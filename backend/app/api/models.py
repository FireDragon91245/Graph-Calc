from typing import List, Optional, Dict, Literal
from pydantic import BaseModel, Field


class Port(BaseModel):
    id: str
    name: str
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


# Persistence Models
class GraphData(BaseModel):
    nodes: List[dict]
    edges: List[dict]


class Category(BaseModel):
    id: str
    name: str


class Item(BaseModel):
    id: str
    name: str
    categoryId: Optional[str] = None


class Tag(BaseModel):
    id: str
    name: str
    memberItemIds: List[str]


class RecipeTag(BaseModel):
    id: str
    name: str
    memberRecipeIds: List[str]


class RecipeInput(BaseModel):
    id: str
    refType: Literal["item", "tag"]
    refId: str
    amount: float


class RecipeOutput(BaseModel):
    id: str
    itemId: str
    amount: float
    probability: float


class Recipe(BaseModel):
    id: str
    name: str
    timeSeconds: float
    inputs: List[RecipeInput]
    outputs: List[RecipeOutput]


class StoreData(BaseModel):
    categories: List[Category]
    items: List[Item]
    tags: List[Tag]
    recipeTags: List[RecipeTag]
    recipes: List[Recipe]
