//! Names unnamed volumes in compose files by editing their text, so comments
//! and layout survive (there's no YAML crate). For each request, a service's
//! `volumes:` list gets `- <key>:<target>` (or its `- /target` line, or the
//! long-form entry, gains the key as its source), and the top-level
//! `volumes:` gets `<key>:` with `name: <name>`.
//!
//! Only block-style YAML is edited. Anything it can't edit safely (flow style,
//! anchors, aliases, `<<:` merges, `extends`, entries written with variables,
//! more than one document) is left alone and returned with a snippet to add
//! by hand. Line endings and the file's indent are kept.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};

/// A volume to name: which service and path, and what to call it.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NameRequest {
    pub service: String,
    pub target: String,
    /// The key under the top-level `volumes:`.
    pub key: String,
    /// The volume's name on the engine (`name:`).
    pub name: String,
}

/// A request that wasn't applied, why, and what to add by hand.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manual {
    pub service: String,
    pub target: String,
    pub reason: String,
    pub snippet: String,
}

/// A problem with a request's key or name that blocks saving.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// The request's position in the list.
    pub index: usize,
    /// `key` or `name`.
    pub field: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Lines

#[derive(Debug, Clone)]
struct Doc {
    lines: Vec<String>,
    ends: Vec<&'static str>,
    /// The ending new lines get: CRLF if the file uses it anywhere.
    eol: &'static str,
}

impl Doc {
    fn parse(text: &str) -> Doc {
        let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let (mut lines, mut ends) = (vec![], vec![]);
        let mut rest = text;
        while !rest.is_empty() {
            match rest.find('\n') {
                Some(i) => {
                    let crlf = i > 0 && rest.as_bytes()[i - 1] == b'\r';
                    lines.push(rest[..if crlf { i - 1 } else { i }].to_string());
                    ends.push(if crlf { "\r\n" } else { "\n" });
                    rest = &rest[i + 1..];
                }
                None => {
                    lines.push(rest.to_string());
                    ends.push("");
                    rest = "";
                }
            }
        }
        Doc { lines, ends, eol }
    }

    fn text(&self) -> String {
        self.lines
            .iter()
            .zip(&self.ends)
            .map(|(l, e)| format!("{l}{e}"))
            .collect()
    }

    fn insert(&mut self, at: usize, line: String) {
        if at > 0 && self.ends[at - 1].is_empty() {
            self.ends[at - 1] = self.eol;
        }
        self.lines.insert(at, line);
        self.ends.insert(at, self.eol);
    }

    fn indent(&self, i: usize) -> usize {
        self.lines[i].len() - self.lines[i].trim_start_matches(' ').len()
    }

    fn trimmed(&self, i: usize) -> &str {
        self.lines[i].trim_start_matches(' ')
    }

    /// Not blank, not a comment.
    fn content(&self, i: usize) -> bool {
        let t = self.lines[i].trim();
        !t.is_empty() && !t.starts_with('#')
    }

    /// The first content line in `from..to`.
    fn next_content(&self, from: usize, to: usize) -> Option<usize> {
        (from..to).find(|&i| self.content(i))
    }

    /// Where the block under line `start` ends (exclusive): the next content
    /// line at or left of `indent`.
    fn block_end(&self, start: usize, indent: usize) -> usize {
        (start + 1..self.lines.len())
            .find(|&i| self.content(i) && self.indent(i) <= indent)
            .unwrap_or(self.lines.len())
    }

    /// The last content line in `start..end` (`start` if there's none after it).
    fn last_content(&self, start: usize, end: usize) -> usize {
        (start..end)
            .rev()
            .find(|&i| self.content(i))
            .unwrap_or(start)
    }

    /// A key at `indent` in `from..to`.
    fn key_at(&self, from: usize, to: usize, indent: usize, key: &str) -> Option<usize> {
        (from..to).find(|&i| {
            self.content(i)
                && self.indent(i) == indent
                && key_of(self.trimmed(i)).is_some_and(|(k, _)| k == key)
        })
    }

    /// The keys at `indent` in `from..to`.
    fn keys_at(&self, from: usize, to: usize, indent: usize) -> Vec<String> {
        (from..to)
            .filter(|&i| self.content(i) && self.indent(i) == indent)
            .filter_map(|i| key_of(self.trimmed(i)).map(|(k, _)| k))
            .collect()
    }

    /// The indent step: how far services sit under `services:`, else 2.
    fn unit(&self) -> usize {
        self.key_at(0, self.lines.len(), 0, "services")
            .and_then(|s| self.next_content(s + 1, self.lines.len()))
            .map(|i| self.indent(i))
            .filter(|&n| n > 0)
            .unwrap_or(2)
    }

    /// Whole-file reasons not to edit it.
    fn check(&self) -> Result<(), String> {
        let mut seen = false;
        for i in 0..self.lines.len() {
            if !self.content(i) || self.indent(i) > 0 {
                continue;
            }
            let t = self.trimmed(i);
            if t.starts_with("---") {
                if seen {
                    return Err("The file holds more than one YAML document.".into());
                }
                continue;
            }
            if t.starts_with('%') {
                continue;
            }
            if t.starts_with('{') || t.starts_with('[') {
                return Err("The file is written in flow style ({...}).".into());
            }
            seen = true;
        }
        Ok(())
    }

    /// The keys under the top-level `volumes:`.
    fn volume_keys(&self) -> Vec<String> {
        let n = self.lines.len();
        let Some(t) = self.key_at(0, n, 0, "volumes") else {
            return vec![];
        };
        let end = self.block_end(t, 0);
        match self.next_content(t + 1, end) {
            Some(c) => self.keys_at(t + 1, end, self.indent(c)),
            None => vec![],
        }
    }
}

/// The value part of a line and what follows it (spaces and a comment).
fn split_comment(s: &str) -> (&str, &str) {
    let b = s.as_bytes();
    let mut quote: Option<u8> = None;
    let mut cut = b.len();
    for i in 0..b.len() {
        let c = b[i];
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                }
            }
            None => {
                let after_space = i == 0 || b[i - 1] == b' ' || b[i - 1] == b'\t';
                if (c == b'"' || c == b'\'') && after_space {
                    quote = Some(c);
                } else if c == b'#' && after_space {
                    cut = i;
                    break;
                }
            }
        }
    }
    let v = s[..cut].trim_end();
    (v, &s[v.len()..])
}

/// A mapping line's key and value (comment dropped): `key: value`.
fn key_of(t: &str) -> Option<(String, String)> {
    let (v, _) = split_comment(t);
    if v.starts_with('{') || v.starts_with('[') || v.starts_with('-') {
        return None;
    }
    let (key, after) = if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let end = v[1..].find(q)? + 1;
        (v[1..end].to_string(), &v[end + 1..])
    } else {
        let i = v
            .find(": ")
            .or_else(|| v.ends_with(':').then(|| v.len() - 1))?;
        (v[..i].trim_end().to_string(), &v[i..])
    };
    let after = after.strip_prefix(':')?;
    if !after.is_empty() && !after.starts_with(' ') {
        return None;
    }
    Some((key, after.trim().to_string()))
}

/// A scalar without its quotes, and which quote it had.
fn unquote(v: &str) -> (String, Option<char>) {
    for q in ['"', '\''] {
        if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) {
            return (v[1..v.len() - 1].to_string(), Some(q));
        }
    }
    (v.to_string(), None)
}

/// A scalar as YAML: plain when that's safe, else quoted.
fn scalar(s: &str, quote: Option<char>) -> String {
    let plain = !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./@+:-".contains(c))
        && !s.starts_with(['-', ':', '@'])
        && !s.contains(": ");
    match quote {
        Some('\'') => format!("'{}'", s.replace('\'', "''")),
        Some(_) => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
        None if plain => s.to_string(),
        None => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
    }
}

/// "/data/" and "/data" are the same mount point.
fn norm(p: &str) -> &str {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        "/"
    } else {
        t
    }
}

fn spaces(n: usize) -> String {
    " ".repeat(n)
}

// ---------------------------------------------------------------------------
// A service and its volumes

#[derive(Debug)]
enum Entry {
    /// `- /data`, `- name:/data`: the value without quotes.
    Short { value: String, quote: Option<char> },
    /// A mapping: where its keys sit and what they say.
    Long {
        key_indent: usize,
        target: Option<(usize, String)>,
        source: Option<String>,
        kind: Option<String>,
    },
    /// Flow style, an alias, or something else this doesn't read.
    Other,
}

#[derive(Debug)]
struct Item {
    start: usize,
    entry: Entry,
}

#[derive(Debug)]
struct Volumes {
    line: usize,
    /// `[]` written inline.
    empty_flow: bool,
    /// Where the list items sit, if there are any.
    item_indent: Option<usize>,
    /// The last line of the list (the key line if it's empty).
    last: usize,
    items: Vec<Item>,
}

#[derive(Debug)]
struct Service {
    start: usize,
    end: usize,
    child: usize,
    volumes: Option<Volumes>,
}

impl Entry {
    fn target(&self) -> Option<String> {
        match self {
            // `/dst`, `src:/dst` or `src:/dst:mode`.
            Entry::Short { value, .. } => {
                let parts: Vec<&str> = value.split(':').collect();
                Some(parts.get(if parts.len() == 1 { 0 } else { 1 })?.to_string())
            }
            Entry::Long { target, .. } => target.as_ref().map(|(_, t)| t.clone()),
            Entry::Other => None,
        }
    }

    /// Written with a variable, so the resolved target isn't known.
    fn uncertain(&self) -> bool {
        match self {
            Entry::Short { value, .. } => value.contains('$'),
            Entry::Long { target, .. } => target.as_ref().is_none_or(|(_, t)| t.contains('$')),
            Entry::Other => true,
        }
    }
}

fn read_entry(doc: &Doc, start: usize, end: usize, item_indent: usize) -> Entry {
    let t = doc.trimmed(start);
    let after = &t[1..];
    let rest = after.trim_start();
    let offset = item_indent + 1 + (after.len() - rest.len());
    let (v, _) = split_comment(rest);
    if v.starts_with(['{', '[', '*', '&', '|', '>', '!']) {
        return Entry::Other;
    }
    let key_indent = if v.is_empty() {
        match doc.next_content(start + 1, end) {
            Some(i) => doc.indent(i),
            None => return Entry::Other,
        }
    } else if key_of(v).is_some() {
        offset
    } else {
        let (value, quote) = unquote(v);
        return Entry::Short { value, quote };
    };
    let mut lines: Vec<(usize, String, String)> = vec![];
    if !v.is_empty() {
        if let Some((k, val)) = key_of(v) {
            lines.push((start, k, val));
        }
    }
    for i in start + 1..end {
        if doc.content(i) && doc.indent(i) == key_indent {
            match key_of(doc.trimmed(i)) {
                Some((k, val)) => lines.push((i, k, val)),
                None => return Entry::Other,
            }
        }
    }
    let get = |key: &str| {
        lines
            .iter()
            .find(|(_, k, _)| k == key)
            .map(|(i, _, v)| (*i, unquote(v).0))
    };
    Entry::Long {
        key_indent,
        target: get("target"),
        source: get("source").map(|(_, v)| v).filter(|v| !v.is_empty()),
        kind: get("type").map(|(_, v)| v),
    }
}

/// A service in a file: None if the file doesn't define it, Err if it does
/// in a way this can't edit.
fn service(doc: &Doc, name: &str) -> Result<Option<Service>, String> {
    let n = doc.lines.len();
    let Some(s) = doc.key_at(0, n, 0, "services") else {
        return Ok(None);
    };
    let (_, v) = key_of(doc.trimmed(s)).unwrap_or_default();
    if !v.is_empty() {
        return Err("The services are written in flow style or through an alias.".into());
    }
    let end = doc.block_end(s, 0);
    let Some(first) = doc.next_content(s + 1, end) else {
        return Ok(None);
    };
    let si = doc.indent(first);
    let Some(start) = doc.key_at(s + 1, end, si, name) else {
        return Ok(None);
    };
    let (_, v) = key_of(doc.trimmed(start)).unwrap_or_default();
    if v.starts_with('&') {
        return Err(
            "The service has an anchor (&), so other services may share its settings.".into(),
        );
    }
    if !v.is_empty() {
        return Err("The service is written in flow style or through an alias.".into());
    }
    let send = doc.block_end(start, si);
    let child = doc
        .next_content(start + 1, send)
        .map(|i| doc.indent(i))
        .unwrap_or(si + doc.unit());
    let mut volumes = None;
    for i in start + 1..send {
        if !doc.content(i) || doc.indent(i) != child {
            continue;
        }
        let Some((k, v)) = key_of(doc.trimmed(i)) else {
            continue;
        };
        match k.as_str() {
            "<<" => return Err("The service merges settings from elsewhere (<<:).".into()),
            "extends" => {
                return Err(
                    "The service uses extends, so its volumes can come from elsewhere.".into(),
                )
            }
            "volumes" => volumes = Some(read_volumes(doc, i, send, child, &v)?),
            _ => {}
        }
    }
    Ok(Some(Service {
        start,
        end: send,
        child,
        volumes,
    }))
}

fn read_volumes(
    doc: &Doc,
    line: usize,
    end: usize,
    child: usize,
    v: &str,
) -> Result<Volumes, String> {
    if v.starts_with(['&', '*']) {
        return Err("The service's volumes are shared through an anchor or alias.".into());
    }
    let empty = Volumes {
        line,
        empty_flow: v == "[]",
        item_indent: None,
        last: line,
        items: vec![],
    };
    if v == "[]" {
        return Ok(empty);
    }
    if !v.is_empty() {
        return Err("The service's volumes are written in flow style ([...]).".into());
    }
    let Some(j) = doc.next_content(line + 1, end) else {
        return Ok(empty);
    };
    let ii = doc.indent(j);
    let dash = |i: usize| {
        let t = doc.trimmed(i);
        t == "-" || t.starts_with("- ")
    };
    if ii < child || (ii == child && !dash(j)) {
        return Ok(empty);
    }
    if !dash(j) {
        return Err("The service's volumes aren't a list.".into());
    }
    let list_end = (j..end)
        .find(|&i| doc.content(i) && (doc.indent(i) < ii || (doc.indent(i) == ii && !dash(i))))
        .unwrap_or(end);
    let starts: Vec<usize> = (j..list_end)
        .filter(|&i| doc.content(i) && doc.indent(i) == ii && dash(i))
        .collect();
    let items = starts
        .iter()
        .enumerate()
        .map(|(n, &s)| Item {
            start: s,
            entry: read_entry(doc, s, starts.get(n + 1).copied().unwrap_or(list_end), ii),
        })
        .collect();
    Ok(Volumes {
        line,
        empty_flow: false,
        item_indent: Some(ii),
        last: doc.last_content(j, list_end),
        items,
    })
}

impl Service {
    /// The entry already written for this target.
    fn entry_for(&self, target: &str) -> Option<&Item> {
        self.volumes
            .as_ref()?
            .items
            .iter()
            .find(|it| it.entry.target().is_some_and(|t| norm(&t) == norm(target)))
    }
}

// ---------------------------------------------------------------------------
// Edits

/// Names one volume in a service: fixes its entry, or adds one.
fn name_in_service(doc: &mut Doc, svc: &Service, req: &NameRequest) -> Result<(), String> {
    let unit = doc.unit();
    let mount = format!("{}:{}", req.key, req.target);
    if let Some(item) = svc.entry_for(&req.target) {
        return match &item.entry {
            Entry::Short { value, quote } => {
                if value.contains(':') {
                    return Err(format!(
                        "The entry for {} already has a source.",
                        req.target
                    ));
                }
                let line = &doc.lines[item.start];
                let ii = doc.indent(item.start);
                let after = &line[ii + 1..];
                let pos = ii + 1 + (after.len() - after.trim_start().len());
                let (_, tail) = split_comment(&line[pos..]);
                doc.lines[item.start] =
                    format!("{}{}{}", &line[..pos], scalar(&mount, *quote), tail);
                Ok(())
            }
            Entry::Long {
                key_indent,
                target,
                source,
                kind,
            } => {
                if source.is_some() {
                    return Err(format!(
                        "The entry for {} already has a source.",
                        req.target
                    ));
                }
                if kind.as_deref().is_some_and(|k| k != "volume") {
                    return Err(format!("The entry for {} isn't a volume.", req.target));
                }
                let at = target.as_ref().map_or(item.start, |(i, _)| *i) + 1;
                doc.insert(
                    at,
                    format!("{}source: {}", spaces(*key_indent), scalar(&req.key, None)),
                );
                Ok(())
            }
            Entry::Other => Err(format!(
                "The entry for {} is written in a way this can't edit.",
                req.target
            )),
        };
    }
    let new_item = |indent: usize| format!("{}- {}", spaces(indent), scalar(&mount, None));
    match &svc.volumes {
        Some(v) => {
            if v.items.iter().any(|it| it.entry.uncertain()) {
                return Err(
                    "Another of the service's volume entries uses a variable or flow style, so it might be this one.".into(),
                );
            }
            if v.empty_flow {
                let line = &doc.lines[v.line];
                let (_, tail) = split_comment(line);
                doc.lines[v.line] = format!("{}volumes:{}", spaces(svc.child), tail);
            }
            let indent = v.item_indent.unwrap_or(svc.child + unit);
            doc.insert(v.last + 1, new_item(indent));
        }
        None => {
            let at = doc.last_content(svc.start, svc.end) + 1;
            doc.insert(at, format!("{}volumes:", spaces(svc.child)));
            doc.insert(at + 1, new_item(svc.child + unit));
        }
    }
    Ok(())
}

/// Adds `<key>:` with `name:` under the top-level `volumes:`.
fn add_volume(doc: &mut Doc, key: &str, name: &str) -> Result<(), String> {
    let unit = doc.unit();
    let n = doc.lines.len();
    let entry = |doc: &mut Doc, at: usize, indent: usize| {
        doc.insert(at, format!("{}{}:", spaces(indent), scalar(key, None)));
        doc.insert(
            at + 1,
            format!("{}name: {}", spaces(indent + unit), scalar(name, None)),
        );
    };
    match doc.key_at(0, n, 0, "volumes") {
        Some(t) => {
            let (_, v) = key_of(doc.trimmed(t)).unwrap_or_default();
            if v == "{}" {
                let (_, tail) = split_comment(&doc.lines[t]);
                doc.lines[t] = format!("volumes:{tail}");
            } else if !v.is_empty() {
                return Err(
                    "The top-level volumes are written in flow style or through an alias.".into(),
                );
            }
            let end = doc.block_end(t, 0);
            let indent = doc.next_content(t + 1, end).map_or(unit, |i| doc.indent(i));
            if doc.keys_at(t + 1, end, indent).iter().any(|k| k == key) {
                return Err(format!("The file already has a volume called {key}."));
            }
            let at = doc.last_content(t, end) + 1;
            entry(doc, at, indent);
        }
        None => {
            if doc.lines.last().is_some_and(|l| !l.trim().is_empty()) {
                doc.insert(n, String::new());
            }
            let at = doc.lines.len();
            doc.insert(at, "volumes:".into());
            entry(doc, at + 1, unit);
        }
    }
    Ok(())
}

/// What to add by hand for a request.
fn snippet(req: &NameRequest) -> String {
    format!(
        "services:\n  {}:\n    volumes:\n      - {}\nvolumes:\n  {}:\n    name: {}\n",
        scalar(&req.service, None),
        scalar(&format!("{}:{}", req.key, req.target), None),
        scalar(&req.key, None),
        scalar(&req.name, None)
    )
}

/// Applies the requests to the files (`(path, text)`, in `-f` order) and
/// returns each file's revised text, plus the requests left to do by hand.
///
/// The service's entry is edited where it's written; otherwise the last file
/// with the service's `volumes:` gets it, else the first file that defines
/// the service. The top-level entry goes in the same file.
pub fn revise(files: &[(String, String)], reqs: &[NameRequest]) -> (Vec<String>, Vec<Manual>) {
    let mut docs: Vec<Doc> = files.iter().map(|(_, t)| Doc::parse(t)).collect();
    let checks: Vec<Result<(), String>> = docs.iter().map(Doc::check).collect();
    let mut manual = vec![];
    for req in reqs {
        let mut refusal = None;
        let (mut matched, mut with_volumes, mut defines) = (None, None, None);
        for (i, doc) in docs.iter().enumerate() {
            if let Err(e) = &checks[i] {
                if doc.lines.iter().any(|l| l.contains(&req.service)) {
                    refusal.get_or_insert(format!("{}: {e}", files[i].0));
                }
                continue;
            }
            match service(doc, &req.service) {
                Ok(Some(svc)) => {
                    defines.get_or_insert(i);
                    if svc.volumes.is_some() {
                        with_volumes = Some(i);
                    }
                    if svc.entry_for(&req.target).is_some() {
                        matched = Some(i);
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    refusal.get_or_insert(e);
                }
            }
        }
        let result = match (refusal, matched.or(with_volumes).or(defines)) {
            (Some(e), _) => Err(e),
            (None, None) => Err(format!(
                "No compose file defines {} directly (it may come from include or extends).",
                req.service
            )),
            (None, Some(i)) => {
                let mut copy = docs[i].clone();
                let edited = service(&copy, &req.service)
                    .and_then(|s| s.ok_or_else(|| "The service went missing.".to_string()))
                    .and_then(|svc| name_in_service(&mut copy, &svc, req))
                    .and_then(|_| add_volume(&mut copy, &req.key, &req.name));
                edited.map(|_| docs[i] = copy)
            }
        };
        if let Err(reason) = result {
            manual.push(Manual {
                service: req.service.clone(),
                target: req.target.clone(),
                reason,
                snippet: snippet(req),
            });
        }
    }
    (docs.iter().map(Doc::text).collect(), manual)
}

/// The keys under the top-level `volumes:` of every file.
pub fn volume_keys(files: &[(String, String)]) -> BTreeSet<String> {
    files
        .iter()
        .flat_map(|(_, t)| Doc::parse(t).volume_keys())
        .collect()
}

fn valid_name(s: &str) -> bool {
    s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

/// Problems with the keys and names: badly formed, used twice, already a key
/// in the files, or already a volume on the engine.
pub fn check(
    reqs: &[NameRequest],
    file_keys: &BTreeSet<String>,
    volumes: &HashSet<String>,
) -> Vec<Issue> {
    let mut out = vec![];
    let bad = "Use letters, digits, _ . or -, starting with a letter or digit.";
    for (i, r) in reqs.iter().enumerate() {
        let issue = |field: &str, message: String| Issue {
            index: i,
            field: field.into(),
            message,
        };
        let twice = |f: fn(&NameRequest) -> &str| {
            reqs.iter().enumerate().any(|(j, o)| j != i && f(o) == f(r))
        };
        if !valid_name(&r.key) {
            out.push(issue("key", bad.into()));
        } else if twice(|r| &r.key) {
            out.push(issue("key", "Two volumes have this key.".into()));
        } else if file_keys.contains(&r.key) {
            out.push(issue(
                "key",
                format!("The compose files already have a volume called {}.", r.key),
            ));
        }
        if !valid_name(&r.name) {
            out.push(issue("name", bad.into()));
        } else if twice(|r| &r.name) {
            out.push(issue("name", "Two volumes have this name.".into()));
        } else if volumes.contains(&r.name) {
            out.push(issue(
                "name",
                format!("A volume called {} already exists.", r.name),
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(service: &str, target: &str, key: &str) -> NameRequest {
        NameRequest {
            service: service.into(),
            target: target.into(),
            key: key.into(),
            name: format!("shop-{key}"),
        }
    }

    fn one(text: &str, r: NameRequest) -> (String, Vec<Manual>) {
        let (mut out, manual) = revise(&[("compose.yml".into(), text.into())], &[r]);
        (out.remove(0), manual)
    }

    #[test]
    fn appends_to_a_block_list_and_adds_the_top_level_entry() {
        let text = "\
services:
  db:
    image: postgres:16
    volumes:
      - ./init:/docker-entrypoint-initdb.d # seed
    ports:
      - 5432:5432
";
        let (out, manual) = one(text, req("db", "/var/lib/postgresql/data", "db-data"));
        assert!(manual.is_empty(), "{manual:?}");
        assert_eq!(
            out,
            "\
services:
  db:
    image: postgres:16
    volumes:
      - ./init:/docker-entrypoint-initdb.d # seed
      - db-data:/var/lib/postgresql/data
    ports:
      - 5432:5432

volumes:
  db-data:
    name: shop-db-data
"
        );
    }

    #[test]
    fn creates_a_missing_volumes_key_at_the_files_indent() {
        let text =
            "services:\n    web:\n        image: nginx\n\n    worker:\n        image: busybox\n";
        let (out, manual) = one(text, req("web", "/var/cache/nginx", "web-nginx"));
        assert!(manual.is_empty());
        assert_eq!(
            out,
            "services:\n    web:\n        image: nginx\n        volumes:\n            - web-nginx:/var/cache/nginx\n\n    worker:\n        image: busybox\n\nvolumes:\n    web-nginx:\n        name: shop-web-nginx\n"
        );
    }

    #[test]
    fn replaces_a_short_entry_with_no_source() {
        let text = "services:\n  worker:\n    volumes:\n    - \"/tmp/cache\"  # scratch\n    - logs:/logs\nvolumes:\n  logs: {}\n";
        let (out, manual) = one(text, req("worker", "/tmp/cache", "worker-cache"));
        assert!(manual.is_empty());
        assert_eq!(
            out,
            "services:\n  worker:\n    volumes:\n    - \"worker-cache:/tmp/cache\"  # scratch\n    - logs:/logs\nvolumes:\n  logs: {}\n  worker-cache:\n    name: shop-worker-cache\n"
        );
    }

    #[test]
    fn gives_a_long_form_entry_a_source() {
        let text = "services:\n  app:\n    volumes:\n      - type: volume\n        target: /data\n        read_only: false\n";
        let (out, manual) = one(text, req("app", "/data/", "app-data"));
        assert!(manual.is_empty());
        assert!(
            out.contains(
                "        target: /data\n        source: app-data\n        read_only: false\n"
            ),
            "{out}"
        );
        let text = "services:\n  app:\n    volumes:\n      - target: /data\n        type: volume\n";
        let (out, _) = one(text, req("app", "/data", "app-data"));
        assert!(
            out.contains("      - target: /data\n        source: app-data\n        type: volume\n"),
            "{out}"
        );
    }

    #[test]
    fn fills_empty_volumes_and_inline_empties() {
        let text = "services:\n  a:\n    volumes: []\nvolumes: {} # none yet\n";
        let (out, manual) = one(text, req("a", "/x", "a-x"));
        assert!(manual.is_empty());
        assert_eq!(out, "services:\n  a:\n    volumes:\n      - a-x:/x\nvolumes: # none yet\n  a-x:\n    name: shop-a-x\n");
        let text = "services:\n  a:\n    volumes:\n    image: busybox\n";
        let (out, _) = one(text, req("a", "/x", "a-x"));
        assert!(
            out.starts_with("services:\n  a:\n    volumes:\n      - a-x:/x\n    image: busybox\n"),
            "{out}"
        );
    }

    #[test]
    fn keeps_crlf_and_a_missing_final_newline() {
        let text = "services:\r\n  a:\r\n    image: x\r\n    volumes:\r\n      - /x";
        let (out, _) = one(text, req("a", "/x", "a-x"));
        assert_eq!(out, "services:\r\n  a:\r\n    image: x\r\n    volumes:\r\n      - a-x:/x\r\n\r\nvolumes:\r\n  a-x:\r\n    name: shop-a-x\r\n");
    }

    #[test]
    fn lists_at_the_keys_indent_and_comments_inside() {
        let text = "services:\n  a:\n    volumes:\n    # cache\n    - /x\n    - y:/y\n# end of a\n  b:\n    image: x\n";
        let (out, manual) = one(text, req("a", "/z", "a-z"));
        assert!(manual.is_empty());
        assert!(out.starts_with("services:\n  a:\n    volumes:\n    # cache\n    - /x\n    - y:/y\n    - a-z:/z\n# end of a\n  b:\n"), "{out}");
    }

    #[test]
    fn picks_the_file_with_the_entry_else_the_service_volumes() {
        let base = ("compose.yml".to_string(), "services:\n  db:\n    image: postgres\n  web:\n    image: nginx\n    volumes:\n      - /cache\n".to_string());
        let over = (
            "compose.override.yml".to_string(),
            "services:\n  db:\n    volumes:\n      - ./seed:/seed\n".to_string(),
        );
        let files = [base, over];
        let (out, manual) = revise(
            &files,
            &[
                req("db", "/data", "db-data"),
                req("web", "/cache", "web-cache"),
            ],
        );
        assert!(manual.is_empty(), "{manual:?}");
        assert!(
            out[1].contains("      - db-data:/data\n")
                && out[1].contains("  db-data:\n    name: shop-db-data\n"),
            "{}",
            out[1]
        );
        assert!(
            out[0].contains("      - web-cache:/cache\n")
                && out[0].contains("  web-cache:\n")
                && !out[0].contains("db-data"),
            "{}",
            out[0]
        );
        // Only the base defines it: the base gets it.
        let (out, _) = revise(&files[..1], &[req("db", "/data", "db-data")]);
        assert!(
            out[0].contains("    image: postgres\n    volumes:\n      - db-data:/data\n  web:"),
            "{}",
            out[0]
        );
    }

    #[test]
    fn two_requests_in_one_file() {
        let text = "services:\n  a:\n    image: x\n";
        let (out, manual) = revise(
            &[("c.yml".into(), text.into())],
            &[req("a", "/x", "a-x"), req("a", "/y", "a-y")],
        );
        assert!(manual.is_empty());
        assert_eq!(out[0], "services:\n  a:\n    image: x\n    volumes:\n      - a-x:/x\n      - a-y:/y\n\nvolumes:\n  a-x:\n    name: shop-a-x\n  a-y:\n    name: shop-a-y\n");
    }

    #[test]
    fn refuses_what_it_cant_edit_safely() {
        let cases = [
            ("services:\n  a:\n    volumes: [\"/x\"]\n", "flow style"),
            ("services: {a: {image: x}}\n", "flow style"),
            (
                "x-base: &base\n  image: x\nservices:\n  a:\n    <<: *base\n",
                "merges",
            ),
            ("services:\n  a: &a\n    image: x\n", "anchor"),
            ("services:\n  a:\n    extends: base\n", "extends"),
            ("services:\n  a:\n    volumes: *vols\n", "anchor or alias"),
            (
                "services:\n  a:\n    volumes:\n      - ${DATA}\n",
                "variable",
            ),
            (
                "services:\n  a:\n    volumes:\n      - {type: volume, target: /x}\n",
                "variable or flow",
            ),
            (
                "services:\n  a:\n    image: x\n---\nservices:\n  b:\n    image: y\n",
                "more than one",
            ),
            (
                "services:\n  a:\n    volumes:\n      - type: tmpfs\n        target: /x\n",
                "isn't a volume",
            ),
            (
                "services:\n  a:\n    volumes:\n      - old:/x\n",
                "already has a source",
            ),
            (
                "services:\n  a:\n    image: x\nvolumes:\n  a-x:\n",
                "already has a volume",
            ),
            (
                "services:\n  a:\n    image: x\nvolumes: *v\n",
                "top-level volumes",
            ),
            (
                "services:\n  b:\n    image: x\n",
                "No compose file defines a",
            ),
        ];
        for (text, why) in cases {
            let (out, manual) = one(text, req("a", "/x", "a-x"));
            assert_eq!(out, text, "changed {text}");
            assert_eq!(manual.len(), 1, "{text}");
            assert!(
                manual[0].reason.contains(why),
                "{text}: {}",
                manual[0].reason
            );
            assert!(
                manual[0].snippet.contains("      - a-x:/x\n")
                    && manual[0].snippet.contains("    name: shop-a-x\n")
            );
        }
    }

    #[test]
    fn anchors_elsewhere_in_the_file_are_fine() {
        let text = "x-env: &env\n  TZ: UTC\nservices:\n  a:\n    environment: *env\n    image: x\n";
        let (out, manual) = one(text, req("a", "/x", "a-x"));
        assert!(manual.is_empty(), "{manual:?}");
        assert!(out.contains("    image: x\n    volumes:\n      - a-x:/x\n"));
    }

    #[test]
    fn quotes_what_needs_it() {
        assert_eq!(scalar("a-x:/x", None), "a-x:/x");
        assert_eq!(scalar("a:/my data", None), "\"a:/my data\"");
        assert_eq!(scalar("it's", Some('\'')), "'it''s'");
        assert_eq!(key_of("\"web\": # c"), Some(("web".into(), "".into())));
        assert_eq!(key_of("- /x"), None);
        assert_eq!(key_of("./a:/b"), None);
        assert_eq!(split_comment("/x  # note"), ("/x", "  # note"));
        assert_eq!(split_comment("\"a # b\" # c"), ("\"a # b\"", " # c"));
    }

    #[test]
    fn checks_keys_and_names() {
        let reqs = [
            req("a", "/x", "a-x"),
            req("b", "/y", "a-x"),
            req("c", "/z", "-bad"),
        ];
        let keys = BTreeSet::from(["logs".to_string()]);
        let vols = HashSet::from(["shop-a-x".to_string()]);
        let issues = check(&reqs, &keys, &vols);
        let says = |i: usize, f: &str| {
            issues
                .iter()
                .find(|x| x.index == i && x.field == f)
                .map(|x| x.message.clone())
        };
        assert_eq!(
            says(0, "key").as_deref(),
            Some("Two volumes have this key.")
        );
        assert_eq!(
            says(0, "name").as_deref(),
            Some("Two volumes have this name.")
        );
        assert!(says(2, "key").unwrap().starts_with("Use letters"));
        assert!(says(2, "name").is_none());
        let issues = check(&[req("a", "/x", "logs")], &keys, &vols);
        assert!(issues[0]
            .message
            .contains("already have a volume called logs"));
        let issues = check(&[req("a", "/x", "a-x")], &keys, &vols);
        assert_eq!(
            issues[0].message,
            "A volume called shop-a-x already exists."
        );
        assert_eq!(
            volume_keys(&[(
                "c".into(),
                "volumes:\n  logs:\n  data:\n    name: x\n".into()
            )]),
            BTreeSet::from(["data".into(), "logs".into()])
        );
    }
}
