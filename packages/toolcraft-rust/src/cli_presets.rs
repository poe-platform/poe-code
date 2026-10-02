//! Preset-file validation, nested-field routing and read-error policy.
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
        ("plain", [value]) => {
            let object = c!("isObject", *value);
            if host.is_true(object)? {
                let null = c!("isNull", *value);
                if !host.is_true(null)? {
                    let array = c!("isArray", *value);
                    return host.call(
                        if host.is_true(array)? {
                            "false"
                        } else {
                            "true"
                        },
                        vec![],
                    );
                }
            }
            host.call("false", vec![])
        }
        ("readError", [error, path]) => {
            let object = c!("isObject", *error);
            if host.is_true(object)? {
                let null = c!("isNull", *error);
                if !host.is_true(null)? {
                    let own = c!("ownCode", *error);
                    if yes!(own) {
                        let code = host.get(*error, "code")?;
                        if host.is_kind(code, "ENOENT")? {
                            return host.call("missing", vec![*path]);
                        }
                    }
                }
            }
            let error_type = c!("isError", *error);
            let message = if host.is_true(error_type)? {
                let message = host.get(*error, "message")?;
                let nonempty = c!("nonempty", message);
                if host.is_true(nonempty)? {
                    host.get(*error, "message")?
                } else {
                    host.literal("Unknown read error.")?
                }
            } else {
                host.literal("Unknown read error.")?
            };
            host.call("readError", vec![*path, message])
        }
        ("expected", [schema]) => {
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "array")? {
                return host.literal("an array");
            }
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "number")? {
                return host.call("expectedNumber", vec![*schema]);
            }
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "json")? {
                return host.literal("valid JSON");
            }
            let kind = host.get(*schema, "kind")?;
            host.call(
                if host.is_kind(kind, "enum")? {
                    "expectedEnum"
                } else {
                    "expectedOther"
                },
                vec![*schema],
            )
        }
        ("scalar", [value, schema, field_path, preset_path]) => {
            let null = c!("isNull", *value);
            if host.is_true(null)? {
                let nullable = host.get(*schema, "nullable")?;
                if host.is_true(nullable)? {
                    return Ok(*value);
                }
            }
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "string")? {
                let string = c!("isString", *value);
                if host.is_true(string)? {
                    let length = c!("unicodeLength", *value);
                    let min = host.get(*schema, "minLength")?;
                    if !host.is_undefined(min)? {
                        let failed = c!("stringMin", length, *schema);
                        if host.is_true(failed)? {
                            return host.call(
                                "minString",
                                vec![*schema, *field_path, *preset_path, length],
                            );
                        }
                    }
                    let max = host.get(*schema, "maxLength")?;
                    if !host.is_undefined(max)? {
                        let failed = c!("stringMax", length, *schema);
                        if host.is_true(failed)? {
                            return host.call(
                                "maxString",
                                vec![*schema, *field_path, *preset_path, length],
                            );
                        }
                    }
                    let pattern = host.get(*schema, "pattern")?;
                    if !host.is_undefined(pattern)? {
                        let pattern = host.get(*schema, "pattern")?;
                        let matches = c!("pattern", *value, pattern);
                        if !yes!(matches) {
                            return host.call(
                                "patternError",
                                vec![*value, *schema, *field_path, *preset_path],
                            );
                        }
                    }
                    return Ok(*value);
                }
            } else if host.is_kind(kind, "number")? {
                let valid = c!("validNumber", *value, *schema);
                if yes!(valid) {
                    return Ok(*value);
                }
            } else if host.is_kind(kind, "boolean")? {
                let boolean = c!("isBoolean", *value);
                if host.is_true(boolean)? {
                    return Ok(*value);
                }
            } else if host.is_kind(kind, "enum")? {
                let matched = c!("findEnum", *schema, *value);
                if !host.is_undefined(matched)? {
                    return Ok(matched);
                }
            }
            host.call("invalidScalar", args.to_vec())
        }
        ("field", [value, field, path]) => {
            let schema = host.get(*field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "json")? {
                return Ok(*value);
            }
            let schema = host.get(*field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if !host.is_kind(kind, "array")? {
                return host.call("scalarField", args.to_vec());
            }
            let null = c!("isNull", *value);
            if host.is_true(null)? {
                let schema = host.get(*field, "schema")?;
                let nullable = host.get(schema, "nullable")?;
                if host.is_true(nullable)? {
                    return Ok(*value);
                }
            }
            let schema = host.get(*field, "schema")?;
            let item = host.get(schema, "item")?;
            let item = c!("unwrap", item);
            let kind = host.get(item, "kind")?;
            let nonscalar = if host.is_kind(kind, "array")? {
                true
            } else {
                let kind = host.get(item, "kind")?;
                host.is_kind(kind, "object")?
            };
            if nonscalar {
                return host.call("nonscalar", vec![*field]);
            }
            let array = c!("isArray", *value);
            if !yes!(array) {
                return host.call("notArray", args.to_vec());
            }
            let schema = host.get(*field, "schema")?;
            let min = host.get(schema, "minItems")?;
            if !host.is_undefined(min)? {
                let failed = c!("arrayMin", *value, *field);
                if host.is_true(failed)? {
                    return host.call("minArray", args.to_vec());
                }
            }
            let schema = host.get(*field, "schema")?;
            let max = host.get(schema, "maxItems")?;
            if !host.is_undefined(max)? {
                let failed = c!("arrayMax", *value, *field);
                if host.is_true(failed)? {
                    return host.call("maxArray", args.to_vec());
                }
            }
            host.call("mapItems", vec![*value, item, *field, *path])
        }
        ("nested", [fields, path]) => host.call("nested", vec![*fields, *path]),
        ("nestedField", [field, path]) => {
            let shorter = c!("shorter", *field, *path);
            if yes!(shorter) {
                host.call("prefix", vec![*field, *path])
            } else {
                Ok(shorter)
            }
        }
        ("load", [fields, dynamic_fields, path, raw]) => {
            let parsed = c!("parse", *raw);
            let ok = host.get(parsed, "ok")?;
            if !host.is_true(ok)? {
                let error = host.get(parsed, "error")?;
                return host.call("jsonError", vec![*path, *raw, error]);
            }
            let value = host.get(parsed, "value")?;
            let plain = run(host, "plain", &[value])?;
            if !yes!(plain) {
                return host.call("notObject", vec![*path]);
            }
            let state = c!("initialize", *fields, *dynamic_fields, *path);
            let path = c!("emptyPath");
            c!("visit", state, value, path);
            host.call("result", vec![state])
        }
        ("entry", [state, value, path, display_path]) => {
            let field = c!("field", *state, *display_path);
            if !host.is_undefined(field)? {
                return host.call("writeField", vec![*state, field, *value]);
            }
            let field = c!("dynamic", *state, *display_path);
            if !host.is_undefined(field)? {
                let validation = c!("validate", field, *value);
                let ok = host.get(validation, "ok")?;
                if !yes!(ok) {
                    return host.call("dynamicError", vec![*state, *display_path, validation]);
                }
                return host.call("writeDynamic", vec![*state, field, validation]);
            }
            let fields = host.get(*state, "allFields")?;
            let nested = c!("nested", fields, *path);
            if !yes!(nested) {
                return host.call("unknown", vec![*state, *display_path]);
            }
            let plain = run(host, "plain", &[*value])?;
            if !yes!(plain) {
                return host.call("notNested", vec![*state, *display_path, *value]);
            }
            host.call("visit", vec![*state, *value, *path])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
