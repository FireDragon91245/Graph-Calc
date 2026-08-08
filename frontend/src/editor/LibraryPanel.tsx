import { useMemo, useState } from "react";
import {
  useGraphStore,
  Category,
  Item,
  Tag,
  Recipe,
  RecipeInput,
  RecipeOutput
} from "../store/graphStore";
import { useTranslation } from "react-i18next";

type LibraryPanelProps = {
  onCreateInputNode: (itemId: string) => void;
  onCreateOutputNode: (itemId: string) => void;
  onCreateRecipeNode: (recipeId: string) => void;
};

type RecipeFormState = {
  name: string;
  timeSeconds: number;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
};

const createInputRow = (index: number): RecipeInput => ({
  id: `i${index}`,
  refType: "item",
  refId: "",
  amount: 1
});

const createOutputRow = (index: number): RecipeOutput => ({
  id: `o${index}`,
  itemId: "",
  amount: 1,
  probability: 1
});

export default function LibraryPanel({
  onCreateInputNode,
  onCreateOutputNode,
  onCreateRecipeNode
}: LibraryPanelProps) {
  const { t } = useTranslation();
  const categories = useGraphStore((state) => state.categories);
  const items = useGraphStore((state) => state.items);
  const tags = useGraphStore((state) => state.tags);
  const recipes = useGraphStore((state) => state.recipes);
  const addCategory = useGraphStore((state) => state.addCategory);
  const addItem = useGraphStore((state) => state.addItem);
  const addTag = useGraphStore((state) => state.addTag);
  const addRecipe = useGraphStore((state) => state.addRecipe);

  const [categoryName, setCategoryName] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState<string>("");
  const [tagName, setTagName] = useState("");
  const [tagMembers, setTagMembers] = useState<string[]>([]);

  const [recipeForm, setRecipeForm] = useState<RecipeFormState>({
    name: "",
    timeSeconds: 2,
    inputs: [createInputRow(1)],
    outputs: [createOutputRow(1)]
  });

  const itemOptions = useMemo(
    () => items.map((item) => ({ value: item.id, label: item.name })),
    [items]
  );

  const tagOptions = useMemo(
    () => tags.map((tag) => ({ value: tag.id, label: tag.name })),
    [tags]
  );

  const handleAddCategory = () => {
    if (!categoryName.trim()) return;
    addCategory(categoryName.trim());
    setCategoryName("");
  };

  const handleAddItem = () => {
    if (!itemName.trim()) return;
    addItem({ name: itemName.trim(), categoryId: itemCategoryId || undefined });
    setItemName("");
  };

  const handleAddTag = () => {
    if (!tagName.trim()) return;
    const formatted = tagName.startsWith("@") ? tagName : `@${tagName}`;
    addTag({ name: formatted, memberItemIds: tagMembers });
    setTagName("");
    setTagMembers([]);
  };

  const handleAddRecipe = () => {
    if (!recipeForm.name.trim()) return;
    const inputs = recipeForm.inputs.filter((input) => input.refId);
    const outputs = recipeForm.outputs.filter((output) => output.itemId);
    if (!inputs.length || !outputs.length) return;

    addRecipe({
      name: recipeForm.name.trim(),
      timeSeconds: recipeForm.timeSeconds,
      inputs,
      outputs
    });

    setRecipeForm({
      name: "",
      timeSeconds: 2,
      inputs: [createInputRow(1)],
      outputs: [createOutputRow(1)]
    });
  };

  const updateRecipeInput = (index: number, update: Partial<RecipeInput>) => {
    setRecipeForm((state) => ({
      ...state,
      inputs: state.inputs.map((input, idx) => (idx === index ? { ...input, ...update } : input))
    }));
  };

  const updateRecipeOutput = (index: number, update: Partial<RecipeOutput>) => {
    setRecipeForm((state) => ({
      ...state,
      outputs: state.outputs.map((output, idx) => (idx === index ? { ...output, ...update } : output))
    }));
  };

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">{t("ui.library.categories")}</div>
        <div className="form-row">
          <input
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            placeholder={t("ui.library.newCategory")}
          />
          <button onClick={handleAddCategory}>{t("common.actions.add")}</button>
        </div>
        <div className="list">
          {categories.map((category) => (
            <div key={category.id} className="list-row">
              <span>{category.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">{t("ui.library.ingredients")}</div>
        <div className="form-grid">
          <input
            value={itemName}
            onChange={(event) => setItemName(event.target.value)}
            placeholder={t("ui.library.itemName")}
          />
          <select value={itemCategoryId} onChange={(event) => setItemCategoryId(event.target.value)}>
            <option value="">{t("ui.library.noCategory")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button onClick={handleAddItem}>{t("common.actions.add")}</button>
        </div>
        <div className="list">
          {items.map((item) => (
            <div key={item.id} className="list-row">
              <span>{item.name}</span>
              <div className="list-actions">
                <button onClick={() => onCreateInputNode(item.id)}>{t("ui.nodes.input")}</button>
                <button onClick={() => onCreateOutputNode(item.id)}>{t("ui.nodes.output")}</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">{t("ui.library.tags")}</div>
        <div className="form-grid">
          <input
            value={tagName}
            onChange={(event) => setTagName(event.target.value)}
            placeholder="@tag"
          />
          <select
            multiple
            value={tagMembers}
            onChange={(event) =>
              setTagMembers(Array.from(event.target.selectedOptions).map((option) => option.value))
            }
          >
            {itemOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button onClick={handleAddTag}>{t("common.actions.add")}</button>
        </div>
        <div className="list">
          {tags.map((tag) => (
            <div key={tag.id} className="list-row">
              <span>{tag.name}</span>
              <span className="muted">{tag.memberItemIds.length} items</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">{t("ui.library.recipes")}</div>
        <div className="form-grid">
          <input
            value={recipeForm.name}
            onChange={(event) => setRecipeForm((state) => ({ ...state, name: event.target.value }))}
            placeholder={t("ui.library.recipeName")}
          />
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={recipeForm.timeSeconds}
            onChange={(event) =>
              setRecipeForm((state) => ({ ...state, timeSeconds: Number(event.target.value) }))
            }
            placeholder={t("ui.library.time")}
          />
        </div>
        <div className="subsection">
          <div className="subsection-title">{t("ui.library.inputs")}</div>
          {recipeForm.inputs.map((input, index) => (
            <div key={input.id} className="form-row">
              <select
                value={input.refType}
                onChange={(event) =>
                  updateRecipeInput(index, { refType: event.target.value as RecipeInput["refType"] })
                }
              >
                <option value="item">{t("ui.library.item")}</option>
                <option value="tag">{t("ui.library.tag")}</option>
              </select>
              <select
                value={input.refId}
                onChange={(event) => updateRecipeInput(index, { refId: event.target.value })}
              >
                <option value="">{t("ui.library.select")}</option>
                {(input.refType === "item" ? itemOptions : tagOptions).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.1"
                value={input.amount}
                onChange={(event) => updateRecipeInput(index, { amount: Number(event.target.value) })}
              />
            </div>
          ))}
          <button
            className="ghost"
            onClick={() =>
              setRecipeForm((state) => ({
                ...state,
                inputs: [...state.inputs, createInputRow(state.inputs.length + 1)]
              }))
            }
          >
            + Add input
          </button>
        </div>
        <div className="subsection">
          <div className="subsection-title">{t("ui.library.outputs")}</div>
          {recipeForm.outputs.map((output, index) => (
            <div key={output.id} className="form-row">
              <select
                value={output.itemId}
                onChange={(event) => updateRecipeOutput(index, { itemId: event.target.value })}
              >
                <option value="">{t("ui.library.select")}</option>
                {itemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.1"
                value={output.amount}
                onChange={(event) => updateRecipeOutput(index, { amount: Number(event.target.value) })}
              />
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={output.probability}
                onChange={(event) =>
                  updateRecipeOutput(index, { probability: Number(event.target.value) })
                }
              />
            </div>
          ))}
          <button
            className="ghost"
            onClick={() =>
              setRecipeForm((state) => ({
                ...state,
                outputs: [...state.outputs, createOutputRow(state.outputs.length + 1)]
              }))
            }
          >
            + Add output
          </button>
        </div>
        <button className="primary full" onClick={handleAddRecipe}>
          Add Recipe
        </button>

        <div className="list">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="list-row">
              <span>{recipe.name}</span>
              <div className="list-actions">
                <button onClick={() => onCreateRecipeNode(recipe.id)}>{t("ui.library.addNode")}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
