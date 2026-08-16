import { create } from "zustand";
import { saveStore, StoreData } from "../api/persistence";
import type { RecipeBlueprint } from "../domain/recipeBlueprint";
import type {
  ModuleDefinition,
  ModuleSystemDefinition,
  RecipeModuleSupport
} from "../domain/moduleSystem";
import i18n from "../i18n";

type Category = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  name: string;
  categoryId?: string;
};

type Tag = {
  id: string;
  name: string;
  memberItemIds: string[];
};

type RecipeTag = {
  id: string;
  name: string;
  memberRecipeIds: string[];
};

type RecipeInput = {
  id: string;
  refType: "item" | "tag";
  refId: string;
  amount: number;
};

type RecipeOutput = {
  id: string;
  itemId: string;
  amount: number;
  probability: number;
};

type Recipe = {
  id: string;
  name: string;
  timeSeconds: number;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  moduleSupport?: RecipeModuleSupport[];
};

type GraphStore = {
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  activeGraphId: string | null;
  setActiveGraphId: (id: string | null) => void;
  categories: Category[];
  items: Item[];
  tags: Tag[];
  recipeTags: RecipeTag[];
  recipes: Recipe[];
  recipeBlueprints: RecipeBlueprint[];
  moduleDefinitions: ModuleDefinition[];
  moduleSystems: ModuleSystemDefinition[];
  projectRevision: number;
  addCategory: (name: string) => void;
  deleteCategory: (categoryId: string) => void;
  renameCategory: (categoryId: string, newName: string) => void;
  addItem: (item: Omit<Item, "id"> & { id?: string }) => void;
  deleteItem: (itemId: string) => void;
  renameItem: (itemId: string, newName: string) => void;
  addTag: (tag: Omit<Tag, "id"> & { id?: string }) => void;
  deleteTag: (tagId: string) => void;
  renameTag: (tagId: string, newName: string) => void;
  addRecipeTag: (recipeTag: Omit<RecipeTag, "id"> & { id?: string }) => void;
  deleteRecipeTag: (recipeTagId: string) => void;
  renameRecipeTag: (recipeTagId: string, newName: string) => void;
  addRecipe: (recipe: Omit<Recipe, "id"> & { id?: string }) => void;
  addRecipesBatch: (recipes: Recipe[], recipeTagIds: string[]) => { added: number; skipped: number };
  deleteRecipe: (recipeId: string) => void;
  renameRecipe: (recipeId: string, newName: string) => void;
  upsertRecipeBlueprint: (blueprint: RecipeBlueprint) => void;
  deleteRecipeBlueprint: (blueprintId: string) => void;
  upsertModuleDefinition: (definition: ModuleDefinition) => void;
  deleteModuleDefinition: (definitionId: string) => void;
  upsertModuleSystem: (system: ModuleSystemDefinition) => void;
  deleteModuleSystem: (systemId: string) => void;
  loadStoreData: (data: StoreData) => void;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getRecipeSignature = (recipe: Recipe) => {
  const inputs = recipe.inputs
    .map((input) => `${input.refType}:${input.refId}:${input.amount}`)
    .sort()
    .join("|");
  const outputs = recipe.outputs
    .map((output) => `${output.itemId}:${output.amount}:${output.probability}`)
    .sort()
    .join("|");
  return `${recipe.timeSeconds}::${inputs}=>${outputs}`;
};

// Debounced save function
let saveTimeout: number | null = null;
let storeSaveInFlight: Promise<void> | null = null;
let pendingStoreSave: { data: StoreData; projectId: string } | null = null;

const buildStoreData = (state: Pick<GraphStore, "categories" | "items" | "tags" | "recipeTags" | "recipes" | "recipeBlueprints" | "moduleDefinitions" | "moduleSystems" | "projectRevision">): StoreData => ({
  schemaVersion: 3,
  projectRevision: state.projectRevision,
  categories: state.categories,
  items: state.items,
  tags: state.tags,
  recipeTags: state.recipeTags,
  recipes: state.recipes,
  recipeBlueprints: state.recipeBlueprints,
  moduleDefinitions: state.moduleDefinitions,
  moduleSystems: state.moduleSystems
});

const withRevision = <T extends object>(state: GraphStore, update: T): T & { projectRevision: number } => ({
  ...update,
  projectRevision: state.projectRevision + 1
});

const confirmGraphImpact = (message: string): boolean =>
  typeof window === "undefined" || window.confirm(message);

const finalizeProjectUpdate = <T extends object>(state: GraphStore, update: T): T & { projectRevision: number } => {
  const next = "projectRevision" in update
    ? update as T & { projectRevision: number }
    : withRevision(state, update);
  debouncedSave({ ...state, ...next });
  return next;
};

const flushStoreSave = async (): Promise<void> => {
  if (storeSaveInFlight) {
    await storeSaveInFlight;
  }

  if (!pendingStoreSave) {
    return;
  }

  const saveJob = pendingStoreSave;
  pendingStoreSave = null;

  storeSaveInFlight = saveStore(saveJob.data, saveJob.projectId)
    .catch((err) => {
      console.error("Failed to auto-save store:", err);
    })
    .finally(() => {
      storeSaveInFlight = null;
    });

  await storeSaveInFlight;
  if (pendingStoreSave) {
    await flushStoreSave();
  }
};

const debouncedSave = (state: GraphStore) => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    if (!state.activeProjectId) {
      return;
    }

    pendingStoreSave = { data: buildStoreData(state), projectId: state.activeProjectId };
    void flushStoreSave();
  }, 300); // 300ms debounce
};

export async function flushPendingStoreSave(): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  const state = useGraphStore.getState();
  if (state.activeProjectId) {
    pendingStoreSave = {
      data: buildStoreData(state),
      projectId: state.activeProjectId
    };
  }

  await flushStoreSave();
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  activeProjectId: null,
  setActiveProjectId: (id) => set({ activeProjectId: id }),
  activeGraphId: null,
  setActiveGraphId: (id) => set({ activeGraphId: id }),
  categories: [],
  items: [],
  tags: [],
  recipeTags: [],
  recipes: [],
  recipeBlueprints: [],
  moduleDefinitions: [],
  moduleSystems: [],
  projectRevision: 0,
  addCategory: (name) =>
    set((state) => {
      const newState = {
        categories: [
          ...state.categories,
          { id: slugify(name || `category_${state.categories.length + 1}`), name }
        ]
      };
      return finalizeProjectUpdate(state, newState);
    }),
  deleteCategory: (categoryId) =>
    set((state) => {
      const category = state.categories.find((entry) => entry.id === categoryId);
      if (category && !confirmGraphImpact(`Deleting category "${category.name}" can change item and module eligibility across project graphs. Continue?`)) return state;
      const newState = {
        categories: state.categories.filter((c) => c.id !== categoryId),
        items: state.items.map((item) =>
          item.categoryId === categoryId
            ? { ...item, categoryId: undefined }
            : item
        )
      };
      return finalizeProjectUpdate(state, newState);
    }),
  renameCategory: (categoryId, newName) =>
    set((state) => {
      const category = state.categories.find((entry) => entry.id === categoryId);
      if (category && category.name !== newName && !confirmGraphImpact(`Renaming category "${category.name}" can update nodes and module rules across project graphs. Continue?`)) return state;
      const newState = {
        categories: state.categories.map((c) =>
          c.id === categoryId ? { ...c, name: newName } : c
        )
      };
      return finalizeProjectUpdate(state, newState);
    }),
  addItem: (item) =>
    set((state) => {
      const itemId = item.id ?? slugify(item.name || `item_${state.items.length + 1}`);
      
      // Check if item with same name already exists (but different ID)
      const existingByName = state.items.find(
        (i) => i.name === item.name && i.id !== itemId
      );
      if (existingByName) {
        alert(i18n.t("ui.validation.itemExists", { name: item.name }));
        return state;
      }
      
      // Check if updating existing item or adding new one
      const existingIndex = state.items.findIndex((i) => i.id === itemId);
      if (existingIndex >= 0 && !confirmGraphImpact(`Updating item "${state.items[existingIndex].name}" will propagate to every affected graph node. Continue?`)) return state;
      let newState;
      if (existingIndex >= 0) {
        // Update existing item
        const newItems = [...state.items];
        newItems[existingIndex] = {
          id: itemId,
          name: item.name,
          categoryId: item.categoryId
        };
        newState = { items: newItems };
      } else {
        // Add new item
        newState = {
          items: [
            ...state.items,
            {
              id: itemId,
              name: item.name,
              categoryId: item.categoryId
            }
          ]
        };
      }
      return finalizeProjectUpdate(state, newState);
    }),
  deleteItem: (itemId) =>
    set((state) => {
      const item = state.items.find((entry) => entry.id === itemId);
      if (item && !confirmGraphImpact(`Deleting item "${item.name}" can invalidate recipes, modules, and graph edges. Continue?`)) return state;
      const newState = {
        items: state.items.filter((i) => i.id !== itemId),
        // Remove item from all tags
        tags: state.tags.map((tag) => ({
          ...tag,
          memberItemIds: tag.memberItemIds.filter((id) => id !== itemId)
        }))
      };
      return finalizeProjectUpdate(state, newState);
    }),
  renameItem: (itemId, newName) =>
    set((state) => {
      const currentItem = state.items.find((entry) => entry.id === itemId);
      if (currentItem && currentItem.name !== newName && !confirmGraphImpact(`Renaming item "${currentItem.name}" will update every affected graph node. Continue?`)) return state;
      // Check if new name conflicts with another item
      const existingByName = state.items.find(
        (i) => i.name === newName && i.id !== itemId
      );
      if (existingByName) {
        alert(i18n.t("ui.validation.itemExists", { name: newName }));
        return state;
      }
      
      const newState = {
        items: state.items.map((item) =>
          item.id === itemId ? { ...item, name: newName } : item
        )
      };
      return finalizeProjectUpdate(state, newState);
    }),
  addTag: (tag) =>
    set((state) => {
      const tagId = tag.id ?? tag.name;
      
      // Check if updating existing tag or adding new one
      const existingIndex = state.tags.findIndex((t) => t.id === tagId);
      if (existingIndex >= 0 && !confirmGraphImpact(`Updating tag "${state.tags[existingIndex].name}" can change recipe inputs and project graphs. Continue?`)) return state;
      let newState;
      if (existingIndex >= 0) {
        // Update existing tag
        const newTags = [...state.tags];
        newTags[existingIndex] = {
          id: tagId,
          name: tag.name,
          memberItemIds: tag.memberItemIds
        };
        newState = { tags: newTags };
      } else {
        // Add new tag
        newState = {
          tags: [
            ...state.tags,
            {
              id: tagId,
              name: tag.name,
              memberItemIds: tag.memberItemIds
            }
          ]
        };
      }
      return finalizeProjectUpdate(state, newState);
    }),
  deleteTag: (tagId) =>
    set((state) => {
      const currentTag = state.tags.find((entry) => entry.id === tagId);
      if (currentTag && !confirmGraphImpact(`Deleting tag "${currentTag.name}" removes affected recipe inputs and updates project graphs. Continue?`)) return state;
      const newState = {
        tags: state.tags.filter((t) => t.id !== tagId),
        // Update recipes that reference this tag in inputs
        recipes: state.recipes.map((recipe) => ({
          ...recipe,
          inputs: recipe.inputs.filter(
            (input) => !(input.refType === "tag" && input.refId === tagId)
          )
        }))
      };
      return finalizeProjectUpdate(state, newState);
    }),
  renameTag: (tagId, newName) =>
    set((state) => {
      const formattedName = newName.startsWith("@") ? newName : `@${newName}`;
      const currentTag = state.tags.find((entry) => entry.id === tagId);
      if (currentTag && currentTag.name !== formattedName && !confirmGraphImpact(`Renaming tag "${currentTag.name}" updates every affected graph node. Continue?`)) return state;
      // Check if new name conflicts
      const existingByName = state.tags.find(
        (t) => t.name === formattedName && t.id !== tagId
      );
      if (existingByName) {
        alert(i18n.t("ui.validation.tagExists", { name: formattedName }));
        return state;
      }
      
      const newState = {
        tags: state.tags.map((tag) =>
          tag.id === tagId ? { ...tag, name: formattedName } : tag
        )
      };
      return finalizeProjectUpdate(state, newState);
    }),
  addRecipeTag: (recipeTag) =>
    set((state) => {
      const recipeTagId = recipeTag.id ?? recipeTag.name;
      
      // Check if updating existing recipe tag or adding new one
      const existingIndex = state.recipeTags.findIndex((rt) => rt.id === recipeTagId);
      if (existingIndex >= 0 && !confirmGraphImpact(`Updating recipe tag "${state.recipeTags[existingIndex].name}" changes every graph node that uses it. Continue?`)) return state;
      let newState;
      if (existingIndex >= 0) {
        // Update existing recipe tag
        const newRecipeTags = [...state.recipeTags];
        newRecipeTags[existingIndex] = {
          id: recipeTagId,
          name: recipeTag.name,
          memberRecipeIds: recipeTag.memberRecipeIds
        };
        newState = { recipeTags: newRecipeTags };
      } else {
        // Add new recipe tag
        newState = {
          recipeTags: [
            ...state.recipeTags,
            {
              id: recipeTagId,
              name: recipeTag.name,
              memberRecipeIds: recipeTag.memberRecipeIds
            }
          ]
        };
      }
      return finalizeProjectUpdate(state, newState);
    }),
  deleteRecipeTag: (recipeTagId) =>
    set((state) => {
      const currentTag = state.recipeTags.find((entry) => entry.id === recipeTagId);
      if (currentTag && !confirmGraphImpact(`Deleting recipe tag "${currentTag.name}" leaves affected graph nodes unresolved. Continue?`)) return state;
      const newState = {
        recipeTags: state.recipeTags.filter((rt) => rt.id !== recipeTagId)
      };
      return finalizeProjectUpdate(state, newState);
    }),
  renameRecipeTag: (recipeTagId, newName) =>
    set((state) => {
      const formattedName = newName.startsWith("@") ? newName : `@${newName}`;
      const currentTag = state.recipeTags.find((entry) => entry.id === recipeTagId);
      if (currentTag && currentTag.name !== formattedName && !confirmGraphImpact(`Renaming recipe tag "${currentTag.name}" updates every affected graph node. Continue?`)) return state;
      // Check if new name conflicts
      const existingByName = state.recipeTags.find(
        (rt) => rt.name === formattedName && rt.id !== recipeTagId
      );
      if (existingByName) {
        alert(i18n.t("ui.validation.recipeTagExists", { name: formattedName }));
        return state;
      }
      
      const newState = {
        recipeTags: state.recipeTags.map((rt) =>
          rt.id === recipeTagId ? { ...rt, name: formattedName } : rt
        )
      };
      return finalizeProjectUpdate(state, newState);
    }),
  addRecipe: (recipe) =>
    set((state) => {
      const recipeId = recipe.id ?? slugify(recipe.name || `recipe_${state.recipes.length + 1}`);
      
      // Check if updating existing recipe or adding new one
      const existingIndex = state.recipes.findIndex((r) => r.id === recipeId);
      if (existingIndex >= 0 && !confirmGraphImpact(`Updating recipe "${state.recipes[existingIndex].name}" changes its nodes in every project graph. Continue?`)) return state;
      let newState;
      if (existingIndex >= 0) {
        // Update existing recipe
        const newRecipes = [...state.recipes];
        newRecipes[existingIndex] = {
          id: recipeId,
          name: recipe.name,
          timeSeconds: recipe.timeSeconds,
          inputs: recipe.inputs,
          outputs: recipe.outputs,
          moduleSupport: recipe.moduleSupport ?? []
        };
        newState = { recipes: newRecipes };
      } else {
        // Add new recipe
        newState = {
          recipes: [
            ...state.recipes,
            {
              id: recipeId,
              name: recipe.name,
              timeSeconds: recipe.timeSeconds,
              inputs: recipe.inputs,
              outputs: recipe.outputs,
              moduleSupport: recipe.moduleSupport ?? []
            }
          ]
        };
      }
      return finalizeProjectUpdate(state, newState);
    }),
  addRecipesBatch: (incomingRecipes, recipeTagIds) => {
    let result = { added: 0, skipped: 0 };
    set((state) => {
      const existingIds = new Set(state.recipes.map((recipe) => recipe.id));
      const existingNames = new Set(state.recipes.map((recipe) => recipe.name.toLowerCase()));
      const existingSignatures = new Set(state.recipes.map(getRecipeSignature));
      const accepted: Recipe[] = [];
      for (const recipe of incomingRecipes) {
        const signature = getRecipeSignature(recipe);
        if (existingIds.has(recipe.id) || existingNames.has(recipe.name.toLowerCase()) || existingSignatures.has(signature)) {
          result.skipped += 1;
          continue;
        }
        existingIds.add(recipe.id);
        existingNames.add(recipe.name.toLowerCase());
        existingSignatures.add(signature);
        accepted.push(recipe);
      }
      result.added = accepted.length;
      if (accepted.length === 0) return state;
      if (recipeTagIds.length > 0 && !confirmGraphImpact(`Adding ${accepted.length} recipes to recipe tags changes matching nodes across project graphs. Continue?`)) {
        result = { added: 0, skipped: result.skipped };
        return state;
      }
      const acceptedIds = accepted.map((recipe) => recipe.id);
      const newState = {
        recipes: [...state.recipes, ...accepted],
        recipeTags: state.recipeTags.map((tag) =>
          recipeTagIds.includes(tag.id)
            ? { ...tag, memberRecipeIds: Array.from(new Set([...tag.memberRecipeIds, ...acceptedIds])) }
            : tag
        ),
      };
      return finalizeProjectUpdate(state, newState);
    });
    return result;
  },
  deleteRecipe: (recipeId) =>
    set((state) => {
      const currentRecipe = state.recipes.find((entry) => entry.id === recipeId);
      if (currentRecipe && !confirmGraphImpact(`Deleting recipe "${currentRecipe.name}" leaves its graph nodes unresolved and changes recipe tags. Continue?`)) return state;
      const newState = {
        recipes: state.recipes.filter((r) => r.id !== recipeId),
        // Remove recipe from all recipe tags
        recipeTags: state.recipeTags.map((rt) => ({
          ...rt,
          memberRecipeIds: rt.memberRecipeIds.filter((id) => id !== recipeId)
        }))
      };
      return finalizeProjectUpdate(state, newState);
    }),
  renameRecipe: (recipeId, newName) =>
    set((state) => {
      const currentRecipe = state.recipes.find((entry) => entry.id === recipeId);
      if (currentRecipe && currentRecipe.name !== newName && !confirmGraphImpact(`Renaming recipe "${currentRecipe.name}" updates every affected graph node. Continue?`)) return state;
      // Check if new name conflicts
      const existingByName = state.recipes.find(
        (r) => r.name === newName && r.id !== recipeId
      );
      if (existingByName) {
        alert(i18n.t("ui.validation.recipeExists", { name: newName }));
        return state;
      }
      
      const newState = {
        recipes: state.recipes.map((recipe) =>
          recipe.id === recipeId ? { ...recipe, name: newName } : recipe
        )
      };
      return finalizeProjectUpdate(state, newState);
    }),
  upsertRecipeBlueprint: (blueprint) =>
    set((state) => {
      const exists = state.recipeBlueprints.some((entry) => entry.id === blueprint.id);
      const newState = {
        recipeBlueprints: exists
          ? state.recipeBlueprints.map((entry) => (entry.id === blueprint.id ? blueprint : entry))
          : [...state.recipeBlueprints, blueprint]
      };
      return finalizeProjectUpdate(state, newState);
    }),
  deleteRecipeBlueprint: (blueprintId) =>
    set((state) => {
      const newState = { recipeBlueprints: state.recipeBlueprints.filter((entry) => entry.id !== blueprintId) };
      return finalizeProjectUpdate(state, newState);
    }),
  upsertModuleDefinition: (definition) =>
    set((state) => {
      if (!state.moduleSystems.some((system) => system.id === definition.systemId && !system.archived)) {
        alert(`Module "${definition.name}" must belong to an active upgrade system.`);
        return state;
      }
      const existing = state.moduleDefinitions.some((entry) => entry.id === definition.id);
      if (existing && !confirmGraphImpact(`Updating module "${definition.name}" can change recipe nodes in every graph. Apply this project-wide update?`)) {
        return state;
      }
      const newState = withRevision(state, {
        moduleDefinitions: existing
          ? state.moduleDefinitions.map((entry) => entry.id === definition.id ? definition : entry)
          : [...state.moduleDefinitions, definition]
      });
      return finalizeProjectUpdate(state, newState);
    }),
  deleteModuleDefinition: (definitionId) =>
    set((state) => {
      const definition = state.moduleDefinitions.find((entry) => entry.id === definitionId);
      if (!definition || !confirmGraphImpact(`Removing module "${definition.name}" can invalidate module slots in project graphs. Continue?`)) return state;
      const newState = withRevision(state, {
        moduleDefinitions: state.moduleDefinitions.map((entry) => entry.id === definitionId ? { ...entry, archived: true } : entry)
      });
      return finalizeProjectUpdate(state, newState);
    }),
  upsertModuleSystem: (system) =>
    set((state) => {
      const existing = state.moduleSystems.some((entry) => entry.id === system.id);
      if (existing && !confirmGraphImpact(`Updating upgrade system "${system.name}" can alter node controls, ports, and solver rates in every graph. Apply this project-wide update?`)) {
        return state;
      }
      const nextSystem = existing ? { ...system, revision: system.revision + 1 } : system;
      const newState = withRevision(state, {
        moduleSystems: existing
          ? state.moduleSystems.map((entry) => entry.id === system.id ? nextSystem : entry)
          : [...state.moduleSystems, nextSystem]
      });
      return finalizeProjectUpdate(state, newState);
    }),
  deleteModuleSystem: (systemId) =>
    set((state) => {
      const system = state.moduleSystems.find((entry) => entry.id === systemId);
      if (!system || !confirmGraphImpact(`Removing upgrade system "${system.name}" affects every recipe and graph node that uses it. Continue?`)) return state;
      const newState = withRevision(state, {
        moduleSystems: state.moduleSystems.map((entry) => entry.id === systemId ? { ...entry, archived: true } : entry),
        moduleDefinitions: state.moduleDefinitions.map((entry) => entry.systemId === systemId ? { ...entry, archived: true } : entry)
      });
      return finalizeProjectUpdate(state, newState);
    }),
  loadStoreData: (data) =>
    set(() => ({
      categories: data.categories,
      items: data.items,
      tags: data.tags,
      recipeTags: data.recipeTags,
      recipes: data.recipes,
      recipeBlueprints: data.recipeBlueprints ?? [],
      moduleDefinitions: data.moduleDefinitions ?? [],
      moduleSystems: data.moduleSystems ?? [],
      projectRevision: data.projectRevision ?? 0
    }))
}));

export type {
  Category,
  Item,
  Tag,
  RecipeTag,
  Recipe,
  RecipeInput,
  RecipeOutput,
  RecipeBlueprint,
  ModuleDefinition,
  ModuleSystemDefinition,
  RecipeModuleSupport
};
