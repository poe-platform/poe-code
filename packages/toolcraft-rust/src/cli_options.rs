//! CLI option grouping, schema dispatch and Commander attribute policy.
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
    macro_rules! kind {
        ($field:expr,$kind:expr) => {{
            let schema = host.get($field, "schema")?;
            let kind = host.get(schema, "kind")?;
            host.is_kind(kind, $kind)?
        }};
    }
    match (operation, args) {
        ("create", [field, globals]) => {
            let collides = c!("collides", *field, *globals);
            let groups = if yes!(collides) {
                let flags = c!("optionFlags", *field, *globals);
                c!("list", flags)
            } else {
                let short = host.get(*field, "shortFlag")?;
                let first = if host.is_undefined(short)? {
                    host.get(*field, "optionFlag")?
                } else {
                    c!("shortFlags", *field)
                };
                c!("groups", first, *field)
            };
            host.call("flatMap", vec![groups, *field, collides])
        }
        ("commander", [flags, description, field]) => {
            let option = c!("newOption", *flags, *description);
            let attribute = host.get(*field, "commanderOptionAttribute")?;
            let original = host.get(*field, "optionAttribute")?;
            if !host.same(attribute, original)? || yes!(c!("hasAliases", *field)) {
                c!("setAttribute", option, *field);
            }
            Ok(option)
        }
        ("group", [flags, index, field, collides]) => {
            if kind!(*field, "boolean") {
                if yes!(*collides) {
                    let option = option(host, *flags, *field)?;
                    return host.call("list", vec![option]);
                }
                let suffix = host.literal("[value]")?;
                let main_flags = c!("valueFlags", *flags, suffix);
                let main_option = option(host, main_flags, *field)?;
                c!("preset", main_option);
                c!("booleanParser", main_option);
                let first = c!("zero", *index);
                if host.is_true(first)? {
                    let negative_flags = c!("negativeFlags", *field);
                    let negative = option(host, negative_flags, *field)?;
                    host.call("list", vec![main_option, negative])
                } else {
                    host.call("list", vec![main_option])
                }
            } else if kind!(*field, "array") {
                let suffix = host.literal("<value...>")?;
                let flags = c!("valueFlags", *flags, suffix);
                let option = option(host, flags, *field)?;
                let parsed = c!("arrayParser", option);
                host.call("list", vec![parsed])
            } else {
                let suffix = if kind!(*field, "json") {
                    host.literal("<json>")?
                } else {
                    host.literal("<value>")?
                };
                let flags = c!("valueFlags", *flags, suffix);
                let option = option(host, flags, *field)?;
                host.call("list", vec![option])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

fn option<H: TextHost>(
    host: &mut H,
    flags: H::Value,
    field: H::Value,
) -> Result<H::Value, H::Error> {
    let description = host.get(field, "description")?;
    run(host, "commander", &[flags, description, field])
}
