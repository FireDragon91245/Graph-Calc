import { DragEvent } from "react";
import { useTranslation } from "react-i18next";

export type NodeType = "recipe" | "recipetag" | "input" | "inputrecipe" | "inputrecipetag" | "output" | "requester" | "mixedoutput";

type NodeTypeInfo = {
  type: NodeType;
  labelKey: string;
  icon: string;
  descriptionKey: string;
  color: string;
};

const nodeTypes: NodeTypeInfo[] = [
  {
    type: "input",
    labelKey: "ui.nodeTypes.input.label",
    icon: "📥",
    descriptionKey: "ui.nodeTypes.input.description",
    color: "#10b981"
  },
  {
    type: "inputrecipe",
    labelKey: "ui.nodeTypes.inputRecipe.label",
    icon: "⚡",
    descriptionKey: "ui.nodeTypes.inputRecipe.description",
    color: "#059669"
  },
  {
    type: "inputrecipetag",
    labelKey: "ui.nodeTypes.inputRecipeTag.label",
    icon: "🔖",
    descriptionKey: "ui.nodeTypes.inputRecipeTag.description",
    color: "#047857"
  },
  {
    type: "output",
    labelKey: "ui.nodeTypes.output.label",
    icon: "📤",
    descriptionKey: "ui.nodeTypes.output.description",
    color: "#3b82f6"
  },
  {
    type: "recipe",
    labelKey: "ui.nodeTypes.recipe.label",
    icon: "⚙️",
    descriptionKey: "ui.nodeTypes.recipe.description",
    color: "#8b5cf6"
  },
  {
    type: "recipetag",
    labelKey: "ui.nodeTypes.recipeTag.label",
    icon: "🏷️",
    descriptionKey: "ui.nodeTypes.recipeTag.description",
    color: "#ec4899"
  },
  {
    type: "requester",
    labelKey: "ui.nodeTypes.requester.label",
    icon: "🎯",
    descriptionKey: "ui.nodeTypes.requester.description",
    color: "#f59e0b"
  },
  {
    type: "mixedoutput",
    labelKey: "ui.nodeTypes.mixedOutput.label",
    icon: "🎲",
    descriptionKey: "ui.nodeTypes.mixedOutput.description",
    color: "#06b6d4"
  }
];

type NodeTypeSelectorProps = {
  onNodeTypeSelected: (type: NodeType) => void;
};

export default function NodeTypeSelector({ onNodeTypeSelected }: NodeTypeSelectorProps) {
  const { t } = useTranslation();
  const handleDragStart = (e: DragEvent, nodeType: NodeType) => {
    e.dataTransfer.setData("application/reactflow", nodeType);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="node-type-selector">
      <h3 className="selector-header">{t("ui.nodeTypes.title")}</h3>
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
              <div className="node-type-label">{t(nt.labelKey)}</div>
              <div className="node-type-desc">{t(nt.descriptionKey)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="selector-hint">
        💡 {t("ui.nodeTypes.hint")}
      </div>
    </div>
  );
}
