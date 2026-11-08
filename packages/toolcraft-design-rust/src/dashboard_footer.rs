//! Dashboard footer fitting, centering, session columns and theme selection.
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
    let two = host.number(2.)?;
    let undefined = c!("undefined");
    match (operation, args) {
        ("defaults", []) => {
            let hints = c!("array");
            for (key, label) in [
                ("q", "Quit"),
                ("e", "Edit"),
                ("l", "Log"),
                ("p", "Pause"),
                ("r", "Retry"),
            ] {
                c!("push", hints, c!("hint", l!(key), l!(label)));
            }
            return Ok(hints);
        }
        ("render", [buffer, rect, hints, session]) => {
            c!("invoke", g!(*buffer, "clearRect"), *buffer, *rect);
            if p!("le", g!(*rect, "width"), zero) || p!("le", g!(*rect, "height"), zero) {
                return Ok(undefined);
            }
            if p!("truthy", *session) {
                r!("session", *buffer, *rect, *session);
            }
            if p!("same", g!(*hints, "length"), zero)
                || (p!("truthy", *session) && p!("same", g!(*rect, "height"), one))
            {
                return Ok(undefined);
            }
            let fitted = c!("array");
            let hints = c!("mapHints", *hints);
            let state = c!("fitState");
            c!("fitHints", hints, fitted, state, *rect);
            let mut width = g!(state, "width");
            if p!("same", g!(fitted, "length"), zero) {
                let key = c!(
                    "truncateToWidth",
                    g!(c!("at", hints, zero), "key"),
                    g!(*rect, "width")
                );
                c!("push", fitted, c!("hint", key, l!("")));
                width = c!("displayWidth", key);
            }
            let cells = r!("cells", fitted);
            let x = c!(
                "add",
                g!(*rect, "x"),
                c!(
                    "floor",
                    c!("divide", c!("subtract", g!(*rect, "width"), width), two)
                )
            );
            let y = if p!("truthy", *session) {
                g!(*rect, "y")
            } else {
                c!(
                    "add",
                    g!(*rect, "y"),
                    c!("floor", c!("divide", g!(*rect, "height"), two))
                )
            };
            c!("draw", *buffer, cells, x, y);
        }
        ("session", [buffer, rect, session]) => {
            let directory = c!("plainTerminalText", g!(*session, "cwd"));
            let agent = c!("string", g!(*session, "agent"));
            let model = g!(*session, "model");
            let model = if p!("nullish", model) {
                l!("default model")
            } else {
                model
            };
            let agent_model = c!("plainTerminalText", c!("agentText", agent, model));
            let gap = c!("min", two, g!(*rect, "width"));
            let available = c!("max", zero, c!("subtract", g!(*rect, "width"), gap));
            let agent_width = c!(
                "min",
                c!("displayWidth", agent_model),
                c!("ceil", c!("divide", available, two))
            );
            let directory_width = c!("max", zero, c!("subtract", available, agent_width));
            let style = g!(g!(c!("getTheme"), "styles"), "muted");
            let y = c!(
                "subtract",
                c!("add", g!(*rect, "y"), g!(*rect, "height")),
                one
            );
            // The method reference is read before coordinate/width getters.
            let method = g!(*buffer, "put");
            let x = g!(*rect, "x");
            let width = if p!("truthy", directory_width) {
                directory_width
            } else {
                g!(*rect, "width")
            };
            c!(
                "invoke",
                method,
                *buffer,
                x,
                y,
                c!("truncateToWidth", directory, width),
                style
            );
            if p!("gt", agent_width, zero) {
                let text = c!("truncateToWidth", agent_model, agent_width);
                put!(
                    *buffer,
                    c!(
                        "subtract",
                        c!("add", g!(*rect, "x"), g!(*rect, "width")),
                        c!("displayWidth", text)
                    ),
                    y,
                    text,
                    style
                );
            }
        }
        ("normalizeHint", [hint]) => {
            let key = c!("plainTerminalText", g!(*hint, "key"));
            let label = c!("plainTerminalText", g!(*hint, "label"));
            return Ok(c!("hint", key, label));
        }
        ("fitHint", [hint, fitted, state, rect]) => {
            let measured = c!("displayWidth", c!("hintText", *hint));
            let gap = if p!("gt", g!(*fitted, "length"), zero) {
                two
            } else {
                zero
            };
            let next = c!("add", measured, gap);
            if p!(
                "gt",
                c!("add", g!(*state, "width"), next),
                g!(*rect, "width")
            ) {
                return Ok(c!("true"));
            }
            c!("push", *fitted, *hint);
            c!(
                "set",
                *state,
                l!("width"),
                c!("add", g!(*state, "width"), next)
            );
            return Ok(c!("false"));
        }
        ("cells", [hints]) => {
            let accent = g!(g!(c!("getTheme"), "styles"), "accent");
            let cells = c!("array");
            c!("hintCells", *hints, cells, accent);
            return Ok(cells);
        }
        ("hintCells", [hint, index, cells, style]) => {
            if p!("gt", *index, zero) {
                // One push call with two distinct empty styles, as in the source.
                let method = g!(*cells, "push");
                let a = c!("cell", l!(" "), c!("object"));
                let b = c!("cell", l!(" "), c!("object"));
                c!("invoke", method, *cells, a, b);
            }
            c!("keyCells", *cells, g!(*hint, "key"), *style);
            if p!("gt", g!(g!(*hint, "label"), "length"), zero) {
                c!("push", *cells, c!("cell", l!(" "), c!("object")));
            }
            c!("labelCells", *cells, g!(*hint, "label"));
        }
        ("drawCell", [buffer, cell, x, y]) => {
            put!(*buffer, *x, *y, g!(*cell, "ch"), g!(*cell, "style"));
            return Ok(c!("add", *x, c!("graphemeWidth", g!(*cell, "ch"))));
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
