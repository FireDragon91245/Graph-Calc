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

  // Extract variable parts from an item ID pattern
  const extractVariablePart = (itemId: string, patternIds: string[]): string | null => {
    // Try to find the common pattern and extract the variable part
    // E.g., from ["refined_diamond_ore", "refined_emerald_ore"], extract "diamond" or "emerald"
    
    // Split all IDs into parts
    const allParts = patternIds.map(id => id.split('_'));
    
    // Find common prefix and suffix
    let prefixLen = 0;
    let suffixLen = 0;
    
    if (allParts.length < 2) return null;
    
    // Find common prefix
    while (prefixLen < allParts[0].length && allParts.every(parts => parts[prefixLen] === allParts[0][prefixLen])) {
      prefixLen++;
    }
    
    // Find common suffix
    while (suffixLen < allParts[0].length - prefixLen && 
           allParts.every(parts => parts[parts.length - 1 - suffixLen] === allParts[0][allParts[0].length - 1 - suffixLen])) {
      suffixLen++;
    }
    
    // Extract the variable part from the current itemId
    const parts = itemId.split('_');
    const variableParts = parts.slice(prefixLen, parts.length - suffixLen);
    return variableParts.join('_');
  };

  // Find items matching a pattern
  const findMatchingItems = (patternTemplate: string, variablePart: string): Item | null => {
    const item = items.find(i => i.id === patternTemplate.replace('{var}', variablePart));
    return item || null;
  };

  // Generate suggestions based on selected pattern
  const generateSuggestions = (patternId: string) => {
    const pattern = patterns.find((p) => p.id === patternId);
    if (!pattern || pattern.recipes.length < 2) {
      setSuggestions([]);
      return;
    }

    const suggestions: RecipeSuggestion[] = [];
    
    // Analyze the pattern from multiple recipes
    const templateRecipe = pattern.recipes[0];
    const inputIds = pattern.recipes.map(r => r.inputs[0]?.refId).filter(Boolean);
    const outputIds = pattern.recipes.map(r => r.outputs[0]?.itemId).filter(Boolean);
    
    if (inputIds.length < 2 || outputIds.length < 2) {
      setSuggestions([]);
      return;
    }

    // Extract pattern templates
    const inputPattern = extractPatternTemplate(inputIds);
    const outputPattern = extractPatternTemplate(outputIds);
    
    if (!inputPattern || !outputPattern) {
      setSuggestions([]);
      return;
    }

    // Find all items that match the input pattern
    const matchingInputs = items.filter(item => {
      const variablePart = extractVariableFromPattern(item.id, inputPattern);
      if (!variablePart) return false;
      
      // Check if this input already has a recipe
      const hasRecipe = recipes.some(r => 
        r.inputs.some(inp => inp.refId === item.id)
      );
      
      return !hasRecipe;
    });

    // Generate suggestions for matching items
    matchingInputs.forEach(inputItem => {
      const variablePart = extractVariableFromPattern(inputItem.id, inputPattern);
      if (!variablePart) return;
      
      // Find corresponding output
      const outputId = outputPattern.prefix + variablePart + outputPattern.suffix;
      const outputItem = items.find(i => i.id === outputId);
      
      if (!outputItem) return;

      // Extract recipe name pattern
      const recipeName = generateRecipeName(templateRecipe.name, pattern.recipes, inputItem.name);

      suggestions.push({
        id: `gen_${inputItem.id}_${Date.now()}`,
        name: recipeName,
        timeSeconds: templateRecipe.timeSeconds,
        inputs: templateRecipe.inputs.map((inp, idx) => {
          if (idx === 0) {
            return {
              refType: "item" as const,
              refId: inputItem.id,
              amount: inp.amount,
              displayName: inputItem.name,
            };
          }
          return {
            refType: inp.refType,
            refId: inp.refId,
            amount: inp.amount,
            displayName: items.find(i => i.id === inp.refId)?.name || inp.refId,
          };
        }),
        outputs: templateRecipe.outputs.map((out, idx) => {
          if (idx === 0) {
            return {
              itemId: outputItem.id,
              amount: out.amount,
              probability: out.probability,
              displayName: outputItem.name,
            };
          }
          return {
            itemId: out.itemId,
            amount: out.amount,
            probability: out.probability,
            displayName: items.find(i => i.id === out.itemId)?.name || out.itemId,
          };
        }),
        approved: true,
        sourceItem: inputItem,
      });
    });

    setSuggestions(suggestions);
  };

  // Extract pattern template from a list of IDs
  const extractPatternTemplate = (ids: string[]): { prefix: string; suffix: string } | null => {
    if (ids.length < 2) return null;
    
    const parts = ids.map(id => id.split('_'));
    let prefixLen = 0;
    let suffixLen = 0;
    
    // Find common prefix
    while (prefixLen < parts[0].length && parts.every(p => p[prefixLen] === parts[0][prefixLen])) {
      prefixLen++;
    }
    
    // Find common suffix
    while (suffixLen < parts[0].length - prefixLen && 
           parts.every(p => p[p.length - 1 - suffixLen] === parts[0][parts[0].length - 1 - suffixLen])) {
      suffixLen++;
    }
    
    const prefix = parts[0].slice(0, prefixLen).join('_');
    const suffix = parts[0].slice(parts[0].length - suffixLen).join('_');
    
    return { 
      prefix: prefix ? prefix + '_' : '', 
      suffix: suffix ? '_' + suffix : '' 
    };
  };

  // Extract variable part from an ID given a pattern
  const extractVariableFromPattern = (id: string, pattern: { prefix: string; suffix: string }): string | null => {
    if (!id.startsWith(pattern.prefix)) return null;
    if (!id.endsWith(pattern.suffix)) return null;
    
    const start = pattern.prefix.length;
    const end = id.length - pattern.suffix.length;
    const variable = id.substring(start, end);
    
    return variable || null;
  };

  // Generate recipe name by analyzing pattern
  const generateRecipeName = (templateName: string, allRecipes: Recipe[], newItemName: string): string => {
    // Try to extract the pattern from template name and first recipe input
    const firstRecipe = allRecipes[0];
    const firstInput = items.find(i => i.id === firstRecipe.inputs[0]?.refId);
    
    if (firstInput) {
      // Replace the first input's name in template with new item name
      return templateName.replace(firstInput.name, newItemName);
    }
    
    return templateName;
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
