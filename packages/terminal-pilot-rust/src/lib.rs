//! Portable terminal automation policies and display state.
pub mod buffer;
pub mod command;
pub mod names;
pub mod pty;
mod pty_spawn;
pub mod screen;
pub mod session;
pub fn strip_ansi(input: &[u16]) -> Vec<u16> {
    let mut result = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let code = input[i];
        let (kind, start) = if code == 0x1b {
            match input.get(i + 1).copied() {
                Some(0x5b) => (1, i + 2),
                Some(0x5d) => (2, i + 2),
                Some(0x50 | 0x58 | 0x5e | 0x5f) => (3, i + 2),
                _ => {
                    i = (i + 2).min(input.len());
                    continue;
                }
            }
        } else {
            match code {
                0x9b => (1, i + 1),
                0x9d => (2, i + 1),
                0x90 | 0x98 | 0x9e | 0x9f => (3, i + 1),
                _ => {
                    result.push(code);
                    i += 1;
                    continue;
                }
            }
        };
        i = start;
        while i < input.len() {
            let code = input[i];
            if kind == 1 && (0x40..=0x7e).contains(&code)
                || kind != 1 && (code == 0x9c || kind == 2 && code == 7)
            {
                i += 1;
                break;
            }
            if kind != 1 && code == 0x1b && input.get(i + 1) == Some(&0x5c) {
                i += 2;
                break;
            }
            i += 1;
        }
    }
    result
}
const NAMED_KEYS: [(&str, &str); 14] = [
    ("Enter", "\r"),
    ("Tab", "\t"),
    ("Escape", "\x1b"),
    ("Backspace", "\x7f"),
    ("Delete", "\x1b[3~"),
    ("ArrowUp", "\x1b[A"),
    ("ArrowDown", "\x1b[B"),
    ("ArrowRight", "\x1b[C"),
    ("ArrowLeft", "\x1b[D"),
    ("Home", "\x1b[H"),
    ("End", "\x1b[F"),
    ("PageUp", "\x1b[5~"),
    ("PageDown", "\x1b[6~"),
    ("Space", " "),
];
fn unknown(key: &[u16]) -> Vec<u16> {
    let mut error = "Unknown terminal key: ".encode_utf16().collect::<Vec<_>>();
    error.extend(key);
    error.extend(". Valid keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowRight, ArrowLeft, Home, End, PageUp, PageDown, Space, Control+<letter>, Alt+<key>".encode_utf16());
    error
}
fn ascii_matches(units: &[u16], name: &str) -> bool {
    units.len() == name.len()
        && units
            .iter()
            .zip(name.bytes())
            .all(|(a, b)| *a < 128 && (*a as u8).eq_ignore_ascii_case(&b))
}
pub fn key_sequence(key: &[u16]) -> Result<Vec<u16>, Vec<u16>> {
    let mut nested = key;
    let mut result = vec![];
    loop {
        if let Some((_, sequence)) = NAMED_KEYS
            .iter()
            .find(|(name, _)| ascii_matches(nested, name))
        {
            result.extend(sequence.encode_utf16());
            return Ok(result);
        }
        if nested.len() >= 8 && ascii_matches(&nested[..8], "control+") {
            let control = &nested[8..];
            if control.len() == 1
                && let Some(letter) =
                    char::from_u32(u32::from(control[0])).and_then(|c| c.to_uppercase().next())
                && letter.is_ascii_uppercase()
            {
                result.push(letter as u16 - 64);
                return Ok(result);
            }
            if result.is_empty() {
                let normalized = "Control+"
                    .encode_utf16()
                    .chain(control.iter().copied())
                    .collect::<Vec<_>>();
                return Err(unknown(&normalized));
            }
            return Err(unknown(key));
        }
        if nested.len() >= 4 && ascii_matches(&nested[..4], "alt+") {
            nested = &nested[4..];
            if nested.is_empty() {
                return Err(unknown(key));
            }
            result.push(0x1b);
            if nested.len() == 1 {
                result.extend(nested);
                return Ok(result);
            }
            continue;
        }
        if nested.len() == 1 {
            result.extend(nested);
            return Ok(result);
        }
        return Err(unknown(key));
    }
}
