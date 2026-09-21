//! Responses event policy. Reasoning objects and argument parsing stay in the host.
use crate::openai_chat::{integer, object, string, text};
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
use std::collections::HashMap;
fn is(value: Option<&Value>, expected: &str) -> bool {
    string(value).is_some_and(|value| value.iter().copied().eq(expected.encode_utf16()))
}
fn normalized(value: Option<&Value>) -> Option<Vec<u16>> {
    string(value)
        .map(trim_ecmascript)
        .filter(|value| !value.is_empty())
        .map(Vec::from)
}
pub fn supports(model: &[u16]) -> bool {
    model.starts_with(&"gpt-".encode_utf16().collect::<Vec<_>>())
        || model.first() == Some(&111)
            && model.get(1).is_some_and(|value| (48..=57).contains(value))
}
#[derive(Default)]
struct Tool {
    item: Option<Vec<u16>>,
    name: Option<Vec<u16>>,
    arguments: Vec<u16>,
}
impl Tool {
    fn units(&self) -> usize {
        self.item.as_ref().map_or(0, Vec::len)
            + self.name.as_ref().map_or(0, Vec::len)
            + self.arguments.len()
    }
}
#[derive(Default)]
pub struct ResponsesStream {
    calls: HashMap<Vec<u16>, Tool>,
    aliases: HashMap<Vec<u16>, Vec<u16>>,
    saw_tool: bool,
    terminated: bool,
    retained: usize,
}
impl ResponsesStream {
    pub fn terminated(&self) -> bool {
        self.terminated
    }
    pub fn record_tool_success(&mut self) {
        self.saw_tool = true;
    }
    pub fn resolve_stop(&self, reason: &[u16]) -> Vec<u16> {
        if self.saw_tool && reason.iter().copied().eq("end_turn".encode_utf16()) {
            "tool_use".encode_utf16().collect()
        } else {
            reason.to_vec()
        }
    }
    fn retain(&mut self, units: usize) -> Result<(), String> {
        if units > 8_388_608usize.saturating_sub(self.retained) {
            return Err("Responses retained UTF16 limit exceeded (8388608 units)".into());
        }
        self.retained += units;
        Ok(())
    }
    fn take_tool(&mut self, id: &[u16]) -> Tool {
        if let Some(tool) = self.calls.remove(id) {
            self.retained -= id.len() + tool.units();
            tool
        } else {
            Tool::default()
        }
    }
    fn store(&mut self, id: Vec<u16>, tool: Tool) -> Result<(), String> {
        if self.calls.len() >= 4096 {
            return Err("Responses tool-call limit exceeded (4096)".into());
        }
        self.retain(id.len() + tool.units())?;
        self.calls.insert(id, tool);
        Ok(())
    }
    fn alias(&mut self, item: &[u16], id: &[u16]) -> Result<(), String> {
        if self.aliases.get(item).is_some_and(|old| old == id) {
            return Ok(());
        }
        if let Some(old) = self.aliases.remove(item) {
            self.retained -= item.len() + old.len();
        }
        if self.aliases.len() >= 4096 {
            return Err("Responses item-alias limit exceeded (4096)".into());
        }
        self.retain(item.len() + id.len())?;
        self.aliases.insert(item.to_vec(), id.to_vec());
        Ok(())
    }
    pub fn push(&mut self, event: &Value) -> Result<Value, String> {
        let mut events = vec![];
        if self.terminated {
            return Ok(Value::Array(events));
        }
        let kind = event.get("type");
        if is(kind, "response.output_text.delta")
            || is(kind, "response.reasoning_summary_text.delta")
        {
            if let Some(delta) = string(event.get("delta")).filter(|value| !value.is_empty()) {
                events.push(object(vec![
                    (
                        "type",
                        text(if is(kind, "response.output_text.delta") {
                            "text"
                        } else {
                            "thinking"
                        }),
                    ),
                    ("text", Value::String(delta.to_vec())),
                ]));
            }
        } else if is(kind, "response.output_item.added") || is(kind, "response.output_item.done") {
            let item = event.get("item");
            let done = is(kind, "response.output_item.done");
            if done && is(item.and_then(|item| item.get("type")), "reasoning") {
                events.push(object(vec![("type", text("reasoning_details"))]));
                return Ok(Value::Array(events));
            }
            if !is(item.and_then(|item| item.get("type")), "function_call") {
                return Ok(Value::Array(events));
            }
            let Some(item) = item else {
                return Ok(Value::Array(events));
            };
            let Some(id) = normalized(item.get("call_id")).or_else(|| normalized(item.get("id")))
            else {
                return Ok(Value::Array(events));
            };
            let mut tool = self.take_tool(&id);
            tool.name = normalized(item.get("name")).or(tool.name);
            tool.item = normalized(item.get("id")).or(tool.item);
            if let Some(item) = &tool.item {
                self.alias(item, &id)?;
            }
            let mut fields = vec![
                (
                    "type",
                    text(if done {
                        "pending_tool"
                    } else {
                        "tool_use_delta"
                    }),
                ),
                ("id", Value::String(id.clone())),
            ];
            if let Some(name) = &tool.name {
                fields.push(("name", Value::String(name.clone())));
            }
            if done {
                let arguments = if tool.arguments.is_empty() {
                    string(item.get("arguments")).unwrap_or(&[]).to_vec()
                } else {
                    tool.arguments
                };
                if arguments.len() > 8_388_608 {
                    return Err("Responses retained UTF16 limit exceeded (8388608 units)".into());
                }
                fields.push(("raw", Value::String(arguments)));
            } else {
                self.saw_tool = true;
                self.store(id, tool)?;
            }
            events.push(object(fields));
        } else if is(kind, "response.function_call_arguments.delta") {
            let Some(item) = normalized(event.get("item_id")) else {
                return Ok(Value::Array(events));
            };
            let Some(delta) = string(event.get("delta")).filter(|value| !value.is_empty()) else {
                return Ok(Value::Array(events));
            };
            let id = self.aliases.get(&item).cloned().unwrap_or(item);
            let mut tool = self.take_tool(&id);
            if delta.len() > 8_388_608usize.saturating_sub(tool.arguments.len()) {
                return Err("Responses retained UTF16 limit exceeded (8388608 units)".into());
            }
            tool.arguments.extend_from_slice(delta);
            self.saw_tool = true;
            events.push(object(vec![
                ("type", text("tool_use_delta")),
                ("id", Value::String(id.clone())),
                ("argsDelta", Value::String(delta.to_vec())),
            ]));
            self.store(id, tool)?;
        } else if is(kind, "response.completed")
            || is(kind, "response.incomplete")
            || is(kind, "response.failed")
        {
            let response = event.get("response");
            if let Some(usage) = response.and_then(|response| response.get("usage")) {
                let input = integer(usage.get("input_tokens")).unwrap_or(0.0);
                let output = integer(usage.get("output_tokens")).unwrap_or(0.0);
                let cached = integer(
                    usage
                        .get("input_tokens_details")
                        .and_then(|value| value.get("cached_tokens")),
                )
                .unwrap_or(0.0);
                if [input, output, cached].iter().any(|value| *value != 0.0) {
                    events.push(object(vec![
                        ("type", text("usage")),
                        ("inputTokens", Value::Number(input)),
                        ("outputTokens", Value::Number(output)),
                        ("cachedTokens", Value::Number(cached)),
                        ("cacheCreationTokens", Value::Number(0.0)),
                    ]));
                }
            }
            let incomplete = response
                .and_then(|response| response.get("incomplete_details"))
                .and_then(|value| value.get("reason"));
            let failed = is(kind, "response.failed")
                || is(
                    response.and_then(|response| response.get("status")),
                    "failed",
                )
                || response
                    .and_then(|response| response.get("error"))
                    .is_some_and(|error| !matches!(error, Value::Null));
            let output_tool = matches!(response.and_then(|response| response.get("output")), Some(Value::Array(items)) if items.iter().any(|item| is(item.get("type"), "function_call")));
            let reason = if failed || is(incomplete, "content_filter") {
                "error"
            } else if is(incomplete, "max_output_tokens") {
                "max_tokens"
            } else if self.saw_tool || output_tool {
                "tool_use"
            } else {
                "end_turn"
            };
            events.push(object(vec![
                ("type", text("pending_stop")),
                ("reason", text(reason)),
            ]));
            self.terminated = true;
        } else if is(kind, "error") {
            events.push(object(vec![("type", text("pending_error"))]));
            self.terminated = true;
        }
        Ok(Value::Array(events))
    }
    pub fn finish(&mut self) -> Value {
        if self.terminated {
            return Value::Array(vec![]);
        }
        self.terminated = true;
        Value::Array(vec![object(vec![
            ("type", text("stop")),
            (
                "reason",
                text(if self.saw_tool {
                    "tool_use"
                } else {
                    "end_turn"
                }),
            ),
        ])])
    }
}
