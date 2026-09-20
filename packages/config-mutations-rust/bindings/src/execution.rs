use config_mutations_rust::execution::{FileMachine, Kind, Request, Response};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi(object)]
pub struct NativeFileResponse {
    pub kind: String,
    pub flag: Option<bool>,
    pub mode: Option<f64>,
    pub content: Option<Utf16String>,
    pub count: Option<u32>,
    pub when_empty: Option<bool>,
    pub force: Option<bool>,
}
#[napi]
pub struct ConfigFileMachine {
    machine: FileMachine,
}
fn value(result: std::result::Result<Request, Vec<u16>>) -> NativeJson {
    let request = match result {
        Ok(request) => request,
        Err(message) => return NativeJson(super::object(vec![("error", Value::String(message))])),
    };
    let (kind, extra) = match request {
        Request::ChmodSupported => ("chmodSupported", vec![]),
        Request::DirectoryOptions => ("directoryOptions", vec![]),
        Request::Mode => ("mode", vec![]),
        Request::DryRun => ("dryRun", vec![]),
        Request::InspectLink(path) => ("lstat", vec![("path", Value::String(path))]),
        Request::Stat => ("stat", vec![]),
        Request::ReadFile => ("readFile", vec![]),
        Request::ReadEntries => ("readdir", vec![]),
        Request::Guard(content) => ("guard", vec![("content", Value::String(content))]),
        Request::MakeDirectory => ("mkdir", vec![]),
        Request::RemoveDirectory => ("rm", vec![]),
        Request::Unlink => ("unlink", vec![]),
        Request::SetMode(mode) => ("chmod", vec![("mode", Value::Number(mode))]),
        Request::Done(outcome) => (
            "done",
            vec![(
                "outcome",
                super::object(vec![
                    ("changed", Value::Bool(outcome.changed)),
                    (
                        "effect",
                        Value::String(outcome.effect.encode_utf16().collect()),
                    ),
                    (
                        "detail",
                        Value::String(outcome.detail.encode_utf16().collect()),
                    ),
                ]),
            )],
        ),
    };
    let mut fields = vec![("kind", Value::String(kind.encode_utf16().collect()))];
    fields.extend(extra);
    NativeJson(super::object(fields))
}
#[napi]
impl ConfigFileMachine {
    #[napi(constructor)]
    pub fn new(kind: String, write_walk: Vec<Utf16String>) -> Result<Self> {
        let kind = match kind.as_str() {
            "ensureDirectory" => Kind::EnsureDirectory,
            "removeDirectory" => Kind::RemoveDirectory,
            "removeFile" => Kind::RemoveFile,
            "chmod" => Kind::Chmod,
            _ => {
                return Err(Error::from_reason(format!(
                    "Unsupported file mutation kind: {kind}"
                )));
            }
        };
        Ok(Self {
            machine: FileMachine::new(kind, write_walk.into_iter().map(|p| p.to_vec()).collect()),
        })
    }
    #[napi]
    pub fn start(&mut self) -> NativeJson {
        value(self.machine.start())
    }
    #[napi]
    pub fn respond(&mut self, response: NativeFileResponse) -> Result<NativeJson> {
        let response = match response.kind.as_str() {
            "unit" => Response::Unit,
            "missing" => Response::Missing,
            "link" => Response::Link(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing link response flag"))?,
            ),
            "stat" => Response::Stat(response.mode),
            "content" => Response::Content(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing file response content"))?
                    .to_vec(),
            ),
            "count" => Response::Count(
                response
                    .count
                    .ok_or_else(|| Error::from_reason("Missing directory response count"))?
                    as usize,
            ),
            "guard" => Response::Guard {
                matches: response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing guard response flag"))?,
                when_empty: response.when_empty.unwrap_or(false),
            },
            "chmodSupported" => Response::ChmodSupported(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing capability response flag"))?,
            ),
            "directoryOptions" => Response::DirectoryOptions {
                supported: response.flag.ok_or_else(|| {
                    Error::from_reason("Missing directory capability response flag")
                })?,
                force: response.force.unwrap_or(false),
            },
            "mode" => Response::Mode(
                response
                    .mode
                    .ok_or_else(|| Error::from_reason("Missing permission response mode"))?,
            ),
            "dryRun" => Response::DryRun(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing dry-run response flag"))?,
            ),
            _ => return Err(Error::from_reason("Unknown file mutation response kind")),
        };
        Ok(value(self.machine.respond(response)))
    }
}
