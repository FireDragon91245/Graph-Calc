import { useCallback, useMemo, useState, DragEvent, MouseEvent as ReactMouseEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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
    useUpdateNodeInternals,
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
import { authenticateUser, AuthUser, changePassword, deleteAccount, getMe, getProfileImage, logoutUser, registerUser, removeProfileImage, updateAccountSettings, uploadProfileImage } from "./api/auth";
import { getCurrentLanguage, setCurrentLanguage, supportedLanguages, type SupportedLanguage } from "./i18n";
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
import ModulesMode from "./components/modules/ModulesMode";
import ProjectSelector from "./components/ProjectSelector";
import GraphSelector from "./components/GraphSelector";
import AuthDialog, { AuthDialogMode } from "./components/AuthDialog";
import SettingsPage from "./components/SettingsPage";
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
import { propagateProjectDataToNodes } from "./domain/projectPropagation";

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
    const { t } = useTranslation();
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
    const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
    const [appView, setAppView] = useState<"workspace" | "settings">("workspace");
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
    const moduleDefinitions = useGraphStore((state) => state.moduleDefinitions);
    const moduleSystems = useGraphStore((state) => state.moduleSystems);
    const projectRevision = useGraphStore((state) => state.projectRevision);
    const loadStoreData = useGraphStore((state) => state.loadStoreData);
    const reactFlowInstance = useReactFlow();
    const updateNodeInternals = useUpdateNodeInternals();
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

    const applyAccountLanguage = useCallback(async (profile: AuthUser): Promise<AuthUser> => {
        const storedLanguage = profile.settings?.language;
        if (storedLanguage && supportedLanguages.includes(storedLanguage as SupportedLanguage)) {
            await setCurrentLanguage(storedLanguage as SupportedLanguage);
            return profile;
        }

        const language = getCurrentLanguage();
        try {
            const settings = await updateAccountSettings({ language });
            return { ...profile, settings };
        } catch (error) {
            console.error("Failed to initialize account settings:", error);
            return profile;
        }
    }, []);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), notice.onAction ? 8000 : 3500);
        return () => window.clearTimeout(timer);
    }, [notice]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        setProfileImageUrl(null);

        if (!authUser?.profileImageId) {
            return () => { cancelled = true; };
        }

        void getProfileImage()
            .then((blob) => {
                if (!blob || cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setProfileImageUrl(objectUrl);
            })
            .catch((error) => {
                console.error("Failed to load profile image:", error);
                if (!cancelled) showNotice({ message: error instanceof Error ? error.message : t("settings.account.image.loadFailed"), tone: "error" });
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [authUser?.id, authUser?.profileImageId, showNotice, t]);

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
                    const profile = await applyAccountLanguage(await getMe());
                    if (!ignore) {
                        setPersistenceMode("remote");
                        setAuthUser(profile);
                    }
                }
            } catch (error) {
                if (error instanceof Error && error.message === "errors.unauthorized") {
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
    }, [applyAccountLanguage]);

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
                const graphData = await loadGraph(pid, getRequiredValue(gid ?? null, t("ui.quickActions.errors.noGraph")));
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
            const projectId = getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject"));
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

    // Project definitions are live references. Re-materialize every production node whenever
    // recipes, items, tags, modules, or upgrade systems change instead of leaving stale copies
    // embedded in graph data.
    useEffect(() => {
        if (!isLoaded) return;
        const result = propagateProjectDataToNodes(nodes, {
            items,
            tags,
            recipes,
            recipeTags,
            moduleDefinitions,
            moduleSystems,
            projectRevision
        }, edges);
        if (result.changedNodeIds.length > 0) {
            setNodes(result.nodes);
            setSolveResult(null);
            setSolveError(null);
            window.setTimeout(() => result.changedNodeIds.forEach((nodeId) => updateNodeInternals(nodeId)), 0);
        }
    }, [isLoaded, nodes, edges, items, tags, recipes, recipeTags, moduleDefinitions, moduleSystems, projectRevision, setNodes, updateNodeInternals]);

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
                            inputs: [{ id: "i1", name: t("ui.nodes.mixedInput"), amountPerCycle: 1, isMixed: true }],
                            outputs: [{ id: "o1", name: t("ui.nodes.mixedOutput"), amountPerCycle: 1, isMixed: true }]
                        };
                    }

                    const recipeData = recipeIds
                        .map((id) => recipes.find((r) => r.id === id))
                        .filter((r): r is NonNullable<typeof r> => r !== undefined);

                    if (recipeData.length === 0) {
                        return {
                            inputs: [{ id: "i1", name: t("ui.nodes.mixedInput"), amountPerCycle: 1, isMixed: true }],
                            outputs: [{ id: "o1", name: t("ui.nodes.mixedOutput"), amountPerCycle: 1, isMixed: true }]
                        };
                    }

                    const inputCounts = recipeData.map((r) => r.inputs.length);
                    const outputCounts = recipeData.map((r) => r.outputs.length);
                    const sameInputCount = inputCounts.every((c) => c === inputCounts[0]);
                    const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

                    if (!sameInputCount || !sameOutputCount) {
                        return {
                            inputs: [{ id: "i1", name: t("ui.nodes.mixedInput"), amountPerCycle: 1, isMixed: true }],
                            outputs: [{ id: "o1", name: t("ui.nodes.mixedOutput"), amountPerCycle: 1, isMixed: true }]
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
                            name = `${t("ui.nodes.mixedInput")} ${i + 1}`;
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
                            name = `${t("ui.nodes.mixedOutput")} ${i + 1}`;
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
                        return [{ id: "o1", name: t("ui.nodes.mixedOutput"), amountPerCycle: 1, isMixed: true }];
                    }

                    const recipeData = recipeIds
                        .map((id) => recipes.find((r) => r.id === id))
                        .filter((r): r is NonNullable<typeof r> => r !== undefined);

                    if (recipeData.length === 0) {
                        return [{ id: "o1", name: t("ui.nodes.mixedOutput"), amountPerCycle: 1, isMixed: true }];
                    }

                    const outputCounts = recipeData.map((r) => r.outputs.length);
                    const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

                    if (!sameOutputCount) {
                        return [{ id: "o1", name: t("ui.nodes.mixedOutput"), amountPerCycle: 1, isMixed: true }];
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
                            name = `${t("ui.nodes.mixedOutput")} ${i + 1}`;
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
                    getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject")),
                    getRequiredValue(activeGraphId, t("ui.quickActions.errors.noGraph"))
                )
                : await solveGuestGraph({
                    graph: buildGraphData(),
                    storeData: {
                        schemaVersion: 6,
                        projectRevision,
                        categories,
                        items,
                        tags,
                        recipeTags,
                        recipes,
                        recipeBlueprints: [],
                        moduleDefinitions,
                        moduleSystems,
                    }
                });
            console.log("Solve result:", result);
            setSolveResult(result);
        } catch (error) {
            setSolveError(error instanceof Error ? error.message : t("ui.quickActions.errors.solve"));
        } finally {
            setIsSolving(false);
        }
    }, [activeGraphId, activeProjectId, authUser, buildGraphData, categories, items, recipeTags, recipes, setNodes, setEdges, tags, projectRevision, moduleDefinitions, moduleSystems]);

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
        const projectId = getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject"));
        const graphId = getRequiredValue(activeGraphId, t("ui.quickActions.errors.noGraph"));
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
            showNotice({
                message: systemClipboardAvailable
                    ? t("ui.quickActions.notice.copied", { count: payload.nodes.length })
                    : t("ui.quickActions.notice.copiedSession", { count: payload.nodes.length }),
                tone: "success"
            });
        }
    }, [activeGraphId, activeProjectId, reactFlowInstance, showNotice, t]);

    const handleCutNodes = useCallback(async (nodeIds?: Iterable<string>) => {
        const currentNodes = reactFlowInstance.getNodes();
        const ids = new Set(nodeIds ?? currentNodes.filter((node) => node.selected).map((node) => node.id));
        if (ids.size === 0) {
            throw new Error(t("ui.quickActions.errors.cutSelection"));
        }

        await handleCopyNodes(ids, { silent: true });
        setSolveResult(null);
        setSolveError(null);
        setNodes((current) => current.filter((node) => !ids.has(node.id)));
        setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
        setMenu(null);

        showNotice({
            message: t("ui.quickActions.notice.cut", { count: ids.size }),
            tone: "success"
        });
    }, [handleCopyNodes, reactFlowInstance, setEdges, setNodes, showNotice, t]);

    const handleDuplicateSelectedNodes = useCallback((nodeIds?: Iterable<string>) => {
        const projectId = getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject"));
        const graphId = getRequiredValue(activeGraphId, t("ui.quickActions.errors.noGraph"));
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
            message: t("ui.quickActions.notice.duplicated", { count: duplicated.nodes.length }),
            tone: "success"
        });
    }, [activeGraphId, activeProjectId, insertGraphSelection, reactFlowInstance, showNotice, t]);

    const handlePasteNodes = useCallback(async (position?: XYPosition) => {
        const projectId = getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject"));
        getRequiredValue(activeGraphId, t("ui.quickActions.errors.noGraph"));
        const clipboard = await readTextFromClipboard();
        if (!clipboard.text) {
            throw new Error(t("ui.quickActions.errors.emptyClipboard"));
        }

        const payload = parseGraphClipboardPayload(clipboard.text);
        if (!payload) {
            throw new Error(t("ui.quickActions.errors.invalidClipboard"));
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

        showNotice({
            message: t("ui.quickActions.notice.pasted", {
                nodes: pasted.nodes.length,
                nodeLabel: t(pasted.nodes.length === 1 ? "ui.quickActions.notice.node" : "ui.quickActions.notice.nodes"),
                edges: pasted.edges.length,
                edgeLabel: t(pasted.edges.length === 1 ? "ui.quickActions.notice.edge" : "ui.quickActions.notice.edges")
            }),
            tone: "success"
        });
    }, [activeGraphId, activeProjectId, getCanvasCenterPosition, insertGraphSelection, reactFlowInstance, showNotice, t]);

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
                    message: error instanceof Error ? error.message : t("ui.quickActions.notice.copyFailed"),
                    tone: "error"
                }));
            } else if (key === "x" && selectedNodeCount > 0) {
                event.preventDefault();
                void handleCutNodes().catch((error) => showNotice({
                    message: error instanceof Error ? error.message : t("ui.quickActions.notice.cutFailed"),
                    tone: "error"
                }));
            } else if (key === "d" && selectedNodeCount > 0) {
                event.preventDefault();
                try {
                    handleDuplicateSelectedNodes();
                } catch (error) {
                    showNotice({
                        message: error instanceof Error ? error.message : t("ui.quickActions.notice.duplicateFailed"),
                        tone: "error"
                    });
                }
            } else if (key === "v") {
                event.preventDefault();
                void handlePasteNodes().catch((error) => showNotice({
                    message: error instanceof Error ? error.message : t("ui.quickActions.notice.pasteFailed"),
                    tone: "error"
                }));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeGraphId, activeProjectId, appMode, handleCopyNodes, handleCutNodes, handleDuplicateSelectedNodes, handlePasteNodes, selectedNodeCount, showNotice, t]);

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
            showNotice({ message: t("ui.quickActions.notice.mixedAdded"), tone: "success" });
            return;
        }

        setPendingNodeType(nodeType);
        setPendingNodePosition(position);
    }, [getCanvasCenterPosition, setNodes, showNotice, t]);

    const handleApplyLayout = useCallback(async (preset: GraphLayoutPreset) => {
        if (nodes.length < 2) {
            throw new Error(t("ui.quickActions.errors.twoNodes"));
        }

        const previousPositions = new Map(nodes.map((node) => [node.id, node.position]));
        const layoutedNodes = await layoutGraph(nodes, edges, preset);
        setNodes(layoutedNodes);
        window.requestAnimationFrame(() => {
            reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
        });

        showNotice({
            message: t("ui.quickActions.notice.layoutApplied"),
            tone: "success",
            actionLabel: t("ui.quickActions.notice.undo"),
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
    }, [edges, nodes, reactFlowInstance, setNodes, showNotice, t]);

    const handleDuplicateGraph = useCallback(async () => {
        const projectId = getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject"));
        const graphId = getRequiredValue(activeGraphId, t("ui.quickActions.errors.noGraph"));
        await flushPendingGraphSave();

        const response = await listGraphs(projectId);
        const sourceGraph = response.graphs.find((graph) => graph.id === graphId);
        if (!sourceGraph) throw new Error(t("ui.quickActions.errors.graphMissing"));

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
        showNotice({ message: t("ui.quickActions.notice.graphDuplicated", { name: copyName }), tone: "success" });
    }, [activeGraphId, activeProjectId, flushPendingGraphSave, handleGraphChange, showNotice, t]);

    const handleCopyGraphJson = useCallback(async () => {
        if (!activeGraphId) throw new Error(t("ui.quickActions.errors.noGraph"));
        await copyTextToClipboard(toPrettyJson(buildGraphData()));
        showNotice({ message: t("ui.quickActions.notice.graphCopied"), tone: "success" });
    }, [activeGraphId, buildGraphData, showNotice, t]);

    const handleCopyProjectJson = useCallback(async () => {
        const projectId = getRequiredValue(activeProjectId, t("ui.quickActions.errors.noProject"));
        await Promise.all([flushPendingGraphSave(), flushPendingStoreSave()]);
        const project = await getProjectSnapshot(projectId);
        await copyTextToClipboard(toPrettyJson({ schemaVersion: 1, project }));
        showNotice({ message: t("ui.quickActions.notice.projectCopied"), tone: "success" });
    }, [activeProjectId, flushPendingGraphSave, showNotice, t]);

    const handleCopySolveResultJson = useCallback(async () => {
        if (!solveResult) throw new Error(t("ui.quickActions.errors.solveFirst"));
        await copyTextToClipboard(toPrettyJson(solveResult));
        showNotice({ message: t("ui.quickActions.notice.solveCopied"), tone: "success" });
    }, [showNotice, solveResult, t]);

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
                throw new Error(t("ui.quickActions.errors.unknown"));
        }
    }, [handleApplyLayout, handleCopyGraphJson, handleCopyNodes, handleCopyProjectJson, handleCopySolveResultJson, handleCutNodes, handleDuplicateGraph, handleDuplicateSelectedNodes, handlePasteNodes, handleQuickAddNode, handleSolve, reactFlowInstance]);

    const handleLogin = useCallback(async (username: string, password: string) => {
        await authenticateUser(username, password);
        await flushPendingGraphSave();
        await flushPendingStoreSave();

        try {
            const [profile, localSnapshot, remoteSnapshot] = await Promise.all([
                getMe().then(applyAccountLanguage),
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
    }, [applyAccountLanguage, finalizeAuthenticatedSession, flushPendingGraphSave, rollbackPendingLogin]);

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
            setMergeDialogError(error instanceof Error ? error.message : t("ui.quickActions.errors.merge"));
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
            const profile = await applyAccountLanguage(await getMe());
            finalizeAuthenticatedSession(profile);
        } catch (error) {
            setPersistenceMode("local");
            await logoutUser().catch((logoutError) => {
                console.error("Failed to roll back session after sync error:", logoutError);
            });
            throw error;
        }

        setIsAuthDialogOpen(false);
    }, [applyAccountLanguage, finalizeAuthenticatedSession, flushPendingGraphSave]);

    const handlePasswordChange = useCallback(async (currentPassword: string, newPassword: string) => {
        const profile = await changePassword(currentPassword, newPassword);
        setAuthUser(profile);
    }, []);

    const handleLanguageChange = useCallback(async (language: SupportedLanguage) => {
        if (authUser) {
            const settings = await updateAccountSettings({ language });
            setAuthUser((current) => current ? { ...current, settings } : current);
        }
        await setCurrentLanguage(language);
    }, [authUser]);

    const handleProfileImageUpload = useCallback(async (file: File) => {
        const profileImageId = await uploadProfileImage(file);
        setAuthUser((current) => current ? { ...current, profileImageId } : current);
    }, []);

    const handleProfileImageDelete = useCallback(async () => {
        await removeProfileImage();
        setAuthUser((current) => current ? { ...current, profileImageId: null } : current);
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
                    label: t("ui.quickActions.addInput.label"),
                    description: t("ui.quickActions.addInput.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "📥",
                    keywords: ["source", "item"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.output",
                    label: t("ui.quickActions.addOutput.label"),
                    description: t("ui.quickActions.addOutput.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "📤",
                    keywords: ["target", "item"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.requester",
                    label: t("ui.quickActions.addRequester.label"),
                    description: t("ui.quickActions.addRequester.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "🎯",
                    keywords: ["demand", "target"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.recipe",
                    label: t("ui.quickActions.addRecipe.label"),
                    description: t("ui.quickActions.addRecipe.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "⚙️",
                    keywords: ["production", "machine"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.input-recipe",
                    label: t("ui.quickActions.addInputRecipe.label"),
                    description: t("ui.quickActions.addInputRecipe.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "⚡",
                    keywords: ["source", "recipe"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.recipe-tag",
                    label: t("ui.quickActions.addRecipeTag.label"),
                    description: t("ui.quickActions.addRecipeTag.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "🏷️",
                    keywords: ["group", "pattern"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.input-recipe-tag",
                    label: t("ui.quickActions.addInputRecipeTag.label"),
                    description: t("ui.quickActions.addInputRecipeTag.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "🔖",
                    keywords: ["source", "group", "pattern"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "node.add.mixed-output",
                    label: t("ui.quickActions.addMixed.label"),
                    description: t("ui.quickActions.addMixed.description"),
                    group: t("ui.quickActions.groups.add"),
                    icon: "🎲",
                    keywords: ["output", "mixed"],
                    disabled: !hasActiveGraph,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
                },
                {
                    id: "graph.rearrange",
                    label: t("ui.quickActions.rearrange.label"),
                    description: t("ui.quickActions.rearrange.description"),
                    group: t("ui.quickActions.groups.graph"),
                    icon: "✨",
                    keywords: ["layout", "organize", "arrange"],
                    disabled: nodes.length < 2,
                    disabledReason: nodes.length < 2 ? t("ui.quickActions.disabled.twoNodes") : undefined,
                    children: [
                        {
                            id: "layout.production",
                            label: t("ui.quickActions.production.label"),
                            description: t("ui.quickActions.production.description"),
                            group: t("ui.quickActions.groups.layout"),
                            icon: "→",
                            keywords: ["layered", "horizontal", "default"]
                        },
                        {
                            id: "layout.compact",
                            label: t("ui.quickActions.compact.label"),
                            description: t("ui.quickActions.compact.description"),
                            group: t("ui.quickActions.groups.layout"),
                            icon: "⇥",
                            keywords: ["layered", "dense", "tight"]
                        },
                        {
                            id: "layout.cascade",
                            label: t("ui.quickActions.cascade.label"),
                            description: t("ui.quickActions.cascade.description"),
                            group: t("ui.quickActions.groups.layout"),
                            icon: "⇘",
                            keywords: ["cascade", "staggered", "branches", "flow"]
                        },
                        {
                            id: "layout.tree",
                            label: t("ui.quickActions.tree.label"),
                            description: t("ui.quickActions.tree.description"),
                            group: t("ui.quickActions.groups.layout"),
                            icon: "⑂",
                            keywords: ["tree", "branch", "parent", "hierarchy"]
                        },
                        {
                            id: "layout.hierarchical",
                            label: t("ui.quickActions.hierarchical.label"),
                            description: t("ui.quickActions.hierarchical.description"),
                            group: t("ui.quickActions.groups.layout"),
                            icon: "≡→",
                            keywords: ["layered", "sugiyama", "hierarchy", "flow"]
                        }
                    ]
                },
                {
                    id: "graph.solve",
                    label: t("ui.quickActions.solve.label"),
                    description: isSolving ? t("ui.quickActions.solve.running") : t("ui.quickActions.solve.description"),
                    group: t("ui.quickActions.groups.graph"),
                    icon: "▶",
                    keywords: ["calculate", "result"],
                    disabled: !hasActiveGraph || isSolving,
                    disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : isSolving ? t("ui.quickActions.disabled.solving") : undefined
                },
                {
                    id: "graph.fit-view",
                    label: t("ui.quickActions.fit.label"),
                    description: t("ui.quickActions.fit.description"),
                    group: t("ui.quickActions.groups.graph"),
                    icon: "⊡",
                    keywords: ["center", "zoom"],
                    disabled: nodes.length === 0,
                    disabledReason: nodes.length === 0 ? t("ui.quickActions.disabled.emptyGraph") : undefined
                }
            );
        }

        actions.push(
            {
                id: "graph.duplicate",
                label: t("ui.quickActions.duplicateGraph.label"),
                description: t("ui.quickActions.duplicateGraph.description"),
                group: t("ui.quickActions.groups.graph"),
                icon: "▣",
                keywords: ["copy", "clone"],
                disabled: !hasActiveGraph,
                disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
            },
            {
                id: "clipboard.nodes.copy",
                label: t("ui.quickActions.copyNodes.label"),
                description: t("ui.quickActions.copyNodes.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "⧉",
                keywords: ["copy", "selection", "nodes", "ctrl c", "command c"],
                disabled: appMode !== "edit" || selectedNodeCount === 0,
                disabledReason: appMode !== "edit"
                    ? t("ui.quickActions.disabled.editGraph")
                    : selectedNodeCount === 0 ? t("ui.quickActions.disabled.selectNodes") : undefined
            },
            {
                id: "clipboard.nodes.paste",
                label: t("ui.quickActions.pasteNodes.label"),
                description: t("ui.quickActions.pasteNodes.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "▣",
                keywords: ["paste", "selection", "nodes", "ctrl v", "command v"],
                disabled: appMode !== "edit" || !hasActiveGraph,
                disabledReason: appMode !== "edit"
                    ? t("ui.quickActions.disabled.editGraph")
                    : !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
            },
            {
                id: "clipboard.nodes.cut",
                label: t("ui.quickActions.cutNodes.label"),
                description: t("ui.quickActions.cutNodes.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "✂",
                keywords: ["cut", "selection", "nodes", "ctrl x", "command x"],
                disabled: appMode !== "edit" || selectedNodeCount === 0,
                disabledReason: appMode !== "edit"
                    ? t("ui.quickActions.disabled.editGraph")
                    : selectedNodeCount === 0 ? t("ui.quickActions.disabled.selectNodes") : undefined
            },
            {
                id: "clipboard.nodes.duplicate",
                label: t("ui.quickActions.duplicateNodes.label"),
                description: t("ui.quickActions.duplicateNodes.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "⧉",
                keywords: ["duplicate", "clone", "selection", "nodes", "ctrl d", "command d"],
                disabled: appMode !== "edit" || selectedNodeCount === 0,
                disabledReason: appMode !== "edit"
                    ? t("ui.quickActions.disabled.editGraph")
                    : selectedNodeCount === 0 ? t("ui.quickActions.disabled.selectNodes") : undefined
            },
            {
                id: "clipboard.graph",
                label: t("ui.quickActions.copyGraph.label"),
                description: t("ui.quickActions.copyGraph.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "{}",
                keywords: ["export", "nodes", "edges"],
                disabled: !hasActiveGraph,
                disabledReason: !hasActiveGraph ? t("ui.quickActions.disabled.selectGraph") : undefined
            },
            {
                id: "clipboard.project",
                label: t("ui.quickActions.copyProject.label"),
                description: t("ui.quickActions.copyProject.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "📦",
                keywords: ["export", "store", "workspace"],
                disabled: !activeProjectId,
                disabledReason: !activeProjectId ? t("ui.quickActions.disabled.selectProject") : undefined
            },
            {
                id: "clipboard.solve-result",
                label: t("ui.quickActions.copySolve.label"),
                description: t("ui.quickActions.copySolve.description"),
                group: t("ui.quickActions.groups.clipboard"),
                icon: "✓",
                keywords: ["export", "flows", "result"],
                disabled: !solveResult,
                disabledReason: !solveResult ? t("ui.quickActions.disabled.solveFirst") : undefined
            }
        );

        return actions;
    }, [activeProjectId, appMode, hasActiveGraph, isSolving, nodes.length, selectedNodeCount, solveResult]);

    return (
        <div className="app-root">
            <div className="top-bar">
                <div className="top-bar-main">
                    <div className="top-bar-main-left">
                        <div className="brand">{t("app.brand")}</div>
                        {!isAuthChecking && appView === "workspace" && (
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
                    {appView === "workspace" && <button
                        type="button"
                        className="quick-actions-trigger"
                        onClick={() => setIsCommandPaletteOpen(true)}
                    >
                        <span className="quick-actions-trigger-icon" aria-hidden="true">⌕</span>
                        <span className="quick-actions-trigger-label">{t("ui.nav.quickActions")}</span>
                        <kbd>{navigator.platform.includes("Mac") ? "⌘I" : "Ctrl+I"}</kbd>
                    </button>}
                    <div className="top-bar-actions">
                        {appView === "workspace" && appMode === "edit" && (
                            <button className="primary" onClick={handleSolve} disabled={isSolving}>
                                {isSolving ? t("ui.nav.solving") : t("ui.nav.solve")}
                            </button>
                        )}
                        <button
                            className="auth-secondary auth-button"
                            onClick={() => setAppView("settings")}
                            disabled={isAuthChecking}
                            title={t("settings.open")}
                        >
                            {isAuthChecking ? t("common.state.checking") : (
                                <>
                                    <span className={`top-bar-account-avatar ${authUser ? "authenticated" : "guest"}`} aria-hidden="true">
                                        {authUser && profileImageUrl
                                            ? <img src={profileImageUrl} alt="" />
                                            : authUser?.username.slice(0, 1).toLocaleUpperCase() ?? "⚙"}
                                    </span>
                                    <span>{authUser?.username ?? t("settings.title")}</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
                {appView === "workspace" && appMode === "config" && (
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
                onClose={() => setIsAuthDialogOpen(false)}
                onLogin={handleLogin}
                onRegister={handleRegister}
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

            {appView === "settings" ? (
                <SettingsPage
                    currentUser={authUser}
                    profileImageUrl={profileImageUrl}
                    onBack={() => setAppView("workspace")}
                    onOpenAuth={openAuthDialog}
                    onPasswordChange={handlePasswordChange}
                    onDeleteAccount={handleDeleteAccount}
                    onLogout={handleLogout}
                    onProfileImageUpload={handleProfileImageUpload}
                    onProfileImageDelete={handleProfileImageDelete}
                    onLanguageChange={handleLanguageChange}
                />
            ) : appMode === "edit" ? (
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
                            <div className="panel-title">{t("ui.stats.title")}</div>
                            <div className="panel-row">{t("ui.stats.nodes", { count: nodes.length })}</div>
                            <div className="panel-row">{t("ui.stats.edges", { count: edges.length })}</div>
                            {solveResult && solveResult.status === "error" && (
                                <div className="panel-error" style={{ marginTop: 8 }}>
                                    {t("ui.stats.solveFailed")}
                                </div>
                            )}
                            {solveResult && solveResult.status === "ok" && (
                                <div className="panel-row" style={{ color: "#10b981", marginTop: 4 }}>
                                    {t("ui.stats.solved", { count: Object.keys(solveResult.machineCounts).length })}
                                </div>
                            )}
                            {solveError && <div className="panel-error">{solveError}</div>}
                            {solveResult && solveResult.warnings && solveResult.warnings.length > 0 && (
                                <div className="solve-warnings" style={{ marginTop: 8 }}>
                                    <div className="panel-subtitle" style={{ color: "#f59e0b" }}>
                                        {t("solver.warningsTitle", { count: solveResult.warnings.length })}
                                    </div>
                                    {solveResult.warnings.map((warning, i) => (
                                        <div key={i} className="solve-warning-item">
                                            {t(warning.code, warning.args)}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {solveResult && solveResult.problemEdgeIds && solveResult.problemEdgeIds.length > 0 && (
                                <div style={{ marginTop: 4 }}>
                                    <div className="panel-muted">
                                        {t("ui.stats.problemEdges", { count: solveResult.problemEdgeIds.length })}
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
                                    ? t("ui.context.copyNodes", { count: selectedNodeCount })
                                    : t("ui.context.copyNode")}
                                onCopy={menu.kind === "node" ? () => {
                                    void handleCopyFromMenu().catch((error) => showNotice({
                                        message: error instanceof Error ? error.message : t("ui.quickActions.notice.copyFailed"),
                                        tone: "error"
                                    }));
                                } : undefined}
                                cutLabel={menu.kind === "node" && menu.id && nodes.find((node) => node.id === menu.id)?.selected && selectedNodeCount > 1
                                    ? t("ui.context.cutNodes", { count: selectedNodeCount })
                                    : t("ui.context.cutNode")}
                                onCut={menu.kind === "node" ? () => {
                                    void handleCutFromMenu().catch((error) => showNotice({
                                        message: error instanceof Error ? error.message : t("ui.quickActions.notice.cutFailed"),
                                        tone: "error"
                                    }));
                                } : undefined}
                                onPaste={() => {
                                    void handlePasteFromMenu().catch((error) => showNotice({
                                        message: error instanceof Error ? error.message : t("ui.quickActions.notice.pasteFailed"),
                                        tone: "error"
                                    }));
                                }}
                                duplicateLabel={menu.kind === "node" && menu.id && nodes.find((node) => node.id === menu.id)?.selected && selectedNodeCount > 1
                                    ? t("ui.context.duplicateNodes", { count: selectedNodeCount })
                                    : t("ui.context.duplicateNode")}
                                onDuplicate={menu.kind === "node" ? () => {
                                    try {
                                        handleDuplicateFromMenu();
                                    } catch (error) {
                                        showNotice({
                                            message: error instanceof Error ? error.message : t("ui.quickActions.notice.duplicateFailed"),
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
                    {configSubMode === "modules" && <ModulesMode />}
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
                        aria-label={t("common.actions.close")}
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
