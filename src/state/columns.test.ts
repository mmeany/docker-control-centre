import { describe, expect, it } from "vitest";
import { MAX_COL_W, MIN_COL_W, clampWidth, columnWidths, gridTemplate, readColumnLayout, storedColumnLayout } from "./columns";

describe("clampWidth", () => {
  it("keeps widths between the limits, in whole pixels", () => {
    expect(clampWidth(10)).toBe(MIN_COL_W);
    expect(clampWidth(99999)).toBe(MAX_COL_W);
    expect(clampWidth(123.6)).toBe(124);
  });
});

describe("readColumnLayout", () => {
  it("reads stored widths and clamps them", () => {
    expect(readColumnLayout({ widths: { name: 300, size: 5, big: 5000 } })).toEqual({ widths: { name: 300, size: MIN_COL_W, big: MAX_COL_W } });
  });

  it("drops anything that isn't a width", () => {
    expect(readColumnLayout({ widths: { name: "300", state: null, n: Number.NaN, ok: 90 } })).toEqual({ widths: { ok: 90 } });
  });

  it("treats a missing or malformed value as no changes", () => {
    for (const v of [undefined, null, 3, "x", [], { widths: [] }, { widths: 4 }, {}]) expect(readColumnLayout(v)).toEqual({ widths: {} });
  });
});

describe("storedColumnLayout", () => {
  it("keeps only the list's current columns", () => {
    expect(storedColumnLayout({ widths: { name: 300, gone: 90 } }, ["name", "size"])).toEqual({ widths: { name: 300 } });
  });

  it("is null when nothing is left, so the value is removed", () => {
    expect(storedColumnLayout({ widths: {} }, ["name"])).toBeNull();
    expect(storedColumnLayout({ widths: { gone: 90 } }, ["name"])).toBeNull();
  });
});

describe("columnWidths / gridTemplate", () => {
  const cols = [
    { id: "name", width: 200 },
    { id: "size", width: 90 },
    { id: "created", width: 150 },
  ];

  it("uses the stored width, else the default", () => {
    expect(columnWidths(cols, { widths: { size: 120, other: 50 } })).toEqual([200, 120, 150]);
  });

  it("fixes every column but the last, which fills the rest", () => {
    expect(gridTemplate([200, 120, 150])).toBe("200px 120px minmax(150px, 1fr)");
    expect(gridTemplate([200])).toBe("minmax(200px, 1fr)");
  });
});
