import { describe, expect, it } from "vitest";
import { HOME, parentPlace, parseAddress, placeUri } from "./places";

describe("addresses", () => {
  it("formats and parses the same address", () => {
    for (const p of [HOME, { section: "containers", path: "" }, { section: "containers", path: "@shop/web-1/logs" }]) {
      expect(parseAddress(placeUri(p))).toEqual(p);
    }
  });

  it("accepts loose input", () => {
    expect(parseAddress("")).toEqual(HOME);
    expect(parseAddress("Containers")).toEqual({ section: "containers", path: "" });
    expect(parseAddress(" containers/@shop ")).toEqual({ section: "containers", path: "@shop" });
    expect(parseAddress("\\containers\\web-1")).toEqual({ section: "containers", path: "web-1" });
  });

  it("rejects addresses that lead nowhere", () => {
    expect(parseAddress("/nope")).toBeNull();
    expect(parseAddress("/containers/web-1/nope")).toBeNull();
  });

  it("goes up through the section to Home", () => {
    expect(parentPlace({ section: "containers", path: "@shop" })).toEqual({ section: "containers", path: "" });
    expect(parentPlace({ section: "containers", path: "" })).toEqual(HOME);
    expect(parentPlace(HOME)).toBeNull();
  });
});
