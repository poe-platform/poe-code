//! Declarative provider identities and credential policy; host I/O remains injectable.
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
use std::collections::HashMap;
include!(concat!(env!("OUT_DIR"), "/definitions.rs"));
#[derive(Debug, PartialEq, Eq)]
pub enum Collision {
    Identity,
    Storage,
}
#[derive(Default)]
pub struct Registry {
    ids: HashMap<Vec<u16>, usize>,
    storage: HashMap<Vec<u16>, usize>,
}
impl Registry {
    pub fn get(&self, id: &[u16]) -> Option<usize> {
        self.ids.get(id).copied()
    }
    pub fn insert(&mut self, id: Vec<u16>, storage: Option<Vec<u16>>) -> Result<usize, Collision> {
        if self.ids.contains_key(&id) {
            return Err(Collision::Identity);
        }
        if storage
            .as_ref()
            .is_some_and(|key| self.storage.contains_key(key))
        {
            return Err(Collision::Storage);
        }
        let index = self.ids.len();
        self.ids.insert(id, index);
        if let Some(key) = storage {
            self.storage.insert(key, index);
        }
        Ok(index)
    }
}
pub fn rank(api_key: bool, preferred_oauth: bool, requires_url: bool) -> u32 {
    if api_key && preferred_oauth {
        0
    } else if requires_url {
        2
    } else {
        1
    }
}
pub fn trim(value: &[u16]) -> &[u16] {
    trim_ecmascript(value)
}
pub fn resolve_shape(provider: &[Vec<u16>], agent: &[Vec<u16>]) -> Option<usize> {
    agent.iter().position(|shape| provider.contains(shape))
}
pub fn definition(id: &str, source: &[u8]) -> Result<Value, String> {
    let Value::Object(mut fields) = json::parse(source, Default::default())
        .map_err(|_| format!("Invalid JSON provider definition: {id}"))?
    else {
        return Err(format!("Provider definition must be an object: {id}"));
    };
    let id_key: Vec<u16> = "id".encode_utf16().collect();
    fields.retain(|(key, _)| key != &id_key);
    fields.insert(0, (id_key, Value::String(id.encode_utf16().collect())));
    Ok(Value::Object(fields))
}
pub fn catalog() -> Result<Vec<Value>, String> {
    DEFINITION_JSON
        .iter()
        .map(|(id, source)| definition(id, source.as_bytes()))
        .collect()
}

/// Prefer the first compatible value from an effectful host iterator.
pub fn first_match<T, E>(
    mut next: impl FnMut() -> Result<Option<T>, E>,
    mut matches: impl FnMut(&T) -> Result<bool, E>,
) -> Result<Option<T>, E> {
    while let Some(value) = next()? {
        if matches(&value)? {
            return Ok(Some(value));
        }
    }
    Ok(None)
}
