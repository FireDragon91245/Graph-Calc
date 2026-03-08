import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.api.models import SolveRequest, SolveResponse, GraphData, StoreData
from app.auth import (
    JWT_TTL_SECONDS,
    create_session_token,
    create_user_record,
    decode_session_token,
    verify_password,
)
from app.solver.solver import solve_graph
from app.persistence import (
    load_graph, save_graph, load_store, save_store,
    list_projects, get_active_project_id, set_active_project,
    create_project, rename_project, copy_project, delete_project,
    list_graphs, get_active_graph_id, set_active_graph,
    create_graph, rename_graph, copy_graph, delete_graph,
    load_users, save_users,
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

def _resolve_project(project_id: Optional[str]) -> str:
    """Return the given project_id or the active one."""
    if project_id:
        return project_id
    return get_active_project_id()


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

    return {"id": user["id"], "username": user["username"]}


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


class SessionResponse(BaseModel):
    authenticated: bool
    user: Optional[dict] = None


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

    token = create_session_token(user)
    _set_session_cookie(response, token)
    return {
        "token": token,
        "user": {"id": user["id"], "username": user["username"]},
    }


@app.get("/session", response_model=SessionResponse)
def api_session(request: Request):
    try:
        user = _get_current_session(request)
        return {"authenticated": True, "user": user}
    except HTTPException:
        return {"authenticated": False, "user": None}


@app.post("/logout")
def api_logout(response: Response):
    _clear_session_cookie(response)
    return {"status": "ok"}


@app.get("/projects")
def api_list_projects():
    """List all projects with active project id"""
    projects = list_projects()
    active_id = get_active_project_id()
    return {"projects": projects, "activeProjectId": active_id}


@app.post("/projects")
def api_create_project(body: ProjectCreate):
    """Create a new project"""
    project = create_project(body.name)
    return project


@app.put("/projects/{project_id}/activate")
def api_activate_project(project_id: str):
    """Set the active project"""
    if not set_active_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


@app.put("/projects/{project_id}/rename")
def api_rename_project(project_id: str, body: ProjectRename):
    """Rename a project"""
    if not rename_project(project_id, body.name):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


@app.post("/projects/{project_id}/copy")
def api_copy_project(project_id: str, body: ProjectCopy):
    """Copy a project"""
    try:
        new_project = copy_project(project_id, body.name)
        return new_project
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/projects/{project_id}")
def api_delete_project(project_id: str):
    """Delete a project"""
    if not delete_project(project_id):
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
def api_list_graphs(project_id: str):
    """List all graphs in a project with active graph id"""
    return list_graphs(project_id)


@app.post("/projects/{project_id}/graphs")
def api_create_graph(project_id: str, body: GraphCreate):
    """Create a new graph in a project"""
    graph = create_graph(project_id, body.name)
    return graph


@app.put("/projects/{project_id}/graphs/{graph_id}/activate")
def api_activate_graph(project_id: str, graph_id: str):
    """Set the active graph for a project"""
    if not set_active_graph(project_id, graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.put("/projects/{project_id}/graphs/{graph_id}/rename")
def api_rename_graph(project_id: str, graph_id: str, body: GraphRename):
    """Rename a graph"""
    if not rename_graph(project_id, graph_id, body.name):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.post("/projects/{project_id}/graphs/{graph_id}/copy")
def api_copy_graph(project_id: str, graph_id: str, body: GraphCopy):
    """Copy a graph"""
    try:
        new_graph = copy_graph(project_id, graph_id, body.name)
        return new_graph
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/projects/{project_id}/graphs/{graph_id}")
def api_delete_graph(project_id: str, graph_id: str):
    """Delete a graph"""
    if not delete_graph(project_id, graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


# ── Solver ──────────────────────────────────────────────────────

@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    store_data = None
    if request.storeData:
        store_data = request.storeData.dict()
    return solve_graph(request.graph, store_data=store_data)


# ── Graph persistence (project-scoped, graph-scoped) ────────────

@app.get("/graph")
def get_graph(
    project_id: Optional[str] = Query(None),
    graph_id: Optional[str] = Query(None)
) -> GraphData:
    """Load saved graph data for a specific graph in a project"""
    pid = _resolve_project(project_id)
    gid = graph_id or get_active_graph_id(pid)
    data = load_graph(pid, gid)
    return GraphData(**data)


@app.post("/graph")
def post_graph(
    graph: GraphData,
    project_id: Optional[str] = Query(None),
    graph_id: Optional[str] = Query(None)
):
    """Save graph data for a specific graph in a project"""
    pid = _resolve_project(project_id)
    gid = graph_id or get_active_graph_id(pid)
    save_graph(pid, gid, graph.dict())
    return {"status": "ok"}


# ── Store persistence (project-scoped) ──────────────────────────

@app.get("/store")
def get_store(project_id: Optional[str] = Query(None)) -> StoreData:
    """Load saved store data for a project"""
    pid = _resolve_project(project_id)
    data = load_store(pid)
    return StoreData(**data)


@app.post("/store")
def post_store(store: StoreData, project_id: Optional[str] = Query(None)):
    """Save store data for a project"""
    pid = _resolve_project(project_id)
    save_store(pid, store.dict())
    return {"status": "ok"}
