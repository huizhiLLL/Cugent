import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { Menu, MessageSquarePlus, Pencil, Settings2, Sparkles, Trash2 } from "lucide-react";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Thread } from "@/components/thread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { runAgentTurn } from "../agent-runtime/index.js";
import { buildEditedConversation, resolveEditedUserMessageIndex } from "./chat-editing.js";
import { createEmptyConversation, deriveConversationTitle, loadChatState, saveChatState } from "./chat-storage.js";
import {
  applyLlmProviderProfile,
  defaultLlmSettings,
  loadLlmSettings,
  llmProviderProfiles,
  saveLlmSettings,
  sanitizeLlmSettings
} from "./llm-settings.js";
import { XIcon } from "lucide-react";
import "./styles.css";

const emptySmartInput = {
  scramble: "",
  timedMoves: "",
  segmentedSolution: ""
};

function App() {
  const [chatState, setChatState] = useState(() => loadChatState());
  const [smartInput, setSmartInput] = useState(emptySmartInput);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [smartDialogOpen, setSmartDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState("model");
  const [renameDialogState, setRenameDialogState] = useState({
    open: false,
    conversationId: null,
    title: ""
  });
  const [deleteDialogState, setDeleteDialogState] = useState({
    open: false,
    conversationId: null,
    title: ""
  });
  const [busy, setBusy] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const pointerStartRef = useRef(null);
  const [llmSettingsDraft, setLlmSettingsDraft] = useState(() => loadLlmSettings());
  const abortControllerRef = useRef(null);
  const cancelRequestedRef = useRef(false);
  const currentConversation = chatState.conversations.find((item) => item.id === chatState.currentConversationId) ?? chatState.conversations[0];
  const sortedConversations = useMemo(
    () => [...chatState.conversations].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [chatState.conversations]
  );
  const messages = currentConversation?.messages ?? [];
  const context = currentConversation?.context ?? {};

  useEffect(() => {
    saveChatState(chatState);
  }, [chatState]);

  async function submitMessage(nextInput, { appendUser = true, conversationIdOverride, contextOverride } = {}) {
    const trimmed = nextInput.trim();
    if (!trimmed || busy) {
      return;
    }

    const conversationId = conversationIdOverride ?? chatState.currentConversationId;
    const conversation = chatState.conversations.find((item) => item.id === conversationId) ?? currentConversation;
    const baseContext = contextOverride ?? conversation?.context ?? {};

    setBusy(true);
    cancelRequestedRef.current = false;
    if (appendUser) {
      updateConversationById(conversationId, (conversationItem) => {
        const nextMessages = [...conversationItem.messages, createMessage("user", trimmed)];
        return {
          ...conversationItem,
          title: conversationItem.messages.length ? conversationItem.title : deriveConversationTitle(trimmed),
          messages: nextMessages,
          updatedAt: new Date().toISOString()
        };
      });
    }

    const assistantMessageId = crypto.randomUUID();
    updateConversationById(conversationId, (conversationItem) => ({
      ...conversationItem,
      messages: [
        ...conversationItem.messages,
        createMessage("assistant", "", {
          id: assistantMessageId,
          response: {
            kind: "streaming",
            evidence: [],
            nextActions: [],
            llm: {
              enabled: true,
              status: "running",
              source: "openai-compatible"
            }
          },
          status: {
            type: "running"
          }
        })
      ],
      updatedAt: new Date().toISOString()
    }));

    try {
      const llmSettings = sanitizeLlmSettings(llmSettingsDraft);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const turn = await runAgentTurn(
        trimmed,
        {
          ...baseContext,
          llmSettings
        },
        {
          onTurnReady: (readyTurn) => {
            updateConversationById(conversationId, (conversationItem) => ({
              ...conversationItem,
              messages: conversationItem.messages.map((item) => {
                if (item.id !== assistantMessageId) {
                  return item;
                }

                return {
                  ...item,
                  text: item.text || getPendingAssistantText(readyTurn),
                  response: {
                    ...readyTurn.response,
                    llm: readyTurn.response?.llm ?? {
                      enabled: llmSettings.enabled,
                      status: "running",
                      source: llmSettings.compatibility,
                      provider: llmSettings.providerId,
                      model: llmSettings.model,
                      streaming: true
                    }
                  },
                  intent: readyTurn.intent.type,
                  toolCalls: readyTurn.toolCalls,
                  status: {
                    type: "running"
                  }
                };
              }),
              updatedAt: new Date().toISOString()
            }));
          },
          onAgentEvent: (agentEvent) => {
            updateConversationById(conversationId, (conversationItem) => ({
              ...conversationItem,
              messages: conversationItem.messages.map((item) => {
                if (item.id !== assistantMessageId) {
                  return item;
                }

                return {
                  ...item,
                  text: agentEvent.text || item.text || "正在判断是否需要调用工具…",
                  response: {
                    ...(item.response ?? { kind: "streaming", evidence: [], nextActions: [] }),
                    toolCalls: agentEvent.toolCalls?.length ? agentEvent.toolCalls : item.response?.toolCalls ?? [],
                    llm: {
                      enabled: true,
                      status: "running",
                      source: llmSettings.compatibility,
                      provider: llmSettings.providerId,
                      model: llmSettings.model,
                      streaming: true
                    }
                  },
                  toolCalls: agentEvent.toolCalls?.length ? agentEvent.toolCalls : item.toolCalls ?? [],
                  status: {
                    type: "running"
                  }
                };
              }),
              updatedAt: new Date().toISOString()
            }));
          },
          signal: abortController.signal,
          onTextDelta: (nextText, llmMeta) => {
            updateConversationById(conversationId, (conversationItem) => ({
              ...conversationItem,
              messages: conversationItem.messages.map((item) => {
                if (item.id !== assistantMessageId) {
                  return item;
                }

                return {
                  ...item,
                  text: nextText,
                  response: {
                    ...(item.response ?? { kind: "streaming", evidence: [], nextActions: [] }),
                    llm: {
                      enabled: true,
                      status: "running",
                      source: llmSettings.compatibility,
                      provider: llmSettings.providerId,
                      model: llmMeta?.model ?? null,
                      responseId: llmMeta?.id ?? null,
                      usage: llmMeta?.usage ?? null,
                      streaming: true
                    }
                  },
                  status: {
                    type: "running"
                  }
                };
              }),
              updatedAt: new Date().toISOString()
            }));
          }
        }
      );

      if (cancelRequestedRef.current) {
        updateConversationById(conversationId, (conversationItem) => ({
          ...conversationItem,
          messages: conversationItem.messages.map((item) => {
            if (item.id !== assistantMessageId) {
              return item;
            }

            return {
              ...item,
              text: item.text || "已停止生成。",
              response: {
                ...(item.response ?? turn.response),
                llm: {
                  ...(turn.response?.llm ?? item.response?.llm ?? {}),
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
          }),
          updatedAt: new Date().toISOString()
        }));
        return;
      }

      const nextContext = { ...baseContext, ...turn.contextPatch };
      updateConversationById(conversationId, (conversationItem) => ({
        ...conversationItem,
        context: nextContext,
        messages: conversationItem.messages.map((item) => {
          if (item.id !== assistantMessageId) {
            return item;
          }

          return {
            ...item,
            text: turn.response.text,
            response: turn.response,
            intent: turn.intent.type,
            toolCalls: turn.toolCalls,
            contextSnapshot: nextContext,
            status: turn.response?.llm?.status === "cancelled"
              ? { type: "incomplete", reason: "cancelled" }
              : { type: "complete", reason: "stop" }
          };
        }),
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      updateConversationById(conversationId, (conversationItem) => ({
        ...conversationItem,
        messages: conversationItem.messages.map((item) => {
          if (item.id !== assistantMessageId) {
            return item;
          }

          return {
            ...item,
            text: `处理失败：${error.message}`,
            response: {
              kind: "error",
              evidence: [],
              nextActions: [],
              llm: {
                enabled: false,
                status: "fallback",
                error: {
                  code: "TURN_FAILED",
                  message: String(error?.message ?? "未知错误")
                }
              }
            },
            status: {
              type: "incomplete",
              reason: "error"
            }
          };
        }),
        updatedAt: new Date().toISOString()
      }));
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
    }
  }

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: busy,
    setMessages: (nextMessages) => {
      updateConversationById(chatState.currentConversationId, (conversation) => ({
        ...conversation,
        messages: typeof nextMessages === "function" ? nextMessages(conversation.messages) : nextMessages,
        updatedAt: new Date().toISOString()
      }));
    },
    onNew: async (message) => {
      await submitMessage(extractMessageText(message));
    },
    onEdit: async (message) => {
      await editMessage(message);
    },
    onReload: async (parentId) => {
      await reloadFromParent(parentId);
    },
    onCancel: async () => {
      cancelRequestedRef.current = true;
      abortControllerRef.current?.abort();
    },
    convertMessage
  });

  function createConversation() {
    const conversation = createEmptyConversation();
    setChatState((previous) => ({
      currentConversationId: conversation.id,
      conversations: [conversation, ...previous.conversations]
    }));
    setSmartInput(emptySmartInput);
    setActionDialogOpen(false);
    setSmartDialogOpen(false);
    setSettingsDialogOpen(false);
    closeMobileHistory();
  }

  function openConversation(conversationId) {
    setChatState((previous) => ({
      ...previous,
      currentConversationId: conversationId
    }));
    closeMobileHistory();
  }

  function closeMobileHistory() {
    const drawer = document.querySelector(".mobile-history-drawer");
    if (drawer?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setMobileHistoryOpen(false);
  }

  function updateSmartInput(field, value) {
    setSmartInput((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  function buildSmartSolveInput() {
    return `scramble: ${smartInput.scramble}
timedMoves: ${smartInput.timedMoves}
segmentedSolution:
${smartInput.segmentedSolution}`.trim();
  }

  async function submitSmartSolve() {
    setSmartDialogOpen(false);
    await submitMessage(buildSmartSolveInput());
  }

  function openSmartCubeDialog() {
    setActionDialogOpen(false);
    setSmartDialogOpen(true);
  }

  function updateLlmSettings(field, value) {
    setLlmSettingsDraft((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  function selectLlmProvider(providerId) {
    setLlmSettingsDraft((previous) => applyLlmProviderProfile(previous, providerId));
  }

  function saveCurrentLlmSettings() {
    const next = sanitizeLlmSettings(llmSettingsDraft);
    setLlmSettingsDraft(next);
    saveLlmSettings(next);
    setSettingsDialogOpen(false);
  }

  function resetLlmSettings() {
    setLlmSettingsDraft(defaultLlmSettings);
  }

  function updateConversationById(conversationId, updater) {
    setChatState((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) => (
        conversation.id === conversationId
          ? updater(conversation)
          : conversation
      ))
    }));
  }

  async function editMessage(message) {
    const conversationId = chatState.currentConversationId;
    const conversation = chatState.conversations.find((item) => item.id === conversationId);
    if (!conversation) return;

    const targetIndex = resolveEditedUserMessageIndex(conversation.messages, message);
    if (targetIndex === -1) return;

    const text = extractMessageText(message);
    const baseContext = getContextBeforeIndex(conversation.messages, targetIndex);
    const nextConversation = buildEditedConversation(conversation, message, text, {
      createUserMessage: createMessage,
      deriveConversationTitle
    });
    if (!nextConversation) return;

    updateConversationById(conversationId, (conversationItem) => ({
      ...conversationItem,
      title: nextConversation.title,
      context: baseContext,
      messages: nextConversation.messages,
      updatedAt: new Date().toISOString()
    }));

    await submitMessage(text, {
      appendUser: false,
      conversationIdOverride: conversationId,
      contextOverride: baseContext
    });
  }

  async function reloadFromParent(parentId) {
    const conversationId = chatState.currentConversationId;
    const conversation = chatState.conversations.find((item) => item.id === conversationId);
    if (!conversation) return;

    const userIndex = parentId
      ? conversation.messages.findIndex((item) => item.id === parentId)
      : 0;
    const userMessage = conversation.messages[userIndex];
    if (!userMessage || userMessage.role !== "user") return;

    const baseContext = getContextBeforeIndex(conversation.messages, userIndex);
    updateConversationById(conversationId, (conversationItem) => ({
      ...conversationItem,
      context: baseContext,
      messages: conversationItem.messages.slice(0, userIndex + 1),
      updatedAt: new Date().toISOString()
    }));

    await submitMessage(userMessage.text, {
      appendUser: false,
      conversationIdOverride: conversationId,
      contextOverride: baseContext
    });
  }

  function renameConversation(conversationId) {
    const conversation = chatState.conversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    setRenameDialogState({
      open: true,
      conversationId,
      title: conversation.title
    });
  }

  function deleteConversation(conversationId) {
    const conversation = chatState.conversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    setDeleteDialogState({
      open: true,
      conversationId,
      title: conversation.title
    });
  }

  function submitRenameConversation() {
    const conversationId = renameDialogState.conversationId;
    const nextTitle = renameDialogState.title.trim();
    if (!conversationId || !nextTitle) return;

    updateConversationById(conversationId, (conversationItem) => ({
      ...conversationItem,
      title: nextTitle,
      updatedAt: conversationItem.updatedAt
    }));
    setRenameDialogState({
      open: false,
      conversationId: null,
      title: ""
    });
  }

  function confirmDeleteConversation() {
    const conversationId = deleteDialogState.conversationId;
    if (!conversationId) return;

    setChatState((previous) => {
      const remaining = previous.conversations.filter((item) => item.id !== conversationId);
      if (!remaining.length) {
        const empty = createEmptyConversation();
        return {
          currentConversationId: empty.id,
          conversations: [empty]
        };
      }

      return {
        currentConversationId: previous.currentConversationId === conversationId ? remaining[0].id : previous.currentConversationId,
        conversations: remaining
      };
    });
    setDeleteDialogState({
      open: false,
      conversationId: null,
      title: ""
    });
  }

  function deleteMessage(messageId) {
    const conversationId = chatState.currentConversationId;
    const conversation = chatState.conversations.find((item) => item.id === conversationId);
    if (!conversation) return;

    const index = conversation.messages.findIndex((item) => item.id === messageId);
    if (index === -1) return;
    const target = conversation.messages[index];
    const next = conversation.messages[index + 1];
    const nextMessages = target.role === "user" && next?.role === "assistant"
      ? [...conversation.messages.slice(0, index), ...conversation.messages.slice(index + 2)]
      : [...conversation.messages.slice(0, index), ...conversation.messages.slice(index + 1)];

    updateConversationById(conversationId, (conversationItem) => ({
      ...conversationItem,
      messages: nextMessages,
      context: getLastAssistantContext(nextMessages),
      updatedAt: new Date().toISOString()
    }));
  }

  function handleEdgePointerDown(event) {
    if (window.innerWidth > 720 || event.clientX > 24 || mobileHistoryOpen) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = {
      kind: "edge",
      x: event.clientX,
      y: event.clientY
    };
  }

  function handleEdgePointerUp(event) {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.kind !== "edge") {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = Math.abs(event.clientY - start.y);
    if (deltaX > 64 && deltaY < 48) {
      setMobileHistoryOpen(true);
    }
  }

  function handleDrawerPointerDown(event) {
    pointerStartRef.current = {
      kind: "drawer",
      x: event.clientX,
      y: event.clientY
    };
  }

  function handleDrawerPointerUp(event) {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.kind !== "drawer") {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = Math.abs(event.clientY - start.y);
    if (deltaX < -64 && deltaY < 56) {
      closeMobileHistory();
    }
  }

  return (
    <TooltipProvider>
      <main
        className="app-shell"
        onPointerDown={handleEdgePointerDown}
        onPointerUp={handleEdgePointerUp}>
        <aside className="sidebar" aria-label="Conversation Sidebar">
          <div className="sidebar-brand">
            <TooltipIconButton
              type="button"
              className="mobile-menu-button"
              tooltip="打开对话历史"
              aria-label="打开对话历史"
              aria-expanded={mobileHistoryOpen}
              onClick={() => setMobileHistoryOpen(true)}
            >
              <Menu />
            </TooltipIconButton>
            <img className="sidebar-label brand-logo" src="/cugent-wordmark.png" alt="Cugent" />
          </div>
          <nav className="sidebar-nav">
            <Button type="button" variant="ghost" className="sidebar-action" onClick={createConversation} title="新建对话">
              <MessageSquarePlus data-icon="inline-start" />
              <span className="sidebar-label">新建对话</span>
            </Button>
            <div className="conversation-history" aria-label="对话历史">
              {sortedConversations.map((conversation) => (
                <div className="history-row" key={conversation.id}>
                  <Button
                    type="button"
                    variant={conversation.id === chatState.currentConversationId ? "secondary" : "ghost"}
                    className="history-item"
                    title={conversation.title}
                    onClick={() => openConversation(conversation.id)}
                  >
                    <span className="sidebar-label history-item-label">{conversation.title}</span>
                  </Button>
                  <div className="history-item-tools">
                    <TooltipIconButton variant="ghost" size="icon" className="history-tool-button" onClick={() => renameConversation(conversation.id)}>
                      <Pencil />
                    </TooltipIconButton>
                    <TooltipIconButton variant="ghost" size="icon" className="history-tool-button" onClick={() => deleteConversation(conversation.id)}>
                      <Trash2 />
                    </TooltipIconButton>
                  </div>
                </div>
              ))}
            </div>
          </nav>
          <div className="sidebar-footer">
            <TooltipIconButton
              type="button"
              className="sidebar-settings-button"
              aria-label="打开设置"
              onClick={() => setSettingsDialogOpen(true)}
            >
              <Settings2 />
            </TooltipIconButton>
          </div>
        </aside>

        <div
          className="mobile-history-backdrop"
          data-open={mobileHistoryOpen}
          aria-hidden={!mobileHistoryOpen}
          onClick={closeMobileHistory}
        >
          <aside
            className="mobile-history-drawer"
            aria-label="移动端对话历史"
            aria-hidden={!mobileHistoryOpen}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={handleDrawerPointerDown}
            onPointerUp={handleDrawerPointerUp}
          >
            <div className="mobile-drawer-brand">
              <img className="brand-logo" src="/cugent-wordmark.png" alt="Cugent" />
            </div>
            <nav className="mobile-drawer-nav">
              <Button type="button" variant="ghost" className="sidebar-action" onClick={createConversation}>
                <MessageSquarePlus data-icon="inline-start" />
                <span>新建对话</span>
              </Button>
              <div className="conversation-history" aria-label="对话历史">
                {sortedConversations.map((conversation) => (
                  <div className="history-row" key={conversation.id}>
                    <Button
                      type="button"
                      variant={conversation.id === chatState.currentConversationId ? "secondary" : "ghost"}
                      className="history-item"
                      title={conversation.title}
                      onClick={() => openConversation(conversation.id)}
                    >
                      <span className="history-item-label">{conversation.title}</span>
                    </Button>
                    <div className="history-item-tools">
                      <TooltipIconButton variant="ghost" size="icon" className="history-tool-button" onClick={() => renameConversation(conversation.id)}>
                        <Pencil />
                      </TooltipIconButton>
                      <TooltipIconButton variant="ghost" size="icon" className="history-tool-button" onClick={() => deleteConversation(conversation.id)}>
                        <Trash2 />
                      </TooltipIconButton>
                    </div>
                  </div>
                ))}
              </div>
            </nav>
            <div className="mobile-drawer-footer">
              <TooltipIconButton
                type="button"
                className="sidebar-settings-button"
                aria-label="打开设置"
                onClick={() => setSettingsDialogOpen(true)}
              >
                <Settings2 />
              </TooltipIconButton>
            </div>
          </aside>
        </div>

        <section className="chat-pane" aria-label="Chat">
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread onOpenSmartCube={() => setActionDialogOpen(true)} onDeleteMessage={deleteMessage} />
          </AssistantRuntimeProvider>
        </section>

        <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
          <DialogContent className="action-dialog-content sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>添加</DialogTitle>
            </DialogHeader>
            <div className="action-list">
              <Button type="button" variant="outline" className="action-list-item" onClick={openSmartCubeDialog}>
                <Sparkles data-icon="inline-start" />
                <span>智能魔方数据</span>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={renameDialogState.open}
          onOpenChange={(open) => {
            setRenameDialogState((previous) => ({
              ...previous,
              open,
              conversationId: open ? previous.conversationId : null,
              title: open ? previous.title : ""
            }));
          }}
        >
          <DialogContent className="action-dialog-content sm:max-w-md">
            <DialogHeader>
              <DialogTitle>重命名会话</DialogTitle>
            </DialogHeader>
            <form
              className="conversation-manage-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitRenameConversation();
              }}
            >
              <label className="conversation-manage-field">
                <Input
                  autoFocus
                  value={renameDialogState.title}
                  onChange={(event) => setRenameDialogState((previous) => ({ ...previous, title: event.target.value }))}
                  placeholder="输入会话名称"
                />
              </label>
              <div className="conversation-manage-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRenameDialogState({ open: false, conversationId: null, title: "" })}
                >
                  取消
                </Button>
                <Button type="submit" className="dialog-primary-button" disabled={!renameDialogState.title.trim()}>
                  保存
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={deleteDialogState.open}
          onOpenChange={(open) => {
            setDeleteDialogState((previous) => ({
              ...previous,
              open,
              conversationId: open ? previous.conversationId : null,
              title: open ? previous.title : ""
            }));
          }}
        >
          <DialogContent className="action-dialog-content sm:max-w-md">
            <DialogHeader>
              <DialogTitle>删除会话</DialogTitle>
              <DialogDescription>
                {`确定删除会话「${deleteDialogState.title}」吗？删除后无法恢复。`}
              </DialogDescription>
            </DialogHeader>
            <div className="conversation-manage-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteDialogState({ open: false, conversationId: null, title: "" })}
              >
                取消
              </Button>
              <Button type="button" className="dialog-primary-button" onClick={confirmDeleteConversation}>
                删除
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={smartDialogOpen} onOpenChange={setSmartDialogOpen}>
          <DialogContent className="smart-dialog-content sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>智能魔方</DialogTitle>
            </DialogHeader>
            <form
              className="smart-fields"
              onSubmit={(event) => {
                event.preventDefault();
                void submitSmartSolve();
              }}
            >
              <label>
                <span>打乱</span>
                <Input
                  value={smartInput.scramble}
                  onChange={(event) => updateSmartInput("scramble", event.target.value)}
                  placeholder="R U R' U'"
                />
              </label>
              <label>
                <span>回顾</span>
                <Textarea
                  value={smartInput.timedMoves}
                  onChange={(event) => updateSmartInput("timedMoves", event.target.value)}
                  placeholder="U@0 R@250 U'@500 R'@750"
                  rows={4}
                />
              </label>
              <label>
                <span>分段解法（可选）</span>
                <Textarea
                  value={smartInput.segmentedSolution}
                  onChange={(event) => updateSmartInput("segmentedSolution", event.target.value)}
                  placeholder="U R // Cross"
                  rows={4}
                />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSmartDialogOpen(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy} className="dialog-primary-button">
                  {busy ? "导入中" : "导入"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
            <DialogContent className="settings-dialog-content sm:max-w-5xl" showCloseButton={false}>
              <DialogHeader className="sr-only">
                <DialogTitle>设置</DialogTitle>
              <DialogDescription>配置模型服务和 API Key。</DialogDescription>
            </DialogHeader>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" className="settings-close-button" aria-label="关闭设置">
                <XIcon />
              </Button>
            </DialogClose>
            <div className="settings-layout">
              <aside className="settings-sidebar">
                <Button
                  type="button"
                  variant={activeSettingsSection === "model" ? "secondary" : "ghost"}
                  className="settings-nav-item"
                  onClick={() => setActiveSettingsSection("model")}
                >
                  <span>模型设置</span>
                </Button>
              </aside>
              <section className="settings-panel">
                {activeSettingsSection === "model" ? (
                  <form
                    className="settings-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveCurrentLlmSettings();
                    }}
                  >
                    <div className="settings-row settings-row-toggle">
                      <div className="settings-row-head">
                        <div className="settings-row-heading">
                          <span className="settings-row-label">启用 LLM</span>
                          <span className="settings-row-help">启用后，对话流会加入 LLM 辅助分析</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={llmSettingsDraft.enabled !== false}
                          className="settings-switch"
                          data-checked={llmSettingsDraft.enabled !== false}
                          onClick={() => updateLlmSettings("enabled", llmSettingsDraft.enabled === false)}
                        >
                          <span className="settings-switch-thumb" />
                        </button>
                      </div>
                    </div>
                    <div className="settings-row settings-row-field">
                      <div className="settings-row-heading">
                        <span className="settings-row-label">模型服务</span>
                        <span className="settings-row-help">大多数情况下选择 DeepSeek 即可</span>
                      </div>
                      <div className="provider-profile-list">
                        {llmProviderProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            type="button"
                            className="provider-profile-option"
                            data-selected={llmSettingsDraft.providerId === profile.id}
                            onClick={() => selectLlmProvider(profile.id)}
                          >
                            <span className="provider-profile-title">{profile.label}</span>
                            <span className="provider-profile-description">{profile.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {shouldShowApiBaseUrl(llmSettingsDraft) ? (
                      <label className="settings-row settings-row-field">
                        <div className="settings-row-heading">
                          <span className="settings-row-label">API 地址</span>
                          <span className="settings-row-help">填写 OpenAI 兼容接口地址</span>
                        </div>
                        <Input
                          className="settings-input"
                          value={llmSettingsDraft.baseUrl}
                          onChange={(event) => updateLlmSettings("baseUrl", event.target.value)}
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                    ) : null}
                    <label className="settings-row settings-row-field">
                      <div className="settings-row-heading">
                        <span className="settings-row-label">API Key</span>
                        <span className="settings-row-help">仅保存在本地客户端</span>
                      </div>
                      <Input
                        className="settings-input"
                        type="password"
                        value={llmSettingsDraft.apiKey}
                        onChange={(event) => updateLlmSettings("apiKey", event.target.value)}
                        placeholder="sk-..."
                      />
                    </label>
                    {shouldShowModelName(llmSettingsDraft) ? (
                      <label className="settings-row settings-row-field">
                        <div className="settings-row-heading">
                          <span className="settings-row-label">模型名</span>
                          <span className="settings-row-help">填写兼容接口中的模型名称</span>
                        </div>
                        <Input
                          className="settings-input"
                          value={llmSettingsDraft.model}
                          onChange={(event) => updateLlmSettings("model", event.target.value)}
                          placeholder="deepseek-v4-flash"
                        />
                      </label>
                    ) : null}
                    <div className="settings-form-actions">
                      <Button type="button" variant="ghost" onClick={resetLlmSettings}>
                        恢复默认
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setSettingsDialogOpen(false)}>
                        取消
                      </Button>
                      <Button type="submit" className="dialog-primary-button">
                        保存
                      </Button>
                    </div>
                  </form>
                ) : null}
              </section>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}

function createMessage(role, text, extra = {}) {
  return {
    id: extra.id ?? crypto.randomUUID(),
    role,
    text,
    ...extra
  };
}

function extractMessageText(message) {
  if (typeof message.content === "string") {
    return message.content;
  }
  return (message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function convertMessage(message) {
  const converted = {
    id: message.id,
    role: message.role,
    content: message.contentParts ?? [{ type: "text", text: message.text }],
    metadata: {
      custom: {
        intent: message.intent,
        toolCalls: message.toolCalls,
        cubeResponse: message.response
      }
    }
  };
  if (message.role === "assistant") {
    converted.status = message.status ?? { type: "complete", reason: "stop" };
  }
  return converted;
}

createRoot(document.getElementById("root")).render(<App />);

function getPendingAssistantText(turn) {
  if (turn.intent?.type === "chat") {
    return "正在思考中…";
  }

  return "正在分析中…";
}

function getContextBeforeIndex(messages, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message.role === "assistant" && message.contextSnapshot) {
      return message.contextSnapshot;
    }
  }

  return {};
}

function getLastAssistantContext(messages) {
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message.role === "assistant" && message.contextSnapshot) {
      return message.contextSnapshot;
    }
  }

  return {};
}

function shouldShowApiBaseUrl(settings) {
  return settings?.providerId === "custom-openai-compatible";
}

function shouldShowModelName(settings) {
  return settings?.providerId === "custom-openai-compatible";
}
