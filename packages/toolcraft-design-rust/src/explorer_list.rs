//! Explorer display lines, cursor visibility and grapheme-aware row drawing.
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
    macro_rules! l {
        ($text:expr) => {
            host.literal($text)?
        };
    }
    macro_rules! r { ($op:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$op,&args)?}}; }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr=>$value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    macro_rules! push {
        ($array:expr,$value:expr) => {
            c!("invoke", g!($array, "push"), $array, $value)
        };
    }
    macro_rules! put {
        ($screen:expr,$x:expr,$y:expr,$text:expr,$style:expr) => {{
            let screen = $screen;
            c!("put", g!(screen, "put"), screen, $x, $y, $text, $style)
        }};
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let two = host.number(2.)?;
    let three = host.number(3.)?;
    let undefined = c!("undefined");
    let no = c!("false");
    let yes = c!("true");
    macro_rules! optional {
        ($value:expr,$key:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                undefined
            } else {
                g!(value, $key)
            }
        }};
    }
    macro_rules! fallback {
        ($value:expr,$other:expr) => {{
            let value = $value;
            if p!("nullish", value) { $other } else { value }
        }};
    }
    match (operation, args) {
        ("render", [state, screen, layout]) => {
            let styles = c!("styles");
            let rect = g!(*layout, "list");
            c!("clear", g!(*screen, "clearRect"), *screen, rect);
            if p!("le", g!(rect, "width"), zero) || p!("le", g!(rect, "height"), zero) {
                return Ok(undefined);
            }
            if p!("same", g!(*layout, "mode"), l!("too-narrow")) {
                r!(
                    "write",
                    *screen,
                    rect,
                    zero,
                    l!("Terminal too narrow"),
                    g!(styles, "muted")
                );
                return Ok(undefined);
            }
            let title = fallback!(
                optional!(g!(g!(*state, "paneDefinitions"), "0"), "title"),
                g!(*state, "title")
            );
            let style = if p!("same", g!(*state, "focused"), l!("list")) {
                g!(styles, "borderFocused")
            } else {
                g!(styles, "border")
            };
            let options = obj!("focused"=>c!("same",g!(*state,"focused"),l!("list")),"indicator"=>if p!("truthy",g!(*state,"rowsLoading")){l!("⠋")}else{let count=c!("string",g!(g!(*state,"filtered"),"length"));c!("template",count,l!("/"),g!(g!(*state,"rows"),"length"))});
            c!("pane", *screen, rect, title, style, options);
            let body = c!("body", rect);
            if p!("le", g!(body, "width"), zero) || p!("le", g!(body, "height"), zero) {
                return Ok(undefined);
            }
            if p!("same", g!(g!(*state, "filtered"), "length"), zero) {
                let hint = if p!("truthy", g!(*state, "rowsLoading")) {
                    l!("Loading…")
                } else {
                    g!(*state, "emptyHint")
                };
                r!(
                    "write",
                    *screen,
                    body,
                    c!("floor", c!("divide", g!(body, "height"), two)),
                    c!("center", hint, g!(body, "width"), g!(body, "x")),
                    g!(styles, "muted")
                );
                return Ok(undefined);
            }
            let lines = r!("lines", *state);
            let mut index = r!("visible", lines, g!(body, "height"), three);
            let mut y = zero;
            while p!("lt", index, g!(lines, "length")) && p!("lt", y, g!(body, "height")) {
                let line = c!("at", lines, index);
                if p!("same", g!(line, "kind"), l!("group")) {
                    r!(
                        "write",
                        *screen,
                        body,
                        y,
                        r!("group", g!(line, "label"), body),
                        g!(styles, "muted")
                    );
                } else if p!("same", g!(line, "kind"), l!("subtitle")) {
                    r!(
                        "write",
                        *screen,
                        body,
                        y,
                        c!("template", l!("  "), g!(line, "text"), l!("")),
                        g!(styles, "muted")
                    );
                } else {
                    let row_index = g!(line, "rowIndex");
                    if p!("ge", y, g!(body, "height")) {
                        break;
                    }
                    let row = g!(line, "row");
                    let multi = g!(*state, "multiSelect");
                    let selected = if p!("truthy", multi) {
                        c!("selected", *state, row)
                    } else {
                        multi
                    };
                    let cursor = c!(
                        "same",
                        row_index,
                        c!("at", g!(*state, "filtered"), g!(*state, "cursor"))
                    );
                    let positions = fallback!(c!("positions", *state, row_index), c!("array"));
                    r!(
                        "row",
                        *screen,
                        body,
                        y,
                        row,
                        obj!("selected"=>selected,"cursor"=>cursor,"focused"=>c!("same",g!(*state,"focused"),l!("list")),"positions"=>positions)
                    );
                }
                y = c!("add", y, one);
                index = c!("add", index, one);
            }
        }
        ("lines", [state]) => {
            let lines = c!("array");
            let context = obj!("lastGroup"=>undefined);
            c!("walkRows", *state, lines, context);
            return Ok(lines);
        }
        ("line", [state, lines, context, index]) => {
            let row = c!("at", g!(*state, "rows"), *index);
            if !p!("truthy", row) {
                return Ok(undefined);
            }
            if p!("truthy", g!(row, "group"))
                && !p!("same", g!(row, "group"), g!(*context, "lastGroup"))
            {
                push!(*lines, obj!("kind"=>l!("group"),"label"=>g!(row,"group")));
                set!(*context, "lastGroup", g!(row, "group"));
            }
            push!(
                *lines,
                obj!("kind"=>l!("row"),"rowIndex"=>*index,"row"=>row,"cursor"=>c!("same",*index,c!("at",g!(*state,"filtered"),g!(*state,"cursor"))))
            );
            if p!("truthy", g!(row, "subtitle")) {
                push!(
                    *lines,
                    obj!("kind"=>l!("subtitle"),"row"=>row,"text"=>g!(row,"subtitle"))
                );
            }
        }
        ("visible", [lines, height, scrolloff]) => {
            if p!("le", *height, zero) {
                return Ok(zero);
            }
            let cursor = c!("findCursor", *lines);
            if p!("lt", cursor, zero) {
                return Ok(zero);
            }
            return Ok(c!(
                "max",
                zero,
                c!(
                    "subtract",
                    cursor,
                    c!(
                        "max",
                        zero,
                        c!("subtract", c!("subtract", *height, one), *scrolloff)
                    )
                )
            ));
        }
        ("isCursor", [line]) => {
            return Ok(if p!("same", g!(*line, "kind"), l!("row")) {
                g!(*line, "cursor")
            } else {
                no
            });
        }
        ("group", [label, rect]) => {
            let text = c!("template", l!(" "), *label, l!(" "));
            let width = c!("width", text, g!(*rect, "x"));
            if p!("ge", width, g!(*rect, "width")) {
                return Ok(*label);
            }
            let horizontal = l!("─");
            return Ok(c!(
                "template",
                text,
                c!(
                    "repeat",
                    g!(horizontal, "repeat"),
                    horizontal,
                    c!("subtract", g!(*rect, "width"), width)
                ),
                l!("")
            ));
        }
        ("row", [screen, rect, row_y, row, opts]) => {
            let styles = c!("styles");
            let selected = p!("truthy", g!(*opts, "selected"));
            let marker = l!(if selected { "*" } else { " " });
            let cursor = p!("truthy", g!(*opts, "cursor"));
            let cursor = l!(if cursor { "●" } else { "◌" });
            let focused = p!("truthy", g!(*opts, "cursor")) && p!("truthy", g!(*opts, "focused"));
            let focus = l!(if focused { " ▌" } else { "" });
            let prefix = c!("prefix", marker, cursor);
            let prefix_width = c!("width", prefix, g!(*rect, "x"));
            let focus_width = c!("width", focus);
            let badge = if p!("truthy", g!(*row, "badge")) {
                c!(
                    "fit",
                    c!("template", l!(" "), g!(g!(*row, "badge"), "text"), l!("")),
                    c!(
                        "max",
                        zero,
                        c!(
                            "subtract",
                            c!("subtract", g!(*rect, "width"), prefix_width),
                            focus_width
                        )
                    ),
                    c!("add", g!(*rect, "x"), prefix_width)
                )
            } else {
                l!("")
            };
            let badge_width = c!("width", badge);
            let available = c!(
                "max",
                zero,
                c!(
                    "subtract",
                    c!(
                        "subtract",
                        c!("subtract", g!(*rect, "width"), prefix_width),
                        focus_width
                    ),
                    badge_width
                )
            );
            let raw_title = c!("strip", g!(*row, "title"));
            let title_x = c!("add", g!(*rect, "x"), prefix_width);
            let title = c!("fit", raw_title, available, title_x);
            let truncated = c!("gt", c!("width", raw_title, title_x), available);
            let positions = c!("set", g!(*opts, "positions"));
            let x = g!(*rect, "x");
            let y = c!("add", g!(*rect, "y"), *row_y);
            put!(
                *screen,
                x,
                y,
                prefix,
                if p!("truthy", g!(*opts, "cursor")) {
                    g!(styles, "accent")
                } else {
                    g!(styles, "muted")
                }
            );
            let x = c!("add", x, prefix_width);
            let point = obj!("x"=>x,"y"=>y);
            c!(
                "walkSegments",
                c!("split", title, x),
                *screen,
                point,
                title,
                truncated,
                positions,
                styles
            );
            if p!("truthy", g!(*row, "badge")) {
                put!(
                    *screen,
                    c!(
                        "subtract",
                        c!(
                            "subtract",
                            c!("add", g!(*rect, "x"), g!(*rect, "width")),
                            badge_width
                        ),
                        focus_width
                    ),
                    y,
                    badge,
                    c!(
                        "at",
                        g!(styles, "tones"),
                        fallback!(g!(g!(*row, "badge"), "tone"), l!("muted"))
                    )
                );
            }
            if p!("truthy", focus) {
                put!(
                    *screen,
                    c!(
                        "subtract",
                        c!("add", g!(*rect, "x"), g!(*rect, "width")),
                        focus_width
                    ),
                    y,
                    focus,
                    g!(styles, "borderFocused")
                );
            }
        }
        ("segment", [segment, screen, point, title, truncated, positions, styles]) => {
            let truncation = p!("truthy", *truncated)
                && p!("same", g!(*segment, "end"), g!(*title, "length"))
                && p!("same", g!(*segment, "value"), l!("…"));
            let matched = if truncation {
                false
            } else {
                let found = r!(
                    "match",
                    g!(*segment, "start"),
                    g!(*segment, "end"),
                    *positions
                );
                host.is_true(found)?
            };
            let style = if matched {
                g!(*styles, "matchHighlight")
            } else {
                c!("object")
            };
            put!(
                *screen,
                g!(*point, "x"),
                g!(*point, "y"),
                g!(*segment, "value"),
                style
            );
            set!(
                *point,
                "x",
                c!("add", g!(*point, "x"), g!(*segment, "width"))
            );
        }
        ("match", [start, end, positions]) => {
            let mut position = *start;
            while p!("lt", position, *end) {
                if p!("truthy", c!("has", *positions, position)) {
                    return Ok(yes);
                }
                position = c!("add", position, one);
            }
            return Ok(no);
        }
        ("write", [screen, rect, row, text, style]) => {
            let style = if host.is_undefined(*style)? {
                c!("object")
            } else {
                *style
            };
            put!(
                *screen,
                g!(*rect, "x"),
                c!("add", g!(*rect, "y"), *row),
                c!("fit", *text, g!(*rect, "width"), g!(*rect, "x")),
                style
            );
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
