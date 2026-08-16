import type { Item, Recipe, RecipeInput, RecipeOutput, Tag } from "../store/graphStore";

export type ModuleEffectTarget =
  | "cycleTime"
  | "inputAmount"
  | "outputAmount"
  | "outputProbability"
  | "addInput"
  | "addOutput";

export type ModuleEffectOperation = "add" | "multiply" | "divide" | "set" | "remove";

export type ModuleEffectSource = "constant" | "moduleCount" | "stateNumber" | "stateBoolean";

export type ModulePortDefinition = {
  key: string;
  refType?: "item" | "tag";
  refId: string;
  amount: number;
  probability?: number;
  merge?: "separate" | "byReference";
};

export type ModuleEffect = {
  id: string;
  target: ModuleEffectTarget;
  operation: ModuleEffectOperation;
  source?: ModuleEffectSource;
  stateKey?: string;
  value?: number;
  coefficient?: number;
  offset?: number;
  exponent?: number;
  divisor?: number;
  selectorPortId?: string;
  selectorRefId?: string;
  port?: ModulePortDefinition;
};

export type ModuleDefinition = {
  id: string;
  systemId: string;
  name: string;
  description?: string;
  effects: ModuleEffect[];
  archived?: boolean;
};

export type ModuleUiControl = {
  id: string;
  type: "slots" | "slider" | "number" | "toggle" | "targetOutputRate";
  label: string;
  stateKey: string;
  drivesStateKey?: string;
  targetPortId?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number | boolean;
  suffix?: string;
};

export type ModuleSystemDefinition = {
  id: string;
  name: string;
  description?: string;
  revision: number;
  controls: ModuleUiControl[];
  effects: ModuleEffect[];
  archived?: boolean;
};

export type RecipeModuleSupport = {
  systemId: string;
  enabled: boolean;
  order?: number;
  slotCount?: number;
  disabledModuleIds?: string[];
};

export const isModuleEnabledForSupport = (moduleId: string, support: RecipeModuleSupport): boolean => {
  return !(support.disabledModuleIds ?? []).includes(moduleId);
};

export type ModuleSystemNodeState = {
  slots?: Array<string | null>;
  values?: Record<string, number | boolean>;
};

export type NodeModuleState = {
  systems: Record<string, ModuleSystemNodeState>;
};

export type EffectiveRecipeInput = RecipeInput & {
  name: string;
  amountPerCycle: number;
  origin: "recipe" | "module";
};

export type EffectiveRecipeOutput = RecipeOutput & {
  name: string;
  amountPerCycle: number;
  origin: "recipe" | "module";
};

export type EffectiveRecipeDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
};

export type EffectiveRecipe = {
  recipeId: string;
  title: string;
  timeSeconds: number;
  inputs: EffectiveRecipeInput[];
  outputs: EffectiveRecipeOutput[];
  moduleState: NodeModuleState;
  fingerprint: string;
  diagnostics: EffectiveRecipeDiagnostic[];
};

export type ModuleProjectData = {
  items: Item[];
  tags: Tag[];
  moduleDefinitions: ModuleDefinition[];
  moduleSystems: ModuleSystemDefinition[];
};

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

const evaluateEffectValue = (
  effect: ModuleEffect,
  state: ModuleSystemNodeState,
  moduleCount: number
): number => {
  let sourceValue: number;
  switch (effect.source ?? "constant") {
    case "moduleCount":
      sourceValue = moduleCount;
      break;
    case "stateNumber": {
      const value = effect.stateKey ? state.values?.[effect.stateKey] : undefined;
      sourceValue = typeof value === "number" ? value : 0;
      break;
    }
    case "stateBoolean": {
      const value = effect.stateKey ? state.values?.[effect.stateKey] : undefined;
      sourceValue = value === true ? 1 : 0;
      break;
    }
    default:
      sourceValue = effect.value ?? 1;
      break;
  }

  const base = finite(effect.offset ?? 0, 0) + finite(effect.coefficient ?? 1, 1) * finite(sourceValue, 0);
  const exponent = finite(effect.exponent ?? 1, 1);
  const divisor = finite(effect.divisor ?? 1, 1);
  if (divisor === 0) return Number.NaN;
  return Math.pow(base, exponent) / divisor;
};

const mutateNumber = (current: number, operation: ModuleEffectOperation, value: number): number | null => {
  switch (operation) {
    case "add": return current + value;
    case "multiply": return current * value;
    case "divide": return value === 0 ? Number.NaN : current / value;
    case "set": return value;
    case "remove": return null;
  }
};

const createDefaultSystemState = (system: ModuleSystemDefinition, support: RecipeModuleSupport): ModuleSystemNodeState => {
  const values: Record<string, number | boolean> = {};
  for (const control of system.controls) {
    if (control.type === "slots") continue;
    values[control.stateKey] = control.defaultValue ?? (control.type === "toggle" ? false : control.min ?? 0);
  }
  return {
    slots: Array.from({ length: Math.max(0, support.slotCount ?? 0) }, () => null),
    values
  };
};

export const normalizeNodeModuleState = (
  recipe: Recipe,
  systems: ModuleSystemDefinition[],
  value?: Partial<NodeModuleState> | null
): NodeModuleState => {
  const next: NodeModuleState = { systems: {} };
  for (const support of recipe.moduleSupport ?? []) {
    if (!support.enabled) continue;
    const system = systems.find((entry) => entry.id === support.systemId && !entry.archived);
    if (!system) continue;
    const defaults = createDefaultSystemState(system, support);
    const existing = value?.systems?.[system.id];
    const slotCount = Math.max(0, support.slotCount ?? 0);
    const values = { ...defaults.values, ...(existing?.values ?? {}) };
    for (const control of system.controls) {
      if (control.type === "slots") continue;
      if (control.type === "toggle") {
        values[control.stateKey] = values[control.stateKey] === true;
        continue;
      }
      const fallback = typeof control.defaultValue === "number" ? control.defaultValue : control.min ?? 0;
      const candidate = typeof values[control.stateKey] === "number" && Number.isFinite(values[control.stateKey])
        ? values[control.stateKey] as number
        : fallback;
      values[control.stateKey] = Math.min(control.max ?? Number.POSITIVE_INFINITY, Math.max(control.min ?? Number.NEGATIVE_INFINITY, candidate));
    }
    next.systems[system.id] = {
      slots: Array.from({ length: slotCount }, (_, index) => existing?.slots?.[index] ?? defaults.slots?.[index] ?? null),
      values
    };
  }
  return next;
};

const stableFingerprint = (value: unknown): string => {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export function materializeEffectiveRecipe(
  recipe: Recipe,
  project: ModuleProjectData,
  requestedState?: Partial<NodeModuleState> | null
): EffectiveRecipe {
  const diagnostics: EffectiveRecipeDiagnostic[] = [];
  const itemNames = new Map(project.items.map((item) => [item.id, item.name]));
  const tagNames = new Map(project.tags.map((tag) => [tag.id, tag.name]));
  const state = normalizeNodeModuleState(recipe, project.moduleSystems, requestedState);

  let timeSeconds = recipe.timeSeconds;
  let inputs: EffectiveRecipeInput[] = recipe.inputs.map((input) => ({
    ...input,
    name: input.refType === "tag" ? tagNames.get(input.refId) ?? input.refId : itemNames.get(input.refId) ?? input.refId,
    amountPerCycle: input.amount,
    origin: "recipe"
  }));
  let outputs: EffectiveRecipeOutput[] = recipe.outputs.map((output) => ({
    ...output,
    name: itemNames.get(output.itemId) ?? output.itemId,
    amountPerCycle: output.amount,
    origin: "recipe"
  }));

  const applyEffect = (effect: ModuleEffect, systemState: ModuleSystemNodeState, count: number, namespace: string) => {
    const value = evaluateEffectValue(effect, systemState, count);
    if (!Number.isFinite(value)) {
      diagnostics.push({ severity: "error", code: "invalid-effect-value", message: `Effect ${effect.id} produced an invalid number.` });
      return;
    }

    if (effect.target === "cycleTime") {
      const next = mutateNumber(timeSeconds, effect.operation, value);
      if (next !== null) timeSeconds = next;
      return;
    }

    if (effect.target === "addInput" || effect.target === "addOutput") {
      if (!effect.port || effect.operation === "remove" || value === 0) return;
      const portAmount = effect.port.amount * value;
      const id = `${namespace}:${effect.port.key}`;
      if (effect.target === "addInput") {
        const refType = effect.port.refType ?? "item";
        if (effect.port.merge === "byReference") {
          const existing = inputs.find((entry) => entry.refType === refType && entry.refId === effect.port?.refId);
          if (existing) {
            existing.amount += portAmount;
            existing.amountPerCycle = existing.amount;
            return;
          }
        }
        inputs.push({
          id,
          refType,
          refId: effect.port.refId,
          amount: portAmount,
          amountPerCycle: portAmount,
          name: refType === "tag" ? tagNames.get(effect.port.refId) ?? effect.port.refId : itemNames.get(effect.port.refId) ?? effect.port.refId,
          origin: "module"
        });
      } else {
        if (effect.port.merge === "byReference") {
          const existing = outputs.find((entry) => entry.itemId === effect.port?.refId);
          if (existing) {
            existing.amount += portAmount;
            existing.amountPerCycle = existing.amount;
            return;
          }
        }
        outputs.push({
          id,
          itemId: effect.port.refId,
          amount: portAmount,
          amountPerCycle: portAmount,
          probability: effect.port.probability ?? 1,
          name: itemNames.get(effect.port.refId) ?? effect.port.refId,
          origin: "module"
        });
      }
      return;
    }

    if (effect.target === "inputAmount") {
      inputs = inputs.flatMap((input) => {
        if (effect.selectorPortId && input.id !== effect.selectorPortId) return [input];
        if (effect.selectorRefId && input.refId !== effect.selectorRefId) return [input];
        const next = mutateNumber(input.amount, effect.operation, value);
        return next === null ? [] : [{ ...input, amount: next, amountPerCycle: next }];
      });
      return;
    }

    outputs = outputs.flatMap((output) => {
      if (effect.selectorPortId && output.id !== effect.selectorPortId) return [output];
      if (effect.selectorRefId && output.itemId !== effect.selectorRefId) return [output];
      const current = effect.target === "outputProbability" ? output.probability : output.amount;
      const next = mutateNumber(current, effect.operation, value);
      if (next === null) return [];
      return effect.target === "outputProbability"
        ? [{ ...output, probability: next }]
        : [{ ...output, amount: next, amountPerCycle: next }];
    });
  };

  const supports = [...(recipe.moduleSupport ?? [])]
    .filter((support) => support.enabled)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.systemId.localeCompare(right.systemId));

  for (const support of supports) {
    const system = project.moduleSystems.find((entry) => entry.id === support.systemId && !entry.archived);
    if (!system) {
      diagnostics.push({ severity: "error", code: "missing-system", message: `Upgrade system ${support.systemId} does not exist.` });
      continue;
    }
    const systemState = state.systems[system.id] ?? createDefaultSystemState(system, support);
    const counts = new Map<string, number>();
    for (const moduleId of systemState.slots ?? []) {
      if (!moduleId) continue;
      if (!isModuleEnabledForSupport(moduleId, support)) {
        diagnostics.push({ severity: "error", code: "module-disabled", message: `Module ${moduleId} is disabled for this recipe.` });
        continue;
      }
      counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
    }
    for (const [moduleId, count] of counts) {
      const moduleDefinition = project.moduleDefinitions.find((entry) => entry.id === moduleId && !entry.archived);
      if (!moduleDefinition) {
        diagnostics.push({ severity: "error", code: "missing-module", message: `Module ${moduleId} does not exist.` });
        continue;
      }
      if (moduleDefinition.systemId !== system.id) {
        diagnostics.push({ severity: "error", code: "wrong-system-module", message: `Module ${moduleId} does not belong to ${system.name}.` });
        continue;
      }
      for (const effect of moduleDefinition.effects) applyEffect(effect, systemState, count, `module:${system.id}:${moduleId}`);
    }
    for (const effect of system.effects) applyEffect(effect, systemState, 1, `system:${system.id}`);
  }

  if (!Number.isFinite(timeSeconds) || timeSeconds <= 0) {
    diagnostics.push({ severity: "error", code: "invalid-cycle-time", message: "Effective cycle time must be greater than zero." });
    timeSeconds = Math.max(0.000001, finite(recipe.timeSeconds, 1));
  }
  for (const input of inputs) {
    if (!Number.isFinite(input.amount) || input.amount < 0) diagnostics.push({ severity: "error", code: "invalid-input", message: `Input ${input.id} has an invalid amount.` });
  }
  for (const output of outputs) {
    if (!Number.isFinite(output.amount) || output.amount < 0 || !Number.isFinite(output.probability) || output.probability < 0 || output.probability > 1) {
      diagnostics.push({ severity: "error", code: "invalid-output", message: `Output ${output.id} has an invalid amount or probability.` });
    }
  }
  const knownItems = new Set(project.items.map((item) => item.id));
  const knownTags = new Set(project.tags.map((tag) => tag.id));
  for (const input of inputs) {
    const exists = input.refType === "tag" ? knownTags.has(input.refId) : knownItems.has(input.refId);
    if (!exists) diagnostics.push({ severity: "error", code: "missing-input-reference", message: `Input ${input.id} references missing ${input.refType} ${input.refId}.` });
  }
  for (const output of outputs) {
    if (!knownItems.has(output.itemId)) diagnostics.push({ severity: "error", code: "missing-output-reference", message: `Output ${output.id} references missing item ${output.itemId}.` });
  }

  const result = { recipeId: recipe.id, title: recipe.name, timeSeconds, inputs, outputs, moduleState: state, diagnostics };
  return { ...result, fingerprint: stableFingerprint(result) };
}

export function effectiveRecipeChanged(left: EffectiveRecipe | null, right: EffectiveRecipe): boolean {
  return left?.fingerprint !== right.fingerprint;
}

export type TargetOutputRateSolution = {
  possible: boolean;
  state: NodeModuleState;
  requiredValue?: number;
  achievedRate?: number;
  outputName?: string;
};

const withSystemNumber = (state: NodeModuleState, systemId: string, stateKey: string, value: number): NodeModuleState => ({
  systems: {
    ...state.systems,
    [systemId]: {
      ...state.systems[systemId],
      values: { ...(state.systems[systemId]?.values ?? {}), [stateKey]: value }
    }
  }
});

/** Numerically inverts a per-node control against effective output/cycle time. */
export function solveTargetOutputRate(options: {
  evaluate: (state: NodeModuleState) => EffectiveRecipe;
  state: NodeModuleState;
  systemId: string;
  drivesStateKey: string;
  targetRate: number;
  min: number;
  max: number;
  targetPortId?: string;
}): TargetOutputRateSolution {
  const { evaluate, state, systemId, drivesStateKey, targetRate, min, max, targetPortId } = options;
  if (!Number.isFinite(targetRate) || targetRate < 0 || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { possible: false, state };
  }

  const sample = (driverValue: number) => {
    const nextState = withSystemNumber(state, systemId, drivesStateKey, driverValue);
    const effective = evaluate(nextState);
    const output = targetPortId
      ? effective.outputs.find((candidate) => candidate.id === targetPortId)
      : effective.outputs[0];
    const rate = output && effective.timeSeconds > 0
      ? output.amount * output.probability / effective.timeSeconds
      : Number.NaN;
    return { driverValue, nextState, rate, outputName: output?.name };
  };

  const steps = 64;
  const samples = Array.from({ length: steps + 1 }, (_, index) => sample(min + (max - min) * index / steps));
  const finiteSamples = samples.filter((entry) => Number.isFinite(entry.rate));
  if (finiteSamples.length === 0) return { possible: false, state };

  let best = finiteSamples.reduce((current, candidate) =>
    Math.abs(candidate.rate - targetRate) < Math.abs(current.rate - targetRate) ? candidate : current
  );
  const tolerance = Math.max(1e-7, Math.abs(targetRate) * 1e-7);

  for (let index = 0; index < samples.length - 1; index += 1) {
    let left = samples[index];
    let right = samples[index + 1];
    if (!Number.isFinite(left.rate) || !Number.isFinite(right.rate)) continue;
    if ((targetRate - left.rate) * (targetRate - right.rate) > 0) continue;

    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = sample((left.driverValue + right.driverValue) / 2);
      if (!Number.isFinite(middle.rate)) break;
      if (Math.abs(middle.rate - targetRate) < Math.abs(best.rate - targetRate)) best = middle;
      if (Math.abs(middle.rate - targetRate) <= tolerance) break;
      if ((targetRate - left.rate) * (targetRate - middle.rate) <= 0) right = middle;
      else left = middle;
    }
  }

  return {
    possible: Math.abs(best.rate - targetRate) <= tolerance,
    state: best.nextState,
    requiredValue: best.driverValue,
    achievedRate: best.rate,
    outputName: best.outputName
  };
}
