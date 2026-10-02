//! Dynamic CLI object/default assembly, indexed arrays and validation diagnostics.
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
    match (operation, args) {
        ("unwrap", [schema]) => {
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "optional")? {
                let inner = host.get(*schema, "inner")?;
                host.call("unwrap", vec![inner])
            } else {
                Ok(*schema)
            }
        }
        ("nonemptyPart", [part]) => host.call(
            if host.is_kind(*part, "")? {
                "false"
            } else {
                "true"
            },
            vec![],
        ),
        ("issue", [issue, path]) => {
            let path = c!("issuePath", *issue, *path);
            let path = if yes!(path) {
                path
            } else {
                host.literal("parameters")?
            };
            host.call("issue", vec![path, *issue])
        }
        ("plain", [value]) => {
            let plain = yes!(c!("isObject", *value))
                && !yes!(c!("isNull", *value))
                && !yes!(c!("isArray", *value));
            host.call(if plain { "true" } else { "false" }, vec![])
        }
        ("invalidIndex", [index]) => {
            if !yes!(c!("integer", *index)) {
                host.call("true", vec![])
            } else {
                host.call("negative", vec![*index])
            }
        }
        ("finalize", [schema, value, path, errors]) => {
            let schema = c!("unwrap", *schema);
            if host.is_undefined(*value)? {
                return Ok(*value);
            }
            if yes!(c!("isNull", *value)) {
                let nullable = host.get(schema, "nullable")?;
                if host.is_true(nullable)? {
                    return Ok(*value);
                }
            }
            let kind = host.get(schema, "kind")?;
            for scalar in ["string", "number", "boolean", "enum"] {
                if host.is_kind(kind, scalar)? {
                    return Ok(*value);
                }
            }
            if host.is_kind(kind, "json")? {
                let validation = c!("validate", schema, *value);
                let ok = host.get(validation, "ok")?;
                if !yes!(ok) {
                    c!("pushIssues", *errors, validation, *path);
                }
                return Ok(*value);
            }
            if host.is_kind(kind, "array")? {
                let item = host.get(schema, "item")?;
                let item = c!("unwrap", item);
                let item_kind = host.get(item, "kind")?;
                if !host.is_kind(item_kind, "object")? {
                    return Ok(*value);
                }
                if !yes!(run(host, "plain", &[*value])?) {
                    c!("indexedError", *errors, *value, *path);
                    return Ok(*value);
                }
                let entries = c!("entries", *value);
                let indices = c!("indices", entries);
                if yes!(c!("invalidIndices", indices)) {
                    c!("numericError", *errors, *path);
                    return Ok(*value);
                }
                let mut index = c!("zero");
                while yes!(c!("more", index, indices)) {
                    let actual = c!("at", indices, index);
                    if !host.same(actual, index)? {
                        c!("contiguousError", *errors, *path);
                        return Ok(*value);
                    }
                    index = c!("increment", index);
                }
                return host.call("arrayValues", vec![indices, schema, *value, *path, *errors]);
            }
            if host.is_kind(kind, "object")? {
                if !yes!(run(host, "plain", &[*value])?) {
                    c!("objectError", *errors, *value, *path);
                    return Ok(*value);
                }
                let result = c!("object");
                c!("eachObject", schema, *value, *path, *errors, result);
                return Ok(result);
            }
            if host.is_kind(kind, "record")? {
                if !yes!(run(host, "plain", &[*value])?) {
                    c!("objectError", *errors, *value, *path);
                    return Ok(*value);
                }
                return host.call("record", vec![schema, *value, *path, *errors]);
            }
            c!("unsupported", *errors, schema, *path);
            Ok(*value)
        }
        ("objectChild", [key, raw, value, path, errors, result]) => {
            let child = c!("unwrap", *raw);
            let child_value = c!("property", *value, *key);
            let child_path = if yes!(c!("empty", *path)) {
                *key
            } else {
                c!("childPath", *path, *key)
            };
            if host.is_undefined(child_value)? {
                let default = host.get(child, "default")?;
                if !host.is_undefined(default)? {
                    c!("setDefault", *result, *key, child);
                    return host.call("undefined", vec![]);
                }
                let kind = host.get(*raw, "kind")?;
                if host.is_kind(kind, "optional")? {
                    return host.call("undefined", vec![]);
                }
                c!("missing", *errors, child_path);
            } else {
                c!(
                    "setValue",
                    *result,
                    *key,
                    *raw,
                    child_value,
                    child_path,
                    *errors
                );
            }
            host.call("undefined", vec![])
        }
        ("recordChild", [schema, key, value, path, errors]) => {
            let schema = host.get(*schema, "value")?;
            let path = if yes!(c!("empty", *path)) {
                *key
            } else {
                c!("childPath", *path, *key)
            };
            host.call("recurse", vec![schema, *value, path, *errors])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
