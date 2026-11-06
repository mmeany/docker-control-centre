//! Long-running work the UI watches (logs, stats, terminals): a registry so
//! the UI can stop them and closing a window stops its own, plus the pure
//! pieces (line splitting, UTF-8 carry-over, stats maths) with unit tests.

use bollard::models::ContainerStatsResponse;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;

/// Running streams by id, remembering which window started each.
#[derive(Default)]
pub struct StreamRegistry {
    next: AtomicU64,
    tasks: Mutex<HashMap<u64, (String, JoinHandle<()>)>>,
}

impl StreamRegistry {
    pub fn next_id(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn add(&self, id: u64, window: &str, task: JoinHandle<()>) {
        self.tasks
            .lock()
            .unwrap()
            .insert(id, (window.to_string(), task));
    }

    /// Forgets a stream that ended by itself.
    pub fn done(&self, id: u64) {
        self.tasks.lock().unwrap().remove(&id);
    }

    pub fn stop(&self, id: u64) {
        if let Some((_, t)) = self.tasks.lock().unwrap().remove(&id) {
            t.abort();
        }
    }

    pub fn stop_window(&self, window: &str) {
        self.tasks.lock().unwrap().retain(|_, (w, t)| {
            if w == window {
                t.abort();
                false
            } else {
                true
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Logs

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LogQuery {
    pub follow: bool,
    /// Last N lines; None = all.
    pub tail: Option<u32>,
    /// Unix seconds.
    pub since: Option<i64>,
    pub until: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// From stderr.
    pub err: bool,
    /// RFC 3339 from the engine; "" if it had none.
    pub time: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LogMessage {
    Lines {
        lines: Vec<LogLine>,
    },
    /// The stream finished (container stopped, range done) or failed.
    End {
        error: Option<String>,
    },
}

/// Removes ANSI escape sequences (colours, cursor moves) and stray CRs.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.peek() {
                Some('[') => {
                    chars.next();
                    // CSI: parameters, then one final byte in @..~
                    for n in chars.by_ref() {
                        if ('@'..='~').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC: until BEL or ESC \
                    while let Some(n) = chars.next() {
                        if n == '\u{7}' || (n == '\u{1b}' && chars.peek() == Some(&'\\')) {
                            if n == '\u{1b}' {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            },
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// "2026-11-06T17:04:19.123456789Z text" -> (time, text).
fn split_time(line: &str) -> (&str, &str) {
    match line.split_once(' ') {
        Some((t, rest)) if t.len() >= 20 && t.as_bytes()[4] == b'-' && t.as_bytes()[10] == b'T' => {
            (t, rest)
        }
        _ => ("", line),
    }
}

/// Splits frames into lines, keeping a partial last line per stream until its
/// newline arrives (TTY containers send arbitrary chunks).
#[derive(Default)]
pub struct LineSplitter {
    partial: [String; 2],
}

impl LineSplitter {
    pub fn push(&mut self, err: bool, chunk: &str, out: &mut Vec<LogLine>) {
        let buf = &mut self.partial[usize::from(err)];
        buf.push_str(chunk);
        while let Some(i) = buf.find('\n') {
            let line: String = buf.drain(..=i).collect();
            out.push(make_line(err, line.trim_end_matches('\n')));
        }
    }

    /// Whatever is left when the stream ends.
    pub fn finish(&mut self, out: &mut Vec<LogLine>) {
        for err in [false, true] {
            let rest = std::mem::take(&mut self.partial[usize::from(err)]);
            if !rest.is_empty() {
                out.push(make_line(err, &rest));
            }
        }
    }
}

fn make_line(err: bool, raw: &str) -> LogLine {
    let (time, text) = split_time(raw);
    LogLine {
        err,
        time: time.to_string(),
        text: strip_ansi(text),
    }
}

// ---------------------------------------------------------------------------
// Terminal output

/// Turns byte chunks into text without splitting a UTF-8 character across
/// two messages.
#[derive(Default)]
pub struct Utf8Carry {
    pending: Vec<u8>,
}

impl Utf8Carry {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    return out;
                }
                Err(e) => {
                    let good = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..good]).unwrap());
                    match e.error_len() {
                        // Incomplete character at the end: keep it for next time.
                        None => {
                            self.pending.drain(..good);
                            return out;
                        }
                        // Invalid bytes: replace and carry on.
                        Some(bad) => {
                            out.push('\u{fffd}');
                            self.pending.drain(..good + bad);
                        }
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TermMessage {
    Output {
        data: String,
    },
    Exit {
        code: Option<i64>,
        message: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// Stats

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsSample {
    /// RFC 3339 from the engine.
    pub time: String,
    /// 100 = one CPU fully used.
    pub cpu_percent: f64,
    pub online_cpus: u32,
    /// Bytes, not counting reclaimable page cache.
    pub mem_used: u64,
    pub mem_limit: u64,
    /// Totals since the container started; the UI turns them into rates.
    pub net_rx: u64,
    pub net_tx: u64,
    pub block_read: u64,
    pub block_write: u64,
    pub pids: u64,
}

pub fn stats_sample(s: &ContainerStatsResponse) -> StatsSample {
    let cpu = s.cpu_stats.clone().unwrap_or_default();
    let pre = s.precpu_stats.clone().unwrap_or_default();
    let total = |c: &bollard::models::ContainerCpuStats| {
        c.cpu_usage
            .as_ref()
            .and_then(|u| u.total_usage)
            .unwrap_or(0)
    };
    let cpus = cpu
        .online_cpus
        .filter(|n| *n > 0)
        .or_else(|| {
            cpu.cpu_usage
                .as_ref()
                .and_then(|u| u.percpu_usage.as_ref())
                .map(|v| v.len() as u32)
        })
        .unwrap_or(1);
    let cpu_delta = total(&cpu).saturating_sub(total(&pre)) as f64;
    let sys_delta = cpu
        .system_cpu_usage
        .unwrap_or(0)
        .saturating_sub(pre.system_cpu_usage.unwrap_or(0)) as f64;
    let cpu_percent = if sys_delta > 0.0 && cpu_delta > 0.0 {
        cpu_delta / sys_delta * cpus as f64 * 100.0
    } else {
        0.0
    };

    let mem = s.memory_stats.clone().unwrap_or_default();
    let stats = mem.stats.unwrap_or_default();
    // cgroup v2 reports inactive_file, v1 total_inactive_file: both are cache.
    let cache = stats
        .get("inactive_file")
        .or_else(|| stats.get("total_inactive_file"))
        .copied()
        .unwrap_or(0);
    let mem_used = mem.usage.unwrap_or(0).saturating_sub(cache);

    let (mut net_rx, mut net_tx) = (0, 0);
    for n in s.networks.clone().unwrap_or_default().values() {
        net_rx += n.rx_bytes.unwrap_or(0);
        net_tx += n.tx_bytes.unwrap_or(0);
    }
    let (mut block_read, mut block_write) = (0, 0);
    let io = s
        .blkio_stats
        .clone()
        .and_then(|b| b.io_service_bytes_recursive)
        .unwrap_or_default();
    for e in io {
        match e.op.unwrap_or_default().to_ascii_lowercase().as_str() {
            "read" => block_read += e.value.unwrap_or(0),
            "write" => block_write += e.value.unwrap_or(0),
            _ => {}
        }
    }
    StatsSample {
        time: s.read.clone().unwrap_or_default(),
        cpu_percent,
        online_cpus: cpus,
        mem_used,
        mem_limit: mem.limit.unwrap_or(0),
        net_rx,
        net_tx,
        block_read,
        block_write,
        pids: s.pids_stats.as_ref().and_then(|p| p.current).unwrap_or(0),
    }
}

/// Percent-encodes a string for a URL query value.
pub fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::{
        ContainerBlkioStatEntry, ContainerBlkioStats, ContainerCpuStats, ContainerCpuUsage,
        ContainerMemoryStats, ContainerNetworkStats, ContainerPidsStats,
    };

    #[test]
    fn strips_ansi() {
        assert_eq!(strip_ansi("\u{1b}[1;32mok\u{1b}[0m done\r"), "ok done");
        assert_eq!(strip_ansi("\u{1b}]0;title\u{7}x"), "x");
        assert_eq!(strip_ansi("plain"), "plain");
    }

    #[test]
    fn splits_lines_across_chunks() {
        let mut s = LineSplitter::default();
        let mut out = vec![];
        s.push(false, "2026-11-06T17:04:19.123Z hel", &mut out);
        assert!(out.is_empty());
        s.push(true, "2026-11-06T17:04:20Z oops\n", &mut out);
        s.push(false, "lo\nno time here\npart", &mut out);
        s.finish(&mut out);
        assert_eq!(
            out,
            vec![
                LogLine {
                    err: true,
                    time: "2026-11-06T17:04:20Z".into(),
                    text: "oops".into()
                },
                LogLine {
                    err: false,
                    time: "2026-11-06T17:04:19.123Z".into(),
                    text: "hello".into()
                },
                LogLine {
                    err: false,
                    time: "".into(),
                    text: "no time here".into()
                },
                LogLine {
                    err: false,
                    time: "".into(),
                    text: "part".into()
                },
            ]
        );
    }

    #[test]
    fn carries_split_utf8() {
        let mut c = Utf8Carry::default();
        let bytes = "a€b".as_bytes(); // € is 3 bytes
        assert_eq!(c.push(&bytes[..2]), "a");
        assert_eq!(c.push(&bytes[2..3]), "");
        assert_eq!(c.push(&bytes[3..]), "€b");
        assert_eq!(c.push(&[0xff, b'x']), "\u{fffd}x");
    }

    #[test]
    fn computes_stats() {
        let cpu = |total, system| ContainerCpuStats {
            cpu_usage: Some(ContainerCpuUsage {
                total_usage: Some(total),
                ..Default::default()
            }),
            system_cpu_usage: Some(system),
            online_cpus: Some(4),
            ..Default::default()
        };
        let net = |rx, tx| ContainerNetworkStats {
            rx_bytes: Some(rx),
            tx_bytes: Some(tx),
            ..Default::default()
        };
        let io = |op: &str, v| ContainerBlkioStatEntry {
            op: Some(op.into()),
            value: Some(v),
            ..Default::default()
        };
        let s = ContainerStatsResponse {
            read: Some("2026-11-06T17:04:19Z".into()),
            cpu_stats: Some(cpu(1_500, 20_000)),
            precpu_stats: Some(cpu(1_000, 10_000)),
            memory_stats: Some(ContainerMemoryStats {
                usage: Some(300),
                limit: Some(1000),
                stats: Some(HashMap::from([("inactive_file".to_string(), 100)])),
                ..Default::default()
            }),
            networks: Some(HashMap::from([
                ("eth0".to_string(), net(10, 20)),
                ("eth1".to_string(), net(1, 2)),
            ])),
            blkio_stats: Some(ContainerBlkioStats {
                io_service_bytes_recursive: Some(vec![
                    io("Read", 7),
                    io("write", 9),
                    io("Total", 16),
                ]),
                ..Default::default()
            }),
            pids_stats: Some(ContainerPidsStats {
                current: Some(5),
                limit: None,
            }),
            ..Default::default()
        };
        let x = stats_sample(&s);
        assert!((x.cpu_percent - 20.0).abs() < 1e-9, "{}", x.cpu_percent); // 500/10000 * 4 cpus
        assert_eq!((x.mem_used, x.mem_limit), (200, 1000));
        assert_eq!((x.net_rx, x.net_tx), (11, 22));
        assert_eq!((x.block_read, x.block_write), (7, 9));
        assert_eq!(x.pids, 5);
        assert_eq!(
            stats_sample(&ContainerStatsResponse::default()).cpu_percent,
            0.0
        );
    }

    #[test]
    fn encodes_urls() {
        assert_eq!(
            url_encode("/containers/@shop/web-1/logs"),
            "%2Fcontainers%2F%40shop%2Fweb-1%2Flogs"
        );
    }
}
