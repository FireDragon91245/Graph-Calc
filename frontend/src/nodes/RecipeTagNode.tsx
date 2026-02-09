import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";

type PortPattern = {
  id: string;
  name: string;
  medium: "item" | "fluid" | "gas";
  amountPerCycle: number;
  probability?: number;
  isMixed: boolean; // True if this port varies across recipes
  fixedRefId?: string; // Set if this is a fixed item/tag across all recipes
};

type RecipeTagNodeData = {
  recipeTagId: string;
  title: string;
  inputs: PortPattern[];
  outputs: PortPattern[];
};

/**
 * Analyzes recipes in a recipe tag to find common patterns
 * Returns the pattern of inputs and outputs with mixed/fixed indicators
 */
function analyzeRecipePattern(
  recipeIds: string[],
  recipes: any[],
  items: any[],
  tags: any[]
): { inputs: PortPattern[]; outputs: PortPattern[] } {
  if (recipeIds.length === 0) {
    return {
      inputs: [{ id: "i1", name: "Mixed Input", medium: "item", amountPerCycle: 1, isMixed: true }],
      outputs: [{ id: "o1", name: "Mixed Output", medium: "item", amountPerCycle: 1, isMixed: true }]
    };
  }

  const recipeData = recipeIds.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
  
  if (recipeData.length === 0) {
    return {
      inputs: [{ id: "i1", name: "Mixed Input", medium: "item", amountPerCycle: 1, isMixed: true }],
      outputs: [{ id: "o1", name: "Mixed Output", medium: "item", amountPerCycle: 1, isMixed: true }]
    };
  }

  // Check if all recipes have the same number of inputs/outputs
  const inputCounts = recipeData.map((r) => r.inputs.length);
  const outputCounts = recipeData.map((r) => r.outputs.length);
  const sameInputCount = inputCounts.every((c) => c === inputCounts[0]);
  const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

  // If structure doesn't match, fallback to 1 mixed in, 1 mixed out
  if (!sameInputCount || !sameOutputCount) {
    return {
      inputs: [{ id: "i1", name: "Mixed Input", medium: "item", amountPerCycle: 1, isMixed: true }],
      outputs: [{ id: "o1", name: "Mixed Output", medium: "item", amountPerCycle: 1, isMixed: true }]
    };
  }

  const numInputs = inputCounts[0];
  const numOutputs = outputCounts[0];

  // Analyze each input position
  const inputs: PortPattern[] = [];
  for (let i = 0; i < numInputs; i++) {
    const inputsAtPosition = recipeData.map((r) => r.inputs[i]);
    const refIds = inputsAtPosition.map((inp) => inp.refId);
    const amounts = inputsAtPosition.map((inp) => inp.amount);
    const refTypes = inputsAtPosition.map((inp) => inp.refType);

    // Check if all have the same refId and amount
    const allSameRefId = refIds.every((id) => id === refIds[0]);
    const allSameAmount = amounts.every((amt) => amt === amounts[0]);
    const allSameRefType = refTypes.every((type) => type === refTypes[0]);

    const isMixed = !allSameRefId;
    let name: string;

    if (isMixed) {
      name = `Mixed Input ${i + 1}`;
    } else {
      // Fixed input - get the name
      const refType = refTypes[0];
      const refId = refIds[0];
      if (refType === "item") {
        name = items.find((item) => item.id === refId)?.name ?? refId;
      } else {
        name = tags.find((tag) => tag.id === refId)?.name ?? refId;
      }
    }

    inputs.push({
      id: `i${i + 1}`,
      name,
      medium: "item",
      amountPerCycle: allSameAmount ? amounts[0] : 1,
      isMixed,
      fixedRefId: allSameRefId ? refIds[0] : undefined
    });
  }

  // Analyze each output position
  const outputs: PortPattern[] = [];
  for (let i = 0; i < numOutputs; i++) {
    const outputsAtPosition = recipeData.map((r) => r.outputs[i]);
    const itemIds = outputsAtPosition.map((out) => out.itemId);
    const amounts = outputsAtPosition.map((out) => out.amount);
    const probabilities = outputsAtPosition.map((out) => out.probability);

    const allSameItemId = itemIds.every((id) => id === itemIds[0]);
    const allSameAmount = amounts.every((amt) => amt === amounts[0]);
    const allSameProbability = probabilities.every((prob) => prob === probabilities[0]);

    const isMixed = !allSameItemId;
    let name: string;

    if (isMixed) {
      name = `Mixed Output ${i + 1}`;
    } else {
      // Fixed output - get the name
      name = items.find((item) => item.id === itemIds[0])?.name ?? itemIds[0];
    }

    outputs.push({
      id: `o${i + 1}`,
      name,
      medium: "item",
      amountPerCycle: allSameAmount ? amounts[0] : 1,
      probability: allSameProbability ? probabilities[0] : undefined,
      isMixed,
      fixedRefId: allSameItemId ? itemIds[0] : undefined
    });
  }

  return { inputs, outputs };
}

export default function RecipeTagNode({ id, data }: NodeProps<RecipeTagNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const recipeTags = useGraphStore((state) => state.recipeTags);
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);

  const handleRecipeTagChange = (newRecipeTagId: string) => {
    const recipeTag = recipeTags.find((rt) => rt.id === newRecipeTagId);
    if (!recipeTag) return;

    // Delete all edges connected to this node
    const edges = getEdges();
    setEdges(edges.filter((edge) => edge.source !== id && edge.target !== id));

    // Analyze pattern
    const pattern = analyzeRecipePattern(recipeTag.memberRecipeIds, recipes, items, tags);

    // Update node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              recipeTagId: recipeTag.id,
              title: recipeTag.name,
              inputs: pattern.inputs,
              outputs: pattern.outputs
            }
          };
        }
        return node;
      })
    );
  };

  return (
    <div className="node recipe-tag">
      <div className="node-header">
        <SearchableDropdown
          className="recipe-tag-dropdown"
          value={data.recipeTagId}
          options={recipeTags.map((rt) => ({ value: rt.id, label: rt.name }))}
          onChange={handleRecipeTagChange}
          placeholder="Select recipe tag"
        />
      </div>
      <div className="node-body">
        <div className="ports">
          <div className="port-col">
            {data.inputs.map((input) => (
              <div key={input.id} className="port-row">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`input-${input.id}`}
                  className={`handle ${input.medium} ${input.isMixed ? "mixed" : ""}`}
                  isConnectableStart={true}
                />
                <span className={`port-name ${input.isMixed ? "mixed-label" : ""}`}>
                  {input.name}
                </span>
                <span className="port-amount">{input.amountPerCycle}</span>
              </div>
            ))}
          </div>
          <div className="port-col">
            {data.outputs.map((output) => (
              <div key={output.id} className="port-row right">
                <span className="port-amount">{output.amountPerCycle}</span>
                <span className={`port-name ${output.isMixed ? "mixed-label" : ""}`}>
                  {output.name}
                </span>
                {output.probability !== undefined && output.probability < 1 ? (
                  <span className="prob">{Math.round(output.probability * 100)}%</span>
                ) : null}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`output-${output.id}`}
                  className={`handle ${output.medium} ${output.isMixed ? "mixed" : ""}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
