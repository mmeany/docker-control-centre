import { describe, expect, it } from "vitest";
import { readLayout } from "./layout";

describe("readLayout", () => {
  it("reads the dashboard and defaults everything else to Explorer", () => {
    expect(readLayout("dashboard")).toBe("dashboard");
    expect(readLayout("explorer")).toBe("explorer");
    expect(readLayout(undefined)).toBe("explorer");
    expect(readLayout("tiles")).toBe("explorer");
    expect(readLayout(1)).toBe("explorer");
  });
});
