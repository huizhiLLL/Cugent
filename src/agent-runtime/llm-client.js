import { generateText, streamText } from "ai";
import { LlmClientError } from "./llm-error.js";
import { normalizeLlmError, resolveLlmModel } from "./llm-provider.js";
import {
  buildPlaybackLinkInstruction,
  buildPromptProfile,
  buildResponseEnhancerSystemInstructions
} from "./prompt-profiles.js";

const DEFAULT_TIMEOUT_MS = 30000;

export async function enhanceAgentTurnResponse({
  message,
  context,
  turn,
  fallbackResponse,
  onTextDelta,
  signal
}) {
  try {
    const { model, provider } = resolveLlmModel(context?.llmSettings);
    const promptMessages = buildPromptMessages({ message, context, turn, fallbackResponse });
    const { system, messages } = buildAiSdkPrompt(promptMessages);
    const shouldStream = provider.capabilities.streaming !== false;

    if (!shouldStream) {
      const result = await generateText({
        model,
        system,
        messages,
        abortSignal: signal,
        timeout: DEFAULT_TIMEOUT_MS
      });
      const text = result.text.trim();
      if (!text) {
        throw new LlmClientError("LLM_EMPTY_RESPONSE", "LLM 返回内容为空。");
      }

      const safeText = sanitizePlaybackMarkdownLinks(text);
      return {
        ...fallbackResponse,
        text: safeText,
        llm: buildLlmMeta({
          provider,
          modelId: result.response?.modelId,
          responseId: result.response?.id,
          usage: result.usage,
          streaming: false
        })
      };
    }

    let accumulatedText = "";
    let usage = null;
    let responseId = null;
    let responseModel = context.llmSettings.model;
    const result = streamText({
      model,
      system,
      messages,
      abortSignal: signal,
      timeout: DEFAULT_TIMEOUT_MS,
      onChunk: ({ chunk }) => {
        if (chunk.type !== "text-delta" || !chunk.text) {
          return;
        }
        accumulatedText += chunk.text;
        onTextDelta?.(accumulatedText, {
          model: responseModel,
          id: responseId,
          usage
        });
      },
      onFinish: (event) => {
        usage = event.totalUsage ?? event.usage ?? usage;
        responseId = event.response?.id ?? responseId;
        responseModel = event.response?.modelId ?? responseModel;
      }
    });

    const text = (await result.text).trim();
    usage = (await result.totalUsage.catch(() => null)) ?? usage;
    const response = await result.response.catch(() => null);
    responseId = response?.id ?? responseId;
    responseModel = response?.modelId ?? responseModel;

    if (!text) {
      throw new LlmClientError("LLM_EMPTY_RESPONSE", "LLM 返回内容为空。");
    }

    const safeText = sanitizePlaybackMarkdownLinks(text);
    return {
      ...fallbackResponse,
      text: safeText,
      llm: buildLlmMeta({
        provider,
        modelId: responseModel,
        responseId,
        usage,
        streaming: true
      })
    };
  } catch (error) {
    throw normalizeLlmError(error);
  }
}

export function sanitizePlaybackMarkdownLinks(text) {
  return String(text ?? "").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (match, label, rawUrl) => {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return label;
    }

    if (url.hostname !== "alg.cubing.net") {
      return label;
    }

    return match;
  });
}

export function buildPromptMessages({ message, context, turn, fallbackResponse }) {
  const promptProfile = buildPromptProfile(turn);
  const linkInstruction = buildPlaybackLinkInstruction(hasPlaybackLinkCandidates(turn));

  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: buildResponseEnhancerSystemInstructions({
            promptProfile,
            playbackLinkInstruction: linkInstruction
          })
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `用户原消息：\n${String(message ?? "").trim() || "(空)"}`,
            `\n当前 intent：${turn.intent?.type ?? "unknown"}`,
            `\n回复策略：${promptProfile.replyStyle}`,
            `\n本地工具调用：\n${safeJson(turn.toolCalls ?? [])}`,
            `\n本地工具结果：\n${safeJson(compactToolResult(turn.toolResult))}`,
            `\n本地 fallback 回复：\n${safeJson(fallbackResponse)}`,
            `\n当前上下文：\n${safeJson(compactContext(context))}`,
            "\n请基于这些内容，生成一段精炼、直接、只保留有效信息的中文回复。"
          ].join("\n")
        }
      ]
    }
  ];
}

export function buildChatCompletionMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message.role,
    content: flattenMessageContent(message.content)
  }));
}

function buildAiSdkPrompt(promptMessages) {
  const normalized = buildChatCompletionMessages(promptMessages);
  return {
    system: normalized
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n\n"),
    messages: normalized.filter((message) => message.role !== "system")
  };
}

function compactToolResult(toolResult) {
  if (!toolResult || typeof toolResult !== "object") {
    return toolResult;
  }

  if (toolResult.type === "solve-review" && toolResult.review) {
    const review = toolResult.review;
    return {
      type: toolResult.type,
      review: {
        puzzle: review.puzzle,
        summary: review.summary,
        validation: review.validation,
        segmentation: review.segmentation,
        cfopAnalysis: review.cfopAnalysis,
        coachSuggestions: {
          total: review.coachSuggestions?.suggestions?.length ?? 0,
          suggestions: review.coachSuggestions?.suggestions?.slice(0, 6) ?? []
        },
        segments: review.segments?.map((segment) => ({
          id: segment.id,
          label: segment.label,
          moveCount: segment.moveCount,
          durationMs: segment.durationMs,
          tps: segment.tps,
          pauses: segment.pauses,
          recognition: segment.recognition
        })) ?? [],
        playback: review.playback
      }
    };
  }

  if (toolResult.type === "segment-inspection") {
    return {
      ...toolResult,
      segment: toolResult.segment ? {
        id: toolResult.segment.id,
        label: toolResult.segment.label,
        moveCount: toolResult.segment.moveCount,
        durationMs: toolResult.segment.durationMs,
        tps: toolResult.segment.tps,
        pauses: toolResult.segment.pauses,
        recognition: toolResult.segment.recognition,
        playback: toolResult.segment.playback
      } : null
    };
  }

  return toolResult;
}

function hasPlaybackLinkCandidates(turn) {
  const reviewSuggestions = turn.toolResult?.review?.coachSuggestions?.suggestions;
  if (Array.isArray(reviewSuggestions) && reviewSuggestions.some(hasSuggestionPlaybackLinks)) {
    return true;
  }

  const toolSuggestions = turn.toolResult?.suggestions;
  if (Array.isArray(toolSuggestions) && toolSuggestions.some(hasSuggestionPlaybackLinks)) {
    return true;
  }

  const recommendedAlgorithms = turn.toolResult?.result?.results;
  return Array.isArray(recommendedAlgorithms) && recommendedAlgorithms.some((candidate) => Boolean(candidate?.playback?.url));
}

function hasSuggestionPlaybackLinks(suggestion) {
  return Array.isArray(suggestion?.recommendedAlgorithms) && suggestion.recommendedAlgorithms.some((candidate) => Boolean(candidate?.playback?.url));
}

function compactContext(context) {
  if (!context || typeof context !== "object") {
    return context;
  }

  const currentSolveReview = context.currentSolveReview;

  return {
    ...context,
    llmSettings: context.llmSettings ? {
      enabled: context.llmSettings.enabled,
      baseUrl: context.llmSettings.baseUrl,
      model: context.llmSettings.model,
      hasApiKey: Boolean(context.llmSettings.apiKey)
    } : null,
    currentSolveReview: currentSolveReview ? {
      puzzle: currentSolveReview.puzzle,
      summary: currentSolveReview.summary,
      validation: currentSolveReview.validation,
      segmentation: currentSolveReview.segmentation,
      segments: currentSolveReview.segments?.map((segment) => ({
        id: segment.id,
        label: segment.label,
        moveCount: segment.moveCount,
        durationMs: segment.durationMs,
        tps: segment.tps,
        recognition: segment.recognition
      })) ?? []
    } : null
  };
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function flattenMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part?.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildLlmMeta({ provider, modelId, responseId, usage, streaming }) {
  return {
    enabled: true,
    status: "complete",
    source: provider.compatibility,
    provider: provider.id,
    model: modelId ?? null,
    responseId: responseId ?? null,
    usage: provider.capabilities.usage === false ? null : usage ?? null,
    streaming,
    runtime: provider.source
  };
}

export function joinChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    throw new LlmClientError("LLM_BASE_URL_MISSING", "请先填写接口基地址。");
  }

  return `${normalizedBaseUrl}/chat/completions`;
}

export function extractChatCompletionText(result) {
  const choice = Array.isArray(result?.choices) ? result.choices[0] : null;
  const content = choice?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

export { LlmClientError } from "./llm-error.js";
