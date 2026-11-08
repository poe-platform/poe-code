//! Explorer header layout, active-filter selection and status counts.
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
    macro_rules! put {
        ($screen:expr,$x:expr,$y:expr,$text:expr,$style:expr) => {{
            let screen = $screen;
            c!("put", g!(screen, "put"), screen, $x, $y, $text, $style)
        }};
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let two = host.number(2.)?;
    let undefined = c!("undefined");
    macro_rules! optional_length {
        ($value:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                undefined
            } else {
                g!(value, "length")
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
            let rect = g!(*layout, "header");
            let styles = c!("styles");
            c!("clear", g!(*screen, "clearRect"), *screen, rect);
            if p!("le", g!(rect, "width"), zero) || p!("le", g!(rect, "height"), zero) {
                return Ok(undefined);
            }
            if p!("same", g!(*layout, "mode"), l!("too-narrow")) {
                put!(
                    *screen,
                    zero,
                    zero,
                    c!("fit", l!("Terminal too narrow"), g!(rect, "width")),
                    g!(styles, "borderFocused")
                );
                return Ok(undefined);
            }
            r!(
                "top",
                *screen,
                g!(*state, "title"),
                g!(rect, "width"),
                g!(styles, "border")
            );
            if p!("gt", g!(rect, "height"), one) {
                let prompt = c!("template", c!("lower", *state), l!(">"), l!(""));
                let second = p!("same", g!(*state, "focused"), l!("detail")) && {
                    let pane = g!(g!(*state, "paneDefinitions"), "1");
                    !p!("nullish", pane) && p!("same", g!(pane, "kind"), l!("list"))
                };
                let active_filter = if second {
                    fallback!(g!(g!(*state, "detail"), "filter"), l!(""))
                } else {
                    g!(*state, "filter")
                };
                let filter = if p!("gt", g!(active_filter, "length"), zero) {
                    c!("template", l!(" "), active_filter, l!(""))
                } else {
                    l!("")
                };
                let count = if second {
                    let left = c!(
                        "string",
                        fallback!(optional_length!(g!(g!(*state, "detail"), "items")), zero)
                    );
                    let right = fallback!(
                        optional_length!(g!(g!(*state, "detail"), "allItems")),
                        fallback!(optional_length!(g!(g!(*state, "detail"), "items")), zero)
                    );
                    c!("template", left, l!("/"), right)
                } else {
                    let left = c!("string", g!(g!(*state, "filtered"), "length"));
                    c!("template", left, l!("/"), g!(g!(*state, "rows"), "length"))
                };
                let selected = if p!("truthy", g!(*state, "multiSelect"))
                    && p!("gt", g!(g!(*state, "selected"), "size"), zero)
                {
                    c!(
                        "template",
                        l!("  ("),
                        g!(g!(*state, "selected"), "size"),
                        l!(" selected)")
                    )
                } else {
                    l!("")
                };
                let loading = p!("truthy", g!(g!(*state, "detail"), "loading"));
                let spinner = l!(if loading { "  *" } else { "" });
                let right = c!("template", count, selected, spinner);
                put!(*screen, zero, one, l!("│"), g!(styles, "border"));
                put!(
                    *screen,
                    c!("max", zero, c!("subtract", g!(rect, "width"), one)),
                    one,
                    l!("│"),
                    g!(styles, "border")
                );
                let right_width = c!("width", right);
                let five = host.number(5.)?;
                let prompt_width = c!(
                    "max",
                    zero,
                    c!(
                        "subtract",
                        c!("subtract", g!(rect, "width"), right_width),
                        five
                    )
                );
                put!(
                    *screen,
                    two,
                    one,
                    c!(
                        "fit",
                        c!("template", prompt, filter, l!("")),
                        prompt_width,
                        two
                    ),
                    g!(styles, "accent")
                );
                put!(
                    *screen,
                    c!(
                        "max",
                        two,
                        c!(
                            "subtract",
                            c!("subtract", g!(rect, "width"), right_width),
                            two
                        )
                    ),
                    one,
                    right,
                    g!(styles, "muted")
                );
            }
            if p!("gt", g!(rect, "height"), two) {
                r!(
                    "horizontal",
                    *screen,
                    two,
                    g!(rect, "width"),
                    g!(styles, "border")
                );
            }
        }
        ("top", [screen, title, width, style]) => {
            if p!("same", *width, one) {
                put!(*screen, zero, zero, l!("┌"), *style);
                return Ok(undefined);
            }
            let inner = c!("max", zero, c!("subtract", *width, two));
            let label = c!("fit", c!("template", l!("─ "), *title, l!(" ")), inner, one);
            let middle = c!("pad", label, inner, l!("─"), one);
            put!(
                *screen,
                zero,
                zero,
                c!("template", l!("┌"), middle, l!("┐")),
                *style
            );
        }
        ("horizontal", [screen, y, width, style]) => {
            if p!("same", *width, one) {
                put!(*screen, zero, *y, l!("├"), *style);
                return Ok(undefined);
            }
            let horizontal = l!("─");
            put!(
                *screen,
                zero,
                *y,
                c!(
                    "template",
                    l!("├"),
                    c!(
                        "repeat",
                        g!(horizontal, "repeat"),
                        horizontal,
                        c!("max", zero, c!("subtract", *width, two))
                    ),
                    l!("┤")
                ),
                *style
            );
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
