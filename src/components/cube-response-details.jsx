import React, { useEffect, useState } from "react";
import { ToolFallback } from "@/components/tool-fallback";
import { TwistyPreview } from "@/components/playback-preview";
import "cubing/twisty";

export function CubeResponseDetails({ response, toolCalls = [] }) {
  return (
    <div className="response-details">
      {toolCalls.length > 0 ? (
        <div className="response-details-block response-details-tool-calls">
          <div className="tool-timeline">
          {toolCalls.map((toolCall, index) => (
            <div className="tool-timeline-item" key={`${toolCall.name}-${index}`}>
              <div className="tool-timeline-marker" aria-hidden="true" />
              <div className="tool-timeline-card">
              <div className="tool-call-head">
                <strong>{formatToolCallName(toolCall.name)}</strong>
                <span>{formatToolCallStatus(toolCall.status)}</span>
              </div>
              <div className="tool-call-summary">
                {formatToolCallSummary(toolCall).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
            </div>
          ))}
          </div>
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
              {item.recommendedAlgorithms?.map((candidate) => <code key={candidate.id}>{candidate.alg}</code>)}
            </div>
          ))}
        </div>
      )}
      {response.recommendedAlgorithms?.length > 0 && (
        <div className="mini-section response-details-block response-details-candidates">
          {response.recommendedAlgorithms.map((candidate) => (
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
  const isRunning = status?.type === "running";
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }

    setOpen(false);
  }, [isRunning]);

  return (
    <ToolFallback.Root
      open={open}
      onOpenChange={setOpen}
      className="cube-tool-call fade-in slide-in-from-bottom-1 animate-in duration-200"
    >
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
      return "调用失败";
    case "running":
      return "进行中";
    case "completed":
    default:
      return "已完成";
  }
}

function formatToolCallName(name) {
  switch (name) {
    case "create_solve_review":
      return "复盘分析";
    case "inspect_solve_segment":
      return "分段查看";
    case "search_algorithms":
      return "公式检索";
    case "build_playback_link":
      return "动画链接";
    default:
      return name;
  }
}

function formatToolCallSummary(toolCall) {
  const args = toolCall.args ?? {};
  const result = toolCall.result ?? {};

  if (toolCall.name === "create_solve_review") {
    if (toolCall.result?.phase && toolCall.status === "running") {
      return [toolCall.result.text ?? "正在处理复盘。"];
    }
    if (result.stage) {
      return [
        result.stage === "parse-review" ? "正在解析回顾。" : "",
        result.stage === "trace-state" ? "正在追踪魔方状态。" : "",
        result.stage === "infer-segmentation" ? "正在推断分段。" : "",
        result.stage === "build-stages" ? "正在整理阶段结果。" : ""
      ].filter(Boolean);
    }
    return [
      `打乱：${truncateValue(args.scramble ?? "")}`,
      `回顾长度：${args.timedMovesLength ?? String(args.timedMoves ?? "").length ?? 0}`,
      result.summary ? `已完成：${result.summary.totalMoves} 步，${result.summary.totalDurationMs}ms，TPS ${result.summary.totalTps}` : "已生成复盘结果"
    ];
  }

  if (toolCall.name === "inspect_solve_segment") {
    return [
      `想看：${args.segmentLabel ?? args.segmentId ?? "未指定"}`,
      result.segment?.label ? `命中：${result.segment.label}` : "已读取分段信息",
      result.stage?.goal?.evidence ? `阶段判断：${result.stage.goal.evidence}` : "阶段判断：无"
    ];
  }

  if (toolCall.name === "search_algorithms") {
    return [
      `查询：${[args.set, args.caseId].filter(Boolean).join(" / ") || "未指定"}`,
      `偏好：${Array.isArray(args.tags) && args.tags.length ? args.tags.join("，") : "无"}`,
      typeof result.total === "number" ? `找到 ${result.total} 条推荐公式` : "已完成公式检索"
    ];
  }

  if (toolCall.name === "build_playback_link") {
    return [
      `公式：${truncateValue(args.alg ?? "")}`,
      args.setup ? `起手：${truncateValue(args.setup)}` : "起手：无",
      result.playback?.bbcode ? "已生成播放链接" : "暂无链接"
    ];
  }

  return [
    `参数：${Object.keys(args).length ? Object.keys(args).join("，") : "无"}`,
    result.type ? `结果：${result.type}` : "已完成"
  ];
}

function truncateValue(value, maxLength = 80) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text || "无";
  }
  return `${text.slice(0, maxLength)}…`;
}
