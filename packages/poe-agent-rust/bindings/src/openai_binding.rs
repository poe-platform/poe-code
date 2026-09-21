use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::openai_policy;

#[napi]
#[derive(Default)]
pub struct NativeAgentChatStream {
    state: poe_agent_rust::openai_chat::ChatStream,
}
#[napi]
impl NativeAgentChatStream {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn push(&mut self, chunk: Unknown<'_>) -> Result<NativeJson> {
        let chunk = read_chat_chunk(chunk)?;
        self.state
            .push(&chunk)
            .map(NativeJson)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn finish(&mut self) -> NativeJson {
        NativeJson(self.state.finish())
    }
    #[napi]
    pub fn push_batch(&mut self, chunks: Object<'_>) -> Result<NativeJson> {
        let length: u32 = chunks.get_named_property("length")?;
        let mut events = vec![];
        for index in 0..length {
            let chunk = read_chat_chunk(chunks.get_element(index)?)?;
            let Value::Array(mut next) =
                self.state.push(&chunk).map_err(napi::Error::from_reason)?
            else {
                unreachable!()
            };
            events.append(&mut next);
        }
        Ok(NativeJson(Value::Array(events)))
    }
}

fn property<'env>(source: Unknown<'env>, name: &str) -> Result<Unknown<'env>> {
    source.coerce_to_object()?.get_named_property(name)
}
fn optional_property<'env>(source: Unknown<'env>, name: &str) -> Result<Unknown<'env>> {
    if matches!(
        source.get_type()?,
        napi::ValueType::Null | napi::ValueType::Undefined
    ) {
        Ok(source)
    } else {
        property(source, name)
    }
}
fn scalar(value: Unknown<'_>) -> Result<Value> {
    Ok(match value.get_type()? {
        napi::ValueType::String => Value::String(unsafe { value.cast::<Utf16String>()? }.to_vec()),
        napi::ValueType::Number => Value::Number(unsafe { value.cast::<f64>()? }),
        napi::ValueType::Boolean => Value::Bool(unsafe { value.cast::<bool>()? }),
        _ => Value::Null,
    })
}
fn fields(values: Vec<(&str, Value)>) -> Value {
    Value::Object(
        values
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
fn read_chat_chunk(chunk: Unknown<'_>) -> Result<Value> {
    let usage = property(chunk, "usage")?;
    let usage = if matches!(
        usage.get_type()?,
        napi::ValueType::Null | napi::ValueType::Undefined
    ) {
        Value::Null
    } else {
        let input = scalar(property(usage, "prompt_tokens")?)?;
        let output = scalar(property(usage, "completion_tokens")?)?;
        let details = property(usage, "prompt_tokens_details")?;
        let cached = scalar(optional_property(details, "cached_tokens")?)?;
        let fallback = if matches!(cached, Value::Number(value) if value.is_finite() && value >= 0.0)
        {
            Value::Null
        } else {
            scalar(property(usage, "cache_read_input_tokens")?)?
        };
        fields(vec![
            ("prompt_tokens", input),
            ("completion_tokens", output),
            (
                "prompt_tokens_details",
                fields(vec![("cached_tokens", cached)]),
            ),
            ("cache_read_input_tokens", fallback),
            (
                "cache_creation_input_tokens",
                scalar(property(usage, "cache_creation_input_tokens")?)?,
            ),
        ])
    };
    let choices = property(chunk, "choices")?;
    let choice = optional_property(choices, "0")?;
    if !choice.coerce_to_bool()? {
        return Ok(fields(vec![("usage", usage)]));
    }
    let delta = property(choice, "delta")?;
    let content = scalar(optional_property(delta, "content")?)?;
    let delta = property(choice, "delta")?;
    let calls = optional_property(delta, "tool_calls")?;
    let mut call_values = vec![];
    if !matches!(
        calls.get_type()?,
        napi::ValueType::Null | napi::ValueType::Undefined
    ) {
        let array = calls.coerce_to_object()?;
        let length: u32 = array.get_named_property("length")?;
        if length > 4096 {
            return Err(napi::Error::from_reason(
                "Chat stream tool-call limit exceeded (4096)",
            ));
        }
        for index in 0..length {
            let call: Unknown<'_> = array.get_element(index)?;
            let id = scalar(property(call, "id")?)?;
            let index = scalar(property(call, "index")?)?;
            let function = property(call, "function")?;
            let name = scalar(optional_property(function, "name")?)?;
            let arguments = scalar(optional_property(function, "arguments")?)?;
            call_values.push(fields(vec![
                ("id", id),
                ("index", index),
                (
                    "function",
                    fields(vec![("name", name), ("arguments", arguments)]),
                ),
            ]));
        }
    }
    Ok(fields(vec![
        ("usage", usage),
        (
            "choices",
            Value::Array(vec![fields(vec![
                (
                    "delta",
                    fields(vec![
                        ("content", content),
                        ("tool_calls", Value::Array(call_values)),
                    ]),
                ),
                ("finish_reason", scalar(property(choice, "finish_reason")?)?),
            ])]),
        ),
    ]))
}

#[napi]
pub fn agent_openai_retryable(status: u32, override_header: Option<String>) -> bool {
    openai_policy::retryable(status, override_header.as_deref())
}

#[napi]
pub fn agent_openai_retry_delay(attempt: u32, random: f64) -> f64 {
    openai_policy::retry_delay(attempt, random)
}
