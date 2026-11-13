import { beforeEach, describe, expect, it, vi } from "vitest";

const setValue = vi.fn(async (key: string, value: unknown) => ({ theme: "system", filterHistory: {}, values: { last: [key, value] } }));
vi.mock("../api/app", () => ({ appApi: { setValue: (k: string, v: unknown) => setValue(k, v) } }));

const { anyColumnLayouts, resetAllColumnLayouts, seedColumnLayouts } = await import("./columns");

describe("anyColumnLayouts / resetAllColumnLayouts", () => {
  beforeEach(() => {
    setValue.mockClear();
    seedColumnLayouts({});
  });

  it("sees saved layouts and ones loaded into this window", () => {
    expect(anyColumnLayouts({ other: 1 })).toBe(false);
    expect(anyColumnLayouts({ "columns.images": { widths: { name: 300 } } })).toBe(true);
    seedColumnLayouts({ "columns.files": { hidden: ["mode"] } });
    expect(anyColumnLayouts({})).toBe(true);
  });

  it("removes every columns value, saved by this window or another, and nothing else", async () => {
    seedColumnLayouts({ "columns.images": { widths: { name: 300 } }, "app.layout": "explorer" });
    const s = await resetAllColumnLayouts({ "columns.table.env": { widths: { name: 90 } }, "app.layout": "explorer" });
    expect(setValue.mock.calls.map(([k, v]) => [k, v]).sort()).toEqual([
      ["columns.images", null],
      ["columns.table.env", null],
    ]);
    expect(s).not.toBeNull();
    expect(anyColumnLayouts({})).toBe(false);
  });

  it("does nothing when nothing changed", async () => {
    expect(await resetAllColumnLayouts({})).toBeNull();
    expect(setValue).not.toHaveBeenCalled();
  });
});
