// A list from the engine (containers, images, …) that loads once connected
// and reloads when its resource changes, on reconnect, or on refresh().
import { useCallback, useEffect, useState } from "react";
import type { AppError } from "../api/core";
import type { EngineState } from "./engine";

export interface EngineList<T> {
  /** null until the first load. */
  items: T[] | null;
  error: AppError | null;
  loading: boolean;
  refresh: () => void;
}

export function useEngineList<T>(engine: EngineState, changes: number, fetch: () => Promise<T[]>): EngineList<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);
  const connected = engine.status === "connected";

  useEffect(() => {
    if (!connected) return;
    let stale = false;
    setLoading(true);
    fetch()
      .then((list) => {
        if (stale) return;
        setItems(list);
        setError(null);
      })
      .catch((e) => !stale && setError(e as AppError))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
    // `fetch` is a stable api function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, changes, token]);

  const refresh = useCallback(() => setToken((t) => t + 1), []);
  return { items, error, loading, refresh };
}
