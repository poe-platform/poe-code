use config_mutations_rust::template_execution::{Kind, Request, Response, TemplateMachine};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi(object)]
pub struct NativeTemplateResponse {
    pub kind: String,
    pub flag: Option<bool>,
    pub content: Option<Utf16String>,
    pub id: Option<Utf16String>,
    pub error: Option<Utf16String>,
    pub config: Option<super::config::NativeConfigResponse>,
}
#[napi]
pub struct ConfigTemplateMachine {
    machine: Option<TemplateMachine>,
}
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn value(result: std::result::Result<Request, Vec<u16>>) -> NativeJson {
    let request = match result {
        Ok(request) => request,
        Err(message) => return NativeJson(super::object(vec![("error", Value::String(message))])),
    };
    if let Request::Config(request) = request {
        let NativeJson(Value::Object(mut fields)) = super::config::value(Ok(request)) else {
            unreachable!()
        };
        fields.push(("phase".encode_utf16().collect(), s("config")));
        return NativeJson(Value::Object(fields));
    }
    let (kind, extra) = match request {
        Request::Loader => ("loader", vec![]),
        Request::Resolve => ("resolve", vec![]),
        Request::Load => ("load", vec![]),
        Request::Context => ("context", vec![]),
        Request::Render => ("render", vec![]),
        Request::ParseRendered => ("parseRendered", vec![]),
        Request::Read => ("readFile", vec![]),
        Request::DryRun => ("dryRun", vec![]),
        Request::Write(content) => ("writeAtomically", vec![("content", Value::String(content))]),
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
        Request::Config(_) => unreachable!(),
    };
    let mut fields = vec![("kind", s(kind))];
    fields.extend(extra);
    NativeJson(super::object(fields))
}
#[napi]
impl ConfigTemplateMachine {
    #[napi(constructor)]
    pub fn new(kind: String) -> Result<Self> {
        let kind = match kind.as_str() {
            "templateWrite" => Kind::Write,
            "templateMergeJson" => Kind::MergeJson,
            "templateMergeToml" => Kind::MergeToml,
            _ => return Err(Error::from_reason("Unsupported template mutation kind")),
        };
        Ok(Self {
            machine: Some(TemplateMachine::new(kind)),
        })
    }
    #[napi]
    pub fn start(&mut self) -> Result<NativeJson> {
        Ok(value(
            self.machine
                .as_mut()
                .ok_or_else(|| Error::from_reason("Template mutation already discarded"))?
                .start(),
        ))
    }
    #[napi]
    pub fn respond(&mut self, response: NativeTemplateResponse) -> Result<NativeJson> {
        let response = match response.kind.as_str() {
            "unit" => Response::Unit,
            "supported" => Response::Supported(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing template loader flag"))?,
            ),
            "rendered" => Response::Rendered(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing rendered template"))?
                    .to_vec(),
            ),
            "content" => Response::Content(
                response
                    .content
                    .ok_or_else(|| Error::from_reason("Missing template target content"))?
                    .to_vec(),
            ),
            "missing" => Response::Missing,
            "dryRun" => Response::DryRun(
                response
                    .flag
                    .ok_or_else(|| Error::from_reason("Missing template dry run flag"))?,
            ),
            "invalidTemplate" => Response::InvalidTemplate {
                id: response
                    .id
                    .ok_or_else(|| Error::from_reason("Missing template id"))?
                    .to_vec(),
                error: response
                    .error
                    .ok_or_else(|| Error::from_reason("Missing template parse error"))?
                    .to_vec(),
            },
            "config" => {
                Response::Config(super::config::response_value(response.config.ok_or_else(
                    || Error::from_reason("Missing template config response"),
                )?)?)
            }
            _ => return Err(Error::from_reason("Unsupported template response")),
        };
        Ok(value(
            self.machine
                .as_mut()
                .ok_or_else(|| Error::from_reason("Template mutation already discarded"))?
                .respond(response),
        ))
    }
    #[napi]
    pub fn discard(&mut self) {
        self.machine = None;
    }
}
