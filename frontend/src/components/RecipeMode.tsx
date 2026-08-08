import { useState, useMemo, DragEvent } from "react";
import { useGraphStore, Recipe, RecipeInput, RecipeOutput, Item, Tag } from "../store/graphStore";
import { useTranslation } from "react-i18next";

export default function RecipeMode() {
  const { t } = useTranslation();
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const categories = useGraphStore((state) => state.categories);
  const addRecipe = useGraphStore((state) => state.addRecipe);
  const deleteRecipe = useGraphStore((state) => state.deleteRecipe);
  const renameRecipe = useGraphStore((state) => state.renameRecipe);

  const [recipeName, setRecipeName] = useState("");
  const [timeSeconds, setTimeSeconds] = useState(2);
  const [inputs, setInputs] = useState<RecipeInput[]>([]);
  const [outputs, setOutputs] = useState<RecipeOutput[]>([]);
  const [draggedItem, setDraggedItem] = useState<Item | Tag | null>(null);
  const [draggedIngredient, setDraggedIngredient] = useState<{type: 'input' | 'output', index: number} | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [recipeSearchTerm, setRecipeSearchTerm] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [editingRecipeName, setEditingRecipeName] = useState("");
  const [editingRecipe, setEditingRecipe] = useState<string | null>(null);

  const handleAddRecipe = () => {
    if (!recipeName.trim()) return;
    if (inputs.length === 0 || outputs.length === 0) {
      alert(t("ui.config.recipe.needsIo"));
      return;
    }

    addRecipe({
      id: editingRecipe ?? undefined,
      name: recipeName.trim(),
      timeSeconds,
      inputs,
      outputs
    });

    // Reset form
    handleClearForm();
  };

  const handleClearForm = () => {
    setRecipeName("");
    setTimeSeconds(2);
    setInputs([]);
    setOutputs([]);
    setEditingRecipe(null);
  };

  const handleLoadRecipe = (recipe: Recipe) => {
    setRecipeName(recipe.name);
    setTimeSeconds(recipe.timeSeconds);
    setInputs([...recipe.inputs]);
    setOutputs([...recipe.outputs]);
    setEditingRecipe(recipe.id);
    setSelectedRecipe(recipe.id);
    // Scroll to top to see the form
    document.querySelector('.config-main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCopyRecipe = (recipe: Recipe) => {
    setRecipeName(recipe.name);
    setTimeSeconds(recipe.timeSeconds);
    setInputs([...recipe.inputs]);
    setOutputs([...recipe.outputs]);
    setEditingRecipe(null); // Don't set editing mode - this is a new recipe
    setSelectedRecipe(null);
    // Scroll to top to see the form
    document.querySelector('.config-main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteRecipe = (recipeId: string) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (confirm(t("ui.config.recipe.deleteConfirm", { name: recipe?.name ?? "" }))) {
      deleteRecipe(recipeId);
      // If the deleted recipe was being edited, clear the form
      if (editingRecipe === recipeId) {
        handleClearForm();
      }
    }
  };

  const handleStartRenameRecipe = (recipe: Recipe) => {
    setEditingRecipeId(recipe.id);
    setEditingRecipeName(recipe.name);
  };

  const handleFinishRenameRecipe = (recipeId: string) => {
    if (editingRecipeName.trim() && editingRecipeName !== recipes.find(r => r.id === recipeId)?.name) {
      renameRecipe(recipeId, editingRecipeName.trim());
    }
    setEditingRecipeId(null);
    setEditingRecipeName("");
  };

  const handleCancelRenameRecipe = () => {
    setEditingRecipeId(null);
    setEditingRecipeName("");
  };

  const handleDragStart = (e: DragEvent, itemOrTag: Item | Tag) => {
    setDraggedItem(itemOrTag);
    setDraggedIngredient(null); // Clear any ingredient drag state
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleSidebarDragEnd = () => {
    setDraggedItem(null);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDropOnInputs = (e: DragEvent) => {
    e.preventDefault();
    // Only add new inputs if dragging from sidebar (not reordering)
    if (draggedItem && !draggedIngredient) {
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
    // Only add new outputs if dragging from sidebar (not reordering)
    if (draggedItem && !draggedIngredient && !("memberItemIds" in draggedItem)) {
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

  // Ingredient drag-and-drop for reordering and swapping
  const handleIngredientDragStart = (e: DragEvent, type: 'input' | 'output', index: number) => {
    // Only allow dragging if starting from the drag handle or the item itself, not from inputs
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') {
      e.preventDefault();
      return;
    }
    e.stopPropagation(); // Prevent parent drag handlers from firing
    setDraggedIngredient({ type, index });
    setDraggedItem(null); // Clear any sidebar item drag state
    e.dataTransfer.effectAllowed = "move";
  };

  const handleIngredientDragEnd = () => {
    setDraggedIngredient(null);
  };

  const handleIngredientDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Set appropriate drop effect based on what's being dragged
    if (draggedIngredient) {
      e.dataTransfer.dropEffect = "move";
    } else if (draggedItem) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDropOnInput = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    // Case 1: Dragging an ingredient within the inputs list (reorder or swap)
    if (draggedIngredient && draggedIngredient.type === 'input') {
      const sourceIndex = draggedIngredient.index;
      if (sourceIndex !== targetIndex) {
        const newInputs = [...inputs];
        // Swap the two ingredients
        [newInputs[sourceIndex], newInputs[targetIndex]] = [newInputs[targetIndex], newInputs[sourceIndex]];
        setInputs(newInputs);
      }
      setDraggedIngredient(null);
    }
    // Case 2: Dragging a new item from sidebar to replace existing ingredient
    else if (draggedItem) {
      const oldInput = inputs[targetIndex];
      const newInputs = [...inputs];
      const isTag = "memberItemIds" in draggedItem;
      newInputs[targetIndex] = {
        ...newInputs[targetIndex],
        refType: isTag ? "tag" : "item",
        refId: draggedItem.id
      };
      setInputs(newInputs);
      
      // Auto-update recipe name if it contains the old ingredient name
      const oldName = getInputDisplay(oldInput);
      const newName = draggedItem.name;
      
      if (recipeName.includes(oldName)) {
        const updatedRecipeName = recipeName.replace(new RegExp(oldName, 'g'), newName);
        setRecipeName(updatedRecipeName);
      }
      
      setDraggedItem(null);
    }
  };

  const handleDropOnOutput = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    // Case 1: Dragging an ingredient within the outputs list (reorder or swap)
    if (draggedIngredient && draggedIngredient.type === 'output') {
      const sourceIndex = draggedIngredient.index;
      if (sourceIndex !== targetIndex) {
        const newOutputs = [...outputs];
        // Swap the two ingredients
        [newOutputs[sourceIndex], newOutputs[targetIndex]] = [newOutputs[targetIndex], newOutputs[sourceIndex]];
        setOutputs(newOutputs);
      }
      setDraggedIngredient(null);
    }
    // Case 2: Dragging a new item from sidebar to replace existing ingredient
    else if (draggedItem && !("memberItemIds" in draggedItem)) {
      const newOutputs = [...outputs];
      newOutputs[targetIndex] = {
        ...newOutputs[targetIndex],
        itemId: draggedItem.id
      };
      setOutputs(newOutputs);
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
    return items.filter((item) => {
      // Search by name
      if (item.name.toLowerCase().includes(term)) return true;
      
      // Search by category
      if (item.categoryId) {
        const category = categories.find(c => c.id === item.categoryId);
        if (category && category.name.toLowerCase().includes(term)) return true;
      }
      
      // Search by tags
      const itemTags = tags.filter(tag => tag.memberItemIds.includes(item.id));
      if (itemTags.some(tag => tag.name.toLowerCase().includes(term))) return true;
      
      return false;
    });
  }, [items, searchTerm, categories, tags]);

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

  const getItemTags = (itemId: string) => {
    return tags.filter(tag => tag.memberItemIds.includes(itemId));
  };

  const getItemCategory = (item: any) => {
    if (!item.categoryId) return null;
    return categories.find(c => c.id === item.categoryId);
  };

  const filteredRecipes = useMemo(() => {
    if (!recipeSearchTerm) return recipes;
    const term = recipeSearchTerm.toLowerCase();
    return recipes.filter((recipe) => {
      // Search by recipe name
      if (recipe.name.toLowerCase().includes(term)) return true;
      
      // Search by input names
      const inputNames = recipe.inputs.map((inp) => getInputDisplay(inp).toLowerCase());
      if (inputNames.some(name => name.includes(term))) return true;
      
      // Search by output names
      const outputNames = recipe.outputs.map((out) => getOutputDisplay(out).toLowerCase());
      if (outputNames.some(name => name.includes(term))) return true;
      
      return false;
    });
  }, [recipes, recipeSearchTerm, items, tags]);

  return (
    <div className="config-mode-content recipe-mode">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>{t("ui.config.recipe.itemsAndTags")}</h3>
          <input
            type="text"
            placeholder={t("ui.config.recipe.search")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="config-input"
          />
          
          <div className="items-and-tags-browser">
            <div className="browser-section">
              <h4>{t("ui.config.recipe.inputTags")}</h4>
              <div className="browser-list">
                {filteredTags.map((tag) => (
                  <div
                    key={tag.id}
                    className="draggable-item tag-item"
                    draggable
                    onDragStart={(e) => handleDragStart(e, tag)}
                    onDragEnd={handleSidebarDragEnd}
                  >
                    <span className="tag-badge">{tag.name}</span>
                    <span className="item-count-mini">{tag.memberItemIds.length}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="browser-section">
              <h4>{t("ui.config.items")}</h4>
              <div className="browser-list">
                {filteredItems.map((item) => {
                  const itemTags = getItemTags(item.id);
                  const category = getItemCategory(item);
                  return (
                    <div
                      key={item.id}
                      className="draggable-item"
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDragEnd={handleSidebarDragEnd}
                    >
                      <div className="draggable-item-content">
                        <div className="item-name">{item.name}</div>
                        <div className="item-badges">
                          {category && (
                            <span className="category-badge-mini">{category.name}</span>
                          )}
                          {itemTags.map(tag => (
                            <span key={tag.id} className="tag-badge-mini">{tag.name}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="config-section">
          <h3>{t("ui.config.statistics")}</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">{recipes.length}</div>
              <div className="stat-label">{t("ui.config.recipes")}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="config-main">
        <div className="recipe-builder">
          <div className="builder-header">
            <h3>{t("ui.config.recipe.builder")}</h3>
          </div>
          
          <div className="recipe-form">
            {editingRecipe && (
              <div className="editing-notice">
                <span>✏️ {t("ui.config.recipe.editing")}</span>
                <button onClick={handleClearForm} className="btn-secondary btn-sm">
                  Clear Form
                </button>
              </div>
            )}
            <div className="form-row">
              <label>{t("ui.config.recipe.name")}</label>
              <input
                type="text"
                placeholder={t("ui.config.recipe.nameExample")}
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                className="config-input"
              />
            </div>
            
            <div className="form-row">
              <label>{t("ui.config.recipe.time")}</label>
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
                <h4>{t("ui.config.recipe.inputs")}</h4>
                <div className="io-list">
                  {inputs.map((input, index) => (
                    <div 
                      key={input.id} 
                      className="io-item"
                      draggable
                      onDragStart={(e) => handleIngredientDragStart(e, 'input', index)}
                      onDragEnd={handleIngredientDragEnd}
                      onDragOver={handleIngredientDragOver}
                      onDrop={(e) => handleDropOnInput(e, index)}
                    >
                      <span className="io-drag-handle" onMouseDown={(e) => e.stopPropagation()}>⋮⋮</span>
                      <span className="io-name">{getInputDisplay(input)}</span>
                      <input
                        type="number"
                        min="1"
                        value={input.amount}
                        onChange={(e) => updateInputAmount(input.id, parseInt(e.target.value))}
                        className="amount-input"
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                      <button 
                        onClick={() => handleRemoveInput(input.id)} 
                        className="btn-remove"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {inputs.length === 0 && (
                    <div className="io-empty">{t("ui.config.recipe.drop")}</div>
                  )}
                </div>
              </div>

              <div
                className="io-panel outputs-panel"
                onDragOver={handleDragOver}
                onDrop={handleDropOnOutputs}
              >
                <h4>{t("ui.config.recipe.outputs")}</h4>
                <div className="io-list">
                  {outputs.map((output, index) => (
                    <div 
                      key={output.id} 
                      className="io-item"
                      draggable
                      onDragStart={(e) => handleIngredientDragStart(e, 'output', index)}
                      onDragEnd={handleIngredientDragEnd}
                      onDragOver={handleIngredientDragOver}
                      onDrop={(e) => handleDropOnOutput(e, index)}
                    >
                      <span className="io-drag-handle" onMouseDown={(e) => e.stopPropagation()}>⋮⋮</span>
                      <span className="io-name">{getOutputDisplay(output)}</span>
                      <input
                        type="number"
                        min="1"
                        value={output.amount}
                        onChange={(e) => updateOutputAmount(output.id, parseInt(e.target.value))}
                        className="amount-input"
                        placeholder={t("ui.config.recipe.amount")}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={output.probability}
                        onChange={(e) => updateOutputProbability(output.id, parseFloat(e.target.value))}
                        className="amount-input"
                        placeholder={t("ui.config.recipe.probability")}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                      <button 
                        onClick={() => handleRemoveOutput(output.id)} 
                        className="btn-remove"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {outputs.length === 0 && (
                    <div className="io-empty">{t("ui.config.recipe.drop")}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button onClick={handleAddRecipe} className="btn-primary btn-large">
                {editingRecipe ? t("common.actions.save") : t("common.actions.create")}
              </button>
              {editingRecipe && (
                <button onClick={handleClearForm} className="btn-secondary btn-large">
                  {t("common.actions.cancel")}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="recipes-list-panel">
          <div className="recipes-list-header">
            <h3>{t("ui.config.recipe.existing")}</h3>
            <input
              type="text"
              placeholder={t("ui.config.recipe.searchRecipes")}
              value={recipeSearchTerm}
              onChange={(e) => setRecipeSearchTerm(e.target.value)}
              className="config-input recipe-search"
            />
          </div>
          <div className="recipes-list">
            {filteredRecipes.length === 0 && recipeSearchTerm && (
              <div className="no-results">No recipes found for "{recipeSearchTerm}"</div>
            )}
            {filteredRecipes.map((recipe) => {
              const info = getRecipeInfo(recipe);
              return (
                <div
                  key={recipe.id}
                  className={`recipe-card ${selectedRecipe === recipe.id ? "selected" : ""} ${editingRecipe === recipe.id ? "editing" : ""}`}
                  onClick={() => handleLoadRecipe(recipe)}
                  title={t("ui.config.recipe.editHint")}
                  style={{ cursor: "pointer" }}
                >
                  <div className="recipe-card-header">
                    {editingRecipeId === recipe.id ? (
                      <div className="recipe-edit-mode">
                        <input
                          type="text"
                          value={editingRecipeName}
                          onChange={(e) => setEditingRecipeName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleFinishRenameRecipe(recipe.id);
                            if (e.key === "Escape") handleCancelRenameRecipe();
                          }}
                          onBlur={() => handleFinishRenameRecipe(recipe.id)}
                          autoFocus
                          className="recipe-rename-input"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <>
                        <h4>{recipe.name}</h4>
                        <div className="recipe-actions">
                          <span className="recipe-time">{recipe.timeSeconds}s</span>
                          <button
                            className="btn-icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyRecipe(recipe);
                            }}
                            title={t("ui.config.recipe.copy")}
                          >
                            📋
                          </button>
                          <button
                            className="btn-icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartRenameRecipe(recipe);
                            }}
                            title={t("ui.config.recipe.rename")}
                          >
                            ✏️
                          </button>
                          <button
                            className="btn-icon-sm btn-icon-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRecipe(recipe.id);
                            }}
                            title={t("ui.config.recipe.delete")}
                          >
                            🗑️
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="recipe-card-io">
                    <div className="recipe-io-line">
                      <span className="io-label">{t("ui.config.recipe.in")}</span>
                      <span className="io-value">{info.inputsDisplay}</span>
                    </div>
                    <div className="recipe-io-line">
                      <span className="io-label">{t("ui.config.recipe.out")}</span>
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
