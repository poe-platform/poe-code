//! Shared number admission and diagnostics with observable caller-realm operations.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("valid", [value, schema]) => {
            let number = c!("isNumber", *value);
            if !host.is_true(number)? {
                return Ok(number);
            }
            let finite = c!("finite", *value);
            let truthy = c!("truthy", finite);
            if !host.is_true(truthy)? {
                return Ok(finite);
            }
            let kind = host.get(*schema, "jsonType")?;
            if host.is_kind(kind, "integer")? {
                let integer = c!("integer", *value);
                let truthy = c!("truthy", integer);
                if !host.is_true(truthy)? {
                    return Ok(integer);
                }
            }
            for (key, compare) in [("minimum", "gte"), ("maximum", "lte")] {
                let bound = host.get(*schema, key)?;
                if !host.is_undefined(bound)? {
                    let bound = host.get(*schema, key)?;
                    let accepted = host.call(compare, vec![*value, bound])?;
                    if !host.is_true(accepted)? {
                        return Ok(accepted);
                    }
                }
            }
            host.call("true", vec![])
        }
        ("describe", [schema]) => {
            let kind = host.get(*schema, "jsonType")?;
            let kind = host.literal(if host.is_kind(kind, "integer")? {
                "an integer"
            } else {
                "a number"
            })?;
            let mut bounds = Vec::with_capacity(2);
            for (key, prefix) in [
                ("minimum", "greater than or equal to "),
                ("maximum", "less than or equal to "),
            ] {
                let bound = host.get(*schema, key)?;
                bounds.push(if host.is_undefined(bound)? {
                    bound
                } else {
                    let bound = host.get(*schema, key)?;
                    let prefix = host.literal(prefix)?;
                    c!("interpolate", prefix, bound)
                });
            }
            let bounds = host.call("bounds", bounds)?;
            let length = host.get(bounds, "length")?;
            let empty = c!("zero", length);
            if host.is_true(empty)? {
                Ok(kind)
            } else {
                let separator = host.literal(" and ")?;
                let joined = c!("join", bounds, separator);
                host.call("description", vec![kind, joined])
            }
        }
        ("bound", [bound]) => host.call(
            if host.is_undefined(*bound)? {
                "false"
            } else {
                "true"
            },
            vec![],
        ),
        _ => host.call("invalidOperation", vec![]),
    }
}
