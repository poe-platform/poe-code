use config_mutations_rust::config::{self, ConfigMachine, Kind, Request, Response};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi(object)]
pub struct NativeConfigResponse {
    pub kind: String,
    pub flag: Option<bool>,
    pub content: Option<Utf16String>,
    pub changed: Option<bool>,
    pub empty: Option<bool>,
    pub deleted: Option<bool>,
}
#[napi]
pub struct ConfigMutationMachine {
    machine: Option<ConfigMachine>,
}
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn value(result: std::result::Result<Request, Vec<u16>>) -> NativeJson {
    let request = match result {
        Ok(request) => request,
        Err(error) => return NativeJson(super::object(vec![("error", Value::String(error))])),
    };
    let (kind, extra) = match request {
        Request::Format => ("format", vec![]),
        Request::Read => ("readFile", vec![]),
        Request::Fresh => ("fresh", vec![]),
        Request::Guard => ("guard", vec![]),
        Request::Value => ("value", vec![]),
        Request::Merge => ("merge", vec![]),
        Request::Prune => ("prune", vec![]),
        Request::Transform => ("transform", vec![]),
        Request::DryRun => ("dryRun", vec![]),
        Request::Unlink => ("unlink", vec![]),
        Request::Parse(content) => ("parse", vec![("content", Value::String(content))]),
        Request::BackupInvalid(content) => {
            ("backupInvalid", vec![("content", Value::String(content))])
        }
        Request::Serialize(original) => (
            "serialize",
            vec![(
                "original",
                original.map(Value::String).unwrap_or(Value::Null),
            )],
        ),
        Request::WriteAtomically(content) => {
            ("writeAtomically", vec![("content", Value::String(content))])
        }
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
    };
    let mut fields = vec![("kind", s(kind))];
    fields.extend(extra);
    NativeJson(super::object(fields))
}
#[napi]
impl ConfigMutationMachine {
    #[napi(constructor)]
    pub fn new(kind: String, raw: Utf16String) -> Result<Self> {
        let kind = match kind.as_str() {
            "configMerge" => Kind::Merge,
            "configPrune" => Kind::Prune,
            "configTransform" => Kind::Transform,
            _ => return Err(Error::from_reason("Unsupported config mutation kind")),
        };
        Ok(Self {
            machine: Some(ConfigMachine::new(kind, raw.to_vec())),
        })
    }
    #[napi]
    pub fn start(&mut self) -> Result<NativeJson> {
        Ok(value(
            self.machine
                .as_mut()
                .ok_or_else(|| Error::from_reason("Config mutation already discarded"))?
                .start(),
        ))
    }
    #[napi]
    pub fn respond(&mut self, response: NativeConfigResponse) -> Result<NativeJson> {
        let response = match response.kind.as_str() {
            "unit" => Response::Unit,
            "missing" => Response::Missing,
            "content" => Response::Content(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing config content"))?
                    .to_vec(),
            ),
            "parsed" => Response::Parsed(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing config parse flag"))?,
            ),
            "bool" => Response::Bool(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing config control flag"))?,
            ),
            "pruned" => Response::Pruned {
                changed: response
                    .changed
                    .ok_or_else(|| Error::from_reason("Missing config prune changed flag"))?,
                empty: response.empty.unwrap_or(false),
            },
            "transformed" => Response::Transformed {
                changed: response
                    .changed
                    .ok_or_else(|| Error::from_reason("Missing config transform changed flag"))?,
                deleted: response.deleted.unwrap_or(false),
            },
            "serialized" => Response::Serialized(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing config serialized content"))?
                    .to_vec(),
            ),
            _ => return Err(Error::from_reason("Unknown config mutation response kind")),
        };
        Ok(value(
            self.machine
                .as_mut()
                .ok_or_else(|| Error::from_reason("Config mutation already discarded"))?
                .respond(response),
        ))
    }
    #[napi]
    pub fn discard(&mut self) {
        self.machine = None;
    }
}
#[napi]
pub fn config_select_format(raw: Utf16String, explicit: Option<Utf16String>) -> NativeJson {
    NativeJson(
        match config::select_format(&raw, explicit.as_ref().map(|s| s.as_ref())) {
            Ok(format) => super::object(vec![("format", s(format.name()))]),
            Err(error) => super::object(vec![("error", Value::String(error))]),
        },
    )
}
