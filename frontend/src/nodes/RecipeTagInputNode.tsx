import { ChangeEvent, useMemo, useState } from "react";
import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";

type PortPattern = {
  id: string;
  itemId?: string;
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
  multiplier?: number;
  solveData?: NodeFlowData;
};

/**
 * Analyzes recipes in a recipe tag to find common output patterns
 */
function analyzeRecipeOutputPattern(
  recipeIds: string[],
  recipes: any[],
  items: any[],
  multiplier: number
): PortPattern[] {
  if (recipeIds.length === 0) {
    return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1 * multiplier, isMixed: true }];
  }

  const recipeData = recipeIds
    .map((id) => recipes.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  
  if (recipeData.length === 0) {
    return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1 * multiplier, isMixed: true }];
  }

  // Check if all recipes have the same number of outputs
  const outputCounts = recipeData.map((r) => r.outputs.length);
  const sameOutputCount = outputCounts.every((c) => c === outputCounts[0]);

  // If structure doesn't match, fallback to 1 mixed output
  if (!sameOutputCount) {
    return [{ id: "o1", name: "Mixed Output", amountPerCycle: 1 * multiplier, isMixed: true }];
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
      itemId: allSameItemId ? itemIds[0] : undefined,
      name,
      amountPerCycle: (allSameAmount ? amounts[0] : 1) * multiplier,
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
  const [showDetails, setShowDetails] = useState(false);
  const multiplier = typeof data.multiplier === "number" && Number.isFinite(data.multiplier) ? data.multiplier : 1;
  const hasSolveData = Boolean(data.solveData);
  const itemIdByName = useMemo(() => new Map(items.map((item) => [item.name, item.id])), [items]);
  const itemNameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);

  const resolveItemId = (output: PortPattern) =>
    output.itemId ?? output.fixedRefId ?? itemIdByName.get(output.name) ?? output.name;

  const handleRecipeTagChange = (newRecipeTagId: string) => {
    const recipeTag = recipeTags.find((rt) => rt.id === newRecipeTagId);
    if (!recipeTag) return;

    // Delete all edges connected to this node
    const edges = getEdges();
    setEdges(edges.filter((edge) => edge.source !== id));

    // Analyze output pattern
    const outputs = analyzeRecipeOutputPattern(recipeTag.memberRecipeIds, recipes, items, multiplier);

    // Update node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              recipeTagId: recipeTag.id,
              title: recipeTag.name,
              outputs,
              multiplier
            }
          };
        }
        return node;
      })
    );
  };

  const handleMultiplierChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    const nextMultiplier = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    const recipeTag = recipeTags.find((rt) => rt.id === data.recipeTagId);
    const outputs = recipeTag
      ? analyzeRecipeOutputPattern(recipeTag.memberRecipeIds, recipes, items, nextMultiplier)
      : data.outputs;

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              multiplier: nextMultiplier,
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
        <div className="node-meta">
          <input
            className="multiplier-input nodrag"
            type="number"
            min="0"
            step="1"
            value={multiplier}
            onChange={handleMultiplierChange}
            aria-label="Recipe tag multiplier"
          />
          <span className="node-sub">x</span>
          {data.solveData?.totalOutput ? (
            <span className="node-badge" title="Utilized production rate">
              ↑ {data.solveData.totalOutput.toFixed(2)}/s
            </span>
          ) : null}
          <button
            className="node-detail-btn"
            onClick={() => hasSolveData && setShowDetails((prev) => !prev)}
            disabled={!hasSolveData}
            title={hasSolveData ? "Show details" : "Run solver first"}
          >
            ...
          </button>
        </div>
      </div>
      <div className="node-body">
        <div className="ports single-col">
          <div className="port-col">
            {data.outputs.map((output) => (
              <div key={output.id} className="port-row right">
                {data.solveData && (
                  <span className="port-rate" title="Actual output flow">
                    {(data.solveData.outputFlows[resolveItemId(output)] ?? 0).toFixed(2)}/s
                  </span>
                )}
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
        {showDetails && data.solveData ? (
          <div className="node-detail-panel">
            <div className="node-detail-title">Input Recipe Tag Details</div>
            <div className="node-detail-row">
              <span>{data.title}</span>
              <span>x{multiplier}</span>
            </div>
            {(recipeTags.find((tag) => tag.id === data.recipeTagId)?.memberRecipeIds ?? []).map((recipeId) => {
              const recipe = recipes.find((entry) => entry.id === recipeId);
              if (!recipe) return null;
              return (
                <div key={recipe.id} className="node-detail-item">
                  <div className="node-detail-row">
                    <span className="flow-name">{recipe.name}</span>
                    <span>{recipe.timeSeconds}s</span>
                  </div>
                  {recipe.outputs.map((output) => {
                    const itemId = output.itemId;
                    const actualUsed = data.solveData?.outputFlows[itemId] ?? 0;
                    const chance = output.probability ?? 1;
                    const cycleAmount = output.amount * multiplier;
                    const producedRate = recipe.timeSeconds > 0 ? (cycleAmount * chance) / recipe.timeSeconds : 0;
                    return (
                      <div key={`${recipe.id}-${output.id}`} className="node-detail-subrow">
                        <span>{itemNameById.get(itemId) ?? itemId}</span>
                        <span>{cycleAmount.toFixed(2)}/cycle • {Math.round(chance * 100)}%</span>
                        <span>{producedRate.toFixed(2)}/s vs {actualUsed.toFixed(2)}/s</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
