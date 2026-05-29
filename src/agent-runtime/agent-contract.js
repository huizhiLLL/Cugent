export const AGENT_RUNTIME_CONTRACT_VERSION = 1;

const STREAMING_RESPONSE_BASE = {
  kind: "streaming",
  evidence: [],
  nextActions: []
};

export function createAgentRuntimeRequest({ message, context, llmSettings }) {
  return {
    version: AGENT_RUNTIME_CONTRACT_VERSION,
    message: String(message ?? ""),
    context: {
      ...(context ?? {}),
      llmSettings
    }
  };
}

export function createRunningAssistantResponse(llmSettings) {
  return {
    ...STREAMING_RESPONSE_BASE,
    llm: createRunningLlmMeta(llmSettings)
  };
}

export function applyTurnReadyToAssistantMessage(message, readyTurn, llmSettings, pendingText) {
  return {
    ...message,
    text: message.text || pendingText,
    response: {
      ...readyTurn.response,
      llm: readyTurn.response?.llm ?? createRunningLlmMeta(llmSettings)
    },
    intent: readyTurn.intent.type,
    toolCalls: readyTurn.toolCalls,
    status: {
      type: "running"
    }
  };
}

export function applyAgentEventToAssistantMessage(message, agentEvent, llmSettings) {
  return {
    ...message,
    text: agentEvent.text || message.text || "正在判断是否需要调用工具…",
    response: {
      ...(message.response ?? STREAMING_RESPONSE_BASE),
      toolCalls: agentEvent.toolCalls?.length ? agentEvent.toolCalls : message.response?.toolCalls ?? [],
      llm: createRunningLlmMeta(llmSettings)
    },
    toolCalls: agentEvent.toolCalls?.length ? agentEvent.toolCalls : message.toolCalls ?? [],
    status: {
      type: "running"
    }
  };
}

export function applyTextDeltaToAssistantMessage(message, nextText, llmMeta, llmSettings) {
  return {
    ...message,
    text: nextText,
    response: {
      ...(message.response ?? STREAMING_RESPONSE_BASE),
      llm: {
        ...createRunningLlmMeta(llmSettings),
        model: llmMeta?.model ?? null,
        responseId: llmMeta?.id ?? null,
        usage: llmMeta?.usage ?? null
      }
    },
    status: {
      type: "running"
    }
  };
}

export function applyCancelledTurnToAssistantMessage(message, turn) {
  return {
    ...message,
    text: message.text || "已停止生成。",
    response: {
      ...(message.response ?? turn.response),
      llm: {
        ...(turn.response?.llm ?? message.response?.llm ?? {}),
        enabled: false,
        status: "cancelled",
        error: {
          code: "LLM_ABORTED",
          message: "已停止生成。"
        }
      }
    },
    status: {
      type: "incomplete",
      reason: "cancelled"
    }
  };
}

export function applyCompletedTurnToAssistantMessage(message, turn, nextContext) {
  return {
    ...message,
    text: turn.response.text,
    response: turn.response,
    intent: turn.intent.type,
    toolCalls: turn.toolCalls,
    contextSnapshot: nextContext,
    status: turn.response?.llm?.status === "cancelled"
      ? { type: "incomplete", reason: "cancelled" }
      : { type: "complete", reason: "stop" }
  };
}

export function applyFailedTurnToAssistantMessage(message, error) {
  const errorMessage = String(error?.message ?? "未知错误");
  return {
    ...message,
    text: `处理失败：${errorMessage}`,
    response: {
      kind: "error",
      evidence: [],
      nextActions: [],
      llm: {
        enabled: false,
        status: "fallback",
        error: {
          code: error?.code ?? "TURN_FAILED",
          message: errorMessage
        }
      }
    },
    status: {
      type: "incomplete",
      reason: "error"
    }
  };
}

function createRunningLlmMeta(llmSettings) {
  return {
    enabled: llmSettings?.enabled !== false,
    status: "running",
    source: llmSettings?.compatibility ?? "openai-compatible",
    provider: llmSettings?.providerId ?? null,
    model: llmSettings?.model ?? null,
    streaming: true
  };
}
