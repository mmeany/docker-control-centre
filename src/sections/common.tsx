// Pieces the images, volumes and networks sections share.
import type { ReactNode } from "react";
import type { ActionResult, ContainerItem } from "../api/engine";
import { ContainerIcon } from "../components/Icons";
import { StatusMark, statusTip } from "../components/StatusMark";
import { ResizableTable } from "../components/ResizableTable";
import { containerStatus } from "../status/status";
import type { Shell } from "../shell/shell";
import { containerPath } from "./containers/paths";

/** Sort-key prefix that puts a row after every name (locale compare ranks "~" first). */
export const LAST = "zzzzzz";

/** Up to 12 names, then "and N more". */
export function NameList({ names }: { names: string[] }) {
  const shown = names.slice(0, 12);
  return (
    <ul className="name-list">
      {shown.map((n) => (
        <li key={n}>{n}</li>
      ))}
      {names.length > shown.length && <li>and {(names.length - shown.length).toLocaleString()} more</li>}
    </ul>
  );
}

/** A label / value table; empty values are left out. */
export function PropsTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="props-table">
      <tbody>
        {rows
          .filter(([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/** Containers using something, each opening on double-click. */
export function UsedBy({ containers, shell, what }: { containers: ContainerItem[]; shell: Shell; what: string }) {
  if (containers.length === 0) return <p className="hint">No container uses this {what}.</p>;
  return (
    <div className="data-table-wrap">
      <ResizableTable
        tableKey="usedBy"
        columns={[
          { id: "container", label: "Container" },
          { id: "state", label: "State" },
          { id: "image", label: "Image" },
        ]}
      >
        <tbody>
          {containers.map((c) => {
            const st = containerStatus(c);
            return (
            <tr
              key={c.id}
              className="link-row"
              title={`${statusTip(st)} Double-click to open.`}
              onDoubleClick={() => shell.navigate({ section: "containers", path: containerPath(c.project, c.name) })}
            >
              <td>
                <StatusMark status={st} />{" "}
                <span className="fl-icon">
                  <ContainerIcon />
                </span>{" "}
                <span className={`fl-name st-${st.state}`}>{c.name}</span>
              </td>
              <td className={`st-${st.state}`}>{st.label}</td>
              <td>{c.image}</td>
            </tr>
            );
          })}
        </tbody>
      </ResizableTable>
    </div>
  );
}

/**
 * Runs a removal, then reports: a flash when everything went, otherwise an
 * error naming each failure. `name` turns an id into something readable.
 */
export async function runRemoval(
  shell: Shell,
  what: { one: string; many: string },
  doing: string,
  run: () => Promise<ActionResult[]>,
  name: (id: string) => string,
  after: () => void,
) {
  shell.setWorking(doing);
  try {
    const results = await run();
    const failed = results.filter((r) => r.error);
    const ok = results.length - failed.length;
    const count = (n: number) => `${n.toLocaleString()} ${n === 1 ? what.one : what.many}`;
    if (failed.length === 0) shell.showFlash(`Deleted ${count(ok)}`);
    else
      shell.showError({
        kind: "other",
        message: `${ok ? `Deleted ${count(ok)}; ` : ""}couldn't delete ${count(failed.length)}. ${failed.map((f) => `${name(f.id)}: ${f.error}`).join(" ")}`,
        detail: "",
      });
  } catch (e) {
    shell.showError(e);
  } finally {
    shell.setWorking(null);
    after();
  }
}
