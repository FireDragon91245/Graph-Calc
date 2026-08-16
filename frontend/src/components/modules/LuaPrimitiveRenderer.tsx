import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getModuleResourceImageUrl } from "../../api/persistence";
import { inspectLuaModule, type LuaUiNode, type LuaPropertyValue } from "../../domain/luaModuleRuntime";
import { resolveModuleSystemResource } from "../../domain/moduleResources";
import { setModuleSlotCount } from "../../domain/moduleSlots";
import { solveTargetOutputRate, type EffectiveRecipe, type ModuleDefinition, type ModuleSystemNodeState, type ModuleSystemResource, type NodeModuleState } from "../../domain/moduleSystem";
import { formatNodeNumber } from "../../utils/numberFormat";

type Props = {
  node: LuaUiNode;
  systemId: string;
  systemState: ModuleSystemNodeState;
  allowedModules: ModuleDefinition[];
  resources?: ModuleSystemResource[];
  projectId?: string | null;
  fullState: NodeModuleState;
  effectiveRecipe?: EffectiveRecipe | null;
  evaluateState?: (state: NodeModuleState) => EffectiveRecipe;
  onChange: (update: { slots?: Array<string | null>; values?: Record<string, number | boolean | string> }) => void;
};

const number = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const safeCount = (value: unknown): number => clamp(Math.floor(number(value, 0)), 0, 64);
const safeTone = (value: unknown): string => ["accent", "warning", "danger", "muted"].includes(text(value)) ? ` tone-${text(value)}` : "";
const safeGap = (value: unknown): string => ["none", "small", "medium", "large"].includes(text(value)) ? ` gap-${text(value)}` : " gap-small";
const safeAlign = (value: unknown): string => ["start", "center", "end", "stretch", "between"].includes(text(value)) ? ` align-${text(value)}` : "";

const moduleProperty = (definition: ModuleDefinition | undefined, path: unknown): LuaPropertyValue | undefined => {
  if (!definition || typeof path !== "string" || !path) return undefined;
  let current: LuaPropertyValue | undefined = inspectLuaModule(definition.lua).value.properties;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
};

type ArtworkProps = {
  resourceId?: string;
  resources: ModuleSystemResource[];
  projectId?: string | null;
  fallback: string;
  alt?: string;
};

function ResourceArtwork({ resourceId, resources, projectId, fallback, alt = "" }: ArtworkProps) {
  const resource = resolveModuleSystemResource(resources, resourceId);
  const source = resource && projectId ? getModuleResourceImageUrl(projectId, resource.imageId) : null;
  return source
    ? <img className="lua-resource-artwork" src={source} alt={alt} draggable={false} />
    : <span className="lua-resource-fallback" aria-hidden="true">{fallback}</span>;
}

type ModuleSlotPickerProps = {
  entry: LuaUiNode;
  moduleId: string | null;
  modules: ModuleDefinition[];
  resources: ModuleSystemResource[];
  projectId?: string | null;
  invalid: boolean;
  onSelect: (moduleId: string | null) => void;
};

function ModuleSlotPicker({ entry, moduleId, modules, resources, projectId, invalid, onSelect }: ModuleSlotPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const selected = moduleId ? modules.find((candidate) => candidate.id === moduleId) : undefined;
  const size = ["small", "medium", "large"].includes(text(entry.size)) ? text(entry.size) : "small";
  const columns = clamp(Math.floor(number(entry.picker_columns, 4)), 1, 8);
  const showLabels = entry.show_labels === true;
  const moduleResource = (definition: ModuleDefinition | undefined): string | undefined => {
    const value = moduleProperty(definition, entry.resource_property);
    return typeof value === "string" && value ? value : undefined;
  };

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const popup = popupRef.current?.getBoundingClientRect();
    const width = popup?.width ?? Math.min(360, columns * (showLabels ? 90 : 52) + 24);
    const height = popup?.height ?? 240;
    const margin = 8;
    const roomBelow = window.innerHeight - anchor.bottom - margin;
    const top = roomBelow >= Math.min(height, 240)
      ? anchor.bottom + 6
      : Math.max(margin, anchor.top - Math.min(height, window.innerHeight - margin * 2) - 6);
    setPosition({
      left: clamp(anchor.left, margin, Math.max(margin, window.innerWidth - width - margin)),
      top,
      maxHeight: Math.max(120, Math.min(360, window.innerHeight - top - margin))
    });
  }, [columns, open, showLabels]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const fallback = selected?.name.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || text(entry.empty_text, "+");
  const label = selected?.name ?? text(entry.label, t("ui.modules.renderer.emptyModuleSlot"));
  return (
    <>
      <button
        ref={anchorRef}
        className={`lua-module-slot size-${size}${invalid ? " is-invalid" : ""}${moduleId ? " is-filled" : ""}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        <ResourceArtwork resourceId={moduleResource(selected) ?? text(entry.empty_resource)} resources={resources} projectId={projectId} fallback={fallback} />
      </button>
      {open ? createPortal(
        <div
          ref={popupRef}
          className="lua-module-picker nodrag nowheel"
          role="listbox"
          aria-label={text(entry.picker_label, t("ui.modules.renderer.selectModule"))}
          style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <button className="lua-module-option is-empty" type="button" role="option" aria-selected={!moduleId} title={text(entry.clear_text, t("ui.modules.renderer.emptySlot"))} onClick={() => { onSelect(null); setOpen(false); }}>
            <span className="lua-module-option-art">×</span>
            {showLabels ? <span>{text(entry.clear_text, t("ui.modules.renderer.empty"))}</span> : null}
          </button>
          {modules.map((candidate) => {
            const candidateFallback = candidate.name.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "◇";
            return (
              <button className={`lua-module-option${candidate.id === moduleId ? " is-selected" : ""}`} type="button" role="option" aria-selected={candidate.id === moduleId} title={candidate.name} key={candidate.id} onClick={() => { onSelect(candidate.id); setOpen(false); }}>
                <span className="lua-module-option-art"><ResourceArtwork resourceId={moduleResource(candidate)} resources={resources} projectId={projectId} fallback={candidateFallback} /></span>
                {showLabels ? <span className="lua-module-option-name">{candidate.name}</span> : null}
              </button>
            );
          })}
          {modules.length === 0 ? <span className="lua-module-picker-empty">{t("ui.modules.renderer.noModules")}</span> : null}
        </div>,
        document.body
      ) : null}
    </>
  );
}

type PopupProps = {
  entry: LuaUiNode;
  path: string;
  renderNode: (entry: LuaUiNode, path: string, onAction?: () => void) => ReactNode;
};

function PrimitivePopup({ entry, path, renderNode }: PopupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 360 });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const placement = ["bottom-start", "bottom-end", "top-start", "top-end", "left-start", "right-start"].includes(text(entry.placement)) ? text(entry.placement) : "bottom-start";

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const popup = popupRef.current?.getBoundingClientRect();
    const width = popup?.width ?? 220;
    const height = popup?.height ?? 180;
    const gap = 6;
    const margin = 8;
    let left = anchor.left;
    let top = anchor.bottom + gap;
    if (placement.endsWith("end")) left = anchor.right - width;
    if (placement.startsWith("top")) top = anchor.top - height - gap;
    if (placement === "left-start") { left = anchor.left - width - gap; top = anchor.top; }
    if (placement === "right-start") { left = anchor.right + gap; top = anchor.top; }
    left = clamp(left, margin, Math.max(margin, window.innerWidth - width - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - Math.min(height, 360) - margin));
    setPosition({ left, top, maxHeight: Math.max(120, Math.min(360, window.innerHeight - top - margin)) });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!entry.trigger || !entry.content) return null;
  const openOnContext = entry.open_on === "context";
  return (
    <>
      <span
        ref={anchorRef}
        className="lua-ui-popup-anchor"
        onClick={openOnContext ? undefined : () => setOpen((current) => !current)}
        onContextMenu={openOnContext ? (event) => { event.preventDefault(); setOpen((current) => !current); } : undefined}
      >
        {renderNode(entry.trigger, `${path}.trigger`)}
      </span>
      {open ? createPortal(
        <div
          ref={popupRef}
          className={`lua-ui-popup nodrag nowheel${safeTone(entry.tone)}`}
          role="dialog"
          aria-label={text(entry.label, t("ui.modules.renderer.popup"))}
          style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {renderNode(entry.content, `${path}.content`, () => { if (entry.close_on_action !== false) setOpen(false); })}
        </div>,
        document.body
      ) : null}
    </>
  );
}

export default function LuaPrimitiveRenderer(props: Props) {
  const { t } = useTranslation();
  const { node, systemId, systemState, allowedModules, resources = [], projectId, fullState, effectiveRecipe, evaluateState, onChange } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const values = systemState.values ?? {};
  const slots = systemState.slots ?? [];
  const targetBindings = new Map<string, string[]>();
  const collectTargets = (entry: LuaUiNode) => {
    if (entry.type === "target_output" && typeof entry.drives === "string" && typeof entry.bind === "string") {
      targetBindings.set(entry.drives, [...(targetBindings.get(entry.drives) ?? []), entry.bind]);
    }
    entry.children?.forEach(collectTargets);
    if (entry.trigger) collectTargets(entry.trigger);
    if (entry.content) collectTargets(entry.content);
  };
  collectTargets(node);

  const updateValue = (bind: string, value: number | boolean | string) => onChange({ values: { ...values, [bind]: value } });
  const binding = (raw: unknown): { kind: "value"; key: string } | { kind: "slot"; slot: number } | null => {
    if (typeof raw === "string" && raw) return { kind: "value", key: raw };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const definition = raw as Record<string, unknown>;
    if (definition.kind === "value" && typeof definition.key === "string" && definition.key) return { kind: "value", key: definition.key };
    if (definition.kind === "slot") {
      const slot = Math.floor(number(definition.slot, 0));
      if (slot >= 1 && slot <= 64) return { kind: "slot", slot };
    }
    return null;
  };
  const readBinding = (raw: unknown): number | boolean | string | null => {
    const resolved = binding(raw);
    if (!resolved) return null;
    return resolved.kind === "value" ? values[resolved.key] ?? null : slots[resolved.slot - 1] ?? null;
  };
  const writeBinding = (raw: unknown, value: number | boolean | string | null) => {
    const resolved = binding(raw);
    if (!resolved) return;
    if (resolved.kind === "value") {
      if (value !== null) updateValue(resolved.key, value);
      return;
    }
    const moduleId = typeof value === "string" && value ? value : null;
    if (moduleId && !allowedModules.some((candidate) => candidate.id === moduleId)) return;
    const next = Array.from({ length: Math.max(slots.length, resolved.slot) }, (_, index) => slots[index] ?? null);
    next[resolved.slot - 1] = moduleId;
    onChange({ slots: next });
  };
  const setNumeric = (entry: LuaUiNode, next: number) => {
    const resolved = binding(entry.bind);
    if (!resolved || resolved.kind !== "value" || !Number.isFinite(next)) return;
    const bind = resolved.key;
    const min = number(entry.min, Number.NEGATIVE_INFINITY);
    const max = number(entry.max, Number.POSITIVE_INFINITY);
    const nextValues = { ...values, [bind]: clamp(entry.integer === true ? Math.round(next) : next, min, max) };
    for (const targetBind of targetBindings.get(bind) ?? []) nextValues[targetBind] = 0;
    onChange({ values: nextValues });
  };

  const render = (entry: LuaUiNode, path: string, onAction?: () => void): ReactNode => {
    const key = `${systemId}:${path}`;
    if (["row", "column", "grid", "group"].includes(entry.type)) {
      const columns = clamp(safeCount(entry.columns) || 2, 1, 12);
      return (
        <div key={key} className={`lua-ui-${entry.type}${safeGap(entry.gap)}${safeAlign(entry.align)}${safeTone(entry.tone)}`} style={entry.type === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
          {entry.type === "group" && entry.label ? <div className="lua-ui-group-label">{text(entry.label)}</div> : null}
          {entry.children?.map((child, index) => render(child, `${path}.${index}`, onAction))}
        </div>
      );
    }
    if (entry.type === "popup") return <PrimitivePopup key={key} entry={entry} path={path} renderNode={render} />;
    if (entry.type === "label") return <span key={key} className={`lua-ui-label${safeTone(entry.tone)}`}>{text(entry.text)}</span>;
    if (entry.type === "icon") {
      const reference = text(entry.item);
      const fallback = reference ? reference.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "◇";
      return <span key={key} className={`lua-ui-icon${safeTone(entry.tone)}`} title={text(entry.label) || reference}><ResourceArtwork resourceId={text(entry.resource)} resources={resources} projectId={projectId} fallback={text(entry.text, fallback)} /></span>;
    }
    if (entry.type === "spacer") return <span key={key} className="lua-ui-spacer" />;

    if (entry.type === "module_slot") {
      const slot = Math.floor(number(entry.slot, 0));
      if (slot < 1 || slot > 64) return null;
      const moduleId = slots[slot - 1] ?? null;
      const requestedModules = Array.isArray(entry.modules) ? new Set(entry.modules.filter((value): value is string => typeof value === "string")) : null;
      const pickerModules = requestedModules ? allowedModules.filter((candidate) => requestedModules.has(candidate.id)) : allowedModules;
      const selectedIsAllowed = !moduleId || pickerModules.some((candidate) => candidate.id === moduleId);
      return <ModuleSlotPicker key={key} entry={entry} moduleId={moduleId} modules={pickerModules} resources={resources} projectId={projectId} invalid={!selectedIsAllowed} onSelect={(nextModuleId) => {
        const next = Array.from({ length: Math.max(slots.length, slot) }, (_, index) => slots[index] ?? null);
        next[slot - 1] = nextModuleId;
        onChange({ slots: next });
      }} />;
    }

    if (entry.type === "module_counter") {
      const moduleId = text(entry.module);
      const moduleDefinition = allowedModules.find((candidate) => candidate.id === moduleId);
      const current = slots.filter((candidate) => candidate === moduleId).length;
      const min = Math.max(0, safeCount(entry.min));
      const max = Math.max(min, safeCount(entry.max));
      const setCount = (next: number) => onChange({ slots: setModuleSlotCount(slots, moduleId, clamp(Math.round(next), min, max)) });
      return <div key={key} className="lua-module-counter">{entry.label ? <span>{text(entry.label)}</span> : null}<button type="button" disabled={!moduleDefinition || current <= min} onClick={() => setCount(current - 1)}>−</button><span className="lua-counter-value">{current}</span><button type="button" disabled={!moduleDefinition || current >= max} onClick={() => setCount(current + 1)}>+</button></div>;
    }

    if (entry.type === "button") {
      const size = ["small", "medium", "large"].includes(text(entry.size)) ? text(entry.size) : "medium";
      return <button key={key} type="button" className={`lua-ui-button${entry.square === true ? ` is-square size-${size}` : ""}${entry.selected === true ? " is-selected" : ""}${safeTone(entry.tone)}`} title={text(entry.title) || undefined} aria-label={text(entry.aria_label) || text(entry.title) || undefined} disabled={entry.disabled === true} onClick={() => {
        const action = entry.on_click;
        if (!action || typeof action !== "object") return;
        const definition = action as Record<string, unknown>;
        if (definition.type === "install") writeBinding({ kind: "slot", slot: definition.slot }, text(definition.module));
        if (definition.type === "clear_slot") writeBinding({ kind: "slot", slot: definition.slot }, null);
        if (definition.type === "toggle") writeBinding(definition.bind, readBinding(definition.bind) !== true);
        if (definition.type === "set" && ["number", "boolean", "string"].includes(typeof definition.value)) writeBinding(definition.bind, definition.value as number | boolean | string);
        if (definition.type === "increment") writeBinding(definition.bind, clamp(number(readBinding(definition.bind), 0) + number(definition.amount, 1), number(definition.min, Number.NEGATIVE_INFINITY), number(definition.max, Number.POSITIVE_INFINITY)));
        onAction?.();
      }}>{entry.children?.length ? entry.children.map((child, index) => render(child, `${path}.${index}`, onAction)) : text(entry.text, t("ui.modules.renderer.button"))}</button>;
    }

    if (entry.type === "toggle") {
      return <label key={key} className="lua-ui-toggle"><span>{text(entry.label)}</span><input type="checkbox" checked={readBinding(entry.bind) === true} onChange={(event) => writeBinding(entry.bind, event.target.checked)} /></label>;
    }

    if (entry.type === "text_input") {
      const current = readBinding(entry.bind);
      return <label key={key} className="lua-ui-input"><span>{text(entry.label)}</span><input type="text" placeholder={text(entry.placeholder) || undefined} value={typeof current === "string" ? current : text(entry.default)} onChange={(event) => writeBinding(entry.bind, event.target.value)} /></label>;
    }

    if (entry.type === "select" || entry.type === "dropdown") {
      const options = Array.isArray(entry.options) ? entry.options : [];
      return <label key={key} className="lua-ui-input"><span>{text(entry.label)}</span><select value={String(readBinding(entry.bind) ?? entry.default ?? "")} onChange={(event) => writeBinding(entry.bind, event.target.value)}>{options.map((option, index) => {
        const value = typeof option === "string" ? option : option && typeof option === "object" ? text((option as Record<string, unknown>).value) : "";
        const label = option && typeof option === "object" ? text((option as Record<string, unknown>).label, value) : value;
        return <option value={value} key={`${value}:${index}`}>{label}</option>;
      })}</select></label>;
    }

    if (entry.type === "counter") {
      const current = number(readBinding(entry.bind), number(entry.default, 0));
      const min = number(entry.min, 0);
      const max = number(entry.max, Number.POSITIVE_INFINITY);
      return <div key={key} className="lua-ui-counter"><span>{text(entry.label)}</span><button type="button" disabled={current <= min} onClick={() => setNumeric(entry, current - number(entry.step, 1))}>−</button><span className="lua-counter-value">{formatNodeNumber(current)}</span><button type="button" disabled={current >= max} onClick={() => setNumeric(entry, current + number(entry.step, 1))}>+</button></div>;
    }

    if (entry.type === "target_output") {
      const bind = text(entry.bind);
      const drives = text(entry.drives);
      const output = entry.output ? effectiveRecipe?.outputs.find((candidate) => candidate.id === entry.output) : effectiveRecipe?.outputs[0];
      const rate = output && effectiveRecipe && effectiveRecipe.timeSeconds > 0 ? output.amount * output.probability / effectiveRecipe.timeSeconds : 0;
      const storedTarget = number(values[bind], 0);
      const current = storedTarget > 0 ? storedTarget : rate;
      return (
        <label key={key} className="lua-ui-input lua-target-output">
          <span>{text(entry.label, t("ui.modules.renderer.targetOutputRate"))}</span>
          <span className="lua-ui-input-line">
            <input type="number" step={number(entry.step, 0.01)} value={drafts[key] ?? formatNodeNumber(current)} disabled={!evaluateState || !drives || !output} onChange={(event) => {
              setDrafts((previous) => ({ ...previous, [key]: event.target.value }));
              const target = Number(event.target.value);
              if (!evaluateState || !drives || !Number.isFinite(target)) return;
              const requested: NodeModuleState = { systems: { ...fullState.systems, [systemId]: { ...systemState, values: { ...values, [bind]: target } } } };
              const solution = solveTargetOutputRate({ evaluate: evaluateState, state: requested, systemId, drivesStateKey: drives, targetRate: target, min: number(entry.min, 0), max: number(entry.max, 100), targetPortId: text(entry.output) || undefined });
              if (solution.possible) {
                onChange({ ...solution.state.systems[systemId], values: { ...(solution.state.systems[systemId]?.values ?? {}), [bind]: target } });
                setErrors((previous) => ({ ...previous, [key]: "" }));
              } else setErrors((previous) => ({ ...previous, [key]: t("ui.modules.renderer.unreachable", { rate: formatNodeNumber(solution.achievedRate ?? 0), suffix: text(entry.suffix, "/s") }) }));
            }} onBlur={() => setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; })} />
            <span>{text(entry.suffix, "/s")}</span>
          </span>
          {errors[key] ? <small className="module-control-error">{errors[key]}</small> : null}
        </label>
      );
    }

    if (entry.type === "number" || entry.type === "slider") {
      const current = number(readBinding(entry.bind), number(entry.default, number(entry.min, 0)));
      const input = <input type={entry.type === "slider" ? "range" : "number"} min={number(entry.min, 0)} max={number(entry.max, 100)} step={number(entry.step, 1)} placeholder={text(entry.placeholder) || undefined} value={entry.type === "number" ? drafts[key] ?? formatNodeNumber(current) : current} onChange={(event) => {
        if (entry.type === "number") setDrafts((previous) => ({ ...previous, [key]: event.target.value }));
        if (event.target.value !== "") setNumeric(entry, Number(event.target.value));
      }} onBlur={() => setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; })} />;
      return entry.type === "slider"
        ? <div key={key} className="lua-ui-slider">{entry.label ? <span>{text(entry.label)}</span> : null}{input}</div>
        : <label key={key} className="lua-ui-input"><span>{text(entry.label)}</span><span className="lua-ui-input-line">{input}{entry.suffix ? <span>{text(entry.suffix)}</span> : null}</span></label>;
    }
    return null;
  };

  return <>{render(node, "root")}</>;
}
