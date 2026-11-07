//! Engine-wide totals for the dashboard overview. The engine has no
//! engine-wide stats, so the command opens one stats stream per running
//! container; this module keeps the latest sample of each, turns counters into
//! per-second rates, and sums them. Pure, so it is unit-tested here.

use crate::streams::StatsSample;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

/// Most containers streamed at once; past this the overview says so.
pub const TOTALS_CAP: usize = 100;
/// How often a snapshot goes to the UI (paces messages; the engine isn't polled).
pub const TOTALS_TICK: Duration = Duration::from_secs(2);

/// One container's latest figures.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerFigures {
    pub id: String,
    pub name: String,
    /// 100 = one CPU fully used.
    pub cpu_percent: f64,
    pub mem_used: u64,
    pub mem_limit: u64,
    /// Bytes per second since the previous sample.
    pub net_rx_rate: f64,
    pub net_tx_rate: f64,
    pub block_read_rate: f64,
    pub block_write_rate: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TotalsSnapshot {
    /// Sum over containers; 100 = one CPU.
    pub cpu_percent: f64,
    /// CPUs the engine has (the most any container reports).
    pub online_cpus: u32,
    pub mem_used: u64,
    /// The largest container limit: the engine's memory when none are limited.
    pub mem_limit: u64,
    pub net_rx_rate: f64,
    pub net_tx_rate: f64,
    pub block_read_rate: f64,
    pub block_write_rate: f64,
    /// Containers counted.
    pub counted: usize,
    /// Running containers not counted because of the cap.
    pub skipped: usize,
    /// Highest CPU first.
    pub containers: Vec<ContainerFigures>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TotalsMessage {
    Totals(TotalsSnapshot),
    /// The stream stopped (engine gone); the UI restarts it when it reconnects.
    End {
        error: Option<String>,
    },
}

struct Entry {
    name: String,
    last: StatsSample,
    /// Seconds (any fixed origin) when `last` arrived.
    at: f64,
    rates: [f64; 4],
}

/// The latest sample per container, and which running containers the cap left out.
#[derive(Default)]
pub struct Totals {
    entries: HashMap<String, Entry>,
    skipped: BTreeSet<String>,
}

fn rate(now: u64, before: u64, dt: f64) -> f64 {
    // A counter that went down (restart) gives no rate rather than a negative one.
    now.saturating_sub(before) as f64 / dt
}

impl Totals {
    /// A sample from `id` arriving at `at` seconds.
    pub fn record(&mut self, id: &str, name: &str, sample: StatsSample, at: f64) {
        let rates = match self.entries.get(id) {
            Some(prev) if at > prev.at => {
                let dt = at - prev.at;
                [
                    rate(sample.net_rx, prev.last.net_rx, dt),
                    rate(sample.net_tx, prev.last.net_tx, dt),
                    rate(sample.block_read, prev.last.block_read, dt),
                    rate(sample.block_write, prev.last.block_write, dt),
                ]
            }
            Some(prev) => prev.rates,
            None => [0.0; 4],
        };
        self.entries.insert(
            id.to_string(),
            Entry {
                name: name.to_string(),
                last: sample,
                at,
                rates,
            },
        );
    }

    /// The container stopped (its stream ended) or went away.
    pub fn remove(&mut self, id: &str) {
        self.entries.remove(id);
        self.skipped.remove(id);
    }

    /// Whether a newly running container can be streamed; if not it's
    /// remembered as skipped. `streaming` is how many streams are open.
    pub fn admit(&mut self, id: &str, streaming: usize) -> bool {
        if streaming < TOTALS_CAP {
            self.skipped.remove(id);
            true
        } else {
            self.skipped.insert(id.to_string());
            false
        }
    }

    /// A skipped container to stream now that a slot is free.
    pub fn next_skipped(&mut self) -> Option<String> {
        let id = self.skipped.iter().next().cloned()?;
        self.skipped.remove(&id);
        Some(id)
    }

    pub fn snapshot(&self) -> TotalsSnapshot {
        let mut containers: Vec<ContainerFigures> = self
            .entries
            .iter()
            .map(|(id, e)| ContainerFigures {
                id: id.clone(),
                name: e.name.clone(),
                cpu_percent: e.last.cpu_percent,
                mem_used: e.last.mem_used,
                mem_limit: e.last.mem_limit,
                net_rx_rate: e.rates[0],
                net_tx_rate: e.rates[1],
                block_read_rate: e.rates[2],
                block_write_rate: e.rates[3],
            })
            .collect();
        containers.sort_by(|a, b| {
            b.cpu_percent
                .total_cmp(&a.cpu_percent)
                .then_with(|| a.name.cmp(&b.name))
        });
        let sum = |f: fn(&ContainerFigures) -> f64| containers.iter().map(f).sum::<f64>();
        TotalsSnapshot {
            cpu_percent: sum(|c| c.cpu_percent),
            online_cpus: self
                .entries
                .values()
                .map(|e| e.last.online_cpus)
                .max()
                .unwrap_or(0),
            mem_used: containers.iter().map(|c| c.mem_used).sum(),
            mem_limit: containers.iter().map(|c| c.mem_limit).max().unwrap_or(0),
            net_rx_rate: sum(|c| c.net_rx_rate),
            net_tx_rate: sum(|c| c.net_tx_rate),
            block_read_rate: sum(|c| c.block_read_rate),
            block_write_rate: sum(|c| c.block_write_rate),
            counted: containers.len(),
            skipped: self.skipped.len(),
            containers,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(cpu: f64, mem: u64, net_rx: u64, block_write: u64) -> StatsSample {
        StatsSample {
            cpu_percent: cpu,
            online_cpus: 8,
            mem_used: mem,
            mem_limit: 16 << 30,
            net_rx,
            block_write,
            ..Default::default()
        }
    }

    #[test]
    fn sums_containers_and_sorts_by_cpu() {
        let mut t = Totals::default();
        t.record("a", "web", sample(12.5, 100, 0, 0), 0.0);
        t.record("b", "db", sample(40.0, 300, 0, 0), 0.0);
        let s = t.snapshot();
        assert_eq!(s.counted, 2);
        assert_eq!(s.cpu_percent, 52.5);
        assert_eq!(s.mem_used, 400);
        assert_eq!(s.mem_limit, 16 << 30);
        assert_eq!(s.online_cpus, 8);
        assert_eq!(s.containers[0].name, "db");
        assert_eq!(s.containers[1].name, "web");
    }

    #[test]
    fn rates_come_from_the_previous_sample() {
        let mut t = Totals::default();
        t.record("a", "web", sample(1.0, 1, 1_000, 500), 10.0);
        assert_eq!(t.snapshot().net_rx_rate, 0.0, "no rate from one sample");
        t.record("a", "web", sample(1.0, 1, 5_000, 2_500), 12.0);
        let s = t.snapshot();
        assert_eq!(s.net_rx_rate, 2_000.0);
        assert_eq!(s.block_write_rate, 1_000.0);
        // Same instant again: keep the last rate rather than divide by zero.
        t.record("a", "web", sample(1.0, 1, 6_000, 2_500), 12.0);
        assert_eq!(t.snapshot().net_rx_rate, 2_000.0);
        // Counters reset (container restarted): no negative rate.
        t.record("a", "web", sample(1.0, 1, 10, 0), 13.0);
        assert_eq!(t.snapshot().net_rx_rate, 0.0);
    }

    #[test]
    fn removing_drops_a_container() {
        let mut t = Totals::default();
        t.record("a", "web", sample(5.0, 10, 0, 0), 0.0);
        t.record("b", "db", sample(5.0, 10, 0, 0), 0.0);
        t.remove("a");
        let s = t.snapshot();
        assert_eq!(s.counted, 1);
        assert_eq!(s.containers[0].id, "b");
        t.remove("b");
        let s = t.snapshot();
        assert_eq!(
            (s.counted, s.cpu_percent, s.mem_limit, s.online_cpus),
            (0, 0.0, 0, 0)
        );
    }

    #[test]
    fn the_cap_skips_and_frees_slots() {
        let mut t = Totals::default();
        assert!(t.admit("a", TOTALS_CAP - 1));
        assert!(!t.admit("b", TOTALS_CAP));
        assert!(!t.admit("c", TOTALS_CAP));
        assert_eq!(t.snapshot().skipped, 2);
        // c stopped before a slot came free.
        t.remove("c");
        assert_eq!(t.next_skipped().as_deref(), Some("b"));
        assert_eq!(t.next_skipped(), None);
        assert_eq!(t.snapshot().skipped, 0);
    }

    #[test]
    fn serialises_for_the_ui() {
        let mut t = Totals::default();
        t.record("a", "web", sample(1.0, 2, 0, 0), 0.0);
        let v = serde_json::to_value(TotalsMessage::Totals(t.snapshot())).unwrap();
        assert_eq!(v["type"], "totals");
        assert_eq!(v["cpuPercent"], 1.0);
        assert_eq!(v["containers"][0]["netRxRate"], 0.0);
        let v = serde_json::to_value(TotalsMessage::End {
            error: Some("gone".into()),
        })
        .unwrap();
        assert_eq!(v, serde_json::json!({ "type": "end", "error": "gone" }));
    }
}
