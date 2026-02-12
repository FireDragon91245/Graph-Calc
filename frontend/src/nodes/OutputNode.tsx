import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";

type OutputItem = {
  id: string;
  itemId: string;
};

type OutputNodeData = {
  items: OutputItem[];
  solveData?: NodeFlowData;
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
        {data.solveData && data.solveData.totalInput > 0 && (
          <span className="node-badge" title="Total input rate">
            ↓ {data.solveData.totalInput.toFixed(2)}/s
          </span>
        )}
      </div>
      <div className="node-body io-body">
        {nodeItems.map((item) => {
          const flowRate = data.solveData?.inputFlows[item.itemId];
          return (
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
                  <SearchableDropdown
                    value={item.itemId}
                    options={items.map((i) => ({ value: i.id, label: i.name }))}
                    onChange={(value) => updateItem(item.id, { itemId: value })}
                    placeholder="Select item"
                  />
                  {flowRate && (
                    <span className="port-rate" title="Output rate">
                      {flowRate.toFixed(2)}/s
                    </span>
                  )}
                  <button className="icon-btn danger" onClick={() => removeItem(item.id)}>
                      ×
                  </button>
              </div>
            </div>
          );
        })}
        <button className="node-add-btn" onClick={addItem}>
          + Add Output
        </button>
      </div>
    </div>
  );
}
