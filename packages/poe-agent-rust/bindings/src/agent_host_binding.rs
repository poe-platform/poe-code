use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::agent_host::{HostState, InvocationState, SpawnOutput, ToolYield};
#[napi]
#[derive(Default)]
pub struct NativeAgentInvocation {
    state: InvocationState,
}
#[napi]
impl NativeAgentInvocation {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn begin_close(&mut self) -> bool {
        self.state.begin_close()
    }
}
#[napi]
#[derive(Default)]
pub struct NativeAgentHostState {
    state: HostState,
}
#[napi]
impl NativeAgentHostState {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn next_fork(&mut self) -> f64 {
        self.state.next_fork()
    }
}
#[napi]
#[derive(Default)]
pub struct NativeAgentSpawnOutput {
    state: SpawnOutput,
}
#[napi]
impl NativeAgentSpawnOutput {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn consume<'env>(
        &mut self,
        env: Env,
        notification: Object<'env>,
        coerce: Unknown<'env>,
    ) -> Result<()> {
        let params: Object<'env> = notification.get_named_property("params")?;
        let update: Object<'env> = params.get_named_property("update")?;
        let kind: Unknown<'env> = update.get_named_property("sessionUpdate")?;
        if !env.strict_equals(kind, env.create_string("agent_message_chunk")?)? {
            return Ok(());
        }
        let content: Unknown<'env> = update.get_named_property("content")?;
        let kind: Unknown<'env> = content.coerce_to_object()?.get_named_property("type")?;
        if !env.strict_equals(kind, env.create_string("text")?)? {
            return Ok(());
        }
        let content: Unknown<'env> = update.get_named_property("content")?;
        let text: Unknown<'env> = content.coerce_to_object()?.get_named_property("text")?;
        let receiver = unsafe { Undefined::to_napi_value(env.raw(), ())? };
        let argument = text.raw();
        let mut result = std::ptr::null_mut();
        let status = unsafe {
            napi::sys::napi_call_function(
                env.raw(),
                receiver,
                coerce.raw(),
                1,
                &argument,
                &mut result,
            )
        };
        if status != napi::sys::Status::napi_ok {
            return Err(napi::Error::new(
                napi::Status::from(status),
                "Spawn chunk coercion failed",
            ));
        }
        let text = unsafe { Utf16String::from_napi_value(env.raw(), result)? };
        self.state.append(&text);
        Ok(())
    }
    #[napi]
    pub fn finish(&mut self) -> Utf16String {
        std::mem::take(&mut self.state).finish().into()
    }
}
#[napi]
pub fn is_agent_tool_delta<'env>(env: Env, next: Object<'env>) -> Result<bool> {
    let value: Unknown<'env> = next.get_named_property("value")?;
    let kind: Unknown<'env> = value.coerce_to_object()?.get_named_property("type")?;
    env.strict_equals(kind, env.create_string("message.delta")?)
}
#[napi]
pub fn map_agent_tool_yield<'env>(
    env: Env,
    next: Object<'env>,
    delta: bool,
) -> Result<Unknown<'env>> {
    let value: Unknown<'env> = next.get_named_property("value")?;
    let value = value.coerce_to_object()?;
    let event = if delta {
        ToolYield::Delta(value.get_named_property::<Unknown<'env>>("content")?.raw())
    } else {
        ToolYield::Progress(value.get_named_property::<Unknown<'env>>("message")?.raw())
    };
    let result = super::transcript_binding::encode(env, event.template())?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), result) })
}
