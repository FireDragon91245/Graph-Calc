import { create } from "zustand";
import { saveStore, StoreData } from "../api/persistence";

type Medium = "item" | "fluid" | "gas";

type Category = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  name: string;
  medium: Medium;
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
  categories: Category[];
  items: Item[];
  tags: Tag[];
  recipeTags: RecipeTag[];
  recipes: Recipe[];
  addCategory: (name: string) => void;
  deleteCategory: (categoryId: string) => void;
  renameCategory: (categoryId: string, newName: string) => void;
  addItem: (item: Omit<Item, "id"> & { id?: string }) => void;
  addTag: (tag: Omit<Tag, "id"> & { id?: string }) => void;
  addRecipeTag: (recipeTag: Omit<RecipeTag, "id"> & { id?: string }) => void;
  addRecipe: (recipe: Omit<Recipe, "id"> & { id?: string }) => void;
  loadStoreData: (data: StoreData) => void;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Debounced save function
let saveTimeout: NodeJS.Timeout | null = null;
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
    saveStore(dataToSave).catch((err) => {
      console.error("Failed to auto-save store:", err);
    });
  }, 300); // 300ms debounce
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  categories: [
    { id: "ore", name: "Ore" },
    { id: "ingot", name: "Ingot" }
  ],
  items: [
    { id: "iron_ore", name: "Iron Ore", medium: "item", categoryId: "ore" },
    { id: "iron_dust", name: "Iron Dust", medium: "item" },
    { id: "iron_ingot", name: "Iron Ingot", medium: "item", categoryId: "ingot" },
    { id: "copper_ore", name: "Copper Ore", medium: "item", categoryId: "ore" },
    { id: "copper_dust", name: "Copper Dust", medium: "item" },
    { id: "copper_ingot", name: "Copper Ingot", medium: "item", categoryId: "ingot" },
    { id: "gold_dust", name: "Gold Dust", medium: "item" },
    { id: "zinc_dust", name: "Zinc Dust", medium: "item" }
  ],
  tags: [
    { id: "@ore", name: "@ore", memberItemIds: ["iron_ore", "copper_ore"] },
    { id: "@ingot", name: "@ingot", memberItemIds: ["iron_ingot", "copper_ingot"] }
  ],
  recipeTags: [],
  recipes: [
    {
      id: "macerate_iron",
      name: "Macerate Iron",
      timeSeconds: 2,
      inputs: [{ id: "i1", refType: "item", refId: "iron_ore", amount: 1 }],
      outputs: [
        { id: "o1", itemId: "iron_dust", amount: 1, probability: 1 },
        { id: "o2", itemId: "gold_dust", amount: 1, probability: 0.1 }
      ]
    },
    {
      id: "smelt_iron",
      name: "Smelt Iron",
      timeSeconds: 3.2,
      inputs: [{ id: "i1", refType: "item", refId: "iron_dust", amount: 1 }],
      outputs: [{ id: "o1", itemId: "iron_ingot", amount: 1, probability: 1 }]
    }
  ],
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
      const newCategoryId = slugify(newName);
      const newState = {
        categories: state.categories.map((c) =>
          c.id === categoryId ? { id: newCategoryId, name: newName } : c
        ),
        items: state.items.map((item) =>
          item.categoryId === categoryId
            ? { ...item, categoryId: newCategoryId }
            : item
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
          medium: item.medium,
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
              medium: item.medium,
              categoryId: item.categoryId
            }
          ]
        };
      }
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
  addRecipe: (recipe) =>
    set((state) => {
      const newState = {
        recipes: [
          ...state.recipes,
          {
            id: recipe.id ?? slugify(recipe.name || `recipe_${state.recipes.length + 1}`),
            name: recipe.name,
            timeSeconds: recipe.timeSeconds,
            inputs: recipe.inputs,
            outputs: recipe.outputs
          }
        ]
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

export type { Category, Item, Tag, RecipeTag, Recipe, RecipeInput, RecipeOutput, Medium };
