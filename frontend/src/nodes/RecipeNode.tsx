import { Handle, NodeProps, Position } from "reactflow";

type Port = {
  id: string;
  name: string;
  medium: "item" | "fluid" | "gas";
  amountPerCycle: number;
  probability?: number;
};

type RecipeNodeData = {
  title: string;
  timeSeconds: number;
  inputs: Port[];
  outputs: Port[];
};

export default function RecipeNode({ data }: NodeProps<RecipeNodeData>) {
  return (
    <div className="node recipe">
      <div className="node-header">
        <span className="node-title">{data.title}</span>
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
