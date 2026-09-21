//! Browser callback policy; hosts supply URL parsing and HTTP I/O.
use crate::state::parse_authorization_state;
use crate::tokens::whitespace;
#[derive(Default)]
pub struct CallbackParameters {
    pub code: Option<Vec<u16>>,
    pub error: Option<Vec<u16>>,
    pub error_description: Option<Vec<u16>>,
    pub state: Option<Vec<u16>>,
    pub issuer: Option<Vec<u16>>,
}
pub struct CallbackBinding {
    state: Option<Vec<u16>>,
    issuer: Option<Vec<u16>>,
    require_issuer: bool,
}
#[derive(Debug)]
pub struct CallbackError {
    pub message: Vec<u16>,
    pub response: Vec<u16>,
    pub denial: Option<(Vec<u16>, Vec<u16>)>,
}
impl CallbackError {
    fn plain(message: &str) -> Self {
        Self {
            message: message.encode_utf16().collect(),
            response: message.encode_utf16().collect(),
            denial: None,
        }
    }
}
impl CallbackBinding {
    pub fn new(state: Option<Vec<u16>>) -> Self {
        let parsed = parse_authorization_state(state.as_deref());
        let require_issuer = parsed.as_ref().is_some_and(|parsed| parsed.require_issuer);
        Self {
            state,
            issuer: parsed.map(|parsed| parsed.issuer),
            require_issuer,
        }
    }
    pub fn resolve(&self, callback: &CallbackParameters) -> Result<Vec<u16>, CallbackError> {
        if let Some(expected) = &self.state {
            if callback.state.as_ref().is_none_or(Vec::is_empty) {
                return Err(CallbackError::plain("OAuth callback missing state"));
            }
            if callback.state.as_ref() != Some(expected) {
                return Err(CallbackError::plain("OAuth callback state mismatch"));
            }
        }
        if self.require_issuer && callback.issuer.as_ref().is_none_or(Vec::is_empty) {
            return Err(CallbackError::plain("OAuth callback missing issuer"));
        }
        if let (Some(actual), Some(expected)) = (&callback.issuer, &self.issuer)
            && !actual.is_empty()
            && actual != expected
        {
            return Err(CallbackError::plain("OAuth callback issuer mismatch"));
        }
        if let Some(error) = &callback.error {
            let description = callback.error_description.as_ref().unwrap_or(error);
            let mut message: Vec<u16> = "OAuth authorization failed: ".encode_utf16().collect();
            message.extend(error);
            message.extend(" — ".encode_utf16());
            message.extend(description);
            let response = message.clone();
            return Err(CallbackError {
                message,
                response,
                denial: Some((error.clone(), description.clone())),
            });
        }
        callback
            .code
            .as_ref()
            .filter(|code| !code.is_empty())
            .cloned()
            .ok_or_else(|| CallbackError::plain("OAuth callback missing authorization code"))
    }
}
pub const CALLBACK_PARAMETERS: &[&str] = &[
    "code",
    "state",
    "iss",
    "error",
    "error_description",
    "error_uri",
];
pub fn duplicate_parameter(counts: &[u32]) -> Option<&'static str> {
    CALLBACK_PARAMETERS
        .iter()
        .zip(counts)
        .find_map(|(name, count)| (*count > 1).then_some(*name))
}
pub fn normalize_input(input: &[u16]) -> Vec<u16> {
    let cleaned: Vec<u16> = input
        .iter()
        .copied()
        .filter(|unit| !matches!(unit, 10 | 13))
        .collect();
    let Some(start) = cleaned.iter().position(|unit| !whitespace(*unit)) else {
        return vec![];
    };
    let end = cleaned.iter().rposition(|unit| !whitespace(*unit)).unwrap() + 1;
    cleaned[start..end].to_vec()
}
pub fn build_success_page(title: Option<&[u16]>, body: Option<&[u16]>) -> Vec<u16> {
    fn escaped(text: &[u16], output: &mut Vec<u16>) {
        for unit in text {
            let entity = match unit {
                38 => Some("&amp;"),
                60 => Some("&lt;"),
                62 => Some("&gt;"),
                34 => Some("&quot;"),
                _ => None,
            };
            if let Some(entity) = entity {
                output.extend(entity.encode_utf16());
            } else {
                output.push(*unit);
            }
        }
    }
    let default_title: Vec<u16> = "Connected".encode_utf16().collect();
    let default_body: Vec<u16> = "You can close this tab and return to your terminal."
        .encode_utf16()
        .collect();
    let title = title.unwrap_or(&default_title);
    let body = body.unwrap_or(&default_body);
    let mut output: Vec<u16> = "<!DOCTYPE html><html><head><meta charset=utf-8><title>"
        .encode_utf16()
        .collect();
    escaped(title, &mut output);
    output.extend("</title></head><body style=\"font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\"><div style=\"text-align:center\"><h1>".encode_utf16());
    escaped(title, &mut output);
    output.extend("</h1><p style=\"color:#666\">".encode_utf16());
    escaped(body, &mut output);
    output.extend("</p></div></body></html>".encode_utf16());
    output
}

#[derive(Default)]
pub struct Lifecycle {
    used: bool,
    closed: bool,
}
impl Lifecycle {
    pub fn begin(&mut self) -> bool {
        if self.used || self.closed {
            return false;
        }
        self.used = true;
        true
    }
    pub fn close(&mut self) -> bool {
        if self.closed {
            return false;
        }
        self.closed = true;
        true
    }
}
pub fn valid_timer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && (1.0..=2_147_483_647.0).contains(&value)
}
pub fn valid_target(value: &mcp_protocol_rust::json::Value, fixed: bool) -> bool {
    use mcp_protocol_rust::json::Value;
    let equals = |key: &str, expected: &str| matches!(value.get(key),Some(Value::String(actual))if actual==&expected.encode_utf16().collect::<Vec<_>>());
    let flag = |key: &str| value.get(key) == Some(&Value::Bool(true));
    if fixed {
        equals("protocol", "http:")
            && ["localhost", "127.0.0.1", "[::1]"]
                .iter()
                .any(|host| equals("hostname", host))
            && !flag("credentials")
            && !flag("fragment")
            && !equals("port", "0")
            && !flag("forbiddenQuery")
            && !flag("controls")
            && flag("pathMatches")
    } else {
        flag("startsSlash")
            && equals("origin", "http://127.0.0.1")
            && flag("pathMatches")
            && !flag("query")
            && !flag("fragment")
    }
}
