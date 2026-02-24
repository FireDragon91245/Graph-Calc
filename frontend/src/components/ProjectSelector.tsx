import { useState, useRef, useEffect } from "react";
import {
  Project,
  listProjects,
  createProject,
  activateProject,
  renameProject as apiRenameProject,
  copyProject as apiCopyProject,
  deleteProject as apiDeleteProject
} from "../api/persistence";

type ProjectSelectorProps = {
  activeProjectId: string | null;
  onProjectChange: (projectId: string) => void;
};

export default function ProjectSelector({
  activeProjectId,
  onProjectChange
}: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const refresh = async () => {
    try {
      const res = await listProjects();
      setProjects(res.projects);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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
    if (id === activeProjectId) {
      setIsOpen(false);
      return;
    }
    try {
      await activateProject(id);
      onProjectChange(id);
      setIsOpen(false);
    } catch (e) {
      console.error("Failed to switch project", e);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const proj = await createProject(name);
      setNewName("");
      setShowNew(false);
      await refresh();
      // Switch to new project
      await activateProject(proj.id);
      onProjectChange(proj.id);
      setIsOpen(false);
    } catch (e) {
      console.error("Failed to create project", e);
    }
  };

  const handleRename = async (id: string) => {
    const name = editName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    try {
      await apiRenameProject(id, name);
      setEditingId(null);
      await refresh();
    } catch (e) {
      console.error("Failed to rename project", e);
    }
  };

  const handleCopy = async (id: string) => {
    const source = projects.find((p) => p.id === id);
    if (!source) return;
    try {
      const newProj = await apiCopyProject(id, `${source.name} (copy)`);
      setContextMenu(null);
      await refresh();
      // Switch to copy
      await activateProject(newProj.id);
      onProjectChange(newProj.id);
    } catch (e) {
      console.error("Failed to copy project", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (projects.length <= 1) {
      alert("Cannot delete the last project.");
      return;
    }
    if (!confirm("Delete this project? This cannot be undone.")) return;
    try {
      await apiDeleteProject(id);
      setContextMenu(null);
      const res = await listProjects();
      setProjects(res.projects);
      if (id === activeProjectId && res.activeProjectId) {
        onProjectChange(res.activeProjectId);
      }
    } catch (e) {
      console.error("Failed to delete project", e);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="project-selector" ref={dropdownRef}>
      <button
        className="project-selector-btn"
        onClick={() => {
          setIsOpen((o) => !o);
          setContextMenu(null);
        }}
        title={activeProject?.name ?? "Select project"}
      >
        <span className="project-selector-icon">📁</span>
        <span className="project-selector-label">
          {activeProject?.name ?? "Loading..."}
        </span>
        <span className="project-selector-chevron">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="project-dropdown">
          <div className="project-dropdown-header">Projects</div>
          <div className="project-list">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`project-item ${p.id === activeProjectId ? "active" : ""}`}
                onClick={() => {
                  if (editingId !== p.id) handleSwitch(p.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, p.id)}
              >
                {editingId === p.id ? (
                  <input
                    ref={inputRef}
                    className="project-edit-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(p.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => handleRename(p.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="project-item-name">{p.name}</span>
                    <button
                      className="project-item-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenu(
                          contextMenu?.id === p.id
                            ? null
                            : { id: p.id, x: e.clientX, y: e.clientY }
                        );
                      }}
                      title="Project actions"
                    >
                      ⋯
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {showNew ? (
            <div className="project-new-row">
              <input
                ref={inputRef}
                className="project-edit-input"
                placeholder="Project name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowNew(false);
                }}
              />
              <button className="project-action-confirm" onClick={handleCreate}>
                ✓
              </button>
            </div>
          ) : (
            <button
              className="project-new-btn"
              onClick={() => {
                setShowNew(true);
                setNewName("");
              }}
            >
              + New Project
            </button>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="project-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              const p = projects.find((pr) => pr.id === contextMenu.id);
              if (p) {
                setEditName(p.name);
                setEditingId(p.id);
                setContextMenu(null);
              }
            }}
          >
            ✏️ Rename
          </button>
          <button onClick={() => handleCopy(contextMenu.id)}>📋 Copy</button>
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
