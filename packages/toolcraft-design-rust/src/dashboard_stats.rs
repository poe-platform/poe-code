//! Statistics formatting, compact summaries and constrained sidebar priorities.
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
        ($text:expr) => {{
            let text = $text;
            host.literal(text)?
        }};
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("set", $value, l!($key), $item)
        };
    }
    macro_rules! put {
        ($buffer:expr,$rect:expr,$row:expr,$text:expr,$style:expr) => {{
            let buffer = $buffer;
            c!(
                "invoke",
                g!(buffer, "putInRect"),
                buffer,
                $rect,
                $row,
                $text,
                $style
            )
        }};
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let undefined = c!("undefined");
    let empty = l!("");
    match (operation, args) {
        ("number", [value]) => return Ok(c!("number", *value)),
        ("status", [status]) => {
            return Ok(c!(
                "add",
                c!("upper", c!("slice", *status, zero, one)),
                c!("slice", *status, one)
            ));
        }
        ("tone", [tone]) => return Ok(c!("at", g!(c!("getTheme"), "styles"), *tone)),
        ("statusStyle", [status]) => {
            let tone = if p!("same", *status, l!("running")) {
                l!("info")
            } else if p!("same", *status, l!("paused")) {
                l!("warning")
            } else if p!("same", *status, l!("error")) {
                l!("error")
            } else if p!("same", *status, l!("done")) {
                l!("success")
            } else {
                l!("muted")
            };
            return Ok(r!("tone", tone));
        }
        ("clip", [text, width]) => {
            let state = c!("object");
            set!(state, "text", empty);
            set!(state, "width", zero);
            c!(
                "walkUntil",
                l!("clipGrapheme"),
                c!("graphemes", *text),
                *width,
                state
            );
            return Ok(g!(state, "text"));
        }
        ("clipGrapheme", [unit, width, state]) => {
            let cells = c!("graphemeWidth", *unit);
            if p!("gt", c!("add", g!(*state, "width"), cells), *width) {
                return Ok(c!("gt", one, zero));
            }
            set!(*state, "text", c!("add", g!(*state, "text"), *unit));
            set!(*state, "width", c!("add", g!(*state, "width"), cells));
        }
        ("blank", []) => return Ok(c!("line", empty, c!("object"), c!("object"), empty)),
        ("keyValue", [label, value, width, style]) => {
            let value = r!("clip", *value, *width);
            let available = c!(
                "max",
                c!("subtract", *width, c!("displayWidth", value)),
                zero
            );
            let label = r!(
                "clip",
                *label,
                c!("max", c!("subtract", available, one), zero)
            );
            let prefix = c!(
                "add",
                label,
                c!(
                    "repeat",
                    l!(" "),
                    c!(
                        "max",
                        c!("subtract", available, c!("displayWidth", label)),
                        zero
                    )
                )
            );
            return Ok(c!("line", prefix, c!("object"), *style, value));
        }
        ("lines", [stats, width]) => {
            if p!("le", *width, zero) {
                return Ok(c!("array"));
            }
            let muted = r!("tone", l!("muted"));
            let total = c!("add", g!(*stats, "tokensIn"), g!(*stats, "tokensOut"));
            let label = g!(*stats, "iterationsLabel");
            let label = if p!("nullish", label) {
                l!("Iteration")
            } else {
                label
            };
            let label = c!("plainTerminalText", label);
            let lines = c!("array");
            c!(
                "push",
                lines,
                r!(
                    "keyValue",
                    l!("Status"),
                    r!("status", g!(*stats, "status")),
                    *width,
                    r!("statusStyle", g!(*stats, "status"))
                )
            );
            let count = c!("number", g!(*stats, "iterations"));
            let suffix = if p!("same", g!(*stats, "iterationsTotal"), undefined) {
                empty
            } else {
                c!("slash", c!("number", g!(*stats, "iterationsTotal")))
            };
            c!(
                "push",
                lines,
                r!(
                    "keyValue",
                    label,
                    c!("add", count, suffix),
                    *width,
                    c!("object")
                )
            );
            c!(
                "push",
                lines,
                r!(
                    "keyValue",
                    l!("Elapsed"),
                    c!("formatElapsed", g!(*stats, "elapsedMs")),
                    *width,
                    c!("object")
                )
            );
            c!("push", lines, r!("blank"));
            c!(
                "push",
                lines,
                r!(
                    "keyValue",
                    l!("Tokens In"),
                    c!("number", g!(*stats, "tokensIn")),
                    *width,
                    c!("object")
                )
            );
            c!(
                "push",
                lines,
                r!(
                    "keyValue",
                    l!("Tokens Out"),
                    c!("number", g!(*stats, "tokensOut")),
                    *width,
                    c!("object")
                )
            );
            c!(
                "push",
                lines,
                r!(
                    "keyValue",
                    l!("Total"),
                    c!("number", total),
                    *width,
                    c!("object")
                )
            );
            if !p!("same", g!(*stats, "currentAction"), undefined) {
                let blank = r!("blank");
                let heading = c!(
                    "line",
                    r!("clip", l!("Current:"), *width),
                    c!("object"),
                    c!("object"),
                    empty
                );
                let actions = c!(
                    "actionLines",
                    g!(*stats, "currentAction"),
                    c!("add", *width, one)
                );
                let actions = c!("mapActions", actions, *width, muted);
                c!("append", lines, blank, heading, actions);
            }
            return Ok(lines);
        }
        ("actionLine", [line, width, muted]) => {
            return Ok(c!(
                "line",
                r!("clip", l!("  "), *width),
                *muted,
                *muted,
                g!(*line, "text")
            ));
        }
        ("compact", [buffer, rect, stats]) => {
            c!("invoke", g!(*buffer, "clearRect"), *buffer, *rect);
            if p!("le", g!(*rect, "width"), zero) || p!("le", g!(*rect, "height"), zero) {
                return Ok(undefined);
            }
            let status = r!("status", g!(*stats, "status"));
            let label = g!(*stats, "iterationsLabel");
            let label = if p!("nullish", label) {
                l!("Iteration")
            } else {
                label
            };
            let count = c!("number", g!(*stats, "iterations"));
            let suffix = if p!("same", g!(*stats, "iterationsTotal"), undefined) {
                empty
            } else {
                c!("slash", c!("number", g!(*stats, "iterationsTotal")))
            };
            let progress = c!("progress", label, count, suffix);
            let primary = if p!("same", g!(*stats, "iterationsTotal"), undefined) {
                c!("pair", status, progress)
            } else {
                c!("pair", progress, status)
            };
            let metrics = c!(
                "metrics",
                primary,
                c!("formatElapsed", g!(*stats, "elapsedMs")),
                c!(
                    "number",
                    c!("add", g!(*stats, "tokensIn"), g!(*stats, "tokensOut"))
                )
            );
            let first = if p!("same", g!(*rect, "height"), one)
                && p!("same", g!(*stats, "iterationsTotal"), undefined)
                && p!("truthy", g!(*stats, "currentAction"))
            {
                c!("pair", status, g!(*stats, "currentAction"))
            } else {
                metrics
            };
            let action = g!(*stats, "currentAction");
            let action = if p!("nullish", action) { empty } else { action };
            let messages = c!("messages", first, action);
            put!(
                *buffer,
                *rect,
                zero,
                c!(
                    "truncateToWidth",
                    c!("at", messages, zero),
                    g!(*rect, "width")
                ),
                r!("statusStyle", g!(*stats, "status"))
            );
            if p!("gt", g!(*rect, "height"), one)
                && !p!("same", g!(*stats, "currentAction"), undefined)
            {
                put!(
                    *buffer,
                    *rect,
                    one,
                    c!(
                        "truncateToWidth",
                        c!("at", messages, one),
                        g!(*rect, "width")
                    ),
                    r!("tone", l!("muted"))
                );
            }
        }
        ("render", [buffer, rect, stats]) => {
            c!("invoke", g!(*buffer, "clearRect"), *buffer, *rect);
            if p!("le", g!(*rect, "width"), zero) || p!("le", g!(*rect, "height"), zero) {
                return Ok(undefined);
            }
            let mut lines = r!("lines", *stats, g!(*rect, "width"));
            if p!("gt", g!(lines, "length"), g!(*rect, "height")) {
                let actions = if p!("same", g!(*stats, "currentAction"), undefined) {
                    c!("array")
                } else {
                    c!("slice", lines, host.number(9.)?)
                };
                let progress = c!("array");
                if !p!("same", g!(*stats, "iterationsTotal"), undefined) {
                    c!("push", progress, c!("at", lines, one));
                }
                let visible = c!(
                    "slice",
                    actions,
                    zero,
                    c!(
                        "max",
                        zero,
                        c!(
                            "subtract",
                            c!("subtract", g!(*rect, "height"), one),
                            g!(progress, "length")
                        )
                    )
                );
                if p!("gt", g!(visible, "length"), zero)
                    && p!("lt", g!(visible, "length"), g!(actions, "length"))
                {
                    let last = c!("at", visible, c!("subtract", g!(visible, "length"), one));
                    let text = c!(
                        "truncateToWidth",
                        c!("ellipsis", g!(last, "text")),
                        c!(
                            "max",
                            zero,
                            c!(
                                "subtract",
                                g!(*rect, "width"),
                                c!("displayWidth", g!(last, "prefix"))
                            )
                        )
                    );
                    c!(
                        "set",
                        visible,
                        c!("subtract", g!(visible, "length"), one),
                        c!("replaceText", last, text)
                    );
                }
                let first = if !p!("same", g!(*stats, "iterationsTotal"), undefined)
                    && p!("same", g!(*rect, "height"), one)
                {
                    r!(
                        "keyValue",
                        r!("status", g!(*stats, "status")),
                        c!(
                            "fraction",
                            g!(*stats, "iterations"),
                            g!(*stats, "iterationsTotal")
                        ),
                        g!(*rect, "width"),
                        r!("statusStyle", g!(*stats, "status"))
                    )
                } else {
                    c!("at", lines, zero)
                };
                let start = if p!("same", g!(*stats, "iterationsTotal"), undefined) {
                    one
                } else {
                    host.number(2.)?
                };
                let secondary = c!("filter", c!("slice", lines, start, host.number(7.)?));
                lines = c!("prioritize", first, progress, visible, secondary);
            }
            let mut row = zero;
            while p!("lt", row, g!(*rect, "height")) {
                let line = c!("at", lines, row);
                if !p!("same", line, undefined) {
                    if p!("gt", g!(g!(line, "prefix"), "length"), zero) {
                        put!(
                            *buffer,
                            *rect,
                            row,
                            g!(line, "prefix"),
                            g!(line, "prefixStyle")
                        );
                    }
                    if !p!("same", g!(g!(line, "text"), "length"), zero) {
                        let start = c!(
                            "min",
                            c!("displayWidth", g!(line, "prefix")),
                            g!(*rect, "width")
                        );
                        let method = g!(*buffer, "putInRect");
                        let target = c!(
                            "rect",
                            c!("add", g!(*rect, "x"), start),
                            c!("add", g!(*rect, "y"), row),
                            c!("subtract", g!(*rect, "width"), start),
                            one
                        );
                        c!(
                            "invoke",
                            method,
                            *buffer,
                            target,
                            zero,
                            g!(line, "text"),
                            g!(line, "style")
                        );
                    }
                }
                row = c!("add", row, one);
            }
        }
        ("nonempty", [line]) => {
            return Ok(if p!("gt", g!(g!(*line, "prefix"), "length"), zero) {
                c!("gt", one, zero)
            } else {
                c!("gt", g!(g!(*line, "text"), "length"), zero)
            });
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
