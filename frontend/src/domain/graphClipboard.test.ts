import { describe, expect, it } from "vitest";
import type { Edge, Node } from "reactflow";
import {
  assertGraphClipboardProject,
  createGraphClipboardPayload,
  materializeGraphClipboardPayload,
  parseGraphClipboardPayload,
  serializeGraphClipboardPayload
} from "./graphClipboard";

const nodes: Node[] = [
  {
    id: "input-a",
    type: "input",
    position: { x: 100, y: 100 },
    data: { itemId: "iron", solveData: { totalFlow: 10 } },
    selected: true,
    width: 180
  },
  {
    id: "recipe-b",
    type: "recipe",
    position: { x: 300, y: 200 },
    data: { recipeId: "plates" },
    selected: true
  },
  {
    id: "output-c",
    type: "output",
    position: { x: 500, y: 200 },
    data: { itemId: "plates" },
    selected: false
  }
];

const edges: Edge[] = [
  {
    id: "edge-ab",
    source: "input-a",
    target: "recipe-b",
    sourceHandle: "iron-out",
    targetHandle: "iron-in"
  },
  {
    id: "edge-bc",
    source: "recipe-b",
    target: "output-c"
  }
];

describe("graph clipboard", () => {
  it("copies selected nodes, strips runtime data, and keeps only internal edges", () => {
    const payload = createGraphClipboardPayload({
      projectId: "project-1",
      graphId: "graph-a",
      nodes,
      edges
    });

    expect(payload.nodes.map((node) => node.id)).toEqual(["input-a", "recipe-b"]);
    expect(payload.nodes[0].data).toEqual({ itemId: "iron" });
    expect(payload.nodes[0]).not.toHaveProperty("selected");
    expect(payload.nodes[0]).not.toHaveProperty("width");
    expect(payload.edges).toEqual([{
      id: "edge-ab",
      source: "input-a",
      target: "recipe-b",
      sourceHandle: "iron-out",
      targetHandle: "iron-in"
    }]);
  });

  it("round-trips a valid payload and rejects malformed or unsupported content", () => {
    const payload = createGraphClipboardPayload({
      projectId: "project-1",
      graphId: "graph-a",
      nodes,
      edges,
      nodeIds: ["input-a"]
    });

    expect(parseGraphClipboardPayload(serializeGraphClipboardPayload(payload))).toEqual(payload);
    expect(parseGraphClipboardPayload("plain text")).toBeNull();
    expect(parseGraphClipboardPayload(JSON.stringify({ ...payload, schemaVersion: 2 }))).toBeNull();
    expect(parseGraphClipboardPayload(JSON.stringify({
      ...payload,
      nodes: [{ ...payload.nodes[0], type: "unknown-node" }]
    }))).toBeNull();
  });

  it("allows the same project and rejects a different project", () => {
    const payload = createGraphClipboardPayload({
      projectId: "project-1",
      graphId: "graph-a",
      nodes,
      edges,
      nodeIds: ["input-a"]
    });

    expect(() => assertGraphClipboardProject(payload, "project-1")).not.toThrow();
    expect(() => assertGraphClipboardProject(payload, "project-2"))
      .toThrow("same project");
  });

  it("remaps node and edge IDs while preserving geometry and handles", () => {
    const payload = createGraphClipboardPayload({
      projectId: "project-1",
      graphId: "graph-a",
      nodes,
      edges
    });
    const ids = ["one", "two", "three", "four"];
    const pasted = materializeGraphClipboardPayload(payload, {
      anchor: { x: 1000, y: 500 },
      existingNodeIds: ["input-one"],
      existingEdgeIds: [],
      offset: 24,
      createId: () => ids.shift()!
    });

    expect(pasted.nodes.map((node) => node.id)).toEqual(["input-two", "recipe-three"]);
    expect(pasted.nodes.map((node) => node.position)).toEqual([
      { x: 924, y: 474 },
      { x: 1124, y: 574 }
    ]);
    expect(pasted.nodes.every((node) => node.selected)).toBe(true);
    expect(pasted.edges[0]).toMatchObject({
      source: "input-two",
      target: "recipe-three",
      sourceHandle: "iron-out",
      targetHandle: "iron-in"
    });
    expect(pasted.edges[0].id).toBe("edge-four");
  });

  it("duplicates a selected group with a 50 pixel offset and remapped internal connection", () => {
    const payload = createGraphClipboardPayload({
      projectId: "project-1",
      graphId: "graph-a",
      nodes,
      edges
    });
    const ids = ["copy-a", "copy-b", "copy-edge"];
    const duplicated = materializeGraphClipboardPayload(payload, {
      anchor: {
        x: (payload.bounds.minX + payload.bounds.maxX) / 2,
        y: (payload.bounds.minY + payload.bounds.maxY) / 2
      },
      existingNodeIds: nodes.map((node) => node.id),
      existingEdgeIds: edges.map((edge) => edge.id),
      offset: 50,
      createId: () => ids.shift()!
    });

    expect(duplicated.nodes.map((node) => node.position)).toEqual([
      { x: 150, y: 150 },
      { x: 350, y: 250 }
    ]);
    expect(duplicated.edges[0]).toMatchObject({
      source: "input-copy-a",
      target: "recipe-copy-b",
      id: "edge-copy-edge"
    });
  });
});
