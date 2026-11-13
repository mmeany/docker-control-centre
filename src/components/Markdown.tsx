// A small Markdown subset rendered straight to React elements, for the help
// topics: headings, paragraphs, lists (nested), tables, inline and fenced
// code, bold and italic. No links, images or HTML; anything else is shown as
// text. No HTML strings and no dangerouslySetInnerHTML.
// Ported from AWS Explorer's viewers/markdown.tsx and trimmed.
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Inline

const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>\"'";

export function renderInline(src: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let text = "";
  let k = 0;
  const key = () => `${keyBase}-${k++}`;
  const flush = () => {
    if (text) out.push(text);
    text = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      // A soft break is a space.
      text = text.replace(/ +$/, "") + " ";
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        let code = src.slice(i + run.length, end).replace(/\n/g, " ");
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        out.push(<code key={key()}>{code}</code>);
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if (ch === "*" || ch === "_") {
      // Intraword underscores (snake_case) are literal.
      if (ch === "_" && /[A-Za-z0-9]/.test(src[i - 1] ?? " ")) {
        text += ch;
        i++;
        continue;
      }
      const dbl = src[i + 1] === ch;
      const delim = dbl ? ch + ch : ch;
      const start = i + delim.length;
      if (src[start] && src[start] !== " ") {
        let end = src.indexOf(delim, start);
        // For single delimiters, skip over doubles inside (*a **b** c*).
        while (!dbl && end > 0 && src[end + 1] === ch) end = src.indexOf(delim, end + 2);
        if (end > start && src[end - 1] !== " ") {
          flush();
          const inner = renderInline(src.slice(start, end), key());
          out.push(dbl ? <strong key={key()}>{inner}</strong> : <em key={key()}>{inner}</em>);
          i = end + delim.length;
          continue;
        }
      }
      text += delim;
      i += delim.length;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Blocks

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*$/;
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])(\s+|$)/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (s: string) => s.length - s.trimStart().length;
const isBlank = (s: string) => s.trim() === "";
/** True if a line starts a block other than a paragraph (ends a paragraph). */
const interrupts = (line: string) => FENCE_RE.test(line) || HEADING_RE.test(line) || LIST_RE.test(line);

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function renderBlocks(lines: string[], keyBase = "b", tight = false): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  const key = () => `${keyBase}-${k++}`;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i++; // the closing fence
      out.push(
        <pre key={key()} className="md-code">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      const Tag = `h${h[1].length}` as "h1";
      out.push(<Tag key={key()}>{renderInline(h[2], key())}</Tag>);
      i++;
      continue;
    }

    const lm = LIST_RE.exec(line);
    if (lm) {
      const baseIndent = lm[1].length;
      const ordered = /\d/.test(lm[2]);
      const items: string[][] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
        const contentIndent = m[0].length;
        const item = [lines[i].slice(contentIndent)];
        i++;
        // Continuation: indented lines (nested lists) and lazy paragraph lines.
        while (i < lines.length && !isBlank(lines[i])) {
          const c = lines[i];
          if (indentOf(c) > baseIndent) item.push(c.slice(Math.min(contentIndent, indentOf(c))));
          else if (!interrupts(c)) item.push(c.trimStart());
          else break;
          i++;
        }
        items.push(item);
        // One blank line between items keeps the list going.
        const next = LIST_RE.exec(lines[i + 1] ?? "");
        if (isBlank(lines[i] ?? "x") && next && next[1].length === baseIndent && /\d/.test(next[2]) === ordered) i++;
      }
      const lis = items.map((item, n) => <li key={n}>{renderBlocks(item, `${keyBase}-li${n}`, true)}</li>);
      out.push(ordered ? <ol key={key()}>{lis}</ol> : <ul key={key()}>{lis}</ul>);
      continue;
    }

    // Table: a header row, then a separator row.
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) body.push(splitRow(lines[i++]));
      out.push(
        <table key={key()} className="md-table">
          <thead>
            <tr>
              {head.map((c, n) => (
                <th key={n}>{renderInline(c, `${keyBase}-th${n}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {head.map((_, n) => (
                  <td key={n}>{renderInline(row[n] ?? "", `${keyBase}-td${r}-${n}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    const para: string[] = [line.trimStart()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines[i])) para.push(lines[i++]);
    const content = renderInline(para.join("\n"), key());
    out.push(tight ? <span key={key()}>{content}</span> : <p key={key()}>{content}</p>);
  }
  return out;
}

/** Renders a Markdown text (the subset above). */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return <div className="md">{renderBlocks(lines)}</div>;
}
