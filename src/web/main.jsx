import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { Box, FileInput, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Search, Sparkles } from "lucide-react";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Thread } from "@/components/thread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { invertAlg } from "../cubing-tools/index.js";
import { runAgentTurn } from "../agent-runtime/index.js";
import "./styles.css";

const scramble = "R U R' U'";
const solution = invertAlg(scramble);
const sampleSolve = `scramble: ${scramble}
timedMoves: ${solution.split(" ").map((move, index) => `${move}@${index * 250}`).join(" ")}
segmentedSolution:
${solution.split(" ").slice(0, 2).join(" ")} // Cross
${solution.split(" ").slice(2).join(" ")} // F2L 1`;

const sampleSmartInput = {
  scramble,
  timedMoves: solution.split(" ").map((move, index) => `${move}@${index * 250}`).join(" "),
  segmentedSolution: `${solution.split(" ").slice(0, 2).join(" ")} // Cross
${solution.split(" ").slice(2).join(" ")} // F2L 1`
};

const welcomeMessage = {
  id: "welcome",
  role: "assistant",
  text: "CubeAgent 已就绪。可以直接聊天、查询公式，或点击输入框旁的 + 导入智能魔方复盘。",
  response: null
};

function App() {
  const [messages, setMessages] = useState([welcomeMessage]);
  const [smartInput, setSmartInput] = useState(sampleSmartInput);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [smartDialogOpen, setSmartDialogOpen] = useState(false);
  const [context, setContext] = useState({});
  const [busy, setBusy] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  async function submitMessage(nextInput, { appendUser = true } = {}) {
    const trimmed = nextInput.trim();
    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    if (appendUser) {
      setMessages((items) => [...items, createMessage("user", trimmed)]);
    }

    try {
      const turn = await runAgentTurn(trimmed, context);
      setContext((previous) => ({ ...previous, ...turn.contextPatch }));
      setMessages((items) => [
        ...items,
        createMessage("assistant", turn.response.text, {
          response: turn.response,
          intent: turn.intent.type,
          toolCalls: turn.toolCalls
        })
      ]);
    } catch (error) {
      setMessages((items) => [
        ...items,
        createMessage("assistant", `处理失败：${error.message}`, {
          response: { kind: "error", evidence: [], nextActions: [] }
        })
      ]);
    } finally {
      setBusy(false);
    }
  }

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: busy,
    onNew: async (message) => {
      await submitMessage(extractMessageText(message));
    },
    convertMessage
  });

  function importSampleSolve() {
    setSmartInput(sampleSmartInput);
    setActionDialogOpen(false);
    void submitMessage(sampleSolve);
  }

  function createConversation() {
    setMessages([welcomeMessage]);
    setSmartInput(sampleSmartInput);
    setActionDialogOpen(false);
    setSmartDialogOpen(false);
    setContext({});
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
    await submitMessage(buildSmartSolveInput());
    setSmartDialogOpen(false);
  }

  function openSmartCubeDialog() {
    setActionDialogOpen(false);
    setSmartDialogOpen(true);
  }

  function runQuickAction(text) {
    setActionDialogOpen(false);
    void submitMessage(text);
  }

  return (
    <TooltipProvider>
      <main className={cn("app-shell", sidebarCollapsed && "sidebar-collapsed")}>
        <aside className="sidebar" aria-label="Conversation Sidebar" aria-expanded={!sidebarCollapsed}>
          <div className="sidebar-brand">
            <div className="brand-mark" aria-hidden="true">
              <Box />
            </div>
            <span className="sidebar-label">CubeAgent</span>
            <TooltipIconButton
              type="button"
              className="collapse-button"
              tooltip={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
              aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </TooltipIconButton>
          </div>
          <nav className="sidebar-nav">
            <Button type="button" variant="ghost" className="sidebar-action" onClick={createConversation} title="新建对话">
              <MessageSquarePlus data-icon="inline-start" />
              <span className="sidebar-label">新建对话</span>
            </Button>
          </nav>
        </aside>

        <section className="chat-pane" aria-label="Chat">
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread onOpenSmartCube={() => setActionDialogOpen(true)} />
          </AssistantRuntimeProvider>
        </section>

        <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
          <DialogContent className="action-dialog-content sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>添加内容</DialogTitle>
              <DialogDescription>从这里导入结构化复盘，或运行开发调试用的快捷消息。</DialogDescription>
            </DialogHeader>
            <div className="action-list">
              <Button type="button" variant="outline" className="action-list-item" onClick={openSmartCubeDialog}>
                <Sparkles data-icon="inline-start" />
                <span>智能魔方</span>
              </Button>
              <Button type="button" variant="ghost" className="action-list-item" onClick={importSampleSolve}>
                <FileInput data-icon="inline-start" />
                <span>导入样例</span>
              </Button>
              <Button type="button" variant="ghost" className="action-list-item" onClick={() => runQuickAction("给我一个右手 no-rotation 的 OLL 27 公式")}>
                <Search data-icon="inline-start" />
                <span>查询 OLL 27</span>
              </Button>
              <Button type="button" variant="ghost" className="action-list-item" onClick={() => runQuickAction("F2L 1 这里怎么样？")}>
                <MessageSquarePlus data-icon="inline-start" />
                <span>追问 F2L 1</span>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={smartDialogOpen} onOpenChange={setSmartDialogOpen}>
          <DialogContent className="smart-dialog-content sm:max-w-xl">
            <DialogHeader>
              <p className="eyebrow">Cube Input</p>
              <DialogTitle>智能魔方</DialogTitle>
              <DialogDescription>填写复盘初始信息，提交后会作为一条结构化消息进入对话。</DialogDescription>
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
                <span>带时间戳的回顾</span>
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
                <Button type="submit" disabled={busy}>
                  {busy ? "导入中" : "导入"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}

function createMessage(role, text, extra = {}) {
  return {
    id: crypto.randomUUID(),
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
    content: [{ type: "text", text: message.text }],
    metadata: {
      custom: {
        intent: message.intent,
        toolCalls: message.toolCalls,
        cubeResponse: message.response
      }
    }
  };
  if (message.role === "assistant") {
    converted.status = { type: "complete", reason: "stop" };
  }
  return converted;
}

createRoot(document.getElementById("root")).render(<App />);
