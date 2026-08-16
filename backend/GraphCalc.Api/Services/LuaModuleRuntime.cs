using System.Text.Json;
using GraphCalc.Api.Contracts;
using MoonSharp.Interpreter;

namespace GraphCalc.Api.Services;

internal sealed record LuaEffectsResult(IReadOnlyList<ModuleEffectDto> Effects, string? Error);
internal sealed record LuaDefaultsResult(IReadOnlyDictionary<string, object?> Defaults, string? Error);
internal sealed record LuaPropertiesResult(IReadOnlyDictionary<string, object?> Properties, string? Error);
internal sealed record LuaSlotsResult(IReadOnlyList<string?> Slots, string? Error);
internal sealed record LuaParametersResult(IReadOnlyDictionary<string, object?> Parameters, string? Error);

internal static class LuaModuleRuntime
{
    private const int MaxScriptLength = 100_000;
    private const int AutoYieldInstructions = 10_000;
    private const int MaxAutoYields = 25;

    // Public API shared with frontend/src/domain/luaModuleRuntime.ts.
    private const string Api = """
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
  for index = 1, count do result[index] = { slot = index, modules = definition.modules } end
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
    if type(key) == "number" then table.insert(numeric, { key = key, value = value }) else result[key] = value end
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
    id = spec.id or (target .. "-" .. operation), target = target, operation = operation,
    value = spec.value or spec.factor or spec.amount or 1,
    selectorPortId = spec.port, selectorRefId = spec.item or spec.reference
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
    id = spec.id or "create-input", target = "addInput", operation = "add", value = 1,
    port = {
      key = assert(spec.key, "input key is required"), refType = spec.tag and "tag" or "item",
      refId = assert(spec.item or spec.tag, "input item or tag is required"),
      amount = assert(spec.amount, "input amount is required"),
      merge = spec.merge and "byReference" or "separate"
    }
  }
end
function fx.outputs.create(spec)
  assert(type(spec) == "table", "fx.outputs.create expects a table")
  return {
    id = spec.id or "create-output", target = "addOutput", operation = "add", value = 1,
    port = {
      key = assert(spec.key, "output key is required"), item = spec.item,
      refId = assert(spec.item, "output item is required"), amount = assert(spec.amount, "output amount is required"),
      probability = spec.probability or 1, merge = spec.merge and "byReference" or "separate"
    }
  }
end
""";

    public static LuaDefaultsResult ReadDefaults(string source)
    {
        try
        {
            var (_, definition) = Load(source);
            var defaultsValue = definition.Table.Get("defaults");
            if (defaultsValue.Type is DataType.Void or DataType.Nil) return new LuaDefaultsResult(new Dictionary<string, object?>(), null);
            if (defaultsValue.Type != DataType.Table) throw new InvalidOperationException("defaults must be a table.");
            var defaults = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var pair in defaultsValue.Table.Pairs)
            {
                if (pair.Key.Type != DataType.String) continue;
                defaults[pair.Key.String] = pair.Value.Type switch
                {
                    DataType.Number when double.IsFinite(pair.Value.Number) => pair.Value.Number,
                    DataType.Boolean => pair.Value.Boolean,
                    DataType.String => pair.Value.String,
                    _ => null
                };
            }
            return new LuaDefaultsResult(defaults, null);
        }
        catch (Exception exception)
        {
            return new LuaDefaultsResult(new Dictionary<string, object?>(), FormatError(exception));
        }
    }

    public static LuaPropertiesResult ReadProperties(string source)
    {
        try
        {
            var (_, definition) = Load(source);
            var propertiesValue = definition.Table.Get("properties");
            if (propertiesValue.Type is DataType.Void or DataType.Nil) return new LuaPropertiesResult(new Dictionary<string, object?>(), null);
            if (propertiesValue.Type != DataType.Table) throw new InvalidOperationException("module.properties must be a table with string keys.");
            var budget = 0;
            var properties = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var pair in propertiesValue.Table.Pairs)
            {
                if (pair.Key.Type != DataType.String) throw new InvalidOperationException("module.properties must be a table with string keys.");
                budget += 1;
                if (budget > 1_000) throw new InvalidOperationException("Module properties contain too much data.");
                properties[pair.Key.String] = ReadPropertyValue(pair.Value, ref budget, 1);
            }
            return new LuaPropertiesResult(properties, null);
        }
        catch (Exception exception)
        {
            return new LuaPropertiesResult(new Dictionary<string, object?>(), FormatError(exception));
        }
    }

    public static LuaParametersResult ResolveParameters(string source, IReadOnlyDictionary<string, JsonElement> provided)
    {
        try
        {
            var (_, definition) = Load(source);
            var result = provided.ToDictionary(entry => entry.Key, entry => JsonValue(entry.Value), StringComparer.Ordinal);
            var parameterValues = definition.Table.Get("parameters");
            if (parameterValues.Type is DataType.Void or DataType.Nil) return new LuaParametersResult(result, null);
            if (parameterValues.Type != DataType.Table) throw new InvalidOperationException("parameters must be an array.");
            for (var index = 1; index <= parameterValues.Table.Length; index++)
            {
                var value = parameterValues.Table.Get(index);
                if (value.Type != DataType.Table) throw new InvalidOperationException($"Parameter {index} must be a table.");
                var id = OptionalString(value.Table, "id") ?? throw new InvalidOperationException($"Parameter {index} requires id.");
                var type = OptionalString(value.Table, "type") ?? throw new InvalidOperationException($"Parameter {id} requires type.");
                var fallback = PrimitiveValue(value.Table.Get("default")) ?? (type == "toggle" ? false : type == "number" ? OptionalNumber(value.Table, "min") ?? 0.0 : string.Empty);
                var candidate = result.GetValueOrDefault(id) ?? fallback;
                result[id] = type switch
                {
                    "number" => ResolveNumber(candidate, value.Table),
                    "toggle" => candidate is true,
                    "text" => Convert.ToString(candidate) ?? string.Empty,
                    "select" => ResolveSelect(candidate, fallback, value.Table),
                    _ => throw new InvalidOperationException($"Parameter {id} has unsupported type '{type}'.")
                };
            }
            return new LuaParametersResult(result, null);
        }
        catch (Exception exception)
        {
            return new LuaParametersResult(new Dictionary<string, object?>(), FormatError(exception));
        }
    }

    public static LuaEffectsResult RunEffects(string source, IReadOnlyDictionary<string, object?> context)
    {
        try
        {
            var (script, definition) = Load(source);
            var apply = definition.Table.Get("apply");
            if (apply.Type is DataType.Void or DataType.Nil) return new LuaEffectsResult([], null);
            if (apply.Type is not (DataType.Function or DataType.ClrFunction)) throw new InvalidOperationException("apply must be a function.");
            var result = RunLimited(script, apply, ToDynValue(script, context));
            if (result.Type is DataType.Void or DataType.Nil) return new LuaEffectsResult([], null);
            if (result.Type != DataType.Table) throw new InvalidOperationException("apply(ctx) must return an array of fx.* effects.");
            var effects = new List<ModuleEffectDto>();
            for (var index = 1; index <= result.Table.Length; index++)
            {
                effects.Add(ParseEffect(result.Table.Get(index), index));
            }
            return new LuaEffectsResult(effects, null);
        }
        catch (Exception exception)
        {
            return new LuaEffectsResult([], FormatError(exception));
        }
    }

    public static LuaSlotsResult ConstrainSlots(string source, IReadOnlyDictionary<string, object?> context, IReadOnlyList<string?> slots)
    {
        try
        {
            var (script, definition) = Load(source);
            var slotPolicies = new SortedDictionary<int, HashSet<string>?>();
            var moduleCapacities = new Dictionary<string, int>(StringComparer.Ordinal);
            var declaredSlots = definition.Table.Get("slots");
            if (declaredSlots.Type is DataType.Function or DataType.ClrFunction)
            {
                var declared = RunLimited(script, declaredSlots, ToDynValue(script, context));
                if (declared.Type != DataType.Table) throw new InvalidOperationException("slots(ctx) must return an array of module_bay.slot policies.");
                ReadDeclaredSlotPolicies(declared.Table, slotPolicies);
                return new LuaSlotsResult(ApplySlotPolicies(slotPolicies, moduleCapacities, slots), null);
            }
            if (declaredSlots.Type is not (DataType.Void or DataType.Nil)) throw new InvalidOperationException("slots must be a function.");

            var node = definition.Table.Get("node");
            if (node.Type is DataType.Void or DataType.Nil) return new LuaSlotsResult([], null);
            if (node.Type is not (DataType.Function or DataType.ClrFunction)) throw new InvalidOperationException("node must be a function.");
            var root = RunLimited(script, node, ToDynValue(script, context));
            if (root.Type is DataType.Void or DataType.Nil) return new LuaSlotsResult([], null);
            if (root.Type != DataType.Table) throw new InvalidOperationException("node(ctx) must return one ui.* primitive.");
            var nodeCount = 0;
            ReadSlotPolicies(root.Table, slotPolicies, moduleCapacities, ref nodeCount, 0);
            return new LuaSlotsResult(ApplySlotPolicies(slotPolicies, moduleCapacities, slots), null);
        }
        catch (Exception exception)
        {
            return new LuaSlotsResult([], FormatError(exception));
        }
    }

    private static IReadOnlyList<string?> ApplySlotPolicies(SortedDictionary<int, HashSet<string>?> slotPolicies, Dictionary<string, int> moduleCapacities, IReadOnlyList<string?> slots)
    {
        if (slotPolicies.Count > 0)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var constrained = Enumerable.Range(0, slotPolicies.Keys.Max()).Select(index => index < slots.Count ? slots[index] : null).ToList();
            for (var index = 0; index < constrained.Count; index++)
            {
                var moduleId = constrained[index];
                if (!slotPolicies.TryGetValue(index + 1, out var allowedModules))
                {
                    constrained[index] = null;
                    continue;
                }
                if (moduleId is not null && allowedModules is not null && !allowedModules.Contains(moduleId))
                {
                    constrained[index] = null;
                    continue;
                }
                if (moduleId is null || !moduleCapacities.TryGetValue(moduleId, out var maximum)) continue;
                var count = counts.GetValueOrDefault(moduleId) + 1;
                counts[moduleId] = count;
                if (count > maximum) constrained[index] = null;
            }
            return constrained;
        }
        if (moduleCapacities.Count == 0) return [];
        var filtered = new List<string?>();
        var moduleCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var moduleId in slots)
        {
            if (moduleId is null || !moduleCapacities.TryGetValue(moduleId, out var maximum)) continue;
            var count = moduleCounts.GetValueOrDefault(moduleId) + 1;
            moduleCounts[moduleId] = count;
            if (count <= maximum) filtered.Add(moduleId);
        }
        return filtered;
    }

    private static (Script Script, DynValue Definition) Load(string source)
    {
        if (string.IsNullOrWhiteSpace(source)) throw new InvalidOperationException("Code is required.");
        if (source.Length > MaxScriptLength) throw new InvalidOperationException($"Code exceeds {MaxScriptLength} characters.");
        var script = new Script(CoreModules.Preset_HardSandbox);
        var chunk = script.LoadString($"{Api}\n{source}", null, "module-system.lua");
        var definition = RunLimited(script, chunk);
        if (definition.Type != DataType.Table) throw new InvalidOperationException("Code must return system { ... } or module { ... }.");
        return (script, definition);
    }

    private static DynValue RunLimited(Script script, DynValue function, params DynValue[] arguments)
    {
        var coroutine = script.CreateCoroutine(function).Coroutine;
        coroutine.AutoYieldCounter = AutoYieldInstructions;
        DynValue result = DynValue.Nil;
        for (var resume = 0; resume <= MaxAutoYields; resume++)
        {
            result = resume == 0 ? coroutine.Resume(arguments) : coroutine.Resume();
            if (coroutine.State == CoroutineState.Dead) return result;
            if (coroutine.State is not (CoroutineState.Suspended or CoroutineState.ForceSuspended)) throw new InvalidOperationException("The script entered an invalid state.");
        }
        throw new InvalidOperationException("Script instruction limit exceeded.");
    }

    private static DynValue ToDynValue(Script script, object? value)
    {
        if (value is null) return DynValue.Nil;
        if (value is bool boolean) return DynValue.NewBoolean(boolean);
        if (value is string text) return DynValue.NewString(text);
        if (value is byte or short or int or long or float or double or decimal) return DynValue.NewNumber(Convert.ToDouble(value));
        if (value is JsonElement json) return json.ValueKind switch
        {
            JsonValueKind.Number when json.TryGetDouble(out var number) => DynValue.NewNumber(number),
            JsonValueKind.True => DynValue.True,
            JsonValueKind.False => DynValue.False,
            JsonValueKind.String => DynValue.NewString(json.GetString() ?? string.Empty),
            _ => DynValue.Nil
        };
        if (value is System.Collections.IEnumerable sequence and not string and not System.Collections.IDictionary)
        {
            var table = new Table(script);
            var index = 1;
            foreach (var entry in sequence) table.Set(index++, ToDynValue(script, entry));
            return DynValue.NewTable(table);
        }
        if (value is System.Collections.IDictionary dictionary)
        {
            var table = new Table(script);
            foreach (System.Collections.DictionaryEntry entry in dictionary) table.Set(Convert.ToString(entry.Key) ?? string.Empty, ToDynValue(script, entry.Value));
            return DynValue.NewTable(table);
        }
        if (value is IReadOnlyDictionary<string, object?> readOnly)
        {
            var table = new Table(script);
            foreach (var (key, entry) in readOnly) table.Set(key, ToDynValue(script, entry));
            return DynValue.NewTable(table);
        }
        throw new InvalidOperationException($"Unsupported script context value: {value.GetType().Name}.");
    }

    private static ModuleEffectDto ParseEffect(DynValue value, int index)
    {
        if (value.Type != DataType.Table) throw new InvalidOperationException($"Effect {index} must be a table.");
        var table = value.Table;
        var target = RequiredString(table, "target", index);
        var operation = RequiredString(table, "operation", index);
        if (target is not ("cycleTime" or "inputAmount" or "outputAmount" or "outputProbability" or "addInput" or "addOutput")) throw new InvalidOperationException($"Effect {index} has an invalid target.");
        if (operation is not ("add" or "multiply" or "divide" or "set" or "remove")) throw new InvalidOperationException($"Effect {index} has an invalid operation.");
        var rawEffectValue = table.Get("value");
        if (rawEffectValue.Type == DataType.Number && !double.IsFinite(rawEffectValue.Number) || rawEffectValue.Type is not (DataType.Void or DataType.Nil or DataType.Number)) throw new InvalidOperationException($"Effect {index} has an invalid value.");
        var portValue = table.Get("port");
        ModulePortDefinitionDto? port = null;
        if (portValue.Type == DataType.Table)
        {
            port = new ModulePortDefinitionDto
            {
                Key = RequiredString(portValue.Table, "key", index),
                RefType = OptionalString(portValue.Table, "refType"),
                RefId = RequiredString(portValue.Table, "refId", index),
                Amount = RequiredNumber(portValue.Table, "amount", index),
                Probability = OptionalNumber(portValue.Table, "probability"),
                Merge = OptionalString(portValue.Table, "merge")
            };
        }
        return new ModuleEffectDto
        {
            Id = OptionalString(table, "id") ?? $"lua-effect-{index}",
            Target = target,
            Operation = operation,
            Value = OptionalNumber(table, "value") ?? 1,
            SelectorPortId = OptionalString(table, "selectorPortId"),
            SelectorRefId = OptionalString(table, "selectorRefId"),
            Port = port
        };
    }

    private static object? JsonValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number when value.TryGetDouble(out var number) => number,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => value.GetString() ?? string.Empty,
        _ => null
    };

    private static object? PrimitiveValue(DynValue value) => value.Type switch
    {
        DataType.Number when double.IsFinite(value.Number) => value.Number,
        DataType.Boolean => value.Boolean,
        DataType.String => value.String,
        _ => null
    };

    private static double ResolveNumber(object candidate, Table definition)
    {
        var numeric = candidate is double number && double.IsFinite(number) ? number : OptionalNumber(definition, "default") ?? OptionalNumber(definition, "min") ?? 0;
        numeric = Math.Min(OptionalNumber(definition, "max") ?? double.PositiveInfinity, Math.Max(OptionalNumber(definition, "min") ?? double.NegativeInfinity, numeric));
        return definition.Get("integer").CastToBool() ? Math.Round(numeric) : numeric;
    }

    private static string ResolveSelect(object candidate, object fallback, Table definition)
    {
        var text = Convert.ToString(candidate) ?? string.Empty;
        var options = definition.Get("options");
        if (options.Type != DataType.Table) return text;
        for (var index = 1; index <= options.Table.Length; index++)
        {
            var option = options.Table.Get(index);
            var value = option.Type == DataType.String ? option.String : option.Type == DataType.Table ? OptionalString(option.Table, "value") : null;
            if (value == text) return text;
        }
        return Convert.ToString(fallback) ?? string.Empty;
    }

    private static void ReadSlotPolicies(Table table, SortedDictionary<int, HashSet<string>?> slotPolicies, Dictionary<string, int> moduleCapacities, ref int nodeCount, int depth)
    {
        if (depth > 24) throw new InvalidOperationException("System UI is nested too deeply.");
        nodeCount += 1;
        if (nodeCount > 250) throw new InvalidOperationException("System UI exceeds the 250 primitive limit.");
        var type = OptionalString(table, "type");
        var allowed = new[] { "row", "column", "grid", "group", "label", "icon", "spacer", "button", "number", "text_input", "select", "dropdown", "slider", "toggle", "counter", "module_slot", "module_counter", "target_output", "popup" };
        if (type is null || !allowed.Contains(type, StringComparer.Ordinal)) throw new InvalidOperationException($"Unsupported UI primitive: {type ?? "missing type"}.");
        if (type is "number" or "text_input" or "select" or "dropdown" or "slider" or "toggle" or "counter" && !IsValidBinding(table.Get("bind"))) throw new InvalidOperationException($"{type} requires a value or slot binding.");
        if (type == "module_slot")
        {
            AddSlotPolicy(table, slotPolicies, "module_slot");
        }
        if (type == "module_counter")
        {
            var moduleId = OptionalString(table, "module");
            var maximum = OptionalNumber(table, "max");
            if (string.IsNullOrWhiteSpace(moduleId) || maximum is null) throw new InvalidOperationException("module_counter requires module and numeric max.");
            moduleCapacities[moduleId] = Math.Clamp((int)Math.Floor(maximum.Value), 0, 64);
        }
        if (type == "target_output" && (string.IsNullOrWhiteSpace(OptionalString(table, "bind")) || string.IsNullOrWhiteSpace(OptionalString(table, "drives")))) throw new InvalidOperationException("target_output requires bind and drives.");
        if (type == "popup")
        {
            var trigger = table.Get("trigger");
            var content = table.Get("content");
            if (trigger.Type != DataType.Table || content.Type != DataType.Table) throw new InvalidOperationException("popup requires trigger and content primitives.");
            ReadSlotPolicies(trigger.Table, slotPolicies, moduleCapacities, ref nodeCount, depth + 1);
            ReadSlotPolicies(content.Table, slotPolicies, moduleCapacities, ref nodeCount, depth + 1);
        }
        var children = table.Get("children");
        if (children.Type != DataType.Table) return;
        for (var index = 1; index <= children.Table.Length; index++)
        {
            var child = children.Table.Get(index);
            if (child.Type == DataType.Table) ReadSlotPolicies(child.Table, slotPolicies, moduleCapacities, ref nodeCount, depth + 1);
        }
    }

    private static void ReadDeclaredSlotPolicies(Table policies, SortedDictionary<int, HashSet<string>?> slotPolicies)
    {
        for (var index = 1; index <= policies.Length; index++)
        {
            var policy = policies.Get(index);
            if (policy.Type != DataType.Table) throw new InvalidOperationException("Each slots(ctx) entry must be a module_bay.slot policy.");
            AddSlotPolicy(policy.Table, slotPolicies, "Slot policy");
        }
    }

    private static void AddSlotPolicy(Table table, SortedDictionary<int, HashSet<string>?> slotPolicies, string label)
    {
        var slotValue = OptionalNumber(table, "slot") ?? throw new InvalidOperationException($"{label} requires a numeric one-based slot index.");
        var slot = (int)Math.Floor(slotValue);
        if (slot is < 1 or > 64) throw new InvalidOperationException($"{label} indices must be between 1 and 64.");
        if (slotPolicies.ContainsKey(slot)) throw new InvalidOperationException($"{label} {slot} is declared more than once.");
        HashSet<string>? allowedModules = null;
        var configuredModules = table.Get("modules");
        if (configuredModules.Type == DataType.Table)
        {
            allowedModules = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 1; index <= configuredModules.Table.Length; index++)
            {
                var module = configuredModules.Table.Get(index);
                if (module.Type != DataType.String) throw new InvalidOperationException($"{label} modules must contain module IDs.");
                allowedModules.Add(module.String);
            }
        }
        slotPolicies[slot] = allowedModules;
    }

    private static bool IsValidBinding(DynValue value)
    {
        if (value.Type == DataType.String) return !string.IsNullOrWhiteSpace(value.String);
        if (value.Type != DataType.Table) return false;
        var kind = OptionalString(value.Table, "kind");
        return kind == "value" && !string.IsNullOrWhiteSpace(OptionalString(value.Table, "key"))
            || kind == "slot" && OptionalNumber(value.Table, "slot") is not null;
    }

    private static object? ReadPropertyValue(DynValue value, ref int budget, int depth)
    {
        if (depth > 12) throw new InvalidOperationException("Module properties are nested too deeply.");
        if (value.Type is DataType.Void or DataType.Nil) return null;
        if (value.Type == DataType.String) return value.String;
        if (value.Type == DataType.Boolean) return value.Boolean;
        if (value.Type == DataType.Number)
        {
            if (!double.IsFinite(value.Number)) throw new InvalidOperationException("Module properties cannot contain non-finite numbers.");
            return value.Number;
        }
        if (value.Type != DataType.Table) throw new InvalidOperationException("Module properties may only contain strings, numbers, booleans, nil, arrays, and tables.");

        var named = new Dictionary<string, object?>(StringComparer.Ordinal);
        var numeric = new SortedDictionary<int, object?>();
        foreach (var pair in value.Table.Pairs)
        {
            budget += 1;
            if (budget > 1_000) throw new InvalidOperationException("Module properties contain too much data.");
            var entry = ReadPropertyValue(pair.Value, ref budget, depth + 1);
            if (pair.Key.Type == DataType.String) named[pair.Key.String] = entry;
            else if (pair.Key.Type == DataType.Number && double.IsInteger(pair.Key.Number) && pair.Key.Number is >= 1 and <= int.MaxValue) numeric[(int)pair.Key.Number] = entry;
            else throw new InvalidOperationException("Module property tables may only use string keys or positive integer indices.");
        }
        if (named.Count > 0)
        {
            foreach (var (key, entry) in numeric) named[key.ToString()] = entry;
            return named;
        }
        if (numeric.Count == 0) return named;
        if (numeric.Keys.SequenceEqual(Enumerable.Range(1, numeric.Count))) return numeric.Values.ToList();
        return numeric.ToDictionary(entry => entry.Key.ToString(), entry => entry.Value, StringComparer.Ordinal);
    }

    private static string RequiredString(Table table, string key, int index) => OptionalString(table, key) ?? throw new InvalidOperationException($"Effect {index} requires {key}.");
    private static string? OptionalString(Table table, string key) => table.Get(key).Type == DataType.String ? table.Get(key).String : null;
    private static double RequiredNumber(Table table, string key, int index) => OptionalNumber(table, key) ?? throw new InvalidOperationException($"Effect {index} requires numeric {key}.");
    private static double? OptionalNumber(Table table, string key)
    {
        var value = table.Get(key);
        return value.Type == DataType.Number && double.IsFinite(value.Number) ? value.Number : null;
    }
    private static string FormatError(Exception exception) => exception is InterpreterException interpreter ? interpreter.DecoratedMessage ?? interpreter.Message : exception.Message;
}
