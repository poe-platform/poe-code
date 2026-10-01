//! Member collision policy. Host maps preserve formatter-result identity and
//! host iteration preserves abrupt-completion and iterator-close semantics.
use crate::host::Host;

pub fn validate<H: Host>(
    host: &mut H,
    mut schema: H::Value,
    formatter: H::Value,
    surface: H::Value,
    mut discriminator: H::Value,
) -> Result<(), H::Error> {
    let empty = host.call("undefined", vec![])?;
    for _ in 0..16_384 {
        let kind = host.get(schema, "kind")?;
        if host.is_kind(kind, "optional")? {
            schema = host.get(schema, "inner")?;
        } else if host.is_kind(kind, "array")? {
            schema = host.get(schema, "item")?;
            discriminator = empty;
        } else if host.is_kind(kind, "record")? {
            schema = host.get(schema, "value")?;
            discriminator = empty;
        } else if host.is_kind(kind, "union")? {
            let branches = host.get(schema, "branches")?;
            host.call("eachBranch", vec![branches, formatter, surface])?;
            return Ok(());
        } else if host.is_kind(kind, "oneOf")? {
            let branches = host.get(schema, "branches")?;
            let branches = host.call("values", vec![branches])?;
            host.call(
                "eachNamedBranch",
                vec![branches, schema, formatter, surface],
            )?;
            return Ok(());
        } else if host.is_kind(kind, "object")? {
            let members = host.call("map", vec![])?;
            if !host.is_undefined(discriminator)? {
                let member = host.call("format", vec![formatter, discriminator])?;
                host.call("set", vec![members, member, discriminator])?;
            }
            let shape = host.get(schema, "shape")?;
            let entries = host.call("entries", vec![shape])?;
            host.call("eachMember", vec![entries, members, formatter, surface])?;
            return Ok(());
        } else {
            return Ok(());
        }
    }
    host.call("stackError", vec![])?;
    Ok(())
}

pub fn validate_member<H: Host>(
    host: &mut H,
    members: H::Value,
    key: H::Value,
    child: H::Value,
    formatter: H::Value,
    surface: H::Value,
) -> Result<(), H::Error> {
    let member = host.call("format", vec![formatter, key])?;
    let existing = host.call("getMember", vec![members, member])?;
    if !host.is_undefined(existing)? {
        host.call("collision", vec![existing, key, surface, member])?;
    }
    host.call("set", vec![members, member, key])?;
    let empty = host.call("undefined", vec![])?;
    validate(host, child, formatter, surface, empty)
}
