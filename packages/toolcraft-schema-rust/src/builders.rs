//! Descriptor construction and constructor validation. Host operations preserve
//! object spread, method callbacks and attached Standard Schema closures.
use crate::host_values::Kind;
use crate::validate::{Host, cat, entries, get, is, text, u, values, yes};
use std::collections::HashMap;

struct BranchGroup<V> {
    keys: Vec<Vec<u16>>,
    positions: Vec<V>,
}

pub(crate) fn fail<H: Host>(host: &mut H, message: Vec<u16>) -> Result<(), H::Error> {
    let message = host.make_string(message)?;
    host.call("error", vec![message]).map(|_| ())
}
pub(crate) fn object<H: Host>(
    host: &mut H,
    properties: Vec<(&str, H::Value)>,
) -> Result<H::Value, H::Error> {
    let result = host.call("object", vec![])?;
    for (name, value) in properties {
        host.define(result, &u(name), value)?;
    }
    Ok(result)
}
fn integer<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    if host.kind(value)? != Kind::Number {
        return Ok(false);
    }
    let number = host.number(value)?;
    Ok(number.is_finite() && number.fract() == 0.0)
}
fn finite<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    Ok(host.kind(value)? == Kind::Number && host.number(value)?.is_finite())
}
pub fn invalid_enum_value<H: Host>(
    host: &mut H,
    value: H::Value,
    require_integer: bool,
) -> Result<bool, H::Error> {
    if require_integer {
        return integer(host, value).map(|valid| !valid);
    }
    Ok(host.kind(value)? == Kind::Number && !host.number(value)?.is_finite())
}
fn assert_bound<H: Host>(
    host: &mut H,
    options: H::Value,
    name: &str,
    nonnegative: bool,
) -> Result<(), H::Error> {
    let value = get(host, options, name)?;
    if host.kind(value)? == Kind::Undefined {
        return Ok(());
    }
    let valid = if nonnegative {
        integer(host, value)? && host.number(value)? >= 0.0
    } else {
        finite(host, value)?
    };
    if !valid {
        fail(
            host,
            u(&format!(
                "{name} must be {}",
                if nonnegative {
                    "a non-negative integer"
                } else {
                    "finite"
                }
            )),
        )?;
    }
    Ok(())
}
fn assert_order<H: Host>(
    host: &mut H,
    options: H::Value,
    min: &str,
    max: &str,
) -> Result<(), H::Error> {
    let minimum = get(host, options, min)?;
    let maximum = get(host, options, max)?;
    if host.kind(minimum)? != Kind::Undefined && host.kind(maximum)? != Kind::Undefined {
        let invalid = host.call("greater", vec![minimum, maximum])?;
        if yes(host, invalid)? {
            fail(
                host,
                u(&format!("{min} must be less than or equal to {max}")),
            )?;
        }
    }
    Ok(())
}
fn assert_default<H: Host>(host: &mut H, schema: H::Value) -> Result<(), H::Error> {
    let default = get(host, schema, "default")?;
    if host.kind(default)? == Kind::Undefined {
        return Ok(());
    }
    let default = get(host, schema, "default")?;
    let result = host.call("validateDescriptor", vec![schema, default])?;
    let ok = get(host, result, "ok")?;
    if !yes(host, ok)? {
        let issues = get(host, result, "issues")?;
        let first = get(host, issues, "0")?;
        let message = if matches!(host.kind(first)?, Kind::Undefined | Kind::Null) {
            host.undefined()?
        } else {
            get(host, first, "message")?
        };
        let message = if matches!(host.kind(message)?, Kind::Undefined | Kind::Null) {
            u("invalid default")
        } else {
            text(host, message, true)?
        };
        fail(host, cat(&[&u("default must satisfy schema: "), &message]))?;
    }
    Ok(())
}

pub fn build<H: Host>(
    host: &mut H,
    kind: &str,
    first: H::Value,
    second: H::Value,
) -> Result<H::Value, H::Error> {
    let options = if matches!(kind, "enum" | "array" | "object") {
        second
    } else {
        first
    };
    match kind {
        "string" | "array" => {
            let (min, max) = if kind == "string" {
                ("minLength", "maxLength")
            } else {
                ("minItems", "maxItems")
            };
            assert_bound(host, options, min, true)?;
            assert_bound(host, options, max, true)?;
            assert_order(host, options, min, max)?;
            if kind == "string" {
                let pattern = get(host, options, "pattern")?;
                if host.kind(pattern)? != Kind::Undefined {
                    let compiled = host.call("compilePattern", vec![pattern])?;
                    if host.kind(compiled)? == Kind::Undefined {
                        fail(host, u("pattern must be a valid regular expression"))?;
                    }
                }
            }
        }
        "number" => {
            assert_bound(host, options, "minimum", false)?;
            assert_bound(host, options, "maximum", false)?;
            assert_order(host, options, "minimum", "maximum")?;
            assert_bound(host, options, "default", false)?;
            let json_type = get(host, options, "jsonType")?;
            if is(host, json_type, "integer")? {
                let default = get(host, options, "default")?;
                if host.kind(default)? != Kind::Undefined {
                    let default = get(host, options, "default")?;
                    if !integer(host, default)? {
                        fail(host, u("default must be an integer"))?;
                    }
                }
            }
        }
        "enum" => {
            let length = get(host, first, "length")?;
            if host.kind(length)? == Kind::Number && host.number(length)? == 0.0 {
                fail(host, u("Enum schema requires at least one value"))?;
            }
            let unique = host.call("setSize", vec![first])?;
            let length = get(host, first, "length")?;
            let equal = host.call("strictEqual", vec![unique, length])?;
            if !yes(host, equal)? {
                fail(host, u("Enum schema values must be unique"))?;
            }
            let integer = host.make_boolean(false)?;
            let invalid = host.call("someInvalidEnum", vec![first, integer])?;
            if crate::validate::truthy(host, invalid)? {
                fail(host, u("Enum schema numeric values must be finite"))?;
            }
            let json_type = get(host, options, "jsonType")?;
            if is(host, json_type, "integer")? {
                let integer = host.make_boolean(true)?;
                let invalid = host.call("someInvalidEnum", vec![first, integer])?;
                if crate::validate::truthy(host, invalid)? {
                    fail(host, u("Integer enum values must be integers"))?;
                }
            }
        }
        "oneOf" => {
            let branches = get(host, first, "branches")?;
            let discriminator = get(host, first, "discriminator")?;
            if host.keys(branches)?.is_empty() {
                fail(host, u("OneOf schema requires at least one branch"))?;
            }
            for (name, branch) in entries(host, branches)? {
                let shape = get(host, branch, "shape")?;
                let declared = host.call("hasOwn", vec![shape, discriminator])?;
                if yes(host, declared)? {
                    let discriminator = text(host, discriminator, true)?;
                    fail(
                        host,
                        cat(&[
                            &u("OneOf branch \""),
                            &name,
                            &u("\" must not declare discriminator field \""),
                            &discriminator,
                            &u("\"."),
                        ]),
                    )?;
                }
            }
        }
        "union" => {
            let length = get(host, first, "length")?;
            if host.kind(length)? == Kind::Number && host.number(length)? == 0.0 {
                fail(host, u("Union schema requires at least one branch"))?;
            }
            let records = host.call("branchFingerprints", vec![first])?;
            let mut index = HashMap::new();
            let mut groups: Vec<BranchGroup<H::Value>> = Vec::new();
            for record in values(host, records)? {
                let keys = get(host, record, "0")?;
                let keys = values(host, keys)?
                    .into_iter()
                    .map(|key| host.string(key))
                    .collect::<Result<Vec<_>, _>>()?;
                let position = get(host, record, "1")?;
                let group = *index.entry(keys.clone()).or_insert_with(|| {
                    groups.push(BranchGroup {
                        keys,
                        positions: Vec::new(),
                    });
                    groups.len() - 1
                });
                groups[group].positions.push(position);
            }
            for BranchGroup { keys, positions } in groups {
                if positions.len() > 1 {
                    let positions = host.call("array", positions)?;
                    let positions = host.call("joinComma", vec![positions])?;
                    let positions = text(host, positions, true)?;
                    fail(
                        host,
                        cat(&[
                            &u("Union branches ["),
                            &positions,
                            &u("] share required-key fingerprint \""),
                            &crate::validate::join(&keys, "+"),
                            &u("\". Each branch must require a distinct set of keys."),
                        ]),
                    )?;
                }
            }
        }
        _ => {}
    }
    let kind_value = host.make_string(u(kind))?;
    let mut fields = vec![("kind", kind_value)];
    match kind {
        "array" => fields.push(("item", first)),
        "object" => fields.push(("shape", first)),
        "enum" => fields.push(("values", first)),
        "optional" => fields.push(("inner", first)),
        "record" => fields.push(("value", first)),
        "union" => fields.push(("branches", first)),
        "oneOf" => {
            fields.push(("discriminator", get(host, first, "discriminator")?));
            fields.push(("branches", get(host, first, "branches")?));
        }
        _ => {}
    }
    let mut schema = object(host, fields)?;
    if matches!(
        kind,
        "string" | "number" | "boolean" | "enum" | "array" | "object" | "json"
    ) {
        schema = host.call("spread", vec![schema, options])?;
    }
    if matches!(
        kind,
        "string" | "number" | "boolean" | "enum" | "array" | "object"
    ) {
        assert_default(host, schema)?;
    }
    host.call("standardize", vec![schema])
}
