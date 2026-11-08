//! Composer editing decisions with host grapheme boundaries and observable state.
use crate::feedback::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn flag<H: Host>(host: &mut H, value: H::Value, name: &str) -> Result<bool, H::Error> {
    let value = host.get(value, name)?;
    predicate(host, "truthy", vec![value])
}
fn ctrl<H: Host>(
    host: &mut H,
    event: H::Value,
    key: H::Value,
    name: &str,
) -> Result<bool, H::Error> {
    Ok(flag(host, event, "ctrl")? && host.is_kind(key, name)?)
}
fn insert<H: Host>(
    host: &mut H,
    state: H::Value,
    next: H::Value,
    text: H::Value,
) -> Result<(), H::Error> {
    let start = host.get(state, "cursor")?;
    let end = host.get(state, "cursor")?;
    host.call("replace", vec![next, state, start, end, text])?;
    Ok(())
}
fn vertical<H: Host>(
    host: &mut H,
    state: H::Value,
    next: H::Value,
    key: H::Value,
    width: H::Value,
) -> Result<H::Value, H::Error> {
    let layout = host.call("layout", vec![state, width])?;
    let direction = host.number(if host.is_kind(key, "up")? { -1. } else { 1. })?;
    let row = host.call("row", vec![layout, direction])?;
    let cursor = host.get(layout, "cursor")?;
    let y = host.get(cursor, "y")?;
    if predicate(host, "same", vec![row, y])? {
        return host.call("handled", vec![state]);
    }
    let previous_width = host.get(state, "preferredWidth")?;
    let preferred = if predicate(host, "same", vec![previous_width, width])? {
        host.get(state, "preferredColumn")?
    } else {
        host.call("undefined", vec![])?
    };
    let preferred = if predicate(host, "nullish", vec![preferred])? {
        let cursor = host.get(layout, "cursor")?;
        host.get(cursor, "x")?
    } else {
        preferred
    };
    host.call("preferred", vec![next, preferred, width])?;
    host.call("startCursor", vec![next, layout, row])?;
    host.call("verticalSegments", vec![state, next, layout, row])?;
    host.call("handled", vec![next])
}
fn edit<H: Host>(
    host: &mut H,
    state: H::Value,
    event: H::Value,
    width: H::Value,
) -> Result<H::Value, H::Error> {
    let name = host.get(event, "name")?;
    let key = if predicate(host, "nullish", vec![name])? {
        host.get(event, "ch")?
    } else {
        name
    };
    if !flag(host, state, "focused")? || ctrl(host, event, key, "c")? {
        return host.call("unhandled", vec![state]);
    }
    if host.is_kind(key, "escape")? {
        return host.call("escape", vec![state]);
    }
    let next = host.call("next", vec![state])?;
    if (host.is_kind(key, "up")? || host.is_kind(key, "down")?)
        && !flag(host, event, "ctrl")?
        && !flag(host, event, "meta")?
    {
        return vertical(host, state, next, key, width);
    }
    let mut needs_segments = false;
    for name in ["left", "right", "backspace", "delete"] {
        if host.is_kind(key, name)? {
            needs_segments = true;
            break;
        }
    }
    if !needs_segments && flag(host, event, "ctrl")? {
        needs_segments = host.is_kind(key, "d")? || host.is_kind(key, "w")?;
    }
    let segments = if needs_segments {
        host.call("segment", vec![state])?
    } else {
        host.call("undefined", vec![])?
    };
    let previous = host.call("previous", vec![segments, state])?;
    let current = host.call("current", vec![segments, state])?;
    let following = host.call("following", vec![current, state])?;
    let cursor = host.get(state, "cursor")?;
    let zero = host.number(0.)?;
    let line_start = if predicate(host, "same", vec![cursor, zero])? {
        zero
    } else {
        host.call("lineStart", vec![state])?
    };
    let newline = host.call("newline", vec![state])?;
    let missing = host.number(-1.)?;
    let line_end = if predicate(host, "same", vec![newline, missing])? {
        let text = host.get(state, "text")?;
        host.get(text, "length")?
    } else {
        newline
    };
    let name = host.get(event, "name")?;
    let empty = host.literal("")?;
    if host.is_kind(name, "paste")? {
        let text = host.call("paste", vec![event])?;
        insert(host, state, next, text)?;
    } else if (host.is_kind(key, "return")? || host.is_kind(key, "enter")?)
        && (flag(host, event, "meta")? || flag(host, event, "shift")?)
    {
        let newline = host.literal("\n")?;
        insert(host, state, next, newline)?;
    } else if host.is_kind(key, "return")?
        || host.is_kind(key, "enter")?
        || host.is_kind(key, "tab")?
    {
        let text = host.call("trimState", vec![state])?;
        if !predicate(host, "truthy", vec![text])? {
            return host.call("handled", vec![state]);
        }
        let kind = host.get(state, "kind")?;
        let text = host.call("trimState", vec![state])?;
        let submission = host.call("submission", vec![kind, text])?;
        let kind = host.get(state, "kind")?;
        if host.is_kind(kind, "message")? && flag(host, state, "afterPlanId")? {
            let after = host.get(state, "afterPlanId")?;
            host.call("afterPlan", vec![submission, after])?;
        }
        return host.call("submitted", vec![state, submission]);
    } else if host.is_kind(key, "left")? && !flag(host, event, "meta")? {
        host.call("cursor", vec![next, previous])?;
    } else if host.is_kind(key, "right")? && !flag(host, event, "meta")? {
        host.call("cursor", vec![next, following])?;
    } else if host.is_kind(key, "home")? || ctrl(host, event, key, "a")? {
        host.call("cursor", vec![next, line_start])?;
    } else if host.is_kind(key, "end")? || ctrl(host, event, key, "e")? {
        host.call("cursor", vec![next, line_end])?;
    } else if host.is_kind(key, "backspace")? {
        let cursor = host.get(state, "cursor")?;
        host.call("replace", vec![next, state, previous, cursor, empty])?;
    } else if host.is_kind(key, "delete")? || ctrl(host, event, key, "d")? {
        let cursor = host.get(state, "cursor")?;
        host.call("replace", vec![next, state, cursor, following, empty])?;
    } else if ctrl(host, event, key, "u")? {
        let cursor = host.get(state, "cursor")?;
        host.call("replace", vec![next, state, line_start, cursor, empty])?;
    } else if ctrl(host, event, key, "k")? {
        let cursor = host.get(state, "cursor")?;
        host.call("replace", vec![next, state, cursor, line_end, empty])?;
    } else if ctrl(host, event, key, "w")? {
        let mut start = host.get(state, "cursor")?;
        let mut preceding = host.call("before", vec![segments, start])?;
        for whitespace in [true, false] {
            while predicate(host, "truthy", vec![preceding])? {
                let trimmed = host.call("trimSegment", vec![preceding])?;
                if host.is_kind(trimmed, "")? != whitespace {
                    break;
                }
                start = host.get(preceding, "index")?;
                preceding = host.call("before", vec![segments, start])?;
            }
        }
        let cursor = host.get(state, "cursor")?;
        host.call("replace", vec![next, state, start, cursor, empty])?;
    } else {
        let ch = host.get(event, "ch")?;
        if host.is_undefined(ch)? || flag(host, event, "ctrl")? || flag(host, event, "meta")? {
            return host.call("unhandled", vec![state]);
        }
        let start = host.get(state, "cursor")?;
        let end = host.get(state, "cursor")?;
        let text = host.get(event, "ch")?;
        host.call("replace", vec![next, state, start, end, text])?;
    }
    host.call("handled", vec![next])
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("create", [kind, after]) => {
            let state = host.call("create", vec![*kind])?;
            if predicate(host, "truthy", vec![*after])? {
                host.call("afterPlan", vec![state, *after])?;
            }
            Ok(state)
        }
        ("edit", [state, event, width]) => edit(host, *state, *event, *width),
        ("verticalStep", [frame, next, segment]) => {
            let cells = if host.is_kind(*segment, "\t")? {
                host.number(2.)?
            } else {
                host.call("measure", vec![*segment])?
            };
            let stop = if host.is_kind(*segment, "\n")? {
                true
            } else {
                let column = host.get(*frame, "column")?;
                let end = host.call("add", vec![column, cells])?;
                let preferred = host.get(*next, "preferredColumn")?;
                predicate(host, "gt", vec![end, preferred])?
            };
            if stop {
                host.call("false", vec![])
            } else {
                host.call("advance", vec![*frame, *next, *segment, cells])?;
                host.call("true", vec![])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
