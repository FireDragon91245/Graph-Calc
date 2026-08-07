import { useEffect, useMemo, useRef, useState } from "react";

export type CommandAction = {
  id: string;
  label: string;
  description: string;
  group: string;
  icon: string;
  keywords?: string[];
  disabled?: boolean;
  disabledReason?: string;
  children?: CommandAction[];
};

type CommandPaletteProps = {
  isOpen: boolean;
  actions: CommandAction[];
  onClose: () => void;
  onActionSelected: (action: CommandAction) => void | Promise<void>;
};

const flattenActions = (actions: CommandAction[]): CommandAction[] =>
  actions.flatMap((action) => [action, ...(action.children ? flattenActions(action.children) : [])]);

export default function CommandPalette({
  isOpen,
  actions,
  onClose,
  onActionSelected
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [path, setPath] = useState<CommandAction[]>([]);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const currentParent = path[path.length - 1];
  const currentActions = currentParent?.children ?? actions;
  const filteredActions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return currentActions;

    return flattenActions(actions).filter((action) => {
      const searchable = [
        action.label,
        action.description,
        action.group,
        ...(action.keywords ?? [])
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [actions, currentActions, search]);

  useEffect(() => {
    if (!isOpen) return;
    setSearch("");
    setHighlightedIndex(0);
    setPath([]);
    setBusyActionId(null);
    setError(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredActions.length, path.length, search]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-action-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const goBack = () => {
    if (busyActionId) return;
    setPath((current) => current.slice(0, -1));
    setError(null);
    setHighlightedIndex(0);
    inputRef.current?.focus();
  };

  const selectAction = async (action: CommandAction) => {
    if (action.disabled || busyActionId) return;

    if (action.children?.length) {
      setPath((current) => [...current, action]);
      setSearch("");
      setError(null);
      return;
    }

    setBusyActionId(action.id);
    setError(null);
    try {
      await onActionSelected(action);
      onClose();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The action could not be completed.");
      setBusyActionId(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (path.length > 0 && !search) goBack();
        else onClose();
      } else if (event.key === "Backspace" && !search && path.length > 0) {
        event.preventDefault();
        goBack();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((current) => Math.min(current + 1, Math.max(filteredActions.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter" && filteredActions[highlightedIndex]) {
        event.preventDefault();
        void selectAction(filteredActions[highlightedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busyActionId, filteredActions, highlightedIndex, isOpen, onClose, path.length, search]);

  if (!isOpen) return null;

  let previousGroup = "";

  return (
    <div className="command-palette-layer" role="presentation">
      <div className="command-palette-backdrop" onClick={busyActionId ? undefined : onClose} />
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={currentParent?.label ?? "Quick actions"}
      >
        <div className="command-palette-header">
          {path.length > 0 && !search ? (
            <button className="command-palette-back" onClick={goBack} aria-label="Back to all actions">
              ←
            </button>
          ) : (
            <span className="command-palette-icon" aria-hidden="true">⌕</span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={currentParent?.label ?? "Search quick actions..."}
            className="command-palette-input"
            aria-label="Search quick actions"
            disabled={Boolean(busyActionId)}
          />
          <kbd className="command-palette-shortcut">Esc</kbd>
        </div>

        {path.length > 0 && !search && (
          <div className="command-palette-breadcrumb">
            Quick Actions <span>›</span> {path.map((entry) => entry.label).join(" › ")}
          </div>
        )}

        <div className="command-palette-results" ref={listRef} role="listbox">
          {filteredActions.length === 0 ? (
            <div className="command-palette-empty">No matching actions</div>
          ) : (
            filteredActions.map((action, index) => {
              const showGroup = action.group !== previousGroup;
              previousGroup = action.group;
              return (
                <div key={action.id}>
                  {showGroup && <div className="command-palette-group">{action.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlightedIndex}
                    aria-disabled={action.disabled}
                    data-action-index={index}
                    className={`command-palette-item ${index === highlightedIndex ? "highlighted" : ""}`}
                    disabled={action.disabled || Boolean(busyActionId)}
                    onClick={() => void selectAction(action)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <span className="command-palette-item-icon" aria-hidden="true">{action.icon}</span>
                    <span className="command-palette-item-copy">
                      <span className="command-palette-item-label">{action.label}</span>
                      <span className="command-palette-item-description">
                        {action.disabledReason ?? action.description}
                      </span>
                    </span>
                    {busyActionId === action.id ? (
                      <span className="command-palette-spinner" aria-label="Working" />
                    ) : action.children?.length ? (
                      <span className="command-palette-chevron" aria-hidden="true">›</span>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {error && <div className="command-palette-error" role="alert">{error}</div>}

        <footer className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          {path.length > 0 && <span><kbd>Backspace</kbd> Back</span>}
        </footer>
      </section>
    </div>
  );
}
