import { useState, useEffect, useRef, useMemo } from "react";
import { useGraphStore } from "../store/graphStore";
import { NodeType } from "../components/NodeTypeSelector";

type CommandAction = {
  id: string;
  type: "input" | "output" | "recipe" | "requester" | "inputrecipe" | "recipetag" | "inputrecipetag";
  label: string;
  itemId?: string;
  itemName?: string;
  recipeId?: string;
  recipeName?: string;
  recipeTagId?: string;
  recipeTagName?: string;
  icon: string;
};

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  onActionSelected: (action: CommandAction) => void;
};

export default function CommandPalette({ isOpen, onClose, onActionSelected }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useGraphStore((state) => state.items);
  const recipes = useGraphStore((state) => state.recipes);
  const recipeTags = useGraphStore((state) => state.recipeTags);

  // Generate all possible actions based on search
  const filteredActions = useMemo(() => {
    if (!search) return [];

    const searchLower = search.toLowerCase();
    const actions: CommandAction[] = [];

    // Search through items for Input/Output nodes
    items.forEach((item) => {
      if (item.name.toLowerCase().includes(searchLower)) {
        actions.push({
          id: `input-${item.id}`,
          type: "input",
          label: `Create Input: ${item.name}`,
          itemId: item.id,
          itemName: item.name,
          icon: "📥"
        });
        actions.push({
          id: `output-${item.id}`,
          type: "output",
          label: `Create Output: ${item.name}`,
          itemId: item.id,
          itemName: item.name,
          icon: "📤"
        });
        actions.push({
          id: `requester-${item.id}`,
          type: "requester",
          label: `Create Requester: ${item.name}`,
          itemId: item.id,
          itemName: item.name,
          icon: "🎯"
        });
      }
    });

    // Search through recipes
    recipes.forEach((recipe) => {
      if (recipe.name.toLowerCase().includes(searchLower)) {
        actions.push({
          id: `recipe-${recipe.id}`,
          type: "recipe",
          label: `Create Recipe: ${recipe.name}`,
          recipeId: recipe.id,
          recipeName: recipe.name,
          icon: "⚙️"
        });
        actions.push({
          id: `inputrecipe-${recipe.id}`,
          type: "inputrecipe",
          label: `Create Input Recipe: ${recipe.name}`,
          recipeId: recipe.id,
          recipeName: recipe.name,
          icon: "📥⚙️"
        });
      }
    });

    // Search through recipe outputs for matches
    recipes.forEach((recipe) => {
      recipe.outputs.forEach((output) => {
        const outputItem = items.find((item) => item.id === output.itemId);
        if (outputItem && outputItem.name.toLowerCase().includes(searchLower)) {
          if (!actions.some((a) => a.id === `recipe-${recipe.id}`)) {
            actions.push({
              id: `recipe-${recipe.id}`,
              type: "recipe",
              label: `Create Recipe: ${recipe.name}`,
              recipeId: recipe.id,
              recipeName: recipe.name,
              icon: "⚙️"
            });
          }
        }
      });
    });

    // Search through recipe inputs for matches
    recipes.forEach((recipe) => {
      recipe.inputs.forEach((input) => {
        if (input.refType === "item") {
          const inputItem = items.find((item) => item.id === input.refId);
          if (inputItem && inputItem.name.toLowerCase().includes(searchLower)) {
            if (!actions.some((a) => a.id === `recipe-${recipe.id}`)) {
              actions.push({
                id: `recipe-${recipe.id}`,
                type: "recipe",
                label: `Create Recipe: ${recipe.name}`,
                recipeId: recipe.id,
                recipeName: recipe.name,
                icon: "⚙️"
              });
            }
          }
        }
      });
    });

    // Search through recipe tags
    recipeTags.forEach((tag) => {
      if (tag.name.toLowerCase().includes(searchLower)) {
        actions.push({
          id: `recipetag-${tag.id}`,
          type: "recipetag",
          label: `Create Recipe Tag: ${tag.name}`,
          recipeTagId: tag.id,
          recipeTagName: tag.name,
          icon: "🏷️⚙️"
        });
        actions.push({
          id: `inputrecipetag-${tag.id}`,
          type: "inputrecipetag",
          label: `Create Input Recipe Tag: ${tag.name}`,
          recipeTagId: tag.id,
          recipeTagName: tag.name,
          icon: "📥🏷️"
        });
      }
    });

    // Remove duplicates and limit results
    const uniqueActions = actions.filter((action, index, self) =>
      index === self.findIndex((a) => a.id === action.id)
    );

    return uniqueActions.slice(0, 10); // Limit to 10 results
  }, [search, items, recipes, recipeTags]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setHighlightedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Reset highlighted index when results change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredActions.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredActions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filteredActions.length > 0) {
        e.preventDefault();
        onActionSelected(filteredActions[highlightedIndex]);
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredActions, highlightedIndex, onClose, onActionSelected]);

  if (!isOpen) return null;

  return (
    <>
      <div className="command-palette-backdrop" onClick={onClose} />
      <div className="command-palette">
        <div className="command-palette-search">
          <span className="command-palette-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items, recipes, or actions..."
            className="command-palette-input"
          />
        </div>
        <div className="command-palette-results" ref={listRef}>
          {filteredActions.length === 0 && search && (
            <div className="command-palette-empty">
              No results found for "{search}"
            </div>
          )}
          {filteredActions.length === 0 && !search && (
            <div className="command-palette-empty">
              Start typing to search for items, recipes, or actions...
            </div>
          )}
          {filteredActions.map((action, index) => (
            <div
              key={action.id}
              className={`command-palette-item ${index === highlightedIndex ? "highlighted" : ""}`}
              onClick={() => {
                onActionSelected(action);
                onClose();
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span className="command-palette-item-icon">{action.icon}</span>
              <span className="command-palette-item-label">{action.label}</span>
            </div>
          ))}
        </div>
        <div className="command-palette-footer">
          <span className="command-palette-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate · <kbd>Enter</kbd> Select · <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
}

export type { CommandAction };
