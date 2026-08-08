import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/translation.json";
import de from "./locales/de/translation.json";
import enUi from "./locales/en/ui.json";
import deUi from "./locales/de/ui.json";
import enMerge from "./locales/en/merge.json";
import deMerge from "./locales/de/merge.json";
import enRecipeGenerator from "./locales/en/recipe-generator.json";
import deRecipeGenerator from "./locales/de/recipe-generator.json";
import enItemGenerator from "./locales/en/item-generator.json";
import deItemGenerator from "./locales/de/item-generator.json";
import enQuickActions from "./locales/en/quick-actions.json";
import deQuickActions from "./locales/de/quick-actions.json";
import enRecipeEngine from "./locales/en/recipe-engine.json";
import deRecipeEngine from "./locales/de/recipe-engine.json";
import enPersistenceErrors from "./locales/en/persistence-errors.json";
import dePersistenceErrors from "./locales/de/persistence-errors.json";

export const supportedLanguages = ["en", "de"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const LANGUAGE_STORAGE_KEY = "graphcalc.language.v1";

function normalizeLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().split("-")[0];
  return supportedLanguages.includes(base as SupportedLanguage) ? base as SupportedLanguage : null;
}

function detectLanguage(): SupportedLanguage {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "en";
  const stored = normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  if (stored) return stored;

  for (const candidate of navigator.languages ?? [navigator.language]) {
    const language = normalizeLanguage(candidate);
    if (language) return language;
  }

  return "en";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, persistenceErrors: enPersistenceErrors, ui: { ...enUi, merge: enMerge, recipeGenerator: enRecipeGenerator, itemGenerator: enItemGenerator, quickActions: enQuickActions, recipeEngine: enRecipeEngine } } },
      de: { translation: { ...de, persistenceErrors: dePersistenceErrors, ui: { ...deUi, merge: deMerge, recipeGenerator: deRecipeGenerator, itemGenerator: deItemGenerator, quickActions: deQuickActions, recipeEngine: deRecipeEngine } } },
    },
    lng: detectLanguage(),
    fallbackLng: "en",
    supportedLngs: [...supportedLanguages],
    load: "languageOnly",
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export function getCurrentLanguage(): SupportedLanguage {
  return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "en";
}

export async function setCurrentLanguage(language: SupportedLanguage): Promise<void> {
  if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  await i18n.changeLanguage(language);
}

function updateDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;
  const normalized = normalizeLanguage(language) ?? "en";
  document.documentElement.lang = normalized;
  document.title = i18n.t("app.documentTitle");
}

i18n.on("initialized", () => updateDocumentLanguage(i18n.resolvedLanguage ?? i18n.language));
i18n.on("languageChanged", updateDocumentLanguage);

export default i18n;
