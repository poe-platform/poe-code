use crate::{array, field as f, o, s, text, truthy, units};
use mcp_protocol_rust::json::Value;
pub struct Facts {
    pub started: bool,
    pub prior_kind: Option<Vec<u16>>,
    pub prior_title: Option<Vec<u16>>,
    pub numbers: Vec<Option<f64>>,
}
pub fn render_kind(kind: Option<&[u16]>) -> Vec<u16> {
    match kind.map(String::from_utf16_lossy).as_deref() {
        Some("execute") => "exec".encode_utf16().collect(),
        Some("write" | "edit") => "edit".encode_utf16().collect(),
        None => "other".encode_utf16().collect(),
        _ => kind.unwrap().to_vec(),
    }
}
fn title(input: &Value, fallback: Value) -> Value {
    let path = f(input, "location");
    if truthy(path) { path.clone() } else { fallback }
}
pub fn output(input: &Value) -> Value {
    if truthy(f(input, "outputText")) {
        return f(input, "outputText").clone();
    }
    let mut result = vec![];
    for item in array(f(input, "content")) {
        if f(item, "type") == &s("text") && truthy(f(item, "text")) {
            result.extend(units(f(item, "text")));
        }
    }
    Value::String(result)
}
pub fn convert(input: &Value, facts: Facts) -> Value {
    let mut events = vec![];
    let mut track = false;
    let mut start = false;
    let mut render = Value::Null;
    let mut tool_title = Value::Null;
    let kind = text(f(input, "sessionUpdate"));
    let event = |kind: &str, mut fields: Vec<(&str, Value)>| {
        fields.insert(0, ("event", s(kind)));
        o(fields)
    };
    match kind.as_str() {
        "agent_message_chunk" | "agent_thought_chunk"
            if f(f(input, "content"), "type") == &s("text") =>
        {
            events.push(event(
                if kind == "agent_message_chunk" {
                    "agent_message"
                } else {
                    "reasoning"
                },
                vec![("text", f(f(input, "content"), "text").clone())],
            ))
        }
        "plan" => events.push(event("plan", vec![("entries", Value::Null)])),
        "usage_update" => {
            let number = |index: usize| facts.numbers.get(index).copied().flatten();
            let used = number(0).unwrap_or(0.0);
            let size = number(1).unwrap_or(0.0);
            let input_tokens = number(2).unwrap_or(used);
            let output = number(3).unwrap_or(0.0);
            let cached = number(4).unwrap_or_else(|| {
                let delta = size - used;
                if delta.is_nan() {
                    delta
                } else {
                    delta.max(0.0)
                }
            });
            let mut fields = vec![
                ("inputTokens", Value::Number(input_tokens)),
                ("outputTokens", Value::Number(output)),
            ];
            if cached > 0.0 {
                fields.push(("cachedTokens", Value::Number(cached)));
            }
            if f(input, "usd") == &Value::Bool(true) {
                fields.push(("costUsd", number(5).map_or(Value::Null, Value::Number)));
                fields.push(("costSource", s("reported")));
            }
            events.push(event("usage", fields));
        }
        "tool_call" | "tool_call_update" => {
            track = true;
            let id = f(input, "toolCallId").clone();
            let prior_kind = facts.prior_kind.map(Value::String);
            let prior_title = facts.prior_title.map(Value::String);
            if kind == "tool_call" {
                render = Value::String(render_kind(
                    input.get("kind").filter(|v| **v != Value::Null).map(units),
                ));
                tool_title = title(input, f(input, "title").clone());
            } else {
                let selected = input
                    .get("kind")
                    .filter(|v| **v != Value::Null)
                    .map(|v| Value::String(render_kind(Some(units(v)))))
                    .filter(truthy);
                render = selected
                    .or_else(|| prior_kind.filter(truthy))
                    .unwrap_or(s("other"));
                tool_title = title(input, prior_title.unwrap_or(id.clone()));
            }
            let status = text(f(input, "status"));
            let terminal = ["completed", "failed", "cancelled"].contains(&status.as_str());
            start = !facts.started
                && (kind == "tool_call"
                    || ["pending", "in_progress"].contains(&status.as_str())
                    || terminal);
            if start {
                let mut fields = vec![
                    ("kind", render.clone()),
                    ("title", tool_title.clone()),
                    ("id", id.clone()),
                ];
                if f(input, "hasInput") == &Value::Bool(true) {
                    fields.push(("input", Value::Null));
                }
                events.push(event("tool_start", fields));
            }
            if terminal {
                events.push(event(
                    "tool_complete",
                    vec![
                        ("kind", render.clone()),
                        ("path", output(input)),
                        ("id", id),
                        ("status", f(input, "status").clone()),
                    ],
                ));
            }
        }
        _ => {}
    }
    o(vec![
        ("events", Value::Array(events)),
        ("track", Value::Bool(track)),
        ("start", Value::Bool(start)),
        ("kind", render),
        ("title", tool_title),
    ])
}
