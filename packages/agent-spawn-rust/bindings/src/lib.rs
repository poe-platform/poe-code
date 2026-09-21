use mcp_protocol_rust::json::{self, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
#[path = "../../../agent-harness-tools-rust/bindings/src/lib.rs"]
mod harness;
pub use harness::*;
#[path = "../../../agent-hook-config-rust/bindings/src/lib.rs"]
mod hooks;
#[path = "../../../agent-skill-config-rust/bindings/src/lib.rs"]
// The harness already reexports the shared mutation bindings.
#[allow(unused_imports)]
mod skills;
pub use hooks::*;
pub use skills::*;
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
    pub fn telemetry_supported(&self, input: String) -> bool {
        self.planner.telemetry_supported(&input)
    }
    #[napi]
    pub fn telemetry_plan(
        &self,
        input: String,
        endpoint: String,
        correlation: String,
        content: bool,
    ) -> NativeJson {
        NativeJson(
            self.planner
                .telemetry_plan(&input, &endpoint, &correlation, content)
                .unwrap_or(Value::Null),
        )
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
    pub fn selected_stdin(&self, input: String, options: Utf16String) -> Result<NativeJson> {
        self.planner
            .selected_stdin(&input, &parse(options)?)
            .map(|v| NativeJson(v.unwrap_or(Value::Null)))
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
use command_binding::number;
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
    pub fn abandon(&mut self) {
        self.state = poe_acp_client_rust::client::Queue::default();
        self.state.complete();
    }
    #[napi]
    pub fn push(&mut self, token: f64) -> bool {
        self.state.push(Value::Number(token))
    }
    #[napi]
    pub fn push_many(&mut self, tokens: Vec<f64>) -> bool {
        for token in tokens {
            if !self.state.push(Value::Number(token)) {
                return false;
            }
        }
        true
    }
    #[napi]
    pub fn poll_many(&mut self, count: u32) -> QueueBatch {
        let mut tokens = vec![];
        let mut kind = None;
        for _ in 0..count.clamp(1, 4096) {
            let action = self.state.poll();
            if let Some(Value::Number(token)) = action.get("value") {
                tokens.push(*token);
            } else {
                if let Some(Value::String(value)) = action.get("type") {
                    kind = Some(String::from_utf16_lossy(value));
                }
                break;
            }
        }
        QueueBatch { tokens, kind }
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

pub mod command_binding;

#[napi]
pub struct NativeSpawnAdapter {
    state: agent_spawn_rust::adapters::Adapter,
}
#[napi]
impl NativeSpawnAdapter {
    #[napi(constructor)]
    pub fn new(format: String) -> Result<Self> {
        Ok(Self {
            state: agent_spawn_rust::adapters::Adapter::new(&format).map_err(Error::from_reason)?,
        })
    }
    #[napi]
    pub fn lines(&mut self, lines: Vec<Utf16String>) -> Either<String, NativeJson> {
        let mut packets = vec![];
        for line in lines {
            packets.extend(self.state.line(&line));
        }
        let packets = Value::Array(packets);
        if packets.is_finite_json() {
            Either::A(json::stringify(&packets))
        } else {
            Either::B(NativeJson(packets))
        }
    }
    #[napi]
    pub fn line(&mut self, line: Utf16String) -> NativeJson {
        NativeJson(Value::Array(self.state.line(&line)))
    }
}
#[napi]
pub fn spawn_claude_kinds() -> NativeJson {
    NativeJson(agent_spawn_rust::adapters::claude_kinds())
}
#[napi]
pub fn spawn_truncate(value: Utf16String, max: f64) -> Utf16String {
    if value.len() as f64 <= max {
        return value;
    }
    let end = if max <= 3.0 { max } else { max - 3.0 };
    let end = if end.is_nan() {
        0
    } else if end < 0.0 {
        ((value.len() as f64 + end.trunc()).max(0.0)) as usize
    } else {
        end as usize
    };
    let mut output = value[..end.min(value.len())].to_vec();
    if max > 3.0 || max.is_nan() {
        output.extend([46, 46, 46]);
    }
    output.into()
}
#[napi]
pub fn spawn_is_nonempty(value: Unknown<'_>) -> Result<bool> {
    Ok(value.get_type()? == napi::ValueType::String
        && !unsafe { value.cast::<Utf16String>()? }.is_empty())
}
#[napi]
#[derive(Default)]
pub struct NativeSpawnLines {
    state: agent_spawn_rust::stream::LineBuffer,
}
#[napi]
impl NativeSpawnLines {
    #[napi(constructor)]
    pub fn new(trim_cr: Option<bool>) -> Self {
        Self {
            state: agent_spawn_rust::stream::LineBuffer::new(trim_cr.unwrap_or(false)),
        }
    }
    #[napi]
    pub fn push(&mut self, chunk: Utf16String) -> Vec<Utf16String> {
        self.state
            .push(&chunk)
            .into_iter()
            .map(Into::into)
            .collect()
    }
    #[napi]
    pub fn end(&mut self) -> Option<Utf16String> {
        self.state.end().map(Into::into)
    }
}
#[napi]
#[derive(Default)]
pub struct NativeSpawnDispatch {
    state: agent_spawn_rust::stream::Dispatch,
}
#[napi]
impl NativeSpawnDispatch {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn enter(&mut self, position: u32, count: u32) -> Result<bool> {
        self.state
            .enter(position as usize, count as usize)
            .map_err(Error::from_reason)
    }
}
#[napi]
pub fn spawn_middleware_callback(position: u32, callable: bool) -> Result<()> {
    agent_spawn_rust::stream::validate_callback(position as usize, callable)
        .map_err(Error::from_reason)
}
#[napi]
pub fn spawn_render_kind(kind: Option<Utf16String>) -> Utf16String {
    agent_spawn_rust::render::render_kind(kind.as_deref()).into()
}
#[napi]
pub fn spawn_render_convert(
    input: Utf16String,
    started: bool,
    kind: Option<Utf16String>,
    title: Option<Utf16String>,
    numbers: Vec<Option<f64>>,
) -> Result<NativeJson> {
    Ok(NativeJson(agent_spawn_rust::render::convert(
        &parse(input)?,
        agent_spawn_rust::render::Facts {
            started,
            prior_kind: kind.map(|v| v.to_vec()),
            prior_title: title.map(|v| v.to_vec()),
            numbers,
        },
    )))
}
#[napi]
pub fn spawn_render_output(content: Utf16String) -> Result<Utf16String> {
    let content = parse(content)?;
    let value = Value::Object(vec![("content".encode_utf16().collect(), content)]);
    match agent_spawn_rust::render::output(&value) {
        Value::String(value) => Ok(value.into()),
        _ => Err(Error::from_reason("Invalid tool output")),
    }
}

#[napi]
pub fn spawn_otel_signal(path: Utf16String) -> Option<String> {
    agent_spawn_rust::otel::signal(&path).map(str::to_owned)
}

#[napi]
pub fn spawn_merge_mcp(existing: Utf16String, addition: Utf16String) -> Result<NativeJson> {
    agent_spawn_rust::execution::merge_mcp(&parse(existing)?, &parse(addition)?)
        .map(NativeJson)
        .map_err(Error::from_reason)
}

#[napi]
#[derive(Default)]
pub struct NativeSpawnUsage {
    state: agent_spawn_rust::stream::Usage,
}
#[napi]
impl NativeSpawnUsage {
    #[napi(constructor)]
    pub fn new(initial: Option<Vec<Option<f64>>>) -> Self {
        Self {
            state: agent_spawn_rust::stream::Usage::with_initial(usage_fields(
                initial.unwrap_or_default(),
            )),
        }
    }
    #[napi]
    pub fn observe(&mut self, fields: Vec<Option<f64>>) -> NativeJson {
        self.state.observe(usage_fields(fields));
        NativeJson(self.state.value())
    }
    #[napi]
    pub fn observe_nonnegative(&mut self, fields: Vec<Option<f64>>) -> NativeJson {
        NativeJson(self.state.observe_nonnegative(usage_fields(fields)))
    }
}
fn usage_fields(fields: Vec<Option<f64>>) -> [Option<f64>; 4] {
    let mut result = [None; 4];
    for (index, value) in fields.into_iter().take(4).enumerate() {
        result[index] = value;
    }
    result
}

#[napi(object)]
pub struct QueueBatch {
    pub tokens: Vec<f64>,
    pub kind: Option<String>,
}

#[path = "../../../poe-acp-client-rust/bindings/src/lib.rs"]
mod acp;
pub use acp::*;
#[napi]
pub fn spawn_acp_rejection(options: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(agent_spawn_rust::execution::acp_rejection(
        &parse(options)?,
    )))
}
#[napi]
pub fn spawn_acp_exit_code(stop_reason: String) -> u32 {
    agent_spawn_rust::execution::acp_exit_code(&stop_reason)
}

#[napi]
#[derive(Default)]
pub struct NativeSessionCapture {
    state: agent_spawn_rust::capture::SessionCapture,
}
#[napi]
impl NativeSessionCapture {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn observe(&mut self, event: Utf16String, retain: bool) -> Result<NativeJson> {
        Ok(NativeJson(self.state.observe(&parse(event)?, retain)))
    }
}

#[napi]
pub fn spawn_capture_message(retain: bool, has_text: bool) -> bool {
    agent_spawn_rust::capture::message(retain, has_text)
}
