//! Interactive prompt transitions. Streams, callbacks and JS values stay on the host.
use crate::feedback::Host;

fn test<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn flag<H: Host>(host: &mut H, object: H::Value, key: &str) -> Result<bool, H::Error> {
    let value = host.get(object, key)?;
    test(host, "truthy", vec![value])
}
fn kind<H: Host>(host: &mut H, object: H::Value, key: &str, value: &str) -> Result<bool, H::Error> {
    let property = host.get(object, key)?;
    host.is_kind(property, value)
}
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
fn state<H: Host>(host: &mut H, object: H::Value, value: &'static str) -> Result<(), H::Error> {
    let value = host.literal(value)?;
    set(host, object, "state", value)
}
fn emit<H: Host>(
    host: &mut H,
    object: H::Value,
    name: &'static str,
    args: &[H::Value],
) -> Result<(), H::Error> {
    let name = host.literal(name)?;
    let mut values = vec![object, name];
    values.extend_from_slice(args);
    host.call("emit", values)?;
    Ok(())
}
fn emit_property<H: Host>(
    host: &mut H,
    object: H::Value,
    name: &'static str,
    key: &'static str,
) -> Result<(), H::Error> {
    let name = host.literal(name)?;
    let key = host.literal(key)?;
    host.call("emitProperty", vec![object, name, key])?;
    Ok(())
}
fn finished<H: Host>(host: &mut H, object: H::Value) -> Result<bool, H::Error> {
    Ok(kind(host, object, "state", "submit")? || kind(host, object, "state", "cancel")?)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("mapKey", [name, character]) => {
            if host.is_kind(*character, "\u{3}")? {
                return host.literal("cancel");
            }
            if host.is_kind(*character, " ")? {
                return host.literal("space");
            }
            if !host.is_undefined(*character)? {
                let alias = host.call("alias", vec![*character])?;
                if !host.is_undefined(alias)? {
                    return host.call("alias", vec![*character]);
                }
            }
            if !test(host, "truthy", vec![*name])? {
                return host.call("undefined", vec![]);
            }
            let action = host.call("keyAction", vec![*name])?;
            if test(host, "nullish", vec![action])? {
                host.call("alias", vec![*name])
            } else {
                Ok(action)
            }
        }
        ("nonTtyPromptMessage", [argv]) => {
            let tokens = host.call("array", vec![])?;
            let values = host.call("args", vec![*argv])?;
            host.call("commandArgs", vec![values, tokens])?;
            host.call("nonTtyMessage", vec![tokens])
        }
        ("commandArg", [value, tokens]) => {
            if test(host, "startsFlag", vec![*value])? {
                return host.call("true", vec![]);
            }
            host.call("push", vec![*tokens, *value])?;
            host.call("false", vec![])
        }
        ("alignSegment", [s, p, segment]) => {
            let boundary = host.get(*s, "boundary")?;
            let cursor = host.get(*p, "_cursor")?;
            if test(host, "ge", vec![boundary, cursor])? {
                return host.call("true", vec![]);
            }
            let length = host.get(*segment, "length")?;
            let boundary = host.call("add", vec![boundary, length])?;
            set(host, *s, "boundary", boundary)?;
            host.call("false", vec![])
        }
        ("getColumns" | "getRows", [output]) => {
            let mut value = host.get(
                *output,
                if operation == "getColumns" {
                    "columns"
                } else {
                    "rows"
                },
            )?;
            if test(host, "nullish", vec![value])? {
                value = host.number(if operation == "getColumns" { 80. } else { 20. })?;
            }
            host.call("max1", vec![value])
        }
        ("wrapFrame", [output, frame]) => {
            let columns = run(host, "getColumns", &[*output])?;
            host.call("wrap", vec![*frame, columns])
        }
        ("wrapTextWithPrefix", [output, text, prefix, start]) => {
            let columns = run(host, "getColumns", &[*output])?;
            let width = host.call("width", vec![*prefix])?;
            let available = host.call("subtract", vec![columns, width])?;
            let available = host.call("max1", vec![available])?;
            let wrapped = host.call("wrap", vec![*text, available])?;
            host.call("prefixLines", vec![wrapped, *prefix, *start])
        }
        ("prompt", [p]) => {
            if test(host, "signalAborted", vec![*p])? {
                state(host, *p, "cancel")?;
                return host.call("resolvedCancel", vec![]);
            }
            let input = host.get(*p, "input")?;
            let tty = host.get(input, "isTTY")?;
            if !host.is_true(tty)? {
                return host.call("nonTty", vec![*p]);
            }
            let input = host.get(*p, "input")?;
            let destroyed = flag(host, input, "destroyed")?;
            let ended = if destroyed {
                false
            } else {
                let input = host.get(*p, "input")?;
                flag(host, input, "readableEnded")?
            };
            if destroyed || ended {
                state(host, *p, "cancel")?;
                return host.call("resolvedCancel", vec![]);
            }
            host.call("ttyPrompt", vec![*p])
        }
        ("nonTtyResult", [p, value]) => {
            if test(host, "cancelled", vec![*value])? || !flag(host, *p, "trackValue")? {
                return Ok(*value);
            }
            host.call("setValue", vec![*p, *value])?;
            let error = host.call("validation", vec![*p])?;
            if test(host, "truthy", vec![error])? {
                return host.call("throwValidation", vec![error]);
            }
            state(host, *p, "submit")?;
            emit(host, *p, "finalize", &[])?;
            host.get(*p, "value")
        }
        ("readLine", [p]) => {
            let input = host.get(*p, "input")?;
            if flag(host, input, "readableEnded")? {
                return host.call("resolvedEmpty", vec![]);
            }
            let input = host.get(*p, "input")?;
            if flag(host, input, "destroyed")? {
                state(host, *p, "cancel")?;
                return host.call("resolvedCancel", vec![]);
            }
            let input = host.get(*p, "input")?;
            if test(host, "readable", vec![input])? {
                host.call("readStream", vec![*p, input])
            } else {
                host.call("readGenericStream", vec![*p])
            }
        }
        ("setValue", [p, value]) => {
            set(host, *p, "value", *value)?;
            emit(host, *p, "value", &[*value])?;
            host.call("undefined", vec![])
        }
        ("setUserInput", [p, value]) => {
            set(host, *p, "userInput", *value)?;
            host.call("minCursor", vec![*p])?;
            if flag(host, *p, "trackValue")? {
                let boundary = host.call("alignCursor", vec![*p, *value])?;
                set(host, *p, "_cursor", boundary)?;
            }
            emit_property(host, *p, "userInput", "userInput")?;
            host.call("undefined", vec![])
        }
        ("clearUserInput", [p]) => host.call("clearInput", vec![*p]),
        ("onCancel", [p]) => {
            if flag(host, *p, "closed")? || finished(host, *p)? {
                return host.call("undefined", vec![]);
            }
            state(host, *p, "cancel")?;
            emit(host, *p, "finalize", &[])?;
            host.call("render", vec![*p])?;
            host.call("close", vec![*p])?;
            host.call("undefined", vec![])
        }
        ("onKeypress", [p, character, key]) => {
            if flag(host, *p, "closed")? {
                return host.call("undefined", vec![]);
            }
            let name = host.get(*key, "name")?;
            let mut action = run(host, "mapKey", &[name, *character])?;
            let space = host.literal(" ")?;
            if flag(host, *p, "trackValue")?
                && test(host, "truthy", vec![*character])?
                && test(host, "ge", vec![*character, space])?
                && !kind(host, *key, "name", "return")?
                && !kind(host, *key, "name", "enter")?
                && !kind(host, *key, "name", "escape")?
            {
                action = host.call("undefined", vec![])?;
            }
            if flag(host, *p, "trackValue")? && !host.is_kind(action, "enter")? {
                host.call("updateTrackedInput", vec![*p, *character, *key, action])?;
            }
            if kind(host, *p, "state", "error")? {
                state(host, *p, "active")?;
                let empty = host.literal("")?;
                set(host, *p, "error", empty)?;
            }
            if (!flag(host, *p, "trackValue")? && test(host, "truthy", vec![action])?)
                || (flag(host, *p, "trackValue")?
                    && test(host, "truthy", vec![action])?
                    && !host.is_kind(action, "enter")?)
            {
                emit(host, *p, "cursor", &[action])?;
            }
            if test(host, "truthy", vec![*character])?
                && test(host, "confirmKey", vec![*character])?
            {
                host.call("emitConfirmation", vec![*p, *character])?;
            }
            if test(host, "truthy", vec![*character])? {
                host.call("emitKey", vec![*p, *character, *key])?;
            }
            if host.is_kind(action, "enter")? {
                let error = host.call("validation", vec![*p])?;
                if test(host, "truthy", vec![error])? {
                    let error = host.call("validationMessage", vec![error])?;
                    set(host, *p, "error", error)?;
                    state(host, *p, "error")?;
                } else {
                    state(host, *p, "submit")?;
                }
            }
            if host.is_kind(action, "cancel")? {
                state(host, *p, "cancel")?;
            }
            if finished(host, *p)? {
                emit(host, *p, "finalize", &[])?;
            }
            host.call("render", vec![*p])?;
            if finished(host, *p)? {
                host.call("close", vec![*p])?;
            }
            host.call("undefined", vec![])
        }
        ("updateTrackedInput", [p, character, key, action]) => {
            edit(host, *p, *character, *key, *action)
        }
        ("render", [p]) => {
            if flag(host, *p, "closed")? {
                return host.call("undefined", vec![]);
            }
            let frame = host.call("frame", vec![*p])?;
            let previous = host.get(*p, "previousFrame")?;
            if test(host, "same", vec![frame, previous])? {
                return host.call("undefined", vec![]);
            }
            if !flag(host, *p, "previousFrame")? {
                host.call("firstWrite", vec![*p, frame])?;
                set(host, *p, "previousFrame", frame)?;
                if kind(host, *p, "state", "initial")? {
                    state(host, *p, "active")?;
                }
            } else {
                host.call("replaceWrite", vec![*p, frame])?;
                set(host, *p, "previousFrame", frame)?;
            }
            host.call("undefined", vec![])
        }
        ("close", [p]) => {
            if flag(host, *p, "closed")? {
                return host.call("undefined", vec![]);
            }
            let yes = host.call("true", vec![])?;
            set(host, *p, "closed", yes)?;
            host.call("detach", vec![*p])?;
            host.call("showCursor", vec![*p])?;
            if !test(host, "windows", vec![])? {
                let input = host.get(*p, "input")?;
                if flag(host, input, "setRawMode")? {
                    host.call("rawOff", vec![*p])?;
                }
            }
            host.call("closeReadline", vec![*p])?;
            host.call("unpipe", vec![*p])?;
            if kind(host, *p, "state", "cancel")? {
                emit(host, *p, "cancel", &[])?;
            } else {
                emit_property(host, *p, "submit", "value")?;
            }
            host.call("removeAll", vec![*p])?;
            host.call("undefined", vec![])
        }
        ("lineChunk", [s, chunk]) => line_chunk(host, *s, *chunk),
        _ => host.call("invalidOperation", vec![]),
    }
}

fn edit<H: Host>(
    host: &mut H,
    p: H::Value,
    character: H::Value,
    key: H::Value,
    action: H::Value,
) -> Result<H::Value, H::Error> {
    let zero = host.number(0.)?;
    if kind(host, key, "name", "home")? {
        set(host, p, "_cursor", zero)?;
        return host.call("undefined", vec![]);
    }
    if kind(host, key, "name", "end")? {
        let input = host.get(p, "userInput")?;
        let length = host.get(input, "length")?;
        set(host, p, "_cursor", length)?;
        return host.call("undefined", vec![]);
    }
    if flag(host, key, "ctrl")? {
        if kind(host, key, "name", "a")? {
            set(host, p, "_cursor", zero)?;
            return host.call("undefined", vec![]);
        }
        if kind(host, key, "name", "e")? {
            let input = host.get(p, "userInput")?;
            let length = host.get(input, "length")?;
            set(host, p, "_cursor", length)?;
            return host.call("undefined", vec![]);
        }
        if kind(host, key, "name", "u")? {
            let remaining = host.call("after", vec![p])?;
            set(host, p, "_cursor", zero)?;
            host.call("setUserInput", vec![p, remaining])?;
            return host.call("undefined", vec![]);
        }
        if kind(host, key, "name", "k")? {
            host.call("cutInput", vec![p])?;
            return host.call("undefined", vec![]);
        }
    }
    let before = host.call("before", vec![p])?;
    let after = host.call("after", vec![p])?;
    if host.is_kind(action, "left")? || host.is_kind(action, "right")? {
        let left = host.is_kind(action, "left")?;
        let cursor = host.get(p, "_cursor")?;
        let length = host.call(
            if left { "lastSize" } else { "firstSize" },
            vec![if left { before } else { after }],
        )?;
        let cursor = host.call(if left { "subtract" } else { "add" }, vec![cursor, length])?;
        set(host, p, "_cursor", cursor)?;
        return host.call("undefined", vec![]);
    }
    for value in ["cancel", "up", "down", "space"] {
        if host.is_kind(action, value)? {
            return host.call("undefined", vec![]);
        }
    }
    if kind(host, key, "name", "backspace")?
        || host.is_kind(character, "\u{8}")?
        || host.is_kind(character, "\u{7f}")?
    {
        let cursor = host.get(p, "_cursor")?;
        if test(host, "gt", vec![cursor, zero])? {
            let cursor = host.get(p, "_cursor")?;
            let length = host.call("lastSize", vec![before])?;
            let cursor = host.call("subtract", vec![cursor, length])?;
            set(host, p, "_cursor", cursor)?;
            host.call("backspaceInput", vec![p, before, after])?;
        }
        return host.call("undefined", vec![]);
    }
    if kind(host, key, "name", "delete")? {
        let cursor = host.get(p, "_cursor")?;
        let input = host.get(p, "userInput")?;
        let length = host.get(input, "length")?;
        if test(host, "lt", vec![cursor, length])? {
            host.call("deleteInput", vec![p, before, after])?;
        }
        return host.call("undefined", vec![]);
    }
    let space = host.literal(" ")?;
    if !test(host, "truthy", vec![character])?
        || test(host, "lt", vec![character, space])?
        || flag(host, key, "ctrl")?
    {
        return host.call("undefined", vec![]);
    }
    let cursor = host.get(p, "_cursor")?;
    let length = host.get(character, "length")?;
    let cursor = host.call("add", vec![cursor, length])?;
    set(host, p, "_cursor", cursor)?;
    host.call("insertInput", vec![p, before, character, after])?;
    host.call("undefined", vec![])
}

fn line_chunk<H: Host>(host: &mut H, s: H::Value, chunk: H::Value) -> Result<H::Value, H::Error> {
    let zero = host.number(0.)?;
    let length = host.get(chunk, "length")?;
    if test(host, "same", vec![length, zero])? {
        return host.call("undefined", vec![]);
    }
    if flag(host, s, "settled")? {
        let input = host.get(s, "input")?;
        if !flag(host, input, "destroyed")? {
            host.call("unshift", vec![s, chunk])?;
        }
        return host.call("undefined", vec![]);
    }
    let mut offset = zero;
    let previous = host.call("pending", vec![s])?;
    if !host.is_undefined(previous)? {
        host.call("deletePending", vec![s])?;
        if test(host, "lineFeed", vec![chunk, zero])? && test(host, "freshCR", vec![previous])? {
            offset = host.number(1.)?;
        }
    }
    loop {
        let length = host.get(chunk, "length")?;
        if !test(host, "lt", vec![offset, length])? {
            break;
        }
        let character = host.call("character", vec![s, chunk, offset])?;
        let cr = host.literal("\r")?;
        let lf = host.literal("\n")?;
        if test(host, "ends", vec![character, cr])? || test(host, "ends", vec![character, lf])? {
            host.call("appendTrimmed", vec![s, character])?;
            offset = host.call("increment", vec![offset])?;
            if test(host, "ends", vec![character, cr])? {
                let length = host.get(chunk, "length")?;
                if test(host, "same", vec![offset, length])? {
                    host.call("rememberCR", vec![s])?;
                } else if test(host, "lineFeed", vec![chunk, offset])? {
                    offset = host.call("increment", vec![offset])?;
                }
            }
            host.call("settleLine", vec![s, chunk, offset])?;
            return host.call("undefined", vec![]);
        }
        host.call("appendLine", vec![s, character])?;
        offset = host.call("increment", vec![offset])?;
    }
    host.call("undefined", vec![])
}
