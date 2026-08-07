import { useCallback, useMemo, useState, DragEvent, MouseEvent as ReactMouseEvent, useEffect, useRef } from "react";
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
    useReactFlow,
    XYPosition
} from "reactflow";
import { solveGraph, SolveResponse, solveGuestGraph } from "./api/solve";
import {
    areWorkspaceSnapshotsEqual,
    captureRemoteWorkspaceToLocal,
    createEmptyStoreData,
    GraphData,
    activateGraph,
    copyGraph,
    getProjectSnapshot,
    getLocalWorkspaceSnapshot,
    getRemoteWorkspaceSnapshot,
    hasMeaningfulWorkspaceSnapshot,
    listGraphs,
    listProjects,
    loadGraph,
    loadStore,
    replaceRemoteWorkspace,
    saveGraph,
    setPersistenceMode,
    syncLocalWorkspaceToRemote,
    WorkspaceSnapshot
} from "./api/persistence";
import { authenticateUser, AuthUser, changePassword, deleteAccount, getMe, logoutUser, registerUser } from "./api/auth";
import ContextMenu from "./editor/ContextMenu";
import CommandPalette, { CommandAction } from "./editor/CommandPalette";
import { flushPendingStoreSave, useGraphStore } from "./store/graphStore";
import RecipeNode from "./nodes/RecipeNode";
import InputNode from "./nodes/InputNode";
import OutputNode from "./nodes/OutputNode";
import RequesterNode from "./nodes/RequesterNode";
import MixedOutputNode from "./nodes/MixedOutputNode";
import RecipeTagNode from "./nodes/RecipeTagNode";
import InputRecipeNode from "./nodes/InputRecipeNode";
import RecipeTagInputNode from "./nodes/RecipeTagInputNode";
import ModeSelector, { AppMode, ConfigSubMode, ConfigSubmodeSelector } from "./components/ModeSelector";
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
import AuthDialog, { AuthDialogMode } from "./components/AuthDialog";
import WorkspaceMergeDialog from "./components/WorkspaceMergeDialog";
import { NodeType } from "./components/NodeTypeSelector";
import EdgeWithTooltip from "./edges/EdgeWithTooltip";
import { GraphLayoutPreset, layoutGraph } from "./domain/graphLayout";
import {
    assertGraphClipboardProject,
    createGraphClipboardPayload,
    materializeGraphClipboardPayload,
    parseGraphClipboardPayload,
    serializeGraphClipboardPayload,
    type MaterializedGraphSelection
} from "./domain/graphClipboard";
import {
    copyTextToClipboard,
    readTextFromClipboard,
    rememberClipboardText,
    toPrettyJson
} from "./utils/clipboard";

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

const initialNodes: Node[] = [];

const initialEdges: Edge[] = [];

const stripSolveData = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }

    const { solveData, ...rest } = value as Record<string, unknown>;
    return rest;
};

const getRequiredValue = (value: string | null, message: string): string => {
    if (!value) {
        throw new Error(message);
    }

    return value;
};

type AppNotice = {
    id: number;
    message: string;
    tone?: "success" | "error";
    actionLabel?: string;
    onAction?: () => void;
};

type CanvasContextMenu = {
    kind: "node" | "pane";
    id?: string;
    top: number;
    left: number;
    position: XYPosition;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
};

const NODE_ACTION_TYPES: Record<string, NodeType> = {
    "node.add.input": "input",
    "node.add.output": "output",
    "node.add.requester": "requester",
    "node.add.recipe": "recipe",
    "node.add.input-recipe": "inputrecipe",
    "node.add.recipe-tag": "recipetag",
    "node.add.input-recipe-tag": "inputrecipetag",
    "node.add.mixed-output": "mixedoutput"
};

const LAYOUT_ACTION_PRESETS: Record<string, GraphLayoutPreset> = {
    "layout.production": "production",
    "layout.compact": "compact",
    "layout.cascade": "cascade",
    "layout.tree": "tree",
    "layout.hierarchical": "hierarchical"
};

function AppContent() {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const [solveResult, setSolveResult] = useState<SolveResponse | null>(null);
    const [solveError, setSolveError] = useState<string | null>(null);
    const [isSolving, setIsSolving] = useState(false);
    const [menu, setMenu] = useState<CanvasContextMenu | null>(null);
    const [appMode, setAppMode] = useState<AppMode>("edit");
    const [configSubMode, setConfigSubMode] = useState<ConfigSubMode>("items");
    const [pendingNodeType, setPendingNodeType] = useState<NodeType | null>(null);
    const [pendingNodePosition, setPendingNodePosition] = useState<{ x: number; y: number } | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [graphListRevision, setGraphListRevision] = useState(0);
    const [notice, setNotice] = useState<AppNotice | null>(null);
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
    const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [pendingMerge, setPendingMerge] = useState<{
        profile: AuthUser;
        localSnapshot: WorkspaceSnapshot;
        remoteSnapshot: WorkspaceSnapshot;
    } | null>(null);
    const [isMergeApplying, setIsMergeApplying] = useState(false);
    const [mergeDialogError, setMergeDialogError] = useState<string | null>(null);

    const activeProjectId = useGraphStore((state) => state.activeProjectId);
    const setActiveProjectId = useGraphStore((state) => state.setActiveProjectId);
    const activeGraphId = useGraphStore((state) => state.activeGraphId);
    const setActiveGraphId = useGraphStore((state) => state.setActiveGraphId);
    const recipes = useGraphStore((state) => state.recipes);
    const categories = useGraphStore((state) => state.categories);
    const items = useGraphStore((state) => state.items);
    const tags = useGraphStore((state) => state.tags);
    const recipeTags = useGraphStore((state) => state.recipeTags);
    const loadStoreData = useGraphStore((state) => state.loadStoreData);
    const reactFlowInstance = useReactFlow();
    const selectionLoadRequestIdRef = useRef(0);
    const saveTimeoutRef = useRef<number | null>(null);
    const graphSaveInFlightRef = useRef<Promise<void> | null>(null);
    const pendingGraphSaveRef = useRef<{ graphData: GraphData; projectId: string; graphId: string } | null>(null);
    const canvasPointerPositionRef = useRef<XYPosition | null>(null);
    const lastPastedPayloadRef = useRef<string | null>(null);
    const repeatedPasteCountRef = useRef(0);

    const showNotice = useCallback((nextNotice: Omit<AppNotice, "id">) => {
        setNotice({ ...nextNotice, id: Date.now() });
    }, []);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), notice.onAction ? 8000 : 3500);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const buildGraphData = useCallback((): GraphData => ({
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
    }), [nodes, edges]);

    const flushGraphSave = useCallback(async () => {
        if (graphSaveInFlightRef.current) {
            await graphSaveInFlightRef.current;
        }

        if (!pendingGraphSaveRef.current) {
            return;
        }

        const saveJob = pendingGraphSaveRef.current;
        pendingGraphSaveRef.current = null;

        const savePromise = saveGraph(saveJob.graphData, saveJob.projectId, saveJob.graphId)
            .catch((error) => {
                console.error("Error auto-saving graph:", error);
            })
            .finally(() => {
                if (graphSaveInFlightRef.current === savePromise) {
                    graphSaveInFlightRef.current = null;
                }
            });
        graphSaveInFlightRef.current = savePromise;
        await savePromise;

        if (pendingGraphSaveRef.current) {
            await flushGraphSave();
        }
    }, []);

    const flushPendingGraphSave = useCallback(async () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        if (!isLoaded || !activeProjectId || !activeGraphId) {
            return;
        }

        pendingGraphSaveRef.current = {
            graphData: buildGraphData(),
            projectId: activeProjectId,
            graphId: activeGraphId
        };
        await flushGraphSave();
    }, [activeGraphId, activeProjectId, buildGraphData, flushGraphSave, isLoaded]);

    // Fit view whenever a graph finishes loading
    const prevIsLoadedRef = useRef(false);
    useEffect(() => {
        if (isLoaded && !prevIsLoadedRef.current) {
            // Small delay to let ReactFlow render the nodes first
            const timer = setTimeout(() => {
                reactFlowInstance.fitView({ padding: 0.15, duration: 200 });
            }, 50);
            return () => clearTimeout(timer);
        }
        prevIsLoadedRef.current = isLoaded;
    }, [isLoaded, reactFlowInstance]);

    useEffect(() => {
        let ignore = false;

        const loadSession = async () => {
            try {
                if (!ignore) {
                    const profile = await getMe();
                    if (!ignore) {
                        setPersistenceMode("remote");
                        setAuthUser(profile);
                    }
                }
            } catch (error) {
                if (error instanceof Error && error.message === "Unauthorized") {
                    if (!ignore) {
                        setPersistenceMode("local");
                        setAuthUser(null);
                    }
                    return;
                }

                console.error("Error loading account:", error);
                if (!ignore) {
                    setPersistenceMode("local");
                    setAuthUser(null);
                }
            } finally {
                if (!ignore) {
                    setIsAuthChecking(false);
                }
            }
        };

        loadSession();

        return () => {
            ignore = true;
        };
    }, []);

    // Load data on mount
    useEffect(() => {
        if (isAuthChecking) {
            return;
        }

        let ignore = false;

        const loadData = async () => {
            try {
                // First, fetch project list to discover the active project
                const projectsRes = await listProjects();
                if (ignore) {
                    return;
                }
                const pid = projectsRes.activeProjectId;
                loadStoreData(createEmptyStoreData());
                if (pid) {
                    setActiveProjectId(pid);
                } else {
                    setActiveProjectId(null);
                    setActiveGraphId(null);
                    setNodes([]);
                    setEdges([]);
                    return;
                }

                // Load store data (categories, items, tags, recipes, etc.)
                const storeData = await loadStore(pid);
                if (ignore) {
                    return;
                }

                loadStoreData(storeData);

                // Fetch active graph for this project
                let gid: string | undefined;
                if (pid) {
                    const graphsRes = await listGraphs(pid);
                    if (ignore) {
                        return;
                    }
                    gid = graphsRes.activeGraphId ?? undefined;
                    if (gid) {
                        setActiveGraphId(gid);
                    } else {
                        setActiveGraphId(null);
                        setNodes([]);
                        setEdges([]);
                        return;
                    }
                }

                // Load graph data (nodes and edges)
                const graphData = await loadGraph(pid, getRequiredValue(gid ?? null, "No active graph selected"));
                if (ignore) {
                    return;
                }
                if (graphData.nodes.length > 0 || graphData.edges.length > 0) {
                    const sanitizedNodes = graphData.nodes.map((node) => ({
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
                console.error("Error loading data:", error);
            } finally {
                if (!ignore) {
                    setIsLoaded(true);
                }
            }
        };

        loadData();

        return () => {
            ignore = true;
        };
    }, [authUser, isAuthChecking, loadStoreData, setNodes, setEdges, setActiveProjectId, setActiveGraphId]);

    // Auto-save graph (nodes and edges) with debouncing
    useEffect(() => {
        // Don't save until initial load is complete
        if (!isLoaded) return;
        if (!activeProjectId || !activeGraphId) return;

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            pendingGraphSaveRef.current = {
                graphData: buildGraphData(),
                projectId: activeProjectId,
                graphId: activeGraphId
            };
            void flushGraphSave();
        }, 500); // 500ms debounce

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [buildGraphData, nodes, edges, isLoaded, activeProjectId, activeGraphId, flushGraphSave]);

    // Handle project change (reload all data for new project)
    const handleProjectChange = useCallback(async (newProjectId: string) => {
        const requestId = ++selectionLoadRequestIdRef.current;

        await Promise.all([flushPendingGraphSave(), flushPendingStoreSave()]);
        if (selectionLoadRequestIdRef.current !== requestId) {
            return;
        }

        setIsLoaded(false);
        setSolveResult(null);
        setSolveError(null);
        setActiveProjectId(newProjectId);

        try {
            const storeData = await loadStore(newProjectId);
            if (selectionLoadRequestIdRef.current !== requestId) {
                return;
            }
            loadStoreData(storeData);

            // Fetch active graph for the new project
            const graphsRes = await listGraphs(newProjectId);
            if (selectionLoadRequestIdRef.current !== requestId) {
                return;
            }
            const gid = graphsRes.activeGraphId ?? undefined;
            setActiveGraphId(gid ?? null);
            if (!gid) {
                setNodes([]);
                setEdges([]);
                return;
            }

            const graphData = await loadGraph(newProjectId, gid);
            if (selectionLoadRequestIdRef.current !== requestId) {
                return;
            }
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
            if (selectionLoadRequestIdRef.current === requestId) {
                setIsLoaded(true);
            }
        }
    }, [flushPendingGraphSave, setActiveProjectId, setActiveGraphId, loadStoreData, setNodes, setEdges]);

    // Handle graph change (reload only graph data, store is shared)
    const handleGraphChange = useCallback(async (newGraphId: string) => {
        const requestId = ++selectionLoadRequestIdRef.current;

        await flushPendingGraphSave();
        if (selectionLoadRequestIdRef.current !== requestId) {
            return;
        }

        setIsLoaded(false);
        setSolveResult(null);
        setSolveError(null);
        setActiveGraphId(newGraphId);

        try {
            const projectId = getRequiredValue(activeProjectId, "No active project selected");
            const graphData = await loadGraph(projectId, newGraphId);
            if (selectionLoadRequestIdRef.current !== requestId) {
                return;
            }
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
            if (selectionLoadRequestIdRef.current === requestId) {
                setIsLoaded(true);
            }
        }
    }, [activeProjectId, flushPendingGraphSave, setActiveGraphId, setNodes, setEdges]);

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
                    kind: "node",
                    id: node.id,
                    top: event.clientY - reactFlowBounds.top,
                    left: event.clientX - reactFlowBounds.left,
                    position: reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
                });
            } else {
                // Fallback if we can't find the container
                setMenu({
                    kind: "node",
                    id: node.id,
                    top: event.clientY,
                    left: event.clientX,
                    position: reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
                });
            }
        },
        [reactFlowInstance, setMenu]
    );

    const onPaneClick = useCallback(() => setMenu(null), [setMenu]);

    const handleDeleteNode = useCallback(() => {
        if (!menu || menu.kind !== "node" || !menu.id) return;
        setNodes((nds) => nds.filter((n) => n.id !== menu.id));
        setEdges((eds) => eds.filter((e) => e.source !== menu.id && e.target !== menu.id));
        setMenu(null);
    }, [menu, setNodes, setEdges]);

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

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY
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

    const openAuthDialog = useCallback((mode: AuthDialogMode = "login") => {
        setAuthDialogMode(mode);
        setIsAuthDialogOpen(true);
    }, []);

    const finalizeAuthenticatedSession = useCallback((profile: AuthUser) => {
        setMergeDialogError(null);
        setPendingMerge(null);
        setIsLoaded(false);
        setPersistenceMode("remote");
        setAuthUser(profile);
    }, []);

    const rollbackPendingLogin = useCallback(async (errorContext: string) => {
        setPersistenceMode("local");
        await logoutUser().catch((logoutError) => {
            console.error(`Failed to roll back session after ${errorContext}:`, logoutError);
        });
    }, []);

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
            const result = authUser
                ? await solveGraph(
                    getRequiredValue(activeProjectId, "No active project selected"),
                    getRequiredValue(activeGraphId, "No active graph selected")
                )
                : await solveGuestGraph({
                    graph: buildGraphData(),
                    storeData: {
                        categories,
                        items,
                        tags,
                        recipeTags,
                        recipes,
                        recipeBlueprints: [],
                    }
                });
            console.log("Solve result:", result);
            setSolveResult(result);
        } catch (error) {
            setSolveError(error instanceof Error ? error.message : "Solve failed");
        } finally {
            setIsSolving(false);
        }
    }, [activeGraphId, activeProjectId, authUser, buildGraphData, categories, items, recipeTags, recipes, setNodes, setEdges, tags]);

    const selectedNodeCount = useMemo(
        () => nodes.filter((node) => node.selected).length,
        [nodes]
    );

    const getCanvasCenterPosition = useCallback(() => {
        const bounds = document.querySelector<HTMLElement>(".react-flow")?.getBoundingClientRect();
        return reactFlowInstance.screenToFlowPosition({
            x: bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2,
            y: bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2
        });
    }, [reactFlowInstance]);

    const insertGraphSelection = useCallback((selection: MaterializedGraphSelection) => {
        setSolveResult(null);
        setSolveError(null);
        setNodes((current) => [
            ...current.map((node) => ({
                ...node,
                selected: false,
                data: stripSolveData(node.data)
            })),
            ...selection.nodes
        ]);
        setEdges((current) => [
            ...current.map((edge) => ({
                ...edge,
                selected: false,
                data: undefined,
                label: undefined
            })),
            ...selection.edges
        ]);
    }, [setEdges, setNodes]);

    const handleCopyNodes = useCallback(async (
        nodeIds?: Iterable<string>,
        options?: { silent?: boolean }
    ) => {
        const projectId = getRequiredValue(activeProjectId, "No active project selected");
        const graphId = getRequiredValue(activeGraphId, "No active graph selected");
        const payload = createGraphClipboardPayload({
            projectId,
            graphId,
            nodes: reactFlowInstance.getNodes(),
            edges: reactFlowInstance.getEdges(),
            nodeIds
        });
        const serialized = serializeGraphClipboardPayload(payload);
        rememberClipboardText(serialized);
        lastPastedPayloadRef.current = null;
        repeatedPasteCountRef.current = 0;

        let systemClipboardAvailable = true;
        try {
            await copyTextToClipboard(serialized);
        } catch (error) {
            systemClipboardAvailable = false;
            console.warn("System clipboard write failed; using the in-app clipboard.", error);
        }

        if (!options?.silent) {
            const nodeLabel = payload.nodes.length === 1 ? "node" : "nodes";
            showNotice({
                message: systemClipboardAvailable
                    ? `Copied ${payload.nodes.length} ${nodeLabel}.`
                    : `Copied ${payload.nodes.length} ${nodeLabel} for this session.`,
                tone: "success"
            });
        }
    }, [activeGraphId, activeProjectId, reactFlowInstance, showNotice]);

    const handleCutNodes = useCallback(async (nodeIds?: Iterable<string>) => {
        const currentNodes = reactFlowInstance.getNodes();
        const ids = new Set(nodeIds ?? currentNodes.filter((node) => node.selected).map((node) => node.id));
        if (ids.size === 0) {
            throw new Error("Select at least one node to cut.");
        }

        await handleCopyNodes(ids, { silent: true });
        setSolveResult(null);
        setSolveError(null);
        setNodes((current) => current.filter((node) => !ids.has(node.id)));
        setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
        setMenu(null);

        showNotice({
            message: `Cut ${ids.size} ${ids.size === 1 ? "node" : "nodes"}.`,
            tone: "success"
        });
    }, [handleCopyNodes, reactFlowInstance, setEdges, setNodes, showNotice]);

    const handleDuplicateSelectedNodes = useCallback((nodeIds?: Iterable<string>) => {
        const projectId = getRequiredValue(activeProjectId, "No active project selected");
        const graphId = getRequiredValue(activeGraphId, "No active graph selected");
        const currentNodes = reactFlowInstance.getNodes();
        const currentEdges = reactFlowInstance.getEdges();
        const payload = createGraphClipboardPayload({
            projectId,
            graphId,
            nodes: currentNodes,
            edges: currentEdges,
            nodeIds
        });
        const duplicated = materializeGraphClipboardPayload(payload, {
            anchor: {
                x: (payload.bounds.minX + payload.bounds.maxX) / 2,
                y: (payload.bounds.minY + payload.bounds.maxY) / 2
            },
            existingNodeIds: currentNodes.map((node) => node.id),
            existingEdgeIds: currentEdges.map((edge) => edge.id),
            offset: 50
        });

        insertGraphSelection(duplicated);
        setMenu(null);
        showNotice({
            message: `Duplicated ${duplicated.nodes.length} ${duplicated.nodes.length === 1 ? "node" : "nodes"}.`,
            tone: "success"
        });
    }, [activeGraphId, activeProjectId, insertGraphSelection, reactFlowInstance, showNotice]);

    const handlePasteNodes = useCallback(async (position?: XYPosition) => {
        const projectId = getRequiredValue(activeProjectId, "No active project selected");
        getRequiredValue(activeGraphId, "No active graph selected");
        const clipboard = await readTextFromClipboard();
        if (!clipboard.text) {
            throw new Error("The clipboard is empty.");
        }

        const payload = parseGraphClipboardPayload(clipboard.text);
        if (!payload) {
            throw new Error("The clipboard does not contain a GraphCalc node selection.");
        }
        assertGraphClipboardProject(payload, projectId);

        const payloadKey = `${payload.sourceProjectId}:${payload.sourceGraphId}:${payload.copiedAt}`;
        if (lastPastedPayloadRef.current === payloadKey) {
            repeatedPasteCountRef.current += 1;
        } else {
            lastPastedPayloadRef.current = payloadKey;
            repeatedPasteCountRef.current = 0;
        }

        const currentNodes = reactFlowInstance.getNodes();
        const currentEdges = reactFlowInstance.getEdges();
        const pasted = materializeGraphClipboardPayload(payload, {
            anchor: position ?? canvasPointerPositionRef.current ?? getCanvasCenterPosition(),
            existingNodeIds: currentNodes.map((node) => node.id),
            existingEdgeIds: currentEdges.map((edge) => edge.id),
            offset: repeatedPasteCountRef.current * 24
        });

        insertGraphSelection(pasted);
        setMenu(null);

        const nodeLabel = pasted.nodes.length === 1 ? "node" : "nodes";
        const edgeLabel = pasted.edges.length === 1 ? "connection" : "connections";
        showNotice({
            message: `Pasted ${pasted.nodes.length} ${nodeLabel} and ${pasted.edges.length} ${edgeLabel}.`,
            tone: "success"
        });
    }, [activeGraphId, activeProjectId, getCanvasCenterPosition, insertGraphSelection, reactFlowInstance, showNotice]);

    const getMenuNodeIds = useCallback((): string[] => {
        if (!menu || menu.kind !== "node" || !menu.id) return [];
        const clickedNode = nodes.find((node) => node.id === menu.id);
        if (!clickedNode) return [];
        return clickedNode.selected
            ? nodes.filter((node) => node.selected).map((node) => node.id)
            : [clickedNode.id];
    }, [menu, nodes]);

    const handleCopyFromMenu = useCallback(async () => {
        if (!menu || menu.kind !== "node" || !menu.id) return;
        await handleCopyNodes(getMenuNodeIds());
        setMenu(null);
    }, [getMenuNodeIds, handleCopyNodes, menu]);

    const handleCutFromMenu = useCallback(async () => {
        await handleCutNodes(getMenuNodeIds());
    }, [getMenuNodeIds, handleCutNodes]);

    const handleDuplicateFromMenu = useCallback(() => {
        handleDuplicateSelectedNodes(getMenuNodeIds());
    }, [getMenuNodeIds, handleDuplicateSelectedNodes]);

    const handlePasteFromMenu = useCallback(async () => {
        if (!menu) return;
        await handlePasteNodes(menu.position);
    }, [handlePasteNodes, menu]);

    const onPaneContextMenu = useCallback((event: ReactMouseEvent) => {
        event.preventDefault();
        const reactFlowBounds = (event.target as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
        setMenu({
            kind: "pane",
            top: reactFlowBounds ? event.clientY - reactFlowBounds.top : event.clientY,
            left: reactFlowBounds ? event.clientX - reactFlowBounds.left : event.clientX,
            position: reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        });
    }, [reactFlowInstance]);

    const onPaneMouseMove = useCallback((event: ReactMouseEvent) => {
        canvasPointerPositionRef.current = reactFlowInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY
        });
    }, [reactFlowInstance]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return;
            const key = event.key.toLowerCase();

            if (key === "i") {
                event.preventDefault();
                setIsCommandPaletteOpen((current) => !current);
                return;
            }

            if (isEditableTarget(event.target) || appMode !== "edit" || !activeProjectId || !activeGraphId) {
                return;
            }

            if (key === "c" && selectedNodeCount > 0) {
                event.preventDefault();
                void handleCopyNodes().catch((error) => showNotice({
                    message: error instanceof Error ? error.message : "The selection could not be copied.",
                    tone: "error"
                }));
            } else if (key === "x" && selectedNodeCount > 0) {
                event.preventDefault();
                void handleCutNodes().catch((error) => showNotice({
                    message: error instanceof Error ? error.message : "The selection could not be cut.",
                    tone: "error"
                }));
            } else if (key === "d" && selectedNodeCount > 0) {
                event.preventDefault();
                try {
                    handleDuplicateSelectedNodes();
                } catch (error) {
                    showNotice({
                        message: error instanceof Error ? error.message : "The selection could not be duplicated.",
                        tone: "error"
                    });
                }
            } else if (key === "v") {
                event.preventDefault();
                void handlePasteNodes().catch((error) => showNotice({
                    message: error instanceof Error ? error.message : "The selection could not be pasted.",
                    tone: "error"
                }));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeGraphId, activeProjectId, appMode, handleCopyNodes, handleCutNodes, handleDuplicateSelectedNodes, handlePasteNodes, selectedNodeCount, showNotice]);

    const handleQuickAddNode = useCallback((nodeType: NodeType) => {
        const position = getCanvasCenterPosition();
        if (nodeType === "mixedoutput") {
            setNodes((current) => [
                ...current,
                {
                    id: `${nodeType}-${Date.now()}`,
                    type: nodeType,
                    position,
                    data: {}
                }
            ]);
            showNotice({ message: "Mixed Output node added.", tone: "success" });
            return;
        }

        setPendingNodeType(nodeType);
        setPendingNodePosition(position);
    }, [getCanvasCenterPosition, setNodes, showNotice]);

    const handleApplyLayout = useCallback(async (preset: GraphLayoutPreset) => {
        if (nodes.length < 2) {
            throw new Error("Add at least two nodes before rearranging the graph.");
        }

        const previousPositions = new Map(nodes.map((node) => [node.id, node.position]));
        const layoutedNodes = await layoutGraph(nodes, edges, preset);
        setNodes(layoutedNodes);
        window.requestAnimationFrame(() => {
            reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
        });

        showNotice({
            message: "Node layout applied.",
            tone: "success",
            actionLabel: "Undo",
            onAction: () => {
                setNodes((current) => current.map((node) => ({
                    ...node,
                    position: previousPositions.get(node.id) ?? node.position
                })));
                window.requestAnimationFrame(() => {
                    reactFlowInstance.fitView({ padding: 0.15, duration: 250 });
                });
                setNotice(null);
            }
        });
    }, [edges, nodes, reactFlowInstance, setNodes, showNotice]);

    const handleDuplicateGraph = useCallback(async () => {
        const projectId = getRequiredValue(activeProjectId, "No active project selected");
        const graphId = getRequiredValue(activeGraphId, "No active graph selected");
        await flushPendingGraphSave();

        const response = await listGraphs(projectId);
        const sourceGraph = response.graphs.find((graph) => graph.id === graphId);
        if (!sourceGraph) throw new Error("The active graph could not be found.");

        const usedNames = new Set(response.graphs.map((graph) => graph.name.toLowerCase()));
        const baseName = `${sourceGraph.name} (copy)`;
        let copyName = baseName;
        let copyIndex = 2;
        while (usedNames.has(copyName.toLowerCase())) {
            copyName = `${sourceGraph.name} (copy ${copyIndex})`;
            copyIndex += 1;
        }

        const copiedGraph = await copyGraph(projectId, graphId, copyName);
        await activateGraph(projectId, copiedGraph.id);
        setGraphListRevision((current) => current + 1);
        await handleGraphChange(copiedGraph.id);
        showNotice({ message: `Duplicated as “${copyName}”.`, tone: "success" });
    }, [activeGraphId, activeProjectId, flushPendingGraphSave, handleGraphChange, showNotice]);

    const handleCopyGraphJson = useCallback(async () => {
        if (!activeGraphId) throw new Error("No active graph selected.");
        await copyTextToClipboard(toPrettyJson(buildGraphData()));
        showNotice({ message: "Graph JSON copied.", tone: "success" });
    }, [activeGraphId, buildGraphData, showNotice]);

    const handleCopyProjectJson = useCallback(async () => {
        const projectId = getRequiredValue(activeProjectId, "No active project selected");
        await Promise.all([flushPendingGraphSave(), flushPendingStoreSave()]);
        const project = await getProjectSnapshot(projectId);
        await copyTextToClipboard(toPrettyJson({ schemaVersion: 1, project }));
        showNotice({ message: "Project JSON copied.", tone: "success" });
    }, [activeProjectId, flushPendingGraphSave, showNotice]);

    const handleCopySolveResultJson = useCallback(async () => {
        if (!solveResult) throw new Error("Run Solve successfully before copying its result.");
        await copyTextToClipboard(toPrettyJson(solveResult));
        showNotice({ message: "Solve result JSON copied.", tone: "success" });
    }, [showNotice, solveResult]);

    const handleQuickAction = useCallback(async (action: CommandAction) => {
        const nodeType = NODE_ACTION_TYPES[action.id];
        if (nodeType) {
            handleQuickAddNode(nodeType);
            return;
        }

        const layoutPreset = LAYOUT_ACTION_PRESETS[action.id];
        if (layoutPreset) {
            await handleApplyLayout(layoutPreset);
            return;
        }

        switch (action.id) {
            case "clipboard.nodes.copy":
                await handleCopyNodes();
                return;
            case "clipboard.nodes.cut":
                await handleCutNodes();
                return;
            case "clipboard.nodes.paste":
                await handlePasteNodes();
                return;
            case "clipboard.nodes.duplicate":
                handleDuplicateSelectedNodes();
                return;
            case "graph.duplicate":
                await handleDuplicateGraph();
                return;
            case "graph.solve":
                await handleSolve();
                return;
            case "graph.fit-view":
                reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
                return;
            case "clipboard.graph":
                await handleCopyGraphJson();
                return;
            case "clipboard.project":
                await handleCopyProjectJson();
                return;
            case "clipboard.solve-result":
                await handleCopySolveResultJson();
                return;
            default:
                throw new Error("Unknown quick action.");
        }
    }, [handleApplyLayout, handleCopyGraphJson, handleCopyNodes, handleCopyProjectJson, handleCopySolveResultJson, handleCutNodes, handleDuplicateGraph, handleDuplicateSelectedNodes, handlePasteNodes, handleQuickAddNode, handleSolve, reactFlowInstance]);

    const handleLogin = useCallback(async (username: string, password: string) => {
        await authenticateUser(username, password);
        await flushPendingGraphSave();
        await flushPendingStoreSave();

        try {
            const [profile, localSnapshot, remoteSnapshot] = await Promise.all([
                getMe(),
                getLocalWorkspaceSnapshot(),
                getRemoteWorkspaceSnapshot(),
            ]);

            if (!hasMeaningfulWorkspaceSnapshot(localSnapshot) || areWorkspaceSnapshotsEqual(localSnapshot, remoteSnapshot)) {
                finalizeAuthenticatedSession(profile);
                setIsAuthDialogOpen(false);
                return;
            }

            setMergeDialogError(null);
            setPendingMerge({ profile, localSnapshot, remoteSnapshot });
            setIsAuthDialogOpen(false);
        } catch (error) {
            await rollbackPendingLogin("login error");
            throw error;
        }
    }, [finalizeAuthenticatedSession, flushPendingGraphSave, rollbackPendingLogin]);

    const handleMergeCancel = useCallback(async () => {
        setMergeDialogError(null);
        setPendingMerge(null);
        await rollbackPendingLogin("merge cancellation");
    }, [rollbackPendingLogin]);

    const handleMergeConfirm = useCallback(async (mergedSnapshot: WorkspaceSnapshot) => {
        if (!pendingMerge) {
            return;
        }

        setIsMergeApplying(true);
        setMergeDialogError(null);

        try {
            if (!areWorkspaceSnapshotsEqual(mergedSnapshot, pendingMerge.remoteSnapshot)) {
                await replaceRemoteWorkspace(mergedSnapshot);
            }

            finalizeAuthenticatedSession(pendingMerge.profile);
        } catch (error) {
            setMergeDialogError(error instanceof Error ? error.message : "Failed to apply workspace merge.");
        } finally {
            setIsMergeApplying(false);
        }
    }, [finalizeAuthenticatedSession, pendingMerge]);

    const handleRegister = useCallback(async (username: string, password: string) => {
        await registerUser(username, password);
        await flushPendingGraphSave();
        await flushPendingStoreSave();

        try {
            await syncLocalWorkspaceToRemote();
            const profile = await getMe();
            finalizeAuthenticatedSession(profile);
        } catch (error) {
            setPersistenceMode("local");
            await logoutUser().catch((logoutError) => {
                console.error("Failed to roll back session after sync error:", logoutError);
            });
            throw error;
        }

        setIsAuthDialogOpen(false);
    }, [finalizeAuthenticatedSession, flushPendingGraphSave]);

    const handlePasswordChange = useCallback(async (currentPassword: string, newPassword: string) => {
        const profile = await changePassword(currentPassword, newPassword);
        setAuthUser(profile);
    }, []);

    const handleDeleteAccount = useCallback(async (currentPassword: string) => {
        await deleteAccount(currentPassword);
        setIsLoaded(false);
        setPersistenceMode("local");
        setAuthUser(null);
        setIsAuthDialogOpen(false);
    }, []);

    const handleLogout = useCallback(async () => {
        await flushPendingGraphSave();
        await flushPendingStoreSave();
        await captureRemoteWorkspaceToLocal();
        await logoutUser();
        setIsLoaded(false);
        setPersistenceMode("local");
        setAuthUser(null);
        setIsAuthDialogOpen(false);
    }, [flushPendingGraphSave]);

    const isAuthenticated = Boolean(authUser);
    const workspaceSelectorKey = authUser ? `remote:${authUser.id}` : "local";
    const hasActiveGraph = Boolean(activeProjectId && activeGraphId);
    const quickActions = useMemo<CommandAction[]>(() => {
        const actions: CommandAction[] = [];

        if (appMode === "edit") {
            actions.push(
                {
                    id: "node.add.input",
                    label: "Add Input Node",
                    description: "Choose an item after selecting this action.",
                    group: "Add nodes",
                    icon: "📥",
                    keywords: ["source", "item"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.output",
                    label: "Add Output Node",
                    description: "Choose an output item after selecting this action.",
                    group: "Add nodes",
                    icon: "📤",
                    keywords: ["target", "item"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.requester",
                    label: "Add Requester Node",
                    description: "Choose the requested item after selecting this action.",
                    group: "Add nodes",
                    icon: "🎯",
                    keywords: ["demand", "target"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.recipe",
                    label: "Add Recipe Node",
                    description: "Choose a configured recipe after selecting this action.",
                    group: "Add nodes",
                    icon: "⚙️",
                    keywords: ["production", "machine"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.input-recipe",
                    label: "Add Input Recipe Node",
                    description: "Choose a recipe to use as an input source.",
                    group: "Add nodes",
                    icon: "⚡",
                    keywords: ["source", "recipe"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.recipe-tag",
                    label: "Add Recipe Tag Node",
                    description: "Choose a configured recipe tag.",
                    group: "Add nodes",
                    icon: "🏷️",
                    keywords: ["group", "pattern"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.input-recipe-tag",
                    label: "Add Input Recipe Tag Node",
                    description: "Choose a recipe tag to use as an input source.",
                    group: "Add nodes",
                    icon: "🔖",
                    keywords: ["source", "group", "pattern"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "node.add.mixed-output",
                    label: "Add Mixed Output Node",
                    description: "Create an output node for mixed incoming items.",
                    group: "Add nodes",
                    icon: "🎲",
                    keywords: ["output", "mixed"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
                },
                {
                    id: "graph.rearrange",
                    label: "Rearrange Nodes",
                    description: "Choose an automatic graph layout.",
                    group: "Graph",
                    icon: "✨",
                    keywords: ["layout", "organize", "arrange"],
                    disabled: nodes.length < 2,
                    disabledReason: nodes.length < 2 ? "Add at least two nodes first." : undefined,
                    children: [
                        {
                            id: "layout.production",
                            label: "Production Flow",
                            description: "Readable left-to-right layered production flow.",
                            group: "Layout",
                            icon: "→",
                            keywords: ["layered", "horizontal", "default"]
                        },
                        {
                            id: "layout.compact",
                            label: "Compact Flow",
                            description: "Tighter left-to-right layout for large graphs.",
                            group: "Layout",
                            icon: "⇥",
                            keywords: ["layered", "dense", "tight"]
                        },
                        {
                            id: "layout.cascade",
                            label: "Cascade Flow",
                            description: "Stagger branches while preserving left-to-right item flow.",
                            group: "Layout",
                            icon: "⇘",
                            keywords: ["cascade", "staggered", "branches", "flow"]
                        },
                        {
                            id: "layout.tree",
                            label: "Tree Flow",
                            description: "Emphasize parent-child recipe branches from left to right.",
                            group: "Layout",
                            icon: "⑂",
                            keywords: ["tree", "branch", "parent", "hierarchy"]
                        },
                        {
                            id: "layout.hierarchical",
                            label: "Hierarchical Flow",
                            description: "Strict Sugiyama layers with uniformly rightward edges.",
                            group: "Layout",
                            icon: "≡→",
                            keywords: ["layered", "sugiyama", "hierarchy", "flow"]
                        }
                    ]
                },
                {
                    id: "graph.solve",
                    label: "Solve Graph",
                    description: isSolving ? "A solve is already running." : "Run the production solver.",
                    group: "Graph",
                    icon: "▶",
                    keywords: ["calculate", "result"],
                    disabled: !hasActiveGraph || isSolving,
                    disabledReason: !hasActiveGraph ? "Select a graph first." : isSolving ? "Solve in progress." : undefined
                },
                {
                    id: "graph.fit-view",
                    label: "Fit Graph to View",
                    description: "Center all nodes in the canvas.",
                    group: "Graph",
                    icon: "⊡",
                    keywords: ["center", "zoom"],
                    disabled: nodes.length === 0,
                    disabledReason: nodes.length === 0 ? "The graph is empty." : undefined
                }
            );
        }

        actions.push(
            {
                id: "graph.duplicate",
                label: "Duplicate Graph",
                description: "Create and open a copy containing the latest edits.",
                group: "Graph",
                icon: "▣",
                keywords: ["copy", "clone"],
                disabled: !hasActiveGraph,
                disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
            },
            {
                id: "clipboard.nodes.copy",
                label: "Copy Selected Nodes",
                description: "Copy selected nodes and the connections between them (Ctrl/Cmd+C).",
                group: "Clipboard",
                icon: "⧉",
                keywords: ["copy", "selection", "nodes", "ctrl c", "command c"],
                disabled: appMode !== "edit" || selectedNodeCount === 0,
                disabledReason: appMode !== "edit"
                    ? "Open a graph in edit mode first."
                    : selectedNodeCount === 0 ? "Select one or more nodes first." : undefined
            },
            {
                id: "clipboard.nodes.paste",
                label: "Paste Nodes",
                description: "Paste copied nodes into this graph (Ctrl/Cmd+V).",
                group: "Clipboard",
                icon: "▣",
                keywords: ["paste", "selection", "nodes", "ctrl v", "command v"],
                disabled: appMode !== "edit" || !hasActiveGraph,
                disabledReason: appMode !== "edit"
                    ? "Open a graph in edit mode first."
                    : !hasActiveGraph ? "Select a graph first." : undefined
            },
            {
                id: "clipboard.nodes.cut",
                label: "Cut Selected Nodes",
                description: "Copy and remove selected nodes (Ctrl/Cmd+X).",
                group: "Clipboard",
                icon: "✂",
                keywords: ["cut", "selection", "nodes", "ctrl x", "command x"],
                disabled: appMode !== "edit" || selectedNodeCount === 0,
                disabledReason: appMode !== "edit"
                    ? "Open a graph in edit mode first."
                    : selectedNodeCount === 0 ? "Select one or more nodes first." : undefined
            },
            {
                id: "clipboard.nodes.duplicate",
                label: "Duplicate Selected Nodes",
                description: "Duplicate selected nodes and their internal connections (Ctrl/Cmd+D).",
                group: "Clipboard",
                icon: "⧉",
                keywords: ["duplicate", "clone", "selection", "nodes", "ctrl d", "command d"],
                disabled: appMode !== "edit" || selectedNodeCount === 0,
                disabledReason: appMode !== "edit"
                    ? "Open a graph in edit mode first."
                    : selectedNodeCount === 0 ? "Select one or more nodes first." : undefined
            },
            {
                id: "clipboard.graph",
                label: "Copy Graph JSON",
                description: "Copy the current graph without temporary solve decorations.",
                group: "Clipboard",
                icon: "{}",
                keywords: ["export", "nodes", "edges"],
                disabled: !hasActiveGraph,
                disabledReason: !hasActiveGraph ? "Select a graph first." : undefined
            },
            {
                id: "clipboard.project",
                label: "Copy Project JSON",
                description: "Copy project configuration and every graph.",
                group: "Clipboard",
                icon: "📦",
                keywords: ["export", "store", "workspace"],
                disabled: !activeProjectId,
                disabledReason: !activeProjectId ? "Select a project first." : undefined
            },
            {
                id: "clipboard.solve-result",
                label: "Copy Solve Result JSON",
                description: "Copy the latest complete solver response.",
                group: "Clipboard",
                icon: "✓",
                keywords: ["export", "flows", "result"],
                disabled: !solveResult,
                disabledReason: !solveResult ? "Run Solve successfully first." : undefined
            }
        );

        return actions;
    }, [activeProjectId, appMode, hasActiveGraph, isSolving, nodes.length, selectedNodeCount, solveResult]);

    return (
        <div className="app-root">
            <div className="top-bar">
                <div className="top-bar-main">
                    <div className="top-bar-main-left">
                        <div className="brand">GraphCalc</div>
                        {!isAuthChecking && (
                            <>
                                <ProjectSelector
                                    key={`project-selector:${workspaceSelectorKey}`}
                                    activeProjectId={activeProjectId}
                                    onProjectChange={handleProjectChange}
                                />
                                <GraphSelector
                                    key={`graph-selector:${workspaceSelectorKey}:${activeProjectId ?? "none"}`}
                                    activeProjectId={activeProjectId}
                                    activeGraphId={activeGraphId}
                                    onGraphChange={handleGraphChange}
                                    refreshToken={graphListRevision}
                                />
                                <ModeSelector
                                    currentMode={appMode}
                                    onModeChange={setAppMode}
                                />
                            </>
                        )}
                    </div>
                    <button
                        type="button"
                        className="quick-actions-trigger"
                        onClick={() => setIsCommandPaletteOpen(true)}
                    >
                        <span className="quick-actions-trigger-icon" aria-hidden="true">⌕</span>
                        <span className="quick-actions-trigger-label">Quick Actions</span>
                        <kbd>{navigator.platform.includes("Mac") ? "⌘I" : "Ctrl+I"}</kbd>
                    </button>
                    <div className="top-bar-actions">
                        {appMode === "edit" && (
                            <button className="primary" onClick={handleSolve} disabled={isSolving}>
                                {isSolving ? "Solving..." : "Solve"}
                            </button>
                        )}
                        <button
                            className="auth-secondary auth-button"
                            onClick={() => openAuthDialog("login")}
                            disabled={isAuthChecking}
                            title={authUser ? `${authUser.username} · ${authUser.projectCount} project${authUser.projectCount === 1 ? "" : "s"}` : "Guest mode · workspace is stored in this browser"}
                        >
                            {isAuthChecking ? "Checking..." : authUser ? `${authUser.username} · ${authUser.projectCount}` : "Guest Mode"}
                        </button>
                    </div>
                </div>
                {appMode === "config" && (
                    <div className="top-bar-subnav">
                        <ConfigSubmodeSelector
                            configSubMode={configSubMode}
                            onConfigSubModeChange={setConfigSubMode}
                        />
                    </div>
                )}
            </div>
            <AuthDialog
                isOpen={isAuthDialogOpen}
                initialMode={authDialogMode}
                currentUser={authUser}
                onClose={() => setIsAuthDialogOpen(false)}
                onLogin={handleLogin}
                onRegister={handleRegister}
                onPasswordChange={handlePasswordChange}
                onDeleteAccount={handleDeleteAccount}
                onLogout={handleLogout}
            />
            <WorkspaceMergeDialog
                isOpen={Boolean(pendingMerge)}
                localSnapshot={pendingMerge?.localSnapshot ?? null}
                remoteSnapshot={pendingMerge?.remoteSnapshot ?? null}
                isSubmitting={isMergeApplying}
                error={mergeDialogError}
                onCancel={handleMergeCancel}
                onConfirm={handleMergeConfirm}
            />
            <CommandPalette
                isOpen={isCommandPaletteOpen}
                actions={quickActions}
                onClose={() => setIsCommandPaletteOpen(false)}
                onActionSelected={handleQuickAction}
            />

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
                        onPaneContextMenu={onPaneContextMenu}
                        onPaneMouseMove={onPaneMouseMove}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        selectionOnDrag
                        panOnDrag={[1, 2]}
                        selectionMode={undefined}
                        zoomOnScroll
                        multiSelectionKeyCode={["Control", "Meta"]}
                        deleteKeyCode={["Backspace", "Delete"]}
                        elementsSelectable
                        nodesDraggable
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                    >
                        <Background gap={20} size={1} color="#1f2a3a" />
                        <MiniMap
                            pannable
                            zoomable
                            nodeColor="#2a3444"
                            nodeStrokeColor="#4a5568"
                            maskColor="rgba(10, 14, 20, 0.7)"
                        />
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
                                copyLabel={menu.kind === "node" && menu.id && nodes.find((node) => node.id === menu.id)?.selected && selectedNodeCount > 1
                                    ? `Copy ${selectedNodeCount} Selected Nodes`
                                    : "Copy Node"}
                                onCopy={menu.kind === "node" ? () => {
                                    void handleCopyFromMenu().catch((error) => showNotice({
                                        message: error instanceof Error ? error.message : "The selection could not be copied.",
                                        tone: "error"
                                    }));
                                } : undefined}
                                cutLabel={menu.kind === "node" && menu.id && nodes.find((node) => node.id === menu.id)?.selected && selectedNodeCount > 1
                                    ? `Cut ${selectedNodeCount} Selected Nodes`
                                    : "Cut Node"}
                                onCut={menu.kind === "node" ? () => {
                                    void handleCutFromMenu().catch((error) => showNotice({
                                        message: error instanceof Error ? error.message : "The selection could not be cut.",
                                        tone: "error"
                                    }));
                                } : undefined}
                                onPaste={() => {
                                    void handlePasteFromMenu().catch((error) => showNotice({
                                        message: error instanceof Error ? error.message : "The selection could not be pasted.",
                                        tone: "error"
                                    }));
                                }}
                                duplicateLabel={menu.kind === "node" && menu.id && nodes.find((node) => node.id === menu.id)?.selected && selectedNodeCount > 1
                                    ? `Duplicate ${selectedNodeCount} Selected Nodes`
                                    : "Duplicate Node"}
                                onDuplicate={menu.kind === "node" ? () => {
                                    try {
                                        handleDuplicateFromMenu();
                                    } catch (error) {
                                        showNotice({
                                            message: error instanceof Error ? error.message : "The selection could not be duplicated.",
                                            tone: "error"
                                        });
                                    }
                                } : undefined}
                                onDelete={menu.kind === "node" ? handleDeleteNode : undefined}
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
            {notice && (
                <div className={`app-notice ${notice.tone ?? "success"}`} role="status" aria-live="polite">
                    <span>{notice.message}</span>
                    {notice.actionLabel && notice.onAction && (
                        <button type="button" onClick={notice.onAction}>{notice.actionLabel}</button>
                    )}
                    <button
                        type="button"
                        className="app-notice-close"
                        onClick={() => setNotice(null)}
                        aria-label="Dismiss notification"
                    >
                        ×
                    </button>
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
