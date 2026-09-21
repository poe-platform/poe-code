use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::file_awareness::{self, Effect};
#[napi]
#[derive(Default)]
pub struct NativeFileAwareness {
    state: file_awareness::Tracker,
}
#[napi]
impl NativeFileAwareness {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn read(&mut self, path: Utf16String) {
        self.state.read(&path);
    }
    #[napi]
    pub fn write(&mut self, path: Utf16String) {
        self.state.write(&path);
    }
    #[napi]
    pub fn snapshot(&self) -> Vec<Vec<Utf16String>> {
        let snapshot = self.state.snapshot();
        vec![
            snapshot.read.into_iter().map(Into::into).collect(),
            snapshot.modified.into_iter().map(Into::into).collect(),
        ]
    }
}
#[napi]
pub fn file_awareness_path_allowed(path: Utf16String) -> bool {
    file_awareness::path_allowed(&path)
}
#[napi]
pub fn file_awareness_tool_effect(tool: Utf16String) -> u32 {
    match file_awareness::tool_effect(&tool) {
        Effect::Ignore => 0,
        Effect::Read => 1,
        Effect::Write => 2,
        Effect::Edit => 3,
    }
}
