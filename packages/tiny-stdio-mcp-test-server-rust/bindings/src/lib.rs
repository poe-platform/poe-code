//! Self-contained fixture addon; shared server binding exports are embedded here.
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use tiny_stdio_mcp_test_server_rust::{self as fixtures, Tool};
#[path = "../../../tiny-stdio-mcp-server-rust/bindings/src/lib.rs"]
pub mod embedded_stdio;

#[napi]
pub fn fixture_caesar_encrypt(text: Utf16String, shift: f64) -> Result<Utf16String> {
    fixtures::caesar_encrypt(&text, shift)
        .map(Utf16String::from)
        .map_err(Error::from_reason)
}
#[napi]
pub fn fixture_next_spawn_count(value: Option<Utf16String>) -> Result<f64> {
    fixtures::next_spawn_count(value.as_ref().map(|value| value.as_ref()))
        .map(|count| count as f64)
        .map_err(Error::from_reason)
}
#[napi]
pub fn fixture_tools() -> NativeJson {
    NativeJson(Value::Array(Tool::descriptors()))
}
#[napi]
pub fn fixture_word_of_the_day() -> &'static str {
    fixtures::WORD_OF_THE_DAY
}
#[napi]
pub fn fixture_cli_plan(
    args: Vec<Utf16String>,
    command: Utf16String,
    version: Utf16String,
) -> NativeJson {
    let args: Vec<_> = args.into_iter().map(|arg| arg.to_vec()).collect();
    NativeJson(fixtures::cli::plan(&args, &command, &version))
}
