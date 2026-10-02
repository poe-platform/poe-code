//! Legacy terminal lifecycle, sparse output and readline event policy.
use crate::feedback::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! r { ($op:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$op,&args)?}}; }
    macro_rules! s {
        ($value:expr,$key:expr,$item:expr) => {{
            let value = $value;
            let key = host.literal($key)?;
            let item = $item;
            c!("set", value, key, item)
        }};
    }
    macro_rules! o {
        ($value:expr,$key:expr) => {{
            let value = $value;
            let key = host.literal($key)?;
            c!("optionalGet", value, key)
        }};
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let undefined = c!("undefined");
    let mode = match operation {
        "enterRawMode" => Some(("rawMode", true, "")),
        "exitRawMode" => Some(("rawMode", false, "")),
        "enterAltScreen" => Some(("altScreen", true, "\u{1b}[?1049h")),
        "exitAltScreen" => Some(("altScreen", false, "\u{1b}[?1049l")),
        "disableLineWrap" => Some(("lineWrapEnabled", false, "\u{1b}[?7l")),
        "enableLineWrap" => Some(("lineWrapEnabled", true, "\u{1b}[?7h")),
        "hideCursor" => Some(("cursorHidden", true, "\u{1b}[?25l")),
        "showCursor" => Some(("cursorHidden", false, "\u{1b}[?25h")),
        _ => None,
    };
    if let Some((field, enabled, text)) = mode {
        let state = c!("state");
        if p!("truthy", g!(state, "destroyed")) || p!("truthy", g!(state, field)) == enabled {
            return Ok(undefined);
        }
        let value = c!(if enabled { "true" } else { "false" });
        if field == "rawMode" {
            c!("raw", value);
            c!(if enabled { "resume" } else { "pause" });
        } else {
            let text = host.literal(text)?;
            r!("write", text);
        }
        let key = host.literal(field)?;
        c!("set", state, key, value);
        return Ok(undefined);
    }
    match (operation, args) {
        ("write", [text]) => {
            if !p!("truthy", g!(c!("state"), "destroyed")) && !p!("same", g!(*text, "length"), zero)
            {
                c!("write", *text);
            }
        }
        ("coordinate", [value]) => return Ok(c!("max", zero, c!("floor", *value))),
        ("position", [x, y]) => {
            let row = c!("add", r!("coordinate", *y), one);
            let col = c!("add", r!("coordinate", *x), one);
            return Ok(c!("position", row, col));
        }
        ("moveTo", [x, y]) => {
            if !p!("truthy", g!(c!("state"), "destroyed")) {
                r!("write", r!("position", *x, *y));
            }
        }
        ("flush", [changes]) => {
            if !p!("truthy", g!(c!("state"), "destroyed"))
                && !p!("same", g!(*changes, "length"), zero)
            {
                r!("write", c!("flush", *changes));
            }
        }
        ("flushCell", [frame, change]) => {
            if p!("same", g!(g!(g!(*change, "cell"), "ch"), "length"), zero) {
                return Ok(undefined);
            }
            if !p!("same", g!(*change, "x"), g!(*frame, "cursorX"))
                || !p!("same", g!(*change, "y"), g!(*frame, "cursorY"))
            {
                s!(
                    *frame,
                    "output",
                    c!(
                        "add",
                        g!(*frame, "output"),
                        r!("position", g!(*change, "x"), g!(*change, "y"))
                    )
                );
            }
            s!(
                *frame,
                "output",
                c!(
                    "add",
                    g!(*frame, "output"),
                    c!("cellToAnsi", g!(*change, "cell"))
                )
            );
            s!(
                *frame,
                "cursorX",
                c!(
                    "add",
                    g!(*change, "x"),
                    c!("graphemeWidth", g!(g!(*change, "cell"), "ch"))
                )
            );
            s!(*frame, "cursorY", g!(*change, "y"));
        }
        ("size", [value]) => {
            return Ok(if host.is_undefined(*value)? || !p!("finite", *value) {
                zero
            } else {
                r!("coordinate", *value)
            });
        }
        ("getSize", []) => {
            let output = c!("output");
            let cols = r!("size", g!(output, "columns"));
            let rows = r!("size", g!(output, "rows"));
            return Ok(c!("size", cols, rows));
        }
        ("onResize" | "onKeypress", [handler]) => {
            return Ok(if p!("truthy", g!(c!("state"), "destroyed")) {
                c!("noop")
            } else {
                c!(
                    if operation == "onResize" {
                        "registerResize"
                    } else {
                        "registerKeypress"
                    },
                    *handler
                )
            });
        }
        ("offResize", [listener]) => {
            if p!("deleteResize", *listener) {
                c!("offResize", *listener);
            }
        }
        ("offKeypress", [listener, parser]) => {
            if p!("deleteKeypress", *listener) {
                c!("destroyParser", *parser);
                c!("offKeypress", *listener);
            }
        }
        ("destroy", []) => {
            let state = c!("state");
            if p!("truthy", g!(state, "destroyed")) {
                return Ok(undefined);
            }
            c!("clearKeypress");
            c!("clearResize");
            r!("exitRawMode");
            r!("enableLineWrap");
            r!("exitAltScreen");
            r!("showCursor");
            s!(state, "destroyed", c!("true"));
        }
        ("dispatch", [handler, event]) => {
            let kind = g!(*event, "type");
            let converted = if host.is_kind(kind, "paste")? {
                let paste = host.literal("paste")?;
                let text = g!(*event, "text");
                let no = c!("false");
                c!("paste", paste, text, no, no, no)
            } else {
                let kind = g!(*event, "type");
                if !host.is_kind(kind, "key")? {
                    return Ok(undefined);
                }
                let ch = g!(*event, "ch");
                let (operation, value) = if !host.is_undefined(ch)? {
                    ("key", g!(*event, "ch"))
                } else {
                    let name = g!(*event, "name");
                    let name = if host.is_kind(name, "enter")? {
                        host.literal("return")?
                    } else {
                        g!(*event, "name")
                    };
                    ("named", name)
                };
                c!(
                    operation,
                    value,
                    g!(*event, "ctrl"),
                    g!(*event, "alt"),
                    g!(*event, "shift")
                )
            };
            c!("emit", *handler, converted);
        }
        ("parse", [data]) => {
            if p!("same", g!(*data, "length"), zero) {
                return Ok(undefined);
            }
            let esc = host.number(27.)?;
            if p!("same", g!(*data, "length"), one) && p!("same", c!("at", *data, zero), esc) {
                let name = host.literal("escape")?;
                let no = c!("false");
                return Ok(c!("named", name, no, no, no));
            }
            return Ok(c!("readline", *data));
        }
        ("toEvent", [text, key]) => {
            let control = r!("control", o!(*key, "sequence"));
            if !host.is_undefined(control)? {
                return Ok(control);
            }
            let ctrl = o!(*key, "ctrl");
            let ctrl = if p!("nullish", ctrl) {
                c!("false")
            } else {
                ctrl
            };
            let meta = o!(*key, "meta");
            let meta = if p!("nullish", meta) {
                c!("false")
            } else {
                meta
            };
            let shift = o!(*key, "shift");
            let shift = if p!("nullish", shift) {
                c!("false")
            } else {
                shift
            };
            let ch = r!("extract", *text, o!(*key, "sequence"));
            if !host.is_undefined(ch)? {
                return Ok(c!("key", ch, ctrl, meta, shift));
            }
            let name = o!(*key, "name");
            if host.is_undefined(name)? {
                return Ok(undefined);
            }
            return Ok(c!("named", g!(*key, "name"), ctrl, meta, shift));
        }
        ("control", [sequence]) => {
            let slash = host.literal("\u{1f}")?;
            if p!("same", *sequence, slash) {
                let ch = host.literal("/")?;
                let yes = c!("true");
                let no = c!("false");
                return Ok(c!("key", ch, yes, no, no));
            }
            if !host.is_undefined(*sequence)? && p!("same", g!(*sequence, "length"), one) {
                let code = c!("code", *sequence);
                let end = host.number(26.)?;
                let tab = host.number(9.)?;
                let lf = host.number(10.)?;
                let cr = host.number(13.)?;
                if p!("ge", code, one)
                    && p!("le", code, end)
                    && !p!("same", code, tab)
                    && !p!("same", code, lf)
                    && !p!("same", code, cr)
                {
                    let offset = host.number(96.)?;
                    let name = c!("character", c!("add", code, offset));
                    let yes = c!("true");
                    let no = c!("false");
                    return Ok(c!("named", name, yes, no, no));
                }
            }
        }
        ("printable", [value]) => {
            if host.is_undefined(*value)? || !p!("same", c!("arrayLength", *value), one) {
                return Ok(c!("false"));
            }
            let code = c!("point", *value);
            let space = host.number(32.)?;
            let del = host.number(127.)?;
            let yes = !host.is_undefined(code)? && p!("ge", code, space) && !p!("same", code, del);
            return Ok(c!(if yes { "true" } else { "false" }));
        }
        ("extract", [text, sequence]) => {
            let printable = r!("printable", *text);
            if host.is_true(printable)? {
                return Ok(*text);
            }
            let printable = r!("printable", *sequence);
            if host.is_true(printable)? {
                return Ok(*sequence);
            }
            let esc = host.literal("\u{1b}")?;
            if host.is_undefined(*sequence)?
                || p!("le", g!(*sequence, "length"), one)
                || !p!("same", c!("at", *sequence, zero), esc)
            {
                return Ok(undefined);
            }
            let candidate = c!("tail", *sequence);
            let printable = r!("printable", candidate);
            return Ok(if host.is_true(printable)? {
                candidate
            } else {
                undefined
            });
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
