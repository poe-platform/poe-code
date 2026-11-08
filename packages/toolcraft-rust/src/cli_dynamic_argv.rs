//! Dynamic argv routing, nested own-property writes and final field assembly.
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
        ("parse", [fields, argv, casing, errors]) => {
            let raw = c!("map");
            let provided = c!("set");
            let positionals = c!("list");
            let mut index = c!("zero");
            while yes!(c!("more", index, *argv)) {
                let token = c!("at", *argv, index);
                let token = if host.is_nullish(token)? {
                    host.literal("")?
                } else {
                    token
                };
                if host.is_kind(token, "--")? {
                    c!("tail", positionals, *argv, index);
                    break;
                }
                if !yes!(c!("long", token)) {
                    if yes!(c!("multi", token))
                        && yes!(c!("hyphen", token))
                        && !yes!(c!("negative", token))
                    {
                        return host.call("unknownOption", vec![token]);
                    }
                    c!("push", positionals, token);
                    index = c!("increment", index);
                    continue;
                }
                let negated = c!("negated", token);
                let normalized = if yes!(negated) {
                    c!("normalize", token)
                } else {
                    token
                };
                let equals = c!("equals", normalized);
                let flag = if yes!(c!("attached", equals)) {
                    c!("flagWithValue", normalized, equals)
                } else {
                    c!("flag", normalized)
                };
                let inline = if yes!(c!("attached", equals)) {
                    c!("inline", normalized, equals)
                } else {
                    c!("undefined")
                };
                let dynamic = c!("resolve", *fields, flag, *casing);
                if host.is_undefined(dynamic)? {
                    return host.call("unknownParameter", vec![flag, *fields]);
                }
                let matched = host.get(dynamic, "match")?;
                let leaf = host.get(dynamic, "leaf")?;
                let store = c!("raw", raw, matched);
                let store = if host.is_nullish(store)? {
                    c!("object")
                } else {
                    store
                };
                let label = c!("label", matched, leaf);
                let negate_boolean = if yes!(negated) {
                    let schema = host.get(leaf, "schema")?;
                    let kind = host.get(schema, "kind")?;
                    host.is_kind(kind, "boolean")?
                } else {
                    false
                };
                let parsed = if negate_boolean {
                    c!("negatedValue", index)
                } else {
                    let schema = host.get(leaf, "schema")?;
                    c!("consume", *argv, index, schema, label, inline)
                };
                c!("store", store, leaf, parsed);
                c!("keep", raw, matched, store);
                c!("provided", provided, matched);
                index = host.get(parsed, "nextIndex")?;
                index = c!("increment", index);
            }
            host.call("finish", vec![provided, positionals, *fields, raw, *errors])
        }
        ("finalized", [field, raw, errors]) => {
            // The reference conditional returns field.schema in both branches,
            // but both schema reads and the intervening kind read are observable.
            let first = host.get(*field, "schema")?;
            host.get(first, "kind")?;
            let schema = host.get(*field, "schema")?;
            let value = c!("raw", *raw, *field);
            let path = host.get(*field, "displayPath")?;
            host.call("finalize", vec![schema, value, path, *errors])
        }
        ("nested", [target, path, value]) => {
            let mut cursor = *target;
            let mut index = c!("zero");
            while yes!(c!("pathMore", index, *path)) {
                let segment = c!("pathAt", *path, index);
                let segment = if host.is_nullish(segment)? {
                    host.literal("")?
                } else {
                    segment
                };
                let existing = if yes!(c!("own", cursor, segment)) {
                    c!("existing", cursor, segment)
                } else {
                    c!("undefined")
                };
                if yes!(c!("isObject", existing)) && !yes!(c!("isNull", existing)) {
                    cursor = existing;
                } else {
                    let next = c!("object");
                    c!("define", cursor, segment, next);
                    cursor = next;
                }
                index = c!("increment", index);
            }
            let leaf = c!("leaf", *path);
            if !host.is_undefined(leaf)? {
                c!("define", cursor, leaf, *value);
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
