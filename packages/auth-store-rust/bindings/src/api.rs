//! Native credential API shared by own addons.
use crate::convert;
use auth_store_rust::{KeychainPlan, Operation};
use mcp_protocol_rust::json::{self, Limits, Value};
use napi::bindgen_prelude::*;
use napi_derive::napi;
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
pub fn select_backend(configured: Option<Utf16String>) -> convert::NativeJson {
    envelope(
        auth_store_rust::select_backend(configured.as_deref())
            .map(|value| Value::String(value.encode_utf16().collect())),
    )
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

#[napi]
pub fn lock_timeout(timeout: f64) -> convert::NativeJson {
    envelope(
        auth_store_rust::lock::validate_timeout(timeout)
            .map(|()| Value::Null)
            .map_err(|message| message.encode_utf16().collect()),
    )
}

#[napi]
pub fn lock_owner(name: Utf16String, own_name: Utf16String) -> convert::NativeJson {
    envelope(
        auth_store_rust::lock::owner(&name, &own_name)
            .map(|pid| pid.map_or(Value::Null, Value::Number))
            .map_err(|message| message.encode_utf16().collect()),
    )
}

#[napi]
pub fn lock_protected_paths(
    resolved: Utf16String,
    root_len: u32,
    separator: u32,
) -> Result<Vec<Utf16String>> {
    if root_len as usize > resolved.len() || separator > 65535 {
        return Err(napi::Error::from_reason("Invalid credential path"));
    }
    Ok(
        auth_store_rust::lock::protected_paths(&resolved, root_len as usize, separator as u16)
            .into_iter()
            .map(Utf16String::from)
            .collect(),
    )
}

#[napi]
pub fn lock_next_ticket(claims: Vec<Object<'_>>) -> Result<convert::NativeJson> {
    let mut tickets = Vec::with_capacity(claims.len());
    for claim in claims {
        let ticket: Unknown = claim.get_named_property("ticket")?;
        tickets.push(match ticket.get_type()? {
            napi::ValueType::Null | napi::ValueType::Undefined => 0.0,
            napi::ValueType::Number => unsafe { ticket.cast::<f64>()? },
            _ => ticket.coerce_to_number()?.get_double()?,
        });
    }
    Ok(envelope(
        auth_store_rust::lock::next_ticket(&tickets)
            .map(Value::Number)
            .map_err(|message| message.encode_utf16().collect()),
    ))
}

#[napi]
pub fn lock_claim_ticket<'env>(
    source: Unknown<'env>,
    positive: Function<'env, Unknown, bool>,
) -> Result<Option<Unknown<'env>>> {
    if source.get_type()? != napi::ValueType::Object {
        return Ok(None);
    }
    let object: Object = unsafe { source.cast()? };
    if !object.has_named_property("ticket")? {
        return Ok(None);
    }
    let first: Unknown = object.get_named_property("ticket")?;
    if first.get_type()? != napi::ValueType::Number {
        return Ok(None);
    }
    let second: Unknown = object.get_named_property("ticket")?;
    if second.get_type()? != napi::ValueType::Number
        || !auth_store_rust::lock::is_safe_integer(unsafe { second.cast::<f64>()? })
    {
        return Ok(None);
    }
    let third: Unknown = object.get_named_property("ticket")?;
    let admitted = if third.get_type()? == napi::ValueType::Number {
        unsafe { third.cast::<f64>()? > 0.0 }
    } else {
        positive.call(third)?
    };
    if admitted {
        Ok(Some(object.get_named_property("ticket")?))
    } else {
        Ok(None)
    }
}

#[napi]
pub fn lock_has_predecessor<'env>(
    peers: Vec<Object<'env>>,
    ticket: f64,
    name: Utf16String,
    less_than: Function<'env, FnArgs<(Unknown, f64)>, bool>,
) -> Result<bool> {
    for peer in peers {
        let value: Unknown = peer.get_named_property("ticket")?;
        let blocks = match value.get_type()? {
            napi::ValueType::Null => true,
            napi::ValueType::Number => {
                let value = unsafe { value.cast::<f64>()? };
                let peer_name: Utf16String = if value == ticket {
                    peer.get_named_property("name")?
                } else {
                    Vec::<u16>::new().into()
                };
                auth_store_rust::lock::precedes(Some(value), ticket, &peer_name, &name)
            }
            // Keep ECMAScript relational coercion and thrown host values intact.
            _ => less_than.call((value, ticket).into())?,
        };
        if blocks {
            return Ok(true);
        }
    }
    Ok(false)
}

use std::cell::RefCell;
#[napi]
pub struct NativeLockLifecycle {
    state: auth_store_rust::lock::LockLifecycle,
}

#[napi]
impl NativeLockLifecycle {
    #[napi(constructor)]
    pub fn new(deadline: f64) -> Self {
        Self {
            state: auth_store_rust::lock::LockLifecycle::new(deadline),
        }
    }

    #[napi]
    pub fn claim_failed(&mut self, collision: bool) {
        self.state.claim_failed(collision);
    }

    #[napi]
    pub fn begin_publication(&mut self) {
        self.state.begin_publication();
    }

    #[napi]
    pub fn publication_failed(&mut self, collision: bool) {
        self.state.publication_failed(collision);
    }

    #[napi]
    pub fn published(&mut self) {
        self.state.published();
    }

    #[napi]
    pub fn cleanup_targets(&self) -> Vec<String> {
        self.state
            .cleanup_targets()
            .into_iter()
            .map(|target| match target {
                auth_store_rust::lock::CleanupTarget::Temporary => "temporary".to_owned(),
                auth_store_rust::lock::CleanupTarget::Claim => "claim".to_owned(),
            })
            .collect()
    }

    #[napi]
    pub fn wait_delay(&self, now: f64) -> convert::NativeJson {
        envelope(
            self.state
                .wait_delay(now)
                .map(Value::Number)
                .map_err(|message| message.encode_utf16().collect()),
        )
    }
}

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
