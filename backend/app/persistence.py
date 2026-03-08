import json
import shutil
from pathlib import Path
from typing import Any, Dict, List

DATA_DIR = Path(__file__).parent.parent.parent / "data"
USER_DATA_DIR = DATA_DIR / "user_data"
LEGACY_PROJECTS_DIR = DATA_DIR / "projects"
LEGACY_META_FILE = DATA_DIR / "projects_meta.json"
USERS_FILE = DATA_DIR / "users.json"


def ensure_data_dir():
    """Ensure base data directories exist."""
    DATA_DIR.mkdir(exist_ok=True)
    USER_DATA_DIR.mkdir(exist_ok=True)


def load_json_file(file_path: Path, default: Any = None) -> Any:
    """Load JSON file or return default if not exists."""
    ensure_data_dir()
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as file_handle:
                return json.load(file_handle)
        except Exception as error:
            print(f"Error loading {file_path}: {error}")
            return default
    return default


def save_json_file(file_path: Path, data: Any):
    """Save data to JSON file."""
    ensure_data_dir()
    file_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(file_path, "w", encoding="utf-8") as file_handle:
            json.dump(data, file_handle, indent=2, ensure_ascii=False)
    except Exception as error:
        print(f"Error saving {file_path}: {error}")
        raise


def _generate_id() -> str:
    """Generate a unique id."""
    import uuid
    return uuid.uuid4().hex[:12]


def _user_root(user_id: str) -> Path:
    return USER_DATA_DIR / user_id


def _user_projects_dir(user_id: str) -> Path:
    return _user_root(user_id) / "projects"


def _user_meta_file(user_id: str) -> Path:
    return _user_root(user_id) / "projects_meta.json"


def _ensure_user_root(user_id: str) -> Path:
    root = _user_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _ensure_user_projects_dir(user_id: str) -> Path:
    projects_dir = _user_projects_dir(user_id)
    projects_dir.mkdir(parents=True, exist_ok=True)
    return projects_dir


def _project_dir(user_id: str, project_id: str) -> Path:
    return _user_projects_dir(user_id) / project_id


def _ensure_project_dir(user_id: str, project_id: str) -> Path:
    project_dir = _project_dir(user_id, project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


def _graphs_dir(user_id: str, project_id: str) -> Path:
    return _project_dir(user_id, project_id) / "graphs"


def _ensure_graphs_dir(user_id: str, project_id: str) -> Path:
    graphs_dir = _graphs_dir(user_id, project_id)
    graphs_dir.mkdir(parents=True, exist_ok=True)
    return graphs_dir


def _graphs_meta_path(user_id: str, project_id: str) -> Path:
    return _project_dir(user_id, project_id) / "graphs_meta.json"


def _copy_legacy_data_to_user(user_id: str):
    legacy_meta = load_json_file(LEGACY_META_FILE, None)
    legacy_projects_exist = LEGACY_PROJECTS_DIR.exists() and any(LEGACY_PROJECTS_DIR.iterdir())
    if legacy_meta is None and not legacy_projects_exist:
        return

    _ensure_user_root(user_id)
    _ensure_user_projects_dir(user_id)

    if legacy_meta is not None:
        save_json_file(_user_meta_file(user_id), legacy_meta)
    else:
        save_json_file(_user_meta_file(user_id), {"projects": [], "activeProjectId": None})

    if legacy_projects_exist:
        shutil.copytree(LEGACY_PROJECTS_DIR, _user_projects_dir(user_id), dirs_exist_ok=True)


def migrate_legacy_global_data_to_user(user_id: str, clear_existing: bool = False):
    """Copy legacy global data into a specific user's isolated workspace."""
    ensure_data_dir()

    user_root = _user_root(user_id)
    if clear_existing and user_root.exists():
        shutil.rmtree(user_root)

    _copy_legacy_data_to_user(user_id)
    ensure_user_workspace(user_id)


def ensure_user_workspace(user_id: str):
    """Ensure isolated per-user storage exists."""
    _ensure_user_root(user_id)
    meta_path = _user_meta_file(user_id)
    projects_dir = _user_projects_dir(user_id)

    if not meta_path.exists():
        save_json_file(meta_path, {"projects": [], "activeProjectId": None})

    if not projects_dir.exists():
        projects_dir.mkdir(parents=True, exist_ok=True)


def delete_user_workspace(user_id: str):
    """Remove a user's isolated workspace data."""
    user_root = _user_root(user_id)
    if user_root.exists():
        shutil.rmtree(user_root)


def count_projects(user_id: str) -> int:
    return len(list_projects(user_id))


def _load_meta(user_id: str) -> Dict[str, Any]:
    default = {"projects": [], "activeProjectId": None}
    ensure_user_workspace(user_id)
    return load_json_file(_user_meta_file(user_id), default)


def _save_meta(user_id: str, meta: Dict[str, Any]):
    save_json_file(_user_meta_file(user_id), meta)


def list_projects(user_id: str) -> List[Dict[str, str]]:
    meta = _load_meta(user_id)
    return meta.get("projects", [])


def get_active_project_id(user_id: str) -> str:
    meta = _load_meta(user_id)
    active_project_id = meta.get("activeProjectId")
    projects = meta.get("projects", [])

    if active_project_id and any(project["id"] == active_project_id for project in projects):
        return active_project_id

    if projects:
        meta["activeProjectId"] = projects[0]["id"]
        _save_meta(user_id, meta)
        return projects[0]["id"]

    project_id = _generate_id()
    meta["projects"] = [{"id": project_id, "name": "Default Project"}]
    meta["activeProjectId"] = project_id
    _save_meta(user_id, meta)
    _ensure_project_dir(user_id, project_id)
    _init_graphs_meta(user_id, project_id)
    return project_id


def set_active_project(user_id: str, project_id: str) -> bool:
    meta = _load_meta(user_id)
    if not any(project["id"] == project_id for project in meta.get("projects", [])):
        return False
    meta["activeProjectId"] = project_id
    _save_meta(user_id, meta)
    return True


def create_project(user_id: str, name: str) -> Dict[str, str]:
    meta = _load_meta(user_id)
    project_id = _generate_id()
    project = {"id": project_id, "name": name}
    meta["projects"].append(project)
    if meta["activeProjectId"] is None:
        meta["activeProjectId"] = project_id
    _save_meta(user_id, meta)
    _ensure_project_dir(user_id, project_id)
    _init_graphs_meta(user_id, project_id)
    return project


def rename_project(user_id: str, project_id: str, new_name: str) -> bool:
    meta = _load_meta(user_id)
    for project in meta["projects"]:
        if project["id"] == project_id:
            project["name"] = new_name
            _save_meta(user_id, meta)
            return True
    return False


def copy_project(user_id: str, project_id: str, new_name: str) -> Dict[str, str]:
    meta = _load_meta(user_id)
    source_project = next((project for project in meta["projects"] if project["id"] == project_id), None)
    if not source_project:
        raise ValueError(f"Project {project_id} not found")

    _maybe_migrate_project(user_id, project_id)

    new_project_id = _generate_id()
    new_project = {"id": new_project_id, "name": new_name}
    meta["projects"].append(new_project)
    _save_meta(user_id, meta)

    source_dir = _project_dir(user_id, project_id)
    target_dir = _project_dir(user_id, new_project_id)
    if source_dir.exists():
        shutil.copytree(source_dir, target_dir)
    else:
        _ensure_project_dir(user_id, new_project_id)

    return new_project


def delete_project(user_id: str, project_id: str) -> bool:
    meta = _load_meta(user_id)
    original_length = len(meta["projects"])
    meta["projects"] = [project for project in meta["projects"] if project["id"] != project_id]
    if len(meta["projects"]) == original_length:
        return False

    project_dir = _project_dir(user_id, project_id)
    if project_dir.exists():
        shutil.rmtree(project_dir)

    if meta["activeProjectId"] == project_id:
        meta["activeProjectId"] = meta["projects"][0]["id"] if meta["projects"] else None
    _save_meta(user_id, meta)
    return True


def _load_graphs_meta(user_id: str, project_id: str) -> Dict[str, Any]:
    default = {"graphs": [], "activeGraphId": None}
    return load_json_file(_graphs_meta_path(user_id, project_id), default)


def _save_graphs_meta(user_id: str, project_id: str, meta: Dict[str, Any]):
    _ensure_project_dir(user_id, project_id)
    save_json_file(_graphs_meta_path(user_id, project_id), meta)


def _init_graphs_meta(user_id: str, project_id: str) -> str:
    graph_id = "main"
    graph_meta = {"graphs": [{"id": graph_id, "name": "Main"}], "activeGraphId": graph_id}
    _save_graphs_meta(user_id, project_id, graph_meta)
    _ensure_graphs_dir(user_id, project_id)
    save_json_file(_graphs_dir(user_id, project_id) / f"{graph_id}.json", {"nodes": [], "edges": []})
    return graph_id


def _maybe_migrate_project(user_id: str, project_id: str):
    project_dir = _project_dir(user_id, project_id)
    graphs_meta_file = _graphs_meta_path(user_id, project_id)
    old_graph_file = project_dir / "graph.json"

    if graphs_meta_file.exists():
        return

    graph_dir = _ensure_graphs_dir(user_id, project_id)
    graph_id = "main"

    if old_graph_file.exists():
        shutil.move(str(old_graph_file), str(graph_dir / f"{graph_id}.json"))
    else:
        save_json_file(graph_dir / f"{graph_id}.json", {"nodes": [], "edges": []})

    graph_meta = {"graphs": [{"id": graph_id, "name": "Main"}], "activeGraphId": graph_id}
    _save_graphs_meta(user_id, project_id, graph_meta)


def list_graphs(user_id: str, project_id: str) -> Dict[str, Any]:
    _maybe_migrate_project(user_id, project_id)
    graph_meta = _load_graphs_meta(user_id, project_id)
    graphs = graph_meta.get("graphs", [])
    active_graph_id = graph_meta.get("activeGraphId")

    if not active_graph_id or not any(graph["id"] == active_graph_id for graph in graphs):
        if graphs:
            active_graph_id = graphs[0]["id"]
            graph_meta["activeGraphId"] = active_graph_id
            _save_graphs_meta(user_id, project_id, graph_meta)
        else:
            graph_id = _init_graphs_meta(user_id, project_id)
            return {"graphs": [{"id": graph_id, "name": "Main"}], "activeGraphId": graph_id}

    return {"graphs": graphs, "activeGraphId": active_graph_id}


def get_active_graph_id(user_id: str, project_id: str) -> str:
    info = list_graphs(user_id, project_id)
    return info["activeGraphId"]


def set_active_graph(user_id: str, project_id: str, graph_id: str) -> bool:
    _maybe_migrate_project(user_id, project_id)
    graph_meta = _load_graphs_meta(user_id, project_id)
    if not any(graph["id"] == graph_id for graph in graph_meta.get("graphs", [])):
        return False
    graph_meta["activeGraphId"] = graph_id
    _save_graphs_meta(user_id, project_id, graph_meta)
    return True


def create_graph(user_id: str, project_id: str, name: str) -> Dict[str, str]:
    _maybe_migrate_project(user_id, project_id)
    graph_meta = _load_graphs_meta(user_id, project_id)
    graph_id = _generate_id()
    graph = {"id": graph_id, "name": name}
    graph_meta["graphs"].append(graph)
    if graph_meta["activeGraphId"] is None:
        graph_meta["activeGraphId"] = graph_id
    _save_graphs_meta(user_id, project_id, graph_meta)
    save_json_file(_ensure_graphs_dir(user_id, project_id) / f"{graph_id}.json", {"nodes": [], "edges": []})
    return graph


def rename_graph(user_id: str, project_id: str, graph_id: str, new_name: str) -> bool:
    _maybe_migrate_project(user_id, project_id)
    graph_meta = _load_graphs_meta(user_id, project_id)
    for graph in graph_meta["graphs"]:
        if graph["id"] == graph_id:
            graph["name"] = new_name
            _save_graphs_meta(user_id, project_id, graph_meta)
            return True
    return False


def copy_graph(user_id: str, project_id: str, graph_id: str, new_name: str) -> Dict[str, str]:
    _maybe_migrate_project(user_id, project_id)
    graph_meta = _load_graphs_meta(user_id, project_id)
    source_graph = next((graph for graph in graph_meta["graphs"] if graph["id"] == graph_id), None)
    if not source_graph:
        raise ValueError(f"Graph {graph_id} not found in project {project_id}")

    new_graph_id = _generate_id()
    new_graph = {"id": new_graph_id, "name": new_name}
    graph_meta["graphs"].append(new_graph)
    _save_graphs_meta(user_id, project_id, graph_meta)

    graph_dir = _ensure_graphs_dir(user_id, project_id)
    source_file = graph_dir / f"{graph_id}.json"
    target_file = graph_dir / f"{new_graph_id}.json"
    if source_file.exists():
        shutil.copy2(str(source_file), str(target_file))
    else:
        save_json_file(target_file, {"nodes": [], "edges": []})

    return new_graph


def delete_graph(user_id: str, project_id: str, graph_id: str) -> bool:
    _maybe_migrate_project(user_id, project_id)
    graph_meta = _load_graphs_meta(user_id, project_id)
    original_length = len(graph_meta["graphs"])
    graph_meta["graphs"] = [graph for graph in graph_meta["graphs"] if graph["id"] != graph_id]
    if len(graph_meta["graphs"]) == original_length:
        return False

    graph_file = _graphs_dir(user_id, project_id) / f"{graph_id}.json"
    if graph_file.exists():
        graph_file.unlink()

    if graph_meta["activeGraphId"] == graph_id:
        graph_meta["activeGraphId"] = graph_meta["graphs"][0]["id"] if graph_meta["graphs"] else None
    _save_graphs_meta(user_id, project_id, graph_meta)
    return True


def load_graph(user_id: str, project_id: str, graph_id: str) -> Dict[str, Any]:
    _maybe_migrate_project(user_id, project_id)
    default = {"nodes": [], "edges": []}
    graph_dir = _ensure_graphs_dir(user_id, project_id)
    return load_json_file(graph_dir / f"{graph_id}.json", default)


def save_graph(user_id: str, project_id: str, graph_id: str, data: Dict[str, Any]):
    _maybe_migrate_project(user_id, project_id)
    graph_dir = _ensure_graphs_dir(user_id, project_id)
    save_json_file(graph_dir / f"{graph_id}.json", data)


def load_store(user_id: str, project_id: str) -> Dict[str, Any]:
    default = {
        "categories": [],
        "items": [],
        "tags": [],
        "recipeTags": [],
        "recipes": [],
    }
    project_dir = _ensure_project_dir(user_id, project_id)
    return load_json_file(project_dir / "store.json", default)


def save_store(user_id: str, project_id: str, data: Dict[str, Any]):
    project_dir = _ensure_project_dir(user_id, project_id)
    save_json_file(project_dir / "store.json", data)


def load_users() -> List[Dict[str, Any]]:
    default = {"users": []}
    data = load_json_file(USERS_FILE, default)
    return data.get("users", [])


def save_users(users: List[Dict[str, Any]]):
    save_json_file(USERS_FILE, {"users": users})
