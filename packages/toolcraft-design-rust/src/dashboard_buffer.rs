//! Legacy dashboard cells. Rust owns clipping, style normalization and diff policy;
//! the host retains observable objects, coercions, iteration and ICU segmentation.
use crate::feedback::Host;

pub fn diff_indices<T: AsRef<[u16]>>(
    width: usize,
    height: usize,
    previous_width: usize,
    previous: &[T],
    next_width: usize,
    next: &[T],
    blank: &[u16],
) -> Vec<u32> {
    let mut changes = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let before = if x < previous_width {
                previous
                    .get(y * previous_width + x)
                    .map(AsRef::as_ref)
                    .unwrap_or(blank)
            } else {
                blank
            };
            let after = if x < next_width {
                next.get(y * next_width + x)
                    .map(AsRef::as_ref)
                    .unwrap_or(blank)
            } else {
                blank
            };
            if before != after {
                changes.push((y * width + x) as u32);
            }
        }
    }
    changes
}

pub fn has_controls(text: &[u16]) -> bool {
    text.iter()
        .any(|&code| (code < 0x20 && code != 9) || (0x7f..=0x9f).contains(&code))
}

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
    macro_rules! method { ($value:expr,$key:expr $(,$arg:expr)* $(,)?) => {{let value=$value;c!("invoke",g!(value,$key),value $(,$arg)*)}}; }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let undefined = c!("undefined");
    match (operation, args) {
        ("normalize", [style]) => {
            let next = c!("object");
            for key in ["fg", "bg", "bold", "dim", "inverse", "underline"] {
                let name = host.literal(key)?;
                let value = c!("optionalGet", *style, name);
                if !host.is_undefined(value)? {
                    let value = g!(*style, key);
                    c!("set", next, name, value);
                }
            }
            return Ok(next);
        }
        ("clone", [cell]) => {
            let ch = g!(*cell, "ch");
            let style = r!("normalize", g!(*cell, "style"));
            return Ok(c!("cell", ch, style));
        }
        ("cells", [width, height, style]) => {
            let style = r!("normalize", *style);
            return Ok(c!("cells", c!("multiply", *width, *height), style));
        }
        ("initialize", [screen, width, height]) => {
            s!(*screen, "_width", c!("max", zero, c!("floor", *width)));
            s!(*screen, "_height", c!("max", zero, c!("floor", *height)));
            s!(
                *screen,
                "_cells",
                r!(
                    "cells",
                    g!(*screen, "_width"),
                    g!(*screen, "_height"),
                    undefined
                )
            );
        }
        ("index", [screen, x, y]) => {
            return Ok(c!("add", c!("multiply", *y, g!(*screen, "_width")), *x));
        }
        ("isInBoundsX" | "isInBoundsY", [screen, value]) => {
            let field = if operation == "isInBoundsX" {
                "_width"
            } else {
                "_height"
            };
            let yes = p!("ge", *value, zero) && p!("lt", *value, g!(*screen, field));
            return Ok(c!(if yes { "true" } else { "false" }));
        }
        ("isInBounds", [screen, x, y]) => {
            let yes = p!("truthy", method!(*screen, "isInBoundsX", *x))
                && p!("truthy", method!(*screen, "isInBoundsY", *y));
            return Ok(c!(if yes { "true" } else { "false" }));
        }
        ("get", [screen, x, y]) => {
            let cell = if p!("truthy", method!(*screen, "isInBounds", *x, *y)) {
                let cells = g!(*screen, "_cells");
                let index = method!(*screen, "index", *x, *y);
                c!("at", cells, index)
            } else {
                undefined
            };
            let cell = if p!("nullish", cell) {
                c!("emptyCell")
            } else {
                cell
            };
            return Ok(r!("clone", cell));
        }
        ("clear", [screen, style]) => {
            s!(
                *screen,
                "_cells",
                r!(
                    "cells",
                    g!(*screen, "_width"),
                    g!(*screen, "_height"),
                    *style
                )
            );
        }
        ("clearRect", [screen, rect, style]) => {
            let start_x = c!("max", zero, g!(*rect, "x"));
            let start_y = c!("max", zero, g!(*rect, "y"));
            let end_x = c!(
                "min",
                g!(*screen, "_width"),
                c!("add", g!(*rect, "x"), c!("max", zero, g!(*rect, "width")))
            );
            let end_y = c!(
                "min",
                g!(*screen, "_height"),
                c!("add", g!(*rect, "y"), c!("max", zero, g!(*rect, "height")))
            );
            let style = r!("normalize", *style);
            let space = host.literal(" ")?;
            let mut y = start_y;
            while p!("lt", y, end_y) {
                let mut x = start_x;
                while p!("lt", x, end_x) {
                    let cells = g!(*screen, "_cells");
                    let index = method!(*screen, "index", x, y);
                    c!("set", cells, index, c!("cell", space, style));
                    x = c!("add", x, one);
                }
                y = c!("add", y, one);
            }
        }
        ("resize", [screen, width, height]) => {
            let width = c!("max", zero, c!("floor", *width));
            let height = c!("max", zero, c!("floor", *height));
            let cells = r!("cells", width, height, undefined);
            let copy_width = c!("min", g!(*screen, "_width"), width);
            let copy_height = c!("min", g!(*screen, "_height"), height);
            let mut y = zero;
            while p!("lt", y, copy_height) {
                let mut x = zero;
                while p!("lt", x, copy_width) {
                    let index = c!("add", c!("multiply", y, width), x);
                    let previous = g!(*screen, "_cells");
                    let old_index = method!(*screen, "index", x, y);
                    let cell = c!("at", previous, old_index);
                    let cell = if p!("nullish", cell) {
                        c!("emptyCell")
                    } else {
                        cell
                    };
                    c!("set", cells, index, r!("clone", cell));
                    x = c!("add", x, one);
                }
                y = c!("add", y, one);
            }
            s!(*screen, "_width", width);
            s!(*screen, "_height", height);
            s!(*screen, "_cells", cells);
        }
        ("segments", [text, style]) => {
            return Ok(if p!("controls", *text) {
                c!("parsedSegments", *text, *style)
            } else {
                c!("segments", *text, *style)
            });
        }
        ("line", [line, row, style]) => {
            return Ok(if p!("same", *row, zero) {
                g!(*line, "segments")
            } else {
                c!("laterLine", *style, g!(*line, "segments"))
            });
        }
        ("put", [screen, x, y, text, style]) => {
            if !p!("truthy", method!(*screen, "isInBoundsY", *y))
                || p!("same", g!(*text, "length"), zero)
            {
                return Ok(undefined);
            }
            let style = r!("normalize", *style);
            let segments = r!("segments", *text, style);
            c!("draw", *screen, *x, *y, segments, undefined, undefined);
        }
        ("putInRect", [screen, rect, row, text, style]) => {
            if p!("lt", *row, zero)
                || p!("ge", *row, g!(*rect, "height"))
                || p!("same", g!(*text, "length"), zero)
                || p!("le", g!(*rect, "width"), zero)
            {
                return Ok(undefined);
            }
            let y = c!("add", g!(*rect, "y"), *row);
            if !p!("truthy", method!(*screen, "isInBoundsY", y)) {
                return Ok(undefined);
            }
            let style = r!("normalize", *style);
            let end = c!("add", g!(*rect, "x"), g!(*rect, "width"));
            let segments = r!("segments", *text, style);
            c!("draw", *screen, undefined, y, segments, *rect, end);
        }
        ("segment", [screen, x, y, segment, rect, end, state]) => {
            let text = g!(*segment, "text");
            let offset = g!(*state, "offset");
            let start = if host.is_undefined(*rect)? {
                c!("max", zero, c!("add", *x, offset))
            } else {
                offset
            };
            let chars = c!("graphemes", c!("expandTabs", text, start));
            c!(
                "characters",
                *screen,
                *x,
                *y,
                chars,
                *segment,
                *rect,
                *end,
                *state
            );
        }
        ("character", [screen, x, y, ch, segment, rect, end, state]) => {
            let rectangular = !host.is_undefined(*rect)?;
            let x = if rectangular { g!(*rect, "x") } else { *x };
            let target = c!("add", x, g!(*state, "offset"));
            let width = c!("graphemeWidth", *ch);
            s!(*state, "offset", c!("add", g!(*state, "offset"), width));
            if rectangular && p!("gt", c!("add", target, width), *end) {
                return Ok(c!("true"));
            }
            if p!("truthy", method!(*screen, "isInBoundsX", target)) {
                let cells = g!(*screen, "_cells");
                let index = method!(*screen, "index", target, *y);
                c!("set", cells, index, c!("cell", *ch, g!(*segment, "style")));
                let mut continuation = one;
                while p!("lt", continuation, width) {
                    if p!(
                        "truthy",
                        method!(*screen, "isInBoundsX", c!("add", target, continuation))
                    ) {
                        let cells = g!(*screen, "_cells");
                        let index = method!(*screen, "index", c!("add", target, continuation), *y);
                        let empty = host.literal("")?;
                        c!(
                            "set",
                            cells,
                            index,
                            c!("cell", empty, g!(*segment, "style"))
                        );
                    }
                    continuation = c!("add", continuation, one);
                }
            }
            return Ok(c!("false"));
        }
        ("equal", [a, b]) => {
            if !p!("same", g!(*a, "ch"), g!(*b, "ch")) {
                return Ok(c!("false"));
            }
            for key in ["fg", "bg", "bold", "dim", "inverse", "underline"] {
                if !p!("same", g!(g!(*a, "style"), key), g!(g!(*b, "style"), key)) {
                    return Ok(c!("false"));
                }
            }
            return Ok(c!("true"));
        }
        ("diff", [prev, next]) => {
            let changes = c!("array");
            let width = c!("max", g!(*prev, "width"), g!(*next, "width"));
            let height = c!("max", g!(*prev, "height"), g!(*next, "height"));
            let mut y = zero;
            while p!("lt", y, height) {
                let mut x = zero;
                while p!("lt", x, width) {
                    let previous = method!(*prev, "get", x, y);
                    let next = method!(*next, "get", x, y);
                    let equal = r!("equal", previous, next);
                    if !host.is_true(equal)? {
                        c!("change", changes, x, y, next);
                    }
                    x = c!("add", x, one);
                }
                y = c!("add", y, one);
            }
            return Ok(changes);
        }
        ("cellToAnsi", [cell]) => {
            if p!("same", g!(g!(*cell, "ch"), "length"), zero) {
                return host.literal("");
            }
            let style = g!(*cell, "style");
            let style = if p!("nullish", style) {
                c!("object")
            } else {
                style
            };
            let mut painter = c!("color");
            for key in ["bold", "dim", "inverse", "underline"] {
                if p!("truthy", g!(style, key)) {
                    painter = g!(painter, key);
                }
            }
            for key in ["fg", "bg"] {
                if p!("truthy", g!(style, key)) {
                    let value = g!(style, key);
                    let hash = host.literal("#")?;
                    painter = if p!("startsWith", value, hash) {
                        method!(painter, if key == "fg" { "hex" } else { "bgHex" }, value)
                    } else {
                        let name = if key == "bg" {
                            let bg = host.literal("bg")?;
                            if p!("startsWith", value, bg) {
                                value
                            } else {
                                c!("backgroundName", value)
                            }
                        } else {
                            value
                        };
                        let candidate = c!("at", painter, name);
                        if p!("callable", candidate) {
                            candidate
                        } else {
                            painter
                        }
                    };
                }
            }
            return Ok(c!("paint", painter, g!(*cell, "ch")));
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
