//! Live spinner lifecycle and format policy. Host owns timer and stream handles.
use crate::feedback::Host;
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
        ("start" | "message" | "stop", [state, message, code]) => {
            if operation == "start" {
                let timer = host.get(*state, "timer")?;
                if predicate(host, "truthy", vec![timer])? {
                    host.call("clear", vec![timer])?;
                    let missing = host.call("undefined", vec![])?;
                    host.call("timer", vec![*state, missing])?;
                }
            }
            let message = host.call("strip", vec![*message])?;
            host.call("current", vec![*state, message])?;
            let format = host.get(*state, "format")?;
            if operation == "message" {
                if !host.is_kind(format, "terminal")? {
                    return host.call("undefined", vec![]);
                }
                let fallback = host.get(*state, "fallback")?;
                if predicate(host, "truthy", vec![fallback])? {
                    return host.call("undefined", vec![]);
                }
                let timer = host.get(*state, "timer")?;
                if predicate(host, "truthy", vec![timer])? {
                    run(host, "frame", &[*state])?;
                }
            } else if operation == "start" {
                if host.is_kind(format, "json")? {
                    return host.call("undefined", vec![]);
                }
                if host.is_kind(format, "markdown")? {
                    host.call("markdownStart", vec![*state])?;
                    return host.call("undefined", vec![]);
                }
                let fallback =
                    predicate(host, "noSpinner", vec![])? || !predicate(host, "tty", vec![])?;
                let value = host.call(if fallback { "true" } else { "false" }, vec![])?;
                host.call("fallback", vec![*state, value])?;
                if fallback {
                    host.call("fallbackStart", vec![*state])?;
                } else {
                    let zero = host.number(0.)?;
                    host.call("index", vec![*state, zero])?;
                    run(host, "frame", &[*state])?;
                    let timer = host.call("interval", vec![*state])?;
                    host.call("timer", vec![*state, timer])?;
                }
            } else {
                if host.is_kind(format, "json")? {
                    host.call("jsonStop", vec![*state])?;
                    return host.call("undefined", vec![]);
                }
                if host.is_kind(format, "markdown")? {
                    host.call("markdownStop", vec![*state])?;
                    return host.call("undefined", vec![]);
                }
                let timer = host.get(*state, "timer")?;
                if predicate(host, "truthy", vec![timer])? {
                    host.call("clear", vec![timer])?;
                    let missing = host.call("undefined", vec![])?;
                    host.call("timer", vec![*state, missing])?;
                }
                let zero = host.number(0.)?;
                let success =
                    host.is_undefined(*code)? || predicate(host, "same", vec![*code, zero])?;
                let marker = host.literal(if success { "◆" } else { "■" })?;
                let marker = host.call(if success { "green" } else { "red" }, vec![marker])?;
                let fallback = host.get(*state, "fallback")?;
                let render = if predicate(host, "truthy", vec![fallback])? {
                    "fallbackStop"
                } else {
                    "terminalStop"
                };
                host.call(render, vec![*state, marker])?;
            }
            host.call("undefined", vec![])
        }
        ("tick", [state]) => {
            let index = host.get(*state, "frameIndex")?;
            let next = host.call("increment", vec![index])?;
            host.call("index", vec![*state, next])?;
            run(host, "frame", &[*state])?;
            host.call("undefined", vec![])
        }
        ("frame", [state]) => {
            let index = host.get(*state, "frameIndex")?;
            let frame = host.call("frame", vec![index])?;
            let message = host.get(*state, "currentMessage")?;
            host.call("renderFrame", vec![frame, message])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
