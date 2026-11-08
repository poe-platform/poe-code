//! Native catalog conversion.
use agent_defs_rust::{Registry, format_specifier, parse_specifier};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::OnceLock;
fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::builtins)
}
fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
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
pub fn catalog_specifier_policy() -> NativeJson {
    NativeJson(object(vec![
        (
            "delimiter",
            Value::String(vec![agent_defs_rust::SPECIFIER_DELIMITER]),
        ),
        ("emptyAgentError", text(agent_defs_rust::EMPTY_AGENT_ERROR)),
    ]))
}
#[napi]
pub fn catalog_definitions() -> NativeJson {
    NativeJson(Value::Array(
        registry()
            .definitions()
            .iter()
            .map(|definition| {
                object(vec![
                    ("exportName", text(&definition.export_name)),
                    ("definition", definition.metadata.clone()),
                    (
                        "hasArgumentTemplates",
                        Value::Bool(definition.argument_templates.is_some()),
                    ),
                ])
            })
            .collect(),
    ))
}
#[napi]
pub fn catalog_lookup_keys() -> NativeJson {
    NativeJson(Value::Array(
        registry()
            .lookup_keys()
            .iter()
            .map(|(key, id)| {
                Value::Array(vec![Value::String(key.clone()), Value::String(id.clone())])
            })
            .collect(),
    ))
}
#[napi]
pub fn catalog_capabilities() -> NativeJson {
    NativeJson(Value::Array(
        ["spawn", "configure", "install", "test", "skill", "mcp"]
            .iter()
            .map(|capability| {
                let units: Vec<_> = capability.encode_utf16().collect();
                Value::Array(vec![
                    text(capability),
                    Value::Array(
                        registry()
                            .list(&units, false)
                            .into_iter()
                            .map(Value::String)
                            .collect(),
                    ),
                ])
            })
            .collect(),
    ))
}
#[napi]
pub fn catalog_parse_specifier(input: Utf16String) -> Result<NativeJson> {
    let specifier = parse_specifier(&input).map_err(Error::from_reason)?;
    let mut fields = vec![("agent", Value::String(specifier.agent))];
    if let Some(model) = specifier.model {
        fields.push(("model", Value::String(model)));
    }
    Ok(NativeJson(object(fields)))
}
#[napi]
pub fn catalog_format_specifier(
    agent: Utf16String,
    model: Option<Utf16String>,
) -> Result<Utf16String> {
    format_specifier(&agent, model.as_ref().map(|value| value.as_ref()))
        .map(Utf16String::from)
        .map_err(Error::from_reason)
}
#[napi]
pub fn catalog_normalize_specifier(
    input: Utf16String,
    normalized_agent: Utf16String,
) -> Result<Utf16String> {
    registry()
        .normalize_specifier(&input, &normalized_agent)
        .map(Utf16String::from)
        .map_err(Error::from_reason)
}
#[napi]
pub fn catalog_capability_error(
    agent: Utf16String,
    normalized_agent: Utf16String,
    capability: Utf16String,
) -> Utf16String {
    registry()
        .capability_error(&agent, &normalized_agent, &capability)
        .into()
}
#[napi]
pub fn catalog_telemetry_arguments(
    id: Utf16String,
    endpoint: Utf16String,
    content: bool,
) -> Option<Vec<Utf16String>> {
    registry()
        .telemetry_arguments(&id, &endpoint, content)
        .map(|values| values.into_iter().map(Utf16String::from).collect())
}
