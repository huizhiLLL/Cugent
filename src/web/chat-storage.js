const STORAGE_KEY = "cubeagent.chat.state";

export function loadChatState() {
  if (typeof window === "undefined") {
    return createEmptyChatState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyChatState();
    }

    const parsed = JSON.parse(raw);
    return sanitizeChatState(parsed);
  } catch {
    return createEmptyChatState();
  }
}

export function saveChatState(state) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeChatState(state)));
}

export function createEmptyConversation() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    messages: [],
    context: {},
    createdAt: now,
    updatedAt: now
  };
}

export function deriveConversationTitle(text) {
  const plain = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) {
    return "新对话";
  }

  return plain.slice(0, 20);
}

export function sanitizeChatState(input) {
  const conversations = Array.isArray(input?.conversations)
    ? input.conversations
      .map(sanitizeConversation)
      .filter(Boolean)
    : [];

  if (!conversations.length) {
    const conversation = createEmptyConversation();
    return {
      currentConversationId: conversation.id,
      conversations: [conversation]
    };
  }

  const currentConversationId = conversations.some((item) => item.id === input?.currentConversationId)
    ? input.currentConversationId
    : conversations[0].id;

  return {
    currentConversationId,
    conversations
  };
}

function sanitizeConversation(input) {
  if (!input?.id) {
    return null;
  }

  return {
    id: String(input.id),
    title: String(input.title || "新对话"),
    messages: Array.isArray(input.messages) ? input.messages : [],
    context: input.context && typeof input.context === "object" ? input.context : {},
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || input.createdAt || new Date().toISOString())
  };
}

function createEmptyChatState() {
  const conversation = createEmptyConversation();
  return {
    currentConversationId: conversation.id,
    conversations: [conversation]
  };
}
