//! Incremental terminal input policy with host-owned buffers and timers.
use crate::text_cells;
pub trait Host: text_cells::Host {
    fn string(&mut self, value: &'static str) -> Result<Self::Value, Self::Error>;
    fn boolean(&mut self, value: bool) -> Result<Self::Value, Self::Error>;
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c {($name:expr $(,$arg:expr)* $(,)?)=>{{let args=vec![$($arg),*];host.call($name,args)?}};}
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p {($name:expr $(,$arg:expr)* $(,)?)=>{{let value=c!($name $(,$arg)*);host.is_true(value)?}};}
    macro_rules! n {
        ($number:expr) => {
            host.number($number as f64)?
        };
    }
    macro_rules! t {
        ($text:expr) => {
            host.string($text)?
        };
    }
    macro_rules! kind {
        ($value:expr,$name:expr) => {{
            let value = $value;
            host.is_kind(value, $name)?
        }};
    }
    macro_rules! undefined {
        ($value:expr) => {{
            let value = $value;
            host.is_undefined(value)?
        }};
    }
    let zero = n!(0);
    let one = n!(1);
    let two = n!(2);
    let yes = host.boolean(true)?;
    let no = host.boolean(false)?;
    macro_rules! key {
        ($name:expr) => {
            c!("key", $name, no, no, no)
        };
    }
    match (operation, args) {
        ("clearTimer", [state]) => {
            let timer = g!(*state, "timer");
            if !host.is_undefined(timer)? {
                c!("clearTimer", timer);
            }
            c!("setTimer", *state, c!("undefined"));
            c!("setEscapeReady", *state, no);
        }
        ("armTimer", [state]) => {
            if undefined!(g!(*state, "timer")) {
                c!("armTimer", *state);
            }
        }
        ("timeout", [state]) => {
            c!("setTimer", *state, c!("undefined"));
            let options = g!(*state, "options");
            let callback = g!(options, "onEvent");
            if !host.is_undefined(callback)?
                && p!("gt", g!(g!(*state, "pending"), "length"), zero)
                && p!("everyEscape", g!(*state, "pending"))
            {
                let count = g!(g!(*state, "pending"), "length");
                c!("setPending", *state, c!("emptyBuffer"));
                let mut index = zero;
                while p!("lt", index, count) {
                    c!("emitKey", options, t!("escape"));
                    index = c!("add", index, one);
                }
            } else {
                c!("setEscapeReady", *state, yes);
            }
        }
        ("feed", [state, chunk]) => {
            if p!("gt", g!(*chunk, "length"), zero) {
                if p!("gt", g!(g!(*state, "pending"), "length"), zero)
                    && p!("everyEscape", g!(*state, "pending"))
                {
                    run(host, "clearTimer", &[*state])?;
                }
                let pending = if p!("same", g!(g!(*state, "pending"), "length"), zero) {
                    c!("bufferFrom", *chunk)
                } else {
                    c!("bufferConcat", g!(*state, "pending"), *chunk)
                };
                c!("setPending", *state, pending);
            }
            return run(host, "parse", &[*state]);
        }
        ("destroy", [state]) => {
            run(host, "clearTimer", &[*state])?;
            c!("setPending", *state, c!("emptyBuffer"));
        }
        ("decode", [input]) => {
            if p!("same", g!(*input, "length"), zero) {
                return Ok(c!("undefined"));
            }
            let first = c!("at", *input, zero);
            let bytes = if p!("lt", first, n!(0x80)) {
                one
            } else if p!("lt", first, n!(0xe0)) {
                two
            } else if p!("lt", first, n!(0xf0)) {
                n!(3)
            } else {
                n!(4)
            };
            if p!("lt", g!(*input, "length"), bytes) {
                return Ok(c!("undefined"));
            }
            return Ok(c!(
                "decoded",
                c!("utf8", c!("subarray", *input, zero, bytes)),
                bytes
            ));
        }
        ("navigation", [final_byte]) => {
            for (byte, name) in [
                ("A", "up"),
                ("B", "down"),
                ("C", "right"),
                ("D", "left"),
                ("H", "home"),
                ("F", "end"),
            ] {
                if host.is_kind(*final_byte, byte)? {
                    return host.string(name);
                }
            }
            return Ok(c!("undefined"));
        }
        ("control", [byte]) => {
            if p!("same", *byte, n!(13)) || p!("same", *byte, n!(10)) {
                return Ok(key!(t!("enter")));
            }
            if p!("same", *byte, n!(9)) {
                return Ok(key!(t!("tab")));
            }
            if p!("same", *byte, n!(127)) || p!("same", *byte, n!(8)) {
                return Ok(key!(t!("backspace")));
            }
            if p!("same", *byte, n!(32)) {
                return Ok(c!("character", t!(" "), no));
            }
            if p!("ge", *byte, one) && p!("le", *byte, n!(26)) {
                return Ok(c!(
                    "key",
                    c!("fromCharCode", c!("add", n!(96), *byte)),
                    yes,
                    no,
                    no
                ));
            }
            return Ok(key!(c!("controlName", *byte)));
        }
        ("csi", [sequence]) => {
            if p!("startsWith", *sequence, t!("\x1b[<"))
                && (p!("endsWith", *sequence, t!("M")) || p!("endsWith", *sequence, t!("m")))
            {
                let fields = c!("split", c!("slice", *sequence, n!(3), n!(-1)), t!(";"));
                let field = c!("at", fields, zero);
                if (host.is_kind(field, "64")? || kind!(c!("at", fields, zero), "65"))
                    && p!("same", g!(fields, "length"), n!(3))
                {
                    let direction = if kind!(c!("at", fields, zero), "64") {
                        t!("up")
                    } else {
                        t!("down")
                    };
                    let x = c!("subtract", c!("number", c!("at", fields, one)), one);
                    let y = c!("subtract", c!("number", c!("at", fields, two)), one);
                    return Ok(c!("wheel", direction, x, y));
                }
            }
            let final_byte = c!("stringAt", *sequence, n!(-1));
            let mut name = run(host, "navigation", &[final_byte])?;
            if host.is_undefined(name)? {
                let field = c!("slice", *sequence, two, n!(-1));
                for (value, label) in [
                    ("1", "home"),
                    ("3", "delete"),
                    ("4", "end"),
                    ("5", "pageup"),
                    ("6", "pagedown"),
                    ("7", "home"),
                    ("8", "end"),
                ] {
                    if host.is_kind(field, value)? {
                        name = t!(label);
                        break;
                    }
                }
            }
            if host.is_undefined(name)? {
                return Ok(name);
            }
            let parameters = c!("split", c!("slice", *sequence, two, n!(-1)), t!(";"));
            let modifier = if p!("gt", g!(parameters, "length"), one) {
                c!("number", c!("stringAt", parameters, n!(-1)))
            } else {
                one
            };
            let shift = p!("same", modifier, two)
                || p!("same", modifier, n!(4))
                || p!("same", modifier, n!(6))
                || p!("same", modifier, n!(8));
            let alt = p!("same", modifier, n!(3))
                || p!("same", modifier, n!(4))
                || p!("same", modifier, n!(7))
                || p!("same", modifier, n!(8));
            let ctrl = p!("same", modifier, n!(5))
                || p!("same", modifier, n!(6))
                || p!("same", modifier, n!(7))
                || p!("same", modifier, n!(8));
            return Ok(c!(
                "key",
                name,
                if ctrl { yes } else { no },
                if alt { yes } else { no },
                if shift { yes } else { no }
            ));
        }
        ("parse", [state]) => {
            let events = c!("array");
            while p!("gt", g!(g!(*state, "pending"), "length"), zero) {
                if p!("truthy", g!(*state, "paste")) {
                    let end = c!("pasteEnd", g!(*state, "pending"));
                    if p!("lt", end, zero) {
                        break;
                    }
                    c!("pushPaste", events, g!(*state, "pending"), end);
                    c!(
                        "setPending",
                        *state,
                        c!(
                            "suffix",
                            g!(*state, "pending"),
                            c!("add", end, c!("pasteEndLength"))
                        )
                    );
                    c!("setPaste", *state, no);
                    continue;
                }
                if p!("same", c!("at", g!(*state, "pending"), zero), n!(27)) {
                    if p!("everyEscape", g!(*state, "pending")) {
                        if p!("truthy", g!(*state, "escapeReady")) {
                            let count = g!(g!(*state, "pending"), "length");
                            c!("setPending", *state, c!("emptyBuffer"));
                            c!("setEscapeReady", *state, no);
                            let mut index = zero;
                            while p!("lt", index, count) {
                                c!("push", events, key!(t!("escape")));
                                index = c!("add", index, one);
                            }
                        } else {
                            run(host, "armTimer", &[*state])?;
                        }
                        break;
                    }
                    run(host, "clearTimer", &[*state])?;
                    if p!("pasteStart", g!(*state, "pending")) {
                        c!(
                            "setPending",
                            *state,
                            c!("suffix", g!(*state, "pending"), c!("pasteStartLength"))
                        );
                        c!("setPaste", *state, yes);
                        continue;
                    }
                    let alt_csi = p!("same", c!("at", g!(*state, "pending"), one), n!(27))
                        && p!("same", c!("at", g!(*state, "pending"), two), n!(91));
                    if p!("same", c!("at", g!(*state, "pending"), one), n!(91)) || alt_csi {
                        let offset = if alt_csi { one } else { zero };
                        let input = c!("suffix", g!(*state, "pending"), offset);
                        let mut end = two;
                        let mut found = false;
                        while p!("lt", end, g!(input, "length")) {
                            let byte = c!("at", input, end);
                            if p!("ge", byte, n!(0x40)) && p!("le", byte, n!(0x7e)) {
                                found = true;
                                break;
                            }
                            end = c!("add", end, one);
                        }
                        if !found {
                            break;
                        }
                        let sequence = c!(
                            "ascii",
                            c!(
                                "subarray",
                                g!(*state, "pending"),
                                offset,
                                c!("add", c!("add", offset, end), one)
                            )
                        );
                        c!(
                            "setPending",
                            *state,
                            c!(
                                "suffix",
                                g!(*state, "pending"),
                                c!("add", c!("add", offset, end), one)
                            )
                        );
                        let event = run(host, "csi", &[sequence])?;
                        if !host.is_undefined(event)? {
                            let event = if alt_csi && kind!(g!(event, "type"), "key") {
                                c!("withAlt", event)
                            } else {
                                event
                            };
                            c!("push", events, event);
                        }
                        continue;
                    }
                    if p!("same", c!("at", g!(*state, "pending"), one), n!(0x4f)) {
                        if p!("lt", g!(g!(*state, "pending"), "length"), n!(3)) {
                            break;
                        }
                        let final_byte = c!("fromCharCode", c!("at", g!(*state, "pending"), two));
                        let name = run(host, "navigation", &[final_byte])?;
                        c!(
                            "setPending",
                            *state,
                            c!("suffix", g!(*state, "pending"), n!(3))
                        );
                        if !host.is_undefined(name)? {
                            c!("push", events, key!(name));
                        }
                        continue;
                    }
                    if p!("same", c!("at", g!(*state, "pending"), one), n!(3)) {
                        c!(
                            "setPending",
                            *state,
                            c!("suffix", g!(*state, "pending"), one)
                        );
                        c!("push", events, key!(t!("escape")));
                        continue;
                    }
                    if p!("lt", c!("at", g!(*state, "pending"), one), n!(32))
                        || p!("same", c!("at", g!(*state, "pending"), one), n!(127))
                    {
                        let byte = c!("at", g!(*state, "pending"), one);
                        let event = run(host, "control", &[byte])?;
                        c!("push", events, c!("withAlt", event));
                        c!(
                            "setPending",
                            *state,
                            c!("suffix", g!(*state, "pending"), two)
                        );
                        continue;
                    }
                    let input = c!("suffix", g!(*state, "pending"), one);
                    let decoded = run(host, "decode", &[input])?;
                    if host.is_undefined(decoded)? {
                        break;
                    }
                    c!(
                        "setPending",
                        *state,
                        c!(
                            "suffix",
                            g!(*state, "pending"),
                            c!("add", one, g!(decoded, "bytes"))
                        )
                    );
                    c!("push", events, c!("character", g!(decoded, "ch"), yes));
                    continue;
                }
                let byte = c!("at", g!(*state, "pending"), zero);
                if p!("lt", byte, n!(32)) || p!("same", byte, n!(127)) {
                    c!(
                        "setPending",
                        *state,
                        c!("suffix", g!(*state, "pending"), one)
                    );
                    let event = run(host, "control", &[byte])?;
                    c!("push", events, event);
                    continue;
                }
                let pending = g!(*state, "pending");
                let decoded = run(host, "decode", &[pending])?;
                if host.is_undefined(decoded)? {
                    break;
                }
                c!(
                    "setPending",
                    *state,
                    c!("suffix", g!(*state, "pending"), g!(decoded, "bytes"))
                );
                c!("push", events, c!("character", g!(decoded, "ch"), no));
            }
            return Ok(events);
        }
        _ => return Ok(c!("invalidOperation")),
    }
    host.call("undefined", vec![])
}
