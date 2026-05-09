const STORAGE_KEY = "cugent.llm.settings";
const LEGACY_STORAGE_KEY = "cubeagent.llm.settings";

export const defaultLlmSettings = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5.4-mini"
};

export function loadLlmSettings() {
  if (typeof window === "undefined") {
    return defaultLlmSettings;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return defaultLlmSettings;
    }

    const parsed = JSON.parse(raw);
    return sanitizeLlmSettings(parsed);
  } catch {
    return defaultLlmSettings;
  }
}

export function saveLlmSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }

  const next = sanitizeLlmSettings(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function sanitizeLlmSettings(input) {
  return {
    enabled: input?.enabled !== false,
    baseUrl: normalizeBaseUrl(input?.baseUrl || defaultLlmSettings.baseUrl),
    apiKey: String(input?.apiKey || ""),
    model: String(input?.model || defaultLlmSettings.model)
  };
}

function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}
