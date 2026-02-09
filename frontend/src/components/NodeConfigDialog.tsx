import { useState, useEffect, useRef, useMemo } from "react";
import { useGraphStore, Recipe, Item } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";

export type NodeType = "recipe" | "input" | "output" | "requester";

type NodeConfigDialogProps = {
  nodeType: NodeType;
  onConfirm: (config: any) => void;
  onCancel: () => void;
};

export default function NodeConfigDialog({
  nodeType,
  onConfirm,
  onCancel
}: NodeConfigDialogProps) {
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus search input when dialog opens
    searchInputRef.current?.focus();
  }, []);

  const recipeOptions = useMemo(
    () => recipes.map((r) => ({ value: r.id, label: r.name })),
    [recipes]
  );

  const itemOptions = useMemo(
    () => items.map((i) => ({ value: i.id, label: i.name })),
    [items]
  );

  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    const term = searchTerm.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, searchTerm]);

  const filteredRecipes = useMemo(() => {
    if (!searchTerm) return recipes;
    const term = searchTerm.toLowerCase();
    return recipes.filter((recipe) => recipe.name.toLowerCase().includes(term));
  }, [recipes, searchTerm]);

  const handleConfirm = () => {
    if (nodeType === "recipe") {
      const recipe = recipes.find((r) => r.id === selectedId);
      if (recipe) {
        onConfirm({ recipeId: recipe.id, recipe });
      }
    } else if (nodeType === "input" || nodeType === "output") {
      const item = items.find((i) => i.id === selectedId);
      if (item) {
        onConfirm({ itemId: item.id, item });
      }
    } else if (nodeType === "requester") {
      const item = items.find((i) => i.id === selectedId);
      if (item) {
        onConfirm({ itemId: item.id, item });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && selectedId) {
      handleConfirm();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Handle arrow navigation
      e.preventDefault();
      const list = nodeType === "recipe" ? filteredRecipes : filteredItems;
      if (list.length === 0) return;
      
      const currentIndex = list.findIndex((item) => item.id === selectedId);
      let newIndex = 0;
      
      if (e.key === "ArrowDown") {
        newIndex = currentIndex < list.length - 1 ? currentIndex + 1 : 0;
      } else {
        newIndex = currentIndex > 0 ? currentIndex - 1 : list.length - 1;
      }
      
      setSelectedId(list[newIndex].id);
    }
  };

  const getTitle = () => {
    switch (nodeType) {
      case "recipe":
        return "Select Recipe";
      case "input":
        return "Select Input Item";
      case "output":
        return "Select Output Item";
      case "requester":
        return "Select Item to Request";
      default:
        return "Select";
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{getTitle()}</h3>
          <button className="dialog-close" onClick={onCancel}>
            ×
          </button>
        </div>
        
        <div className="dialog-body">
          <input
            ref={searchInputRef}
            type="text"
            className="dialog-search"
            placeholder="Type to search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          
          <div className="dialog-list">
            {nodeType === "recipe" ? (
              filteredRecipes.length > 0 ? (
                filteredRecipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    className={`dialog-list-item ${selectedId === recipe.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(recipe.id)}
                    onDoubleClick={() => {
                      setSelectedId(recipe.id);
                      setTimeout(handleConfirm, 0);
                    }}
                  >
                    <div className="list-item-name">{recipe.name}</div>
                    <div className="list-item-meta">
                      {recipe.inputs.length} in → {recipe.outputs.length} out • {recipe.timeSeconds}s
                    </div>
                  </div>
                ))
              ) : (
                <div className="dialog-empty">No recipes found</div>
              )
            ) : (
              filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className={`dialog-list-item ${selectedId === item.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => {
                      setSelectedId(item.id);
                      setTimeout(handleConfirm, 0);
                    }}
                  >
                    <div className="list-item-name">{item.name}</div>
                    <div className="list-item-meta">
                      <span className={`medium-badge medium-${item.medium}`}>
                        {item.medium}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="dialog-empty">No items found</div>
              )
            )}
          </div>
        </div>
        
        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!selectedId}
          >
            Add Node
          </button>
        </div>
        
        <div className="dialog-hints">
          <span>↑↓ Navigate</span>
          <span>Enter Confirm</span>
          <span>Esc Cancel</span>
        </div>
      </div>
    </div>
  );
}
