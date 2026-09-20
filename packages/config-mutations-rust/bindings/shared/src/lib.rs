use config_mutations_rust::jsonc::{self, PathSegment};
use mcp_protocol_rust::json::{self as json, Limits, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
mod snapshot;
fn input(source: &[u16]) -> Result<Value> {
    json::parse_utf16(
        source,
        Limits {
            max_bytes: usize::MAX,
            max_nodes: usize::MAX,
            max_depth: 512,
        },
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}
#[napi]
pub fn config_json_parse(source: Utf16String) -> Result<NativeJson> {
    jsonc::parse_object(&source)
        .map(NativeJson)
        .map_err(|e| Error::from_reason(e.to_string()))
}
#[napi]
pub fn config_json_indent(source: Utf16String) -> Utf16String {
    jsonc::detect_indent(&source).into()
}
#[napi]
pub fn config_json_serialize(serialized: Utf16String) -> Result<Utf16String> {
    Ok(jsonc::serialize(&input(&serialized)?).into())
}
#[napi]
pub struct ConfigJsonEdit {
    plan: Option<jsonc::EditPlan>,
}
#[napi]
impl ConfigJsonEdit {
    #[napi(getter)]
    pub fn wrappers(&self) -> Result<NativeJson> {
        Ok(NativeJson(Value::Array(
            self.plan
                .as_ref()
                .ok_or_else(|| Error::from_reason("JSON edit already consumed"))?
                .wrappers()
                .iter()
                .map(|segment| match segment {
                    PathSegment::Key(key) => Value::String(key.clone()),
                    PathSegment::Index(index) => Value::Number(*index as f64),
                })
                .collect(),
        )))
    }
    #[napi(getter)]
    pub fn replaces_value(&self) -> Result<bool> {
        Ok(self
            .plan
            .as_ref()
            .ok_or_else(|| Error::from_reason("JSON edit already consumed"))?
            .replaces_value())
    }
    #[napi]
    pub fn apply(&mut self, serialized: Option<Utf16String>) -> Result<Utf16String> {
        Ok(self
            .plan
            .take()
            .ok_or_else(|| Error::from_reason("JSON edit already consumed"))?
            .apply_serialized(serialized.as_ref().map(|s| s.as_ref()))
            .into())
    }
    #[napi]
    pub fn discard(&mut self) {
        self.plan = None;
    }
}
#[napi]
pub fn config_json_plan(
    source: Utf16String,
    path: Vec<Either<Utf16String, f64>>,
    has_value: bool,
) -> Result<ConfigJsonEdit> {
    let path: Vec<_> = path
        .into_iter()
        .map(|part| match part {
            Either::A(key) => Ok(PathSegment::Key(key.to_vec())),
            Either::B(index)
                if index.is_finite()
                    && index.fract() == 0.0
                    && index >= i64::MIN as f64
                    && index < (i64::MAX as f64) =>
            {
                Ok(PathSegment::Index(index as i64))
            }
            _ => Err(Error::from_reason(
                "Expected string or integer JSON path segment",
            )),
        })
        .collect::<Result<_>>()?;
    jsonc::plan(source.to_vec(), &path, has_value)
        .map(|plan| ConfigJsonEdit { plan: Some(plan) })
        .map_err(|e| Error::from_reason(e.to_string()))
}

fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
#[napi]
pub fn config_toml_parse(source: Utf16String) -> NativeJson {
    use config_mutations_rust::toml;
    NativeJson(match toml::parse(&source) {
        Ok(value) => {
            let mut temporals = vec![];
            let value = snapshot::parsed(value, &mut vec![], &mut temporals);
            object(vec![
                ("value", value),
                ("temporals", Value::Array(temporals)),
            ])
        }
        Err(error) => object(vec![(
            "error",
            object(vec![
                ("message", Value::String(error.message_utf16())),
                ("line", Value::Number(error.line as f64)),
                ("column", Value::Number(error.column as f64)),
                ("codeblock", Value::String(error.codeblock)),
            ]),
        )]),
    })
}
#[napi]
pub fn config_toml_serialize(serialized: Buffer) -> Result<Utf16String> {
    let value = snapshot::decode(&serialized).map_err(Error::from_reason)?;
    config_mutations_rust::toml::stringify(&value)
        .map(Utf16String::from)
        .map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn config_yaml_parse(
    source: Utf16String,
    date_key: Option<Function<f64, Utf16String>>,
    unique_keys: Option<bool>,
    object_root: Option<bool>,
) -> Result<NativeJson> {
    use config_mutations_rust::yaml;
    let mut callback_error = None;
    let mut format = |epoch: i64| match date_key.as_ref().unwrap().call(epoch as f64) {
        Ok(text) => text.to_vec(),
        Err(error) => {
            callback_error = Some(error);
            vec![]
        }
    };
    let parsed = yaml::parse_with_options(
        &source,
        if date_key.is_some() {
            Some(&mut format)
        } else {
            None
        },
        yaml::ParseOptions {
            unique_keys: unique_keys.unwrap_or(true),
            object_root: object_root.unwrap_or(true),
        },
    );
    if let Some(error) = callback_error {
        return Err(error);
    }
    Ok(NativeJson(match parsed {
        Ok(parsed) => {
            let mut temporals = vec![];
            let value = snapshot::parsed(parsed.value, &mut vec![], &mut temporals);
            object(vec![
                ("value", value),
                ("temporals", Value::Array(temporals)),
                (
                    "dateIds",
                    Value::Array(
                        parsed
                            .date_ids
                            .into_iter()
                            .map(|id| Value::Number(id as f64))
                            .collect(),
                    ),
                ),
                (
                    "symbolIds",
                    Value::Array(
                        parsed
                            .symbol_ids
                            .into_iter()
                            .map(|id| Value::Number(id as f64))
                            .collect(),
                    ),
                ),
            ])
        }
        Err(error) => object(vec![(
            "error",
            object(vec![
                (
                    "message",
                    Value::String(error.to_string().encode_utf16().collect()),
                ),
                ("line", Value::Number(error.line as f64)),
                ("column", Value::Number(error.column as f64)),
                (
                    "reason",
                    Value::String(error.reason.encode_utf16().collect()),
                ),
                ("offset", Value::Number(error.offset as f64)),
            ]),
        )]),
    }))
}
#[napi]
pub fn config_yaml_serialize(serialized: Buffer) -> Result<Utf16String> {
    let graph = snapshot::decode_graph(&serialized).map_err(Error::from_reason)?;
    config_mutations_rust::yaml::stringify_graph(&graph)
        .map(Utf16String::from)
        .map_err(|e| Error::from_reason(e.reason))
}

mod atomic;
mod backup;
mod execution;
pub use execution::config_mutation_factories;
mod config;
pub use config::config_select_format;
pub use config::{config_detect_format, config_get_format};
mod template;
pub use toolcraft_design_rust_napi_core::*;
#[napi]
pub fn config_safe_timestamp(iso: Utf16String) -> Utf16String {
    config_mutations_rust::backup::safe_timestamp(&iso).into()
}
mod mock;
pub use mock::config_mock_directory_parts;
