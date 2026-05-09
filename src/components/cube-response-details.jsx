import React from "react";
import { ToolFallback } from "@/components/tool-fallback";
import { TwistyPreview } from "@/components/playback-preview";
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
