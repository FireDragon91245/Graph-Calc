import { DragEvent } from "react";

export type NodeType = "recipe" | "input" | "output" | "requester";

type NodeTypeInfo = {
  type: NodeType;
  label: string;
  icon: string;
  description: string;
  color: string;
};

const nodeTypes: NodeTypeInfo[] = [
  {
    type: "input",
    label: "Input Node",
    icon: "📥",
    description: "Source of items/fluids",
    color: "#10b981"
  },
  {
    type: "output",
    label: "Output Node",
    icon: "📤",
    description: "Target for production",
    color: "#3b82f6"
  },
  {
    type: "recipe",
    label: "Recipe Node",
    icon: "⚙️",
    description: "Processing recipe",
    color: "#8b5cf6"
  },
  {
    type: "requester",
    label: "Requester Node",
    icon: "🎯",
    description: "Defines production targets",
    color: "#f59e0b"
  }
];

type NodeTypeSelectorProps = {
  onNodeTypeSelected: (type: NodeType) => void;
};

export default function NodeTypeSelector({ onNodeTypeSelected }: NodeTypeSelectorProps) {
  const handleDragStart = (e: DragEvent, nodeType: NodeType) => {
    e.dataTransfer.setData("application/reactflow", nodeType);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="node-type-selector">
      <h3 className="selector-header">Node Types</h3>
      <div className="node-types-list">
        {nodeTypes.map((nt) => (
          <div
            key={nt.type}
            className="node-type-card"
            draggable
            onDragStart={(e) => handleDragStart(e, nt.type)}
            onClick={() => onNodeTypeSelected(nt.type)}
            style={{ borderLeftColor: nt.color }}
          >
            <div className="node-type-icon">{nt.icon}</div>
            <div className="node-type-info">
              <div className="node-type-label">{nt.label}</div>
              <div className="node-type-desc">{nt.description}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="selector-hint">
        💡 Drag & drop or click to add nodes
      </div>
    </div>
  );
}
