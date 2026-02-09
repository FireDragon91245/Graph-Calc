# GraphCalc UI Update - Complete Overhaul

## Overview
This update completely transforms the GraphCalc UI with a multi-mode system designed for rapid configuration and editing.

---

## 🎨 Major Changes

### 1. **Mode System**
The application now has two primary modes accessible via a top bar selector:

#### **Edit Mode** (Node Editor)
- **Simplified Sidebar**: Shows only 4 node types (Input, Output, Recipe, Requester)
  - No more cluttered lists of specific items/recipes
  - Clean, icon-based cards with descriptions
  - Drag & drop from sidebar to canvas
  - Click to add at next position

- **Smart Node Creation Dialog**:
  - Opens automatically when you drop/click a node type
  - Auto-focused search bar with keyboard navigation (↑↓ arrows)
  - Filter items/recipes in real-time as you type
  - Enter to confirm, Escape to cancel
  - Double-click items for instant add
  - Context-aware: shows items for Input/Output, recipes for Recipe nodes

- **Enhanced Canvas**:
  - Same familiar ReactFlow interface
  - Right-click context menu preserved
  - Solver integration intact
  - Live statistics panel

#### **Config Mode** (Data Management)
Three specialized sub-modes for rapid bulk configuration:

##### **Items Sub-Mode**
- **Visual Category Grid**: Cards for each category + uncategorized section
- **Drag & Drop Categorization**: Drag items between categories
- **Quick Add**: Sidebar form to rapidly create items
- **Statistics Dashboard**: See total items and categories at a glance
- **Medium Badges**: Visual tags for item/fluid/gas types

##### **Tags Sub-Mode**
- **Tag Panels**: Visual cards for each tag showing member count
- **Item Browser**: Searchable list of all items with their tags
- **Drag & Drop Assignment**: Drag items from sidebar onto tag panels
- **Quick Tag Creation**: Create tags with @ prefix automatically
- **Multi-tag Display**: See all tags an item belongs to

##### **Recipe Sub-Mode**
- **Split-Screen Layout**:
  - Left: Item/Tag browser with search
  - Center: Recipe builder with drag & drop
  - Right: List of existing recipes

- **Visual Recipe Builder**:
  - Name and time inputs
  - Dual drop zones: Inputs (accepts items/tags) & Outputs (items only)
  - Inline editing: amounts and probabilities
  - Visual feedback for drops
  - Remove items with X buttons

- **Existing Recipes List**: Review all recipes with I/O summary

---

## 🎯 Key Features

### Drag & Drop Everywhere
- Node types → Canvas (Edit mode)
- Items → Categories (Item mode)
- Items → Tags (Tag mode)
- Items/Tags → Recipe inputs/outputs (Recipe mode)

### Keyboard Shortcuts
- **Ctrl+K**: Global search (Edit mode)
- **↑↓**: Navigate dialogs
- **Enter**: Confirm selection
- **Escape**: Cancel/close dialogs
- **Backspace/Delete**: Remove nodes

### Visual Feedback
- Hover effects on all interactive elements
- Color-coded medium badges (item/fluid/gas)
- Selected state highlighting
- Drag hints and empty state messages
- Statistics panels everywhere

---

## 📁 New Files Created

### Components
- `components/ModeSelector.tsx` - Top bar mode switching
- `components/NodeTypeSelector.tsx` - Simplified sidebar for Edit mode
- `components/NodeConfigDialog.tsx` - Smart popup for node configuration
- `components/ItemMode.tsx` - Item & category management
- `components/TagMode.tsx` - Tag management with drag & drop
- `components/RecipeMode.tsx` - Recipe builder interface

### Styles
- `styles/modes.css` - Comprehensive styling for all new components

---

## 🔧 Technical Details

### State Management
- Uses existing Zustand store (`graphStore`)
- New local state for mode management
- Pending node creation flow for dialogs

### Type Safety
- Full TypeScript support
- Proper type exports for all modes
- ReactFlow integration maintained

### Performance
- Memoized filtered lists
- Efficient re-renders
- Smooth animations with CSS transitions

---

## 🚀 Usage Guide

### Creating Nodes (Edit Mode)
1. Click a node type in sidebar OR drag it to canvas
2. Dialog opens with search bar auto-focused
3. Type to filter, use arrows to navigate
4. Press Enter or click to add node

### Creating Items (Config Mode → Items)
1. Enter item name and select medium
2. Click "Add Item" or press Enter
3. Drag items between categories to organize
4. Click "+ Add to [Category]" for quick category assignment

### Creating Tags (Config Mode → Tags)
1. Type tag name (@ auto-added)
2. Click "Create Tag"
3. Drag items from sidebar onto tag panels
4. Remove items with X button

### Creating Recipes (Config Mode → Recipes)
1. Enter recipe name and time
2. Drag items/tags into "Inputs" zone
3. Drag items into "Outputs" zone
4. Set amounts and probabilities
5. Click "Create Recipe"

---

## 🎨 Design Philosophy

- **Glassmorphism**: Translucent panels with backdrop blur
- **Dark Theme**: High contrast for readability
- **Color Coding**: 
  - Purple for tags/recipes
  - Green for items
  - Blue for fluids
  - Orange for time/gas
  - Indigo for primary actions

- **Smooth Transitions**: 200ms ease on all interactions
- **Clear Hierarchy**: Visual weight guides attention
- **Generous Spacing**: Comfortable touch targets

---

## 🔮 Future Enhancements

Potential additions to consider:
- Bulk import/export for items and recipes
- Template recipes
- Advanced tag logic (AND/OR operations)
- Recipe validation warnings
- Undo/redo for config mode
- Preset item packs
- Recipe dependencies visualization
- Global search across all modes

---

## 📝 Migration Notes

- Old `LibraryPanel.tsx` is no longer used in main App
- All existing functionality preserved
- Data structures unchanged (fully backward compatible)
- Can switch between modes without losing work

---

**Developer**: Built with React, TypeScript, ReactFlow, and Zustand
**Date**: February 9, 2026
