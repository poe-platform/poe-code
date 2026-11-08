//! Explorer region invalidation, modal layering and toast composition.
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
    let undefined = c!("undefined");
    let null = c!("null");
    match (operation, args) {
        ("render", [state, screen]) => {
            let options = c!("object");
            set!(options, "cols", g!(g!(*state, "size"), "cols"));
            set!(options, "rows", g!(g!(*state, "size"), "rows"));
            let hidden = c!("same", g!(*state, "layout"), l!("narrow-list-only"));
            let hidden = if host.is_true(hidden)? {
                hidden
            } else {
                c!("same", g!(*state, "layout"), l!("too-narrow"))
            };
            set!(options, "detailHidden", hidden);
            set!(options, "focused", g!(*state, "focused"));
            let layout = c!("layout", options);
            let dirty = if p!("same", g!(*state, "dirty"), zero) {
                c!("all")
            } else {
                g!(*state, "dirty")
            };
            c!("walk", *state, *screen, layout, dirty);
            if !p!("same", g!(*state, "modal"), null)
                && p!("same", c!("and", dirty, c!("modalMask")), zero)
            {
                c!("modal", *state, *screen);
            }
            if !p!("same", g!(*state, "toast"), null) {
                r!("toast", *state, *screen);
            }
        }
        ("region", [region, render, state, screen, layout, dirty]) => {
            if !p!("same", c!("and", *dirty, *region), zero) {
                c!("render", *render, *state, *screen, *layout);
            }
        }
        ("toast", [state, screen]) => {
            if p!("le", g!(*screen, "width"), zero) || p!("le", g!(*screen, "height"), zero) {
                return Ok(undefined);
            }
            let one = host.number(1.)?;
            let y = c!("max", zero, c!("subtract", g!(*screen, "height"), one));
            c!(
                "clear",
                g!(*screen, "clearRect"),
                *screen,
                obj!("x"=>zero,"y"=>y,"width"=>g!(*screen,"width"),"height"=>one)
            );
            if p!("same", g!(*state, "toast"), null) {
                return Ok(undefined);
            }
            let styles = c!("styles");
            let message = c!(
                "fit",
                c!(
                    "template",
                    l!(" "),
                    g!(g!(*state, "toast"), "message"),
                    l!(" ")
                ),
                g!(*screen, "width")
            );
            c!(
                "put",
                g!(*screen, "put"),
                *screen,
                zero,
                y,
                message,
                g!(styles, "accent")
            );
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
