use auth_store_rust::{KeychainPlan, Operation};
use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[path = "../../../mcp-protocol-rust/bindings/src/convert.rs"]
mod convert;
fn envelope(result: std::result::Result<Value, Vec<u16>>) -> convert::NativeJson {
    let (key, value) = match result {
        Ok(value) => ("value", value),
        Err(message) => ("error", Value::String(message)),
    };
    convert::NativeJson(Value::Object(vec![(key.encode_utf16().collect(), value)]))
}
#[napi]
pub struct NativeKeychainPlan {
    plan: KeychainPlan,
}
#[napi]
impl NativeKeychainPlan {
    #[napi(constructor)]
    pub fn new(service: Utf16String, account: Utf16String) -> Result<Self> {
        Ok(Self {
            plan: KeychainPlan::new(&service, &account).map_err(napi::Error::from_reason)?,
        })
    }
    #[napi]
    pub fn command(
        &self,
        operation: String,
        value: Option<Utf16String>,
    ) -> Result<Vec<Utf16String>> {
        let operation = Operation::parse(&operation)
            .ok_or_else(|| napi::Error::from_reason("Invalid Keychain operation"))?;
        self.plan
            .command(operation, value.as_ref().map(|value| value.as_ref()))
            .map(|args| args.into_iter().map(Utf16String::from).collect())
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn complete(&self, operation: String, result: Utf16String) -> Result<convert::NativeJson> {
        let operation = Operation::parse(&operation)
            .ok_or_else(|| napi::Error::from_reason("Invalid Keychain operation"))?;
        let result = json::parse_utf16(&result, Limits::default())
            .map_err(|_| napi::Error::from_reason("Invalid Keychain result"))?;
        Ok(envelope(self.plan.complete(operation, &result)))
    }
    #[napi]
    pub fn execution_failure(&self, operation: String, reason: Utf16String) -> Result<Utf16String> {
        let operation = Operation::parse(&operation)
            .ok_or_else(|| napi::Error::from_reason("Invalid Keychain operation"))?;
        Ok(KeychainPlan::execution_failure(operation, &reason).into())
    }
}
#[napi]
pub fn resolve_backend(
    configured: Option<Utf16String>,
    platform: Utf16String,
) -> convert::NativeJson {
    envelope(
        auth_store_rust::resolve_backend(
            configured.as_ref().map(|value| value.as_ref()),
            &platform,
        )
        .map(|value| Value::String(value.encode_utf16().collect())),
    )
}
#[napi]
pub fn validate_defaults(directory: Utf16String, absolute: bool, file: Utf16String) -> Result<()> {
    auth_store_rust::validate_defaults(&directory, absolute, &file)
        .map_err(napi::Error::from_reason)
}
#[napi]
pub fn parse_document(raw: Utf16String) -> convert::NativeJson {
    convert::NativeJson(auth_store_rust::parse_document(&raw).unwrap_or(Value::Null))
}
#[napi]
pub fn protected_paths(
    resolved: Utf16String,
    root_len: u32,
    separator: u32,
    start: Option<Utf16String>,
    inside: bool,
) -> Result<Vec<Utf16String>> {
    if root_len as usize > resolved.len() || separator > 65535 {
        return Err(napi::Error::from_reason("Invalid credential path"));
    }
    Ok(auth_store_rust::protected_paths(
        &resolved,
        root_len as usize,
        separator as u16,
        start.as_ref().map(|text| text.as_ref()),
        inside,
    )
    .into_iter()
    .map(Utf16String::from)
    .collect())
}
#[napi]
pub fn migration_write_needed(
    primary: Option<Utf16String>,
    captured: Utf16String,
    legacy: Option<Utf16String>,
) -> bool {
    auth_store_rust::migration_write_needed(
        primary.as_ref().map(|value| value.as_ref()),
        &captured,
        legacy.as_ref().map(|value| value.as_ref()),
    )
}
#[napi]
pub fn rollback_plan(
    primary: Option<Utf16String>,
    legacy: Option<Utf16String>,
    has_legacy: bool,
) -> convert::NativeJson {
    convert::NativeJson(auth_store_rust::rollback_plan(
        primary.as_ref().map(|value| value.as_ref()),
        legacy.as_ref().map(|value| value.as_ref()),
        has_legacy,
    ))
}
#[napi]
pub fn provider_key(provider: Utf16String) -> Utf16String {
    let mut text: Vec<u16> = "provider:".encode_utf16().collect();
    text.extend(provider.iter());
    text.into()
}

use std::cell::RefCell;
#[napi]
#[derive(Default)]
pub struct NativeDerivedKeyCache {
    state: RefCell<auth_store_rust::cache::DerivedKeyCache>,
}
#[napi]
impl NativeDerivedKeyCache {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.state.borrow().size() as u32
    }
    #[napi]
    pub fn lookup(&self, key: Utf16String) -> Option<Buffer> {
        self.state
            .borrow_mut()
            .lookup(&key)
            .map(|value| value.to_vec().into())
    }
    #[napi]
    pub fn insert(&self, key: Utf16String, value: Buffer) -> Result<()> {
        self.state
            .borrow_mut()
            .insert(&key, &value)
            .map_err(napi::Error::from_reason)
    }
}
