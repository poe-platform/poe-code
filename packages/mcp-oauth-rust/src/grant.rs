//! Bounded raw OAuth grant admission, independent of binding hosts.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
const INVALID: &str = "Invalid OAuth token grant";
#[derive(Debug)]
pub struct TokenGrant {
    scope: Option<Value>,
    lifetime: Option<Value>,
    seconds: Option<Value>,
    milliseconds: Option<Value>,
    access: Vec<u16>,
    refresh: Option<Vec<u16>>,
}
#[derive(Debug)]
pub struct GrantTiming {
    pub lifetime: Option<f64>,
}
pub fn valid_timestamp(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= 8_640_000_000_000_000.0
}
fn safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
}
fn optional_number(value: Option<&Value>, nullable: bool) -> Result<Option<f64>, &'static str> {
    match value {
        None => Ok(None),
        Some(Value::Null) if nullable => Ok(None),
        Some(Value::Number(number)) => Ok(Some(*number)),
        _ => Err(INVALID),
    }
}
impl TokenGrant {
    pub fn parse(payload: &Value) -> Result<Self, &'static str> {
        crate::registration::validate_credential_json(payload).map_err(|_| INVALID)?;
        if !matches!(payload, Value::Object(_)) {
            return Err(INVALID);
        }
        let nonempty = |value: Option<&Value>| match value {
            Some(Value::String(text)) => {
                let text = trim_ecmascript(text);
                if text.is_empty() {
                    Err(INVALID)
                } else {
                    Ok(text.to_vec())
                }
            }
            _ => Err(INVALID),
        };
        let access = nonempty(payload.get("access_token"))?;
        if !matches!(payload.get("token_type"), Some(Value::String(text)) if text.len()==6 && text.iter().zip(b"bearer").all(|(unit,byte)| *unit==u16::from(*byte)||*unit==u16::from(byte.to_ascii_uppercase())))
        {
            return Err(INVALID);
        }
        let refresh = payload
            .get("refresh_token")
            .map(|value| nonempty(Some(value)))
            .transpose()?;
        Ok(Self {
            scope: payload.get("scope").cloned(),
            lifetime: payload.get("expires_in").cloned(),
            seconds: payload.get("expires_at").cloned(),
            milliseconds: payload.get("expiresAt").cloned(),
            access,
            refresh,
        })
    }
    pub fn access(&self) -> &[u16] {
        &self.access
    }
    pub fn timing(&self) -> Result<GrantTiming, &'static str> {
        let lifetime = optional_number(self.lifetime.as_ref(), false)?;
        let seconds = optional_number(self.seconds.as_ref(), true)?;
        let milliseconds = optional_number(self.milliseconds.as_ref(), true)?;
        if lifetime.is_some_and(|value| !safe_integer(value) || value < 0.0)
            || seconds.is_some_and(|value| !safe_integer(value))
            || milliseconds.is_some_and(|value| !valid_timestamp(value))
        {
            return Err(INVALID);
        }
        Ok(GrantTiming { lifetime })
    }
    pub fn absolute_expiry(&self) -> Result<Option<f64>, &'static str> {
        let seconds = optional_number(self.seconds.as_ref(), true)?.map(|value| value * 1000.0);
        if seconds.is_some_and(|value| !valid_timestamp(value)) {
            return Err(INVALID);
        }
        Ok(optional_number(self.milliseconds.as_ref(), true)?.or(seconds))
    }
    pub fn validate_relative(&self, value: Option<f64>) -> Result<(), &'static str> {
        if value.is_some_and(|value| !valid_timestamp(value)) {
            Err(INVALID)
        } else {
            Ok(())
        }
    }
    pub fn fields(&self) -> Result<Value, &'static str> {
        let mut fields = vec![
            (
                "accessToken".encode_utf16().collect(),
                Value::String(self.access.clone()),
            ),
            (
                "tokenType".encode_utf16().collect(),
                Value::String("Bearer".encode_utf16().collect()),
            ),
        ];
        if let Some(refresh) = &self.refresh {
            fields.push((
                "refreshToken".encode_utf16().collect(),
                Value::String(refresh.clone()),
            ));
        }
        let raw_scope = self.scope.as_ref();
        let scope = crate::scope::normalize(raw_scope).map_err(|_| INVALID)?;
        if raw_scope.is_some() && scope.is_none() {
            return Err(INVALID);
        }
        if let Some(scope) = scope {
            fields.push(("scope".encode_utf16().collect(), Value::String(scope)));
        }
        Ok(Value::Object(fields))
    }
}
