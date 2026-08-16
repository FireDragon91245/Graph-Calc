import { Handle, NodeProps, Position, useReactFlow, useUpdateNodeInternals } from "reactflow";
import { useEffect, useMemo, useState } from "react";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";
import { useTranslation } from "react-i18next";
import { materializeEffectiveRecipe, type EffectiveRecipe, type NodeModuleState } from "../domain/moduleSystem";
import NodeModulePanel from "../components/modules/NodeModulePanel";
import { formatCycleTime, formatNodeNumber } from "../utils/numberFormat";

type Port = {
  id: string;
  name: string;
  itemId?: string;
  refId?: string;
  refType?: "item" | "tag";
  fixedRefId?: string;
  amountPerCycle: number;
  probability?: number;
};

type RecipeNodeData = {
  recipeId: string;
  title: string;
  timeSeconds: number;
  inputs: Port[];
  outputs: Port[];
  ghostInputs?: Port[];
  ghostOutputs?: Port[];
  moduleState?: NodeModuleState;
  effectiveRecipeCache?: EffectiveRecipe;
  unresolved?: boolean;
  solveData?: NodeFlowData;
};

export default function RecipeNode({ id, data }: NodeProps<RecipeNodeData>) {
  const { t } = useTranslation();
  const { setNodes, getEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const moduleDefinitions = useGraphStore((state) => state.moduleDefinitions);
  const moduleSystems = useGraphStore((state) => state.moduleSystems);
  const [showDetails, setShowDetails] = useState(false);
  const hasSolveData = Boolean(data.solveData);
  const itemNameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);
  const tagNameById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);

  const resolveInputId = (port: Port) => port.refId ?? port.fixedRefId ?? port.name;
  const resolveOutputId = (port: Port) => port.itemId ?? port.fixedRefId ?? port.name;
  const recipeTitle = recipes.find((recipe) => recipe.id === data.recipeId)?.name ?? data.title;
  const recipe = recipes.find((entry) => entry.id === data.recipeId);
  const effective = useMemo(
    () => recipe
      ? materializeEffectiveRecipe(recipe, { items, tags, moduleDefinitions, moduleSystems }, data.moduleState)
      : null,
    [recipe, items, tags, moduleDefinitions, moduleSystems, data.moduleState]
  );
  const visibleTimeSeconds = effective?.timeSeconds ?? data.timeSeconds;
  const visibleInputs: Port[] = effective?.inputs ?? data.inputs;
  const visibleOutputs: Port[] = effective?.outputs ?? data.outputs;

  useEffect(() => {
    if (!effective) return;
    updateNodeInternals(id);
  }, [effective?.fingerprint, id, updateNodeInternals]);
  const getInputLabel = (port: Port) => {
    const referencedId = port.refId ?? port.fixedRefId;
    if (!referencedId) {
      return port.name;
    }
    if (port.refType === "tag") {
      return tagNameById.get(referencedId) ?? port.name;
    }
    if (port.refType === "item") {
      return itemNameById.get(referencedId) ?? port.name;
    }
    return itemNameById.get(referencedId) ?? tagNameById.get(referencedId) ?? port.name;
  };
  const getOutputLabel = (port: Port) => {
    const referencedId = port.itemId ?? port.fixedRefId;
    return referencedId ? itemNameById.get(referencedId) ?? port.name : port.name;
  };

  const handleRecipeChange = (newRecipeId: string) => {
    const recipe = recipes.find((r) => r.id === newRecipeId);
    if (!recipe) return;

    // Build new ports data
    const inputs = recipe.inputs.map((input) => {
      const name =
        input.refType === "item"
          ? items.find((item) => item.id === input.refId)?.name ?? input.refId
          : tags.find((tag) => tag.id === input.refId)?.name ?? input.refId;

      return {
        id: input.id,
        name,
        refId: input.refId,
        refType: input.refType,
        amountPerCycle: input.amount
      };
    });

    const outputs = recipe.outputs.map((output) => ({
      id: output.id,
      itemId: output.itemId,
      name: items.find((item) => item.id === output.itemId)?.name ?? output.itemId,
      amountPerCycle: output.amount,
      probability: output.probability
    }));

    // Update node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const edges = getEdges();
          const ghostInputs = [...(node.data.ghostInputs ?? []), ...(node.data.inputs ?? [])].filter((port: Port, index: number, all: Port[]) =>
            !inputs.some((current) => current.id === port.id) &&
            edges.some((edge) => edge.target === id && edge.targetHandle === `input-${port.id}`) &&
            all.findIndex((candidate) => candidate.id === port.id) === index
          );
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
              inputs,
              outputs,
              ghostInputs,
              ghostOutputs,
              moduleState: undefined,
              effectiveRecipeCache: undefined,
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
    setNodes((nodes) => nodes.map((node) => node.id === id ? {
      ...node,
      data: {
        ...node.data,
        moduleState,
        effectiveRecipeCache: nextEffective,
        timeSeconds: nextEffective.timeSeconds,
        inputs: nextEffective.inputs,
        outputs: nextEffective.outputs,
        solveData: undefined
      }
    } : node));
  };

  return (
    <div className="node recipe">
      <div className="node-header">
        <SearchableDropdown
          className="recipe-dropdown"
          value={data.recipeId}
          options={recipes.map((r) => ({ value: r.id, label: r.name }))}
          onChange={handleRecipeChange}
          placeholder={t("ui.nodes.selectRecipe")}
        />
        <span className="node-sub cycle-time" title={`${visibleTimeSeconds}s`}>{formatCycleTime(visibleTimeSeconds)}</span>
        {hasSolveData ? (
          <span className="node-badge" title={t("ui.nodes.totalInput")}>
            ↓ {(data.solveData?.totalInput ?? 0).toFixed(2)}/s
          </span>
        ) : null}
        {data.solveData?.machineCount !== undefined ? (
          <span className="node-badge" title={t("ui.nodes.machineCount")}>
            🏭 {(data.solveData.machineCount ?? 0).toFixed(2)}
          </span>
        ) : null}
        {hasSolveData ? (
          <span className="node-badge" title={t("ui.nodes.totalOutput")}>
            ↑ {(data.solveData?.totalOutput ?? 0).toFixed(2)}/s
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
      <div className="node-body">
        {data.unresolved ? <div className="node-project-warning">Recipe removed from project. Choose a replacement.</div> : null}
        <div className="ports">
          <div className="port-col">
            {visibleInputs.map((input) => {
              const itemId = resolveInputId(input);
              const flowRate = data.solveData?.inputFlows[itemId] ?? 0;
              return (
                <div key={input.id} className="port-row">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`input-${input.id}`}
                    className="handle"
                    isConnectableStart={true}
                  />
                  <span className="port-name">{getInputLabel(input)}</span>
                  <span className="port-amount">{formatNodeNumber(input.amountPerCycle)}</span>
                  {hasSolveData && (
                    <span className="port-rate" title={t("ui.nodes.actualFlow")}>
                      {flowRate.toFixed(2)}/s
                    </span>
                  )}
                </div>
              );
            })}
            {(data.ghostInputs ?? []).map((input) => (
              <div key={`ghost-${input.id}`} className="port-row ghost-port" title="This project update removed the port. Reconnect or delete its edge.">
                <Handle type="target" position={Position.Left} id={`input-${input.id}`} className="handle ghost" />
                <span className="port-name">Removed: {getInputLabel(input)}</span>
              </div>
            ))}
          </div>
          <div className="port-col">
            {visibleOutputs.map((output) => {
              const itemId = resolveOutputId(output);
              const flowRate = data.solveData?.outputFlows[itemId] ?? 0;
              return (
                <div key={output.id} className="port-row right">
                  {hasSolveData && (
                    <span className="port-rate" title={t("ui.nodes.actualFlow")}>
                      {flowRate.toFixed(2)}/s
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
              );
            })}
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
            <div className="node-detail-title">{t("ui.nodes.recipeDetails")}</div>
            <div className="node-detail-row">
              <span>{recipeTitle}</span>
              <span title={`${visibleTimeSeconds}s`}>{formatCycleTime(visibleTimeSeconds)}</span>
            </div>
            <div className="node-detail-row">
              <span>{t("ui.nodes.machines")}</span>
              <span>{(data.solveData.machineCount ?? 0).toFixed(2)}</span>
            </div>
            {visibleInputs.map((input) => {
              const itemId = resolveInputId(input);
              const machineCount = data.solveData?.machineCount ?? 0;
              const expectedRate = visibleTimeSeconds > 0 ? (machineCount * input.amountPerCycle) / visibleTimeSeconds : 0;
              const actualRate = data.solveData?.inputFlows[itemId] ?? 0;
              const pct = expectedRate > 0 ? (actualRate / expectedRate) * 100 : 0;
              return (
                <div key={`in-${input.id}`} className="node-detail-item">
                  <div className="node-detail-row">
                    <span className="flow-name">IN • {getInputLabel(input)}</span>
                    <span>{actualRate.toFixed(2)}/s</span>
                  </div>
                  <div className="node-detail-subrow">
                    <span>{input.amountPerCycle.toFixed(2)}/cycle</span>
                    <span>expected {expectedRate.toFixed(2)}/s</span>
                    <span>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
            {visibleOutputs.map((output) => {
              const itemId = resolveOutputId(output);
              const machineCount = data.solveData?.machineCount ?? 0;
              const chance = output.probability ?? 1;
              const expectedRate = visibleTimeSeconds > 0 ? (machineCount * output.amountPerCycle * chance) / visibleTimeSeconds : 0;
              const actualRate = data.solveData?.outputFlows[itemId] ?? 0;
              const pct = expectedRate > 0 ? (actualRate / expectedRate) * 100 : 0;
              return (
                <div key={`out-${output.id}`} className="node-detail-item">
                  <div className="node-detail-row">
                    <span className="flow-name">OUT • {getOutputLabel(output)}</span>
                    <span>{actualRate.toFixed(2)}/s</span>
                  </div>
                  <div className="node-detail-subrow">
                    <span>{output.amountPerCycle.toFixed(2)}/cycle • {Math.round(chance * 100)}%</span>
                    <span>expected {expectedRate.toFixed(2)}/s</span>
                    <span>{pct.toFixed(1)}%</span>
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
