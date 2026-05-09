import React, { useEffect, useMemo, useRef } from "react";
import { ChevronDown, Eye, Play } from "lucide-react";
import { ToolFallback } from "@/components/tool-fallback";
import "cubing/twisty";

export function CubeResponseDetails({ response }) {
  return (
    <div className="response-details">
      {response.evidence?.length > 0 && (
        <ul className="response-details-block response-details-evidence">
          {response.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {response.highlights?.length > 0 && (
        <div className="mini-section response-details-block response-details-highlights">
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
        <div className="mini-section response-details-block response-details-candidates">
          {response.candidates.map((candidate) => (
            <div className="candidate" key={candidate.id}>
              <strong>{candidate.name}</strong>
              <code>{candidate.alg}</code>
            </div>
          ))}
        </div>
      )}
      {response.playback ? (
        <div className="response-details-block response-details-playback">
          <TwistyPreview playback={response.playback} title="预览" />
        </div>
      ) : null}
    </div>
  );
}

export function CubeResponseToolCall({ response, toolName = "分析结果详情" }) {
  return (
    <ToolFallback.Root defaultOpen className="cube-tool-call fade-in slide-in-from-bottom-1 animate-in duration-200">
      <ToolFallback.Trigger
        toolName={toolName}
        status={{ type: "complete", reason: "stop" }}
      />
      <ToolFallback.Content>
        <div className="px-4 pb-1">
          <CubeResponseDetails response={response} />
        </div>
      </ToolFallback.Content>
    </ToolFallback.Root>
  );
}

function LlmStatus({ response }) {
  const llm = response.llm;
  const label = formatLlmStatus(llm);

  if (!label) {
    return null;
  }

  return (
    <div className={`llm-status llm-status-${llm.status ?? "unknown"}`}>
      {label}
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
        <span className="preview-title" title={title} aria-label={title}>
          <Eye />
          <ChevronDown className="size-3.5" />
        </span>
        <button type="button" onClick={play} title="播放转动">
          <Play />
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

function formatLlmStatus(llm) {
  if (!llm) {
    return "";
  }

  if (llm.status === "running") {
    return `LLM 正在生成${llm.model ? ` · ${llm.model}` : ""}`;
  }

  if (llm.status === "complete") {
    return `LLM 已生成${llm.model ? ` · ${llm.model}` : ""}${llm.streaming ? " · streaming" : ""}`;
  }

  if (llm.status === "cancelled") {
    return "已停止生成，保留当前内容。";
  }

  if (llm.status === "fallback") {
    return `LLM 调用失败，已退回本地摘要：${llm.error?.message ?? "未知原因"}`;
  }

  return "";
}
