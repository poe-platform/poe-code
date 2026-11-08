use mcp_protocol_rust::json::{self, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use tiny_oauth_test_server_rust::Fixture;
fn parse(text: &[u16]) -> Result<Value> {
    json::parse_utf16(text, Default::default())
        .map_err(|_| Error::from_reason("Invalid native fixture input"))
}
fn reply(result: std::result::Result<Value, tiny_oauth_test_server_rust::Error>) -> Utf16String {
    let (key, value) = match result {
        Ok(value) => ("value", value),
        Err(error) => ("fault", error.value()),
    };
    json::stringify(&Value::Object(vec![(key.encode_utf16().collect(), value)]))
        .encode_utf16()
        .collect::<Vec<_>>()
        .into()
}
#[napi]
pub struct NativeOAuthFixture {
    state: Fixture,
}
#[napi]
impl NativeOAuthFixture {
    #[napi(constructor)]
    pub fn new(options: Utf16String) -> Result<Self> {
        Ok(Self {
            state: Fixture::new(parse(&options)?).map_err(|e| Error::from_reason(e.message))?,
        })
    }
    #[napi]
    pub fn call(&mut self, command: String, input: Utf16String) -> Result<Utf16String> {
        Ok(reply(self.state.call(&command, parse(&input)?)))
    }
}
