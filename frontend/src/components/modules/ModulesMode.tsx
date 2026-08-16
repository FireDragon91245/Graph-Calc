import { useMemo, useState } from "react";
import { useGraphStore } from "../../store/graphStore";
import type { ModuleDefinition, ModuleEffect, ModuleSystemDefinition, ModuleUiControl } from "../../domain/moduleSystem";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const SPEED_EFFECTS: ModuleEffect[] = [{
  id: "speed",
  target: "cycleTime",
  operation: "divide",
  source: "moduleCount",
  offset: 1,
  coefficient: 0.5
}];

const SLOT_CONTROLS: ModuleUiControl[] = [{ id: "slots", type: "slots", label: "Module slots", stateKey: "slots" }];
const OVERCLOCK_CONTROLS: ModuleUiControl[] = [
  { id: "clock-slider", type: "slider", label: "Clock speed", stateKey: "clockPercent", min: 1, max: 250, step: 0.01, defaultValue: 100, suffix: "%" },
  { id: "target-output-rate", type: "targetOutputRate", label: "Target output rate", stateKey: "targetOutputRate", drivesStateKey: "clockPercent", min: 0, step: 0.01, suffix: "/s" }
];
const OVERCLOCK_EFFECTS: ModuleEffect[] = [{
  id: "clock-speed",
  target: "cycleTime",
  operation: "divide",
  source: "stateNumber",
  stateKey: "clockPercent",
  coefficient: 0.01
}];

type BasicModuleKind = "speed" | "productivity" | "efficiency";

const buildBasicEffects = (kind: BasicModuleKind, percent: number): ModuleEffect[] => {
  const ratio = Math.max(0, percent) / 100;
  if (kind === "speed") {
    return [{ id: "speed", target: "cycleTime", operation: "divide", source: "moduleCount", offset: 1, coefficient: ratio }];
  }
  if (kind === "productivity") {
    return [{ id: "productivity", target: "outputAmount", operation: "multiply", source: "moduleCount", offset: 1, coefficient: ratio }];
  }
  return [{ id: "efficiency", target: "inputAmount", operation: "multiply", source: "moduleCount", offset: 1, coefficient: -ratio }];
};

const validateEffects = (value: unknown): ModuleEffect[] => {
  if (!Array.isArray(value)) throw new Error("Effects must be a JSON array.");
  const targets = new Set(["cycleTime", "inputAmount", "outputAmount", "outputProbability", "addInput", "addOutput"]);
  const operations = new Set(["add", "multiply", "divide", "set", "remove"]);
  value.forEach((effect, index) => {
    if (!effect || typeof effect !== "object") throw new Error(`Effect ${index + 1} must be an object.`);
    const candidate = effect as Partial<ModuleEffect>;
    if (!candidate.id || !targets.has(candidate.target ?? "")) throw new Error(`Effect ${index + 1} has an invalid id or target.`);
    if (!operations.has(candidate.operation ?? "")) throw new Error(`Effect ${index + 1} has an invalid operation.`);
    if ((candidate.target === "addInput" || candidate.target === "addOutput") && (!candidate.port?.key || !candidate.port.refId)) {
      throw new Error(`Effect ${index + 1} must define port.key and port.refId.`);
    }
  });
  return value as ModuleEffect[];
};

const validateControls = (value: unknown): ModuleUiControl[] => {
  if (!Array.isArray(value)) throw new Error("Controls must be a JSON array.");
  const types = new Set(["slots", "slider", "number", "toggle", "targetOutputRate"]);
  value.forEach((control, index) => {
    if (!control || typeof control !== "object") throw new Error(`Control ${index + 1} must be an object.`);
    const candidate = control as Partial<ModuleUiControl>;
    if (!candidate.id || !candidate.label || !candidate.stateKey || !types.has(candidate.type ?? "")) {
      throw new Error(`Control ${index + 1} requires a valid id, type, label, and stateKey.`);
    }
    if ((candidate.type === "slider" || candidate.type === "number") && candidate.min !== undefined && candidate.max !== undefined && candidate.min > candidate.max) {
      throw new Error(`Control ${index + 1} has min greater than max.`);
    }
    if (candidate.type === "targetOutputRate" && !candidate.drivesStateKey) {
      throw new Error(`Target output control ${index + 1} requires drivesStateKey.`);
    }
  });
  for (const control of value as ModuleUiControl[]) {
    if (control.type === "targetOutputRate" && !value.some((candidate) => {
      const driven = candidate as Partial<ModuleUiControl>;
      return driven.stateKey === control.drivesStateKey && (driven.type === "slider" || driven.type === "number");
    })) {
      throw new Error(`Target output control ${control.id} must drive a slider or number control in the same system.`);
    }
  }
  return value as ModuleUiControl[];
};

export default function ModulesMode() {
  const definitions = useGraphStore((state) => state.moduleDefinitions);
  const systems = useGraphStore((state) => state.moduleSystems);
  const upsertDefinition = useGraphStore((state) => state.upsertModuleDefinition);
  const deleteDefinition = useGraphStore((state) => state.deleteModuleDefinition);
  const upsertSystem = useGraphStore((state) => state.upsertModuleSystem);
  const deleteSystem = useGraphStore((state) => state.deleteModuleSystem);

  const [moduleId, setModuleId] = useState("");
  const [moduleSystemId, setModuleSystemId] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleEffects, setModuleEffects] = useState(pretty(SPEED_EFFECTS));
  const [basicModuleKind, setBasicModuleKind] = useState<BasicModuleKind>("speed");
  const [basicModulePercent, setBasicModulePercent] = useState(50);
  const [systemId, setSystemId] = useState("");
  const [systemName, setSystemName] = useState("");
  const [systemDescription, setSystemDescription] = useState("");
  const [systemControls, setSystemControls] = useState(pretty(SLOT_CONTROLS));
  const [systemEffects, setSystemEffects] = useState(pretty([]));
  const [error, setError] = useState<string | null>(null);

  const activeDefinitions = useMemo(() => definitions.filter((entry) => !entry.archived), [definitions]);
  const activeSystems = useMemo(() => systems.filter((entry) => !entry.archived), [systems]);

  const loadModule = (definition: ModuleDefinition) => {
    setModuleId(definition.id);
    setModuleSystemId(definition.systemId);
    setModuleName(definition.name);
    setModuleDescription(definition.description ?? "");
    setModuleEffects(pretty(definition.effects));
    setError(null);
  };

  const saveModule = () => {
    try {
      const effects = validateEffects(JSON.parse(moduleEffects));
      if (!moduleName.trim()) throw new Error("A module name is required.");
      const ownerSystemId = moduleSystemId || activeSystems[0]?.id;
      if (!ownerSystemId) throw new Error("Create or select an owning upgrade system first.");
      upsertDefinition({ id: moduleId || `${ownerSystemId}:${slug(moduleName)}`, systemId: ownerSystemId, name: moduleName.trim(), description: moduleDescription.trim(), effects });
      setModuleId("");
      setModuleName("");
      setModuleDescription("");
      setModuleEffects(pretty(SPEED_EFFECTS));
      setError(null);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Invalid module definition.");
    }
  };

  const loadSystem = (system: ModuleSystemDefinition) => {
    setSystemId(system.id);
    setSystemName(system.name);
    setSystemDescription(system.description ?? "");
    setSystemControls(pretty(system.controls));
    setSystemEffects(pretty(system.effects));
    setError(null);
  };

  const saveSystem = () => {
    try {
      const controls = validateControls(JSON.parse(systemControls));
      const effects = validateEffects(JSON.parse(systemEffects));
      if (!systemName.trim()) throw new Error("A system name is required.");
      const existing = systems.find((entry) => entry.id === systemId);
      const nextSystemId = systemId || slug(systemName);
      upsertSystem({
        id: nextSystemId,
        name: systemName.trim(),
        description: systemDescription.trim(),
        revision: existing?.revision ?? 1,
        controls,
        effects
      });
      setSystemId("");
      setSystemName("");
      setSystemDescription("");
      setSystemControls(pretty(SLOT_CONTROLS));
      setSystemEffects(pretty([]));
      if (!moduleSystemId) setModuleSystemId(nextSystemId);
      setError(null);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Invalid upgrade system.");
    }
  };

  return (
    <div className="config-mode-content modules-mode">
      <div className="config-sidebar modules-library">
        <div className="config-section">
          <h3>Upgrade systems</h3>
          <p className="module-help">Each system owns its modules. Recipes may disable individual modules, but cannot import modules from another system.</p>
          {activeSystems.map((system) => (
            <div className="module-system-tree" key={system.id}>
              <div className="module-library-row module-system-row">
                <button onClick={() => { loadSystem(system); setModuleSystemId(system.id); }}>{system.name} <small>v{system.revision}</small></button>
                <button className="btn-remove" onClick={() => deleteSystem(system.id)}>×</button>
              </div>
              <div className="module-system-children">
                {activeDefinitions.filter((definition) => definition.systemId === system.id).map((definition) => (
                  <div className="module-library-row module-child-row" key={definition.id}>
                    <button onClick={() => loadModule(definition)}>↳ {definition.name}</button>
                    <button className="btn-remove" onClick={() => deleteDefinition(definition.id)}>×</button>
                  </div>
                ))}
                <button className="module-add-child" onClick={() => { setModuleId(""); setModuleSystemId(system.id); setModuleName(""); setModuleDescription(""); setModuleEffects(pretty(SPEED_EFFECTS)); }}>+ Module</button>
              </div>
            </div>
          ))}
          {activeSystems.length === 0 ? <p className="module-support-empty">Create an upgrade system before creating modules.</p> : null}
        </div>
      </div>

      <div className="config-main module-builders">
        {error ? <div className="panel-error">{error}</div> : null}
        <section className="module-builder-card">
          <div className="builder-header"><h3>{moduleId ? "Edit module" : "Create module"}</h3></div>
          <label>
            Owning upgrade system
            <select className="config-input" value={moduleSystemId || activeSystems[0]?.id || ""} onChange={(event) => setModuleSystemId(event.target.value)} disabled={Boolean(moduleId)}>
              {activeSystems.map((system) => <option value={system.id} key={system.id}>{system.name}</option>)}
            </select>
          </label>
          <div className="module-basic-builder">
            <strong>Basic effect builder</strong>
            <label>
              Effect
              <select value={basicModuleKind} onChange={(event) => setBasicModuleKind(event.target.value as BasicModuleKind)}>
                <option value="speed">Speed</option>
                <option value="productivity">Productivity</option>
                <option value="efficiency">Input efficiency</option>
              </select>
            </label>
            <label>
              Change per module
              <span className="module-basic-number"><input type="number" min="0" step="0.01" value={basicModulePercent} onChange={(event) => setBasicModulePercent(Number(event.target.value) || 0)} /><span>%</span></span>
            </label>
            <button className="btn-secondary" onClick={() => setModuleEffects(pretty(buildBasicEffects(basicModuleKind, basicModulePercent)))}>Apply basic effect</button>
          </div>
          <label>Name<input className="config-input" value={moduleName} onChange={(event) => setModuleName(event.target.value)} /></label>
          <label>Description<input className="config-input" value={moduleDescription} onChange={(event) => setModuleDescription(event.target.value)} /></label>
          <details className="module-advanced-editor" open={Boolean(moduleId)}>
            <summary>Advanced declarative effects</summary>
            <p className="module-help">Power users can modify every operation, selector, formula, and dynamic input/output here.</p>
            <textarea aria-label="Declarative effects" className="module-json-editor" value={moduleEffects} onChange={(event) => setModuleEffects(event.target.value)} />
          </details>
          <div className="module-editor-actions">
            {moduleId ? <button className="btn-secondary" onClick={() => { setModuleId(""); setModuleName(""); }}>Cancel edit</button> : null}
            <button className="btn-primary" onClick={saveModule} disabled={activeSystems.length === 0}>Save module</button>
          </div>
        </section>

        <section className="module-builder-card">
          <div className="builder-header"><h3>{systemId ? "Edit upgrade system" : "Create upgrade system"}</h3></div>
          <div className="module-preset-row">
            <button className="btn-secondary" onClick={() => { setSystemControls(pretty(SLOT_CONTROLS)); setSystemEffects(pretty([])); }}>Slot system</button>
            <button className="btn-secondary" onClick={() => { setSystemControls(pretty(OVERCLOCK_CONTROLS)); setSystemEffects(pretty(OVERCLOCK_EFFECTS)); }}>Exact overclock system</button>
          </div>
          <label>Name<input className="config-input" value={systemName} onChange={(event) => setSystemName(event.target.value)} /></label>
          <label>Description<input className="config-input" value={systemDescription} onChange={(event) => setSystemDescription(event.target.value)} /></label>
          <label>Custom node UI schema<textarea className="module-json-editor" value={systemControls} onChange={(event) => setSystemControls(event.target.value)} /></label>
          <label>System effects<textarea className="module-json-editor" value={systemEffects} onChange={(event) => setSystemEffects(event.target.value)} /></label>
          <div className="module-editor-actions">
            {systemId ? <button className="btn-secondary" onClick={() => { setSystemId(""); setSystemName(""); }}>Cancel edit</button> : null}
            <button className="btn-primary" onClick={saveSystem}>Save upgrade system</button>
          </div>
        </section>

        <details className="module-schema-reference">
          <summary>Power-user schema reference</summary>
          <p>Controls may be <code>slots</code>, <code>slider</code>, <code>number</code>, <code>toggle</code>, or <code>targetOutputRate</code>. A target-rate control uses <code>drivesStateKey</code> to solve another numeric control automatically and can optionally select an output with <code>targetPortId</code>.</p>
          <p>Effect targets: <code>cycleTime</code>, <code>inputAmount</code>, <code>outputAmount</code>, <code>outputProbability</code>, <code>addInput</code>, and <code>addOutput</code>. Operations: <code>add</code>, <code>multiply</code>, <code>divide</code>, <code>set</code>, and <code>remove</code>.</p>
          <p>Sources may be <code>constant</code>, <code>moduleCount</code>, <code>stateNumber</code>, or <code>stateBoolean</code>. The evaluated value is <code>(offset + coefficient × source)^exponent / divisor</code>. Use <code>selectorPortId</code> or <code>selectorRefId</code> to target one port.</p>
          <p>Dynamic ports require <code>port.key</code>, <code>port.refId</code>, and <code>port.amount</code>; inputs may also set <code>refType</code>, and outputs may set <code>probability</code>. A stable node handle is derived from the system/module id and port key.</p>
        </details>
      </div>
    </div>
  );
}
