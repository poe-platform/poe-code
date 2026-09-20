use mcp_protocol_rust::json::Value;
use napi::{Env, Error, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_schema_rust::{CompileOptions, CompiledSchema};

#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
#[path = "../../../mcp-protocol-rust/bindings/src/json_input.rs"]
#[expect(
    dead_code,
    reason = "shared ingress also defines the server-only tool return mode"
)]
mod input;
use convert::NativeJson;

#[napi]
pub struct NativeCompiledSchema {
    schema: CompiledSchema,
}

#[napi]
impl NativeCompiledSchema {
    #[napi(constructor)]
    pub fn new(env: Env, schema: Unknown<'_>, options: Option<Unknown<'_>>) -> Result<Self> {
        let value = input::read(&env, schema, input::Mode::Json)?
            .ok_or_else(|| Error::from_reason("JSON Schema must be a boolean or object."))?;
        let options = options
            .map(|options| input::read(&env, options, input::Mode::Json))
            .transpose()?
            .flatten();
        if options
            .as_ref()
            .and_then(|options| options.get("formats"))
            .is_some_and(|formats| !matches!(formats, Value::Object(entries) if entries.is_empty()))
        {
            return Err(Error::from_reason(
                "Custom schema formats are not yet implemented",
            ));
        }
        let registry = match options.as_ref().and_then(|options| options.get("registry")) {
            Some(Value::Object(entries)) => entries
                .iter()
                .map(|(uri, schema)| (String::from_utf16_lossy(uri), schema.clone()))
                .collect(),
            None => Vec::new(),
            _ => return Err(Error::from_reason("registry must be an object.")),
        };
        Ok(Self {
            schema: CompiledSchema::compile(value, CompileOptions { registry })
                .map_err(Error::from_reason)?,
        })
    }

    #[napi(
        ts_return_type = "{ ok: boolean; issues?: { path: string[]; expected: string; received: string; message: string; keyword: string }[] }"
    )]
    pub fn validate(&self, env: Env, value: Unknown<'_>) -> Result<NativeJson> {
        let value = input::read(&env, value, input::Mode::Json)?.ok_or_else(|| {
            Error::from_reason("Schema validation currently requires a JSON value")
        })?;
        let issues = self.schema.validate(&value).map_err(Error::from_reason)?;
        Ok(NativeJson(if issues.is_empty() {
            object([("ok", Value::Bool(true))])
        } else {
            object([
                ("ok", Value::Bool(false)),
                (
                    "issues",
                    Value::Array(
                        issues
                            .into_iter()
                            .map(|issue| {
                                object([
                                    (
                                        "path",
                                        Value::Array(
                                            issue.path.into_iter().map(Value::String).collect(),
                                        ),
                                    ),
                                    ("expected", string(&issue.expected)),
                                    ("received", string(&issue.received)),
                                    ("message", Value::String(issue.message)),
                                    ("keyword", string(&issue.keyword)),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ])
        }))
    }
}

fn string(source: &str) -> Value {
    Value::String(source.encode_utf16().collect())
}
fn object<const N: usize>(properties: [(&str, Value); N]) -> Value {
    Value::Object(
        properties
            .into_iter()
            .map(|(name, value)| (name.encode_utf16().collect(), value))
            .collect(),
    )
}
