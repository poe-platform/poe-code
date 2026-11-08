//! Screen drawing and frame-diff policy. JavaScript retains observable objects,
//! arrays, iteration, property access and coercions at the host boundary.
use crate::text_cells::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{
        let args = vec![$($arg),*]; host.call($name, args)?
    }}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{ let value=c!($name $(,$arg)*); host.is_true(value)? }}; }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let two = host.number(2.)?;
    match (operation, args) {
        ("resize", [screen, size]) => {
            let cols = c!("normalize", g!(*size, "cols"));
            c!("setCols", *screen, cols);
            let rows = c!("normalize", g!(*size, "rows"));
            c!("setRows", *screen, rows);
            let length = c!("multiply", g!(*screen, "cols"), g!(*screen, "rows"));
            c!("setFront", *screen, c!("cells", length));
            let length = c!("multiply", g!(*screen, "cols"), g!(*screen, "rows"));
            c!("setBack", *screen, c!("cells", length));
        }
        ("index", [screen, x, y]) => {
            return Ok(c!("add", c!("multiply", *y, g!(*screen, "cols")), *x));
        }
        ("inBounds", [screen, x, y]) => {
            let inside = p!("ge", *x, zero)
                && p!("ge", *y, zero)
                && p!("lt", *x, g!(*screen, "cols"))
                && p!("lt", *y, g!(*screen, "rows"));
            return Ok(c!(if inside { "true" } else { "false" }));
        }
        ("cell", [screen, x, y, ch, style]) => {
            if !p!(
                "truthy",
                c!("invoke", g!(*screen, "inBounds"), *screen, *x, *y)
            ) || p!("same", g!(*ch, "length"), zero)
            {
                return Ok(c!("undefined"));
            }
            let segment = c!("firstGrapheme", *ch);
            if host.is_undefined(segment)? {
                return Ok(c!("undefined"));
            }
            let measured = c!("graphemeWidth", segment);
            let width = if p!("gt", measured, one) { two } else { one };
            let back = g!(*screen, "back");
            let index = c!("invoke", g!(*screen, "index"), *screen, *x, *y);
            c!("setAt", back, index, c!("makeCell", segment, width, *style));
            if p!("same", width, two)
                && p!(
                    "truthy",
                    c!(
                        "invoke",
                        g!(*screen, "inBounds"),
                        *screen,
                        c!("add", *x, one),
                        *y
                    )
                )
            {
                let back = g!(*screen, "back");
                let index = c!(
                    "invoke",
                    g!(*screen, "index"),
                    *screen,
                    c!("add", *x, one),
                    *y
                );
                c!(
                    "setAt",
                    back,
                    index,
                    c!("makeCell", c!("empty"), one, *style)
                );
            }
        }
        ("textStep", [screen, x, y, segment, style, offset]) => {
            let width = c!("max", zero, c!("graphemeWidth", *segment));
            if p!("gt", width, zero) {
                c!(
                    "invoke",
                    g!(*screen, "cell"),
                    *screen,
                    c!("add", *x, *offset),
                    *y,
                    *segment,
                    *style
                );
            }
            return Ok(c!("add", *offset, width));
        }
        ("put", [screen, x, y, text, style]) => {
            let method = g!(*screen, "text");
            let packed = run(host, "legacy", &[*style])?;
            c!("invoke", method, *screen, *x, *y, *text, packed);
        }
        ("legacy", [style]) => {
            if p!("number", *style) {
                return Ok(*style);
            }
            let mut packed = zero;
            for (key, bit) in [
                ("bold", 1.),
                ("dim", 2.),
                ("underline", 4.),
                ("inverse", 8.),
            ] {
                let value = g!(*style, key);
                let bit = if p!("truthy", value) {
                    host.number(bit)?
                } else {
                    zero
                };
                packed = c!("or", packed, bit);
            }
            for (key, shift) in [("fg", 8.), ("bg", 16.)] {
                let value = g!(*style, key);
                let color = run(host, "legacyColor", &[value])?;
                let shift = host.number(shift)?;
                packed = c!("or", packed, c!("shift", color, shift));
            }
            return Ok(packed);
        }
        ("legacyColor", [value]) => {
            if host.is_undefined(*value)? {
                return Ok(zero);
            }
            let exact = c!("colorIndex", *value);
            if p!("ge", exact, zero) {
                return Ok(exact);
            }
            return if p!("truthy", c!("hexColor", *value)) {
                host.number(7.)
            } else {
                Ok(zero)
            };
        }
        ("clearRect", [screen, rect, style]) => {
            let packed = run(host, "legacy", &[*style])?;
            let start_x = c!("max", zero, g!(*rect, "x"));
            let start_y = c!("max", zero, g!(*rect, "y"));
            let end_x = c!(
                "min",
                g!(*screen, "cols"),
                c!("add", g!(*rect, "x"), c!("max", zero, g!(*rect, "width")))
            );
            let end_y = c!(
                "min",
                g!(*screen, "rows"),
                c!("add", g!(*rect, "y"), c!("max", zero, g!(*rect, "height")))
            );
            let mut y = start_y;
            while p!("lt", y, end_y) {
                let mut x = start_x;
                while p!("lt", x, end_x) {
                    c!(
                        "invoke",
                        g!(*screen, "cell"),
                        *screen,
                        x,
                        y,
                        c!("space"),
                        packed
                    );
                    x = c!("add", x, one);
                }
                y = c!("add", y, one);
            }
        }
        ("flush", [screen]) => {
            let changed = c!("set");
            let mut index = zero;
            while p!("lt", index, g!(g!(*screen, "back"), "length")) {
                let old = c!("at", g!(*screen, "front"), index);
                let next = c!("at", g!(*screen, "back"), index);
                if !(p!("same", g!(old, "ch"), g!(next, "ch"))
                    && p!("same", g!(old, "width"), g!(next, "width"))
                    && p!("same", g!(old, "style"), g!(next, "style")))
                {
                    c!("setAdd", changed, index);
                    let old = c!("at", g!(*screen, "front"), index);
                    let next = c!("at", g!(*screen, "back"), index);
                    if (p!("same", g!(old, "width"), two) || p!("same", g!(next, "width"), two))
                        && p!(
                            "lt",
                            c!("add", c!("remainder", index, g!(*screen, "cols")), one),
                            g!(*screen, "cols")
                        )
                    {
                        c!("setAdd", changed, c!("add", index, one));
                    }
                    if p!("same", g!(old, "ch"), c!("empty"))
                        && p!("gt", c!("remainder", index, g!(*screen, "cols")), zero)
                    {
                        c!("setAdd", changed, c!("subtract", index, one));
                    }
                }
                index = c!("add", index, one);
            }
            let mut output = c!("empty");
            let mut current_style = g!(*screen, "outputStyle");
            let ordered = c!("ordered", changed);
            let mut cursor = zero;
            while p!("lt", cursor, g!(ordered, "length")) {
                let start = c!("at", ordered, cursor);
                let y = c!("row", start, g!(*screen, "cols"));
                let mut end = start;
                while p!("lt", c!("add", cursor, one), g!(ordered, "length"))
                    && p!(
                        "same",
                        c!("at", ordered, c!("add", cursor, one)),
                        c!("add", end, one)
                    )
                    && p!(
                        "same",
                        c!(
                            "row",
                            c!("at", ordered, c!("add", cursor, one)),
                            g!(*screen, "cols")
                        ),
                        y
                    )
                {
                    cursor = c!("add", cursor, one);
                    end = c!("add", end, one);
                }
                let row = c!("add", y, one);
                let col = c!("add", c!("remainder", start, g!(*screen, "cols")), one);
                output = c!("add", output, c!("cursor", row, col));
                let mut index = start;
                while p!("le", index, end) {
                    let cell = c!("at", g!(*screen, "back"), index);
                    let delta = c!(
                        "delta",
                        current_style,
                        g!(cell, "style"),
                        g!(*screen, "colors")
                    );
                    output = c!("add", output, delta);
                    current_style = g!(cell, "style");
                    let ch = if p!("same", g!(g!(cell, "ch"), "length"), zero) {
                        c!("empty")
                    } else {
                        g!(cell, "ch")
                    };
                    output = c!("add", output, ch);
                    index = c!("add", index, one);
                }
                cursor = c!("add", cursor, one);
            }
            c!("setFront", *screen, g!(*screen, "back"));
            c!(
                "setBack",
                *screen,
                c!(
                    "cells",
                    c!("multiply", g!(*screen, "cols"), g!(*screen, "rows"))
                )
            );
            c!("setOutputStyle", *screen, current_style);
            return Ok(output);
        }
        _ => return Ok(c!("invalidOperation")),
    }
    host.call("undefined", vec![])
}
