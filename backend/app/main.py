import os
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.api.models import (
    AccountProfile,
    DeleteAccountRequest,
    Graph,
    GraphData,
    PasswordChangeRequest,
    SessionResponse,
    SolveRequest,
    SolveResponse,
    StoreData,
)
from app.auth import (
    DEFAULT_SESSION_VERSION,
    JWT_TTL_SECONDS,
    create_session_token,
    create_user_record,
    decode_session_token,
    hash_password,
    verify_password,
)
from app.solver.solver import solve_graph
from app.persistence import (
    load_graph, save_graph, load_store, save_store,
    list_projects, get_active_project_id, set_active_project,
    create_project, rename_project, copy_project, delete_project,
    list_graphs, get_active_graph_id, set_active_graph,
    create_graph, rename_graph, copy_graph, delete_graph,
    count_projects, delete_user_workspace, ensure_user_workspace,
    load_users, save_users, migrate_legacy_global_data_to_user,
)

app = FastAPI(title="GraphCalc Solver")

SESSION_COOKIE_NAME = "graphcalc_session"
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "https://localhost:5173,https://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    print(
        "[http]"
        f" method={request.method}"
        f" path={request.url.path}"
        f" status={response.status_code}"
        f" origin={request.headers.get('origin', '-') }"
    )
    return response


# ── Helper ──────────────────────────────────────────────────────

def _resolve_project(user_id: str, project_id: Optional[str]) -> str:
    """Return the given project_id or the active one."""
    if project_id:
        if not any(project["id"] == project_id for project in list_projects(user_id)):
            raise HTTPException(status_code=404, detail="Project not found")
        return project_id
    return get_active_project_id(user_id)


def _require_project_access(user_id: str, project_id: str) -> str:
    if not any(project["id"] == project_id for project in list_projects(user_id)):
        raise HTTPException(status_code=404, detail="Project not found")
    return project_id


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_TTL_SECONDS,
        path="/",
    )


def _clear_session_cookie(response: Response):
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )


def _get_current_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = decode_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid session")

    users = load_users()
    user = next(
        (
            entry for entry in users
            if entry.get("id") == payload["userId"] and entry.get("username") == payload["username"]
        ),
        None,
    )
    if not user:
        raise HTTPException(status_code=401, detail="Session user not found")

    current_session_version = int(user.get("sessionVersion") or DEFAULT_SESSION_VERSION)
    if current_session_version != int(payload.get("sessionVersion") or DEFAULT_SESSION_VERSION):
        raise HTTPException(status_code=401, detail="Session is no longer valid")

    return {"id": user["id"], "username": user["username"], "sessionVersion": current_session_version}


def require_authenticated_user(request: Request) -> dict:
    return _get_current_session(request)


def _build_account_profile(user: dict) -> AccountProfile:
    active_project_id = None
    try:
        active_project_id = get_active_project_id(user["id"])
    except Exception:
        active_project_id = None

    return AccountProfile(
        id=user["id"],
        username=user["username"],
        projectCount=count_projects(user["id"]),
        activeProjectId=active_project_id,
    )


def _find_user_record(user_id: str) -> dict:
    users = load_users()
    user = next((entry for entry in users if entry.get("id") == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _save_updated_user(updated_user: dict):
    users = load_users()
    for index, user in enumerate(users):
        if user.get("id") == updated_user["id"]:
            users[index] = updated_user
            save_users(users)
            return
    raise HTTPException(status_code=404, detail="User not found")


# ── Project management ──────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str

class ProjectRename(BaseModel):
    name: str

class ProjectCopy(BaseModel):
    name: str


class AuthCredentials(BaseModel):
    username: str
    password: str


@app.post("/register")
def api_register(body: AuthCredentials, response: Response):
    username = body.username.strip()
    password = body.password

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(password) <= 8:
        raise HTTPException(status_code=400, detail="Password must be longer than 8 characters")

    users = load_users()
    if any(entry.get("username") == username for entry in users):
        raise HTTPException(status_code=409, detail="Username already exists")

    user = create_user_record(username, password)
    users.append(user)
    save_users(users)
    ensure_user_workspace(user["id"])

    token = create_session_token(user)
    _set_session_cookie(response, token)
    return {
        "token": token,
        "user": {"id": user["id"], "username": user["username"]},
    }


@app.post("/authenticate")
def api_authenticate(body: AuthCredentials, response: Response):
    username = body.username.strip()
    password = body.password

    users = load_users()
    user = next((entry for entry in users if entry.get("username") == username), None)
    if not user or not verify_password(password, user):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    ensure_user_workspace(user["id"])

    token = create_session_token(user)
    _set_session_cookie(response, token)
    return {
        "token": token,
        "user": {"id": user["id"], "username": user["username"]},
    }


@app.get("/session", response_model=SessionResponse)
def api_session(user: dict = Depends(require_authenticated_user)):
    return {"authenticated": True, "user": _build_account_profile(user)}


@app.get("/me", response_model=AccountProfile)
def api_me(user: dict = Depends(require_authenticated_user)):
    return _build_account_profile(user)


@app.get("/whoami", response_model=AccountProfile)
def api_whoami(user: dict = Depends(require_authenticated_user)):
    return _build_account_profile(user)


@app.put("/me/password")
def api_change_password(body: PasswordChangeRequest, response: Response, user: dict = Depends(require_authenticated_user)):
    if len(body.newPassword) <= 8:
        raise HTTPException(status_code=400, detail="Password must be longer than 8 characters")

    user_record = _find_user_record(user["id"])
    if not verify_password(body.currentPassword, user_record):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    updated_user = {
        **user_record,
        **hash_password(body.newPassword),
        "sessionVersion": int(user_record.get("sessionVersion") or DEFAULT_SESSION_VERSION) + 1,
    }
    _save_updated_user(updated_user)

    token = create_session_token(updated_user)
    _set_session_cookie(response, token)
    return {"status": "ok", "user": _build_account_profile(updated_user), "token": token}


@app.delete("/me")
def api_delete_account(body: DeleteAccountRequest, response: Response, user: dict = Depends(require_authenticated_user)):
    users = load_users()
    user_record = next((entry for entry in users if entry.get("id") == user["id"]), None)
    if not user_record:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(body.currentPassword, user_record):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    remaining_users = [entry for entry in users if entry.get("id") != user["id"]]
    save_users(remaining_users)
    delete_user_workspace(user["id"])
    _clear_session_cookie(response)
    return {"status": "ok"}


@app.post("/logout")
def api_logout(response: Response, _: dict = Depends(require_authenticated_user)):
    _clear_session_cookie(response)
    return {"status": "ok"}


@app.get("/projects")
def api_list_projects(user: dict = Depends(require_authenticated_user)):
    """List all projects with active project id"""
    projects = list_projects(user["id"])
    active_id = get_active_project_id(user["id"])
    return {"projects": projects, "activeProjectId": active_id}


@app.post("/projects")
def api_create_project(body: ProjectCreate, user: dict = Depends(require_authenticated_user)):
    """Create a new project"""
    project = create_project(user["id"], body.name)
    return project


@app.put("/projects/{project_id}/activate")
def api_activate_project(project_id: str, user: dict = Depends(require_authenticated_user)):
    """Set the active project"""
    if not set_active_project(user["id"], project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


@app.put("/projects/{project_id}/rename")
def api_rename_project(project_id: str, body: ProjectRename, user: dict = Depends(require_authenticated_user)):
    """Rename a project"""
    if not rename_project(user["id"], project_id, body.name):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


@app.post("/projects/{project_id}/copy")
def api_copy_project(project_id: str, body: ProjectCopy, user: dict = Depends(require_authenticated_user)):
    """Copy a project"""
    try:
        new_project = copy_project(user["id"], project_id, body.name)
        return new_project
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/projects/{project_id}")
def api_delete_project(project_id: str, user: dict = Depends(require_authenticated_user)):
    """Delete a project"""
    if not delete_project(user["id"], project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


# ── Graph management (per-project) ─────────────────────────────

class GraphCreate(BaseModel):
    name: str

class GraphRename(BaseModel):
    name: str

class GraphCopy(BaseModel):
    name: str


@app.get("/projects/{project_id}/graphs")
def api_list_graphs(project_id: str, user: dict = Depends(require_authenticated_user)):
    """List all graphs in a project with active graph id"""
    return list_graphs(user["id"], _require_project_access(user["id"], project_id))


@app.post("/projects/{project_id}/graphs")
def api_create_graph(project_id: str, body: GraphCreate, user: dict = Depends(require_authenticated_user)):
    """Create a new graph in a project"""
    graph = create_graph(user["id"], _require_project_access(user["id"], project_id), body.name)
    return graph


@app.put("/projects/{project_id}/graphs/{graph_id}/activate")
def api_activate_graph(project_id: str, graph_id: str, user: dict = Depends(require_authenticated_user)):
    """Set the active graph for a project"""
    if not set_active_graph(user["id"], _require_project_access(user["id"], project_id), graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.put("/projects/{project_id}/graphs/{graph_id}/rename")
def api_rename_graph(project_id: str, graph_id: str, body: GraphRename, user: dict = Depends(require_authenticated_user)):
    """Rename a graph"""
    if not rename_graph(user["id"], _require_project_access(user["id"], project_id), graph_id, body.name):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.post("/projects/{project_id}/graphs/{graph_id}/copy")
def api_copy_graph(project_id: str, graph_id: str, body: GraphCopy, user: dict = Depends(require_authenticated_user)):
    """Copy a graph"""
    try:
        new_graph = copy_graph(user["id"], _require_project_access(user["id"], project_id), graph_id, body.name)
        return new_graph
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/projects/{project_id}/graphs/{graph_id}")
def api_delete_graph(project_id: str, graph_id: str, user: dict = Depends(require_authenticated_user)):
    """Delete a graph"""
    if not delete_graph(user["id"], _require_project_access(user["id"], project_id), graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


# ── Solver ──────────────────────────────────────────────────────

@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest, user: dict = Depends(require_authenticated_user)) -> SolveResponse:
    project_id = _resolve_project(user["id"], request.projectId)
    graph_id = request.graphId or get_active_graph_id(user["id"], project_id)
    graph_data = load_graph(user["id"], project_id, graph_id)
    store_data = load_store(user["id"], project_id)
    return solve_graph(Graph(**graph_data), store_data=store_data)


# ── Graph persistence (project-scoped, graph-scoped) ────────────

@app.get("/graph")
def get_graph(
    project_id: Optional[str] = Query(None),
    graph_id: Optional[str] = Query(None),
    user: dict = Depends(require_authenticated_user),
) -> GraphData:
    """Load saved graph data for a specific graph in a project"""
    pid = _resolve_project(user["id"], project_id)
    gid = graph_id or get_active_graph_id(user["id"], pid)
    data = load_graph(user["id"], pid, gid)
    return GraphData(**data)


@app.post("/graph")
def post_graph(
    graph: GraphData,
    project_id: Optional[str] = Query(None),
    graph_id: Optional[str] = Query(None),
    user: dict = Depends(require_authenticated_user),
):
    """Save graph data for a specific graph in a project"""
    pid = _resolve_project(user["id"], project_id)
    gid = graph_id or get_active_graph_id(user["id"], pid)
    save_graph(user["id"], pid, gid, graph.dict())
    return {"status": "ok"}


# ── Store persistence (project-scoped) ──────────────────────────

@app.get("/store")
def get_store(project_id: Optional[str] = Query(None), user: dict = Depends(require_authenticated_user)) -> StoreData:
    """Load saved store data for a project"""
    pid = _resolve_project(user["id"], project_id)
    data = load_store(user["id"], pid)
    return StoreData(**data)


@app.post("/store")
def post_store(store: StoreData, project_id: Optional[str] = Query(None), user: dict = Depends(require_authenticated_user)):
    """Save store data for a project"""
    pid = _resolve_project(user["id"], project_id)
    save_store(user["id"], pid, store.dict())
    return {"status": "ok"}
