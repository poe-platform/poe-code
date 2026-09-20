use napi::bindgen_prelude::*;
use napi_derive::napi;
#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
#[napi]
pub fn parse_json_rpc_message(line: Utf16String) -> convert::NativeJson {
    convert::NativeJson(tiny_mcp_client_rust::messages::parse_message(line.as_ref()).into_value())
}
