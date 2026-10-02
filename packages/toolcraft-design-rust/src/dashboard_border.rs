//! Dashboard frame geometry, title clipping and divider junctions.
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
    macro_rules! yes { ($op:expr $(,$arg:expr)* $(,)?) => {{let value=r!($op $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! l {
        ($text:expr) => {
            host.literal($text)?
        };
    }
    macro_rules! put {
        ($buffer:expr,$x:expr,$y:expr,$text:expr,$style:expr) => {{
            let buffer = $buffer;
            c!("invoke", g!(buffer, "put"), buffer, $x, $y, $text, $style)
        }};
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let undefined = c!("undefined");
    match (operation, args) {
        ("render", [buffer, layout, opts]) => {
            let outer = g!(*layout, "outerBorder");
            if p!("le", g!(outer, "width"), zero) || p!("le", g!(outer, "height"), zero) {
                return Ok(undefined);
            }
            let left = g!(outer, "x");
            let top = g!(outer, "y");
            let right = c!(
                "subtract",
                c!("add", g!(outer, "x"), g!(outer, "width")),
                one
            );
            let bottom = c!(
                "subtract",
                c!("add", g!(outer, "y"), g!(outer, "height")),
                one
            );
            r!("top", *buffer, left, top, right, *layout, *opts);
            r!(
                "sides",
                *buffer,
                left,
                right,
                top,
                bottom,
                g!(*opts, "style")
            );
            r!(
                "bottom",
                *buffer,
                left,
                top,
                right,
                bottom,
                *layout,
                g!(*opts, "style")
            );
            r!("vertical", *buffer, *layout, g!(*opts, "style"));
            r!(
                "footer",
                *buffer,
                left,
                right,
                bottom,
                *layout,
                g!(*opts, "style")
            );
        }
        ("top", [buffer, left, top, right, layout, opts]) => {
            if p!("same", *left, *right) {
                put!(*buffer, *left, *top, l!("┌"), g!(*opts, "style"));
                return Ok(undefined);
            }
            let bottom = c!(
                "subtract",
                c!(
                    "add",
                    g!(g!(*layout, "outerBorder"), "y"),
                    g!(g!(*layout, "outerBorder"), "height")
                ),
                one
            );
            let junction = yes!("interior", *top, bottom)
                && yes!("pane", *layout, *left, *right)
                && p!(
                    "le",
                    g!(g!(*layout, "divider"), "top"),
                    c!("add", *top, one)
                )
                && p!(
                    "ge",
                    g!(g!(*layout, "divider"), "bottom"),
                    c!("add", *top, one)
                );
            if !junction {
                put!(
                    *buffer,
                    *left,
                    *top,
                    c!(
                        "framed",
                        l!("┌"),
                        r!(
                            "segment",
                            c!("subtract", c!("subtract", *right, *left), one),
                            g!(*opts, "leftTitle")
                        ),
                        l!("┐")
                    ),
                    g!(*opts, "style")
                );
                return Ok(undefined);
            }
            let left_width = c!(
                "subtract",
                c!("subtract", g!(g!(*layout, "divider"), "x"), *left),
                one
            );
            let right_width = c!(
                "subtract",
                c!("subtract", *right, g!(g!(*layout, "divider"), "x")),
                one
            );
            let row = c!(
                "joined",
                l!("┌"),
                r!("segment", left_width, g!(*opts, "leftTitle")),
                l!("┬"),
                r!("segment", right_width, g!(*opts, "rightTitle")),
                l!("┐")
            );
            put!(*buffer, *left, *top, row, g!(*opts, "style"));
        }
        ("sides", [buffer, left, right, top, bottom, style]) => {
            let mut y = c!("add", *top, one);
            while p!("lt", y, *bottom) {
                put!(*buffer, *left, y, l!("│"), *style);
                put!(*buffer, *right, y, l!("│"), *style);
                y = c!("add", y, one);
            }
        }
        ("bottom", [buffer, left, top, right, bottom, layout, style]) => {
            if p!("le", *bottom, *top) {
                return Ok(undefined);
            }
            if p!("same", *left, *right) {
                put!(*buffer, *left, *bottom, l!("└"), *style);
                return Ok(undefined);
            }
            put!(*buffer, *left, *bottom, l!("└"), *style);
            put!(
                *buffer,
                c!("add", *left, one),
                *bottom,
                c!(
                    "repeat",
                    l!("─"),
                    c!(
                        "max",
                        zero,
                        c!("subtract", c!("subtract", *right, *left), one)
                    )
                ),
                *style
            );
            put!(*buffer, *right, *bottom, l!("┘"), *style);
            if yes!("interior", *top, *bottom)
                && yes!("pane", *layout, *left, *right)
                && p!(
                    "le",
                    g!(g!(*layout, "divider"), "top"),
                    c!("subtract", *bottom, one)
                )
                && p!(
                    "ge",
                    g!(g!(*layout, "divider"), "bottom"),
                    c!("subtract", *bottom, one)
                )
            {
                put!(
                    *buffer,
                    g!(g!(*layout, "divider"), "x"),
                    *bottom,
                    l!("┴"),
                    *style
                );
            }
        }
        ("vertical", [buffer, layout, style]) => {
            let left = g!(g!(*layout, "outerBorder"), "x");
            let right = c!(
                "subtract",
                c!(
                    "add",
                    g!(g!(*layout, "outerBorder"), "x"),
                    g!(g!(*layout, "outerBorder"), "width")
                ),
                one
            );
            if !yes!("pane", *layout, left, right) {
                return Ok(undefined);
            }
            let start = c!(
                "max",
                g!(g!(*layout, "divider"), "top"),
                c!("add", g!(g!(*layout, "outerBorder"), "y"), one)
            );
            let two = host.number(2.)?;
            let end = c!(
                "min",
                g!(g!(*layout, "divider"), "bottom"),
                c!(
                    "subtract",
                    c!(
                        "add",
                        g!(g!(*layout, "outerBorder"), "y"),
                        g!(g!(*layout, "outerBorder"), "height")
                    ),
                    two
                )
            );
            let mut y = start;
            while p!("le", y, end) {
                put!(*buffer, g!(g!(*layout, "divider"), "x"), y, l!("│"), *style);
                y = c!("add", y, one);
            }
        }
        ("footer", [buffer, left, right, bottom, layout, style]) => {
            let y = g!(g!(*layout, "footerDivider"), "y");
            if p!("le", y, g!(g!(*layout, "outerBorder"), "y")) || p!("ge", y, *bottom) {
                return Ok(undefined);
            }
            let width = c!(
                "add",
                c!(
                    "subtract",
                    g!(g!(*layout, "footerDivider"), "right"),
                    g!(g!(*layout, "footerDivider"), "left")
                ),
                one
            );
            if p!("gt", width, zero) {
                put!(
                    *buffer,
                    g!(g!(*layout, "footerDivider"), "left"),
                    y,
                    c!("repeat", l!("─"), width),
                    *style
                );
            }
            put!(*buffer, *left, y, l!("├"), *style);
            put!(*buffer, *right, y, l!("┤"), *style);
            if !yes!("pane", *layout, *left, *right)
                || p!(
                    "lt",
                    g!(g!(*layout, "divider"), "x"),
                    g!(g!(*layout, "footerDivider"), "left")
                )
                || p!(
                    "gt",
                    g!(g!(*layout, "divider"), "x"),
                    g!(g!(*layout, "footerDivider"), "right")
                )
            {
                return Ok(undefined);
            }
            let above = p!(
                "ge",
                g!(g!(*layout, "divider"), "bottom"),
                c!("subtract", y, one)
            ) && p!("le", g!(g!(*layout, "divider"), "top"), y);
            let below = p!("gt", g!(g!(*layout, "divider"), "bottom"), y);
            if above {
                put!(
                    *buffer,
                    g!(g!(*layout, "divider"), "x"),
                    y,
                    l!(if below { "┼" } else { "┴" }),
                    *style
                );
            }
        }
        ("segment", [width, title]) => {
            let title = if host.is_undefined(*title)? {
                *title
            } else {
                c!("plainTerminalText", *title)
            };
            if p!("le", *width, zero) {
                return host.literal("");
            }
            if !p!("truthy", title) {
                return Ok(c!("repeat", l!("─"), *width));
            }
            let content = c!("truncateToWidth", c!("titled", l!("─"), title), *width);
            let line = c!(
                "repeat",
                l!("─"),
                c!("subtract", *width, c!("displayWidth", content))
            );
            return Ok(c!("framed", content, line, l!("")));
        }
        ("interior", [top, bottom]) => return Ok(c!("gt", c!("subtract", *bottom, *top), one)),
        ("pane", [layout, left, right]) => {
            let yes = p!("gt", g!(g!(*layout, "leftPane"), "width"), zero)
                && p!("gt", g!(g!(*layout, "rightPane"), "width"), zero)
                && p!("gt", g!(g!(*layout, "divider"), "x"), *left)
                && p!("lt", g!(g!(*layout, "divider"), "x"), *right);
            return Ok(c!(if yes { "true" } else { "false" }));
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
