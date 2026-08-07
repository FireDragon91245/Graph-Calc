export async function copyTextToClipboard(value: string): Promise<void> {
  rememberedClipboardText = value;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for browsers that expose the API but deny it in this context.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("The browser denied clipboard access.");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

let rememberedClipboardText: string | null = null;

export function rememberClipboardText(value: string): void {
  rememberedClipboardText = value;
}

export type ClipboardReadResult = {
  text: string | null;
  source: "system" | "memory" | "none";
};

export async function readTextFromClipboard(): Promise<ClipboardReadResult> {
  if (navigator.clipboard?.readText) {
    try {
      return { text: await navigator.clipboard.readText(), source: "system" };
    } catch {
      // Browser permission can be denied even after a successful copy.
    }
  }

  if (rememberedClipboardText !== null) {
    return { text: rememberedClipboardText, source: "memory" };
  }

  return { text: null, source: "none" };
}

export const toPrettyJson = (value: unknown): string => JSON.stringify(value, null, 2);
