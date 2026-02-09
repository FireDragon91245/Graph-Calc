import { useState, useMemo, DragEvent } from "react";
import { useGraphStore, Recipe, RecipeInput, RecipeOutput, Item, Tag } from "../store/graphStore";

export default function RecipeMode() {
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const addRecipe = useGraphStore((state) => state.addRecipe);

  const [recipeName, setRecipeName] = useState("");
  const [timeSeconds, setTimeSeconds] = useState(2);
  const [inputs, setInputs] = useState<RecipeInput[]>([]);
  const [outputs, setOutputs] = useState<RecipeOutput[]>([]);
  const [draggedItem, setDraggedItem] = useState<Item | Tag | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null);

  const handleAddRecipe = () => {
    if (!recipeName.trim()) return;
    if (inputs.length === 0 || outputs.length === 0) {
      alert("Recipe must have at least one input and one output");
      return;
    }

    addRecipe({
      name: recipeName.trim(),
      timeSeconds,
      inputs,
      outputs
    });

    // Reset form
    setRecipeName("");
    setTimeSeconds(2);
    setInputs([]);
    setOutputs([]);
  };

  const handleDragStart = (e: DragEvent, itemOrTag: Item | Tag) => {
    setDraggedItem(itemOrTag);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDropOnInputs = (e: DragEvent) => {
    e.preventDefault();
    if (draggedItem) {
      const isTag = "memberItemIds" in draggedItem;
      const newInput: RecipeInput = {
        id: `i${inputs.length + 1}`,
        refType: isTag ? "tag" : "item",
        refId: draggedItem.id,
        amount: 1
      };
      setInputs([...inputs, newInput]);
      setDraggedItem(null);
    }
  };

  const handleDropOnOutputs = (e: DragEvent) => {
    e.preventDefault();
    if (draggedItem && !("memberItemIds" in draggedItem)) {
      const newOutput: RecipeOutput = {
        id: `o${outputs.length + 1}`,
        itemId: draggedItem.id,
        amount: 1,
        probability: 1
      };
      setOutputs([...outputs, newOutput]);
      setDraggedItem(null);
    }
  };

  const handleRemoveInput = (id: string) => {
    setInputs(inputs.filter((inp) => inp.id !== id));
  };

  const handleRemoveOutput = (id: string) => {
    setOutputs(outputs.filter((out) => out.id !== id));
  };

  const updateInputAmount = (id: string, amount: number) => {
    setInputs(inputs.map((inp) => (inp.id === id ? { ...inp, amount } : inp)));
  };

  const updateOutputAmount = (id: string, amount: number) => {
    setOutputs(outputs.map((out) => (out.id === id ? { ...out, amount } : out)));
  };

  const updateOutputProbability = (id: string, probability: number) => {
    setOutputs(outputs.map((out) => (out.id === id ? { ...out, probability } : out)));
  };

  const getInputDisplay = (input: RecipeInput) => {
    if (input.refType === "tag") {
      const tag = tags.find((t) => t.id === input.refId);
      return tag ? tag.name : input.refId;
    } else {
      const item = items.find((i) => i.id === input.refId);
      return item ? item.name : input.refId;
    }
  };

  const getOutputDisplay = (output: RecipeOutput) => {
    const item = items.find((i) => i.id === output.itemId);
    return item ? item.name : output.itemId;
  };

  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    const term = searchTerm.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, searchTerm]);

  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags;
    const term = searchTerm.toLowerCase();
    return tags.filter((tag) => tag.name.toLowerCase().includes(term));
  }, [tags, searchTerm]);

  const getRecipeInfo = (recipe: Recipe) => {
    return {
      inputsDisplay: recipe.inputs.map((inp) => getInputDisplay(inp)).join(", "),
      outputsDisplay: recipe.outputs.map((out) => getOutputDisplay(out)).join(", ")
    };
  };

  return (
    <div className="config-mode-content recipe-mode">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>Items & Tags</h3>
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="config-input"
          />
          
          <div className="items-and-tags-browser">
            <div className="browser-section">
              <h4>Tags (for inputs)</h4>
              <div className="browser-list">
                {filteredTags.map((tag) => (
                  <div
                    key={tag.id}
                    className="draggable-item tag-item"
                    draggable
                    onDragStart={(e) => handleDragStart(e, tag)}
                  >
                    <span className="tag-badge">{tag.name}</span>
                    <span className="item-count-mini">{tag.memberItemIds.length}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="browser-section">
              <h4>Items</h4>
              <div className="browser-list">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="draggable-item"
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                  >
                    {item.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="config-section">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">{recipes.length}</div>
              <div className="stat-label">Recipes</div>
            </div>
          </div>
        </div>
      </div>

      <div className="config-main">
        <div className="recipe-builder">
          <div className="builder-header">
            <h3>Recipe Builder</h3>
          </div>
          
          <div className="recipe-form">
            <div className="form-row">
              <label>Recipe Name</label>
              <input
                type="text"
                placeholder="e.g., Macerate Iron"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                className="config-input"
              />
            </div>
            
            <div className="form-row">
              <label>Processing Time (seconds)</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={timeSeconds}
                onChange={(e) => setTimeSeconds(parseFloat(e.target.value))}
                className="config-input"
              />
            </div>

            <div className="recipe-io-grid">
              <div
                className="io-panel inputs-panel"
                onDragOver={handleDragOver}
                onDrop={handleDropOnInputs}
              >
                <h4>Inputs</h4>
                <div className="io-list">
                  {inputs.map((input) => (
                    <div key={input.id} className="io-item">
                      <span className="io-name">{getInputDisplay(input)}</span>
                      <input
                        type="number"
                        min="1"
                        value={input.amount}
                        onChange={(e) => updateInputAmount(input.id, parseInt(e.target.value))}
                        className="amount-input"
                      />
                      <button onClick={() => handleRemoveInput(input.id)} className="btn-remove">
                        ×
                      </button>
                    </div>
                  ))}
                  {inputs.length === 0 && (
                    <div className="io-empty">Drop items or tags here</div>
                  )}
                </div>
              </div>

              <div
                className="io-panel outputs-panel"
                onDragOver={handleDragOver}
                onDrop={handleDropOnOutputs}
              >
                <h4>Outputs</h4>
                <div className="io-list">
                  {outputs.map((output) => (
                    <div key={output.id} className="io-item">
                      <span className="io-name">{getOutputDisplay(output)}</span>
                      <input
                        type="number"
                        min="1"
                        value={output.amount}
                        onChange={(e) => updateOutputAmount(output.id, parseInt(e.target.value))}
                        className="amount-input"
                        placeholder="Amount"
                      />
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={output.probability}
                        onChange={(e) => updateOutputProbability(output.id, parseFloat(e.target.value))}
                        className="amount-input"
                        placeholder="Prob"
                      />
                      <button onClick={() => handleRemoveOutput(output.id)} className="btn-remove">
                        ×
                      </button>
                    </div>
                  ))}
                  {outputs.length === 0 && (
                    <div className="io-empty">Drop items here (tags not allowed)</div>
                  )}
                </div>
              </div>
            </div>

            <button onClick={handleAddRecipe} className="btn-primary btn-large">
              Create Recipe
            </button>
          </div>
        </div>

        <div className="recipes-list-panel">
          <h3>Existing Recipes</h3>
          <div className="recipes-list">
            {recipes.map((recipe) => {
              const info = getRecipeInfo(recipe);
              return (
                <div
                  key={recipe.id}
                  className={`recipe-card ${selectedRecipe === recipe.id ? "selected" : ""}`}
                  onClick={() => setSelectedRecipe(recipe.id)}
                >
                  <div className="recipe-card-header">
                    <h4>{recipe.name}</h4>
                    <span className="recipe-time">{recipe.timeSeconds}s</span>
                  </div>
                  <div className="recipe-card-io">
                    <div className="recipe-io-line">
                      <span className="io-label">In:</span>
                      <span className="io-value">{info.inputsDisplay}</span>
                    </div>
                    <div className="recipe-io-line">
                      <span className="io-label">Out:</span>
                      <span className="io-value">{info.outputsDisplay}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
