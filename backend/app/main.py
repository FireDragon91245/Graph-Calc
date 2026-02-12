from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.models import SolveRequest, SolveResponse, GraphData, StoreData
from app.solver.solver import solve_graph
from app.persistence import load_graph, save_graph, load_store, save_store

app = FastAPI(title="GraphCalc Solver")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.post("/solve", response_model=SolveResponse)
def solve(request: SolveRequest) -> SolveResponse:
    store_data = None
    if request.storeData:
        store_data = request.storeData.dict()
    return solve_graph(request.graph, store_data=store_data)


@app.get("/graph")
def get_graph() -> GraphData:
    """Load saved graph data"""
    data = load_graph()
    return GraphData(**data)


@app.post("/graph")
def post_graph(graph: GraphData):
    """Save graph data"""
    save_graph(graph.dict())
    return {"status": "ok"}


@app.get("/store")
def get_store() -> StoreData:
    """Load saved store data"""
    data = load_store()
    return StoreData(**data)


@app.post("/store")
def post_store(store: StoreData):
    """Save store data"""
    save_store(store.dict())
    return {"status": "ok"}
