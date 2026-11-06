//! Files inside a container. Listing runs a small sh script through exec
//! (fast, any size of folder); when the container isn't running or has no
//! shell (distroless, scratch), it reads the folder from the archive API
//! instead, up to a size cap. Copying out and in use the archive API.

use crate::engine::map_error;
use crate::error::{AppError, ErrorKind};
use crate::tar::{self, Event, Kind};
use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
use bollard::query_parameters::{
    DownloadFromContainerOptionsBuilder, UploadToContainerOptionsBuilder,
};
use bollard::Docker;
use futures_util::StreamExt;
use serde::Serialize;
use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// file, dir, link (to a file), linkDir (to a folder), other.
    pub kind: String,
    pub size: u64,
    /// ISO 8601 UTC; "" if unknown.
    pub modified: String,
    /// "-rw-r--r--" (exec) or octal "644" (archive).
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    /// "exec" or "archive".
    pub method: String,
    /// The archive was bigger than the cap: some entries may be missing.
    pub truncated: bool,
}

/// Lists one folder: name|size|mtime|perms per entry, NUL-terminated.
/// Exit 2: no such folder; 3: no stat; 4: exists but can't open as a folder.
const LIST_SCRIPT: &str = r#"cd -- "$1" 2>/dev/null || { [ -e "$1" ] && exit 4; exit 2; }
command -v stat >/dev/null 2>&1 || exit 3
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  t=f; [ -d "$f" ] && t=d; [ -L "$f" ] && t="l$t"
  s=$(stat -c '%s|%Y|%A' -- "$f" 2>/dev/null) || s='0|0|?'
  printf '%s|%s|%s\000' "$t" "$s" "$f"
done"#;

/// Most bytes read from the archive when listing without a shell.
pub const ARCHIVE_CAP: usize = 64 * 1024 * 1024;

fn iso(secs: i64) -> String {
    u64::try_from(secs)
        .ok()
        .filter(|s| *s > 0)
        .map(|s| crate::util::iso8601(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(s)))
        .unwrap_or_default()
}

/// Parses the script's output.
pub fn parse_listing(out: &[u8]) -> Vec<FileEntry> {
    let mut v: Vec<FileEntry> = out
        .split(|b| *b == 0)
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let r = String::from_utf8_lossy(r);
            let mut parts = r.splitn(5, '|');
            let t = parts.next()?;
            let size = parts.next()?.parse().unwrap_or(0);
            let mtime = parts.next()?.parse().unwrap_or(0);
            let mode = parts.next()?.to_string();
            let name = parts.next()?.trim_start_matches('\n').to_string();
            let kind = match t {
                "d" => "dir",
                "f" => {
                    if mode.starts_with('-') || mode == "?" {
                        "file"
                    } else {
                        "other"
                    }
                }
                "ld" => "linkDir",
                "lf" => "link",
                _ => "other",
            };
            Some(FileEntry {
                name,
                kind: kind.into(),
                size,
                modified: iso(mtime),
                mode,
            })
        })
        .collect();
    sort_entries(&mut v);
    v
}

/// Folders first, then by name.
fn sort_entries(v: &mut [FileEntry]) {
    v.sort_by(|a, b| {
        let fa = matches!(a.kind.as_str(), "dir" | "linkDir");
        let fb = matches!(b.kind.as_str(), "dir" | "linkDir");
        fb.cmp(&fa)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// Children of `path` among an archive's entries. Docker names entries
/// `<basename>/…` for a folder and `…` (relative) for "/".
pub fn children_from_archive(path: &str, entries: &[tar::Entry]) -> Vec<FileEntry> {
    let base = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let mut out: Vec<FileEntry> = entries
        .iter()
        .filter_map(|e| {
            let rel = if base.is_empty() {
                e.path.as_str()
            } else {
                e.path.strip_prefix(base)?.strip_prefix('/')?
            };
            if rel.is_empty() || rel.contains('/') {
                return None;
            }
            let kind = match e.kind {
                Kind::Dir => "dir",
                Kind::File => "file",
                Kind::Symlink => "link",
                Kind::Other => "other",
            };
            Some(FileEntry {
                name: rel.to_string(),
                kind: kind.into(),
                size: e.size,
                modified: iso(e.mtime),
                mode: format!("{:o}", e.mode & 0o7777),
            })
        })
        .collect();
    sort_entries(&mut out);
    out
}

/// Normalises a container path: absolute, no "..", no trailing slash.
pub fn clean_path(p: &str) -> Result<String, AppError> {
    let mut parts = vec![];
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => return Err(AppError::invalid("Paths can't go up with ..")),
            s => parts.push(s),
        }
    }
    Ok(format!("/{}", parts.join("/")))
}

enum ExecList {
    Done(Vec<FileEntry>),
    /// No usable shell or stat: use the archive.
    Fallback,
}

async fn list_exec(
    docker: &Docker,
    id: &str,
    path: &str,
) -> Result<ExecList, bollard::errors::Error> {
    let opts = CreateExecOptions::<String> {
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        cmd: Some(vec![
            "sh".into(),
            "-c".into(),
            LIST_SCRIPT.into(),
            "sh".into(),
            path.into(),
        ]),
        ..Default::default()
    };
    let exec = match docker.create_exec(id, opts).await {
        Ok(e) => e.id,
        // The engine refuses up front when there's no sh at all.
        Err(bollard::errors::Error::DockerResponseServerError {
            status_code: 409 | 500,
            ..
        }) => return Ok(ExecList::Fallback),
        Err(e) => return Err(e),
    };
    let started = docker
        .start_exec(
            &exec,
            Some(StartExecOptions {
                detach: false,
                tty: false,
                output_capacity: None,
            }),
        )
        .await?;
    let mut out = vec![];
    if let StartExecResults::Attached { mut output, .. } = started {
        while let Some(frame) = output.next().await {
            if let Ok(bollard::container::LogOutput::StdOut { message }) = frame {
                out.extend_from_slice(&message);
            }
        }
    }
    match docker.inspect_exec(&exec).await?.exit_code {
        Some(0) => Ok(ExecList::Done(parse_listing(&out))),
        Some(2) => Err(bollard::errors::Error::DockerResponseServerError {
            status_code: 404,
            message: format!("{path} doesn't exist."),
        }),
        Some(4) => Err(bollard::errors::Error::DockerResponseServerError {
            status_code: 403,
            message: format!("{path} isn't a folder you can open."),
        }),
        // 3: no stat; 126 / 127: no sh.
        _ => Ok(ExecList::Fallback),
    }
}

async fn list_archive(
    docker: &Docker,
    id: &str,
    path: &str,
) -> Result<Listing, bollard::errors::Error> {
    let opts = DownloadFromContainerOptionsBuilder::new()
        .path(path)
        .build();
    let mut stream = Box::pin(docker.download_from_container(id, Some(opts)));
    let mut reader = tar::Reader::default();
    let mut entries = vec![];
    let mut read = 0usize;
    let mut truncated = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        read += chunk.len();
        reader.feed(&chunk, &mut |e| {
            if let Event::Entry(e) = e {
                entries.push(e);
            }
        });
        if reader.is_done() {
            break;
        }
        if read > ARCHIVE_CAP {
            truncated = true;
            break;
        }
    }
    Ok(Listing {
        path: path.into(),
        entries: children_from_archive(path, &entries),
        method: "archive".into(),
        truncated,
    })
}

pub async fn list(
    docker: &Docker,
    id: &str,
    path: &str,
    running: bool,
) -> Result<Listing, bollard::errors::Error> {
    if running {
        if let ExecList::Done(entries) = list_exec(docker, id, path).await? {
            return Ok(Listing {
                path: path.into(),
                entries,
                method: "exec".into(),
                truncated: false,
            });
        }
    }
    list_archive(docker, id, path).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    /// "file": the file itself was saved; "tar": a folder, saved as an archive.
    pub saved_as: String,
    pub bytes: u64,
}

/// Saves a file from the container to `dest`, or a folder as a .tar archive.
pub async fn copy_out(
    docker: &Docker,
    id: &str,
    path: &str,
    dest: &Path,
) -> Result<CopyResult, AppError> {
    use tokio::io::AsyncWriteExt;
    let opts = DownloadFromContainerOptionsBuilder::new()
        .path(path)
        .build();
    let mut stream = Box::pin(docker.download_from_container(id, Some(opts)));
    let target = dest.display().to_string();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::io(e, &target))?;
    let mut reader = tar::Reader::default();
    // The first entry decides: a regular file is unpacked; anything else
    // (a folder) is saved as the archive itself. Until then, keep the bytes.
    let mut unpack: Option<bool> = None;
    let mut held: Vec<u8> = vec![];
    let mut entries = 0usize;
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| map_error("", e))?;
        if unpack == Some(false) {
            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::io(e, &target))?;
            written += chunk.len() as u64;
            continue;
        }
        if unpack.is_none() {
            held.extend_from_slice(&chunk);
        }
        let mut data: Vec<u8> = vec![];
        reader.feed(&chunk, &mut |e| match e {
            Event::Entry(e) => {
                entries += 1;
                if unpack.is_none() {
                    unpack = Some(e.kind == Kind::File);
                }
            }
            Event::Data(d) if entries == 1 => data.extend_from_slice(d),
            Event::Data(_) => {}
        });
        match unpack {
            Some(false) => {
                let all = std::mem::take(&mut held);
                file.write_all(&all)
                    .await
                    .map_err(|e| AppError::io(e, &target))?;
                written += all.len() as u64;
            }
            Some(true) => {
                held.clear();
                file.write_all(&data)
                    .await
                    .map_err(|e| AppError::io(e, &target))?;
                written += data.len() as u64;
                if reader.is_done() || entries > 1 {
                    break;
                }
            }
            None => {}
        }
    }
    file.flush().await.map_err(|e| AppError::io(e, &target))?;
    Ok(CopyResult {
        saved_as: if unpack == Some(true) { "file" } else { "tar" }.into(),
        bytes: written,
    })
}

/// Largest total copied in at once (it's built in memory).
pub const COPY_IN_CAP: usize = 512 * 1024 * 1024;

fn mtime(m: &std::fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn add(w: &mut tar::Writer, src: &Path, name: &str, count: &mut usize) -> Result<(), AppError> {
    let meta = std::fs::metadata(src).map_err(|e| AppError::io(e, &src.display().to_string()))?;
    if meta.is_dir() {
        w.dir(name, mtime(&meta));
        let mut kids: Vec<_> = std::fs::read_dir(src)
            .map_err(|e| AppError::io(e, &src.display().to_string()))?
            .flatten()
            .collect();
        kids.sort_by_key(|k| k.file_name());
        for k in kids {
            add(
                w,
                &k.path(),
                &format!("{name}/{}", k.file_name().to_string_lossy()),
                count,
            )?;
        }
    } else {
        let data = std::fs::read(src).map_err(|e| AppError::io(e, &src.display().to_string()))?;
        w.file(name, &data, mtime(&meta), 0o644);
        *count += 1;
    }
    if w.len() > COPY_IN_CAP {
        return Err(AppError::new(
            ErrorKind::Invalid,
            "That's more than 512 MB; copy it in smaller parts.",
        ));
    }
    Ok(())
}

/// Builds the archive for copying `sources` (files or folders) into a folder.
pub fn pack(sources: &[String]) -> Result<(Vec<u8>, usize), AppError> {
    let mut w = tar::Writer::default();
    let mut count = 0;
    for s in sources {
        let p = Path::new(s);
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| AppError::invalid(format!("{s} has no file name.")))?;
        add(&mut w, p, &name, &mut count)?;
    }
    Ok((w.finish(), count))
}

pub async fn copy_in(
    docker: &Docker,
    id: &str,
    dir: &str,
    archive: Vec<u8>,
) -> Result<(), bollard::errors::Error> {
    let opts = UploadToContainerOptionsBuilder::new().path(dir).build();
    docker
        .upload_to_container(
            id,
            Some(opts),
            bollard::body_full(bytes::Bytes::from(archive)),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_script_output() {
        let out = b"d|4096|1793016245|drwxr-xr-x|etc\0f|12|0|-rw-r--r--|a|b.txt\0lf|7|1|lrwxrwxrwx|link\0ld|7|1|lrwxrwxrwx|cfg\0f|0|0|crw-rw-rw-|null\0";
        let v = parse_listing(out);
        let names: Vec<(&str, &str)> = v
            .iter()
            .map(|e| (e.name.as_str(), e.kind.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![
                ("cfg", "linkDir"),
                ("etc", "dir"),
                ("a|b.txt", "file"),
                ("link", "link"),
                ("null", "other")
            ]
        );
        assert_eq!(v[1].modified, "2026-10-26T12:04:05Z");
        assert_eq!(v[2].size, 12);
    }

    fn e(path: &str, kind: Kind) -> tar::Entry {
        tar::Entry {
            path: path.into(),
            kind,
            size: 1,
            mtime: 0,
            mode: 0o644,
            link: String::new(),
        }
    }

    #[test]
    fn finds_children_in_an_archive() {
        let entries = [
            e("etc", Kind::Dir),
            e("etc/hosts", Kind::File),
            e("etc/nginx", Kind::Dir),
            e("etc/nginx/nginx.conf", Kind::File),
        ];
        let kids = children_from_archive("/etc", &entries);
        assert_eq!(
            kids.iter().map(|k| k.name.as_str()).collect::<Vec<_>>(),
            vec!["nginx", "hosts"]
        );
        let root = [
            e("bin", Kind::Dir),
            e("bin/sh", Kind::File),
            e("app", Kind::File),
        ];
        assert_eq!(
            children_from_archive("/", &root)
                .iter()
                .map(|k| k.name.as_str())
                .collect::<Vec<_>>(),
            vec!["bin", "app"]
        );
    }

    #[test]
    fn cleans_paths() {
        assert_eq!(clean_path("etc//nginx/./").unwrap(), "/etc/nginx");
        assert_eq!(clean_path("").unwrap(), "/");
        assert!(clean_path("/etc/../root").is_err());
    }

    #[test]
    fn packs_files_and_folders() {
        let dir = std::env::temp_dir().join(format!("dcc-pack-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("x.txt"), "x").unwrap();
        std::fs::write(dir.join("top.txt"), "top").unwrap();
        let (bytes, count) = pack(&[dir.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(count, 2);
        let mut names = vec![];
        let mut r = tar::Reader::default();
        r.feed(&bytes, &mut |ev| {
            if let Event::Entry(en) = ev {
                names.push(en.path);
            }
        });
        let base = dir.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(
            names,
            vec![
                base.clone(),
                format!("{base}/sub"),
                format!("{base}/sub/x.txt"),
                format!("{base}/top.txt")
            ]
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}

/// Against a real engine (`cargo test --features integration`).
#[cfg(all(test, feature = "integration"))]
mod integration {
    use super::*;
    use crate::engine::Engine;
    use bollard::models::ContainerCreateBody;
    use bollard::query_parameters::{
        CreateContainerOptionsBuilder, CreateImageOptionsBuilder, RemoveContainerOptionsBuilder,
        RemoveImageOptionsBuilder,
    };

    async fn create(docker: &Docker, name: &str, image: &str, cmd: Option<Vec<String>>) -> String {
        let body = ContainerCreateBody {
            image: Some(image.into()),
            cmd,
            ..Default::default()
        };
        docker
            .create_container(
                Some(CreateContainerOptionsBuilder::new().name(name).build()),
                body,
            )
            .await
            .expect("create")
            .id
    }

    async fn remove(docker: &Docker, id: &str) {
        docker
            .remove_container(
                id,
                Some(RemoveContainerOptionsBuilder::new().force(true).build()),
            )
            .await
            .expect("remove");
    }

    #[tokio::test]
    async fn browse_and_copy_with_a_shell() {
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        if docker.inspect_image("python:3.12-slim").await.is_err() {
            eprintln!("skipped: python:3.12-slim isn't on this engine");
            return;
        }
        let id = create(
            docker,
            &format!("dcc-files-{}", std::process::id()),
            "python:3.12-slim",
            Some(vec!["sleep".into(), "300".into()]),
        )
        .await;
        docker.start_container(&id, None).await.expect("start");

        let etc = list(docker, &id, "/etc", true).await.expect("list /etc");
        assert_eq!(etc.method, "exec");
        assert!(
            etc.entries
                .iter()
                .any(|e| e.name == "hosts" && e.kind == "file"),
            "{:?}",
            etc.entries
        );
        assert!(etc.entries.iter().any(|e| e.kind == "dir"));
        let root = list(docker, &id, "/", true).await.expect("list /");
        assert!(root
            .entries
            .iter()
            .any(|e| e.name == "bin" && (e.kind == "linkDir" || e.kind == "dir")));
        assert!(list(docker, &id, "/no/such/dir", true).await.is_err());

        // Copy in: a folder and a file from this computer.
        let src = std::env::temp_dir().join(format!("dcc-copyin-{}", std::process::id()));
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("sub").join("note.txt"), "hello from windows").unwrap();
        let (archive, count) = pack(&[src.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(count, 1);
        copy_in(docker, &id, "/tmp", archive)
            .await
            .expect("copy in");
        let base = src.file_name().unwrap().to_string_lossy().into_owned();
        let tmp = list(docker, &id, &format!("/tmp/{base}/sub"), true)
            .await
            .expect("list copied");
        assert_eq!(
            tmp.entries
                .iter()
                .map(|e| e.name.as_str())
                .collect::<Vec<_>>(),
            vec!["note.txt"]
        );

        // Copy out: the file as itself, the folder as an archive.
        let out = src.join("out.txt");
        let r = copy_out(docker, &id, &format!("/tmp/{base}/sub/note.txt"), &out)
            .await
            .expect("copy out");
        assert_eq!(r.saved_as, "file");
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "hello from windows");
        let out_tar = src.join("out.tar");
        let r = copy_out(docker, &id, &format!("/tmp/{base}"), &out_tar)
            .await
            .expect("copy folder");
        assert_eq!(r.saved_as, "tar");
        let mut names = vec![];
        tar::Reader::default().feed(&std::fs::read(&out_tar).unwrap(), &mut |e| {
            if let Event::Entry(e) = e {
                names.push(e.path);
            }
        });
        assert!(names.contains(&format!("{base}/sub/note.txt")), "{names:?}");

        // The archive listing agrees with exec.
        let via_archive = list(docker, &id, "/etc", false)
            .await
            .expect("archive /etc");
        assert_eq!(via_archive.method, "archive");
        let exec_names: Vec<_> = etc.entries.iter().map(|e| &e.name).collect();
        let archive_names: Vec<_> = via_archive.entries.iter().map(|e| &e.name).collect();
        assert_eq!(exec_names, archive_names);

        remove(docker, &id).await;
        std::fs::remove_dir_all(&src).ok();
    }

    #[tokio::test]
    async fn browse_without_a_shell() {
        let _hello = crate::engine::hello_world_lock().await;
        let engine = Engine::from_env();
        let docker = engine.docker().expect("client");
        let had = docker.inspect_image("hello-world:latest").await.is_ok();
        if !had {
            let opts = CreateImageOptionsBuilder::new()
                .from_image("hello-world")
                .tag("latest")
                .build();
            let mut pull = Box::pin(docker.create_image(Some(opts), None, None));
            while let Some(e) = pull.next().await {
                e.expect("pull hello-world");
            }
        }
        let id = create(
            docker,
            &format!("dcc-noshell-{}", std::process::id()),
            "hello-world:latest",
            None,
        )
        .await;
        // Exec can't work here (not running, no shell): it falls back to the archive.
        let root = list(docker, &id, "/", true).await.expect("list /");
        assert_eq!(root.method, "archive");
        assert!(
            root.entries
                .iter()
                .any(|e| e.name == "hello" && e.kind == "file"),
            "{:?}",
            root.entries
        );
        remove(docker, &id).await;
        if !had {
            docker
                .remove_image(
                    "hello-world:latest",
                    Some(RemoveImageOptionsBuilder::new().build()),
                    None,
                )
                .await
                .expect("remove image");
        }
    }
}
