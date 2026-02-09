from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.models import SolveRequest, SolveResponse
from app.solver.solver import solve_graph

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
    return solve_graph(request.graph)
