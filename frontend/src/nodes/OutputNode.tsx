import { Handle, NodeProps, Position } from "reactflow";

type OutputNodeData = {
  title: string;
  targetPerSecond?: number;
};

export default function OutputNode({ data }: NodeProps<OutputNodeData>) {
  return (
    <div className="node io output">
      <div className="node-header">
        <span className="node-title">{data.title}</span>
        <span className="node-sub">Output</span>
      </div>
      <div className="node-body io-body">
        <div className="node-row">
          <span>Target</span>
          <span>{data.targetPerSecond ?? "—"} /s</span>
        </div>
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          className="handle item center"
          isConnectableStart={true}
          style={{ left: -16 }} /* Pull out to center on edge (body margin 8px + half handle) */
        />
      </div>
    </div>
  );
}
