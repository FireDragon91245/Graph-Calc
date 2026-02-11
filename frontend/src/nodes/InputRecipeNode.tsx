import { ChangeEvent } from "react";
import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";

type Port = {
  id: string;
  name: string;
  amountPerCycle: number;
  probability?: number;
};

type InputRecipeNodeData = {
  recipeId: string;
  title: string;
  timeSeconds: number;
  outputs: Port[];
  multiplier?: number;
};

export default function InputRecipeNode({ id, data }: NodeProps<InputRecipeNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const multiplier = Number.isFinite(data.multiplier) ? data.multiplier : 1;

  const buildOutputs = (recipeId: string, nextMultiplier: number) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return data.outputs;

    return recipe.outputs.map((output) => ({
      id: output.id,
      name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
      amountPerCycle: output.amount * nextMultiplier,
      probability: output.probability
    }));
  };

  const handleRecipeChange = (newRecipeId: string) => {
    const recipe = recipes.find((r) => r.id === newRecipeId);
    if (!recipe) return;

    // Delete all edges connected to this node
    const edges = getEdges();
    setEdges(edges.filter((edge) => edge.source !== id));

    // Build new outputs data
    const outputs = buildOutputs(recipe.id, multiplier);

    // Update node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
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
    const outputs = buildOutputs(data.recipeId, nextMultiplier);

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
    <div className="node io input-recipe">
      <div className="node-header">
        <SearchableDropdown
          className="recipe-dropdown"
          value={data.recipeId}
          options={recipes.map((r) => ({ value: r.id, label: r.name }))}
          onChange={handleRecipeChange}
          placeholder="Select recipe"
        />
        <div className="node-meta">
          <input
            className="multiplier-input nodrag"
            type="number"
            min="0"
            step="1"
            value={multiplier}
            onChange={handleMultiplierChange}
            aria-label="Recipe multiplier"
          />
          <span className="node-sub">x</span>
          <span className="node-sub">{data.timeSeconds}s</span>
        </div>
      </div>
      <div className="node-body">
        <div className="ports single-col">
          <div className="port-col">
            {data.outputs.map((output) => (
              <div key={output.id} className="port-row right">
                <span className="port-amount">{output.amountPerCycle}</span>
                <span className="port-name">{output.name}</span>
                {output.probability !== undefined && output.probability < 1 ? (
                  <span className="prob">{Math.round(output.probability * 100)}%</span>
                ) : null}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`output-${output.id}`}
                  className="handle"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
