//! Just enough tar for Docker's archive API: a streaming reader (headers,
//! GNU long names, pax paths, file data) and a writer for copying files in.
//! The engine sends and expects plain (uncompressed) tar.

const BLOCK: usize = 512;

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// As stored, without a leading "./" or trailing "/".
    pub path: String,
    pub kind: Kind,
    pub size: u64,
    /// Unix seconds.
    pub mtime: i64,
    pub mode: u32,
    pub link: String,
}

/// What the reader reports as bytes arrive.
pub enum Event<'a> {
    Entry(Entry),
    /// Part of the current entry's contents.
    Data(&'a [u8]),
}

enum State {
    Header,
    /// Contents of the current entry, then padding.
    Data {
        left: u64,
        pad: usize,
    },
    /// Contents of a long-name or pax record, gathered for the next header.
    Meta {
        left: u64,
        pad: usize,
        gnu: bool,
        buf: Vec<u8>,
    },
    Done,
}

/// Feed it chunks in order; it calls back with entries and their data.
pub struct Reader {
    state: State,
    header: Vec<u8>,
    long_name: Option<String>,
    long_link: Option<String>,
    pax_path: Option<String>,
}

impl Default for Reader {
    fn default() -> Self {
        Reader {
            state: State::Header,
            header: Vec::with_capacity(BLOCK),
            long_name: None,
            long_link: None,
            pax_path: None,
        }
    }
}

fn padding(size: u64) -> usize {
    ((BLOCK as u64 - size % BLOCK as u64) % BLOCK as u64) as usize
}

fn text(b: &[u8]) -> String {
    let end = b.iter().position(|c| *c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

/// Octal, or GNU base-256 when the top bit is set.
fn number(b: &[u8]) -> u64 {
    if b.first().is_some_and(|c| c & 0x80 != 0) {
        return b[1..]
            .iter()
            .fold((b[0] & 0x7f) as u64, |n, c| (n << 8) | *c as u64);
    }
    let s = text(b);
    u64::from_str_radix(s.trim().trim_matches(' '), 8).unwrap_or(0)
}

/// Docker names a folder's entries `<name>/…`, but the root's `/…`.
fn clean(path: &str) -> String {
    path.trim_start_matches("./")
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
#[test]
fn strips_leading_slashes_and_dots() {
    assert_eq!(clean("/"), "");
    assert_eq!(clean("/.dockerenv"), ".dockerenv");
    assert_eq!(clean("./etc/"), "etc");
    assert_eq!(clean("etc/hosts"), "etc/hosts");
}

/// "30 path=a/b\n" records: the path one, if any.
fn pax_path(records: &[u8]) -> Option<String> {
    String::from_utf8_lossy(records).lines().find_map(|l| {
        l.split_once(' ')
            .and_then(|(_, kv)| kv.strip_prefix("path="))
            .map(String::from)
    })
}

impl Reader {
    pub fn is_done(&self) -> bool {
        matches!(self.state, State::Done)
    }

    pub fn feed(&mut self, mut chunk: &[u8], f: &mut impl FnMut(Event)) {
        while !chunk.is_empty() {
            match &mut self.state {
                State::Done => return,
                State::Header => {
                    let take = (BLOCK - self.header.len()).min(chunk.len());
                    self.header.extend_from_slice(&chunk[..take]);
                    chunk = &chunk[take..];
                    if self.header.len() == BLOCK {
                        let h = std::mem::take(&mut self.header);
                        self.header.reserve(BLOCK);
                        self.on_header(&h, f);
                    }
                }
                State::Data { left, pad } => {
                    if *left > 0 {
                        let take = (*left).min(chunk.len() as u64) as usize;
                        f(Event::Data(&chunk[..take]));
                        *left -= take as u64;
                        chunk = &chunk[take..];
                    } else {
                        let take = (*pad).min(chunk.len());
                        *pad -= take;
                        chunk = &chunk[take..];
                        if *pad == 0 {
                            self.state = State::Header;
                        }
                    }
                }
                State::Meta {
                    left,
                    pad,
                    gnu,
                    buf,
                } => {
                    if *left > 0 {
                        let take = (*left).min(chunk.len() as u64) as usize;
                        buf.extend_from_slice(&chunk[..take]);
                        *left -= take as u64;
                        chunk = &chunk[take..];
                    } else {
                        let take = (*pad).min(chunk.len());
                        *pad -= take;
                        chunk = &chunk[take..];
                        if *pad == 0 {
                            let (gnu, buf) = (*gnu, std::mem::take(buf));
                            if gnu {
                                self.long_name = Some(text(&buf));
                            } else if let Some(p) = pax_path(&buf) {
                                self.pax_path = Some(p);
                            }
                            self.state = State::Header;
                        }
                    }
                }
            }
            if let State::Data { left: 0, pad: 0 }
            | State::Meta {
                left: 0, pad: 0, ..
            } = self.state
            {
                // Zero-length body: the next block is already a header.
                if let State::Meta { gnu, ref buf, .. } = self.state {
                    if gnu {
                        self.long_name = Some(text(buf));
                    } else if let Some(p) = pax_path(buf) {
                        self.pax_path = Some(p);
                    }
                }
                self.state = State::Header;
            }
        }
    }

    fn on_header(&mut self, h: &[u8], f: &mut impl FnMut(Event)) {
        if h.iter().all(|b| *b == 0) {
            self.state = State::Done;
            return;
        }
        let size = number(&h[124..136]);
        let flag = h[156];
        match flag {
            b'L' | b'K' => {
                // GNU long name ('K': long link name; kept with the name for simplicity).
                let gnu = flag == b'L';
                if !gnu {
                    self.long_link = None;
                }
                self.state = State::Meta {
                    left: size,
                    pad: padding(size),
                    gnu,
                    buf: vec![],
                };
                return;
            }
            b'x' | b'g' => {
                self.state = State::Meta {
                    left: size,
                    pad: padding(size),
                    gnu: false,
                    buf: vec![],
                };
                return;
            }
            _ => {}
        }
        let name = text(&h[0..100]);
        let ustar = &h[257..262] == b"ustar";
        let prefix = if ustar {
            text(&h[345..500])
        } else {
            String::new()
        };
        let stored = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let path = self
            .pax_path
            .take()
            .or(self.long_name.take())
            .unwrap_or(stored);
        let kind = match flag {
            b'0' | 0 | b'7' => Kind::File,
            b'5' => Kind::Dir,
            b'2' => Kind::Symlink,
            _ => Kind::Other,
        };
        let entry = Entry {
            kind,
            size,
            mtime: number(&h[136..148]) as i64,
            mode: number(&h[100..108]) as u32,
            link: self.long_link.take().unwrap_or_else(|| text(&h[157..257])),
            path: clean(&path),
        };
        f(Event::Entry(entry));
        // Directories, links etc. carry no data even if size is set oddly.
        let body = if matches!(flag, b'0' | 0 | b'7') {
            size
        } else {
            0
        };
        self.state = State::Data {
            left: body,
            pad: padding(body),
        };
    }
}

// ---------------------------------------------------------------------------
// Writing

fn put_octal(h: &mut [u8], at: usize, len: usize, n: u64) {
    let s = format!("{:0width$o}", n, width = len - 1);
    h[at..at + len - 1].copy_from_slice(s.as_bytes());
    h[at + len - 1] = 0;
}

fn header(name: &str, size: u64, mtime: u64, mode: u32, flag: u8) -> [u8; BLOCK] {
    let mut h = [0u8; BLOCK];
    let n = name.as_bytes();
    h[..n.len().min(100)].copy_from_slice(&n[..n.len().min(100)]);
    put_octal(&mut h, 100, 8, mode as u64);
    put_octal(&mut h, 108, 8, 0);
    put_octal(&mut h, 116, 8, 0);
    put_octal(&mut h, 124, 12, size);
    put_octal(&mut h, 136, 12, mtime);
    h[156] = flag;
    h[257..263].copy_from_slice(b"ustar\0");
    h[263..265].copy_from_slice(b"00");
    // Checksum: sum of the header with the checksum field as spaces.
    h[148..156].copy_from_slice(b"        ");
    let sum: u32 = h.iter().map(|b| *b as u32).sum();
    let s = format!("{sum:06o}\0 ");
    h[148..156].copy_from_slice(s.as_bytes());
    h
}

/// Builds an archive in memory.
#[derive(Default)]
pub struct Writer {
    out: Vec<u8>,
}

impl Writer {
    fn name(&mut self, path: &str, flag_for_long: u8) -> String {
        if path.len() < 100 {
            return path.to_string();
        }
        // GNU long name record, then a truncated name in the real header.
        let mut data = path.as_bytes().to_vec();
        data.push(0);
        self.out.extend_from_slice(&header(
            "././@LongLink",
            data.len() as u64,
            0,
            0o644,
            flag_for_long,
        ));
        self.block(&data);
        path[..99].to_string()
    }

    fn block(&mut self, data: &[u8]) {
        self.out.extend_from_slice(data);
        self.out
            .extend(std::iter::repeat_n(0u8, padding(data.len() as u64)));
    }

    pub fn dir(&mut self, path: &str, mtime: u64) {
        let p = format!("{}/", path.trim_end_matches('/'));
        let name = self.name(&p, b'L');
        self.out
            .extend_from_slice(&header(&name, 0, mtime, 0o755, b'5'));
    }

    pub fn file(&mut self, path: &str, data: &[u8], mtime: u64, mode: u32) {
        let name = self.name(path, b'L');
        self.out
            .extend_from_slice(&header(&name, data.len() as u64, mtime, mode, b'0'));
        self.block(data);
    }

    pub fn len(&self) -> usize {
        self.out.len()
    }

    pub fn finish(mut self) -> Vec<u8> {
        self.out.extend_from_slice(&[0u8; BLOCK * 2]);
        self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads a whole archive, in chunks of `step` bytes.
    fn read(bytes: &[u8], step: usize) -> Vec<(Entry, Vec<u8>)> {
        let mut r = Reader::default();
        let mut out: Vec<(Entry, Vec<u8>)> = vec![];
        for chunk in bytes.chunks(step) {
            r.feed(chunk, &mut |e| match e {
                Event::Entry(e) => out.push((e, vec![])),
                Event::Data(d) => out.last_mut().unwrap().1.extend_from_slice(d),
            });
        }
        assert!(r.is_done());
        out
    }

    #[test]
    fn round_trips_files_dirs_and_long_names() {
        let long = format!("deep/{}/file.txt", "x".repeat(120));
        let mut w = Writer::default();
        w.dir("deep", 1_700_000_000);
        w.file("deep/hello.txt", b"hello", 1_700_000_001, 0o644);
        w.file(&long, &vec![7u8; 1500], 1_700_000_002, 0o600);
        w.file("empty", b"", 0, 0o644);
        let bytes = w.finish();
        assert_eq!(bytes.len() % BLOCK, 0);
        for step in [1, 7, 511, 512, 513, 100_000] {
            let got = read(&bytes, step);
            assert_eq!(got.len(), 4, "step {step}");
            assert_eq!(
                (got[0].0.path.as_str(), &got[0].0.kind),
                ("deep", &Kind::Dir)
            );
            assert_eq!(
                (got[1].0.path.as_str(), got[1].1.as_slice()),
                ("deep/hello.txt", b"hello".as_slice())
            );
            assert_eq!(got[1].0.mtime, 1_700_000_001);
            assert_eq!(got[2].0.path, long);
            assert_eq!(got[2].1.len(), 1500);
            assert_eq!(got[2].0.mode, 0o600);
            assert_eq!((got[3].0.path.as_str(), got[3].1.len()), ("empty", 0));
        }
    }

    #[test]
    fn reads_pax_paths_and_symlinks() {
        let mut bytes = vec![];
        let rec = "27 path=a/very/long/name\n";
        bytes.extend_from_slice(&header("PaxHeaders/x", rec.len() as u64, 0, 0o644, b'x'));
        let mut data = rec.as_bytes().to_vec();
        data.resize(BLOCK, 0);
        bytes.extend_from_slice(&data);
        bytes.extend_from_slice(&header("short", 0, 0, 0o644, b'0'));
        let mut link = header("./lnk", 0, 0, 0o777, b'2');
        link[157..163].copy_from_slice(b"target");
        // Fix the checksum after editing.
        link[148..156].copy_from_slice(b"        ");
        let sum: u32 = link.iter().map(|b| *b as u32).sum();
        link[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        bytes.extend_from_slice(&link);
        bytes.extend_from_slice(&[0u8; BLOCK * 2]);
        let got = read(&bytes, 300);
        assert_eq!(got[0].0.path, "a/very/long/name");
        assert_eq!(
            (
                got[1].0.path.as_str(),
                &got[1].0.kind,
                got[1].0.link.as_str()
            ),
            ("lnk", &Kind::Symlink, "target")
        );
    }

    #[test]
    fn reads_base256_sizes() {
        let mut b = [0u8; 12];
        b[0] = 0x80;
        b[11] = 0x05;
        b[10] = 0x01;
        assert_eq!(number(&b), 0x0105);
        assert_eq!(number(b"0000644\0"), 0o644);
    }
}
