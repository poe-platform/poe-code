use mcp_oauth_server_rust::{
    security,
    store::{Kind, Record, Rotation, Store},
};
use mcp_protocol_rust::json::{self, Limits};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::cell::RefCell;
#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
fn kind(value: &str) -> Result<Kind> {
    Kind::parse(value).ok_or_else(|| napi::Error::from_reason("Unknown authorization record kind"))
}
#[napi]
pub struct NativeAuthorizationRecord {
    record: Record,
}
#[napi]
impl NativeAuthorizationRecord {
    #[napi(getter)]
    pub fn payload(&self) -> Buffer {
        self.record.payload.to_vec().into()
    }
    #[napi(getter)]
    pub fn patches(&self) -> convert::NativeJson {
        convert::NativeJson(self.record.patches.clone())
    }
}
#[napi]
pub struct NativeAuthorizationRotation {
    result: Rotation,
}
#[napi]
impl NativeAuthorizationRotation {
    #[napi(getter)]
    pub fn status(&self) -> &'static str {
        match self.result {
            Rotation::Rotated(_) => "rotated",
            Rotation::Replay(_) => "replay",
            Rotation::Invalid => "invalid",
        }
    }
    #[napi(getter)]
    pub fn previous(&self) -> Option<NativeAuthorizationRecord> {
        match &self.result {
            Rotation::Rotated(r) => Some(NativeAuthorizationRecord { record: r.clone() }),
            _ => None,
        }
    }
    #[napi(getter)]
    pub fn grant(&self) -> Option<NativeAuthorizationRecord> {
        match &self.result {
            Rotation::Replay(Some(r)) => Some(NativeAuthorizationRecord { record: r.clone() }),
            _ => None,
        }
    }
}
#[napi]
pub struct NativeAuthorizationStore {
    store: RefCell<Store>,
}
#[napi]
impl NativeAuthorizationStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            store: RefCell::new(Store::default()),
        }
    }
    #[napi]
    pub fn put(&self, table: String, payload: Buffer, metadata: Utf16String) -> Result<()> {
        let attributes = json::parse_utf16(&metadata, Limits::default())
            .map_err(|_| napi::Error::from_reason("Invalid authorization record metadata"))?;
        self.store
            .borrow_mut()
            .put(kind(&table)?, Record::new(payload.to_vec(), attributes))
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn get(
        &self,
        table: String,
        key: Utf16String,
        take: bool,
    ) -> Result<Option<NativeAuthorizationRecord>> {
        let kind = kind(&table)?;
        let result = if take {
            self.store.borrow_mut().take(kind, &key)
        } else {
            self.store.borrow().get(kind, &key)
        };
        Ok(result.map(|record| NativeAuthorizationRecord { record }))
    }
    #[napi]
    pub fn rotate(
        &self,
        key: Utf16String,
        replacement: Utf16String,
        now: f64,
        expires: f64,
    ) -> NativeAuthorizationRotation {
        NativeAuthorizationRotation {
            result: self
                .store
                .borrow_mut()
                .rotate(&key, replacement.to_vec(), now, expires),
        }
    }
    #[napi]
    pub fn revoke_token(&self, key: Utf16String, now: f64) -> Option<NativeAuthorizationRecord> {
        self.store
            .borrow_mut()
            .revoke_token(&key, now)
            .map(|record| NativeAuthorizationRecord { record })
    }
    #[napi]
    pub fn revoke_grant(&self, key: Utf16String, now: f64) {
        self.store.borrow_mut().revoke_grant(&key, now);
    }
}
impl Default for NativeAuthorizationStore {
    fn default() -> Self {
        Self::new()
    }
}
#[napi]
pub fn validate_csrf_cookie(name: Utf16String, max_age: f64) -> Result<()> {
    security::validate_cookie(&name, max_age).map_err(napi::Error::from_reason)
}
#[napi]
pub fn csrf_cookie(name: Utf16String, max_age: f64, token: Utf16String) -> Result<Utf16String> {
    security::security_cookie(&name, max_age, &token)
        .map(Utf16String::from)
        .map_err(napi::Error::from_reason)
}
#[napi]
pub fn csrf_cookie_value(header: Option<Utf16String>, name: Utf16String) -> Option<Utf16String> {
    security::cookie_value(header.as_ref().map(|s| s.as_ref()), &name).map(Utf16String::from)
}
