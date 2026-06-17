import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { Sparkles } from "lucide-react";
import { MobileHistoryDrawer } from "@/components/mobile-history-drawer";
import { Sidebar } from "@/components/sidebar";
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
import {
  applyAgentEventToAssistantMessage,
  applyCancelledTurnToAssistantMessage,
  applyCompletedTurnToAssistantMessage,
  applyFailedTurnToAssistantMessage,
  applyTextDeltaToAssistantMessage,
  applyTurnReadyToAssistantMessage,
  createAgentRuntimeRequest,
  createRunningAssistantResponse,
  runAgentTurn
} from "../agent-runtime/index.js";
import { buildEditedConversation, resolveEditedUserMessageIndex } from "./chat-editing.js";
import { createEmptyConversation, deriveConversationTitle, loadChatState } from "./chat-storage.js";
import {
  applyLlmProviderProfile,
  defaultLlmSettings,
  loadLlmSettings,
  llmProviderProfiles,
  saveLlmSettings,
  sanitizeLlmSettings
} from "./llm-settings.js";
import { usePersistChatState } from "./use-persist-chat-state.js";
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
  const [streamingMessage, setStreamingMessage] = useState(null);
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
  const storedMessages = currentConversation?.messages ?? [];
  const messages = useMemo(() => {
    if (!streamingMessage || streamingMessage.conversationId !== currentConversation?.id) {
      return storedMessages;
    }

    return storedMessages.map((message) => (
      message.id === streamingMessage.messageId
        ? applyTextDeltaToAssistantMessage(
          message,
          streamingMessage.text,
          streamingMessage.llmMeta,
          streamingMessage.llmSettings
        )
        : message
    ));
  }, [currentConversation?.id, storedMessages, streamingMessage]);
  const context = currentConversation?.context ?? {};

  const flushChatState = usePersistChatState(chatState);

  async function submitMessage(nextInput, { appendUser = true, conversationIdOverride, contextOverride } = {}) {
    const trimmed = nextInput.trim();
    if (!trimmed || busy) {
      return;
    }

    const conversationId = conversationIdOverride ?? chatState.currentConversationId;
    const conversation = chatState.conversations.find((item) => item.id === conversationId) ?? currentConversation;
    const baseContext = contextOverride ?? conversation?.context ?? {};

    setBusy(true);
    setStreamingMessage(null);
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
    setStreamingMessage({
      conversationId,
      messageId: assistantMessageId,
      text: "",
      llmMeta: null,
      llmSettings: llmSettingsDraft
    });
    updateConversationById(conversationId, (conversationItem) => ({
      ...conversationItem,
      messages: [
        ...conversationItem.messages,
        createMessage("assistant", "", {
          id: assistantMessageId,
          response: createRunningAssistantResponse(llmSettingsDraft),
          status: {
            type: "running"
          }
        })
      ],
      updatedAt: new Date().toISOString()
    }));

    try {
      const llmSettings = sanitizeLlmSettings(llmSettingsDraft);
      const agentRequest = createAgentRuntimeRequest({
        message: trimmed,
        context: baseContext,
        llmSettings
      });
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const turn = await runAgentTurn(
        agentRequest.message,
        agentRequest.context,
        {
          onTurnReady: (readyTurn) => {
            updateConversationById(conversationId, (conversationItem) => ({
              ...conversationItem,
              messages: conversationItem.messages.map((item) => {
                if (item.id !== assistantMessageId) {
                  return item;
                }

                return applyTurnReadyToAssistantMessage(
                  item,
                  readyTurn,
                  llmSettings,
                  getPendingAssistantText(readyTurn)
                );
              }),
              updatedAt: new Date().toISOString()
            }));
          },
          onAgentEvent: (agentEvent) => {
            if (agentEvent.phase === "answering") {
              return;
            }

            updateConversationById(conversationId, (conversationItem) => ({
              ...conversationItem,
              messages: conversationItem.messages.map((item) => {
                if (item.id !== assistantMessageId) {
                  return item;
                }

                return applyAgentEventToAssistantMessage(item, agentEvent, llmSettings);
              }),
              updatedAt: new Date().toISOString()
            }));
          },
          signal: abortController.signal,
          onTextDelta: (nextText, llmMeta) => {
            setStreamingMessage({
              conversationId,
              messageId: assistantMessageId,
              text: nextText,
              llmMeta,
              llmSettings
            });
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

            return applyCancelledTurnToAssistantMessage(item, turn);
          }),
          updatedAt: new Date().toISOString()
        }));
        setStreamingMessage(null);
        flushChatState();
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

          return applyCompletedTurnToAssistantMessage(item, turn, nextContext);
        }),
        updatedAt: new Date().toISOString()
      }));
      setStreamingMessage(null);
      flushChatState();
    } catch (error) {
      updateConversationById(conversationId, (conversationItem) => ({
        ...conversationItem,
        messages: conversationItem.messages.map((item) => {
          if (item.id !== assistantMessageId) {
            return item;
          }

          return applyFailedTurnToAssistantMessage(item, error);
        }),
        updatedAt: new Date().toISOString()
      }));
      setStreamingMessage(null);
      flushChatState();
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
    setStreamingMessage(null);
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

    setStreamingMessage(null);
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
    setStreamingMessage(null);
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

    setStreamingMessage((previous) => (
      previous?.messageId === messageId || previous?.messageId === next?.id ? null : previous
    ));
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
        <Sidebar
          conversations={sortedConversations}
          currentConversationId={chatState.currentConversationId}
          mobileHistoryOpen={mobileHistoryOpen}
          onOpenMobileHistory={() => setMobileHistoryOpen(true)}
          onCreateConversation={createConversation}
          onOpenConversation={openConversation}
          onRenameConversation={renameConversation}
          onDeleteConversation={deleteConversation}
          onOpenSettings={() => setSettingsDialogOpen(true)}
        />

        <MobileHistoryDrawer
          open={mobileHistoryOpen}
          conversations={sortedConversations}
          currentConversationId={chatState.currentConversationId}
          onClose={closeMobileHistory}
          onDrawerPointerDown={handleDrawerPointerDown}
          onDrawerPointerUp={handleDrawerPointerUp}
          onCreateConversation={createConversation}
          onOpenConversation={openConversation}
          onRenameConversation={renameConversation}
          onDeleteConversation={deleteConversation}
          onOpenSettings={() => setSettingsDialogOpen(true)}
        />

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
