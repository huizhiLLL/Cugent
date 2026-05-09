import { executeAgentToolCall, getAgentToolSchemas } from "./tool-registry.js";
import { joinChatCompletionsUrl, LlmClientError } from "./llm-client.js";

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
  options.onAgentEvent?.({
    phase: "thinking",
    toolCalls: [],
    text: "我先看看要不要调用工具。"
  });

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
    const result = await requestAgentLoopCompletion({
      llmSettings: context.llmSettings,
      messages,
      tools,
      signal: options.signal,
      onTextDelta: options.onTextDelta,
      onAgentEvent: options.onAgentEvent,
      existingToolCalls: executedToolCalls
    });

    responseId = result?.id ?? responseId;
    responseModel = result?.model ?? responseModel;
    usage = result?.usage ?? usage;

    const choiceMessage = result?.choices?.[0]?.message;
    const toolCalls = Array.isArray(choiceMessage?.tool_calls) ? choiceMessage.tool_calls : [];

    if (!toolCalls.length) {
      options.onAgentEvent?.({
        phase: "finalizing",
        toolCalls: executedToolCalls,
        text: "结果已经齐了，正在整理回答。"
      });
      finalText = String(choiceMessage?.content ?? "").trim();
      break;
    }

    options.onAgentEvent?.({
      phase: "tool_calling",
      toolCalls: [
        ...executedToolCalls,
        ...toolCalls.map((toolCall) => ({
          name: toolCall.function?.name ?? "unknown",
          args: parseToolCallArguments(toolCall.function?.arguments),
          status: "running",
          result: null
        }))
      ],
      text: `正在处理：${toolCalls.map((toolCall) => formatToolName(toolCall.function?.name ?? "unknown")).join("、")}。`
    });

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
        latestContext,
        onAgentEvent: options.onAgentEvent,
        executedToolCalls
      });

      executedToolCalls.push({
        name: toolCall.function?.name ?? "unknown",
        args,
        status: execution.toolResult?.type === "error" ? "error" : "completed",
        result: execution.content
      });

      options.onAgentEvent?.({
        phase: "tool_returned",
        toolCalls: [...executedToolCalls],
        text: `${formatToolName(toolCall.function?.name ?? "unknown")} 已准备好。`
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
        "你是运行在 Cugent 的中文魔方教练助手。",
        "你可以调用本地确定性工具来完成 solve 导入、分段分析、公式查询与播放链接生成。",
        "所有魔方事实必须来自工具结果，不能自行猜测 cube state、阶段完成情况、case、公式或链接。",
        "如果用户在讨论当前 solve，优先直接利用上下文中的 currentSolveReview；只有需要聚焦某个阶段时再调用 inspect_solve_segment。",
        "如果用户提供了 scramble 与 timedMoves，优先调用 create_solve_review。",
        "如果用户询问公式、候选、替换建议，优先调用 search_algorithms 或 inspect_solve_segment。",
        "如果工具结果里已经提供了公式 playback.url，正文中可以直接使用标准 Markdown 链接格式：[公式文本](https://alg.cubing.net/...)。",
        "必须原样使用工具结果提供的 playback.url，不要改写 URL，不要输出 BBCode。",
        "不要写空话、套话、安慰性表述或没有证据支撑的评价，例如“这次复原没有问题”“这个 PLL 做得很快”。",
        "如果要评价某一阶段，必须落到具体阶段、具体问题、具体证据或具体指标。",
        "不要写“点击链接查看动画”“在 Alg.cubing.net 打开回放”这类说明；当前对话会自行渲染回放。",
        "优先先给结果或推荐，再给支撑这个结论的最关键证据。",
        "如果内容较多，优先拆成短段落，或 2 到 4 条短列表，保证一眼能扫完。",
        "不要暴露内部流程，不要描述你如何思考、如何调用工具、如何组织提示词。",
        "面向用户表达，不要写成开发备注、系统说明或操作引导文案。",
        "输出结果的语言风格要精炼，不要输出 emoji，直接指出需要关注的地方和用户需要的内容，抛弃一切空话废话。",
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

async function parseAgentStreamResponse(response, { onTextDelta, onAgentEvent, llmSettings, existingToolCalls = [] }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let responseId = null;
  let responseModel = llmSettings.model;
  let usage = null;
  let finalContent = "";
  let finalReasoning = "";
  let finishReason = null;
  const toolCallsByIndex = new Map();
  let hasEmittedThinking = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const dataLines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const data of dataLines) {
        if (data === "[DONE]") {
          continue;
        }

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        responseId = chunk?.id ?? responseId;
        responseModel = chunk?.model ?? responseModel;
        usage = chunk?.usage ?? usage;

        const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : null;
        const delta = choice?.delta ?? {};
        finishReason = choice?.finish_reason ?? finishReason;

        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          finalReasoning += delta.reasoning_content;
          if (!hasEmittedThinking) {
            hasEmittedThinking = true;
            onAgentEvent?.({
              phase: "thinking",
              toolCalls: [],
              text: "正在思考…"
            });
          }
        }

        if (typeof delta.content === "string" && delta.content) {
          finalContent += delta.content;
          onTextDelta?.(finalContent, {
            id: responseId,
            model: responseModel,
            usage
          });
          onAgentEvent?.({
            phase: "answering",
            toolCalls: [
              ...existingToolCalls,
              ...[...toolCallsByIndex.values()].map((toolCall) => ({
                name: toolCall.function?.name ?? "unknown",
                args: parseToolCallArguments(toolCall.function?.arguments),
                status: "running",
                result: null
              }))
            ],
            text: finalContent
          });
        }

        const streamedToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        for (const streamedToolCall of streamedToolCalls) {
          const index = streamedToolCall.index ?? 0;
          const existing = toolCallsByIndex.get(index) ?? {
            index,
            id: streamedToolCall.id ?? null,
            type: streamedToolCall.type ?? "function",
            function: {
              name: streamedToolCall.function?.name ?? "",
              arguments: ""
            }
          };

          existing.id = streamedToolCall.id ?? existing.id;
          existing.type = streamedToolCall.type ?? existing.type;
          existing.function.name = streamedToolCall.function?.name ?? existing.function.name;
          existing.function.arguments += streamedToolCall.function?.arguments ?? "";
          toolCallsByIndex.set(index, existing);
        }

        if (streamedToolCalls.length > 0) {
          onAgentEvent?.({
            phase: "tool_calling",
            toolCalls: [...toolCallsByIndex.values()].map((toolCall) => ({
              name: toolCall.function?.name ?? "unknown",
              args: parseToolCallArguments(toolCall.function?.arguments),
              status: "running",
              result: null
            })),
            text: `正在调用 ${[...toolCallsByIndex.values()].map((toolCall) => toolCall.function?.name ?? "unknown").join("、")}…`
          });
        }
      }
    }
  }

  const toolCalls = [...toolCallsByIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map((toolCall) => ({
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: toolCall.function.arguments ?? ""
      }
    }));

  return {
    id: responseId,
    model: responseModel,
    usage,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: finalContent,
          reasoning_content: finalReasoning,
          tool_calls: toolCalls
        },
        finish_reason: finishReason ?? (toolCalls.length ? "tool_calls" : "stop")
      }
    ]
  };
}

async function requestAgentLoopCompletion({ llmSettings, messages, tools, signal, onTextDelta, onAgentEvent, existingToolCalls = [] }) {
  const response = await fetchWithTimeout(joinChatCompletionsUrl(llmSettings.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${String(llmSettings.apiKey).trim()}`
    },
    body: JSON.stringify({
      model: llmSettings.model,
      stream: true,
      messages,
      tools,
      tool_choice: "auto"
    })
  }, DEFAULT_TIMEOUT_MS, signal);
  if (!response.ok) {
    throw await createHttpError(response);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const result = await response.json();
    const message = result?.choices?.[0]?.message ?? {};
    return {
      id: result?.id ?? null,
      model: result?.model ?? llmSettings.model,
      usage: result?.usage ?? null,
      choices: [
        {
          index: 0,
          message,
          finish_reason: result?.choices?.[0]?.finish_reason ?? "stop"
        }
      ]
    };
  }

  if (!response.body) {
    throw new LlmClientError("LLM_STREAM_MISSING", "接口未返回可读取的流。");
  }

  return await parseAgentStreamResponse(response, { onTextDelta, onAgentEvent, llmSettings, existingToolCalls });
}

async function executeAgentToolSafely({ toolCall, args, latestContext, onAgentEvent, executedToolCalls }) {
  try {
    return await executeAgentToolCall({
      name: toolCall.function?.name,
      args,
      context: latestContext,
      onProgress: (progress) => {
        onAgentEvent?.({
          phase: progress.stage ?? "tool_progress",
          toolCalls: [
            ...executedToolCalls,
            {
              name: toolCall.function?.name ?? "unknown",
              args,
              status: "running",
              result: progress
            }
          ],
          text: progress.text ?? "正在处理…"
        });
      }
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

function formatToolName(name) {
  switch (name) {
    case "create_solve_review":
      return "复盘分析";
    case "inspect_solve_segment":
      return "分段查看";
    case "search_algorithms":
      return "公式检索";
    case "build_playback_link":
      return "动画链接";
    default:
      return name;
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
