//! Observable counterpart of the primitive UTF-16 ANSI scanner.
use crate::table::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("strip", [value]) => {
            let mut output = host.call("empty", vec![])?;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let character = host.call("at", vec![*value, index])?;
                if host.is_kind(character, "\u{1b}")? {
                    index = run(host, "escape", &[*value, index])?;
                    continue;
                }
                if host.is_kind(character, "\u{9b}")? {
                    let next = host.call("increment", vec![index])?;
                    index = run(host, "csi", &[*value, next])?;
                    continue;
                }
                output = host.call("add", vec![output, character])?;
                let length = host.get(character, "length")?;
                index = host.call("add", vec![index, length])?;
            }
            Ok(output)
        }
        ("escape", [value, index]) => {
            let next = host.call("increment", vec![*index])?;
            let character = host.call("at", vec![*value, next])?;
            for (kind, operation) in [("[", "csi"), ("]", "osc")] {
                if host.is_kind(character, kind)? {
                    let next = host.call("plusTwo", vec![*index])?;
                    return run(host, operation, &[*value, next]);
                }
            }
            let length = host.get(*value, "length")?;
            let next = host.call("plusTwo", vec![*index])?;
            host.call("min", vec![length, next])
        }
        ("csi", [value, start]) => {
            let mut index = *start;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let code = host.call("charCode", vec![*value, index])?;
                index = host.call("increment", vec![index])?;
                if predicate(host, "final", vec![code])? {
                    break;
                }
            }
            Ok(index)
        }
        ("osc", [value, start]) => {
            let mut index = *start;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let character = host.call("at", vec![*value, index])?;
                if host.is_kind(character, "\u{7}")? {
                    return host.call("increment", vec![index]);
                }
                let character = host.call("at", vec![*value, index])?;
                if host.is_kind(character, "\u{1b}")? {
                    let next = host.call("increment", vec![index])?;
                    let character = host.call("at", vec![*value, next])?;
                    if host.is_kind(character, "\\")? {
                        return host.call("plusTwo", vec![index]);
                    }
                }
                index = host.call("increment", vec![index])?;
            }
            Ok(index)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
