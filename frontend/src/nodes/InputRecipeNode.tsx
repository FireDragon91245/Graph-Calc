import { ChangeEvent, useMemo, useState } from "react";
import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";
import { useTranslation } from "react-i18next";
import { materializeEffectiveRecipe, type NodeModuleState } from "../domain/moduleSystem";
import NodeModulePanel from "../components/modules/NodeModulePanel";
import { formatCycleTime, formatNodeNumber } from "../utils/numberFormat";

type Port = {
  id: string;
  itemId?: string;
  name: string;
  amountPerCycle: number;
  probability?: number;
};

type InputRecipeNodeData = {
  recipeId: string;
  title: string;
  timeSeconds: number;
  outputs: Port[];
  ghostOutputs?: Port[];
  multiplier?: number;
  moduleState?: NodeModuleState;
  unresolved?: boolean;
  solveData?: NodeFlowData;
};

export default function InputRecipeNode({ id, data }: NodeProps<InputRecipeNodeData>) {
  const { t } = useTranslation();
  const { setNodes, getEdges } = useReactFlow();
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const moduleDefinitions = useGraphStore((state) => state.moduleDefinitions);
  const moduleSystems = useGraphStore((state) => state.moduleSystems);
  const [showDetails, setShowDetails] = useState(false);
  const multiplier = typeof data.multiplier === "number" && Number.isFinite(data.multiplier) ? data.multiplier : 1;
  const hasSolveData = Boolean(data.solveData);
  const itemNameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);
  const itemIdByName = useMemo(() => new Map(items.map((item) => [item.name, item.id])), [items]);
  const recipeTitle = recipes.find((recipe) => recipe.id === data.recipeId)?.name ?? data.title;
  const recipe = recipes.find((entry) => entry.id === data.recipeId);
  const effective = useMemo(() => recipe
    ? materializeEffectiveRecipe(recipe, { items, tags, moduleDefinitions, moduleSystems }, data.moduleState)
    : null, [recipe, items, tags, moduleDefinitions, moduleSystems, data.moduleState]);

  const resolveItemId = (output: Port) => output.itemId ?? itemIdByName.get(output.name) ?? output.name;
  const getOutputLabel = (output: Port) => {
    const itemId = output.itemId;
    return itemId ? itemNameById.get(itemId) ?? output.name : output.name;
  };

  const buildOutputs = (recipeId: string, nextMultiplier: number) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return data.outputs;
    const materialized = materializeEffectiveRecipe(recipe, { items, tags, moduleDefinitions, moduleSystems }, data.moduleState);
    return materialized.outputs.map((output) => ({
      id: output.id,
      itemId: output.itemId,
      name: output.name,
      amountPerCycle: output.amountPerCycle * nextMultiplier,
      probability: output.probability
    }));
  };

  const handleRecipeChange = (newRecipeId: string) => {
    const recipe = recipes.find((r) => r.id === newRecipeId);
    if (!recipe) return;

    // Build new outputs data
    const outputs = buildOutputs(recipe.id, multiplier);

    // Update node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const edges = getEdges();
          const ghostOutputs = [...(node.data.ghostOutputs ?? []), ...(node.data.outputs ?? [])].filter((port: Port, index: number, all: Port[]) =>
            !outputs.some((current) => current.id === port.id) &&
            edges.some((edge) => edge.source === id && edge.sourceHandle === `output-${port.id}`) &&
            all.findIndex((candidate) => candidate.id === port.id) === index
          );
          return {
            ...node,
            data: {
              ...node.data,
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
              outputs,
              ghostOutputs,
              multiplier,
              moduleState: undefined,
              effectiveFingerprint: undefined,
              unresolved: false,
              solveData: undefined
            }
          };
        }
        return node;
      })
    );
  };

  const handleModuleStateChange = (moduleState: NodeModuleState) => {
    if (!recipe) return;
    const nextEffective = materializeEffectiveRecipe(recipe, { items, tags, moduleDefinitions, moduleSystems }, moduleState);
    const outputs = nextEffective.outputs.map((output) => ({ ...output, amountPerCycle: output.amount * multiplier }));
    setNodes((nodes) => nodes.map((node) => node.id === id ? {
      ...node,
      data: { ...node.data, moduleState, timeSeconds: nextEffective.timeSeconds, outputs, solveData: undefined }
    } : node));
  };

  const handleMultiplierChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    const nextMultiplier = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    const outputs = buildOutputs(data.recipeId, nextMultiplier);

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              multiplier: nextMultiplier,
              outputs
            }
          };
        }
        return node;
      })
    );
  };

  return (
    <div className="node io input-recipe">
      <div className="node-header">
        <SearchableDropdown
          className="recipe-dropdown"
          value={data.recipeId}
          options={recipes.map((r) => ({ value: r.id, label: r.name }))}
          onChange={handleRecipeChange}
          placeholder={t("ui.nodes.selectRecipe")}
        />
        <div className="node-meta">
          <input
            className="multiplier-input nodrag"
            type="number"
            min="0"
            step="1"
            value={multiplier}
            onChange={handleMultiplierChange}
            aria-label={t("ui.nodes.recipeMultiplier")}
          />
          <span className="node-sub">x</span>
          <span className="node-sub cycle-time" title={`${data.timeSeconds}s`}>{formatCycleTime(data.timeSeconds)}</span>
          {data.solveData?.totalOutput ? (
            <span className="node-badge" title={t("ui.nodes.utilizedRate")}>
              ↑ {data.solveData.totalOutput.toFixed(2)}/s
            </span>
          ) : null}
          <button
            className="node-detail-btn"
            onClick={() => hasSolveData && setShowDetails((prev) => !prev)}
            disabled={!hasSolveData}
            title={hasSolveData ? t("ui.nodes.showDetails") : t("ui.nodes.runSolver")}
          >
            ...
          </button>
        </div>
      </div>
      <div className="node-body">
        {data.unresolved ? <div className="node-project-warning">Recipe removed from project. Choose a replacement.</div> : null}
        <div className="ports single-col">
          <div className="port-col">
            {data.outputs.map((output) => (
              <div key={output.id} className="port-row right">
                {data.solveData && (
                  <span className="port-rate" title={t("ui.nodes.actualOutput")}>
                    {(data.solveData.outputFlows[resolveItemId(output)] ?? 0).toFixed(2)}/s
                  </span>
                )}
                <span className="port-amount">{formatNodeNumber(output.amountPerCycle)}</span>
                <span className="port-name">{getOutputLabel(output)}</span>
                {output.probability !== undefined && output.probability < 1 ? (
                  <span className="prob">{Math.round(output.probability * 100)}%</span>
                ) : null}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`output-${output.id}`}
                  className="handle"
                />
              </div>
            ))}
            {(data.ghostOutputs ?? []).map((output) => (
              <div key={`ghost-${output.id}`} className="port-row right ghost-port" title="This project update removed the port. Reconnect or delete its edge.">
                <span className="port-name">Removed: {getOutputLabel(output)}</span>
                <Handle type="source" position={Position.Right} id={`output-${output.id}`} className="handle ghost" />
              </div>
            ))}
          </div>
        </div>
        {showDetails && data.solveData ? (
          <div className="node-detail-panel">
            <div className="node-detail-title">{t("ui.nodes.inputRecipeDetails")}</div>
            <div className="node-detail-row">
              <span>{recipeTitle}</span>
              <span title={`${data.timeSeconds}s`}>x{formatNodeNumber(multiplier)} • {formatCycleTime(data.timeSeconds)}</span>
            </div>
            {data.outputs.map((output) => {
              const itemId = resolveItemId(output);
              const actualUsed = data.solveData?.outputFlows[itemId] ?? 0;
              const chance = output.probability ?? 1;
              const producedRate = data.timeSeconds > 0 ? (output.amountPerCycle * chance) / data.timeSeconds : 0;
              return (
                <div key={`detail-${output.id}`} className="node-detail-item">
                  <div className="node-detail-row">
                    <span className="flow-name">{getOutputLabel(output)}</span>
                    <span className="flow-rate">{actualUsed.toFixed(2)}/s used</span>
                  </div>
                  <div className="node-detail-subrow">
                    <span>{output.amountPerCycle.toFixed(2)} / cycle</span>
                    <span>{Math.round(chance * 100)}%</span>
                    <span>{producedRate.toFixed(2)}/s produced</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {recipe && effective ? (
          <NodeModulePanel
            supports={recipe.moduleSupport ?? []}
            systems={moduleSystems}
            modules={moduleDefinitions}
            value={effective.moduleState}
            diagnostics={effective.diagnostics.map((diagnostic) => diagnostic.message)}
            effectiveRecipe={effective}
            evaluateState={(moduleState) => materializeEffectiveRecipe(recipe, { items, tags, moduleDefinitions, moduleSystems }, moduleState)}
            onChange={handleModuleStateChange}
          />
        ) : null}
      </div>
    </div>
  );
}
