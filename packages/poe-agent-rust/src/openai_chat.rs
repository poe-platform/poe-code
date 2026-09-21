//! Ordered streaming tool assembly and usage/stop mapping for Chat Completions.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
use std::collections::HashMap;

fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
fn string(value: Option<&Value>) -> Option<&[u16]> {
    match value {
        Some(Value::String(value)) => Some(value),
        _ => None,
    }
}
fn integer(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(value)) if value.is_finite() && *value >= 0.0 => Some(value.floor()),
        _ => None,
    }
}
#[derive(Default)]
struct Tool {
    id: Vec<u16>,
    name: Option<Vec<u16>>,
    arguments: Vec<u16>,
}
#[derive(Default)]
pub struct ChatStream {
    calls: Vec<Tool>,
    indices: HashMap<u64, usize>,
    ids: HashMap<Vec<u16>, usize>,
    usage: Option<Value>,
    stop: Option<Value>,
    retained_units: usize,
}
impl ChatStream {
    pub fn push(&mut self, chunk: &Value) -> Result<Value, String> {
        if let Some(usage) = chunk.get("usage") {
            let input = integer(usage.get("prompt_tokens")).unwrap_or(0.0);
            let output = integer(usage.get("completion_tokens")).unwrap_or(0.0);
            let cached = integer(
                usage
                    .get("prompt_tokens_details")
                    .and_then(|value| value.get("cached_tokens")),
            )
            .or_else(|| integer(usage.get("cache_read_input_tokens")))
            .unwrap_or(0.0);
            let creation = integer(usage.get("cache_creation_input_tokens")).unwrap_or(0.0);
            if [input, output, cached, creation]
                .iter()
                .any(|value| *value != 0.0)
            {
                self.usage = Some(object(vec![
                    ("type", text("usage")),
                    ("inputTokens", Value::Number(input)),
                    ("outputTokens", Value::Number(output)),
                    ("cachedTokens", Value::Number(cached)),
                    ("cacheCreationTokens", Value::Number(creation)),
                ]));
            }
        }
        let mut events = vec![];
        let choice = match chunk.get("choices") {
            Some(Value::Array(choices)) => choices.first(),
            _ => None,
        };
        let Some(choice) = choice else {
            return Ok(Value::Array(events));
        };
        if let Some(delta) = choice.get("delta") {
            if let Some(content) = string(delta.get("content")).filter(|value| !value.is_empty()) {
                events.push(object(vec![
                    ("type", text("text")),
                    ("text", Value::String(content.to_vec())),
                ]));
            }
            if let Some(Value::Array(calls)) = delta.get("tool_calls") {
                for call in calls {
                    let key = match call.get("index") {
                        Some(Value::Number(value)) => {
                            if *value == 0.0 {
                                0
                            } else {
                                value.to_bits()
                            }
                        }
                        _ => u64::MAX,
                    };
                    let id = string(call.get("id"))
                        .map(trim_ecmascript)
                        .filter(|value| !value.is_empty());
                    let index = if let Some(id) = id {
                        let index = if let Some(index) = self.ids.get(id) {
                            *index
                        } else {
                            if self.calls.len() >= 4096 {
                                return Err("Chat stream tool-call limit exceeded (4096)".into());
                            }
                            self.retain(id.len().saturating_mul(2))?;
                            let index = self.calls.len();
                            self.calls.push(Tool {
                                id: id.to_vec(),
                                ..Tool::default()
                            });
                            self.ids.insert(id.to_vec(), index);
                            index
                        };
                        if !self.indices.contains_key(&key) && self.indices.len() >= 4096 {
                            return Err("Chat stream tool-index limit exceeded (4096)".into());
                        }
                        self.indices.insert(key, index);
                        index
                    } else if let Some(index) = self.indices.get(&key) {
                        *index
                    } else {
                        continue;
                    };
                    let function = call.get("function");
                    let name = function
                        .and_then(|value| string(value.get("name")))
                        .filter(|value| !value.is_empty());
                    if self.calls[index].name.is_none()
                        && let Some(name) = name
                    {
                        self.retain(name.len())?;
                        self.calls[index].name = Some(name.to_vec());
                    }
                    if let Some(delta) = function
                        .and_then(|value| string(value.get("arguments")))
                        .filter(|value| !value.is_empty())
                    {
                        self.retain(delta.len())?;
                        let call = &mut self.calls[index];
                        call.arguments.extend_from_slice(delta);
                        let mut fields = vec![
                            ("type", text("tool_use_delta")),
                            ("id", Value::String(call.id.clone())),
                        ];
                        if let Some(name) = name {
                            fields.push(("name", Value::String(name.to_vec())));
                        }
                        fields.push(("argsDelta", Value::String(delta.to_vec())));
                        events.push(object(fields));
                    }
                }
            }
        }
        if let Some(reason) = choice
            .get("finish_reason")
            .filter(|value| !matches!(value, Value::Null))
        {
            let reason = string(Some(reason)).unwrap_or(&[]);
            let reason = if reason.iter().copied().eq("stop".encode_utf16()) {
                "end_turn"
            } else if reason.iter().copied().eq("tool_calls".encode_utf16())
                || reason.iter().copied().eq("function_call".encode_utf16())
            {
                "tool_use"
            } else if reason.iter().copied().eq("length".encode_utf16()) {
                "max_tokens"
            } else {
                "error"
            };
            self.stop = Some(text(reason));
        }
        Ok(Value::Array(events))
    }
    fn retain(&mut self, additional: usize) -> Result<(), String> {
        if additional > 8_388_608usize.saturating_sub(self.retained_units) {
            return Err("Chat stream retained UTF16 limit exceeded (8388608 units)".into());
        }
        self.retained_units += additional;
        Ok(())
    }
    pub fn finish(&mut self) -> Value {
        let mut events = std::mem::take(&mut self.calls)
            .into_iter()
            .map(|call| {
                let mut fields = vec![
                    ("type", text("pending_tool")),
                    ("id", Value::String(call.id)),
                ];
                if let Some(name) = call.name {
                    fields.push(("name", Value::String(name)));
                }
                fields.push(("raw", Value::String(call.arguments)));
                object(fields)
            })
            .collect::<Vec<_>>();
        if let Some(usage) = self.usage.take() {
            events.push(usage);
        }
        events.push(object(vec![
            ("type", text("stop")),
            (
                "reason",
                self.stop.take().unwrap_or_else(|| text("end_turn")),
            ),
        ]));
        self.indices.clear();
        self.ids.clear();
        self.retained_units = 0;
        Value::Array(events)
    }
}
