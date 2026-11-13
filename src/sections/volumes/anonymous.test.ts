import { describe, expect, it } from "vitest";
import type { ContainerItem } from "../../api/engine";
import type { VolumeItem } from "../../api/resources";
import { mountedAt, volumeLabel } from "./anonymous";

const hash = "ab".repeat(32);
const c = (name: string, mounts: [string, string][]) => ({ name, volumeMounts: mounts.map(([n, destination]) => ({ name: n, destination })) }) as unknown as ContainerItem;
const vol = (name: string, anonymous: boolean) => ({ name, anonymous }) as VolumeItem;

describe("anonymous volume labels", () => {
  const containers = [c("shop-db-2", [[hash, "/var/lib/postgresql/data"]]), c("shop-db-1", [[hash, "/var/lib/postgresql/data"], ["shop_logs", "/logs"]])];

  it("names an anonymous volume by who mounts it", () => {
    expect(mountedAt(containers, hash)).toEqual(["shop-db-1:/var/lib/postgresql/data", "shop-db-2:/var/lib/postgresql/data"]);
    expect(volumeLabel(vol(hash, true), containers)).toBe("shop-db-1:/var/lib/postgresql/data + 1 (anonymous)");
    expect(volumeLabel(vol(hash, true), containers.slice(0, 1))).toBe("shop-db-2:/var/lib/postgresql/data (anonymous)");
  });

  it("falls back to the start of the hash, and leaves named volumes alone", () => {
    expect(volumeLabel(vol(hash, true), [])).toBe(`${hash.slice(0, 12)}… (anonymous)`);
    expect(volumeLabel(vol("shop_logs", false), containers)).toBe("shop_logs");
  });
});
