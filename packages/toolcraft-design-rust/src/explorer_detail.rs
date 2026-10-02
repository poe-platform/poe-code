//! Explorer detail mode selection, scrolling, rendering and frame composition.
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
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let undefined = c!("undefined");
    let null = c!("null");
    macro_rules! fallback {
        ($value:expr,$other:expr) => {{
            let value = $value;
            if p!("nullish", value) { $other } else { value }
        }};
    }
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
    match (operation, args) {
        ("render", [state, screen, layout]) => {
            let rect = g!(*layout, "detail");
            let styles = c!("styles");
            c!("clear", g!(*screen, "clearRect"), *screen, rect);
            if p!("le", g!(rect, "width"), zero) || p!("le", g!(rect, "height"), zero) {
                return Ok(undefined);
            }
            let row = fallback!(c!("find", g!(*state, "rows"), *state), null);
            let pane = g!(g!(*state, "paneDefinitions"), "1");
            let method = optional!(pane, "titleForRow");
            let title = if p!("nullish", method) {
                undefined
            } else {
                c!("title", method, pane, fallback!(row, undefined))
            };
            let title = fallback!(title, fallback!(optional!(pane, "title"), l!("Preview")));
            let body = r!("body", *state, *screen, c!("body", rect), row);
            let start = g!(body, "start");
            let max = g!(body, "max");
            let style = if p!("same", g!(*state, "focused"), l!("detail")) {
                g!(styles, "borderFocused")
            } else {
                g!(styles, "border")
            };
            let focused = c!("same", g!(*state, "focused"), l!("detail"));
            let indicator = if p!("truthy", g!(g!(*state, "detail"), "loading")) {
                l!("⠋")
            } else {
                let percent = if p!("same", max, zero) {
                    zero
                } else {
                    let hundred = host.number(100.)?;
                    c!("round", c!("multiply", c!("divide", start, max), hundred))
                };
                c!("template", percent, l!("%"), l!(""))
            };
            c!(
                "frame",
                *screen,
                rect,
                title,
                style,
                obj!("focused"=>focused,"indicator"=>indicator)
            );
        }
        ("matches", [row, state]) => {
            return Ok(c!(
                "same",
                g!(*row, "id"),
                g!(g!(*state, "detail"), "rowId")
            ));
        }
        ("body", [state, screen, rect, row]) => {
            let styles = c!("styles");
            let items = g!(g!(*state, "detail"), "items");
            if p!("le", g!(*rect, "width"), zero) || p!("le", g!(*rect, "height"), zero) {
                return Ok(obj!("start"=>zero,"max"=>zero));
            }
            if p!("same", items, null) {
                let text = if p!("same", *row, null) {
                    g!(*state, "emptyHint")
                } else {
                    l!("Loading detail...")
                };
                r!("write", *screen, *rect, zero, text, g!(styles, "muted"));
                return Ok(obj!("start"=>zero,"max"=>zero));
            }
            if p!("same", g!(items, "length"), zero) {
                r!(
                    "write",
                    *screen,
                    *rect,
                    zero,
                    g!(*state, "emptyHint"),
                    g!(styles, "muted")
                );
                return Ok(obj!("start"=>zero,"max"=>zero));
            }
            if p!("same", g!(items, "length"), one)
                && p!("same", optional!(g!(items, "0"), "title"), undefined)
            {
                let text = r!("item", g!(items, "0"), *rect, *row);
                let content = c!("prepare", text, g!(*rect, "width"));
                return Ok(r!(
                    "blob",
                    *screen,
                    *rect,
                    g!(content, "lines"),
                    g!(g!(*state, "detail"), "scroll")
                ));
            }
            return run(host, "list", &[*state, *screen, *rect, items, *row]);
        }
        ("list", [state, screen, rect, items, row]) => {
            let styles = c!("styles");
            let cursor = obj!("y"=>zero);
            let max = c!("max", zero, c!("subtract", g!(*items, "length"), one));
            let start = c!(
                "min",
                max,
                c!("max", zero, g!(g!(*state, "detail"), "scroll"))
            );
            let mut index = start;
            while p!("lt", index, g!(*items, "length"))
                && p!("lt", g!(cursor, "y"), g!(*rect, "height"))
            {
                let item = c!("at", *items, index);
                let active = p!("same", index, g!(g!(*state, "detail"), "cursor"));
                let title = fallback!(g!(item, "title"), g!(item, "id"));
                let selected = p!("truthy", g!(*state, "multiSelect"))
                    && p!(
                        "truthy",
                        c!("selected", g!(*state, "selected"), g!(item, "id"))
                    );
                let prefix = l!(match (selected, active) {
                    (true, true) => "*▌ ",
                    (true, false) => "*  ",
                    (false, true) => " ▌ ",
                    (false, false) => "   ",
                });
                let badge = if p!("truthy", g!(item, "badge")) {
                    c!("template", l!(" "), g!(g!(item, "badge"), "text"), l!(""))
                } else {
                    l!("")
                };
                let text = c!("template", prefix, title, badge);
                let style = if active {
                    g!(styles, "borderFocused")
                } else {
                    g!(styles, "accent")
                };
                r!("write", *screen, *rect, g!(cursor, "y"), text, style);
                set!(cursor, "y", c!("add", g!(cursor, "y"), one));
                if p!("truthy", g!(item, "subtitle"))
                    && p!("lt", g!(cursor, "y"), g!(*rect, "height"))
                {
                    r!(
                        "write",
                        *screen,
                        *rect,
                        g!(cursor, "y"),
                        c!("template", l!("  "), g!(item, "subtitle"), l!("")),
                        g!(styles, "muted")
                    );
                    set!(cursor, "y", c!("add", g!(cursor, "y"), one));
                }
                let text = r!("item", item, *rect, *row);
                let content = c!("prepare", text, g!(*rect, "width"));
                c!("walkLines", content, *screen, *rect, cursor);
                if p!("lt", g!(cursor, "y"), g!(*rect, "height")) {
                    set!(cursor, "y", c!("add", g!(cursor, "y"), one));
                }
                index = c!("add", index, one);
            }
            return Ok(obj!("start"=>start,"max"=>max));
        }
        ("content-line", [line, screen, rect, cursor]) => {
            if p!("ge", g!(*cursor, "y"), g!(*rect, "height")) {
                return Ok(c!("true"));
            }
            r!(
                "write",
                *screen,
                *rect,
                g!(*cursor, "y"),
                c!("template", l!("  "), *line, l!("")),
                c!("object")
            );
            set!(*cursor, "y", c!("add", g!(*cursor, "y"), one));
            return Ok(c!("false"));
        }
        ("blob", [screen, rect, all_lines, scroll]) => {
            let max = c!(
                "max",
                zero,
                c!("subtract", g!(*all_lines, "length"), g!(*rect, "height"))
            );
            let start = c!("min", max, c!("max", zero, *scroll));
            let lines = c!("slice", *all_lines, start);
            let mut row = zero;
            while p!("lt", row, g!(*rect, "height")) {
                let cursor = obj!("x"=>g!(*rect,"x"));
                let cells = fallback!(c!("at", lines, row), c!("array"));
                c!("walkCells", cells, *screen, *rect, row, cursor);
                row = c!("add", row, one);
            }
            return Ok(obj!("start"=>start,"max"=>max));
        }
        ("cell", [cell, screen, rect, row, cursor]) => {
            if p!(
                "gt",
                c!("add", g!(*cursor, "x"), g!(*cell, "width")),
                c!("add", g!(*rect, "x"), g!(*rect, "width"))
            ) {
                return Ok(c!("true"));
            }
            c!(
                "put",
                g!(*screen, "put"),
                *screen,
                g!(*cursor, "x"),
                c!("add", g!(*rect, "y"), *row),
                g!(*cell, "ch"),
                g!(*cell, "style")
            );
            set!(
                *cursor,
                "x",
                c!("add", g!(*cursor, "x"), g!(*cell, "width"))
            );
            return Ok(c!("false"));
        }
        ("item", [item, rect, row]) => {
            if !p!("same", g!(*item, "renderedContent"), undefined) {
                return host.get(*item, "renderedContent");
            }
            let result = c!("render", *item, *rect, *row);
            if p!("truthy", g!(result, "ok")) {
                let value = g!(result, "value");
                return Ok(if p!("isString", value) {
                    value
                } else {
                    l!("Loading detail...")
                });
            }
            let error = g!(result, "error");
            return Ok(if p!("isError", error) {
                c!("template", l!("Error: "), g!(error, "message"), l!(""))
            } else {
                l!("Error: detail failed")
            });
        }
        ("write", [screen, rect, row, text, style]) => {
            let style = if host.is_undefined(*style)? {
                c!("object")
            } else {
                *style
            };
            if p!("lt", *row, zero) || p!("ge", *row, g!(*rect, "height")) {
                return Ok(undefined);
            }
            let method = g!(*screen, "put");
            let x = g!(*rect, "x");
            let y = c!("add", g!(*rect, "y"), *row);
            let text = c!("fit", *text, g!(*rect, "width"), g!(*rect, "x"));
            c!("put", method, *screen, x, y, text, style);
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
