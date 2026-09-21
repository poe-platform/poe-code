use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
pub(crate) fn number(value: Unknown<'_>) -> Result<f64> {
    Ok(if value.get_type()? == napi::ValueType::Number {
        unsafe { value.cast::<f64>()? }
    } else {
        f64::NAN
    })
}
#[napi]
pub struct NativeSpawnCommand {
    state: agent_spawn_rust::command::Command,
}
#[napi]
impl NativeSpawnCommand {
    #[napi(constructor)]
    pub fn new(unix: bool, can_abort: bool, timeout: Unknown<'_>, preabort: bool) -> Result<Self> {
        Ok(Self {
            state: agent_spawn_rust::command::Command::new(
                unix,
                can_abort,
                number(timeout)?,
                preabort,
            ),
        })
    }
    #[napi(getter)]
    pub fn group(&self) -> bool {
        self.state.group()
    }
    #[napi(getter)]
    pub fn terminated(&self) -> bool {
        self.state.terminated()
    }
    #[napi]
    pub fn preaborted(&mut self) -> Option<NativeJson> {
        self.state.preaborted().map(NativeJson)
    }
    #[napi]
    pub fn stdout(&mut self, chunk: Utf16String) {
        self.state.stdout(&chunk);
    }
    #[napi]
    pub fn stderr(&mut self, chunk: Utf16String) {
        self.state.stderr(&chunk);
    }
    #[napi]
    pub fn terminate(&mut self, timeout: bool) -> bool {
        self.state.terminate(if timeout {
            agent_spawn_rust::command::Termination::Timeout
        } else {
            agent_spawn_rust::command::Termination::Abort
        })
    }
    #[napi]
    pub fn close(&mut self, code: Option<f64>, signal: Option<f64>) -> Option<NativeJson> {
        self.state.close(code, signal).map(NativeJson)
    }
    #[napi]
    pub fn error(
        &mut self,
        message: Utf16String,
        code: Option<f64>,
        errno: Option<f64>,
    ) -> Option<NativeJson> {
        self.state.error(&message, code, errno).map(NativeJson)
    }
}
#[napi]
pub fn spawn_command_timings() -> Vec<u32> {
    vec![
        agent_spawn_rust::command::TERMINATION_GRACE_MS,
        agent_spawn_rust::command::GROUP_POLL_MS,
        agent_spawn_rust::command::GROUP_WAIT_MS,
    ]
}
