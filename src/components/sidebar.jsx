import React from "react";
import { Menu, MessageSquarePlus, Settings2 } from "lucide-react";
import { ConversationList } from "@/components/conversation-list";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";

export function Sidebar({
  conversations,
  currentConversationId,
  mobileHistoryOpen,
  onOpenMobileHistory,
  onCreateConversation,
  onOpenConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings
}) {
  return (
    <aside className="sidebar" aria-label="Conversation Sidebar">
      <div className="sidebar-brand">
        <TooltipIconButton
          type="button"
          className="mobile-menu-button"
          tooltip="打开对话历史"
          aria-label="打开对话历史"
          aria-expanded={mobileHistoryOpen}
          onClick={onOpenMobileHistory}
        >
          <Menu />
        </TooltipIconButton>
        <img className="sidebar-label brand-logo" src="/cugent-wordmark.png" alt="Cugent" />
      </div>
      <nav className="sidebar-nav">
        <Button type="button" variant="ghost" className="sidebar-action" onClick={onCreateConversation} title="新建对话">
          <MessageSquarePlus data-icon="inline-start" />
          <span className="sidebar-label">新建对话</span>
        </Button>
        <ConversationList
          conversations={conversations}
          currentConversationId={currentConversationId}
          labelClassName="sidebar-label history-item-label"
          onOpenConversation={onOpenConversation}
          onRenameConversation={onRenameConversation}
          onDeleteConversation={onDeleteConversation}
        />
      </nav>
      <div className="sidebar-footer">
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
  );
}
