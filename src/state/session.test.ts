import { describe, expect, it } from "vitest";
import { MAX_VIEWS, readSession, readViews, withView } from "./session";

describe("session", () => {
  it("restores tabs from addresses", () => {
    expect(readSession({ tabs: ["/", "/containers/@shop"], active: 1 })).toEqual({
      places: [
        { section: null, path: "" },
        { section: "containers", path: "@shop" },
      ],
      active: 1,
    });
  });

  it("drops addresses that no longer lead anywhere and keeps the active tab", () => {
    const r = readSession({ tabs: ["/gone", "/containers", "/also-gone", "/containers/web-1"], active: 3 });
    expect(r?.places.map((p) => p.path)).toEqual(["", "web-1"]);
    expect(r?.active).toBe(1);
  });

  it("ignores junk", () => {
    expect(readSession(null)).toBeNull();
    expect(readSession({ tabs: "x" })).toBeNull();
    expect(readSession({ tabs: ["/nope"] })).toBeNull();
    expect(readViews({ "/a": "tiles", "/b": "huge", "/c": 3 })).toEqual({ "/a": "tiles" });
  });

  it("keeps the most recent views and doesn't store the default", () => {
    let v = withView({}, "/a", "tiles");
    v = withView(v, "/b", "list");
    v = withView(v, "/a", "list");
    expect(Object.keys(v)).toEqual(["/b", "/a"]);
    expect(withView(v, "/a", "details")).toEqual({ "/b": "list" });
    for (let i = 0; i < MAX_VIEWS + 5; i++) v = withView(v, `/p${i}`, "tiles");
    expect(Object.keys(v)).toHaveLength(MAX_VIEWS);
    expect(v["/b"]).toBeUndefined();
  });
});
