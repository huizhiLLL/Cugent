import { stepCountIs, streamText } from "ai";
import { createAiSdkAgentTools } from "./tool-registry.js";
import { LlmClientError } from "./llm-error.js";
import { normalizeLlmError, resolveLlmModel } from "./llm-provider.js";
import { buildAgentLoopSystemInstructions } from "./prompt-profiles.js";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TOOL_CALL_ROUNDS = 4;

export async function runLlmAgentLoop({ message, context, options = {} }) {
  try {
    if (options.signal?.aborted) {
      throw new LlmClientError("LLM_ABORTED", "已停止生成。");
    }

    const { model, provider } = resolveLlmModel(context?.llmSettings);
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

    const tools = createAiSdkAgentTools({
      getContext: () => latestContext,
      updateContext: (contextPatch) => {
        latestContext = mergeContextPatch(latestContext, contextPatch);
      },
      onProgress: (progress) => {
        options.onAgentEvent?.({
          phase: progress.stage ?? "tool_progress",
          toolCalls: [...executedToolCalls],
          text: progress.text ?? "正在处理…"
        });
      }
    });

    const result = streamText({
      model,
      messages: buildAgentLoopMessages({ message, context }),
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(MAX_TOOL_CALL_ROUNDS),
      abortSignal: options.signal,
      timeout: DEFAULT_TIMEOUT_MS,
      onChunk: ({ chunk }) => {
        handleStreamChunk({
          chunk,
          executedToolCalls,
          onAgentEvent: options.onAgentEvent,
          onTextDelta: options.onTextDelta,
          appendFinalText: (textDelta) => {
            finalText += textDelta;
            return finalText;
          }
        });
      },
      experimental_onToolCallStart: ({ toolCall }) => {
        const toolName = toolCall?.toolName ?? "unknown";
        options.onAgentEvent?.({
          phase: "tool_calling",
          toolCalls: [
            ...executedToolCalls,
            {
              name: toolName,
              args: toolCall?.input ?? {},
              status: "running",
              result: null
            }
          ],
          text: `正在处理：${formatToolName(toolName)}。`
        });
      },
      experimental_onToolCallFinish: ({ toolCall, output, success, error }) => {
        const toolName = toolCall?.toolName ?? "unknown";
        const execution = output && typeof output === "object" ? output : null;
        const nextToolCall = {
          name: toolName,
          args: toolCall?.input ?? {},
          status: !success || execution?.toolResult?.type === "error" ? "error" : "completed",
          result: execution?.content ?? output ?? formatToolExecutionError(error)
        };

        executedToolCalls.push(nextToolCall);
        latestToolResult = execution?.toolResult ?? latestToolResult;

        options.onAgentEvent?.({
          phase: "tool_returned",
          toolCalls: [...executedToolCalls],
          text: `${formatToolName(toolName)} 已准备好。`
        });
      },
      onFinish: (event) => {
        usage = event.totalUsage ?? event.usage ?? usage;
        responseId = event.response?.id ?? responseId;
        responseModel = event.response?.modelId ?? responseModel;
      }
    });

    finalText = (await result.text).trim();
    usage = (await result.totalUsage.catch(() => null)) ?? usage;
    const response = await result.response.catch(() => null);
    responseId = response?.id ?? responseId;
    responseModel = response?.modelId ?? responseModel;

    if (!finalText) {
      throw new LlmClientError("LLM_EMPTY_RESPONSE", "LLM 未返回最终可展示内容。");
    }

    options.onAgentEvent?.({
      phase: "finalizing",
      toolCalls: executedToolCalls,
      text: "结果已经齐了，正在整理回答。"
    });

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
        source: provider.compatibility,
        provider: provider.id,
        model: responseModel,
        responseId,
        usage,
        streaming: true,
        toolLoop: true,
        runtime: provider.source
      }
    };
  } catch (error) {
    throw normalizeLlmError(error);
  }
}

function buildAgentLoopMessages({ message, context }) {
  return [
    {
      role: "system",
      content: buildAgentLoopSystemInstructions()
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

function handleStreamChunk({ chunk, executedToolCalls, onAgentEvent, onTextDelta, appendFinalText }) {
  if (chunk.type === "text-delta") {
    const nextText = appendFinalText(chunk.text ?? "");
    onTextDelta?.(nextText, {});
    onAgentEvent?.({
      phase: "answering",
      toolCalls: [...executedToolCalls],
      text: nextText
    });
  }

  if (chunk.type === "reasoning-delta") {
    onAgentEvent?.({
      phase: "thinking",
      toolCalls: [...executedToolCalls],
      text: "正在思考…"
    });
  }
}

function formatToolExecutionError(error) {
  return {
    type: "error",
    code: "TOOL_EXECUTION_FAILED",
    message: String(error?.message ?? error ?? "工具执行失败。")
  };
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
