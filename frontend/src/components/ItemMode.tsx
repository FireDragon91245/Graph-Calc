import { useState, DragEvent } from "react";
import { useGraphStore, Category, Item, Medium } from "../store/graphStore";

export default function ItemMode() {
  const categories = useGraphStore((state) => state.categories);
  const items = useGraphStore((state) => state.items);
  const addCategory = useGraphStore((state) => state.addCategory);
  const addItem = useGraphStore((state) => state.addItem);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemMedium, setNewItemMedium] = useState<Medium>("item");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<Item | null>(null);

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    addCategory(newCategoryName.trim());
    setNewCategoryName("");
  };

  const handleAddItem = (categoryId?: string) => {
    if (!newItemName.trim()) return;
    addItem({
      name: newItemName.trim(),
      medium: newItemMedium,
      categoryId: categoryId || selectedCategory || undefined
    });
    setNewItemName("");
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
          <select
            value={newItemMedium}
            onChange={(e) => setNewItemMedium(e.target.value as Medium)}
            className="config-select"
          >
            <option value="item">Item</option>
            <option value="fluid">Fluid</option>
            <option value="gas">Gas</option>
          </select>
          <button onClick={() => handleAddItem()} className="btn-primary">
            Add Item
          </button>
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                >
                  <span className="item-name">{item.name}</span>
                  <span className={`medium-badge medium-${item.medium}`}>
                    {item.medium}
                  </span>
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
                <h4>{category.name}</h4>
                <span className="item-count">{getCategoryItems(category.id).length}</span>
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
                    <span className={`medium-badge medium-${item.medium}`}>
                      {item.medium}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="btn-add-to-category"
                onClick={() => handleAddItem(category.id)}
              >
                + Add to {category.name}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
