import { useMemo } from "react";
import { inspectLuaModule, renderLuaSystem, resolveLuaRecipeParameters } from "../../domain/luaModuleRuntime";
import { type EffectiveRecipe, type ModuleDefinition, type ModuleSystemDefinition, type NodeModuleState, type RecipeModuleSupport } from "../../domain/moduleSystem";
import { useGraphStore } from "../../store/graphStore";
import LuaPrimitiveRenderer from "./LuaPrimitiveRenderer";

type Props = {
  supports: RecipeModuleSupport[];
  systems: ModuleSystemDefinition[];
  modules: ModuleDefinition[];
  value: NodeModuleState;
  diagnostics?: string[];
  effectiveRecipe?: EffectiveRecipe | null;
  evaluateState?: (state: NodeModuleState) => EffectiveRecipe;
  onChange: (value: NodeModuleState) => void;
};

export default function NodeModulePanel({ supports, systems, modules, value, diagnostics = [], effectiveRecipe, evaluateState, onChange }: Props) {
  const activeProjectId = useGraphStore((state) => state.activeProjectId);
  const orderedSupports = useMemo(
    () => [...supports].filter((support) => support.enabled).sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    [supports]
  );
  if (orderedSupports.length === 0) {
    return diagnostics.length ? <div className="node-module-panel nodrag nowheel">{diagnostics.map((message) => <div className="module-error" key={message}>{message}</div>)}</div> : null;
  }

  const updateSystem = (systemId: string, update: { slots?: Array<string | null>; values?: Record<string, number | boolean | string> }) => {
    onChange({ systems: { ...value.systems, [systemId]: { ...value.systems[systemId], ...update } } });
  };

  return (
    <div className="node-module-panel nodrag nowheel">
      {orderedSupports.map((support) => {
        const system = systems.find((entry) => entry.id === support.systemId && !entry.archived);
        if (!system) return <div className="module-error" key={support.systemId}>Missing system: {support.systemId}</div>;
        const systemState = value.systems[system.id] ?? { slots: [], values: {} };
        const allowedModules = modules.filter((entry) => entry.systemId === system.id && !entry.archived && !(support.disabledModuleIds ?? []).includes(entry.id));
        const rendered = renderLuaSystem(system.lua, {
          state: systemState.values ?? {},
          slots: systemState.slots ?? [],
          parameters: resolveLuaRecipeParameters(system.lua, support.parameters),
          modules: allowedModules.map((entry) => ({
            id: entry.id,
            name: entry.name,
            description: entry.description ?? "",
            properties: inspectLuaModule(entry.lua).value.properties
          })),
          resources: (system.resources ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
          recipe: effectiveRecipe ? {
            id: effectiveRecipe.recipeId,
            name: effectiveRecipe.title,
            time_seconds: effectiveRecipe.timeSeconds,
            inputs: effectiveRecipe.inputs.map((entry) => ({ id: entry.id, ref_type: entry.refType, ref_id: entry.refId, amount: entry.amount })),
            outputs: effectiveRecipe.outputs.map((entry) => ({ id: entry.id, item_id: entry.itemId, amount: entry.amount, probability: entry.probability }))
          } : { inputs: [], outputs: [] }
        });

        return (
          <div className="node-module-system" key={system.id}>
            <div className="node-module-title"><span>{system.name}</span><span className="node-module-revision">Lua · v{system.revision}</span></div>
            {rendered.error ? <div className="module-error">{rendered.error}</div> : null}
            {rendered.value ? (
              <LuaPrimitiveRenderer
                node={rendered.value}
                systemId={system.id}
                systemState={systemState}
                allowedModules={allowedModules}
                resources={system.resources ?? []}
                projectId={activeProjectId}
                fullState={value}
                effectiveRecipe={effectiveRecipe}
                evaluateState={evaluateState}
                onChange={(next) => updateSystem(system.id, next)}
              />
            ) : null}
          </div>
        );
      })}
      {diagnostics.map((message, index) => <div className="module-error" key={`${message}-${index}`}>{message}</div>)}
    </div>
  );
}
