use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
#[path = "../../../terminal-pilot-rust/bindings/src/lib.rs"]
pub mod embedded_pilot;
#[path = "../../../tiny-stdio-mcp-server-rust/bindings/src/lib.rs"]
pub mod embedded_stdio;
#[napi]
#[derive(Default)]
pub struct NativeTerminalMcpAdmission {
    state: terminal_pilot_mcp_rust::ShutdownAdmission,
}
#[napi]
impl NativeTerminalMcpAdmission {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn shutdown(&mut self) {
        self.state.shutdown();
    }
    #[napi]
    pub fn assert_open(&self) -> Result<()> {
        self.state.admit().map_err(Error::from_reason)
    }
}
#[napi]
pub fn terminal_pilot_mcp_tools() -> NativeJson {
    NativeJson(Value::Array(terminal_pilot_mcp_rust::tools()))
}
#[napi]
pub fn terminal_pilot_mcp_result(env: Env, name: String, value: Unknown<'_>) -> Result<NativeJson> {
    let value = mcp_protocol_rust_napi_core::json_input::read(
        &env,
        value,
        mcp_protocol_rust_napi_core::json_input::Mode::Json,
    )?
    .unwrap_or(Value::Null);
    Ok(NativeJson(
        terminal_pilot_mcp_rust::result(&name, &value).unwrap_or_else(|fault| {
            Value::Object(vec![
                (
                    "fault".encode_utf16().collect(),
                    Value::String(fault.message.encode_utf16().collect()),
                ),
                (
                    "code".encode_utf16().collect(),
                    Value::Number(fault.code as f64),
                ),
            ])
        }),
    ))
}
#[napi]
pub fn terminal_pilot_mcp_cli(args: Vec<String>) -> Result<bool> {
    terminal_pilot_mcp_rust::cli(&args).map_err(Error::from_reason)
}
#[napi]
pub fn terminal_pilot_mcp_help() -> &'static str {
    terminal_pilot_mcp_rust::HELP
}
