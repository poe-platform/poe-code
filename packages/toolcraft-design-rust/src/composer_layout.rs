//! Wrapped composer rows, UTF-16 starts, caret placement and cache admission.
use crate::feedback::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn cursor_matches<H: Host>(
    host: &mut H,
    frame: H::Value,
    state: H::Value,
) -> Result<bool, H::Error> {
    let offset = host.get(frame, "offset")?;
    let cursor = host.get(state, "cursor")?;
    predicate(host, "same", vec![offset, cursor])
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("layout", [state, width]) => {
            let one = host.number(1.)?;
            let width = host.call("max", vec![one, *width])?;
            let cached = host.call("cached", vec![*state])?;
            let cached_text = host.call("cachedText", vec![cached])?;
            let text = host.get(*state, "text")?;
            if predicate(host, "same", vec![cached_text, text])? {
                let cached_cursor = host.get(cached, "cursor")?;
                let cursor = host.get(*state, "cursor")?;
                if predicate(host, "same", vec![cached_cursor, cursor])? {
                    let cached_width = host.get(cached, "width")?;
                    if predicate(host, "same", vec![cached_width, width])? {
                        return host.get(cached, "layout");
                    }
                }
            }
            let frame = host.call("frame", vec![])?;
            let text = host.get(*state, "text")?;
            host.call("segments", vec![frame, text, *state, width])?;
            if cursor_matches(host, frame, *state)? {
                let column = host.get(frame, "column")?;
                if predicate(host, "ge", vec![column, width])? {
                    let zero = host.number(0.)?;
                    host.call("lineBreak", vec![frame, zero])?;
                }
                host.call("markCursor", vec![frame])?;
            }
            let layout = host.call("result", vec![frame])?;
            let text = host.get(*state, "text")?;
            let cursor = host.get(*state, "cursor")?;
            host.call("cache", vec![*state, text, cursor, width, layout])?;
            Ok(layout)
        }
        ("step", [frame, segment, state, width]) => {
            let tab = host.is_kind(*segment, "\t")?;
            let cells = if tab {
                host.number(2.)?
            } else {
                host.call("measure", vec![*segment])?
            };
            let newline = host.is_kind(*segment, "\n")?;
            if !newline {
                let column = host.get(*frame, "column")?;
                let next = host.call("add", vec![column, cells])?;
                if predicate(host, "gt", vec![next, *width])? {
                    let zero = host.number(0.)?;
                    host.call("lineBreak", vec![*frame, zero])?;
                }
            }
            if cursor_matches(host, *frame, *state)? {
                host.call("markCursor", vec![*frame])?;
            }
            if newline {
                let one = host.number(1.)?;
                host.call("lineBreak", vec![*frame, one])?;
            } else {
                let text = if tab { host.literal("  ")? } else { *segment };
                host.call("append", vec![*frame, text, cells])?;
            }
            host.call("advance", vec![*frame, *segment])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
