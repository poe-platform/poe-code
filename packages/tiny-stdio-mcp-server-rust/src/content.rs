use mcp_protocol_rust::json::{self, Value};

pub fn normalize_result(result: Option<Value>) -> Result<Value, String> {
    if let Some(value) = &result
        && let Some(Value::Array(content)) = value.get("content")
    {
        if !content.iter().all(is_text_block)
            || value
                .get("isError")
                .is_some_and(|value| !matches!(value, Value::Bool(_)))
            || value
                .get("structuredContent")
                .is_some_and(|value| !matches!(value, Value::Object(_)) || !value.is_json_value())
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
            value if is_text_block(&value) => content.push(value),
            Value::String(units) => content.push(text_block(units)),
            Value::Number(value) => {
                let text = if value == 0.0 {
                    "0".into()
                } else {
                    value.to_string()
                };
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

fn is_text_block(value: &Value) -> bool {
    matches!(value.get("type"), Some(Value::String(units)) if units.iter().copied().eq("text".encode_utf16()))
        && matches!(value.get("text"), Some(Value::String(_)))
}
