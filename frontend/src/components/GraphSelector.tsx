import { useCallback, useEffect, useRef, useState } from "react";
import {
  GraphInfo,
  listGraphs,
  createGraph,
  activateGraph,
  renameGraph as apiRenameGraph,
  copyGraph as apiCopyGraph,
  deleteGraph as apiDeleteGraph
} from "../api/persistence";

type GraphSelectorProps = {
  activeProjectId: string | null;
  activeGraphId: string | null;
  onGraphChange: (graphId: string) => void;
};

export default function GraphSelector({
  activeProjectId,
  activeGraphId,
  onGraphChange
}: GraphSelectorProps) {
  const [graphs, setGraphs] = useState<GraphInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeGraph = graphs.find((g) => g.id === activeGraphId);

  const refresh = useCallback(async () => {
    if (!activeProjectId) {
      setGraphs([]);
      return null;
    }

    try {
      const res = await listGraphs(activeProjectId);
      setGraphs(res.graphs);
      return res;
    } catch (e) {
      console.error("Failed to load graphs", e);
      return null;
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        (!contextMenuRef.current || !contextMenuRef.current.contains(target))
      ) {
        setIsOpen(false);
        setContextMenu(null);
        setShowNew(false);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus input when editing
  useEffect(() => {
    if ((editingId || showNew) && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId, showNew]);

  const handleSwitch = (id: string) => {
    if (!activeProjectId) return;
    if (id === activeGraphId) {
      setIsOpen(false);
      return;
    }

    const previousGraphId = activeGraphId;
    setIsOpen(false);
    onGraphChange(id);

    void activateGraph(activeProjectId, id).catch((e) => {
      console.error("Failed to switch graph", e);
      if (previousGraphId && previousGraphId !== id) {
        onGraphChange(previousGraphId);
      }
      void refresh();
    });
  };

  const handleCreate = async () => {
    if (!activeProjectId) return;
    const name = newName.trim();
    if (!name) return;
    try {
      const g = await createGraph(activeProjectId, name);
      const previousGraphId = activeGraphId;

      setGraphs((current) => [...current, g]);
      setNewName("");
      setShowNew(false);
      setIsOpen(false);
      onGraphChange(g.id);

      void activateGraph(activeProjectId, g.id)
        .catch((e) => {
          console.error("Failed to activate new graph", e);
          if (previousGraphId) {
            onGraphChange(previousGraphId);
          }
          void refresh();
        })
        .finally(() => {
          void refresh();
        });
    } catch (e) {
      console.error("Failed to create graph", e);
    }
  };

  const handleRename = (id: string) => {
    if (!activeProjectId) return;
    const name = editName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }

    const previousGraphs = graphs;
    setGraphs((current) => current.map((graph) => (graph.id === id ? { ...graph, name } : graph)));
    setEditingId(null);

    void apiRenameGraph(activeProjectId, id, name).catch((e) => {
      console.error("Failed to rename graph", e);
      setGraphs(previousGraphs);
      void refresh();
    });
  };

  const handleCopy = async (id: string) => {
    if (!activeProjectId) return;
    const source = graphs.find((g) => g.id === id);
    if (!source) return;
    try {
      const newG = await apiCopyGraph(activeProjectId, id, `${source.name} (copy)`);
      const previousGraphId = activeGraphId;

      setGraphs((current) => [...current, newG]);
      setContextMenu(null);
      setIsOpen(false);
      onGraphChange(newG.id);

      void activateGraph(activeProjectId, newG.id)
        .catch((e) => {
          console.error("Failed to activate copied graph", e);
          if (previousGraphId) {
            onGraphChange(previousGraphId);
          }
          void refresh();
        })
        .finally(() => {
          void refresh();
        });
    } catch (e) {
      console.error("Failed to copy graph", e);
    }
  };

  const handleDelete = (id: string) => {
    if (!activeProjectId) return;
    if (graphs.length <= 1) {
      alert("Cannot delete the last graph.");
      return;
    }
    if (!confirm("Delete this graph? This cannot be undone.")) return;

    const previousGraphs = graphs;
    const remainingGraphs = graphs.filter((graph) => graph.id !== id);
    const fallbackGraphId = id === activeGraphId ? remainingGraphs[0]?.id ?? null : activeGraphId;

    setGraphs(remainingGraphs);
    setContextMenu(null);

    if (id === activeGraphId && fallbackGraphId) {
      onGraphChange(fallbackGraphId);
    }

    void apiDeleteGraph(activeProjectId, id)
      .then(async () => {
        const res = await refresh();
        if (id === activeGraphId && res?.activeGraphId && res.activeGraphId !== fallbackGraphId) {
          onGraphChange(res.activeGraphId);
        }
      })
      .catch((e) => {
        console.error("Failed to delete graph", e);
        setGraphs(previousGraphs);
        if (id === activeGraphId && activeGraphId) {
          onGraphChange(activeGraphId);
        }
        void refresh();
      });
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="graph-selector" ref={dropdownRef}>
      <button
        className="graph-selector-btn"
        onClick={() => {
          setIsOpen((o) => !o);
          setContextMenu(null);
        }}
        title={activeGraph?.name ?? "Select graph"}
      >
        <span className="graph-selector-icon">📊</span>
        <span className="graph-selector-label">
          {activeGraph?.name ?? "Loading..."}
        </span>
        <span className="graph-selector-chevron">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="graph-dropdown">
          <div className="graph-dropdown-header">Graphs</div>
          <div className="graph-list">
            {graphs.map((g) => (
              <div
                key={g.id}
                className={`graph-item ${g.id === activeGraphId ? "active" : ""}`}
                onClick={() => {
                  if (editingId !== g.id) handleSwitch(g.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, g.id)}
              >
                {editingId === g.id ? (
                  <input
                    ref={inputRef}
                    className="graph-edit-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(g.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => handleRename(g.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="graph-item-name">{g.name}</span>
                    <button
                      className="graph-item-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenu(
                          contextMenu?.id === g.id
                            ? null
                            : { id: g.id, x: e.clientX, y: e.clientY }
                        );
                      }}
                      title="Graph actions"
                    >
                      ⋯
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {showNew ? (
            <div className="graph-new-row">
              <input
                ref={inputRef}
                className="graph-edit-input"
                placeholder="Graph name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowNew(false);
                }}
              />
              <button className="graph-action-confirm" onClick={handleCreate}>
                ✓
              </button>
            </div>
          ) : (
            <button
              className="graph-new-btn"
              onClick={() => {
                setShowNew(true);
                setNewName("");
              }}
            >
              + New Graph
            </button>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="graph-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              const g = graphs.find((gr) => gr.id === contextMenu.id);
              if (g) {
                setEditName(g.name);
                setEditingId(g.id);
                setContextMenu(null);
              }
            }}
          >
            ✏️ Rename
          </button>
          <button onClick={() => handleCopy(contextMenu.id)}>📋 Duplicate</button>
          <button
            className="danger"
            onClick={() => handleDelete(contextMenu.id)}
          >
            🗑️ Delete
          </button>
        </div>
      )}
    </div>
  );
}
