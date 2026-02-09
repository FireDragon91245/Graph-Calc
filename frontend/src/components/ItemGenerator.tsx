import { useState, useMemo } from "react";
import { useGraphStore, Item } from "../store/graphStore";

interface ItemSuggestion {
  id: string;
  name: string;
  itemId: string;
  categoryId?: string;
  approved: boolean;
  sourceItem: Item;
}

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
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const categories = useGraphStore((state) => state.categories);
  const addItem = useGraphStore((state) => state.addItem);

  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string>("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<TransformStep[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState<string>("");
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
    return items.filter((item) => selectedItemIds.includes(item.id));
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
    if (steps.length === 0) return "Add at least one transformation step.";

    for (const step of steps) {
      switch (step.type) {
        case "addPrefix":
        case "addSuffix":
        case "removePrefix":
        case "removeSuffix":
          if (!step.value?.trim()) return "Each add/remove step needs a value.";
          break;
        case "replace":
          if (!step.replaceFrom?.trim()) return "Find & replace needs a search term.";
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
      alert("Please select items or a tag first!");
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
          categoryId: targetCategoryId || sourceItem.categoryId,
          approved: true,
          sourceItem,
        });
      }
    });

    if (newSuggestions.length === 0) {
      alert("No new items to generate! All transformed items already exist or transformation had no effect.");
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
      alert("No items approved!");
      return;
    }

    if (!confirm(`Create ${approved.length} items?`)) {
      return;
    }

    approved.forEach((suggestion) => {
      addItem({
        id: suggestion.itemId,
        name: suggestion.name,
        categoryId: suggestion.categoryId,
      });
    });

    alert(`✅ Created ${approved.length} items!`);
    setSuggestions([]);
  };

  const clearForm = () => {
    setSelectedTagId("");
    setSelectedItemIds([]);
    setSteps([]);
    setSuggestions([]);
  };

  return (
    <div className="config-mode-content">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>Item Generator</h3>
          <p className="help-text">
            Generate new items by transforming existing ones with naming patterns
          </p>
        </div>

        <div className="config-section">
          <h3>Select Source Items</h3>
          
          <div className="form-row">
            <label>Select Tag (Optional)</label>
            <select
              value={selectedTagId}
              onChange={(e) => {
                setSelectedTagId(e.target.value);
                setSelectedItemIds([]);
              }}
              className="config-input"
            >
              <option value="">-- Or select items manually --</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name} ({tag.memberItemIds.length} items)
                </option>
              ))}
            </select>
          </div>

          {!selectedTagId && (
            <>
              <input
                type="text"
                placeholder="Search items..."
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
                        onChange={() => {}}
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
              ✓ Using tag: <strong>{tags.find(t => t.id === selectedTagId)?.name}</strong>
              <div className="help-text" style={{ marginTop: "0.25rem" }}>
                {tags.find(t => t.id === selectedTagId)?.memberItemIds.length} items selected
              </div>
            </div>
          )}

          {!selectedTagId && selectedItemIds.length > 0 && (
            <div className="selected-items-count">
              ✓ {selectedItemIds.length} items selected
            </div>
          )}
        </div>
      </div>

      <div className="config-main">
        <div className="generator-panel">
          <h3>Transformation Settings</h3>
          
          <div className="form-row" style={{ alignItems: "flex-start" }}>
            <div>
              <label>Steps (run top to bottom)</label>
              <p className="help-text">Chain multiple actions like remove prefix → add prefix → replace text.</p>
            </div>
            <button onClick={() => addStep()} className="btn-secondary" style={{ marginLeft: "auto" }}>
              + Add Step
            </button>
          </div>

          {steps.length === 0 && (
            <div className="help-text" style={{ marginBottom: "1rem" }}>
              No steps yet. Add one to start building a transformation pipeline.
            </div>
          )}

          <div className="steps-list">
            {steps.map((step, index) => (
              <div key={step.id} className="suggestion-card" style={{ marginBottom: "0.75rem" }}>
                <div className="suggestion-header">
                  <div className="suggestion-title">
                    <h4>Step {index + 1}</h4>
                    <div className="suggestion-badges">
                      <span className="category-badge-mini">{step.type}</span>
                    </div>
                  </div>
                  <button onClick={() => removeStep(step.id)} className="btn-secondary">
                    Remove
                  </button>
                </div>

                <div className="form-row">
                  <label>Type</label>
                  <select
                    value={step.type}
                    onChange={(e) => updateStep(step.id, { type: e.target.value as TransformType })}
                    className="config-input"
                  >
                    <option value="addPrefix">Add Prefix</option>
                    <option value="addSuffix">Add Suffix</option>
                    <option value="replace">Find & Replace</option>
                    <option value="removePrefix">Remove Prefix</option>
                    <option value="removeSuffix">Remove Suffix</option>
                    <option value="uppercase">Uppercase (name only)</option>
                    <option value="lowercase">Lowercase (name only)</option>
                    <option value="titlecase">Title Case (name only)</option>
                  </select>
                </div>

                {(step.type === "addPrefix" || step.type === "addSuffix" || step.type === "removePrefix" || step.type === "removeSuffix") && (
                  <div className="form-row">
                    <label>
                      {step.type === "addPrefix" && "Value"}
                      {step.type === "addSuffix" && "Value"}
                      {step.type === "removePrefix" && "Value"}
                      {step.type === "removeSuffix" && "Value"}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Raw"
                      value={step.value ?? ""}
                      onChange={(e) => updateStep(step.id, { value: e.target.value })}
                      className="config-input"
                    />
                  </div>
                )}

                {step.type === "replace" && (
                  <>
                    <div className="form-row">
                      <label>Find Text</label>
                      <input
                        type="text"
                        placeholder="e.g., Raw"
                        value={step.replaceFrom ?? ""}
                        onChange={(e) => updateStep(step.id, { replaceFrom: e.target.value })}
                        className="config-input"
                      />
                    </div>
                    <div className="form-row">
                      <label>Replace With</label>
                      <input
                        type="text"
                        placeholder="e.g., Crushed"
                        value={step.replaceTo ?? ""}
                        onChange={(e) => updateStep(step.id, { replaceTo: e.target.value })}
                        className="config-input"
                      />
                    </div>
                  </>
                )}

                {(step.type === "uppercase" || step.type === "lowercase" || step.type === "titlecase") && (
                  <div className="help-text" style={{ marginTop: "0.5rem" }}>
                    This step only changes the display name; IDs stay slugged from other steps.
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="form-row">
            <label>Target Category (Optional)</label>
            <select
              value={targetCategoryId}
              onChange={(e) => setTargetCategoryId(e.target.value)}
              className="config-input"
            >
              <option value="">-- Keep source category --</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-actions">
              <button onClick={generateSuggestions} className="btn-primary btn-large">
                Generate Preview
              </button>
              <button onClick={clearForm} className="btn-secondary btn-large">
                Clear
              </button>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="suggestions-section">
              <div className="suggestions-header">
                <h3>{suggestions.length} Item Suggestions</h3>
                <div className="bulk-actions">
                  <button onClick={approveAll} className="btn-secondary">
                    ✓ Approve All
                  </button>
                  <button onClick={rejectAll} className="btn-secondary">
                    ✗ Reject All
                  </button>
                  <button
                    onClick={createApprovedItems}
                    className="btn-primary"
                    disabled={!suggestions.some((s) => s.approved)}
                  >
                    Create {suggestions.filter((s) => s.approved).length} Approved
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
                        </div>
                      </div>
                      <button
                        onClick={() => toggleApproval(suggestion.id)}
                        className={`btn-toggle ${suggestion.approved ? "approved" : "rejected"}`}
                      >
                        {suggestion.approved ? "✓ Approved" : "✗ Rejected"}
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
