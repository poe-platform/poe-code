use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
#[napi]
#[derive(Default)]
pub struct NativeAgentCallerPending {
    state: poe_agent_rust::caller_ack::Pending,
}
#[napi]
impl NativeAgentCallerPending {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn insert(&mut self, id: Utf16String) -> Result<Option<f64>> {
        self.state
            .insert(id.to_vec())
            .map(|i| i.map(|i| i as f64))
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn take(&mut self, id: Utf16String) -> Option<f64> {
        self.state.take(&id).map(|i| i as f64)
    }
    #[napi]
    pub fn drain(&mut self) -> Vec<f64> {
        self.state.drain().into_iter().map(|i| i as f64).collect()
    }
}
