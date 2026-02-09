import { useState, useRef, useEffect } from "react";
import { useGraphStore } from "../store/graphStore";

type Option = {
  value: string;
  label: string;
};

type SearchableDropdownProps = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export default function SearchableDropdown({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = ""
}: SearchableDropdownProps) {
  const items = useGraphStore((state) => state.items);
  const categories = useGraphStore((state) => state.categories);
  const tags = useGraphStore((state) => state.tags);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = options.find((opt) => opt.value === value);

  const getItemMetadata = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return null;
    
    const category = item.categoryId ? categories.find(c => c.id === item.categoryId) : null;
    const itemTags = tags.filter(tag => tag.memberItemIds.includes(itemId));
    
    return { category, tags: itemTags };
  };

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(0);
    }
  }, [search, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          onChange(filteredOptions[highlightedIndex].value);
          setIsOpen(false);
          setSearch("");
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearch("");
        break;
    }
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (listRef.current && isOpen) {
      const highlighted = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  return (
    <div className={`searchable-dropdown nodrag ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className="dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
      >
        <span className="dropdown-label">{selectedOption?.label || placeholder}</span>
        <span className="dropdown-arrow">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="dropdown-menu">
          <div className="dropdown-search-wrapper">
            <input
              ref={searchRef}
              type="text"
              className="dropdown-search"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="dropdown-list" ref={listRef}>
            {filteredOptions.length === 0 ? (
              <div className="dropdown-empty">No results</div>
            ) : (
              filteredOptions.map((option, index) => {
                const metadata = getItemMetadata(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`dropdown-item ${
                      index === highlightedIndex ? "highlighted" : ""
                    } ${option.value === value ? "selected" : ""}`}
                    onClick={() => handleSelect(option.value)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <div className="dropdown-item-content">
                      <div className="dropdown-item-label">{option.label}</div>
                      {metadata && (metadata.category || metadata.tags.length > 0) && (
                        <div className="dropdown-item-badges">
                          {metadata.category && (
                            <span className="category-badge-mini">{metadata.category.name}</span>
                          )}
                          {metadata.tags.map((tag: any) => (
                            <span key={tag.id} className="tag-badge-mini">{tag.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
