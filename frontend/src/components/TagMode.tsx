import { useState, DragEvent, useMemo } from "react";
import { useGraphStore, Tag, Item } from "../store/graphStore";

export default function TagMode() {
  const tags = useGraphStore((state) => state.tags);
  const items = useGraphStore((state) => state.items);
  const categories = useGraphStore((state) => state.categories);
  const addTag = useGraphStore((state) => state.addTag);

  const [newTagName, setNewTagName] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    const formatted = newTagName.startsWith("@") ? newTagName : `@${newTagName}`;
    addTag({ name: formatted, memberItemIds: [] });
    setNewTagName("");
  };

  const handleDragStart = (e: DragEvent, item: Item) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDropOnTag = (e: DragEvent, tagId: string) => {
    e.preventDefault();
    if (draggedItem) {
      const tag = tags.find((t) => t.id === tagId);
      if (tag && !tag.memberItemIds.includes(draggedItem.id)) {
        addTag({
          ...tag,
          memberItemIds: [...tag.memberItemIds, draggedItem.id]
        });
      }
      setDraggedItem(null);
    }
  };

  const handleRemoveFromTag = (tagId: string, itemId: string) => {
    const tag = tags.find((t) => t.id === tagId);
    if (tag) {
      addTag({
        ...tag,
        memberItemIds: tag.memberItemIds.filter((id) => id !== itemId)
      });
    }
  };

  const getTagItems = (tag: Tag) => {
    return items.filter((item) => tag.memberItemIds.includes(item.id));
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
      const itemTags = getItemTags(item.id);
      if (itemTags.some(tag => tag.name.toLowerCase().includes(term))) return true;
      
      return false;
    });
  }, [items, searchTerm, categories, tags]);

  const getItemTags = (itemId: string) => {
    return tags.filter((tag) => tag.memberItemIds.includes(itemId));
  };

  const getItemCategory = (item: Item) => {
    if (!item.categoryId) return null;
    return categories.find(c => c.id === item.categoryId);
  };

  return (
    <div className="config-mode-content">
      <div className="config-sidebar">
        <div className="config-section">
          <h3>Add Tag</h3>
          <input
            type="text"
            placeholder="@tag_name"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
            className="config-input"
          />
          <button onClick={handleAddTag} className="btn-primary">
            Create Tag
          </button>
        </div>

        <div className="config-section">
          <h3>Item Browser</h3>
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="config-input"
          />
          <div className="items-browser">
            {filteredItems.map((item) => {
              const itemTags = getItemTags(item.id);
              const category = getItemCategory(item);
              return (
                <div
                  key={item.id}
                  className="item-card draggable"
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                >
                  <span className="item-name">{item.name}</span>
                  <div className="item-badges">
                    {category && (
                      <span className="category-badge-mini">{category.name}</span>
                    )}
                    {itemTags.map((tag) => (
                      <span key={tag.id} className="tag-badge-mini">
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="config-section">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-value">{tags.length}</div>
              <div className="stat-label">Total Tags</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{items.length}</div>
              <div className="stat-label">Items</div>
            </div>
          </div>
        </div>
      </div>

      <div className="config-main">
        <div className="tag-hint">
          💡 Drag items from the sidebar and drop them onto tags to add members
        </div>
        
        <div className="tags-grid">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className={`tag-panel ${selectedTag === tag.id ? "selected" : ""}`}
              onClick={() => setSelectedTag(tag.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnTag(e, tag.id)}
            >
              <div className="tag-header">
                <h4 className="tag-name">{tag.name}</h4>
                <span className="item-count">{tag.memberItemIds.length} items</span>
              </div>
              
              <div className="tag-members">
                {getTagItems(tag).map((item) => (
                  <div key={item.id} className="tag-member-card">
                    <span className="member-name">{item.name}</span>
                    <button
                      className="btn-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromTag(tag.id, item.id);
                      }}
                      title="Remove from tag"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {tag.memberItemIds.length === 0 && (
                  <div className="tag-empty">Drop items here</div>
                )}
              </div>
            </div>
          ))}

          {tags.length === 0 && (
            <div className="empty-state">
              <p>No tags yet. Create one to get started!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
