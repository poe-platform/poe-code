use crate::{o, s, text};
use mcp_protocol_rust::json::Value;
use std::collections::{HashMap, HashSet};
pub fn update(entry: &Value) -> &Value {
    if matches!(entry.get("sessionUpdate"), Some(Value::String(_))) {
        return entry;
    }
    if matches!(entry.get("jsonrpc"), Some(Value::String(_)))
        && entry.get("method") == Some(&s("session/update"))
        && let Some(update) = entry.get("params").and_then(|v| v.get("update"))
        && matches!(update.get("sessionUpdate"), Some(Value::String(_)))
    {
        return update;
    }
    entry
}
#[derive(Default)]
pub struct Collector {
    tools: Vec<Value>,
    indexes: HashMap<Vec<u16>, usize>,
    started: HashSet<Vec<u16>>,
    messages: Vec<Value>,
    usage: Vec<Value>,
    session: Option<Value>,
}
fn set(value: &mut Value, key: &str, replacement: Value) {
    if let Value::Object(fields) = value {
        let key = key.encode_utf16().collect::<Vec<_>>();
        if let Some((_, v)) = fields.iter_mut().find(|(k, _)| *k == key) {
            *v = replacement;
        } else {
            fields.push((key, replacement));
        }
    }
}
pub fn nonblank(value: Option<&Value>) -> Option<Value> {
    value
        .filter(|v| matches!(v,Value::String(s) if !String::from_utf16_lossy(s).trim().is_empty()))
        .cloned()
}
impl Collector {
    pub fn push(&mut self, entry: Value) -> Result<(), String> {
        if self.session.is_none()
            && matches!(entry.get("jsonrpc"), Some(Value::String(_)))
            && entry.get("method") == Some(&s("session/update"))
        {
            self.session = nonblank(entry.get("params").and_then(|v| v.get("sessionId")));
        }
        let update = update(&entry);
        let kind = update.get("sessionUpdate").map(text).unwrap_or_default();
        match kind.as_str() {
            "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk" => {
                self.messages.push(update.clone())
            }
            "usage_update" => self.usage.push(update.clone()),
            "tool_call" | "tool_call_update" => {
                let id = match update.get("toolCallId") {
                    Some(Value::String(id)) => id.clone(),
                    _ => return Ok(()),
                };
                let start = kind == "tool_call";
                if start && !self.started.insert(id.clone()) {
                    return Err(format!(
                        "Duplicate tool call identifier \"{}\".",
                        String::from_utf16_lossy(&id)
                    ));
                }
                let index = if let Some(index) = self.indexes.get(&id) {
                    *index
                } else {
                    let index = self.tools.len();
                    self.indexes.insert(id.clone(), index);
                    self.tools.push(o(vec![]));
                    index
                };
                let tool = &mut self.tools[index];
                if start {
                    *tool = o(vec![
                        ("toolCallId", Value::String(id.clone())),
                        ("title", update.get("title").cloned().unwrap_or(Value::Null)),
                    ]);
                } else if tool.get("toolCallId").is_none() {
                    *tool = o(vec![
                        ("toolCallId", Value::String(id.clone())),
                        (
                            "title",
                            nonblank(update.get("title")).unwrap_or(Value::String(id)),
                        ),
                    ]);
                }
                for field in ["title", "kind", "status", "rawInput", "rawOutput"] {
                    if let Some(value) = update.get(field) {
                        if field == "title"
                            && (!matches!(value,Value::String(s) if !s.is_empty()) || start)
                        {
                            continue;
                        }
                        if !start && ["kind", "status"].contains(&field) && value == &Value::Null {
                            continue;
                        }
                        set(tool, field, value.clone());
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
    pub fn tools(&self) -> Value {
        Value::Array(self.tools.clone())
    }
    pub fn messages(&self) -> &[Value] {
        &self.messages
    }
    pub fn usage(&self) -> &[Value] {
        &self.usage
    }
    pub fn session(&self) -> Option<&Value> {
        self.session.as_ref()
    }
    pub fn result(&self, kind: &str) -> Value {
        match kind {
            "tools" => self.tools(),
            "messages" => Value::Array(self.messages.clone()),
            "usage" => Value::Array(self.usage.clone()),
            _ => Value::Null,
        }
    }
}
fn read(value: Option<&Value>) -> Option<Value> {
    value
        .filter(|v| matches!(v,Value::String(s) if !s.is_empty()))
        .cloned()
}
fn tool_kind(value: Option<&Value>) -> Option<Value> {
    Some(s(match value.map(text).unwrap_or_default().as_str() {
        "exec" | "execute" => "execute",
        "read" => "read",
        "write" | "edit" | "delete" | "move" => "write",
        "other" | "search" | "think" | "fetch" | "switch_mode" => "other",
        _ => return None,
    }))
}
fn status(value: Option<&Value>) -> Option<Value> {
    value
        .filter(|v| {
            ["pending", "in_progress", "completed", "failed", "cancelled"]
                .iter()
                .any(|s1| *v == &s(s1))
        })
        .cloned()
}
fn number(value: Option<&Value>, integer: bool) -> Option<f64> {
    match value {
        Some(Value::Number(n))
            if n.is_finite() && (!integer || (n.fract() == 0.0 && *n >= 0.0)) =>
        {
            Some(*n)
        }
        _ => None,
    }
}
pub fn legacy(event: &Value) -> Value {
    let empty = || Value::Array(vec![]);
    match event.get("event").map(text).unwrap_or_default().as_str() {
        "session_start" => read(event.get("threadId")).map_or_else(empty, |id| {
            Value::Array(vec![o(vec![
                ("sessionUpdate", s("session_info_update")),
                ("_meta", o(vec![("threadId", id)])),
            ])])
        }),
        "agent_message" | "reasoning" => read(event.get("text")).map_or_else(empty, |text1| {
            Value::Array(vec![o(vec![
                (
                    "sessionUpdate",
                    s(if event.get("event") == Some(&s("reasoning")) {
                        "agent_thought_chunk"
                    } else {
                        "agent_message_chunk"
                    }),
                ),
                ("content", o(vec![("type", s("text")), ("text", text1)])),
            ])])
        }),
        "plan" => {
            let value = o(vec![
                ("sessionUpdate", s("plan")),
                (
                    "entries",
                    event.get("entries").cloned().unwrap_or(Value::Null),
                ),
            ]);
            if crate::updates::plan(&value) {
                Value::Array(vec![value])
            } else {
                empty()
            }
        }
        "tool_start" | "tool_complete" => {
            let Some(id) = read(event.get("id")).or_else(|| read(event.get("toolCallId"))) else {
                return empty();
            };
            let start = event.get("event") == Some(&s("tool_start"));
            let status = status(event.get("status"));
            if !start && event.get("status").is_some() && status.is_none() {
                return empty();
            }
            let mut tool = o(vec![
                (
                    "sessionUpdate",
                    s(if start {
                        "tool_call"
                    } else {
                        "tool_call_update"
                    }),
                ),
                ("toolCallId", id.clone()),
                (
                    "status",
                    if start {
                        s("pending")
                    } else {
                        status.unwrap_or(s("completed"))
                    },
                ),
            ]);
            if start {
                set(
                    &mut tool,
                    "title",
                    read(event.get("title")).unwrap_or(id.clone()),
                );
            }
            let kind = tool_kind(event.get("kind"));
            if let Some(kind) = &kind {
                set(&mut tool, "kind", kind.clone());
            }
            let fields = if start {
                &["input", "rawInput"][..]
            } else {
                &["output", "path", "rawOutput"][..]
            };
            if let Some(raw) = fields.iter().find_map(|key| event.get(key)) {
                set(
                    &mut tool,
                    if start { "rawInput" } else { "rawOutput" },
                    raw.clone(),
                );
            }
            let mut tools = vec![tool];
            if start {
                let mut next = o(vec![
                    ("sessionUpdate", s("tool_call_update")),
                    ("toolCallId", id),
                    ("status", s("in_progress")),
                ]);
                if let Some(kind) = kind {
                    set(&mut next, "kind", kind);
                }
                tools.push(next);
            }
            Value::Array(tools)
        }
        "usage" => {
            let fields = ["inputTokens", "outputTokens", "cachedTokens", "costUsd"];
            let values = fields
                .iter()
                .enumerate()
                .map(|(i, key)| number(event.get(key), i < 3))
                .collect::<Vec<_>>();
            if fields
                .iter()
                .enumerate()
                .any(|(i, key)| event.get(key).is_some() && values[i].is_none())
            {
                return empty();
            }
            let used = values[0].unwrap_or(0.0) + values[1].unwrap_or(0.0);
            let mut usage = o(vec![
                ("sessionUpdate", s("usage_update")),
                ("used", Value::Number(used)),
                ("size", Value::Number(used + values[2].unwrap_or(0.0))),
            ]);
            if let Some(cost) = values[3] {
                set(
                    &mut usage,
                    "cost",
                    o(vec![
                        ("amount", Value::Number(cost)),
                        ("currency", s("USD")),
                    ]),
                );
            }
            Value::Array(vec![usage])
        }
        _ => empty(),
    }
}

pub fn classify(
    direct: Option<&str>,
    envelope: bool,
    nested: Option<&str>,
) -> (bool, &'static str) {
    let use_envelope = direct.is_none() && envelope && nested.is_some();
    let kind = direct.or(if use_envelope { nested } else { None });
    (
        use_envelope,
        match kind {
            Some("user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk") => {
                "messages"
            }
            Some("usage_update") => "usage",
            Some("tool_call" | "tool_call_update") => "tools",
            _ => "other",
        },
    )
}
