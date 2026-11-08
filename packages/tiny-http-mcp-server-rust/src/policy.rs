//! HTTP admission and session/message decisions, separated from asynchronous host I/O.
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
use std::collections::{BTreeSet, HashMap};
fn key(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn text(s: &str) -> Value {
    Value::String(key(s))
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(fields.into_iter().map(|(k, v)| (key(k), v)).collect())
}
fn string(v: Option<&Value>) -> Option<&[u16]> {
    match v {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}
fn is(v: Option<&Value>, s: &str) -> bool {
    string(v).is_some_and(|v| v.iter().copied().eq(s.encode_utf16()))
}
fn number(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => *n,
        _ => f64::NAN,
    }
}
fn boolean(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}
fn first(v: Option<&Value>) -> Option<&[u16]> {
    match v {
        Some(Value::Array(a)) => string(a.first()),
        _ => string(v),
    }
}
fn rejection(status: u16, reason: &str, message: impl Into<String>) -> Value {
    object(vec![
        ("status", Value::Number(status as f64)),
        ("reason", text(reason)),
        (
            "body",
            object(vec![
                ("error", text(reason)),
                ("message", text(&message.into())),
            ]),
        ),
    ])
}
fn status(status: u16, allow: &str) -> Value {
    object(vec![
        ("status", Value::Number(status as f64)),
        ("headers", object(vec![("Allow", text(allow))])),
    ])
}
fn rpc(code: i32, message: &str) -> Value {
    object(vec![
        ("code", Value::Number(code as f64)),
        ("message", text(message)),
    ])
}
fn rpc_status(message: &str) -> Value {
    object(vec![
        ("status", Value::Number(400.0)),
        ("rpc", rpc(-32600, message)),
    ])
}
fn accepts(headers: &Value, expected: &str) -> bool {
    let Some(value) = headers.get("accept") else {
        return true;
    };
    let joined = match value {
        Value::String(s) => String::from_utf16_lossy(s),
        Value::Array(a) => a
            .iter()
            .filter_map(|v| string(Some(v)))
            .map(String::from_utf16_lossy)
            .collect::<Vec<_>>()
            .join(","),
        _ => return false,
    };
    joined
        .split(',')
        .map(|s| {
            s.split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_lowercase()
        })
        .any(|s| s == "*/*" || s == expected)
}
pub fn normalize_host(host: &[u16]) -> Vec<u16> {
    let normalized = String::from_utf16_lossy(trim_ecmascript(host)).to_lowercase();
    if normalized.starts_with('[')
        && let Some(end) = normalized.find(']').filter(|i| *i > 0)
    {
        return key(&normalized[1..end]);
    }
    if normalized.chars().filter(|c| *c == ':').count() > 1 {
        return key(&normalized);
    }
    key(normalized.split(':').next().unwrap_or_default())
}
#[derive(Debug)]
pub struct Policy {
    limits: HashMap<&'static str, f64>,
    origins: BTreeSet<Vec<u16>>,
    hosts: BTreeSet<Vec<u16>>,
    json_response: bool,
    trusted: bool,
}
impl Policy {
    pub fn new(options: &Value) -> Result<Self, String> {
        let mut limits = HashMap::new();
        for (name, minimum, default) in [
            ("maxRequestBytes", 1, None),
            ("maxBatchSize", 1, None),
            ("maxResponseBytes", 1, Some(16.0 * 1024.0 * 1024.0)),
            ("maxSessions", 1, Some(128.0)),
            ("maxSessionsPerSubject", 1, Some(16.0)),
            ("sessionTtlMs", 1, Some(900000.0)),
            ("maxStreamsPerSession", 1, Some(1.0)),
            ("maxStreamBufferBytes", 0, Some(1048576.0)),
            ("maxSseEventHistory", 0, Some(100.0)),
            ("sseKeepAliveMs", 0, Some(30000.0)),
            ("maxConcurrentToolCalls", 1, None),
        ] {
            let provided = options.get(name);
            let value = provided.map(|_| number(provided)).or(default);
            if let Some(n) = value {
                if !n.is_finite() || n.fract() != 0.0 || n < (minimum as f64) {
                    return Err(format!(
                        "{name} must be an integer greater than or equal to {minimum}."
                    ));
                }
                limits.insert(name, n);
            }
        }
        let strings = |name| match options.get(name) {
            Some(Value::Array(a)) => a
                .iter()
                .filter_map(|v| string(Some(v)).map(<[u16]>::to_vec))
                .collect::<BTreeSet<_>>(),
            _ => BTreeSet::new(),
        };
        let hosts = if options.get("allowedHosts").is_none() {
            ["localhost", "127.0.0.1", "::1"]
                .into_iter()
                .map(key)
                .collect()
        } else {
            strings("allowedHosts")
                .into_iter()
                .map(|s| normalize_host(&s))
                .collect()
        };
        Ok(Self {
            limits,
            origins: strings("allowedOrigins"),
            hosts,
            json_response: boolean(options.get("enableJsonResponse")),
            trusted: boolean(options.get("trustedProxy")),
        })
    }
    pub fn settings(&self) -> Value {
        let mut fields = self
            .limits
            .iter()
            .map(|(k, v)| (key(k), Value::Number(*v)))
            .collect::<Vec<_>>();
        fields.push((key("enableJsonResponse"), Value::Bool(self.json_response)));
        fields.push((key("trustedProxy"), Value::Bool(self.trusted)));
        Value::Object(fields)
    }
    pub fn call(&self, command: &str, input: &Value) -> Value {
        let empty = Value::Object(vec![]);
        let headers = input.get("headers").unwrap_or(&empty);
        match command {
            "http" => {
                let origin_plan = crate::auth::request_origin(
                    headers,
                    boolean(input.get("encrypted")),
                    self.trusted,
                );
                let host = string(origin_plan.get("host")).unwrap_or_default();
                let origin = first(headers.get("origin"));
                let allowed_origin = origin.is_some_and(|s| {
                    self.origins.contains(s) || string(input.get("endpointOrigin")) == Some(s)
                });
                let decision = if boolean(input.get("closed")) {
                    Some(rejection(
                        503,
                        "transport_closed",
                        "The transport is closed; create or use an active transport.",
                    ))
                } else if first(headers.get("host")).is_some_and(|s| !s.is_empty())
                    && !self.hosts.contains(&normalize_host(host))
                {
                    Some(rejection(
                        403,
                        "host_not_allowed",
                        format!(
                            "Host {} is not allowed; add it to allowedHosts.",
                            json::stringify(&Value::String(host.to_vec()))
                        ),
                    ))
                } else if let Some(origin) = origin.filter(|_| !allowed_origin) {
                    Some(rejection(
                        403,
                        "origin_not_allowed",
                        format!(
                            "Origin {} is not allowed; add it to allowedOrigins.",
                            json::stringify(&Value::String(origin.to_vec()))
                        ),
                    ))
                } else if is(headers.get("mcp-protocol-version"), "2026-07-28")
                    && !is(input.get("method"), "POST")
                    && !is(input.get("method"), "OPTIONS")
                {
                    Some(status(405, "POST, OPTIONS"))
                } else if !["POST", "GET", "DELETE", "OPTIONS"]
                    .iter()
                    .any(|s| is(input.get("method"), s))
                {
                    Some(status(405, "POST, GET, DELETE, OPTIONS"))
                } else {
                    None
                };
                let mut fields =
                    vec![("route", input.get("method").cloned().unwrap_or(Value::Null))];
                if let Some(rejection) = decision {
                    fields.push(("rejection", rejection))
                }
                for (field, name) in [
                    ("mcp-session-id", "sessionId"),
                    ("x-request-id", "requestId"),
                ] {
                    if let Some(s) = first(headers.get(field)).filter(|s| !s.is_empty()) {
                        fields.push((name, Value::String(s.to_vec())))
                    }
                }
                if allowed_origin {
                    fields.push(("origin", Value::String(origin.unwrap().to_vec())))
                }
                object(fields)
            }
            "post" => {
                let json = first(headers.get("content-type")).is_some_and(|s| {
                    String::from_utf16_lossy(s)
                        .split(';')
                        .next()
                        .unwrap_or_default()
                        .trim()
                        .eq_ignore_ascii_case("application/json")
                });
                if !json {
                    return object(vec![
                        ("status", Value::Number(415.0)),
                        ("rpc", rpc(-32600, "Invalid Request")),
                    ]);
                }
                let expected = if self.json_response {
                    "application/json"
                } else {
                    "text/event-stream"
                };
                if !accepts(headers, expected) {
                    return rejection(
                        406,
                        "response_type_not_acceptable",
                        format!("Accept must allow {expected}."),
                    );
                }
                Value::Null
            }
            "modern_detect" => {
                let modern=is(headers.get("mcp-protocol-version"),"2026-07-28")||input.get("messages").is_some_and(|messages|matches!(messages,Value::Array(a) if a.iter().any(|m|is(m.get("method"),"server/discover")||m.get("method").is_some()&&m.get("params").and_then(|p|p.get("_meta")).and_then(|m|m.get("io.modelcontextprotocol/protocolVersion")).is_some())));
                Value::Bool(modern)
            }
            "modern" => {
                let messages = match input.get("messages") {
                    Some(Value::Array(a)) => a,
                    _ => {
                        return rpc_status("Modern HTTP requires a single request or notification");
                    }
                };
                if boolean(input.get("isBatch"))
                    || messages.len() != 1
                    || messages[0].get("method").is_none()
                {
                    return rpc_status("Modern HTTP requires a single request or notification");
                }
                if !accepts(headers, "application/json") || !accepts(headers, "text/event-stream") {
                    return rejection(
                        406,
                        "response_type_not_acceptable",
                        "Accept must allow application/json and text/event-stream.",
                    );
                }
                if let Some(error) = crate::headers::validate_modern(headers, &messages[0]) {
                    return object(vec![
                        ("status", Value::Number(400.0)),
                        ("rpc", rpc(error.code, &error.message)),
                    ]);
                }
                Value::Null
            }
            "modern_id" => {
                if input.get("id").is_none()
                    && !string(input.get("method"))
                        .is_some_and(|s| s.starts_with(&key("notifications/")))
                {
                    rpc_status("A request ID is required")
                } else {
                    Value::Null
                }
            }
            "modern_status" => Value::Number(match number(input.get("code")) {
                -32601.0 => 404.0,
                n if [-32602.0, -32022.0, -32020.0, -32021.0].contains(&n) => 400.0,
                _ => 200.0,
            }),
            "session_initial" => {
                if !boolean(input.get("initialize")) {
                    return rejection(
                        400,
                        "session_id_required",
                        "Mcp-Session-Id is required; initialize a session first.",
                    );
                }
                if number(input.get("count")) >= self.limits["maxSessions"] {
                    return rejection(
                        503,
                        "session_limit_reached",
                        "The server has reached its session limit; close a session or retry later.",
                    );
                }
                if input.get("subject").is_some()
                    && number(input.get("subjectCount")) >= self.limits["maxSessionsPerSubject"]
                {
                    return rejection(
                        429,
                        "subject_session_limit_reached",
                        "The authenticated subject has reached its session limit; close a session or retry later.",
                    );
                }
                Value::Null
            }
            "expired" => Value::Bool(
                number(input.get("now")) - number(input.get("lastSeenAt"))
                    > self.limits["sessionTtlMs"],
            ),
            "protocol" => {
                if let Some(version) = string(input.get("version"))
                    && first(headers.get("mcp-protocol-version")).is_some_and(|s| s != version)
                {
                    return rejection(
                        400,
                        "protocol_version_mismatch",
                        format!(
                            "MCP-Protocol-Version must match the session protocol version {}.",
                            String::from_utf16_lossy(version)
                        ),
                    );
                }
                Value::Null
            }
            "message" => {
                let method =
                    String::from_utf16_lossy(string(input.get("method")).unwrap_or_default());
                if !boolean(input.get("stateful"))
                    && ["resources/subscribe", "resources/unsubscribe"].contains(&method.as_str())
                {
                    return rpc(-32601, "Method not found");
                }
                if boolean(input.get("stateful"))
                    && !boolean(input.get("initialized"))
                    && !["initialize", "notifications/initialized", "ping"]
                        .contains(&method.as_str())
                {
                    return rpc(-32600, "Session not initialized");
                }
                if method == "tools/call"
                    && self
                        .limits
                        .get("maxConcurrentToolCalls")
                        .is_some_and(|n| number(input.get("active")) >= *n)
                {
                    return rpc(-32000, "Too many concurrent tool calls");
                }
                Value::Null
            }
            "session_failure" => {
                if boolean(input.get("missing")) {
                    rejection(
                        400,
                        "session_id_required",
                        "Mcp-Session-Id is required; initialize a session first.",
                    )
                } else {
                    rejection(
                        404,
                        "session_not_found",
                        "Session was not found or has expired; reinitialize the session.",
                    )
                }
            }
            "active" => {
                if !boolean(input.get("exists")) {
                    text("missing")
                } else if number(input.get("now")) - number(input.get("lastSeenAt"))
                    > self.limits["sessionTtlMs"]
                {
                    text("expired")
                } else if input.get("subject").is_some()
                    && input.get("subject") != input.get("requestSubject")
                {
                    text("unauthorized")
                } else {
                    text("use")
                }
            }
            "session_update" => {
                if boolean(input.get("hasError")) {
                    return Value::Null;
                }
                if is(input.get("method"), "initialize") && boolean(input.get("request")) {
                    input
                        .get("result")
                        .and_then(|r| r.get("protocolVersion"))
                        .filter(|v| matches!(v, Value::String(_)))
                        .map_or(Value::Null, |v| {
                            object(vec![("protocolVersion", v.clone())])
                        })
                } else if is(input.get("method"), "notifications/initialized")
                    && input.get("version").is_some()
                {
                    object(vec![("initialized", Value::Bool(true))])
                } else {
                    Value::Null
                }
            }
            "stateless_initialize" => {
                let mut result = input.clone();
                if let Value::Object(fields) = &mut result
                    && let Some((_, Value::Object(capabilities))) = fields
                        .iter_mut()
                        .find(|(k, _)| k.iter().copied().eq("capabilities".encode_utf16()))
                {
                    for (name, capability) in capabilities {
                        if ["tools", "prompts", "resources"]
                            .iter()
                            .any(|s| name.iter().copied().eq(s.encode_utf16()))
                            && let Value::Object(fields) = capability
                        {
                            fields.retain(|(k, _)| {
                                !k.iter().copied().eq("listChanged".encode_utf16())
                                    && !(name.iter().copied().eq("resources".encode_utf16())
                                        && k.iter().copied().eq("subscribe".encode_utf16()))
                            });
                        }
                    }
                }
                result
            }
            "tool_ok" => Value::Bool(
                !boolean(input.get("hasError"))
                    && !boolean(input.get("result").and_then(|r| r.get("isError"))),
            ),
            "get" => {
                if !boolean(input.get("stateful")) {
                    status(405, "POST, GET, DELETE, OPTIONS")
                } else if !accepts(headers, "text/event-stream") {
                    rejection(
                        406,
                        "response_type_not_acceptable",
                        "Accept must allow text/event-stream.",
                    )
                } else {
                    Value::Null
                }
            }
            "stream" => {
                if number(input.get("count")) >= self.limits["maxStreamsPerSession"] {
                    rejection(
                        409,
                        "stream_limit_reached",
                        "This session already has the maximum number of streams; close a stream and retry.",
                    )
                } else {
                    Value::Null
                }
            }
            "write" => {
                if number(input.get("bytes")) > self.limits["maxResponseBytes"] {
                    text("destroy")
                } else if number(input.get("buffered")) > self.limits["maxStreamBufferBytes"] {
                    text("end")
                } else {
                    text("write")
                }
            }
            "options" => {
                if first(headers.get("access-control-request-method")).is_some_and(|s| {
                    !["POST", "GET", "DELETE", "OPTIONS"]
                        .iter()
                        .any(|m| s.iter().copied().eq(m.encode_utf16()))
                }) {
                    return status(405, "POST, GET, DELETE, OPTIONS");
                }
                let allowed = match headers.get("access-control-request-headers") {
                    Some(Value::Array(a)) => text(
                        &a.iter()
                            .filter_map(|v| string(Some(v)))
                            .map(String::from_utf16_lossy)
                            .collect::<Vec<_>>()
                            .join(", "),
                    ),
                    Some(v) => v.clone(),
                    None => text(
                        "Accept, Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
                    ),
                };
                object(vec![
                    ("status", Value::Number(204.0)),
                    (
                        "headers",
                        object(vec![
                            ("Allow", text("POST, GET, DELETE, OPTIONS")),
                            (
                                "Access-Control-Allow-Methods",
                                text("POST, GET, DELETE, OPTIONS"),
                            ),
                            ("Access-Control-Allow-Headers", allowed),
                            ("Access-Control-Max-Age", text("600")),
                        ]),
                    ),
                ])
            }
            _ => Value::Null,
        }
    }
}
pub fn normalize_path(path: &[u16], express: bool) -> Result<Vec<u16>, &'static str> {
    if path.is_empty() || path == [47] {
        return Ok(key(if express { "/" } else { "/mcp" }));
    }
    if path.contains(&63) || path.contains(&35) {
        return Err("path must not include a query or fragment");
    }
    // Express preserves a trailing slash when it first adds the missing leading slash.
    let mut out = vec![];
    if !path.starts_with(&[47]) {
        out.push(47)
    }
    out.extend(path);
    if (!express || path.starts_with(&[47])) && out.len() > 1 && out.last() == Some(&47) {
        out.pop();
    }
    Ok(out)
}
