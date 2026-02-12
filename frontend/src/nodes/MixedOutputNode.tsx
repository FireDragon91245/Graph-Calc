import { Handle, NodeProps, Position } from "reactflow";
import { useState } from "react";
import type { NodeFlowData } from "../api/solve";
import { useGraphStore } from "../store/graphStore";

type MixedOutputNodeData = {
  solveData?: NodeFlowData;
};

export default function MixedOutputNode({ id, data }: NodeProps<MixedOutputNodeData>) {
  const items = useGraphStore((state) => state.items);
  const itemNameById = new Map(items.map((item) => [item.id, item.name]));
  const [showDetails, setShowDetails] = useState(false);
  const hasSolveData = Boolean(data.solveData);

  return (
    <div className="node io mixed-output">
      <div className="node-header">
        <span className="node-title">Mixed Output</span>
        {data.solveData && data.solveData.totalInput > 0 && (
          <span className="node-badge" title="Total output">
            {data.solveData.totalInput.toFixed(2)}/s
          </span>
        )}
        <button
          className="node-detail-btn"
          onClick={() => hasSolveData && setShowDetails((prev) => !prev)}
          disabled={!hasSolveData}
          title={hasSolveData ? "Show details" : "Run solver first"}
        >
          ...
        </button>
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
        {showDetails && data.solveData ? (
          <div className="node-detail-panel">
            <div className="node-detail-title">Mixed Output Details</div>
            {Object.entries(data.solveData.inputFlows).map(([itemId, rate]) => (
              <div key={`in-${itemId}`} className="node-detail-row">
                <span className="flow-name">IN • {itemNameById.get(itemId) ?? itemId}</span>
                <span className="flow-rate">{rate.toFixed(2)}/s</span>
              </div>
            ))}
            {Object.entries(data.solveData.outputFlows).map(([itemId, rate]) => (
              <div key={`out-${itemId}`} className="node-detail-row">
                <span className="flow-name">OUT • {itemNameById.get(itemId) ?? itemId}</span>
                <span className="flow-rate">{rate.toFixed(2)}/s</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
