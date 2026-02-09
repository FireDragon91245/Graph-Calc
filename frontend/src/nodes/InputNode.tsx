import { Handle, NodeProps, Position } from "reactflow";

type InputNodeData = {
  title: string;
  limitPerSecond?: number;
};

export default function InputNode({ data }: NodeProps<InputNodeData>) {
  return (
    <div className="node io input">
      <div className="node-header">
        <span className="node-title">{data.title}</span>
        <span className="node-sub">Input</span>
      </div>
      <div className="node-body io-body">
        <div className="node-row">
          <span>Limit</span>
          <span>{data.limitPerSecond ?? "∞"} /s</span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          className="handle item center"
          style={{ right: -16 }} /* Pull out to center on edge (body margin 8px + half handle) */
        />
      </div>
    </div>
  );
}
