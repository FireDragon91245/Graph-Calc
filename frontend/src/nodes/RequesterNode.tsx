import { Handle, NodeProps, Position } from "reactflow";

type RequesterNodeData = {
  requests: Array<{ itemId: string; targetPerSecond: number }>;
};

export default function RequesterNode({ data }: NodeProps<RequesterNodeData>) {
  return (
    <div className="node requester">
      <div className="node-header">
        <span className="node-title">Requester</span>
        <span className="node-sub">Goal</span>
      </div>
      <div className="node-body">
        {data.requests.map((req) => (
          <div key={req.itemId} className="node-row" style={{ position: "relative" }}>
             <Handle
              type="target"
              position={Position.Left}
              id={`input-${req.itemId}`}
              className="handle item center"
              isConnectableStart={true}
              style={{ left: -20 }} /* Similar to recipe inputs */
            />
            <span>{req.itemId}</span>
            <span>{req.targetPerSecond} /s</span>
          </div>
        ))}
      </div>
    </div>
  );
}
