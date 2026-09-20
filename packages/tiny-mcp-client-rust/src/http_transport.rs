//! HTTP transport policy and ownership identities. The host executes HTTP/stream I/O.
use crate::{
    http::HttpResponseMessages,
    messages::{ParsedMessage, parse_message},
};
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
use std::collections::HashMap;
use std::sync::Arc;
use tiny_stdio_mcp_server_rust::headers::{self, ParameterHeader};

#[derive(Hash, PartialEq, Eq)]
enum Id {
    String(Vec<u16>),
    Number(u64),
}
impl Id {
    fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::String(value) => Some(Self::String(value.clone())),
            Value::Number(value) => Some(Self::Number(if *value == 0.0 {
                0
            } else if value.is_nan() {
                f64::NAN.to_bits()
            } else {
                value.to_bits()
            })),
            _ => None,
        }
    }
}
fn is_text(value: Option<&Value>, expected: &str) -> bool {
    matches!(value, Some(Value::String(value)) if value.iter().copied().eq(expected.encode_utf16()))
}
fn record(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| matches!(value, Value::Object(_)))
}
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
pub struct Post {
    pub message: Option<Arc<Value>>,
    pub modern: bool,
    pub ordered: bool,
    pub slot: Option<u64>,
    pub cancelled: bool,
    pub cancel_slot: Option<u64>,
    pub has_session: bool,
}
pub type HeaderChanges = Vec<(String, Option<Vec<u16>>)>;
impl Post {
    pub fn response_context(&self) -> Option<HttpResponseMessages> {
        self.message
            .as_ref()
            .filter(|message| message.get("id").is_some())
            .map(|message| {
                HttpResponseMessages::from_shared(message.clone())
                    .expect("parsed originating request")
            })
    }
    pub fn error_line(&self, status: u16, body: &[u16]) -> Option<Vec<u16>> {
        if !self.modern || status < 400 {
            return None;
        }
        let request = self
            .message
            .as_ref()
            .filter(|message| message.get("id").is_some())?;
        if !body.is_empty() {
            let mut context = self.response_context()?;
            if let Ok(line) = context.validate(body, false)
                && let ParsedMessage::Response(mut response) = parse_message(&line)
                && response.get("error").is_some()
            {
                super::http::order_properties(&mut response);
                return Some(text(&json::stringify(&response)));
            }
        }
        if status < 500 && is_text(request.get("method"), "server/discover") {
            return Some(text(&json::stringify(&Value::Object(vec![
                (text("jsonrpc"), Value::String(text("2.0"))),
                (text("id"), request.get("id").expect("request ID").clone()),
                (
                    text("error"),
                    Value::Object(vec![
                        (text("code"), Value::Number(-32601.0)),
                        (
                            text("message"),
                            Value::String(text("Modern discovery unavailable")),
                        ),
                    ]),
                ),
            ]))));
        }
        None
    }
}
#[derive(Debug, PartialEq)]
pub enum ResponseKind {
    Ignore,
    Json,
    Sse,
    Unsupported,
}
pub fn response_kind(status: u16, content_type: Option<&str>) -> ResponseKind {
    if status == 202 {
        return ResponseKind::Ignore;
    }
    let Some(content_type) = content_type else {
        return ResponseKind::Ignore;
    };
    let units = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .encode_utf16()
        .collect::<Vec<_>>();
    let units = trim_ecmascript(&units);
    let matches = |expected: &str| {
        units.len() == expected.len()
            && units
                .iter()
                .copied()
                .zip(expected.bytes())
                .all(|(left, right)| {
                    left == u16::from(right)
                        || (right.is_ascii_lowercase() && left == u16::from(right - 32))
                })
    };
    if matches("application/json") {
        ResponseKind::Json
    } else if matches("text/event-stream") {
        ResponseKind::Sse
    } else {
        ResponseKind::Unsupported
    }
}
pub struct Disposal {
    pub session: Option<Vec<u16>>,
    pub slots: Vec<u64>,
}
#[derive(Default)]
pub struct HttpState {
    session: Option<Vec<u16>>,
    event_id: Option<Vec<u16>>,
    get_started: bool,
    modern: bool,
    disposed: bool,
    next: u64,
    active: HashMap<Id, u64>,
    tool_headers: HashMap<Vec<u16>, Vec<ParameterHeader>>,
}
impl HttpState {
    pub fn disposed(&self) -> bool {
        self.disposed
    }
    pub fn active_count(&self) -> usize {
        self.active.len()
    }
    pub fn prepare(&mut self, line: &[u16]) -> Result<Post, &'static str> {
        if self.disposed {
            return Err("HTTP transport disposed");
        }
        let parsed = parse_message(line);
        let ordered = match &parsed {
            ParsedMessage::Request(message) => is_text(message.get("method"), "initialize"),
            ParsedMessage::Notification(message) => {
                is_text(message.get("method"), "notifications/initialized")
            }
            _ => false,
        };
        let notification = matches!(parsed, ParsedMessage::Notification(_));
        let message = match parsed {
            ParsedMessage::Request(message) | ParsedMessage::Notification(message) => {
                Some(Arc::new(message))
            }
            _ => None,
        };
        let modern = message
            .as_ref()
            .and_then(|message| record(message.get("params")))
            .and_then(|params| record(params.get("_meta")))
            .is_some_and(|metadata| {
                matches!(
                    metadata.get("io.modelcontextprotocol/protocolVersion"),
                    Some(Value::String(_))
                )
            });
        if modern {
            self.modern = true;
        }
        if ordered && !notification {
            self.modern = false;
        }
        let cancelled = self.modern
            && notification
            && message
                .as_ref()
                .is_some_and(|message| is_text(message.get("method"), "notifications/cancelled"));
        let cancel_slot = if cancelled {
            message
                .as_ref()
                .and_then(|message| record(message.get("params")))
                .and_then(|params| params.get("requestId"))
                .and_then(Id::from_value)
                .and_then(|id| self.active.get(&id).copied())
        } else {
            None
        };
        let slot = if !cancelled
            && modern
            && !notification
            && let Some(id) = message
                .as_ref()
                .and_then(|message| message.get("id"))
                .and_then(Id::from_value)
        {
            self.next = self
                .next
                .checked_add(1)
                .filter(|slot| *slot <= 9_007_199_254_740_991)
                .ok_or("HTTP transport request identity exhausted")?;
            self.active.insert(id, self.next);
            Some(self.next)
        } else {
            None
        };
        Ok(Post {
            message,
            modern,
            ordered,
            slot,
            cancelled,
            cancel_slot,
            has_session: !modern && self.session.is_some(),
        })
    }
    pub fn finish(&mut self, post: &Post) {
        if let Some(id) = post
            .message
            .as_ref()
            .and_then(|message| message.get("id"))
            .and_then(Id::from_value)
            && self.active.get(&id) == post.slot.as_ref()
        {
            self.active.remove(&id);
        }
    }
    pub fn clear_tools(&mut self) {
        self.tool_headers.clear();
    }
    pub fn filter_tool(&mut self, name: Vec<u16>, schema: &Value) -> Result<(), String> {
        match headers::get_parameter_headers(schema) {
            Ok(definitions) => {
                self.tool_headers.insert(name, definitions);
                Ok(())
            }
            Err(error) => {
                self.tool_headers.remove(&name);
                Err(error)
            }
        }
    }
    pub fn reject_tool(&mut self, name: &[u16]) {
        self.tool_headers.remove(name);
    }
    pub fn post_headers(&self, post: &Post) -> Result<HeaderChanges, String> {
        let mut changes = vec![
            (
                "Accept".into(),
                Some(text("application/json, text/event-stream")),
            ),
            ("Content-Type".into(), Some(text("application/json"))),
        ];
        let message = post.message.as_ref();
        if post.modern
            && let Some(message) = message
            && let Some(params) = record(message.get("params"))
            && let Some(metadata) = record(params.get("_meta"))
        {
            changes.push(("Mcp-Session-Id".into(), None));
            changes.push(("Last-Event-ID".into(), None));
            changes.push((
                "MCP-Protocol-Version".into(),
                metadata
                    .get("io.modelcontextprotocol/protocolVersion")
                    .and_then(|value| match value {
                        Value::String(value) => Some(value.clone()),
                        _ => None,
                    }),
            ));
            if message.get("id").is_some() {
                if let Some(Value::String(method)) = message.get("method") {
                    changes.push(("Mcp-Method".into(), Some(method.clone())));
                }
                let method = message.get("method");
                let name = params.get(if is_text(method, "resources/read") {
                    "uri"
                } else {
                    "name"
                });
                let named_method = ["tools/call", "resources/read", "prompts/get"]
                    .iter()
                    .any(|expected| is_text(method, expected));
                changes.push((
                    "Mcp-Name".into(),
                    if named_method && let Some(Value::String(name)) = name {
                        Some(headers::encode_value(name)?)
                    } else {
                        None
                    },
                ));
                if is_text(method, "tools/call")
                    && let Some(Value::String(name)) = params.get("name")
                    && let Some(definitions) = self.tool_headers.get(name)
                {
                    for definition in definitions {
                        changes.push((definition.name.clone(), None));
                    }
                    for (name, value) in headers::create_parameter_headers(
                        definitions,
                        params.get("arguments").unwrap_or(&Value::Null),
                    )? {
                        changes.push((name, Some(value)));
                    }
                }
            }
        } else if let Some(session) = &self.session {
            changes.push(("Mcp-Session-Id".into(), Some(session.clone())));
            changes.push(("MCP-Protocol-Version".into(), Some(text("2025-03-26"))));
        }
        Ok(changes)
    }
    pub fn get_headers(&self) -> Vec<(String, Vec<u16>)> {
        let mut headers = vec![("Accept".into(), text("text/event-stream"))];
        if let Some(session) = &self.session {
            headers.push(("Mcp-Session-Id".into(), session.clone()));
            headers.push(("MCP-Protocol-Version".into(), text("2025-03-26")));
        }
        if let Some(cursor) = &self.event_id {
            headers.push(("Last-Event-ID".into(), cursor.clone()));
        }
        headers
    }
    pub fn capture_session(&mut self, session: Option<&[u16]>) -> Result<(), &'static str> {
        if let Some(session) = session.filter(|value| !value.is_empty()) {
            if self
                .session
                .as_ref()
                .is_some_and(|current| current != session)
            {
                return Err("HTTP transport response changed active session ID");
            }
            self.session = Some(session.to_vec());
        }
        Ok(())
    }
    pub fn expire_session(&mut self) {
        self.session = None;
    }
    pub fn begin_get(&mut self) -> bool {
        if self.disposed || self.session.is_none() || self.get_started {
            return false;
        }
        self.get_started = true;
        true
    }
    pub fn set_event_id(&mut self, cursor: Option<Vec<u16>>) {
        self.event_id = cursor;
    }
    pub fn finish_get(&mut self) -> bool {
        self.get_started = false;
        !self.disposed && self.session.is_some() && self.event_id.is_some()
    }
    pub fn dispose(&mut self) -> Option<Disposal> {
        if self.disposed {
            return None;
        }
        self.disposed = true;
        self.tool_headers.clear();
        let slots = self.active.drain().map(|(_, slot)| slot).collect();
        Some(Disposal {
            session: self.session.take(),
            slots,
        })
    }
}
