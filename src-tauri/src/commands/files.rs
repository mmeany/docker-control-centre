//! Commands for the sample "Local files" section.

use crate::error::AppError;
use crate::files::{self, DirEntry, TextFile};

#[tauri::command]
pub fn home_dir() -> Option<String> {
    files::home_dir()
}

#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<DirEntry>, AppError> {
    files::list_dir(&path).await
}

#[tauri::command]
pub async fn read_text(path: String) -> Result<TextFile, AppError> {
    files::read_text(&path, files::PREVIEW_LIMIT).await
}
