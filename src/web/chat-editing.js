export function resolveEditedUserMessageIndex(messages, editPayload) {
  const targetId = editPayload?.sourceId ?? editPayload?.parentId ?? null;
  if (!targetId) {
    return -1;
  }

  return messages.findIndex((item) => item.id === targetId);
}

export function buildEditedConversation(conversation, editPayload, nextText, { createUserMessage, deriveConversationTitle }) {
  const targetIndex = resolveEditedUserMessageIndex(conversation.messages, editPayload);
  if (targetIndex === -1) {
    return null;
  }

  const targetId = conversation.messages[targetIndex].id;

  return {
    ...conversation,
    title: targetIndex === 0 ? deriveConversationTitle(nextText) : conversation.title,
    messages: [
      ...conversation.messages.slice(0, targetIndex),
      createUserMessage("user", nextText, { id: targetId })
    ]
  };
}
