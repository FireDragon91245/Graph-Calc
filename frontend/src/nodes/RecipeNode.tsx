import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";

type Port = {
  id: string;
  name: string;
  amountPerCycle: number;
  probability?: number;
};

type RecipeNodeData = {
  recipeId: string;
  title: string;
  timeSeconds: number;
  inputs: Port[];
  outputs: Port[];
  solveData?: NodeFlowData;
};

export default function RecipeNode({ id, data }: NodeProps<RecipeNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);

  const handleRecipeChange = (newRecipeId: string) => {
    const recipe = recipes.find((r) => r.id === newRecipeId);
    if (!recipe) return;

    // Delete all edges connected to this node
    const edges = getEdges();
    setEdges(edges.filter((edge) => edge.source !== id && edge.target !== id));

    // Build new ports data
    const inputs = recipe.inputs.map((input) => {
      const name =
        input.refType === "item"
          ? items.find((item) => item.id === input.refId)?.name ?? input.refId
          : tags.find((tag) => tag.id === input.refId)?.name ?? input.refId;

      return {
        id: input.id,
        name,
        amountPerCycle: input.amount
      };
    });

    const outputs = recipe.outputs.map((output) => ({
      id: output.id,
      name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
      amountPerCycle: output.amount,
      probability: output.probability
    }));

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
              inputs,
              outputs
            }
          };
        }
        return node;
      })
    );
  };

  return (
    <div className="node recipe">
      <div className="node-header">
        <SearchableDropdown
          className="recipe-dropdown"
          value={data.recipeId}
          options={recipes.map((r) => ({ value: r.id, label: r.name }))}
          onChange={handleRecipeChange}
          placeholder="Select recipe"
        />
        <span className="node-sub">{data.timeSeconds}s</span>
        {data.solveData?.machineCount && (
          <span className="node-badge" title="Machine Count">
            🏭 {data.solveData.machineCount.toFixed(2)}
          </span>
        )}
      </div>
      <div className="node-body">
        <div className="ports">
          <div className="port-col">
            {data.inputs.map((input) => {
              const itemId = input.name; // Simplified - may need better mapping
              const flowRate = data.solveData?.inputFlows[itemId];
              return (
                <div key={input.id} className="port-row">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`input-${input.id}`}
                    className="handle"
                    isConnectableStart={true}
                  />
                  <span className="port-name">{input.name}</span>
                  <span className="port-amount">{input.amountPerCycle}</span>
                  {flowRate && (
                    <span className="port-rate" title="Actual flow rate">
                      {flowRate.toFixed(2)}/s
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="port-col">
            {data.outputs.map((output) => {
              const itemId = output.name; // Simplified - may need better mapping
              const flowRate = data.solveData?.outputFlows[itemId];
              return (
                <div key={output.id} className="port-row right">
                  {flowRate && (
                    <span className="port-rate" title="Actual flow rate">
                      {flowRate.toFixed(2)}/s
                    </span>
                  )}
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
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
