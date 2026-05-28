import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LlmClientError } from "./llm-error.js";

const DEFAULT_PROVIDER_ID = "openai-compatible";
const DEFAULT_CAPABILITIES = {
  streaming: true,
  tools: true,
  usage: true,
  reasoning: false
};

export function resolveLlmModel(llmSettings) {
  validateLlmSettings(llmSettings);
  if (llmSettings.modelInstance) {
    const providerId = normalizeProviderId(llmSettings.providerId ?? llmSettings.provider);
    const capabilities = resolveCapabilities(llmSettings);
    return {
      model: llmSettings.modelInstance,
      provider: {
        id: providerId,
        label: llmSettings.providerLabel ?? providerId,
        source: "ai-sdk",
        compatibility: llmSettings.compatibility ?? "openai-compatible",
        capabilities
      }
    };
  }

  const providerId = normalizeProviderId(llmSettings.providerId ?? llmSettings.provider);
  const capabilities = resolveCapabilities(llmSettings);
  const provider = createOpenAICompatible({
    name: providerId,
    apiKey: String(llmSettings.apiKey).trim(),
    baseURL: normalizeBaseUrl(llmSettings.baseUrl),
    includeUsage: capabilities.usage !== false
  });

  return {
    model: provider(String(llmSettings.model).trim()),
    provider: {
      id: providerId,
      label: llmSettings.providerLabel ?? providerId,
      source: "ai-sdk",
      compatibility: llmSettings.compatibility ?? "openai-compatible",
      capabilities
    }
  };
}

function resolveCapabilities(llmSettings) {
  return {
    ...DEFAULT_CAPABILITIES,
    ...(llmSettings.capabilities && typeof llmSettings.capabilities === "object" ? llmSettings.capabilities : {})
  };
}

export function normalizeLlmError(error) {
  if (error instanceof LlmClientError) {
    return error;
  }

  if (error?.name === "AbortError") {
    return new LlmClientError("LLM_ABORTED", "已停止生成。");
  }

  const status = error?.statusCode ?? error?.status ?? error?.response?.status ?? null;
  if (status === 401 || status === 403) {
    return new LlmClientError("LLM_AUTH_FAILED", "鉴权失败，请检查 API Key 或接口权限。", { status, detail: error });
  }
  if (status === 429) {
    return new LlmClientError("LLM_RATE_LIMIT", "接口触发限流，请稍后重试。", { status, detail: error });
  }
  if (status >= 500) {
    return new LlmClientError("LLM_UPSTREAM_ERROR", "模型服务暂时不可用，请稍后再试。", { status, detail: error });
  }

  const message = String(error?.message ?? error ?? "");
  if (/aborted|abort/i.test(message)) {
    return new LlmClientError("LLM_ABORTED", "已停止生成。");
  }
  if (/timeout/i.test(message)) {
    return new LlmClientError("LLM_TIMEOUT", "LLM 请求超时。");
  }
  if (/fetch failed|network|cors/i.test(message)) {
    return new LlmClientError("LLM_NETWORK_OR_CORS", "无法连接到兼容接口，可能是网络失败或浏览器跨域限制。");
  }

  return new LlmClientError("LLM_UPSTREAM_ERROR", message || "模型调用失败。", { status, detail: error });
}

function validateLlmSettings(llmSettings) {
  if (!llmSettings || llmSettings.enabled === false) {
    throw new LlmClientError("LLM_DISABLED", "当前未启用 LLM。");
  }
  if (!String(llmSettings.baseUrl ?? "").trim()) {
    throw new LlmClientError("LLM_BASE_URL_MISSING", "请先填写接口基地址。");
  }
  if (!String(llmSettings.apiKey ?? "").trim()) {
    throw new LlmClientError("LLM_API_KEY_MISSING", "请先填写 API Key。");
  }
  if (!String(llmSettings.model ?? "").trim()) {
    throw new LlmClientError("LLM_MODEL_MISSING", "请先填写模型名。");
  }
}

function normalizeProviderId(provider) {
  return String(provider ?? DEFAULT_PROVIDER_ID).trim() || DEFAULT_PROVIDER_ID;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? "").trim().replace(/\/+$/, "");
}
