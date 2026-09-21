use crate::{field, o, s};
use mcp_protocol_rust::json::Value;
use std::collections::HashMap;
#[derive(Default)]
pub struct SessionCapture {
    tools: HashMap<Vec<u16>, usize>,
    count: usize,
}
fn nonempty(value: &Value) -> Option<Value> {
    match value {
        Value::String(value) if !value.is_empty() => Some(Value::String(value.clone())),
        _ => None,
    }
}
impl SessionCapture {
    /// Select metadata and stable tool slots without retaining opaque host inputs.
    pub fn observe(&mut self, event: &Value, retain: bool) -> Value {
        let kind = field(event, "event");
        if kind == &s("session_start") {
            return nonempty(field(event, "threadId")).map_or(Value::Null, |thread| {
                o(vec![("type", s("thread")), ("threadId", thread)])
            });
        }
        if !retain {
            return Value::Null;
        }
        if kind == &s("agent_message") {
            return if message(retain, field(event, "hasText") == &Value::Bool(true)) {
                o(vec![("type", s("message"))])
            } else {
                Value::Null
            };
        }
        if kind != &s("tool_start") && kind != &s("tool_complete") {
            return Value::Null;
        }
        let id = nonempty(field(event, "id"));
        let index = id
            .as_ref()
            .and_then(|id| match id {
                Value::String(id) => self.tools.get(id).copied(),
                _ => None,
            })
            .unwrap_or_else(|| {
                let index = self.count;
                self.count += 1;
                if let Some(Value::String(id)) = &id {
                    self.tools.insert(id.clone(), index);
                }
                index
            });
        let mut action = vec![("type", s("tool")), ("index", Value::Number(index as f64))];
        let mut fields = vec![];
        if let Some(id) = id {
            fields.push(("id", id));
        }
        for name in if kind == &s("tool_start") {
            &["kind", "title"][..]
        } else {
            &["kind", "path"][..]
        } {
            if let Some(value) = nonempty(field(event, name)) {
                fields.push((*name, value));
            }
        }
        if kind == &s("tool_complete")
            && [s("completed"), s("failed"), s("cancelled")].contains(field(event, "status"))
        {
            fields.push(("status", field(event, "status").clone()));
        }
        action.push(("fields", o(fields)));
        action.push(("input", Value::Bool(kind == &s("tool_start"))));
        o(action)
    }
}

/// Typed ingress avoids serializing message bodies and metadata descriptors.
pub fn message(retain: bool, has_text: bool) -> bool {
    retain && has_text
}
