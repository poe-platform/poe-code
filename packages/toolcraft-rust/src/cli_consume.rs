//! CLI field-value dispatch, argument consumption and validation-error collection.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    macro_rules! kind {
        ($schema:expr,$kind:expr) => {{
            let kind = host.get($schema, "kind")?;
            host.is_kind(kind, $kind)?
        }};
    }
    macro_rules! field_kind {
        ($field:expr,$kind:expr) => {{
            let schema = host.get($field, "schema")?;
            kind!(schema, $kind)
        }};
    }
    match (operation, args) {
        ("input", [value, schema, label]) => {
            if kind!(*schema, "array") {
                host.call("array", vec![*value, *schema, *label])
            } else if kind!(*schema, "json") {
                if host.is_kind(*value, "null")? {
                    let nullable = host.get(*schema, "nullable")?;
                    if host.is_true(nullable)? {
                        return host.call("null", vec![]);
                    }
                }
                host.call("json", vec![*value, *label])
            } else {
                host.call("scalar", vec![*value, *schema, *label])
            }
        }
        ("option", [field, value, errors]) => {
            let attempt = c!("attempt", *field, *value);
            let failed = host.get(attempt, "failed")?;
            if !host.is_true(failed)? {
                return host.get(attempt, "value");
            }
            let error = host.get(attempt, "error")?;
            if yes!(c!("userError", error)) || yes!(c!("argumentError", error)) {
                c!("pushError", *errors, *field, error);
                host.call("failed", vec![])
            } else {
                host.call("rethrow", vec![error])
            }
        }
        ("optionBody", [field, value]) => {
            if yes!(c!("isNull", *value)) {
                return host.call("success", vec![*value]);
            }
            if field_kind!(*field, "array") && yes!(c!("isArray", *value)) {
                let values = c!("list");
                let state = c!("eachItem", *value, *field, values);
                let done = host.get(state, "done")?;
                if host.is_true(done)? {
                    let null = c!("null");
                    return host.call("success", vec![null]);
                }
                let schema = host.get(*field, "schema")?;
                let label = host.get(*field, "displayPath")?;
                c!("bounds", values, schema, label);
                return host.call("success", vec![values]);
            }
            if !yes!(c!("isString", *value)) {
                return host.call("success", vec![*value]);
            }
            let schema = host.get(*field, "schema")?;
            let label = host.get(*field, "displayPath")?;
            let parsed = run(host, "input", &[*value, schema, label])?;
            if field_kind!(*field, "array") && yes!(c!("isArray", parsed)) {
                let schema = host.get(*field, "schema")?;
                let label = host.get(*field, "displayPath")?;
                c!("bounds", parsed, schema, label);
            }
            host.call("success", vec![parsed])
        }
        ("optionItem", [item, field, values]) => {
            let text = c!("string", *item);
            let schema = host.get(*field, "schema")?;
            let label = host.get(*field, "displayPath")?;
            let parsed = c!("array", text, schema, label);
            if yes!(c!("isNull", parsed)) {
                host.call("done", vec![])
            } else {
                c!("append", *values, parsed);
                host.call("notDone", vec![])
            }
        }
        ("consume", [args, index, schema, label, inline]) => {
            if kind!(*schema, "boolean") {
                if !host.is_undefined(*inline)? {
                    let value = c!("scalar", *inline, *schema, *label);
                    return host.call("consumed", vec![*index, value]);
                }
                let next = c!("next", *args, *index);
                let explicit = host.is_kind(next, "true")? || host.is_kind(next, "false")? || {
                    let nullable = host.get(*schema, "nullable")?;
                    host.is_true(nullable)? && host.is_kind(next, "null")?
                };
                if explicit {
                    let next_index = c!("increment", *index);
                    let value = c!("scalar", next, *schema, *label);
                    return host.call("consumed", vec![next_index, value]);
                }
                let value = c!("true");
                return host.call("consumed", vec![*index, value]);
            }
            if !host.is_undefined(*inline)? {
                let value = run(host, "input", &[*inline, *schema, *label])?;
                return host.call("consumed", vec![*index, value]);
            }
            if kind!(*schema, "array") {
                let values = c!("list");
                let mut next_index = *index;
                let mut cursor = c!("increment", *index);
                loop {
                    if !yes!(c!("more", cursor, *args)) {
                        break;
                    }
                    let token = c!("at", *args, cursor);
                    let token = if host.is_nullish(token)? {
                        host.literal("")?
                    } else {
                        token
                    };
                    if yes!(c!("nextOption", token, *schema)) {
                        break;
                    }
                    let parsed = c!("array", token, *schema, *label);
                    if yes!(c!("isNull", parsed)) {
                        return host.call("consumed", vec![cursor, parsed]);
                    }
                    c!("append", values, parsed);
                    next_index = cursor;
                    cursor = c!("increment", cursor);
                }
                if yes!(c!("empty", values)) {
                    return host.call("missing", vec![*label]);
                }
                c!("bounds", values, *schema, *label);
                return host.call("consumed", vec![next_index, values]);
            }
            let next = c!("next", *args, *index);
            if host.is_undefined(next)? {
                return host.call("missing", vec![*label]);
            }
            let next_index = c!("increment", *index);
            let value = run(host, "input", &[next, *schema, *label])?;
            host.call("consumed", vec![next_index, value])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
