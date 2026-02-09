# GraphCalc Node Editor — Deliverables (Feb 9, 2026)

## 1) React Frontend Concept (ReactFlow)

### Core stack
- React + TypeScript
- ReactFlow for node canvas
- Zustand or Redux Toolkit for state
- TanStack Query for API calls
- Framer Motion for transitions
- CSS: Tailwind + custom glassmorphism tokens

### Layout
- Top bar: global search (Ctrl/Cmd+K), run solver button, view toggles
- Left panel: node library, recipe browser, tag explorer
- Center: node canvas (zoom/pan), minimap, background grid
- Right panel: selected node inspector + solver results

### Interaction
- Drag & drop node creation from library
- Right-click context menu: add node, paste, align, auto-layout
- Multi-select (box select) + align/distribute
- Snapping/grid & auto-align options
- Inline port labels with item icons
- Live validation: missing inputs, cycles, unconnected outputs

### Node types
- RecipeNode
- InputNode
- OutputNode
- RequesterNode
- (Future) Splitter/Buffer/Constraint nodes

### Visual language
- Dark theme with high contrast edges
- Nodes with distinct headers by type
- Port colors by category: item/fluids/gases
- Probability badge on outputs (e.g., 10%)

### Recommended ReactFlow node data
```ts
export type PortType = "input" | "output";
export type Medium = "item" | "fluid" | "gas";

export type Port = {
  id: string;
  name: string;
  medium: Medium;
  amountPerCycle: number;
  probability?: number; // 0..1
  tag?: string; // @ingot
};

export type RecipeNodeData = {
  type: "recipe";
  recipeId: string;
  title: string;
  timeSeconds: number;
  inputs: Port[];
  outputs: Port[];
};

export type InputNodeData = {
  type: "input";
  itemId: string;
  title: string;
  limitPerSecond?: number; // undefined => infinite
};

export type OutputNodeData = {
  type: "output";
  itemId: string;
  title: string;
  targetPerSecond?: number;
};

export type RequesterNodeData = {
  type: "requester";
  requests: Array<{ itemId: string; targetPerSecond: number }>;
};
```

---

## 2) Backend API (FastAPI recommended)

### Endpoints
- POST /solve
  - Body: graph + recipes + tags + targets
  - Response: flows, machine counts, bottlenecks, byproduct rates

### Example request
```json
{
  "graph": {
    "nodes": [{"id":"n1","type":"recipe","recipeId":"macerate_iron"}],
    "edges": [{"id":"e1","from":"n1","fromPort":"o1","to":"n2","toPort":"i1"}]
  },
  "recipes": ["..."],
  "tags": {"@ingot": ["iron","copper"]},
  "targets": {
    "maximizeOutput": ["iron_dust"],
    "minimizeInput": ["iron_ore"],
    "balance": true
  }
}
```

### Example response
```json
{
  "status": "ok",
  "machineCounts": {"macerate_iron": 2.5},
  "flowsPerSecond": {
    "iron_dust": 1.25,
    "gold_dust": 0.125
  },
  "bottlenecks": ["iron_ore"]
}
```

---

## 3) Recipe + Tag JSON Schema (suggestion)

```json
{
  "items": [
    {"id":"iron_ore","name":"Iron Ore","medium":"item"}
  ],
  "tags": {
    "@ingot": ["iron_ingot", "copper_ingot"],
    "@macerate_ingot": ["macerate_iron", "macerate_copper"]
  },
  "recipes": [
    {
      "id": "macerate_iron",
      "name": "Macerate Iron",
      "timeSeconds": 2,
      "inputs": [{"item":"iron_ingot","amount":1}],
      "outputs": [
        {"item":"iron_dust","amount":1,"probability":1.0},
        {"item":"gold_dust","amount":1,"probability":0.1}
      ]
    }
  ]
}
```

---

## 4) Example Dataset (simple ore chain)

```json
{
  "items": [
    {"id":"iron_ore","name":"Iron Ore","medium":"item"},
    {"id":"iron_dust","name":"Iron Dust","medium":"item"},
    {"id":"iron_ingot","name":"Iron Ingot","medium":"item"},
    {"id":"copper_ore","name":"Copper Ore","medium":"item"},
    {"id":"copper_dust","name":"Copper Dust","medium":"item"},
    {"id":"copper_ingot","name":"Copper Ingot","medium":"item"},
    {"id":"gold_dust","name":"Gold Dust","medium":"item"},
    {"id":"zinc_dust","name":"Zinc Dust","medium":"item"}
  ],
  "tags": {
    "@ore": ["iron_ore", "copper_ore"],
    "@ingot": ["iron_ingot", "copper_ingot"],
    "@macerate_ingot": ["macerate_iron", "macerate_copper"]
  },
  "recipes": [
    {
      "id": "macerate_iron",
      "name": "Macerate Iron",
      "timeSeconds": 2,
      "inputs": [{"item":"iron_ore","amount":1}],
      "outputs": [
        {"item":"iron_dust","amount":1,"probability":1.0},
        {"item":"gold_dust","amount":1,"probability":0.1}
      ]
    },
    {
      "id": "macerate_copper",
      "name": "Macerate Copper",
      "timeSeconds": 2,
      "inputs": [{"item":"copper_ore","amount":1}],
      "outputs": [
        {"item":"copper_dust","amount":1,"probability":1.0},
        {"item":"zinc_dust","amount":1,"probability":0.1}
      ]
    },
    {
      "id": "smelt_iron",
      "name": "Smelt Iron",
      "timeSeconds": 3.2,
      "inputs": [{"item":"iron_dust","amount":1}],
      "outputs": [{"item":"iron_ingot","amount":1,"probability":1.0}]
    },
    {
      "id": "smelt_copper",
      "name": "Smelt Copper",
      "timeSeconds": 3.2,
      "inputs": [{"item":"copper_dust","amount":1}],
      "outputs": [{"item":"copper_ingot","amount":1,"probability":1.0}]
    }
  ]
}
```

---

## 5) Solver Integration Proposal (OR-Tools LP)

### Modeling idea
- Decision variables: $x_r$ = machines for recipe $r$
- Per-recipe flow: $rate_r = x_r / timeSeconds$
- Each output contributes $rate_r * amount * probability$
- Each input consumes $rate_r * amount$

### Constraints
- Flow balance per item: sum(outputs) - sum(inputs) >= 0 (or == 0 for strict)
- Limited input caps: sum(inputs) <= limit
- Output targets: sum(outputs) >= target

### Objectives
- Maximize total requested outputs (when inputs limited)
- Minimize total inputs (when outputs fixed)
- Multi-objective blend: weighted sum or lexicographic

### Probabilistic outputs
- Treat expected value as linear (probability * amount)
- Provide warning badges in UI for variance

---

## 6) Next Steps (implementation order)
1. ReactFlow canvas + node types + port rendering
2. Graph serialization format
3. FastAPI /solve endpoint stub
4. Basic LP solver with OR-Tools
5. Live updates + caching
6. Tag expansion pipeline

---

## 7) Suggested file layout
- frontend/
  - src/
    - nodes/
    - editor/
    - store/
- backend/
  - app/
    - api/
    - solver/
- data/
  - recipes.json

