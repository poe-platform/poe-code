use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
#[napi]
#[derive(Default)]
pub struct NativeProviderRegistry {
    state: poe_agent_rust::Registry,
}
#[napi]
impl NativeProviderRegistry {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn register(&mut self, name: Utf16String, entry: Utf16String) -> Option<NativeJson> {
        self.state
            .register(name.to_vec(), entry.to_vec())
            .map(|collision| {
                NativeJson(Value::Object(vec![
                    (
                        "providerName".encode_utf16().collect(),
                        Value::String(collision.name),
                    ),
                    (
                        "pluginEntries".encode_utf16().collect(),
                        Value::Array(collision.entries.into_iter().map(Value::String).collect()),
                    ),
                ]))
            })
    }
}
#[napi]
#[derive(Default)]
pub struct NativeProviderResolution {
    state: poe_agent_rust::Resolution,
}
#[napi]
impl NativeProviderResolution {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: poe_agent_rust::Resolution::default(),
        }
    }
    #[napi]
    pub fn begin(&mut self, count: u32) -> Result<Option<u32>> {
        self.state
            .begin(count as usize)
            .map(|index| index.map(|v| v as u32))
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn finish(&mut self, supported: bool) -> Result<Option<u32>> {
        self.state
            .finish(supported)
            .map(|index| index.map(|v| v as u32))
            .map_err(Error::from_reason)
    }
}
#[napi]
pub fn agent_provider_error(
    model: Utf16String,
    names: Vec<Utf16String>,
    provider: Option<Utf16String>,
) -> Utf16String {
    poe_agent_rust::provider_error(
        &model,
        &names.into_iter().map(|v| v.to_vec()).collect::<Vec<_>>(),
        provider.as_deref(),
    )
    .into()
}
#[napi]
pub fn agent_duplicate_error(name: Utf16String, entries: Vec<Utf16String>) -> Utf16String {
    poe_agent_rust::duplicate_error(
        &name,
        &entries.into_iter().map(|v| v.to_vec()).collect::<Vec<_>>(),
    )
    .into()
}
#[napi]
pub fn agent_tool_valid(name: Utf16String) -> bool {
    poe_agent_rust::valid_tool_name(&name)
}
#[napi]
pub fn agent_tool_error(name: Utf16String, contributor: Option<Utf16String>) -> Utf16String {
    poe_agent_rust::tool_error(&name, contributor.as_deref()).into()
}
#[napi]
pub fn agent_session_valid(id: Unknown<'_>) -> Result<bool> {
    Ok(id.get_type()? == napi::ValueType::String
        && poe_agent_rust::safe_session_id(&unsafe { id.cast::<Utf16String>()? }))
}
#[napi]
pub fn agent_session_error(id: Utf16String) -> Utf16String {
    poe_agent_rust::session_error(&id).into()
}
#[napi]
pub fn agent_session_decode(source: Utf16String) -> NativeJson {
    let string = |value: &str| Value::String(value.encode_utf16().collect());
    let pairs = match poe_agent_rust::session::decode(&source) {
        Ok(value) => vec![("status", string("ok")), ("value", value)],
        Err(poe_agent_rust::session::ReadError::Syntax(error)) => {
            vec![
                ("status", string("syntax")),
                ("message", string(&error.to_string())),
                (
                    "bounded",
                    Value::Bool(matches!(
                        error.kind,
                        mcp_protocol_rust::json::ErrorKind::ByteLimit
                            | mcp_protocol_rust::json::ErrorKind::DepthLimit
                            | mcp_protocol_rust::json::ErrorKind::NodeLimit
                            | mcp_protocol_rust::json::ErrorKind::InvalidLimits
                    )),
                ),
            ]
        }
        Err(poe_agent_rust::session::ReadError::Unsupported(version)) => vec![
            ("status", string("version")),
            ("hasVersion", Value::Bool(version.is_some())),
            ("version", version.unwrap_or(Value::Null)),
        ],
        Err(poe_agent_rust::session::ReadError::Invalid) => vec![("status", string("invalid"))],
    };
    NativeJson(Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    ))
}
