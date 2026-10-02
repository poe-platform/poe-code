//! Selection prompt admission, navigation and presentation policies.
use crate::{
    feedback::Host,
    prompt_components::{append, color_glyph, suffix},
};

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn find<H: Host>(
    host: &mut H,
    start: H::Value,
    direction: H::Value,
    options: H::Value,
) -> Result<H::Value, H::Error> {
    if predicate(host, "allDisabled", vec![options])? {
        return Ok(start);
    }
    let mut index = start;
    let mut checked = 0.;
    loop {
        let count = host.number(checked)?;
        let length = host.get(options, "length")?;
        if !predicate(host, "lt", vec![count, length])? {
            break;
        }
        index = host.call("normalize", vec![index, options])?;
        if !predicate(host, "disabledAt", vec![options, index])? {
            return Ok(index);
        }
        index = host.call("add", vec![index, direction])?;
        checked += 1.;
    }
    Ok(start)
}

fn option<H: Host>(
    host: &mut H,
    option: H::Value,
    active: bool,
    submit: bool,
    cancel: bool,
) -> Result<H::Value, H::Error> {
    let hint = host.get(option, "hint")?;
    let hint = if predicate(host, "truthy", vec![hint])? {
        host.call("hint", vec![option])?
    } else {
        host.literal("")?
    };
    if submit {
        return host.call("dimLabel", vec![option]);
    }
    if cancel {
        return host.call("strikeLabel", vec![option]);
    }
    let disabled = host.get(option, "disabled")?;
    let disabled = predicate(host, "truthy", vec![disabled])?;
    let marker = color_glyph(
        host,
        if disabled {
            "gray"
        } else if active {
            "green"
        } else {
            "dim"
        },
        if !disabled && active {
            "radioActive"
        } else {
            "radioInactive"
        },
    )?;
    let text = suffix(host, marker, " ")?;
    let label = if disabled {
        host.call("disabledLabel", vec![option])?
    } else if active {
        host.get(option, "label")?
    } else {
        host.call("dimLabel", vec![option])?
    };
    let text = append(host, text, label)?;
    append(host, text, hint)
}

fn header<H: Host>(host: &mut H, prompt: H::Value, opts: H::Value) -> Result<H::Value, H::Error> {
    let start = color_glyph(host, "gray", "barStart")?;
    let text = suffix(host, start, " ")?;
    let state = host.get(prompt, "state")?;
    let marker = host.call("symbol", vec![state])?;
    let text = append(host, text, marker)?;
    let text = suffix(host, text, " ")?;
    let message = host.get(opts, "message")?;
    append(host, text, message)
}

fn frame<H: Host>(host: &mut H, prompt: H::Value, opts: H::Value) -> Result<H::Value, H::Error> {
    let state = host.get(prompt, "state")?;
    let closed = if host.is_kind(state, "submit")? {
        true
    } else {
        let state = host.get(prompt, "state")?;
        host.is_kind(state, "cancel")?
    };
    if closed {
        let selected = host.call("selectedOption", vec![prompt])?;
        let rendered = if predicate(host, "truthy", vec![selected])? {
            let state = host.get(prompt, "state")?;
            let submit = host.is_kind(state, "submit")?;
            let state = host.get(prompt, "state")?;
            let cancel = host.is_kind(state, "cancel")?;
            option(host, selected, false, submit, cancel)?
        } else {
            host.literal("")?
        };
        let state = host.get(prompt, "state")?;
        let color = if host.is_kind(state, "submit")? {
            "green"
        } else {
            "red"
        };
        let end = color_glyph(host, color, "barEnd")?;
        let text = header(host, prompt, opts)?;
        let text = suffix(host, text, "\n")?;
        let output = host.call("output", vec![opts])?;
        let prefix = color_glyph(host, "gray", "bar")?;
        let prefix = suffix(host, prefix, "  ")?;
        let rendered = host.call("wrap", vec![output, rendered, prefix])?;
        let text = append(host, text, rendered)?;
        let text = suffix(host, text, "\n")?;
        return append(host, text, end);
    }
    let lines = host.call("selectLines", vec![prompt, opts])?;
    let text = header(host, prompt, opts)?;
    let text = suffix(host, text, "\n")?;
    let body = host.call("joinLines", vec![lines])?;
    let text = append(host, text, body)?;
    let text = suffix(host, text, "\n")?;
    let end = color_glyph(host, "cyan", "barEnd")?;
    append(host, text, end)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("find", [start, direction, options]) => find(host, *start, *direction, *options),
        ("selectInitial", [opts]) => {
            let options = host.get(*opts, "options")?;
            let length = host.get(options, "length")?;
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![length, zero])? {
                let message = host.literal("Select prompt requires at least one option.")?;
                return host.call("error", vec![message]);
            }
            let options = host.get(*opts, "options")?;
            if predicate(host, "allDisabled", vec![options])? {
                let message =
                    host.literal("Select prompt requires at least one enabled option.")?;
                return host.call("error", vec![message]);
            }
            let index = host.call("initialIndex", vec![*opts])?;
            let one = host.number(1.)?;
            let options = host.get(*opts, "options")?;
            find(host, index, one, options)
        }
        ("selectCursor", [prompt, action]) => {
            if host.is_kind(*action, "up")? || host.is_kind(*action, "left")? {
                host.call("moveUp", vec![*prompt])?;
            } else if host.is_kind(*action, "down")? || host.is_kind(*action, "right")? {
                host.call("moveDown", vec![*prompt])?;
            }
            host.call("selectValue", vec![*prompt])?;
            host.call("undefined", vec![])
        }
        ("selectNonTty", [prompt, fallback]) => {
            let mode = host.call("noPrompt", vec![])?;
            host.call(
                if host.is_kind(mode, "1")? {
                    "resolveSelect"
                } else {
                    "nonTty"
                },
                vec![*prompt, *fallback],
            )
        }
        ("selectOption", [item, active]) => {
            let active = predicate(host, "truthy", vec![*active])?;
            option(host, *item, active, false, false)
        }
        ("selectFrame", [prompt, opts]) => frame(host, *prompt, *opts),
        _ => host.call("invalidOperation", vec![]),
    }
}
