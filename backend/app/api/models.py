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
    type: Literal["recipe", "recipetag", "input", "inputrecipe", "inputrecipetag", "output", "requester", "mixedoutput"]
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


class SolveStoreData(BaseModel):
    """Store data sent alongside solve requests for recipe tag expansion"""
    items: List[dict] = []
    recipes: List[dict] = []
    recipeTags: List[dict] = []
    tags: List[dict] = []


class SolveRequest(BaseModel):
    graph: Optional[Graph] = None
    projectId: Optional[str] = None
    graphId: Optional[str] = None
    targets: SolveTargets = SolveTargets()
    storeData: Optional[SolveStoreData] = None


class AccountProfile(BaseModel):
    id: str
    username: str
    projectCount: int
    activeProjectId: Optional[str] = None


class SessionResponse(BaseModel):
    authenticated: bool
    user: Optional[AccountProfile] = None


class PasswordChangeRequest(BaseModel):
    currentPassword: str
    newPassword: str


class DeleteAccountRequest(BaseModel):
    currentPassword: str


class NodeFlowData(BaseModel):
    """Flow data for a specific node"""
    machineCount: Optional[float] = None
    recipeRuns: Dict[str, float] = {}  # recipe_id -> machine count (for recipe tag breakdown)
    inputFlows: Dict[str, float] = {}  # item_id -> rate/s
    outputFlows: Dict[str, float] = {}  # item_id -> rate/s
    totalInput: float = 0
    totalOutput: float = 0


class EdgeFlowData(BaseModel):
    """Flow data for a specific edge"""
    flows: Dict[str, float] = {}  # item_id -> rate/s
    totalFlow: float = 0


class SolveResponse(BaseModel):
    status: Literal["ok", "error"]
    machineCounts: Dict[str, float] = {}  # Legacy: recipe_name -> count
    flowsPerSecond: Dict[str, float] = {}  # Legacy: item_id -> total rate
    bottlenecks: List[str] = []
    warnings: List[str] = []
    nodeFlows: Dict[str, NodeFlowData] = {}  # node_id -> flow data
    edgeFlows: Dict[str, EdgeFlowData] = {}  # edge_id -> flow data
    problemEdgeIds: List[str] = []  # edge IDs with mismatches or infeasibility


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
