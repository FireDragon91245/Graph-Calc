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


# ── Project management ──────────────────────────────────────────

def _load_meta() -> Dict[str, Any]:
    """Load projects metadata"""
    default = {"projects": [], "activeProjectId": None}
    return load_json_file(META_FILE, default)


def _save_meta(meta: Dict[str, Any]):
    """Save projects metadata"""
    save_json_file(META_FILE, meta)


def _generate_project_id() -> str:
    """Generate a unique project id"""
    import uuid
    return uuid.uuid4().hex[:12]


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
    pid = _generate_project_id()
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
    pid = _generate_project_id()
    project = {"id": pid, "name": name}
    meta["projects"].append(project)
    if meta["activeProjectId"] is None:
        meta["activeProjectId"] = pid
    _save_meta(meta)
    _ensure_project_dir(pid)
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

    new_pid = _generate_project_id()
    new_project = {"id": new_pid, "name": new_name}
    meta["projects"].append(new_project)
    _save_meta(meta)

    # Copy all files from source project dir to new project dir
    src_dir = _project_dir(project_id)
    dst_dir = _ensure_project_dir(new_pid)
    if src_dir.exists():
        for f in src_dir.iterdir():
            if f.is_file():
                shutil.copy2(f, dst_dir / f.name)

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


# ── Per-project graph / store ───────────────────────────────────

def load_graph(project_id: str) -> Dict[str, Any]:
    """Load graph data for a project"""
    default = {"nodes": [], "edges": []}
    d = _ensure_project_dir(project_id)
    return load_json_file(d / "graph.json", default)


def save_graph(project_id: str, data: Dict[str, Any]):
    """Save graph data for a project"""
    d = _ensure_project_dir(project_id)
    save_json_file(d / "graph.json", data)


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
