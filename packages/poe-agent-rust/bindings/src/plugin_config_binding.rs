use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::plugin_config::{Names, distance};
#[napi]
#[derive(Default)]
pub struct NativeAgentPluginNames {
    state: Names,
}
#[napi]
impl NativeAgentPluginNames {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn contains(&self, name: Utf16String) -> bool {
        self.state.contains(&name)
    }
    #[napi]
    pub fn insert(&mut self, name: Utf16String) -> bool {
        self.state.insert(name.to_vec())
    }
}
#[napi]
pub fn agent_plugin_distances(name: Utf16String, candidates: Vec<Utf16String>) -> Vec<u32> {
    candidates
        .iter()
        .map(|candidate| distance(&name, candidate) as u32)
        .collect()
}
