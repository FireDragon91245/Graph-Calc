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

type TransformType = "prefix" | "suffix" | "replace" | "removePrefix" | "removeSuffix";

export default function ItemGenerator() {
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const categories = useGraphStore((state) => state.categories);
  const addItem = useGraphStore((state) => state.addItem);

  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string>("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [transformType, setTransformType] = useState<TransformType>("prefix");
  const [transformValue, setTransformValue] = useState("");
  const [replaceFrom, setReplaceFrom] = useState("");
  const [replaceTo, setReplaceTo] = useState("");
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

  const applyTransform = (itemName: string, itemId: string): { name: string; id: string } => {
    let newName = itemName;
    let newId = itemId;

    switch (transformType) {
      case "prefix":
        newName = `${transformValue} ${itemName}`;
        newId = `${transformValue.toLowerCase().replace(/\s+/g, "_")}_${itemId}`;
        break;
      case "suffix":
        newName = `${itemName} ${transformValue}`;
        newId = `${itemId}_${transformValue.toLowerCase().replace(/\s+/g, "_")}`;
        break;
      case "replace":
        if (replaceFrom) {
          newName = itemName.replace(new RegExp(replaceFrom, "gi"), replaceTo);
          newId = itemId.replace(new RegExp(replaceFrom.replace(/\s+/g, "_"), "gi"), replaceTo.replace(/\s+/g, "_"));
        }
        break;
      case "removePrefix":
        if (transformValue && itemName.toLowerCase().startsWith(transformValue.toLowerCase())) {
          newName = itemName.substring(transformValue.length).trim();
          const prefixId = transformValue.toLowerCase().replace(/\s+/g, "_");
          if (itemId.startsWith(prefixId + "_")) {
            newId = itemId.substring(prefixId.length + 1);
          }
        }
        break;
      case "removeSuffix":
        if (transformValue && itemName.toLowerCase().endsWith(transformValue.toLowerCase())) {
          newName = itemName.substring(0, itemName.length - transformValue.length).trim();
          const suffixId = transformValue.toLowerCase().replace(/\s+/g, "_");
          if (itemId.endsWith("_" + suffixId)) {
            newId = itemId.substring(0, itemId.length - suffixId.length - 1);
          }
        }
        break;
    }

    return { name: newName, id: newId };
  };

  const generateSuggestions = () => {
    const sourceItems = getSourceItems();
    
    if (sourceItems.length === 0) {
      alert("Please select items or a tag first!");
      return;
    }

    if (transformType === "replace" && !replaceFrom) {
      alert("Please enter text to replace!");
      return;
    }

    if ((transformType === "prefix" || transformType === "suffix" || transformType === "removePrefix" || transformType === "removeSuffix") && !transformValue) {
      alert(`Please enter ${transformType === "removePrefix" || transformType === "removeSuffix" ? "text to remove" : "text to add"}!`);
      return;
    }

    const newSuggestions: ItemSuggestion[] = [];

    sourceItems.forEach((sourceItem) => {
      const transformed = applyTransform(sourceItem.name, sourceItem.id);
      
      // Check if item already exists
      const exists = items.some((item) => item.id === transformed.id);
      
      if (!exists && transformed.name !== sourceItem.name) {
        newSuggestions.push({
          id: `gen_${transformed.id}_${Date.now()}`,
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
    setTransformValue("");
    setReplaceFrom("");
    setReplaceTo("");
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
          
          <div className="form-row">
            <label>Transform Type</label>
            <select
              value={transformType}
              onChange={(e) => setTransformType(e.target.value as TransformType)}
              className="config-input"
            >
              <option value="prefix">Add Prefix</option>
              <option value="suffix">Add Suffix</option>
              <option value="replace">Find & Replace</option>
              <option value="removePrefix">Remove Prefix</option>
              <option value="removeSuffix">Remove Suffix</option>
            </select>
          </div>

          {transformType === "replace" ? (
            <>
              <div className="form-row">
                <label>Find Text</label>
                <input
                  type="text"
                  placeholder="e.g., Raw"
                  value={replaceFrom}
                  onChange={(e) => setReplaceFrom(e.target.value)}
                  className="config-input"
                />
              </div>
              <div className="form-row">
                <label>Replace With</label>
                <input
                  type="text"
                  placeholder="e.g., Crushed"
                  value={replaceTo}
                  onChange={(e) => setReplaceTo(e.target.value)}
                  className="config-input"
                />
              </div>
            </>
          ) : (
            <div className="form-row">
              <label>
                {transformType === "prefix" && "Prefix to Add"}
                {transformType === "suffix" && "Suffix to Add"}
                {transformType === "removePrefix" && "Prefix to Remove"}
                {transformType === "removeSuffix" && "Suffix to Remove"}
              </label>
              <input
                type="text"
                placeholder={
                  transformType === "prefix" ? "e.g., Crushed" :
                  transformType === "suffix" ? "e.g., Ore" :
                  transformType === "removePrefix" ? "e.g., Raw" :
                  "e.g., Ore"
                }
                value={transformValue}
                onChange={(e) => setTransformValue(e.target.value)}
                className="config-input"
              />
            </div>
          )}

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
