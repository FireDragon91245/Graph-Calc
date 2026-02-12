import { Handle, NodeProps, Position } from "reactflow";
import type { NodeFlowData } from "../api/solve";

type MixedOutputNodeData = {
  solveData?: NodeFlowData;
};

export default function MixedOutputNode({ id, data }: NodeProps<MixedOutputNodeData>) {
  return (
    <div className="node io mixed-output">
      <div className="node-header">
        <span className="node-title">Mixed Output</span>
        {data.solveData && data.solveData.totalInput > 0 && (
          <span className="node-badge" title="Total output">
            {data.solveData.totalInput.toFixed(2)}/s
          </span>
        )}
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
        {data.solveData && Object.keys(data.solveData.inputFlows).length > 0 && (
          <div className="solve-details">
            {Object.entries(data.solveData.inputFlows).map(([itemId, rate]) => (
              <div key={itemId} className="flow-item">
                <span className="flow-name">{itemId}</span>
                <span className="flow-rate">{rate.toFixed(2)}/s</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
