use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::redaction;

#[napi]
pub fn is_sensitive_name(name: Utf16String) -> bool {
    redaction::is_sensitive_name(&name)
}

#[napi]
pub fn redact_http_header_value(name: Utf16String, value: Utf16String) -> Utf16String {
    redaction::redact_header(&name, &value).into()
}

fn string_value<'env>(env: Env, value: Utf16String) -> Result<Unknown<'env>> {
    // Conversion and use stay in the current synchronous callback handle scope;
    // no raw handle is retained by Rust after the traversal returns.
    unsafe { Unknown::from_napi_value(env.raw(), Utf16String::to_napi_value(env.raw(), value)?) }
}

enum Task<'env> {
    Visit(Unknown<'env>, Utf16String, bool),
    Leave(Unknown<'env>),
    Object(Unknown<'env>, Vec<Unknown<'env>>),
}

/// Handles stay in the synchronous callback scope. A flat work stack avoids
/// overflowing the native stack on deep object/serializer graphs. Array mapping
/// stays in the caller's realm for sparse slots, species and custom methods.
#[napi]
pub fn redact_value<'env>(
    env: Env,
    value: Unknown<'env>,
    name: Utf16String,
    seen: Object<'env>,
    apply_to_json: bool,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let has: Function<Unknown, bool> = seen.get_named_property("has")?;
    let add: Function<Unknown, Unknown> = seen.get_named_property("add")?;
    let delete: Function<Unknown, bool> = seen.get_named_property("delete")?;
    let mut tasks = vec![Task::Visit(value, name, apply_to_json)];
    let mut values = Vec::new();
    while let Some(task) = tasks.pop() {
        let (value, name, apply_to_json) = match task {
            Task::Visit(value, name, apply) => (value, name, apply),
            Task::Leave(value) => {
                delete.apply(seen, value)?;
                continue;
            }
            Task::Object(value, keys) => {
                let children = values.split_off(values.len() - keys.len());
                let output = keys
                    .into_iter()
                    .zip(children)
                    .map(|(key, child)| vec![key, child])
                    .collect::<Vec<_>>();
                let from_entries: Function<Vec<Vec<Unknown>>, Unknown> =
                    host.get_named_property("fromEntries")?;
                values.push(from_entries.call(output)?);
                delete.apply(seen, value)?;
                continue;
            }
        };
        if redaction::is_sensitive_name(&name) {
            values.push(string_value(
                env,
                "<redacted>".encode_utf16().collect::<Vec<_>>().into(),
            )?);
            continue;
        }
        let kind = value.get_type()?;
        if !matches!(kind, ValueType::Object | ValueType::Function) {
            values.push(value);
            continue;
        }
        if has.apply(seen, value)? {
            values.push(string_value(
                env,
                "[Circular]".encode_utf16().collect::<Vec<_>>().into(),
            )?);
            continue;
        }
        add.apply(seen, value)?;
        // The type check admits object/function handles only.
        let object: Object = unsafe { value.cast()? };
        if apply_to_json {
            let serializer: Function<Unknown, Unknown> = host.get_named_property("serializer")?;
            let hook = serializer.call(value)?;
            if hook.get_type()? == ValueType::Function {
                let serialize: Function<FnArgs<(Unknown, Unknown, Utf16String)>, Unknown> =
                    host.get_named_property("serialize")?;
                let serialized = serialize.call((hook, value, name.to_vec().into()).into())?;
                if !env.strict_equals(serialized, value)? {
                    tasks.push(Task::Leave(value));
                    tasks.push(Task::Visit(serialized, name, false));
                    continue;
                }
            }
        }
        if kind == ValueType::Function {
            delete.apply(seen, value)?;
            values.push(env.get_global()?.get_named_property("undefined")?);
            continue;
        }
        if object.is_array()? {
            let map: Function<FnArgs<(Unknown, Object)>, Unknown> =
                host.get_named_property("map")?;
            values.push(map.call((value, seen).into())?);
            delete.apply(seen, value)?;
        } else {
            let entries: Function<Unknown, Vec<Object>> = host.get_named_property("entries")?;
            // Snapshot all getters before any child serializer is called.
            let entries = entries.call(value)?;
            let mut keys = Vec::with_capacity(entries.len());
            let mut children = Vec::with_capacity(entries.len());
            for entry in entries {
                let key: Utf16String = entry.get_element(0)?;
                let child: Unknown = entry.get_element(1)?;
                if key.as_ref() == [116, 111, 74, 83, 79, 78]
                    && child.get_type()? == ValueType::Function
                {
                    continue;
                }
                keys.push(string_value(env, key.to_vec().into())?);
                children.push(Task::Visit(child, key, true));
            }
            tasks.push(Task::Object(value, keys));
            tasks.extend(children.into_iter().rev());
        }
    }
    values
        .pop()
        .ok_or_else(|| napi::Error::from_reason("Missing redaction result"))
}
