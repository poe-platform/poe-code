use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::{html_markdown, web_tools};
#[napi]
pub fn agent_web_non_public_host(host: Utf16String) -> bool {
    web_tools::non_public_host(&host)
}
#[napi]
pub fn agent_web_content_type(value: Option<Utf16String>) -> Utf16String {
    web_tools::normalize_content_type(value.as_deref()).into()
}
#[napi]
pub fn agent_web_page(
    url: Utf16String,
    kind: Utf16String,
    content: Utf16String,
    offset: f64,
) -> Utf16String {
    web_tools::page(&url, &kind, &content, offset as usize).into()
}
#[napi]
pub fn agent_html_markdown(content: Utf16String) -> Result<Utf16String> {
    html_markdown::convert(&content)
        .map(Into::into)
        .map_err(napi::Error::from_reason)
}
#[napi(custom_finalize)]
#[derive(Default)]
pub struct NativeAgentWebSearch {
    state: web_tools::SearchResults,
    reported: i64,
}
#[napi]
impl NativeAgentWebSearch {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn push(&mut self, env: Env, value: Utf16String) -> Result<()> {
        self.state.push(&value);
        let bytes = self.state.allocated_bytes() as i64;
        if bytes != self.reported {
            env.adjust_external_memory(bytes - self.reported)?;
            self.reported = bytes;
        }
        Ok(())
    }
    #[napi(getter)]
    pub fn complete(&self) -> bool {
        self.state.complete()
    }
    #[napi]
    pub fn format(&self) -> Utf16String {
        self.state.format().into()
    }
}
impl ObjectFinalize for NativeAgentWebSearch {
    fn finalize(self, env: Env) -> Result<()> {
        if self.reported != 0 {
            env.adjust_external_memory(-self.reported)?;
        }
        Ok(())
    }
}
