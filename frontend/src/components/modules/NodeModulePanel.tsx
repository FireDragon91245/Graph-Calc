import { useMemo, useState } from "react";
import { solveTargetOutputRate, type EffectiveRecipe, type ModuleDefinition, type ModuleSystemDefinition, type NodeModuleState, type RecipeModuleSupport } from "../../domain/moduleSystem";
import { formatNodeNumber } from "../../utils/numberFormat";

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
  const [controlErrors, setControlErrors] = useState<Record<string, string>>({});
  const [controlDrafts, setControlDrafts] = useState<Record<string, string>>({});
  const orderedSupports = useMemo(
    () => [...supports].filter((support) => support.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [supports]
  );
  if (orderedSupports.length === 0) {
    return diagnostics.length > 0 ? (
      <div className="node-module-panel nodrag nowheel">
        {diagnostics.map((diagnostic, index) => <div className="module-error" key={`${diagnostic}-${index}`}>{diagnostic}</div>)}
      </div>
    ) : null;
  }

  const updateSystem = (systemId: string, update: { slots?: Array<string | null>; values?: Record<string, number | boolean> }) => {
    onChange({
      systems: {
        ...value.systems,
        [systemId]: {
          ...value.systems[systemId],
          ...update
        }
      }
    });
  };

  return (
    <div className="node-module-panel nodrag nowheel">
      {orderedSupports.map((support) => {
        const system = systems.find((entry) => entry.id === support.systemId && !entry.archived);
        if (!system) return <div className="module-error" key={support.systemId}>Missing system: {support.systemId}</div>;
        const systemState = value.systems[system.id] ?? { slots: [], values: {} };
        const allowed = modules.filter((entry) =>
          entry.systemId === system.id &&
          !entry.archived &&
          !(support.disabledModuleIds ?? []).includes(entry.id)
        );

        return (
          <div className="node-module-system" key={system.id}>
            <div className="node-module-title">
              <span>{system.name}</span>
              <span className="node-module-revision">v{system.revision}</span>
            </div>
            {system.controls.map((control) => {
              if (control.type === "slots") {
                const slotCount = Math.max(0, support.slotCount ?? 0);
                const slots = Array.from({ length: slotCount }, (_, index) => systemState.slots?.[index] ?? null);
                return (
                  <div className="module-control" key={control.id}>
                    <span className="module-control-label">{control.label}</span>
                    <div className="module-slot-grid">
                      {slots.map((moduleId, index) => {
                        const selected = moduleId ? modules.find((entry) => entry.id === moduleId) : undefined;
                        const selectedIsAllowed = Boolean(selected && allowed.some((entry) => entry.id === selected.id));
                        return (
                          <select
                            key={`${system.id}-slot-${index}`}
                            className={`module-slot ${moduleId && !selectedIsAllowed ? "module-slot-invalid" : ""}`}
                            aria-label={`${control.label} ${index + 1}`}
                            value={moduleId ?? ""}
                            onChange={(event) => {
                              const next = [...slots];
                              next[index] = event.target.value || null;
                              updateSystem(system.id, { slots: next });
                            }}
                          >
                            <option value="">Empty</option>
                            {moduleId && !selectedIsAllowed ? (
                              <option value={moduleId}>Unavailable: {selected?.name ?? moduleId}</option>
                            ) : null}
                            {allowed.map((definition) => <option key={definition.id} value={definition.id}>{definition.name}</option>)}
                          </select>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              if (control.type === "targetOutputRate") {
                const drivenControl = system.controls.find((candidate) =>
                  candidate.stateKey === control.drivesStateKey && (candidate.type === "slider" || candidate.type === "number")
                );
                const output = control.targetPortId
                  ? effectiveRecipe?.outputs.find((candidate) => candidate.id === control.targetPortId)
                  : effectiveRecipe?.outputs[0];
                const currentRate = output && effectiveRecipe && effectiveRecipe.timeSeconds > 0
                  ? output.amount * output.probability / effectiveRecipe.timeSeconds
                  : 0;
                const storedTarget = systemState.values?.[control.stateKey];
                const targetValue = typeof storedTarget === "number" && storedTarget > 0 ? storedTarget : currentRate;
                const errorKey = `${system.id}:${control.id}`;
                const canCalculate = Boolean(evaluateState && drivenControl && output);
                const applyTargetRate = (targetRate: number) => {
                  if (!evaluateState || !drivenControl || !Number.isFinite(targetRate)) return;
                  const requestedState: NodeModuleState = {
                    systems: {
                      ...value.systems,
                      [system.id]: {
                        ...systemState,
                        values: { ...(systemState.values ?? {}), [control.stateKey]: targetRate }
                      }
                    }
                  };
                  const solution = solveTargetOutputRate({
                    evaluate: evaluateState,
                    state: requestedState,
                    systemId: system.id,
                    drivesStateKey: drivenControl.stateKey,
                    targetRate,
                    min: drivenControl.min ?? 0,
                    max: drivenControl.max ?? 100,
                    targetPortId: control.targetPortId
                  });
                  if (solution.possible) {
                    onChange({
                      systems: {
                        ...solution.state.systems,
                        [system.id]: {
                          ...solution.state.systems[system.id],
                          values: {
                            ...(solution.state.systems[system.id]?.values ?? {}),
                            [control.stateKey]: targetRate
                          }
                        }
                      }
                    });
                    setControlErrors((current) => ({ ...current, [errorKey]: "" }));
                  } else {
                    onChange(requestedState);
                    const reachable = solution.achievedRate === undefined ? "unavailable" : `${formatNodeNumber(solution.achievedRate)}${control.suffix ?? "/s"}`;
                    setControlErrors((current) => ({ ...current, [errorKey]: `Not reachable within ${drivenControl.min ?? 0}–${drivenControl.max ?? 100}%. Nearest: ${reachable}.` }));
                  }
                };

                return (
                  <div className="module-control module-target-rate" key={control.id}>
                    <span className="module-control-label">
                      {control.label}
                      {output ? <small>{output.name}</small> : null}
                    </span>
                    <div className="module-target-rate-input">
                      <input
                        className="module-number-input"
                        type="number"
                        min={control.min ?? 0}
                        max={control.max}
                        step={control.step ?? "any"}
                        value={controlDrafts[errorKey] ?? formatNodeNumber(targetValue)}
                        disabled={!canCalculate}
                        onChange={(event) => {
                          const draft = event.target.value;
                          setControlDrafts((current) => ({ ...current, [errorKey]: draft }));
                          if (draft !== "" && Number.isFinite(Number(draft))) applyTargetRate(Number(draft));
                        }}
                        onBlur={() => setControlDrafts((current) => {
                          const next = { ...current };
                          delete next[errorKey];
                          return next;
                        })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                      <span className="module-control-suffix">{control.suffix ?? "/s"}</span>
                    </div>
                    {!canCalculate ? <span className="module-control-error">Requires a fixed recipe output.</span> : null}
                    {controlErrors[errorKey] ? <span className="module-control-error">{controlErrors[errorKey]}</span> : null}
                  </div>
                );
              }

              const current = systemState.values?.[control.stateKey] ?? control.defaultValue ?? (control.type === "toggle" ? false : control.min ?? 0);
              if (control.type === "toggle") {
                return (
                  <label className="module-control module-toggle" key={control.id}>
                    <span className="module-control-label">{control.label}</span>
                    <input
                      type="checkbox"
                      checked={current === true}
                      onChange={(event) => updateSystem(system.id, { values: { ...(systemState.values ?? {}), [control.stateKey]: event.target.checked } })}
                    />
                  </label>
                );
              }

              const numericValue = typeof current === "number" ? current : Number(current) || 0;
              const numberDraftKey = `${system.id}:${control.id}:number`;
              const setNumber = (next: number) => {
                const values = { ...(systemState.values ?? {}), [control.stateKey]: next };
                for (const dependent of system.controls) {
                  if (dependent.type === "targetOutputRate" && dependent.drivesStateKey === control.stateKey) {
                    values[dependent.stateKey] = 0;
                    const dependentKey = `${system.id}:${dependent.id}`;
                    setControlErrors((current) => ({ ...current, [dependentKey]: "" }));
                    setControlDrafts((current) => {
                      const drafts = { ...current };
                      delete drafts[dependentKey];
                      return drafts;
                    });
                  }
                }
                updateSystem(system.id, { values });
              };
              return (
                <div className="module-control" key={control.id}>
                  <span className="module-control-label">{control.label}</span>
                  <div className="module-number-control">
                    {control.type === "slider" ? (
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={numericValue}
                        onChange={(event) => setNumber(Number(event.target.value))}
                      />
                    ) : null}
                    <input
                      className="module-number-input"
                      type="number"
                      min={control.min}
                      max={control.max}
                      step={control.step ?? "any"}
                      value={controlDrafts[numberDraftKey] ?? formatNodeNumber(numericValue)}
                      onChange={(event) => {
                        const draft = event.target.value;
                        setControlDrafts((current) => ({ ...current, [numberDraftKey]: draft }));
                        if (draft !== "" && Number.isFinite(Number(draft))) setNumber(Number(draft));
                      }}
                      onBlur={() => setControlDrafts((current) => {
                        const next = { ...current };
                        delete next[numberDraftKey];
                        return next;
                      })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    {control.suffix ? <span className="module-control-suffix">{control.suffix}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {diagnostics.map((diagnostic, index) => <div className="module-error" key={`${diagnostic}-${index}`}>{diagnostic}</div>)}
    </div>
  );
}
