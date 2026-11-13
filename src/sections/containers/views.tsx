// A container's inspect children (environment, mounts, ports, networks,
// labels) and its details-pane summary.
import type { ReactNode } from "react";
import type { ContainerDetails, ContainerItem, KeyValue } from "../../api/engine";
import { MaskedValue } from "../../components/MaskedValue";
import { ContainerIcon, ProjectIcon } from "../../components/Icons";
import { StatusMark } from "../../components/StatusMark";
import { containerStatus, projectStatus } from "../../status/status";
import { formatDate } from "../../format";
import type { ChildId } from "./paths";
import { portsText } from "./ports";

/** Environment variables whose values are hidden until revealed. */
const SECRET = /pass|secret|token|key|credential|private|auth/i;

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <div className="empty-note">{empty}</div>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td key={j} className="mono">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function pairs(list: KeyValue[], mask: boolean, onError: (e: unknown) => void, onCopied: () => void): ReactNode[][] {
  return list.map((kv) => [
    kv.key,
    mask && SECRET.test(kv.key) && kv.value ? <MaskedValue load={() => Promise.resolve(kv.value)} onError={onError} onCopied={onCopied} /> : kv.value,
  ]);
}

interface ChildProps {
  child: Exclude<ChildId, "logs" | "terminal" | "stats" | "files">;
  details: ContainerDetails;
  onError: (e: unknown) => void;
  onCopied: () => void;
}

export const INSPECT_CHILDREN: ChildId[] = ["env", "mounts", "ports", "networks", "labels"];

/** One inspect child as a table. */
export function InspectChild({ child, details: d, onError, onCopied }: ChildProps) {
  let body: ReactNode;
  switch (child) {
    case "env":
      body = <Table head={["Name", "Value"]} rows={pairs(d.env, true, onError, onCopied)} empty="No environment variables." />;
      break;
    case "labels":
      body = <Table head={["Label", "Value"]} rows={pairs(d.labels, false, onError, onCopied)} empty="No labels." />;
      break;
    case "mounts":
      body = (
        <Table
          head={["Type", "Source", "Destination", "Access"]}
          rows={d.mounts.map((m) => [m.kind, m.name || m.source, m.destination, m.readWrite ? "Read / write" : "Read only"])}
          empty="No volumes or bind mounts."
        />
      );
      break;
    case "ports":
      body = (
        <>
          {d.portsConfigured && <p className="hint">Not running, so nothing is published now: these are published when it starts.</p>}
          <Table
            head={["Container port", d.portsConfigured ? "Published on when it starts" : "Published on"]}
            rows={d.ports.map((p) => [p.containerPort, p.host.length ? p.host.join(", ") : "Not published"])}
            empty="No ports exposed or published."
          />
        </>
      );
      break;
    case "networks":
      body = (
        <Table
          head={["Network", "IP address", "Gateway", "MAC address", "Aliases"]}
          rows={d.networks.map((n) => [n.name, n.ipAddress, n.gateway, n.macAddress, n.aliases.join(", ")])}
          empty="Not on any network."
        />
      );
      break;
  }
  return <div className="detail-view inspect-view">{body}</div>;
}

function Props({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="props-table">
      <tbody>
        {rows
          .filter(([, v]) => v !== "" && v !== null && v !== undefined)
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

/** Details pane for one container; `details` fills in once inspected. */
export function ContainerPane({ item, details }: { item: ContainerItem; details: ContainerDetails | null }) {
  const d = details?.id === item.id ? details : null;
  const exit = d && d.state === "exited" && d.exitCode !== null ? `Exit code ${d.exitCode}` : "";
  const st = containerStatus(item);
  return (
    <>
      <div className="details-head">
        <span className="fl-icon">
          <ContainerIcon />
        </span>
        <div>
          <div className={`details-title st-${st.state}`}>{item.name}</div>
          <div className="details-sub">
            <StatusMark status={st} /> {st.reason}
          </div>
          <div className="details-sub">{item.status}</div>
        </div>
      </div>
      <Props
        rows={[
          ["State", [item.state, d?.health, exit].filter(Boolean).join(" · ")],
          ["Image", item.image],
          ["Command", d?.command],
          ["Ports", portsText(item)],
          ["Project", item.project && `${item.project}${item.service ? ` (service ${item.service})` : ""}`],
          ["Created", formatDate(item.created)],
          ["Started", d?.startedAt && formatDate(d.startedAt)],
          ["Finished", d?.finishedAt && formatDate(d.finishedAt)],
          ["Restart", d && `${d.restartPolicy}${d.restartCount ? `, restarted ${d.restartCount}×` : ""}`],
          ["Error", d?.error],
          ["ID", <span className="mono">{item.id.slice(0, 12)}</span>],
        ]}
      />
    </>
  );
}

export function ProjectPane({ name, containers, pinned = false }: { name: string; containers: ContainerItem[]; pinned?: boolean }) {
  const by = (s: string) => containers.filter((c) => c.state === s).length;
  const st = projectStatus(containers, pinned);
  const dir = containers.find((c) => c.workingDir)?.workingDir ?? "";
  return (
    <>
      <div className="details-head">
        <span className="fl-icon">
          <ProjectIcon />
        </span>
        <div>
          <div className={`details-title st-${st.state}`}>{name}</div>
          <div className="details-sub">
            <StatusMark status={st} /> {st.reason}
          </div>
        </div>
      </div>
      <Props
        rows={[
          ["Containers", containers.length.toLocaleString()],
          ["Running", by("running").toLocaleString()],
          ["Paused", by("paused") ? by("paused").toLocaleString() : ""],
          ["Stopped", (by("exited") + by("created") + by("dead")).toLocaleString()],
          ["Services", [...new Set(containers.map((c) => c.service).filter(Boolean))].join(", ")],
          ["Folder", <span className="mono">{dir}</span>],
          ["Files", <span className="mono">{(containers.find((c) => c.configFiles.length)?.configFiles ?? []).join(", ")}</span>],
        ]}
      />
    </>
  );
}

export function SelectionPane({ items }: { items: ContainerItem[] }) {
  const running = items.filter((c) => c.state === "running").length;
  return (
    <div className="details-head">
      <div>
        <div className="details-title">{items.length.toLocaleString()} containers selected</div>
        <div className="details-sub">{running.toLocaleString()} running</div>
      </div>
    </div>
  );
}
