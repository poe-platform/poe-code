use super::openai_binding::{fields, optional_property, property, scalar};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::openai_responses::ResponsesStream;
fn is(value: &Value, expected: &str) -> bool {
    matches!(value, Value::String(value) if value.iter().copied().eq(expected.encode_utf16()))
}
#[napi]
pub fn agent_responses_supports(model: Utf16String) -> bool {
    poe_agent_rust::openai_responses::supports(&model)
}
#[napi]
#[derive(Default)]
pub struct NativeAgentResponsesStream {
    state: ResponsesStream,
}
#[napi]
impl NativeAgentResponsesStream {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn record_tool_success(&mut self) {
        self.state.record_tool_success();
    }
    #[napi]
    pub fn resolve_stop(&self, reason: Utf16String) -> Utf16String {
        self.state.resolve_stop(&reason).into()
    }
    #[napi]
    pub fn push_batch(&mut self, chunks: Object<'_>) -> Result<NativeJson> {
        let length: u32 = chunks.get_named_property("length")?;
        let mut events = vec![];
        for index in 0..length {
            if self.state.terminated() {
                break;
            }
            let event = read_event(chunks.get_element(index)?)?;
            let Value::Array(mut next) =
                self.state.push(&event).map_err(napi::Error::from_reason)?
            else {
                unreachable!()
            };
            for event in &mut next {
                if let Value::Object(properties) = event
                    && ["reasoning_details", "pending_error"].iter().any(|kind| {
                        is(
                            properties
                                .iter()
                                .find(|(key, _)| key.iter().copied().eq("type".encode_utf16()))
                                .map(|(_, value)| value)
                                .unwrap_or(&Value::Null),
                            kind,
                        )
                    })
                {
                    properties.push((
                        "sourceIndex".encode_utf16().collect(),
                        Value::Number(index as f64),
                    ));
                }
            }
            events.append(&mut next);
        }
        Ok(NativeJson(Value::Array(events)))
    }
    #[napi]
    pub fn finish(&mut self) -> NativeJson {
        NativeJson(self.state.finish())
    }
}
fn read_event(event: Unknown<'_>) -> Result<Value> {
    let kind = scalar(property(event, "type")?)?;
    let mut values = vec![];
    if is(&kind, "response.output_text.delta")
        || is(&kind, "response.reasoning_summary_text.delta")
        || is(&kind, "response.function_call_arguments.delta")
    {
        if is(&kind, "response.function_call_arguments.delta") {
            values.push(("item_id", scalar(property(event, "item_id")?)?));
        }
        values.push(("delta", scalar(property(event, "delta")?)?));
    } else if is(&kind, "response.output_item.added") || is(&kind, "response.output_item.done") {
        let item = property(event, "item")?;
        if item.get_type()? == napi::ValueType::Object {
            let item_kind = scalar(property(item, "type")?)?;
            let mut item_fields = vec![];
            if is(&item_kind, "function_call") {
                for key in ["call_id", "id", "name", "arguments"] {
                    item_fields.push((key, scalar(property(item, key)?)?));
                }
            }
            item_fields.push(("type", item_kind));
            values.push(("item", fields(item_fields)));
        }
    } else if is(&kind, "response.completed")
        || is(&kind, "response.incomplete")
        || is(&kind, "response.failed")
    {
        let response = property(event, "response")?;
        let usage = optional_property(response, "usage")?;
        let details = optional_property(usage, "input_tokens_details")?;
        let usage = fields(vec![
            (
                "input_tokens",
                scalar(optional_property(usage, "input_tokens")?)?,
            ),
            (
                "output_tokens",
                scalar(optional_property(usage, "output_tokens")?)?,
            ),
            (
                "input_tokens_details",
                fields(vec![(
                    "cached_tokens",
                    scalar(optional_property(details, "cached_tokens")?)?,
                )]),
            ),
        ]);
        let status = scalar(optional_property(response, "status")?)?;
        let error = optional_property(response, "error")?;
        let error = if matches!(
            error.get_type()?,
            napi::ValueType::Undefined | napi::ValueType::Null
        ) {
            Value::Null
        } else {
            Value::Bool(true)
        };
        let incomplete = optional_property(response, "incomplete_details")?;
        let incomplete = fields(vec![(
            "reason",
            scalar(optional_property(incomplete, "reason")?)?,
        )]);
        let output = optional_property(response, "output")?;
        let mut items = vec![];
        if !matches!(
            output.get_type()?,
            napi::ValueType::Null | napi::ValueType::Undefined
        ) {
            let output = output.coerce_to_object()?;
            let length: u32 = output.get_named_property("length")?;
            if length > 4096 {
                return Err(napi::Error::from_reason(
                    "Responses output-item limit exceeded (4096)",
                ));
            }
            for index in 0..length {
                let item: Unknown<'_> = output.get_element(index)?;
                let item_kind = scalar(property(item, "type")?)?;
                let function = is(&item_kind, "function_call");
                items.push(fields(vec![("type", item_kind)]));
                if function {
                    break;
                }
            }
        }
        values.push((
            "response",
            fields(vec![
                ("usage", usage),
                ("status", status),
                ("error", error),
                ("incomplete_details", incomplete),
                ("output", Value::Array(items)),
            ]),
        ));
    }
    values.push(("type", kind));
    Ok(fields(values))
}
