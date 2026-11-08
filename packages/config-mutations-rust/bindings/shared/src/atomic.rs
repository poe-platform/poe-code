use config_mutations_rust::atomic::{AtomicMachine, Failure, Request, Response, WriteError};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi(object)]
pub struct NativeAtomicResponse {
    pub kind: String,
    pub flag: Option<bool>,
    pub path: Option<Utf16String>,
    pub walk: Option<Vec<Utf16String>>,
    pub token: Option<u32>,
    pub exists: Option<bool>,
}
#[napi]
pub struct ConfigAtomicMachine {
    machine: AtomicMachine,
}
fn string(source: &str) -> Value {
    Value::String(source.encode_utf16().collect())
}
fn error_value(error: WriteError) -> NativeJson {
    NativeJson(super::object(match error {
        WriteError::Host(token) => vec![
            ("kind", string("error")),
            ("token", Value::Number(token as f64)),
        ],
        WriteError::Message(message) => vec![
            ("kind", string("error")),
            ("message", Value::String(message)),
        ],
    }))
}
fn value(result: std::result::Result<Request, Vec<u16>>, retryable: bool) -> NativeJson {
    let request = match result {
        Ok(request) => request,
        Err(message) => return error_value(WriteError::Message(message)),
    };
    let (kind, extra) = match request {
        Request::InspectLink(path) => (
            "lstat",
            vec![
                ("path", Value::String(path)),
                ("retryable", Value::Bool(retryable)),
            ],
        ),
        Request::TempPath => ("tempPath", vec![]),
        Request::WriteExclusive { path, content } => (
            "writeFile",
            vec![
                ("path", Value::String(path)),
                ("content", Value::String(content)),
            ],
        ),
        Request::Rename { from, to } => (
            "rename",
            vec![("from", Value::String(from)), ("to", Value::String(to))],
        ),
        Request::Cleanup(path) => ("unlink", vec![("path", Value::String(path))]),
        Request::Done => ("done", vec![]),
        Request::Error(error) => return error_value(error),
    };
    let mut fields = vec![("kind", string(kind))];
    fields.extend(extra);
    NativeJson(super::object(fields))
}
#[napi]
impl ConfigAtomicMachine {
    #[napi(constructor)]
    pub fn new(target: Utf16String, content: Utf16String, walk: Vec<Utf16String>) -> Self {
        Self {
            machine: AtomicMachine::new(
                target.to_vec(),
                content.to_vec(),
                walk.into_iter().map(|p| p.to_vec()).collect(),
            ),
        }
    }
    #[napi]
    pub fn start(&mut self) -> NativeJson {
        {
            let result = self.machine.start();
            value(result, self.machine.checks_collisions())
        }
    }
    #[napi]
    pub fn respond(&mut self, response: NativeAtomicResponse) -> Result<NativeJson> {
        let response = match response.kind.as_str() {
            "unit" => Response::Unit,
            "missing" => Response::Missing,
            "link" => Response::Link(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing atomic link flag"))?,
            ),
            "temp" => Response::Temp {
                path: response
                    .path
                    .ok_or_else(|| Error::from_reason("Missing atomic temporary path"))?
                    .to_vec(),
                walk: response
                    .walk
                    .ok_or_else(|| Error::from_reason("Missing atomic temporary walk"))?
                    .into_iter()
                    .map(|p| p.to_vec())
                    .collect(),
            },
            "failure" => Response::Failure {
                kind: if response.exists.unwrap_or(false) {
                    Failure::Exists
                } else {
                    Failure::Other
                },
                token: response
                    .token
                    .ok_or_else(|| Error::from_reason("Missing atomic host error token"))?,
            },
            _ => return Err(Error::from_reason("Unknown atomic response kind")),
        };
        {
            let result = self.machine.respond(response);
            Ok(value(result, self.machine.checks_collisions()))
        }
    }
}
