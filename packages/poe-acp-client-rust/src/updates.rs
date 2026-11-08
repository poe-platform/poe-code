use crate::{array, o, s, text};
use mcp_protocol_rust::json::{self, Value};
fn object(value: &Value) -> bool {
    matches!(value, Value::Object(_))
}
fn string(value: &Value) -> bool {
    matches!(value, Value::String(_))
}
fn number(value: &Value) -> bool {
    matches!(value, Value::Number(_))
}
fn integer(value: &Value) -> bool {
    matches!(value,Value::Number(n) if n.is_finite()&&n.fract()==0.0&&*n>=0.0)
}
fn meta(value: &Value) -> bool {
    optional(value, "_meta", true, object)
}
fn optional(value: &Value, key: &str, nullable: bool, check: impl Fn(&Value) -> bool) -> bool {
    value
        .get(key)
        .is_none_or(|v| (nullable && *v == Value::Null) || check(v))
}
fn required(value: &Value, key: &str, check: impl Fn(&Value) -> bool) -> bool {
    value.get(key).is_some_and(check)
}
fn enumeration(value: &Value, values: &[&str]) -> bool {
    string(value) && values.contains(&text(value).as_str())
}
fn items(value: &Value, check: impl Fn(&Value) -> bool) -> bool {
    matches!(value, Value::Array(_)) && array(value).iter().all(check)
}
fn annotations(value: &Value) -> bool {
    object(value)
        && meta(value)
        && optional(value, "audience", true, |v| {
            items(v, |v| enumeration(v, &["assistant", "user"]))
        })
        && optional(value, "lastModified", true, string)
        && optional(value, "priority", true, number)
}
fn resource(value: &Value) -> bool {
    object(value)
        && meta(value)
        && required(value, "uri", string)
        && optional(value, "mimeType", true, string)
        && (required(value, "text", string) || required(value, "blob", string))
}
fn content(value: &Value, tool: bool) -> bool {
    if !object(value) || !meta(value) || !optional(value, "annotations", true, annotations) {
        return false;
    }
    match text(value.get("type").unwrap_or(&Value::Null)).as_str() {
        "text" => required(value, "text", string),
        "image" => {
            required(value, "data", string)
                && required(value, "mimeType", string)
                && optional(value, "uri", true, string)
        }
        "audio" => !tool && required(value, "data", string) && required(value, "mimeType", string),
        "resource_link" => {
            required(value, "name", string)
                && required(value, "uri", string)
                && optional(value, "description", true, string)
                && optional(value, "mimeType", true, string)
                && optional(value, "size", true, number)
                && optional(value, "title", true, string)
        }
        "resource" => required(value, "resource", resource),
        "diff" => {
            tool && required(value, "path", string)
                && required(value, "newText", string)
                && optional(value, "oldText", true, string)
        }
        "terminal" => tool && required(value, "terminalId", string),
        _ => false,
    }
}
fn kind(value: &Value) -> bool {
    enumeration(value, &["read", "write", "execute", "other"])
}
fn status(value: &Value) -> bool {
    enumeration(
        value,
        &["pending", "in_progress", "completed", "failed", "cancelled"],
    )
}
fn location(value: &Value) -> bool {
    object(value)
        && meta(value)
        && required(value, "path", string)
        && value.get("line").is_none()
        && optional(value, "lineNumber", true, integer)
}
fn entry(value: &Value) -> bool {
    object(value)
        && meta(value)
        && required(value, "content", string)
        && required(value, "priority", |v| {
            enumeration(v, &["high", "medium", "low"])
        })
        && required(value, "status", |v| {
            enumeration(v, &["pending", "in_progress", "completed"])
        })
}
pub fn plan(value: &Value) -> bool {
    object(value)
        && meta(value)
        && value.get("sessionUpdate") == Some(&s("plan"))
        && required(value, "entries", |v| items(v, entry))
}
fn select_option(value: &Value) -> bool {
    object(value)
        && meta(value)
        && required(value, "value", string)
        && required(value, "name", string)
        && optional(value, "description", true, string)
}
fn select_group(value: &Value) -> bool {
    object(value)
        && meta(value)
        && required(value, "group", string)
        && required(value, "name", string)
        && required(value, "options", |v| items(v, select_option))
}
fn config_option(value: &Value) -> bool {
    object(value)
        && meta(value)
        && value.get("type") == Some(&s("select"))
        && required(value, "id", string)
        && required(value, "name", string)
        && required(value, "currentValue", string)
        && required(value, "options", |v| {
            items(v, select_option) || items(v, select_group)
        })
        && optional(value, "description", true, string)
        && optional(value, "category", true, string)
}
pub fn update(value: &Value) -> bool {
    if !object(value) {
        return false;
    }
    match text(value.get("sessionUpdate").unwrap_or(&Value::Null)).as_str() {
        "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk" => {
            meta(value) && required(value, "content", |v| content(v, false))
        }
        "tool_call" | "tool_call_update" => {
            let partial = value.get("sessionUpdate") == Some(&s("tool_call_update"));
            meta(value)
                && required(value, "toolCallId", string)
                && (partial || required(value, "title", string))
                && optional(value, "kind", partial, kind)
                && optional(value, "status", partial, status)
                && optional(value, "content", partial, |v| {
                    items(v, |v| content(v, true))
                })
                && optional(value, "locations", partial, |v| items(v, location))
        }
        "plan" => plan(value),
        "current_mode_update" => meta(value) && required(value, "currentModeId", string),
        "session_info_update" => {
            meta(value)
                && optional(value, "title", true, string)
                && optional(value, "updatedAt", true, string)
        }
        "available_commands_update" => {
            meta(value)
                && required(value, "availableCommands", |v| {
                    items(v, |v| {
                        object(v)
                            && meta(v)
                            && required(v, "name", string)
                            && required(v, "description", string)
                            && optional(v, "input", true, |v| {
                                object(v) && meta(v) && required(v, "hint", string)
                            })
                    })
                })
        }
        "config_option_update" => {
            meta(value) && required(value, "configOptions", |v| items(v, config_option))
        }
        "usage_update" => {
            meta(value)
                && required(value, "used", integer)
                && required(value, "size", integer)
                && optional(value, "cost", true, |v| {
                    object(v)
                        && required(
                            v,
                            "amount",
                            |v| matches!(v,Value::Number(n) if n.is_finite()),
                        )
                        && required(v, "currency", string)
                })
        }
        _ => false,
    }
}
pub fn notification(value: &Value) -> bool {
    object(value)
        && meta(value)
        && required(value, "sessionId", string)
        && required(value, "update", update)
}
pub fn parse(source: &[u16]) -> Value {
    let Ok(value) = json::parse_utf16(source, Default::default()) else {
        return Value::Null;
    };
    if object(&value)
        && value.get("jsonrpc") == Some(&s("2.0"))
        && value.get("method") == Some(&s("session/update"))
        && required(&value, "params", notification)
    {
        value
    } else {
        Value::Null
    }
}
pub fn format(session: Vec<u16>, update: Value, meta: Option<Value>) -> Value {
    let mut fields = vec![("sessionId", Value::String(session)), ("update", update)];
    if let Some(meta) = meta {
        fields.push(("_meta", meta));
    }
    o(vec![
        ("jsonrpc", s("2.0")),
        ("method", s("session/update")),
        ("params", o(fields)),
    ])
}
