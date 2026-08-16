import { describe, expect, it } from "vitest";
import type { Edge, Node } from "reactflow";
import { propagateProjectDataToNodes, type ProjectPropagationData } from "./projectPropagation";

const baseProject: ProjectPropagationData = {
  items: [
    { id: "ore", name: "Ore" },
    { id: "plate", name: "Plate" },
    { id: "power", name: "Power" }
  ],
  tags: [],
  recipes: [{
    id: "smelt",
    name: "Smelt",
    timeSeconds: 2,
    inputs: [{ id: "ore-input", refType: "item", refId: "ore", amount: 1 }],
    outputs: [{ id: "plate-output", itemId: "plate", amount: 1, probability: 1 }],
    moduleSupport: []
  }],
  recipeTags: [],
  moduleDefinitions: [],
  moduleSystems: [],
  projectRevision: 1
};

const recipeNode: Node = {
  id: "node-1",
  type: "recipe",
  position: { x: 0, y: 0 },
  data: {
    recipeId: "smelt",
    title: "Stale name",
    timeSeconds: 99,
    inputs: [],
    outputs: []
  }
};

describe("propagateProjectDataToNodes", () => {
  it("refreshes static node copies from the current project recipe", () => {
    const result = propagateProjectDataToNodes([recipeNode], baseProject);
    const data = result.nodes[0].data;

    expect(result.changedNodeIds).toEqual(["node-1"]);
    expect(data.title).toBe("Smelt");
    expect(data.timeSeconds).toBe(2);
    expect(data.inputs).toEqual([expect.objectContaining({ id: "ore-input", amount: 1 })]);
    expect(data.outputs).toEqual([expect.objectContaining({ id: "plate-output", amount: 1 })]);
  });

  it("keeps a removed connected port as a ghost until its edge is removed", () => {
    const first = propagateProjectDataToNodes([recipeNode], baseProject).nodes[0];
    const changedProject = {
      ...baseProject,
      projectRevision: 2,
      recipes: [{ ...baseProject.recipes[0], inputs: [] }]
    };
    const edge: Edge = {
      id: "edge-1",
      source: "source",
      target: "node-1",
      sourceHandle: "output-any",
      targetHandle: "input-ore-input"
    };

    const withEdge = propagateProjectDataToNodes([first], changedProject, [edge]).nodes[0];
    expect(withEdge.data.inputs).toEqual([]);
    expect(withEdge.data.ghostInputs).toEqual([expect.objectContaining({ id: "ore-input" })]);

    const withoutEdge = propagateProjectDataToNodes([withEdge], changedProject, []).nodes[0];
    expect(withoutEdge.data.ghostInputs).toEqual([]);
  });

  it("marks deleted recipe references unresolved instead of solving stale data", () => {
    const first = propagateProjectDataToNodes([recipeNode], baseProject).nodes[0];
    const result = propagateProjectDataToNodes([first], {
      ...baseProject,
      recipes: [],
      projectRevision: 2
    });

    expect(result.nodes[0].data.unresolved).toBe(true);
    expect(result.nodes[0].data.inputs).toEqual([]);
    expect(result.nodes[0].data.outputs).toEqual([]);
  });

  it("marks deleted item references on IO nodes", () => {
    const inputNode: Node = {
      id: "input-1",
      type: "input",
      position: { x: 0, y: 0 },
      data: { items: [{ id: "row-1", itemId: "deleted-item", mode: "infinite" }] }
    };

    const result = propagateProjectDataToNodes([inputNode], baseProject);
    expect(result.nodes[0].data.unresolvedItemIds).toEqual(["deleted-item"]);
  });
});
