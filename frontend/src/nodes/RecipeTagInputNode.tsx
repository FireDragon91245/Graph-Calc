import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";

type PortPattern = {
  id: string;
  name: string;
  amountPerCycle: number;
  probability?: number;
  isMixed: boolean;
  fixedRefId?: string;
};

type RecipeTagInputNodeData = {
  recipeTagId: string;
  title: string;
  outputs: PortPattern[];
};

/**
 * Analyzes recipes in a recipe tag to find common output patterns
 */
function analyzeRecipeOutputPattern(
  recipeIds: string[],
  recipes: any[],
  items: any[]
): PortPattern[] {
  if (recipeIds.length === 0) {
    return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }];
  }

  const recipeData = recipeIds
    .map((id) => recipes.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  
  if (recipeData.length === 0) {
    return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }];
  }

  // Check if all recipes have the same number of outputs
  const outputCounts = recipeData.map((r) => r.outputs.length);
  const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

  // If structure doesn't match, fallback to 1 mixed output
  if (!sameOutputCount) {
    return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1, isMixed: true }];
  }

  const numOutputs = outputCounts[0];

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
      amountPerCycle: allSameAmount ? amounts[0] : 1,
      probability: allSameProbability ? probabilities[0] : undefined,
      isMixed,
      fixedRefId: allSameItemId ? itemIds[0] : undefined
    });
  }

  return outputs;
}

export default function RecipeTagInputNode({ id, data }: NodeProps<RecipeTagInputNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const recipeTags = useGraphStore((state) => state.recipeTags);
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);

  const handleRecipeTagChange = (newRecipeTagId: string) => {
    const recipeTag = recipeTags.find((rt) => rt.id === newRecipeTagId);
    if (!recipeTag) return;

    // Delete all edges connected to this node
    const edges = getEdges();
    setEdges(edges.filter((edge) => edge.source !== id));

    // Analyze output pattern
    const outputs = analyzeRecipeOutputPattern(recipeTag.memberRecipeIds, recipes, items);

    // Update node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              recipeTagId: recipeTag.id,
              title: recipeTag.name,
              outputs
            }
          };
        }
        return node;
      })
    );
  };

  return (
    <div className="node io input-recipe-tag">
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
        <div className="ports single-col">
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
                  className={`handle ${output.isMixed ? "mixed" : ""}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
