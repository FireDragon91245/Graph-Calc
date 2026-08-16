import type { ModuleDefinition, ModuleSystemDefinition, RecipeModuleSupport } from "../../domain/moduleSystem";

type Props = {
  value: RecipeModuleSupport[];
  systems: ModuleSystemDefinition[];
  modules: ModuleDefinition[];
  onChange: (value: RecipeModuleSupport[]) => void;
};

export default function RecipeModuleSupportEditor({ value, systems, modules, onChange }: Props) {
  const activeSystems = systems.filter((system) => !system.archived);
  if (activeSystems.length === 0) {
    return <div className="module-support-empty">Create an upgrade system in Configuration → Modules before enabling recipe upgrades.</div>;
  }

  const update = (systemId: string, patch: Partial<RecipeModuleSupport>) => {
    const existing = value.find((entry) => entry.systemId === systemId);
    const next = existing
      ? value.map((entry) => entry.systemId === systemId ? { ...entry, ...patch } : entry)
      : [...value, { systemId, enabled: true, order: value.length, slotCount: 0, disabledModuleIds: [], ...patch }];
    onChange(next);
  };

  return (
    <div className="recipe-module-support">
      <div className="recipe-module-support-title">Modules and upgrades</div>
      {activeSystems.map((system) => {
        const support = value.find((entry) => entry.systemId === system.id);
        const enabled = support?.enabled ?? false;
        const hasSlots = system.controls.some((control) => control.type === "slots");
        const systemModules = modules.filter((module) => module.systemId === system.id && !module.archived);
        const disabled = new Set(support?.disabledModuleIds ?? []);
        return (
          <div className={`recipe-module-support-system ${enabled ? "enabled" : ""}`} key={system.id}>
            <label className="module-support-heading">
              <input type="checkbox" checked={enabled} onChange={(event) => update(system.id, { enabled: event.target.checked })} />
              <span>{system.name}</span>
              <small>v{system.revision}</small>
            </label>
            {enabled && hasSlots ? (
              <div className="module-support-options">
                <label>
                  Slots
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={support?.slotCount ?? 0}
                    onChange={(event) => update(system.id, { slotCount: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </label>
                <div className="module-support-allowed">
                  <span>Modules enabled for this recipe</span>
                  {systemModules.map((module) => (
                    <label key={module.id}>
                      <input
                        type="checkbox"
                        checked={!disabled.has(module.id)}
                        onChange={(event) => {
                          const next = new Set(disabled);
                          event.target.checked ? next.delete(module.id) : next.add(module.id);
                          update(system.id, { disabledModuleIds: Array.from(next) });
                        }}
                      />
                      {module.name}
                    </label>
                  ))}
                  {systemModules.length === 0 ? <small>This system does not own any modules yet.</small> : <small>Turn off only the modules this recipe cannot use.</small>}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
