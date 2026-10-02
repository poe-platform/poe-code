//! Visible escaping of terminal controls and Unicode direction controls.
use crate::text_cells::Host;
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    if let ("character", [character]) = (operation, args) {
        let code = host.call("point", vec![*character])?;
        let control_end = host.number(0x1f as f64)?;
        let mut escape = predicate(host, "le", vec![code, control_end])?;
        if !escape {
            for (start, end) in [
                (0x7f, 0x9f),
                (0x061c, 0x061c),
                (0x200e, 0x200e),
                (0x200f, 0x200f),
                (0x202a, 0x202e),
                (0x2066, 0x2069),
            ] {
                let lower = host.number(f64::from(start))?;
                let matched = if start == end {
                    predicate(host, "same", vec![code, lower])?
                } else {
                    if !predicate(host, "ge", vec![code, lower])? {
                        continue;
                    }
                    let upper = host.number(f64::from(end))?;
                    predicate(host, "le", vec![code, upper])?
                };
                if matched {
                    escape = true;
                    break;
                }
            }
        }
        if escape {
            host.call("escaped", vec![code])
        } else {
            Ok(*character)
        }
    } else {
        host.call("invalidOperation", vec![])
    }
}
