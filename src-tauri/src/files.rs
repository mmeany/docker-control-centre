//! Sample section backend: list a folder, read the start of a text file.
//! Shows the usual shape of a module: plain async functions returning
//! `Result<T, AppError>`, serde types in camelCase, unit tests beside them.

use crate::error::AppError;
use serde::Serialize;

/// Most bytes a preview reads.
pub const PREVIEW_LIMIT: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// ISO 8601, UTC.
    pub modified: Option<String>,
    /// Dot-files (and, on Windows, files with the hidden attribute).
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub size: u64,
    pub truncated: bool,
    pub binary: bool,
}

pub fn home_dir() -> Option<String> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(|p| p.to_string_lossy().into_owned())
        .filter(|p| !p.is_empty())
}

#[cfg(windows)]
fn is_hidden(name: &str, meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    name.starts_with('.') || meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &std::fs::Metadata) -> bool {
    name.starts_with('.')
}

/// Folders first, then files, each by name (case-insensitive).
pub async fn list_dir(path: &str) -> Result<Vec<DirEntry>, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::invalid("Choose a folder"));
    }
    let mut rd = tokio::fs::read_dir(path)
        .await
        .map_err(|e| AppError::io(e, path))?;
    let mut out = Vec::new();
    while let Some(entry) = rd.next_entry().await.map_err(|e| AppError::io(e, path))? {
        let name = entry.file_name().to_string_lossy().into_owned();
        // Broken links and files that vanish mid-listing are skipped.
        let Ok(meta) = tokio::fs::metadata(entry.path()).await else {
            continue;
        };
        out.push(DirEntry {
            hidden: is_hidden(&name, &meta),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified: meta.modified().ok().map(crate::util::iso8601),
            name,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Reads up to `limit` bytes. Files with NUL bytes count as binary.
pub async fn read_text(path: &str, limit: usize) -> Result<TextFile, AppError> {
    use tokio::io::AsyncReadExt;
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| AppError::io(e, path))?;
    if meta.is_dir() {
        return Err(AppError::invalid(format!("{path} is a folder")));
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| AppError::io(e, path))?;
    let mut buf = Vec::with_capacity(limit.min(meta.len() as usize));
    file.take(limit as u64)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| AppError::io(e, path))?;
    let binary = buf.contains(&0);
    Ok(TextFile {
        text: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&buf).into_owned()
        },
        size: meta.len(),
        truncated: (buf.len() as u64) < meta.len(),
        binary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_folders_first_and_reads_text() {
        let dir = std::env::temp_dir().join(format!("tdt-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("b.txt"), "hello").unwrap();
        std::fs::write(dir.join("A.json"), "{\"a\":1}").unwrap();
        std::fs::write(dir.join(".hidden"), "x").unwrap();
        std::fs::write(dir.join("bin.dat"), [0u8, 1, 2]).unwrap();
        let p = dir.to_string_lossy();
        let list = list_dir(&p).await.unwrap();
        let names: Vec<&str> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", ".hidden", "A.json", "b.txt", "bin.dat"]);
        assert!(
            list[0].is_dir && list[1].hidden && list[3].size == 5 && list[3].modified.is_some()
        );

        let t = read_text(&dir.join("b.txt").to_string_lossy(), 3)
            .await
            .unwrap();
        assert_eq!(
            (t.text.as_str(), t.truncated, t.binary),
            ("hel", true, false)
        );
        assert!(
            read_text(&dir.join("bin.dat").to_string_lossy(), 100)
                .await
                .unwrap()
                .binary
        );
        assert!(read_text(&dir.join("sub").to_string_lossy(), 100)
            .await
            .is_err());
        let missing = list_dir(&dir.join("nope").to_string_lossy())
            .await
            .unwrap_err();
        assert_eq!(missing.kind, crate::error::ErrorKind::NotFound);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
