import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { FileInput, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Search, Sparkles } from "lucide-react";
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

const scramble = "B' R' U2 L2 F U2 L2 B2 F' D2 F R2 B D R U2 L F2 R' U";
const solution = invertAlg(scramble);
const reviewMoves = "U'@0 F'@136 U'@265 F'@448 F'@504 U'@729 F@1475 D@1582 F'@1792 D@2166 R'@2233 D'@2294 R@2367 R@2423 D'@2483 R'@2572 D@2621 R@2674 D'@2720 R'@3083 R@3360 D'@3409 R'@3475 L@3628 D@3739 D@3788 L'@3850 D@4356 L'@4444 D@4505 L@4563 D'@5008 R@5112 D'@5170 R'@5237 D@5294 R@5343 D'@5383 R'@5474 D@5537 D@5590 R@5641 D'@5694 R'@5759 D@6236 R@6327 D@6434 R'@6506 D'@6614 L@6669 R'@6803 B@6852 R@6913 B'@6958 L'@7049 R@7544 D'@7605 R'@7685 D'@7778 R@7896 D@8146 R@8232 U@8283 R'@8380 D'@8430 R@8495 U'@8544 R'@8664 D@8737 D@8775 R'@8818 D'@8888 D'@8916";
const displayReviewMoves = `${reviewMoves.slice(0, 154)}...`;
const ollCompressionAlg = "R' F R U R' U' F' U R";
const demoConversationTitles = [
  "OLL 压缩建议",
  "F2L 暂停复盘",
  "PLL 公式替换",
  "Cross 规划检查"
];
const demoMessages = [
  createMessage("user", "能帮我看看上次 F2L 1 为什么卡住吗？"),
  createMessage("assistant", "可以。上次主要卡在入槽前的观察切换，我会优先看停顿和转体位置。"),
  createMessage("user", "今天先看这把完整复盘。"),
  createMessage("assistant", "好，把打乱和带时间戳的回顾发我，我会按阶段拆开看。"),
  createMessage(
    "user",
    `帮我分析：\n打乱：${scramble}\n复盘：["${displayReviewMoves}","333"]`
  ),
  createMessage("assistant", "已收到打乱和具体解法回顾\n\n根据分析，建议 OLL 压缩为一步公式：`R' F R U R' U' F' U R`", {
    contentParts: [
      { type: "text", text: "已收到打乱和具体解法回顾" },
      {
        type: "tool-call",
        toolCallId: "demo-solve-review",
        toolName: "AnalyzeSolveReview",
        args: {
          scramble,
          review: `${displayReviewMoves}","333`
        },
        argsText: JSON.stringify(
          {
            scramble,
            review: `${displayReviewMoves}","333`
          },
          null,
          2
        ),
        result: {
          status: "ok",
          suggestion: ollCompressionAlg
        }
      },
      { type: "text", text: `根据分析，建议 OLL 压缩为一步公式：\`${ollCompressionAlg}\`` }
    ],
    response: {
      kind: "algorithm-preview",
      evidence: [],
      nextActions: [],
      playback: "https://alg.cubing.net/?alg=R-_F_R_U_R-_U-_F-_U_R_&setup=R-_U-_F_U_R_U-_R-_F-_R"
    },
    intent: "solve-import",
    toolCalls: [{ name: "AnalyzeSolveReview", status: "complete" }]
  })
];
const sampleSolve = `scramble: ${scramble}
timedMoves: ${solution.split(" ").map((move, index) => `${move}@${index * 250}`).join(" ")}
segmentedSolution:
${solution.split(" ").slice(0, 2).join(" ")} // Cross
${solution.split(" ").slice(2).join(" ")} // F2L 1`;

const sampleSmartInput = {
  scramble,
  timedMoves: reviewMoves,
  segmentedSolution: ""
};

function App() {
  const [messages, setMessages] = useState(() => demoMessages);
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
    setMessages([]);
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
            <div className="conversation-history" aria-label="对话历史">
              {demoConversationTitles.map((title, index) => (
                <Button
                  key={title}
                  type="button"
                  variant={index === 0 ? "secondary" : "ghost"}
                  className="history-item"
                  title={title}
                  onClick={() => setMessages(demoMessages)}
                >
                  <MessageSquarePlus data-icon="inline-start" />
                  <span className="sidebar-label">{title}</span>
                </Button>
              ))}
            </div>
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
    converted.status = { type: "complete", reason: "stop" };
  }
  return converted;
}

createRoot(document.getElementById("root")).render(<App />);
