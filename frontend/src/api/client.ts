import i18n, { getCurrentLanguage } from "../i18n";

const API_BASE = "/api";

if (import.meta.env.DEV) {
  console.info("[api] configured base", API_BASE);
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!headers.has("Accept-Language")) {
    headers.set("Accept-Language", getCurrentLanguage());
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestUrl = `${API_BASE}${path}`;

  if (import.meta.env.DEV) {
    console.debug("[api] request", {
      method: init.method ?? "GET",
      url: requestUrl,
    });
  }

  try {
    const response = await fetch(requestUrl, {
      ...init,
      credentials: "include",
      headers
    });

    if (import.meta.env.DEV) {
      console.debug("[api] response", {
        method: init.method ?? "GET",
        url: requestUrl,
        status: response.status,
        ok: response.ok,
      });
    }

    return response;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[api] network failure", {
        method: init.method ?? "GET",
        url: requestUrl,
        error,
      });
    }
    throw error;
  }
}

export async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.code === "string" && data.code && i18n.exists(data.code)) {
      const values = data.args && typeof data.args === "object" ? data.args : undefined;
      return String(i18n.t(data.code, values));
    }
    if (typeof data?.detail === "string" && data.detail) {
      return data.detail;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) {
        return text;
      }
    } catch {
      return i18n.exists(fallback) ? i18n.t(fallback) : fallback;
    }
  }

  return i18n.exists(fallback) ? i18n.t(fallback) : fallback;
}
