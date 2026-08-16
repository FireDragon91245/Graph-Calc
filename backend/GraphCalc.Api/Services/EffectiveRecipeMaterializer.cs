using System.Text.Json;
using GraphCalc.Api.Contracts;

namespace GraphCalc.Api.Services;

internal sealed record MaterializedRecipe(
    string RecipeId,
    string Name,
    double TimeSeconds,
    List<Dictionary<string, object?>> Inputs,
    List<Dictionary<string, object?>> Outputs,
    IReadOnlyList<string> Diagnostics,
    bool IsValid);

internal static class EffectiveRecipeMaterializer
{
    public static MaterializedRecipe Materialize(RecipeDto recipe, JsonElement? nodeData, StoreData store)
    {
        var diagnostics = new List<string>();
        var timeSeconds = recipe.TimeSeconds;
        var inputs = recipe.Inputs.Select(input => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["id"] = input.Id,
            ["refType"] = input.RefType,
            ["refId"] = input.RefId,
            ["itemId"] = input.RefId,
            ["amount"] = input.Amount,
            ["amountPerCycle"] = input.Amount,
            ["origin"] = "recipe"
        }).ToList();
        var outputs = recipe.Outputs.Select(output => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["id"] = output.Id,
            ["itemId"] = output.ItemId,
            ["amount"] = output.Amount,
            ["amountPerCycle"] = output.Amount,
            ["probability"] = output.Probability,
            ["origin"] = "recipe"
        }).ToList();

        foreach (var support in recipe.ModuleSupport
                     .Where(entry => entry.Enabled)
                     .OrderBy(entry => entry.Order)
                     .ThenBy(entry => entry.SystemId, StringComparer.Ordinal))
        {
            var system = store.ModuleSystems.FirstOrDefault(entry => entry.Id == support.SystemId && !entry.Archived);
            if (system is null)
            {
                diagnostics.Add($"Missing upgrade system '{support.SystemId}'.");
                continue;
            }

            var state = ReadSystemState(nodeData, system);
            var disabled = support.DisabledModuleIds.ToHashSet(StringComparer.Ordinal);
            var enabledModules = store.ModuleDefinitions
                .Where(entry => entry.SystemId == system.Id && !entry.Archived && !disabled.Contains(entry.Id))
                .ToArray();
            var moduleProperties = new Dictionary<string, IReadOnlyDictionary<string, object?>>(StringComparer.Ordinal);
            foreach (var module in enabledModules)
            {
                var propertyResult = LuaModuleRuntime.ReadProperties(module.Lua);
                moduleProperties[module.Id] = propertyResult.Properties;
                if (propertyResult.Error is not null) diagnostics.Add($"{module.Name}: {propertyResult.Error}");
            }
            var parameterResult = LuaModuleRuntime.ResolveParameters(system.Lua, support.Parameters);
            if (parameterResult.Error is not null) diagnostics.Add($"{system.Name}: {parameterResult.Error}");
            var slotResult = LuaModuleRuntime.ConstrainSlots(system.Lua, BuildLuaContext(recipe, parameterResult.Parameters, state, system, enabledModules, moduleProperties, new Dictionary<string, object?>(), 1, timeSeconds, inputs, outputs), state.Slots);
            if (slotResult.Error is not null) diagnostics.Add($"{system.Name}: {slotResult.Error}");
            state.Slots.Clear();
            state.Slots.AddRange(slotResult.Slots);
            var moduleCounts = state.Slots
                .Where(moduleId => !string.IsNullOrWhiteSpace(moduleId))
                .GroupBy(moduleId => moduleId!, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

            foreach (var (moduleId, count) in moduleCounts)
            {
                if (disabled.Contains(moduleId))
                {
                    diagnostics.Add($"Module '{moduleId}' is disabled on recipe '{recipe.Name}'.");
                    continue;
                }

                var module = store.ModuleDefinitions.FirstOrDefault(entry => entry.Id == moduleId && !entry.Archived);
                if (module is null)
                {
                    diagnostics.Add($"Missing module '{moduleId}'.");
                    continue;
                }
                if (module.SystemId != system.Id)
                {
                    diagnostics.Add($"Module '{moduleId}' does not belong to upgrade system '{system.Name}'.");
                    continue;
                }

                var result = LuaModuleRuntime.RunEffects(module.Lua, BuildLuaContext(recipe, parameterResult.Parameters, state, system, enabledModules, moduleProperties, moduleProperties.GetValueOrDefault(module.Id) ?? new Dictionary<string, object?>(), count, timeSeconds, inputs, outputs));
                if (result.Error is not null) diagnostics.Add($"{module.Name}: {result.Error}");
                foreach (var effect in result.Effects)
                {
                    ApplyEffect(effect, $"module:{system.Id}:{module.Id}", ref timeSeconds, ref inputs, ref outputs, diagnostics);
                }
            }

            var systemResult = LuaModuleRuntime.RunEffects(system.Lua, BuildLuaContext(recipe, parameterResult.Parameters, state, system, enabledModules, moduleProperties, new Dictionary<string, object?>(), 1, timeSeconds, inputs, outputs));
            if (systemResult.Error is not null) diagnostics.Add($"{system.Name}: {systemResult.Error}");
            foreach (var effect in systemResult.Effects)
            {
                ApplyEffect(effect, $"system:{system.Id}", ref timeSeconds, ref inputs, ref outputs, diagnostics);
            }
        }

        if (!double.IsFinite(timeSeconds) || timeSeconds <= 0)
        {
            diagnostics.Add($"Recipe '{recipe.Name}' produced an invalid cycle time.");
            timeSeconds = recipe.TimeSeconds > 0 && double.IsFinite(recipe.TimeSeconds) ? recipe.TimeSeconds : 1.0;
        }

        foreach (var input in inputs)
        {
            var amount = GetDouble(input, "amount");
            if (!double.IsFinite(amount) || amount < 0) diagnostics.Add($"Input '{GetString(input, "id")}' has an invalid amount.");
        }
        foreach (var output in outputs)
        {
            var amount = GetDouble(output, "amount");
            var probability = GetDouble(output, "probability", 1.0);
            if (!double.IsFinite(amount) || amount < 0 || !double.IsFinite(probability) || probability < 0 || probability > 1)
            {
                diagnostics.Add($"Output '{GetString(output, "id")}' has an invalid amount or probability.");
            }
        }

        var knownItems = store.Items.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var knownTags = store.Tags.Select(tag => tag.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var input in inputs)
        {
            var refType = GetString(input, "refType");
            var refId = GetString(input, "refId");
            var exists = refType == "tag" ? knownTags.Contains(refId) : knownItems.Contains(refId);
            if (!exists) diagnostics.Add($"Input '{GetString(input, "id")}' references missing {refType} '{refId}'.");
        }
        foreach (var output in outputs)
        {
            var itemId = GetString(output, "itemId");
            if (!knownItems.Contains(itemId)) diagnostics.Add($"Output '{GetString(output, "id")}' references missing item '{itemId}'.");
        }

        return new MaterializedRecipe(recipe.Id, recipe.Name, timeSeconds, inputs, outputs, diagnostics, diagnostics.Count == 0);
    }

    private static SystemState ReadSystemState(JsonElement? nodeData, ModuleSystemDefinitionDto system)
    {
        var defaults = LuaModuleRuntime.ReadDefaults(system.Lua);
        var values = new Dictionary<string, object?>(defaults.Defaults, StringComparer.Ordinal);
        var slots = new List<string?>();
        if (nodeData is null || nodeData.Value.ValueKind != JsonValueKind.Object ||
            !nodeData.Value.TryGetProperty("moduleState", out var moduleState) || moduleState.ValueKind != JsonValueKind.Object ||
            !moduleState.TryGetProperty("systems", out var systems) || systems.ValueKind != JsonValueKind.Object ||
            !systems.TryGetProperty(system.Id, out var systemState) || systemState.ValueKind != JsonValueKind.Object)
        {
            return new SystemState(slots, values);
        }

        if (systemState.TryGetProperty("slots", out var slotValues) && slotValues.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var slotValue in slotValues.EnumerateArray())
            {
                slots.Add(slotValue.ValueKind == JsonValueKind.String ? slotValue.GetString() : null);
                index += 1;
            }
        }

        if (systemState.TryGetProperty("values", out var stateValues) && stateValues.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in stateValues.EnumerateObject())
            {
                values[property.Name] = property.Value.ValueKind switch
                {
                    JsonValueKind.Number when property.Value.TryGetDouble(out var number) => number,
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.String => property.Value.GetString(),
                    _ => values.GetValueOrDefault(property.Name)
                };
            }
        }

        return new SystemState(slots, values);
    }

    private static IReadOnlyDictionary<string, object?> BuildLuaContext(
        RecipeDto recipe,
        IReadOnlyDictionary<string, object?> parameters,
        SystemState state,
        ModuleSystemDefinitionDto system,
        IReadOnlyList<ModuleDefinitionDto> modules,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>> moduleProperties,
        IReadOnlyDictionary<string, object?> properties,
        int count,
        double timeSeconds,
        IReadOnlyList<Dictionary<string, object?>> inputs,
        IReadOnlyList<Dictionary<string, object?>> outputs)
    {
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["state"] = state.Values,
            ["slots"] = state.Slots,
            ["parameters"] = parameters,
            ["count"] = count,
            ["properties"] = properties,
            ["modules"] = modules.Select(module => new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = module.Id,
                ["name"] = module.Name,
                ["description"] = module.Description ?? string.Empty,
                ["properties"] = moduleProperties.GetValueOrDefault(module.Id) ?? new Dictionary<string, object?>()
            }).ToList(),
            ["resources"] = system.Resources.Select(resource => new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = resource.Id,
                ["name"] = resource.Name
            }).ToList(),
            ["recipe"] = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = recipe.Id,
                ["name"] = recipe.Name,
                ["time_seconds"] = timeSeconds,
                ["inputs"] = inputs.Select(input => new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = GetString(input, "id"),
                    ["ref_type"] = GetString(input, "refType"),
                    ["ref_id"] = GetString(input, "refId"),
                    ["amount"] = GetDouble(input, "amount")
                }).ToList(),
                ["outputs"] = outputs.Select(output => new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = GetString(output, "id"),
                    ["item_id"] = GetString(output, "itemId"),
                    ["amount"] = GetDouble(output, "amount"),
                    ["probability"] = GetDouble(output, "probability", 1.0)
                }).ToList()
            }
        };
    }

    private static void ApplyEffect(
        ModuleEffectDto effect,
        string effectNamespace,
        ref double timeSeconds,
        ref List<Dictionary<string, object?>> inputs,
        ref List<Dictionary<string, object?>> outputs,
        List<string> diagnostics)
    {
        var value = effect.Value ?? 1.0;
        if (!double.IsFinite(value))
        {
            diagnostics.Add($"Effect '{effect.Id}' produced an invalid number.");
            return;
        }

        if (effect.Target == "cycleTime")
        {
            timeSeconds = Mutate(timeSeconds, effect.Operation, value) ?? timeSeconds;
            return;
        }

        if (effect.Target is "addInput" or "addOutput")
        {
            if (effect.Port is null || effect.Operation == "remove" || value == 0) return;
            var amount = effect.Port.Amount * value;
            if (!double.IsFinite(amount) || amount < 0)
            {
                diagnostics.Add($"Effect '{effect.Id}' produced an invalid port amount.");
                return;
            }

            if (effect.Target == "addInput")
            {
                var refType = effect.Port.RefType ?? "item";
                if (effect.Port.Merge == "byReference")
                {
                    var existing = inputs.FirstOrDefault(input => GetString(input, "refType") == refType && GetString(input, "refId") == effect.Port.RefId);
                    if (existing is not null)
                    {
                        var merged = GetDouble(existing, "amount") + amount;
                        existing["amount"] = merged;
                        existing["amountPerCycle"] = merged;
                        return;
                    }
                }

                inputs.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = $"{effectNamespace}:{effect.Port.Key}",
                    ["refType"] = refType,
                    ["refId"] = effect.Port.RefId,
                    ["itemId"] = effect.Port.RefId,
                    ["amount"] = amount,
                    ["amountPerCycle"] = amount,
                    ["origin"] = "module"
                });
            }
            else
            {
                if (effect.Port.Merge == "byReference")
                {
                    var existing = outputs.FirstOrDefault(output => GetString(output, "itemId") == effect.Port.RefId);
                    if (existing is not null)
                    {
                        var merged = GetDouble(existing, "amount") + amount;
                        existing["amount"] = merged;
                        existing["amountPerCycle"] = merged;
                        return;
                    }
                }

                outputs.Add(new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["id"] = $"{effectNamespace}:{effect.Port.Key}",
                    ["itemId"] = effect.Port.RefId,
                    ["amount"] = amount,
                    ["amountPerCycle"] = amount,
                    ["probability"] = effect.Port.Probability ?? 1.0,
                    ["origin"] = "module"
                });
            }

            return;
        }

        if (effect.Target == "inputAmount")
        {
            inputs = MutatePorts(inputs, effect, value, input => GetString(input, "refId"));
            return;
        }

        if (effect.Target is "outputAmount" or "outputProbability")
        {
            outputs = MutatePorts(outputs, effect, value, output => GetString(output, "itemId"));
        }
    }

    private static List<Dictionary<string, object?>> MutatePorts(
        List<Dictionary<string, object?>> ports,
        ModuleEffectDto effect,
        double value,
        Func<Dictionary<string, object?>, string> getReference)
    {
        var result = new List<Dictionary<string, object?>>(ports.Count);
        foreach (var port in ports)
        {
            if (!string.IsNullOrWhiteSpace(effect.SelectorPortId) && GetString(port, "id") != effect.SelectorPortId ||
                !string.IsNullOrWhiteSpace(effect.SelectorRefId) && getReference(port) != effect.SelectorRefId)
            {
                result.Add(port);
                continue;
            }

            var property = effect.Target == "outputProbability" ? "probability" : "amount";
            var current = GetDouble(port, property, property == "probability" ? 1.0 : 0.0);
            var next = Mutate(current, effect.Operation, value);
            if (next is null) continue;
            port[property] = next.Value;
            if (property == "amount") port["amountPerCycle"] = next.Value;
            result.Add(port);
        }
        return result;
    }

    private static double? Mutate(double current, string operation, double value) => operation switch
    {
        "add" => current + value,
        "multiply" => current * value,
        "divide" => value == 0 ? double.NaN : current / value,
        "set" => value,
        "remove" => null,
        _ => current
    };

    private static string GetString(IReadOnlyDictionary<string, object?> value, string key) =>
        value.TryGetValue(key, out var item) ? item as string ?? string.Empty : string.Empty;

    private static double GetDouble(IReadOnlyDictionary<string, object?> value, string key, double fallback = 0.0) =>
        value.TryGetValue(key, out var item) && item is double number ? number : fallback;

    private sealed record SystemState(List<string?> Slots, Dictionary<string, object?> Values);
}
