//! Result projection uses source keys for validation and cased keys on the wire.
use crate::host::Host;
use crate::sdk_validation::{constraints, field_label, kind, unwrap, yes};

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("resultValue", [raw, value, label, errors]) => {
            let schema = unwrap(host, *raw)?;
            let native = c!("nativeSchema", schema);
            if !host.is_undefined(native)? {
                return host.call("native", vec![schema, *value, *label, *errors]);
            }
            if kind(host, *raw, "optional")? && host.is_undefined(*value)? {
                let default = host.get(schema, "default")?;
                return if host.is_undefined(default)? {
                    host.call("undefined", vec![])
                } else {
                    let default = host.get(schema, "default")?;
                    let cloned = c!("clone", default);
                    host.call("resultValue", vec![schema, cloned, *label, *errors])
                };
            }
            if yes(host, "isNull", vec![*value])? {
                let nullable = host.get(schema, "nullable")?;
                if host.is_true(nullable)? {
                    return Ok(*value);
                }
            }
            let schema_kind = host.get(schema, "kind")?;
            if host.is_kind(schema_kind, "object")? {
                host.call("resultObject", vec![schema, *value, *label, *errors])
            } else if host.is_kind(schema_kind, "array")? {
                if !yes(host, "isArray", vec![*value])? {
                    c!("invalidArray", *errors, *label, *value);
                    return Ok(*value);
                }
                let unused = c!("undefined");
                constraints(host, schema, *value, *label, *errors, unused, false)?;
                host.call("resultArray", vec![schema, *value, *label, *errors])
            } else if host.is_kind(schema_kind, "record")? {
                if !yes(host, "isPlain", vec![*value])? {
                    c!("invalidObject", *errors, *label, *value);
                    return Ok(*value);
                }
                host.call("resultRecord", vec![schema, *value, *label, *errors])
            } else if host.is_kind(schema_kind, "oneOf")? {
                let key = host.get(schema, "discriminator")?;
                let resolved = c!("discriminator", schema, *value, key, *label, *errors);
                if host.is_undefined(resolved)? {
                    return Ok(*value);
                }
                let branch = host.get(resolved, "branch")?;
                let value = host.get(resolved, "value")?;
                let output = c!("resultObject", branch, value, *label, *errors);
                host.call("resultDiscriminated", vec![output, schema, resolved])
            } else if host.is_kind(schema_kind, "union")? {
                host.call("resultUnion", vec![schema, *value, *label, *errors])
            } else {
                host.call("value", vec![*raw, *value, *label, *errors])
            }
        }
        ("resultObject", [schema, value, label, errors]) => {
            if !yes(host, "isPlain", vec![*value])? {
                c!("invalidObject", *errors, *label, *value);
                return host.call("object", vec![]);
            }
            let output = c!("object");
            let shape = host.get(*schema, "shape")?;
            let expected = c!("expectedKeys", shape);
            c!("resultExtras", *schema, *value, *label, *errors, expected);
            let shape = host.get(*schema, "shape")?;
            c!("resultMembers", shape, *value, *label, *errors, output);
            let additional = host.get(*schema, "additionalProperties")?;
            if host.is_true(additional)? {
                let wire = c!("wireKeys", expected);
                c!("resultCarry", *value, expected, wire, output);
            }
            Ok(output)
        }
        ("resultExtra", [schema, label, errors, expected, key]) => {
            if !yes(host, "setHas", vec![*expected, *key])? {
                let additional = host.get(*schema, "additionalProperties")?;
                if !host.is_true(additional)? {
                    let field = field_label(host, *label, *key)?;
                    c!("unexpectedResult", *errors, field, *expected, *label);
                }
            }
            host.call("undefined", vec![])
        }
        ("resultField", [value, label, errors, output, key, raw]) => {
            let child = unwrap(host, *raw)?;
            let has = yes(host, "hasOwn", vec![*value, *key])?;
            let wire = c!("format", *key);
            let field = field_label(host, *label, *key)?;
            let absent = !has
                || (kind(host, *raw, "optional")? && {
                    let item = c!("property", *value, *key);
                    host.is_undefined(item)?
                });
            if absent {
                let default = host.get(child, "default")?;
                if !host.is_undefined(default)? {
                    let default = host.get(child, "default")?;
                    let cloned = c!("clone", default);
                    let converted = c!("resultValue", child, cloned, field, *errors);
                    c!("define", *output, wire, converted);
                } else if !kind(host, *raw, "optional")? {
                    c!("missingResult", *errors, field);
                }
            } else {
                let item = c!("property", *value, *key);
                let converted = c!("resultValue", *raw, item, field, *errors);
                c!("define", *output, wire, converted);
            }
            Ok(*output)
        }
        ("resultCarryField", [value, expected, wire, output, key]) => {
            if !yes(host, "setHas", vec![*expected, *key])?
                && !yes(host, "setHas", vec![*wire, *key])?
            {
                let item = c!("property", *value, *key);
                c!("define", *output, *key, item);
            }
            Ok(*output)
        }
        ("resultCommand", [schema, value]) => {
            let errors = c!("array");
            let label = c!("emptyString");
            let result = c!("resultValue", *schema, *value, label, errors);
            run(host, "resultErrors", &[errors])?;
            Ok(result)
        }
        ("resultErrors", [errors]) => {
            if yes(host, "empty", vec![*errors])? {
                return host.call("undefined", vec![]);
            }
            let single = yes(host, "single", vec![*errors])?;
            host.call(
                if single {
                    "singleResultError"
                } else {
                    "multipleResultErrors"
                },
                vec![*errors],
            )
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
