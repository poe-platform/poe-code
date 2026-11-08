use napi_derive::napi;
#[napi]
#[derive(Default)]
pub struct NativeDisposal {
    state: poe_agent_rust::run_context::Disposal,
}
#[napi]
impl NativeDisposal {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn add(&mut self, handle: u32) {
        self.state.add(handle);
    }
    #[napi]
    pub fn attempts(&self) -> Vec<u32> {
        self.state.attempts()
    }
    #[napi]
    pub fn retain_failed(&mut self, failures: Vec<u32>) {
        self.state.retain_failed(failures);
    }
    #[napi]
    pub fn clear(&mut self) {
        self.state.clear();
    }
}
