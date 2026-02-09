export type GraphNode = {
  id: string;
  type: "recipe" | "input" | "output" | "requester";
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

export type SolveRequest = {
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  targets?: SolveTargets;
};

export type SolveResponse = {
  status: "ok" | "error";
  machineCounts: Record<string, number>;
  flowsPerSecond: Record<string, number>;
  bottlenecks: string[];
  warnings: string[];
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
