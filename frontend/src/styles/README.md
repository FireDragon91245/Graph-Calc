# Styles Directory

This directory contains modular CSS files for the Graph Calculator application.

## File Structure

### `base.css`
- CSS custom properties (variables)
- Global resets and box-sizing
- Body and root element styles
- Base color scheme and theme variables

### `layout.css`
- Application layout structure (grid, canvas)
- Top bar navigation
- Sidebar panel
- Section and subsection containers

### `forms.css`
- Form controls (inputs, selects, buttons)
- Form layouts (form-row, form-grid)
- List components and list rows
- Icon buttons and mode buttons
- Specialized inputs (limit-input, mode-btn)

### `nodes.css`
- Base node styling
- Node headers and bodies
- IO nodes (Input, Output, Requester)
- Recipe node ports and handles
- Panel components for solver results
- Add buttons for dynamic lists

### `dropdown.css`
- Searchable dropdown component
- Dropdown trigger button
- Dropdown menu and search input
- Dropdown list items and states
- Recipe-specific dropdown styling

### `context-menu.css`
- Context menu container
- Context menu items and hover states

### `reactflow.css`
- React Flow library overrides
- Minimap styling
- Node selection states
- Handle positioning adjustments

### `utilities.css`
- Utility classes (muted, unit, empty-state)
- Helper classes for common patterns

## Usage

All modular files are imported via the main `styles.css` file in the parent directory:

```css
@import './styles/base.css';
@import './styles/layout.css';
/* ... etc */
```

## Adding New Styles

When adding new styles:
1. Determine which module the styles belong to
2. Add styles to the appropriate modular file
3. If creating a new component category, create a new module file
4. Update this README with the new module information
5. Import the new module in the main `styles.css` file

## Benefits of Modular Structure

- **Maintainability**: Easier to locate and update specific component styles
- **Organization**: Logical grouping of related styles
- **Scalability**: Simple to add new modules as the app grows
- **Reusability**: Components are clearly defined and documented
- **Collaboration**: Multiple developers can work on different modules
