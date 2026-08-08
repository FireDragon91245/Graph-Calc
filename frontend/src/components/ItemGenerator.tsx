import { useState, useMemo } from "react";
import { useGraphStore, Item } from "../store/graphStore";
import { useTranslation } from "react-i18next";

interface ItemSuggestion {
  id: string;
  name: string;
  itemId: string;
  categoryId?: string;
  targetTagIds: string[];
  approved: boolean;
  sourceItem: Item;
}

const NO_CATEGORY_VALUE = "__none__";

type TransformType =
  | "addPrefix"
  | "addSuffix"
  | "replace"
  | "removePrefix"
  | "removeSuffix"
  | "uppercase"
  | "lowercase"
  | "titlecase";

interface TransformStep {
  id: string;
  type: TransformType;
  value?: string;
  replaceFrom?: string;
  replaceTo?: string;
}

export default function ItemGenerator() {
  const { t } = useTranslation();
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const categories = useGraphStore((state) => state.categories);
  const addItem = useGraphStore((state) => state.addItem);
  const addTag = useGraphStore((state) => state.addTag);

  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<TransformStep[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState<string>("");
  const [targetTagIds, setTargetTagIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    const term = searchTerm.toLowerCase();
    return items.filter((item) => {
      if (item.name.toLowerCase().includes(term)) return true;
      if (item.categoryId) {
        const category = categories.find(c => c.id === item.categoryId);
        if (category && category.name.toLowerCase().includes(term)) return true;
      }
      return false;
    });
  }, [items, searchTerm, categories]);

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const getSourceItems = (): Item[] => {
    if (selectedTagId) {
      const tag = tags.find((t) => t.id === selectedTagId);
      if (tag) {
        return items.filter((item) => tag.memberItemIds.includes(item.id));
      }
    }
    if (selectedCategoryId) {
      return items.filter((item) =>
        selectedCategoryId === NO_CATEGORY_VALUE
          ? !item.categoryId
          : item.categoryId === selectedCategoryId
      );
    }
    return items.filter((item) => selectedItemIds.includes(item.id));
  };

  const toggleTargetTag = (tagId: string) => {
    setTargetTagIds((previous) =>
      previous.includes(tagId)
        ? previous.filter((id) => id !== tagId)
        : [...previous, tagId]
    );
  };

  const slugify = (text: string) => text.toLowerCase().trim().replace(/\s+/g, "_");

  const toTitleCase = (text: string) =>
    text
      .toLowerCase()
      .split(/\s+/)
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
      .join(" ");

  const applyTransformSteps = (itemName: string, itemId: string): { name: string; id: string } => {
    let newName = itemName;
    let newId = itemId;

    steps.forEach((step) => {
      switch (step.type) {
        case "addPrefix": {
          const val = step.value?.trim();
          if (val) {
            newName = `${val} ${newName}`;
            newId = `${slugify(val)}_${newId}`;
          }
          break;
        }
        case "addSuffix": {
          const val = step.value?.trim();
          if (val) {
            newName = `${newName} ${val}`;
            newId = `${newId}_${slugify(val)}`;
          }
          break;
        }
        case "removePrefix": {
          const val = step.value?.trim();
          if (val && newName.toLowerCase().startsWith(val.toLowerCase())) {
            newName = newName.substring(val.length).trim();
            const slug = slugify(val);
            if (newId.startsWith(`${slug}_`)) {
              newId = newId.substring(slug.length + 1);
            }
          }
          break;
        }
        case "removeSuffix": {
          const val = step.value?.trim();
          if (val && newName.toLowerCase().endsWith(val.toLowerCase())) {
            newName = newName.substring(0, newName.length - val.length).trim();
            const slug = slugify(val);
            if (newId.endsWith(`_${slug}`)) {
              newId = newId.substring(0, newId.length - slug.length - 1);
            }
          }
          break;
        }
        case "replace": {
          const from = step.replaceFrom?.trim();
          const to = step.replaceTo ?? "";
          if (from) {
            newName = newName.replace(new RegExp(from, "gi"), to);
            newId = newId.replace(new RegExp(slugify(from), "gi"), slugify(to));
          }
          break;
        }
        case "uppercase": {
          newName = newName.toUpperCase();
          break;
        }
        case "lowercase": {
          newName = newName.toLowerCase();
          break;
        }
        case "titlecase": {
          newName = toTitleCase(newName);
          break;
        }
      }
    });

    return { name: newName, id: newId };
  };

  const addStep = (type: TransformType = "addPrefix") => {
    setSteps((prev) => [
      ...prev,
      {
        id: `step_${Date.now()}_${prev.length}`,
        type,
        value: "",
        replaceFrom: "",
        replaceTo: "",
      },
    ]);
  };

  const updateStep = (stepId: string, patch: Partial<TransformStep>) => {
    setSteps((prev) => prev.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
  };

  const removeStep = (stepId: string) => {
    setSteps((prev) => prev.filter((step) => step.id !== stepId));
  };

  const validateSteps = (): string | null => {
    if (steps.length === 0) return t("ui.itemGenerator.validation.oneStep");

    for (const step of steps) {
      switch (step.type) {
        case "addPrefix":
        case "addSuffix":
        case "removePrefix":
        case "removeSuffix":
          if (!step.value?.trim()) return t("ui.itemGenerator.validation.value");
          break;
        case "replace":
          if (!step.replaceFrom?.trim()) return t("ui.itemGenerator.validation.search");
          break;
        default:
          break;
      }
    }
    return null;
  };

  const generateSuggestions = () => {
    const sourceItems = getSourceItems();
    
    if (sourceItems.length === 0) {
      alert(t("ui.generator.item.selectFirst"));
      return;
    }

    const stepError = validateSteps();
    if (stepError) {
      alert(stepError);
      return;
    }

    const timestamp = Date.now();
    const newSuggestions: ItemSuggestion[] = [];

    sourceItems.forEach((sourceItem, index) => {
      const transformed = applyTransformSteps(sourceItem.name, sourceItem.id);
      
      const exists = items.some((item) => item.id === transformed.id);
      
      if (!exists && transformed.name !== sourceItem.name) {
        newSuggestions.push({
          id: `gen_${transformed.id}_${timestamp + index}`,
          name: transformed.name,
          itemId: transformed.id,
          categoryId:
            targetCategoryId === NO_CATEGORY_VALUE
              ? undefined
              : targetCategoryId || sourceItem.categoryId,
          targetTagIds: [...targetTagIds],
          approved: true,
          sourceItem,
        });
      }
    });

    if (newSuggestions.length === 0) {
      alert(t("ui.generator.item.noNew"));
      return;
    }

    setSuggestions(newSuggestions);
  };

  const toggleApproval = (suggestionId: string) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, approved: !s.approved } : s))
    );
  };

  const approveAll = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, approved: true })));
  };

  const rejectAll = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, approved: false })));
  };

  const createApprovedItems = () => {
    const approved = suggestions.filter((s) => s.approved);
    
    if (approved.length === 0) {
      alert(t("ui.generator.item.noApproved"));
      return;
    }

    if (!confirm(t("ui.generator.item.confirmCreate", { count: approved.length }))) {
      return;
    }

    approved.forEach((suggestion) => {
      addItem({
        id: suggestion.itemId,
        name: suggestion.name,
        categoryId: suggestion.categoryId,
      });
    });

    const createdItemIds = approved.map((suggestion) => suggestion.itemId);
    const approvedTargetTagIds = new Set(
      approved.flatMap((suggestion) => suggestion.targetTagIds)
    );
    tags.forEach((tag) => {
      if (!approvedTargetTagIds.has(tag.id)) return;
      addTag({
        ...tag,
        memberItemIds: Array.from(new Set([...tag.memberItemIds, ...createdItemIds])),
      });
    });

    alert(`✅ ${t("ui.generator.item.created", { count: approved.length })}`);
    setSuggestions([]);
  };

  const clearForm = () => {
    setSelectedTagId("");
    setSelectedCategoryId("");
    setSelectedItemIds([]);
    setSteps([]);
    setTargetCategoryId("");
    setTargetTagIds([]);
    setSearchTerm("");
    setSuggestions([]);
  };

  return (
    <div className="config-mode-content">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>{t("ui.generator.item.title")}</h3>
          <p className="help-text">
            {t("ui.itemGenerator.intro")}
          </p>
        </div>

        <div className="config-section">
          <h3>{t("ui.generator.item.selectSources")}</h3>
          
          <div className="form-row">
            <label>{t("ui.generator.item.sourceTag")}</label>
            <select
              value={selectedTagId}
              onChange={(e) => {
                setSelectedTagId(e.target.value);
                setSelectedCategoryId("");
                setSelectedItemIds([]);
              }}
              className="config-input"
            >
              <option value="">— {t("ui.generator.item.noTag")} —</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name} ({tag.memberItemIds.length} items)
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>{t("ui.generator.item.sourceCategory")}</label>
            <select
              value={selectedCategoryId}
              onChange={(e) => {
                setSelectedCategoryId(e.target.value);
                setSelectedTagId("");
                setSelectedItemIds([]);
              }}
              className="config-input"
            >
              <option value="">— {t("ui.generator.item.manual")} —</option>
              <option value={NO_CATEGORY_VALUE}>— {t("ui.generator.item.none")} —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({items.filter((item) => item.categoryId === category.id).length} items)
                </option>
              ))}
            </select>
          </div>

          {!selectedTagId && !selectedCategoryId && (
            <>
              <input
                type="text"
                placeholder={t("ui.generator.item.search")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="config-input"
                style={{ marginTop: "0.5rem" }}
              />
              <div className="item-selection-list">
                {filteredItems.map((item) => {
                  const category = item.categoryId ? categories.find(c => c.id === item.categoryId) : null;
                  return (
                    <div
                      key={item.id}
                      className={`selectable-item ${selectedItemIds.includes(item.id) ? "selected" : ""}`}
                      onClick={() => toggleItemSelection(item.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => toggleItemSelection(item.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="item-info">
                        <span className="item-name">{item.name}</span>
                        {category && <span className="category-badge-mini">{category.name}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {selectedTagId && (
            <div className="selected-tag-info">
              ✓ {t("ui.generator.item.usingTag", { name: tags.find(tag => tag.id === selectedTagId)?.name ?? "" })}
              <div className="help-text" style={{ marginTop: "0.25rem" }}>
                {t("ui.itemGenerator.itemsSelected", { count: tags.find(tag => tag.id === selectedTagId)?.memberItemIds.length ?? 0 })}
              </div>
            </div>
          )}

          {selectedCategoryId && (
            <div className="selected-tag-info">
              ✓ {t("ui.itemGenerator.usingCategory", { name: selectedCategoryId === NO_CATEGORY_VALUE ? t("ui.generator.item.none") : categories.find((category) => category.id === selectedCategoryId)?.name })}
              <div className="help-text" style={{ marginTop: "0.25rem" }}>
                {t("ui.itemGenerator.itemsSelected", { count: getSourceItems().length })}
              </div>
            </div>
          )}

          {!selectedTagId && !selectedCategoryId && selectedItemIds.length > 0 && (
            <div className="selected-items-count">
              ✓ {t("ui.itemGenerator.itemsSelected", { count: selectedItemIds.length })}
            </div>
          )}
        </div>
      </div>

      <div className="config-main">
        <div className="generator-panel">
          <h3>{t("ui.generator.item.settings")}</h3>
          
          <div className="form-row" style={{ alignItems: "flex-start" }}>
            <div>
              <label>{t("ui.generator.item.steps")}</label>
              <p className="help-text">{t("ui.generator.item.stepsHelp")}</p>
            </div>
            <button onClick={() => addStep()} className="btn-secondary" style={{ marginLeft: "auto" }}>
              + {t("ui.itemGenerator.addStep")}
            </button>
          </div>

          {steps.length === 0 && (
            <div className="help-text" style={{ marginBottom: "1rem" }}>
              {t("ui.itemGenerator.noSteps")}
            </div>
          )}

          <div className="steps-list">
            {steps.map((step, index) => (
              <div key={step.id} className="suggestion-card" style={{ marginBottom: "0.75rem" }}>
                <div className="suggestion-header">
                  <div className="suggestion-title">
                    <h4>{t("ui.itemGenerator.step", { number: index + 1 })}</h4>
                    <div className="suggestion-badges">
                      <span className="category-badge-mini">{step.type}</span>
                    </div>
                  </div>
                  <button onClick={() => removeStep(step.id)} className="btn-secondary">
                    {t("ui.itemGenerator.remove")}
                  </button>
                </div>

                <div className="form-row">
                  <label>{t("ui.generator.item.type")}</label>
                  <select
                    value={step.type}
                    onChange={(e) => updateStep(step.id, { type: e.target.value as TransformType })}
                    className="config-input"
                  >
                    <option value="addPrefix">{t("ui.generator.item.addPrefix")}</option>
                    <option value="addSuffix">{t("ui.generator.item.addSuffix")}</option>
                    <option value="replace">{t("ui.generator.item.findReplace")}</option>
                    <option value="removePrefix">{t("ui.generator.item.removePrefix")}</option>
                    <option value="removeSuffix">{t("ui.generator.item.removeSuffix")}</option>
                    <option value="uppercase">{t("ui.generator.item.uppercase")}</option>
                    <option value="lowercase">{t("ui.generator.item.lowercase")}</option>
                    <option value="titlecase">{t("ui.generator.item.titlecase")}</option>
                  </select>
                </div>

                {(step.type === "addPrefix" || step.type === "addSuffix" || step.type === "removePrefix" || step.type === "removeSuffix") && (
                  <div className="form-row">
                    <label>
                      {t("ui.itemGenerator.value")}
                    </label>
                    <input
                      type="text"
                      placeholder={t("ui.itemGenerator.rawExample")}
                      value={step.value ?? ""}
                      onChange={(e) => updateStep(step.id, { value: e.target.value })}
                      className="config-input"
                    />
                  </div>
                )}

                {step.type === "replace" && (
                  <>
                    <div className="form-row">
                      <label>{t("ui.generator.item.find")}</label>
                      <input
                        type="text"
                        placeholder={t("ui.itemGenerator.rawExample")}
                        value={step.replaceFrom ?? ""}
                        onChange={(e) => updateStep(step.id, { replaceFrom: e.target.value })}
                        className="config-input"
                      />
                    </div>
                    <div className="form-row">
                      <label>{t("ui.generator.item.replaceWith")}</label>
                      <input
                        type="text"
                        placeholder={t("ui.itemGenerator.crushedExample")}
                        value={step.replaceTo ?? ""}
                        onChange={(e) => updateStep(step.id, { replaceTo: e.target.value })}
                        className="config-input"
                      />
                    </div>
                  </>
                )}

                {(step.type === "uppercase" || step.type === "lowercase" || step.type === "titlecase") && (
                  <div className="help-text" style={{ marginTop: "0.5rem" }}>
                    {t("ui.itemGenerator.caseHelp")}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="form-row">
            <label>{t("ui.generator.item.targetCategory")}</label>
            <select
              value={targetCategoryId}
              onChange={(e) => setTargetCategoryId(e.target.value)}
              className="config-input"
            >
              <option value="">— {t("ui.generator.item.keepCategory")} —</option>
              <option value={NO_CATEGORY_VALUE}>— {t("ui.generator.item.none")} —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row item-generator-target-tags">
            <div className="item-generator-setting-heading">
              <label>{t("ui.generator.item.targetTags")}</label>
              <span className="help-text">{t("ui.generator.item.targetTagsHelp")}</span>
            </div>
            {tags.length > 0 ? (
              <div className="item-generator-tag-grid">
                {tags.map((tag) => (
                  <label key={tag.id} className="item-generator-tag-option">
                    <input
                      type="checkbox"
                      checked={targetTagIds.includes(tag.id)}
                      onChange={() => toggleTargetTag(tag.id)}
                    />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="help-text">{t("ui.generator.item.createTagFirst")}</span>
            )}
          </div>

          <div className="form-row">
            <div className="form-actions">
              <button onClick={generateSuggestions} className="btn-primary btn-large">
                {t("ui.itemGenerator.preview")}
              </button>
              <button onClick={clearForm} className="btn-secondary btn-large">
                {t("ui.itemGenerator.clear")}
              </button>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="suggestions-section">
              <div className="suggestions-header">
                <h3>{t("ui.itemGenerator.suggestions", { count: suggestions.length })}</h3>
                <div className="bulk-actions">
                  <button onClick={approveAll} className="btn-secondary">
                    ✓ {t("ui.itemGenerator.approveAll")}
                  </button>
                  <button onClick={rejectAll} className="btn-secondary">
                    ✗ {t("ui.itemGenerator.rejectAll")}
                  </button>
                  <button
                    onClick={createApprovedItems}
                    className="btn-primary"
                    disabled={!suggestions.some((s) => s.approved)}
                  >
                    {t("ui.itemGenerator.createApproved", { count: suggestions.filter((s) => s.approved).length })}
                  </button>
                </div>
              </div>

              <div className="suggestions-list">
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className={`suggestion-card ${suggestion.approved ? "approved" : "rejected"}`}
                  >
                    <div className="suggestion-header">
                      <div className="suggestion-title">
                        <h4>{suggestion.name}</h4>
                        <div className="suggestion-badges">
                          {suggestion.categoryId && (
                            <span className="category-badge-mini">
                              {categories.find(c => c.id === suggestion.categoryId)?.name}
                            </span>
                          )}
                          {suggestion.targetTagIds.map((tagId) => (
                            <span key={tagId} className="tag-badge-mini">
                              {tags.find((tag) => tag.id === tagId)?.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleApproval(suggestion.id)}
                        className={`btn-toggle ${suggestion.approved ? "approved" : "rejected"}`}
                      >
                        {suggestion.approved ? `✓ ${t("ui.itemGenerator.approved")}` : `✗ ${t("ui.itemGenerator.rejected")}`}
                      </button>
                    </div>

                    <div className="suggestion-details">
                      <div className="transform-arrow">
                        <span className="source-item">{suggestion.sourceItem.name}</span>
                        <span className="arrow">→</span>
                        <span className="target-item">{suggestion.name}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
