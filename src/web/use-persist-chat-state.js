import { useCallback, useEffect, useRef } from "react";
import { saveChatState } from "./chat-storage.js";

export function usePersistChatState(chatState, { delay = 500 } = {}) {
  const timerRef = useRef(null);
  const pendingImmediateFlushRef = useRef(false);
  const stateRef = useRef(chatState);

  stateRef.current = chatState;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    pendingImmediateFlushRef.current = false;
    clearTimer();
    saveChatState(stateRef.current);
  }, [clearTimer]);

  const requestFlush = useCallback(() => {
    pendingImmediateFlushRef.current = true;
    setTimeout(() => {
      if (pendingImmediateFlushRef.current) {
        flush();
      }
    }, 0);
  }, [flush]);

  useEffect(() => {
    clearTimer();
    if (pendingImmediateFlushRef.current) {
      flush();
      return clearTimer;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveChatState(stateRef.current);
    }, delay);

    return clearTimer;
  }, [chatState, delay, clearTimer]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flush]);

  return requestFlush;
}
