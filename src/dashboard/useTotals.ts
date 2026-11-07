// The engine-wide totals stream for the overview: runs while the overview is
// mounted and the engine is connected (so it restarts after a reconnect),
// keeping five minutes of history in memory only.
import { useEffect, useState } from "react";
import type { AppError } from "../api/core";
import { streamsApi, type TotalsSnapshot } from "../api/streams";
import type { EngineState } from "../state/engine";
import { pointOf, pushPoint, type TotalsPoint } from "./overviewData";

export interface Totals {
  latest: TotalsSnapshot | null;
  history: TotalsPoint[];
  /** Why there are no figures (the stream couldn't start or ended). */
  error: string | null;
}

export function useTotals(engine: EngineState): Totals {
  const [latest, setLatest] = useState<TotalsSnapshot | null>(null);
  const [history, setHistory] = useState<TotalsPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connected = engine.status === "connected";

  useEffect(() => {
    if (!connected) return;
    let live = true;
    let stream: number | null = null;
    setError(null);
    streamsApi
      .statsTotals((m) => {
        if (!live) return;
        if (m.type === "totals") {
          const { type: _type, ...snapshot } = m;
          setLatest(snapshot);
          setHistory((h) => pushPoint(h, pointOf(snapshot)));
        } else {
          setError(m.error ?? "The figures stopped.");
        }
      })
      .then((id) => {
        if (live) stream = id;
        else void streamsApi.stop(id).catch(() => {});
      })
      .catch((e) => live && setError((e as AppError).message));
    return () => {
      live = false;
      if (stream !== null) void streamsApi.stop(stream).catch(() => {});
    };
  }, [connected]);

  return { latest: connected ? latest : null, history, error: connected ? error : "Not connected to the engine." };
}
