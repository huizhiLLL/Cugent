import React from "react";
import { MessageSquarePlus, Settings2 } from "lucide-react";
import { ConversationList } from "@/components/conversation-list";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";

export function MobileHistoryDrawer({
  open,
  conversations,
  currentConversationId,
  onClose,
  onDrawerPointerDown,
  onDrawerPointerUp,
  onCreateConversation,
  onOpenConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings
}) {
  return (
    <div
      className="mobile-history-backdrop"
      data-open={open}
      aria-hidden={!open}
      onClick={onClose}
    >
      <aside
        className="mobile-history-drawer"
        aria-label="移动端对话历史"
        aria-hidden={!open}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={onDrawerPointerDown}
        onPointerUp={onDrawerPointerUp}
      >
        <div className="mobile-drawer-brand">
          <img className="brand-logo" src="/cugent-wordmark.png" alt="Cugent" />
        </div>
        <nav className="mobile-drawer-nav">
          <Button type="button" variant="ghost" className="sidebar-action" onClick={onCreateConversation}>
            <MessageSquarePlus data-icon="inline-start" />
            <span>新建对话</span>
          </Button>
          <ConversationList
            conversations={conversations}
            currentConversationId={currentConversationId}
            onOpenConversation={onOpenConversation}
            onRenameConversation={onRenameConversation}
            onDeleteConversation={onDeleteConversation}
          />
        </nav>
        <div className="mobile-drawer-footer">
          <TooltipIconButton
            type="button"
            className="sidebar-settings-button"
            aria-label="打开设置"
            onClick={onOpenSettings}
          >
            <Settings2 />
          </TooltipIconButton>
        </div>
      </aside>
    </div>
  );
}
