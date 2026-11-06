import { describe, expect, it } from "vitest";
import { back, closeTab, currentOf, cycleTab, forward, initTabs, navigate, openTab, type TabsState } from "./tabs";

const same = (a: string, b: string) => a === b;
const active = (s: TabsState<string>) => s.tabs.find((t) => t.id === s.active)!;

describe("tabs", () => {
  it("keeps history per tab", () => {
    let s = initTabs(["home"]);
    s = navigate(s, "a", same);
    s = navigate(s, "b", same);
    s = openTab(s, "x");
    expect(currentOf(active(s))).toBe("x");
    s = navigate(s, "y", same);
    s = cycleTab(s, 1);
    expect(currentOf(active(s))).toBe("b");
    s = back(s);
    expect(currentOf(active(s))).toBe("a");
    s = forward(s);
    expect(currentOf(active(s))).toBe("b");
    s = cycleTab(s, -1);
    expect(currentOf(active(s))).toBe("y");
  });

  it("drops forward history on a new navigation, and ignores the same place", () => {
    let s = navigate(navigate(initTabs(["home"]), "a", same), "b", same);
    s = navigate(back(s), "c", same);
    expect(active(s).stack).toEqual(["home", "a", "c"]);
    expect(navigate(s, "c", same)).toBe(s);
  });

  it("opens next to the active tab and closes to a neighbour", () => {
    let s = initTabs(["1", "2", "3"]);
    s = openTab(s, "new", false);
    expect(s.tabs.map((t) => currentOf(t))).toEqual(["1", "new", "2", "3"]);
    expect(s.active).toBe(1);
    s = closeTab(s, 1, "home");
    expect(currentOf(active(s))).toBe("new");
  });

  it("closing the last tab leaves a fresh one", () => {
    const s = closeTab(initTabs(["a"]), 1, "home");
    expect(s.tabs).toHaveLength(1);
    expect(currentOf(active(s))).toBe("home");
  });
});
