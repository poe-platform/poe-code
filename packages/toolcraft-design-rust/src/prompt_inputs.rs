//! Text and password prompt cursor, fallback and frame policy.
use crate::{
    feedback::Host,
    prompt_components::{append, color_glyph, suffix},
};

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let result = host.call(name, args)?;
    host.is_true(result)
}

fn cursor<H: Host>(host: &mut H, prompt: H::Value, password: bool) -> Result<H::Value, H::Error> {
    let state = host.get(prompt, "state")?;
    if host.is_kind(state, "submit")? {
        return host.get(prompt, if password { "masked" } else { "userInput" });
    }
    let (before, current, after) = if password {
        let masked = host.get(prompt, "masked")?;
        let position = host.call("maskCursor", vec![prompt])?;
        let before = host.call("maskBefore", vec![masked, position])?;
        let current = host.call("maskCurrent", vec![masked, position, prompt])?;
        let after = host.call("maskAfter", vec![masked, position, prompt])?;
        (before, current, after)
    } else {
        let before = host.call("textBefore", vec![prompt])?;
        let current = host.call("textCurrent", vec![prompt])?;
        let after = host.call("textAfter", vec![prompt, current])?;
        (before, current, after)
    };
    let present = predicate(host, "truthy", vec![current])?;
    let before = suffix(host, before, "")?;
    let current = if present {
        current
    } else {
        host.literal("█")?
    };
    let color = host.literal("inverse")?;
    let current = host.call("color", vec![color, current])?;
    let text = append(host, before, current)?;
    if present {
        append(host, text, after)
    } else {
        Ok(text)
    }
}

fn header<H: Host>(
    host: &mut H,
    prompt: H::Value,
    message: H::Value,
) -> Result<H::Value, H::Error> {
    let start = color_glyph(host, "gray", "barStart")?;
    let text = suffix(host, start, " ")?;
    let state = host.get(prompt, "state")?;
    let marker = host.call("symbol", vec![state])?;
    let text = append(host, text, marker)?;
    let text = suffix(host, text, " ")?;
    append(host, text, message)
}

fn text_input<H: Host>(
    host: &mut H,
    prompt: H::Value,
    opts: H::Value,
) -> Result<H::Value, H::Error> {
    let parts = host.call("placeholder", vec![opts])?;
    if predicate(host, "hasInput", vec![prompt])? {
        return host.get(prompt, "userInputWithCursor");
    }
    let first = host.get(parts, "0")?;
    let color = host.literal("inverse")?;
    if predicate(host, "truthy", vec![first])? {
        let first = host.call("color", vec![color, first])?;
        let text = suffix(host, first, "")?;
        let rest = host.call("dimRest", vec![parts])?;
        append(host, text, rest)
    } else {
        let blank = host.literal("_")?;
        host.call("color", vec![color, blank])
    }
}

fn frame<H: Host>(
    host: &mut H,
    prompt: H::Value,
    opts: H::Value,
    password: bool,
) -> Result<H::Value, H::Error> {
    let value = host.get(prompt, if password { "masked" } else { "value" })?;
    let value = if !password && predicate(host, "nullish", vec![value])? {
        host.literal("")?
    } else {
        value
    };
    let state = host.get(prompt, "state")?;
    let submit = host.is_kind(state, "submit")?;
    let cancel = if submit {
        false
    } else {
        let state = host.get(prompt, "state")?;
        host.is_kind(state, "cancel")?
    };
    // Text computes its placeholder/input before checking the error state.
    // Password computes its cursor only when evaluating the wrap arguments.
    let input = if !password && !submit && !cancel {
        text_input(host, prompt, opts)?
    } else {
        value
    };
    let error = if submit || cancel {
        false
    } else {
        let state = host.get(prompt, "state")?;
        host.is_kind(state, "error")?
    };
    let message = host.get(opts, "message")?;
    let text = header(host, prompt, message)?;
    let text = suffix(host, text, "\n")?;
    let output = host.call("output", vec![opts])?;
    let input = if submit || cancel {
        host.call(if cancel { "strike" } else { "dim" }, vec![value])?
    } else if password {
        host.get(prompt, "userInputWithCursor")?
    } else {
        input
    };
    let prefix = if submit || cancel {
        color_glyph(host, "gray", "bar")?
    } else {
        let state = host.get(prompt, "state")?;
        host.call("symbolBar", vec![state])?
    };
    let prefix = suffix(host, prefix, "  ")?;
    let wrapped = host.call("wrap", vec![output, input, prefix])?;
    let text = append(host, text, wrapped)?;
    let text = suffix(host, text, "\n")?;
    let end = color_glyph(
        host,
        if submit {
            "green"
        } else if cancel {
            "red"
        } else if error {
            "yellow"
        } else {
            "cyan"
        },
        "barEnd",
    )?;
    let text = append(host, text, end)?;
    if error {
        let text = suffix(host, text, "  ")?;
        let message = host.call("colorError", vec![prompt])?;
        append(host, text, message)
    } else {
        Ok(text)
    }
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("defaultText", [value, opts]) => {
            if predicate(host, "truthy", vec![*value])? {
                return Ok(*value);
            }
            let default = host.get(*opts, "defaultValue")?;
            if predicate(host, "truthy", vec![default])? {
                Ok(default)
            } else {
                host.literal("")
            }
        }
        ("textFinalize", [prompt, opts]) => {
            let state = host.get(*prompt, "state")?;
            if host.is_kind(state, "submit")? {
                host.call("finalizeText", vec![*prompt, *opts])?;
            }
            host.call("undefined", vec![])
        }
        ("textCursor" | "passwordCursor", [prompt]) => {
            cursor(host, *prompt, operation == "passwordCursor")
        }
        ("textFrame" | "passwordFrame", [prompt, opts]) => {
            frame(host, *prompt, *opts, operation == "passwordFrame")
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
