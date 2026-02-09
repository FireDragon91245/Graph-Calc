import { useState, DragEvent } from "react";
import { useGraphStore, Category, Item } from "../store/graphStore";

export default function ItemMode() {
  const categories = useGraphStore((state) => state.categories);
  const items = useGraphStore((state) => state.items);
  const addCategory = useGraphStore((state) => state.addCategory);
  const deleteCategory = useGraphStore((state) => state.deleteCategory);
  const renameCategory = useGraphStore((state) => state.renameCategory);
  const addItem = useGraphStore((state) => state.addItem);
  const deleteItem = useGraphStore((state) => state.deleteItem);
  const renameItem = useGraphStore((state) => state.renameItem);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [draggedItem, setDraggedItem] = useState<Item | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState("");

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    addCategory(newCategoryName.trim());
    setNewCategoryName("");
  };

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    // Always add to uncategorized by default
    addItem({
      name: newItemName.trim()
    });
    setNewItemName("");
  };

  const handleDeleteCategory = (categoryId: string) => {
    if (confirm("Delete this category? All items will move to Uncategorized.")) {
      deleteCategory(categoryId);
    }
  };

  const handleStartRename = (category: Category) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  };

  const handleFinishRename = (categoryId: string) => {
    if (editingCategoryName.trim() && editingCategoryName !== categories.find(c => c.id === categoryId)?.name) {
      renameCategory(categoryId, editingCategoryName.trim());
    }
    setEditingCategoryId(null);
    setEditingCategoryName("");
  };

  const handleCancelRename = () => {
    setEditingCategoryId(null);
    setEditingCategoryName("");
  };

  const handleDeleteItem = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (confirm(`Delete "${item?.name}"? This will remove it from all tags and recipes.`)) {
      deleteItem(itemId);
    }
  };

  const handleStartRenameItem = (item: Item) => {
    setEditingItemId(item.id);
    setEditingItemName(item.name);
  };

  const handleFinishRenameItem = (itemId: string) => {
    if (editingItemName.trim() && editingItemName !== items.find(i => i.id === itemId)?.name) {
      renameItem(itemId, editingItemName.trim());
    }
    setEditingItemId(null);
    setEditingItemName("");
  };

  const handleCancelRenameItem = () => {
    setEditingItemId(null);
    setEditingItemName("");
  };

  const handleDragStart = (e: DragEvent, item: Item) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropOnCategory = (e: DragEvent, categoryId: string) => {
    e.preventDefault();
    if (draggedItem) {
      // Update item's category
      addItem({ ...draggedItem, categoryId });
      setDraggedItem(null);
    }
  };

  const handleDropOnUncategorized = (e: DragEvent) => {
    e.preventDefault();
    if (draggedItem) {
      // Remove category from item
      const { categoryId, ...itemWithoutCategory } = draggedItem;
      addItem(itemWithoutCategory);
      setDraggedItem(null);
    }
  };

  const getCategoryItems = (categoryId: string) => {
    return items.filter((item) => item.categoryId === categoryId);
  };

  const getUncategorizedItems = () => {
    return items.filter((item) => !item.categoryId);
  };

  return (
    <div className="config-mode-content">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>Quick Add Item</h3>
          <input
            type="text"
            placeholder="Item name..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
            className="config-input"
          />
          <button onClick={() => handleAddItem()} className="btn-primary">
            Add Item
          </button>
          <p className="help-text">
            Items are added to Uncategorized. Drag them to categories to organize.
          </p>
        </div>

        <div className="config-section">
          <h3>Add Category</h3>
          <input
            type="text"
            placeholder="Category name..."
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
            className="config-input"
          />
          <button onClick={handleAddCategory} className="btn-primary">
            Add Category
          </button>
        </div>

        <div className="config-section">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">{items.length}</div>
              <div className="stat-label">Total Items</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{categories.length}</div>
              <div className="stat-label">Categories</div>
            </div>
          </div>
        </div>
      </div>

      <div className="config-main">
        <div className="categories-grid">
          {/* Uncategorized section */}
          <div
            className="category-panel uncategorized"
            onDragOver={handleDragOver}
            onDrop={handleDropOnUncategorized}
          >
            <div className="category-header">
              <h4>Uncategorized</h4>
              <span className="item-count">{getUncategorizedItems().length}</span>
            </div>
            <div className="items-list">
              {getUncategorizedItems().map((item) => (
                <div
                  key={item.id}
                  className="item-card"
                  draggable={editingItemId !== item.id}
                  onDragStart={(e) => handleDragStart(e, item)}
                >
                  {editingItemId === item.id ? (
                    <div className="item-edit-mode">
                      <input
                        type="text"
                        value={editingItemName}
                        onChange={(e) => setEditingItemName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishRenameItem(item.id);
                          if (e.key === "Escape") handleCancelRenameItem();
                        }}
                        onBlur={() => handleFinishRenameItem(item.id)}
                        autoFocus
                        className="item-rename-input"
                      />
                    </div>
                  ) : (
                    <>
                      <span className="item-name">{item.name}</span>
                      <div className="item-actions">
                        <button
                          className="btn-icon-sm"
                          onClick={() => handleStartRenameItem(item)}
                          title="Rename item"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-icon-sm btn-icon-danger"
                          onClick={() => handleDeleteItem(item.id)}
                          title="Delete item"
                        >
                          🗑️
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Category sections */}
          {categories.map((category) => (
            <div
              key={category.id}
              className="category-panel"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnCategory(e, category.id)}
            >
              <div className="category-header">
                {editingCategoryId === category.id ? (
                  <div className="category-edit-mode">
                    <input
                      type="text"
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleFinishRename(category.id);
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      onBlur={() => handleFinishRename(category.id)}
                      autoFocus
                      className="category-rename-input"
                    />
                  </div>
                ) : (
                  <>
                    <h4>{category.name}</h4>
                    <div className="category-actions">
                      <span className="item-count">{getCategoryItems(category.id).length}</span>
                      <button
                        className="btn-icon"
                        onClick={() => handleStartRename(category)}
                        title="Rename category"
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-icon btn-icon-danger"
                        onClick={() => handleDeleteCategory(category.id)}
                        title="Delete category"
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="items-list">
                {getCategoryItems(category.id).map((item) => (
                  <div
                    key={item.id}
                    className="item-card"
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                  >
                    <span className="item-name">{item.name}</span>
                    <span className="category-badge">
                      {category.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
