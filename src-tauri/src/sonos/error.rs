use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("network: {0}")]
    Http(#[from] reqwest::Error),
    #[error("speaker returned HTTP {0}")]
    Status(u16),
    #[error("UPnP error {code} during {action}")]
    Upnp { code: u32, action: String },
    #[error("unexpected response from speaker: {0}")]
    Parse(String),
    #[error("no Sonos speakers found on this network")]
    NotFound,
    #[error("music service error: {fault}")]
    Smapi { fault: String, detail: String, refresh: Option<(String, String)> },
    #[error("{0}")]
    Other(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn other(msg: impl Into<String>) -> Self {
        Error::Other(msg.into())
    }
    pub fn parse(msg: impl Into<String>) -> Self {
        Error::Parse(msg.into())
    }
}

impl From<roxmltree::Error> for Error {
    fn from(e: roxmltree::Error) -> Self {
        Error::Parse(e.to_string())
    }
}

impl From<Error> for String {
    fn from(e: Error) -> String {
        // Friendlier wording for the two errors users actually hit.
        match &e {
            Error::Upnp { code: 701, .. } => "The speaker refused (transition not available).".into(),
            Error::Upnp { code: 800, .. } => "The speaker couldn't play that (account or format problem).".into(),
            Error::Http(inner) if inner.is_timeout() => "A speaker didn't answer in time.".into(),
            Error::Http(inner) if inner.is_connect() => "Couldn't reach the speaker.".into(),
            Error::Smapi { fault, detail, .. } if !detail.is_empty() => format!("{fault}: {detail}"),
            _ => e.to_string(),
        }
    }
}
