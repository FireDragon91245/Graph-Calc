export type GraphNode = {
  id: string;
  type: "recipe" | "recipetag" | "input" | "inputrecipe" | "inputrecipetag" | "output" | "requester" | "mixedoutput";
  data?: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type SolveTargets = {
  maximizeOutput?: string[];
  minimizeInput?: string[];
  balance?: boolean;
};

export type NodeFlowData = {
  machineCount?: number;
  recipeRuns?: Record<string, number>;  // recipe_id -> machine count
  inputFlows: Record<string, number>;  // item_id -> rate/s
  outputFlows: Record<string, number>;  // item_id -> rate/s
  totalInput: number;
  totalOutput: number;
};

export type EdgeFlowData = {
  flows: Record<string, number>;  // item_id -> rate/s
  totalFlow: number;
};

export type StoreDataForSolve = {
  items: { id: string; name: string; categoryId?: string }[];
  recipes: Record<string, unknown>[];
  recipeTags: { id: string; name: string; memberRecipeIds: string[] }[];
  tags: { id: string; name: string; memberItemIds: string[] }[];
};

export type SolveRequest = {
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  targets?: SolveTargets;
  storeData?: StoreDataForSolve;
};

export type SolveResponse = {
  status: "ok" | "error";
  machineCounts: Record<string, number>;
  flowsPerSecond: Record<string, number>;
  bottlenecks: string[];
  warnings: string[];
  nodeFlows: Record<string, NodeFlowData>;  // node_id -> flow data
  edgeFlows: Record<string, EdgeFlowData>;  // edge_id -> flow data
  problemEdgeIds: string[];  // edge IDs with mismatches or zero flow
};

export async function solveGraph(payload: SolveRequest): Promise<SolveResponse> {
  const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
  const res = await fetch(`${baseUrl}/solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Solve failed: ${res.status}`);
  }

  return res.json() as Promise<SolveResponse>;
}
