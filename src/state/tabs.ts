// Explorer-style tabs, each with its own back / forward history. The state
// changes are plain functions (unit-tested in tabs.test.ts); useTabs wraps
// them for React.
import { useCallback, useMemo, useState } from "react";

export interface Tab<T> {
  id: number;
  stack: T[];
  index: number;
}

export interface TabsState<T> {
  tabs: Tab<T>[];
  active: number;
  nextId: number;
}

type Same<T> = (a: T, b: T) => boolean;

export function initTabs<T>(start: T[]): TabsState<T> {
  const tabs = start.map((p, i) => ({ id: i + 1, stack: [p], index: 0 }));
  return { tabs, active: tabs[0].id, nextId: tabs.length + 1 };
}

export const currentOf = <T>(t: Tab<T>): T => t.stack[t.index];

function updateActive<T>(s: TabsState<T>, f: (t: Tab<T>) => Tab<T>): TabsState<T> {
  return { ...s, tabs: s.tabs.map((t) => (t.id === s.active ? f(t) : t)) };
}

/** Unchanged state (no re-render) when `p` is already the active tab's place. */
export function navigate<T>(s: TabsState<T>, p: T, same: Same<T>): TabsState<T> {
  const tab = s.tabs.find((t) => t.id === s.active)!;
  if (same(currentOf(tab), p)) return s;
  return updateActive(s, (t) => {
    const stack = [...t.stack.slice(0, t.index + 1), p];
    return { ...t, stack, index: stack.length - 1 };
  });
}

export const back = <T>(s: TabsState<T>) => updateActive(s, (t) => (t.index > 0 ? { ...t, index: t.index - 1 } : t));

export const forward = <T>(s: TabsState<T>) =>
  updateActive(s, (t) => (t.index < t.stack.length - 1 ? { ...t, index: t.index + 1 } : t));

/** Opens `p` in a new tab after the active one; `activate` switches to it. */
export function openTab<T>(s: TabsState<T>, p: T, activate = true): TabsState<T> {
  const tab = { id: s.nextId, stack: [p], index: 0 };
  const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  return { tabs, active: activate ? tab.id : s.active, nextId: s.nextId + 1 };
}

/** Closes a tab; closing the last one leaves a fresh tab at `root`. */
export function closeTab<T>(s: TabsState<T>, id: number, root: T): TabsState<T> {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s;
  if (s.tabs.length === 1) return { tabs: [{ id: s.nextId, stack: [root], index: 0 }], active: s.nextId, nextId: s.nextId + 1 };
  const tabs = s.tabs.filter((t) => t.id !== id);
  const active = s.active === id ? tabs[Math.min(i, tabs.length - 1)].id : s.active;
  return { ...s, tabs, active };
}

export const selectTab = <T>(s: TabsState<T>, id: number) => (s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s);

/** Ctrl+Tab / Ctrl+Shift+Tab: next or previous tab, wrapping. */
export function cycleTab<T>(s: TabsState<T>, step: 1 | -1): TabsState<T> {
  const i = s.tabs.findIndex((t) => t.id === s.active);
  const n = s.tabs.length;
  return { ...s, active: s.tabs[(i + step + n) % n].id };
}

export function useTabs<T>(root: T, same: Same<T>) {
  const [state, setState] = useState(() => initTabs([root]));
  const activeTab = state.tabs.find((t) => t.id === state.active)!;

  const actions = useMemo(
    () => ({
      navigate: (p: T) => setState((s) => navigate(s, p, same)),
      back: () => setState(back),
      forward: () => setState(forward),
      openTab: (p: T, activate = true) => setState((s) => openTab(s, p, activate)),
      closeTab: (id: number) => setState((s) => closeTab(s, id, root)),
      selectTab: (id: number) => setState((s) => selectTab(s, id)),
      cycleTab: (step: 1 | -1) => setState((s) => cycleTab(s, step)),
      /** Replaces every tab (session restore); `active` is an index. */
      restore: (places: T[], active: number) =>
        setState(() => {
          const s = initTabs(places.length ? places : [root]);
          return { ...s, active: s.tabs[Math.min(Math.max(active, 0), s.tabs.length - 1)].id };
        }),
    }),
    [root, same],
  );
  const closeActive = useCallback(() => actions.closeTab(state.active), [actions, state.active]);

  return {
    tabs: state.tabs,
    active: state.active,
    current: currentOf(activeTab),
    canBack: activeTab.index > 0,
    canForward: activeTab.index < activeTab.stack.length - 1,
    closeActive,
    ...actions,
  };
}
