from typing import List, Optional, Dict, Literal
from pydantic import BaseModel, Field


class Port(BaseModel):
    id: str
    name: str
    medium: Literal["item", "fluid", "gas"] = "item"
    amountPerCycle: float = Field(gt=0)
    probability: Optional[float] = Field(default=1.0, ge=0, le=1)


class RecipeNodeData(BaseModel):
    title: str
    timeSeconds: float = Field(gt=0)
    inputs: List[Port]
    outputs: List[Port]


class GraphNode(BaseModel):
    id: str
    type: Literal["recipe", "input", "output", "requester"]
    data: Optional[dict] = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None


class Graph(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class SolveTargets(BaseModel):
    maximizeOutput: List[str] = []
    minimizeInput: List[str] = []
    balance: bool = False


class SolveRequest(BaseModel):
    graph: Graph
    targets: SolveTargets = SolveTargets()


class SolveResponse(BaseModel):
    status: Literal["ok", "error"]
    machineCounts: Dict[str, float] = {}
    flowsPerSecond: Dict[str, float] = {}
    bottlenecks: List[str] = []
    warnings: List[str] = []
