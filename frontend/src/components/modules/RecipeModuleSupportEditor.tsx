import { inspectLuaSystem, resolveLuaRecipeParameters } from "../../domain/luaModuleRuntime";
import type { ModuleDefinition, ModuleSystemDefinition, ModuleValue, RecipeModuleSupport } from "../../domain/moduleSystem";

type Props = {
  value: RecipeModuleSupport[];
  systems: ModuleSystemDefinition[];
  modules: ModuleDefinition[];
  onChange: (value: RecipeModuleSupport[]) => void;
};

export default function RecipeModuleSupportEditor({ value, systems, modules, onChange }: Props) {
  const activeSystems = systems.filter((system) => !system.archived);
  if (activeSystems.length === 0) return <div className="module-support-empty">Create a Lua upgrade system in Configuration → Modules first.</div>;

  const update = (systemId: string, patch: Partial<RecipeModuleSupport>) => {
    const existing = value.find((entry) => entry.systemId === systemId);
    const next = existing
      ? value.map((entry) => entry.systemId === systemId ? { ...entry, ...patch } : entry)
      : [...value, { systemId, enabled: true, order: value.length, parameters: {}, disabledModuleIds: [], ...patch }];
    onChange(next);
  };

  return (
    <div className="recipe-module-support">
      <div className="recipe-module-support-title">Lua module systems</div>
      {activeSystems.map((system) => {
        const support = value.find((entry) => entry.systemId === system.id);
        const enabled = support?.enabled ?? false;
        const systemModules = modules.filter((module) => module.systemId === system.id && !module.archived);
        const disabled = new Set(support?.disabledModuleIds ?? []);
        const inspection = inspectLuaSystem(system.lua);
        const parameterValues = resolveLuaRecipeParameters(system.lua, support?.parameters);
        const setParameter = (id: string, parameterValue: ModuleValue) => update(system.id, { parameters: { ...parameterValues, [id]: parameterValue } });
        const enable = (nextEnabled: boolean) => {
          const defaults = Object.fromEntries(inspection.value.parameters.map((parameter) => [parameter.id, parameter.defaultValue ?? (parameter.type === "toggle" ? false : parameter.type === "number" ? parameter.min ?? 0 : "")]));
          update(system.id, { enabled: nextEnabled, parameters: { ...defaults, ...parameterValues } });
        };
        return (
          <div className={`recipe-module-support-system ${enabled ? "enabled" : ""}`} key={system.id}>
            <label className="module-support-heading">
              <input type="checkbox" checked={enabled} onChange={(event) => enable(event.target.checked)} />
              <span>{system.name}</span><small>Lua · v{system.revision}</small>
            </label>
            {enabled ? (
              <div className="module-support-options lua-recipe-parameters">
                {inspection.error ? <div className="module-error">{inspection.error}</div> : null}
                {inspection.value.parameters.map((parameter) => {
                  const current = parameterValues[parameter.id] ?? parameter.defaultValue ?? (parameter.type === "toggle" ? false : parameter.type === "number" ? parameter.min ?? 0 : "");
                  const controlId = `module-parameter-${system.id}-${parameter.id}`;
                  if (parameter.type === "toggle") return (
                    <div key={parameter.id} className="lua-recipe-parameter lua-recipe-parameter-toggle">
                      <label htmlFor={controlId} className="lua-recipe-toggle"><input id={controlId} type="checkbox" checked={current === true} onChange={(event) => setParameter(parameter.id, event.target.checked)} /><span>{parameter.label}</span></label>
                      {parameter.description ? <small>{parameter.description}</small> : null}
                    </div>
                  );
                  if (parameter.type === "select") return (
                    <div key={parameter.id} className="lua-recipe-parameter">
                      <label htmlFor={controlId} className="lua-recipe-parameter-label">{parameter.label}</label>
                      <select id={controlId} value={String(current)} onChange={(event) => setParameter(parameter.id, event.target.value)}>{parameter.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
                      {parameter.description ? <small>{parameter.description}</small> : null}
                    </div>
                  );
                  return (
                    <div key={parameter.id} className="lua-recipe-parameter">
                      <label htmlFor={controlId} className="lua-recipe-parameter-label">{parameter.label}</label>
                      <input
                        id={controlId}
                        type={parameter.type === "number" ? "number" : "text"}
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.integer ? 1 : parameter.step}
                        placeholder={parameter.placeholder}
                        value={typeof current === "string" || typeof current === "number" ? current : ""}
                        onChange={(event) => setParameter(parameter.id, parameter.type === "number" ? Number(event.target.value) : event.target.value)}
                      />
                      {parameter.description ? <small>{parameter.description}</small> : null}
                    </div>
                  );
                })}
                {systemModules.length ? (
                  <div className="module-support-allowed">
                    <span className="module-support-allowed-title">Modules enabled for this recipe</span>
                    <div className="module-support-module-list">{systemModules.map((module) => <label key={module.id}><input type="checkbox" checked={!disabled.has(module.id)} onChange={(event) => {
                        const next = new Set(disabled);
                        event.target.checked ? next.delete(module.id) : next.add(module.id);
                        update(system.id, { disabledModuleIds: [...next] });
                      }} /><span>{module.name}</span></label>)}</div>
                    <small>Every child module is enabled unless explicitly turned off here.</small>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
