import { useState, DragEvent, useMemo } from "react";
import { useGraphStore, RecipeTag, Recipe } from "../store/graphStore";

export default function RecipeTagMode() {
  const recipeTags = useGraphStore((state) => state.recipeTags);
  const recipes = useGraphStore((state) => state.recipes);
  const addRecipeTag = useGraphStore((state) => state.addRecipeTag);

  const [newRecipeTagName, setNewRecipeTagName] = useState("");
  const [selectedRecipeTag, setSelectedRecipeTag] = useState<string | null>(null);
  const [draggedRecipe, setDraggedRecipe] = useState<Recipe | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const handleAddRecipeTag = () => {
    if (!newRecipeTagName.trim()) return;
    const formatted = newRecipeTagName.startsWith("@") ? newRecipeTagName : `@${newRecipeTagName}`;
    addRecipeTag({ name: formatted, memberRecipeIds: [] });
    setNewRecipeTagName("");
  };

  const handleDragStart = (e: DragEvent, recipe: Recipe) => {
    setDraggedRecipe(recipe);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDropOnRecipeTag = (e: DragEvent, recipeTagId: string) => {
    e.preventDefault();
    if (draggedRecipe) {
      const recipeTag = recipeTags.find((rt) => rt.id === recipeTagId);
      if (recipeTag && !recipeTag.memberRecipeIds.includes(draggedRecipe.id)) {
        addRecipeTag({
          ...recipeTag,
          memberRecipeIds: [...recipeTag.memberRecipeIds, draggedRecipe.id]
        });
      }
      setDraggedRecipe(null);
    }
  };

  const handleRemoveFromRecipeTag = (recipeTagId: string, recipeId: string) => {
    const recipeTag = recipeTags.find((rt) => rt.id === recipeTagId);
    if (recipeTag) {
      addRecipeTag({
        ...recipeTag,
        memberRecipeIds: recipeTag.memberRecipeIds.filter((id) => id !== recipeId)
      });
    }
  };

  const getRecipeTagRecipes = (recipeTag: RecipeTag) => {
    return recipes.filter((recipe) => recipeTag.memberRecipeIds.includes(recipe.id));
  };

  const filteredRecipes = useMemo(() => {
    if (!searchTerm) return recipes;
    const term = searchTerm.toLowerCase();
    return recipes.filter((recipe) => recipe.name.toLowerCase().includes(term));
  }, [recipes, searchTerm]);

  const getRecipeTags = (recipeId: string) => {
    return recipeTags.filter((rt) => rt.memberRecipeIds.includes(recipeId));
  };

  return (
    <div className="config-mode-content">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>Add Recipe Tag</h3>
          <p className="help-text">
            Recipe tags group multiple recipes that can be used polymorphically
          </p>
          <input
            type="text"
            placeholder="@recipe_tag_name"
            value={newRecipeTagName}
            onChange={(e) => setNewRecipeTagName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRecipeTag()}
            className="config-input"
          />
          <button onClick={handleAddRecipeTag} className="btn-primary">
            Create Recipe Tag
          </button>
        </div>

        <div className="config-section">
          <h3>Recipe Browser</h3>
          <input
            type="text"
            placeholder="Search recipes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="config-input"
          />
          <div className="items-browser">
            {filteredRecipes.map((recipe) => (
              <div
                key={recipe.id}
                className="item-card draggable"
                draggable
                onDragStart={(e) => handleDragStart(e, recipe)}
              >
                <div className="recipe-browser-item">
                  <span className="item-name">{recipe.name}</span>
                  <span className="recipe-time-badge">{recipe.timeSeconds}s</span>
                </div>
                <div className="item-tags">
                  {getRecipeTags(recipe.id).map((rt) => (
                    <span key={rt.id} className="tag-badge-mini">
                      {rt.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="config-section">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">{recipeTags.length}</div>
              <div className="stat-label">Recipe Tags</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{recipes.length}</div>
              <div className="stat-label">Recipes</div>
            </div>
          </div>
        </div>
      </div>

      <div className="config-main">
        <div className="tag-hint">
          💡 Drag recipes from the sidebar and drop them onto recipe tags to group them
        </div>
        
        <div className="tags-grid">
          {recipeTags.map((recipeTag) => (
            <div
              key={recipeTag.id}
              className={`tag-panel ${selectedRecipeTag === recipeTag.id ? "selected" : ""}`}
              onClick={() => setSelectedRecipeTag(recipeTag.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnRecipeTag(e, recipeTag.id)}
            >
              <div className="tag-header">
                <h4 className="tag-name">{recipeTag.name}</h4>
                <span className="item-count">{recipeTag.memberRecipeIds.length} recipes</span>
              </div>
              
              <div className="tag-members">
                {getRecipeTagRecipes(recipeTag).map((recipe) => (
                  <div key={recipe.id} className="tag-member-card">
                    <div className="member-info">
                      <span className="member-name">{recipe.name}</span>
                      <span className="recipe-time-badge-small">{recipe.timeSeconds}s</span>
                    </div>
                    <button
                      className="btn-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromRecipeTag(recipeTag.id, recipe.id);
                      }}
                      title="Remove from recipe tag"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {recipeTag.memberRecipeIds.length === 0 && (
                  <div className="tag-empty">Drop recipes here</div>
                )}
              </div>
            </div>
          ))}

          {recipeTags.length === 0 && (
            <div className="empty-state">
              <p>No recipe tags yet. Create one to get started!</p>
              <p className="help-text">
                Example: Create @smelt to group all smelting recipes together
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
