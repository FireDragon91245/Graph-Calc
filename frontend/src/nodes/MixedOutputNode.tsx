import { Handle, NodeProps, Position } from "reactflow";

type MixedOutputNodeData = {
  // Empty - just a simple node with one mixed input
};

export default function MixedOutputNode({ id, data }: NodeProps<MixedOutputNodeData>) {
  return (
    <div className="node io mixed-output">
      <div className="node-header">
        <span className="node-title">Mixed Output</span>
      </div>
      <div className="node-body">
        <div className="port-row" style={{ position: "relative" }}>
          <Handle
            type="target"
            position={Position.Left}
            id="mixed-input"
            className="handle mixed"
            isConnectableStart={true}
            style={{ left: -20 }}
          />
          <span className="port-name mixed-label">Mixed Input</span>
        </div>
      </div>
    </div>
  );
}
