import { describe, expect, it } from "vitest";
import type { ContainerItem } from "../../api/engine";
import { colourOf, fileName, parentDir, pinnedLabel, yamlTokens, projectsFrom, projectState, targetOf, windowsPath } from "./projects";

const c = (name: string, project: string | null, state = "running", extra: Partial<ContainerItem> = {}) =>
  ({ name, project, state, workingDir: project ? `/home/mark/${project}` : null, configFiles: project ? [`/home/mark/${project}/compose.yml`] : [], ...extra }) as ContainerItem;

describe("compose projects", () => {
  it("merges running projects with pinned files", () => {
    const ps = projectsFrom(
      [c("shop-web-1", "shop"), c("shop-db-1", "shop", "exited"), c("solo", null)],
      [
        { name: "shop", files: ["E:\\shop\\compose.yml"] },
        { name: "blog", files: ["E:\\blog\\compose.yml", "E:\\blog\\compose.override.yml"] },
      ],
    );
    expect(ps.map((p) => [p.name, projectState(p)])).toEqual([
      ["blog", "Down"],
      ["shop", "1 of 2 running"],
    ]);
    // Pinned wins for where to run; labels give it otherwise.
    expect(targetOf(ps[1])).toEqual({ name: "shop", dir: "E:\\shop", files: ["E:\\shop\\compose.yml"] });
    expect(targetOf({ ...ps[1], pinned: null })).toEqual({ name: "shop", dir: "/home/mark/shop", files: ["/home/mark/shop/compose.yml"] });
    expect(targetOf(ps[0])).toEqual({ name: "blog", dir: "E:\\blog", files: ["E:\\blog\\compose.yml", "E:\\blog\\compose.override.yml"] });
    expect(pinnedLabel(ps[0].pinned!)).toBe("E:\\blog\\compose.yml (+1 more)");
    expect(pinnedLabel(ps[1].pinned!)).toBe("E:\\shop\\compose.yml");
  });

  it("describes state", () => {
    const [p] = projectsFrom([c("a", "x", "exited"), c("b", "x", "exited")], []);
    expect(projectState(p)).toBe("Stopped");
  });

  it("shows engine paths as Windows paths", () => {
    expect(windowsPath("/mnt/e/claude/shop", "Ubuntu-Dev")).toBe("E:\\claude\\shop");
    expect(windowsPath("/home/mark/app", "Ubuntu-Dev")).toBe("\\\\wsl.localhost\\Ubuntu-Dev\\home\\mark\\app");
    expect(windowsPath("C:\\x", "Ubuntu-Dev")).toBe("C:\\x");
    expect(parentDir("/compose.yml")).toBe("/");
  });

  it("names files", () => {
    expect(fileName("/home/mark/shop/compose.yml")).toBe("compose.yml");
    expect(fileName("E:\\shop\\compose.override.yml")).toBe("compose.override.yml");
  });

  it("picks out YAML keys and comments", () => {
    const kinds = (l: string) => yamlTokens(l).map((t) => `${t.kind}:${t.text}`);
    expect(kinds("services:")).toEqual(["key:services", "text::"]);
    expect(kinds("    image: nginx:1.27 # pinned")).toEqual(["text:    ", "key:image", "text:: nginx:1.27 ", "comment:# pinned"]);
    expect(kinds("  - PORT=8080")).toEqual(["text:  - PORT=8080"]);
    expect(kinds("  - name: web")).toEqual(["text:  - ", "key:name", "text:: web"]);
    expect(kinds('    command: "echo #not a comment"')).toEqual(["text:    ", "key:command", 'text:: "echo #not a comment"']);
    expect(kinds("# top")).toEqual(["comment:# top"]);
    expect(kinds("  url: http://x/#frag")).toEqual(["text:  ", "key:url", "text:: http://x/#frag"]);
    expect(kinds("")).toEqual([]);
  });

  it("gives each service a stable colour", () => {
    expect(colourOf("web")).toBe(colourOf("web"));
    expect(colourOf("web")).toBeGreaterThanOrEqual(0);
    expect(colourOf("web")).toBeLessThan(8);
  });
});
