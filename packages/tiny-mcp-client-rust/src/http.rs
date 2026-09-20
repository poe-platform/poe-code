//! HTTP response stream correlation, independent of fetch, readers and OAuth.
use crate::messages::{ParsedMessage, parse_message};
use mcp_protocol_rust::json::{self, Limits, Value};
const SUBSCRIPTION_METHODS: [&str; 5] = [
    "notifications/subscriptions/acknowledged",
    "notifications/tools/list_changed",
    "notifications/prompts/list_changed",
    "notifications/resources/list_changed",
    "notifications/resources/updated",
];
fn text_is(value: Option<&Value>, expected: &str) -> bool {
    matches!(value, Some(Value::String(text)) if text.iter().copied().eq(expected.encode_utf16()))
}
fn metadata(value: &Value) -> Option<&Value> {
    value
        .get("_meta")
        .filter(|value| matches!(value, Value::Object(_)))
}
fn subscription_id(value: &Value) -> Option<&Value> {
    metadata(value)?.get("io.modelcontextprotocol/subscriptionId")
}
fn array_index(key: &[u16]) -> Option<u32> {
    if key.is_empty() || key.len() > 10 || (key.len() > 1 && key[0] == 48) {
        return None;
    }
    let mut number = 0u64;
    for unit in key {
        if !(48..=57).contains(unit) {
            return None;
        }
        number = number * 10 + u64::from(unit - 48);
    }
    (number < u64::from(u32::MAX)).then_some(number as u32)
}
fn order_properties(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            fields.sort_by_cached_key(|(name, _)| array_index(name).unwrap_or(u32::MAX));
            for (_, child) in fields {
                order_properties(child);
            }
        }
        Value::Array(values) => {
            for child in values {
                order_properties(child);
            }
        }
        _ => {}
    }
}
pub struct HttpResponseMessages {
    request: Value,
    completed: bool,
    acknowledged: bool,
}
impl HttpResponseMessages {
    pub fn new(request: Value) -> Result<Self, String> {
        if !matches!(request.get("id"), Some(Value::Number(_) | Value::String(_)))
            || !matches!(request.get("method"), Some(Value::String(_)))
        {
            return Err("Invalid originating HTTP request".into());
        }
        Ok(Self {
            request,
            completed: false,
            acknowledged: false,
        })
    }
    pub fn completed(&self) -> bool {
        self.completed
    }
    pub fn validate(
        &mut self,
        line: &[u16],
        allow_notifications: bool,
    ) -> Result<Vec<u16>, String> {
        if self.completed {
            return Err("MCP HTTP message arrived after completion".into());
        }
        let mut line = line.to_vec();
        let mut parsed = parse_message(&line);
        if matches!(parsed, ParsedMessage::Invalid { .. })
            && let Ok(mut raw) = json::parse_utf16(&line, Limits::default())
            && text_is(raw.get("jsonrpc"), "2.0")
            && raw.get("id").is_none_or(|id| *id == Value::Null)
            && raw.get("method").is_none()
            && raw.get("result").is_none()
            && let Value::Object(fields) = &mut raw
        {
            let id = self
                .request
                .get("id")
                .expect("validated request ID")
                .clone();
            if let Some((_, previous)) = fields
                .iter_mut()
                .find(|(name, _)| name.iter().copied().eq("id".encode_utf16()))
            {
                *previous = id;
            } else {
                fields.push(("id".encode_utf16().collect(), id));
            }
            order_properties(&mut raw);
            let normalized = json::stringify(&raw).encode_utf16().collect::<Vec<_>>();
            let normalized_message = parse_message(&normalized);
            if matches!(normalized_message, ParsedMessage::Response(_)) {
                parsed = normalized_message;
                line = normalized;
            }
        }
        if let ParsedMessage::Response(response) = &parsed {
            if response.get("id") != self.request.get("id") {
                return Err("MCP HTTP response ID does not match its originating request".into());
            }
            if text_is(self.request.get("method"), "subscriptions/listen")
                && let Some(result) = response.get("result")
                && (!self.acknowledged || subscription_id(result) != self.request.get("id"))
            {
                return Err("Invalid MCP HTTP subscription completion".into());
            }
            self.completed = true;
            return Ok(line);
        }
        let ParsedMessage::Notification(notification) = parsed else {
            return Err(
                "Modern MCP HTTP responses cannot contain requests or invalid messages".into(),
            );
        };
        if !allow_notifications {
            return Err(
                "Modern MCP HTTP responses cannot contain requests or invalid messages".into(),
            );
        }
        let params = notification.get("params").unwrap_or(&Value::Null);
        let id = subscription_id(params);
        let method = notification.get("method");
        let stream_method = SUBSCRIPTION_METHODS
            .iter()
            .any(|name| text_is(method, name));
        if text_is(self.request.get("method"), "subscriptions/listen") {
            if id != self.request.get("id") || !stream_method {
                return Err(
                    "MCP HTTP notification does not match its originating subscription".into(),
                );
            }
            let acknowledgement = text_is(method, "notifications/subscriptions/acknowledged");
            if !self.acknowledged {
                if !acknowledgement {
                    return Err(
                        "MCP HTTP subscription notification arrived before acknowledgement".into(),
                    );
                }
                self.acknowledged = true;
            } else if acknowledgement {
                return Err("MCP HTTP subscription was acknowledged more than once".into());
            }
        } else {
            if id.is_some() || stream_method {
                return Err(
                    "Subscription notifications require their originating HTTP subscription stream"
                        .into(),
                );
            }
            if text_is(method, "notifications/progress") {
                let token = self
                    .request
                    .get("params")
                    .and_then(metadata)
                    .and_then(|meta| meta.get("progressToken"));
                if token.is_none()
                    || matches!(token, Some(Value::Array(_) | Value::Object(_)))
                    || params.get("progressToken") != token
                {
                    return Err(
                        "MCP HTTP progress token does not match its originating request".into(),
                    );
                }
            }
        }
        Ok(line)
    }
}
