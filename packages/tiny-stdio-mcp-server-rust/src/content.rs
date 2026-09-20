use mcp_protocol_rust::formats::{is_base64, is_valid_uri};
use mcp_protocol_rust::json::{self, Value};

pub fn normalize_result(result: Option<Value>, modern: bool) -> Result<Value, String> {
    if let Some(value) = &result
        && let Some(Value::Array(content)) = value.get("content")
    {
        if !content.iter().all(is_content_item)
            || value
                .get("isError")
                .is_some_and(|value| !matches!(value, Value::Bool(_)))
            || value.get("structuredContent").is_some_and(|value| {
                (!modern && !matches!(value, Value::Object(_))) || !value.is_json_value()
            })
        {
            return Err("Invalid tool result".into());
        }
        return Ok(result.expect("validated explicit result"));
    }
    let mut pending = result.into_iter().collect::<Vec<_>>();
    let mut content = Vec::new();
    while let Some(value) = pending.pop() {
        match value {
            Value::Array(values) => pending.extend(values.into_iter().rev()),
            value if is_content_block(&value) => {
                if !is_content_item(&value) {
                    return Err("Invalid tool result".into());
                }
                content.push(value);
            }
            Value::String(units) => content.push(text_block(units)),
            Value::Number(value) => {
                let text = mcp_protocol_rust::numbers::format(value);
                content.push(text_block(text.encode_utf16().collect()));
            }
            value => {
                if !value.is_json_value() {
                    return Err(
                        "Tool return must be a JSON value or supported content helper".into(),
                    );
                }
                content.push(text_block(json::stringify(&value).encode_utf16().collect()));
            }
        }
    }
    Ok(Value::Object(vec![(
        "content".encode_utf16().collect(),
        Value::Array(content),
    )]))
}

fn text_block(units: Vec<u16>) -> Value {
    Value::Object(vec![
        (
            "type".encode_utf16().collect(),
            Value::String("text".encode_utf16().collect()),
        ),
        ("text".encode_utf16().collect(), Value::String(units)),
    ])
}

pub fn is_content_item(value: &Value) -> bool {
    if !matches!(value, Value::Object(_)) || !valid_annotations(value) {
        return false;
    }
    match value.get("type") {
        Some(Value::String(units)) => {
            if units.iter().copied().eq("text".encode_utf16()) {
                return is_string(value.get("text"));
            }
            if units.iter().copied().eq("image".encode_utf16())
                || units.iter().copied().eq("audio".encode_utf16())
            {
                return matches!(value.get("data"), Some(Value::String(data)) if is_base64(data))
                    && is_string(value.get("mimeType"));
            }
            if units.iter().copied().eq("resource_link".encode_utf16()) {
                return matches!(value.get("uri"), Some(Value::String(uri)) if is_valid_uri(uri))
                    && is_string(value.get("name"))
                    && ["title", "description", "mimeType"]
                        .iter()
                        .all(|name| value.get(name).is_none_or(|value| is_string(Some(value))))
                    && value
                        .get("size")
                        .is_none_or(|value| matches!(value, Value::Number(_)));
            }
            units.iter().copied().eq("resource".encode_utf16())
                && value.get("resource").is_some_and(is_resource_contents)
        }
        _ => false,
    }
}

pub fn is_resource_contents(value: &Value) -> bool {
    matches!(value, Value::Object(_))
        && matches!(value.get("uri"), Some(Value::String(uri)) if is_valid_uri(uri))
        && value
            .get("mimeType")
            .is_none_or(|value| is_string(Some(value)))
        && (is_string(value.get("text"))
            || matches!(value.get("blob"), Some(Value::String(blob)) if is_base64(blob)))
}

fn valid_annotations(value: &Value) -> bool {
    let Some(annotations) = value.get("annotations") else {
        return true;
    };
    matches!(annotations, Value::Object(_))
        && annotations.get("audience").is_none_or(|value| matches!(value, Value::Array(roles) if roles.iter().all(|role| string_is(role, "user") || string_is(role, "assistant"))))
        && annotations.get("priority").is_none_or(|value| matches!(value, Value::Number(_)))
        && annotations.get("lastModified").is_none_or(|value| is_string(Some(value)))
}

// Conversion recognizes the same content shape as the public TS helper before
// protocol validation. Incomplete lookalikes remain ordinary JSON text.
fn is_content_block(value: &Value) -> bool {
    if string_is_option(value.get("type"), "text") {
        return is_string(value.get("text"));
    }
    if string_is_option(value.get("type"), "image") || string_is_option(value.get("type"), "audio")
    {
        return is_string(value.get("data")) && is_string(value.get("mimeType"));
    }
    if string_is_option(value.get("type"), "resource_link") {
        return is_string(value.get("uri")) && is_string(value.get("name"));
    }
    string_is_option(value.get("type"), "resource")
        && value.get("resource").is_some_and(|resource| {
            is_string(resource.get("uri"))
                && resource
                    .get("mimeType")
                    .is_none_or(|value| is_string(Some(value)))
                && (is_string(resource.get("text")) || is_string(resource.get("blob")))
        })
}

fn is_string(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(_)))
}
fn string_is_option(value: Option<&Value>, text: &str) -> bool {
    value.is_some_and(|value| string_is(value, text))
}
fn string_is(value: &Value, text: &str) -> bool {
    matches!(value, Value::String(units) if units.iter().copied().eq(text.encode_utf16()))
}
