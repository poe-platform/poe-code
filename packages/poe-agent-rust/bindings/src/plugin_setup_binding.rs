use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::plugin_setup::{Pagination, SetupPlan, Stage};
#[napi]
#[derive(Default)]
pub struct NativeAgentSetupPlan {
    state: SetupPlan,
}
#[napi]
impl NativeAgentSetupPlan {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn next(&mut self, count: u32) -> NativeJson {
        NativeJson(
            self.state
                .next(count as usize)
                .map_or(Value::Null, |(index, stage)| {
                    let stage = match stage {
                        Stage::Tools => "tools",
                        Stage::Prompt => "prompt",
                        Stage::Hooks => "hooks",
                        Stage::Setup => "setup",
                        Stage::Flush => "flush",
                        Stage::Dispose => "dispose",
                    };
                    Value::Object(vec![
                        (
                            "index".encode_utf16().collect(),
                            Value::Number(index as f64),
                        ),
                        (
                            "stage".encode_utf16().collect(),
                            Value::String(stage.encode_utf16().collect()),
                        ),
                    ])
                }),
        )
    }
    #[napi]
    pub fn skip_current(&mut self) {
        self.state.skip_current();
    }
}
#[napi]
#[derive(Default)]
pub struct NativeAgentMcpPages {
    state: Pagination<u32>,
}
#[napi]
impl NativeAgentMcpPages {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn advance(&mut self) {
        self.state.advance();
    }
    #[napi]
    pub fn seen(&self, cursor: u32) -> bool {
        self.state.seen(&cursor)
    }
    #[napi]
    pub fn record(&mut self, cursor: u32) {
        self.state.record(cursor);
    }
    #[napi(getter)]
    pub fn exceeded(&self) -> bool {
        self.state.continuation_error().is_some()
    }
}
#[napi]
pub fn agent_mcp_discovery_error(name: Utf16String, repeated: bool) -> Utf16String {
    poe_agent_rust::plugin_setup::discovery_error(&name, repeated).into()
}

#[napi]
pub fn map_agent_mcp_part<'env>(
    env: Env,
    item: Object<'env>,
    format: Function<'env, FnArgs<(String, Unknown<'_>)>, Unknown<'env>>,
    has_text: Function<'env, Unknown<'env>, bool>,
) -> Result<Unknown<'env>> {
    use poe_agent_rust::plugin_setup::McpPart;
    let kind: Unknown<'env> = item.get_c_named_property_unchecked(c"type")?;
    if kind.get_type()? != napi::ValueType::String {
        return Ok(unsafe {
            Unknown::from_raw_unchecked(env.raw(), Undefined::to_napi_value(env.raw(), ())?)
        });
    }
    let kind: String = unsafe { kind.cast()? };
    let read = |name| item.get_c_named_property_unchecked::<Unknown<'env>>(name);
    let mapped = match kind.as_str() {
        "text" => McpPart::Text(read(c"text")?.raw()),
        "image" => McpPart::Image {
            mime_type: read(c"mimeType")?.raw(),
            data: read(c"data")?.raw(),
        },
        "audio" => McpPart::Text(
            format
                .call(FnArgs::from(("audio".into(), unsafe {
                    Unknown::from_raw_unchecked(env.raw(), item.raw())
                })))?
                .raw(),
        ),
        "resource" => {
            let resource = read(c"resource")?;
            let text =
                has_text.call(unsafe { Unknown::from_raw_unchecked(env.raw(), resource.raw()) })?;
            McpPart::Text(if text {
                resource
                    .coerce_to_object()?
                    .get_c_named_property_unchecked::<Unknown<'env>>(c"text")?
                    .raw()
            } else {
                format.call(FnArgs::from(("blob".into(), resource)))?.raw()
            })
        }
        "resource_link" => McpPart::Text(
            format
                .call(FnArgs::from(("link".into(), unsafe {
                    Unknown::from_raw_unchecked(env.raw(), item.raw())
                })))?
                .raw(),
        ),
        _ => {
            return Ok(unsafe {
                Unknown::from_raw_unchecked(env.raw(), Undefined::to_napi_value(env.raw(), ())?)
            });
        }
    };
    let value = super::transcript_binding::encode(env, poe_agent_rust::plugin_setup::part(mapped))?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), value) })
}

#[napi]
pub fn agent_mcp_tool_error<'env>(env: Env, message: Unknown<'env>) -> Result<Unknown<'env>> {
    let value = super::transcript_binding::encode(
        env,
        poe_agent_rust::plugin_setup::tool_error(message.raw()),
    )?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), value) })
}
