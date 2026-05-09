import React from "react";
import { ToolFallback } from "@/components/tool-fallback";
import { TwistyPreview } from "@/components/playback-preview";
import "cubing/twisty";

export function CubeResponseDetails({ response, toolCalls = [] }) {
  return (
    <div className="response-details">
      {toolCalls.length > 0 ? (
        <div className="mini-section response-details-block response-details-tool-calls">
          {toolCalls.map((toolCall, index) => (
            <div className="highlight" key={`${toolCall.name}-${index}`}>
              <strong>{`${index + 1}. ${toolCall.name}`}</strong>
              <span>{formatToolCallStatus(toolCall.status)}</span>
              <div className="tool-call-summary">
                {formatToolCallSummary(toolCall).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <details className="tool-call-raw">
                <summary>查看参数与原始结果</summary>
                <pre className="tool-call-json">{JSON.stringify(toolCall.args ?? {}, null, 2)}</pre>
                {toolCall.result ? (
                  <pre className="tool-call-json">{JSON.stringify(toolCall.result, null, 2)}</pre>
                ) : null}
              </details>
            </div>
          ))}
        </div>
      ) : null}
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

export function CubeResponseToolCall({ response, toolCalls = [], status, toolName = "分析结果详情" }) {
  return (
    <ToolFallback.Root defaultOpen className="cube-tool-call fade-in slide-in-from-bottom-1 animate-in duration-200">
      <ToolFallback.Trigger
        toolName={toolName}
        status={status ?? { type: "complete", reason: "stop" }}
      />
      <ToolFallback.Content>
        <div className="px-4 pb-1">
          <CubeResponseDetails response={response ?? { evidence: [], highlights: [], nextActions: [] }} toolCalls={toolCalls} />
        </div>
      </ToolFallback.Content>
    </ToolFallback.Root>
  );
}

function formatToolCallStatus(status) {
  switch (status) {
    case "error":
      return "error";
    case "running":
      return "running";
    case "completed":
    default:
      return "completed";
  }
}

function formatToolCallSummary(toolCall) {
  const args = toolCall.args ?? {};
  const result = toolCall.result ?? {};

  if (toolCall.name === "create_solve_review") {
    return [
      `scramble：${truncateValue(args.scramble ?? "")}`,
      `timedMoves 长度：${args.timedMovesLength ?? String(args.timedMoves ?? "").length ?? 0}`,
      result.summary ? `结果：${result.summary.totalMoves} 步，${result.summary.totalDurationMs}ms，TPS ${result.summary.totalTps}` : "结果：已生成 solve review"
    ];
  }

  if (toolCall.name === "inspect_solve_segment") {
    return [
      `目标分段：${args.segmentLabel ?? args.segmentId ?? "未指定"}`,
      result.segment?.label ? `命中分段：${result.segment.label}` : "结果：已读取局部分段",
      result.stage?.goal?.evidence ? `阶段目标：${result.stage.goal.evidence}` : "阶段目标：无"
    ];
  }

  if (toolCall.name === "search_algorithms") {
    return [
      `查询：${[args.set, args.caseId].filter(Boolean).join(" / ") || "未指定"}`,
      `tags：${Array.isArray(args.tags) && args.tags.length ? args.tags.join(", ") : "无"}`,
      typeof result.total === "number" ? `命中 ${result.total} 条候选` : "结果：已完成公式检索"
    ];
  }

  if (toolCall.name === "build_playback_link") {
    return [
      `alg：${truncateValue(args.alg ?? "")}`,
      args.setup ? `setup：${truncateValue(args.setup)}` : "setup：无",
      result.playback?.bbcode ? "结果：已生成播放链接" : "结果：无"
    ];
  }

  return [
    `参数：${Object.keys(args).length ? Object.keys(args).join(", ") : "无"}`,
    result.type ? `结果类型：${result.type}` : "结果：已完成"
  ];
}

function truncateValue(value, maxLength = 80) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text || "无";
  }
  return `${text.slice(0, maxLength)}…`;
}
