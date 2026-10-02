//! CLI scalar/array value admission and ordered validation diagnostics.
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
        ("received", [value]) => {
            let null = c!("isNull", *value);
            if host.is_true(null)? {
                return host.literal("null");
            }
            if host.is_undefined(*value)? {
                return host.literal("missing");
            }
            let array = c!("isArray", *value);
            if yes!(array) {
                return host.call("arrayDescription", vec![*value]);
            }
            let object = c!("isObject", *value);
            if host.is_true(object)? {
                return host.literal("object");
            }
            let string = c!("isString", *value);
            if host.is_true(string)? {
                let long = c!("longString", *value);
                let value = if host.is_true(long)? {
                    c!("truncate", *value)
                } else {
                    *value
                };
                return host.call("quoted", vec![value]);
            }
            host.call("json", vec![*value])
        }
        ("errorMessage", [error]) => {
            let error_type = c!("isError", *error);
            if host.is_true(error_type)? {
                host.get(*error, "message")
            } else {
                host.call("string", vec![*error])
            }
        }
        ("boolean", [value, label]) => {
            let normalized = c!("booleanText", *value);
            if host.is_kind(normalized, "true")? {
                host.call("true", vec![])
            } else if host.is_kind(normalized, "false")? {
                host.call("false", vec![])
            } else {
                host.call("booleanError", vec![*value, *label])
            }
        }
        ("enum", [value, values, label]) => {
            let matched = c!("findEnum", *values, *value);
            if !host.is_undefined(matched)? {
                return Ok(matched);
            }
            let suggestions = c!("suggestions", *value, *values);
            let length = host.get(suggestions, "length")?;
            let positive = c!("positive", length);
            let line = if host.is_true(positive)? {
                c!("suggestionLine", suggestions)
            } else {
                host.literal(" ")?
            };
            host.call("enumError", vec![*value, *values, *label, line])
        }
        ("enumMatch", [candidate, value]) => {
            let candidate = c!("string", *candidate);
            host.call(
                if host.same(candidate, *value)? {
                    "true"
                } else {
                    "false"
                },
                vec![],
            )
        }
        ("string", [value, schema, label]) => {
            let length = c!("unicodeLength", *value);
            let min = host.get(*schema, "minLength")?;
            if !host.is_undefined(min)? {
                let failed = c!("stringMin", length, *schema);
                if host.is_true(failed)? {
                    return host.call("minString", vec![*schema, *label, length]);
                }
            }
            let max = host.get(*schema, "maxLength")?;
            if !host.is_undefined(max)? {
                let failed = c!("stringMax", length, *schema);
                if host.is_true(failed)? {
                    return host.call("maxString", vec![*schema, *label, length]);
                }
            }
            let pattern = host.get(*schema, "pattern")?;
            if !host.is_undefined(pattern)? {
                let pattern = host.get(*schema, "pattern")?;
                let valid = c!("pattern", *value, pattern);
                if !yes!(valid) {
                    return host.call("patternError", vec![*value, *schema, *label]);
                }
            }
            Ok(*value)
        }
        ("pattern", [value, pattern]) => host.call("pattern", vec![*value, *pattern]),
        ("json", [value, label]) => {
            let parsed = c!("jsonResult", *value);
            let failed = host.get(parsed, "failed")?;
            if host.is_true(failed)? {
                let error = host.get(parsed, "error")?;
                host.call("jsonError", vec![*value, *label, error])
            } else {
                host.get(parsed, "value")
            }
        }
        ("available", [values]) => host.call("available", vec![*values]),
        ("scalar", [value, schema, label]) => {
            if host.is_kind(*value, "null")? {
                let nullable = host.get(*schema, "nullable")?;
                if host.is_true(nullable)? {
                    return host.call("null", vec![]);
                }
            }
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "string")? {
                return run(host, "string", args);
            }
            if host.is_kind(kind, "number")? {
                let parsed = c!("number", *value);
                let blank = c!("blank", *value);
                let invalid = if host.is_true(blank)? {
                    true
                } else {
                    let valid = c!("validNumber", parsed, *schema);
                    !yes!(valid)
                };
                return if invalid {
                    host.call("numberError", vec![*value, *schema, *label])
                } else {
                    Ok(parsed)
                };
            }
            if host.is_kind(kind, "boolean")? {
                return run(host, "boolean", &[*value, *label]);
            }
            if host.is_kind(kind, "enum")? {
                let values = host.get(*schema, "values")?;
                return run(host, "enum", &[*value, values, *label]);
            }
            let mut kinds = Vec::new();
            for kind in ["boolean", "enum", "number", "string"] {
                kinds.push(host.literal(kind)?);
            }
            let kinds = host.call("list", kinds)?;
            host.call("unsupported", vec![kinds])
        }
        ("unwrap", [schema]) => {
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "optional")? {
                let inner = host.get(*schema, "inner")?;
                host.call("unwrap", vec![inner])
            } else {
                Ok(*schema)
            }
        }
        ("array", [value, schema, label]) => {
            if host.is_kind(*value, "null")? {
                let nullable = host.get(*schema, "nullable")?;
                if host.is_true(nullable)? {
                    return host.call("null", vec![]);
                }
            }
            let item = host.get(*schema, "item")?;
            let item = c!("unwrap", item);
            let kind = host.get(item, "kind")?;
            let nonscalar = if host.is_kind(kind, "array")? {
                true
            } else {
                let kind = host.get(item, "kind")?;
                host.is_kind(kind, "object")?
            };
            if nonscalar {
                host.call("nonscalarArray", vec![*label])
            } else {
                host.call("arrayItems", vec![*value, item, *label])
            }
        }
        ("arrayBounds", [value, schema, label]) => {
            let min = host.get(*schema, "minItems")?;
            if !host.is_undefined(min)? {
                let failed = c!("arrayMin", *value, *schema);
                if host.is_true(failed)? {
                    return host.call("minArray", vec![*value, *schema, *label]);
                }
            }
            let max = host.get(*schema, "maxItems")?;
            if !host.is_undefined(max)? {
                let failed = c!("arrayMax", *value, *schema);
                if host.is_true(failed)? {
                    return host.call("maxArray", vec![*value, *schema, *label]);
                }
            }
            host.call("undefined", vec![])
        }
        ("missing", [field]) => {
            let message = c!("missingBase", *field);
            let schema = host.get(*field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "enum")? {
                host.call("missingEnum", vec![*field, message])
            } else {
                Ok(message)
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
