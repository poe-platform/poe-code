//! Approval plan admission, canonical traversal and hash comparison policies.
use crate::host::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("isValue", [value]) => {
            let primitive = host.call("primitive", vec![*value])?;
            if host.is_true(primitive)? {
                return Ok(primitive);
            }
            let number = host.call("number", vec![*value])?;
            if host.is_true(number)? {
                return host.call("finite", vec![*value]);
            }
            let array = host.call("array", vec![*value])?;
            if host.is_true(array)? {
                return host.call("every", vec![*value]);
            }
            let object = host.call("object", vec![*value])?;
            if !host.is_true(object)? {
                return Ok(object);
            }
            let plain = host.call("plain", vec![*value])?;
            if !host.is_true(plain)? {
                return Ok(plain);
            }
            host.call("everyValue", vec![*value])
        }
        ("normalize", [value, seen]) => {
            let primitive = host.call("primitive", vec![*value])?;
            if host.is_true(primitive)? {
                return Ok(*value);
            }
            let number = host.call("number", vec![*value])?;
            if host.is_true(number)? {
                let finite = host.call("finite", vec![*value])?;
                if !host.is_true(finite)? {
                    return host.call("nonFinite", vec![]);
                }
                return Ok(*value);
            }
            let object = host.call("object", vec![*value])?;
            if !host.is_true(object)? {
                return host.call("invalidValue", vec![]);
            }
            let circular = host.call("has", vec![*seen, *value])?;
            if host.is_true(circular)? {
                return host.call("circular", vec![]);
            }
            host.call("add", vec![*seen, *value])?;
            // The host owns finally semantics when a nested getter throws.
            host.call("withSeen", vec![*value, *seen])
        }
        ("children", [value, seen]) => {
            let array = host.call("array", vec![*value])?;
            if host.is_true(array)? {
                return host.call("map", vec![*value, *seen]);
            }
            let plain = host.call("plain", vec![*value])?;
            if !host.is_true(plain)? {
                return host.call("invalidValue", vec![]);
            }
            host.call("members", vec![*value, *seen])
        }
        ("create", [value]) => {
            let seen = host.call("set", vec![])?;
            let normalized = run(host, "normalize", &[*value, seen])?;
            let canonical = host.call("canonical", vec![normalized])?;
            let digest = host.call("digest", vec![canonical])?;
            let display = host.call("display", vec![normalized])?;
            host.call("plan", vec![normalized, canonical, display, digest])
        }
        ("assertHash", [expected, actual]) => {
            if !host.same(*expected, *actual)? {
                return host.call("changed", vec![*expected, *actual]);
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
