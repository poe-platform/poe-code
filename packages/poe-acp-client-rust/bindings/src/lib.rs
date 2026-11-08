mod notification;
use mcp_protocol_rust::json::{self, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Error, ValueType, bindgen_prelude::*};
use napi_derive::napi;
fn step(step: poe_acp_client_rust::transport::Step) -> NativeJson {
    use poe_acp_client_rust::transport::Step;
    let (kind, ms, fallback) = match step {
        Step::None => ("none", 0.0, Value::Null),
        Step::Wait(ms) => ("wait", ms, Value::Null),
        Step::Kill => ("kill", 0.0, Value::Null),
        Step::Close => ("close", 0.0, Value::Null),
        Step::ForceClose => (
            "close",
            0.0,
            Value::String("SIGKILL".encode_utf16().collect()),
        ),
    };
    NativeJson(Value::Object(vec![
        (
            "kind".encode_utf16().collect(),
            Value::String(kind.encode_utf16().collect()),
        ),
        ("ms".encode_utf16().collect(), Value::Number(ms)),
        ("fallbackSignal".encode_utf16().collect(), fallback),
    ]))
}
#[napi]
#[derive(Default)]
pub struct NativeAcpTransport {
    state: poe_acp_client_rust::transport::Transport,
}
#[napi]
impl NativeAcpTransport {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn append_stderr(&mut self, source: Utf16String) {
        self.state.stderr(&source);
    }
    #[napi(getter)]
    pub fn stderr(&self) -> Utf16String {
        self.state.stderr_output().into()
    }
    #[napi(getter)]
    pub fn closed(&self) -> bool {
        self.state.closed()
    }
    #[napi(getter)]
    pub fn disposing(&self) -> bool {
        self.state.disposing()
    }
    #[napi]
    pub fn begin_dispose(&mut self) -> bool {
        self.state.begin_dispose()
    }
    #[napi]
    pub fn signal_result(&mut self, accepted: bool, now: f64) -> NativeJson {
        step(self.state.signal_result(accepted, now))
    }
    #[napi]
    pub fn step(&mut self, now: f64) -> NativeJson {
        step(self.state.step(now))
    }
    #[napi]
    pub fn close(&mut self) -> bool {
        self.state.close()
    }
}
fn json_text(source: Option<Utf16String>) -> Result<Option<Value>> {
    source
        .map(|source| {
            json::parse_utf16(&source, Default::default())
                .map_err(|_| Error::from_reason("Invalid ACP JSON value"))
        })
        .transpose()
}
fn request_id(source: Unknown<'_>) -> Result<Option<Value>> {
    let value = match source.get_type()? {
        ValueType::Undefined => return Ok(None),
        ValueType::Null => Value::Null,
        ValueType::Number => Value::Number(unsafe { source.cast()? }),
        ValueType::String => Value::String(unsafe { source.cast::<Utf16String>()? }.to_vec()),
        _ => {
            return Err(Error::from_reason(
                "Request id must be null, a string, or a safe integer",
            ));
        }
    };
    Ok(Some(value))
}
#[napi]
pub struct NativeAcpLayer {
    state: poe_acp_client_rust::layer::Layer,
}
#[napi]
impl NativeAcpLayer {
    #[napi(constructor)]
    pub fn new(first: Option<f64>) -> Result<Self> {
        Ok(Self {
            state: poe_acp_client_rust::layer::Layer::new(first.unwrap_or(1.0))
                .map_err(Error::from_reason)?,
        })
    }
    #[napi]
    pub fn register(
        &mut self,
        method: Utf16String,
        notification: bool,
        handler: u32,
    ) -> Option<u32> {
        self.state.register(method.to_vec(), notification, handler)
    }
    #[napi]
    pub fn request(
        &mut self,
        method: Utf16String,
        params: Option<Utf16String>,
        id: Unknown<'_>,
    ) -> Result<NativeJson> {
        let params = json_text(params)?;
        let id = request_id(id)?;
        self.state
            .request(&method, params, id)
            .map(NativeJson)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn notification(
        &self,
        method: Utf16String,
        params: Option<Utf16String>,
    ) -> Result<NativeJson> {
        self.state
            .notification(&method, json_text(params)?)
            .map(NativeJson)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn assert_open(&self) -> Result<()> {
        self.state.assert_open().map_err(Error::from_reason)
    }
    #[napi]
    pub fn incoming(&mut self, source: Utf16String) -> NativeJson {
        NativeJson(self.state.incoming(&source))
    }
    #[napi]
    pub fn cancel(&mut self, token: u32) {
        self.state.cancel(token);
    }
    #[napi(getter)]
    pub fn pending_count(&self) -> u32 {
        self.state.pending_count() as u32
    }
    #[napi]
    pub fn push_text(&mut self, source: Utf16String) -> Result<NativeJson> {
        self.state
            .push(&source)
            .map(|actions| NativeJson(Value::Array(actions)))
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn finish_text(&mut self) -> NativeJson {
        NativeJson(Value::Array(self.state.finish()))
    }
    #[napi]
    pub fn dispose(&mut self) {
        self.state.dispose();
    }
}
#[napi]
pub fn acp_parse_packet(source: Utf16String) -> NativeJson {
    NativeJson(poe_acp_client_rust::protocol::parse(&source))
}
#[napi]
pub fn acp_parse_update(source: Utf16String) -> NativeJson {
    NativeJson(poe_acp_client_rust::updates::parse(&source))
}
#[napi]
pub fn acp_is_error_code(value: Unknown<'_>) -> Result<bool> {
    if value.get_type()? != ValueType::Number {
        return Ok(false);
    }
    let number: f64 = unsafe { value.cast()? };
    Ok(poe_acp_client_rust::protocol::code(&Value::Number(number)))
}
#[napi]
pub fn acp_check_cost(active: bool, value: Unknown<'_>) -> Result<()> {
    if !active {
        return Ok(());
    }
    if value.get_type()? == ValueType::Number && unsafe { value.cast::<f64>()? }.is_finite() {
        Ok(())
    } else {
        Err(Error::from_reason(
            "usage_update cost amount must be finite",
        ))
    }
}
#[napi]
pub fn acp_format_update(
    session: Utf16String,
    update: Utf16String,
    meta: Option<Utf16String>,
) -> Result<String> {
    let parse = |source: &[u16]| {
        json::parse_utf16(source, Default::default())
            .map_err(|_| Error::from_reason("Invalid ACP JSON value"))
    };
    let update = parse(&update)?;
    let meta = meta.map(|meta| parse(&meta)).transpose()?;
    Ok(json::stringify(&poe_acp_client_rust::updates::format(
        session.to_vec(),
        update,
        meta,
    )))
}
#[napi]
pub struct NativeAcpClient {
    state: poe_acp_client_rust::client::Client,
}
#[napi]
impl NativeAcpClient {
    #[napi(constructor)]
    pub fn new(version: Unknown<'_>, skip_auth: bool) -> Result<Self> {
        let version = if version.get_type()? == ValueType::Number {
            unsafe { version.cast::<f64>()? }
        } else {
            f64::NAN
        };
        Ok(Self {
            state: poe_acp_client_rust::client::Client::new(version, skip_auth),
        })
    }
    #[napi(getter)]
    pub fn state(&self) -> String {
        self.state.state().into()
    }
    #[napi(getter)]
    pub fn negotiated_version(&self) -> Option<f64> {
        self.state.negotiated_version()
    }
    #[napi(getter)]
    pub fn auth_methods(&self) -> NativeJson {
        NativeJson(Value::Array(self.state.auth_methods().to_vec()))
    }
    #[napi(getter)]
    pub fn capabilities(&self) -> Option<NativeJson> {
        self.state.capabilities().cloned().map(NativeJson)
    }
    #[napi]
    pub fn snapshot(&self) -> NativeJson {
        NativeJson(self.state.snapshot())
    }
    #[napi]
    pub fn open(&self) -> Result<()> {
        self.state.open().map_err(Error::from_reason)
    }
    #[napi]
    pub fn ready(&self, operation: String) -> Result<()> {
        self.state.ready(&operation).map_err(Error::from_reason)
    }
    #[napi]
    pub fn begin_initialize(&mut self) -> Result<()> {
        self.state.begin_initialize().map_err(Error::from_reason)
    }
    #[napi]
    pub fn end_initialize(&mut self) {
        self.state.end_initialize();
    }
    #[napi]
    pub fn finish_initialize(&mut self, source: Utf16String) -> Result<NativeJson> {
        self.state
            .finish_initialize(&json_text(Some(source))?.unwrap())
            .map(NativeJson)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn begin_authenticate(&mut self, method: String) -> Result<()> {
        self.state
            .begin_authenticate(&method)
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn end_authenticate(&mut self, success: bool) {
        self.state.end_authenticate(success);
    }
    #[napi]
    pub fn mcp(&self, source: Utf16String) -> Result<()> {
        self.state
            .mcp(&json_text(Some(source))?.unwrap())
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn loading(&self) -> Result<()> {
        self.state.loading().map_err(Error::from_reason)
    }
    #[napi]
    pub fn begin_prompt(&mut self, session: Utf16String, source: Utf16String) -> Result<()> {
        self.state
            .begin_prompt(&session, &json_text(Some(source))?.unwrap())
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn end_prompt(&mut self, session: Utf16String) {
        self.state.end_prompt(&session);
    }
    #[napi]
    pub fn accepts(&self, env: Env, source: Unknown<'_>) -> Result<bool> {
        Ok(self.state.accepts(&notification::read(&env, source)?))
    }
    #[napi]
    pub fn register_handlers(
        &mut self,
        source: Utf16String,
        read: bool,
        write: bool,
        terminal: bool,
    ) -> Result<Vec<String>> {
        Ok(self
            .state
            .register_handlers(&json_text(Some(source))?.unwrap(), read, write, terminal))
    }
    #[napi]
    pub fn track(&mut self, session: Utf16String, terminal: Utf16String) -> Result<()> {
        self.state
            .track(session.to_vec(), terminal.to_vec())
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn known(&self, session: Utf16String, terminal: Utf16String) -> bool {
        self.state.known(&session, &terminal)
    }
    #[napi]
    pub fn untrack(&mut self, session: Utf16String, terminal: Utf16String) {
        self.state.untrack(&session, &terminal);
    }
    #[napi]
    pub fn dispose(&mut self) {
        self.state.dispose();
    }
}
#[napi]
pub fn acp_validate_response(method: String, source: Utf16String) -> Result<()> {
    poe_acp_client_rust::client::response(&method, &json_text(Some(source))?.unwrap())
        .map_err(Error::from_reason)
}
#[napi]
pub fn acp_permission(source: Option<Utf16String>, automatic: bool) -> Result<NativeJson> {
    poe_acp_client_rust::client::permission(&json_text(source)?.unwrap_or(Value::Null), automatic)
        .map(NativeJson)
        .map_err(Error::from_reason)
}
#[napi]
pub fn acp_validate_index(value: Unknown<'_>, one_based: bool, field: String) -> Result<()> {
    let value = match value.get_type()? {
        ValueType::Null | ValueType::Undefined => None,
        ValueType::Number => Some(unsafe { value.cast::<f64>()? }),
        _ => Some(f64::NAN),
    };
    poe_acp_client_rust::client::index(value, one_based, &field).map_err(Error::from_reason)
}
#[napi]
#[derive(Default)]
pub struct NativeAcpQueue {
    state: poe_acp_client_rust::client::Queue,
}
#[napi]
impl NativeAcpQueue {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Default::default(),
        }
    }
    #[napi]
    pub fn push(&mut self, source: Utf16String) -> Result<bool> {
        Ok(self.state.push(json_text(Some(source))?.unwrap()))
    }
    #[napi]
    pub fn complete(&mut self) {
        self.state.complete();
    }
    #[napi]
    pub fn fail(&mut self, message: String) {
        self.state.fail(message);
    }
    #[napi]
    pub fn poll(&mut self) -> NativeJson {
        NativeJson(self.state.poll())
    }
}
#[napi]
#[derive(Default)]
pub struct NativeAcpCollector {
    state: poe_acp_client_rust::stream::Collector,
}
#[napi]
impl NativeAcpCollector {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Default::default(),
        }
    }
    #[napi]
    pub fn push(&mut self, source: Utf16String) -> Result<()> {
        self.state
            .push(json_text(Some(source))?.unwrap())
            .map_err(Error::from_reason)
    }
    #[napi]
    pub fn result(&self, kind: String) -> NativeJson {
        NativeJson(self.state.result(&kind))
    }
    #[napi]
    pub fn session(&self) -> NativeJson {
        NativeJson(self.state.session().cloned().unwrap_or(Value::Null))
    }
    #[napi]
    pub fn report(&self, options: Utf16String) -> Result<NativeJson> {
        poe_acp_client_rust::report::generate(&self.state, &json_text(Some(options))?.unwrap())
            .map(NativeJson)
            .map_err(Error::from_reason)
    }
}
#[napi]
pub fn acp_legacy(source: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(poe_acp_client_rust::stream::legacy(
        &json_text(Some(source))?.unwrap(),
    )))
}
#[napi]
pub fn acp_redact_report(source: Utf16String) -> Result<NativeJson> {
    Ok(NativeJson(poe_acp_client_rust::report::redact(
        &json_text(Some(source))?.unwrap(),
    )))
}
#[napi]
pub fn acp_report_summary(source: Utf16String, duration: String) -> Result<String> {
    Ok(poe_acp_client_rust::report::summary(
        &json_text(Some(source))?.unwrap(),
        &duration,
    ))
}
#[napi]
pub fn acp_safe_segment(value: String) -> String {
    poe_acp_client_rust::report::safe_segment(&value)
}
#[napi]
pub fn acp_validate_usage(
    used: Unknown<'_>,
    size: Unknown<'_>,
    cost: bool,
    amount: Unknown<'_>,
) -> Result<()> {
    for (value, field, integer) in [
        (used, "usage.used", true),
        (size, "usage.size", true),
        (amount, "usage.cost.amount", false),
    ] {
        if !integer && !cost {
            continue;
        }
        let number = if value.get_type()? == ValueType::Number {
            unsafe { value.cast::<f64>()? }
        } else {
            f64::NAN
        };
        if !number.is_finite() || number < 0.0 || (integer && number.fract() != 0.0) {
            return Err(Error::from_reason(format!(
                "{field} must be {}.",
                if integer {
                    "a non-negative integer"
                } else {
                    "a finite non-negative number"
                }
            )));
        }
    }
    Ok(())
}

#[napi]
pub fn acp_stream_decision(
    direct: Option<String>,
    envelope: bool,
    nested: Option<String>,
) -> NativeJson {
    let (envelope, category) =
        poe_acp_client_rust::stream::classify(direct.as_deref(), envelope, nested.as_deref());
    NativeJson(Value::Object(vec![
        ("envelope".encode_utf16().collect(), Value::Bool(envelope)),
        (
            "category".encode_utf16().collect(),
            Value::String(category.encode_utf16().collect()),
        ),
    ]))
}
