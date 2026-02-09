import { useState, useMemo } from "react";
import { useGraphStore, Recipe, Item, Tag } from "../store/graphStore";

interface RecipeSuggestion {
  id: string;
  name: string;
  timeSeconds: number;
  inputs: Array<{ refType: "item" | "tag"; refId: string; amount: number; displayName: string }>;
  outputs: Array<{ itemId: string; amount: number; probability: number; displayName: string }>;
  approved: boolean;
  sourceItem: Item;
}

export default function RecipeGenerator() {
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const recipes = useGraphStore((state) => state.recipes);
  const addRecipe = useGraphStore((state) => state.addRecipe);

  const [suggestions, setSuggestions] = useState<RecipeSuggestion[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);

  // Detect recipe patterns from existing recipes
  const patterns = useMemo(() => {
    const patternMap = new Map<string, Recipe[]>();

    recipes.forEach((recipe) => {
      // Group by input/output structure similarity
      const key = `${recipe.inputs.length}in_${recipe.outputs.length}out_${recipe.timeSeconds}s`;
      if (!patternMap.has(key)) {
        patternMap.set(key, []);
      }
      patternMap.get(key)!.push(recipe);
    });

    return Array.from(patternMap.entries()).map(([key, recipes]) => ({
      id: key,
      name: `Pattern: ${recipes.length} recipes (${recipes[0].inputs.length} inputs → ${recipes[0].outputs.length} outputs, ${recipes[0].timeSeconds}s)`,
      recipes,
      count: recipes.length,
    }));
  }, [recipes]);

  // Find item name similarity using word matching
  const findSimilarItemName = (sourceItem: Item, targetPrefix: string = ""): Item | null => {
    // Extract base name (e.g., "diamond" from "diamond_geode")
    const sourceName = sourceItem.name.toLowerCase();
    const sourceId = sourceItem.id.toLowerCase();
    
    // Try to extract the gem/material name
    const baseMatch = sourceId.match(/^(.+?)_geode$/);
    if (!baseMatch) return null;
    
    const baseName = baseMatch[1]; // e.g., "diamond"
    
    // Look for item with target prefix + base name
    const targetId = targetPrefix ? `${targetPrefix}_${baseName}` : baseName;
    const targetItem = items.find((item) => item.id.toLowerCase() === targetId);
    
    return targetItem || null;
  };

  // Generate suggestions based on selected pattern
  const generateSuggestions = (patternId: string) => {
    const pattern = patterns.find((p) => p.id === patternId);
    if (!pattern || pattern.recipes.length === 0) return;

    const templateRecipe = pattern.recipes[0];
    const suggestions: RecipeSuggestion[] = [];

    // Detect if this is a geode cutting pattern
    const isGeodePattern = templateRecipe.inputs.some((input) => {
      const item = items.find((i) => i.id === input.refId);
      return item?.id.includes("_geode");
    });

    if (isGeodePattern) {
      // Find all geode items
      const geodeTag = tags.find((t) => t.name === "@geode");
      const geodeItems = geodeTag 
        ? items.filter((item) => geodeTag.memberItemIds.includes(item.id))
        : items.filter((item) => item.id.includes("_geode"));

      // Check which geodes don't have recipes yet
      geodeItems.forEach((geodeItem) => {
        const hasRecipe = recipes.some((recipe) =>
          recipe.inputs.some((input) => input.refId === geodeItem.id)
        );

        if (!hasRecipe) {
          // Try to find corresponding output item (e.g., raw_diamond for diamond_geode)
          const outputItem = findSimilarItemName(geodeItem, "raw");
          
          if (outputItem) {
            // Find the static inputs (e.g., lubricant)
            const staticInputs = templateRecipe.inputs.filter((input) => {
              const item = items.find((i) => i.id === input.refId);
              return item && !item.id.includes("_geode");
            });

            // Find the static outputs (e.g., stone_dust)
            const staticOutputs = templateRecipe.outputs.filter((output) => {
              const item = items.find((i) => i.id === output.itemId);
              return item && !item.id.startsWith("raw_");
            });

            suggestions.push({
              id: `gen_${geodeItem.id}_${Date.now()}`,
              name: `Cut ${geodeItem.name}`,
              timeSeconds: templateRecipe.timeSeconds,
              inputs: [
                {
                  refType: "item",
                  refId: geodeItem.id,
                  amount: 1,
                  displayName: geodeItem.name,
                },
                ...staticInputs.map((input) => ({
                  refType: input.refType,
                  refId: input.refId,
                  amount: input.amount,
                  displayName: items.find((i) => i.id === input.refId)?.name || input.refId,
                })),
              ],
              outputs: [
                {
                  itemId: outputItem.id,
                  amount: 1,
                  probability: 1.0,
                  displayName: outputItem.name,
                },
                ...staticOutputs.map((output) => ({
                  itemId: output.itemId,
                  amount: output.amount,
                  probability: output.probability,
                  displayName: items.find((i) => i.id === output.itemId)?.name || output.itemId,
                })),
              ],
              approved: true,
              sourceItem: geodeItem,
            });
          }
        }
      });
    }

    setSuggestions(suggestions);
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

  const createApprovedRecipes = () => {
    const approved = suggestions.filter((s) => s.approved);
    
    if (approved.length === 0) {
      alert("No recipes approved!");
      return;
    }

    if (!confirm(`Create ${approved.length} recipes?`)) {
      return;
    }

    approved.forEach((suggestion) => {
      const newRecipe: Omit<Recipe, "id"> = {
        name: suggestion.name,
        timeSeconds: suggestion.timeSeconds,
        inputs: suggestion.inputs.map((input, idx) => ({
          id: `i${idx + 1}`,
          refType: input.refType,
          refId: input.refId,
          amount: input.amount,
        })),
        outputs: suggestion.outputs.map((output, idx) => ({
          id: `o${idx + 1}`,
          itemId: output.itemId,
          amount: output.amount,
          probability: output.probability,
        })),
      };
      
      addRecipe(newRecipe);
    });

    alert(`✅ Created ${approved.length} recipes!`);
    setSuggestions([]);
    setSelectedPattern(null);
  };

  return (
    <div className="config-mode-content">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>Recipe Generator</h3>
          <p className="help-text">
            Automatically generate similar recipes based on existing patterns
          </p>
        </div>

        <div className="config-section">
          <h3>Detected Patterns</h3>
          {patterns.length === 0 ? (
            <p className="help-text">No patterns detected. Create some recipes first!</p>
          ) : (
            <div className="pattern-list">
              {patterns.map((pattern) => (
                <div
                  key={pattern.id}
                  className={`pattern-card ${selectedPattern === pattern.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedPattern(pattern.id);
                    generateSuggestions(pattern.id);
                  }}
                >
                  <div className="pattern-name">{pattern.name}</div>
                  <div className="pattern-example">
                    Example: {pattern.recipes[0].name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="config-main">
        {suggestions.length === 0 ? (
          <div className="empty-state">
            <p>Select a pattern to generate recipe suggestions</p>
            <p className="help-text">
              The generator will find items that match the pattern but don't have recipes yet
            </p>
          </div>
        ) : (
          <div className="suggestions-panel">
            <div className="suggestions-header">
              <h3>{suggestions.length} Recipe Suggestions</h3>
              <div className="bulk-actions">
                <button onClick={approveAll} className="btn-secondary">
                  ✓ Approve All
                </button>
                <button onClick={rejectAll} className="btn-secondary">
                  ✗ Reject All
                </button>
                <button
                  onClick={createApprovedRecipes}
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
                    <h4>{suggestion.name}</h4>
                    <button
                      onClick={() => toggleApproval(suggestion.id)}
                      className={`btn-toggle ${suggestion.approved ? "approved" : "rejected"}`}
                    >
                      {suggestion.approved ? "✓ Approved" : "✗ Rejected"}
                    </button>
                  </div>

                  <div className="suggestion-details">
                    <div className="suggestion-time">⏱️ {suggestion.timeSeconds}s</div>
                    
                    <div className="suggestion-io">
                      <div className="suggestion-inputs">
                        <strong>Inputs:</strong>
                        {suggestion.inputs.map((input, idx) => (
                          <div key={idx} className="io-tag">
                            {input.amount}x {input.displayName}
                          </div>
                        ))}
                      </div>
                      
                      <div className="suggestion-outputs">
                        <strong>Outputs:</strong>
                        {suggestion.outputs.map((output, idx) => (
                          <div key={idx} className="io-tag">
                            {output.amount}x {output.displayName}
                            {output.probability < 1 && ` (${(output.probability * 100).toFixed(0)}%)`}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
