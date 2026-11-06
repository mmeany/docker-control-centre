// Connection to the engine, kept by the shell and passed to every section.
// `changes` counts change events per resource so sections can reload their
// lists when theirs moves (it also moves for every resource on reconnect).
import { useEffect, useRef, useState } from "react";
import type { AppError } from "../api/core";
import { engineApi, type EngineInfo, type EngineMessage, type EngineResource } from "../api/engine";

export type EngineStatus = "connecting" | "connected" | "disconnected" | "unavailable";

export interface EngineState {
  status: EngineStatus;
  /** Why it's disconnected or unavailable. */
  message: string;
  info: EngineInfo | null;
  changes: Record<EngineResource, number>;
}

const NO_CHANGES: Record<EngineResource, number> = { container: 0, image: 0, volume: 0, network: 0 };

/** How long to gather a burst of events (compose up) before reloading. */
const SETTLE_MS = 250;

export function useEngine(): EngineState {
  const [state, setState] = useState<EngineState>({ status: "connecting", message: "", info: null, changes: NO_CHANGES });
  const pending = useRef(new Set<EngineResource>());
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const loadInfo = () =>
      engineApi
        .info()
        .then((info) => live && setState((s) => ({ ...s, info })))
        .catch(() => {});

    function flush() {
      const touched = [...pending.current];
      pending.current.clear();
      if (!live || touched.length === 0) return;
      setState((s) => {
        const changes = { ...s.changes };
        for (const r of touched) changes[r] += 1;
        return { ...s, changes };
      });
      if (touched.includes("container") || touched.includes("image")) void loadInfo();
    }

    function onMessage(m: EngineMessage) {
      if (!live) return;
      if (m.type === "connected") {
        setState((s) => ({
          ...s,
          status: "connected",
          message: "",
          // Anything may have changed while we were away.
          changes: Object.fromEntries(Object.entries(s.changes).map(([k, v]) => [k, v + 1])) as Record<EngineResource, number>,
        }));
        void loadInfo();
      } else if (m.type === "disconnected") {
        setState((s) => ({ ...s, status: "disconnected", message: m.message }));
      } else {
        pending.current.add(m.resource);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, SETTLE_MS);
      }
    }

    engineApi.watch(onMessage).catch((e: AppError) => live && setState((s) => ({ ...s, status: "unavailable", message: e.message })));
    return () => {
      live = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  return state;
}
