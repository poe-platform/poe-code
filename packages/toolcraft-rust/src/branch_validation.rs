//! Discriminated and exclusive-union argument policies. The host keeps property
//! access, coercion, callback identity and iterator completion semantics.
use crate::host::Host;

pub fn discriminator<H: Host>(
    host: &mut H,
    schema: H::Value,
    value: H::Value,
    key: H::Value,
    label: H::Value,
    errors: H::Value,
) -> Result<H::Value, H::Error> {
    let empty = host.call("undefined", vec![])?;
    let object = host.call("isObject", vec![value])?;
    if !host.is_true(object)? {
        host.call("invalidObject", vec![errors, label])?;
        return Ok(empty);
    }
    let no_label = host.call("zeroLength", vec![label])?;
    let field = if host.is_true(no_label)? {
        key
    } else {
        host.call("fieldLabel", vec![label, key])?
    };
    let branches = host.get(schema, "branches")?;
    let names = host.call("keys", vec![branches])?;
    let no_names = host.call("zeroLength", vec![names])?;
    let expected = host.call(
        if host.is_true(no_names)? {
            "noBranches"
        } else {
            "expectedBranches"
        },
        vec![names],
    )?;
    let own = host.call("hasOwn", vec![value, key])?;
    if !host.is_true(own)? {
        host.call("missingDiscriminator", vec![errors, field, expected])?;
        return Ok(empty);
    }
    let plain = host.call("isPlain", vec![value])?;
    if !host.is_true(plain)? {
        host.call("nonPlainObject", vec![errors, label])?;
        return Ok(empty);
    }
    let discriminator = host.call("property", vec![value, key])?;
    let string = host.call("isString", vec![discriminator])?;
    let mut valid = host.is_true(string)?;
    if valid {
        let branches = host.get(schema, "branches")?;
        let own = host.call("hasOwn", vec![branches, discriminator])?;
        valid = host.is_true(own)?;
    }
    if !valid {
        let received = host.call(
            if host.is_true(string)? {
                "json"
            } else {
                "receivedType"
            },
            vec![discriminator],
        )?;
        host.call(
            "invalidDiscriminator",
            vec![errors, field, received, expected],
        )?;
        return Ok(empty);
    }
    let rest = host.call("withoutDiscriminator", vec![value, key])?;
    let branches = host.get(schema, "branches")?;
    let branch = host.call("property", vec![branches, discriminator])?;
    host.call("selected", vec![discriminator, branch, rest])
}

pub fn union<H: Host>(
    host: &mut H,
    schema: H::Value,
    value: H::Value,
    label: H::Value,
    errors: H::Value,
    validator: H::Value,
) -> Result<H::Value, H::Error> {
    let plain = host.call("isPlain", vec![value])?;
    if !host.is_true(plain)? {
        let object = host.call("isObject", vec![value])?;
        host.call(
            if host.is_true(object)? {
                "nonPlainObject"
            } else {
                "invalidObject"
            },
            vec![errors, label],
        )?;
        return Ok(value);
    }
    let matches = host.call("array", vec![])?;
    let failures = host.call("array", vec![])?;
    let branches = host.get(schema, "branches")?;
    host.call(
        "eachUnionBranch",
        vec![branches, matches, failures, validator],
    )?;
    let single = host.call("oneLength", vec![matches])?;
    if host.is_true(single)? {
        return host.get(matches, "0");
    }
    let empty = host.call("zeroLength", vec![matches])?;
    host.call(
        if host.is_true(empty)? {
            "noMatches"
        } else {
            "multipleMatches"
        },
        vec![errors, label, matches, failures],
    )?;
    Ok(value)
}

pub fn union_branch<H: Host>(
    host: &mut H,
    index: H::Value,
    branch: H::Value,
    matches: H::Value,
    failures: H::Value,
    validator: H::Value,
) -> Result<(), H::Error> {
    let errors = host.call("array", vec![])?;
    let normalized = host.call("validateBranch", vec![validator, branch, errors])?;
    let empty = host.call("zeroLength", vec![errors])?;
    if host.is_true(empty)? {
        host.call("push", vec![matches, normalized])?;
    } else {
        let first = host.get(errors, "0")?;
        let failure = host.call("branchFailure", vec![first, index])?;
        host.call("push", vec![failures, failure])?;
    }
    Ok(())
}
