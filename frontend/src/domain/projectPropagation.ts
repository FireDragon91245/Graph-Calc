import type { Edge, Node } from "reactflow";
import type { Item, Recipe, RecipeTag, Tag } from "../store/graphStore";
import { materializeEffectiveRecipe, type ModuleDefinition, type ModuleSystemDefinition, type NodeModuleState } from "./moduleSystem";

export type ProjectPropagationData = {
  items: Item[];
  tags: Tag[];
  recipes: Recipe[];
  recipeTags: RecipeTag[];
  moduleDefinitions: ModuleDefinition[];
  moduleSystems: ModuleSystemDefinition[];
  projectRevision: number;
};

export type ProjectPropagationResult = {
  nodes: Node[];
  changedNodeIds: string[];
  structuralNodeIds: string[];
};

type VisiblePort = {
  id: string;
  name: string;
  itemId?: string;
  refId?: string;
  refType?: "item" | "tag";
  fixedRefId?: string;
  amountPerCycle: number;
  probability?: number;
  isMixed?: boolean;
};

const portSignature = (ports: VisiblePort[]) => ports.map((port) => `${port.id}:${port.refId ?? port.itemId ?? "mixed"}`).join("|");

const buildTagPattern = (
  recipes: Recipe[],
  project: ProjectPropagationData,
  moduleState: NodeModuleState | undefined,
  includeInputs: boolean,
  multiplier: number
): { inputs: VisiblePort[]; outputs: VisiblePort[]; fingerprint: string; diagnostics: string[] } => {
  const candidates = recipes.map((recipe) => materializeEffectiveRecipe(recipe, project, moduleState));
  const inputIds = includeInputs ? Array.from(new Set(candidates.flatMap((recipe) => recipe.inputs.map((input) => input.id)))) : [];
  const outputIds = Array.from(new Set(candidates.flatMap((recipe) => recipe.outputs.map((output) => output.id))));

  const inputs: VisiblePort[] = inputIds.map((id) => {
    const ports = candidates.map((candidate) => candidate.inputs.find((input) => input.id === id));
    const first = ports[0];
    const allPresent = ports.every(Boolean);
    const sameReference = allPresent && ports.every((port) => port?.refId === first?.refId && port?.refType === first?.refType);
    const sameAmount = allPresent && ports.every((port) => port?.amount === first?.amount);
    return {
      id,
      name: sameReference && first ? first.name : `Mixed input ${id}`,
      refId: sameReference ? first?.refId : undefined,
      fixedRefId: sameReference ? first?.refId : undefined,
      refType: sameReference ? first?.refType : undefined,
      amountPerCycle: sameAmount ? first?.amount ?? 1 : 1,
      isMixed: !sameReference
    };
  });

  const outputs: VisiblePort[] = outputIds.map((id) => {
    const ports = candidates.map((candidate) => candidate.outputs.find((output) => output.id === id));
    const first = ports[0];
    const allPresent = ports.every(Boolean);
    const sameReference = allPresent && ports.every((port) => port?.itemId === first?.itemId);
    const sameAmount = allPresent && ports.every((port) => port?.amount === first?.amount);
    const sameProbability = allPresent && ports.every((port) => port?.probability === first?.probability);
    return {
      id,
      name: sameReference && first ? first.name : `Mixed output ${id}`,
      itemId: sameReference ? first?.itemId : undefined,
      fixedRefId: sameReference ? first?.itemId : undefined,
      amountPerCycle: (sameAmount ? first?.amount ?? 1 : 1) * multiplier,
      probability: sameProbability ? first?.probability : undefined,
      isMixed: !sameReference
    };
  });

  return {
    inputs,
    outputs,
    fingerprint: candidates.map((candidate) => candidate.fingerprint).join(":") + `:${multiplier}`,
    diagnostics: candidates.length === 0
      ? ["Recipe tag has no usable recipe members."]
      : Array.from(new Set(candidates.flatMap((candidate) => candidate.diagnostics.map((diagnostic) => `${candidate.title}: ${diagnostic.message}`))))
  };
};

export function propagateProjectDataToNodes(currentNodes: Node[], project: ProjectPropagationData, edges: Edge[] = []): ProjectPropagationResult {
  const changedNodeIds: string[] = [];
  const structuralNodeIds: string[] = [];
  const nextNodes = currentNodes.map((node) => {
    if (node.type === "recipe" || node.type === "inputrecipe") {
      const recipeId = typeof node.data?.recipeId === "string" ? node.data.recipeId : "";
      const recipe = project.recipes.find((entry) => entry.id === recipeId);
      if (!recipe) {
        const ghostInputs = [...(node.data?.ghostInputs ?? []), ...(node.data?.inputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
          edges.some((edge) => edge.target === node.id && edge.targetHandle === `input-${port.id}`) && all.findIndex((candidate) => candidate.id === port.id) === index
        );
        const ghostOutputs = [...(node.data?.ghostOutputs ?? []), ...(node.data?.outputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
          edges.some((edge) => edge.source === node.id && edge.sourceHandle === `output-${port.id}`) && all.findIndex((candidate) => candidate.id === port.id) === index
        );
        if (node.data?.unresolved === true && node.data?.projectRevision === project.projectRevision &&
            portSignature(node.data?.ghostInputs ?? []) === portSignature(ghostInputs) &&
            portSignature(node.data?.ghostOutputs ?? []) === portSignature(ghostOutputs)) return node;
        changedNodeIds.push(node.id);
        structuralNodeIds.push(node.id);
        return {
          ...node,
          data: {
            ...node.data,
            inputs: [],
            outputs: [],
            ghostInputs,
            ghostOutputs,
            unresolved: true,
            projectDiagnostics: [],
            projectRevision: project.projectRevision,
            solveData: undefined
          }
        };
      }
      const effective = materializeEffectiveRecipe(recipe, project, node.data?.moduleState);
      const multiplier = node.type === "inputrecipe" && typeof node.data?.multiplier === "number" ? node.data.multiplier : 1;
      const inputs = node.type === "inputrecipe" ? [] : effective.inputs;
      const outputs = effective.outputs.map((output) => ({
        ...output,
        amount: output.amount * multiplier,
        amountPerCycle: output.amountPerCycle * multiplier
      }));
      const previousPortSignature = `${portSignature(node.data?.inputs ?? [])}>${portSignature(node.data?.outputs ?? [])}`;
      const nextPortSignature = `${portSignature(inputs)}>${portSignature(outputs)}`;
      const ghostInputs = [...(node.data?.ghostInputs ?? []), ...(node.data?.inputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
        !inputs.some((current) => current.id === port.id) &&
        edges.some((edge) => edge.target === node.id && edge.targetHandle === `input-${port.id}`) &&
        all.findIndex((candidate) => candidate.id === port.id) === index
      );
      const ghostOutputs = [...(node.data?.ghostOutputs ?? []), ...(node.data?.outputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
        !outputs.some((current) => current.id === port.id) &&
        edges.some((edge) => edge.source === node.id && edge.sourceHandle === `output-${port.id}`) &&
        all.findIndex((candidate) => candidate.id === port.id) === index
      );
      const changed = node.data?.effectiveFingerprint !== effective.fingerprint ||
        node.data?.projectRevision !== project.projectRevision ||
        portSignature(node.data?.ghostInputs ?? []) !== portSignature(ghostInputs) ||
        portSignature(node.data?.ghostOutputs ?? []) !== portSignature(ghostOutputs);
      if (!changed) return node;
      changedNodeIds.push(node.id);
      if (previousPortSignature !== nextPortSignature) structuralNodeIds.push(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          title: recipe.name,
          timeSeconds: effective.timeSeconds,
          inputs,
          outputs,
          ghostInputs,
          ghostOutputs,
          moduleState: effective.moduleState,
          effectiveRecipeCache: effective,
          effectiveFingerprint: effective.fingerprint,
          projectRevision: project.projectRevision,
          unresolved: false,
          solveData: undefined
        }
      };
    }

    if (node.type === "recipetag" || node.type === "inputrecipetag") {
      const recipeTagId = typeof node.data?.recipeTagId === "string" ? node.data.recipeTagId : "";
      const recipeTag = project.recipeTags.find((entry) => entry.id === recipeTagId);
      if (!recipeTag) {
        const ghostInputs = [...(node.data?.ghostInputs ?? []), ...(node.data?.inputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
          edges.some((edge) => edge.target === node.id && edge.targetHandle === `input-${port.id}`) && all.findIndex((candidate) => candidate.id === port.id) === index
        );
        const ghostOutputs = [...(node.data?.ghostOutputs ?? []), ...(node.data?.outputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
          edges.some((edge) => edge.source === node.id && edge.sourceHandle === `output-${port.id}`) && all.findIndex((candidate) => candidate.id === port.id) === index
        );
        if (node.data?.unresolved === true && node.data?.projectRevision === project.projectRevision &&
            portSignature(node.data?.ghostInputs ?? []) === portSignature(ghostInputs) &&
            portSignature(node.data?.ghostOutputs ?? []) === portSignature(ghostOutputs)) return node;
        changedNodeIds.push(node.id);
        structuralNodeIds.push(node.id);
        return {
          ...node,
          data: { ...node.data, inputs: [], outputs: [], ghostInputs, ghostOutputs, unresolved: true, projectDiagnostics: [], projectRevision: project.projectRevision, solveData: undefined }
        };
      }
      const recipes = recipeTag.memberRecipeIds
        .map((recipeId) => project.recipes.find((entry) => entry.id === recipeId))
        .filter((recipe): recipe is Recipe => Boolean(recipe));
      const multiplier = node.type === "inputrecipetag" && typeof node.data?.multiplier === "number" ? node.data.multiplier : 1;
      const pattern = buildTagPattern(recipes, project, node.data?.moduleState, node.type === "recipetag", multiplier);
      const previousPortSignature = `${portSignature(node.data?.inputs ?? [])}>${portSignature(node.data?.outputs ?? [])}`;
      const nextPortSignature = `${portSignature(pattern.inputs)}>${portSignature(pattern.outputs)}`;
      const ghostInputs = [...(node.data?.ghostInputs ?? []), ...(node.data?.inputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
        !pattern.inputs.some((current) => current.id === port.id) &&
        edges.some((edge) => edge.target === node.id && edge.targetHandle === `input-${port.id}`) &&
        all.findIndex((candidate) => candidate.id === port.id) === index
      );
      const ghostOutputs = [...(node.data?.ghostOutputs ?? []), ...(node.data?.outputs ?? [])].filter((port: VisiblePort, index: number, all: VisiblePort[]) =>
        !pattern.outputs.some((current) => current.id === port.id) &&
        edges.some((edge) => edge.source === node.id && edge.sourceHandle === `output-${port.id}`) &&
        all.findIndex((candidate) => candidate.id === port.id) === index
      );
      if (node.data?.effectiveFingerprint === pattern.fingerprint &&
          node.data?.projectRevision === project.projectRevision &&
          portSignature(node.data?.ghostInputs ?? []) === portSignature(ghostInputs) &&
          portSignature(node.data?.ghostOutputs ?? []) === portSignature(ghostOutputs)) return node;
      changedNodeIds.push(node.id);
      if (previousPortSignature !== nextPortSignature) structuralNodeIds.push(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          title: recipeTag.name,
          inputs: pattern.inputs,
          outputs: pattern.outputs,
          ghostInputs,
          ghostOutputs,
          projectDiagnostics: pattern.diagnostics,
          effectiveFingerprint: pattern.fingerprint,
          projectRevision: project.projectRevision,
          unresolved: false,
          solveData: undefined
        }
      };
    }

    if (node.type === "input" || node.type === "output" || node.type === "requester") {
      const rows = node.type === "requester" ? node.data?.requests ?? [] : node.data?.items ?? [];
      const knownItems = new Set(project.items.map((item) => item.id));
      const unresolvedItemIds = Array.from(new Set(rows
        .map((row: { itemId?: string }) => row.itemId)
        .filter((itemId: unknown): itemId is string => typeof itemId === "string" && itemId.length > 0 && !knownItems.has(itemId))));
      const previous = Array.isArray(node.data?.unresolvedItemIds) ? node.data.unresolvedItemIds as string[] : [];
      if (node.data?.projectRevision === project.projectRevision && previous.join("|") === unresolvedItemIds.join("|")) return node;
      changedNodeIds.push(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          unresolvedItemIds,
          projectRevision: project.projectRevision,
          solveData: undefined
        }
      };
    }

    return node;
  });

  return { nodes: nextNodes, changedNodeIds, structuralNodeIds };
}
