//! Fixed plan context allocation and clipping above a live output viewport.
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
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    match (operation, args) {
        ("render", [buffer, rect, context]) => {
            if p!("same", g!(*context, "length"), zero)
                || p!("le", g!(*rect, "width"), zero)
                || p!("le", g!(*rect, "height"), one)
            {
                return Ok(*rect);
            }
            let available = c!(
                "max",
                one,
                c!("floor", c!("divide", g!(*rect, "height"), host.number(2.)?))
            );
            let entries = c!("entries", *context, *rect);
            let lines = c!("flat", entries);
            let visible = c!("slice", lines, available);
            if p!("gt", g!(lines, "length"), available) {
                let last = c!("at", visible, c!("subtract", available, one));
                let text = if p!("ge", g!(c!("at", entries, zero), "length"), available) {
                    let text = if p!("same", available, one) {
                        c!("plainTerminalText", c!("at", *context, zero))
                    } else {
                        g!(last, "text")
                    };
                    c!("truncateToWidth", c!("ellipsis", text), g!(*rect, "width"))
                } else {
                    c!(
                        "truncateToWidth",
                        c!("queued", c!("subtract", g!(*context, "length"), one)),
                        g!(*rect, "width")
                    )
                };
                c!(
                    "set",
                    visible,
                    c!("subtract", available, one),
                    c!("replaceText", last, text)
                );
            }
            c!(
                "invoke",
                g!(*buffer, "clearRect"),
                *buffer,
                c!("rectHeight", *rect, g!(visible, "length"))
            );
            c!("paint", visible, *buffer, *rect);
            return Ok(c!("remaining", *rect, g!(visible, "length")));
        }
        ("entry", [text, rect]) => {
            return Ok(c!(
                "lines",
                *text,
                c!("add", g!(*rect, "width"), host.number(3.)?)
            ));
        }
        ("paint", [line, row, buffer, rect]) => {
            c!(
                "invoke",
                g!(*buffer, "putInRect"),
                *buffer,
                *rect,
                *row,
                g!(*line, "text"),
                c!("dim", *row)
            );
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    host.call("undefined", vec![])
}
