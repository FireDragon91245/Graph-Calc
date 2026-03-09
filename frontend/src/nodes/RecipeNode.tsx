import { Handle, NodeProps, Position, useReactFlow } from "reactflow";
import { useMemo, useState } from "react";
import { useGraphStore } from "../store/graphStore";
import SearchableDropdown from "../editor/SearchableDropdown";
import type { NodeFlowData } from "../api/solve";

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
  solveData?: NodeFlowData;
};

export default function RecipeNode({ id, data }: NodeProps<RecipeNodeData>) {
  const { setNodes, getEdges, setEdges } = useReactFlow();
  const recipes = useGraphStore((state) => state.recipes);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const [showDetails, setShowDetails] = useState(false);
  const hasSolveData = Boolean(data.solveData);
  const itemNameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);
  const tagNameById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);

  const resolveInputId = (port: Port) => port.refId ?? port.fixedRefId ?? port.name;
  const resolveOutputId = (port: Port) => port.itemId ?? port.fixedRefId ?? port.name;
  const recipeTitle = recipes.find((recipe) => recipe.id === data.recipeId)?.name ?? data.title;
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

    // Delete all edges connected to this node
    const edges = getEdges();
    setEdges(edges.filter((edge) => edge.source !== id && edge.target !== id));

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
          return {
            ...node,
            data: {
              recipeId: recipe.id,
              title: recipe.name,
              timeSeconds: recipe.timeSeconds,
              inputs,
              outputs
            }
          };
        }
        return node;
      })
    );
  };

  return (
    <div className="node recipe">
      <div className="node-header">
        <SearchableDropdown
          className="recipe-dropdown"
          value={data.recipeId}
          options={recipes.map((r) => ({ value: r.id, label: r.name }))}
          onChange={handleRecipeChange}
          placeholder="Select recipe"
        />
        <span className="node-sub">{data.timeSeconds}s</span>
        {hasSolveData ? (
          <span className="node-badge" title="Total input flow">
            ↓ {(data.solveData?.totalInput ?? 0).toFixed(2)}/s
          </span>
        ) : null}
        {data.solveData?.machineCount !== undefined ? (
          <span className="node-badge" title="Machine Count">
            🏭 {(data.solveData.machineCount ?? 0).toFixed(2)}
          </span>
        ) : null}
        {hasSolveData ? (
          <span className="node-badge" title="Total output flow">
            ↑ {(data.solveData?.totalOutput ?? 0).toFixed(2)}/s
          </span>
        ) : null}
        <button
          className="node-detail-btn"
          onClick={() => hasSolveData && setShowDetails((prev) => !prev)}
          disabled={!hasSolveData}
          title={hasSolveData ? "Show details" : "Run solver first"}
        >
          ...
        </button>
      </div>
      <div className="node-body">
        <div className="ports">
          <div className="port-col">
            {data.inputs.map((input) => {
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
                  <span className="port-amount">{input.amountPerCycle}</span>
                  {hasSolveData && (
                    <span className="port-rate" title="Actual flow rate">
                      {flowRate.toFixed(2)}/s
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="port-col">
            {data.outputs.map((output) => {
              const itemId = resolveOutputId(output);
              const flowRate = data.solveData?.outputFlows[itemId] ?? 0;
              return (
                <div key={output.id} className="port-row right">
                  {hasSolveData && (
                    <span className="port-rate" title="Actual flow rate">
                      {flowRate.toFixed(2)}/s
                    </span>
                  )}
                  <span className="port-amount">{output.amountPerCycle}</span>
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
          </div>
        </div>
        {showDetails && data.solveData ? (
          <div className="node-detail-panel">
            <div className="node-detail-title">Recipe Details</div>
            <div className="node-detail-row">
              <span>{recipeTitle}</span>
              <span>{data.timeSeconds}s</span>
            </div>
            <div className="node-detail-row">
              <span>Machines</span>
              <span>{(data.solveData.machineCount ?? 0).toFixed(2)}</span>
            </div>
            {data.inputs.map((input) => {
              const itemId = resolveInputId(input);
              const machineCount = data.solveData?.machineCount ?? 0;
              const expectedRate = data.timeSeconds > 0 ? (machineCount * input.amountPerCycle) / data.timeSeconds : 0;
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
            {data.outputs.map((output) => {
              const itemId = resolveOutputId(output);
              const machineCount = data.solveData?.machineCount ?? 0;
              const chance = output.probability ?? 1;
              const expectedRate = data.timeSeconds > 0 ? (machineCount * output.amountPerCycle * chance) / data.timeSeconds : 0;
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
      </div>
    </div>
  );
}
