import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/Markdown";
import { CHILDREN } from "../sections/containers/paths";
import type { Layout } from "../shell/layout";
import { HOME, type Place } from "../shell/places";
import { generalTopic, HELP_TOPICS, placeTopic, type HelpTopicId } from "./index";

const LAYOUTS: Layout[] = ["explorer", "dashboard"];
const at = (section: string, path = ""): Place => ({ section, path });

/** Every kind of place each section can produce. */
const PLACES: Place[] = [
  HOME,
  at("containers"),
  at("containers", "@shop"),
  at("containers", "@shop/shop-web-1"),
  at("containers", "solo"),
  ...CHILDREN.map((c) => at("containers", `@shop/shop-web-1/${c.id}`)),
  at("containers", "solo/files/etc/nginx"),
  at("compose"),
  at("compose", "shop"),
  at("compose", "shop/logs"),
  at("compose", "shop/file"),
  at("images"),
  at("images", "0123456789ab"),
  at("volumes"),
  at("volumes", "shop_data"),
  at("networks"),
  at("networks", "shop_default"),
];

/** Topics that belong to dialogs, not places. */
const DIALOG_TOPICS: HelpTopicId[] = ["settings", "compose.run", "compose.drop", "images.pull"];

describe("placeTopic", () => {
  it("gives every place a topic in both layouts", () => {
    for (const layout of LAYOUTS) for (const p of PLACES) expect(HELP_TOPICS[placeTopic(p, layout)], `${p.section}/${p.path}`).toBeDefined();
  });

  it("splits list levels by layout and shares the rest", () => {
    const split = (p: Place) => placeTopic(p, "explorer") !== placeTopic(p, "dashboard");
    expect(split(HOME)).toBe(true);
    for (const s of ["containers", "compose", "images", "volumes", "networks"]) expect(split(at(s)), s).toBe(true);
    expect(split(at("containers", "@shop"))).toBe(true);
    expect(split(at("containers", "@shop/shop-web-1/logs"))).toBe(false);
    expect(split(at("compose", "shop/file"))).toBe(false);
    expect(split(at("images", "0123456789ab"))).toBe(false);
  });

  it("maps container children to their views", () => {
    const t = (child: string) => placeTopic(at("containers", `web-1/${child}`), "explorer");
    expect(t("logs")).toBe("containers.logs");
    expect(t("terminal")).toBe("containers.terminal");
    expect(t("stats")).toBe("containers.stats");
    expect(t("files")).toBe("containers.files");
    for (const c of ["env", "mounts", "ports", "networks", "labels"]) expect(t(c)).toBe("containers.details");
    expect(placeTopic(at("containers", "web-1/files/etc"), "dashboard")).toBe("containers.files");
  });

  it("falls back to the section list for a path it can't read", () => {
    expect(placeTopic(at("containers", "!bad"), "explorer")).toBe("containers.list.explorer");
  });
});

describe("help topics", () => {
  it("are all reachable: from a place, a dialog, general help or while disconnected", () => {
    const reachable = new Set<string>([
      ...LAYOUTS.flatMap((l) => PLACES.map((p) => placeTopic(p, l))),
      ...LAYOUTS.map(generalTopic),
      ...DIALOG_TOPICS,
      "connecting",
    ]);
    expect(Object.keys(HELP_TOPICS).filter((id) => !reachable.has(id))).toEqual([]);
  });

  it("are plain text that renders cleanly", () => {
    for (const [id, t] of Object.entries(HELP_TOPICS)) {
      expect(t.title.trim(), id).not.toBe("");
      expect(t.body.trim(), id).not.toBe("");
      expect(`${t.title} ${t.body}`, id).not.toContain("!");
      // Unbalanced markers would show up as text.
      const text = renderToStaticMarkup(createElement(Markdown, { text: t.body })).replace(/<code>[^<]*<\/code>/g, "");
      expect(text, id).not.toMatch(/\*\*|`/);
    }
  });
});

describe("Markdown", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

  it("renders headings, paragraphs and inline marks", () => {
    expect(html("### Title\n\nSome **bold**, *italic* and `code`.\nSame paragraph.")).toBe(
      '<div class="md"><h3>Title</h3><p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>. Same paragraph.</p></div>',
    );
  });

  it("keeps snake_case and escaped characters literal", () => {
    expect(html("a_b_c and \\*not italic\\*")).toBe('<div class="md"><p>a_b_c and *not italic*</p></div>');
  });

  it("renders lists, nested and ordered", () => {
    expect(html("- one\n- two\n  - deeper\n\n1. first\n2. second")).toBe(
      '<div class="md"><ul><li><span>one</span></li><li><span>two</span><ul><li><span>deeper</span></li></ul></li></ul><ol><li><span>first</span></li><li><span>second</span></li></ol></div>',
    );
  });

  it("renders tables and fenced code", () => {
    expect(html("| Keys | Action |\n|---|---|\n| F1 | Help |\n\n```\nline <1>\n```")).toBe(
      '<div class="md"><table class="md-table"><thead><tr><th>Keys</th><th>Action</th></tr></thead><tbody><tr><td>F1</td><td>Help</td></tr></tbody></table><pre class="md-code"><code>line &lt;1&gt;</code></pre></div>',
    );
  });

  it("shows HTML and links as text", () => {
    expect(html('<script>alert(1)</script> [a](http://x)')).toBe('<div class="md"><p>&lt;script&gt;alert(1)&lt;/script&gt; [a](http://x)</p></div>');
  });
});
