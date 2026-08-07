export type RecipeTransformType =
  | "addPrefix"
  | "addSuffix"
  | "removePrefix"
  | "removeSuffix"
  | "replace"
  | "lowercase"
  | "uppercase";

export interface RecipeTransformStep {
  id: string;
  type: RecipeTransformType;
  value?: string;
  replaceFrom?: string;
  replaceTo?: string;
}

export interface RecipeSourceRule {
  filterMode: "all" | "any";
  tagIds: string[];
  categoryIds: string[];
  itemIds: string[];
  excludeTagIds: string[];
  excludeCategoryIds: string[];
  excludeItemIds: string[];
}

export type RecipeSlotResolver = "source" | "fixedItem" | "fixedTag" | "related";

export interface RecipeSlotRule {
  id: string;
  resolver: RecipeSlotResolver;
  amount: number;
  refId?: string;
  targetTagId?: string;
  targetCategoryId?: string;
  nameTransforms: RecipeTransformStep[];
}

export interface RecipeOutputSlotRule extends Omit<RecipeSlotRule, "resolver"> {
  resolver: Exclude<RecipeSlotResolver, "fixedTag">;
  probability: number;
}

export interface RecipeBlueprint {
  id: string;
  name: string;
  description: string;
  source: RecipeSourceRule;
  recipeNamePrefix: string;
  recipeNameItem: "source" | "input1" | "output1" | "none";
  recipeNameSuffix: string;
  timeSeconds: number;
  inputs: RecipeSlotRule[];
  outputs: RecipeOutputSlotRule[];
  recipeTagIds: string[];
  createdAt: number;
  updatedAt: number;
}
