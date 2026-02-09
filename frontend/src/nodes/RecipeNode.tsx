import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";

type Port = {
  id: string;
  name: string;
  medium: "item" | "fluid" | "gas";
  amountPerCycle: number;
  probability?: number;
};

type RecipeNodeData = {
  recipeId: string;
  title: string;
  timeSeconds: number;
  inputs: Port[];
  outputs: Port[];
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
        amountPerCycle: input.amount,
        medium: "item" as const
      };
    });

    const outputs = recipe.outputs.map((output) => ({
      id: output.id,
      name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
      amountPerCycle: output.amount,
      medium: "item" as const,
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
                  className={`handle ${input.medium}`}
                  isConnectableStart={true}
                />
                <span className="port-name">{input.name}</span>
                <span className="port-amount">{input.amountPerCycle}</span>
              </div>
            ))}
          </div>
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
                  className={`handle ${output.medium}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
