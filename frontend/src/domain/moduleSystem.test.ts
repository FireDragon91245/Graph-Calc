import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import type { Recipe } from "../store/graphStore";
import { constrainLuaModuleSlots, inspectLuaModule, renderLuaSystem, validateLuaModule } from "./luaModuleRuntime";
import { FACTORIO_SYSTEM_LUA, POWER_SHARD_SYSTEM_LUA, PRODUCTIVITY_MODULE_LUA, SLOOP_SYSTEM_LUA, SPEED_MODULE_LUA } from "./luaModuleTemplates";
import { resolveModuleSystemResource } from "./moduleResources";
import { setModuleSlotCount } from "./moduleSlots";
import { materializeEffectiveRecipe, solveTargetOutputRate, type ModuleDefinition, type ModuleSystemDefinition } from "./moduleSystem";

const recipe: Recipe = {
  id: "plate",
  name: "Iron plate",
  timeSeconds: 2,
  inputs: [{ id: "ore", refType: "item", refId: "iron-ore", amount: 1 }],
  outputs: [{ id: "plate", itemId: "iron-plate", amount: 1, probability: 1 }],
  moduleSupport: [{ systemId: "bay", enabled: true, parameters: { module_slots: 2 }, disabledModuleIds: [] }]
};

const speed: ModuleDefinition = { id: "speed", systemId: "bay", name: "Speed", lua: SPEED_MODULE_LUA };
const productivity: ModuleDefinition = { id: "productivity", systemId: "bay", name: "Productivity", lua: PRODUCTIVITY_MODULE_LUA };
const bay: ModuleSystemDefinition = { id: "bay", name: "Machine module bay", revision: 1, lua: FACTORIO_SYSTEM_LUA };
const project = {
  items: [{ id: "iron-ore", name: "Iron Ore" }, { id: "iron-plate", name: "Iron Plate" }, { id: "electricity", name: "Electricity" }],
  tags: [],
  moduleDefinitions: [speed, productivity],
  moduleSystems: [bay]
};

describe("Lua module systems", () => {
  it("localizes runtime errors and does not reuse errors from the previous language", async () => {
    await i18n.changeLanguage("en");
    expect(validateLuaModule("")).toBe("Code is required.");
    await i18n.changeLanguage("de");
    expect(validateLuaModule("")).toBe("Code ist erforderlich.");
    await i18n.changeLanguage("en");
  });

  it("fills and clears existing empty slots for counted modules", () => {
    expect(setModuleSlotCount([null, null], "sloop", 1)).toEqual(["sloop", null]);
    expect(setModuleSlotCount(["sloop", null], "sloop", 2)).toEqual(["sloop", "sloop"]);
    expect(setModuleSlotCount(["sloop", "sloop"], "sloop", 1)).toEqual(["sloop", null]);
    expect(setModuleSlotCount(["other", null, "sloop"], "sloop", 2)).toEqual(["other", "sloop", "sloop"]);
  });

  it("resolves system resources by stable ID first and editable label second", () => {
    const resources = [
      { id: "speed1", name: "Old label", imageId: "image-id" },
      { id: "other", name: "Speed1", imageId: "label-image" }
    ];
    expect(resolveModuleSystemResource(resources, "speed1")?.imageId).toBe("image-id");
    expect(resolveModuleSystemResource(resources, "Speed1")?.imageId).toBe("label-image");
  });

  it("renders a safe primitive tree from Lua", () => {
    const rendered = renderLuaSystem(FACTORIO_SYSTEM_LUA, { state: {}, slots: [], parameters: { module_slots: 3 }, modules: [] });
    expect(rendered.error).toBeUndefined();
    expect(rendered.value).toMatchObject({ type: "column", children: [expect.objectContaining({ type: "label" }), expect.objectContaining({ type: "row", children: [expect.objectContaining({ type: "popup" }), expect.objectContaining({ type: "popup" }), expect.objectContaining({ type: "popup" })] })] });
  });

  it("lets the Factorio system explicitly interpret a module image property", () => {
    const rendered = renderLuaSystem(FACTORIO_SYSTEM_LUA, {
      state: {},
      slots: ["speed-1"],
      parameters: { module_slots: 1 },
      modules: [{ id: "speed-1", name: "Speed 1", properties: { image: "speed1", label: "S1" } }]
    });
    expect(rendered.error).toBeUndefined();
    expect(rendered.value).toMatchObject({
      type: "column",
      children: [{ type: "label" }, {
        type: "row",
        children: [{
          type: "popup",
          trigger: { type: "button", children: [{ type: "icon", resource: "speed1" }] },
          content: { type: "grid", children: [expect.anything(), { type: "button", children: [{ type: "icon", resource: "speed1" }] }] }
        }]
      }]
    });
  });

  it("stops runaway browser Lua scripts", () => {
    expect(validateLuaModule("while true do end")).toContain("instruction limit");
  });

  it("applies a different Lua module loadout per node", () => {
    const normal = materializeEffectiveRecipe(recipe, project, { systems: { bay: { slots: [null, null] } } });
    const upgraded = materializeEffectiveRecipe(recipe, project, { systems: { bay: { slots: ["speed", "productivity"] } } });
    expect(normal.timeSeconds).toBe(2);
    expect(upgraded.timeSeconds).toBeCloseTo(2 / 1.5);
    expect(upgraded.outputs[0].amount).toBeCloseTo(1.1);
  });

  it("uses the Lua loadout policy as the authoritative per-recipe slot limit", () => {
    const effective = materializeEffectiveRecipe(recipe, project, { systems: { bay: { slots: ["speed", "speed", "speed"] } } });
    expect(effective.moduleState.systems.bay.slots).toEqual(["speed", "speed"]);
    expect(effective.timeSeconds).toBeCloseTo(1);
  });

  it("composes a popup from generic buttons, labels, and actions", () => {
    const source = `return system {
      node = function() return ui.popup {
        trigger = ui.button {
          square = "small",
          ui.label { text = "+" }
        },
        content = ui.grid {
          columns = 2,
          ui.button {
            on_click = actions.clear_slot { slot = 1 },
            ui.label { text = "Empty" }
          }
        }
      } end
    }`;
    const rendered = renderLuaSystem(source, {});
    expect(rendered.error).toBeUndefined();
    expect(rendered.value).toMatchObject({
      type: "popup",
      trigger: { type: "button", children: [{ type: "label", text: "+" }] },
      content: { type: "grid", children: [{ type: "button", children: [{ type: "label", text: "Empty" }] }] }
    });
  });

  it("can render a dedicated counted-module interface instead of slots or dropdowns", () => {
    const rendered = renderLuaSystem(SLOOP_SYSTEM_LUA, {
      state: {},
      slots: [],
      parameters: { max_sloops: 2 },
      modules: [{ id: "sloop", name: "Somersloop", properties: { kind: "somersloop", image: "" } }]
    });
    expect(rendered.error).toBeUndefined();
    expect(rendered.value).toMatchObject({
      type: "row",
      children: [
        { type: "icon", label: "Somersloop" },
        { type: "module_counter", module: "sloop", max: 2 }
      ]
    });
  });

  it("exposes arbitrary module properties to owning system code", () => {
    const propertyModule: ModuleDefinition = {
      id: "property-speed",
      systemId: "property-bay",
      name: "Property speed",
      lua: `return module { properties = { image = "speed1", speed_bonus = 0.25, presentation = { label = "S1" } } }`
    };
    const propertySystem: ModuleSystemDefinition = {
      id: "property-bay",
      name: "Property bay",
      revision: 1,
      lua: `return system {
        slots = function() return module_bay.slots { count = 2 } end,
        apply = function(ctx)
          local total = 0
          for _, module_id in ipairs(ctx.slots) do
            for _, candidate in ipairs(ctx.modules) do
              if candidate.id == module_id then total = total + candidate.properties.speed_bonus end
            end
          end
          return { fx.cycle_time.divide(1 + total) }
        end
      }`
    };
    const propertyRecipe = { ...recipe, moduleSupport: [{ systemId: "property-bay", enabled: true }] };
    const effective = materializeEffectiveRecipe(propertyRecipe, { ...project, moduleSystems: [propertySystem], moduleDefinitions: [propertyModule] }, { systems: { "property-bay": { slots: ["property-speed", "property-speed"] } } });
    expect(effective.timeSeconds).toBeCloseTo(2 / 1.5);
    expect(inspectLuaModule(propertyModule.lua).value.properties).toEqual({ image: "speed1", speed_bonus: 0.25, presentation: { label: "S1" } });
  });

  it("lets each Lua slot restrict its own graphical picker and solver policy", () => {
    const source = `return system {
      slots = function() return {
        module_bay.slot { slot = 1, modules = { "speed" } },
        module_bay.slot { slot = 2, modules = { "productivity" } }
      } end,
      node = function() return ui.row {
        ui.dropdown { bind = bindings.slot(1), options = {} },
        ui.dropdown { bind = bindings.slot(2), options = {} }
      } end
    }`;
    const rendered = renderLuaSystem(source, {});
    expect(rendered.error).toBeUndefined();
    expect(constrainLuaModuleSlots(source, {}, ["productivity", "productivity", "speed"]).value).toEqual([null, "productivity"]);
  });

  it("allows owned modules unless the recipe disables them", () => {
    const disabledRecipe = { ...recipe, moduleSupport: [{ systemId: "bay", enabled: true, parameters: { module_slots: 1 }, disabledModuleIds: ["speed"] }] };
    const effective = materializeEffectiveRecipe(disabledRecipe, project, { systems: { bay: { slots: ["speed"] } } });
    expect(effective.timeSeconds).toBe(2);
    expect(effective.diagnostics).toContainEqual(expect.objectContaining({ code: "module-disabled" }));
  });

  it("rejects a module owned by another system", () => {
    const foreign: ModuleDefinition = { ...speed, id: "foreign", systemId: "other" };
    const effective = materializeEffectiveRecipe(recipe, { ...project, moduleDefinitions: [...project.moduleDefinitions, foreign] }, { systems: { bay: { slots: ["foreign"] } } });
    expect(effective.timeSeconds).toBe(2);
    expect(effective.diagnostics).toContainEqual(expect.objectContaining({ code: "wrong-system-module" }));
  });

  it("runs system-only power-shard behavior and solves a target rate", () => {
    const overclock: ModuleSystemDefinition = { id: "overclock", name: "Power Shards", revision: 1, lua: POWER_SHARD_SYSTEM_LUA };
    const supported = { ...recipe, moduleSupport: [{ systemId: "overclock", enabled: true, parameters: { max_shards: 3 } }] };
    const targetProject = { ...project, moduleSystems: [overclock], moduleDefinitions: [] };
    const effective = materializeEffectiveRecipe(supported, targetProject, { systems: { overclock: { values: { clock_percent: 133 } } } });
    expect(effective.timeSeconds).toBeCloseTo(2 / 1.33);

    const solution = solveTargetOutputRate({
      evaluate: (state) => materializeEffectiveRecipe(supported, targetProject, state),
      state: effective.moduleState,
      systemId: "overclock",
      drivesStateKey: "clock_percent",
      targetRate: 1,
      min: 1,
      max: 250
    });
    expect(solution.possible).toBe(true);
    expect(solution.requiredValue).toBeCloseTo(200, 4);
  });

  it("can create a dynamic input from Lua", () => {
    const power: ModuleSystemDefinition = {
      id: "power",
      name: "Power",
      revision: 1,
      lua: `return system {
        defaults = { enabled = false },
        node = function(ctx) return ui.toggle { label = "Power", bind = "enabled" } end,
        apply = function(ctx)
          if not ctx.state.enabled then return {} end
          return { fx.inputs.create { key = "electricity", item = "electricity", amount = 4 } }
        end
      }`
    };
    const supported = { ...recipe, moduleSupport: [{ systemId: "power", enabled: true }] };
    const effective = materializeEffectiveRecipe(supported, { ...project, moduleSystems: [power], moduleDefinitions: [] }, { systems: { power: { values: { enabled: true } } } });
    expect(effective.inputs).toContainEqual(expect.objectContaining({ id: "system:power:electricity", refId: "electricity", amount: 4, origin: "module" }));
  });
});
