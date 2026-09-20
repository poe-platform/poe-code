use crate::convert::NativeJson;
use mcp_oauth_rust::jwks::{self, Cache, Configuration, Token};
use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
use std::sync::Arc;
fn strings(source: &[u16]) -> Result<Vec<Vec<u16>>> {
    let value = json::parse_utf16(source, Limits::default())
        .map_err(|_| napi::Error::from_reason("token verification failed"))?;
    let Value::Array(values) = value else {
        return Err(napi::Error::from_reason("token verification failed"));
    };
    values
        .into_iter()
        .map(|v| match v {
            Value::String(s) => Ok(s),
            _ => Err(napi::Error::from_reason("token verification failed")),
        })
        .collect()
}
#[napi(object)]
pub struct JwksTiming {
    pub skew: f64,
    pub ttl: f64,
    pub timeout: f64,
    pub cooldown: f64,
}
#[napi]
pub fn validate_jwks_configuration(
    protocol: String,
    hostname: String,
    credentials: bool,
    insecure: bool,
    timing: JwksTiming,
) -> Result<()> {
    Configuration {
        skew: timing.skew,
        ttl: timing.ttl,
        timeout: timing.timeout,
        cooldown: timing.cooldown,
    }
    .validate(&protocol, &hostname, credentials, insecure)
    .map_err(napi::Error::from_reason)
}
#[napi]
pub struct NativeJwksToken {
    token: Token,
    payload: RefCell<Option<Value>>,
}
#[napi]
impl NativeJwksToken {
    #[napi(constructor)]
    pub fn new(token: Utf16String, allowed: Utf16String) -> Result<Self> {
        let allowed = strings(&allowed)?
            .iter()
            .map(|s| String::from_utf16_lossy(s))
            .collect::<Vec<_>>();
        Ok(Self {
            token: Token::new(&token, &allowed).map_err(napi::Error::from_reason)?,
            payload: RefCell::new(None),
        })
    }
    #[napi]
    pub fn signature_data(&self) -> Result<Vec<Buffer>> {
        let (signature, data) = self
            .token
            .signature_data()
            .map_err(napi::Error::from_reason)?;
        Ok(vec![signature.into(), data.into()])
    }
    #[napi]
    pub fn validate_claims(
        &self,
        issuers: Utf16String,
        now: f64,
        skew: f64,
        require_type: bool,
    ) -> Result<()> {
        let payload = self.token.payload().map_err(napi::Error::from_reason)?;
        jwks::claims(
            &self.token.header,
            &payload,
            &strings(&issuers)?,
            now,
            skew,
            require_type,
        )
        .map_err(napi::Error::from_reason)?;
        *self.payload.borrow_mut() = Some(payload);
        Ok(())
    }
    #[napi(getter)]
    pub fn audiences(&self) -> NativeJson {
        let payload = self.payload.borrow();
        let value = match payload.as_ref().and_then(|p| p.get("aud")) {
            Some(Value::String(s)) => Value::Array(vec![Value::String(s.clone())]),
            Some(Value::Array(a)) if a.iter().all(|v| matches!(v, Value::String(_))) => {
                Value::Array(a.clone())
            }
            _ => Value::Array(Vec::new()),
        };
        NativeJson(value)
    }
    #[napi]
    pub fn complete(&self, audience: Utf16String, required: Utf16String) -> Result<NativeJson> {
        let payload = self.payload.borrow();
        self.token
            .result(
                payload
                    .as_ref()
                    .ok_or_else(|| napi::Error::from_reason("token verification failed"))?,
                &audience,
                &strings(&required)?,
            )
            .map(NativeJson)
            .map_err(napi::Error::from_reason)
    }
}
#[napi]
pub struct NativeJwksCache {
    cache: RefCell<Cache>,
}
#[napi]
pub struct NativeJwksDocument {
    keys: Arc<Vec<Value>>,
}
#[napi]
impl NativeJwksDocument {
    #[napi(constructor)]
    pub fn new(source: Utf16String) -> Result<Self> {
        let keys = jwks::parse_jwks(&String::from_utf16_lossy(&source))
            .map_err(napi::Error::from_reason)?;
        Ok(Self {
            keys: Arc::new(keys),
        })
    }
    #[napi]
    pub fn select(&self, token: &NativeJwksToken) -> NativeJson {
        NativeJson(Value::Array(
            jwks::candidates(&self.keys, &token.token)
                .into_iter()
                .map(|key| {
                    jwks::import_plan(key, &token.token.algorithm).unwrap_or_else(|_| {
                        Value::Object(vec![(
                            "malformed".encode_utf16().collect(),
                            Value::Bool(true),
                        )])
                    })
                })
                .collect(),
        ))
    }
}
#[napi]
impl NativeJwksCache {
    #[napi(constructor)]
    pub fn new(ttl: f64, cooldown: f64) -> Self {
        Self {
            cache: RefCell::new(Cache::new(ttl, cooldown)),
        }
    }
    #[napi]
    pub fn valid(&self, now: f64) -> bool {
        self.cache.borrow().cached(now).is_some()
    }
    #[napi]
    pub fn store(&self, document: &NativeJwksDocument, now: f64) {
        self.cache
            .borrow_mut()
            .store_shared(document.keys.clone(), now);
    }
    #[napi]
    pub fn force(&self, now: f64) -> bool {
        self.cache.borrow_mut().force(now)
    }
    #[napi]
    pub fn snapshot(&self) -> Option<NativeJwksDocument> {
        self.cache
            .borrow()
            .snapshot()
            .map(|keys| NativeJwksDocument { keys })
    }
}
