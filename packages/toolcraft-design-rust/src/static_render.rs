//! Static spinner and menu output policy.
use crate::feedback::Host;
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn timer<H: Host>(host: &mut H, options: H::Value) -> Result<H::Value, H::Error> {
    let value = host.get(options, "timer")?;
    if predicate(host, "truthy", vec![value])? {
        host.call("timer", vec![options])
    } else {
        host.literal("")
    }
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("frames", []) => {
            let mut frames = Vec::new();
            for frame in ["◒", "◐", "◓", "◑"] {
                frames.push(host.literal(frame)?);
            }
            host.call("frames", frames)
        }
        ("running", [options, format, frames]) => {
            if host.is_kind(*format, "markdown")? {
                let suffix = host.literal("...\n")?;
                return host.call("markdownSpinner", vec![*options, suffix]);
            }
            if host.is_kind(*format, "json")? {
                return host.call("runningJson", vec![*options]);
            }
            let frame = host.get(*options, "frame")?;
            let frame = if predicate(host, "nullish", vec![frame])? {
                host.number(0.)?
            } else {
                frame
            };
            let index = host.call("frameIndex", vec![frame, *frames])?;
            let character = host.call("frameColor", vec![*frames, index])?;
            let timer = timer(host, *options)?;
            let bar = host.call("bar", vec![])?;
            host.call("runningText", vec![character, *options, timer, bar])
        }
        ("stopped", [options, format]) => {
            if host.is_kind(*format, "markdown")? {
                let suffix = host.literal("\n")?;
                return host.call("markdownSpinner", vec![*options, suffix]);
            }
            if host.is_kind(*format, "json")? {
                return host.call("stoppedJson", vec![*options]);
            }
            let code = host.get(*options, "code")?;
            let zero = host.number(0.)?;
            let code = if predicate(host, "nullish", vec![code])? {
                zero
            } else {
                code
            };
            let success = predicate(host, "same", vec![code, zero])?;
            let symbol = host.literal(if success { "◆" } else { "■" })?;
            let symbol = host.call(if success { "green" } else { "red" }, vec![symbol])?;
            let timer = timer(host, *options)?;
            let bar = host.call("bar", vec![])?;
            let output = host.call("stoppedText", vec![symbol, *options, timer])?;
            let subtext = host.get(*options, "subtext")?;
            if predicate(host, "truthy", vec![subtext])? {
                host.call("subtext", vec![output, bar, *options])
            } else {
                Ok(output)
            }
        }
        ("markdownTimer", [options]) => {
            let value = host.get(*options, "timer")?;
            if predicate(host, "truthy", vec![value])? {
                host.call("markdownTimer", vec![*options])
            } else {
                host.literal("")
            }
        }
        ("menu", [options, format]) => {
            let selected = host.get(*options, "selectedIndex")?;
            let selected = if predicate(host, "nullish", vec![selected])? {
                host.number(0.)?
            } else {
                selected
            };
            if !predicate(host, "integer", vec![selected])?
                || !predicate(host, "finite", vec![selected])?
            {
                return host.call("invalidSelection", vec![]);
            }
            if host.is_kind(*format, "markdown")? {
                return host.call("markdownMenu", vec![*options, selected]);
            }
            if host.is_kind(*format, "json")? {
                return host.call("jsonMenu", vec![*options, selected]);
            }
            let theme = host.call("theme", vec![])?;
            let bar = host.call("bar", vec![])?;
            let lines = host.call("array", vec![])?;
            host.call("menuHeader", vec![lines, *options])?;
            host.call("push", vec![lines, bar])?;
            host.call("menuOptions", vec![*options, selected, theme, bar, lines])?;
            host.call("menuFooter", vec![lines, bar])?;
            host.call("join", vec![lines])
        }
        ("selectionMark", [index, selected]) => {
            let selected = predicate(host, "same", vec![*index, *selected])?;
            host.literal(if selected { "x" } else { " " })
        }
        ("menuOption", [option, index, selected, theme, bar, lines]) => {
            let selected = predicate(host, "same", vec![*index, *selected])?;
            let prefix = host.call(if selected { "active" } else { "inactive" }, vec![])?;
            let label = if selected {
                host.call("accent", vec![*theme, *option])?
            } else {
                host.get(*option, "label")?
            };
            let hint = host.get(*option, "hint")?;
            let hint = if predicate(host, "truthy", vec![hint])? {
                host.call("hint", vec![*option])?
            } else {
                host.literal("")?
            };
            host.call("menuLine", vec![*lines, *bar, prefix, label, hint])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
