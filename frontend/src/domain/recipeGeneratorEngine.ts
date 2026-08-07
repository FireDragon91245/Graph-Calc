import type { Category, Item, Recipe, RecipeInput, RecipeOutput, Tag } from "../store/graphStore";
import type {
  RecipeBlueprint,
  RecipeOutputSlotRule,
  RecipeSlotRule,
  RecipeTransformStep,
} from "./recipeBlueprint";

export type RecipeCandidateStatus = "ready" | "error" | "conflict";

export interface RecipeCandidate {
  id: string;
  sourceItem: Item;
  status: RecipeCandidateStatus;
  recipe?: Recipe;
  messages: string[];
  trace: string[];
}

export interface RecipeGeneratorContext {
  items: Item[];
  tags: Tag[];
  categories: Category[];
  recipes: Recipe[];
}

export const slugifyRecipeValue = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function applyRelatedNameTransforms(value: string, steps: RecipeTransformStep[]): string {
  return steps.reduce((current, step) => {
    const operand = (step.value ?? "").trim();
    switch (step.type) {
      case "addPrefix":
        return operand ? `${operand} ${current}`.trim().replace(/\s+/g, " ") : current;
      case "addSuffix":
        return operand ? `${current} ${operand}`.trim().replace(/\s+/g, " ") : current;
      case "removePrefix":
        return operand && current.toLowerCase().startsWith(operand.toLowerCase())
          ? current.slice(operand.length).trim()
          : current;
      case "removeSuffix":
        return operand && current.toLowerCase().endsWith(operand.toLowerCase())
          ? current.slice(0, -operand.length).trim()
          : current;
      case "replace": {
        const from = (step.replaceFrom ?? "").trim();
        return from
          ? current.split(from).join((step.replaceTo ?? "").trim()).trim().replace(/\s+/g, " ")
          : current;
      }
      case "lowercase":
        return current.toLowerCase();
      case "uppercase":
        return current.toUpperCase();
    }
  }, value.trim());
}

function itemIsInTag(itemId: string, tagId: string, tags: Tag[]): boolean {
  return tags.some((tag) => tag.id === tagId && tag.memberItemIds.includes(itemId));
}

export function selectBlueprintSourceItems(blueprint: RecipeBlueprint, context: RecipeGeneratorContext): Item[] {
  const rule = blueprint.source;
  const hasPositiveFilters = rule.tagIds.length > 0 || rule.categoryIds.length > 0 || rule.itemIds.length > 0;
  if (!hasPositiveFilters) return [];

  return context.items.filter((item) => {
    if (rule.excludeItemIds.includes(item.id)) return false;
    if (item.categoryId && rule.excludeCategoryIds.includes(item.categoryId)) return false;
    if (rule.excludeTagIds.some((tagId) => itemIsInTag(item.id, tagId, context.tags))) return false;

    const groups: boolean[] = [];
    if (rule.tagIds.length > 0) {
      groups.push(rule.tagIds.some((tagId) => itemIsInTag(item.id, tagId, context.tags)));
    }
    if (rule.categoryIds.length > 0) groups.push(Boolean(item.categoryId && rule.categoryIds.includes(item.categoryId)));
    if (rule.itemIds.length > 0) groups.push(rule.itemIds.includes(item.id));
    return rule.filterMode === "all" ? groups.every(Boolean) : groups.some(Boolean);
  });
}

function findRelatedItem(
  slot: RecipeSlotRule | RecipeOutputSlotRule,
  source: Item,
  context: RecipeGeneratorContext,
): { item?: Item; error?: string; trace: string } {
  const targetValue = applyRelatedNameTransforms(source.name, slot.nameTransforms);
  const matches = context.items.filter((item) => {
    if (item.name.toLowerCase() !== targetValue.toLowerCase()) return false;
    if (slot.targetCategoryId && item.categoryId !== slot.targetCategoryId) return false;
    if (slot.targetTagId && !itemIsInTag(item.id, slot.targetTagId, context.tags)) return false;
    return true;
  });
  const constraints = [
    slot.targetTagId ? `tag ${context.tags.find((tag) => tag.id === slot.targetTagId)?.name ?? slot.targetTagId}` : "",
    slot.targetCategoryId
      ? `category ${context.categories.find((category) => category.id === slot.targetCategoryId)?.name ?? slot.targetCategoryId}`
      : "",
  ].filter(Boolean);
  const trace = `Looked up name “${targetValue}”${constraints.length ? ` inside ${constraints.join(" and ")}` : ""}`;
  if (matches.length === 0) return { error: `${trace}: no match`, trace };
  if (matches.length > 1) return { error: `${trace}: ${matches.length} ambiguous matches`, trace };
  return { item: matches[0], trace: `${trace} → ${matches[0].name}` };
}

function resolveInput(
  slot: RecipeSlotRule,
  source: Item,
  index: number,
  context: RecipeGeneratorContext,
): { input?: RecipeInput; item?: Item; name?: string; error?: string; trace: string } {
  if (!Number.isFinite(slot.amount) || slot.amount <= 0) {
    return { error: `Input ${index + 1} amount must be greater than zero`, trace: `Input ${index + 1} has invalid amount` };
  }
  if (slot.resolver === "source") {
    return {
      input: { id: `i${index + 1}`, refType: "item", refId: source.id, amount: slot.amount },
      item: source,
      name: source.name,
      trace: `Input ${index + 1} uses source item ${source.name}`,
    };
  }
  if (slot.resolver === "fixedTag") {
    const tag = context.tags.find((entry) => entry.id === slot.refId);
    if (!tag) return { error: `Input ${index + 1} fixed tag is missing`, trace: `Input ${index + 1} could not resolve fixed tag` };
    return {
      input: { id: `i${index + 1}`, refType: "tag", refId: tag.id, amount: slot.amount },
      name: tag.name,
      trace: `Input ${index + 1} always uses tag ${tag.name}`,
    };
  }
  if (slot.resolver === "fixedItem") {
    const item = context.items.find((entry) => entry.id === slot.refId);
    if (!item) return { error: `Input ${index + 1} fixed item is missing`, trace: `Input ${index + 1} could not resolve fixed item` };
    return {
      input: { id: `i${index + 1}`, refType: "item", refId: item.id, amount: slot.amount },
      item,
      name: item.name,
      trace: `Input ${index + 1} always uses ${item.name}`,
    };
  }
  const related = findRelatedItem(slot, source, context);
  return related.item
    ? {
        input: { id: `i${index + 1}`, refType: "item", refId: related.item.id, amount: slot.amount },
        item: related.item,
        name: related.item.name,
        trace: `Input ${index + 1}: ${related.trace}`,
      }
    : { error: `Input ${index + 1}: ${related.error}`, trace: `Input ${index + 1}: ${related.trace}` };
}

function resolveOutput(
  slot: RecipeOutputSlotRule,
  source: Item,
  index: number,
  context: RecipeGeneratorContext,
): { output?: RecipeOutput; item?: Item; name?: string; error?: string; trace: string } {
  if (!Number.isFinite(slot.amount) || slot.amount <= 0) {
    return { error: `Output ${index + 1} amount must be greater than zero`, trace: `Output ${index + 1} has invalid amount` };
  }
  if (!Number.isFinite(slot.probability) || slot.probability <= 0 || slot.probability > 1) {
    return { error: `Output ${index + 1} probability must be between 0 and 1`, trace: `Output ${index + 1} has invalid probability` };
  }
  let item: Item | undefined;
  let trace = "";
  if (slot.resolver === "source") {
    item = source;
    trace = `Output ${index + 1} uses source item ${source.name}`;
  } else if (slot.resolver === "fixedItem") {
    item = context.items.find((entry) => entry.id === slot.refId);
    trace = item ? `Output ${index + 1} always uses ${item.name}` : `Output ${index + 1} could not resolve fixed item`;
  } else {
    const related = findRelatedItem(slot, source, context);
    item = related.item;
    trace = `Output ${index + 1}: ${related.trace}`;
    if (!item) return { error: `Output ${index + 1}: ${related.error}`, trace };
  }
  if (!item) return { error: `Output ${index + 1} fixed item is missing`, trace };
  return {
    output: { id: `o${index + 1}`, itemId: item.id, amount: slot.amount, probability: slot.probability },
    item,
    name: item.name,
    trace,
  };
}

export function recipeSignature(recipe: Recipe): string {
  const inputs = recipe.inputs
    .map((entry) => `${entry.refType}:${entry.refId}:${entry.amount}`)
    .sort()
    .join("|");
  const outputs = recipe.outputs
    .map((entry) => `${entry.itemId}:${entry.amount}:${entry.probability}`)
    .sort()
    .join("|");
  return `${recipe.timeSeconds}::${inputs}=>${outputs}`;
}

export function generateRecipeCandidates(blueprint: RecipeBlueprint, context: RecipeGeneratorContext): RecipeCandidate[] {
  const sources = selectBlueprintSourceItems(blueprint, context);
  const existingSignatures = new Set(context.recipes.map(recipeSignature));
  const generatedIds = new Set<string>();
  const generatedNames = new Set<string>();

  return sources.map((source) => {
    const messages: string[] = [];
    const trace = [`Source item: ${source.name}`];
    const resolvedInputs = blueprint.inputs.map((slot, index) => resolveInput(slot, source, index, context));
    const resolvedOutputs = blueprint.outputs.map((slot, index) => resolveOutput(slot, source, index, context));
    resolvedInputs.forEach((result) => {
      trace.push(result.trace);
      if (result.error) messages.push(result.error);
    });
    resolvedOutputs.forEach((result) => {
      trace.push(result.trace);
      if (result.error) messages.push(result.error);
    });
    if (blueprint.inputs.length === 0) messages.push("Recipe needs at least one input");
    if (blueprint.outputs.length === 0) messages.push("Recipe needs at least one output");
    if (!Number.isFinite(blueprint.timeSeconds) || blueprint.timeSeconds <= 0) messages.push("Duration must be greater than zero");

    const friendlyNameItem = blueprint.recipeNameItem === "input1"
      ? resolvedInputs[0]?.name ?? ""
      : blueprint.recipeNameItem === "output1"
        ? resolvedOutputs[0]?.name ?? ""
        : blueprint.recipeNameItem === "none"
          ? ""
          : source.name;
    const name = [blueprint.recipeNamePrefix, friendlyNameItem, blueprint.recipeNameSuffix]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ");
    const id = slugifyRecipeValue(name);
    if (!name) messages.push("Recipe name is empty");
    if (!id) messages.push("Generated recipe ID is empty");

    if (messages.length > 0) return { id: `${blueprint.id}:${source.id}`, sourceItem: source, status: "error", messages, trace };

    const recipe: Recipe = {
      id,
      name,
      timeSeconds: blueprint.timeSeconds,
      inputs: resolvedInputs.map((result) => result.input!),
      outputs: resolvedOutputs.map((result) => result.output!),
    };
    if (context.recipes.some((entry) => entry.id === id)) messages.push(`Recipe ID “${id}” already exists`);
    if (context.recipes.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) messages.push(`Recipe name “${name}” already exists`);
    if (existingSignatures.has(recipeSignature(recipe))) messages.push("An equivalent recipe already exists");
    if (generatedIds.has(id) || generatedNames.has(name.toLowerCase())) messages.push("Another preview row produces the same ID or name");
    generatedIds.add(id);
    generatedNames.add(name.toLowerCase());
    trace.push(`Recipe: ${name} (${id})`);
    return {
      id: `${blueprint.id}:${source.id}`,
      sourceItem: source,
      status: messages.length ? "conflict" : "ready",
      recipe,
      messages,
      trace,
    };
  });
}
