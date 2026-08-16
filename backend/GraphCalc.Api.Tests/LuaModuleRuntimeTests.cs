using GraphCalc.Api.Services;
using System.Text.Json;
using Xunit;

namespace GraphCalc.Api.Tests;

public sealed class LuaModuleRuntimeTests
{
    [Fact]
    public void ExecutesHighLevelEffectApi()
    {
        const string source = """
return module {
  properties = {
    image = "speed1",
    bonus = 0.1,
    presentation = { label = "S1" }
  },
  apply = function(ctx)
    return { fx.outputs.multiply(1 + ctx.properties.bonus * ctx.count) }
  end
}
""";
        var properties = LuaModuleRuntime.ReadProperties(source);
        Assert.Null(properties.Error);
        Assert.Equal("speed1", properties.Properties["image"]);
        Assert.Equal(0.1d, properties.Properties["bonus"]);
        var presentation = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(properties.Properties["presentation"]);
        Assert.Equal("S1", presentation["label"]);

        var result = LuaModuleRuntime.RunEffects(source, new Dictionary<string, object?> { ["count"] = 2, ["properties"] = properties.Properties });
        Assert.Null(result.Error);
        var effect = Assert.Single(result.Effects);
        Assert.Equal("outputAmount", effect.Target);
        Assert.Equal("multiply", effect.Operation);
        Assert.NotNull(effect.Value);
        Assert.InRange(effect.Value.Value, 1.19999999, 1.20000001);
    }

    [Fact]
    public void ConstrainsSlotsFromLuaUi()
    {
        const string source = """
return system {
  node = function(ctx)
    local slots = {}
    for index = 1, ctx.parameters.max_slots do
      slots[#slots + 1] = ui.module_slot { slot = index }
    end
    return ui.row { children = slots }
  end
}
""";
        var context = new Dictionary<string, object?>
        {
            ["parameters"] = new Dictionary<string, object?> { ["max_slots"] = 2 }
        };
        var result = LuaModuleRuntime.ConstrainSlots(source, context, ["speed", "productivity", "speed"]);
        Assert.Null(result.Error);
        Assert.Equal(["speed", "productivity"], result.Slots);
    }

    [Fact]
    public void StopsRunawayScripts()
    {
        var result = LuaModuleRuntime.RunEffects("while true do end", new Dictionary<string, object?>());
        Assert.Contains("instruction limit", result.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EnforcesPerSlotModuleAllowLists()
    {
        const string source = """
return system {
  slots = function()
    return {
      module_bay.slot { slot = 1, modules = { "speed" } },
      module_bay.slot { slot = 2, modules = { "productivity" } }
    }
  end,
  node = function()
    return ui.row {
      ui.dropdown { bind = bindings.slot(1), options = {} },
      ui.dropdown { bind = bindings.slot(2), options = {} }
    }
  end
}
""";
        var result = LuaModuleRuntime.ConstrainSlots(source, new Dictionary<string, object?>(), ["productivity", "productivity", "speed"]);
        Assert.Null(result.Error);
        Assert.Equal([null, "productivity"], result.Slots);
    }

    [Fact]
    public void ResolvesAndConstrainsRecipeParameterDefaults()
    {
        const string source = """
return system {
  parameters = {
    parameter.number { id = "slots", label = "Slots", default = 4, min = 0, max = 3, integer = true }
  }
}
""";
        var result = LuaModuleRuntime.ResolveParameters(source, new Dictionary<string, JsonElement>());
        Assert.Null(result.Error);
        Assert.Equal(3d, result.Parameters["slots"]);
    }
}
