import React, { useEffect, useMemo, useRef } from "react";
import { Play } from "lucide-react";
import "cubing/twisty";

export function CubeResponseDetails({ response }) {
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
