//! Explorer footer hint selection, action shortcuts and clipped drawing.
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
    let zero = host.number(0.)?;
    let two = host.number(2.)?;
    let undefined = c!("undefined");
    let yes = c!("true");
    let no = c!("false");
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
            let rect = g!(*layout, "footer");
            let styles = c!("styles");
            c!("clear", g!(*screen, "clearRect"), *screen, rect);
            if p!("le", g!(rect, "width"), zero) || p!("le", g!(rect, "height"), zero) {
                return Ok(undefined);
            }
            let hints = r!("hints", *state);
            let cursor = obj!("x"=>c!("add",g!(rect,"x"),two),"y"=>g!(rect,"y"),"endX"=>c!("add",g!(rect,"x"),g!(rect,"width")));
            c!("walkHints", hints, *screen, cursor, styles);
        }
        ("hints", [state]) => {
            if p!("same", optional!(g!(*state, "modal"), "kind"), l!("input")) {
                return Ok(c!(
                    "pair",
                    obj!("key"=>l!("Enter"),"label"=>l!("submit"),"running"=>no),
                    obj!("key"=>l!("Esc"),"label"=>l!("cancel"),"running"=>no)
                ));
            }
            if p!(
                "same",
                optional!(g!(*state, "modal"), "kind"),
                l!("confirm")
            ) {
                return Ok(c!(
                    "pair",
                    obj!("key"=>l!("Y/Enter"),"label"=>g!(g!(*state,"modal"),"confirmLabel"),"running"=>no),
                    obj!("key"=>l!("N/Esc"),"label"=>g!(g!(*state,"modal"),"cancelLabel"),"running"=>no)
                ));
            }
            let hints = c!("array");
            if p!("same", g!(*state, "focused"), l!("detail")) {
                push!(
                    hints,
                    obj!("key"=>l!("Tab"),"label"=>l!("focus"),"running"=>no)
                );
            }
            push!(
                hints,
                obj!("key"=>l!("Enter"),"label"=>l!("actions"),"running"=>no)
            );
            c!("walkActions", *state, hints);
            push!(
                hints,
                obj!("key"=>l!("Ctrl+P"),"label"=>l!("palette"),"running"=>no)
            );
            let up = fallback!(c!("binding", *state, l!("builtin:reorderUp")), c!("array"));
            let down = fallback!(
                c!("binding", *state, l!("builtin:reorderDown")),
                c!("array")
            );
            if p!(
                "includes",
                g!(up, "includes"),
                up,
                l!("Shift+up"),
                l!("up.includes is not a function")
            ) && p!(
                "includes",
                g!(down, "includes"),
                down,
                l!("Shift+down"),
                l!("down.includes is not a function")
            ) {
                push!(
                    hints,
                    obj!("key"=>l!("⇧↑↓"),"label"=>l!("reorder (within state)"),"running"=>no,"bracketed"=>no)
                );
            }
            push!(
                hints,
                obj!("key"=>l!("Esc"),"label"=>l!("clear/quit"),"running"=>no)
            );
            if p!("gt", g!(g!(*state, "selected"), "size"), zero) {
                push!(
                    hints,
                    obj!("key"=>c!("string",g!(g!(*state,"selected"),"size")),"label"=>l!("selected"),"running"=>no,"bracketed"=>no)
                );
            }
            return Ok(hints);
        }
        ("action", [state, hints, id, entry]) => {
            if !p!("truthy", g!(*entry, "available"))
                || p!("same", optional!(g!(*entry, "action"), "showInFooter"), no)
            {
                return Ok(undefined);
            }
            let key = r!("key", *entry, *id);
            let label = if p!("truthy", g!(*state, "multiSelect"))
                && p!("gt", g!(g!(*state, "selected"), "size"), zero)
                && p!("same", g!(*entry, "source"), l!("row"))
            {
                let label = c!("string", g!(*entry, "label"));
                c!(
                    "template",
                    label,
                    l!(" "),
                    g!(g!(*state, "selected"), "size")
                )
            } else {
                g!(*entry, "label")
            };
            push!(
                *hints,
                obj!("key"=>key,"label"=>label,"running"=>c!("same",g!(*entry,"running"),yes))
            );
        }
        ("key", [entry, fallback_key]) => {
            let accelerator = optional!(g!(*entry, "action"), "accelerator");
            if !host.is_undefined(accelerator)? {
                return Ok(c!("accelerator", *entry));
            }
            let key = optional!(g!(*entry, "action"), "key");
            if p!("isArray", key) {
                return Ok(fallback!(g!(key, "0"), *fallback_key));
            }
            return Ok(fallback!(
                key,
                if p!("same", optional!(g!(*entry, "action"), "primary"), yes) {
                    l!("Enter")
                } else {
                    *fallback_key
                }
            ));
        }
        ("hint", [hint, screen, cursor, styles]) => {
            let x = g!(*cursor, "x");
            let y = g!(*cursor, "y");
            let end = g!(*cursor, "endX");
            if p!("ge", x, end) {
                return Ok(yes);
            }
            if p!("same", g!(*hint, "bracketed"), no) {
                let key = c!("string", g!(*hint, "key"));
                let text = c!("template", key, l!(" "), g!(*hint, "label"));
                let style = if p!("truthy", g!(*hint, "running")) {
                    g!(*styles, "muted")
                } else {
                    c!("object")
                };
                let width = r!("put", *screen, x, y, end, text, style);
                set!(*cursor, "x", c!("add", x, c!("add", width, two)));
                return Ok(no);
            }
            let text = c!("template", l!("["), g!(*hint, "key"), l!("]"));
            let style = if p!("truthy", g!(*hint, "running")) {
                g!(*styles, "muted")
            } else {
                g!(*styles, "accent")
            };
            let width = r!("put", *screen, x, y, end, text, style);
            let x = c!("add", x, width);
            set!(*cursor, "x", x);
            if p!("lt", width, c!("width", text)) || p!("ge", x, end) {
                return Ok(yes);
            }
            let text = c!("template", l!(" "), g!(*hint, "label"), l!(""));
            let style = if p!("truthy", g!(*hint, "running")) {
                g!(*styles, "muted")
            } else {
                c!("object")
            };
            let width = r!("put", *screen, x, y, end, text, style);
            set!(*cursor, "x", c!("add", x, c!("add", width, two)));
            return Ok(no);
        }
        ("put", [screen, x, y, end, text, style]) => {
            let style = if host.is_undefined(*style)? {
                c!("object")
            } else {
                *style
            };
            let remaining = c!("max", zero, c!("subtract", *end, *x));
            let fitted = c!("fit", *text, remaining, *x);
            c!("put", g!(*screen, "put"), *screen, *x, *y, fitted, style);
            return Ok(c!("width", fitted, *x));
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
