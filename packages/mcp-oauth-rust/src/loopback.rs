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
}
impl CallbackError {
    fn plain(message: &str) -> Self {
        Self {
            message: message.encode_utf16().collect(),
            response: message.encode_utf16().collect(),
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
            let mut response: Vec<u16> = "Authorization failed: ".encode_utf16().collect();
            response.extend(description);
            return Err(CallbackError { message, response });
        }
        callback
            .code
            .as_ref()
            .filter(|code| !code.is_empty())
            .cloned()
            .ok_or_else(|| CallbackError::plain("OAuth callback missing authorization code"))
    }
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
