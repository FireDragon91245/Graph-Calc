import { apiFetch, getErrorMessage } from "./client";

export interface GraphData {
  nodes: any[];
  edges: any[];
}

export interface Category {
  id: string;
  name: string;
}

export interface Item {
  id: string;
  name: string;
  categoryId?: string;
}

export interface Tag {
  id: string;
  name: string;
  memberItemIds: string[];
}

export interface RecipeTag {
  id: string;
  name: string;
  memberRecipeIds: string[];
}

export interface RecipeInput {
  id: string;
  refType: "item" | "tag";
  refId: string;
  amount: number;
}

export interface RecipeOutput {
  id: string;
  itemId: string;
  amount: number;
  probability: number;
}

export interface Recipe {
  id: string;
  name: string;
  timeSeconds: number;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
}

export interface StoreData {
  categories: Category[];
  items: Item[];
  tags: Tag[];
  recipeTags: RecipeTag[];
  recipes: Recipe[];
}

// ── Project types ──────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
}

export interface ProjectsResponse {
  projects: Project[];
  activeProjectId: string | null;
}

// ── Graph types ────────────────────────────────────────────────

export interface GraphInfo {
  id: string;
  name: string;
}

export interface GraphsResponse {
  graphs: GraphInfo[];
  activeGraphId: string | null;
}

export interface WorkspaceGraphSnapshot {
  name: string;
  data: GraphData;
}

export interface WorkspaceProjectSnapshot {
  name: string;
  activeGraphName: string | null;
  store: StoreData;
  graphs: WorkspaceGraphSnapshot[];
}

export interface WorkspaceSnapshot {
  activeProjectName: string | null;
  projects: WorkspaceProjectSnapshot[];
}

export type PersistenceMode = "local" | "remote";

type LocalGraphRecord = {
  id: string;
  name: string;
  data: GraphData;
};

type LocalProjectRecord = {
  id: string;
  name: string;
  activeGraphId: string | null;
  store: StoreData;
  graphs: LocalGraphRecord[];
};

type LocalWorkspaceRecord = {
  version: number;
  activeProjectId: string | null;
  projects: LocalProjectRecord[];
};

const LOCAL_WORKSPACE_STORAGE_KEY = "graphcalc.local-workspace.v1";
const LOCAL_WORKSPACE_VERSION = 1;
const DEFAULT_LOCAL_PROJECT_NAME = "Guest Project";
const DEFAULT_LOCAL_GRAPH_NAME = "Main Graph";

let persistenceMode: PersistenceMode = "local";
let localWorkspaceFallback: LocalWorkspaceRecord | null = null;

const cloneData = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createEmptyStoreData(): StoreData {
  return {
    categories: [],
    items: [],
    tags: [],
    recipeTags: [],
    recipes: []
  };
}

function createEmptyGraphData(): GraphData {
  return {
    nodes: [],
    edges: []
  };
}

function createLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultLocalGraph(name = DEFAULT_LOCAL_GRAPH_NAME): LocalGraphRecord {
  return {
    id: createLocalId("graph"),
    name,
    data: createEmptyGraphData()
  };
}

function createDefaultLocalProject(name = DEFAULT_LOCAL_PROJECT_NAME): LocalProjectRecord {
  const graph = createDefaultLocalGraph();
  return {
    id: createLocalId("project"),
    name,
    activeGraphId: graph.id,
    store: createEmptyStoreData(),
    graphs: [graph]
  };
}

function createDefaultLocalWorkspace(): LocalWorkspaceRecord {
  const project = createDefaultLocalProject();
  return {
    version: LOCAL_WORKSPACE_VERSION,
    activeProjectId: project.id,
    projects: [project]
  };
}

function normalizeStoreData(value: unknown): StoreData {
  const candidate = value as Partial<StoreData> | null | undefined;
  return {
    categories: Array.isArray(candidate?.categories) ? cloneData(candidate.categories) : [],
    items: Array.isArray(candidate?.items) ? cloneData(candidate.items) : [],
    tags: Array.isArray(candidate?.tags) ? cloneData(candidate.tags) : [],
    recipeTags: Array.isArray(candidate?.recipeTags) ? cloneData(candidate.recipeTags) : [],
    recipes: Array.isArray(candidate?.recipes) ? cloneData(candidate.recipes) : []
  };
}

function normalizeGraphData(value: unknown): GraphData {
  const candidate = value as Partial<GraphData> | null | undefined;
  return {
    nodes: Array.isArray(candidate?.nodes) ? cloneData(candidate.nodes) : [],
    edges: Array.isArray(candidate?.edges) ? cloneData(candidate.edges) : []
  };
}

function normalizeLocalGraph(value: unknown): LocalGraphRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LocalGraphRecord>;
  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : createLocalId("graph"),
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : DEFAULT_LOCAL_GRAPH_NAME,
    data: normalizeGraphData(candidate.data)
  };
}

function normalizeLocalProject(value: unknown): LocalProjectRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LocalProjectRecord>;
  const graphs = Array.isArray(candidate.graphs)
    ? candidate.graphs.map(normalizeLocalGraph).filter((graph): graph is LocalGraphRecord => graph !== null)
    : [];
  const ensuredGraphs = graphs.length > 0 ? graphs : [createDefaultLocalGraph()];
  const activeGraphId = typeof candidate.activeGraphId === "string" && ensuredGraphs.some((graph) => graph.id === candidate.activeGraphId)
    ? candidate.activeGraphId
    : ensuredGraphs[0].id;

  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : createLocalId("project"),
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : DEFAULT_LOCAL_PROJECT_NAME,
    activeGraphId,
    store: normalizeStoreData(candidate.store),
    graphs: ensuredGraphs
  };
}

function loadRawLocalWorkspace(): string | null {
  try {
    return window.localStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY);
  } catch {
    return localWorkspaceFallback ? JSON.stringify(localWorkspaceFallback) : null;
  }
}

function saveRawLocalWorkspace(serialized: string, workspace: LocalWorkspaceRecord): void {
  localWorkspaceFallback = cloneData(workspace);

  try {
    window.localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, serialized);
  } catch (error) {
    console.error("Failed to persist local workspace:", error);
  }
}

function writeLocalWorkspace(workspace: LocalWorkspaceRecord): LocalWorkspaceRecord {
  const normalizedProjects = workspace.projects.length > 0 ? workspace.projects : [createDefaultLocalProject()];
  const activeProjectId = normalizedProjects.some((project) => project.id === workspace.activeProjectId)
    ? workspace.activeProjectId
    : normalizedProjects[0].id;
  const normalizedWorkspace: LocalWorkspaceRecord = {
    version: LOCAL_WORKSPACE_VERSION,
    activeProjectId,
    projects: normalizedProjects
  };

  saveRawLocalWorkspace(JSON.stringify(normalizedWorkspace), normalizedWorkspace);
  return cloneData(normalizedWorkspace);
}

function readLocalWorkspace(): LocalWorkspaceRecord {
  try {
    const raw = loadRawLocalWorkspace();
    if (!raw) {
      return writeLocalWorkspace(createDefaultLocalWorkspace());
    }

    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceRecord>;
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.map(normalizeLocalProject).filter((project): project is LocalProjectRecord => project !== null)
      : [];

    return writeLocalWorkspace({
      version: LOCAL_WORKSPACE_VERSION,
      activeProjectId: typeof parsed.activeProjectId === "string" ? parsed.activeProjectId : null,
      projects
    });
  } catch (error) {
    console.error("Failed to load local workspace:", error);
    return writeLocalWorkspace(createDefaultLocalWorkspace());
  }
}

function updateLocalWorkspace<T>(mutator: (workspace: LocalWorkspaceRecord) => T): T {
  const workspace = readLocalWorkspace();
  const result = mutator(workspace);
  writeLocalWorkspace(workspace);
  return result;
}

function getLocalProjectOrThrow(workspace: LocalWorkspaceRecord, projectId: string): LocalProjectRecord {
  const project = workspace.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

function getLocalGraphOrThrow(project: LocalProjectRecord, graphId: string): LocalGraphRecord {
  const graph = project.graphs.find((entry) => entry.id === graphId);
  if (!graph) {
    throw new Error("Graph not found");
  }

  return graph;
}

function isStoreDataEmpty(store: StoreData): boolean {
  return store.categories.length === 0
    && store.items.length === 0
    && store.tags.length === 0
    && store.recipeTags.length === 0
    && store.recipes.length === 0;
}

function isGraphDataEmpty(graph: GraphData): boolean {
  return graph.nodes.length === 0 && graph.edges.length === 0;
}

function normalizeSnapshotGraphData(graph: GraphData): GraphData {
  return {
    nodes: cloneData(graph.nodes).sort((left, right) => `${left?.id ?? ""}`.localeCompare(`${right?.id ?? ""}`)),
    edges: cloneData(graph.edges).sort((left, right) => `${left?.id ?? ""}`.localeCompare(`${right?.id ?? ""}`))
  };
}

function normalizeSnapshotStoreData(store: StoreData): StoreData {
  return {
    categories: cloneData(store.categories).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    items: cloneData(store.items).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    tags: cloneData(store.tags).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    recipeTags: cloneData(store.recipeTags).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    recipes: cloneData(store.recipes).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name))
  };
}

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const projects = cloneData(snapshot.projects)
    .map((project) => ({
      name: project.name,
      activeGraphName: project.activeGraphName,
      store: normalizeSnapshotStoreData(project.store),
      graphs: cloneData(project.graphs)
        .map((graph) => ({
          name: graph.name,
          data: normalizeSnapshotGraphData(graph.data)
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    activeProjectName: snapshot.activeProjectName,
    projects
  };
}

function workspaceToSnapshot(workspace: LocalWorkspaceRecord): WorkspaceSnapshot {
  const activeProject = workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? workspace.projects[0] ?? null;

  return {
    activeProjectName: activeProject?.name ?? null,
    projects: workspace.projects.map((project) => {
      const activeGraph = project.graphs.find((graph) => graph.id === project.activeGraphId) ?? project.graphs[0] ?? null;
      return {
        name: project.name,
        activeGraphName: activeGraph?.name ?? null,
        store: normalizeStoreData(project.store),
        graphs: project.graphs.map((graph) => ({
          name: graph.name,
          data: normalizeGraphData(graph.data)
        }))
      };
    })
  };
}

function snapshotToWorkspace(snapshot: WorkspaceSnapshot): LocalWorkspaceRecord {
  const projects = snapshot.projects.map((project) => {
    const graphs = (project.graphs.length > 0 ? project.graphs : [{ name: DEFAULT_LOCAL_GRAPH_NAME, data: createEmptyGraphData() }])
      .map((graph) => ({
        id: createLocalId("graph"),
        name: graph.name,
        data: normalizeGraphData(graph.data)
      }));
    const activeGraph = graphs.find((graph) => graph.name === project.activeGraphName) ?? graphs[0] ?? null;

    return {
      id: createLocalId("project"),
      name: project.name,
      activeGraphId: activeGraph?.id ?? null,
      store: normalizeStoreData(project.store),
      graphs
    };
  });
  const activeProject = projects.find((project) => project.name === snapshot.activeProjectName) ?? projects[0] ?? null;

  return {
    version: LOCAL_WORKSPACE_VERSION,
    activeProjectId: activeProject?.id ?? null,
    projects: projects.length > 0 ? projects : [createDefaultLocalProject()]
  };
}

function hasMeaningfulLocalWorkspace(workspace: LocalWorkspaceRecord): boolean {
  if (workspace.projects.length !== 1) {
    return true;
  }

  const [project] = workspace.projects;
  if (!project) {
    return false;
  }

  if (project.name !== DEFAULT_LOCAL_PROJECT_NAME) {
    return true;
  }

  if (project.graphs.length !== 1) {
    return true;
  }

  const [graph] = project.graphs;
  if (!graph) {
    return false;
  }

  return graph.name !== DEFAULT_LOCAL_GRAPH_NAME
    || !isStoreDataEmpty(project.store)
    || !isGraphDataEmpty(graph.data);
}

export function hasMeaningfulWorkspaceSnapshot(snapshot: WorkspaceSnapshot): boolean {
  return hasMeaningfulLocalWorkspace(snapshotToWorkspace(snapshot));
}

export function areWorkspaceSnapshotsEqual(left: WorkspaceSnapshot, right: WorkspaceSnapshot): boolean {
  return JSON.stringify(normalizeWorkspaceSnapshot(left)) === JSON.stringify(normalizeWorkspaceSnapshot(right));
}

function toProjectSummary(project: LocalProjectRecord): Project {
  return {
    id: project.id,
    name: project.name
  };
}

function toGraphSummary(graph: LocalGraphRecord): GraphInfo {
  return {
    id: graph.id,
    name: graph.name
  };
}

function createProjectCopy(project: LocalProjectRecord, name: string): LocalProjectRecord {
  const graphIdMap = new Map<string, string>();
  const graphs = project.graphs.map((graph) => {
    const newId = createLocalId("graph");
    graphIdMap.set(graph.id, newId);
    return {
      id: newId,
      name: graph.name,
      data: cloneData(graph.data)
    };
  });

  return {
    id: createLocalId("project"),
    name,
    activeGraphId: graphIdMap.get(project.activeGraphId ?? "") ?? graphs[0]?.id ?? null,
    store: cloneData(project.store),
    graphs
  };
}

function ensureUniqueName(baseName: string, usedNames: Set<string>, fallbackName: string): string {
  const trimmed = baseName.trim() || fallbackName;
  if (!usedNames.has(trimmed.toLowerCase())) {
    usedNames.add(trimmed.toLowerCase());
    return trimmed;
  }

  let index = 2;
  while (usedNames.has(`${trimmed} (${index})`.toLowerCase())) {
    index += 1;
  }

  const uniqueName = `${trimmed} (${index})`;
  usedNames.add(uniqueName.toLowerCase());
  return uniqueName;
}

// ── Remote Project API ─────────────────────────────────────────

async function apiListProjects(): Promise<ProjectsResponse> {
  const response = await apiFetch("/projects");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to list projects"));
  }
  return response.json();
}

async function apiCreateProject(name: string): Promise<Project> {
  const response = await apiFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to create project"));
  }
  return response.json();
}

async function apiActivateProject(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to activate project"));
  }
}

async function apiRenameProject(projectId: string, name: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/rename`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to rename project"));
  }
}

async function apiCopyProject(projectId: string, name: string): Promise<Project> {
  const response = await apiFetch(`/projects/${projectId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to copy project"));
  }
  return response.json();
}

async function apiDeleteProject(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/delete`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to delete project"));
  }
}

// ── Remote Graph management API (per-project) ──────────────────

async function apiListGraphs(projectId: string): Promise<GraphsResponse> {
  const response = await apiFetch(`/projects/${projectId}/graphs`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to list graphs"));
  }
  return response.json();
}

async function apiCreateGraph(projectId: string, name: string): Promise<GraphInfo> {
  const response = await apiFetch(`/projects/${projectId}/graphs`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to create graph"));
  }
  return response.json();
}

async function apiActivateGraph(projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to activate graph"));
  }
}

async function apiRenameGraph(projectId: string, graphId: string, name: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/rename`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to rename graph"));
  }
}

async function apiCopyGraph(projectId: string, graphId: string, name: string): Promise<GraphInfo> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to copy graph"));
  }
  return response.json();
}

async function apiDeleteGraph(projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/delete`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to delete graph"));
  }
}

// ── Remote Graph / Store (project-scoped) ──────────────────────

async function apiLoadGraph(projectId: string, graphId: string): Promise<GraphData> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/load`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load graph"));
  }
  return response.json();
}

async function apiSaveGraph(graph: GraphData, projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/save`, {
    method: "POST",
    body: JSON.stringify(graph)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to save graph"));
  }
}

async function apiLoadStore(projectId: string): Promise<StoreData> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/store/load`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load store"));
  }
  return response.json();
}

async function apiSaveStore(store: StoreData, projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/store/save`, {
    method: "POST",
    body: JSON.stringify(store)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to save store"));
  }
}

// ── Local Project API ──────────────────────────────────────────

async function localListProjects(): Promise<ProjectsResponse> {
  const workspace = readLocalWorkspace();
  return {
    projects: workspace.projects.map(toProjectSummary),
    activeProjectId: workspace.activeProjectId
  };
}

async function localCreateProject(name: string): Promise<Project> {
  return updateLocalWorkspace((workspace) => {
    const project = createDefaultLocalProject(name.trim() || DEFAULT_LOCAL_PROJECT_NAME);
    workspace.projects.push(project);
    return toProjectSummary(project);
  });
}

async function localActivateProject(projectId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    getLocalProjectOrThrow(workspace, projectId);
    workspace.activeProjectId = projectId;
  });
}

async function localRenameProject(projectId: string, name: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    project.name = name.trim() || project.name;
  });
}

async function localCopyProject(projectId: string, name: string): Promise<Project> {
  return updateLocalWorkspace((workspace) => {
    const source = getLocalProjectOrThrow(workspace, projectId);
    const projectCopy = createProjectCopy(source, name.trim() || `${source.name} (copy)`);
    workspace.projects.push(projectCopy);
    return toProjectSummary(projectCopy);
  });
}

async function localDeleteProject(projectId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const index = workspace.projects.findIndex((project) => project.id === projectId);
    if (index < 0) {
      throw new Error("Project not found");
    }

    workspace.projects.splice(index, 1);

    if (workspace.projects.length === 0) {
      const defaultProject = createDefaultLocalProject();
      workspace.projects.push(defaultProject);
      workspace.activeProjectId = defaultProject.id;
      return;
    }

    if (workspace.activeProjectId === projectId) {
      workspace.activeProjectId = workspace.projects[0].id;
    }
  });
}

// ── Local Graph management API (per-project) ───────────────────

async function localListGraphs(projectId: string): Promise<GraphsResponse> {
  const workspace = readLocalWorkspace();
  const project = getLocalProjectOrThrow(workspace, projectId);
  return {
    graphs: project.graphs.map(toGraphSummary),
    activeGraphId: project.activeGraphId
  };
}

async function localCreateGraph(projectId: string, name: string): Promise<GraphInfo> {
  return updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    const graph: LocalGraphRecord = {
      id: createLocalId("graph"),
      name: name.trim() || DEFAULT_LOCAL_GRAPH_NAME,
      data: createEmptyGraphData()
    };
    project.graphs.push(graph);
    if (!project.activeGraphId) {
      project.activeGraphId = graph.id;
    }
    return toGraphSummary(graph);
  });
}

async function localActivateGraph(projectId: string, graphId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    getLocalGraphOrThrow(project, graphId);
    project.activeGraphId = graphId;
  });
}

async function localRenameGraph(projectId: string, graphId: string, name: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    const graph = getLocalGraphOrThrow(project, graphId);
    graph.name = name.trim() || graph.name;
  });
}

async function localCopyGraph(projectId: string, graphId: string, name: string): Promise<GraphInfo> {
  return updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    const source = getLocalGraphOrThrow(project, graphId);
    const graphCopy: LocalGraphRecord = {
      id: createLocalId("graph"),
      name: name.trim() || `${source.name} (copy)`,
      data: cloneData(source.data)
    };
    project.graphs.push(graphCopy);
    return toGraphSummary(graphCopy);
  });
}

async function localDeleteGraph(projectId: string, graphId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    const index = project.graphs.findIndex((graph) => graph.id === graphId);
    if (index < 0) {
      throw new Error("Graph not found");
    }

    project.graphs.splice(index, 1);

    if (project.graphs.length === 0) {
      const fallbackGraph = createDefaultLocalGraph();
      project.graphs.push(fallbackGraph);
      project.activeGraphId = fallbackGraph.id;
      return;
    }

    if (project.activeGraphId === graphId) {
      project.activeGraphId = project.graphs[0].id;
    }
  });
}

// ── Local Graph / Store (project-scoped) ───────────────────────

async function localLoadGraph(projectId: string, graphId: string): Promise<GraphData> {
  const workspace = readLocalWorkspace();
  const project = getLocalProjectOrThrow(workspace, projectId);
  const graph = getLocalGraphOrThrow(project, graphId);
  return cloneData(graph.data);
}

async function localSaveGraph(graph: GraphData, projectId: string, graphId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    const target = getLocalGraphOrThrow(project, graphId);
    target.data = normalizeGraphData(graph);
  });
}

async function localLoadStore(projectId: string): Promise<StoreData> {
  const workspace = readLocalWorkspace();
  const project = getLocalProjectOrThrow(workspace, projectId);
  return cloneData(project.store);
}

async function localSaveStore(store: StoreData, projectId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    project.store = normalizeStoreData(store);
  });
}

// ── Persistence mode helpers ───────────────────────────────────

export function getPersistenceMode(): PersistenceMode {
  return persistenceMode;
}

export function setPersistenceMode(mode: PersistenceMode): void {
  persistenceMode = mode;
}

export async function listProjects(): Promise<ProjectsResponse> {
  return persistenceMode === "remote" ? apiListProjects() : localListProjects();
}

export async function createProject(name: string): Promise<Project> {
  return persistenceMode === "remote" ? apiCreateProject(name) : localCreateProject(name);
}

export async function activateProject(projectId: string): Promise<void> {
  return persistenceMode === "remote" ? apiActivateProject(projectId) : localActivateProject(projectId);
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  return persistenceMode === "remote" ? apiRenameProject(projectId, name) : localRenameProject(projectId, name);
}

export async function copyProject(projectId: string, name: string): Promise<Project> {
  return persistenceMode === "remote" ? apiCopyProject(projectId, name) : localCopyProject(projectId, name);
}

export async function deleteProject(projectId: string): Promise<void> {
  return persistenceMode === "remote" ? apiDeleteProject(projectId) : localDeleteProject(projectId);
}

export async function listGraphs(projectId: string): Promise<GraphsResponse> {
  return persistenceMode === "remote" ? apiListGraphs(projectId) : localListGraphs(projectId);
}

export async function createGraph(projectId: string, name: string): Promise<GraphInfo> {
  return persistenceMode === "remote" ? apiCreateGraph(projectId, name) : localCreateGraph(projectId, name);
}

export async function activateGraph(projectId: string, graphId: string): Promise<void> {
  return persistenceMode === "remote" ? apiActivateGraph(projectId, graphId) : localActivateGraph(projectId, graphId);
}

export async function renameGraph(projectId: string, graphId: string, name: string): Promise<void> {
  return persistenceMode === "remote" ? apiRenameGraph(projectId, graphId, name) : localRenameGraph(projectId, graphId, name);
}

export async function copyGraph(projectId: string, graphId: string, name: string): Promise<GraphInfo> {
  return persistenceMode === "remote" ? apiCopyGraph(projectId, graphId, name) : localCopyGraph(projectId, graphId, name);
}

export async function deleteGraph(projectId: string, graphId: string): Promise<void> {
  return persistenceMode === "remote" ? apiDeleteGraph(projectId, graphId) : localDeleteGraph(projectId, graphId);
}

export async function loadGraph(projectId: string, graphId: string): Promise<GraphData> {
  return persistenceMode === "remote" ? apiLoadGraph(projectId, graphId) : localLoadGraph(projectId, graphId);
}

export async function saveGraph(graph: GraphData, projectId: string, graphId: string): Promise<void> {
  return persistenceMode === "remote" ? apiSaveGraph(graph, projectId, graphId) : localSaveGraph(graph, projectId, graphId);
}

export async function loadStore(projectId: string): Promise<StoreData> {
  return persistenceMode === "remote" ? apiLoadStore(projectId) : localLoadStore(projectId);
}

export async function saveStore(store: StoreData, projectId: string): Promise<void> {
  return persistenceMode === "remote" ? apiSaveStore(store, projectId) : localSaveStore(store, projectId);
}

export async function getLocalWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  return normalizeWorkspaceSnapshot(workspaceToSnapshot(readLocalWorkspace()));
}

export async function getRemoteWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const remoteProjects = await apiListProjects();
  const projects = await Promise.all(remoteProjects.projects.map(async (remoteProject) => {
    const [store, graphsResponse] = await Promise.all([
      apiLoadStore(remoteProject.id),
      apiListGraphs(remoteProject.id)
    ]);
    const graphs = await Promise.all(graphsResponse.graphs.map(async (graph) => ({
      name: graph.name,
      data: await apiLoadGraph(remoteProject.id, graph.id)
    })));

    return {
      name: remoteProject.name,
      activeGraphName: graphsResponse.graphs.find((graph) => graph.id === graphsResponse.activeGraphId)?.name ?? graphs[0]?.name ?? null,
      store,
      graphs
    };
  }));

  return normalizeWorkspaceSnapshot({
    activeProjectName: remoteProjects.projects.find((project) => project.id === remoteProjects.activeProjectId)?.name ?? projects[0]?.name ?? null,
    projects
  });
}

async function importSnapshotToRemote(snapshot: WorkspaceSnapshot): Promise<void> {
  const projectNameCounts = new Map<string, number>();
  const ensureUniqueProjectName = (name: string): string => {
    const normalized = name.trim() || DEFAULT_LOCAL_PROJECT_NAME;
    const currentCount = projectNameCounts.get(normalized.toLowerCase()) ?? 0;
    projectNameCounts.set(normalized.toLowerCase(), currentCount + 1);
    return currentCount === 0 ? normalized : `${normalized} (${currentCount + 1})`;
  };

  const activeProjectIdsByName = new Map<string, string>();

  for (const project of snapshot.projects) {
    const remoteProject = await apiCreateProject(ensureUniqueProjectName(project.name));
    activeProjectIdsByName.set(project.name, remoteProject.id);
    await apiSaveStore(project.store, remoteProject.id);

    const remoteGraphs = await apiListGraphs(remoteProject.id);
    const graphNameCounts = new Map<string, number>();
    const ensureUniqueGraphName = (name: string): string => {
      const normalized = name.trim() || DEFAULT_LOCAL_GRAPH_NAME;
      const currentCount = graphNameCounts.get(normalized.toLowerCase()) ?? 0;
      graphNameCounts.set(normalized.toLowerCase(), currentCount + 1);
      return currentCount === 0 ? normalized : `${normalized} (${currentCount + 1})`;
    };
    const remoteGraphIdsByName = new Map<string, string>();
    const sourceGraphs = project.graphs.length > 0 ? project.graphs : [{ name: DEFAULT_LOCAL_GRAPH_NAME, data: createEmptyGraphData() }];
    const firstSourceGraph = sourceGraphs[0];
    const defaultRemoteGraphId = remoteGraphs.activeGraphId ?? remoteGraphs.graphs[0]?.id ?? null;

    if (firstSourceGraph) {
      const firstGraphName = ensureUniqueGraphName(firstSourceGraph.name);
      if (defaultRemoteGraphId) {
        await apiRenameGraph(remoteProject.id, defaultRemoteGraphId, firstGraphName);
        await apiSaveGraph(firstSourceGraph.data, remoteProject.id, defaultRemoteGraphId);
        remoteGraphIdsByName.set(firstGraphName, defaultRemoteGraphId);
      } else {
        const createdGraph = await apiCreateGraph(remoteProject.id, firstGraphName);
        await apiSaveGraph(firstSourceGraph.data, remoteProject.id, createdGraph.id);
        remoteGraphIdsByName.set(firstGraphName, createdGraph.id);
      }
    }

    for (const graph of sourceGraphs.slice(1)) {
      const graphName = ensureUniqueGraphName(graph.name);
      const createdGraph = await apiCreateGraph(remoteProject.id, graphName);
      await apiSaveGraph(graph.data, remoteProject.id, createdGraph.id);
      remoteGraphIdsByName.set(graphName, createdGraph.id);
    }

    const activeGraphId = project.activeGraphName ? remoteGraphIdsByName.get(project.activeGraphName) : undefined;
    if (activeGraphId) {
      await apiActivateGraph(remoteProject.id, activeGraphId);
    }
  }

  const activeProjectId = snapshot.activeProjectName ? activeProjectIdsByName.get(snapshot.activeProjectName) : undefined;
  if (activeProjectId) {
    await apiActivateProject(activeProjectId);
  }
}

export async function replaceRemoteWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  const existingProjects = await apiListProjects();
  for (const project of existingProjects.projects) {
    await apiDeleteProject(project.id);
  }

  const normalizedSnapshot = normalizeWorkspaceSnapshot(snapshot);
  if (normalizedSnapshot.projects.length === 0) {
    await importSnapshotToRemote(normalizeWorkspaceSnapshot(workspaceToSnapshot(createDefaultLocalWorkspace())));
    return;
  }

  await importSnapshotToRemote(normalizedSnapshot);
}

export async function syncLocalWorkspaceToRemote(): Promise<void> {
  const workspace = readLocalWorkspace();
  if (!hasMeaningfulLocalWorkspace(workspace)) {
    return;
  }

  const localSnapshot = workspaceToSnapshot(workspace);
  await importSnapshotToRemote({
    activeProjectName: localSnapshot.activeProjectName,
    projects: localSnapshot.projects.map((project) => ({
      ...project,
      name: ensureUniqueName(project.name, new Set<string>(), DEFAULT_LOCAL_PROJECT_NAME)
    }))
  });
}

export async function captureRemoteWorkspaceToLocal(): Promise<void> {
  const remoteSnapshot = await getRemoteWorkspaceSnapshot();
  writeLocalWorkspace(snapshotToWorkspace(remoteSnapshot));
}
