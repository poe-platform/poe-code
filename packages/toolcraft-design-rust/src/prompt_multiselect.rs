//! Multiselect validation, toggle and presentation decisions.
use crate::{
    feedback::Host,
    prompt_components::{append, color_glyph, suffix},
    prompt_selection::{find, header},
};

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn current<H: Host>(host: &mut H, prompt: H::Value) -> Result<H::Value, H::Error> {
    let value = host.get(prompt, "value")?;
    if predicate(host, "nullish", vec![value])? {
        host.call("array", vec![])
    } else {
        Ok(value)
    }
}

fn option<H: Host>(
    host: &mut H,
    option: H::Value,
    values: H::Value,
    active: H::Value,
) -> Result<H::Value, H::Error> {
    let value = host.get(option, "value")?;
    let selected = host.call("hasValue", vec![values, value])?;
    let hint = host.get(option, "hint")?;
    let hint = if predicate(host, "truthy", vec![hint])? {
        host.call("hint", vec![option])?
    } else {
        host.literal("")?
    };
    let disabled = host.get(option, "disabled")?;
    let disabled = predicate(host, "truthy", vec![disabled])?;
    let selected = !disabled && predicate(host, "truthy", vec![selected])?;
    let active = !disabled && predicate(host, "truthy", vec![active])?;
    let (color, glyph) = if disabled {
        ("gray", "checkboxInactive")
    } else if selected {
        ("green", "checkboxSelected")
    } else if active {
        ("cyan", "checkboxActive")
    } else {
        ("dim", "checkboxInactive")
    };
    let marker = color_glyph(host, color, glyph)?;
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

fn frame<H: Host>(host: &mut H, prompt: H::Value, opts: H::Value) -> Result<H::Value, H::Error> {
    let state = host.get(prompt, "state")?;
    let closed = if host.is_kind(state, "submit")? {
        true
    } else {
        let state = host.get(prompt, "state")?;
        host.is_kind(state, "cancel")?
    };
    if closed {
        let selected = host.call("selectedOptions", vec![prompt])?;
        let length = host.get(selected, "length")?;
        let three = host.number(3.)?;
        let labels = if predicate(host, "gt", vec![length, three])? {
            let state = host.get(prompt, "state")?;
            host.call(
                if host.is_kind(state, "submit")? {
                    "countLabel"
                } else {
                    "countStrikeLabel"
                },
                vec![selected],
            )?
        } else {
            host.call("selectedLabels", vec![prompt, selected])?
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
        let labels = host.call("wrap", vec![output, labels, prefix])?;
        let text = append(host, text, labels)?;
        let text = suffix(host, text, "\n")?;
        return append(host, text, end);
    }
    let lines = host.call("lines", vec![prompt, opts])?;
    let header = header(host, prompt, opts)?;
    let body = host.call("body", vec![header, lines])?;
    let state = host.get(prompt, "state")?;
    host.call(
        if host.is_kind(state, "error")? {
            "pushError"
        } else {
            "pushEnd"
        },
        vec![body, prompt],
    )?;
    host.call("joinLines", vec![body])
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("initial", [opts]) => {
            let options = host.get(*opts, "options")?;
            let length = host.get(options, "length")?;
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![length, zero])? {
                let message = host.literal("Multiselect prompt requires at least one option.")?;
                return host.call("error", vec![message]);
            }
            let options = host.get(*opts, "options")?;
            if predicate(host, "allDisabled", vec![options])? {
                let message =
                    host.literal("Multiselect prompt requires at least one enabled option.")?;
                return host.call("error", vec![message]);
            }
            let options = host.get(*opts, "options")?;
            let one = host.number(1.)?;
            find(host, zero, one, options)
        }
        ("validate", [opts, value]) => {
            let required = host.get(*opts, "required")?;
            if predicate(host, "truthy", vec![required])? {
                let empty = if !predicate(host, "truthy", vec![*value])? {
                    true
                } else {
                    let length = host.get(*value, "length")?;
                    let zero = host.number(0.)?;
                    predicate(host, "same", vec![length, zero])?
                };
                if empty {
                    return host.literal("Please select at least one option.\nPress SPACE to select, ENTER to submit");
                }
            }
            host.call("undefined", vec![])
        }
        ("cursor", [prompt, action]) => {
            if host.is_kind(*action, "up")? || host.is_kind(*action, "left")? {
                host.call("moveUp", vec![*prompt])?;
            } else if host.is_kind(*action, "down")? || host.is_kind(*action, "right")? {
                host.call("moveDown", vec![*prompt])?;
            } else if host.is_kind(*action, "space")? {
                host.call("toggleFocused", vec![*prompt])?;
            }
            host.call("undefined", vec![])
        }
        ("key", [prompt, key]) => {
            if host.is_kind(*key, "a")? {
                host.call("toggleAll", vec![*prompt])?;
            } else if host.is_kind(*key, "i")? {
                host.call("invert", vec![*prompt])?;
            }
            host.call("undefined", vec![])
        }
        ("toggleFocused", [prompt]) => {
            let item = host.call("focusedOption", vec![*prompt])?;
            if predicate(host, "truthy", vec![item])? {
                let disabled = host.get(item, "disabled")?;
                if !predicate(host, "truthy", vec![disabled])? {
                    host.call("toggleOption", vec![*prompt, item])?;
                }
            }
            host.call("undefined", vec![])
        }
        ("toggleValue", [prompt, value]) => {
            let current = current(host, *prompt)?;
            host.call("setToggled", vec![*prompt, current, *value])?;
            host.call("undefined", vec![])
        }
        ("toggleResult", [current, value]) => {
            let included = predicate(host, "includes", vec![*current, *value])?;
            host.call(
                if included { "removeValue" } else { "addValue" },
                vec![*current, *value],
            )
        }
        ("toggleAll", [prompt]) => {
            let enabled = host.call("enabledValues", vec![*prompt])?;
            let current = current(host, *prompt)?;
            let selected = predicate(host, "allSelected", vec![enabled, current])?;
            let value = if selected {
                host.call("array", vec![])?
            } else {
                enabled
            };
            host.call("setValue", vec![*prompt, value])?;
            host.call("undefined", vec![])
        }
        ("invert", [prompt]) => {
            let current = current(host, *prompt)?;
            host.call("setInverted", vec![*prompt, current])?;
            host.call("undefined", vec![])
        }
        ("nonTty", [prompt, fallback]) => {
            let mode = host.call("noPrompt", vec![])?;
            host.call(
                if host.is_kind(mode, "1")? {
                    "resolveValues"
                } else {
                    "nonTty"
                },
                vec![*prompt, *fallback],
            )
        }
        ("option", [item, values, active]) => option(host, *item, *values, *active),
        ("selectedLabel", [prompt, item]) => {
            let state = host.get(*prompt, "state")?;
            host.call(
                if host.is_kind(state, "submit")? {
                    "dimLabel"
                } else {
                    "strikeLabel"
                },
                vec![*item],
            )
        }
        ("line", [prompt, line]) => {
            let state = host.get(*prompt, "state")?;
            let color = if host.is_kind(state, "error")? {
                "yellow"
            } else {
                "cyan"
            };
            let bar = color_glyph(host, color, "bar")?;
            let text = suffix(host, bar, "  ")?;
            append(host, text, *line)
        }
        ("errorEnd", [prompt]) => {
            let end = color_glyph(host, "yellow", "barEnd")?;
            let text = suffix(host, end, "  ")?;
            let error = host.call("colorError", vec![*prompt])?;
            append(host, text, error)
        }
        ("frame", [prompt, opts]) => frame(host, *prompt, *opts),
        _ => host.call("invalidOperation", vec![]),
    }
}
