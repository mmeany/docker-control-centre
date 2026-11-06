import { useCallback, useState } from "react";

/** Explorer-style history with back/forward over any kind of place. */
export function useHistory<T>(root: T, same: (a: T, b: T) => boolean) {
  const [state, setState] = useState({ stack: [root], index: 0 });
  const current = state.stack[state.index];

  const navigate = useCallback(
    (p: T) => {
      setState((s) => {
        if (same(s.stack[s.index], p)) return s;
        const stack = [...s.stack.slice(0, s.index + 1), p];
        return { stack, index: stack.length - 1 };
      });
    },
    [same],
  );

  const back = useCallback(() => setState((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s)), []);
  const forward = useCallback(
    () => setState((s) => (s.index < s.stack.length - 1 ? { ...s, index: s.index + 1 } : s)),
    [],
  );
  /** Clears history, starting again at `start` (default: the root). */
  const reset = useCallback((start?: T) => setState({ stack: [start ?? root], index: 0 }), [root]);

  return {
    current,
    navigate,
    back,
    forward,
    reset,
    canBack: state.index > 0,
    canForward: state.index < state.stack.length - 1,
  };
}
