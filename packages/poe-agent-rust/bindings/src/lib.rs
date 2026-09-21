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

#[napi]
#[derive(Default)]
pub struct NativeAgentMemoryStore {
    state: poe_agent_rust::session_log::MemoryStore,
}
#[napi]
impl NativeAgentMemoryStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn append(&mut self, source: Utf16String) -> Result<()> {
        self.state
            .append(&source)
            .map_err(|error| Error::from_reason(error.to_string()))
    }
    #[napi]
    pub fn list(&self) -> NativeJson {
        NativeJson(Value::Array(self.state.entries().to_vec()))
    }
    #[napi]
    pub fn clear(&mut self) {
        self.state.clear();
    }
}
#[napi]
pub fn agent_session_log_decode(source: Utf16String) -> NativeJson {
    use poe_agent_rust::session_log::{LogError, decode_jsonl};
    let status = |name: &str| Value::String(name.encode_utf16().collect());
    let pairs = match decode_jsonl(&source) {
        Ok(entries) => vec![("status", status("ok")), ("entries", Value::Array(entries))],
        Err(LogError::Syntax(line)) => vec![
            ("status", status("syntax")),
            ("line", Value::Number(line as f64)),
        ],
        Err(LogError::Limit(line)) => vec![
            ("status", status("limit")),
            ("line", Value::Number(line as f64)),
        ],
        Err(LogError::Invalid) => vec![("status", status("invalid"))],
    };
    NativeJson(Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    ))
}

#[napi]
#[derive(Default)]
pub struct NativeAgentToolCatalog {
    state: poe_agent_rust::tools::ToolCatalog,
}
#[napi]
impl NativeAgentToolCatalog {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn get(&self, name: Utf16String) -> Option<u32> {
        self.state.get(&name).map(|index| index as u32)
    }
    #[napi]
    pub fn upsert(&mut self, name: Utf16String) -> u32 {
        self.state.upsert(name.to_vec()) as u32
    }
    #[napi]
    pub fn active(&self, visibility: Vec<Utf16String>, skills: Vec<Utf16String>) -> Vec<u32> {
        use poe_agent_rust::tools::Visibility;
        let visibility = visibility
            .iter()
            .map(|value| match String::from_utf16_lossy(value).as_str() {
                "model" => Visibility::Model,
                "internal" => Visibility::Internal,
                _ => Visibility::Skill,
            })
            .collect::<Vec<_>>();
        self.state
            .active(
                &visibility,
                &skills
                    .into_iter()
                    .map(|value| value.to_vec())
                    .collect::<Vec<_>>(),
            )
            .into_iter()
            .map(|index| index as u32)
            .collect()
    }
}
#[napi]
pub fn agent_trim(value: Utf16String) -> Utf16String {
    mcp_protocol_rust::strings::trim_ecmascript(&value)
        .to_vec()
        .into()
}
#[napi]
pub fn agent_runtime_error(kind: Utf16String, name: Utf16String) -> Utf16String {
    use poe_agent_rust::tools::RuntimeErrorKind;
    let kind = match String::from_utf16_lossy(&kind).as_str() {
        "tool" => RuntimeErrorKind::Tool,
        "setup" => RuntimeErrorKind::Setup,
        _ => RuntimeErrorKind::Prompt,
    };
    poe_agent_rust::tools::runtime_error(kind, &name).into()
}

pub mod config_binding;

pub mod file_awareness_binding;

pub mod hooks_binding;

pub mod prompts_binding;

pub mod run_context_binding;

pub mod tool_results_binding;

pub mod session_tree_binding;

pub mod transcript_binding;

pub mod plugin_setup_binding;

pub mod model_stream_binding;

#[path = "../../../tiny-mcp-client-rust/bindings/src/lib.rs"]
pub mod embedded_client;
pub use embedded_client::NativeHttpResponseMessages;
use mcp_protocol_rust_napi_core::convert;

pub mod execution_binding;

pub mod model_messages_binding;

pub mod agent_host_binding;

pub mod builtin_plugins_binding;

pub mod context_plugins_binding;

pub mod file_tools_binding;
pub mod openai_binding;
pub mod responses_binding;

pub mod shell_binding;

pub mod web_binding;
