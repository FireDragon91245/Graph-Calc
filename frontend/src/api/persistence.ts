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

// ── Project API ────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectsResponse> {
  const response = await apiFetch("/projects");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to list projects"));
  }
  return response.json();
}

export async function createProject(name: string): Promise<Project> {
  const response = await apiFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to create project"));
  }
  return response.json();
}

export async function activateProject(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to activate project"));
  }
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/rename`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to rename project"));
  }
}

export async function copyProject(projectId: string, name: string): Promise<Project> {
  const response = await apiFetch(`/projects/${projectId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to copy project"));
  }
  return response.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to delete project"));
  }
}

// ── Graph management API (per-project) ─────────────────────────

export async function listGraphs(projectId: string): Promise<GraphsResponse> {
  const response = await apiFetch(`/projects/${projectId}/graphs`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to list graphs"));
  }
  return response.json();
}

export async function createGraph(projectId: string, name: string): Promise<GraphInfo> {
  const response = await apiFetch(`/projects/${projectId}/graphs`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to create graph"));
  }
  return response.json();
}

export async function activateGraph(projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to activate graph"));
  }
}

export async function renameGraph(projectId: string, graphId: string, name: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/rename`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to rename graph"));
  }
}

export async function copyGraph(projectId: string, graphId: string, name: string): Promise<GraphInfo> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to copy graph"));
  }
  return response.json();
}

export async function deleteGraph(projectId: string, graphId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/graphs/${graphId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to delete graph"));
  }
}

// ── Graph / Store (project-scoped) ─────────────────────────────

function qs(projectId?: string, graphId?: string): string {
  const params: string[] = [];
  if (projectId) params.push(`project_id=${encodeURIComponent(projectId)}`);
  if (graphId) params.push(`graph_id=${encodeURIComponent(graphId)}`);
  return params.length > 0 ? `?${params.join("&")}` : "";
}

export async function loadGraph(projectId?: string, graphId?: string): Promise<GraphData> {
  const response = await apiFetch(`/graph${qs(projectId, graphId)}`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load graph"));
  }
  return response.json();
}

export async function saveGraph(graph: GraphData, projectId?: string, graphId?: string): Promise<void> {
  const response = await apiFetch(`/graph${qs(projectId, graphId)}`, {
    method: "POST",
    body: JSON.stringify(graph)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to save graph"));
  }
}

export async function loadStore(projectId?: string): Promise<StoreData> {
  const response = await apiFetch(`/store${qs(projectId)}`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load store"));
  }
  return response.json();
}

export async function saveStore(store: StoreData, projectId?: string): Promise<void> {
  const response = await apiFetch(`/store${qs(projectId)}`, {
    method: "POST",
    body: JSON.stringify(store)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to save store"));
  }
}
