import { useCallback, useEffect, useRef, useState } from "react";
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

  const refresh = useCallback(async () => {
    try {
      const res = await listProjects();
      setProjects(res.projects);
      return res;
    } catch (e) {
      console.error("Failed to load projects", e);
      return null;
    }
  }, []);

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
    if (id === activeProjectId) {
      setIsOpen(false);
      return;
    }

    const previousProjectId = activeProjectId;
    setIsOpen(false);
    onProjectChange(id);

    void activateProject(id).catch((e) => {
      console.error("Failed to switch project", e);
      if (previousProjectId && previousProjectId !== id) {
        onProjectChange(previousProjectId);
      }
      void refresh();
    });
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const proj = await createProject(name);
      const previousProjectId = activeProjectId;

      setProjects((current) => [...current, proj]);
      setNewName("");
      setShowNew(false);
      setIsOpen(false);
      onProjectChange(proj.id);

      void activateProject(proj.id)
        .catch((e) => {
          console.error("Failed to activate new project", e);
          if (previousProjectId) {
            onProjectChange(previousProjectId);
          }
          void refresh();
        })
        .finally(() => {
          void refresh();
        });
    } catch (e) {
      console.error("Failed to create project", e);
    }
  };

  const handleRename = (id: string) => {
    const name = editName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }

    const previousProjects = projects;
    setProjects((current) => current.map((project) => (project.id === id ? { ...project, name } : project)));
    setEditingId(null);

    void apiRenameProject(id, name).catch((e) => {
      console.error("Failed to rename project", e);
      setProjects(previousProjects);
      void refresh();
    });
  };

  const handleCopy = async (id: string) => {
    const source = projects.find((p) => p.id === id);
    if (!source) return;
    try {
      const newProj = await apiCopyProject(id, `${source.name} (copy)`);
      const previousProjectId = activeProjectId;

      setProjects((current) => [...current, newProj]);
      setContextMenu(null);
      setIsOpen(false);
      onProjectChange(newProj.id);

      void activateProject(newProj.id)
        .catch((e) => {
          console.error("Failed to activate copied project", e);
          if (previousProjectId) {
            onProjectChange(previousProjectId);
          }
          void refresh();
        })
        .finally(() => {
          void refresh();
        });
    } catch (e) {
      console.error("Failed to copy project", e);
    }
  };

  const handleDelete = (id: string) => {
    if (projects.length <= 1) {
      alert("Cannot delete the last project.");
      return;
    }
    if (!confirm("Delete this project? This cannot be undone.")) return;

    const previousProjects = projects;
    const remainingProjects = projects.filter((project) => project.id !== id);
    const fallbackProjectId = id === activeProjectId ? remainingProjects[0]?.id ?? null : activeProjectId;

    setProjects(remainingProjects);
    setContextMenu(null);

    if (id === activeProjectId && fallbackProjectId) {
      onProjectChange(fallbackProjectId);
    }

    void apiDeleteProject(id)
      .then(async () => {
        const res = await refresh();
        if (id === activeProjectId && res?.activeProjectId && res.activeProjectId !== fallbackProjectId) {
          onProjectChange(res.activeProjectId);
        }
      })
      .catch((e) => {
        console.error("Failed to delete project", e);
        setProjects(previousProjects);
        if (id === activeProjectId && activeProjectId) {
          onProjectChange(activeProjectId);
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
