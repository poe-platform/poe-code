//! Explorer modal geometry, content selection, palette filtering and box drawing.
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
    macro_rules! invoke { ($value:expr,$key:expr,$message:expr $(,$arg:expr)* $(,)?) => {{let value=$value;c!("invoke",g!(value,$key),value,l!($message) $(,$arg)*)}}; }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let two = host.number(2.)?;
    let undefined = c!("undefined");
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
    macro_rules! kind {
        ($state:expr,$kind:expr) => {
            p!("same", optional!(g!($state, "modal"), "kind"), l!($kind))
        };
    }
    match (operation, args) {
        ("render", [state, screen]) => {
            if p!("same", g!(*state, "modal"), c!("null"))
                || p!("le", g!(*screen, "width"), zero)
                || p!("le", g!(*screen, "height"), zero)
            {
                return Ok(undefined);
            }
            let available = c!("subtract", g!(*screen, "width"), two);
            let minimum = host.number(34.)?;
            let screen_width = g!(*screen, "width");
            let ratio = if kind!(*state, "content") { 0.86 } else { 0.62 };
            let ratio = host.number(ratio)?;
            let width = c!(
                "min",
                available,
                c!(
                    "max",
                    minimum,
                    c!("floor", c!("multiply", screen_width, ratio))
                )
            );
            let available = c!("subtract", g!(*screen, "height"), two);
            let height = c!("min", available, r!("height", *state));
            let x = c!(
                "max",
                zero,
                c!(
                    "floor",
                    c!("divide", c!("subtract", g!(*screen, "width"), width), two)
                )
            );
            let y = c!(
                "max",
                zero,
                c!(
                    "floor",
                    c!("divide", c!("subtract", g!(*screen, "height"), height), two)
                )
            );
            let styles = c!("styles");
            r!(
                "box",
                *screen,
                x,
                y,
                width,
                height,
                r!("title", *state),
                g!(styles, "borderFocused")
            );
            let lines = r!("lines", *state);
            let mut row = zero;
            while p!(
                "lt",
                row,
                c!("min", g!(lines, "length"), c!("subtract", height, two))
            ) {
                let method = g!(*screen, "put");
                let column = c!("add", x, two);
                let line_row = c!("add", c!("add", y, one), row);
                let four = host.number(4.)?;
                let text = c!(
                    "fit",
                    c!("strip", c!("at", lines, row)),
                    c!("subtract", width, four),
                    c!("add", x, two)
                );
                let style = if p!("same", row, one) {
                    g!(styles, "accent")
                } else {
                    c!("object")
                };
                c!(
                    "invoke",
                    method,
                    *screen,
                    l!("screen.put is not a function"),
                    column,
                    line_row,
                    text,
                    style
                );
                row = c!("add", row, one);
            }
        }
        ("lines", [state]) => {
            if kind!(*state, "help") {
                return Ok(c!(
                    "array",
                    l!("Navigation"),
                    l!("  ↑ ↓ k j       move cursor"),
                    l!("  Tab           cycle panes"),
                    l!("  /             filter"),
                    l!("  ?             help"),
                    l!("  q             quit")
                ));
            }
            if kind!(*state, "confirm") {
                let message = g!(g!(*state, "modal"), "message");
                let first = c!(
                    "template",
                    l!("  [ "),
                    g!(g!(*state, "modal"), "confirmLabel"),
                    l!(" ]    ")
                );
                let second = c!(
                    "template",
                    first,
                    g!(g!(*state, "modal"), "cancelLabel"),
                    l!("")
                );
                return Ok(c!("array", message, second));
            }
            if kind!(*state, "input") {
                let value = if p!("gt", g!(g!(g!(*state, "modal"), "value"), "length"), zero) {
                    g!(g!(*state, "modal"), "value")
                } else {
                    fallback!(g!(g!(*state, "modal"), "placeholder"), l!(""))
                };
                let label = g!(g!(*state, "modal"), "label");
                return Ok(c!("array", label, c!("template", l!("  "), value, l!("▌"))));
            }
            if kind!(*state, "palette") {
                let query = c!(
                    "template",
                    l!("Query: "),
                    g!(g!(*state, "modal"), "query"),
                    l!("")
                );
                return Ok(c!("spread", query, r!("palette", *state)));
            }
            if kind!(*state, "content") {
                let lines = invoke!(
                    g!(g!(*state, "modal"), "content"),
                    "split",
                    "state.modal.content.split is not a function",
                    l!("\n")
                );
                return Ok(invoke!(
                    lines,
                    "slice",
                    "state.modal.content.split(...).slice is not a function",
                    g!(g!(*state, "modal"), "scroll")
                ));
            }
            return Ok(c!("array"));
        }
        ("title", [state]) => {
            if kind!(*state, "help") {
                return Ok(l!("Keybindings"));
            }
            if kind!(*state, "confirm") || kind!(*state, "input") || kind!(*state, "content") {
                return Ok(g!(g!(*state, "modal"), "title"));
            }
            return Ok(l!("Command Palette"));
        }
        ("height", [state]) => {
            let minimum = host.number(5.)?;
            let lines = if kind!(*state, "content") {
                invoke!(
                    g!(g!(*state, "modal"), "content"),
                    "split",
                    "state.modal.content.split is not a function",
                    l!("\n")
                )
            } else {
                r!("lines", *state)
            };
            return Ok(c!("max", minimum, c!("add", g!(lines, "length"), two)));
        }
        ("box", [screen, x, y, width, height, title, style]) => {
            invoke!(
                *screen,
                "clearRect",
                "screen.clearRect is not a function",
                obj!("x"=>*x,"y"=>*y,"width"=>*width,"height"=>*height)
            );
            let inner = c!("max", zero, c!("subtract", *width, two));
            let segment = c!(
                "fit",
                c!("template", l!("─ "), *title, l!(" ")),
                inner,
                c!("add", *x, one)
            );
            invoke!(
                *screen,
                "put",
                "screen.put is not a function",
                *x,
                *y,
                c!(
                    "template",
                    l!("╭"),
                    c!("pad", segment, inner, l!("─"), c!("add", *x, one)),
                    l!("╮")
                ),
                *style
            );
            let mut row = one;
            while p!("lt", row, c!("subtract", *height, one)) {
                invoke!(
                    *screen,
                    "put",
                    "screen.put is not a function",
                    *x,
                    c!("add", *y, row),
                    l!("│"),
                    *style
                );
                invoke!(
                    *screen,
                    "put",
                    "screen.put is not a function",
                    c!("subtract", c!("add", *x, *width), one),
                    c!("add", *y, row),
                    l!("│"),
                    *style
                );
                row = c!("add", row, one);
            }
            invoke!(
                *screen,
                "put",
                "screen.put is not a function",
                *x,
                c!("subtract", c!("add", *y, *height), one),
                c!(
                    "template",
                    l!("╰"),
                    invoke!(
                        l!("─"),
                        "repeat",
                        "\"─\".repeat is not a function",
                        c!("max", zero, c!("subtract", *width, two))
                    ),
                    l!("╯")
                ),
                *style
            );
        }
        ("palette", [state]) => {
            if !kind!(*state, "palette") {
                return Ok(c!("array"));
            }
            let query = invoke!(
                g!(g!(*state, "modal"), "query"),
                "toLocaleLowerCase",
                "state.modal.query.toLocaleLowerCase is not a function"
            );
            let lines = c!("array");
            let entries = invoke!(
                g!(*state, "actionState"),
                "values",
                "state.actionState.values is not a function"
            );
            c!("walkEntries", entries, *state, query, lines);
            return Ok(if p!("same", g!(lines, "length"), zero) {
                c!("array", l!("  No actions"))
            } else {
                lines
            });
        }
        ("entry", [entry, state, query, lines]) => {
            let yes = c!("true");
            if !p!("same", g!(*entry, "available"), yes)
                || p!("same", g!(*entry, "running"), yes)
                || p!("same", g!(*entry, "action"), undefined)
            {
                return Ok(undefined);
            }
            if !p!("same", *query, l!("")) {
                let lower = invoke!(
                    g!(*entry, "label"),
                    "toLocaleLowerCase",
                    "entry.label.toLocaleLowerCase is not a function"
                );
                if !p!(
                    "truthy",
                    invoke!(
                        lower,
                        "includes",
                        "entry.label.toLocaleLowerCase(...).includes is not a function",
                        *query
                    )
                ) {
                    return Ok(undefined);
                }
            }
            let prefix = if p!(
                "same",
                g!(*lines, "length"),
                g!(g!(*state, "modal"), "cursor")
            ) {
                l!("▌ ")
            } else {
                l!("  ")
            };
            invoke!(
                *lines,
                "push",
                "lines.push is not a function",
                c!("template", prefix, g!(*entry, "label"), l!(""))
            );
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
