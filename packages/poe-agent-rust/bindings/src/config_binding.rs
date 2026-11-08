use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn result(value: std::result::Result<Value, Vec<u16>>) -> NativeJson {
    let (key, value) = match value {
        Ok(value) => ("value", value),
        Err(error) => ("error", Value::String(error)),
    };
    NativeJson(Value::Object(vec![(key.encode_utf16().collect(), value)]))
}
#[napi]
pub fn normalize_config_name(value: Utf16String, label: Utf16String) -> NativeJson {
    result(poe_agent_rust::config::normalize_name(&value, &label).map(Value::String))
}
#[napi]
pub fn trim_config_string(value: Utf16String) -> Utf16String {
    trim_ecmascript(&value).to_vec().into()
}
#[napi]
pub fn normalize_plugin_dependencies(values: Vec<Utf16String>) -> Vec<Utf16String> {
    poe_agent_rust::config::dependencies(values.into_iter().map(|value| value.to_vec()).collect())
        .into_iter()
        .map(Into::into)
        .collect()
}
#[napi]
#[derive(Default)]
pub struct NativePluginGraph {
    state: poe_agent_rust::config::Graph,
}
#[napi]
impl NativePluginGraph {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn add(&mut self, name: Utf16String) -> NativeJson {
        result(
            self.state
                .add(name.to_vec())
                .map(|index| Value::Number(index as f64)),
        )
    }
    #[napi]
    pub fn begin(&mut self, name: Utf16String) -> NativeJson {
        result(
            self.state
                .begin(&name)
                .map(|index| index.map_or(Value::Null, |index| Value::Number(index as f64))),
        )
    }
    #[napi]
    pub fn load(&mut self, values: Vec<Utf16String>) -> NativeJson {
        result(
            self.state
                .load(values.into_iter().map(|value| value.to_vec()).collect())
                .map(|index| index.map_or(Value::Null, |index| Value::Number(index as f64))),
        )
    }
    #[napi]
    pub fn order(&self) -> Vec<u32> {
        self.state.order().to_vec()
    }
}
