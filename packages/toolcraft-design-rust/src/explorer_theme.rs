//! Explorer palette projection and callback formatting.
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
    macro_rules! l {
        ($value:expr) => {
            host.literal($value)?
        };
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr => $value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    match operation {
        "theme" => {
            let theme = c!("theme");
            Ok(
                obj!("accent"=>g!(theme,"accent"),"muted"=>g!(theme,"muted"),"border"=>g!(theme,"muted"),"borderFocused"=>g!(theme,"accent"),"badge"=>c!("badge",theme),"matchHighlight"=>c!("matchHighlight",theme)),
            )
        }
        "styles" => {
            let styles = g!(c!("theme"), "styles");
            let result = obj!("accent"=>g!(styles,"accent"),"muted"=>g!(styles,"muted"),"border"=>g!(styles,"muted"),"borderFocused"=>g!(styles,"accent"));
            let highlight = c!("spread", g!(styles, "accent"));
            set!(highlight, "underline", c!("true"));
            set!(result, "matchHighlight", highlight);
            set!(
                result,
                "tones",
                obj!("success"=>g!(styles,"success"),"warning"=>g!(styles,"warning"),"error"=>g!(styles,"error"),"info"=>g!(styles,"info"),"muted"=>g!(styles,"muted"))
            );
            Ok(result)
        }
        "badge" => {
            let function = c!("at", args[0], args[2]);
            let text = c!("template", l!(" "), args[1], l!(" "));
            Ok(c!(
                "invoke",
                function,
                args[0],
                text,
                l!("theme[tone] is not a function")
            ))
        }
        "match" => {
            let function = g!(args[0], "accent");
            let text = c!("template", l!("\u{1b}[4m"), args[1], l!("\u{1b}[24m"));
            Ok(c!(
                "invoke",
                function,
                args[0],
                text,
                l!("theme.accent is not a function")
            ))
        }
        _ => Ok(c!("invalidOperation")),
    }
}
