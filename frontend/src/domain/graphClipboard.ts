import type { Edge, Node, XYPosition } from "reactflow";

export const GRAPH_CLIPBOARD_KIND = "graphcalc/node-selection";
export const GRAPH_CLIPBOARD_SCHEMA_VERSION = 1;

const ALLOWED_NODE_TYPES = new Set([
  "recipe",
  "recipetag",
  "input",
  "inputrecipe",
  "inputrecipetag",
  "output",
  "requester",
  "mixedoutput"
]);

type ClipboardNode = {
  id: string;
  type: string;
  position: XYPosition;
  data: Record<string, unknown>;
};

type ClipboardEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

type ClipboardBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type GraphClipboardPayload = {
  kind: typeof GRAPH_CLIPBOARD_KIND;
  schemaVersion: typeof GRAPH_CLIPBOARD_SCHEMA_VERSION;
  sourceProjectId: string;
  sourceGraphId: string;
  copiedAt: number;
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
  bounds: ClipboardBounds;
};

export type MaterializedGraphSelection = {
  nodes: Node[];
  edges: Edge[];
};

type CreatePayloadOptions = {
  projectId: string;
  graphId: string;
  nodes: Node[];
  edges: Edge[];
  nodeIds?: Iterable<string>;
};

type MaterializeOptions = {
  anchor: XYPosition;
  existingNodeIds: Iterable<string>;
  existingEdgeIds: Iterable<string>;
  offset?: number;
  createId?: () => string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPosition = (value: unknown): value is XYPosition =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stripSolveData = (data: unknown): Record<string, unknown> => {
  if (!isRecord(data)) return {};
  const { solveData: _solveData, ...rest } = data;
  return cloneJson(rest);
};

const createDefaultId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const createUniqueId = (
  prefix: string,
  usedIds: Set<string>,
  createId: () => string
): string => {
  let candidate = "";
  do {
    candidate = `${prefix}-${createId()}`;
  } while (usedIds.has(candidate));
  usedIds.add(candidate);
  return candidate;
};

const calculateBounds = (nodes: ClipboardNode[]): ClipboardBounds => {
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
};

export function createGraphClipboardPayload({
  projectId,
  graphId,
  nodes,
  edges,
  nodeIds
}: CreatePayloadOptions): GraphClipboardPayload {
  const requestedIds = nodeIds ? new Set(nodeIds) : null;
  const selectedNodes = nodes.filter((node) => requestedIds ? requestedIds.has(node.id) : node.selected);
  if (selectedNodes.length === 0) {
    throw new Error("Select at least one node to copy.");
  }

  const clipboardNodes: ClipboardNode[] = selectedNodes.map((node) => ({
    id: node.id,
    type: node.type ?? "recipe",
    position: { x: node.position.x, y: node.position.y },
    data: stripSolveData(node.data)
  }));
  const selectedIds = new Set(clipboardNodes.map((node) => node.id));
  const clipboardEdges: ClipboardEdge[] = edges
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null
    }));

  return {
    kind: GRAPH_CLIPBOARD_KIND,
    schemaVersion: GRAPH_CLIPBOARD_SCHEMA_VERSION,
    sourceProjectId: projectId,
    sourceGraphId: graphId,
    copiedAt: Date.now(),
    nodes: clipboardNodes,
    edges: clipboardEdges,
    bounds: calculateBounds(clipboardNodes)
  };
}

export const serializeGraphClipboardPayload = (payload: GraphClipboardPayload): string =>
  JSON.stringify(payload);

export function assertGraphClipboardProject(
  payload: GraphClipboardPayload,
  targetProjectId: string
): void {
  if (payload.sourceProjectId !== targetProjectId) {
    throw new Error("Nodes can only be pasted into another graph in the same project.");
  }
}

export function parseGraphClipboardPayload(value: string): GraphClipboardPayload | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(candidate)
    || candidate.kind !== GRAPH_CLIPBOARD_KIND
    || candidate.schemaVersion !== GRAPH_CLIPBOARD_SCHEMA_VERSION
    || typeof candidate.sourceProjectId !== "string"
    || typeof candidate.sourceGraphId !== "string"
    || !isFiniteNumber(candidate.copiedAt)
    || !Array.isArray(candidate.nodes)
    || candidate.nodes.length === 0
    || candidate.nodes.length > 5000
    || !Array.isArray(candidate.edges)
    || candidate.edges.length > 20000
    || !isRecord(candidate.bounds)) {
    return null;
  }

  const nodes = candidate.nodes;
  const validNodes = nodes.every((node) =>
    isRecord(node)
    && typeof node.id === "string"
    && typeof node.type === "string"
    && ALLOWED_NODE_TYPES.has(node.type)
    && isPosition(node.position)
    && isRecord(node.data)
  );
  if (!validNodes) return null;

  const nodeIds = new Set(nodes.map((node) => node.id as string));
  if (nodeIds.size !== nodes.length) return null;

  const validEdges = candidate.edges.every((edge) =>
    isRecord(edge)
    && typeof edge.id === "string"
    && typeof edge.source === "string"
    && typeof edge.target === "string"
    && nodeIds.has(edge.source)
    && nodeIds.has(edge.target)
    && isNullableString(edge.sourceHandle)
    && isNullableString(edge.targetHandle)
  );
  if (!validEdges) return null;

  const bounds = candidate.bounds;
  if (!isFiniteNumber(bounds.minX)
    || !isFiniteNumber(bounds.minY)
    || !isFiniteNumber(bounds.maxX)
    || !isFiniteNumber(bounds.maxY)) {
    return null;
  }

  return cloneJson(candidate) as GraphClipboardPayload;
}

export function materializeGraphClipboardPayload(
  payload: GraphClipboardPayload,
  {
    anchor,
    existingNodeIds,
    existingEdgeIds,
    offset = 0,
    createId = createDefaultId
  }: MaterializeOptions
): MaterializedGraphSelection {
  const usedNodeIds = new Set(existingNodeIds);
  const usedEdgeIds = new Set(existingEdgeIds);
  const nodeIdMap = new Map<string, string>();
  const sourceCenter = {
    x: (payload.bounds.minX + payload.bounds.maxX) / 2,
    y: (payload.bounds.minY + payload.bounds.maxY) / 2
  };

  const nodes: Node[] = payload.nodes.map((node) => {
    const id = createUniqueId(node.type, usedNodeIds, createId);
    nodeIdMap.set(node.id, id);
    return {
      id,
      type: node.type,
      position: {
        x: node.position.x - sourceCenter.x + anchor.x + offset,
        y: node.position.y - sourceCenter.y + anchor.y + offset
      },
      data: cloneJson(node.data),
      selected: true
    };
  });

  const edges: Edge[] = payload.edges.map((edge) => ({
    id: createUniqueId("edge", usedEdgeIds, createId),
    source: nodeIdMap.get(edge.source)!,
    target: nodeIdMap.get(edge.target)!,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    selected: false
  }));

  return { nodes, edges };
}
