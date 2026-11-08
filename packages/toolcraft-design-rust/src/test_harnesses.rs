//! Policies for the public prompt and terminal testing harnesses.
use crate::feedback::Host;

fn set<H: Host>(
    host: &mut H,
    object: H::Value,
    key: &'static str,
    value: H::Value,
) -> Result<(), H::Error> {
    let key = host.literal(key)?;
    host.call("set", vec![object, key, value])?;
    Ok(())
}
fn truthy<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let value = host.call("truthy", vec![value])?;
    host.is_true(value)
}
fn fallback<H: Host>(
    host: &mut H,
    value: H::Value,
    default: H::Value,
) -> Result<H::Value, H::Error> {
    let nullish = host.call("nullish", vec![value])?;
    Ok(if host.is_true(nullish)? {
        default
    } else {
        value
    })
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("promptInput", [input, options]) => {
            let tty = host.get(*options, "tty")?;
            let yes = host.call("true", vec![])?;
            let tty = fallback(host, tty, yes)?;
            set(host, *input, "isTTY", tty)?;
        }
        ("promptOutput", [output, options, frames]) => {
            let tty = host.get(*options, "tty")?;
            let yes = host.call("true", vec![])?;
            let tty = fallback(host, tty, yes)?;
            set(host, *output, "isTTY", tty)?;
            for (key, default) in [("columns", 80.), ("rows", 20.)] {
                let value = host.get(*options, key)?;
                let default = host.number(default)?;
                let value = fallback(host, value, default)?;
                set(host, *output, key, value)?;
            }
            set(host, *output, "frames", *frames)?;
        }
        ("capture", [chunk, chunks, frames]) => {
            let value = host.call("string", vec![*chunk])?;
            host.call("push", vec![*chunks, value])?;
            host.call("push", vec![*frames, value])?;
        }
        ("output", [driver]) => {
            let writes = host.get(*driver, "writes")?;
            return host.call("join", vec![writes]);
        }
        ("destroyed", [driver]) => {
            let started = host.get(*driver, "started")?;
            if truthy(host, started)? {
                return host.call("false", vec![]);
            }
            let count = host.get(*driver, "stopCount")?;
            let zero = host.number(0.)?;
            return host.call("gt", vec![count, zero]);
        }
        ("start" | "stop", [driver]) => {
            let started = host.get(*driver, "started")?;
            if truthy(host, started)? == (operation == "stop") {
                let value = host.call(
                    if operation == "start" {
                        "true"
                    } else {
                        "false"
                    },
                    vec![],
                )?;
                set(host, *driver, "started", value)?;
                let key = if operation == "start" {
                    "startCount"
                } else {
                    "stopCount"
                };
                let count = host.get(*driver, key)?;
                let next = host.call("increment", vec![count])?;
                set(host, *driver, key, next)?;
            }
        }
        ("write", [driver, ansi]) => {
            let started = host.get(*driver, "started")?;
            if truthy(host, started)? {
                let writes = host.get(*driver, "writes")?;
                host.call("pushWrites", vec![writes, *ansi])?;
            }
        }
        ("press", [driver, key]) => {
            let started = host.get(*driver, "started")?;
            if truthy(host, started)? {
                let mut name = host.get(*key, "name")?;
                let nullish = host.call("nullish", vec![name])?;
                if host.is_true(nullish)? {
                    name = host.get(*key, "ch")?;
                    let empty = host.literal("")?;
                    name = fallback(host, name, empty)?;
                }
                let ch = host.get(*key, "ch")?;
                let ctrl = host.get(*key, "ctrl")?;
                let alt = host.get(*key, "meta")?;
                let shift = host.get(*key, "shift")?;
                let kind = host.literal("key")?;
                let event = host.call("keyEvent", vec![kind, name, ch, ctrl, alt, shift])?;
                host.call("dispatchKey", vec![*driver, event])?;
            }
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    host.call("undefined", vec![])
}
