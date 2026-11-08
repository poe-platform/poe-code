//! Async spinner presentation policy; the host retains promises and timers.
use crate::feedback::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn elapsed<H: Host>(host: &mut H, state: H::Value) -> Result<H::Value, H::Error> {
    let seconds = host.call("seconds", vec![state])?;
    let minute = host.number(60.)?;
    let short = predicate(host, "lt", vec![seconds, minute])?;
    host.call(
        if short { "shortElapsed" } else { "longElapsed" },
        vec![seconds],
    )
}

fn callback<H: Host>(
    host: &mut H,
    state: H::Value,
    name: &'static str,
    result: H::Value,
) -> Result<H::Value, H::Error> {
    let function = host.get(state, name)?;
    if predicate(host, "truthy", vec![function])? {
        host.call(name, vec![state, result])
    } else {
        host.call("undefined", vec![])
    }
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("begin", [state]) => {
            let format = host.call("format", vec![])?;
            if host.is_kind(format, "json")? {
                return host.number(0.);
            }
            let disabled = predicate(host, "noSpinner", vec![])?;
            let tty = predicate(host, "tty", vec![])?;
            if disabled || !tty {
                return host.number(1.);
            }
            host.call("begin", vec![*state])?;
            let message = host.call("readMessage", vec![*state])?;
            host.call("start", vec![*state, message])?;
            host.call("schedule", vec![*state])?;
            host.number(2.)
        }
        ("tick", [state]) => {
            let message = host.call("readMessage", vec![*state])?;
            let time = elapsed(host, *state)?;
            let message = host.call("timedMessage", vec![message, time])?;
            host.call("message", vec![*state, message])?;
            host.call("undefined", vec![])
        }
        ("finish", [state, result, mode]) => {
            let active = host.number(2.)?;
            let fallback = host.number(1.)?;
            let json = host.number(0.)?;
            if predicate(host, "same", vec![*mode, active])? {
                host.call("clear", vec![*state])?;
                let time = elapsed(host, *state)?;
                let message = callback(host, *state, "stopMessage", *result)?;
                let message = if predicate(host, "truthy", vec![message])? {
                    message
                } else {
                    host.literal("Done")?
                };
                let message = host.call("timedMessage", vec![message, time])?;
                host.call("stop", vec![*state, message])?;
            } else if predicate(host, "same", vec![*mode, fallback])? {
                let message = callback(host, *state, "stopMessage", *result)?;
                if predicate(host, "truthy", vec![message])? {
                    host.call("fallbackMessage", vec![message])?;
                }
            }
            let sub = callback(host, *state, "subtext", *result)?;
            if predicate(host, "truthy", vec![sub])? {
                let render = if predicate(host, "same", vec![*mode, json])? {
                    "jsonSubtext"
                } else {
                    "guidedSubtext"
                };
                host.call(render, vec![sub])?;
            }
            host.call("undefined", vec![])
        }
        ("fail", [state]) => {
            host.call("clear", vec![*state])?;
            let empty = host.literal("")?;
            let code = host.number(1.)?;
            host.call("stop", vec![*state, empty, code])?;
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
