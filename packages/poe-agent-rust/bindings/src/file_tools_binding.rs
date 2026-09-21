use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::file_tools;
#[napi]
pub fn agent_slice_lines(content: Utf16String, offset: f64, limit: Option<f64>) -> Utf16String {
    file_tools::slice_lines(&content, offset, limit).into()
}
#[napi]
pub fn agent_count_occurrences(content: Utf16String, search: Utf16String) -> f64 {
    file_tools::count_occurrences(&content, &search) as f64
}
#[napi]
pub fn agent_replace_text(
    content: Utf16String,
    search: Utf16String,
    replacement: Utf16String,
    all: bool,
) -> Utf16String {
    file_tools::replace_text(&content, &search, &replacement, all).into()
}
#[napi]
pub fn agent_image_mime(extension: Utf16String) -> Option<String> {
    file_tools::image_mime(&extension).map(str::to_owned)
}
#[napi]
pub struct NativeAgentGlob {
    state: file_tools::Glob,
}
#[napi]
impl NativeAgentGlob {
    #[napi(constructor)]
    pub fn new(pattern: Utf16String) -> Result<Self> {
        Ok(Self {
            state: file_tools::Glob::new(&pattern).map_err(Error::from_reason)?,
        })
    }
    #[napi]
    pub fn base(&self) -> Utf16String {
        self.state.base().to_vec().into()
    }
    #[napi]
    pub fn static_path(&self) -> Option<Utf16String> {
        self.state.static_path().map(|value| value.to_vec().into())
    }
    #[napi]
    pub fn match_paths(&self, paths: Vec<Utf16String>) -> Vec<bool> {
        paths.iter().map(|path| self.state.matches(path)).collect()
    }
    #[napi]
    pub fn max_depth(&self) -> Option<f64> {
        self.state.max_depth().map(|value| value as f64)
    }
    #[napi]
    pub fn matches(&self, path: Utf16String) -> bool {
        self.state.matches(&path)
    }
}
