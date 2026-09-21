use crate::{o, s, text};
use mcp_protocol_rust::json::{self, Value};
use std::collections::HashMap;
#[derive(Clone, Hash, PartialEq, Eq)]
enum Id {
    Null,
    Number(i64),
    String(Vec<u16>),
}
fn key(value: &Value) -> Result<Id, String> {
    if !crate::protocol::id(value) {
        return Err("Request id must be null, a string, or a safe integer".into());
    }
    Ok(match value {
        Value::Null => Id::Null,
        Value::Number(n) => Id::Number(*n as i64),
        Value::String(s) => Id::String(s.clone()),
        _ => unreachable!(),
    })
}
fn line(value: &Value) -> Value {
    s(&(json::stringify(value) + "\n"))
}
pub struct Layer {
    next: f64,
    token: u32,
    disposed: bool,
    pending: HashMap<Id, u32>,
    requests: HashMap<Vec<u16>, u32>,
    notifications: HashMap<Vec<u16>, u32>,
    buffer: Vec<u16>,
}
impl Layer {
    pub fn new(first: f64) -> Result<Self, String> {
        if !crate::protocol::id(&Value::Number(first)) {
            return Err("firstRequestId must be a safe integer".into());
        }
        Ok(Self {
            next: first,
            token: 0,
            disposed: false,
            pending: HashMap::new(),
            requests: HashMap::new(),
            notifications: HashMap::new(),
            buffer: vec![],
        })
    }
    pub fn assert_open(&self) -> Result<(), String> {
        if self.disposed {
            Err("JSON-RPC message layer is disposed".into())
        } else {
            Ok(())
        }
    }
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
    pub fn retained_frame_capacity(&self) -> usize {
        self.buffer.capacity()
    }
    pub fn register(&mut self, method: Vec<u16>, notification: bool, handler: u32) -> Option<u32> {
        if notification {
            self.notifications.insert(method, handler)
        } else {
            self.requests.insert(method, handler)
        }
    }
    pub fn request(
        &mut self,
        method: &[u16],
        params: Option<Value>,
        id: Option<Value>,
    ) -> Result<Value, String> {
        self.assert_open()?;
        let id = if let Some(id) = id {
            id
        } else {
            let id = Value::Number(self.next);
            self.next += 1.0;
            id
        };
        let key = key(&id)?;
        if self.pending.contains_key(&key) {
            return Err(format!(
                "A request with id {} is already pending",
                json::stringify(&id)
            ));
        }
        self.token = self
            .token
            .checked_add(1)
            .ok_or("JSON-RPC request token capacity exceeded")?;
        let mut fields = vec![
            ("jsonrpc", s("2.0")),
            ("id", id.clone()),
            ("method", Value::String(method.to_vec())),
        ];
        if let Some(params) = params {
            fields.push(("params", params));
        }
        self.pending.insert(key, self.token);
        Ok(o(vec![
            ("token", Value::Number(self.token as f64)),
            ("line", line(&o(fields))),
        ]))
    }
    pub fn notification(&self, method: &[u16], params: Option<Value>) -> Result<Value, String> {
        self.assert_open()?;
        let mut fields = vec![
            ("jsonrpc", s("2.0")),
            ("method", Value::String(method.to_vec())),
        ];
        if let Some(params) = params {
            fields.push(("params", params));
        }
        Ok(line(&o(fields)))
    }
    pub fn cancel(&mut self, token: u32) {
        self.pending.retain(|_, value| *value != token);
    }
    pub fn incoming(&mut self, source: &[u16]) -> Value {
        if self.disposed {
            return o(vec![("type", s("none"))]);
        }
        let parsed = crate::protocol::parse(source);
        let id = parsed.get("id").cloned().unwrap_or(Value::Null);
        if parsed.get("type") == Some(&s("invalid")) {
            return o(vec![
                ("type", s("write")),
                (
                    "line",
                    line(&crate::protocol::response(
                        id,
                        parsed.get("error").unwrap().clone(),
                    )),
                ),
            ]);
        }
        let message = parsed.get("message").unwrap().clone();
        if parsed.get("type") == Some(&s("response")) {
            let key = key(message.get("id").unwrap()).expect("parsed response id");
            return if let Some(token) = self.pending.remove(&key) {
                o(vec![
                    ("type", s("response")),
                    ("token", Value::Number(token as f64)),
                    ("message", message),
                ])
            } else {
                o(vec![("type", s("none"))])
            };
        }
        let Value::String(method) = message.get("method").unwrap() else {
            unreachable!()
        };
        let notification = parsed.get("type") == Some(&s("notification"));
        let handler = if notification {
            self.notifications.get(method)
        } else {
            self.requests.get(method)
        };
        if let Some(handler) = handler {
            return o(vec![
                (
                    "type",
                    s(if notification {
                        "notification"
                    } else {
                        "request"
                    }),
                ),
                ("handler", Value::Number(*handler as f64)),
                ("message", message),
            ]);
        }
        if notification {
            return o(vec![("type", s("none"))]);
        }
        let error = crate::protocol::error(
            -32601,
            &format!(
                "Method not found: \"{}\"",
                text(message.get("method").unwrap())
            ),
            None,
        );
        o(vec![
            ("type", s("write")),
            (
                "line",
                line(&crate::protocol::response(
                    message.get("id").unwrap().clone(),
                    error,
                )),
            ),
        ])
    }
    pub fn push(&mut self, chunk: &[u16]) -> Result<Vec<Value>, String> {
        if self.disposed {
            return Ok(vec![]);
        }
        let mut actions = vec![];
        for unit in chunk {
            if *unit == 10 {
                if self.buffer.last() == Some(&13) {
                    self.buffer.pop();
                }
                if !self.buffer.is_empty() {
                    let buffer = std::mem::take(&mut self.buffer);
                    actions.push(Value::String(buffer.clone()));
                    if buffer.capacity() <= 64 * 1024 {
                        self.buffer = buffer;
                        self.buffer.clear();
                    }
                }
            } else {
                if self.buffer.len() >= 8 * 1024 * 1024 {
                    return Err("ACP JSON-RPC line resource limit exceeded".into());
                }
                self.buffer.push(*unit);
            }
        }
        Ok(actions)
    }
    pub fn finish(&mut self) -> Vec<Value> {
        if self.disposed || self.buffer.is_empty() {
            return vec![];
        }
        let mut buffer = std::mem::take(&mut self.buffer);
        if buffer.last() == Some(&13) {
            buffer.pop();
        }
        if buffer.is_empty() {
            vec![]
        } else {
            vec![Value::String(buffer)]
        }
    }
    pub fn dispose(&mut self) {
        self.disposed = true;
        self.pending = HashMap::new();
        self.requests = HashMap::new();
        self.notifications = HashMap::new();
        self.buffer = vec![];
    }
}
