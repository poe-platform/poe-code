//! Explorer pane geometry and ordered screen drawing.
use crate::feedback::Host;

pub fn run<H: Host>(host: &mut H, args: &[H::Value]) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! l {
        ($text:expr) => {
            host.literal($text)?
        };
    }
    let [screen, rect, title, style, options] = *args else {
        return host.call("invalidArguments", vec![]);
    };
    macro_rules! focused {
        ($yes:expr,$no:expr) => {{
            let focused = p!("truthy", g!(options, "focused"));
            l!(if focused { $yes } else { $no })
        }};
    }
    macro_rules! put {
        ($x:expr,$y:expr,$text:expr) => {
            c!("put", g!(screen, "put"), screen, $x, $y, $text, style)
        };
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let two = host.number(2.)?;
    let undefined = c!("undefined");
    if p!("le", g!(rect, "width"), zero) || p!("le", g!(rect, "height"), zero) {
        return Ok(undefined);
    }
    if p!("same", g!(rect, "width"), one) {
        let mut y = 0.;
        while p!("lt", host.number(y)?, g!(rect, "height")) {
            put!(
                g!(rect, "x"),
                c!("add", g!(rect, "y"), host.number(y)?),
                l!("│")
            );
            y += 1.;
        }
        return Ok(undefined);
    }
    let inner_width = c!("max", zero, c!("subtract", g!(rect, "width"), two));
    let horizontal = focused!("━", "─");
    let indicator = g!(options, "indicator");
    let indicator = if host.is_undefined(indicator)? {
        l!("")
    } else {
        c!("template", l!(" "), g!(options, "indicator"), l!(" "))
    };
    let available = c!(
        "max",
        zero,
        c!("subtract", inner_width, g!(indicator, "length"))
    );
    let first = c!(
        "fit",
        c!("title", horizontal, title),
        available,
        c!("add", g!(rect, "x"), one)
    );
    // The method lookup precedes the second title coercion and clipping call.
    let repeat = g!(horizontal, "repeat");
    let second = c!(
        "fit",
        c!("title", horizontal, title),
        available,
        c!("add", g!(rect, "x"), one)
    );
    let padding = c!(
        "repeat",
        repeat,
        horizontal,
        c!("max", zero, c!("subtract", available, g!(second, "length")))
    );
    let segment = c!(
        "pad",
        c!("template", first, padding, indicator),
        inner_width,
        horizontal,
        c!("add", g!(rect, "x"), one)
    );
    put!(
        g!(rect, "x"),
        g!(rect, "y"),
        c!("template", focused!("┏", "┌"), segment, focused!("┓", "┐"))
    );
    let mut y = 1.;
    while p!(
        "lt",
        host.number(y)?,
        c!("subtract", g!(rect, "height"), one)
    ) {
        put!(
            g!(rect, "x"),
            c!("add", g!(rect, "y"), host.number(y)?),
            focused!("┃", "│")
        );
        put!(
            c!("subtract", c!("add", g!(rect, "x"), g!(rect, "width")), one),
            c!("add", g!(rect, "y"), host.number(y)?),
            focused!("┃", "│")
        );
        y += 1.;
    }
    if p!("gt", g!(rect, "height"), one) {
        put!(
            g!(rect, "x"),
            c!(
                "subtract",
                c!("add", g!(rect, "y"), g!(rect, "height")),
                one
            ),
            c!(
                "template",
                focused!("┗", "└"),
                c!("repeat", g!(horizontal, "repeat"), horizontal, inner_width),
                focused!("┛", "┘")
            )
        );
    }
    Ok(undefined)
}
