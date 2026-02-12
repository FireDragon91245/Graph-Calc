import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";

type InputItem = {
  id: string;
  itemId: string;
  mode: "infinite" | "limit";
  limit?: number;
};

type InputNodeData = {
  items: InputItem[];
  solveData?: NodeFlowData;
};

export default function InputNode({ id, data }: NodeProps<InputNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const items = useGraphStore((state) => state.items);

  const addItem = () => {
    const newItem: InputItem = {
      id: Date.now().toString(),
      itemId: items[0]?.id || "",
      mode: "infinite",
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

  const updateItem = (itemId: string, updates: Partial<InputItem>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              items: node.data.items.map((item: InputItem) =>
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
    const handleId = `output-${itemId}`;
    setEdges(edges.filter((edge) => 
      !(edge.source === id && edge.sourceHandle === handleId)
    ));

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              items: node.data.items.filter((item: InputItem) => item.id !== itemId),
            },
          };
        }
        return node;
      })
    );
  };

  // Ensure data.items exists
  const nodeItems = data.items || [];

  return (
    <div className="node io input">
      <div className="node-header">
        <span className="node-title">Input</span>
        {data.solveData && data.solveData.totalOutput > 0 && (
          <span className="node-badge" title="Total output rate">
            ↑ {data.solveData.totalOutput.toFixed(2)}/s
          </span>
        )}
      </div>
      <div className="node-body io-body">
        {nodeItems.map((item) => (
          <div key={item.id} className="node-row input-row" style={{ position: "relative" }}>
            <div className="row-controls">
              <SearchableDropdown
                value={item.itemId}
                options={items.map((i) => ({ value: i.id, label: i.name }))}
                onChange={(value) => updateItem(item.id, { itemId: value })}
                placeholder="Select item"
              />
              {data.solveData && (
                <span className="port-rate" title="Utilized rate from this input row">
                  {(data.solveData.outputFlows[item.itemId] ?? 0).toFixed(2)}/s
                </span>
              )}
              <div className="row-actions">
                <button
                   className={`mode-btn ${item.mode === "infinite" ? "active" : ""}`}
                   onClick={() => updateItem(item.id, { mode: item.mode === "infinite" ? "limit" : "infinite" })}
                   title={item.mode === "infinite" ? "Infinite" : "Limited"}
                >
                  {item.mode === "infinite" ? "∞" : "↧"}
                </button>
                {item.mode === "limit" && (
                  <input
                    type="number"
                    className="nodrag limit-input"
                    value={item.limit || 0}
                    onChange={(e) => updateItem(item.id, { limit: parseFloat(e.target.value) })}
                    placeholder="Limit"
                  />
                )}
                <button className="icon-btn danger" onClick={() => removeItem(item.id)}>
                  ×
                </button>
              </div>
            </div>
            <Handle
              type="source"
              position={Position.Right}
              id={`output-${item.id}`}
              className="handle item center"
              style={{ right: -16 }}
            />
          </div>
        ))}
        <button className="node-add-btn" onClick={addItem}>
          + Add Item
        </button>
      </div>
    </div>
  );
}
