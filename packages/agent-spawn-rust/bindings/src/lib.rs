use mcp_protocol_rust::json::{self, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
fn parse(source: Utf16String) -> Result<Value> {
    json::parse_utf16(&source, Default::default())
        .map_err(|_| Error::from_reason("Invalid spawn JSON value"))
}
#[napi]
pub struct NativeSpawnPlanner {
    planner: agent_spawn_rust::Planner,
}
#[napi]
impl NativeSpawnPlanner {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            planner: agent_spawn_rust::Planner::builtins(),
        }
    }
    #[napi]
    pub fn supports_mode(&self, input: String, mode: String) -> bool {
        self.planner.supports_mode(&input, &mode)
    }
    #[napi]
    pub fn mcp_admission(
        &self,
        agent: String,
        servers: Utf16String,
        supported: bool,
        argv: bool,
        strict: bool,
    ) -> Result<bool> {
        self.planner
            .mcp_admission(&agent, &parse(servers)?, supported, argv, strict)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn catalog(&self) -> NativeJson {
        NativeJson(self.planner.catalog())
    }
    #[napi]
    pub fn resolve_id(&self, input: String) -> Option<Utf16String> {
        self.planner
            .definition(&input)
            .and_then(|d| d.metadata.get("id"))
            .and_then(|v| {
                if let Value::String(v) = v {
                    Some(v.clone().into())
                } else {
                    None
                }
            })
    }
    #[napi]
    pub fn build(
        &self,
        input: String,
        options: Utf16String,
        binary: Option<Utf16String>,
    ) -> Result<NativeJson> {
        self.planner
            .build(&input, &parse(options)?, binary.as_deref())
            .map(NativeJson)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn model(&self, input: String, model: Utf16String) -> Result<Utf16String> {
        let config = self
            .planner
            .definition(&input)
            .and_then(|d| d.spawn_config.as_ref())
            .ok_or_else(|| Error::from_reason("Agent has no CLI spawn config"))?;
        Ok(agent_spawn_rust::model_transform(config, &model).into())
    }
    #[napi]
    pub fn resume(
        &self,
        input: String,
        thread: Utf16String,
        cwd: Utf16String,
        hint: bool,
    ) -> Result<NativeJson> {
        let config = self
            .planner
            .definition(&input)
            .and_then(|d| d.spawn_config.as_ref())
            .ok_or_else(|| Error::from_reason("Agent has no CLI spawn config"))?;
        Ok(NativeJson(Value::Array(agent_spawn_rust::resume_args(
            config, &thread, &cwd, hint,
        ))))
    }
    #[napi]
    pub fn acp_args(&self, input: String, options: Utf16String) -> Result<NativeJson> {
        self.planner
            .acp_args(&input, &parse(options)?)
            .map(NativeJson)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn supported_mcp(&self) -> Vec<String> {
        self.planner.supported_mcp()
    }
}
#[napi]
pub fn spawn_mode_config(source: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(agent_spawn_rust::mode_config(&parse(source)?)))
}
#[napi]
pub fn spawn_resolve_mode(source: Utf16String, mode: Option<String>) -> Result<NativeJson> {
    agent_spawn_rust::resolve_mode(&parse(source)?, mode.as_deref())
        .map(NativeJson)
        .map_err(Error::from_reason)
}
#[napi]
pub fn spawn_mcp(servers: Utf16String, format: String) -> Result<NativeJson> {
    agent_spawn_rust::mcp::serialize(&parse(servers)?, &format)
        .map(NativeJson)
        .map_err(Error::from_reason)
}
#[napi]
pub fn spawn_json_servers(servers: Utf16String) -> Result<NativeJson> {
    agent_spawn_rust::mcp::json_servers(&parse(servers)?)
        .map(NativeJson)
        .map_err(Error::from_reason)
}
#[napi]
pub fn spawn_merge_environment(sources: Vec<Utf16String>) -> Result<NativeJson> {
    let values = sources.into_iter().map(parse).collect::<Result<Vec<_>>>()?;
    Ok(NativeJson(agent_spawn_rust::environment(&values)))
}
#[napi]
pub fn spawn_strip_model(model: Utf16String) -> Utf16String {
    let start = model.iter().position(|v| *v == 47).map_or(0, |i| i + 1);
    model[start..].to_vec().into()
}

impl Default for NativeSpawnPlanner {
    fn default() -> Self {
        Self::new()
    }
}
fn number(value: Unknown<'_>) -> Result<f64> {
    Ok(if value.get_type()? == napi::ValueType::Number {
        unsafe { value.cast::<f64>()? }
    } else {
        f64::NAN
    })
}
#[napi(object)]
pub struct RetryDecision {
    pub kind: String,
    pub delay: Option<f64>,
}
fn retry_decision(value: agent_spawn_rust::retry::Decision) -> RetryDecision {
    use agent_spawn_rust::retry::Decision;
    match value {
        Decision::Done => RetryDecision {
            kind: "done".into(),
            delay: None,
        },
        Decision::Check => RetryDecision {
            kind: "check".into(),
            delay: None,
        },
        Decision::Wait(ms) => RetryDecision {
            kind: "wait".into(),
            delay: Some(ms),
        },
    }
}
#[napi]
pub struct NativeSpawnRetry {
    state: agent_spawn_rust::retry::Retry,
}
#[napi]
impl NativeSpawnRetry {
    #[napi(constructor)]
    pub fn new(max: Unknown<'_>, base: Unknown<'_>) -> Result<Self> {
        Ok(Self {
            state: agent_spawn_rust::retry::Retry::new(number(max)?, number(base)?)
                .map_err(Error::from_reason)?,
        })
    }
    #[napi]
    pub fn begin(&mut self, aborted: bool) -> Result<f64> {
        self.state.begin(aborted).map_err(Error::from_reason)
    }
    #[napi]
    pub fn evaluate(&mut self, exit: Unknown<'_>) -> Result<RetryDecision> {
        Ok(retry_decision(
            self.state
                .evaluate(number(exit)?)
                .map_err(Error::from_reason)?,
        ))
    }
    #[napi]
    pub fn finish_check(&mut self, retry: bool) -> Result<RetryDecision> {
        Ok(retry_decision(
            self.state.finish_check(retry).map_err(Error::from_reason)?,
        ))
    }
    #[napi]
    pub fn prefix(&self, kind: String) -> NativeJson {
        NativeJson(Value::Object(vec![
            (
                "field".encode_utf16().collect(),
                agent_spawn_rust::retry::prefix_field(&kind)
                    .map_or(Value::Null, |v| Value::String(v.encode_utf16().collect())),
            ),
            (
                "prefix".encode_utf16().collect(),
                Value::String(
                    format!("attempt: {} ", self.state.attempt())
                        .encode_utf16()
                        .collect(),
                ),
            ),
        ]))
    }
    #[napi]
    pub fn wait_event(&self, ms: f64) -> NativeJson {
        NativeJson(Value::Object(vec![
            (
                "event".encode_utf16().collect(),
                Value::String("agent_message".encode_utf16().collect()),
            ),
            (
                "text".encode_utf16().collect(),
                Value::String(
                    format!(
                        "attempt: {} wait {}ms before retry",
                        self.state.attempt(),
                        if ms.is_nan() {
                            "NaN".into()
                        } else {
                            mcp_protocol_rust::numbers::format(ms)
                        }
                    )
                    .encode_utf16()
                    .collect(),
                ),
            ),
        ]))
    }
}
#[napi]
pub fn spawn_retryable(exit: Unknown<'_>) -> Result<bool> {
    Ok(agent_spawn_rust::retry::retryable(number(exit)?))
}
#[napi]
pub fn spawn_backoff(base: f64, completed: f64) -> f64 {
    agent_spawn_rust::retry::backoff(base, completed)
}
#[napi]
#[derive(Default)]
pub struct NativeSpawnQueue {
    state: poe_acp_client_rust::client::Queue,
}
#[napi]
impl NativeSpawnQueue {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn push(&mut self, token: f64) -> bool {
        self.state.push(Value::Number(token))
    }
    #[napi]
    pub fn poll(&mut self) -> NativeJson {
        NativeJson(self.state.poll())
    }
    #[napi]
    pub fn close(&mut self) {
        self.state.complete();
    }
    #[napi]
    pub fn fail(&mut self) {
        self.state.fail("failure".into());
    }
}

#[napi]
pub struct NativeSpawnParallel {
    state: agent_spawn_rust::parallel::Scheduler,
}
#[napi]
impl NativeSpawnParallel {
    #[napi(constructor)]
    pub fn new(count: u32, max: Unknown<'_>, check: Unknown<'_>, fail_fast: bool) -> Result<Self> {
        // Preserve validation precedence even for empty input.
        let max = number(max)?;
        if !max.is_finite() || max.fract() != 0.0 || max < 1.0 {
            return Err(Error::from_reason(
                "spawn.parallel maxConcurrent must be an integer greater than or equal to 1.",
            ));
        }
        if check.get_type()? != napi::ValueType::Boolean {
            return Err(Error::from_reason(
                "spawn.parallel check must be a boolean.",
            ));
        }
        let check = unsafe { check.cast::<bool>()? };
        Ok(Self {
            state: agent_spawn_rust::parallel::Scheduler::new(
                count as usize,
                max,
                check,
                fail_fast,
            )
            .map_err(Error::from_reason)?,
        })
    }
    #[napi(getter)]
    pub fn workers(&self) -> u32 {
        self.state.workers() as u32
    }
    #[napi]
    pub fn take(&mut self) -> Option<u32> {
        self.state.take().map(|index| index as u32)
    }
    #[napi]
    pub fn complete(&mut self, index: u32, exit: Unknown<'_>) -> Result<bool> {
        self.state
            .complete(index as usize, number(exit)? == 0.0)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn reject(&mut self, index: u32, aborted: bool) -> Result<String> {
        Ok(match self
            .state
            .reject(index as usize, aborted)
            .map_err(Error::from_reason)?
        {
            agent_spawn_rust::parallel::Rejection::Primary => "primary",
            agent_spawn_rust::parallel::Rejection::Collect => "collect",
            agent_spawn_rust::parallel::Rejection::Ignore => "ignore",
        }
        .into())
    }
    #[napi]
    pub fn stop(&mut self) -> bool {
        self.state.stop()
    }
    #[napi]
    pub fn first_failed(&self) -> Option<u32> {
        self.state.first_failed().map(|index| index as u32)
    }
}
