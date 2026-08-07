import type { Edge, Node } from "reactflow";

export type GraphLayoutPreset =
  | "production"
  | "compact"
  | "cascade"
  | "tree"
  | "hierarchical";

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 150;

const getLayoutOptions = (preset: GraphLayoutPreset): Record<string, string> => {
  const shared = {
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
    "elk.padding": "[top=40,left=40,bottom=40,right=40]"
  };

  switch (preset) {
    case "production":
      return {
        ...shared,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "70",
        "elk.layered.spacing.nodeNodeBetweenLayers": "130",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES"
      };
    case "compact":
      return {
        ...shared,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "SPLINES",
        "elk.spacing.nodeNode": "36",
        "elk.layered.spacing.nodeNodeBetweenLayers": "72",
        "elk.layered.compaction.postCompaction.strategy": "LEFT"
      };
    case "cascade":
      return {
        ...shared,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "POLYLINE",
        "elk.spacing.nodeNode": "58",
        "elk.layered.spacing.nodeNodeBetweenLayers": "105",
        "elk.layered.layering.strategy": "LONGEST_PATH_SOURCE",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "LINEAR_SEGMENTS",
        "elk.layered.nodePlacement.favorStraightEdges": "true"
      };
    case "tree":
      return {
        ...shared,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "76",
        "elk.layered.spacing.nodeNodeBetweenLayers": "125",
        "elk.layered.layering.strategy": "LONGEST_PATH_SOURCE",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.favorStraightEdges": "true"
      };
    case "hierarchical":
      return {
        ...shared,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "80",
        "elk.layered.spacing.nodeNodeBetweenLayers": "150",
        "elk.layered.spacing.edgeNodeBetweenLayers": "30",
        "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.nodePlacement.favorStraightEdges": "true"
      };
  }
};

export async function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  preset: GraphLayoutPreset
): Promise<Node[]> {
  if (nodes.length < 2) return nodes;

  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  const graph = await elk.layout({
    id: "root",
    layoutOptions: getLayoutOptions(preset),
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width ?? DEFAULT_NODE_WIDTH,
      height: node.height ?? DEFAULT_NODE_HEIGHT
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  });

  const positions = new Map(
    (graph.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])
  );

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
}
