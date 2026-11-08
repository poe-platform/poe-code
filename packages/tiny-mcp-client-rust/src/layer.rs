//! Protocol bookkeeping is independent of streams, callbacks and clock adapters.
use crate::messages::{ParsedMessage, parse_payload};
use mcp_protocol_rust::{
    json::{self, Limits, Value},
    metadata::is_valid_metadata,
};
use std::collections::{HashMap, HashSet, VecDeque};
use tiny_stdio_mcp_server_rust::protocol::validate_definition;

#[derive(Debug, PartialEq)]
pub struct LayerError {
    pub code: Option<i32>,
    pub message: &'static str,
}
#[derive(Debug, PartialEq)]
pub enum Event {
    Write(Value),
    Settle {
        id: u64,
        result: Option<Value>,
        error: Option<Value>,
    },
    Invoke {
        token: u64,
        id: Value,
        method: Vec<u16>,
        params: Option<Value>,
    },
    Cancel {
        token: u64,
        reason: Vec<u16>,
    },
    Notification {
        method: Vec<u16>,
        params: Option<Value>,
    },
}
#[derive(Hash, PartialEq, Eq)]
enum Key {
    String(Vec<u16>),
    Number(u64),
}
impl Key {
    fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::String(text) => Some(Self::String(text.clone())),
            Value::Number(number) => Some(Self::Number(if *number == 0.0 {
                0
            } else if number.is_nan() {
                f64::NAN.to_bits()
            } else {
                number.to_bits()
            })),
            _ => None,
        }
    }
}
struct Incoming {
    id: Value,
    method: Vec<u16>,
    canceled: bool,
}
pub struct MessageLayer {
    limit: usize,
    modern: bool,
    disposed: bool,
    next_exchange: u64,
    next_request: u64,
    next_incoming: u64,
    exchanges: HashSet<u64>,
    pending: HashMap<u64, u64>,
    handlers: HashSet<Vec<u16>>,
    incoming: HashMap<u64, Incoming>,
    named_incoming: HashMap<Key, u64>,
    queued: VecDeque<ParsedMessage>,
    events: VecDeque<Event>,
}
impl MessageLayer {
    pub fn new(limit: usize) -> Result<Self, LayerError> {
        if limit == 0 {
            return Err(error(
                None,
                "maxConcurrentRequests must be a positive safe integer",
            ));
        }
        Ok(Self {
            limit,
            modern: false,
            disposed: false,
            next_exchange: 0,
            next_request: 0,
            next_incoming: 0,
            exchanges: HashSet::new(),
            pending: HashMap::new(),
            handlers: HashSet::new(),
            incoming: HashMap::new(),
            named_incoming: HashMap::new(),
            queued: VecDeque::new(),
            events: VecDeque::new(),
        })
    }
    pub fn set_modern(&mut self, modern: bool) {
        self.modern = modern;
    }
    pub fn register_request(&mut self, method: Vec<u16>) {
        self.handlers.insert(method);
    }
    pub fn begin_exchange(&mut self) -> Result<u64, LayerError> {
        if self.disposed {
            return Err(error(None, "JSON-RPC message layer disposed"));
        }
        if self.exchanges.len() >= self.limit {
            return Err(error(None, "JSON-RPC request capacity exceeded"));
        }
        self.next_exchange = next(self.next_exchange)?;
        self.exchanges.insert(self.next_exchange);
        Ok(self.next_exchange)
    }
    pub fn prepare_request(
        &mut self,
        exchange: u64,
        method: Vec<u16>,
        params: Option<Value>,
        metadata: Option<Value>,
    ) -> Result<Value, LayerError> {
        if self.disposed {
            return Err(error(None, "JSON-RPC message layer disposed"));
        }
        if !self.exchanges.contains(&exchange) {
            return Err(error(None, "Unknown JSON-RPC exchange"));
        }
        if params
            .as_ref()
            .is_some_and(|params| !params.is_json_value())
        {
            return Err(error(
                Some(-32602),
                "Request params must contain only JSON values",
            ));
        }
        if !valid_params_metadata(params.as_ref())
            || metadata
                .as_ref()
                .is_some_and(|metadata| !is_valid_metadata(metadata))
        {
            return Err(error(Some(-32602), "Invalid request metadata"));
        }
        self.next_request = next(self.next_request)?;
        let params = if let Some(Value::Object(metadata)) = metadata {
            let mut params = match params {
                None => vec![],
                Some(Value::Object(params)) => params,
                _ => {
                    return Err(error(
                        Some(-32602),
                        "Modern request params must be an object",
                    ));
                }
            };
            let mut merged = params
                .iter()
                .find(|(key, _)| key == &units("_meta"))
                .and_then(|(_, value)| match value {
                    Value::Object(entries) => Some(entries.clone()),
                    _ => None,
                })
                .unwrap_or_default();
            for (key, value) in metadata {
                put(&mut merged, key, value);
            }
            put(&mut params, units("_meta"), Value::Object(merged));
            Some(Value::Object(params))
        } else {
            params
        };
        let id = self.next_request;
        let mut request = vec![
            (units("jsonrpc"), Value::String(units("2.0"))),
            (units("id"), Value::Number(id as f64)),
            (units("method"), Value::String(method)),
        ];
        if let Some(params) = params {
            request.push((units("params"), params));
        }
        self.pending.insert(id, exchange);
        Ok(Value::Object(request))
    }
    pub fn notification(
        &self,
        method: Vec<u16>,
        params: Option<Value>,
    ) -> Result<Value, LayerError> {
        if self.disposed {
            return Err(error(None, "JSON-RPC message layer disposed"));
        }
        if params
            .as_ref()
            .is_some_and(|params| !params.is_json_value())
        {
            return Err(error(
                Some(-32602),
                "Notification params must contain only JSON values",
            ));
        }
        if !valid_params_metadata(params.as_ref()) {
            return Err(error(Some(-32602), "Invalid notification metadata"));
        }
        let mut result = vec![
            (units("jsonrpc"), Value::String(units("2.0"))),
            (units("method"), Value::String(method)),
        ];
        if let Some(params) = params {
            result.push((units("params"), params));
        }
        Ok(Value::Object(result))
    }
    pub fn cancel_request(&mut self, id: u64) -> bool {
        self.pending.remove(&id).is_some()
    }
    pub fn finish_exchange(&mut self, exchange: u64) -> bool {
        self.pending.retain(|_, owner| *owner != exchange);
        self.exchanges.remove(&exchange)
    }
    pub fn feed(&mut self, line: &[u16]) -> Result<(), LayerError> {
        if self.disposed || line.is_empty() {
            return Ok(());
        }
        match json::parse_utf16(line, Limits::default()) {
            Ok(Value::Array(batch)) => self.queued.extend(batch.into_iter().map(parse_payload)),
            Ok(value) => self.queued.push_back(parse_payload(value)),
            Err(_) => self.queued.push_back(ParsedMessage::Invalid {
                id: Value::Null,
                code: -32700,
                message: "Parse error",
            }),
        }
        Ok(())
    }
    pub fn next_event(&mut self) -> Option<Event> {
        if self.disposed {
            return None;
        }
        if let Some(event) = self.events.pop_front() {
            return Some(event);
        }
        while let Some(parsed) = self.queued.pop_front() {
            match parsed {
                ParsedMessage::Invalid { id, code, message } => {
                    return Some(Event::Write(error_reply(id, code as f64, units(message))));
                }
                ParsedMessage::Response(message) => {
                    let Some(Value::Number(id)) = message.get("id") else {
                        continue;
                    };
                    if !id.is_finite()
                        || *id < 1.0
                        || id.fract() != 0.0
                        || !self.pending.contains_key(&(*id as u64))
                    {
                        continue;
                    }
                    let id = *id as u64;
                    self.pending.remove(&id);
                    return Some(Event::Settle {
                        id,
                        result: message.get("result").cloned(),
                        error: message.get("error").cloned(),
                    });
                }
                ParsedMessage::Notification(message) => {
                    let Value::String(method) =
                        message.get("method").expect("parsed notification method")
                    else {
                        unreachable!()
                    };
                    let params = message.get("params").cloned();
                    let notification = Event::Notification {
                        method: method.clone(),
                        params: params.clone(),
                    };
                    if method == &units("notifications/cancelled")
                        && let Some(params) = &params
                        && let Some(key) = params.get("requestId").and_then(Key::from_value)
                        && let Some(token) = self.named_incoming.get(&key)
                        && let Some(incoming) = self.incoming.get_mut(token)
                    {
                        incoming.canceled = true;
                        let reason = match params.get("reason") {
                            Some(Value::String(reason)) => reason.clone(),
                            _ => units("Server request cancelled"),
                        };
                        self.events.push_back(notification);
                        return Some(Event::Cancel {
                            token: *token,
                            reason,
                        });
                    }
                    return Some(notification);
                }
                ParsedMessage::Request(message) => {
                    let id = message.get("id").expect("parsed request id").clone();
                    let Value::String(method) =
                        message.get("method").expect("parsed request method")
                    else {
                        unreachable!()
                    };
                    if self.modern {
                        return Some(Event::Write(error_reply(
                            id,
                            -32600.0,
                            units("Modern MCP servers cannot initiate JSON-RPC requests"),
                        )));
                    }
                    if !self.handlers.contains(method) {
                        return Some(Event::Write(error_reply(
                            id,
                            -32601.0,
                            units("Method not found: ")
                                .into_iter()
                                .chain(method.iter().copied())
                                .collect(),
                        )));
                    }
                    let key = Key::from_value(&id).expect("parsed request key");
                    if self.named_incoming.contains_key(&key) {
                        return Some(Event::Write(error_reply(
                            id,
                            -32600.0,
                            units("Duplicate active server request ID"),
                        )));
                    }
                    if self.incoming.len() >= self.limit {
                        return Some(Event::Write(error_reply(
                            id,
                            -32000.0,
                            units("Server request capacity exceeded"),
                        )));
                    }
                    let token = match next(self.next_incoming) {
                        Ok(token) => token,
                        Err(_) => {
                            return Some(Event::Write(error_reply(
                                id,
                                -32000.0,
                                units("Server request identifier exhausted"),
                            )));
                        }
                    };
                    self.next_incoming = token;
                    self.named_incoming.insert(key, token);
                    self.incoming.insert(
                        token,
                        Incoming {
                            id: id.clone(),
                            method: method.clone(),
                            canceled: false,
                        },
                    );
                    return Some(Event::Invoke {
                        token,
                        id,
                        method: method.clone(),
                        params: message.get("params").cloned(),
                    });
                }
            }
        }
        None
    }
    pub fn validate_incoming(&self, token: u64, params: Option<Value>) -> Option<Value> {
        let incoming = self.incoming.get(&token)?;
        response_type(&incoming.method)?;
        let mut input = vec![(units("method"), Value::String(incoming.method.clone()))];
        if let Some(params) = params {
            input.push((units("params"), params));
        }
        if validate_definition("InputRequest", &Value::Object(input)) {
            return None;
        }
        Some(error_reply(
            incoming.id.clone(),
            -32602.0,
            units("Invalid client input request"),
        ))
    }
    pub fn complete_incoming(&self, token: u64, result: Result<Value, Value>) -> Option<Value> {
        let incoming = self.incoming.get(&token)?;
        if self.disposed || incoming.canceled {
            return None;
        }
        let (key, result) = match result {
            Ok(result) => {
                if response_type(&incoming.method)
                    .is_some_and(|definition| !validate_definition(definition, &result))
                {
                    return Some(error_reply(
                        incoming.id.clone(),
                        -32603.0,
                        units("Invalid client input response"),
                    ));
                }
                if !result.is_json_value() {
                    return Some(error_reply(
                        incoming.id.clone(),
                        -32603.0,
                        units("Response result must contain only JSON values"),
                    ));
                }
                ("result", result)
            }
            Err(error) => ("error", error),
        };
        Some(Value::Object(vec![
            (units("jsonrpc"), Value::String(units("2.0"))),
            (units("id"), incoming.id.clone()),
            (units(key), result),
        ]))
    }
    pub fn finish_incoming(&mut self, token: u64) -> bool {
        let Some(incoming) = self.incoming.remove(&token) else {
            return false;
        };
        if let Some(key) = Key::from_value(&incoming.id) {
            self.named_incoming.remove(&key);
        }
        true
    }
    pub fn dispose(&mut self) {
        self.disposed = true;
        self.pending.clear();
        self.exchanges.clear();
        self.incoming.clear();
        self.named_incoming.clear();
        self.queued.clear();
        self.events.clear();
    }
}
fn next(value: u64) -> Result<u64, LayerError> {
    value
        .checked_add(1)
        .filter(|value| *value <= 9_007_199_254_740_991)
        .ok_or_else(|| error(None, "JSON-RPC request identifier exhausted"))
}
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn error(code: Option<i32>, message: &'static str) -> LayerError {
    LayerError { code, message }
}
fn put(entries: &mut Vec<(Vec<u16>, Value)>, key: Vec<u16>, value: Value) {
    if let Some((_, previous)) = entries.iter_mut().find(|(name, _)| name == &key) {
        *previous = value;
    } else {
        entries.push((key, value));
    }
}
fn valid_params_metadata(params: Option<&Value>) -> bool {
    params
        .and_then(|params| params.get("_meta"))
        .is_none_or(is_valid_metadata)
}
fn response_type(method: &[u16]) -> Option<&'static str> {
    match String::from_utf16_lossy(method).as_str() {
        "roots/list" => Some("ListRootsResult"),
        "sampling/createMessage" => Some("CreateMessageResult"),
        "elicitation/create" => Some("ElicitResult"),
        _ => None,
    }
}
fn error_reply(id: Value, code: f64, message: Vec<u16>) -> Value {
    Value::Object(vec![
        (units("jsonrpc"), Value::String(units("2.0"))),
        (units("id"), id),
        (
            units("error"),
            Value::Object(vec![
                (units("code"), Value::Number(code)),
                (units("message"), Value::String(message)),
            ]),
        ),
    ])
}
