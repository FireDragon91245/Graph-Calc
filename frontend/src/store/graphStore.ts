import { create } from "zustand";
import { saveStore, StoreData } from "../api/persistence";

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
  deleteRecipe: (recipeId: string) => void;
  renameRecipe: (recipeId: string, newName: string) => void;
  loadStoreData: (data: StoreData) => void;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Debounced save function
let saveTimeout: number | null = null;
let storeSaveInFlight = false;
let pendingStoreSave: { data: StoreData; projectId?: string } | null = null;

const flushStoreSave = () => {
  if (storeSaveInFlight || !pendingStoreSave) {
    return;
  }

  const saveJob = pendingStoreSave;
  pendingStoreSave = null;
  storeSaveInFlight = true;

  saveStore(saveJob.data, saveJob.projectId)
    .catch((err) => {
      console.error("Failed to auto-save store:", err);
    })
    .finally(() => {
      storeSaveInFlight = false;
      if (pendingStoreSave) {
        flushStoreSave();
      }
    });
};

const debouncedSave = (state: GraphStore) => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    const dataToSave: StoreData = {
      categories: state.categories,
      items: state.items,
      tags: state.tags,
      recipeTags: state.recipeTags,
      recipes: state.recipes
    };
    const projectId = state.activeProjectId ?? undefined;
    pendingStoreSave = { data: dataToSave, projectId };
    flushStoreSave();
  }, 300); // 300ms debounce
};

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
  addCategory: (name) =>
    set((state) => {
      const newState = {
        categories: [
          ...state.categories,
          { id: slugify(name || `category_${state.categories.length + 1}`), name }
        ]
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  deleteCategory: (categoryId) =>
    set((state) => {
      const newState = {
        categories: state.categories.filter((c) => c.id !== categoryId),
        items: state.items.map((item) =>
          item.categoryId === categoryId
            ? { ...item, categoryId: undefined }
            : item
        )
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  renameCategory: (categoryId, newName) =>
    set((state) => {
      const newState = {
        categories: state.categories.map((c) =>
          c.id === categoryId ? { ...c, name: newName } : c
        )
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  addItem: (item) =>
    set((state) => {
      const itemId = item.id ?? slugify(item.name || `item_${state.items.length + 1}`);
      
      // Check if item with same name already exists (but different ID)
      const existingByName = state.items.find(
        (i) => i.name === item.name && i.id !== itemId
      );
      if (existingByName) {
        alert(`Item "${item.name}" already exists!`);
        return state;
      }
      
      // Check if updating existing item or adding new one
      const existingIndex = state.items.findIndex((i) => i.id === itemId);
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
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  deleteItem: (itemId) =>
    set((state) => {
      const newState = {
        items: state.items.filter((i) => i.id !== itemId),
        // Remove item from all tags
        tags: state.tags.map((tag) => ({
          ...tag,
          memberItemIds: tag.memberItemIds.filter((id) => id !== itemId)
        }))
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  renameItem: (itemId, newName) =>
    set((state) => {
      // Check if new name conflicts with another item
      const existingByName = state.items.find(
        (i) => i.name === newName && i.id !== itemId
      );
      if (existingByName) {
        alert(`Item "${newName}" already exists!`);
        return state;
      }
      
      const newState = {
        items: state.items.map((item) =>
          item.id === itemId ? { ...item, name: newName } : item
        )
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  addTag: (tag) =>
    set((state) => {
      const tagId = tag.id ?? tag.name;
      
      // Check if updating existing tag or adding new one
      const existingIndex = state.tags.findIndex((t) => t.id === tagId);
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
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  deleteTag: (tagId) =>
    set((state) => {
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
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  renameTag: (tagId, newName) =>
    set((state) => {
      const formattedName = newName.startsWith("@") ? newName : `@${newName}`;
      // Check if new name conflicts
      const existingByName = state.tags.find(
        (t) => t.name === formattedName && t.id !== tagId
      );
      if (existingByName) {
        alert(`Tag "${formattedName}" already exists!`);
        return state;
      }
      
      const newState = {
        tags: state.tags.map((tag) =>
          tag.id === tagId ? { ...tag, name: formattedName } : tag
        )
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  addRecipeTag: (recipeTag) =>
    set((state) => {
      const recipeTagId = recipeTag.id ?? recipeTag.name;
      
      // Check if updating existing recipe tag or adding new one
      const existingIndex = state.recipeTags.findIndex((rt) => rt.id === recipeTagId);
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
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  deleteRecipeTag: (recipeTagId) =>
    set((state) => {
      const newState = {
        recipeTags: state.recipeTags.filter((rt) => rt.id !== recipeTagId)
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  renameRecipeTag: (recipeTagId, newName) =>
    set((state) => {
      const formattedName = newName.startsWith("@") ? newName : `@${newName}`;
      // Check if new name conflicts
      const existingByName = state.recipeTags.find(
        (rt) => rt.name === formattedName && rt.id !== recipeTagId
      );
      if (existingByName) {
        alert(`Recipe Tag "${formattedName}" already exists!`);
        return state;
      }
      
      const newState = {
        recipeTags: state.recipeTags.map((rt) =>
          rt.id === recipeTagId ? { ...rt, name: formattedName } : rt
        )
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  addRecipe: (recipe) =>
    set((state) => {
      const recipeId = recipe.id ?? slugify(recipe.name || `recipe_${state.recipes.length + 1}`);
      
      // Check if updating existing recipe or adding new one
      const existingIndex = state.recipes.findIndex((r) => r.id === recipeId);
      let newState;
      if (existingIndex >= 0) {
        // Update existing recipe
        const newRecipes = [...state.recipes];
        newRecipes[existingIndex] = {
          id: recipeId,
          name: recipe.name,
          timeSeconds: recipe.timeSeconds,
          inputs: recipe.inputs,
          outputs: recipe.outputs
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
              outputs: recipe.outputs
            }
          ]
        };
      }
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  deleteRecipe: (recipeId) =>
    set((state) => {
      const newState = {
        recipes: state.recipes.filter((r) => r.id !== recipeId),
        // Remove recipe from all recipe tags
        recipeTags: state.recipeTags.map((rt) => ({
          ...rt,
          memberRecipeIds: rt.memberRecipeIds.filter((id) => id !== recipeId)
        }))
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  renameRecipe: (recipeId, newName) =>
    set((state) => {
      // Check if new name conflicts
      const existingByName = state.recipes.find(
        (r) => r.name === newName && r.id !== recipeId
      );
      if (existingByName) {
        alert(`Recipe "${newName}" already exists!`);
        return state;
      }
      
      const newState = {
        recipes: state.recipes.map((recipe) =>
          recipe.id === recipeId ? { ...recipe, name: newName } : recipe
        )
      };
      debouncedSave({ ...state, ...newState });
      return newState;
    }),
  loadStoreData: (data) =>
    set(() => ({
      categories: data.categories,
      items: data.items,
      tags: data.tags,
      recipeTags: data.recipeTags,
      recipes: data.recipes
    }))
}));

export type { Category, Item, Tag, RecipeTag, Recipe, RecipeInput, RecipeOutput };
