//! SDK argument validation and normalization policy. Host values stay opaque:
//! getters, descriptors, array methods and exceptions retain JavaScript identity.
use crate::host::Host;

fn yes<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn kind<H: Host>(host: &mut H, schema: H::Value, name: &str) -> Result<bool, H::Error> {
    let value = host.get(schema, "kind")?;
    host.is_kind(value, name)
}

fn unwrap<H: Host>(host: &mut H, mut schema: H::Value) -> Result<H::Value, H::Error> {
    for _ in 0..16_384 {
        if !kind(host, schema, "optional")? {
            return Ok(schema);
        }
        schema = host.get(schema, "inner")?;
    }
    host.call("overflow", vec![])
}

fn field_label<H: Host>(
    host: &mut H,
    label: H::Value,
    key: H::Value,
) -> Result<H::Value, H::Error> {
    if yes(host, "empty", vec![label])? {
        Ok(key)
    } else {
        host.call("fieldLabel", vec![label, key])
    }
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("mcpArguments", [schema, value]) => {
            let errors = host.call("array", vec![])?;
            let input = if host.is_nullish(*value)? {
                host.call("object", vec![])?
            } else {
                *value
            };
            let label = host.call("emptyString", vec![])?;
            let result = object(host, *schema, input, label, errors)?;
            crate::sdk::run(host, "validationErrors", &[errors])?;
            Ok(result)
        }
        ("mcpNative", [schema, value, label, errors]) => {
            let validation = host.call("validate", vec![*schema, *value])?;
            let ok = host.get(validation, "ok")?;
            if !host.is_true(ok)? {
                let issues = host.get(validation, "issues")?;
                host.call("nativeIssues", vec![*errors, *label, issues])?;
            }
            Ok(*value)
        }
        ("mcpReceived", [value]) => {
            if yes(host, "isNull", vec![*value])? {
                host.call("receivedNull", vec![])
            } else if host.is_undefined(*value)? {
                host.call("receivedMissing", vec![])
            } else if yes(host, "isArray", vec![*value])? {
                host.call("receivedArray", vec![*value])
            } else if yes(host, "isObject", vec![*value])? {
                let plain = yes(host, "isPlain", vec![*value])?;
                host.call(
                    if plain {
                        "receivedObject"
                    } else {
                        "receivedNonPlain"
                    },
                    vec![],
                )
            } else if yes(host, "isString", vec![*value])? {
                let text = if yes(host, "longReceived", vec![*value])? {
                    host.call("truncateReceived", vec![*value])?
                } else {
                    *value
                };
                host.call("quotedReceived", vec![text])
            } else {
                host.call("json", vec![*value])
            }
        }
        ("mcpEnumError", [value, schema, label]) => {
            let suggestion = if yes(host, "isString", vec![*value])? {
                let suggestions = host.call("suggestions", vec![*value, *schema])?;
                if yes(host, "positiveLength", vec![suggestions])? {
                    host.call("suggestionLine", vec![suggestions])?
                } else {
                    host.call("space", vec![])?
                }
            } else {
                host.call("space", vec![])?
            };
            host.call("enumMessage", vec![*value, *schema, *label, suggestion])
        }
        ("unwrap", [schema]) => unwrap(host, *schema),
        ("object", [schema, value, label, errors]) => {
            object(host, *schema, *value, *label, *errors)
        }
        ("value", [schema, input, label, errors]) => value(host, *schema, *input, *label, *errors),
        ("extra", [schema, input, label, errors, output, fields, key]) => {
            if !yes(host, "mapHas", vec![*fields, *key])? {
                let additional = host.get(*schema, "additionalProperties")?;
                if host.is_true(additional)? {
                    let item = host.call("property", vec![*input, *key])?;
                    host.call("define", vec![*output, *key, item])?;
                } else {
                    let field = field_label(host, *label, *key)?;
                    host.call("unexpected", vec![*errors, field, *fields, *label])?;
                }
            }
            Ok(*output)
        }
        ("field", [input, label, errors, output, input_key, output_key, raw]) => {
            let child = unwrap(host, *raw)?;
            let has = yes(host, "hasOwn", vec![*input, *input_key])?;
            let field = field_label(host, *label, *input_key)?;
            let absent = !has
                || (kind(host, *raw, "optional")? && {
                    let value = host.call("property", vec![*input, *input_key])?;
                    host.is_undefined(value)?
                });
            if absent {
                let default = host.get(child, "default")?;
                if !host.is_undefined(default)? {
                    let default = host.call("default", vec![child, field, *errors])?;
                    host.call("define", vec![*output, *output_key, default])?;
                } else if kind(host, *raw, "optional")? {
                    if !host.same(*input_key, *output_key)?
                        && yes(host, "aliasOwn", vec![*output, *output_key])?
                    {
                        let alias = field_label(host, *label, *output_key)?;
                        host.call("alias", vec![*errors, alias, field])?;
                    }
                } else {
                    host.call("missing", vec![*errors, field])?;
                }
            } else {
                let value = host.call("property", vec![*input, *input_key])?;
                let value = host.call("value", vec![*raw, value, field, *errors])?;
                host.call("define", vec![*output, *output_key, value])?;
            }
            Ok(*output)
        }
        ("native", [schema, value, label, errors]) => {
            let value = host.call("omit", vec![*schema, *value])?;
            if !yes(host, "isJson", vec![value])? {
                host.call("invalidJson", vec![*errors, *label])?;
                return Ok(value);
            }
            let value = host.call("normalize", vec![*schema, value])?;
            let validation = host.call("validate", vec![*schema, value])?;
            let ok = host.get(validation, "ok")?;
            if !host.is_true(ok)? {
                let issues = host.get(validation, "issues")?;
                host.call("nativeIssues", vec![*errors, *label, issues])?;
            }
            Ok(value)
        }
        ("normalize", [schema, value]) => normalize(host, *schema, *value),
        ("nativeFields", [schema]) => {
            let shapes = if kind(host, *schema, "object")? {
                let shape = host.get(*schema, "shape")?;
                host.call("singleShape", vec![shape])?
            } else if kind(host, *schema, "union")? {
                let branches = host.get(*schema, "branches")?;
                host.call("branchShapes", vec![branches])?
            } else if kind(host, *schema, "oneOf")? {
                let branches = host.get(*schema, "branches")?;
                let branches = host.call("values", vec![branches])?;
                host.call("branchShapes", vec![branches])?
            } else {
                host.call("array", vec![])?
            };
            host.call("shapeFields", vec![shapes])
        }
        ("omitDescriptor", [schema, property, depth, budget, member]) => {
            if !host.is_undefined(*property)? && yes(host, "hasValue", vec![*property])? {
                let schema = host.call("property", vec![*schema, *member])?;
                let value = host.get(*property, "value")?;
                let value = host.call("omitNext", vec![schema, value, *depth, *budget])?;
                host.call("descriptorValue", vec![*property, value])?;
            }
            Ok(*property)
        }
        ("normalizeField", [output, fields, key, item]) => {
            let field = host.call("mapGet", vec![*fields, *key])?;
            let output_key = if host.is_undefined(field)? {
                *key
            } else {
                host.get(field, "0")?
            };
            if yes(host, "hasOwn", vec![*output, output_key])? {
                return host.call("duplicate", vec![output_key]);
            }
            let item = if host.is_undefined(field)? {
                *item
            } else {
                let schema = host.get(field, "1")?;
                host.call("normalize", vec![schema, *item])?
            };
            host.call("define", vec![*output, output_key, item])
        }
        ("normalizeDefault", [output, key, child]) => {
            let field = unwrap(host, *child)?;
            if !yes(host, "hasOwn", vec![*output, *key])? {
                let default = host.get(field, "default")?;
                if !host.is_undefined(default)? {
                    let default = host.get(field, "default")?;
                    let default = host.call("clone", vec![default])?;
                    let default = host.call("normalize", vec![field, default])?;
                    host.call("define", vec![*output, *key, default])?;
                }
            }
            Ok(*output)
        }
        ("omit", [schema, value, depth, budget]) => omit(host, *schema, *value, *depth, *budget),
        ("omitField", [descriptors, key, field, depth, budget]) => {
            let property = host.call("property", vec![*descriptors, *key])?;
            if !host.is_undefined(property)? && yes(host, "hasValue", vec![property])? {
                let value = host.get(property, "value")?;
                if host.is_undefined(value)? && kind(host, *field, "optional")? {
                    host.call("delete", vec![*descriptors, *key])?;
                } else {
                    let value = host.get(property, "value")?;
                    let value = host.call("omitNext", vec![*field, value, *depth, *budget])?;
                    host.call("descriptorValue", vec![property, value])?;
                }
            }
            Ok(*descriptors)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

fn object<H: Host>(
    host: &mut H,
    schema: H::Value,
    input: H::Value,
    label: H::Value,
    errors: H::Value,
) -> Result<H::Value, H::Error> {
    let native = host.call("nativeSchema", vec![schema])?;
    if !host.is_undefined(native)? {
        return host.call("native", vec![schema, input, label, errors]);
    }
    if !yes(host, "isPlain", vec![input])? {
        host.call("invalidObject", vec![errors, label, input])?;
        return host.call("object", vec![]);
    }
    let output = host.call("object", vec![])?;
    let shape = host.get(schema, "shape")?;
    let fields = host.call("fields", vec![shape])?;
    host.call("extras", vec![schema, input, label, errors, output, fields])?;
    host.call("members", vec![input, label, errors, output, fields])?;
    Ok(output)
}

fn value<H: Host>(
    host: &mut H,
    raw: H::Value,
    value: H::Value,
    label: H::Value,
    errors: H::Value,
) -> Result<H::Value, H::Error> {
    let schema = unwrap(host, raw)?;
    if kind(host, raw, "optional")? && host.is_undefined(value)? {
        return host.call("default", vec![schema, label, errors]);
    }
    let native = host.call("nativeSchema", vec![schema])?;
    if !host.is_undefined(native)? {
        return host.call("native", vec![schema, value, label, errors]);
    }
    if yes(host, "isNull", vec![value])? {
        let nullable = host.get(schema, "nullable")?;
        if host.is_true(nullable)? {
            return Ok(value);
        }
    }
    let kind = host.get(schema, "kind")?;
    if host.is_kind(kind, "string")? {
        if !yes(host, "isString", vec![value])? {
            host.call("invalidString", vec![errors, label, value])?;
        } else {
            let length = host.call("unicodeLength", vec![value])?;
            constraints(host, schema, value, label, errors, length, true)?;
            let pattern = host.get(schema, "pattern")?;
            if !host.is_undefined(pattern)? {
                let pattern = host.get(schema, "pattern")?;
                if !yes(host, "matches", vec![pattern, value])? {
                    host.call("patternError", vec![errors, label, value, schema])?;
                }
            }
        }
    } else if host.is_kind(kind, "number")? {
        if !yes(host, "validNumber", vec![value, schema])? {
            host.call("invalidNumber", vec![errors, label, value, schema])?;
        }
    } else if host.is_kind(kind, "boolean")? {
        if !yes(host, "isBoolean", vec![value])? {
            host.call("invalidBoolean", vec![errors, label, value])?;
        }
    } else if host.is_kind(kind, "enum")? {
        let values = host.get(schema, "values")?;
        if !yes(host, "includes", vec![values, value])? {
            host.call("invalidEnum", vec![errors, label, value, schema])?;
        }
    } else if host.is_kind(kind, "array")? {
        if !yes(host, "isArray", vec![value])? {
            host.call("invalidArray", vec![errors, label, value])?;
        } else {
            // Read length only when each bound is present, as in the JS contract.
            let unused = host.call("undefined", vec![])?;
            constraints(host, schema, value, label, errors, unused, false)?;
            return host.call("arrayValues", vec![schema, value, label, errors]);
        }
    } else if host.is_kind(kind, "object")? {
        return host.call("validateObject", vec![schema, value, label, errors]);
    } else if host.is_kind(kind, "json")? {
        let validation = host.call("validate", vec![schema, value])?;
        let ok = host.get(validation, "ok")?;
        if !host.is_true(ok)? {
            let issues = host.get(validation, "issues")?;
            host.call("jsonIssues", vec![errors, label, issues])?;
        }
    } else if host.is_kind(kind, "record")? {
        if !yes(host, "isPlain", vec![value])? {
            host.call("invalidObject", vec![errors, label, value])?;
        } else {
            return host.call("recordValues", vec![schema, value, label, errors]);
        }
    } else if host.is_kind(kind, "oneOf")? {
        let discriminator = host.get(schema, "discriminator")?;
        let key = host.call("format", vec![discriminator])?;
        let resolved = host.call("discriminator", vec![schema, value, key, label, errors])?;
        if host.is_undefined(resolved)? {
            return Ok(value);
        }
        let branch = host.get(resolved, "branch")?;
        let value = host.get(resolved, "value")?;
        let value = host.call("validateObject", vec![branch, value, label, errors])?;
        return host.call("discriminatedValue", vec![value, schema, resolved]);
    } else if host.is_kind(kind, "union")? {
        return host.call("union", vec![schema, value, label, errors]);
    } else {
        return host.call("undefined", vec![]);
    }
    Ok(value)
}

fn constraints<H: Host>(
    host: &mut H,
    schema: H::Value,
    value: H::Value,
    label: H::Value,
    errors: H::Value,
    length: H::Value,
    string: bool,
) -> Result<(), H::Error> {
    let keys = if string {
        [
            ("minLength", "lt", "shortString"),
            ("maxLength", "gt", "longString"),
        ]
    } else {
        [
            ("minItems", "lt", "shortArray"),
            ("maxItems", "gt", "longArray"),
        ]
    };
    for (key, compare, error) in keys {
        let bound = host.get(schema, key)?;
        if !host.is_undefined(bound)? {
            let length = if string {
                length
            } else {
                host.get(value, "length")?
            };
            let bound = host.get(schema, key)?;
            if yes(host, compare, vec![length, bound])? {
                host.call(
                    error,
                    vec![errors, label, schema, if string { length } else { value }],
                )?;
            }
        }
    }
    Ok(())
}

fn normalize<H: Host>(host: &mut H, raw: H::Value, value: H::Value) -> Result<H::Value, H::Error> {
    let schema = unwrap(host, raw)?;
    if kind(host, schema, "array")? && yes(host, "isArray", vec![value])? {
        return host.call("normalizeArray", vec![schema, value]);
    }
    if kind(host, schema, "record")? && yes(host, "isPlain", vec![value])? {
        return host.call("normalizeRecord", vec![schema, value]);
    }
    if (kind(host, schema, "object")?
        || kind(host, schema, "union")?
        || kind(host, schema, "oneOf")?)
        && yes(host, "isPlain", vec![value])?
    {
        let fields = host.call("nativeFields", vec![schema])?;
        let output = host.call("object", vec![])?;
        host.call("normalizeMembers", vec![output, fields, value])?;
        if kind(host, schema, "object")? {
            let shape = host.get(schema, "shape")?;
            host.call("normalizeDefaults", vec![output, shape])?;
        }
        return Ok(output);
    }
    Ok(value)
}

fn omit<H: Host>(
    host: &mut H,
    raw: H::Value,
    value: H::Value,
    depth: H::Value,
    budget: H::Value,
) -> Result<H::Value, H::Error> {
    if yes(host, "omitExhausted", vec![depth, budget])? {
        return Ok(value);
    }
    let schema = unwrap(host, raw)?;
    if kind(host, schema, "array")? && yes(host, "isArray", vec![value])? {
        if yes(host, "oversizedArray", vec![value])? {
            return Ok(value);
        }
        let descriptors = host.call("descriptors", vec![value])?;
        host.call("omitArray", vec![schema, value, descriptors, depth, budget])?;
        return host.call("arrayDescriptors", vec![value, descriptors]);
    }
    if kind(host, schema, "record")? && yes(host, "isPlain", vec![value])? {
        let descriptors = host.call("descriptors", vec![value])?;
        host.call("omitRecord", vec![schema, descriptors, depth, budget])?;
        return host.call("objectDescriptors", vec![value, descriptors]);
    }
    if !yes(host, "isPlain", vec![value])?
        || (!kind(host, schema, "object")?
            && !kind(host, schema, "union")?
            && !kind(host, schema, "oneOf")?)
    {
        return Ok(value);
    }
    let descriptors = host.call("descriptors", vec![value])?;
    let fields = host.call("nativeFields", vec![schema])?;
    host.call("omitMembers", vec![descriptors, fields, depth, budget])?;
    host.call("objectDescriptors", vec![value, descriptors])
}
