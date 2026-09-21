//! Portable OAuth-protected MCP fixture policies. Hosts supply canonical URL facts
//! and listener results; Rust owns configuration, retries, admission and cleanup.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn obj(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn field<'a>(v: &'a Value, k: &str) -> &'a Value {
    v.get(k).unwrap_or(&Value::Null)
}
fn text(v: &Value) -> &[u16] {
    if let Value::String(v) = v { v } else { &[] }
}
fn string(v: &Value) -> String {
    String::from_utf16_lossy(text(v))
}
fn number(v: &Value) -> f64 {
    if let Value::Number(n) = v {
        *n
    } else {
        f64::NAN
    }
}
fn missing(v: &Value, k: &str) -> bool {
    v.get(k).is_none_or(|v| matches!(v, Value::Null))
}
#[derive(Debug)]
pub struct Error {
    pub message: String,
    pub type_error: bool,
}
impl Error {
    fn plain(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            type_error: false,
        }
    }
    pub fn value(&self) -> Value {
        obj(vec![
            ("message", s(&self.message)),
            (
                "name",
                s(if self.type_error {
                    "TypeError"
                } else {
                    "Error"
                }),
            ),
        ])
    }
}
fn numeric_text(value: &Value) -> String {
    if let Some(v) = value.get("nativeNonFinite") {
        string(v)
    } else {
        number(value).to_string()
    }
}
fn ttl(v: &Value) -> Result<Value, Error> {
    let n = if missing(v, "ttlSeconds") {
        60.0
    } else {
        number(field(v, "ttlSeconds"))
    };
    if !n.is_finite() || n.fract() != 0.0 || n <= 0.0 {
        return Err(Error {
            message: format!(
                "ttlSeconds must be a positive integer, received {}",
                numeric_text(field(v, "ttlSeconds"))
            ),
            type_error: true,
        });
    }
    Ok(Value::Number(n))
}
fn port(v: &Value) -> Result<f64, Error> {
    let n = if missing(v, "port") {
        0.0
    } else {
        number(field(v, "port"))
    };
    if !n.is_finite() || n.fract() != 0.0 || !(0.0..=65535.0).contains(&n) {
        return Err(Error::plain("port must be an integer between 0 and 65535"));
    }
    Ok(n)
}
fn path(value: &Value) -> Result<Value, Error> {
    let raw = text(value);
    if raw.is_empty() {
        return Ok(s("/mcp"));
    }
    if raw.contains(&63) || raw.contains(&35) {
        return Err(Error::plain("mcpPath must not include a query or fragment"));
    }
    let mut result = Vec::with_capacity(raw.len() + 1);
    if raw[0] != 47 {
        result.push(47);
    }
    result.extend(raw);
    if result.len() > 1 && result.last() == Some(&47) {
        result.pop();
    }
    Ok(Value::String(result))
}
fn scopes(value: &Value) -> Result<Value, Error> {
    let values = if matches!(value, Value::Null) {
        vec![s("mcp.read")]
    } else if let Value::Array(v) = value {
        v.clone()
    } else {
        return Err(Error::plain("scopes must contain non-empty values"));
    };
    if values.iter().any(|v| trim_ecmascript(text(v)).is_empty()) {
        return Err(Error::plain("scopes must contain non-empty values"));
    }
    if values
        .iter()
        .any(|v| trim_ecmascript(text(v)) != text(v) || text(v).contains(&32))
    {
        return Err(Error::plain("scope entries must not contain spaces"));
    }
    Ok(Value::Array(values))
}
fn url(value: &Value, label: &str) -> Result<(), Error> {
    if value.get("href").is_none() {
        return Err(Error::plain(format!("{label} must be an absolute URL")));
    }
    Ok(())
}
pub fn options(v: &Value) -> Result<Value, Error> {
    let path = path(field(v, "mcpPath"))?;
    let scopes = scopes(field(v, "scopes"))?;
    let ttl = ttl(v)?;
    let mut out = vec![
        ("mcpPath", path),
        ("scopes", scopes),
        ("ttlSeconds", ttl),
        (
            "autoApprove",
            if missing(v, "autoApprove") {
                Value::Bool(false)
            } else {
                field(v, "autoApprove").clone()
            },
        ),
    ];
    if v.get("issuer").is_some() {
        let info = field(v, "issuerInfo");
        url(info, "issuer")?;
        if string(field(info, "protocol")) != "http:" {
            return Err(Error::plain(
                "issuer must use http: because the embedded servers do not terminate TLS",
            ));
        }
        if matches!(string(field(info, "pathname")).as_str(), "" | "/") {
            return Err(Error::plain(
                "issuer must include a non-root path such as /oauth so OAuth metadata discovery stays unambiguous",
            ));
        }
        if !text(field(info, "search")).is_empty() || !text(field(info, "hash")).is_empty() {
            return Err(Error::plain("issuer must not include a query or fragment"));
        }
        out.push(("issuer", field(info, "href").clone()));
    }
    if v.get("resource").is_some() {
        let info = field(v, "resourceInfo");
        url(info, "resource")?;
        if !text(field(info, "hash")).is_empty() {
            return Err(Error::plain("resource must not include a fragment"));
        }
        out.push(("resource", field(info, "href").clone()));
    }
    Ok(obj(out))
}
#[derive(Default)]
pub struct Fixture {
    pending: bool,
    active: Option<u64>,
    generation: u64,
}
impl Fixture {
    pub fn call(&mut self, command: &str, v: Value) -> Result<Value, Error> {
        match command {
            "start" => {
                if self.pending || self.active.is_some() {
                    return Err(Error::plain("MCP OAuth test server is already listening"));
                }
                let n = port(&v)?;
                self.pending = true;
                Ok(Value::Number(n))
            }
            "failed" => {
                self.pending = false;
                Ok(Value::Null)
            }
            "bound" => {
                self.pending = false;
                self.generation = self
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| Error::plain("listener generation exhausted"))?;
                self.active = Some(self.generation);
                Ok(Value::Number(self.generation as f64))
            }
            "close_needed" => Ok(Value::Bool(
                self.active.is_some_and(|n| n as f64 == number(&v)),
            )),
            "closed" => {
                if self.active.is_some_and(|n| n as f64 == number(&v)) {
                    self.active = None;
                }
                Ok(Value::Null)
            }
            "retry" => Ok(Value::Bool(
                number(field(&v, "port")) == 0.0
                    && number(field(&v, "attempt")) < 9.0
                    && string(field(&v, "ownCode")) == "EADDRINUSE",
            )),
            "ports" => {
                let same = field(&v, "sameHost") == &Value::Bool(true)
                    && number(field(&v, "port")) == number(field(&v, "oauthPort"));
                if same
                    && number(field(&v, "port")) != 0.0
                    && field(&v, "reserved") != &Value::Bool(true)
                {
                    return Err(Error::plain(
                        "issuer must not use the same hostname and port as the MCP listener because this fixture runs them on separate HTTP listeners",
                    ));
                }
                Ok(Value::Bool(!same && number(field(&v, "port")) != 0.0))
            }
            "first_rejection" => {
                let Value::Array(results) = v else {
                    return Err(Error::plain("invalid cleanup results"));
                };
                Ok(results
                    .iter()
                    .position(|r| string(field(r, "status")) == "rejected")
                    .map_or(Value::Null, |i| Value::Number(i as f64)))
            }
            "revoked" => {
                if v == Value::Bool(true) {
                    Err(Error::plain("token revoked"))
                } else {
                    Ok(Value::Null)
                }
            }
            "cli_options" => cli_options(&v),
            "cli_help" => Ok(s(&cli_help(&string(field(&v, "name"))))),
            "cli_startup" => Ok(s(&format!(
                "{} {}\nMCP URL: {}\nPRM URL: {}\nAS issuer: {}\nResource: {}\n",
                string(field(&v, "name")),
                string(field(&v, "version")),
                string(field(&v, "mcpUrl")),
                string(field(&v, "prmUrl")),
                string(field(&v, "issuer")),
                string(field(&v, "resource"))
            ))),
            _ => Err(Error::plain("unknown fixture command")),
        }
    }
}
fn decimal(v: &Value, key: &str, default: f64, positive: bool) -> Result<Value, Error> {
    if v.get(key).is_none() {
        return Ok(Value::Number(default));
    }
    let raw = text(field(v, key));
    let n = string(field(v, key)).parse::<f64>().unwrap_or(f64::NAN);
    if raw.is_empty()
        || raw.iter().any(|c| !(48..=57).contains(c))
        || !n.is_finite()
        || n.fract() != 0.0
        || (positive && n <= 0.0)
        || (!positive && n > 65535.0)
    {
        return Err(Error::plain(if positive {
            format!("--{key} must be a positive integer.")
        } else {
            format!("--{key} must be an integer between 0 and 65535.")
        }));
    }
    Ok(Value::Number(n))
}
fn cli_options(v: &Value) -> Result<Value, Error> {
    let values = field(v, "values");
    let port = decimal(values, "port", 0.0, false)?;
    let mut out = vec![
        ("help", field(values, "help") == &Value::Bool(true)),
        (
            "autoApprove",
            field(values, "auto-approve") == &Value::Bool(true),
        ),
        (
            "printTestToken",
            field(values, "print-test-token") == &Value::Bool(true),
        ),
    ]
    .into_iter()
    .map(|(k, v)| (k, Value::Bool(v)))
    .collect::<Vec<_>>();
    out.push(("port", port));
    out.push((
        "hostname",
        if values.get("hostname").is_none() {
            s("127.0.0.1")
        } else {
            field(values, "hostname").clone()
        },
    ));
    if let Some(path) = values.get("mcp-path") {
        out.push(("mcpPath", path.clone()));
    }
    if values.get("issuer").is_some() {
        let info = field(v, "issuerInfo");
        url(info, "--issuer").map_err(|_| Error::plain("--issuer must be an absolute URL."))?;
        if string(field(info, "protocol")) != "http:" {
            return Err(Error::plain(
                "--issuer must use http: because the embedded authorization server does not terminate TLS.",
            ));
        }
        if string(field(info, "pathname")) == "/" {
            return Err(Error::plain(
                "--issuer must include a non-root path such as /oauth so OAuth discovery stays unambiguous.",
            ));
        }
        out.push(("issuer", field(info, "href").clone()));
    }
    if values.get("resource").is_some() {
        let info = field(v, "resourceInfo");
        url(info, "--resource").map_err(|_| Error::plain("--resource must be an absolute URL."))?;
        out.push(("resource", field(info, "href").clone()));
    }
    out.push(("ttlSeconds", decimal(values, "ttl-seconds", 60.0, true)?));
    if let Some(value) = values.get("scopes") {
        let entries = text(value)
            .split(|c| *c == 44)
            .map(trim_ecmascript)
            .map(|v| Value::String(v.to_vec()))
            .collect::<Vec<_>>();
        if entries.iter().any(|v| text(v).is_empty()) {
            return Err(Error::plain("--scopes must not contain empty entries."));
        }
        out.push(("scopes", Value::Array(entries)));
    }
    Ok(obj(out))
}
fn cli_help(name: &str) -> String {
    [format!("Usage: {name} [options]"),"".into(),"Options:".into(),
 "  --port <port>               Port to listen on for the MCP endpoint (default: 0, ephemeral)".into(),
 "  --hostname <hostname>       Hostname to bind to (default: 127.0.0.1)".into(),
 "  --mcp-path <path>           MCP endpoint path (default: /mcp)".into(),
 "  --issuer <url>              HTTP issuer URL for the embedded authorization server".into(),
 "  --resource <url>            Canonical protected resource URI (default: MCP URL)".into(),
 "  --ttl-seconds <seconds>     Access token TTL in seconds (default: 60)".into(),
 "  --auto-approve              Auto-approve every OAuth authorization request".into(),
 "  --scopes <scope1,scope2>    Comma-separated scopes to publish and require".into(),
 "  --print-test-token          Print a sample bearer token for the configured resource".into(),
 "  -h, --help                  Show this help message".into()].join("\n")
}
