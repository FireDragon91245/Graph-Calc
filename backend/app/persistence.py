import json
import os
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote_plus

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import PyMongoError

DATA_DIR = Path(__file__).parent.parent.parent / "data"
USER_DATA_DIR = DATA_DIR / "user_data"
LEGACY_PROJECTS_DIR = DATA_DIR / "projects"
LEGACY_META_FILE = DATA_DIR / "projects_meta.json"
USERS_FILE = DATA_DIR / "users.json"

DEFAULT_PROJECT_NAME = "Default Project"
DEFAULT_GRAPH_ID = "main"
DEFAULT_GRAPH_NAME = "Main"
DEFAULT_GRAPH_DATA = {"nodes": [], "edges": []}
DEFAULT_STORE = {
    "categories": [],
    "items": [],
    "tags": [],
    "recipeTags": [],
    "recipes": [],
}

MONGO_HOST = os.getenv("MONGO_HOST", "localhost")
MONGO_PORT = int(os.getenv("MONGO_PORT", "27017"))
MONGO_USERNAME = os.getenv("MONGO_USERNAME", "graphcalc")
MONGO_PASSWORD = os.getenv("MONGO_PASSWORD", "MONGO_PASSWORD")
MONGO_AUTH_DB = os.getenv("MONGO_AUTH_DB", "graphcalc")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "graphcalc")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_ALLOW_NOAUTH_FALLBACK = os.getenv("MONGO_ALLOW_NOAUTH_FALLBACK", "true").lower() not in {"0", "false", "no"}

_client: Optional[MongoClient] = None
_database: Optional[Database] = None


def _generate_id() -> str:
    return uuid.uuid4().hex[:12]


def _build_mongo_uri() -> str:
    if MONGO_URI:
        return MONGO_URI

    credentials = ""
    if MONGO_USERNAME:
        credentials = quote_plus(MONGO_USERNAME)
        if MONGO_PASSWORD:
            credentials = f"{credentials}:{quote_plus(MONGO_PASSWORD)}"
        credentials = f"{credentials}@"

    return f"mongodb://{credentials}{MONGO_HOST}:{MONGO_PORT}/{MONGO_DB_NAME}?authSource={quote_plus(MONGO_AUTH_DB)}"


def _build_noauth_mongo_uri() -> str:
    return f"mongodb://{MONGO_HOST}:{MONGO_PORT}/{MONGO_DB_NAME}"


def _candidate_mongo_uris() -> List[str]:
    uris: List[str] = []
    primary = _build_mongo_uri()
    if primary:
        uris.append(primary)

    noauth_uri = _build_noauth_mongo_uri()
    if MONGO_ALLOW_NOAUTH_FALLBACK and noauth_uri not in uris:
        uris.append(noauth_uri)

    return uris


def _db() -> Database:
    global _client, _database

    if _database is None:
        last_error: Optional[Exception] = None
        for candidate_uri in _candidate_mongo_uris():
            try:
                candidate_client = MongoClient(candidate_uri, serverSelectionTimeoutMS=5000)
                candidate_database = candidate_client[MONGO_DB_NAME]
                candidate_database.command("ping")
                _client = candidate_client
                _database = candidate_database
                break
            except PyMongoError as error:
                last_error = error

        if _database is None:
            if last_error is not None:
                raise last_error
            raise RuntimeError("Unable to connect to MongoDB")
    return _database


def _users() -> Collection:
    return _db()["users"]


def _workspaces() -> Collection:
    return _db()["user_workspaces"]


def _projects() -> Collection:
    return _db()["projects"]


def _graphs() -> Collection:
    return _db()["graphs"]


def _settings() -> Collection:
    return _db()["settings"]


def initialize_persistence():
    _db()
    _ensure_indexes()
    _migrate_legacy_data_if_needed()


def _ensure_indexes():
    _users().create_index([("username", ASCENDING)], unique=True)
    _projects().create_index([("userId", ASCENDING), ("projectId", ASCENDING)], unique=True)
    _projects().create_index([("userId", ASCENDING), ("sortOrder", ASCENDING)])
    _graphs().create_index([("userId", ASCENDING), ("projectId", ASCENDING), ("graphId", ASCENDING)], unique=True)
    _graphs().create_index([("userId", ASCENDING), ("projectId", ASCENDING), ("sortOrder", ASCENDING)])


def _default_workspace(user_id: str) -> Dict[str, Any]:
    return {"_id": user_id, "userId": user_id, "activeProjectId": None}


def _default_project_document(user_id: str, project_id: str, name: str, sort_order: int) -> Dict[str, Any]:
    return {
        "_id": f"{user_id}:{project_id}",
        "userId": user_id,
        "projectId": project_id,
        "name": name,
        "sortOrder": sort_order,
        "activeGraphId": DEFAULT_GRAPH_ID,
        "store": dict(DEFAULT_STORE),
    }


def _default_graph_document(user_id: str, project_id: str, graph_id: str, name: str, sort_order: int) -> Dict[str, Any]:
    return {
        "_id": f"{user_id}:{project_id}:{graph_id}",
        "userId": user_id,
        "projectId": project_id,
        "graphId": graph_id,
        "name": name,
        "sortOrder": sort_order,
        "data": dict(DEFAULT_GRAPH_DATA),
    }


def _load_json_file(file_path: Path, default: Any = None) -> Any:
    if not file_path.exists():
        return default

    try:
        with open(file_path, "r", encoding="utf-8") as file_handle:
            return json.load(file_handle)
    except Exception as error:
        print(f"[mongo-migration] failed to read {file_path}: {error}")
        return default


def _workspace_doc(user_id: str) -> Dict[str, Any]:
    ensure_user_workspace(user_id)
    workspace = _workspaces().find_one({"_id": user_id})
    return workspace or _default_workspace(user_id)


def _project_doc(user_id: str, project_id: str) -> Optional[Dict[str, Any]]:
    return _projects().find_one({"userId": user_id, "projectId": project_id})


def _graph_doc(user_id: str, project_id: str, graph_id: str) -> Optional[Dict[str, Any]]:
    return _graphs().find_one({"userId": user_id, "projectId": project_id, "graphId": graph_id})


def _next_sort_order(collection: Collection, query: Dict[str, Any]) -> int:
    highest = collection.find(query).sort("sortOrder", -1).limit(1)
    top = next(highest, None)
    return int(top.get("sortOrder", -1)) + 1 if top else 0


def _normalize_store(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = dict(DEFAULT_STORE)
    if isinstance(data, dict):
        for key in DEFAULT_STORE:
            value = data.get(key, DEFAULT_STORE[key])
            normalized[key] = value if isinstance(value, list) else list(DEFAULT_STORE[key])
    return normalized


def _normalize_graph_data(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = dict(DEFAULT_GRAPH_DATA)
    if isinstance(data, dict):
        for key in DEFAULT_GRAPH_DATA:
            value = data.get(key, DEFAULT_GRAPH_DATA[key])
            normalized[key] = value if isinstance(value, list) else list(DEFAULT_GRAPH_DATA[key])
    return normalized


def _ensure_project_graphs(user_id: str, project_id: str):
    project = _project_doc(user_id, project_id)
    if not project:
        return

    if _graphs().count_documents({"userId": user_id, "projectId": project_id}) == 0:
        _graphs().insert_one(_default_graph_document(user_id, project_id, DEFAULT_GRAPH_ID, DEFAULT_GRAPH_NAME, 0))
        _projects().update_one(
            {"userId": user_id, "projectId": project_id},
            {"$set": {"activeGraphId": DEFAULT_GRAPH_ID}},
        )


def _set_active_project_if_missing(user_id: str, project_id: str):
    workspace = _workspace_doc(user_id)
    if workspace.get("activeProjectId") is None:
        _workspaces().update_one({"_id": user_id}, {"$set": {"activeProjectId": project_id}})


def _set_active_graph_if_missing(user_id: str, project_id: str, graph_id: str):
    project = _project_doc(user_id, project_id)
    if project and project.get("activeGraphId") is None:
        _projects().update_one(
            {"userId": user_id, "projectId": project_id},
            {"$set": {"activeGraphId": graph_id}},
        )


def ensure_user_workspace(user_id: str):
    _workspaces().update_one(
        {"_id": user_id},
        {"$setOnInsert": _default_workspace(user_id)},
        upsert=True,
    )


def delete_user_workspace(user_id: str):
    _graphs().delete_many({"userId": user_id})
    _projects().delete_many({"userId": user_id})
    _workspaces().delete_one({"_id": user_id})


def count_projects(user_id: str) -> int:
    return _projects().count_documents({"userId": user_id})


def list_projects(user_id: str) -> List[Dict[str, str]]:
    ensure_user_workspace(user_id)
    cursor = _projects().find({"userId": user_id}).sort([("sortOrder", ASCENDING), ("name", ASCENDING)])
    return [{"id": project["projectId"], "name": project["name"]} for project in cursor]


def get_active_project_id(user_id: str) -> str:
    ensure_user_workspace(user_id)
    workspace = _workspace_doc(user_id)
    active_project_id = workspace.get("activeProjectId")
    if active_project_id and _project_doc(user_id, active_project_id):
        return active_project_id

    projects = list_projects(user_id)
    if projects:
        active_project_id = projects[0]["id"]
        _workspaces().update_one({"_id": user_id}, {"$set": {"activeProjectId": active_project_id}})
        return active_project_id

    return create_project(user_id, DEFAULT_PROJECT_NAME)["id"]


def set_active_project(user_id: str, project_id: str) -> bool:
    if not _project_doc(user_id, project_id):
        return False
    ensure_user_workspace(user_id)
    _workspaces().update_one({"_id": user_id}, {"$set": {"activeProjectId": project_id}})
    return True


def create_project(user_id: str, name: str) -> Dict[str, str]:
    ensure_user_workspace(user_id)
    project_id = _generate_id()
    sort_order = _next_sort_order(_projects(), {"userId": user_id})
    _projects().insert_one(_default_project_document(user_id, project_id, name, sort_order))
    _graphs().insert_one(_default_graph_document(user_id, project_id, DEFAULT_GRAPH_ID, DEFAULT_GRAPH_NAME, 0))
    _set_active_project_if_missing(user_id, project_id)
    return {"id": project_id, "name": name}


def rename_project(user_id: str, project_id: str, new_name: str) -> bool:
    result = _projects().update_one(
        {"userId": user_id, "projectId": project_id},
        {"$set": {"name": new_name}},
    )
    return result.matched_count > 0


def copy_project(user_id: str, project_id: str, new_name: str) -> Dict[str, str]:
    source_project = _project_doc(user_id, project_id)
    if not source_project:
        raise ValueError(f"Project {project_id} not found")

    new_project_id = _generate_id()
    new_sort_order = _next_sort_order(_projects(), {"userId": user_id})
    project_copy = _default_project_document(user_id, new_project_id, new_name, new_sort_order)
    project_copy["activeGraphId"] = source_project.get("activeGraphId") or DEFAULT_GRAPH_ID
    project_copy["store"] = _normalize_store(source_project.get("store"))
    _projects().insert_one(project_copy)

    source_graphs = list(
        _graphs().find({"userId": user_id, "projectId": project_id}).sort([("sortOrder", ASCENDING), ("name", ASCENDING)])
    )
    if not source_graphs:
        _graphs().insert_one(_default_graph_document(user_id, new_project_id, DEFAULT_GRAPH_ID, DEFAULT_GRAPH_NAME, 0))
    else:
        for graph in source_graphs:
            _graphs().insert_one(
                {
                    "_id": f"{user_id}:{new_project_id}:{graph['graphId']}",
                    "userId": user_id,
                    "projectId": new_project_id,
                    "graphId": graph["graphId"],
                    "name": graph.get("name", graph["graphId"]),
                    "sortOrder": int(graph.get("sortOrder", 0)),
                    "data": _normalize_graph_data(graph.get("data")),
                }
            )

    return {"id": new_project_id, "name": new_name}


def delete_project(user_id: str, project_id: str) -> bool:
    result = _projects().delete_one({"userId": user_id, "projectId": project_id})
    if result.deleted_count == 0:
        return False

    _graphs().delete_many({"userId": user_id, "projectId": project_id})

    workspace = _workspace_doc(user_id)
    if workspace.get("activeProjectId") == project_id:
        next_project = _projects().find({"userId": user_id}).sort("sortOrder", ASCENDING).limit(1)
        fallback = next(next_project, None)
        _workspaces().update_one(
            {"_id": user_id},
            {"$set": {"activeProjectId": fallback.get("projectId") if fallback else None}},
        )

    return True


def list_graphs(user_id: str, project_id: str) -> Dict[str, Any]:
    _ensure_project_graphs(user_id, project_id)
    project = _project_doc(user_id, project_id)
    if not project:
        return {"graphs": [], "activeGraphId": None}

    graphs = list(
        _graphs().find({"userId": user_id, "projectId": project_id}).sort([("sortOrder", ASCENDING), ("name", ASCENDING)])
    )
    active_graph_id = project.get("activeGraphId")
    if graphs and not any(graph["graphId"] == active_graph_id for graph in graphs):
        active_graph_id = graphs[0]["graphId"]
        _projects().update_one(
            {"userId": user_id, "projectId": project_id},
            {"$set": {"activeGraphId": active_graph_id}},
        )

    return {
        "graphs": [{"id": graph["graphId"], "name": graph.get("name", graph["graphId"])} for graph in graphs],
        "activeGraphId": active_graph_id,
    }


def get_active_graph_id(user_id: str, project_id: str) -> str:
    info = list_graphs(user_id, project_id)
    return info["activeGraphId"]


def set_active_graph(user_id: str, project_id: str, graph_id: str) -> bool:
    if not _graph_doc(user_id, project_id, graph_id):
        return False
    result = _projects().update_one(
        {"userId": user_id, "projectId": project_id},
        {"$set": {"activeGraphId": graph_id}},
    )
    return result.matched_count > 0


def create_graph(user_id: str, project_id: str, name: str) -> Dict[str, str]:
    if not _project_doc(user_id, project_id):
        raise ValueError(f"Project {project_id} not found")

    graph_id = _generate_id()
    sort_order = _next_sort_order(_graphs(), {"userId": user_id, "projectId": project_id})
    _graphs().insert_one(_default_graph_document(user_id, project_id, graph_id, name, sort_order))
    _set_active_graph_if_missing(user_id, project_id, graph_id)
    return {"id": graph_id, "name": name}


def rename_graph(user_id: str, project_id: str, graph_id: str, new_name: str) -> bool:
    result = _graphs().update_one(
        {"userId": user_id, "projectId": project_id, "graphId": graph_id},
        {"$set": {"name": new_name}},
    )
    return result.matched_count > 0


def copy_graph(user_id: str, project_id: str, graph_id: str, new_name: str) -> Dict[str, str]:
    source_graph = _graph_doc(user_id, project_id, graph_id)
    if not source_graph:
        raise ValueError(f"Graph {graph_id} not found in project {project_id}")

    new_graph_id = _generate_id()
    sort_order = _next_sort_order(_graphs(), {"userId": user_id, "projectId": project_id})
    new_graph = _default_graph_document(user_id, project_id, new_graph_id, new_name, sort_order)
    new_graph["data"] = _normalize_graph_data(source_graph.get("data"))
    _graphs().insert_one(new_graph)
    return {"id": new_graph_id, "name": new_name}


def delete_graph(user_id: str, project_id: str, graph_id: str) -> bool:
    result = _graphs().delete_one({"userId": user_id, "projectId": project_id, "graphId": graph_id})
    if result.deleted_count == 0:
        return False

    project = _project_doc(user_id, project_id)
    if project and project.get("activeGraphId") == graph_id:
        next_graph = _graphs().find({"userId": user_id, "projectId": project_id}).sort("sortOrder", ASCENDING).limit(1)
        fallback = next(next_graph, None)
        _projects().update_one(
            {"userId": user_id, "projectId": project_id},
            {"$set": {"activeGraphId": fallback.get("graphId") if fallback else None}},
        )
    return True


def load_graph(user_id: str, project_id: str, graph_id: str) -> Dict[str, Any]:
    graph = _graph_doc(user_id, project_id, graph_id)
    if not graph:
        return dict(DEFAULT_GRAPH_DATA)
    return _normalize_graph_data(graph.get("data"))


def save_graph(user_id: str, project_id: str, graph_id: str, data: Dict[str, Any]):
    normalized = _normalize_graph_data(data)
    existing = _graph_doc(user_id, project_id, graph_id)
    if existing:
        _graphs().update_one({"_id": existing["_id"]}, {"$set": {"data": normalized}})
        return

    sort_order = _next_sort_order(_graphs(), {"userId": user_id, "projectId": project_id})
    _graphs().insert_one(_default_graph_document(user_id, project_id, graph_id, graph_id, sort_order))
    _graphs().update_one(
        {"userId": user_id, "projectId": project_id, "graphId": graph_id},
        {"$set": {"data": normalized}},
    )


def load_store(user_id: str, project_id: str) -> Dict[str, Any]:
    project = _project_doc(user_id, project_id)
    if not project:
        return dict(DEFAULT_STORE)
    return _normalize_store(project.get("store"))


def save_store(user_id: str, project_id: str, data: Dict[str, Any]):
    _projects().update_one(
        {"userId": user_id, "projectId": project_id},
        {"$set": {"store": _normalize_store(data)}},
    )


def load_users() -> List[Dict[str, Any]]:
    cursor = _users().find({}).sort("username", ASCENDING)
    users: List[Dict[str, Any]] = []
    for user in cursor:
        current = dict(user)
        current["id"] = current.pop("_id")
        users.append(current)
    return users


def save_users(users: List[Dict[str, Any]]):
    user_ids = [str(user["id"]) for user in users]
    if user_ids:
        _users().delete_many({"_id": {"$nin": user_ids}})
    else:
        _users().delete_many({})

    for user in users:
        payload = dict(user)
        payload["_id"] = str(payload.pop("id"))
        _users().replace_one({"_id": payload["_id"]}, payload, upsert=True)


def get_jwt_secret(generator: Callable[[], str]) -> str:
    secret_record = _settings().find_one({"_id": "jwt-secret"})
    if secret_record and isinstance(secret_record.get("secret"), str) and secret_record["secret"]:
        return secret_record["secret"]

    secret = generator()
    _settings().update_one(
        {"_id": "jwt-secret"},
        {"$setOnInsert": {"secret": secret}},
        upsert=True,
    )
    stored = _settings().find_one({"_id": "jwt-secret"})
    return str(stored.get("secret") if stored else secret)


def migrate_legacy_global_data_to_user(user_id: str, clear_existing: bool = False):
    if clear_existing:
        delete_user_workspace(user_id)
    ensure_user_workspace(user_id)
    _import_workspace(user_id, LEGACY_META_FILE, LEGACY_PROJECTS_DIR, replace_existing=clear_existing)


def _migrate_legacy_data_if_needed():
    marker = _settings().find_one({"_id": "legacy-import"})
    if marker and marker.get("completed"):
        return

    has_existing_data = (
        _users().count_documents({}) > 0
        or _projects().count_documents({}) > 0
        or _graphs().count_documents({}) > 0
        or _workspaces().count_documents({}) > 0
    )
    if has_existing_data:
        _settings().update_one(
            {"_id": "legacy-import"},
            {"$set": {"completed": True, "source": "mongo-existing"}},
            upsert=True,
        )
        return

    legacy_payload = _load_json_file(USERS_FILE, {"users": []})
    legacy_users = legacy_payload.get("users", []) if isinstance(legacy_payload, dict) else []
    imported_any = False
    current_users: List[Dict[str, Any]] = []

    for user in legacy_users:
        payload = dict(user)
        payload["id"] = str(payload.get("id") or _generate_id())
        current_users = [entry for entry in current_users if entry.get("id") != payload["id"]]
        current_users.append(payload)
        ensure_user_workspace(payload["id"])

        user_meta = USER_DATA_DIR / payload["id"] / "projects_meta.json"
        user_projects = USER_DATA_DIR / payload["id"] / "projects"
        if user_meta.exists() or user_projects.exists():
            _import_workspace(payload["id"], user_meta, user_projects, replace_existing=False)
            imported_any = True

    if current_users:
        save_users(current_users)

    if not imported_any and current_users and (LEGACY_META_FILE.exists() or LEGACY_PROJECTS_DIR.exists()):
        _import_workspace(current_users[0]["id"], LEGACY_META_FILE, LEGACY_PROJECTS_DIR, replace_existing=False)
        imported_any = True

    _settings().update_one(
        {"_id": "legacy-import"},
        {"$set": {"completed": True, "source": "json-files" if imported_any else "none"}},
        upsert=True,
    )


def _import_workspace(user_id: str, meta_path: Path, projects_dir: Path, replace_existing: bool):
    ensure_user_workspace(user_id)
    if replace_existing:
        _graphs().delete_many({"userId": user_id})
        _projects().delete_many({"userId": user_id})

    meta = _load_json_file(meta_path, {"projects": [], "activeProjectId": None})
    project_entries = meta.get("projects", []) if isinstance(meta, dict) else []

    for index, project in enumerate(project_entries):
        project_id = str(project.get("id") or _generate_id())
        project_name = str(project.get("name") or f"Project {index + 1}")
        project_doc = _default_project_document(user_id, project_id, project_name, index)
        project_doc["store"] = _normalize_store(
            _load_json_file(projects_dir / project_id / "store.json", dict(DEFAULT_STORE))
        )
        _projects().replace_one({"_id": project_doc["_id"]}, project_doc, upsert=True)

        graph_meta = _load_json_file(projects_dir / project_id / "graphs_meta.json", None)
        if graph_meta and isinstance(graph_meta, dict):
            graph_entries = graph_meta.get("graphs", [])
            active_graph_id = graph_meta.get("activeGraphId")
        else:
            graph_entries = [{"id": DEFAULT_GRAPH_ID, "name": DEFAULT_GRAPH_NAME}]
            active_graph_id = DEFAULT_GRAPH_ID

        _graphs().delete_many({"userId": user_id, "projectId": project_id})
        for graph_index, graph in enumerate(graph_entries):
            graph_id = str(graph.get("id") or _generate_id())
            graph_name = str(graph.get("name") or graph_id)
            graph_file = projects_dir / project_id / "graphs" / f"{graph_id}.json"
            if not graph_file.exists() and graph_id == DEFAULT_GRAPH_ID:
                graph_file = projects_dir / project_id / "graph.json"

            graph_doc = _default_graph_document(user_id, project_id, graph_id, graph_name, graph_index)
            graph_doc["data"] = _normalize_graph_data(_load_json_file(graph_file, dict(DEFAULT_GRAPH_DATA)))
            _graphs().replace_one({"_id": graph_doc["_id"]}, graph_doc, upsert=True)

        _projects().update_one(
            {"userId": user_id, "projectId": project_id},
            {"$set": {"activeGraphId": active_graph_id or DEFAULT_GRAPH_ID}},
        )

    _workspaces().update_one(
        {"_id": user_id},
        {"$set": {"activeProjectId": meta.get("activeProjectId") if isinstance(meta, dict) else None}},
        upsert=True,
    )

    if not project_entries:
        get_active_project_id(user_id)
