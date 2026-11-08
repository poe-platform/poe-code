use mcp_protocol_rust::json::{self, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use tiny_http_mcp_oauth_test_server_rust::{Error as FixtureError, Fixture};
#[path = "../../../tiny-http-mcp-server-rust/bindings/src/lib.rs"]
pub mod embedded_http;
#[path = "../../../tiny-oauth-test-server-rust/bindings/src/lib.rs"]
pub mod embedded_oauth;
pub use embedded_http::NativeHttpResponseMessages;
pub(crate) use embedded_http::embedded_stdio::convert;
fn parse(text: &[u16]) -> Result<Value> {
    json::parse_utf16(text, Default::default())
        .map_err(|_| Error::from_reason("Invalid native fixture input"))
}
fn reply(result: std::result::Result<Value, FixtureError>) -> Utf16String {
    let (key, value) = match result {
        Ok(v) => ("value", v),
        Err(e) => ("fault", e.value()),
    };
    json::stringify(&Value::Object(vec![(key.encode_utf16().collect(), value)]))
        .encode_utf16()
        .collect::<Vec<_>>()
        .into()
}
#[napi(js_name = "mcpOAuthFixtureOptions")]
pub fn mcp_oauth_fixture_options(input: Utf16String) -> Result<Utf16String> {
    Ok(reply(tiny_http_mcp_oauth_test_server_rust::options(
        &parse(&input)?,
    )))
}
#[napi]
#[derive(Default)]
pub struct NativeMcpOAuthFixture {
    state: Fixture,
}
#[napi]
impl NativeMcpOAuthFixture {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn call(&mut self, command: String, input: Utf16String) -> Result<Utf16String> {
        Ok(reply(self.state.call(&command, parse(&input)?)))
    }
}
