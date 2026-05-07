import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileInput, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Play, Plus, RotateCw, Search, Send, Sparkles, X } from "lucide-react";
import "cubing/twisty";
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
  role: "assistant",
  text: "CubeAgent 已就绪。可以直接聊天、查询公式，或点击输入框旁的 + 导入智能魔方复盘。",
  response: null
};

function App() {
  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState("");
  const [smartInput, setSmartInput] = useState(sampleSmartInput);
  const [smartDialogOpen, setSmartDialogOpen] = useState(false);
  const [context, setContext] = useState({});
  const [busy, setBusy] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const textareaRef = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  function resizeComposer() {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  async function submitMessage(nextInput = input) {
    const trimmed = nextInput.trim();
    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    setMessages((items) => [...items, { role: "user", text: trimmed, response: null }]);

    try {
      const turn = await runAgentTurn(trimmed, context);
      setContext((previous) => ({ ...previous, ...turn.contextPatch }));
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          text: turn.response.text,
          response: turn.response,
          intent: turn.intent.type,
          toolCalls: turn.toolCalls
        }
      ]);
      setInput("");
    } catch (error) {
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          text: `处理失败：${error.message}`,
          response: { kind: "error", evidence: [], nextActions: [] }
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  function quickSend(text) {
    setInput(text);
    void submitMessage(text);
  }

  function importSampleSolve() {
    setSmartInput(sampleSmartInput);
    void submitMessage(sampleSolve);
  }

  function createConversation() {
    setMessages([welcomeMessage]);
    setInput("");
    setSmartInput(sampleSmartInput);
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

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Conversation Sidebar" aria-expanded={!sidebarCollapsed}>
        <div className="sidebar-brand">
          <div className="brand-mark">C</div>
          <span className="sidebar-label">CubeAgent</span>
          <button
            type="button"
            className="collapse-button"
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <nav className="sidebar-nav">
          <button type="button" onClick={createConversation} title="新建对话">
            <MessageSquarePlus size={19} />
            <span className="sidebar-label">新建对话</span>
          </button>
        </nav>
      </aside>

      <section className="chat-pane" aria-label="Chat">
        <header className="topbar">
          <div>
            <p className="eyebrow">CubeAgent</p>
            <h1>魔方 AI 教练 PoC</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="icon-button" title="导入样例" onClick={importSampleSolve}>
              <FileInput size={18} />
            </button>
            <button type="button" className="icon-button" title="查询 OLL 27" onClick={() => quickSend("给我一个右手 no-rotation 的 OLL 27 公式")}>
              <Search size={18} />
            </button>
            <button type="button" className="icon-button" title="追问 F2L 1" onClick={() => quickSend("F2L 1 这里怎么样？")}>
              <Sparkles size={18} />
            </button>
          </div>
        </header>

        <div className="message-list" ref={messageListRef}>
          {messages.map((message, index) => (
            <Message key={`${message.role}-${index}`} message={message} />
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage(input);
          }}
        >
          <button type="button" className="attach-button" title="智能魔方导入" onClick={() => setSmartDialogOpen(true)}>
            <Plus size={18} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入消息，或点击 + 导入智能魔方复盘"
            rows={1}
          />
          <button type="submit" disabled={busy} title="发送">
            {busy ? <RotateCw size={18} className="spin" /> : <Send size={18} />}
            <span>{busy ? "处理中" : "发送"}</span>
          </button>
        </form>
      </section>

      {smartDialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSmartDialogOpen(false)}>
          <section className="smart-dialog" role="dialog" aria-modal="true" aria-labelledby="smart-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="smart-dialog-header">
              <div>
                <p className="eyebrow">Cube Input</p>
                <h2 id="smart-dialog-title">智能魔方</h2>
              </div>
              <button type="button" className="icon-button" title="关闭" onClick={() => setSmartDialogOpen(false)}>
                <X size={17} />
              </button>
            </header>
            <form
              className="smart-fields"
              onSubmit={(event) => {
                event.preventDefault();
                void submitSmartSolve();
              }}
            >
              <label>
                <span>打乱</span>
                <input
                  value={smartInput.scramble}
                  onChange={(event) => updateSmartInput("scramble", event.target.value)}
                  placeholder="R U R' U'"
                />
              </label>
              <label>
                <span>带时间戳的回顾</span>
                <textarea
                  value={smartInput.timedMoves}
                  onChange={(event) => updateSmartInput("timedMoves", event.target.value)}
                  placeholder="U@0 R@250 U'@500 R'@750"
                  rows={4}
                />
              </label>
              <label>
                <span>分段解法（可选）</span>
                <textarea
                  value={smartInput.segmentedSolution}
                  onChange={(event) => updateSmartInput("segmentedSolution", event.target.value)}
                  placeholder="U R // Cross"
                  rows={4}
                />
              </label>
              <div className="smart-dialog-actions">
                <button type="button" onClick={() => setSmartDialogOpen(false)}>取消</button>
                <button type="submit" disabled={busy}>{busy ? "导入中" : "导入"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function Message({ message }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="bubble">
        <p>{message.text}</p>
        {message.intent && <span className="intent">{message.intent}</span>}
        {message.response && <ResponseDetails response={message.response} />}
      </div>
    </article>
  );
}

function ResponseDetails({ response }) {
  return (
    <div className="response-details">
      {response.evidence?.length > 0 && (
        <ul>
          {response.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {response.highlights?.length > 0 && (
        <div className="mini-section">
          {response.highlights.map((item) => (
            <div className="highlight" key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.priority}</span>
              {item.candidates?.map((candidate) => <code key={candidate.id}>{candidate.alg}</code>)}
            </div>
          ))}
        </div>
      )}
      {response.candidates?.length > 0 && (
        <div className="mini-section">
          {response.candidates.map((candidate) => (
            <div className="candidate" key={candidate.id}>
              <strong>{candidate.name}</strong>
              <code>{candidate.alg}</code>
            </div>
          ))}
        </div>
      )}
      {response.playback && <TwistyPreview playback={response.playback} title="预览" />}
    </div>
  );
}

function TwistyPreview({ playback, alg, setup = "", title = "预览", compact = false }) {
  const playerRef = useRef(null);
  const parsed = useMemo(() => {
    if (alg) {
      return { alg, setup };
    }
    return parsePlayback(playback);
  }, [alg, playback, setup]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !parsed.alg) {
      return;
    }
    player.setAttribute("alg", parsed.alg);
    if (parsed.setup) {
      player.setAttribute("experimental-setup-alg", parsed.setup);
    } else {
      player.removeAttribute("experimental-setup-alg");
    }
  }, [parsed.alg, parsed.setup]);

  if (!parsed.alg) {
    return <code className="playback-code">{playback}</code>;
  }

  function play() {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (typeof player.jumpToStart === "function") {
      player.jumpToStart();
    }
    if (typeof player.play === "function") {
      void player.play();
    }
  }

  return (
    <div className={`twisty-preview ${compact ? "compact" : ""}`}>
      <div className="twisty-toolbar">
        <strong>{title}</strong>
        <button type="button" onClick={play} title="播放转动">
          <Play size={15} />

        </button>
      </div>
      <twisty-player
        ref={playerRef}
        puzzle="3x3x3"
        background="none"
        hint-facelets="none"
        control-panel="none"
      />
      <code className="formula-line">{parsed.alg}</code>
    </div>
  );
}

function parsePlayback(playback) {
  const raw = String(playback ?? "");
  const urlMatch = raw.match(/\[URL="([^"]+)"\]/);
  const url = urlMatch?.[1] ?? raw;

  try {
    const parsedUrl = new URL(url);
    return {
      alg: decodeAlgParam(parsedUrl.searchParams.get("alg") ?? ""),
      setup: decodeAlgParam(parsedUrl.searchParams.get("setup") ?? "")
    };
  } catch {
    return { alg: "", setup: "" };
  }
}

function decodeAlgParam(value) {
  return value.replace(/_/g, " ").replace(/-/g, "'");
}

createRoot(document.getElementById("root")).render(<App />);
