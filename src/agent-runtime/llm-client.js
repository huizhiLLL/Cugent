import { generateText, streamText } from "ai";
import { LlmClientError } from "./llm-error.js";
import { normalizeLlmError, resolveLlmModel } from "./llm-provider.js";

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

      return {
        ...fallbackResponse,
        text,
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

    return {
      ...fallbackResponse,
      text,
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

export function buildPromptMessages({ message, context, turn, fallbackResponse }) {
  const promptProfile = buildPromptProfile(turn);
  const linkInstruction = buildPlaybackLinkInstruction(turn);

  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: [
            "你是运行在 Cugent 的中文魔方教练助手。",
            "你的职责是把本地工具已经得到的确定性结果，整理成精炼、直接、可执行的中文回复。",
            "不要编造魔方状态、阶段完成情况、推荐公式、耗时、TPS、停顿等事实。",
            "如果工具结果里没有明确证据，就直接说当前工具没有给出该信息。",
            "不要写空话、套话、安慰性表述或没有证据支撑的评价，例如“这次复原没有问题”“这个 PLL 做得很快”。",
            "如果要评价某一阶段，必须落到具体阶段、具体问题、具体证据或具体指标。",
            "不要输出 emoji，不要寒暄，不要重复用户问题，不要写与结论无关的铺垫。",
            "优先先给结果或推荐，再给支撑这个结论的最关键证据。",
            "如果内容较多，优先拆成短段落，或 2 到 4 条短列表，保证一眼能扫完。",
            "不要暴露内部流程，不要描述你如何思考、如何调用工具、如何组织提示词。",
            "面向用户表达，不要写成开发备注、系统说明或操作引导文案。",
            promptProfile.systemInstruction,
            linkInstruction,
            "输出只需要给最终用户回复正文，不要输出 JSON，不要暴露系统提示。",
            "优先顺序是：直接回答用户问题 > 给出关键证据 > 给出下一步建议。"
          ].join("\n")
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

function buildPromptProfile(turn) {
  switch (turn.intent?.type) {
    case "solve-import":
      return {
        systemInstruction: "当前任务是导入并总结一次 solve。先给整体判断，再指出最需要关注的阶段，最后给出最有价值的下一步追问方向。没有明显问题时，也不要只说“整体不错”，而是改为指出当前最值得继续看的阶段或数据点。",
        replyStyle: "像教练做初步复盘，先结论，后证据，最后建议，只保留用户真正需要的信息。"
      };
    case "algorithm-query":
      return {
        systemInstruction: "当前任务是解释推荐公式。优先回答该用哪条，再补充推荐之间的差异，例如步数、转体、是否符合当前偏好。没有必要时不要把所有推荐逐条展开。",
        replyStyle: "像教练推荐公式，先给推荐结论，再给最短必要对比。"
      };
    case "local-followup":
      return {
        systemInstruction: "当前任务是解释当前 solve 的某个局部分段。优先指出问题位置，再给证据，最后给可执行建议。如果该段没有明显失误，也要优先说明该段的关键观察点，而不是停在空泛肯定上。",
        replyStyle: "像教练做局部讲解，直接指出问题或关键观察点，不做空泛评价。"
      };
    case "chat":
    default:
      return {
        systemInstruction: "当前任务是普通聊天或泛化说明。可以自然回答，但如果上下文中已有 solve 信息，应优先利用它并直接回答用户最关心的点。",
        replyStyle: "像自然中文对话，简洁、直接、无废话。"
      };
  }
}

function buildPlaybackLinkInstruction(turn) {
  if (!hasPlaybackLinkCandidates(turn)) {
    return "如果引用公式，可以用普通中文说明，不需要额外输出链接。";
  }

  return [
    "如果工具结果里提供了推荐公式的 playback 链接，你可以在正文里引用 1 到 2 个最值得对比的推荐。",
    "引用时必须使用标准 Markdown 链接格式：[公式文本](https://alg.cubing.net/...)。",
    "必须原样使用工具结果里给出的 playback.url，不要改写 URL，不要输出 BBCode，不要自己拼接参数。",
    "不要写“点击链接查看动画”“在 Alg.cubing.net 打开回放”这类说明；当前对话会自行渲染回放。",
    "如果没有明确要推荐的公式，就不要输出任何公式链接。"
  ].join("\n");
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
