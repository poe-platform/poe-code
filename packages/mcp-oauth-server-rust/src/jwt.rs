//! Compact JWS decoding and JWT claim policy. Hosts verify signatures before claims.
use crate::server::Error;
use mcp_protocol_rust::json::{self, Limits, Value};
pub fn jose(name: &'static str, code: &'static str, message: impl Into<String>) -> Error {
    Error {
        name: Some(name),
        code: Some(code),
        ..Error::plain(message)
    }
}
fn invalid(message: &str) -> Error {
    jose("JWSInvalid", "ERR_JWS_INVALID", message)
}
fn own_string<'a>(value: &'a Value, key: &str) -> Option<&'a [u16]> {
    match value.get(key) {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}
fn decode_json(segment: &[u16]) -> Result<Value, ()> {
    let bytes = mcp_oauth_rust::jwks::decode(segment).map_err(|_| ())?;
    let decoded = String::from_utf8_lossy(&bytes);
    json::parse(
        decoded
            .strip_prefix('\u{feff}')
            .unwrap_or(&decoded)
            .as_bytes(),
        Limits::default(),
    )
    .map_err(|_| ())
}
#[derive(Debug)]
pub struct Jws {
    header: Value,
    segments: Vec<Vec<u16>>,
    b64: bool,
}
impl Jws {
    pub fn new(token: &[u16], allowed: &str) -> Result<Self, Error> {
        let segments: Vec<_> = token.split(|u| *u == 46).map(<[u16]>::to_vec).collect();
        if segments.len() != 3 {
            return Err(invalid("Invalid Compact JWS"));
        }
        let header = if segments[0].is_empty() {
            Value::Object(Vec::new())
        } else {
            decode_json(&segments[0]).map_err(|_| invalid("JWS Protected Header is invalid"))?
        };
        let mut b64 = true;
        if let Some(crit) = header.get("crit") {
            let Value::Array(crit) = crit else {
                return Err(invalid(
                    "\"crit\" (Critical) Header Parameter MUST be an array of non-empty strings when present",
                ));
            };
            if crit.is_empty()
                || crit
                    .iter()
                    .any(|v| !matches!(v,Value::String(s) if !s.is_empty()))
            {
                return Err(invalid(
                    "\"crit\" (Critical) Header Parameter MUST be an array of non-empty strings when present",
                ));
            }
            for claim in crit {
                let Value::String(name) = claim else {
                    unreachable!()
                };
                let name = String::from_utf16_lossy(name);
                if name != "b64" {
                    return Err(jose(
                        "JOSENotSupported",
                        "ERR_JOSE_NOT_SUPPORTED",
                        format!("Extension Header Parameter \"{name}\" is not recognized"),
                    ));
                }
                match header.get("b64") {
                    None => return Err(invalid("Extension Header Parameter \"b64\" is missing")),
                    Some(Value::Bool(value)) => b64 = *value,
                    _ => {
                        return Err(invalid(
                            "The \"b64\" (base64url-encode payload) Header Parameter must be a boolean",
                        ));
                    }
                }
            }
        }
        let algorithm = own_string(&header, "alg")
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                invalid("JWS \"alg\" (Algorithm) Header Parameter missing or invalid")
            })?;
        if !algorithm.iter().copied().eq(allowed.encode_utf16()) {
            return Err(jose(
                "JOSEAlgNotAllowed",
                "ERR_JOSE_ALG_NOT_ALLOWED",
                "\"alg\" (Algorithm) Header Parameter value not allowed",
            ));
        }
        Ok(Self {
            header,
            segments,
            b64,
        })
    }
    pub fn signature_data(&self) -> Result<(Vec<u8>, Vec<u8>), Error> {
        let mut data = Vec::new();
        for unit in &self.segments[0] {
            if *unit > 127 {
                return Err(Error {
                    name: Some("TypeError"),
                    ..Error::plain("non-ASCII string encountered in encode()")
                });
            }
            data.push(*unit as u8);
        }
        data.push(b'.');
        if self.b64 {
            for unit in &self.segments[1] {
                if *unit > 127 {
                    return Err(Error {
                        name: Some("TypeError"),
                        ..Error::plain("non-ASCII string encountered in encode()")
                    });
                }
                data.push(*unit as u8);
            }
        } else {
            data.extend(String::from_utf16_lossy(&self.segments[1]).as_bytes());
        }
        let signature = mcp_oauth_rust::jwks::decode(&self.segments[2])
            .map_err(|_| invalid("Failed to base64url decode the signature"))?;
        Ok((signature, data))
    }
    pub fn claims(&self, issuer: &[u16], audience: &[u16], now: f64) -> Result<Value, Error> {
        if !self.b64 {
            return Err(jose(
                "JWTInvalid",
                "ERR_JWT_INVALID",
                "JWTs MUST NOT use unencoded payload",
            ));
        }
        let bytes = mcp_oauth_rust::jwks::decode(&self.segments[1])
            .map_err(|_| invalid("Failed to base64url decode the payload"))?;
        let decoded = String::from_utf8_lossy(&bytes);
        let payload = json::parse(
            decoded
                .strip_prefix('\u{feff}')
                .unwrap_or(&decoded)
                .as_bytes(),
            Limits::default(),
        )
        .map_err(|_| {
            jose(
                "JWTInvalid",
                "ERR_JWT_INVALID",
                "JWT Claims Set must be a top-level JSON object",
            )
        })?;
        if !matches!(payload, Value::Object(_)) {
            return Err(jose(
                "JWTInvalid",
                "ERR_JWT_INVALID",
                "JWT Claims Set must be a top-level JSON object",
            ));
        }
        let failed = |claim, reason, message: String, expired: bool| {
            let mut e = jose(
                if expired {
                    "JWTExpired"
                } else {
                    "JWTClaimValidationFailed"
                },
                if expired {
                    "ERR_JWT_EXPIRED"
                } else {
                    "ERR_JWT_CLAIM_VALIDATION_FAILED"
                },
                message,
            );
            e.claim = Some(claim);
            e.reason = Some(reason);
            e.payload = Some(Box::new(payload.clone()));
            e
        };
        let typ = own_string(&self.header, "typ")
            .map(String::from_utf16_lossy)
            .unwrap_or_default()
            .to_lowercase();
        if !["at+jwt", "application/at+jwt"].contains(&typ.as_str()) {
            return Err(failed(
                "typ",
                "check_failed",
                "unexpected \"typ\" JWT header value".into(),
                false,
            ));
        }
        for key in ["iss", "aud"] {
            if payload.get(key).is_none() {
                return Err(failed(
                    key,
                    "missing",
                    format!("missing required \"{key}\" claim"),
                    false,
                ));
            }
        }
        if own_string(&payload, "iss") != Some(issuer) {
            return Err(failed(
                "iss",
                "check_failed",
                "unexpected \"iss\" claim value".into(),
                false,
            ));
        }
        let aud = match payload.get("aud") {
            Some(Value::String(s)) => s == audience,
            Some(Value::Array(a)) => a
                .iter()
                .any(|v| matches!(v,Value::String(s) if s==audience)),
            _ => false,
        };
        if !aud {
            return Err(failed(
                "aud",
                "check_failed",
                "unexpected \"aud\" claim value".into(),
                false,
            ));
        }
        if payload
            .get("iat")
            .is_some_and(|v| !matches!(v, Value::Number(_)))
        {
            return Err(failed(
                "iat",
                "invalid",
                "\"iat\" claim must be a number".into(),
                false,
            ));
        }
        for key in ["nbf", "exp"] {
            if let Some(value) = payload.get(key) {
                let Value::Number(n) = value else {
                    return Err(failed(
                        key,
                        "invalid",
                        format!("\"{key}\" claim must be a number"),
                        false,
                    ));
                };
                if (key == "nbf" && *n > now.floor()) || (key == "exp" && *n <= now.floor()) {
                    return Err(failed(
                        key,
                        "check_failed",
                        format!("\"{key}\" claim timestamp check failed"),
                        key == "exp",
                    ));
                }
            }
        }
        Ok(payload)
    }
}
