import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari-web/dist/fengari-web.bundle.js";
import i18n from "../i18n";
import type { ModuleEffect, ModuleValue, RecipeParameterDefinition } from "./moduleSystem";

const MAX_SCRIPT_LENGTH = 100_000;
const MAX_INSTRUCTIONS = 250_000;
const MAX_TABLE_ENTRIES = 5_000;
const MAX_VALUE_DEPTH = 24;

/** Public API injected into every module-system Lua sandbox. Keep this in sync with LuaModuleRuntime.cs. */
export const LUA_MODULE_API = String.raw`
local function identity(definition)
  assert(type(definition) == "table", "definition must be a table")
  return definition
end

system = identity
module = identity

parameter = {}
local function parameter_value(kind, definition)
  definition = definition or {}
  definition.type = kind
  return definition
end
function parameter.number(definition) return parameter_value("number", definition) end
function parameter.toggle(definition) return parameter_value("toggle", definition) end
function parameter.text(definition) return parameter_value("text", definition) end
function parameter.select(definition) return parameter_value("select", definition) end

bindings = {}
function bindings.value(key) return { kind = "value", key = key } end
function bindings.slot(index) return { kind = "slot", slot = index } end

module_bay = {}
function module_bay.slot(definition)
  definition = definition or {}
  assert(type(definition.slot) == "number", "module_bay.slot requires slot")
  return definition
end
function module_bay.slots(definition)
  definition = definition or {}
  local count = math.max(0, math.floor(assert(definition.count, "module_bay.slots requires count")))
  local result = {}
  for index = 1, count do
    result[index] = { slot = index, modules = definition.modules }
  end
  return result
end

ui = {}
local function leaf(kind, definition)
  definition = definition or {}
  definition.type = kind
  return definition
end
local function layout(kind, definition)
  definition = definition or {}
  local result = { type = kind, children = {} }
  local numeric = {}
  for key, value in pairs(definition) do
    if type(key) == "number" then
      table.insert(numeric, { key = key, value = value })
    else
      result[key] = value
    end
  end
  table.sort(numeric, function(left, right) return left.key < right.key end)
  for _, entry in ipairs(numeric) do table.insert(result.children, entry.value) end
  return result
end
function ui.row(definition) return layout("row", definition) end
function ui.column(definition) return layout("column", definition) end
function ui.grid(definition) return layout("grid", definition) end
function ui.group(definition) return layout("group", definition) end
function ui.label(definition) return leaf("label", definition) end
function ui.icon(definition) return leaf("icon", definition) end
function ui.spacer(definition) return leaf("spacer", definition) end
function ui.button(definition) return layout("button", definition) end
function ui.number(definition) return leaf("number", definition) end
function ui.text_input(definition) return leaf("text_input", definition) end
function ui.select(definition) return leaf("select", definition) end
function ui.dropdown(definition) return leaf("dropdown", definition) end
function ui.slider(definition) return leaf("slider", definition) end
function ui.toggle(definition) return leaf("toggle", definition) end
function ui.counter(definition) return leaf("counter", definition) end
function ui.module_slot(definition) return leaf("module_slot", definition) end
function ui.module_counter(definition) return leaf("module_counter", definition) end
function ui.target_output(definition) return leaf("target_output", definition) end
function ui.popup(definition)
  definition = definition or {}
  definition.type = "popup"
  return definition
end
function ui.when(condition, child) if condition then return child end return nil end

actions = {}
local function action(kind, definition)
  definition = definition or {}
  definition.type = kind
  return definition
end
function actions.set(definition) return action("set", definition) end
function actions.increment(definition) return action("increment", definition) end
function actions.toggle(definition) return action("toggle", definition) end
function actions.install(definition) return action("install", definition) end
function actions.clear_slot(definition) return action("clear_slot", definition) end

fx = {}
local function normalize_spec(specification)
  if type(specification) == "number" then return { value = specification } end
  return specification or {}
end
local function amount_effect(target, operation, specification)
  local spec = normalize_spec(specification)
  return {
    id = spec.id or (target .. "-" .. operation),
    target = target,
    operation = operation,
    value = spec.value or spec.factor or spec.amount or 1,
    selectorPortId = spec.port,
    selectorRefId = spec.item or spec.reference
  }
end
local function effect_family(target)
  return {
    add = function(spec) return amount_effect(target, "add", spec) end,
    multiply = function(spec) return amount_effect(target, "multiply", spec) end,
    divide = function(spec) return amount_effect(target, "divide", spec) end,
    set = function(spec) return amount_effect(target, "set", spec) end,
    remove = function(spec) return amount_effect(target, "remove", spec) end
  }
end
fx.cycle_time = effect_family("cycleTime")
fx.inputs = effect_family("inputAmount")
fx.outputs = effect_family("outputAmount")
fx.probability = effect_family("outputProbability")
function fx.inputs.create(spec)
  assert(type(spec) == "table", "fx.inputs.create expects a table")
  return {
    id = spec.id or "create-input",
    target = "addInput",
    operation = "add",
    value = 1,
    port = {
      key = assert(spec.key, "input key is required"),
      refType = spec.tag and "tag" or "item",
      refId = assert(spec.item or spec.tag, "input item or tag is required"),
      amount = assert(spec.amount, "input amount is required"),
      merge = spec.merge and "byReference" or "separate"
    }
  }
end
function fx.outputs.create(spec)
  assert(type(spec) == "table", "fx.outputs.create expects a table")
  return {
    id = spec.id or "create-output",
    target = "addOutput",
    operation = "add",
    value = 1,
    port = {
      key = assert(spec.key, "output key is required"),
      refId = assert(spec.item, "output item is required"),
      amount = assert(spec.amount, "output amount is required"),
      probability = spec.probability or 1,
      merge = spec.merge and "byReference" or "separate"
    }
  }
end
`;

export type LuaUiNode = {
  type: "row" | "column" | "grid" | "group" | "label" | "icon" | "spacer" | "button" | "number" | "text_input" | "select" | "dropdown" | "slider" | "toggle" | "counter" | "module_slot" | "module_counter" | "target_output" | "popup";
  children?: LuaUiNode[];
  trigger?: LuaUiNode;
  content?: LuaUiNode;
  [key: string]: unknown;
};

export type LuaSystemInspection = {
  parameters: RecipeParameterDefinition[];
  defaults: Record<string, ModuleValue>;
};

export type LuaPropertyValue = string | number | boolean | null | LuaPropertyValue[] | { [key: string]: LuaPropertyValue };

export type LuaModuleInspection = {
  properties: Record<string, LuaPropertyValue>;
};

export type LuaRunResult<T> = { value: T; error?: undefined } | { value: T; error: string };
const inspectionCache = new Map<string, LuaRunResult<LuaSystemInspection>>();
const moduleInspectionCache = new Map<string, LuaRunResult<LuaModuleInspection>>();

const errorText = (state: unknown): string => {
  const raw = lua.lua_tostring(state, -1);
  return raw ? to_jsstring(raw) : i18n.t("ui.modules.runtime.unknownScript");
};

const pushValue = (state: unknown, value: unknown, depth = 0): void => {
  if (depth > MAX_VALUE_DEPTH) throw new Error(i18n.t("ui.modules.runtime.contextTooDeep"));
  if (value === null || value === undefined) {
    lua.lua_pushnil(state);
    return;
  }
  if (typeof value === "boolean") {
    lua.lua_pushboolean(state, value);
    return;
  }
  if (typeof value === "number") {
    lua.lua_pushnumber(state, Number.isFinite(value) ? value : 0);
    return;
  }
  if (typeof value === "string") {
    lua.lua_pushstring(state, to_luastring(value));
    return;
  }
  if (Array.isArray(value)) {
    lua.lua_createtable(state, value.length, 0);
    value.forEach((entry, index) => {
      pushValue(state, entry, depth + 1);
      lua.lua_rawseti(state, -2, index + 1);
    });
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    lua.lua_createtable(state, 0, entries.length);
    for (const [key, entry] of entries) {
      pushValue(state, entry, depth + 1);
      lua.lua_setfield(state, -2, to_luastring(key));
    }
    return;
  }
  lua.lua_pushnil(state);
};

const readValue = (state: unknown, index: number, budget: { entries: number }, depth = 0): unknown => {
  if (depth > MAX_VALUE_DEPTH) throw new Error(i18n.t("ui.modules.runtime.resultTooDeep"));
  const type = lua.lua_type(state, index);
  if (type === lua.LUA_TNIL) return null;
  if (type === lua.LUA_TBOOLEAN) return Boolean(lua.lua_toboolean(state, index));
  if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(state, index);
  if (type === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(state, index));
  if (type !== lua.LUA_TTABLE) return undefined;

  if (!lua.lua_checkstack(state, 4)) throw new Error(i18n.t("ui.modules.runtime.uiStackTooDeep"));
  const absolute = lua.lua_absindex(state, index);
  const numeric = new Map<number, unknown>();
  const named: Record<string, unknown> = {};
  lua.lua_pushnil(state);
  while (lua.lua_next(state, absolute)) {
    budget.entries += 1;
    if (budget.entries > MAX_TABLE_ENTRIES) throw new Error(i18n.t("ui.modules.runtime.tooMuchData"));
    const value = readValue(state, -1, budget, depth + 1);
    const keyType = lua.lua_type(state, -2);
    if (keyType === lua.LUA_TNUMBER) numeric.set(lua.lua_tonumber(state, -2), value);
    else if (keyType === lua.LUA_TSTRING) named[to_jsstring(lua.lua_tostring(state, -2))] = value;
    lua.lua_pop(state, 1);
  }

  const numericKeys = [...numeric.keys()].sort((left, right) => left - right);
  const isArray = Object.keys(named).length === 0 && numericKeys.every((key, offset) => key === offset + 1);
  if (isArray) return numericKeys.map((key) => numeric.get(key));
  for (const key of numericKeys) named[String(key)] = numeric.get(key);
  return named;
};

const createSandbox = (): unknown => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  for (const name of ["os", "io", "package", "debug", "js", "fengari", "require", "dofile", "loadfile", "load", "collectgarbage"]) {
    lua.lua_pushnil(state);
    lua.lua_setglobal(state, to_luastring(name));
  }
  lua.lua_sethook(state, (hookState: unknown) => lauxlib.luaL_error(hookState, to_luastring(i18n.t("ui.modules.runtime.instructionLimit"))), lua.LUA_MASKCOUNT, MAX_INSTRUCTIONS);
  return state;
};

const runProgram = (source: string, callback?: string, context?: unknown): unknown => {
  if (!source.trim()) throw new Error(i18n.t("ui.modules.runtime.codeRequired"));
  if (source.length > MAX_SCRIPT_LENGTH) throw new Error(i18n.t("ui.modules.runtime.codeTooLong", { count: MAX_SCRIPT_LENGTH }));
  const state = createSandbox();
  try {
    const status = lauxlib.luaL_loadstring(state, to_luastring(`${LUA_MODULE_API}\n${source}`));
    if (status !== lua.LUA_OK) throw new Error(errorText(state));
    if (lua.lua_pcall(state, 0, 1, 0) !== lua.LUA_OK) throw new Error(errorText(state));
    if (!lua.lua_istable(state, -1)) throw new Error(i18n.t("ui.modules.runtime.returnRequired"));

    if (callback) {
      lua.lua_getfield(state, -1, to_luastring(callback));
      if (lua.lua_isnil(state, -1)) return null;
      if (!lua.lua_isfunction(state, -1)) throw new Error(i18n.t("ui.modules.runtime.callbackFunction", { name: callback }));
      pushValue(state, context ?? {});
      if (lua.lua_pcall(state, 1, 1, 0) !== lua.LUA_OK) throw new Error(errorText(state));
    }
    return readValue(state, -1, { entries: 0 });
  } finally {
    lua.lua_close(state);
  }
};

const finiteNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const textValue = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

const parsePropertyValue = (value: unknown, budget: { entries: number }, depth = 0): LuaPropertyValue => {
  if (depth > 12) throw new Error(i18n.t("ui.modules.runtime.propertiesTooDeep"));
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(i18n.t("ui.modules.runtime.propertiesFinite"));
    return value;
  }
  if (Array.isArray(value)) {
    budget.entries += value.length;
    if (budget.entries > 1_000) throw new Error(i18n.t("ui.modules.runtime.propertiesTooLarge"));
    return value.map((entry) => parsePropertyValue(entry, budget, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    budget.entries += entries.length;
    if (budget.entries > 1_000) throw new Error(i18n.t("ui.modules.runtime.propertiesTooLarge"));
    return Object.fromEntries(entries.map(([key, entry]) => [key, parsePropertyValue(entry, budget, depth + 1)]));
  }
  throw new Error(i18n.t("ui.modules.runtime.propertiesTypes"));
};

export const inspectLuaModule = (source: string): LuaRunResult<LuaModuleInspection> => {
  const cacheKey = `${i18n.resolvedLanguage ?? i18n.language}:${source}`;
  const cached = moduleInspectionCache.get(cacheKey);
  if (cached) return cached;
  let result: LuaRunResult<LuaModuleInspection>;
  try {
    const definition = runProgram(source) as Record<string, unknown>;
    const raw = definition.properties;
    const properties = raw === undefined || raw === null || Array.isArray(raw) && raw.length === 0
      ? {}
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? parsePropertyValue(raw, { entries: 0 }) as Record<string, LuaPropertyValue>
        : (() => { throw new Error(i18n.t("ui.modules.runtime.propertiesTable")); })();
    result = { value: { properties } };
  } catch (error) {
    result = { value: { properties: {} }, error: error instanceof Error ? error.message : i18n.t("ui.modules.runtime.invalidModule") };
  }
  if (moduleInspectionCache.size >= 128) moduleInspectionCache.delete(moduleInspectionCache.keys().next().value as string);
  moduleInspectionCache.set(cacheKey, result);
  return result;
};

const parseParameter = (value: unknown): RecipeParameterDefinition | null => {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = textValue(entry.id);
  const label = textValue(entry.label);
  const type = textValue(entry.type);
  if (!id || !label || !["number", "toggle", "text", "select"].includes(type ?? "")) return null;
  const options = Array.isArray(entry.options)
    ? entry.options.flatMap((option) => typeof option === "string" ? [{ value: option, label: option }] : option && typeof option === "object" && typeof (option as Record<string, unknown>).value === "string"
      ? [{ value: String((option as Record<string, unknown>).value), label: String((option as Record<string, unknown>).label ?? (option as Record<string, unknown>).value) }]
      : [])
    : undefined;
  return {
    id,
    label,
    type: type as RecipeParameterDefinition["type"],
    description: textValue(entry.description),
    defaultValue: typeof entry.default === "number" || typeof entry.default === "boolean" || typeof entry.default === "string" ? entry.default : undefined,
    min: finiteNumber(entry.min),
    max: finiteNumber(entry.max),
    step: finiteNumber(entry.step),
    integer: entry.integer === true,
    placeholder: textValue(entry.placeholder),
    options
  };
};

export const inspectLuaSystem = (source: string): LuaRunResult<LuaSystemInspection> => {
  const cacheKey = `${i18n.resolvedLanguage ?? i18n.language}:${source}`;
  const cached = inspectionCache.get(cacheKey);
  if (cached) return cached;
  let result: LuaRunResult<LuaSystemInspection>;
  try {
    const definition = runProgram(source) as Record<string, unknown>;
    const parameters = Array.isArray(definition.parameters) ? definition.parameters.map(parseParameter).filter((entry): entry is RecipeParameterDefinition => Boolean(entry)) : [];
    const defaults = definition.defaults && typeof definition.defaults === "object" && !Array.isArray(definition.defaults)
      ? Object.fromEntries(Object.entries(definition.defaults as Record<string, unknown>).filter(([, value]) => typeof value === "number" || typeof value === "boolean" || typeof value === "string")) as Record<string, ModuleValue>
      : {};
    result = { value: { parameters, defaults } };
  } catch (error) {
    result = { value: { parameters: [], defaults: {} }, error: error instanceof Error ? error.message : i18n.t("ui.modules.runtime.invalidSystem") };
  }
  if (inspectionCache.size >= 128) inspectionCache.delete(inspectionCache.keys().next().value as string);
  inspectionCache.set(cacheKey, result);
  return result;
};

export const resolveLuaRecipeParameters = (source: string, provided: Record<string, ModuleValue> = {}): Record<string, ModuleValue> => {
  const inspection = inspectLuaSystem(source);
  const resolved: Record<string, ModuleValue> = {};
  for (const parameter of inspection.value.parameters) {
    const fallback = parameter.defaultValue ?? (parameter.type === "toggle" ? false : parameter.type === "number" ? parameter.min ?? 0 : "");
    const candidate = provided[parameter.id] ?? fallback;
    if (parameter.type === "number") {
      const numeric = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : Number(fallback) || 0;
      const bounded = Math.min(parameter.max ?? Number.POSITIVE_INFINITY, Math.max(parameter.min ?? Number.NEGATIVE_INFINITY, numeric));
      resolved[parameter.id] = parameter.integer ? Math.round(bounded) : bounded;
    } else if (parameter.type === "toggle") resolved[parameter.id] = candidate === true;
    else if (parameter.type === "select") {
      const text = String(candidate);
      resolved[parameter.id] = parameter.options?.some((option) => option.value === text) ? text : String(fallback);
    } else resolved[parameter.id] = String(candidate);
  }
  return { ...provided, ...resolved };
};

const validBinding = (value: unknown): boolean => typeof value === "string" || Boolean(value && typeof value === "object" && !Array.isArray(value) && (
  ((value as Record<string, unknown>).kind === "value" && typeof (value as Record<string, unknown>).key === "string")
  || ((value as Record<string, unknown>).kind === "slot" && finiteNumber((value as Record<string, unknown>).slot) !== undefined)
));

const parseUiNode = (value: unknown, budget: { nodes: number } = { nodes: 0 }): LuaUiNode | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  budget.nodes += 1;
  if (budget.nodes > 250) throw new Error(i18n.t("ui.modules.runtime.uiTooLarge", { count: 250 }));
  const raw = value as Record<string, unknown>;
  const type = textValue(raw.type);
  const allowed = ["row", "column", "grid", "group", "label", "icon", "spacer", "button", "number", "text_input", "select", "dropdown", "slider", "toggle", "counter", "module_slot", "module_counter", "target_output", "popup"];
  if (!type || !allowed.includes(type)) throw new Error(i18n.t("ui.modules.runtime.unsupportedPrimitive", { type: type ?? i18n.t("ui.modules.runtime.missingType") }));
  if (["number", "text_input", "select", "dropdown", "slider", "toggle", "counter"].includes(type) && !validBinding(raw.bind)) throw new Error(i18n.t("ui.modules.runtime.bindingRequired", { type }));
  if (type === "module_slot" && finiteNumber(raw.slot) === undefined) throw new Error(i18n.t("ui.modules.runtime.moduleSlotIndexRequired"));
  if (type === "module_counter" && (!textValue(raw.module) || finiteNumber(raw.max) === undefined)) throw new Error(i18n.t("ui.modules.runtime.moduleCounterRequired"));
  if (type === "target_output" && (!textValue(raw.bind) || !textValue(raw.drives))) throw new Error(i18n.t("ui.modules.runtime.targetOutputRequired"));
  const children = Array.isArray(raw.children) ? raw.children.map((child) => parseUiNode(child, budget)).filter((child): child is LuaUiNode => Boolean(child)) : undefined;
  const trigger = type === "popup" ? parseUiNode(raw.trigger, budget) : undefined;
  const content = type === "popup" ? parseUiNode(raw.content, budget) : undefined;
  if (type === "popup" && (!trigger || !content)) throw new Error(i18n.t("ui.modules.runtime.popupRequired"));
  return { ...raw, type: type as LuaUiNode["type"], children, trigger: trigger ?? undefined, content: content ?? undefined };
};

export const renderLuaSystem = (source: string, context: unknown): LuaRunResult<LuaUiNode | null> => {
  try {
    return { value: parseUiNode(runProgram(source, "node", context)) };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : i18n.t("ui.modules.runtime.nodeUiFailed") };
  }
};

const constrainSlotPolicies = (slotPolicies: Map<number, Set<string> | null>, moduleCapacities: Map<string, number>, slots: Array<string | null>): Array<string | null> => {
  if (slotPolicies.size > 0) {
    const maximumSlot = Math.max(...slotPolicies.keys());
    const counts = new Map<string, number>();
    return Array.from({ length: maximumSlot }, (_, index) => {
      const policy = slotPolicies.get(index + 1);
      if (policy === undefined) return null;
      const moduleId = slots[index] ?? null;
      if (moduleId && policy && !policy.has(moduleId)) return null;
      if (!moduleId || !moduleCapacities.has(moduleId)) return moduleId;
      const next = (counts.get(moduleId) ?? 0) + 1;
      counts.set(moduleId, next);
      return next <= (moduleCapacities.get(moduleId) ?? 0) ? moduleId : null;
    });
  }
  if (moduleCapacities.size === 0) return [];
  const counts = new Map<string, number>();
  return slots.filter((moduleId) => {
    if (!moduleId || !moduleCapacities.has(moduleId)) return false;
    const next = (counts.get(moduleId) ?? 0) + 1;
    counts.set(moduleId, next);
    return next <= (moduleCapacities.get(moduleId) ?? 0);
  });
};

const constrainFromUiShortcuts = (root: LuaUiNode | null, slots: Array<string | null>): Array<string | null> => {
  const slotPolicies = new Map<number, Set<string> | null>();
  const moduleCapacities = new Map<string, number>();
  const visit = (node: LuaUiNode) => {
    if (node.type === "module_slot") {
      const slot = Math.floor(finiteNumber(node.slot) ?? 0);
      if (slot < 1 || slot > 64) throw new Error(i18n.t("ui.modules.runtime.moduleSlotRange"));
      if (slotPolicies.has(slot)) throw new Error(i18n.t("ui.modules.runtime.moduleSlotDuplicate", { slot }));
      const allowed = Array.isArray(node.modules)
        ? new Set(node.modules.filter((value): value is string => typeof value === "string" && value.length > 0))
        : null;
      slotPolicies.set(slot, allowed);
    }
    if (node.type === "module_counter" && typeof node.module === "string") {
      const maximum = finiteNumber(node.max) ?? 0;
      moduleCapacities.set(node.module, Math.max(0, Math.min(64, Math.floor(maximum))));
    }
    node.children?.forEach(visit);
    if (node.trigger) visit(node.trigger);
    if (node.content) visit(node.content);
  };
  if (root) visit(root);
  return constrainSlotPolicies(slotPolicies, moduleCapacities, slots);
};

const parseDeclaredSlotPolicies = (value: unknown): Map<number, Set<string> | null> => {
  if (!Array.isArray(value)) throw new Error(i18n.t("ui.modules.runtime.slotsArray"));
  const policies = new Map<number, Set<string> | null>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(i18n.t("ui.modules.runtime.slotEntry"));
    const entry = raw as Record<string, unknown>;
    const slot = Math.floor(finiteNumber(entry.slot) ?? 0);
    if (slot < 1 || slot > 64) throw new Error(i18n.t("ui.modules.runtime.slotRange"));
    if (policies.has(slot)) throw new Error(i18n.t("ui.modules.runtime.slotDuplicate", { slot }));
    if (entry.modules !== undefined && (!Array.isArray(entry.modules) || entry.modules.some((moduleId) => typeof moduleId !== "string"))) {
      throw new Error(i18n.t("ui.modules.runtime.slotModulesArray"));
    }
    policies.set(slot, Array.isArray(entry.modules) ? new Set(entry.modules as string[]) : null);
  }
  return policies;
};

export const constrainLuaModuleSlots = (source: string, context: unknown, slots: Array<string | null>): LuaRunResult<Array<string | null>> => {
  try {
    const declared = runProgram(source, "slots", context);
    if (declared !== null) return { value: constrainSlotPolicies(parseDeclaredSlotPolicies(declared), new Map(), slots) };
    const rendered = renderLuaSystem(source, context);
    if (rendered.error) return { value: [], error: rendered.error };
    return { value: constrainFromUiShortcuts(rendered.value, slots) };
  } catch (error) {
    return { value: [], error: error instanceof Error ? error.message : i18n.t("ui.modules.runtime.slotPolicyFailed") };
  }
};

const parseEffect = (value: unknown, index: number): ModuleEffect | null => {
  if (!value || typeof value !== "object") return null;
  const effect = value as Record<string, unknown>;
  const target = textValue(effect.target);
  const operation = textValue(effect.operation);
  if (!target || !operation || !["cycleTime", "inputAmount", "outputAmount", "outputProbability", "addInput", "addOutput"].includes(target) || !["add", "multiply", "divide", "set", "remove"].includes(operation)) return null;
  if (effect.value !== undefined && finiteNumber(effect.value) === undefined) return null;
  const port = effect.port && typeof effect.port === "object" ? effect.port as Record<string, unknown> : undefined;
  return {
    id: textValue(effect.id) ?? `lua-effect-${index + 1}`,
    target: target as ModuleEffect["target"],
    operation: operation as ModuleEffect["operation"],
    value: finiteNumber(effect.value) ?? 1,
    selectorPortId: textValue(effect.selectorPortId),
    selectorRefId: textValue(effect.selectorRefId),
    port: port && textValue(port.key) && textValue(port.refId) && finiteNumber(port.amount) !== undefined ? {
      key: textValue(port.key)!,
      refType: port.refType === "tag" ? "tag" : "item",
      refId: textValue(port.refId)!,
      amount: finiteNumber(port.amount)!,
      probability: finiteNumber(port.probability),
      merge: port.merge === "byReference" ? "byReference" : "separate"
    } : undefined
  };
};

export const runLuaEffects = (source: string, context: unknown): LuaRunResult<ModuleEffect[]> => {
  try {
    const raw = runProgram(source, "apply", context);
    if (raw === null) return { value: [] };
    if (!Array.isArray(raw)) throw new Error(i18n.t("ui.modules.runtime.effectsArray"));
    const effects = raw.map(parseEffect).filter((effect): effect is ModuleEffect => Boolean(effect));
    if (effects.length !== raw.length) throw new Error(i18n.t("ui.modules.runtime.invalidEffect"));
    return { value: effects };
  } catch (error) {
    return { value: [], error: error instanceof Error ? error.message : i18n.t("ui.modules.runtime.effectsFailed") };
  }
};

export const validateLuaModule = (source: string): string | null => {
  return inspectLuaModule(source).error ?? null;
};
