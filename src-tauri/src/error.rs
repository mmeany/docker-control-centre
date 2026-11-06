//! Errors returned to the UI: a kind it can switch on, a short message and
//! the full detail (shown under "Details").

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // not every kind is used by every app
pub enum ErrorKind {
    NotFound,
    AccessDenied,
    /// Bad input from the UI (validation failed).
    Invalid,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: ErrorKind,
    /// Short human message for the UI.
    pub message: String,
    /// Full error text.
    pub detail: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            kind,
            detail: message.clone(),
            message,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Invalid, message)
    }

    /// An I/O error about `what` (a path, usually), classified by kind.
    #[allow(dead_code)] // shared helper for sections that touch files
    pub fn io(err: std::io::Error, what: &str) -> Self {
        use std::io::ErrorKind as K;
        let (kind, message) = match err.kind() {
            K::NotFound => (ErrorKind::NotFound, format!("{what} doesn't exist.")),
            K::PermissionDenied => (
                ErrorKind::AccessDenied,
                format!("You don't have permission to open {what}."),
            ),
            _ => (ErrorKind::Other, format!("Couldn't open {what}: {err}")),
        };
        Self {
            kind,
            message,
            detail: err.to_string(),
        }
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::new(ErrorKind::Other, s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_io_errors() {
        let e = AppError::io(
            std::io::Error::from(std::io::ErrorKind::NotFound),
            "C:\\nope",
        );
        assert_eq!(e.kind, ErrorKind::NotFound);
        assert!(e.message.contains("C:\\nope"));
        let v = serde_json::to_value(AppError::invalid("x")).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"kind": "invalid", "message": "x", "detail": "x"})
        );
    }
}
