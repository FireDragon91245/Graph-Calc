import { apiFetch, getErrorMessage } from "./client";
import i18n from "../i18n";
import type { RecipeBlueprint } from "../domain/recipeBlueprint";
import type { ModuleDefinition, ModuleSystemDefinition, RecipeModuleSupport } from "../domain/moduleSystem";

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
  moduleSupport?: RecipeModuleSupport[];
}

export interface StoreData {
  schemaVersion: number;
  projectRevision: number;
  categories: Category[];
  items: Item[];
  tags: Tag[];
  recipeTags: RecipeTag[];
  recipes: Recipe[];
  recipeBlueprints: RecipeBlueprint[];
  moduleDefinitions: ModuleDefinition[];
  moduleSystems: ModuleSystemDefinition[];
}

// ── Project types ──────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  thumbnailId: string | null;
}

export interface ProjectsResponse {
  projects: Project[];
  activeProjectId: string | null;
}

// ── Graph types ────────────────────────────────────────────────

export interface GraphInfo {
  id: string;
  name: string;
  thumbnailId: string | null;
}

export interface WorkspaceThumbnailSnapshot {
  contentType: string;
  sha256: string;
  dataUrl: string;
}

export interface GraphsResponse {
  graphs: GraphInfo[];
  activeGraphId: string | null;
}

export interface WorkspaceGraphSnapshot {
  name: string;
  data: GraphData;
  thumbnail: WorkspaceThumbnailSnapshot | null;
}

export interface WorkspaceProjectSnapshot {
  name: string;
  activeGraphName: string | null;
  store: StoreData;
  graphs: WorkspaceGraphSnapshot[];
  thumbnail: WorkspaceThumbnailSnapshot | null;
  moduleResources: Array<{ imageId: string; image: WorkspaceThumbnailSnapshot }>;
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
  thumbnailId: string | null;
};

type LocalProjectRecord = {
  id: string;
  name: string;
  activeGraphId: string | null;
  store: StoreData;
  graphs: LocalGraphRecord[];
  thumbnailId: string | null;
};

type LocalImageRecord = {
  id: string;
  contentType: string;
  sha256: string;
  dataUrl: string;
};

type LocalImageStore = {
  version: number;
  images: LocalImageRecord[];
};

type LocalWorkspaceRecord = {
  version: number;
  activeProjectId: string | null;
  projects: LocalProjectRecord[];
};

const LOCAL_WORKSPACE_STORAGE_KEY = "graphcalc.local-workspace.v1";
const LOCAL_IMAGES_STORAGE_KEY = "graphcalc.local-images.v1";
const LOCAL_WORKSPACE_VERSION = 1;
const getDefaultLocalProjectName = () => i18n.t("ui.defaults.guestProject");
const getDefaultLocalGraphName = () => i18n.t("ui.defaults.mainGraph");
const isDefaultLocalProjectName = (name: string) => ["en", "de"].some((language) => name === i18n.getFixedT(language)("ui.defaults.guestProject"));
const isDefaultLocalGraphName = (name: string) => ["en", "de"].some((language) => name === i18n.getFixedT(language)("ui.defaults.mainGraph"));

let persistenceMode: PersistenceMode = "local";
let localWorkspaceFallback: LocalWorkspaceRecord | null = null;
let localImagesFallback: LocalImageStore = { version: 1, images: [] };

const cloneData = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createEmptyStoreData(): StoreData {
  return {
    schemaVersion: 7,
    projectRevision: 0,
    categories: [],
    items: [],
    tags: [],
    recipeTags: [],
    recipes: [],
    recipeBlueprints: [],
    moduleDefinitions: [],
    moduleSystems: []
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

function createDefaultLocalGraph(name = getDefaultLocalGraphName()): LocalGraphRecord {
  return {
    id: createLocalId("graph"),
    name,
    data: createEmptyGraphData(),
    thumbnailId: null
  };
}

function createDefaultLocalProject(name = getDefaultLocalProjectName()): LocalProjectRecord {
  const graph = createDefaultLocalGraph();
  return {
    id: createLocalId("project"),
    name,
    activeGraphId: graph.id,
    store: createEmptyStoreData(),
    graphs: [graph],
    thumbnailId: null
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
    schemaVersion: 7,
    projectRevision: typeof candidate?.projectRevision === "number" ? candidate.projectRevision : 0,
    categories: Array.isArray(candidate?.categories) ? cloneData(candidate.categories) : [],
    items: Array.isArray(candidate?.items) ? cloneData(candidate.items) : [],
    tags: Array.isArray(candidate?.tags) ? cloneData(candidate.tags) : [],
    recipeTags: Array.isArray(candidate?.recipeTags) ? cloneData(candidate.recipeTags) : [],
    recipes: Array.isArray(candidate?.recipes) ? cloneData(candidate.recipes) : [],
    recipeBlueprints: Array.isArray(candidate?.recipeBlueprints) ? cloneData(candidate.recipeBlueprints) : [],
    moduleDefinitions: Array.isArray(candidate?.moduleDefinitions) ? cloneData(candidate.moduleDefinitions) : [],
    moduleSystems: Array.isArray(candidate?.moduleSystems) ? cloneData(candidate.moduleSystems) : []
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
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : getDefaultLocalGraphName(),
    data: normalizeGraphData(candidate.data),
    thumbnailId: typeof candidate.thumbnailId === "string" && candidate.thumbnailId ? candidate.thumbnailId : null
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
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : getDefaultLocalProjectName(),
    activeGraphId,
    store: normalizeStoreData(candidate.store),
    graphs: ensuredGraphs,
    thumbnailId: typeof candidate.thumbnailId === "string" && candidate.thumbnailId ? candidate.thumbnailId : null
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
    throw new Error(i18n.t("persistenceErrors.projectNotFound"));
  }

  return project;
}

function getLocalGraphOrThrow(project: LocalProjectRecord, graphId: string): LocalGraphRecord {
  const graph = project.graphs.find((entry) => entry.id === graphId);
  if (!graph) {
    throw new Error(i18n.t("persistenceErrors.graphNotFound"));
  }

  return graph;
}

function isStoreDataEmpty(store: StoreData): boolean {
  return store.categories.length === 0
    && store.items.length === 0
    && store.tags.length === 0
    && store.recipeTags.length === 0
    && store.recipes.length === 0
    && store.recipeBlueprints.length === 0
    && store.moduleDefinitions.length === 0
    && store.moduleSystems.length === 0;
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
    schemaVersion: store.schemaVersion,
    projectRevision: store.projectRevision,
    categories: cloneData(store.categories).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    items: cloneData(store.items).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    tags: cloneData(store.tags).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    recipeTags: cloneData(store.recipeTags).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    recipes: cloneData(store.recipes).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    recipeBlueprints: cloneData(store.recipeBlueprints).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    moduleDefinitions: cloneData(store.moduleDefinitions).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
    moduleSystems: cloneData(store.moduleSystems).sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name))
  };
}

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const projects = cloneData(snapshot.projects)
    .map((project) => ({
      name: project.name,
      activeGraphName: project.activeGraphName,
      store: normalizeSnapshotStoreData(project.store),
      thumbnail: project.thumbnail ? cloneData(project.thumbnail) : null,
      moduleResources: cloneData(project.moduleResources ?? []).sort((left, right) => left.imageId.localeCompare(right.imageId)),
      graphs: cloneData(project.graphs)
        .map((graph) => ({
          name: graph.name,
          data: normalizeSnapshotGraphData(graph.data),
          thumbnail: graph.thumbnail ? cloneData(graph.thumbnail) : null
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
      const moduleResourceImageIds = Array.from(new Set(project.store.moduleSystems.flatMap((system) => (system.resources ?? []).map((resource) => resource.imageId))));
      return {
        name: project.name,
        activeGraphName: activeGraph?.name ?? null,
        store: normalizeStoreData(project.store),
        thumbnail: getLocalThumbnailSnapshot(project.thumbnailId),
        moduleResources: moduleResourceImageIds.flatMap((imageId) => {
          const image = getLocalThumbnailSnapshot(imageId);
          return image ? [{ imageId, image }] : [];
        }),
        graphs: project.graphs.map((graph) => ({
          name: graph.name,
          data: normalizeGraphData(graph.data),
          thumbnail: getLocalThumbnailSnapshot(graph.thumbnailId)
        }))
      };
    })
  };
}

function snapshotToWorkspace(snapshot: WorkspaceSnapshot): LocalWorkspaceRecord {
  const imageStore = readLocalImages();
  const ensureImage = (thumbnail: WorkspaceThumbnailSnapshot | null | undefined): string | null => {
    if (!thumbnail) return null;
    const existing = imageStore.images.find((image) => image.sha256 === thumbnail.sha256);
    if (existing) return existing.id;
    const image: LocalImageRecord = { id: createLocalId("image"), ...thumbnail };
    imageStore.images.push(image);
    return image.id;
  };
  const projects = snapshot.projects.map((project) => {
    const resourceImageIds = new Map<string, string>();
    for (const resource of project.moduleResources ?? []) {
      const imageId = ensureImage(resource.image);
      if (imageId) resourceImageIds.set(resource.imageId, imageId);
    }
    const store = normalizeStoreData(project.store);
    store.moduleSystems = store.moduleSystems.map((system) => ({
      ...system,
      resources: (system.resources ?? []).map((resource) => ({ ...resource, imageId: resourceImageIds.get(resource.imageId) ?? resource.imageId }))
    }));
    const graphs = (project.graphs.length > 0 ? project.graphs : [{ name: getDefaultLocalGraphName(), data: createEmptyGraphData(), thumbnail: null }])
      .map((graph) => ({
        id: createLocalId("graph"),
        name: graph.name,
        data: normalizeGraphData(graph.data),
        thumbnailId: ensureImage(graph.thumbnail)
      }));
    const activeGraph = graphs.find((graph) => graph.name === project.activeGraphName) ?? graphs[0] ?? null;

    return {
      id: createLocalId("project"),
      name: project.name,
      activeGraphId: activeGraph?.id ?? null,
      store,
      graphs,
      thumbnailId: ensureImage(project.thumbnail)
    };
  });
  writeLocalImages(imageStore);
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

  if (!isDefaultLocalProjectName(project.name)) {
    return true;
  }

  if (project.graphs.length !== 1) {
    return true;
  }

  const [graph] = project.graphs;
  if (!graph) {
    return false;
  }

  return !isDefaultLocalGraphName(graph.name)
    || !isStoreDataEmpty(project.store)
    || !isGraphDataEmpty(graph.data)
    || Boolean(project.thumbnailId)
    || Boolean(graph.thumbnailId);
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
    name: project.name,
    thumbnailId: project.thumbnailId
  };
}

function toGraphSummary(graph: LocalGraphRecord): GraphInfo {
  return {
    id: graph.id,
    name: graph.name,
    thumbnailId: graph.thumbnailId
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
      data: cloneData(graph.data),
      thumbnailId: graph.thumbnailId
    };
  });

  return {
    id: createLocalId("project"),
    name,
    activeGraphId: graphIdMap.get(project.activeGraphId ?? "") ?? graphs[0]?.id ?? null,
    store: cloneData(project.store),
    graphs,
    thumbnailId: project.thumbnailId
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
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.listProjects")));
  }
  return response.json();
}

async function apiCreateProject(name: string): Promise<Project> {
  const response = await apiFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.createProject")));
  }
  return response.json();
}

async function apiActivateProject(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.activateProject")));
  }
}

async function apiRenameProject(projectId: string, name: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/rename`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.renameProject")));
  }
}

async function apiCopyProject(projectId: string, name: string): Promise<Project> {
  const response = await apiFetch(`/projects/${projectId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.copyProject")));
  }
  return response.json();
}

async function apiDeleteProject(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/delete`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.deleteProject")));
  }
}

// ── Remote Graph management API (per-project) ──────────────────

async function apiListGraphs(projectId: string): Promise<GraphsResponse> {
  const response = await apiFetch(`/projects/${projectId}/graphs`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.listGraphs")));
  }
  return response.json();
}

async function apiCreateGraph(projectId: string, name: string): Promise<GraphInfo> {
  const response = await apiFetch(`/projects/${projectId}/graphs`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.createGraph")));
  }
  return response.json();
}

async function apiActivateGraph(projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.activateGraph")));
  }
}

async function apiRenameGraph(projectId: string, graphId: string, name: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/rename`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.renameGraph")));
  }
}

async function apiCopyGraph(projectId: string, graphId: string, name: string): Promise<GraphInfo> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.copyGraph")));
  }
  return response.json();
}

async function apiDeleteGraph(projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/delete`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.deleteGraph")));
  }
}

// ── Remote Graph / Store (project-scoped) ──────────────────────

async function apiLoadGraph(projectId: string, graphId: string): Promise<GraphData> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/load`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.loadGraph")));
  }
  return response.json();
}

async function apiSaveGraph(graph: GraphData, projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/save`, {
    method: "POST",
    body: JSON.stringify(graph)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.saveGraph")));
  }
}

async function apiLoadStore(projectId: string): Promise<StoreData> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/store/load`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.loadStore")));
  }
  return normalizeStoreData(await response.json());
}

async function apiSaveStore(store: StoreData, projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/store/save`, {
    method: "POST",
    body: JSON.stringify(store)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.saveStore")));
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
    const project = createDefaultLocalProject(name.trim() || getDefaultLocalProjectName());
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
  const releasedImageIds: string[] = [];
  updateLocalWorkspace((workspace) => {
    const index = workspace.projects.findIndex((project) => project.id === projectId);
    if (index < 0) {
      throw new Error(i18n.t("persistenceErrors.projectNotFound"));
    }

    const [removed] = workspace.projects.splice(index, 1);
    if (removed?.thumbnailId) releasedImageIds.push(removed.thumbnailId);
    removed?.graphs.forEach((graph) => { if (graph.thumbnailId) releasedImageIds.push(graph.thumbnailId); });

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
  releasedImageIds.forEach(deleteUnreferencedLocalImage);
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
      name: name.trim() || getDefaultLocalGraphName(),
      data: createEmptyGraphData(),
      thumbnailId: null
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
      data: cloneData(source.data),
      thumbnailId: source.thumbnailId
    };
    project.graphs.push(graphCopy);
    return toGraphSummary(graphCopy);
  });
}

async function localDeleteGraph(projectId: string, graphId: string): Promise<void> {
  let releasedImageId: string | null = null;
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    const index = project.graphs.findIndex((graph) => graph.id === graphId);
    if (index < 0) {
      throw new Error(i18n.t("persistenceErrors.graphNotFound"));
    }

    const [removed] = project.graphs.splice(index, 1);
    releasedImageId = removed?.thumbnailId ?? null;

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
  deleteUnreferencedLocalImage(releasedImageId);
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
  return normalizeStoreData(project.store);
}

async function localSaveStore(store: StoreData, projectId: string): Promise<void> {
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    project.store = normalizeStoreData(store);
  });
}

async function storeLocalThumbnail(file: File, prevalidated?: Awaited<ReturnType<typeof validateThumbnailFile>>): Promise<string> {
  const validated = prevalidated ?? await validateThumbnailFile(file);
  const store = readLocalImages();
  const existing = store.images.find((image) => image.sha256 === validated.sha256);
  if (existing) return existing.id;
  const image: LocalImageRecord = { id: createLocalId("image"), ...validated };
  writeLocalImages({ version: 1, images: [...store.images, image] });
  return image.id;
}

async function localPutProjectThumbnail(projectId: string, file: File, validated?: Awaited<ReturnType<typeof validateThumbnailFile>>): Promise<string> {
  const thumbnailId = await storeLocalThumbnail(file, validated);
  let previousThumbnailId: string | null = null;
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    previousThumbnailId = project.thumbnailId;
    project.thumbnailId = thumbnailId;
  });
  deleteUnreferencedLocalImage(previousThumbnailId);
  return thumbnailId;
}

async function localPutGraphThumbnail(projectId: string, graphId: string, file: File, validated?: Awaited<ReturnType<typeof validateThumbnailFile>>): Promise<string> {
  const thumbnailId = await storeLocalThumbnail(file, validated);
  let previousThumbnailId: string | null = null;
  updateLocalWorkspace((workspace) => {
    const graph = getLocalGraphOrThrow(getLocalProjectOrThrow(workspace, projectId), graphId);
    previousThumbnailId = graph.thumbnailId;
    graph.thumbnailId = thumbnailId;
  });
  deleteUnreferencedLocalImage(previousThumbnailId);
  return thumbnailId;
}

async function localDeleteProjectThumbnail(projectId: string): Promise<void> {
  let previousThumbnailId: string | null = null;
  updateLocalWorkspace((workspace) => {
    const project = getLocalProjectOrThrow(workspace, projectId);
    previousThumbnailId = project.thumbnailId;
    project.thumbnailId = null;
  });
  deleteUnreferencedLocalImage(previousThumbnailId);
}

async function localDeleteGraphThumbnail(projectId: string, graphId: string): Promise<void> {
  let previousThumbnailId: string | null = null;
  updateLocalWorkspace((workspace) => {
    const graph = getLocalGraphOrThrow(getLocalProjectOrThrow(workspace, projectId), graphId);
    previousThumbnailId = graph.thumbnailId;
    graph.thumbnailId = null;
  });
  deleteUnreferencedLocalImage(previousThumbnailId);
}

// ── Persistence mode helpers ───────────────────────────────────

export function getPersistenceMode(): PersistenceMode {
  return persistenceMode;
}

export function getModuleResourceImageUrl(projectId: string, imageId: string): string | null {
  if (!projectId || !imageId) return null;
  if (persistenceMode === "remote") {
    return `/api/projects/${encodeURIComponent(projectId)}/module-resources/${encodeURIComponent(imageId)}`;
  }
  return getLocalImage(imageId)?.dataUrl ?? null;
}

export async function uploadModuleResourceImage(projectId: string, file: File): Promise<string> {
  const validated = await validateThumbnailFile(file);
  if (persistenceMode === "remote") {
    return apiPutModuleResourceImage(projectId, file);
  }

  const store = readLocalImages();
  const existing = store.images.find((image) => image.sha256 === validated.sha256);
  if (existing) return existing.id;
  const image: LocalImageRecord = { id: createLocalId("image"), ...validated };
  writeLocalImages({ version: 1, images: [...store.images, image] });
  return image.id;
}

async function apiPutModuleResourceImage(projectId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/module-resources`, { method: "PUT", body: form });
  if (!response.ok) throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.saveThumbnail")));
  return ((await response.json()) as { imageId: string }).imageId;
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

export function getProjectThumbnailUrl(projectId: string, thumbnailId: string | null): string | null {
  if (!thumbnailId) return null;
  if (persistenceMode === "remote") return `/api/projects/${encodeURIComponent(projectId)}/thumbnail?v=${encodeURIComponent(thumbnailId)}`;
  return getLocalImage(thumbnailId)?.dataUrl ?? null;
}

export function getGraphThumbnailUrl(projectId: string, graphId: string, thumbnailId: string | null): string | null {
  if (!thumbnailId) return null;
  if (persistenceMode === "remote") return `/api/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/thumbnail?v=${encodeURIComponent(thumbnailId)}`;
  return getLocalImage(thumbnailId)?.dataUrl ?? null;
}

export async function putProjectThumbnail(projectId: string, file: File): Promise<string> {
  const validated = await validateThumbnailFile(file);
  return persistenceMode === "remote"
    ? apiPutThumbnail(`/projects/${encodeURIComponent(projectId)}/thumbnail`, file)
    : localPutProjectThumbnail(projectId, file, validated);
}

export async function deleteProjectThumbnail(projectId: string): Promise<void> {
  return persistenceMode === "remote"
    ? apiDeleteThumbnail(`/projects/${encodeURIComponent(projectId)}/thumbnail`)
    : localDeleteProjectThumbnail(projectId);
}

export async function putGraphThumbnail(projectId: string, graphId: string, file: File): Promise<string> {
  const validated = await validateThumbnailFile(file);
  return persistenceMode === "remote"
    ? apiPutThumbnail(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/thumbnail`, file)
    : localPutGraphThumbnail(projectId, graphId, file, validated);
}

export async function deleteGraphThumbnail(projectId: string, graphId: string): Promise<void> {
  return persistenceMode === "remote"
    ? apiDeleteThumbnail(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graphId)}/thumbnail`)
    : localDeleteGraphThumbnail(projectId, graphId);
}

async function apiPutThumbnail(path: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const response = await apiFetch(path, { method: "PUT", body: form });
  if (!response.ok) throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.saveThumbnail")));
  const result = await response.json() as { thumbnailId: string };
  return result.thumbnailId;
}

async function apiDeleteThumbnail(path: string): Promise<void> {
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) throw new Error(await getErrorMessage(response, i18n.t("persistenceErrors.removeThumbnail")));
}

async function fetchRemoteThumbnail(path: string, thumbnailId: string | null): Promise<WorkspaceThumbnailSnapshot | null> {
  if (!thumbnailId) return null;
  const response = await apiFetch(path);
  if (!response.ok) return null;
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(i18n.t("persistenceErrors.readThumbnail")));
    reader.readAsDataURL(blob);
  });
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { contentType: blob.type, sha256, dataUrl };
}

function readLocalImages(): LocalImageStore {
  try {
    const raw = window.localStorage.getItem(LOCAL_IMAGES_STORAGE_KEY);
    if (!raw) return cloneData(localImagesFallback);
    const parsed = JSON.parse(raw) as Partial<LocalImageStore>;
    const images = Array.isArray(parsed.images)
      ? parsed.images.filter((image): image is LocalImageRecord => Boolean(
        image && typeof image.id === "string" && typeof image.contentType === "string"
        && typeof image.sha256 === "string" && typeof image.dataUrl === "string"
      ))
      : [];
    localImagesFallback = { version: 1, images };
    return cloneData(localImagesFallback);
  } catch {
    return cloneData(localImagesFallback);
  }
}

function writeLocalImages(store: LocalImageStore): void {
  const serialized = JSON.stringify(store);
  window.localStorage.setItem(LOCAL_IMAGES_STORAGE_KEY, serialized);
  localImagesFallback = cloneData(store);
}

function getLocalImage(imageId: string | null): LocalImageRecord | null {
  if (!imageId) return null;
  return readLocalImages().images.find((image) => image.id === imageId) ?? null;
}

function getLocalThumbnailSnapshot(imageId: string | null): WorkspaceThumbnailSnapshot | null {
  const image = getLocalImage(imageId);
  return image ? { contentType: image.contentType, sha256: image.sha256, dataUrl: image.dataUrl } : null;
}

function isLocalImageReferenced(imageId: string): boolean {
  const workspace = readLocalWorkspace();
  return workspace.projects.some((project) =>
    project.thumbnailId === imageId
    || project.graphs.some((graph) => graph.thumbnailId === imageId)
    || project.store.moduleSystems.some((system) => (system.resources ?? []).some((resource) => resource.imageId === imageId))
  );
}

function deleteUnreferencedLocalImage(imageId: string | null): void {
  if (!imageId || isLocalImageReferenced(imageId)) return;
  const store = readLocalImages();
  const images = store.images.filter((image) => image.id !== imageId);
  if (images.length !== store.images.length) writeLocalImages({ version: 1, images });
}

async function validateThumbnailFile(file: File): Promise<{ contentType: string; sha256: string; dataUrl: string }> {
  if (file.size === 0) throw new Error(i18n.t("persistenceErrors.chooseImage"));
  if (file.size > 5 * 1024 * 1024) throw new Error(i18n.t("persistenceErrors.imageSize"));
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(i18n.t("persistenceErrors.imageType"));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(i18n.t("persistenceErrors.invalidImage"));
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width < 16 || height < 16 || width > 1024 || height > 1024) {
    throw new Error(i18n.t("persistenceErrors.dimensions"));
  }

  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(i18n.t("persistenceErrors.readImage")));
    reader.readAsDataURL(file);
  });
  return { contentType: file.type, sha256, dataUrl };
}

function dataUrlToFile(thumbnail: WorkspaceThumbnailSnapshot): File {
  const [header, encoded] = thumbnail.dataUrl.split(",", 2);
  if (!header || encoded === undefined) throw new Error(i18n.t("persistenceErrors.invalidThumbnail"));
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], "thumbnail", { type: thumbnail.contentType });
}

export async function getProjectSnapshot(projectId: string): Promise<WorkspaceProjectSnapshot> {
  const [projectsResponse, store, graphsResponse] = await Promise.all([
    listProjects(),
    loadStore(projectId),
    listGraphs(projectId)
  ]);
  const project = projectsResponse.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(i18n.t("persistenceErrors.activeProjectMissing"));
  }

  const graphs = await Promise.all(
    graphsResponse.graphs.map(async (graph) => ({
      name: graph.name,
      data: await loadGraph(projectId, graph.id),
      thumbnail: persistenceMode === "remote"
        ? await fetchRemoteThumbnail(`/projects/${encodeURIComponent(projectId)}/graphs/${encodeURIComponent(graph.id)}/thumbnail`, graph.thumbnailId)
        : getLocalThumbnailSnapshot(graph.thumbnailId)
    }))
  );
  const moduleResourceImageIds = Array.from(new Set(store.moduleSystems.flatMap((system) => (system.resources ?? []).map((resource) => resource.imageId))));
  const moduleResources = (await Promise.all(moduleResourceImageIds.map(async (imageId) => {
    const image = persistenceMode === "remote"
      ? await fetchRemoteThumbnail(`/projects/${encodeURIComponent(projectId)}/module-resources/${encodeURIComponent(imageId)}`, imageId)
      : getLocalThumbnailSnapshot(imageId);
    return image ? { imageId, image } : null;
  }))).filter((entry): entry is { imageId: string; image: WorkspaceThumbnailSnapshot } => Boolean(entry));

  return {
    name: project.name,
    activeGraphName:
      graphsResponse.graphs.find((graph) => graph.id === graphsResponse.activeGraphId)?.name
      ?? graphs[0]?.name
      ?? null,
    store,
    graphs,
    moduleResources,
    thumbnail: persistenceMode === "remote"
      ? await fetchRemoteThumbnail(`/projects/${encodeURIComponent(projectId)}/thumbnail`, project.thumbnailId)
      : getLocalThumbnailSnapshot(project.thumbnailId)
  };
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
      data: await apiLoadGraph(remoteProject.id, graph.id),
      thumbnail: await fetchRemoteThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/graphs/${encodeURIComponent(graph.id)}/thumbnail`, graph.thumbnailId)
    })));
    const moduleResourceImageIds = Array.from(new Set(store.moduleSystems.flatMap((system) => (system.resources ?? []).map((resource) => resource.imageId))));
    const moduleResources = (await Promise.all(moduleResourceImageIds.map(async (imageId) => {
      const image = await fetchRemoteThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/module-resources/${encodeURIComponent(imageId)}`, imageId);
      return image ? { imageId, image } : null;
    }))).filter((entry): entry is { imageId: string; image: WorkspaceThumbnailSnapshot } => Boolean(entry));

    return {
      name: remoteProject.name,
      activeGraphName: graphsResponse.graphs.find((graph) => graph.id === graphsResponse.activeGraphId)?.name ?? graphs[0]?.name ?? null,
      store,
      graphs,
      moduleResources,
      thumbnail: await fetchRemoteThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/thumbnail`, remoteProject.thumbnailId)
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
    const normalized = name.trim() || getDefaultLocalProjectName();
    const currentCount = projectNameCounts.get(normalized.toLowerCase()) ?? 0;
    projectNameCounts.set(normalized.toLowerCase(), currentCount + 1);
    return currentCount === 0 ? normalized : `${normalized} (${currentCount + 1})`;
  };

  const activeProjectIdsByName = new Map<string, string>();

  for (const project of snapshot.projects) {
    const remoteProject = await apiCreateProject(ensureUniqueProjectName(project.name));
    activeProjectIdsByName.set(project.name, remoteProject.id);
    const resourceImageIds = new Map<string, string>();
    for (const resource of project.moduleResources ?? []) {
      resourceImageIds.set(resource.imageId, await apiPutModuleResourceImage(remoteProject.id, dataUrlToFile(resource.image)));
    }
    const remappedStore = normalizeStoreData(project.store);
    remappedStore.moduleSystems = remappedStore.moduleSystems.map((system) => ({
      ...system,
      resources: (system.resources ?? []).map((resource) => ({ ...resource, imageId: resourceImageIds.get(resource.imageId) ?? resource.imageId }))
    }));
    await apiSaveStore(remappedStore, remoteProject.id);
    if (project.thumbnail) {
      await apiPutThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/thumbnail`, dataUrlToFile(project.thumbnail));
    }

    const remoteGraphs = await apiListGraphs(remoteProject.id);
    const graphNameCounts = new Map<string, number>();
    const ensureUniqueGraphName = (name: string): string => {
      const normalized = name.trim() || getDefaultLocalGraphName();
      const currentCount = graphNameCounts.get(normalized.toLowerCase()) ?? 0;
      graphNameCounts.set(normalized.toLowerCase(), currentCount + 1);
      return currentCount === 0 ? normalized : `${normalized} (${currentCount + 1})`;
    };
    const remoteGraphIdsByName = new Map<string, string>();
    const sourceGraphs = project.graphs.length > 0 ? project.graphs : [{ name: getDefaultLocalGraphName(), data: createEmptyGraphData(), thumbnail: null }];
    const firstSourceGraph = sourceGraphs[0];
    const defaultRemoteGraphId = remoteGraphs.activeGraphId ?? remoteGraphs.graphs[0]?.id ?? null;

    if (firstSourceGraph) {
      const firstGraphName = ensureUniqueGraphName(firstSourceGraph.name);
      if (defaultRemoteGraphId) {
        await apiRenameGraph(remoteProject.id, defaultRemoteGraphId, firstGraphName);
        await apiSaveGraph(firstSourceGraph.data, remoteProject.id, defaultRemoteGraphId);
        if (firstSourceGraph.thumbnail) await apiPutThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/graphs/${encodeURIComponent(defaultRemoteGraphId)}/thumbnail`, dataUrlToFile(firstSourceGraph.thumbnail));
        remoteGraphIdsByName.set(firstGraphName, defaultRemoteGraphId);
      } else {
        const createdGraph = await apiCreateGraph(remoteProject.id, firstGraphName);
        await apiSaveGraph(firstSourceGraph.data, remoteProject.id, createdGraph.id);
        if (firstSourceGraph.thumbnail) await apiPutThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/graphs/${encodeURIComponent(createdGraph.id)}/thumbnail`, dataUrlToFile(firstSourceGraph.thumbnail));
        remoteGraphIdsByName.set(firstGraphName, createdGraph.id);
      }
    }

    for (const graph of sourceGraphs.slice(1)) {
      const graphName = ensureUniqueGraphName(graph.name);
      const createdGraph = await apiCreateGraph(remoteProject.id, graphName);
      await apiSaveGraph(graph.data, remoteProject.id, createdGraph.id);
      if (graph.thumbnail) await apiPutThumbnail(`/projects/${encodeURIComponent(remoteProject.id)}/graphs/${encodeURIComponent(createdGraph.id)}/thumbnail`, dataUrlToFile(graph.thumbnail));
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
      name: ensureUniqueName(project.name, new Set<string>(), getDefaultLocalProjectName())
    }))
  });
}

export async function captureRemoteWorkspaceToLocal(): Promise<void> {
  const remoteSnapshot = await getRemoteWorkspaceSnapshot();
  writeLocalWorkspace(snapshotToWorkspace(remoteSnapshot));
}
