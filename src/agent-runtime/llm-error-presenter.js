const USER_ERROR_MESSAGES = {
  LLM_DISABLED: "AI 辅助还没有开启。",
  LLM_BASE_URL_MISSING: "模型服务还没有配置完整。",
  LLM_API_KEY_MISSING: "还没有填写 API Key。",
  LLM_MODEL_MISSING: "模型服务还没有配置完整。",
  LLM_AUTH_FAILED: "API Key 可能不正确，或者当前账号没有权限使用这个模型。",
  LLM_RATE_LIMIT: "模型服务现在有点忙，可以稍后再试。",
  LLM_UPSTREAM_ERROR: "模型服务暂时不可用，可以稍后再试。",
  LLM_NETWORK_OR_CORS: "暂时连不上模型服务，请检查网络或当前服务是否允许网页访问。",
  LLM_TIMEOUT: "模型响应超时了，可以稍后重试。",
  LLM_EMPTY_RESPONSE: "模型没有返回可用内容。",
  LLM_ABORTED: "已停止生成。"
};

export function getUserFacingLlmError(error) {
  const code = error?.code ?? "LLM_UNKNOWN_ERROR";
  return {
    code,
    message: USER_ERROR_MESSAGES[code] ?? "AI 辅助暂时不可用，已保留本地分析结果。",
    detail: error?.message ?? null
  };
}

export function buildChatLlmFallbackText(error) {
  const userError = getUserFacingLlmError(error);
  return userError.message;
}
