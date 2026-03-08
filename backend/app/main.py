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
from app.config import get_config
from app.persistence import (
    count_projects,
    copy_graph,
    copy_project,
    create_graph,
    create_project,
    delete_graph,
    delete_project,
    delete_user_workspace,
    ensure_user_workspace,
    get_active_graph_id,
    get_active_project_id,
    initialize_persistence,
    list_graphs,
    list_projects,
    load_graph,
    load_store,
    load_users,
    rename_graph,
    rename_project,
    save_graph,
    save_store,
    save_users,
    set_active_graph,
    set_active_project,
)
from app.solver.solver import solve_graph

app = FastAPI(title="GraphCalc Solver")
APP_CONFIG = get_config()
SESSION_COOKIE_NAME = APP_CONFIG.auth.cookie.name

app.add_middleware(
    CORSMiddleware,
    allow_origins=APP_CONFIG.server.frontendOrigins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    initialize_persistence()


@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    if APP_CONFIG.server.logRequests:
        print(
            "[http]"
            f" method={request.method}"
            f" path={request.url.path}"
            f" status={response.status_code}"
            f" origin={request.headers.get('origin', '-') }"
        )
    return response


def _resolve_project(user_id: str, project_id: Optional[str]) -> str:
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
        httponly=APP_CONFIG.auth.cookie.httpOnly,
        secure=APP_CONFIG.auth.cookie.secure,
        samesite=APP_CONFIG.auth.cookie.sameSite,
        max_age=JWT_TTL_SECONDS,
        path=APP_CONFIG.auth.cookie.path,
    )


def _clear_session_cookie(response: Response):
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=APP_CONFIG.auth.cookie.httpOnly,
        secure=APP_CONFIG.auth.cookie.secure,
        samesite=APP_CONFIG.auth.cookie.sameSite,
        path=APP_CONFIG.auth.cookie.path,
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
            entry
            for entry in users
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
    return {"token": token, "user": {"id": user["id"], "username": user["username"]}}


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
    return {"token": token, "user": {"id": user["id"], "username": user["username"]}}


@app.get("/session", response_model=SessionResponse)
def api_session(user: dict = Depends(require_authenticated_user)):
    return {"authenticated": True, "user": _build_account_profile(user)}


@app.get("/me", response_model=AccountProfile)
def api_me(user: dict = Depends(require_authenticated_user)):
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
    projects = list_projects(user["id"])
    active_id = get_active_project_id(user["id"])
    return {"projects": projects, "activeProjectId": active_id}


@app.post("/projects")
def api_create_project(body: ProjectCreate, user: dict = Depends(require_authenticated_user)):
    return create_project(user["id"], body.name)


@app.put("/projects/{project_id}/activate")
def api_activate_project(project_id: str, user: dict = Depends(require_authenticated_user)):
    if not set_active_project(user["id"], project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


@app.put("/projects/{project_id}/rename")
def api_rename_project(project_id: str, body: ProjectRename, user: dict = Depends(require_authenticated_user)):
    if not rename_project(user["id"], project_id, body.name):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


@app.post("/projects/{project_id}/copy")
def api_copy_project(project_id: str, body: ProjectCopy, user: dict = Depends(require_authenticated_user)):
    try:
        return copy_project(user["id"], project_id, body.name)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.delete("/projects/{project_id}")
def api_delete_project(project_id: str, user: dict = Depends(require_authenticated_user)):
    if not delete_project(user["id"], project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok"}


class GraphCreate(BaseModel):
    name: str


class GraphRename(BaseModel):
    name: str


class GraphCopy(BaseModel):
    name: str


@app.get("/projects/{project_id}/graphs")
def api_list_graphs(project_id: str, user: dict = Depends(require_authenticated_user)):
    return list_graphs(user["id"], _require_project_access(user["id"], project_id))


@app.post("/projects/{project_id}/graphs")
def api_create_graph(project_id: str, body: GraphCreate, user: dict = Depends(require_authenticated_user)):
    return create_graph(user["id"], _require_project_access(user["id"], project_id), body.name)


@app.put("/projects/{project_id}/graphs/{graph_id}/activate")
def api_activate_graph(project_id: str, graph_id: str, user: dict = Depends(require_authenticated_user)):
    if not set_active_graph(user["id"], _require_project_access(user["id"], project_id), graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.put("/projects/{project_id}/graphs/{graph_id}/rename")
def api_rename_graph(project_id: str, graph_id: str, body: GraphRename, user: dict = Depends(require_authenticated_user)):
    if not rename_graph(user["id"], _require_project_access(user["id"], project_id), graph_id, body.name):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.post("/projects/{project_id}/graphs/{graph_id}/copy")
def api_copy_graph(project_id: str, graph_id: str, body: GraphCopy, user: dict = Depends(require_authenticated_user)):
    try:
        return copy_graph(user["id"], _require_project_access(user["id"], project_id), graph_id, body.name)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.delete("/projects/{project_id}/graphs/{graph_id}")
def api_delete_graph(project_id: str, graph_id: str, user: dict = Depends(require_authenticated_user)):
    if not delete_graph(user["id"], _require_project_access(user["id"], project_id), graph_id):
        raise HTTPException(status_code=404, detail="Graph not found")
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest, user: dict = Depends(require_authenticated_user)) -> SolveResponse:
    project_id = _resolve_project(user["id"], request.projectId)
    graph_id = request.graphId or get_active_graph_id(user["id"], project_id)
    graph_data = load_graph(user["id"], project_id, graph_id)
    store_data = load_store(user["id"], project_id)
    return solve_graph(Graph(**graph_data), store_data=store_data)


@app.get("/graph")
def get_graph(
    project_id: Optional[str] = Query(None),
    graph_id: Optional[str] = Query(None),
    user: dict = Depends(require_authenticated_user),
) -> GraphData:
    pid = _resolve_project(user["id"], project_id)
    gid = graph_id or get_active_graph_id(user["id"], pid)
    return GraphData(**load_graph(user["id"], pid, gid))


@app.post("/graph")
def post_graph(
    graph: GraphData,
    project_id: Optional[str] = Query(None),
    graph_id: Optional[str] = Query(None),
    user: dict = Depends(require_authenticated_user),
):
    pid = _resolve_project(user["id"], project_id)
    gid = graph_id or get_active_graph_id(user["id"], pid)
    save_graph(user["id"], pid, gid, graph.dict())
    return {"status": "ok"}


@app.get("/store")
def get_store(project_id: Optional[str] = Query(None), user: dict = Depends(require_authenticated_user)) -> StoreData:
    pid = _resolve_project(user["id"], project_id)
    return StoreData(**load_store(user["id"], pid))


@app.post("/store")
def post_store(store: StoreData, project_id: Optional[str] = Query(None), user: dict = Depends(require_authenticated_user)):
    pid = _resolve_project(user["id"], project_id)
    save_store(user["id"], pid, store.dict())
    return {"status": "ok"}
