import { useEffect, useMemo, useState } from "react";
import {
  useGraphStore,
  type Item,
  type Recipe,
  type RecipeBlueprint,
} from "../store/graphStore";
import type {
  RecipeOutputSlotRule,
  RecipeSlotResolver,
  RecipeSlotRule,
  RecipeTransformStep,
  RecipeTransformType,
} from "../domain/recipeBlueprint";
import {
  generateRecipeCandidates,
  type RecipeCandidate,
} from "../domain/recipeGeneratorEngine";
import SearchableDropdown from "../editor/SearchableDropdown";

const makeId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function makeInput(resolver: RecipeSlotResolver = "source"): RecipeSlotRule {
  return { id: makeId("input"), resolver, amount: 1, nameTransforms: [] };
}

function makeOutput(): RecipeOutputSlotRule {
  return {
    id: makeId("output"),
    resolver: "related",
    amount: 1,
    probability: 1,
    nameTransforms: [],
  };
}

const relatedTransformLabels: Partial<Record<RecipeTransformType, string>> = {
  addPrefix: "Add before",
  addSuffix: "Add after",
  removePrefix: "Remove from beginning",
  removeSuffix: "Remove from end",
  replace: "Find and replace",
  uppercase: "Uppercase",
  lowercase: "Lowercase",
};

const makeRelatedTransform = (type: RecipeTransformType = "addSuffix"): RecipeTransformStep => ({
  id: makeId("name_step"),
  type,
  value: "",
  replaceFrom: "",
  replaceTo: "",
});

function inferFriendlyChange(source: string, target: string) {
  let best = "";
  let sourceStart = 0;
  let targetStart = 0;
  for (let left = 0; left < source.length; left += 1) {
    for (let right = 0; right < target.length; right += 1) {
      let length = 0;
      while (source[left + length] && source[left + length] === target[right + length]) length += 1;
      if (length > best.length) {
        best = source.slice(left, left + length);
        sourceStart = left;
        targetStart = right;
      }
    }
  }
  if (!best) return { removePrefix: source, removeSuffix: "", addPrefix: target, addSuffix: "" };
  return {
    removePrefix: source.slice(0, sourceStart),
    removeSuffix: source.slice(sourceStart + best.length),
    addPrefix: target.slice(0, targetStart),
    addSuffix: target.slice(targetStart + best.length),
  };
}

function inferredChangeSteps(change: ReturnType<typeof inferFriendlyChange>): RecipeTransformStep[] {
  const steps: RecipeTransformStep[] = [];
  const add = (type: RecipeTransformType, value: string) => {
    const cleaned = value.trim();
    if (cleaned) steps.push({ ...makeRelatedTransform(type), value: cleaned });
  };
  add("removePrefix", change.removePrefix);
  add("removeSuffix", change.removeSuffix);
  add("addPrefix", change.addPrefix);
  add("addSuffix", change.addSuffix);
  return steps;
}

function makeBlueprint(): RecipeBlueprint {
  const timestamp = Date.now();
  return {
    id: makeId("blueprint"),
    name: "New recipe pattern",
    description: "",
    source: {
      filterMode: "all",
      tagIds: [],
      categoryIds: [],
      itemIds: [],
      excludeTagIds: [],
      excludeCategoryIds: [],
      excludeItemIds: [],
    },
    recipeNamePrefix: "Process",
    recipeNameItem: "source",
    recipeNameSuffix: "",
    timeSeconds: 1,
    inputs: [makeInput()],
    outputs: [makeOutput()],
    recipeTagIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function blueprintFromRecipe(recipe: Recipe, items: Item[]): RecipeBlueprint {
  const blueprint = makeBlueprint();
  const firstItemInput = recipe.inputs.find((input) => input.refType === "item");
  const sourceItem = firstItemInput ? items.find((item) => item.id === firstItemInput.refId) : undefined;
  const sourceNamePosition = sourceItem ? recipe.name.indexOf(sourceItem.name) : -1;
  const firstOutput = recipe.outputs[0];
  const firstOutputItem = firstOutput ? items.find((item) => item.id === firstOutput.itemId) : undefined;
  const inferredOutputChange = sourceItem && firstOutputItem
    ? inferFriendlyChange(sourceItem.name, firstOutputItem.name)
    : null;
  return {
    ...blueprint,
    name: `${recipe.name} pattern`,
    description: `Created from ${recipe.name}. Review every fixed and variable slot before generating.`,
    source: { ...blueprint.source, itemIds: sourceItem ? [sourceItem.id] : [] },
    recipeNamePrefix: sourceNamePosition >= 0 ? recipe.name.slice(0, sourceNamePosition) : recipe.name,
    recipeNameItem: sourceNamePosition >= 0 ? "source" : "none",
    recipeNameSuffix: sourceNamePosition >= 0 && sourceItem
      ? recipe.name.slice(sourceNamePosition + sourceItem.name.length)
      : "",
    timeSeconds: recipe.timeSeconds,
    inputs: recipe.inputs.map((input) => ({
      id: makeId("input"),
      resolver: sourceItem && input.refType === "item" && input.refId === sourceItem.id
        ? "source"
        : input.refType === "tag" ? "fixedTag" : "fixedItem",
      amount: input.amount,
      refId: input.refId,
      nameTransforms: [],
    })),
    outputs: recipe.outputs.map((output, index) => ({
      id: makeId("output"),
      resolver: index === 0 && inferredOutputChange ? "related" : "fixedItem",
      amount: output.amount,
      probability: output.probability,
      refId: output.itemId,
      nameTransforms: index === 0 && inferredOutputChange
        ? inferredChangeSteps(inferredOutputChange)
        : [],
    })),
  };
}

export default function RecipeGenerator() {
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const categories = useGraphStore((state) => state.categories);
  const recipes = useGraphStore((state) => state.recipes);
  const recipeTags = useGraphStore((state) => state.recipeTags);
  const blueprints = useGraphStore((state) => state.recipeBlueprints);
  const upsertBlueprint = useGraphStore((state) => state.upsertRecipeBlueprint);
  const deleteBlueprint = useGraphStore((state) => state.deleteRecipeBlueprint);
  const addRecipesBatch = useGraphStore((state) => state.addRecipesBatch);

  const [draft, setDraft] = useState<RecipeBlueprint | null>(null);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const [importRecipeId, setImportRecipeId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);

  const candidates = useMemo(
    () => draft ? generateRecipeCandidates(draft, { items, tags, categories, recipes }) : [],
    [draft, items, tags, categories, recipes],
  );
  const readyCandidates = candidates.filter((candidate) => candidate.status === "ready" && candidate.recipe);

  useEffect(() => {
    setApprovedIds(new Set(readyCandidates.map((candidate) => candidate.id)));
  }, [draft?.updatedAt, candidates.length, candidates.map((candidate) => `${candidate.id}:${candidate.status}`).join("|")]);

  const patchDraft = (patch: Partial<RecipeBlueprint>) => {
    setDraft((current) => current ? { ...current, ...patch, updatedAt: Date.now() } : current);
  };

  const patchSource = (patch: Partial<RecipeBlueprint["source"]>) => {
    if (!draft) return;
    patchDraft({ source: { ...draft.source, ...patch } });
  };

  const toggleSourceValue = (field: keyof RecipeBlueprint["source"], value: string) => {
    if (!draft || field === "filterMode") return;
    const current = draft.source[field] as string[];
    patchSource({ [field]: current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value] });
  };

  const startBlank = () => {
    const blueprint = makeBlueprint();
    setSelectedBlueprintId(null);
    setDraft(blueprint);
  };

  const selectBlueprint = (blueprint: RecipeBlueprint) => {
    setSelectedBlueprintId(blueprint.id);
    setDraft(clone(blueprint));
  };

  const importRecipe = () => {
    const recipe = recipes.find((entry) => entry.id === importRecipeId);
    if (!recipe) return;
    setSelectedBlueprintId(null);
    setDraft(blueprintFromRecipe(recipe, items));
  };

  const saveBlueprint = () => {
    if (!draft?.name.trim()) {
      alert("Give this pattern a name first.");
      return;
    }
    const saved = { ...draft, name: draft.name.trim(), updatedAt: Date.now() };
    upsertBlueprint(saved);
    setDraft(saved);
    setSelectedBlueprintId(saved.id);
  };

  const removeBlueprint = () => {
    if (!draft || !blueprints.some((entry) => entry.id === draft.id)) return;
    if (!confirm(`Delete recipe pattern “${draft.name}”? Existing recipes are not affected.`)) return;
    deleteBlueprint(draft.id);
    setDraft(null);
    setSelectedBlueprintId(null);
  };

  const updateInput = (id: string, patch: Partial<RecipeSlotRule>) => {
    if (!draft) return;
    patchDraft({ inputs: draft.inputs.map((slot) => slot.id === id ? { ...slot, ...patch } : slot) });
  };

  const updateOutput = (id: string, patch: Partial<RecipeOutputSlotRule>) => {
    if (!draft) return;
    patchDraft({ outputs: draft.outputs.map((slot) => slot.id === id ? { ...slot, ...patch } : slot) });
  };

  const toggleApproval = (candidateId: string) => {
    setApprovedIds((current) => {
      const next = new Set(current);
      next.has(candidateId) ? next.delete(candidateId) : next.add(candidateId);
      return next;
    });
  };

  const createApproved = () => {
    if (!draft) return;
    const selectedRecipes = readyCandidates
      .filter((candidate) => approvedIds.has(candidate.id))
      .map((candidate) => candidate.recipe!);
    if (selectedRecipes.length === 0) {
      alert("Select at least one ready recipe.");
      return;
    }
    if (!confirm(`Create ${selectedRecipes.length} recipes from “${draft.name}”?`)) return;
    const result = addRecipesBatch(selectedRecipes, draft.recipeTagIds);
    alert(`Created ${result.added} recipes${result.skipped ? `; skipped ${result.skipped} conflicts` : ""}.`);
  };

  const filteredItems = items.filter((item) =>
    !itemSearch || item.name.toLowerCase().includes(itemSearch.toLowerCase()) || item.id.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const renderResolverFields = (
    slot: RecipeSlotRule | RecipeOutputSlotRule,
    onChange: (patch: Partial<RecipeSlotRule & RecipeOutputSlotRule>) => void,
    allowTag: boolean,
  ) => {
    if (slot.resolver === "fixedItem") {
      return (
        <label>Item
          <select className="config-input" value={slot.refId ?? ""} onChange={(event) => onChange({ refId: event.target.value })}>
            <option value="">Select item…</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      );
    }
    if (allowTag && slot.resolver === "fixedTag") {
      return (
        <label>Input tag
          <select className="config-input" value={slot.refId ?? ""} onChange={(event) => onChange({ refId: event.target.value })}>
            <option value="">Select tag…</option>
            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
        </label>
      );
    }
    if (slot.resolver !== "related") return null;
    const steps = slot.nameTransforms;
    const setSteps = (nextSteps: RecipeTransformStep[]) => onChange({ nameTransforms: nextSteps });
    const updateStep = (stepId: string, patch: Partial<RecipeTransformStep>) =>
      setSteps(steps.map((step) => step.id === stepId ? { ...step, ...patch } : step));
    return (
      <div className="rg-related-editor">
        <div className="rg-related-heading">
          <div><strong>Name changes</strong><small>Steps run from top to bottom. Spacing is added automatically.</small></div>
          <button className="btn-secondary" type="button" onClick={() => setSteps([...steps, makeRelatedTransform()])}>+ Add step</button>
        </div>
        <div className="rg-name-step-list">
          {steps.map((step, index) => (
            <div className="rg-name-step" key={step.id}>
              <span>{index + 1}</span>
              <select className="config-input" value={step.type} onChange={(event) => updateStep(step.id, { type: event.target.value as RecipeTransformType })}>
                {Object.entries(relatedTransformLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {step.type === "replace" ? (
                <>
                  <input className="config-input" value={step.replaceFrom ?? ""} onChange={(event) => updateStep(step.id, { replaceFrom: event.target.value })} placeholder="Find" />
                  <input className="config-input" value={step.replaceTo ?? ""} onChange={(event) => updateStep(step.id, { replaceTo: event.target.value })} placeholder="Replace with" />
                </>
              ) : step.type === "uppercase" || step.type === "lowercase" ? (
                <span className="rg-name-step-fill" />
              ) : (
                <input className="config-input" value={step.value ?? ""} onChange={(event) => updateStep(step.id, { value: event.target.value })} placeholder={step.type === "addSuffix" ? "Plate" : "Text"} />
              )}
              <button className="rg-icon-button" type="button" onClick={() => setSteps(steps.filter((entry) => entry.id !== step.id))}>×</button>
            </div>
          ))}
          {steps.length === 0 && <div className="rg-name-step-empty">No name changes. The source item name is used as-is.</div>}
        </div>
        <div className="rg-related-constraints">
          <label>Required tag
            <select className="config-input" value={slot.targetTagId ?? ""} onChange={(event) => onChange({ targetTagId: event.target.value || undefined })}>
              <option value="">Any tag</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
          <label>Required category
            <select className="config-input" value={slot.targetCategoryId ?? ""} onChange={(event) => onChange({ targetCategoryId: event.target.value || undefined })}>
              <option value="">Any category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  };

  return (
    <div className="recipe-studio">
      <aside className="recipe-studio-library">
        <div className="rg-library-heading">
          <h3>Recipe Patterns</h3>
          <button className="btn-primary rg-new-pattern-button" onClick={startBlank}>+ New</button>
        </div>
        <p className="help-text">Create many similar recipes from your item groups.</p>

        <div className="rg-import-row">
          <SearchableDropdown
            value={importRecipeId}
            options={recipes.map((recipe) => ({ value: recipe.id, label: recipe.name }))}
            onChange={setImportRecipeId}
            placeholder="Start from recipe…"
            className="rg-recipe-import-search"
          />
          <button className="btn-secondary" onClick={importRecipe} disabled={!importRecipeId}>Import</button>
        </div>

        <div className="rg-blueprint-list">
          {blueprints.map((blueprint) => (
            <button
              key={blueprint.id}
              className={`rg-blueprint-card ${selectedBlueprintId === blueprint.id ? "selected" : ""}`}
              onClick={() => selectBlueprint(blueprint)}
            >
              <strong>{blueprint.name}</strong>
              <span>{blueprint.inputs.length} inputs · {blueprint.outputs.length} outputs</span>
            </button>
          ))}
          {blueprints.length === 0 && <div className="rg-library-empty">No saved patterns yet.</div>}
        </div>
      </aside>

      {!draft ? (
        <main className="recipe-studio-empty">
          <div className="rg-empty-icon">⌘</div>
          <h2>Build a recipe pattern</h2>
          <p>Start blank or import an existing recipe. You will explicitly decide how every slot is resolved.</p>
          <button className="btn-primary btn-large" onClick={startBlank}>Create first pattern</button>
        </main>
      ) : (
        <main className="recipe-studio-workspace">
          <header className="rg-workspace-header">
            <div>
              <input className="rg-title-input" value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} />
            </div>
            <div className="rg-header-actions">
              {blueprints.some((entry) => entry.id === draft.id) && <button className="btn-danger" onClick={removeBlueprint}>Delete</button>}
              <button className="btn-primary" onClick={saveBlueprint}>Save pattern</button>
            </div>
          </header>

          <div className="rg-editor-scroll">
            <section className="rg-section">
              <div className="rg-section-heading"><span>1</span><div><h3>Source items</h3><p>Choose the only items this pattern is allowed to iterate over.</p></div></div>
              <div className="rg-two-column">
                <label>Combine active filters
                  <select className="config-input" value={draft.source.filterMode} onChange={(event) => patchSource({ filterMode: event.target.value as "all" | "any" })}>
                    <option value="all">Match all filter groups</option>
                    <option value="any">Match any filter group</option>
                  </select>
                </label>
                <label>Description
                  <input className="config-input" value={draft.description} onChange={(event) => patchDraft({ description: event.target.value })} placeholder="What this pattern generates" />
                </label>
              </div>
              <div className="rg-filter-columns">
                <div><h4>Include tags</h4><div className="rg-check-grid">{tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={draft.source.tagIds.includes(tag.id)} onChange={() => toggleSourceValue("tagIds", tag.id)} />{tag.name}<small>{tag.memberItemIds.length}</small></label>)}</div></div>
                <div><h4>Include categories</h4><div className="rg-check-grid">{categories.map((category) => <label key={category.id}><input type="checkbox" checked={draft.source.categoryIds.includes(category.id)} onChange={() => toggleSourceValue("categoryIds", category.id)} />{category.name}</label>)}</div></div>
                <div><h4>Manual items</h4><input className="config-input rg-item-search" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Search items…" /><div className="rg-check-grid rg-item-grid">{filteredItems.map((item) => <label key={item.id}><input type="checkbox" checked={draft.source.itemIds.includes(item.id)} onChange={() => toggleSourceValue("itemIds", item.id)} />{item.name}</label>)}</div></div>
              </div>
              <details className="rg-exclusions"><summary>Exclusions</summary><div className="rg-filter-columns"><div><h4>Exclude tags</h4><div className="rg-check-grid">{tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={draft.source.excludeTagIds.includes(tag.id)} onChange={() => toggleSourceValue("excludeTagIds", tag.id)} />{tag.name}</label>)}</div></div><div><h4>Exclude categories</h4><div className="rg-check-grid">{categories.map((category) => <label key={category.id}><input type="checkbox" checked={draft.source.excludeCategoryIds.includes(category.id)} onChange={() => toggleSourceValue("excludeCategoryIds", category.id)} />{category.name}</label>)}</div></div><div><h4>Exclude items</h4><div className="rg-check-grid rg-item-grid">{filteredItems.map((item) => <label key={item.id}><input type="checkbox" checked={draft.source.excludeItemIds.includes(item.id)} onChange={() => toggleSourceValue("excludeItemIds", item.id)} />{item.name}</label>)}</div></div></div></details>
            </section>

            <section className="rg-section">
              <div className="rg-section-heading"><span>2</span><div><h3>Recipe structure</h3><p>Choose where each ingredient and result comes from.</p></div></div>
              <div className="rg-slot-columns">
                <div><div className="rg-slot-column-heading"><h4>Inputs</h4><button className="btn-secondary" onClick={() => patchDraft({ inputs: [...draft.inputs, makeInput("fixedItem")] })}>+ Input</button></div>{draft.inputs.map((slot, index) => <div className="rg-slot-card" key={slot.id}><div className="rg-slot-card-heading"><strong>Input {index + 1}</strong><button className="rg-icon-button" onClick={() => patchDraft({ inputs: draft.inputs.filter((entry) => entry.id !== slot.id) })}>×</button></div><div className="rg-slot-grid"><label>Choose item from<select className="config-input" value={slot.resolver} onChange={(event) => updateInput(slot.id, { resolver: event.target.value as RecipeSlotResolver, refId: undefined })}><option value="source">Current source item</option><option value="fixedItem">One specific item</option><option value="fixedTag">An item tag</option><option value="related">A similarly named item</option></select></label><label>Amount<input className="config-input" type="number" min="0" step="any" value={slot.amount} onChange={(event) => updateInput(slot.id, { amount: Number(event.target.value) })} /></label></div>{renderResolverFields(slot, (patch) => updateInput(slot.id, patch), true)}</div>)}</div>
                <div><div className="rg-slot-column-heading"><h4>Outputs</h4><button className="btn-secondary" onClick={() => patchDraft({ outputs: [...draft.outputs, makeOutput()] })}>+ Output</button></div>{draft.outputs.map((slot, index) => <div className="rg-slot-card" key={slot.id}><div className="rg-slot-card-heading"><strong>Output {index + 1}</strong><button className="rg-icon-button" onClick={() => patchDraft({ outputs: draft.outputs.filter((entry) => entry.id !== slot.id) })}>×</button></div><div className="rg-slot-grid"><label>Choose item from<select className="config-input" value={slot.resolver} onChange={(event) => updateOutput(slot.id, { resolver: event.target.value as RecipeOutputSlotRule["resolver"], refId: undefined })}><option value="source">Current source item</option><option value="fixedItem">One specific item</option><option value="related">A similarly named item</option></select></label><label>Amount<input className="config-input" type="number" min="0" step="any" value={slot.amount} onChange={(event) => updateOutput(slot.id, { amount: Number(event.target.value) })} /></label><label>Chance<input className="config-input" type="number" min="0.0001" max="1" step="0.01" value={slot.probability} onChange={(event) => updateOutput(slot.id, { probability: Number(event.target.value) })} /></label></div>{renderResolverFields(slot, (patch) => updateOutput(slot.id, patch), false)}</div>)}</div>
              </div>
            </section>

            <section className="rg-section">
              <div className="rg-section-heading"><span>3</span><div><h3>Recipe settings</h3><p>Set how generated recipe names should look and how long they take. Spacing is added automatically.</p></div></div>
              <div className="rg-friendly-name-grid"><label>Text before item<input className="config-input" value={draft.recipeNamePrefix} onChange={(event) => patchDraft({ recipeNamePrefix: event.target.value })} placeholder="Process" /></label><label>Use item name from<select className="config-input" value={draft.recipeNameItem} onChange={(event) => patchDraft({ recipeNameItem: event.target.value as RecipeBlueprint["recipeNameItem"] })}><option value="source">Source item</option><option value="input1">First input</option><option value="output1">First output</option><option value="none">No item name</option></select></label><label>Text after item<input className="config-input" value={draft.recipeNameSuffix} onChange={(event) => patchDraft({ recipeNameSuffix: event.target.value })} placeholder="Recipe" /></label><label>Duration (seconds)<input className="config-input" type="number" min="0" step="any" value={draft.timeSeconds} onChange={(event) => patchDraft({ timeSeconds: Number(event.target.value) })} /></label></div>
              <div><h4>Assign recipe tags</h4><div className="rg-check-grid rg-horizontal-checks">{recipeTags.map((tag) => <label key={tag.id}><input type="checkbox" checked={draft.recipeTagIds.includes(tag.id)} onChange={() => patchDraft({ recipeTagIds: draft.recipeTagIds.includes(tag.id) ? draft.recipeTagIds.filter((id) => id !== tag.id) : [...draft.recipeTagIds, tag.id] })} />{tag.name}</label>)}</div></div>
            </section>

            <section className="rg-section rg-preview-section">
              <div className="rg-preview-heading"><div className="rg-section-heading"><span>4</span><div><h3>Live preview</h3><p>Only green rows can be created. Expand a row to see exactly why it matched.</p></div></div><div className="rg-preview-actions"><div className="rg-stats"><span className="ready">{readyCandidates.length} ready</span><span>{candidates.filter((candidate) => candidate.status === "conflict").length} conflicts</span><span>{candidates.filter((candidate) => candidate.status === "error").length} errors</span></div><button className="btn-primary" onClick={createApproved} disabled={!readyCandidates.some((candidate) => approvedIds.has(candidate.id))}>Create {readyCandidates.filter((candidate) => approvedIds.has(candidate.id)).length} approved</button></div></div>
              <div className="rg-preview-list">
                {candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} approved={approvedIds.has(candidate.id)} expanded={expandedCandidateId === candidate.id} onToggleApproval={() => toggleApproval(candidate.id)} onToggleExpanded={() => setExpandedCandidateId(expandedCandidateId === candidate.id ? null : candidate.id)} items={items} tags={tags} />)}
                {candidates.length === 0 && <div className="rg-preview-empty">Choose at least one source tag, category, or manual item to produce a preview.</div>}
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}

function CandidateCard({ candidate, approved, expanded, onToggleApproval, onToggleExpanded, items, tags }: {
  candidate: RecipeCandidate;
  approved: boolean;
  expanded: boolean;
  onToggleApproval: () => void;
  onToggleExpanded: () => void;
  items: Item[];
  tags: Array<{ id: string; name: string }>;
}) {
  const recipe = candidate.recipe;
  const inputName = (refType: "item" | "tag", refId: string) => refType === "item"
    ? items.find((item) => item.id === refId)?.name ?? refId
    : tags.find((tag) => tag.id === refId)?.name ?? refId;
  return (
    <article className={`rg-candidate ${candidate.status} ${approved ? "approved" : ""}`}>
      <div className="rg-candidate-main">
        <input type="checkbox" checked={approved} disabled={candidate.status !== "ready"} onChange={onToggleApproval} />
        <button className="rg-candidate-summary" onClick={onToggleExpanded}>
          <span className={`rg-status-dot ${candidate.status}`} />
          <span><strong>{recipe?.name ?? candidate.sourceItem.name}</strong><small>{candidate.sourceItem.name} · {candidate.status}</small></span>
          {recipe && <span className="rg-io-summary"><span>{recipe.inputs.map((input) => `${input.amount}× ${inputName(input.refType, input.refId)}`).join(" + ")}</span><b>→</b><span>{recipe.outputs.map((output) => `${output.amount}× ${inputName("item", output.itemId)}`).join(" + ")}</span></span>}
          <span className="rg-expand">{expanded ? "▴" : "▾"}</span>
        </button>
      </div>
      {expanded && <div className="rg-candidate-detail">{candidate.messages.length > 0 && <div className="rg-message-list">{candidate.messages.map((message) => <div key={message}>{message}</div>)}</div>}<ol>{candidate.trace.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol></div>}
    </article>
  );
}
