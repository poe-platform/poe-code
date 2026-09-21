//! Document policies over opaque host values; keys are exact UTF16.
use std::{collections::HashSet, hash::Hash};
pub type Entries<V> = Vec<(Vec<u16>, V)>;
pub trait Host {
    type Value: Copy + Eq + Hash;
    type Error;
    fn is_record(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_undefined(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn keys(&mut self, value: Self::Value) -> Result<Vec<Vec<u16>>, Self::Error>;
    fn own(&mut self, value: Self::Value, key: &[u16]) -> Result<Self::Value, Self::Error>;
    fn entries(&mut self, value: Self::Value) -> Result<Entries<Self::Value>, Self::Error>;
    fn create(&mut self) -> Result<Self::Value, Self::Error>;
    fn define(
        &mut self,
        target: Self::Value,
        key: &[u16],
        value: Self::Value,
    ) -> Result<(), Self::Error>;
    fn policy_error(&mut self, message: &'static str) -> Self::Error;
}
pub fn normalize_scope<H: Host>(host: &mut H, value: H::Value) -> Result<H::Value, H::Error> {
    let result = host.create()?;
    if host.is_record(value)? {
        for (key, value) in host.entries(value)? {
            if !host.is_undefined(value)? {
                host.define(result, &key, value)?;
            }
        }
    }
    Ok(result)
}
pub fn normalize<H: Host>(host: &mut H, value: H::Value) -> Result<H::Value, H::Error> {
    let result = host.create()?;
    if host.is_record(value)? {
        for (scope, values) in host.entries(value)? {
            let values = normalize_scope(host, values)?;
            if !host.keys(values)?.is_empty() {
                host.define(result, &scope, values)?;
            }
        }
    }
    Ok(result)
}
fn own_record<H: Host>(host: &mut H, value: H::Value, key: &[u16]) -> Result<H::Value, H::Error> {
    let value = host.own(value, key)?;
    if host.is_record(value)? {
        Ok(value)
    } else {
        host.create()
    }
}
fn union<H: Host>(host: &mut H, base: H::Value, over: H::Value) -> Result<Vec<Vec<u16>>, H::Error> {
    let mut keys = host.keys(base)?;
    let mut seen: HashSet<_> = keys.iter().cloned().collect();
    for key in host.keys(over)? {
        if seen.insert(key.clone()) {
            keys.push(key);
        }
    }
    Ok(keys)
}
pub fn merge<H: Host>(host: &mut H, base: H::Value, over: H::Value) -> Result<H::Value, H::Error> {
    let result = host.create()?;
    for scope in union(host, base, over)? {
        let a = own_record(host, base, &scope)?;
        let b = own_record(host, over, &scope)?;
        let values = if scope == "runtime".encode_utf16().collect::<Vec<_>>() {
            merge_runtime(host, a, b, 0)?
        } else {
            // Object.entries(over) is evaluated before the base enumeration.
            let overrides = host
                .entries(b)?
                .into_iter()
                .map(|(key, value)| {
                    host.is_undefined(value)
                        .map(|undefined| (key, value, undefined))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let values = host.create()?;
            for (key, value) in host.entries(a)? {
                host.define(values, &key, value)?;
            }
            for (key, value, undefined) in overrides {
                if !undefined {
                    host.define(values, &key, value)?;
                }
            }
            values
        };
        if !host.keys(values)?.is_empty() {
            host.define(result, &scope, values)?;
        }
    }
    Ok(result)
}
fn merge_runtime<H: Host>(
    host: &mut H,
    base: H::Value,
    over: H::Value,
    depth: usize,
) -> Result<H::Value, H::Error> {
    if depth > 512 {
        return Err(host.policy_error("Config runtime merge depth exceeded (512)."));
    }
    let result = host.create()?;
    for key in union(host, base, over)? {
        let a = host.own(base, &key)?;
        let b = host.own(over, &key)?;
        if host.is_undefined(b)? {
            if !host.is_undefined(a)? {
                host.define(result, &key, a)?;
            }
        } else {
            let value = if host.is_record(a)? && host.is_record(b)? {
                merge_runtime(host, a, b, depth + 1)?
            } else {
                b
            };
            host.define(result, &key, value)?;
        }
    }
    Ok(result)
}
