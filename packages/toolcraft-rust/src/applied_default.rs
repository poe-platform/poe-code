//! Applied defaults remain canonical, are cloned, and validate against the
//! pre-projection schema without synthesizing unused nested defaults.
use crate::host::Host;

pub fn validate<H: Host>(
    host: &mut H,
    schema: H::Value,
    label: H::Value,
    errors: H::Value,
) -> Result<H::Value, H::Error> {
    let default = host.get(schema, "default")?;
    if host.is_undefined(default)? {
        return Ok(default);
    }
    let default = host.get(schema, "default")?;
    let value = host.call("clone", vec![default])?;
    let schema = host.call("unfiltered", vec![schema])?;
    let validation = host.call("validate", vec![schema, value])?;
    let ok = host.get(validation, "ok")?;
    if !host.is_true(ok)? {
        let issues = host.get(validation, "issues")?;
        let mut message = host.call("firstMessage", vec![issues])?;
        if host.is_nullish(message)? {
            message = host.call("fallback", vec![])?;
        }
        host.call("invalid", vec![errors, label, message])?;
    }
    Ok(value)
}
