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

            var state = ReadSystemState(nodeData, system, support);
            var disabled = support.DisabledModuleIds.ToHashSet(StringComparer.Ordinal);
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

                foreach (var effect in module.Effects)
                {
                    ApplyEffect(effect, state, count, $"module:{system.Id}:{module.Id}", ref timeSeconds, ref inputs, ref outputs, diagnostics);
                }
            }

            foreach (var effect in system.Effects)
            {
                ApplyEffect(effect, state, 1, $"system:{system.Id}", ref timeSeconds, ref inputs, ref outputs, diagnostics);
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

    private static SystemState ReadSystemState(JsonElement? nodeData, ModuleSystemDefinitionDto system, RecipeModuleSupportDto support)
    {
        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var control in system.Controls.Where(control => control.Type != "slots"))
        {
            values[control.StateKey] = ReadDefaultValue(control);
        }

        var slots = Enumerable.Repeat<string?>(null, Math.Max(0, support.SlotCount)).ToList();
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
                if (index >= slots.Count) break;
                if (slotValue.ValueKind == JsonValueKind.String) slots[index] = slotValue.GetString();
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
                    _ => values.GetValueOrDefault(property.Name)
                };
            }
        }

        foreach (var control in system.Controls.Where(control => control.Type != "slots"))
        {
            if (control.Type == "toggle")
            {
                values[control.StateKey] = values.GetValueOrDefault(control.StateKey) is true;
                continue;
            }

            var fallback = ReadDefaultValue(control) is double defaultNumber ? defaultNumber : control.Min ?? 0.0;
            var numeric = values.GetValueOrDefault(control.StateKey) is double current && double.IsFinite(current) ? current : fallback;
            values[control.StateKey] = Math.Min(control.Max ?? double.PositiveInfinity, Math.Max(control.Min ?? double.NegativeInfinity, numeric));
        }

        return new SystemState(slots, values);
    }

    private static object? ReadDefaultValue(ModuleUiControlDto control)
    {
        if (control.DefaultValue is not { } value) return control.Type == "toggle" ? false : control.Min ?? 0.0;
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDouble(out var number) => number,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => control.Type == "toggle" ? false : control.Min ?? 0.0
        };
    }

    private static void ApplyEffect(
        ModuleEffectDto effect,
        SystemState state,
        int moduleCount,
        string effectNamespace,
        ref double timeSeconds,
        ref List<Dictionary<string, object?>> inputs,
        ref List<Dictionary<string, object?>> outputs,
        List<string> diagnostics)
    {
        var value = EvaluateValue(effect, state, moduleCount);
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

    private static double EvaluateValue(ModuleEffectDto effect, SystemState state, int moduleCount)
    {
        var source = effect.Source switch
        {
            "moduleCount" => moduleCount,
            "stateNumber" => state.Values.GetValueOrDefault(effect.StateKey ?? string.Empty) is double number ? number : 0.0,
            "stateBoolean" => state.Values.GetValueOrDefault(effect.StateKey ?? string.Empty) is true ? 1.0 : 0.0,
            _ => effect.Value ?? 1.0
        };
        var baseValue = (effect.Offset ?? 0.0) + (effect.Coefficient ?? 1.0) * source;
        var divisor = effect.Divisor ?? 1.0;
        return divisor == 0 ? double.NaN : Math.Pow(baseValue, effect.Exponent ?? 1.0) / divisor;
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
