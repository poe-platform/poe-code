use napi::{Error, Result};
use napi_derive::napi;
#[napi]
#[derive(Default)]
pub struct NativePromptOrder {
    state: poe_agent_rust::prompts::Order,
}
#[napi]
impl NativePromptOrder {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn add(&mut self, handle: u32) {
        self.state.add(handle);
    }
    #[napi]
    pub fn get(&self, index: u32) -> Option<u32> {
        self.state.get(index as usize)
    }
    #[napi]
    pub fn snapshot(&self) -> Vec<u32> {
        self.state.snapshot()
    }
    #[napi]
    pub fn append(&mut self, handles: Vec<u32>, offset: u32) -> Result<()> {
        self.state
            .append(handles, offset)
            .map_err(Error::from_reason)
    }
}
