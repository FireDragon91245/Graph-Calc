import json
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List

# Define data directory path
DATA_DIR = Path(__file__).parent.parent.parent / "data"
PROJECTS_DIR = DATA_DIR / "projects"
META_FILE = DATA_DIR / "projects_meta.json"


def ensure_data_dir():
    """Ensure data directory exists"""
    DATA_DIR.mkdir(exist_ok=True)
    PROJECTS_DIR.mkdir(exist_ok=True)


def _project_dir(project_id: str) -> Path:
    """Get the directory path for a project"""
    return PROJECTS_DIR / project_id


def _ensure_project_dir(project_id: str) -> Path:
    """Ensure project directory exists and return it"""
    d = _project_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _graphs_dir(project_id: str) -> Path:
    """Get the graphs directory for a project"""
    return _project_dir(project_id) / "graphs"


def _ensure_graphs_dir(project_id: str) -> Path:
    """Ensure graphs directory exists and return it"""
    d = _graphs_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _graphs_meta_path(project_id: str) -> Path:
    """Path to graphs_meta.json inside a project"""
    return _project_dir(project_id) / "graphs_meta.json"


def load_json_file(file_path: Path, default: Any = None) -> Any:
    """Load JSON file or return default if not exists"""
    ensure_data_dir()
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
            return default
    return default


def save_json_file(file_path: Path, data: Any):
    """Save data to JSON file"""
    ensure_data_dir()
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving {file_path}: {e}")
        raise


def _generate_id() -> str:
    """Generate a unique id"""
    import uuid
    return uuid.uuid4().hex[:12]


# ── Project management ──────────────────────────────────────────

def _load_meta() -> Dict[str, Any]:
    """Load projects metadata"""
    default = {"projects": [], "activeProjectId": None}
    return load_json_file(META_FILE, default)


def _save_meta(meta: Dict[str, Any]):
    """Save projects metadata"""
    save_json_file(META_FILE, meta)


def list_projects() -> List[Dict[str, str]]:
    """Return list of projects [{id, name}]"""
    meta = _load_meta()
    return meta.get("projects", [])


def get_active_project_id() -> str:
    """Return the active project id, creating a default project if none exists"""
    meta = _load_meta()
    active = meta.get("activeProjectId")
    if active and any(p["id"] == active for p in meta.get("projects", [])):
        return active
    # If no active project, pick the first one or create one
    projects = meta.get("projects", [])
    if projects:
        meta["activeProjectId"] = projects[0]["id"]
        _save_meta(meta)
        return projects[0]["id"]
    # Create default project
    pid = _generate_id()
    meta["projects"] = [{"id": pid, "name": "Default Project"}]
    meta["activeProjectId"] = pid
    _save_meta(meta)
    _ensure_project_dir(pid)
    return pid


def set_active_project(project_id: str) -> bool:
    """Set the active project"""
    meta = _load_meta()
    if not any(p["id"] == project_id for p in meta.get("projects", [])):
        return False
    meta["activeProjectId"] = project_id
    _save_meta(meta)
    return True


def create_project(name: str) -> Dict[str, str]:
    """Create a new project, returns {id, name}"""
    meta = _load_meta()
    pid = _generate_id()
    project = {"id": pid, "name": name}
    meta["projects"].append(project)
    if meta["activeProjectId"] is None:
        meta["activeProjectId"] = pid
    _save_meta(meta)
    _ensure_project_dir(pid)
    # Create default "Main" graph for new projects
    _init_graphs_meta(pid)
    return project


def rename_project(project_id: str, new_name: str) -> bool:
    """Rename a project"""
    meta = _load_meta()
    for p in meta["projects"]:
        if p["id"] == project_id:
            p["name"] = new_name
            _save_meta(meta)
            return True
    return False


def copy_project(project_id: str, new_name: str) -> Dict[str, str]:
    """Copy a project with all its data"""
    meta = _load_meta()
    source = None
    for p in meta["projects"]:
        if p["id"] == project_id:
            source = p
            break
    if not source:
        raise ValueError(f"Project {project_id} not found")

    # Ensure source is migrated first
    _maybe_migrate_project(project_id)

    new_pid = _generate_id()
    new_project = {"id": new_pid, "name": new_name}
    meta["projects"].append(new_project)
    _save_meta(meta)

    # Deep-copy the entire project directory tree
    src_dir = _project_dir(project_id)
    dst_dir = _project_dir(new_pid)
    if src_dir.exists():
        shutil.copytree(src_dir, dst_dir)
    else:
        _ensure_project_dir(new_pid)

    return new_project


def delete_project(project_id: str) -> bool:
    """Delete a project and its data"""
    meta = _load_meta()
    original_len = len(meta["projects"])
    meta["projects"] = [p for p in meta["projects"] if p["id"] != project_id]
    if len(meta["projects"]) == original_len:
        return False

    # Remove project directory
    proj_dir = _project_dir(project_id)
    if proj_dir.exists():
        shutil.rmtree(proj_dir)

    # If deleted project was active, switch to first remaining or None
    if meta["activeProjectId"] == project_id:
        meta["activeProjectId"] = meta["projects"][0]["id"] if meta["projects"] else None
    _save_meta(meta)
    return True


# ── Graph management (per-project, multi-graph) ────────────────

def _load_graphs_meta(project_id: str) -> Dict[str, Any]:
    """Load graphs metadata for a project"""
    default = {"graphs": [], "activeGraphId": None}
    return load_json_file(_graphs_meta_path(project_id), default)


def _save_graphs_meta(project_id: str, meta: Dict[str, Any]):
    """Save graphs metadata for a project"""
    _ensure_project_dir(project_id)
    save_json_file(_graphs_meta_path(project_id), meta)


def _init_graphs_meta(project_id: str) -> str:
    """Create default graphs_meta with a 'Main' graph. Returns graph id."""
    gid = "main"
    gmeta = {"graphs": [{"id": gid, "name": "Main"}], "activeGraphId": gid}
    _save_graphs_meta(project_id, gmeta)
    _ensure_graphs_dir(project_id)
    # Create empty graph file
    save_json_file(_graphs_dir(project_id) / f"{gid}.json", {"nodes": [], "edges": []})
    return gid


def _maybe_migrate_project(project_id: str):
    """Migrate legacy single-graph project to multi-graph structure."""
    proj_dir = _project_dir(project_id)
    graphs_meta_file = _graphs_meta_path(project_id)
    old_graph_file = proj_dir / "graph.json"

    # Already migrated
    if graphs_meta_file.exists():
        return

    gdir = _ensure_graphs_dir(project_id)
    gid = "main"

    # Move old graph.json → graphs/main.json
    if old_graph_file.exists():
        shutil.move(str(old_graph_file), str(gdir / f"{gid}.json"))
    else:
        save_json_file(gdir / f"{gid}.json", {"nodes": [], "edges": []})

    # Write graphs_meta
    gmeta = {"graphs": [{"id": gid, "name": "Main"}], "activeGraphId": gid}
    _save_graphs_meta(project_id, gmeta)


def list_graphs(project_id: str) -> Dict[str, Any]:
    """Return {graphs: [{id, name}], activeGraphId} for a project"""
    _maybe_migrate_project(project_id)
    gmeta = _load_graphs_meta(project_id)
    graphs = gmeta.get("graphs", [])
    active = gmeta.get("activeGraphId")
    # Ensure active is valid
    if not active or not any(g["id"] == active for g in graphs):
        if graphs:
            active = graphs[0]["id"]
            gmeta["activeGraphId"] = active
            _save_graphs_meta(project_id, gmeta)
        else:
            # No graphs at all – create default
            gid = _init_graphs_meta(project_id)
            return {"graphs": [{"id": gid, "name": "Main"}], "activeGraphId": gid}
    return {"graphs": graphs, "activeGraphId": active}


def get_active_graph_id(project_id: str) -> str:
    """Return the active graph id for a project"""
    info = list_graphs(project_id)
    return info["activeGraphId"]


def set_active_graph(project_id: str, graph_id: str) -> bool:
    """Set the active graph for a project"""
    _maybe_migrate_project(project_id)
    gmeta = _load_graphs_meta(project_id)
    if not any(g["id"] == graph_id for g in gmeta.get("graphs", [])):
        return False
    gmeta["activeGraphId"] = graph_id
    _save_graphs_meta(project_id, gmeta)
    return True


def create_graph(project_id: str, name: str) -> Dict[str, str]:
    """Create a new graph in a project, returns {id, name}"""
    _maybe_migrate_project(project_id)
    gmeta = _load_graphs_meta(project_id)
    gid = _generate_id()
    graph = {"id": gid, "name": name}
    gmeta["graphs"].append(graph)
    if gmeta["activeGraphId"] is None:
        gmeta["activeGraphId"] = gid
    _save_graphs_meta(project_id, gmeta)
    # Create empty graph file
    gdir = _ensure_graphs_dir(project_id)
    save_json_file(gdir / f"{gid}.json", {"nodes": [], "edges": []})
    return graph


def rename_graph(project_id: str, graph_id: str, new_name: str) -> bool:
    """Rename a graph"""
    _maybe_migrate_project(project_id)
    gmeta = _load_graphs_meta(project_id)
    for g in gmeta["graphs"]:
        if g["id"] == graph_id:
            g["name"] = new_name
            _save_graphs_meta(project_id, gmeta)
            return True
    return False


def copy_graph(project_id: str, graph_id: str, new_name: str) -> Dict[str, str]:
    """Duplicate a graph within the same project"""
    _maybe_migrate_project(project_id)
    gmeta = _load_graphs_meta(project_id)
    source = None
    for g in gmeta["graphs"]:
        if g["id"] == graph_id:
            source = g
            break
    if not source:
        raise ValueError(f"Graph {graph_id} not found in project {project_id}")

    new_gid = _generate_id()
    new_graph = {"id": new_gid, "name": new_name}
    gmeta["graphs"].append(new_graph)
    _save_graphs_meta(project_id, gmeta)

    # Copy graph data file
    gdir = _ensure_graphs_dir(project_id)
    src_file = gdir / f"{graph_id}.json"
    dst_file = gdir / f"{new_gid}.json"
    if src_file.exists():
        shutil.copy2(str(src_file), str(dst_file))
    else:
        save_json_file(dst_file, {"nodes": [], "edges": []})

    return new_graph


def delete_graph(project_id: str, graph_id: str) -> bool:
    """Delete a graph from a project"""
    _maybe_migrate_project(project_id)
    gmeta = _load_graphs_meta(project_id)
    original_len = len(gmeta["graphs"])
    gmeta["graphs"] = [g for g in gmeta["graphs"] if g["id"] != graph_id]
    if len(gmeta["graphs"]) == original_len:
        return False

    # Remove graph file
    gdir = _graphs_dir(project_id)
    graph_file = gdir / f"{graph_id}.json"
    if graph_file.exists():
        graph_file.unlink()

    # If deleted graph was active, switch to first remaining or None
    if gmeta["activeGraphId"] == graph_id:
        gmeta["activeGraphId"] = gmeta["graphs"][0]["id"] if gmeta["graphs"] else None
    _save_graphs_meta(project_id, gmeta)
    return True


# ── Per-project graph / store ───────────────────────────────────

def load_graph(project_id: str, graph_id: str) -> Dict[str, Any]:
    """Load graph data for a specific graph in a project"""
    _maybe_migrate_project(project_id)
    default = {"nodes": [], "edges": []}
    gdir = _ensure_graphs_dir(project_id)
    return load_json_file(gdir / f"{graph_id}.json", default)


def save_graph(project_id: str, graph_id: str, data: Dict[str, Any]):
    """Save graph data for a specific graph in a project"""
    _maybe_migrate_project(project_id)
    gdir = _ensure_graphs_dir(project_id)
    save_json_file(gdir / f"{graph_id}.json", data)


def load_store(project_id: str) -> Dict[str, Any]:
    """Load store data for a project"""
    default = {
        "categories": [],
        "items": [],
        "tags": [],
        "recipeTags": [],
        "recipes": []
    }
    d = _ensure_project_dir(project_id)
    return load_json_file(d / "store.json", default)


def save_store(project_id: str, data: Dict[str, Any]):
    """Save store data for a project"""
    d = _ensure_project_dir(project_id)
    save_json_file(d / "store.json", data)
