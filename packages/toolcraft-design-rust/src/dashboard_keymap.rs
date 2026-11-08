//! Dashboard key parsing and stateful command/sequence resolution.
use crate::feedback::Host;

pub fn defaults() -> &'static [(&'static str, &'static [&'static str])] {
    &[
        ("forceQuit", &["Ctrl+C"]),
        ("quit", &["q"]),
        ("edit", &["e"]),
        ("pause", &["p"]),
        ("retry", &["r"]),
        ("view-log", &["l"]),
        ("scroll-up", &["up"]),
        ("scroll-down", &["down"]),
        ("page-up", &["pageup"]),
        ("page-down", &["pagedown"]),
        ("follow", &["f", "F", "end"]),
        ("render-stats", &["Ctrl+g"]),
    ]
}
pub fn named_keys() -> &'static [&'static str] {
    &[
        "backspace",
        "delete",
        "down",
        "end",
        "enter",
        "escape",
        "home",
        "left",
        "pagedown",
        "pageup",
        "return",
        "right",
        "tab",
        "up",
    ]
}
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn length_is<H: Host>(host: &mut H, value: H::Value, size: f64) -> Result<bool, H::Error> {
    let length = host.get(value, "length")?;
    let size = host.number(size)?;
    predicate(host, "same", vec![length, size])
}
fn normalize<H: Host>(host: &mut H, value: H::Value) -> Result<H::Value, H::Error> {
    let lower = host.call("lower", vec![value])?;
    if host.is_kind(lower, "space")? {
        return host.literal(" ");
    }
    for (arrow, name) in [("↑", "up"), ("↓", "down"), ("←", "left"), ("→", "right")] {
        if host.is_kind(value, arrow)? {
            return host.literal(name);
        }
    }
    Ok(value)
}
fn shifted<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    if !length_is(host, value, 1.)? {
        return Ok(false);
    }
    let lower = host.call("lower", vec![value])?;
    if predicate(host, "same", vec![lower, value])? {
        return Ok(false);
    }
    let upper = host.call("upper", vec![value])?;
    predicate(host, "same", vec![upper, value])
}
fn character<H: Host>(
    host: &mut H,
    value: H::Value,
    flags: H::Value,
) -> Result<H::Value, H::Error> {
    let shift = host.get(flags, "shift")?;
    let ch = if predicate(host, "truthy", vec![shift])? {
        let lower = host.call("lower", vec![value])?;
        let upper = host.call("upper", vec![value])?;
        if predicate(host, "same", vec![lower, upper])? {
            value
        } else {
            host.call("upper", vec![value])?
        }
    } else {
        value
    };
    host.call("character", vec![ch, flags])
}
fn parse<H: Host>(host: &mut H, binding: H::Value) -> Result<H::Value, H::Error> {
    let value = host.call("trim", vec![binding])?;
    if length_is(host, value, 0.)? {
        return host.call("undefined", vec![]);
    }
    let parts = host.call("parts", vec![value])?;
    if length_is(host, parts, 0.)? {
        return host.call("undefined", vec![]);
    }
    let flags = host.call("flags", vec![])?;
    let key = host.call("last", vec![parts])?;
    if host.is_undefined(key)? {
        return host.call("undefined", vec![]);
    }
    host.call("modifiers", vec![parts, flags])?;
    let normalized = normalize(host, key)?;
    if length_is(host, parts, 1.)? && shifted(host, normalized)? {
        let name = host.literal("shift")?;
        host.call("setFlag", vec![flags, name])?;
    }
    if length_is(host, normalized, 1.)? {
        return character(host, normalized, flags);
    }
    let mut plain = true;
    for name in ["ctrl", "meta", "shift"] {
        let value = host.get(flags, name)?;
        if predicate(host, "truthy", vec![value])? {
            plain = false;
            break;
        }
    }
    if plain
        && !predicate(host, "named", vec![normalized])?
        && predicate(host, "printable", vec![normalized])?
    {
        return host.call("sequence", vec![normalized, flags]);
    }
    let name = host.call("lower", vec![normalized])?;
    host.call("namedBinding", vec![name, flags])
}
fn matches<H: Host>(host: &mut H, binding: H::Value, event: H::Value) -> Result<bool, H::Error> {
    let sequence = host.get(binding, "sequence")?;
    if !host.is_undefined(sequence)? {
        return Ok(false);
    }
    for name in ["ctrl", "meta", "shift"] {
        let a = host.get(binding, name)?;
        let b = host.get(event, name)?;
        if !predicate(host, "same", vec![a, b])? {
            return Ok(false);
        }
    }
    let ch = host.get(binding, "ch")?;
    if !host.is_undefined(ch)? {
        let event_ch = host.get(event, "ch")?;
        let ch = host.get(binding, "ch")?;
        if predicate(host, "same", vec![event_ch, ch])? {
            return Ok(true);
        }
        let name = host.get(event, "name")?;
        let ch = host.get(binding, "ch")?;
        let lower = host.call("lower", vec![ch])?;
        return predicate(host, "same", vec![name, lower]);
    }
    let name = host.get(binding, "name")?;
    if !host.is_undefined(name)? {
        let event_name = host.get(event, "name")?;
        let name = host.get(binding, "name")?;
        return predicate(host, "same", vec![event_name, name]);
    }
    Ok(false)
}
fn token<H: Host>(host: &mut H, event: H::Value) -> Result<H::Value, H::Error> {
    for name in ["ctrl", "meta"] {
        let value = host.get(event, name)?;
        if predicate(host, "truthy", vec![value])? {
            return host.call("undefined", vec![]);
        }
    }
    let ch = host.get(event, "ch")?;
    if host.is_undefined(ch)? {
        return host.call("undefined", vec![]);
    }
    host.get(event, "ch")
}
fn pending<H: Host>(host: &mut H, state: H::Value, value: H::Value) -> Result<H::Value, H::Error> {
    host.call("pending", vec![state, value])
}
fn resolve<H: Host>(host: &mut H, state: H::Value, event: H::Value) -> Result<H::Value, H::Error> {
    let single = host.literal("single")?;
    let found = host.call("scan", vec![state, event, single])?;
    let matched = host.get(found, "found")?;
    let empty = host.literal("")?;
    if host.is_true(matched)? {
        pending(host, state, empty)?;
        return host.get(found, "value");
    }
    let token = token(host, event)?;
    if host.is_undefined(token)? {
        pending(host, state, empty)?;
        return host.call("undefined", vec![]);
    }
    let previous = host.get(state, "pendingSequence")?;
    let next = host.call("concat", vec![previous, token])?;
    pending(host, state, next)?;
    let sequence = host.literal("sequenceMatch")?;
    let found = host.call("scan", vec![state, event, sequence])?;
    let matched = host.get(found, "found")?;
    if host.is_true(matched)? {
        pending(host, state, empty)?;
        return host.get(found, "value");
    }
    if predicate(host, "hasPrefix", vec![state])? {
        return host.call("undefined", vec![]);
    }
    pending(host, state, token)?;
    if !predicate(host, "hasPrefix", vec![state])? {
        pending(host, state, empty)?;
    }
    host.call("undefined", vec![])
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("parse", [binding]) => parse(host, *binding),
        ("modifier", [flags, modifier]) => {
            let normalized = host.call("lower", vec![*modifier])?;
            let name =
                if host.is_kind(normalized, "ctrl")? || host.is_kind(normalized, "control")? {
                    Some("ctrl")
                } else if host.is_kind(normalized, "meta")? || host.is_kind(normalized, "alt")? {
                    Some("meta")
                } else if host.is_kind(normalized, "shift")? {
                    Some("shift")
                } else {
                    None
                };
            if let Some(name) = name {
                let name = host.literal(name)?;
                host.call("setFlag", vec![*flags, name])?;
            }
            host.call("undefined", vec![])
        }
        ("printableChar", [ch]) => {
            let point = host.call("point", vec![*ch])?;
            let min = host.number(32.)?;
            let del = host.number(127.)?;
            let valid = !host.is_undefined(point)?
                && !predicate(host, "lt", vec![point, min])?
                && !predicate(host, "same", vec![point, del])?;
            host.call(if valid { "true" } else { "false" }, vec![])
        }
        ("single", [_state, binding, event]) => {
            let matched = matches(host, *binding, *event)?;
            host.call(if matched { "true" } else { "false" }, vec![])
        }
        ("sequenceMatch", [state, binding, _event]) => {
            let sequence = host.get(*binding, "sequence")?;
            let pending = host.get(*state, "pendingSequence")?;
            let matched = predicate(host, "same", vec![sequence, pending])?;
            host.call(if matched { "true" } else { "false" }, vec![])
        }
        ("register", [state, command, overrides, defaults]) => {
            let keys = host.call("keys", vec![*overrides, *defaults, *command])?;
            let bindings = host.call("parseKeys", vec![keys])?;
            host.call("rememberSequences", vec![*state, bindings])?;
            host.call("setBindings", vec![*state, *command, bindings])
        }
        ("remember", [state, binding]) => {
            let sequence = host.get(*binding, "sequence")?;
            if !host.is_undefined(sequence)? {
                host.call("addSequence", vec![*state, *binding])?;
            }
            host.call("undefined", vec![])
        }
        ("resolve", [state, event]) => resolve(host, *state, *event),
        ("canonical", [binding]) => {
            let parsed = parse(host, *binding)?;
            if host.is_undefined(parsed)? {
                return host.call("undefined", vec![]);
            }
            let modifiers = host.call("canonicalModifiers", vec![parsed])?;
            let name = host.get(parsed, "name")?;
            let key = if predicate(host, "nullish", vec![name])? {
                host.get(parsed, "ch")?
            } else {
                name
            };
            let sequence = host.get(parsed, "sequence")?;
            if !host.is_undefined(sequence)? {
                return host.call("sequenceLower", vec![parsed]);
            }
            if host.is_undefined(key)? {
                host.call("undefined", vec![])
            } else {
                host.call("canonical", vec![modifiers, key])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
