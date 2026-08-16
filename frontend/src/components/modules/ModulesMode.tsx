import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getModuleResourceImageUrl, uploadModuleResourceImage } from "../../api/persistence";
import { inspectLuaModule, inspectLuaSystem, renderLuaSystem, resolveLuaRecipeParameters, validateLuaModule } from "../../domain/luaModuleRuntime";
import type { ModuleDefinition, ModuleSystemDefinition, ModuleSystemNodeState, ModuleSystemResource } from "../../domain/moduleSystem";
import { useGraphStore } from "../../store/graphStore";
import LuaPrimitiveRenderer from "./LuaPrimitiveRenderer";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const NEW_SYSTEM_CODE = `return system {
  parameters = {},
  defaults = {},

  slots = function(ctx)
    return {}
  end,

  node = function(ctx)
    return ui.column {}
  end
}`;
const NEW_MODULE_CODE = `return module {
  properties = {},

  apply = function(ctx)
    return {}
  end
}`;

export default function ModulesMode() {
  const { t } = useTranslation();
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
  const [moduleLua, setModuleLua] = useState(NEW_MODULE_CODE);
  const [systemId, setSystemId] = useState("");
  const [systemName, setSystemName] = useState("");
  const [systemDescription, setSystemDescription] = useState("");
  const [systemResources, setSystemResources] = useState<ModuleSystemResource[]>([]);
  const [systemLua, setSystemLua] = useState(NEW_SYSTEM_CODE);
  const [previewState, setPreviewState] = useState<ModuleSystemNodeState>({ slots: [], values: {} });
  const [error, setError] = useState<string | null>(null);
  const [uploadingResource, setUploadingResource] = useState(false);

  const resetModule = (owner = moduleSystemId) => {
    setModuleId(""); setModuleSystemId(owner); setModuleName(""); setModuleDescription(""); setModuleLua(NEW_MODULE_CODE); setError(null);
  };
  const resetSystem = () => {
    setSystemId(""); setSystemName(""); setSystemDescription(""); setSystemResources([]); setSystemLua(NEW_SYSTEM_CODE); setPreviewState({ slots: [], values: {} }); setError(null);
  };
  const loadModule = (definition: ModuleDefinition) => {
    setModuleId(definition.id); setModuleSystemId(definition.systemId); setModuleName(definition.name); setModuleDescription(definition.description ?? ""); setModuleLua(definition.lua); setError(null);
  };
  const loadSystem = (system: ModuleSystemDefinition) => {
    setSystemId(system.id); setSystemName(system.name); setSystemDescription(system.description ?? ""); setSystemResources(system.resources ?? []); setSystemLua(system.lua); setModuleSystemId(system.id); setPreviewState({ slots: [], values: {} }); setError(null);
  };

  const saveModule = () => {
    const owner = moduleSystemId || activeSystems[0]?.id;
    if (!owner) return setError(t("ui.modules.errors.ownerRequired"));
    if (!moduleName.trim()) return setError(t("ui.modules.errors.moduleNameRequired"));
    const scriptError = validateLuaModule(moduleLua);
    if (scriptError) return setError(scriptError);
    const id = moduleId || `${owner}:${slug(moduleName)}`;
    if (!slug(moduleName)) return setError(t("ui.modules.errors.moduleNameInvalid"));
    upsertDefinition({ id, systemId: owner, name: moduleName.trim(), description: moduleDescription.trim(), lua: moduleLua });
    resetModule(owner);
  };

  const saveSystem = () => {
    if (!systemName.trim()) return setError(t("ui.modules.errors.systemNameRequired"));
    const nextId = systemId || slug(systemName);
    if (!nextId) return setError(t("ui.modules.errors.systemNameInvalid"));
    const inspection = inspectLuaSystem(systemLua);
    if (inspection.error) return setError(inspection.error);
    const existing = systems.find((entry) => entry.id === systemId);
    upsertSystem({ id: nextId, name: systemName.trim(), description: systemDescription.trim(), revision: existing?.revision ?? 1, resources: systemResources, lua: systemLua });
    if (!moduleSystemId) setModuleSystemId(nextId);
    resetSystem();
  };

  const uploadResource = async (file: File) => {
    if (!activeProjectId) return setError(t("ui.modules.errors.projectRequired"));
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
      setError(uploadError instanceof Error ? uploadError.message : t("ui.modules.errors.uploadFailed"));
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
    recipe: { id: "preview", name: t("ui.modules.preview.recipeName"), time_seconds: 1, inputs: [], outputs: [{ id: "output", item_id: "preview-output", amount: 1, probability: 1 }] }
  }), [systemLua, previewValues, previewState.slots, previewParameters, previewModuleContexts, systemResources, t]);

  return (
    <div className="config-mode-content modules-mode">
      <div className="config-sidebar modules-library">
        <div className="config-section">
          <h3>{t("ui.modules.title")}</h3>
          <p className="module-help">{t("ui.modules.description")}</p>
          {activeSystems.map((system) => (
            <div className="module-system-tree" key={system.id}>
              <div className="module-library-row module-system-row"><button onClick={() => loadSystem(system)}>{system.name}</button><button className="btn-remove" onClick={() => deleteSystem(system.id)}>×</button></div>
              <div className="module-system-children">
                {activeDefinitions.filter((definition) => definition.systemId === system.id).map((definition) => <div className="module-library-row module-child-row" key={definition.id}><button onClick={() => loadModule(definition)}>↳ {definition.name}</button><button className="btn-remove" onClick={() => deleteDefinition(definition.id)}>×</button></div>)}
                <button className="module-add-child" onClick={() => resetModule(system.id)}>+ {t("ui.modules.module")}</button>
              </div>
            </div>
          ))}
          {activeSystems.length === 0 ? <p className="module-support-empty">{t("ui.modules.empty")}</p> : null}
        </div>
      </div>

      <div className="config-main lua-module-workbench">
        {error ? <div className="panel-error">{error}</div> : null}
        <section className="module-builder-card lua-editor-card">
          <div className="builder-header"><h3>{systemId ? t("ui.modules.editSystem") : t("ui.modules.createSystem")}</h3></div>
          <label>{t("ui.modules.fields.name")}<input className="config-input" value={systemName} onChange={(event) => setSystemName(event.target.value)} /></label>
          <label>{t("ui.modules.fields.description")}<input className="config-input" value={systemDescription} onChange={(event) => setSystemDescription(event.target.value)} /></label>
          <div className="module-resource-editor">
            <div className="module-resource-heading"><span>{t("ui.modules.resources.title")}</span><label className={`btn-secondary module-resource-upload${uploadingResource ? " is-disabled" : ""}`}>{uploadingResource ? t("ui.modules.resources.uploading") : `+ ${t("ui.modules.resources.upload")}`}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingResource} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadResource(file); event.currentTarget.value = ""; }} /></label></div>
            <small>{t("ui.modules.resources.help")}</small>
            <div className="module-resource-grid">
              {systemResources.map((resource) => <div className="module-resource-card" key={resource.id}>{activeProjectId && getModuleResourceImageUrl(activeProjectId, resource.imageId) ? <img src={getModuleResourceImageUrl(activeProjectId, resource.imageId)!} alt="" /> : <span>◇</span>}<input aria-label={t("ui.modules.resources.name", { id: resource.id })} value={resource.name} onChange={(event) => setSystemResources((current) => current.map((entry) => entry.id === resource.id ? { ...entry, name: event.target.value } : entry))} /><code>{resource.id}</code><button type="button" title={t("ui.modules.resources.remove")} onClick={() => setSystemResources((current) => current.filter((entry) => entry.id !== resource.id))}>×</button></div>)}
              {systemResources.length === 0 ? <span className="module-resource-empty">{t("ui.modules.resources.empty")}</span> : null}
            </div>
          </div>
          <label>{t("ui.modules.fields.systemCode")}<textarea aria-label={t("ui.modules.fields.systemCode")} className="module-code-editor lua-code-editor" spellCheck={false} value={systemLua} onChange={(event) => setSystemLua(event.target.value)} /></label>
          <div className="lua-system-preview">
            <strong>{t("ui.modules.preview.title")}</strong>
            <small>{t("ui.modules.preview.help")}</small>
            {previewUi.error ? <div className="module-error">{previewUi.error}</div> : null}
            {previewUi.value ? <div className="lua-preview-canvas"><LuaPrimitiveRenderer node={previewUi.value} systemId="__preview__" systemState={{ ...previewState, values: previewValues }} allowedModules={previewModules} resources={systemResources} projectId={activeProjectId} fullState={{ systems: { __preview__: previewState } }} onChange={(update) => setPreviewState((current) => ({ ...current, ...update }))} /></div> : null}
          </div>
          <div className="module-editor-actions">{systemId ? <button className="btn-secondary" onClick={resetSystem}>{t("ui.modules.actions.cancelEdit")}</button> : null}<button className="btn-primary" onClick={saveSystem}>{t("ui.modules.actions.saveSystem")}</button></div>
        </section>

        <section className="module-builder-card lua-editor-card">
          <div className="builder-header"><h3>{moduleId ? t("ui.modules.editModule") : t("ui.modules.createModule")}</h3></div>
          <label>{t("ui.modules.fields.owningSystem")}<select className="config-input" value={moduleSystemId || activeSystems[0]?.id || ""} onChange={(event) => setModuleSystemId(event.target.value)} disabled={Boolean(moduleId)}>{activeSystems.map((system) => <option value={system.id} key={system.id}>{system.name}</option>)}</select></label>
          <label>{t("ui.modules.fields.name")}<input className="config-input" value={moduleName} onChange={(event) => setModuleName(event.target.value)} /></label>
          <label>{t("ui.modules.fields.description")}<input className="config-input" value={moduleDescription} onChange={(event) => setModuleDescription(event.target.value)} /></label>
          <label>{t("ui.modules.fields.moduleCode")}<textarea aria-label={t("ui.modules.fields.moduleCode")} className="module-code-editor lua-code-editor" spellCheck={false} value={moduleLua} onChange={(event) => setModuleLua(event.target.value)} /></label>
          <small className="module-help">{t("ui.modules.modulePropertiesHelp")}</small>
          <div className="module-editor-actions">{moduleId ? <button className="btn-secondary" onClick={() => resetModule(moduleSystemId)}>{t("ui.modules.actions.cancelEdit")}</button> : null}<button className="btn-primary" onClick={saveModule} disabled={!activeSystems.length}>{t("ui.modules.actions.saveModule")}</button></div>
        </section>

      </div>
    </div>
  );
}
