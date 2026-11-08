//! CLI configuration policy independent of Node argument, URL and signal primitives.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};

struct NumericOption {
    flag: &'static str,
    field: &'static str,
    minimum: u8,
    listener: bool,
}
const NUMBERS: &[NumericOption] = &[
    NumericOption {
        flag: "max-request-bytes",
        field: "maxRequestBytes",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-batch-size",
        field: "maxBatchSize",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-response-bytes",
        field: "maxResponseBytes",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-sessions",
        field: "maxSessions",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-sessions-per-subject",
        field: "maxSessionsPerSubject",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "session-ttl-ms",
        field: "sessionTtlMs",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-streams-per-session",
        field: "maxStreamsPerSession",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-stream-buffer-bytes",
        field: "maxStreamBufferBytes",
        minimum: 0,
        listener: false,
    },
    NumericOption {
        flag: "max-sse-event-history",
        field: "maxSseEventHistory",
        minimum: 0,
        listener: false,
    },
    NumericOption {
        flag: "sse-keep-alive-ms",
        field: "sseKeepAliveMs",
        minimum: 0,
        listener: false,
    },
    NumericOption {
        flag: "max-concurrent-tool-calls",
        field: "maxConcurrentToolCalls",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "max-queued-tool-calls",
        field: "maxQueuedToolCalls",
        minimum: 0,
        listener: false,
    },
    NumericOption {
        flag: "max-active-requests",
        field: "maxActiveRequests",
        minimum: 1,
        listener: false,
    },
    NumericOption {
        flag: "request-timeout-ms",
        field: "requestTimeoutMs",
        minimum: 0,
        listener: true,
    },
    NumericOption {
        flag: "headers-timeout-ms",
        field: "headersTimeoutMs",
        minimum: 0,
        listener: true,
    },
    NumericOption {
        flag: "keep-alive-timeout-ms",
        field: "keepAliveTimeoutMs",
        minimum: 0,
        listener: true,
    },
    NumericOption {
        flag: "shutdown-grace-ms",
        field: "shutdownGraceMs",
        minimum: 0,
        listener: false,
    },
];
fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn record(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
fn string(value: Option<&Value>) -> Option<&[u16]> {
    if let Some(Value::String(value)) = value {
        Some(value)
    } else {
        None
    }
}
fn definition(kind: &str, multiple: bool) -> Value {
    let mut fields = vec![("type", text(kind))];
    if multiple {
        fields.push(("multiple", Value::Bool(true)));
    }
    record(fields)
}
pub fn spec() -> Value {
    let mut options = vec![];
    for flag in ["port", "hostname", "path"] {
        options.push((flag, definition("string", false)));
    }
    for flag in ["stateless", "json-response"] {
        options.push((flag, definition("boolean", false)));
    }
    for flag in ["allowed-host", "allowed-origin"] {
        options.push((flag, definition("string", true)));
    }
    for option in NUMBERS {
        options.push((option.flag, definition("string", false)));
    }
    options.push(("trusted-proxy", definition("boolean", false)));
    for flag in [
        "oauth-resource",
        "oauth-verifier-module",
        "oauth-verifier-export",
    ] {
        options.push((flag, definition("string", false)));
    }
    for flag in [
        "oauth-authorization-server",
        "oauth-supported-scope",
        "oauth-required-scope",
        "oauth-bearer-method",
    ] {
        options.push((flag, definition("string", true)));
    }
    options.push((
        "help",
        record(vec![("type", text("boolean")), ("short", text("h"))]),
    ));
    options.push(("version", definition("boolean", false)));
    let mut server_fields = vec![text("allowedHosts"), text("allowedOrigins")];
    server_fields.extend(
        NUMBERS
            .iter()
            .filter(|o| !o.listener && o.field != "shutdownGraceMs")
            .map(|o| text(o.field)),
    );
    record(vec![
        ("options", record(options)),
        ("serverFields", Value::Array(server_fields)),
        (
            "listenerFields",
            Value::Array(
                NUMBERS
                    .iter()
                    .filter(|o| o.listener)
                    .map(|o| text(o.field))
                    .collect(),
            ),
        ),
    ])
}
fn decimal(value: &[u16], flag: &str) -> Result<f64, String> {
    let value = trim_ecmascript(value);
    if value.is_empty() || value.iter().any(|u| !(48..=57).contains(u)) {
        return Err(format!("--{flag} must be an integer."));
    }
    let value = value.iter().map(|u| *u as u8 as char).collect::<String>();
    Ok(value.parse::<f64>().unwrap_or(f64::INFINITY))
}
pub fn numeric_plan(values: &Value) -> Result<Value, String> {
    let mut fields = vec![];
    for option in NUMBERS {
        if let Some(value) = string(values.get(option.flag)) {
            let number = decimal(value, option.flag)?;
            if !number.is_finite() || number.fract() != 0.0 || number < f64::from(option.minimum) {
                return Err(format!(
                    "--{} must be an integer greater than or equal to {}.",
                    option.flag, option.minimum
                ));
            }
            fields.push((option.field, Value::Number(number)));
        }
    }
    if values.get("shutdown-grace-ms").is_none() {
        fields.push(("shutdownGraceMs", Value::Number(10000.0)));
    }
    let port = if let Some(value) = string(values.get("port")) {
        let number = decimal(value, "port")?;
        if !number.is_finite() || number.fract() != 0.0 || !(0.0..=65535.0).contains(&number) {
            return Err("--port must be an integer between 0 and 65535.".into());
        }
        number
    } else {
        3000.0
    };
    fields.push(("port", Value::Number(port)));
    Ok(record(fields))
}
pub fn oauth_plan(values: &Value) -> Result<Option<Value>, String> {
    let Some(resource) = string(values.get("oauth-resource")) else {
        if [
            "oauth-resource",
            "oauth-authorization-server",
            "oauth-supported-scope",
            "oauth-required-scope",
            "oauth-bearer-method",
            "oauth-verifier-module",
            "oauth-verifier-export",
        ]
        .iter()
        .any(|key| values.get(key).is_some())
        {
            return Err("--oauth-resource is required when configuring OAuth.".into());
        }
        return Ok(None);
    };
    let servers=values.get("oauth-authorization-server").filter(|v|matches!(v,Value::Array(a) if !a.is_empty())).ok_or("--oauth-authorization-server must be provided at least once when --oauth-resource is set.")?;
    let module = string(values.get("oauth-verifier-module"))
        .filter(|v| !v.is_empty())
        .ok_or("--oauth-verifier-module is required when --oauth-resource is set.")?;
    let mut lists = vec![];
    for (flag, field) in [
        ("oauth-supported-scope", "scopesSupported"),
        ("oauth-required-scope", "requiredScopes"),
        ("oauth-bearer-method", "bearerMethodsSupported"),
    ] {
        if let Some(Value::Array(items)) = values
            .get(flag)
            .filter(|v| matches!(v,Value::Array(a) if !a.is_empty()))
        {
            let items = items
                .iter()
                .map(|value| {
                    let Some(value) = string(Some(value)) else {
                        return Err(format!("--{flag} must be provided as a string."));
                    };
                    let value = trim_ecmascript(value);
                    if value.is_empty() {
                        return Err(format!("--{flag} must not be blank."));
                    }
                    Ok(Value::String(value.to_vec()))
                })
                .collect::<Result<Vec<_>, String>>()?;
            lists.push((field, Value::Array(items)));
        }
    }
    let export = string(values.get("oauth-verifier-export"))
        .filter(|v| !v.is_empty())
        .map(|v| Value::String(v.to_vec()))
        .unwrap_or_else(|| text("default"));
    let mut fields = vec![
        ("resource", Value::String(resource.to_vec())),
        ("authorizationServers", servers.clone()),
        ("verifierModule", Value::String(module.to_vec())),
        ("verifierExport", export),
    ];
    fields.extend(lists);
    Ok(Some(record(fields)))
}
pub fn help(command: &[u16]) -> Vec<u16> {
    let mut text = "Usage: ".encode_utf16().collect::<Vec<_>>();
    text.extend(command);
    text.extend(" [options]\n\n".encode_utf16());
    text.extend(
        include_str!("cli-help.txt")
            .trim_end_matches('\n')
            .encode_utf16(),
    );
    text
}
pub fn module_kind(path: &[u16]) -> &'static str {
    if path.starts_with(&"file:".encode_utf16().collect::<Vec<_>>()) {
        return "file";
    }
    let windows = path.len() >= 3
        && matches!(path[0],65..=90|97..=122)
        && path[1] == 58
        && matches!(path[2], 47 | 92);
    if path.starts_with(&[46]) || path.starts_with(&[47]) || windows {
        "path"
    } else {
        "bare"
    }
}
#[derive(Debug, PartialEq, Eq)]
pub enum SignalAction {
    Start,
    Force,
    Ignore,
}
#[derive(Default)]
pub struct Shutdown {
    started: bool,
    settled: bool,
}
impl Shutdown {
    pub fn signal(&mut self) -> SignalAction {
        if self.settled {
            SignalAction::Ignore
        } else if self.started {
            SignalAction::Force
        } else {
            self.started = true;
            SignalAction::Start
        }
    }
    pub fn settle(&mut self) -> bool {
        if self.settled {
            false
        } else {
            self.settled = true;
            true
        }
    }
    pub fn is_settled(&self) -> bool {
        self.settled
    }
}
