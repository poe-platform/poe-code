use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::execution::{EventQueue, Next, Push, RunState, StopFailure};

#[napi]
#[derive(Default)]
pub struct NativeAgentEventQueue {
    state: EventQueue<u32, u32>,
}
#[napi]
impl NativeAgentEventQueue {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn push(&mut self, item: u32) -> i64 {
        match self.state.push(item) {
            Push::Buffered => -1,
            Push::Discard(_) => -2,
            Push::Deliver { waiter, .. } => i64::from(waiter),
        }
    }
    #[napi]
    pub fn take(&mut self) -> i64 {
        match self.state.take() {
            Next::Item(item) => i64::from(item),
            Next::Wait => -1,
            Next::Closed => -2,
        }
    }
    #[napi]
    pub fn wait(&mut self, waiter: u32) {
        self.state.wait(waiter);
    }
    #[napi]
    pub fn close(&mut self) -> Vec<u32> {
        self.state.close()
    }
}

#[napi]
#[derive(Default)]
pub struct NativeAgentExecution {
    state: RunState,
}
#[napi]
impl NativeAgentExecution {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn accepts_event(&self) -> bool {
        self.state.accept_event()
    }
    #[napi]
    pub fn accept_terminal(&mut self) -> bool {
        self.state.accept_terminal()
    }
    #[napi]
    pub fn start_stop(&mut self) {
        self.state.start_stop();
    }
    #[napi]
    pub fn stop_started(&self) -> bool {
        self.state.stop_started()
    }
    #[napi]
    pub fn disposed(&self) -> bool {
        self.state.disposed()
    }
    #[napi]
    pub fn finish_disposal(&mut self) {
        self.state.finish_disposal();
    }
    #[napi]
    pub fn advance_iteration(&mut self, options: Object<'_>) -> Result<Option<f64>> {
        self.state
            .next_iteration(None)
            .expect("no maximum cannot reject");
        let first: Unknown<'_> = options.get_named_property("maxIterations")?;
        if first.get_type()? != ValueType::Undefined {
            let maximum: Unknown<'_> = options.get_named_property("maxIterations")?;
            let maximum = maximum.coerce_to_number()?.get_double()?;
            if self.state.iteration() > maximum {
                return Ok(None);
            }
        }
        Ok(Some(self.state.iteration()))
    }
    #[napi]
    pub fn check_stop(&self, env: Env, response: Object<'_>) -> Result<()> {
        let reason: Unknown<'_> = response.get_named_property("stopReason")?;
        if reason.get_type()? == ValueType::String {
            let value = unsafe { reason.cast::<Utf16String>()? };
            if value.to_vec() == "error".encode_utf16().collect::<Vec<_>>() {
                return env.throw_error(StopFailure::Model.message(), None);
            }
        }
        let reason: Unknown<'_> = response.get_named_property("stopReason")?;
        if reason.get_type()? == ValueType::String {
            let value = unsafe { reason.cast::<Utf16String>()? };
            if value.to_vec() == "max_tokens".encode_utf16().collect::<Vec<_>>() {
                return env.throw_error(StopFailure::TokenLimit.message(), None);
            }
        }
        Ok(())
    }
}
