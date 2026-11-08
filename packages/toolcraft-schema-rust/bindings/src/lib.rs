use mcp_protocol_rust::json::Value;
use napi::{Env, Error, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_schema_rust::{CompileOptions, CompiledSchema, FormatValidator, ValidationOptions};

pub mod dsl;
pub mod host_values;
pub mod validate;

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
pub fn normalize_legacy_nullability(env: Env, schema: Unknown<'_>) -> Result<NativeJson> {
    let value = input::read(&env, schema, input::Mode::Json)?
        .ok_or_else(|| Error::from_reason("JSON Schema must be a boolean or object."))?;
    toolcraft_schema_rust::nullability::normalize_legacy_nullability(&value)
        .map(NativeJson)
        .map_err(Error::from_reason)
}

#[napi]
pub struct NativeCompiledSchema {
    schema: CompiledSchema,
}

type FormatCallback<'env> = Function<'env, FnArgs<(Utf16String, Utf16String)>, Option<bool>>;

struct Formats<'env> {
    callback: FormatCallback<'env>,
    error: Option<Error>,
}

impl FormatValidator for Formats<'_> {
    fn check(&mut self, name: &[u16], value: &[u16]) -> std::result::Result<Option<bool>, String> {
        match self
            .callback
            .call(FnArgs::from((name.to_vec().into(), value.to_vec().into())))
        {
            Ok(result) => Ok(result),
            Err(error) => {
                self.error = Some(error);
                Err("Format callback failed".into())
            }
        }
    }
}

#[napi]
impl NativeCompiledSchema {
    #[napi(constructor)]
    pub fn new(
        env: Env,
        schema: Unknown<'_>,
        options: Option<Unknown<'_>>,
        diagnose_pattern: Option<Function<'_, Utf16String, Unknown<'_>>>,
    ) -> Result<Self> {
        let value = input::read(&env, schema, input::Mode::Json)?
            .ok_or_else(|| Error::from_reason("JSON Schema must be a boolean or object."))?;
        let options = options
            .map(|options| input::read(&env, options, input::Mode::Json))
            .transpose()?
            .flatten();
        let registry = match options.as_ref().and_then(|options| options.get("registry")) {
            Some(Value::Object(entries)) => entries
                .iter()
                .map(|(uri, schema)| (String::from_utf16_lossy(uri), schema.clone()))
                .collect(),
            None => Vec::new(),
            _ => return Err(Error::from_reason("registry must be an object.")),
        };
        let schema =
            CompiledSchema::compile(value, CompileOptions { registry }).map_err(|error| {
                if let (Some(source), Some(diagnose)) = (error.pattern, diagnose_pattern)
                    && let Err(syntax_error) = diagnose.call(source.into())
                {
                    return syntax_error;
                }
                Error::from_reason(error.message)
            })?;
        Ok(Self { schema })
    }

    #[napi(
        ts_return_type = "{ ok: boolean; issues?: { path: string[]; expected: string; received: string; message: string; keyword: string }[] }",
        ts_args_type = "value: unknown, checkFormat?: (name: string, value: string) => boolean | undefined, sources?: number[]"
    )]
    pub fn validate(
        &self,
        env: Env,
        value: Unknown<'_>,
        check_format: Option<FormatCallback<'_>>,
        sources: Option<Vec<u32>>,
    ) -> Result<NativeJson> {
        let value = input::read(&env, value, input::Mode::Json)?.ok_or_else(|| {
            Error::from_reason("Schema validation currently requires a JSON value")
        })?;
        let mut formats = check_format.map(|callback| Formats {
            callback,
            error: None,
        });
        let options = ValidationOptions {
            formats: formats
                .as_mut()
                .map(|formats| formats as &mut dyn FormatValidator),
        };
        let evaluation = match sources {
            Some(sources) => self.schema.validate_candidates(
                &sources
                    .into_iter()
                    .map(|source| source as usize)
                    .collect::<Vec<_>>(),
                &value,
                options,
            ),
            None => self.schema.validate(&value, options),
        };
        if let Some(error) = formats.and_then(|formats| formats.error) {
            return Err(error);
        }
        let issues = evaluation.map_err(Error::from_reason)?;
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
                                    ("expected", Value::String(issue.expected)),
                                    ("received", string(&issue.received)),
                                    ("message", Value::String(issue.message)),
                                    ("keyword", Value::String(issue.keyword)),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ])
        }))
    }

    #[napi]
    pub fn properties(&self) -> Result<NativeJson> {
        let properties = self.schema.properties().map_err(Error::from_reason)?;
        Ok(NativeJson(Value::Array(
            properties
                .into_iter()
                .map(|property| {
                    object([
                        ("name", Value::String(property.name)),
                        ("required", Value::Bool(property.required)),
                        ("schemas", Value::Array(property.schemas)),
                        (
                            "sources",
                            Value::Array(
                                property
                                    .sources
                                    .into_iter()
                                    .map(|source| Value::Number(source as f64))
                                    .collect(),
                            ),
                        ),
                    ])
                })
                .collect(),
        )))
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
