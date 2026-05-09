import { executeAgentToolCall, getAgentToolSchemas } from "./tool-registry.js";
import { extractChatCompletionText, joinChatCompletionsUrl, LlmClientError } from "./llm-client.js";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TOOL_CALL_ROUNDS = 4;

export async function runLlmAgentLoop({ message, context, options = {} }) {
  validateLlmSettings(context?.llmSettings);

  const messages = buildAgentLoopMessages({ message, context });
  const tools = getAgentToolSchemas();
  const executedToolCalls = [];
  let latestContext = { ...(context ?? {}) };
  let latestToolResult = {
    type: "chat",
    message: "未命中特定魔方工具，交给普通聊天模型处理。"
  };
  let finalText = "";
  let usage = null;
  let responseId = null;
  let responseModel = context.llmSettings.model;

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
    const result = await requestAgentLoopCompletion({
      llmSettings: context.llmSettings,
      messages,
      tools,
      signal: options.signal
    });

    responseId = result?.id ?? responseId;
    responseModel = result?.model ?? responseModel;
    usage = result?.usage ?? usage;

    const choiceMessage = result?.choices?.[0]?.message;
    const toolCalls = Array.isArray(choiceMessage?.tool_calls) ? choiceMessage.tool_calls : [];

    if (!toolCalls.length) {
      finalText = extractChatCompletionText(result) || String(choiceMessage?.content ?? "").trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: choiceMessage?.content ?? "",
      reasoning_content: choiceMessage?.reasoning_content ?? undefined,
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      const args = parseToolCallArguments(toolCall.function?.arguments);
      const execution = await executeAgentToolSafely({
        toolCall,
        args,
        latestContext
      });

      executedToolCalls.push({
        name: toolCall.function?.name ?? "unknown",
        args,
        status: execution.toolResult?.type === "error" ? "error" : "completed",
        result: execution.content
      });

      latestToolResult = execution.toolResult ?? latestToolResult;
      latestContext = mergeContextPatch(latestContext, execution.contextPatch);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(execution.content)
      });
    }
  }

  if (!finalText) {
    throw new LlmClientError("LLM_EMPTY_RESPONSE", "LLM 未返回最终可展示内容。");
  }

  return {
    intent: {
      type: "agent-loop",
      confidence: 1,
      params: {}
    },
    toolCalls: executedToolCalls,
    toolResult: latestToolResult,
    contextPatch: buildContextPatchDiff(context, latestContext),
    llmText: finalText,
    llmMeta: {
      enabled: true,
      status: "complete",
      source: "openai-compatible",
      model: responseModel,
      responseId,
      usage,
      streaming: false,
      toolLoop: true
    }
  };
}

function buildAgentLoopMessages({ message, context }) {
  return [
    {
      role: "system",
      content: [
        "你是 Cugent 的中文魔方教练助手。",
        "你可以调用本地确定性工具来完成 solve 导入、分段分析、公式查询与播放链接生成。",
        "所有魔方事实必须来自工具结果，不能自行猜测 cube state、阶段完成情况、case、公式或链接。",
        "如果用户在讨论当前 solve，优先直接利用上下文中的 currentSolveReview；只有需要聚焦某个阶段时再调用 inspect_solve_segment。",
        "如果用户提供了 scramble 与 timedMoves，优先调用 create_solve_review。",
        "如果用户询问公式、候选、替换建议，优先调用 search_algorithms 或 inspect_solve_segment。",
        "如果工具结果里已经提供了公式 playback.url，正文中可以直接使用标准 Markdown 链接格式：[公式文本](https://alg.cubing.net/...)。",
        "必须原样使用工具结果提供的 playback.url，不要改写 URL，不要输出 BBCode。",
        "最终回复请使用中文，先给结论，再补最关键的证据和下一步建议。"
      ].join("\n")
    },
    {
      role: "system",
      content: `当前上下文：\n${JSON.stringify(compactLoopContext(context), null, 2)}`
    },
    {
      role: "user",
      content: String(message ?? "").trim() || "(空)"
    }
  ];
}

function compactLoopContext(context) {
  if (!context || typeof context !== "object") {
    return {};
  }

  return {
    selectedSegmentId: context.selectedSegmentId ?? null,
    currentSolveReview: context.currentSolveReview ? {
      puzzle: context.currentSolveReview.puzzle,
      summary: context.currentSolveReview.summary,
      segmentation: context.currentSolveReview.segmentation,
      segments: context.currentSolveReview.segments?.map((segment) => ({
        id: segment.id,
        label: segment.label,
        moveCount: segment.moveCount,
        effectiveMoveCount: segment.effectiveMoveCount,
        recognition: segment.recognition
      })) ?? []
    } : null
  };
}

async function requestAgentLoopCompletion({ llmSettings, messages, tools, signal }) {
  const response = await fetchWithTimeout(joinChatCompletionsUrl(llmSettings.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${String(llmSettings.apiKey).trim()}`
    },
    body: JSON.stringify({
      model: llmSettings.model,
      stream: false,
      messages,
      tools,
      tool_choice: "auto"
    })
  }, DEFAULT_TIMEOUT_MS, signal);

  if (!response.ok) {
    throw await createHttpError(response);
  }

  return response.json();
}

async function executeAgentToolSafely({ toolCall, args, latestContext }) {
  try {
    return await executeAgentToolCall({
      name: toolCall.function?.name,
      args,
      context: latestContext
    });
  } catch (error) {
    return {
      toolResult: {
        type: "error",
        code: "TOOL_EXECUTION_FAILED",
        message: String(error?.message ?? error ?? "工具执行失败。")
      },
      content: {
        type: "error",
        code: "TOOL_EXECUTION_FAILED",
        message: String(error?.message ?? error ?? "工具执行失败。")
      },
      contextPatch: {}
    };
  }
}

function parseToolCallArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

function mergeContextPatch(context, patch) {
  return {
    ...(context ?? {}),
    ...(patch ?? {})
  };
}

function buildContextPatchDiff(previousContext = {}, nextContext = {}) {
  const diff = {};

  for (const [key, value] of Object.entries(nextContext)) {
    if (previousContext[key] !== value) {
      diff[key] = value;
    }
  }

  return diff;
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

async function fetchWithTimeout(url, options, timeoutMs, signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new DOMException("Timeout", "AbortError")), timeoutMs);

  const abortHandler = () => controller.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  signal?.addEventListener("abort", abortHandler);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (signal?.aborted) {
        throw new LlmClientError("LLM_ABORTED", "已停止生成。");
      }
      throw new LlmClientError("LLM_TIMEOUT", "LLM 请求超时。");
    }

    if (error instanceof TypeError) {
      throw new LlmClientError("LLM_NETWORK_OR_CORS", "无法连接到兼容接口，可能是网络失败或浏览器跨域限制。");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}

async function createHttpError(response) {
  const status = response.status;
  let detail = null;

  try {
    detail = await response.json();
  } catch {
    detail = null;
  }

  if (status === 401 || status === 403) {
    return new LlmClientError("LLM_AUTH_FAILED", "鉴权失败，请检查 API Key 或接口权限。", { status, detail });
  }
  if (status === 429) {
    return new LlmClientError("LLM_RATE_LIMIT", "接口触发限流，请稍后重试。", { status, detail });
  }
  if (status >= 500) {
    return new LlmClientError("LLM_UPSTREAM_ERROR", "模型服务暂时不可用，请稍后再试。", { status, detail });
  }

  return new LlmClientError("LLM_HTTP_ERROR", `模型接口请求失败（${status}）。`, { status, detail });
}
