//! MCP JSON-schema projection, requiredness and default metadata policy.
use crate::host::Host;
use crate::sdk_validation::{kind, unwrap, yes};

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("casing", [source, casing, direction, schema]) => {
            let canonical = unwrap(host, *source)?;
            let native = c!("nativeSchema", canonical);
            if !host.is_undefined(native)? {
                return Ok(*schema);
            }
            let branches = if kind(host, canonical, "oneOf")? {
                let branches = host.get(canonical, "branches")?;
                c!("values", branches)
            } else if kind(host, canonical, "union")? {
                host.get(canonical, "branches")?
            } else {
                c!("array")
            };
            let one_of = c!("oneOf", *schema, canonical, branches, *casing, *direction);
            let additional = if kind(host, canonical, "record")? {
                let value = host.get(canonical, "value")?;
                let child = host.get(*schema, "additionalProperties")?;
                c!("apply", value, *casing, *direction, child)
            } else {
                host.get(*schema, "additionalProperties")?
            };
            let metadata = c!("spread", *schema);
            let default = host.get(*schema, "default")?;
            if !host.is_undefined(default)? {
                let default = host.get(canonical, "default")?;
                let cloned = c!("clone", default);
                let converted = c!("serialize", canonical, cloned, *casing);
                c!("setDefault", metadata, converted);
                if !yes(host, "validDefault", vec![metadata])? {
                    c!("deleteDefault", metadata);
                }
            }
            if !kind(host, canonical, "object")? {
                if kind(host, canonical, "array")? {
                    let output = c!("withAdditional", metadata, additional);
                    let item = host.get(canonical, "item")?;
                    let schema_item = host.get(*schema, "items")?;
                    let items = c!("apply", item, *casing, *direction, schema_item);
                    return host.call("arraySchema", vec![output, items, one_of]);
                }
                return host.call("leafSchema", vec![metadata, additional, one_of]);
            }
            let properties = c!("properties", *schema, canonical, *casing, *direction);
            let required = c!("required", *schema, canonical, *casing, *direction);
            let conditions = if host.is_kind(*direction, "input")? {
                let additional = host.get(canonical, "additionalProperties")?;
                if host.is_true(additional)? {
                    let shape = host.get(canonical, "shape")?;
                    c!("aliases", shape, *casing)
                } else {
                    c!("array")
                }
            } else {
                c!("array")
            };
            host.call(
                "objectSchema",
                vec![
                    metadata, additional, properties, conditions, required, one_of, *schema,
                ],
            )
        }
        ("branch", [canonical, branches, index, child, casing, direction]) => {
            let branch = c!("property", *branches, *index);
            if host.is_undefined(branch)? {
                return Ok(*child);
            }
            let converted = c!("apply", branch, *casing, *direction, *child);
            if kind(host, *canonical, "oneOf")? {
                let default = host.get(*child, "default")?;
                if !host.is_undefined(default)? {
                    let default = host.get(*child, "default")?;
                    let cloned = c!("clone", default);
                    let value = c!("serialize", *canonical, cloned, *casing);
                    c!("setDefault", converted, value);
                    if !yes(host, "validDefault", vec![converted])? {
                        c!("deleteDefault", converted);
                    }
                }
            }
            Ok(converted)
        }
        ("property", [canonical, casing, direction, key, value]) => {
            let formatted = c!("format", *key, *casing);
            let shape = host.get(*canonical, "shape")?;
            let value = if yes(host, "hasOwn", vec![shape, *key])? {
                let shape = host.get(*canonical, "shape")?;
                let source = c!("property", shape, *key);
                c!("apply", source, *casing, *direction, *value)
            } else {
                *value
            };
            host.call("pair", vec![formatted, value])
        }
        ("required", [canonical, direction, key]) => {
            if host.is_kind(*direction, "output")? {
                return host.call("true", vec![]);
            }
            let shape = host.get(*canonical, "shape")?;
            if !yes(host, "directOwn", vec![shape, *key])? {
                return host.call("true", vec![]);
            }
            let shape = host.get(*canonical, "shape")?;
            let raw = c!("property", shape, *key);
            let child = unwrap(host, raw)?;
            let default = host.get(child, "default")?;
            host.call(
                if host.is_undefined(default)? {
                    "true"
                } else {
                    "false"
                },
                vec![],
            )
        }
        ("alias", [key, child, casing]) => {
            let caller = c!("format", *key, *casing);
            if !host.same(caller, *key)? && kind(host, *child, "optional")? {
                let unwrapped = unwrap(host, *child)?;
                let default = host.get(unwrapped, "default")?;
                if host.is_undefined(default)? {
                    return host.call("aliasCondition", vec![*key, caller]);
                }
            }
            host.call("array", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
