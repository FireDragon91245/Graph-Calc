import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";

type OutputItem = {
  id: string;
  itemId: string;
};

type OutputNodeData = {
  items: OutputItem[];
};

export default function OutputNode({ id, data }: NodeProps<OutputNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const items = useGraphStore((state) => state.items);

  const addItem = () => {
    const newItem: OutputItem = {
      id: Date.now().toString(),
      itemId: items[0]?.id || "",
    };
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const currentItems = node.data.items || [];
          return {
            ...node,
            data: { ...node.data, items: [...currentItems, newItem] },
          };
        }
        return node;
      })
    );
  };

  const updateItem = (itemId: string, updates: Partial<OutputItem>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              items: node.data.items.map((item: OutputItem) =>
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
              items: node.data.items.filter((item: OutputItem) => item.id !== itemId),
            },
          };
        }
        return node;
      })
    );
  };

  const nodeItems = data.items || [];

  return (
    <div className="node io output">
      <div className="node-header">
        <span className="node-title">Output</span>
      </div>
      <div className="node-body io-body">
        {nodeItems.map((item) => (
          <div key={item.id} className="node-row" style={{ position: "relative" }}>
            <Handle
              type="target"
              position={Position.Left}
              id={`input-${item.id}`} 
              className="handle item center"
              isConnectableStart={true}
              style={{ left: -16 }}
            />
             <div className="row-controls">
                <select
                    className="nodrag"
                    value={item.itemId}
                    onChange={(e) => updateItem(item.id, { itemId: e.target.value })}
                >
                    {items.map((i) => (
                    <option key={i.id} value={i.id}>
                        {i.name}
                    </option>
                    ))}
                </select>
                <button className="icon-btn danger" onClick={() => removeItem(item.id)}>
                    ×
                </button>
            </div>
            {/* Display amount? Currently just config. Solver result would be overlayed or looked up via ID? */}
          </div>
        ))}
        <button className="node-add-btn" onClick={addItem}>
          + Add Output
        </button>
      </div>
    </div>
  );
}
