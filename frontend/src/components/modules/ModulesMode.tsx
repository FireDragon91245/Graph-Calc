import { useMemo, useState } from "react";
import { getModuleResourceImageUrl, uploadModuleResourceImage } from "../../api/persistence";
import { inspectLuaModule, inspectLuaSystem, renderLuaSystem, resolveLuaRecipeParameters, validateLuaModule } from "../../domain/luaModuleRuntime";
import { FACTORIO_SYSTEM_LUA, POWER_SHARD_SYSTEM_LUA, PRODUCTIVITY_MODULE_LUA, SLOOP_MODULE_LUA, SLOOP_SYSTEM_LUA, SPEED_MODULE_LUA } from "../../domain/luaModuleTemplates";
import type { ModuleDefinition, ModuleSystemDefinition, ModuleSystemNodeState, ModuleSystemResource } from "../../domain/moduleSystem";
import { useGraphStore } from "../../store/graphStore";
import LuaPrimitiveRenderer from "./LuaPrimitiveRenderer";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function ModulesMode() {
  const definitions = useGraphStore((state) => state.moduleDefinitions);
  const systems = useGraphStore((state) => state.moduleSystems);
  const upsertDefinition = useGraphStore((state) => state.upsertModuleDefinition);
  const deleteDefinition = useGraphStore((state) => state.deleteModuleDefinition);
  const upsertSystem = useGraphStore((state) => state.upsertModuleSystem);
  const deleteSystem = useGraphStore((state) => state.deleteModuleSystem);
  const activeProjectId = useGraphStore((state) => state.activeProjectId);
  const activeDefinitions = useMemo(() => definitions.filter((entry) => !entry.archived), [definitions]);
  const activeSystems = useMemo(() => systems.filter((entry) => !entry.archived), [systems]);

  const [moduleId, setModuleId] = useState("");
  const [moduleSystemId, setModuleSystemId] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleLua, setModuleLua] = useState(SPEED_MODULE_LUA);
  const [systemId, setSystemId] = useState("");
  const [systemName, setSystemName] = useState("");
  const [systemDescription, setSystemDescription] = useState("");
  const [systemResources, setSystemResources] = useState<ModuleSystemResource[]>([]);
  const [systemLua, setSystemLua] = useState(FACTORIO_SYSTEM_LUA);
  const [previewState, setPreviewState] = useState<ModuleSystemNodeState>({ slots: [], values: {} });
  const [error, setError] = useState<string | null>(null);
  const [uploadingResource, setUploadingResource] = useState(false);

  const resetModule = (owner = moduleSystemId) => {
    setModuleId(""); setModuleSystemId(owner); setModuleName(""); setModuleDescription(""); setModuleLua(SPEED_MODULE_LUA); setError(null);
  };
  const resetSystem = () => {
    setSystemId(""); setSystemName(""); setSystemDescription(""); setSystemResources([]); setSystemLua(FACTORIO_SYSTEM_LUA); setPreviewState({ slots: [], values: {} }); setError(null);
  };
  const loadModule = (definition: ModuleDefinition) => {
    setModuleId(definition.id); setModuleSystemId(definition.systemId); setModuleName(definition.name); setModuleDescription(definition.description ?? ""); setModuleLua(definition.lua); setError(null);
  };
  const loadSystem = (system: ModuleSystemDefinition) => {
    setSystemId(system.id); setSystemName(system.name); setSystemDescription(system.description ?? ""); setSystemResources(system.resources ?? []); setSystemLua(system.lua); setModuleSystemId(system.id); setPreviewState({ slots: [], values: {} }); setError(null);
  };

  const saveModule = () => {
    const owner = moduleSystemId || activeSystems[0]?.id;
    if (!owner) return setError("Create an owning Lua system first.");
    if (!moduleName.trim()) return setError("A module name is required.");
    const scriptError = validateLuaModule(moduleLua);
    if (scriptError) return setError(scriptError);
    const id = moduleId || `${owner}:${slug(moduleName)}`;
    if (!slug(moduleName)) return setError("The module name must contain at least one letter or number.");
    upsertDefinition({ id, systemId: owner, name: moduleName.trim(), description: moduleDescription.trim(), lua: moduleLua });
    resetModule(owner);
  };

  const saveSystem = () => {
    if (!systemName.trim()) return setError("A system name is required.");
    const nextId = systemId || slug(systemName);
    if (!nextId) return setError("The system name must contain at least one letter or number.");
    const inspection = inspectLuaSystem(systemLua);
    if (inspection.error) return setError(inspection.error);
    const existing = systems.find((entry) => entry.id === systemId);
    upsertSystem({ id: nextId, name: systemName.trim(), description: systemDescription.trim(), revision: existing?.revision ?? 1, resources: systemResources, lua: systemLua });
    if (!moduleSystemId) setModuleSystemId(nextId);
    resetSystem();
  };

  const uploadResource = async (file: File) => {
    if (!activeProjectId) return setError("Open a project before uploading system resources.");
    setUploadingResource(true);
    setError(null);
    try {
      const imageId = await uploadModuleResourceImage(activeProjectId, file);
      const base = slug(file.name.replace(/\.[^.]+$/, "")) || "resource";
      let resourceId = base;
      let suffix = 2;
      while (systemResources.some((resource) => resource.id === resourceId)) resourceId = `${base}-${suffix++}`;
      setSystemResources((current) => [...current, { id: resourceId, name: file.name.replace(/\.[^.]+$/, "") || resourceId, imageId }]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload the resource image.");
    } finally {
      setUploadingResource(false);
    }
  };

  const previewInspection = useMemo(() => inspectLuaSystem(systemLua), [systemLua]);
  const previewParameters = useMemo(() => resolveLuaRecipeParameters(systemLua), [systemLua]);
  const previewValues = { ...previewInspection.value.defaults, ...(previewState.values ?? {}) };
  const previewModules = activeDefinitions.filter((definition) => definition.systemId === systemId);
  const previewModuleContexts = previewModules.map((definition) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    properties: inspectLuaModule(definition.lua).value.properties
  }));
  const previewUi = useMemo(() => renderLuaSystem(systemLua, {
    state: previewValues,
    slots: previewState.slots ?? [],
    parameters: previewParameters,
    modules: previewModuleContexts,
    resources: systemResources.map((resource) => ({ id: resource.id, name: resource.name })),
    recipe: { id: "preview", name: "Preview recipe", time_seconds: 1, inputs: [], outputs: [{ id: "output", item_id: "preview-output", amount: 1, probability: 1 }] }
  }), [systemLua, previewValues, previewState.slots, previewParameters, previewModuleContexts, systemResources]);

  return (
    <div className="config-mode-content modules-mode">
      <div className="config-sidebar modules-library">
        <div className="config-section">
          <h3>Lua systems</h3>
          <p className="module-help">Systems own their modules, recipe parameters, node design, state, and optional behavior.</p>
          {activeSystems.map((system) => (
            <div className="module-system-tree" key={system.id}>
              <div className="module-library-row module-system-row"><button onClick={() => loadSystem(system)}>{system.name} <small>v{system.revision}</small></button><button className="btn-remove" onClick={() => deleteSystem(system.id)}>×</button></div>
              <div className="module-system-children">
                {activeDefinitions.filter((definition) => definition.systemId === system.id).map((definition) => <div className="module-library-row module-child-row" key={definition.id}><button onClick={() => loadModule(definition)}>↳ {definition.name}</button><button className="btn-remove" onClick={() => deleteDefinition(definition.id)}>×</button></div>)}
                <button className="module-add-child" onClick={() => resetModule(system.id)}>+ Lua module</button>
              </div>
            </div>
          ))}
          {activeSystems.length === 0 ? <p className="module-support-empty">Create a Lua system to begin.</p> : null}
        </div>
      </div>

      <div className="config-main lua-module-workbench">
        {error ? <div className="panel-error">{error}</div> : null}
        <section className="module-builder-card lua-editor-card">
          <div className="builder-header"><h3>{systemId ? "Edit Lua system" : "Create Lua system"}</h3></div>
          <div className="module-preset-row">
            <button className="btn-secondary" onClick={() => setSystemLua(FACTORIO_SYSTEM_LUA)}>Factorio slots</button>
            <button className="btn-secondary" onClick={() => setSystemLua(SLOOP_SYSTEM_LUA)}>Sloop counter</button>
            <button className="btn-secondary" onClick={() => setSystemLua(POWER_SHARD_SYSTEM_LUA)}>Power shards</button>
          </div>
          <label>Name<input className="config-input" value={systemName} onChange={(event) => setSystemName(event.target.value)} /></label>
          <label>Description<input className="config-input" value={systemDescription} onChange={(event) => setSystemDescription(event.target.value)} /></label>
          <div className="module-resource-editor">
            <div className="module-resource-heading"><span>System resources</span><label className={`btn-secondary module-resource-upload${uploadingResource ? " is-disabled" : ""}`}>{uploadingResource ? "Uploading…" : "+ Upload image"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingResource} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadResource(file); event.currentTarget.value = ""; }} /></label></div>
            <small>Images are stored in the project image collection. Lua can reference an image by its editable label or stable ID.</small>
            <div className="module-resource-grid">
              {systemResources.map((resource) => <div className="module-resource-card" key={resource.id}>{activeProjectId && getModuleResourceImageUrl(activeProjectId, resource.imageId) ? <img src={getModuleResourceImageUrl(activeProjectId, resource.imageId)!} alt="" /> : <span>◇</span>}<input aria-label={`Resource name ${resource.id}`} value={resource.name} onChange={(event) => setSystemResources((current) => current.map((entry) => entry.id === resource.id ? { ...entry, name: event.target.value } : entry))} /><code>{resource.id}</code><button type="button" title="Remove resource" onClick={() => setSystemResources((current) => current.filter((entry) => entry.id !== resource.id))}>×</button></div>)}
              {systemResources.length === 0 ? <span className="module-resource-empty">No images uploaded.</span> : null}
            </div>
          </div>
          <label>System Lua<textarea aria-label="System Lua" className="module-code-editor lua-code-editor" spellCheck={false} value={systemLua} onChange={(event) => setSystemLua(event.target.value)} /></label>
          <div className="lua-system-preview">
            <strong>Live node preview</strong>
            <small>Uses parameter defaults and modules already owned by this saved system.</small>
            {previewUi.error ? <div className="module-error">{previewUi.error}</div> : null}
            {previewUi.value ? <div className="lua-preview-canvas"><LuaPrimitiveRenderer node={previewUi.value} systemId="__preview__" systemState={{ ...previewState, values: previewValues }} allowedModules={previewModules} resources={systemResources} projectId={activeProjectId} fullState={{ systems: { __preview__: previewState } }} onChange={(update) => setPreviewState((current) => ({ ...current, ...update }))} /></div> : null}
          </div>
          <div className="module-editor-actions">{systemId ? <button className="btn-secondary" onClick={resetSystem}>Cancel edit</button> : null}<button className="btn-primary" onClick={saveSystem}>Validate and save system</button></div>
        </section>

        <section className="module-builder-card lua-editor-card">
          <div className="builder-header"><h3>{moduleId ? "Edit Lua module" : "Create Lua module"}</h3></div>
          <div className="module-preset-row">
            <button className="btn-secondary" onClick={() => setModuleLua(SPEED_MODULE_LUA)}>Speed</button>
            <button className="btn-secondary" onClick={() => setModuleLua(PRODUCTIVITY_MODULE_LUA)}>Productivity</button>
            <button className="btn-secondary" onClick={() => setModuleLua(SLOOP_MODULE_LUA)}>Somersloop</button>
          </div>
          <label>Owning system<select className="config-input" value={moduleSystemId || activeSystems[0]?.id || ""} onChange={(event) => setModuleSystemId(event.target.value)} disabled={Boolean(moduleId)}>{activeSystems.map((system) => <option value={system.id} key={system.id}>{system.name}</option>)}</select></label>
          <label>Name<input className="config-input" value={moduleName} onChange={(event) => setModuleName(event.target.value)} /></label>
          <label>Description<input className="config-input" value={moduleDescription} onChange={(event) => setModuleDescription(event.target.value)} /></label>
          <label>Module Lua<textarea aria-label="Module Lua" className="module-code-editor lua-code-editor" spellCheck={false} value={moduleLua} onChange={(event) => setModuleLua(event.target.value)} /></label>
          <small className="module-help">Return an optional <code>properties</code> table from Lua. The owning system receives it as <code>candidate.properties</code> and decides how to render or calculate with it.</small>
          <div className="module-editor-actions">{moduleId ? <button className="btn-secondary" onClick={() => resetModule(moduleSystemId)}>Cancel edit</button> : null}<button className="btn-primary" onClick={saveModule} disabled={!activeSystems.length}>Validate and save module</button></div>
        </section>

        <section className="module-builder-card lua-api-reference">
          <div className="builder-header"><h3>Lua consumer API</h3></div>
          <p>System scripts return <code>system {'{'} parameters, defaults, slots(ctx), node(ctx), apply(ctx) {'}'}</code>. <code>slots(ctx)</code> defines solver permissions; <code>node(ctx)</code> is presentation only. Module scripts return <code>module {'{'} properties, apply(ctx) {'}'}</code>.</p>
          <p><code>ctx.state</code> is per-node state, <code>ctx.parameters</code> is per-recipe configuration, <code>ctx.slots</code> is the loadout, <code>ctx.modules</code> contains enabled child modules and their arbitrary <code>properties</code> tables, <code>ctx.resources</code> lists system images, and <code>ctx.recipe</code> contains the current effective recipe. Module callbacks also receive <code>ctx.count</code> and their own <code>ctx.properties</code>.</p>
          <p>Layout: <code>ui.row</code>, <code>ui.column</code>, <code>ui.grid</code>, <code>ui.group</code>, <code>ui.popup</code>. Display: <code>ui.label</code>, <code>ui.icon</code>, <code>ui.spacer</code>. Input: <code>ui.button</code>, <code>ui.number</code>, <code>ui.text_input</code>, <code>ui.select</code>, <code>ui.dropdown</code>, <code>ui.slider</code>, <code>ui.toggle</code>, <code>ui.counter</code>, plus optional <code>ui.module_slot</code>, <code>ui.module_counter</code>, and <code>ui.target_output</code> conveniences. Use <code>bindings.value</code>, <code>bindings.slot</code>, <code>actions.install</code>, and <code>actions.clear_slot</code> to compose module interfaces yourself.</p>
          <p>Effects: <code>fx.cycle_time</code>, <code>fx.inputs</code>, <code>fx.outputs</code>, and <code>fx.probability</code> support <code>add</code>, <code>multiply</code>, <code>divide</code>, <code>set</code>, and <code>remove</code>. Use <code>fx.inputs.create</code> and <code>fx.outputs.create</code> for dynamic ports.</p>
          <p>The sandbox exposes Lua math, string, and table operations. It has no HTML, CSS, DOM, filesystem, network, package loading, dynamic code loading, or host-language access. Execution and output sizes are limited.</p>
        </section>
      </div>
    </div>
  );
}
