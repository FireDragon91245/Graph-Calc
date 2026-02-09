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
  medium: "item" | "fluid" | "gas";
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

export async function loadGraph(): Promise<GraphData> {
  const response = await fetch(`${API_BASE}/graph`);
  if (!response.ok) {
    throw new Error(`Failed to load graph: ${response.statusText}`);
  }
  return response.json();
}

export async function saveGraph(graph: GraphData): Promise<void> {
  const response = await fetch(`${API_BASE}/graph`, {
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

export async function loadStore(): Promise<StoreData> {
  const response = await fetch(`${API_BASE}/store`);
  if (!response.ok) {
    throw new Error(`Failed to load store: ${response.statusText}`);
  }
  return response.json();
}

export async function saveStore(store: StoreData): Promise<void> {
  const response = await fetch(`${API_BASE}/store`, {
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
