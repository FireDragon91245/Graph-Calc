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
import { loadGraph, saveGraph, loadStore, saveStore, listProjects, listGraphs } from "./api/persistence";
import ContextMenu from "./editor/ContextMenu";
import CommandPalette, { CommandAction } from "./editor/CommandPalette";
import { useGraphStore } from "./store/graphStore";
import RecipeNode from "./nodes/RecipeNode";
import InputNode from "./nodes/InputNode";
import OutputNode from "./nodes/OutputNode";
import RequesterNode from "./nodes/RequesterNode";
import MixedOutputNode from "./nodes/MixedOutputNode";
import RecipeTagNode from "./nodes/RecipeTagNode";
import InputRecipeNode from "./nodes/InputRecipeNode";
import RecipeTagInputNode from "./nodes/RecipeTagInputNode";
import ModeSelector, { AppMode, ConfigSubMode } from "./components/ModeSelector";
import NodeTypeSelector from "./components/NodeTypeSelector";
import NodeConfigDialog from "./components/NodeConfigDialog";
import ItemMode from "./components/ItemMode";
import TagMode from "./components/TagMode";
import RecipeMode from "./components/RecipeMode";
import RecipeTagMode from "./components/RecipeTagMode";
import RecipeGenerator from "./components/RecipeGenerator";
import ItemGenerator from "./components/ItemGenerator";
import ProjectSelector from "./components/ProjectSelector";
import GraphSelector from "./components/GraphSelector";
import { NodeType } from "./components/NodeTypeSelector";
import EdgeWithTooltip from "./edges/EdgeWithTooltip";

const nodeTypes = {
  recipe: RecipeNode,
  recipetag: RecipeTagNode,
  input: InputNode,
  inputrecipe: InputRecipeNode,
  inputrecipetag: RecipeTagInputNode,
  output: OutputNode,
  requester: RequesterNode,
  mixedoutput: MixedOutputNode
};

const edgeTypes = {
  default: EdgeWithTooltip,
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
      inputs: [{ id: "i1", name: "Iron Ore", refId: "iron_ore", refType: "item", amountPerCycle: 1 }],
      outputs: [
        { id: "o1", itemId: "iron_dust", name: "Iron Dust", amountPerCycle: 1, probability: 1 },
        { id: "o2", itemId: "gold_dust", name: "Gold Dust", amountPerCycle: 1, probability: 0.1 }
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
      inputs: [{ id: "i1", name: "Iron Dust", refId: "iron_dust", refType: "item", amountPerCycle: 1 }],
      outputs: [{ id: "o1", itemId: "iron_ingot", name: "Iron Ingot", amountPerCycle: 1, probability: 1 }]
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

const stripSolveData = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const { solveData, ...rest } = value as Record<string, unknown>;
  return rest;
};

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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  
  const activeProjectId = useGraphStore((state) => state.activeProjectId);
  const setActiveProjectId = useGraphStore((state) => state.setActiveProjectId);
  const activeGraphId = useGraphStore((state) => state.activeGraphId);
  const setActiveGraphId = useGraphStore((state) => state.setActiveGraphId);
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const recipeTags = useGraphStore((state) => state.recipeTags);
  const loadStoreData = useGraphStore((state) => state.loadStoreData);
  const reactFlowInstance = useReactFlow();

  // Keyboard shortcut for command palette (Ctrl+I)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+I or Cmd+I on Mac
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        // Only open in edit mode
        if (appMode === "edit") {
          e.preventDefault();
          setIsCommandPaletteOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appMode]);

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // First, fetch project list to discover the active project
        const projectsRes = await listProjects();
        const pid = projectsRes.activeProjectId;
        if (pid) {
          setActiveProjectId(pid);
        }

        // Load store data (categories, items, tags, recipes, etc.)
        const storeData = await loadStore(pid ?? undefined);
        
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
          saveStore(defaultData, pid ?? undefined).catch(console.error);
        }

        // Fetch active graph for this project
        let gid: string | undefined;
        if (pid) {
          const graphsRes = await listGraphs(pid);
          gid = graphsRes.activeGraphId ?? undefined;
          if (gid) {
            setActiveGraphId(gid);
          }
        }

        // Load graph data (nodes and edges)
        const graphData = await loadGraph(pid ?? undefined, gid);
        if (graphData.nodes.length > 0 || graphData.edges.length > 0) {
          const sanitizedNodes = graphData.nodes.map((node) => ({
            ...node,
            data: stripSolveData(node.data)
          }));

          setNodes(sanitizedNodes);
          setEdges(graphData.edges);
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadData();
  }, [loadStoreData, setNodes, setEdges, setActiveProjectId, setActiveGraphId]);

  // Auto-save graph (nodes and edges) with debouncing
  const saveTimeoutRef = useRef<number | null>(null);
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
          data: stripSolveData(node.data)
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null
        }))
      };

      saveGraph(graphData, activeProjectId ?? undefined, activeGraphId ?? undefined).catch((error) => {
        console.error("Error auto-saving graph:", error);
      });
    }, 500); // 500ms debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [nodes, edges, isLoaded, activeProjectId, activeGraphId]);

  // Handle project change (reload all data for new project)
  const handleProjectChange = useCallback(async (newProjectId: string) => {
    setIsLoaded(false);
    setSolveResult(null);
    setSolveError(null);
    setActiveProjectId(newProjectId);
    try {
      const storeData = await loadStore(newProjectId);
      loadStoreData(storeData);

      // Fetch active graph for the new project
      const graphsRes = await listGraphs(newProjectId);
      const gid = graphsRes.activeGraphId ?? undefined;
      setActiveGraphId(gid ?? null);

      const graphData = await loadGraph(newProjectId, gid);
      if (graphData.nodes.length > 0 || graphData.edges.length > 0) {
        const sanitizedNodes = graphData.nodes.map((node: any) => ({
          ...node,
          data: stripSolveData(node.data)
        }));
        setNodes(sanitizedNodes);
        setEdges(graphData.edges);
      } else {
        setNodes([]);
        setEdges([]);
      }
    } catch (error) {
      console.error("Error loading project data:", error);
    } finally {
      setIsLoaded(true);
    }
  }, [setActiveProjectId, setActiveGraphId, loadStoreData, setNodes, setEdges]);

  // Handle graph change (reload only graph data, store is shared)
  const handleGraphChange = useCallback(async (newGraphId: string) => {
    setIsLoaded(false);
    setSolveResult(null);
    setSolveError(null);
    setActiveGraphId(newGraphId);
    try {
      const graphData = await loadGraph(activeProjectId ?? undefined, newGraphId);
      if (graphData.nodes.length > 0 || graphData.edges.length > 0) {
        const sanitizedNodes = graphData.nodes.map((node: any) => ({
          ...node,
          data: stripSolveData(node.data)
        }));
        setNodes(sanitizedNodes);
        setEdges(graphData.edges);
      } else {
        setNodes([]);
        setEdges([]);
      }
    } catch (error) {
      console.error("Error loading graph data:", error);
    } finally {
      setIsLoaded(true);
    }
  }, [activeProjectId, setActiveGraphId, setNodes, setEdges]);

  // Inject solve results into node and edge data
  useEffect(() => {
    if (!solveResult) return;

    const problemEdgeSet = new Set(solveResult.problemEdgeIds ?? []);

    // Update nodes with their flow data
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const flowData = solveResult.nodeFlows[node.id];
        if (flowData) {
          return {
            ...node,
            data: {
              ...node.data,
              solveData: flowData
            }
          };
        }
        return node;
      })
    );

    // Update edges with their flow data and problem status
    setEdges((currentEdges) =>
      currentEdges.map((edge) => {
        const flowData = solveResult.edgeFlows[edge.id];
        const isProblem = problemEdgeSet.has(edge.id);
        if (flowData || isProblem) {
          return {
            ...edge,
            data: {
              ...(flowData ?? { flows: {}, totalFlow: 0 }),
              isProblem,
            },
            label: flowData && flowData.totalFlow > 0 ? `${flowData.totalFlow.toFixed(2)}/s` : undefined
          };
        }
        return edge;
      })
    );
  }, [solveResult, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );
  
  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      
      // Get the ReactFlow wrapper's position to calculate correct menu position
      const reactFlowBounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      
      if (reactFlowBounds) {
        setMenu({
          id: node.id,
          top: event.clientY - reactFlowBounds.top,
          left: event.clientX - reactFlowBounds.left,
        });
      } else {
        // Fallback if we can't find the container
        setMenu({
          id: node.id,
          top: event.clientY,
          left: event.clientX,
        });
      }
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
    // Mixed output doesn't need configuration dialog - create directly
    if (nodeType === "mixedoutput") {
      const id = `${nodeType}-${Date.now()}`;
      const position = createPosition();
      setNodes((current) => [
        ...current,
        {
          id,
          type: "mixedoutput",
          position,
          data: {}
        }
      ]);
      return;
    }
    
    // Open dialog immediately when clicked from sidebar
    setPendingNodeType(nodeType);
    setPendingNodePosition(createPosition());
  }, [nodes.length, setNodes]);

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

      // Mixed output doesn't need configuration dialog - create directly
      if (nodeType === "mixedoutput") {
        const id = `${nodeType}-${Date.now()}`;
        setNodes((current) => [
          ...current,
          {
            id,
            type: "mixedoutput",
            position,
            data: {}
          }
        ]);
        return;
      }

      // Open dialog with the dropped node type
      setPendingNodeType(nodeType);
      setPendingNodePosition(position);
    },
    [reactFlowInstance, setNodes]
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
            refId: input.refId,
            refType: input.refType,
            amountPerCycle: input.amount
          };
        });

        const outputs = recipe.outputs.map((output: any) => ({
          id: output.id,
          itemId: output.itemId,
          name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
          amountPerCycle: output.amount,
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
      } else if (pendingNodeType === "mixedoutput") {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "mixedoutput",
            position: pendingNodePosition,
            data: {}
          }
        ]);
      } else if (pendingNodeType === "recipetag") {
        const recipeTag = config.recipeTag;
        
        // Analyze pattern from recipes in this tag
        const analyzeRecipePattern = (recipeIds: string[]) => {
          if (recipeIds.length === 0) {
            return {
              inputs: [{ id: "i1", name: "Mixed Input", amountPerCycle: 1, isMixed: true }],
              outputs: [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }]
            };
          }

          const recipeData = recipeIds
            .map((id) => recipes.find((r) => r.id === id))
            .filter((r): r is NonNullable<typeof r> => r !== undefined);
          
          if (recipeData.length === 0) {
            return {
              inputs: [{ id: "i1", name: "Mixed Input", amountPerCycle: 1, isMixed: true }],
              outputs: [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }]
            };
          }

          const inputCounts = recipeData.map((r) => r.inputs.length);
          const outputCounts = recipeData.map((r) => r.outputs.length);
          const sameInputCount = inputCounts.every((c) => c === inputCounts[0]);
          const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

          if (!sameInputCount || !sameOutputCount) {
            return {
              inputs: [{ id: "i1", name: "Mixed Input", amountPerCycle: 1, isMixed: true }],
              outputs: [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }]
            };
          }

          const numInputs = inputCounts[0];
          const numOutputs = outputCounts[0];

          const inputs = [];
          for (let i = 0; i < numInputs; i++) {
            const inputsAtPosition = recipeData.map((r) => r.inputs[i]);
            const refIds = inputsAtPosition.map((inp) => inp.refId);
            const amounts = inputsAtPosition.map((inp) => inp.amount);
            const refTypes = inputsAtPosition.map((inp) => inp.refType);

            const allSameRefId = refIds.every((id) => id === refIds[0]);
            const allSameAmount = amounts.every((amt) => amt === amounts[0]);

            const isMixed = !allSameRefId;
            let name: string;

            if (isMixed) {
              name = `Mixed Input ${i + 1}`;
            } else {
              const refType = refTypes[0];
              const refId = refIds[0];
              if (refType === "item") {
                name = items.find((item) => item.id === refId)?.name ?? refId;
              } else {
                name = tags.find((tag) => tag.id === refId)?.name ?? refId;
              }
            }

            inputs.push({
              id: `i${i + 1}`,
              name,
              amountPerCycle: allSameAmount ? amounts[0] : 1,
              isMixed,
              refType: refTypes[0],
              refId: allSameRefId ? refIds[0] : undefined,
              fixedRefId: allSameRefId ? refIds[0] : undefined
            });
          }

          const outputs = [];
          for (let i = 0; i < numOutputs; i++) {
            const outputsAtPosition = recipeData.map((r) => r.outputs[i]);
            const itemIds = outputsAtPosition.map((out) => out.itemId);
            const amounts = outputsAtPosition.map((out) => out.amount);
            const probabilities = outputsAtPosition.map((out) => out.probability);

            const allSameItemId = itemIds.every((id) => id === itemIds[0]);
            const allSameAmount = amounts.every((amt) => amt === amounts[0]);
            const allSameProbability = probabilities.every((prob) => prob === probabilities[0]);

            const isMixed = !allSameItemId;
            let name: string;

            if (isMixed) {
              name = `Mixed Output ${i + 1}`;
            } else {
              name = items.find((item) => item.id === itemIds[0])?.name ?? itemIds[0];
            }

            outputs.push({
              id: `o${i + 1}`,
              name,
              amountPerCycle: allSameAmount ? amounts[0] : 1,
              probability: allSameProbability ? probabilities[0] : undefined,
              isMixed,
              itemId: allSameItemId ? itemIds[0] : undefined,
              fixedRefId: allSameItemId ? itemIds[0] : undefined
            });
          }

          return { inputs, outputs };
        };

        const pattern = analyzeRecipePattern(recipeTag.memberRecipeIds);

        setNodes((current) => [
          ...current,
          {
            id,
            type: "recipetag",
            position: pendingNodePosition,
            data: {
              recipeTagId: recipeTag.id,
              title: recipeTag.name,
              inputs: pattern.inputs,
              outputs: pattern.outputs
            }
          }
        ]);
      } else if (pendingNodeType === "inputrecipe") {
        const recipe = config.recipe;
        const outputs = recipe.outputs.map((output: any) => ({
          id: output.id,
          itemId: output.itemId,
          name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
          amountPerCycle: output.amount,
          probability: output.probability
        }));

        setNodes((current) => [
          ...current,
          {
            id,
            type: "inputrecipe",
            position: pendingNodePosition,
            data: {
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
              outputs,
              multiplier: 1
            }
          }
        ]);
      } else if (pendingNodeType === "inputrecipetag") {
        const recipeTag = config.recipeTag;
        
        // Analyze output pattern from recipes in this tag
        const analyzeRecipeOutputPattern = (recipeIds: string[]) => {
          if (recipeIds.length === 0) {
            return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }];
          }

          const recipeData = recipeIds
            .map((id) => recipes.find((r) => r.id === id))
            .filter((r): r is NonNullable<typeof r> => r !== undefined);
          
          if (recipeData.length === 0) {
            return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }];
          }

          const outputCounts = recipeData.map((r) => r.outputs.length);
          const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

          if (!sameOutputCount) {
            return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }];
          }

          const numOutputs = outputCounts[0];

          const outputs = [];
          for (let i = 0; i < numOutputs; i++) {
            const outputsAtPosition = recipeData.map((r) => r.outputs[i]);
            const itemIds = outputsAtPosition.map((out) => out.itemId);
            const amounts = outputsAtPosition.map((out) => out.amount);
            const probabilities = outputsAtPosition.map((out) => out.probability);

            const allSameItemId = itemIds.every((id) => id === itemIds[0]);
            const allSameAmount = amounts.every((amt) => amt === amounts[0]);
            const allSameProbability = probabilities.every((prob) => prob === probabilities[0]);

            const isMixed = !allSameItemId;
            let name: string;

            if (isMixed) {
              name = `Mixed Output ${i + 1}`;
            } else {
              name = items.find((item) => item.id === itemIds[0])?.name ?? itemIds[0];
            }

            outputs.push({
              id: `o${i + 1}`,
              name,
              amountPerCycle: allSameAmount ? amounts[0] : 1,
              probability: allSameProbability ? probabilities[0] : undefined,
              isMixed,
              itemId: allSameItemId ? itemIds[0] : undefined,
              fixedRefId: allSameItemId ? itemIds[0] : undefined
            });
          }

          return outputs;
        };

        const outputs = analyzeRecipeOutputPattern(recipeTag.memberRecipeIds);

        setNodes((current) => [
          ...current,
          {
            id,
            type: "inputrecipetag",
            position: pendingNodePosition,
            data: {
              recipeTagId: recipeTag.id,
              title: recipeTag.name,
              outputs,
              multiplier: 1
            }
          }
        ]);
      }

      setPendingNodeType(null);
      setPendingNodePosition(null);
    },
    [pendingNodeType, pendingNodePosition, items, tags, recipes, setNodes]
  );

  const handleNodeConfigCancel = useCallback(() => {
    setPendingNodeType(null);
    setPendingNodePosition(null);
  }, []);

  // Handle command palette action selection
  const handleCommandPaletteAction = useCallback(
    (action: CommandAction) => {
      const position = reactFlowInstance.project({
        x: window.innerWidth / 2 - 150,
        y: window.innerHeight / 2 - 100
      });

      const id = `${action.type}-${Date.now()}`;

      if (action.type === "input" && action.itemId) {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "input",
            position,
            data: { items: [{ id: "1", itemId: action.itemId, mode: "infinite" }] }
          }
        ]);
      } else if (action.type === "output" && action.itemId) {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "output",
            position,
            data: { items: [{ id: "1", itemId: action.itemId }] }
          }
        ]);
      } else if (action.type === "requester" && action.itemId) {
        setNodes((current) => [
          ...current,
          {
            id,
            type: "requester",
            position,
            data: { requests: [{ id: "req1", itemId: action.itemId, targetPerSecond: 1.0 }] }
          }
        ]);
      } else if (action.type === "recipe" && action.recipeId) {
        const recipe = recipes.find((r) => r.id === action.recipeId);
        if (!recipe) return;

        const inputs = recipe.inputs.map((input: any) => {
          const name =
            input.refType === "item"
              ? items.find((item) => item.id === input.refId)?.name ?? input.refId
              : tags.find((tag) => tag.id === input.refId)?.name ?? input.refId;

          return {
            id: input.id,
            name,
            refId: input.refId,
            refType: input.refType,
            amountPerCycle: input.amount
          };
        });

        const outputs = recipe.outputs.map((output: any) => ({
          id: output.id,
          itemId: output.itemId,
          name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
          amountPerCycle: output.amount,
          probability: output.probability
        }));

        setNodes((current) => [
          ...current,
          {
            id,
            type: "recipe",
            position,
            data: {
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
              inputs,
              outputs
            }
          }
        ]);
      } else if (action.type === "inputrecipe" && action.recipeId) {
        const recipe = recipes.find((r) => r.id === action.recipeId);
        if (!recipe) return;

        const outputs = recipe.outputs.map((output: any) => ({
          id: output.id,
          itemId: output.itemId,
          name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
          amountPerCycle: output.amount,
          probability: output.probability
        }));

        setNodes((current) => [
          ...current,
          {
            id,
            type: "inputrecipe",
            position,
            data: {
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
              outputs,
              multiplier: 1
            }
          }
        ]);
      }
    },
    [reactFlowInstance, setNodes, recipes, items, tags]
  );

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
          refId: input.refId,
          refType: input.refType,
          amountPerCycle: input.amount
        };
      });

      const outputs = recipe.outputs.map((output) => ({
        id: output.id,
        itemId: output.itemId,
        name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
        amountPerCycle: output.amount,
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
          type: (node.type ?? "recipe") as "recipe" | "recipetag" | "input" | "inputrecipe" | "inputrecipetag" | "output" | "requester" | "mixedoutput",
          data: node.data as Record<string, unknown>
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null
        }))
      },
      storeData: {
        items: items,
        recipes: recipes as unknown as Record<string, unknown>[],
        recipeTags: recipeTags,
        tags: tags
      }
    }),
    [nodes, edges, items, recipes, recipeTags, tags]
  );

  const handleSolve = useCallback(async () => {
    setIsSolving(true);
    setSolveError(null);
    setSolveResult(null);

    // Clear previous solve data from nodes and edges immediately
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: stripSolveData(node.data) as Record<string, unknown>,
      }))
    );
    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({
        ...edge,
        data: undefined,
        label: undefined,
      }))
    );

    try {
      const result = await solveGraph(graphPayload);
      console.log("Solve result:", result);
      setSolveResult(result);
    } catch (error) {
      setSolveError(error instanceof Error ? error.message : "Solve failed");
    } finally {
      setIsSolving(false);
    }
  }, [graphPayload, setNodes, setEdges]);

  return (
    <div className="app-root">
      <div className="top-bar">
        <div className="brand">GraphCalc</div>
        <ProjectSelector
          activeProjectId={activeProjectId}
          onProjectChange={handleProjectChange}
        />
        <GraphSelector
          activeProjectId={activeProjectId}
          activeGraphId={activeGraphId}
          onGraphChange={handleGraphChange}
        />
        <ModeSelector
          currentMode={appMode}
          onModeChange={setAppMode}
          configSubMode={configSubMode}
          onConfigSubModeChange={setConfigSubMode}
        />
        {appMode === "edit" && (
          <>
            <input 
              className="search" 
              placeholder="Quick Actions (Ctrl+I)" 
              readOnly
              onClick={() => setIsCommandPaletteOpen(true)}
              style={{ cursor: "pointer" }}
            />
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
            zoomOnScroll
            multiSelectionKeyCode="Control"
            deleteKeyCode={["Backspace", "Delete"]}
            elementsSelectable
            nodesDraggable
            fitView
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
          >
            <Background gap={20} size={1} color="#1f2a3a" />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
            <Panel position="top-right" className="panel">
              <div className="panel-title">Live Stats</div>
              <div className="panel-row">Nodes: {nodes.length}</div>
              <div className="panel-row">Edges: {edges.length}</div>
              {solveResult && solveResult.status === "error" && (
                <div className="panel-error" style={{ marginTop: 8 }}>
                  Solve failed
                </div>
              )}
              {solveResult && solveResult.status === "ok" && (
                <div className="panel-row" style={{ color: "#10b981", marginTop: 4 }}>
                  Solved ({Object.keys(solveResult.machineCounts).length} recipes)
                </div>
              )}
              {solveError && <div className="panel-error">{solveError}</div>}
              {solveResult && solveResult.warnings && solveResult.warnings.length > 0 && (
                <div className="solve-warnings" style={{ marginTop: 8 }}>
                  <div className="panel-subtitle" style={{ color: "#f59e0b" }}>
                    Warnings ({solveResult.warnings.length})
                  </div>
                  {solveResult.warnings.map((w, i) => (
                    <div key={i} className="solve-warning-item">
                      {w}
                    </div>
                  ))}
                </div>
              )}
              {solveResult && solveResult.problemEdgeIds && solveResult.problemEdgeIds.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div className="panel-muted">
                    {solveResult.problemEdgeIds.length} problem edge{solveResult.problemEdgeIds.length !== 1 ? "s" : ""} highlighted
                  </div>
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
          {pendingNodeType && pendingNodeType !== "mixedoutput" && (
            <NodeConfigDialog
              nodeType={pendingNodeType as Exclude<typeof pendingNodeType, "mixedoutput">}
              onConfirm={handleNodeConfigConfirm}
              onCancel={handleNodeConfigCancel}
            />
          )}
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            onActionSelected={handleCommandPaletteAction}
          />
        </div>
      ) : (
        <div className="config-container">
          {configSubMode === "items" && <ItemMode />}
          {configSubMode === "tags" && <TagMode />}
          {configSubMode === "recipes" && <RecipeMode />}
          {configSubMode === "recipeTags" && <RecipeTagMode />}
          {configSubMode === "recipeGenerator" && <RecipeGenerator />}
          {configSubMode === "itemGenerator" && <ItemGenerator />}
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
