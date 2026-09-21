//! Host-independent OAuth token validation and wire forms.
use mcp_protocol_rust::json::{self, Limits, Value};

const INVALID_EXPIRY: &str = "OAuth token response has invalid expires_in";
fn property(key: &str, value: Value) -> (Vec<u16>, Value) {
    (key.encode_utf16().collect(), value)
}
pub(crate) fn whitespace(unit: u16) -> bool {
    matches!(unit, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn trimmed(value: Option<&Value>) -> Option<Vec<u16>> {
    let Value::String(text) = value? else {
        return None;
    };
    let start = text.iter().position(|unit| !whitespace(*unit))?;
    let end = text.iter().rposition(|unit| !whitespace(*unit))? + 1;
    Some(text[start..end].to_vec())
}
#[derive(Debug)]
pub struct TokenFields {
    access: Vec<u16>,
    refresh: Option<Vec<u16>>,
    scope: Option<Value>,
    expires: Option<f64>,
}
impl TokenFields {
    pub fn parse(payload: &Value) -> Result<Self, &'static str> {
        let access = trimmed(payload.get("access_token"))
            .ok_or("OAuth token response missing access_token")?;
        let bearer = match payload.get("token_type") {
            Some(Value::String(text)) => {
                text.len() == 6
                    && text.iter().zip(b"bearer").all(|(unit, byte)| {
                        *unit == u16::from(*byte) || *unit == u16::from(byte.to_ascii_uppercase())
                    })
            }
            _ => false,
        };
        if !bearer {
            return Err("OAuth token response missing token_type=Bearer");
        }
        let expires = match payload.get("expires_in") {
            None => None,
            Some(Value::Number(number))
                if number.is_finite() && number.fract() == 0.0 && *number >= 0.0 =>
            {
                Some(*number)
            }
            _ => return Err(INVALID_EXPIRY),
        };
        Ok(Self {
            access,
            refresh: trimmed(payload.get("refresh_token")),
            scope: payload.get("scope").cloned(),
            expires,
        })
    }
    pub fn needs_clock(&self) -> bool {
        self.expires.is_some()
    }
    pub fn complete(&self, now: Option<f64>) -> Result<Value, &'static str> {
        let expires_at = match self.expires {
            None => Value::Null,
            Some(seconds) => {
                let date = now.ok_or(INVALID_EXPIRY)? + seconds * 1000.0;
                if !date.is_finite() || date.fract() != 0.0 || date.abs() > 8_640_000_000_000_000.0
                {
                    return Err(INVALID_EXPIRY);
                }
                Value::Number(date)
            }
        };
        let mut fields = vec![
            property("accessToken", Value::String(self.access.clone())),
            property(
                "tokenType",
                Value::String("Bearer".encode_utf16().collect()),
            ),
            property("expiresAt", expires_at),
        ];
        if let Some(refresh) = &self.refresh {
            fields.push(property("refreshToken", Value::String(refresh.clone())));
        }
        let scope = crate::scope::normalize(self.scope.as_ref())?;
        if self.scope.is_some() && scope.is_none() {
            return Err("Invalid OAuth scope syntax in token response");
        }
        if let Some(scope) = scope {
            fields.push(property("scope", Value::String(scope)));
        }
        Ok(Value::Object(fields))
    }
}
pub fn is_retryable(error: &[u16], status: f64) -> bool {
    status >= 500.0
        || error.iter().copied().eq("server_error".encode_utf16())
        || error
            .iter()
            .copied()
            .eq("temporarily_unavailable".encode_utf16())
}
#[derive(Debug)]
pub enum ResponseError {
    InvalidObject,
    OAuth(Value),
}
pub fn read_json_response(text: &[u16], ok: bool, status: f64) -> Result<Value, ResponseError> {
    let payload = json::parse_utf16(text, Limits::default())
        .ok()
        .filter(|value| matches!(value, Value::Object(_)));
    if ok {
        return payload.ok_or(ResponseError::InvalidObject);
    }
    let fallback = if status == 503.0 {
        "temporarily_unavailable"
    } else {
        "server_error"
    };
    let mut fields = vec![];
    for key in ["error", "error_description", "error_uri"] {
        if let Some(Value::String(text)) = payload.as_ref().and_then(|value| value.get(key)) {
            fields.push(property(key, Value::String(text.clone())));
        } else if key == "error" {
            fields.push(property(
                key,
                Value::String(fallback.encode_utf16().collect()),
            ));
        }
    }
    Err(ResponseError::OAuth(Value::Object(fields)))
}
/// application/x-www-form-urlencoded uses USVString replacement before UTF-8.
pub fn encode_form(pairs: &[(Vec<u16>, Vec<u16>)]) -> String {
    fn encode(text: &[u16], output: &mut String) {
        const HEX: &[u8] = b"0123456789ABCDEF";
        for point in char::decode_utf16(text.iter().copied()) {
            let point = point.unwrap_or(char::REPLACEMENT_CHARACTER);
            let mut bytes = [0; 4];
            for byte in point.encode_utf8(&mut bytes).bytes() {
                match byte {
                    b' ' => output.push('+'),
                    b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                        output.push(char::from(byte))
                    }
                    _ => {
                        output.push('%');
                        output.push(char::from(HEX[usize::from(byte >> 4)]));
                        output.push(char::from(HEX[usize::from(byte & 15)]));
                    }
                }
            }
        }
    }
    let mut output = String::new();
    for (index, (key, value)) in pairs.iter().enumerate() {
        if index != 0 {
            output.push('&');
        }
        encode(key, &mut output);
        output.push('=');
        encode(value, &mut output);
    }
    output
}
