//! Interactive dashboard admission preserves the original short-circuit order.
use crate::feedback::Host;

pub fn should_use<H: Host>(
    host: &mut H,
    enabled: H::Value,
    io: H::Value,
) -> Result<bool, H::Error> {
    if !host.is_true(enabled)? {
        return Ok(false);
    }
    let format = host.call("format", vec![])?;
    if !host.is_kind(format, "terminal")? {
        return Ok(false);
    }
    for stream in ["stdin", "stdout"] {
        let stream = host.get(io, stream)?;
        let tty = host.get(stream, "isTTY")?;
        let truthy = host.call("truthy", vec![tty])?;
        if !host.is_true(truthy)? {
            return Ok(false);
        }
    }
    Ok(true)
}
