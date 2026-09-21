use super::{convert::NativeJson, registration_binding::read_credential_json};
use mcp_oauth_rust::grant::{ImportTiming, TokenGrant, valid_timestamp};
use mcp_protocol_rust::json::Value;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi]
pub struct NativeTokenGrant {
    grant: TokenGrant,
    prepared: Option<ImportTiming>,
}
#[napi]
impl NativeTokenGrant {
    #[napi(constructor)]
    pub fn new(env: Env, source: Unknown<'_>) -> Result<Self> {
        let payload = read_credential_json(env, source)?;
        Ok(Self {
            grant: TokenGrant::parse(&payload).map_err(napi::Error::from_reason)?,
            prepared: None,
        })
    }
    #[napi]
    pub fn prepare(&mut self, expires: Unknown<'_>, issued: Unknown<'_>) -> Result<Option<f64>> {
        let expires = timestamp_value(expires)?;
        let issued = timestamp_value(issued)?;
        let timing = self
            .grant
            .prepare_import(expires.as_ref(), issued.as_ref())
            .map_err(napi::Error::from_reason)?;
        let lifetime = timing.lifetime;
        self.prepared = Some(timing);
        Ok(lifetime)
    }
    #[napi]
    pub fn complete(&self, anchor: Unknown<'_>) -> Result<NativeJson> {
        let anchor = match anchor.get_type()? {
            napi::ValueType::Undefined => None,
            napi::ValueType::Number => Some(unsafe { anchor.cast::<f64>()? }),
            _ => return Err(napi::Error::from_reason("Invalid OAuth token grant")),
        };
        let timing = self
            .prepared
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("Invalid OAuth token grant"))?;
        self.grant
            .complete_import(timing, anchor)
            .map(NativeJson)
            .map_err(napi::Error::from_reason)
    }
    #[napi(getter)]
    pub fn access(&self) -> Utf16String {
        self.grant.access().to_vec().into()
    }
    #[napi]
    pub fn lifetime(&self) -> Result<Option<f64>> {
        self.grant
            .timing()
            .map(|timing| timing.lifetime)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn absolute_expiry(&self) -> Result<Option<f64>> {
        self.grant
            .absolute_expiry()
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn validate_relative(&self, value: Unknown<'_>) -> Result<()> {
        let value = match value.get_type()? {
            napi::ValueType::Undefined => None,
            napi::ValueType::Number => Some(unsafe { value.cast::<f64>()? }),
            _ => return Err(napi::Error::from_reason("Invalid OAuth token grant")),
        };
        self.grant
            .validate_relative(value)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn fields(&self) -> Result<NativeJson> {
        self.grant
            .fields()
            .map(NativeJson)
            .map_err(napi::Error::from_reason)
    }
}
#[napi]
pub fn validate_grant_timestamp(value: Unknown<'_>) -> Result<()> {
    if value.get_type()? == napi::ValueType::Number
        && valid_timestamp(unsafe { value.cast::<f64>()? })
    {
        Ok(())
    } else {
        Err(napi::Error::from_reason("Invalid OAuth token grant"))
    }
}

fn timestamp_value(value: Unknown<'_>) -> Result<Option<Value>> {
    Ok(match value.get_type()? {
        napi::ValueType::Undefined => None,
        napi::ValueType::Null => Some(Value::Null),
        napi::ValueType::Number => Some(Value::Number(unsafe { value.cast::<f64>()? })),
        _ => Some(Value::Bool(false)),
    })
}
