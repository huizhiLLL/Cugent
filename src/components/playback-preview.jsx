import React, { useEffect, useMemo, useRef } from "react";
import { ChevronDown, Eye, Play } from "lucide-react";

export function TwistyPreview({ playback, alg, setup = "", title = "预览", compact = false }) {
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

  if (compact) {
    return (
      <span className="twisty-preview-inline">
        <span className="twisty-preview-inline-toolbar" title={title} aria-label={title}>
          <Eye />
          <button type="button" onClick={play} title="播放转动">
            <Play />
          </button>
        </span>
        <twisty-player
          ref={playerRef}
          puzzle="3x3x3"
          background="none"
          hint-facelets="none"
          control-panel="none"
        />
        <code className="formula-line">{parsed.alg}</code>
      </span>
    );
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

export function parsePlayback(playback) {
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
