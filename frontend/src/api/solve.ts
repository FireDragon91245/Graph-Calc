import { apiFetch, getErrorMessage } from "./client";

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

export type SolveRequest = {
  projectId?: string | null;
  graphId?: string | null;
  targets?: SolveTargets;
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
  const res = await apiFetch("/solve", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(await getErrorMessage(res, `Solve failed: ${res.status}`));
  }

  return res.json() as Promise<SolveResponse>;
}
