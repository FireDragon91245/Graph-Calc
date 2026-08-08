import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <div className="mode-selector">
      <div className="mode-tabs">
        <button
          className={`mode-tab ${currentMode === "edit" ? "active" : ""}`}
          onClick={() => onModeChange("edit")}
        >
          <span className="mode-icon">✏️</span>
          {t("ui.nav.edit")}
        </button>
        <button
          className={`mode-tab ${currentMode === "config" ? "active" : ""}`}
          onClick={() => onModeChange("config")}
        >
          <span className="mode-icon">⚙️</span>
          {t("ui.nav.config")}
        </button>
      </div>
    </div>
  );
}

export function ConfigSubmodeSelector({
  configSubMode,
  onConfigSubModeChange
}: ConfigSubmodeSelectorProps) {
  const { t } = useTranslation();
  if (!onConfigSubModeChange) {
    return null;
  }

  return (
    <div className="config-submodes">
      <button
        className={`submode-tab ${configSubMode === "items" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("items")}
      >
        {t("ui.nav.items")}
      </button>
      <button
        className={`submode-tab ${configSubMode === "tags" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("tags")}
      >
        {t("ui.nav.itemTags")}
      </button>
      <button
        className={`submode-tab ${configSubMode === "recipes" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("recipes")}
      >
        {t("ui.nav.recipes")}
      </button>
      <button
        className={`submode-tab ${configSubMode === "recipeTags" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("recipeTags")}
      >
        {t("ui.nav.recipeTags")}
      </button>
      <button
        className={`submode-tab ${configSubMode === "recipeGenerator" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("recipeGenerator")}
      >
        🤖 {t("ui.nav.recipeGenerator")}
      </button>
      <button
        className={`submode-tab ${configSubMode === "itemGenerator" ? "active" : ""}`}
        onClick={() => onConfigSubModeChange("itemGenerator")}
      >
        🔮 {t("ui.nav.itemGenerator")}
      </button>
    </div>
  );
}
