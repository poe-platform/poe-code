//! Single-detail composition with host-owned asynchronous closures and row identities.
use crate::feedback::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match operation {
        "single" => {
            let detail = c!("object");
            let key = host.literal("items")?;
            c!("assign", detail, key, c!("items", args[0]));
            Ok(detail)
        }
        "items" => {
            let item = c!("object");
            let key = host.literal("id")?;
            let id = host.get(args[0], "id")?;
            c!("assign", item, key, id);
            let key = host.literal("render")?;
            c!("assign", item, key, c!("render", args[0], args[1]));
            Ok(c!("array", item))
        }
        _ => Ok(c!("invalidOperation")),
    }
}
