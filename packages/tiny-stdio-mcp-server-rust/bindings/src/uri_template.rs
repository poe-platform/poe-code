use super::{convert::NativeJson, input};
use napi::{Env, Error, bindgen_prelude::*};
use napi_derive::napi;
use tiny_stdio_mcp_server_rust::uri_template::UriTemplate;

#[napi]
pub struct NativeUriTemplate {
    template: UriTemplate,
}

#[napi]
impl NativeUriTemplate {
    #[napi(constructor)]
    pub fn new(source: Utf16String) -> Result<Self> {
        Ok(Self {
            template: UriTemplate::parse(&source).map_err(Error::from_reason)?,
        })
    }
    #[napi]
    pub fn expand(&self, env: Env, variables: Unknown<'_>) -> Result<Utf16String> {
        let variables = input::read(&env, variables, input::Mode::Json)?
            .ok_or_else(|| Error::from_reason("URI template variables must be an object"))?;
        self.template
            .expand(&variables)
            .map(Into::into)
            .map_err(Error::from_reason)
    }
    #[napi(js_name = "match", ts_return_type = "Record<string, string> | null")]
    pub fn match_uri(&self, uri: Utf16String) -> Result<Option<NativeJson>> {
        self.template
            .match_uri(&uri)
            .map(|value| value.map(NativeJson))
            .map_err(Error::from_reason)
    }
}
