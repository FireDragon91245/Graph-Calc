import { useState } from "react";

export type AppMode = "edit" | "config";
export type ConfigSubMode = "items" | "tags" | "recipes" | "recipeTags" | "recipeGenerator" | "itemGenerator";

type ModeSelectorProps = {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

type ConfigSubmodeSelectorProps = {
  configSubMode?: ConfigSubMode;
  onConfigSubModeChange?: (subMode: ConfigSubMode) => void;
};

export default function ModeSelector({
  currentMode,
  onModeChange
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
    </div>
  );
}

export function ConfigSubmodeSelector({
  configSubMode,
  onConfigSubModeChange
}: ConfigSubmodeSelectorProps) {
  if (!onConfigSubModeChange) {
    return null;
  }

  return (
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
        Item Tags
      </button>
      <button
        className={`submode-tab ${configSubMode === "recipes" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("recipes")}
      >
        Recipes
      </button>
      <button
        className={`submode-tab ${configSubMode === "recipeTags" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("recipeTags")}
      >
        Recipe Tags
      </button>
      <button
        className={`submode-tab ${configSubMode === "recipeGenerator" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("recipeGenerator")}
      >
        🤖 Recipe Generator
      </button>
      <button
        className={`submode-tab ${configSubMode === "itemGenerator" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("itemGenerator")}
      >
        🔮 Item Generator
      </button>
    </div>
  );
}
