const STORAGE_KEY = "cugent.llm.settings";
const LEGACY_STORAGE_KEY = "cubeagent.llm.settings";

export const llmProviderProfiles = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "默认模型服务，只需要填写 API Key。",
    compatibility: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    capabilities: {
      streaming: true,
      tools: true,
      usage: true,
      reasoning: true
    }
  },
  {
    id: "custom-openai-compatible",
    label: "自定义兼容接口",
    description: "已有其他兼容接口时使用。",
    compatibility: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    capabilities: {
      streaming: true,
      tools: true,
      usage: false,
      reasoning: false
    }
  }
];

export const defaultProviderProfile = llmProviderProfiles[0];

export const defaultLlmSettings = {
  enabled: true,
  providerId: defaultProviderProfile.id,
  providerLabel: defaultProviderProfile.label,
  compatibility: defaultProviderProfile.compatibility,
  capabilities: defaultProviderProfile.capabilities,
  baseUrl: defaultProviderProfile.defaultBaseUrl,
  apiKey: "",
  model: defaultProviderProfile.defaultModel
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
  const profile = findLlmProviderProfile(input?.providerId ?? input?.provider);
  const baseUrl = normalizeBaseUrl(input?.baseUrl || profile.defaultBaseUrl);
  const model = profile.id === "custom-openai-compatible"
    ? String(input?.model || profile.defaultModel)
    : profile.defaultModel;

  return {
    enabled: input?.enabled !== false,
    providerId: profile.id,
    providerLabel: profile.label,
    provider: profile.id,
    compatibility: profile.compatibility,
    capabilities: {
      ...profile.capabilities,
      ...(input?.capabilities && typeof input.capabilities === "object" ? input.capabilities : {})
    },
    baseUrl,
    apiKey: String(input?.apiKey || ""),
    model
  };
}

export function findLlmProviderProfile(providerId) {
  const normalized = String(providerId ?? "").trim();
  if (normalized === "openrouter") {
    return defaultProviderProfile;
  }
  return llmProviderProfiles.find((profile) => profile.id === normalized) ?? defaultProviderProfile;
}

export function applyLlmProviderProfile(settings, providerId) {
  const profile = findLlmProviderProfile(providerId);
  return sanitizeLlmSettings({
    ...settings,
    providerId: profile.id,
    provider: profile.id,
    providerLabel: profile.label,
    compatibility: profile.compatibility,
    capabilities: profile.capabilities,
    baseUrl: profile.defaultBaseUrl,
    model: profile.defaultModel
  });
}

function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}
