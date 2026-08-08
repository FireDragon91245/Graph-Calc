import { useCallback, useEffect, useRef, useState } from "react";
import {
  GraphInfo,
  listGraphs,
  createGraph,
  activateGraph,
  renameGraph as apiRenameGraph,
  copyGraph as apiCopyGraph,
  deleteGraph as apiDeleteGraph,
  deleteGraphThumbnail,
  getGraphThumbnailUrl,
  putGraphThumbnail
} from "../api/persistence";
import EntityThumbnail from "./EntityThumbnail";
import { useTranslation } from "react-i18next";

type GraphSelectorProps = {
  activeProjectId: string | null;
  activeGraphId: string | null;
  onGraphChange: (graphId: string) => Promise<void>;
  refreshToken?: number;
};

export default function GraphSelector({
  activeProjectId,
  activeGraphId,
  onGraphChange,
  refreshToken = 0
}: GraphSelectorProps) {
  const { t } = useTranslation();
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
  }, [refresh, refreshToken]);

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

  const handleSwitch = async (id: string) => {
    if (!activeProjectId) return;
    if (id === activeGraphId) {
      setIsOpen(false);
      return;
    }

    const previousGraphId = activeGraphId;
    setIsOpen(false);
    try {
      await onGraphChange(id);
      await activateGraph(activeProjectId, id);
    } catch (e) {
      console.error("Failed to switch graph", e);
      if (previousGraphId && previousGraphId !== id) {
        await onGraphChange(previousGraphId);
      }
      await refresh();
    }
  };

  const handleCreate = async () => {
    if (!activeProjectId) return;
    const name = newName.trim();
    if (!name) return;
    try {
      const g = await createGraph(activeProjectId, name);

      setGraphs((current) => [...current, g]);
      setNewName("");
      setShowNew(false);
      setIsOpen(false);
      await onGraphChange(g.id);
      await activateGraph(activeProjectId, g.id);
      await refresh();
    } catch (e) {
      console.error("Failed to create or activate graph", e);
      if (activeGraphId) {
        await onGraphChange(activeGraphId);
      }
      await refresh();
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
      const newG = await apiCopyGraph(activeProjectId, id, `${source.name} (${t("ui.defaults.copy")})`);

      setGraphs((current) => [...current, newG]);
      setContextMenu(null);
      setIsOpen(false);
      await onGraphChange(newG.id);
      await activateGraph(activeProjectId, newG.id);
      await refresh();
    } catch (e) {
      console.error("Failed to copy or activate graph", e);
      if (activeGraphId) {
        await onGraphChange(activeGraphId);
      }
      await refresh();
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeProjectId) return;
    if (graphs.length <= 1) {
      alert(t("ui.graph.deleteLast"));
      return;
    }
    if (!confirm(t("ui.graph.deleteConfirm"))) return;

    const previousGraphs = graphs;
    const remainingGraphs = graphs.filter((graph) => graph.id !== id);
    const fallbackGraphId = id === activeGraphId ? remainingGraphs[0]?.id ?? null : activeGraphId;

    setGraphs(remainingGraphs);
    setContextMenu(null);

    try {
      if (id === activeGraphId && fallbackGraphId) {
        await onGraphChange(fallbackGraphId);
      }
      await apiDeleteGraph(activeProjectId, id);
      const res = await refresh();
      if (id === activeGraphId && res?.activeGraphId && res.activeGraphId !== fallbackGraphId) {
        await onGraphChange(res.activeGraphId);
      }
    } catch (e) {
      console.error("Failed to delete graph", e);
      setGraphs(previousGraphs);
      if (id === activeGraphId && activeGraphId) {
        await onGraphChange(activeGraphId);
      }
      await refresh();
    }
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const handleThumbnailUpload = async (id: string, file: File) => {
    if (!activeProjectId) return;
    const thumbnailId = await putGraphThumbnail(activeProjectId, id, file);
    setGraphs((current) => current.map((graph) => graph.id === id ? { ...graph, thumbnailId } : graph));
  };

  const handleThumbnailDelete = async (id: string) => {
    if (!activeProjectId) return;
    await deleteGraphThumbnail(activeProjectId, id);
    setGraphs((current) => current.map((graph) => graph.id === id ? { ...graph, thumbnailId: null } : graph));
    setContextMenu(null);
  };

  return (
    <div className="graph-selector" ref={dropdownRef}>
      <div
        className="graph-selector-btn"
        onClick={() => {
          setIsOpen((open) => !open);
          setContextMenu(null);
        }}
      >
        {activeGraph && activeProjectId && (
          <EntityThumbnail
            compact
            src={getGraphThumbnailUrl(activeProjectId, activeGraph.id, activeGraph.thumbnailId)}
            label={activeGraph.name}
            onUpload={(file) => handleThumbnailUpload(activeGraph.id, file)}
          />
        )}
        <button
          type="button"
          className="graph-selector-toggle"
          title={activeGraph?.name ?? t("ui.graph.select")}
        >
          <span className="graph-selector-label">
            {activeGraph?.name ?? t("ui.graph.loading")}
          </span>
          <span className="graph-selector-chevron">{isOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {isOpen && (
        <div className="graph-dropdown">
          <div className="graph-dropdown-header">{t("ui.graph.graphs")}</div>
          <div className="graph-list">
            {graphs.map((g) => (
              <div
                key={g.id}
                className={`graph-item ${g.id === activeGraphId ? "active" : ""}`}
                onClick={() => {
                  if (editingId !== g.id) void handleSwitch(g.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, g.id)}
              >
                <EntityThumbnail
                  src={activeProjectId ? getGraphThumbnailUrl(activeProjectId, g.id, g.thumbnailId) : null}
                  label={g.name}
                  onUpload={(file) => handleThumbnailUpload(g.id, file)}
                />
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
                      title={t("ui.graph.actions")}
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
                placeholder={t("ui.graph.namePlaceholder")}
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
              + {t("ui.graph.new")}
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
            ✏️ {t("common.actions.rename")}
          </button>
          <button onClick={() => void handleCopy(contextMenu.id)}>📋 {t("ui.graph.duplicate")}</button>
          {graphs.find((graph) => graph.id === contextMenu.id)?.thumbnailId && (
            <button onClick={() => void handleThumbnailDelete(contextMenu.id)}>{t("ui.graph.removeThumbnail")}</button>
          )}
          <button
            className="danger"
            onClick={() => void handleDelete(contextMenu.id)}
          >
            🗑️ {t("common.actions.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
