//! Dynamic CLI schema traversal, numeric selectors and longest-prefix admission.
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
        ("kind", [kind]) => {
            if host.is_kind(*kind, "oneOf")? {
                host.literal("oneof")
            } else {
                Ok(*kind)
            }
        }
        ("unsupported", [kind, path]) => host.call("unsupported", vec![*kind, *path]),
        ("qualify", [prefix, path]) => {
            if yes!(c!("empty", *prefix)) {
                Ok(*path)
            } else if yes!(c!("empty", *path)) {
                Ok(*prefix)
            } else {
                host.call("qualify", vec![*prefix, *path])
            }
        }
        ("numeric", [value]) => {
            if yes!(c!("empty", *value)) {
                host.call("false", vec![])
            } else {
                host.call("digits", vec![*value])
            }
        }
        ("badDigit", [value]) => {
            if yes!(c!("below", *value)) {
                host.call("true", vec![])
            } else {
                host.call("above", vec![*value])
            }
        }
        ("availablePaths", [display, prefix]) => {
            if yes!(c!("empty", *display)) {
                host.call("list", vec![])
            } else {
                host.call("availablePaths", vec![*display, *prefix])
            }
        }
        ("leaf", [schema, segments, casing, output, display, prefix]) => {
            let schema = c!("unwrap", *schema);
            let raw_kind = host.get(schema, "kind")?;
            let kind = run(host, "kind", &[raw_kind])?;
            if yes!(c!("empty", *segments)) {
                for candidate in ["json", "array", "string", "number", "boolean", "enum"] {
                    let candidate_kind = host.get(schema, "kind")?;
                    if host.is_kind(candidate_kind, candidate)? {
                        let display = c!("joinPath", *display);
                        return host.call("leaf", vec![display, *output, schema]);
                    }
                }
                let display = c!("joinPath", *display);
                let qualified = run(host, "qualify", &[*prefix, display])?;
                let message = c!("unsupported", kind, qualified);
                return host.call("fail", vec![message]);
            }
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "object")? {
                let parts = c!("split", *segments);
                let head = host.get(parts, "head")?;
                let rest = host.get(parts, "rest")?;
                let selected = c!(
                    "objectChild",
                    schema,
                    head,
                    rest,
                    *casing,
                    *output,
                    *display,
                    *prefix
                );
                let done = host.get(selected, "done")?;
                if host.is_true(done)? {
                    host.get(selected, "value")
                } else {
                    host.call(
                        "unknownObject",
                        vec![schema, head, *casing, *display, *prefix],
                    )
                }
            } else if host.is_kind(kind, "record")? {
                let parts = c!("split", *segments);
                let head = host.get(parts, "head")?;
                let rest = host.get(parts, "rest")?;
                let child = host.get(schema, "value")?;
                let head = if host.is_nullish(head)? {
                    host.literal("")?
                } else {
                    head
                };
                let output = c!("appendOutput", *output, head);
                let display = c!("appendDisplay", *display, head);
                host.call(
                    "recurse",
                    vec![child, rest, *casing, output, display, *prefix],
                )
            } else if host.is_kind(kind, "array")? {
                let item = host.get(schema, "item")?;
                let item = c!("unwrap", item);
                let item_kind = host.get(item, "kind")?;
                if !host.is_kind(item_kind, "object")? {
                    return host.call("arrayObjectError", vec![*display, *prefix]);
                }
                let parts = c!("split", *segments);
                let head = host.get(parts, "head")?;
                let rest = host.get(parts, "rest")?;
                if host.is_undefined(head)? || !yes!(run(host, "numeric", &[head])?) {
                    return host.call("arrayIndexError", vec![*display, *prefix]);
                }
                let output = c!("appendOutput", *output, head);
                let display = c!("appendDisplay", *display, head);
                host.call(
                    "recurse",
                    vec![item, rest, *casing, output, display, *prefix],
                )
            } else {
                host.call("unknownLeaf", vec![*segments, *display, *prefix])
            }
        }
        ("objectChild", [key, child, head, rest, casing, output, display, prefix]) => {
            let name = c!("name", *key, *casing);
            if host.same(name, *head)? {
                let output = c!("appendOutput", *output, *key);
                let display = c!("appendDisplay", *display, *key);
                let leaf = c!("recurse", *child, *rest, *casing, output, display, *prefix);
                host.call("selected", vec![leaf])
            } else {
                host.call("unselected", vec![])
            }
        }
        ("option", [fields, name, casing]) => {
            let path = c!("flagPath", *name);
            let candidates = c!("sorted", *fields);
            let selected = c!("find", candidates, path, *casing);
            if host.is_undefined(selected)? {
                Ok(selected)
            } else {
                host.call("match", vec![selected, path, *casing])
            }
        }
        ("matches", [field, path, casing]) => {
            let option_path = c!("optionPath", *field, *casing);
            if yes!(c!("moreSegments", *path, option_path)) {
                host.call("every", vec![option_path, *path])
            } else {
                host.call("false", vec![])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
