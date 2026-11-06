import { describe, expect, it } from "vitest";
import type { ContainerItem, ContainerState } from "../../api/engine";
import { applicable, summary, working } from "./actions";

const c = (name: string, state: ContainerState) => ({ name, state }) as ContainerItem;
const items = [c("a", "running"), c("b", "exited"), c("c", "paused"), c("d", "created"), c("e", "dead")];
const names = (xs: ContainerItem[]) => xs.map((x) => x.name);

describe("container actions", () => {
  it("applies only to containers in a suitable state", () => {
    expect(names(applicable("start", items))).toEqual(["b", "d"]);
    expect(names(applicable("stop", items))).toEqual(["a", "c"]);
    expect(names(applicable("pause", items))).toEqual(["a"]);
    expect(names(applicable("unpause", items))).toEqual(["c"]);
    expect(names(applicable("kill", items))).toEqual(["a", "c"]);
    expect(names(applicable("restart", items))).toEqual(["a", "b", "c", "d"]);
    expect(names(applicable("remove", items))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("describes progress and results", () => {
    expect(working("stop", 2)).toBe("Stopping 2 containers…");
    expect(summary("stop", 1, 0)).toBe("Stopped 1 container");
    expect(summary("unpause", 2, 1)).toBe("Resumed 2 containers; 1 failed");
    expect(summary("remove", 0, 3)).toBe("Couldn't delete 3 containers");
  });
});
