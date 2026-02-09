import { useCallback, useMemo, useState, DragEvent, useEffect, useRef } from "react";
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
  ReactFlowProvider,
  useReactFlow
} from "reactflow";
import { solveGraph, SolveResponse } from "./api/solve";
import { loadGraph, saveGraph, loadStore, saveStore } from "./api/persistence";
import ContextMenu from "./editor/ContextMenu";
import { useGraphStore } from "./store/graphStore";
import RecipeNode from "./nodes/RecipeNode";
import InputNode from "./nodes/InputNode";
import OutputNode from "./nodes/OutputNode";
import RequesterNode from "./nodes/RequesterNode";
import ModeSelector, { AppMode, ConfigSubMode } from "./components/ModeSelector";
import NodeTypeSelector from "./components/NodeTypeSelector";
import NodeConfigDialog from "./components/NodeConfigDialog";
import ItemMode from "./components/ItemMode";
import TagMode from "./components/TagMode";
import RecipeMode from "./components/RecipeMode";
import RecipeTagMode from "./components/RecipeTagMode";
import { NodeType } from "./components/NodeTypeSelector";

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
    sourceHandle: "output-row1",
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
    targetHandle: "input-row1"
  }
];

function AppContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [solveResult, setSolveResult] = useState<SolveResponse | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("edit");
  const [configSubMode, setConfigSubMode] = useState<ConfigSubMode>("items");
  const [pendingNodeType, setPendingNodeType] = useState<NodeType | null>(null);
  const [pendingNodePosition, setPendingNodePosition] = useState<{ x: number; y: number } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const loadStoreData = useGraphStore((state) => state.loadStoreData);
  const reactFlowInstance = useReactFlow();

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load store data (categories, items, tags, recipes, etc.)
        const storeData = await loadStore();
        
        // If store has data, load it; otherwise keep the default state and save it
        if (storeData.categories.length > 0 || storeData.items.length > 0 || 
            storeData.tags.length > 0 || storeData.recipeTags.length > 0 || 
            storeData.recipes.length > 0) {
          loadStoreData(storeData);
        } else {
          // Save the default store data from the initial state
          const currentState = useGraphStore.getState();
          const defaultData = {
            categories: currentState.categories,
            items: currentState.items,
            tags: currentState.tags,
            recipeTags: currentState.recipeTags,
            recipes: currentState.recipes
          };
          saveStore(defaultData).catch(console.error);
        }

        // Load graph data (nodes and edges)
        const graphData = await loadGraph();
        if (graphData.nodes.length > 0 || graphData.edges.length > 0) {
          setNodes(graphData.nodes);
          setEdges(graphData.edges);
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadData();
  }, [loadStoreData, setNodes, setEdges]);

  // Auto-save graph (nodes and edges) with debouncing
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Don't save until initial load is complete
    if (!isLoaded) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      const graphData = {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type ?? "recipe",
          position: node.position,
          data: node.data
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null
        }))
      };

      saveGraph(graphData).catch((error) => {
        console.error("Error auto-saving graph:", error);
      });
    }, 500); // 500ms debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [nodes, edges, isLoaded]);

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
    
    setNodes((nds) => {
      const deselected = nds.map((n) => ({ ...n, selected: false }));
      const newNode: Node = {
        ...node,
        id: `${node.type}-${Date.now()}`,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
        selected: true,
        data: JSON.parse(JSON.stringify(node.data)),
      };
      return [...deselected, newNode];
    });
    setMenu(null);
  }, [menu, nodes, setNodes]);

  const createPosition = () => ({
    x: 120 + nodes.length * 40,
    y: 120 + nodes.length * 24
  });

  const handleNodeTypeSelected = useCallback((nodeType: NodeType) => {
    // Open dialog immediately when clicked from sidebar
    setPendingNodeType(nodeType);
    setPendingNodePosition(createPosition());
  }, [nodes.length]);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData("application/reactflow") as NodeType;
      if (!nodeType) return;

      // Get position relative to ReactFlow viewport
      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top
      });

      // Open dialog with the dropped node type
      setPendingNodeType(nodeType);
      setPendingNodePosition(position);
    },
    [reactFlowInstance]
  );

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleNodeConfigConfirm = useCallback(
    (config: any) => {
      if (!pendingNodeType || !pendingNodePosition) return;

      const id = `${pendingNodeType}-${Date.now()}`;

      if (pendingNodeType === "input") {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "input",
            position: pendingNodePosition,
            data: { items: [{ id: "1", itemId: config.itemId, mode: "infinite" }] }
          }
        ]);
      } else if (pendingNodeType === "output") {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "output",
            position: pendingNodePosition,
            data: { items: [{ id: "1", itemId: config.itemId }] }
          }
        ]);
      } else if (pendingNodeType === "recipe") {
        const recipe = config.recipe;
        const inputs = recipe.inputs.map((input: any) => {
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

        const outputs = recipe.outputs.map((output: any) => ({
          id: output.id,
          name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
          amountPerCycle: output.amount,
          medium: "item" as const,
          probability: output.probability
        }));

        setNodes((current) => [
          ...current,
          {
            id,
            type: "recipe",
            position: pendingNodePosition,
            data: {
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
              inputs,
              outputs
            }
          }
        ]);
      } else if (pendingNodeType === "requester") {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "requester",
            position: pendingNodePosition,
            data: { requests: [{ id: "req1", itemId: config.itemId, targetPerSecond: 1.0 }] }
          }
        ]);
      }

      setPendingNodeType(null);
      setPendingNodePosition(null);
    },
    [pendingNodeType, pendingNodePosition, items, tags, setNodes]
  );

  const handleNodeConfigCancel = useCallback(() => {
    setPendingNodeType(null);
    setPendingNodePosition(null);
  }, []);

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
            recipeId: recipe.id,
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
        <ModeSelector
          currentMode={appMode}
          onModeChange={setAppMode}
          configSubMode={configSubMode}
          onConfigSubModeChange={setConfigSubMode}
        />
        {appMode === "edit" && (
          <>
            <input className="search" placeholder="Search (Ctrl+K)" />
            <button className="primary" onClick={handleSolve} disabled={isSolving}>
              {isSolving ? "Solving..." : "Solve"}
            </button>
          </>
        )}
      </div>
      
      {appMode === "edit" ? (
        <div className="layout">
          <NodeTypeSelector onNodeTypeSelected={handleNodeTypeSelected} />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={onPaneClick}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
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
          {pendingNodeType && (
            <NodeConfigDialog
              nodeType={pendingNodeType}
              onConfirm={handleNodeConfigConfirm}
              onCancel={handleNodeConfigCancel}
            />
          )}
        </div>
      ) : (
        <div className="config-container">
          {configSubMode === "items" && <ItemMode />}
          {configSubMode === "tags" && <TagMode />}
          {configSubMode === "recipes" && <RecipeMode />}
          {configSubMode === "recipeTags" && <RecipeTagMode />}
        </div>
      )}
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
