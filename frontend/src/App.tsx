import { useCallback, useMemo, useState, MouseEvent as ReactMouseEvent } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Panel,
  NodeMouseHandler,
  ReactFlowProvider
} from "reactflow";
import { solveGraph, SolveResponse } from "./api/solve";
import LibraryPanel from "./editor/LibraryPanel";
import ContextMenu from "./editor/ContextMenu";
import { useGraphStore } from "./store/graphStore";
import RecipeNode from "./nodes/RecipeNode";
import InputNode from "./nodes/InputNode";
import OutputNode from "./nodes/OutputNode";
import RequesterNode from "./nodes/RequesterNode";

const nodeTypes = {
  recipe: RecipeNode,
  input: InputNode,
  output: OutputNode,
  requester: RequesterNode
};

const initialNodes: Node[] = [
  {
    id: "n-input-iron",
    type: "input",
    position: { x: -400, y: -60 },
    data: { 
      items: [{ id: "row1", itemId: "iron_ore", mode: "limit", limit: 2 }]
    }
  },
  {
    id: "n-recipe-macerate",
    type: "recipe",
    position: { x: -60, y: -80 },
    data: {
      title: "Macerate Iron",
      timeSeconds: 2,
      inputs: [{ id: "i1", name: "Iron Ore", amountPerCycle: 1, medium: "item" }],
      outputs: [
        { id: "o1", name: "Iron Dust", amountPerCycle: 1, medium: "item", probability: 1 },
        { id: "o2", name: "Gold Dust", amountPerCycle: 1, medium: "item", probability: 0.1 }
      ]
    }
  },
  {
    id: "n-recipe-smelt",
    type: "recipe",
    position: { x: 260, y: -80 },
    data: {
      title: "Smelt Iron",
      timeSeconds: 3.2,
      inputs: [{ id: "i1", name: "Iron Dust", amountPerCycle: 1, medium: "item" }],
      outputs: [{ id: "o1", name: "Iron Ingot", amountPerCycle: 1, medium: "item", probability: 1 }]
    }
  },
  {
    id: "n-output-iron",
    type: "output",
    position: { x: 560, y: -60 },
    data: { items: [{ id: "row1", itemId: "iron_ingot" }] }
  },
  {
    id: "n-requester",
    type: "requester",
    position: { x: 260, y: 160 },
    data: { requests: [{ id: "req1", itemId: "iron_ingot", targetPerSecond: 1.2 }] }
  }
];

const initialEdges: Edge[] = [
  {
    id: "e1",
    source: "n-input-iron",
    target: "n-recipe-macerate",
    sourceHandle: "output",
    targetHandle: "input-i1"
  },
  {
    id: "e2",
    source: "n-recipe-macerate",
    target: "n-recipe-smelt",
    sourceHandle: "output-o1",
    targetHandle: "input-i1"
  },
  {
    id: "e3",
    source: "n-recipe-smelt",
    target: "n-output-iron",
    sourceHandle: "output-o1",
    targetHandle: "input"
  }
];

function AppContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [solveResult, setSolveResult] = useState<SolveResponse | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );
  
  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      setMenu({
        id: node.id,
        top: event.clientY,
        left: event.clientX,
      });
    },
    [setMenu]
  );
  
  const onPaneClick = useCallback(() => setMenu(null), [setMenu]);
  
  const handleDeleteNode = useCallback(() => {
    if (!menu) return;
    setNodes((nds) => nds.filter((n) => n.id !== menu.id));
    setEdges((eds) => eds.filter((e) => e.source !== menu.id && e.target !== menu.id));
    setMenu(null);
  }, [menu, setNodes, setEdges]);
  
  const handleDuplicateNode = useCallback(() => {
    if (!menu) return;
    const node = nodes.find((n) => n.id === menu.id);
    if (!node) return;
    
    // Simple deep clone
    const newNode: Node = {
      ...node,
      id: `${node.type}-${Date.now()}`,
      position: { x: node.position.x + 50, y: node.position.y + 50 },
      selected: true,
      data: JSON.parse(JSON.stringify(node.data)),
    };
    
    setNodes((nds) => nds.map(n => ({ ...n, selected: false })).concat(newNode));
    setMenu(null);
  }, [menu, nodes, setNodes]);

  const createPosition = () => ({
    x: 120 + nodes.length * 40,
    y: 120 + nodes.length * 24
  });

  const handleCreateInputNode = useCallback(
    (itemId: string) => {
      const item = items.find((entry) => entry.id === itemId);
      if (!item) return;
      const id = `input-${item.id}-${Date.now()}`;
      setNodes((current) => [
        ...current,
        {
          id,
          type: "input",
          position: createPosition(),
          data: { 
             items: [{ id: "1", itemId: item.id, mode: "infinite" }]
          }
        }
      ]);
    },
    [items, setNodes, nodes.length]
  );

  const handleCreateOutputNode = useCallback(
    (itemId: string) => {
      const item = items.find((entry) => entry.id === itemId);
      if (!item) return;
      const id = `output-${item.id}-${Date.now()}`;
      setNodes((current) => [
        ...current,
        {
          id,
          type: "output",
          position: createPosition(),
          data: { items: [{ id: "1", itemId: item.id }] }
        }
      ]);
    },
    [items, setNodes, nodes.length]
  );

  const handleCreateRecipeNode = useCallback(
    (recipeId: string) => {
      const recipe = recipes.find((entry) => entry.id === recipeId);
      if (!recipe) return;

      const inputs = recipe.inputs.map((input) => {
        const name =
          input.refType === "item"
            ? items.find((item) => item.id === input.refId)?.name ?? input.refId
            : tags.find((tag) => tag.id === input.refId)?.name ?? input.refId;

        return {
          id: input.id,
          name,
          amountPerCycle: input.amount,
          medium: "item" as const
        };
      });

      const outputs = recipe.outputs.map((output) => ({
        id: output.id,
        name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
        amountPerCycle: output.amount,
        medium: "item" as const,
        probability: output.probability
      }));

      const id = `recipe-${recipe.id}-${Date.now()}`;
      setNodes((current) => [
        ...current,
        {
          id,
          type: "recipe",
          position: createPosition(),
          data: {
            title: recipe.name,
            timeSeconds: recipe.timeSeconds,
            inputs,
            outputs
          }
        }
      ]);
    },
    [recipes, items, tags, setNodes, nodes.length]
  );

  const graphPayload = useMemo(
    () => ({
      graph: {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: (node.type ?? "recipe") as "recipe" | "input" | "output" | "requester",
          data: node.data as Record<string, unknown>
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null
        }))
      }
    }),
    [nodes, edges]
  );

  const handleSolve = useCallback(async () => {
    setIsSolving(true);
    setSolveError(null);

    try {
      const result = await solveGraph(graphPayload);
      setSolveResult(result);
    } catch (error) {
      setSolveError(error instanceof Error ? error.message : "Solve failed");
    } finally {
      setIsSolving(false);
    }
  }, [graphPayload]);

  return (
    <div className="app-root">
      <div className="top-bar">
        <div className="brand">GraphCalc</div>
        <input className="search" placeholder="Search recipes, items, nodes (Ctrl+K)" />
        <button className="primary" onClick={handleSolve} disabled={isSolving}>
          {isSolving ? "Solving..." : "Solve"}
        </button>
      </div>
      <div className="layout">
        <LibraryPanel
          onCreateInputNode={handleCreateInputNode}
          onCreateOutputNode={handleCreateOutputNode}
          onCreateRecipeNode={handleCreateRecipeNode}
        />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          selectionOnDrag
          panOnDrag={[1, 2]}
          selectionMode={undefined}
          panOnScroll
          multiSelectionKeyCode="Control"
          deleteKeyCode={["Backspace", "Delete"]}
          elementsSelectable
          nodesDraggable
          fitView
          nodeTypes={nodeTypes}
        >
          <Background gap={20} size={1} color="#1f2a3a" />
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
          <Panel position="top-right" className="panel">
            <div className="panel-title">Live Stats</div>
            <div className="panel-row">Nodes: {nodes.length}</div>
            <div className="panel-row">Edges: {edges.length}</div>
          </Panel>
          <Panel position="bottom-right" className="panel results">
            <div className="panel-title">Solver Output</div>
            {solveError ? <div className="panel-error">{solveError}</div> : null}
            {!solveResult ? (
              <div className="panel-muted">Run solver to see results.</div>
            ) : (
              <div className="panel-section">
                <div className="panel-subtitle">Machines</div>
                {Object.entries(solveResult.machineCounts).map(([key, value]) => (
                  <div key={key} className="panel-row">
                    <span>{key}</span>
                    <span>{value.toFixed(2)}</span>
                  </div>
                ))}
                <div className="panel-subtitle">Flows / s</div>
                {Object.entries(solveResult.flowsPerSecond).map(([key, value]) => (
                  <div key={key} className="panel-row">
                    <span>{key}</span>
                    <span>{value.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {menu && (
            <ContextMenu
              top={menu.top}
              left={menu.left}
              onClose={() => setMenu(null)}
              onDuplicate={handleDuplicateNode}
              onDelete={handleDeleteNode}
            />
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}
