use config_mutations_rust::backup::{BackupMachine, Kind, Request, Response, WriteError};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi(object)]
pub struct NativeBackupResponse {
    pub kind: String,
    pub flag: Option<bool>,
    pub content: Option<Utf16String>,
    pub entries: Option<Vec<Utf16String>>,
    pub walk: Option<Vec<Utf16String>>,
    pub token: Option<u32>,
    pub exists: Option<bool>,
}
#[napi]
pub struct ConfigBackupMachine {
    machine: BackupMachine,
}
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn value(result: std::result::Result<Request, Vec<u16>>, retryable: bool) -> NativeJson {
    let request = match result {
        Ok(request) => request,
        Err(message) => Request::Error(WriteError::Message(message)),
    };
    let (kind, extra) = match request {
        Request::InspectLink(path) => (
            "lstat",
            vec![
                ("path", Value::String(path)),
                ("retryable", Value::Bool(retryable)),
            ],
        ),
        Request::Once => ("once", vec![]),
        Request::DryRun => ("dryRun", vec![]),
        Request::Timestamp => ("timestamp", vec![]),
        Request::List(path) => ("readdir", vec![("path", Value::String(path))]),
        Request::ValidateTimestamp(timestamp) => (
            "validateTimestamp",
            vec![("timestamp", Value::String(timestamp))],
        ),
        Request::Walk(path) => (
            "walk",
            vec![
                ("path", Value::String(path)),
                ("retryable", Value::Bool(retryable)),
            ],
        ),
        Request::Read {
            path,
            missing_allowed,
        } => (
            "readFile",
            vec![
                ("path", Value::String(path)),
                ("missingAllowed", Value::Bool(missing_allowed)),
            ],
        ),
        Request::WriteExclusive { path, content } => (
            "writeFile",
            vec![
                ("path", Value::String(path)),
                ("content", Value::String(content)),
            ],
        ),
        Request::WriteAtomically { path, content } => (
            "writeAtomically",
            vec![
                ("path", Value::String(path)),
                ("content", Value::String(content)),
            ],
        ),
        Request::Unlink {
            path,
            ignore_missing,
            cleanup,
        } => (
            "unlink",
            vec![
                ("path", Value::String(path)),
                ("ignoreMissing", Value::Bool(ignore_missing)),
                ("cleanup", Value::Bool(cleanup)),
            ],
        ),
        Request::Done(outcome) => (
            "done",
            vec![(
                "outcome",
                super::object(vec![
                    ("changed", Value::Bool(outcome.changed)),
                    ("effect", s(outcome.effect)),
                    ("detail", s(outcome.detail)),
                ]),
            )],
        ),
        Request::Error(WriteError::Host(token)) => {
            ("error", vec![("token", Value::Number(token as f64))])
        }
        Request::Error(WriteError::Message(message)) => {
            ("error", vec![("message", Value::String(message))])
        }
    };
    let mut fields = vec![("kind", s(kind))];
    fields.extend(extra);
    NativeJson(super::object(fields))
}
#[napi]
impl ConfigBackupMachine {
    #[napi(constructor)]
    pub fn new(kind: String, target: Utf16String, walk: Vec<Utf16String>) -> Result<Self> {
        let kind = match kind.as_str() {
            "backup" => Kind::Backup,
            "restoreBackup" => Kind::Restore,
            _ => return Err(Error::from_reason("Unsupported backup mutation kind")),
        };
        Ok(Self {
            machine: BackupMachine::new(
                kind,
                target.to_vec(),
                walk.into_iter().map(|p| p.to_vec()).collect(),
            ),
        })
    }
    #[napi]
    pub fn start(&mut self) -> NativeJson {
        let result = self.machine.start();
        value(result, self.machine.checks_collisions())
    }
    #[napi]
    pub fn respond(&mut self, response: NativeBackupResponse) -> Result<NativeJson> {
        let response = match response.kind.as_str() {
            "unit" => Response::Unit,
            "missing" => Response::Missing,
            "link" => Response::Link(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing backup link flag"))?,
            ),
            "bool" => Response::Bool(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing backup control flag"))?,
            ),
            "content" => Response::Content(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing backup content"))?
                    .to_vec(),
            ),
            "entries" => Response::Entries(
                response
                    .entries
                    .ok_or_else(|| Error::from_reason("Missing backup entries"))?
                    .into_iter()
                    .map(|p| p.to_vec())
                    .collect(),
            ),
            "walk" => Response::Walk(
                response
                    .walk
                    .ok_or_else(|| Error::from_reason("Missing backup walk"))?
                    .into_iter()
                    .map(|p| p.to_vec())
                    .collect(),
            ),
            "timestamp" => Response::Timestamp(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing backup timestamp"))?
                    .to_vec(),
            ),
            "failure" => Response::Failure {
                exists: response.exists.unwrap_or(false),
                token: response
                    .token
                    .ok_or_else(|| Error::from_reason("Missing backup error token"))?,
            },
            _ => return Err(Error::from_reason("Unknown backup response kind")),
        };
        let result = self.machine.respond(response);
        Ok(value(result, self.machine.checks_collisions()))
    }
}
