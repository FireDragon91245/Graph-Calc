const API_BASE = "http://localhost:8000";

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
  const response = await fetch(`${API_BASE}/projects`);
  if (!response.ok) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }
  return response.json();
}

export async function createProject(name: string): Promise<Project> {
  const response = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(`Failed to create project: ${response.statusText}`);
  }
  return response.json();
}

export async function activateProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(`Failed to activate project: ${response.statusText}`);
  }
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(`Failed to rename project: ${response.statusText}`);
  }
}

export async function copyProject(projectId: string, name: string): Promise<Project> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(`Failed to copy project: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`Failed to delete project: ${response.statusText}`);
  }
}

// ── Graph management API (per-project) ─────────────────────────

export async function listGraphs(projectId: string): Promise<GraphsResponse> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/graphs`);
  if (!response.ok) {
    throw new Error(`Failed to list graphs: ${response.statusText}`);
  }
  return response.json();
}

export async function createGraph(projectId: string, name: string): Promise<GraphInfo> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/graphs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(`Failed to create graph: ${response.statusText}`);
  }
  return response.json();
}

export async function activateGraph(projectId: string, graphId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/graphs/${graphId}/activate`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(`Failed to activate graph: ${response.statusText}`);
  }
}

export async function renameGraph(projectId: string, graphId: string, name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/graphs/${graphId}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(`Failed to rename graph: ${response.statusText}`);
  }
}

export async function copyGraph(projectId: string, graphId: string, name: string): Promise<GraphInfo> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/graphs/${graphId}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(`Failed to copy graph: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteGraph(projectId: string, graphId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/graphs/${graphId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`Failed to delete graph: ${response.statusText}`);
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
  const response = await fetch(`${API_BASE}/graph${qs(projectId, graphId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load graph: ${response.statusText}`);
  }
  return response.json();
}

export async function saveGraph(graph: GraphData, projectId?: string, graphId?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/graph${qs(projectId, graphId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(graph)
  });
  if (!response.ok) {
    throw new Error(`Failed to save graph: ${response.statusText}`);
  }
}

export async function loadStore(projectId?: string): Promise<StoreData> {
  const response = await fetch(`${API_BASE}/store${qs(projectId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load store: ${response.statusText}`);
  }
  return response.json();
}

export async function saveStore(store: StoreData, projectId?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/store${qs(projectId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(store)
  });
  if (!response.ok) {
    throw new Error(`Failed to save store: ${response.statusText}`);
  }
}
