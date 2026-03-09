import { useEffect, useMemo, useState } from "react";
import type { GraphData, StoreData, WorkspaceGraphSnapshot, WorkspaceProjectSnapshot, WorkspaceSnapshot } from "../api/persistence";

type ProjectPresenceStatus = "same" | "only-local" | "only-account" | "different";
type GraphPresenceStatus = "same" | "only-local" | "only-account" | "different";
type ProjectSideChoice = "merge" | "discard";
type ProjectConflictChoice = "custom" | "local" | "account" | "copy-to-new";
type GraphSideChoice = "merge" | "discard";
type GraphConflictChoice = "local" | "account" | "copy-to-new";
type StoreChoice = "local" | "account";

type GraphComparison = {
  key: string;
  name: string;
  status: GraphPresenceStatus;
  localGraph: WorkspaceGraphSnapshot | null;
  remoteGraph: WorkspaceGraphSnapshot | null;
};

type ProjectComparison = {
  key: string;
  name: string;
  status: ProjectPresenceStatus;
  localProject: WorkspaceProjectSnapshot | null;
  remoteProject: WorkspaceProjectSnapshot | null;
  storeDifferent: boolean;
  graphs: GraphComparison[];
};

type WorkspaceMergeDialogProps = {
  isOpen: boolean;
  localSnapshot: WorkspaceSnapshot | null;
  remoteSnapshot: WorkspaceSnapshot | null;
  isSubmitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (snapshot: WorkspaceSnapshot) => Promise<void>;
};

const normalizeStore = (store: StoreData): StoreData => ({
  categories: [...store.categories].sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
  items: [...store.items].sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
  tags: [...store.tags].sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
  recipeTags: [...store.recipeTags].sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)),
  recipes: [...store.recipes].sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name))
});

const normalizeGraph = (graph: GraphData): GraphData => ({
  nodes: [...graph.nodes].sort((left, right) => `${left?.id ?? ""}`.localeCompare(`${right?.id ?? ""}`)),
  edges: [...graph.edges].sort((left, right) => `${left?.id ?? ""}`.localeCompare(`${right?.id ?? ""}`))
});

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const areStoresEqual = (left: StoreData, right: StoreData): boolean => JSON.stringify(normalizeStore(left)) === JSON.stringify(normalizeStore(right));
const areGraphsEqual = (left: GraphData, right: GraphData): boolean => JSON.stringify(normalizeGraph(left)) === JSON.stringify(normalizeGraph(right));

const lowerName = (value: string): string => value.trim().toLowerCase();

const compareProjects = (localSnapshot: WorkspaceSnapshot, remoteSnapshot: WorkspaceSnapshot): ProjectComparison[] => {
  const localProjectsByName = new Map(localSnapshot.projects.map((project) => [lowerName(project.name), project]));
  const remoteProjectsByName = new Map(remoteSnapshot.projects.map((project) => [lowerName(project.name), project]));
  const names = Array.from(new Set([...localProjectsByName.keys(), ...remoteProjectsByName.keys()])).sort();

  return names.map((name) => {
    const localProject = localProjectsByName.get(name) ?? null;
    const remoteProject = remoteProjectsByName.get(name) ?? null;
    const displayName = localProject?.name ?? remoteProject?.name ?? "Unnamed Project";

    if (!localProject) {
      return {
        key: name,
        name: displayName,
        status: "only-account",
        localProject: null,
        remoteProject,
        storeDifferent: false,
        graphs: []
      } satisfies ProjectComparison;
    }

    if (!remoteProject) {
      return {
        key: name,
        name: displayName,
        status: "only-local",
        localProject,
        remoteProject: null,
        storeDifferent: false,
        graphs: []
      } satisfies ProjectComparison;
    }

    const localGraphsByName = new Map(localProject.graphs.map((graph) => [lowerName(graph.name), graph]));
    const remoteGraphsByName = new Map(remoteProject.graphs.map((graph) => [lowerName(graph.name), graph]));
    const graphNames = Array.from(new Set([...localGraphsByName.keys(), ...remoteGraphsByName.keys()])).sort();
    const graphs = graphNames.map((graphName) => {
      const localGraph = localGraphsByName.get(graphName) ?? null;
      const remoteGraph = remoteGraphsByName.get(graphName) ?? null;
      const displayGraphName = localGraph?.name ?? remoteGraph?.name ?? "Unnamed Graph";

      if (!localGraph) {
        return {
          key: `${name}::${graphName}`,
          name: displayGraphName,
          status: "only-account",
          localGraph: null,
          remoteGraph
        } satisfies GraphComparison;
      }

      if (!remoteGraph) {
        return {
          key: `${name}::${graphName}`,
          name: displayGraphName,
          status: "only-local",
          localGraph,
          remoteGraph: null
        } satisfies GraphComparison;
      }

      return {
        key: `${name}::${graphName}`,
        name: displayGraphName,
        status: areGraphsEqual(localGraph.data, remoteGraph.data) ? "same" : "different",
        localGraph,
        remoteGraph
      } satisfies GraphComparison;
    });

    const storeDifferent = !areStoresEqual(localProject.store, remoteProject.store);
    const status = !storeDifferent && graphs.every((graph) => graph.status === "same") ? "same" : "different";

    return {
      key: name,
      name: displayName,
      status,
      localProject,
      remoteProject,
      storeDifferent,
      graphs
    } satisfies ProjectComparison;
  });
};

function uniqueName(baseName: string, usedNames: Set<string>, suffix = "copy"): string {
  const trimmed = baseName.trim() || "Unnamed";
  const direct = trimmed.toLowerCase();
  if (!usedNames.has(direct)) {
    usedNames.add(direct);
    return trimmed;
  }

  let index = 1;
  while (usedNames.has(`${trimmed} (${suffix} ${index})`.toLowerCase())) {
    index += 1;
  }

  const nextName = `${trimmed} (${suffix} ${index})`;
  usedNames.add(nextName.toLowerCase());
  return nextName;
}

function buildMergedSnapshot(
  comparisons: ProjectComparison[],
  projectSideChoices: Record<string, ProjectSideChoice>,
  projectConflictChoices: Record<string, ProjectConflictChoice>,
  projectStoreChoices: Record<string, StoreChoice>,
  graphSideChoices: Record<string, GraphSideChoice>,
  graphConflictChoices: Record<string, GraphConflictChoice>,
  remoteSnapshot: WorkspaceSnapshot
): WorkspaceSnapshot {
  const mergedProjects: WorkspaceProjectSnapshot[] = [];
  const usedProjectNames = new Set<string>();

  for (const comparison of comparisons) {
    if (comparison.status === "same") {
      if (comparison.remoteProject) {
        const projectName = uniqueName(comparison.remoteProject.name, usedProjectNames);
        mergedProjects.push({ ...clone(comparison.remoteProject), name: projectName });
      }
      continue;
    }

    if (comparison.status === "only-local") {
      if (projectSideChoices[comparison.key] === "merge" && comparison.localProject) {
        const projectName = uniqueName(comparison.localProject.name, usedProjectNames);
        mergedProjects.push({ ...clone(comparison.localProject), name: projectName });
      }
      continue;
    }

    if (comparison.status === "only-account") {
      if (projectSideChoices[comparison.key] !== "discard" && comparison.remoteProject) {
        const projectName = uniqueName(comparison.remoteProject.name, usedProjectNames);
        mergedProjects.push({ ...clone(comparison.remoteProject), name: projectName });
      }
      continue;
    }

    const conflictChoice = projectConflictChoices[comparison.key] ?? "custom";
    if (conflictChoice === "local" && comparison.localProject) {
      const projectName = uniqueName(comparison.localProject.name, usedProjectNames);
      mergedProjects.push({ ...clone(comparison.localProject), name: projectName });
      continue;
    }

    if (conflictChoice === "account" && comparison.remoteProject) {
      const projectName = uniqueName(comparison.remoteProject.name, usedProjectNames);
      mergedProjects.push({ ...clone(comparison.remoteProject), name: projectName });
      continue;
    }

    if (conflictChoice === "copy-to-new") {
      if (comparison.remoteProject) {
        const accountProjectName = uniqueName(comparison.remoteProject.name, usedProjectNames);
        mergedProjects.push({ ...clone(comparison.remoteProject), name: accountProjectName });
      }
      if (comparison.localProject) {
        const localProjectName = uniqueName(comparison.localProject.name, usedProjectNames, "local copy");
        mergedProjects.push({ ...clone(comparison.localProject), name: localProjectName });
      }
      continue;
    }

    const remoteProject = comparison.remoteProject ?? comparison.localProject;
    const localProject = comparison.localProject ?? comparison.remoteProject;
    if (!remoteProject || !localProject) {
      continue;
    }

    const mergedGraphs: WorkspaceGraphSnapshot[] = [];
    const usedGraphNames = new Set<string>();

    for (const graphComparison of comparison.graphs) {
      if (graphComparison.status === "same" && graphComparison.remoteGraph) {
        const graphName = uniqueName(graphComparison.remoteGraph.name, usedGraphNames);
        mergedGraphs.push({ ...clone(graphComparison.remoteGraph), name: graphName });
        continue;
      }

      if (graphComparison.status === "only-local") {
        if (graphSideChoices[graphComparison.key] === "merge" && graphComparison.localGraph) {
          const graphName = uniqueName(graphComparison.localGraph.name, usedGraphNames);
          mergedGraphs.push({ ...clone(graphComparison.localGraph), name: graphName });
        }
        continue;
      }

      if (graphComparison.status === "only-account") {
        if (graphSideChoices[graphComparison.key] !== "discard" && graphComparison.remoteGraph) {
          const graphName = uniqueName(graphComparison.remoteGraph.name, usedGraphNames);
          mergedGraphs.push({ ...clone(graphComparison.remoteGraph), name: graphName });
        }
        continue;
      }

      const graphChoice = graphConflictChoices[graphComparison.key] ?? "account";
      if ((graphChoice === "account" || graphChoice === "copy-to-new") && graphComparison.remoteGraph) {
        const graphName = uniqueName(graphComparison.remoteGraph.name, usedGraphNames);
        mergedGraphs.push({ ...clone(graphComparison.remoteGraph), name: graphName });
      }
      if ((graphChoice === "local" || graphChoice === "copy-to-new") && graphComparison.localGraph) {
        const suffix = graphChoice === "copy-to-new" ? "local copy" : "copy";
        const graphName = uniqueName(graphComparison.localGraph.name, usedGraphNames, suffix);
        mergedGraphs.push({ ...clone(graphComparison.localGraph), name: graphName });
      }
    }

    const firstFallbackGraph = mergedGraphs[0] ?? clone(remoteProject.graphs[0] ?? localProject.graphs[0] ?? { name: "Main Graph", data: { nodes: [], edges: [] } });
    if (mergedGraphs.length === 0) {
      mergedGraphs.push(firstFallbackGraph);
    }

    const preferredActiveNames = [remoteProject.activeGraphName, localProject.activeGraphName].filter((name): name is string => Boolean(name));
    const activeGraphName = preferredActiveNames.find((name) => mergedGraphs.some((graph) => graph.name === name)) ?? mergedGraphs[0].name;
    const store = comparison.storeDifferent ? clone((projectStoreChoices[comparison.key] ?? "account") === "local" ? localProject.store : remoteProject.store) : clone(remoteProject.store);
    const projectName = uniqueName(remoteProject.name, usedProjectNames);

    mergedProjects.push({
      name: projectName,
      activeGraphName,
      store,
      graphs: mergedGraphs
    });
  }

  const activeProjectName = remoteSnapshot.activeProjectName && mergedProjects.some((project) => project.name === remoteSnapshot.activeProjectName)
    ? remoteSnapshot.activeProjectName
    : mergedProjects[0]?.name ?? null;

  return {
    activeProjectName,
    projects: mergedProjects
  };
}

const statusLabel: Record<ProjectPresenceStatus | GraphPresenceStatus, string> = {
  same: "Same",
  "only-local": "Only local",
  "only-account": "Only account",
  different: "Different"
};

export default function WorkspaceMergeDialog({
  isOpen,
  localSnapshot,
  remoteSnapshot,
  isSubmitting,
  error,
  onCancel,
  onConfirm
}: WorkspaceMergeDialogProps) {
  const comparisons = useMemo(() => {
    if (!localSnapshot || !remoteSnapshot) {
      return [];
    }

    return compareProjects(localSnapshot, remoteSnapshot);
  }, [localSnapshot, remoteSnapshot]);

  const [projectSideChoices, setProjectSideChoices] = useState<Record<string, ProjectSideChoice>>({});
  const [projectConflictChoices, setProjectConflictChoices] = useState<Record<string, ProjectConflictChoice>>({});
  const [projectStoreChoices, setProjectStoreChoices] = useState<Record<string, StoreChoice>>({});
  const [graphSideChoices, setGraphSideChoices] = useState<Record<string, GraphSideChoice>>({});
  const [graphConflictChoices, setGraphConflictChoices] = useState<Record<string, GraphConflictChoice>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextProjectSideChoices: Record<string, ProjectSideChoice> = {};
    const nextProjectConflictChoices: Record<string, ProjectConflictChoice> = {};
    const nextProjectStoreChoices: Record<string, StoreChoice> = {};
    const nextGraphSideChoices: Record<string, GraphSideChoice> = {};
    const nextGraphConflictChoices: Record<string, GraphConflictChoice> = {};

    for (const comparison of comparisons) {
      if (comparison.status === "only-local") {
        nextProjectSideChoices[comparison.key] = "discard";
      } else if (comparison.status === "only-account") {
        nextProjectSideChoices[comparison.key] = "merge";
      } else if (comparison.status === "different") {
        nextProjectConflictChoices[comparison.key] = "custom";
        nextProjectStoreChoices[comparison.key] = "account";
      }

      for (const graph of comparison.graphs) {
        if (graph.status === "only-local") {
          nextGraphSideChoices[graph.key] = "discard";
        } else if (graph.status === "only-account") {
          nextGraphSideChoices[graph.key] = "merge";
        } else if (graph.status === "different") {
          nextGraphConflictChoices[graph.key] = "account";
        }
      }
    }

    setProjectSideChoices(nextProjectSideChoices);
    setProjectConflictChoices(nextProjectConflictChoices);
    setProjectStoreChoices(nextProjectStoreChoices);
    setGraphSideChoices(nextGraphSideChoices);
    setGraphConflictChoices(nextGraphConflictChoices);
    setValidationError(null);
  }, [comparisons, isOpen]);

  const mergedSnapshot = useMemo(() => {
    if (!localSnapshot || !remoteSnapshot) {
      return null;
    }

    return buildMergedSnapshot(
      comparisons,
      projectSideChoices,
      projectConflictChoices,
      projectStoreChoices,
      graphSideChoices,
      graphConflictChoices,
      remoteSnapshot
    );
  }, [comparisons, graphConflictChoices, graphSideChoices, localSnapshot, projectConflictChoices, projectSideChoices, projectStoreChoices, remoteSnapshot]);

  if (!isOpen || !localSnapshot || !remoteSnapshot || !mergedSnapshot) {
    return null;
  }

  const handleConfirm = async () => {
    if (mergedSnapshot.projects.length === 0) {
      setValidationError("The merge must keep at least one project.");
      return;
    }

    setValidationError(null);
    await onConfirm(mergedSnapshot);
  };

  return (
    <div className="auth-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && !isSubmitting && onCancel()}>
      <div className="workspace-merge-dialog" role="dialog" aria-modal="true" aria-label="Workspace merge dialog">
        <div className="auth-dialog-header">
          <div>
            <h2 className="auth-dialog-title">Resolve Workspace Differences</h2>
            <p className="auth-dialog-subtitle">
              Local guest data and account data do not match. Review the merge plan before switching into the account workspace.
            </p>
          </div>
          <button className="auth-close" type="button" onClick={onCancel} disabled={isSubmitting} aria-label="Close merge dialog">
            ×
          </button>
        </div>

        <div className="workspace-merge-legend">
          <span className="workspace-merge-chip same">Same</span>
          <span className="workspace-merge-chip warning">Only on one side</span>
          <span className="workspace-merge-chip conflict">Different</span>
        </div>

        <p className="auth-helper workspace-merge-helper">
          Conservative defaults are selected: account wins on conflicts, local-only entries are discarded, and account-only entries are kept unless you change them.
        </p>

        <div className="workspace-merge-list">
          {comparisons.map((comparison) => (
            <div key={comparison.key} className={`workspace-merge-project workspace-merge-${comparison.status}`}>
              <div className="workspace-merge-row workspace-merge-project-row">
                <div>
                  <div className="workspace-merge-title">Project: {comparison.name}</div>
                  <div className="workspace-merge-meta">
                    {comparison.status === "only-local" && "Exists only in the local guest workspace."}
                    {comparison.status === "only-account" && "Exists only in the account workspace."}
                    {comparison.status === "same" && "Project data matches on both sides."}
                    {comparison.status === "different" && "Project contents differ between guest and account."}
                  </div>
                </div>
                <span className={`workspace-merge-chip ${comparison.status === "same" ? "same" : comparison.status === "different" ? "conflict" : "warning"}`}>
                  {statusLabel[comparison.status]}
                </span>
              </div>

              {(comparison.status === "only-local" || comparison.status === "only-account") && (
                <div className="workspace-merge-actions">
                  <button
                    type="button"
                    className={projectSideChoices[comparison.key] === "merge" ? "primary" : "auth-secondary"}
                    onClick={() => setProjectSideChoices((current) => ({ ...current, [comparison.key]: "merge" }))}
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    className={projectSideChoices[comparison.key] === "discard" ? "primary" : "auth-secondary"}
                    onClick={() => setProjectSideChoices((current) => ({ ...current, [comparison.key]: "discard" }))}
                  >
                    Discard
                  </button>
                </div>
              )}

              {comparison.status === "different" && (
                <div className="workspace-merge-actions workspace-merge-project-actions">
                  <button
                    type="button"
                    className={projectConflictChoices[comparison.key] === "custom" ? "primary" : "auth-secondary"}
                    onClick={() => setProjectConflictChoices((current) => ({ ...current, [comparison.key]: "custom" }))}
                  >
                    Custom Merge
                  </button>
                  <button
                    type="button"
                    className={projectConflictChoices[comparison.key] === "account" ? "primary" : "auth-secondary"}
                    onClick={() => setProjectConflictChoices((current) => ({ ...current, [comparison.key]: "account" }))}
                  >
                    Account
                  </button>
                  <button
                    type="button"
                    className={projectConflictChoices[comparison.key] === "local" ? "primary" : "auth-secondary"}
                    onClick={() => setProjectConflictChoices((current) => ({ ...current, [comparison.key]: "local" }))}
                  >
                    Local
                  </button>
                  <button
                    type="button"
                    className={projectConflictChoices[comparison.key] === "copy-to-new" ? "primary" : "auth-secondary"}
                    onClick={() => setProjectConflictChoices((current) => ({ ...current, [comparison.key]: "copy-to-new" }))}
                  >
                    Copy To New
                  </button>
                </div>
              )}

              {comparison.status === "different" && projectConflictChoices[comparison.key] === "custom" && (
                <div className="workspace-merge-children">
                  {comparison.storeDifferent && (
                    <div className="workspace-merge-row workspace-merge-row-conflict">
                      <div>
                        <div className="workspace-merge-title">Project Data</div>
                        <div className="workspace-merge-meta">Items, recipes, tags, and other project store data differ.</div>
                      </div>
                      <div className="workspace-merge-actions">
                        <button
                          type="button"
                          className={projectStoreChoices[comparison.key] === "account" ? "primary" : "auth-secondary"}
                          onClick={() => setProjectStoreChoices((current) => ({ ...current, [comparison.key]: "account" }))}
                        >
                          Account
                        </button>
                        <button
                          type="button"
                          className={projectStoreChoices[comparison.key] === "local" ? "primary" : "auth-secondary"}
                          onClick={() => setProjectStoreChoices((current) => ({ ...current, [comparison.key]: "local" }))}
                        >
                          Local
                        </button>
                      </div>
                    </div>
                  )}

                  {comparison.graphs.map((graph) => (
                    <div key={graph.key} className={`workspace-merge-row ${graph.status === "same" ? "workspace-merge-row-same" : graph.status === "different" ? "workspace-merge-row-conflict" : "workspace-merge-row-warning"}`}>
                      <div>
                        <div className="workspace-merge-title">Graph: {graph.name}</div>
                        <div className="workspace-merge-meta">
                          {graph.status === "same" && "Graph data matches on both sides."}
                          {graph.status === "only-local" && "Graph exists only in the local guest workspace."}
                          {graph.status === "only-account" && "Graph exists only in the account workspace."}
                          {graph.status === "different" && "Graph contents differ between guest and account."}
                        </div>
                      </div>
                      <div className="workspace-merge-row-actions">
                        <span className={`workspace-merge-chip ${graph.status === "same" ? "same" : graph.status === "different" ? "conflict" : "warning"}`}>
                          {statusLabel[graph.status]}
                        </span>
                        {graph.status === "only-local" || graph.status === "only-account" ? (
                          <div className="workspace-merge-actions">
                            <button
                              type="button"
                              className={graphSideChoices[graph.key] === "merge" ? "primary" : "auth-secondary"}
                              onClick={() => setGraphSideChoices((current) => ({ ...current, [graph.key]: "merge" }))}
                            >
                              Merge
                            </button>
                            <button
                              type="button"
                              className={graphSideChoices[graph.key] === "discard" ? "primary" : "auth-secondary"}
                              onClick={() => setGraphSideChoices((current) => ({ ...current, [graph.key]: "discard" }))}
                            >
                              Discard
                            </button>
                          </div>
                        ) : graph.status === "different" ? (
                          <div className="workspace-merge-actions">
                            <button
                              type="button"
                              className={graphConflictChoices[graph.key] === "account" ? "primary" : "auth-secondary"}
                              onClick={() => setGraphConflictChoices((current) => ({ ...current, [graph.key]: "account" }))}
                            >
                              Account
                            </button>
                            <button
                              type="button"
                              className={graphConflictChoices[graph.key] === "local" ? "primary" : "auth-secondary"}
                              onClick={() => setGraphConflictChoices((current) => ({ ...current, [graph.key]: "local" }))}
                            >
                              Local
                            </button>
                            <button
                              type="button"
                              className={graphConflictChoices[graph.key] === "copy-to-new" ? "primary" : "auth-secondary"}
                              onClick={() => setGraphConflictChoices((current) => ({ ...current, [graph.key]: "copy-to-new" }))}
                            >
                              Copy To New
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {validationError && <p className="auth-error">{validationError}</p>}
        {error && <p className="auth-error">{error}</p>}

        <div className="auth-actions">
          <button className="auth-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
            Cancel Login
          </button>
          <button className="primary" type="button" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Applying Merge..." : "Continue Login"}
          </button>
        </div>
      </div>
    </div>
  );
}