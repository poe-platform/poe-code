//! Explorer Markdown preparation and the existing content-hash/width cache policy.
use crate::feedback::Host;

const HASH_OFFSET: u32 = 2_166_136_261;
const HASH_PRIME: u32 = 16_777_619;

pub fn content_hash(content: &[u16]) -> u32 {
    content.iter().fold(HASH_OFFSET, |hash, unit| {
        (hash ^ u32::from(*unit)).wrapping_mul(HASH_PRIME)
    })
}

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
    macro_rules! n {
        ($value:expr) => {
            host.number($value)?
        };
    }
    macro_rules! p { ($name:expr $(,$arg:expr)*) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr => $value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    match operation {
        "prepare" => {
            let content = args[0];
            let lines = c!("array");
            if p!("same", g!(c!("trim", content), "length"), n!(0.)) {
                c!("push", lines, c!("array"));
                return Ok(obj!("text"=>l!(""),"lines"=>lines));
            }
            let width = c!("max", n!(1.), args[1]);
            let key = c!("key", c!("hash", content), width);
            let cache = args[2];
            let cached = c!("cacheGet", cache, key);
            if !host.is_undefined(cached)? {
                return Ok(cached);
            }
            let text = c!("trimEnd", c!("render", content, width));
            c!("push", lines, c!("array"));
            c!("walkCells", c!("cells", text), lines);
            let prepared = obj!("text"=>text,"lines"=>lines);
            c!("cacheSet", cache, key, prepared);
            Ok(prepared)
        }
        "cell" => {
            let cell = args[0];
            let lines = args[1];
            if p!("same", g!(cell, "ch"), l!("\n")) {
                c!("push", lines, c!("array"));
            } else {
                c!("lastPush", lines, cell);
            }
            Ok(c!("undefined"))
        }
        "hash" => {
            let content = args[0];
            let mut hash = n!(HASH_OFFSET as f64);
            let mut index = 0.;
            while p!("lt", n!(index), g!(content, "length")) {
                hash = c!("xor", hash, c!("charCodeAt", content, n!(index)));
                hash = c!("imul", hash, n!(HASH_PRIME as f64));
                index += 1.;
            }
            Ok(c!("unsigned", hash))
        }
        _ => Ok(c!("invalidOperation")),
    }
}
