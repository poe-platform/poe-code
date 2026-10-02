//! Public tail-boundary policy, retaining observable host reads and coercions.
use crate::feedback::Host;

fn compare<H: Host>(
    host: &mut H,
    operation: &str,
    left: H::Value,
    right: H::Value,
) -> Result<bool, H::Error> {
    let result = host.call(operation, vec![left, right])?;
    host.is_true(result)
}

pub fn tail_start<H: Host>(
    host: &mut H,
    text: H::Value,
    start: H::Value,
) -> Result<H::Value, H::Error> {
    let mut index = 0.;
    loop {
        let offset = host.number(index)?;
        if !compare(host, "lt", offset, start)? {
            return Ok(start);
        }
        let ch = host.call("at", vec![text, offset])?;
        if !host.is_kind(ch, "\u{1b}")? && !host.is_kind(ch, "\u{9b}")? {
            index += 1.;
            continue;
        }
        let mut end = index + 1.;
        let csi = if host.is_kind(ch, "\u{9b}")? {
            true
        } else {
            let offset = host.number(end)?;
            let next = host.call("at", vec![text, offset])?;
            host.is_kind(next, "[")?
        };
        if csi {
            if host.is_kind(ch, "\u{1b}")? {
                end += 1.;
            }
            loop {
                let offset = host.number(end)?;
                let length = host.get(text, "length")?;
                if !compare(host, "lt", offset, length)? {
                    break;
                }
                let code = host.call("charCodeAt", vec![text, offset])?;
                let low = host.number(64.)?;
                let high = host.number(126.)?;
                if compare(host, "ge", code, low)? && compare(host, "le", code, high)? {
                    break;
                }
                end += 1.;
            }
        }
        let offset = host.number(end)?;
        if compare(host, "le", start, offset)? {
            return host.call("finish", vec![offset, text]);
        }
        index = end + 1.;
    }
}
