import { useState } from "react";

export type AppMode = "edit" | "config";
export type ConfigSubMode = "items" | "tags" | "recipes";

type ModeSelectorProps = {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  configSubMode?: ConfigSubMode;
  onConfigSubModeChange?: (subMode: ConfigSubMode) => void;
};

export default function ModeSelector({
  currentMode,
  onModeChange,
  configSubMode,
  onConfigSubModeChange
}: ModeSelectorProps) {
  return (
    <div className="mode-selector">
      <div className="mode-tabs">
        <button
          className={`mode-tab ${currentMode === "edit" ? "active" : ""}`}
          onClick={() => onModeChange("edit")}
        >
          <span className="mode-icon">✏️</span>
          Edit Mode
        </button>
        <button
          className={`mode-tab ${currentMode === "config" ? "active" : ""}`}
          onClick={() => onModeChange("config")}
        >
          <span className="mode-icon">⚙️</span>
          Config Mode
        </button>
      </div>
      
      {currentMode === "config" && onConfigSubModeChange && (
        <div className="config-submodes">
          <button
            className={`submode-tab ${configSubMode === "items" ? "active" : ""}`}
            onClick={() => onConfigSubModeChange("items")}
          >
            Items & Categories
          </button>
          <button
            className={`submode-tab ${configSubMode === "tags" ? "active" : ""}`}
            onClick={() => onConfigSubModeChange("tags")}
          >
            Tags
          </button>
          <button
            className={`submode-tab ${configSubMode === "recipes" ? "active" : ""}`}
            onClick={() => onConfigSubModeChange("recipes")}
          >
            Recipes
          </button>
        </div>
      )}
    </div>
  );
}
