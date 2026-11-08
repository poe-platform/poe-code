use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::shell_tools::{self, RetainedOutput};
#[napi(custom_finalize)]
#[derive(Default)]
pub struct NativeAgentShellOutput {
    state: RetainedOutput,
    reported_bytes: i64,
}
#[napi]
impl NativeAgentShellOutput {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn append(&mut self, env: Env, chunk: Utf16String) -> Result<i64> {
        self.state.append(&chunk);
        let bytes = self.state.allocated_bytes() as i64;
        // Return V8's accounting counter for native allocation diagnostics.
        // process.memoryUsage().external does not include this counter on all hosts.
        let external = env.adjust_external_memory(bytes - self.reported_bytes)?;
        self.reported_bytes = bytes;
        Ok(external)
    }
    #[napi]
    pub fn format(&self) -> Utf16String {
        self.state.format().into()
    }
}
#[napi]
pub fn agent_shell_timeout(seconds: Option<f64>) -> Result<f64> {
    shell_tools::timeout_ms(seconds).map_err(napi::Error::from_reason)
}
#[napi]
pub fn agent_shell_policy(command: Utf16String, mode: Utf16String) -> Option<Utf16String> {
    shell_tools::validate_policy(&command, &String::from_utf16_lossy(&mode)).map(Into::into)
}

impl ObjectFinalize for NativeAgentShellOutput {
    fn finalize(self, env: Env) -> Result<()> {
        if self.reported_bytes != 0 {
            env.adjust_external_memory(-self.reported_bytes)?;
        }
        Ok(())
    }
}
