from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from app.api.models import SolveRequest, SolveResponse, GraphData, StoreData
from app.solver.solver import solve_graph
from app.persistence import (
    load_graph, save_graph, load_store, save_store,
    list_projects, get_active_project_id, set_active_project,
    create_project, rename_project, copy_project, delete_project
)

app = FastAPI(title="GraphCalc Solver")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# ── Helper ──────────────────────────────────────────────────────

def _resolve_project(project_id: Optional[str]) -> str:
    """Return the given project_id or the active one."""
    if project_id:
        return project_id
    return get_active_project_id()


# ── Project management ──────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str

class ProjectRename(BaseModel):
    name: str

class ProjectCopy(BaseModel):
    name: str


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


# ── Solver ──────────────────────────────────────────────────────

@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    store_data = None
    if request.storeData:
        store_data = request.storeData.dict()
    return solve_graph(request.graph, store_data=store_data)


# ── Graph persistence (project-scoped) ──────────────────────────

@app.get("/graph")
def get_graph(project_id: Optional[str] = Query(None)) -> GraphData:
    """Load saved graph data for a project"""
    pid = _resolve_project(project_id)
    data = load_graph(pid)
    return GraphData(**data)


@app.post("/graph")
def post_graph(graph: GraphData, project_id: Optional[str] = Query(None)):
    """Save graph data for a project"""
    pid = _resolve_project(project_id)
    save_graph(pid, graph.dict())
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
