//! Stack sections and framework-frame filtering with caller-realm string methods.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("format", [stack, mode]) => {
            if host.is_kind(*mode, "raw")? {
                Ok(*stack)
            } else {
                run(host, "trim", &[*stack])
            }
        }
        ("trim", [stack]) => {
            let sections = run(host, "split", &[*stack])?;
            let trimmed = c!("mapSections", sections);
            let count = c!("sumHidden", trimmed);
            let zero = c!("zero", count);
            if host.is_true(zero)? {
                Ok(*stack)
            } else {
                host.call("joinSections", vec![trimmed])
            }
        }
        ("split", [stack]) => {
            let separator = host.literal("\n")?;
            let lines = c!("split", *stack, separator);
            let first = c!("first", lines);
            if host.is_undefined(first)? {
                return host.call("list", vec![]);
            }
            let section = c!("section", first);
            let sections = c!("list", section);
            c!("eachLine", lines, sections);
            Ok(sections)
        }
        ("line", [line, sections]) => {
            let trimmed = c!("trimStart", *line);
            let prefix = host.literal("[cause]:")?;
            let cause = c!("startsWith", trimmed, prefix);
            let cause = c!("truthy", cause);
            if host.is_true(cause)? {
                let section = c!("section", *line);
                c!("push", *sections, section);
            } else {
                c!("appendLast", *sections, *line);
            }
            host.call("undefined", vec![])
        }
        ("section", [section]) => {
            let users = c!("list");
            let skipped = c!("list");
            let lines = host.get(*section, "lines")?;
            c!("eachFrame", lines, users, skipped);
            let length = host.get(skipped, "length")?;
            let zero = c!("zero", length);
            if host.is_true(zero)? {
                host.call("untouchedSection", vec![*section])
            } else {
                host.call("trimmedSection", vec![*section, users, skipped])
            }
        }
        ("frame", [line, users, skipped]) => {
            let from = host.literal("\\")?;
            let to = host.literal("/")?;
            let normalized = c!("replaceAll", *line, from, to);
            let mut hidden = false;
            for pattern in [
                "node_modules/toolcraft/",
                "node_modules/toolcraft-openapi/",
                "node_modules/toolcraft-schema/",
                "node_modules/commander/",
                "node:internal/",
                "/packages/toolcraft/src/",
            ] {
                let pattern = host.literal(pattern)?;
                let matches = c!("includes", normalized, pattern);
                let matches = c!("truthy", matches);
                if host.is_true(matches)? {
                    hidden = true;
                    break;
                }
            }
            c!("push", if hidden { *skipped } else { *users }, *line);
            host.call("undefined", vec![])
        }
        ("count", [count, section]) => {
            let hidden = host.get(*section, "hiddenFrameCount")?;
            host.call("add", vec![*count, hidden])
        }
        ("summary", [count]) => {
            let one = c!("one", *count);
            let prefix = host.literal("    … (")?;
            let suffix = host.literal(if host.is_true(one)? {
                " framework / runtime frame hidden — pass --debug=raw to show)"
            } else {
                " framework / runtime frames hidden — pass --debug=raw to show)"
            })?;
            host.call("interpolate", vec![prefix, *count, suffix])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
