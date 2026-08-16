import { describe, expect, it } from "vitest";
import { materializeEffectiveRecipe, solveTargetOutputRate, type ModuleDefinition, type ModuleSystemDefinition } from "./moduleSystem";
import type { Recipe } from "../store/graphStore";

const recipe: Recipe = {
  id: "plate",
  name: "Iron plate",
  timeSeconds: 2,
  inputs: [{ id: "ore", refType: "item", refId: "iron-ore", amount: 1 }],
  outputs: [{ id: "plate", itemId: "iron-plate", amount: 1, probability: 1 }],
  moduleSupport: [{ systemId: "bay", enabled: true, slotCount: 2, disabledModuleIds: [] }]
};

const speed: ModuleDefinition = {
  id: "speed",
  systemId: "bay",
  name: "Speed",
  effects: [{ id: "speed", target: "cycleTime", operation: "divide", source: "moduleCount", offset: 1, coefficient: 0.5 }]
};

const productivity: ModuleDefinition = {
  id: "productivity",
  systemId: "bay",
  name: "Productivity",
  effects: [{ id: "productivity", target: "outputAmount", operation: "multiply", source: "moduleCount", offset: 1, coefficient: 0.1 }]
};

const bay: ModuleSystemDefinition = {
  id: "bay",
  name: "Machine module bay",
  revision: 1,
  controls: [{ id: "slots", type: "slots", label: "Modules", stateKey: "slots" }],
  effects: []
};

const project = {
  items: [{ id: "iron-ore", name: "Iron Ore" }, { id: "iron-plate", name: "Iron Plate" }, { id: "electricity", name: "Electricity" }],
  tags: [],
  moduleDefinitions: [speed, productivity],
  moduleSystems: [bay]
};

describe("materializeEffectiveRecipe", () => {
  it("applies a different module loadout per node", () => {
    const normal = materializeEffectiveRecipe(recipe, project, { systems: { bay: { slots: [null, null] } } });
    const upgraded = materializeEffectiveRecipe(recipe, project, { systems: { bay: { slots: ["speed", "productivity"] } } });

    expect(normal.timeSeconds).toBe(2);
    expect(upgraded.timeSeconds).toBeCloseTo(2 / 1.5);
    expect(upgraded.outputs[0].amount).toBeCloseTo(1.1);
    expect(upgraded.fingerprint).not.toBe(normal.fingerprint);
  });

  it("allows owned modules unless the recipe disables them", () => {
    const unrestricted = { ...recipe, moduleSupport: [{ systemId: "bay", enabled: true, slotCount: 1, disabledModuleIds: [] }] };
    const effective = materializeEffectiveRecipe(unrestricted, project, { systems: { bay: { slots: ["speed"] } } });

    expect(effective.timeSeconds).toBeCloseTo(2 / 1.5);
    expect(effective.diagnostics).toEqual([]);

    const disabled = materializeEffectiveRecipe({ ...recipe, moduleSupport: [{ systemId: "bay", enabled: true, slotCount: 1, disabledModuleIds: ["speed"] }] }, project, { systems: { bay: { slots: ["speed"] } } });
    expect(disabled.diagnostics).toContainEqual(expect.objectContaining({ code: "module-disabled" }));
  });

  it("rejects a module owned by another upgrade system", () => {
    const foreignModule: ModuleDefinition = { ...speed, id: "foreign-speed", systemId: "other-system" };
    const effective = materializeEffectiveRecipe(recipe, {
      ...project,
      moduleDefinitions: [...project.moduleDefinitions, foreignModule]
    }, {
      systems: { bay: { slots: ["foreign-speed", null] } }
    });

    expect(effective.timeSeconds).toBe(2);
    expect(effective.diagnostics).toContainEqual(expect.objectContaining({
      code: "wrong-system-module",
      message: expect.stringContaining("does not belong")
    }));
  });

  it("supports exact percentage controls", () => {
    const overclock: ModuleSystemDefinition = {
      id: "overclock",
      name: "Overclock",
      revision: 1,
      controls: [{ id: "clock", type: "number", label: "Clock", stateKey: "clockPercent", min: 1, max: 250, defaultValue: 100 }],
      effects: [{ id: "clock", target: "cycleTime", operation: "divide", source: "stateNumber", stateKey: "clockPercent", coefficient: 0.01 }]
    };
    const supported = { ...recipe, moduleSupport: [{ systemId: "overclock", enabled: true }] };
    const effective = materializeEffectiveRecipe(supported, { ...project, moduleSystems: [overclock] }, {
      systems: { overclock: { values: { clockPercent: 133 } } }
    });

    expect(effective.timeSeconds).toBeCloseTo(2 / 1.33);
    expect(effective.moduleState.systems.overclock.values?.clockPercent).toBe(133);
  });

  it("calculates the clock percentage required for a target output rate", () => {
    const overclock: ModuleSystemDefinition = {
      id: "overclock",
      name: "Overclock",
      revision: 1,
      controls: [{ id: "clock-slider", type: "slider", label: "Clock", stateKey: "clockPercent", min: 1, max: 250, defaultValue: 100 }],
      effects: [{ id: "clock", target: "cycleTime", operation: "divide", source: "stateNumber", stateKey: "clockPercent", coefficient: 0.01 }]
    };
    const supported = { ...recipe, moduleSupport: [{ systemId: "overclock", enabled: true }] };
    const targetProject = { ...project, moduleSystems: [overclock] };
    const initial = materializeEffectiveRecipe(supported, targetProject).moduleState;
    const solution = solveTargetOutputRate({
      evaluate: (state) => materializeEffectiveRecipe(supported, targetProject, state),
      state: initial,
      systemId: "overclock",
      drivesStateKey: "clockPercent",
      targetRate: 1,
      min: 1,
      max: 250
    });

    expect(solution.possible).toBe(true);
    expect(solution.requiredValue).toBeCloseTo(200, 4);
    expect(solution.achievedRate).toBeCloseTo(1, 6);

    const impossible = solveTargetOutputRate({
      evaluate: (state) => materializeEffectiveRecipe(supported, targetProject, state),
      state: initial,
      systemId: "overclock",
      drivesStateKey: "clockPercent",
      targetRate: 2,
      min: 1,
      max: 250
    });
    expect(impossible.possible).toBe(false);
    expect(impossible.achievedRate).toBeCloseTo(1.25, 6);
  });

  it("can add a stable dynamic input", () => {
    const power: ModuleSystemDefinition = {
      id: "power",
      name: "Power",
      revision: 1,
      controls: [{ id: "enabled", type: "toggle", label: "Boost", stateKey: "enabled", defaultValue: false }],
      effects: [{
        id: "power-input",
        target: "addInput",
        operation: "add",
        source: "stateBoolean",
        stateKey: "enabled",
        port: { key: "electricity", refId: "electricity", amount: 4 }
      }]
    };
    const supported = { ...recipe, moduleSupport: [{ systemId: "power", enabled: true }] };
    const effective = materializeEffectiveRecipe(supported, { ...project, moduleSystems: [power] }, {
      systems: { power: { values: { enabled: true } } }
    });

    expect(effective.inputs).toContainEqual(expect.objectContaining({
      id: "system:power:electricity",
      refId: "electricity",
      amount: 4,
      origin: "module"
    }));
  });
});
