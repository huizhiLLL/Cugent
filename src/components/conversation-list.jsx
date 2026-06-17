import React, { memo } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";

export const ConversationList = memo(function ConversationList({
  conversations,
  currentConversationId,
  onOpenConversation,
  onRenameConversation,
  onDeleteConversation,
  labelClassName = "history-item-label"
}) {
  return (
    <div className="conversation-history" aria-label="对话历史">
      {conversations.map((conversation) => (
        <div className="history-row" key={conversation.id}>
          <Button
            type="button"
            variant={conversation.id === currentConversationId ? "secondary" : "ghost"}
            className="history-item"
            title={conversation.title}
            onClick={() => onOpenConversation(conversation.id)}
          >
            <span className={labelClassName}>{conversation.title}</span>
          </Button>
          <div className="history-item-tools">
            <TooltipIconButton tooltip="重命名会话" variant="ghost" size="icon" className="history-tool-button" onClick={() => onRenameConversation(conversation.id)}>
              <Pencil />
            </TooltipIconButton>
            <TooltipIconButton tooltip="删除会话" variant="ghost" size="icon" className="history-tool-button" onClick={() => onDeleteConversation(conversation.id)}>
              <Trash2 />
            </TooltipIconButton>
          </div>
        </div>
      ))}
    </div>
  );
});
