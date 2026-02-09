import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";

type RequesterItem = {
  id: string;
  itemId: string;
  targetPerSecond: number;
};

type RequesterNodeData = {
  requests: RequesterItem[]; // Kept property name 'requests' for compatibility if needed, using array now
};

export default function RequesterNode({ id, data }: NodeProps<RequesterNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const items = useGraphStore((state) => state.items);

  const addItem = () => {
    const newItem: RequesterItem = {
      id: Date.now().toString(),
      itemId: items[0]?.id || "",
      targetPerSecond: 1,
    };
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const currentItems = node.data.requests || [];
          return {
            ...node,
            data: { ...node.data, requests: [...currentItems, newItem] },
          };
        }
        return node;
      })
    );
  };

  const updateItem = (itemId: string, updates: Partial<RequesterItem>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              requests: node.data.requests.map((item: RequesterItem) =>
                item.id === itemId ? { ...item, ...updates } : item
              ),
            },
          };
        }
        return node;
      })
    );
  };

  const removeItem = (itemId: string) => {
    // Remove edges connected to this item's handle
    const edges = getEdges();
    const handleId = `input-${itemId}`;
    setEdges(edges.filter((edge) => 
      !(edge.target === id && edge.targetHandle === handleId)
    ));

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              requests: node.data.requests.filter((item: RequesterItem) => item.id !== itemId),
            },
          };
        }
        return node;
      })
    );
  };

  const requests = data.requests || [];

  return (
    <div className="node io requester">
      <div className="node-header">
        <span className="node-title">Requester</span>
      </div>
      <div className="node-body io-body">
        {requests.map((req) => (
          <div key={req.id} className="node-row input-row" style={{ position: "relative" }}>
             <Handle
              type="target"
              position={Position.Left}
              id={`input-${req.id}`} // Using ID instead of itemId to allow duplicate items if needed? User asked: "multiple items posible". Usually itemId is unique per requester node, but unique handle IDs per ROW is safer.
              className="handle item center"
              isConnectableStart={true}
              style={{ left: -20 }}
            />
            <div className="row-controls">
                <select
                    className="nodrag"
                    value={req.itemId}
                    onChange={(e) => updateItem(req.id, { itemId: e.target.value })}
                >
                    {items.map((i) => (
                    <option key={i.id} value={i.id}>
                        {i.name}
                    </option>
                    ))}
                </select>
                <div className="row-actions">
                    <input
                        type="number"
                        className="nodrag limit-input"
                        value={req.targetPerSecond}
                        onChange={(e) => updateItem(req.id, { targetPerSecond: parseFloat(e.target.value) })}
                    />
                    <span className="unit">/s</span>
                    <button className="icon-btn danger" onClick={() => removeItem(req.id)}>
                        ×
                    </button>
                </div>
            </div>
          </div>
        ))}
         <button className="node-add-btn" onClick={addItem}>
          + Add Goal
        </button>
      </div>
    </div>
  );
}
