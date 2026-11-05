use std::fmt::Write;

// fmt has a fixed diagnostic profile; using the host's Unicode version would
// change which bytes it escapes. Boundaries are [start, end) in pairs.
use super::fmt_printable::BOUNDARIES;

fn units(mut bytes: &[u8], unicode: bool) -> impl Iterator<Item = (&[u8], Option<char>)> {
    std::iter::from_fn(move || {
        let &first = bytes.first()?;
        let width = match first {
            0xc2..=0xdf if unicode => 2,
            0xe0..=0xef if unicode => 3,
            0xf0..=0xf4 if unicode => 4,
            _ => 1,
        };
        let ch = bytes
            .get(..width)
            .and_then(|b| std::str::from_utf8(b).ok())
            .and_then(|s| s.chars().next());
        let (unit, rest) = bytes.split_at(if ch.is_some() { width } else { 1 });
        bytes = rest;
        Some((unit, ch))
    })
}

pub(in crate::commands) fn filename(text: &str, unicode: bool) -> String {
    let bytes = crate::vfs::stream_string_to_bytes(text);
    let bare = !bytes.is_empty() && !matches!(bytes.as_slice(), b"{" | b"}")
        && !matches!(bytes[0], b'#' | b'~') && units(&bytes, unicode).all(|(_, ch)| ch.is_some_and(|c|
            if c.is_ascii() { !c.is_ascii_control() && !r#" !"'$&()*:;<=>?[\^`|"#.contains(c) }
            else { BOUNDARIES.partition_point(|&start| start <= c as u32) % 2 == 1 }
        ));
    if bare { text.to_string() } else { quote(text, true, unicode) }
}

pub(in crate::commands) fn quote(text: &str, shell: bool, unicode: bool) -> String {
    let bytes = crate::vfs::stream_string_to_bytes(text);
    let printable = |ch: Option<char>| {
        ch.is_some_and(|c| {
            if c.is_ascii() {
                !c.is_ascii_control()
            } else {
                BOUNDARIES.partition_point(|&start| start <= c as u32) % 2 == 1
            }
        })
    };
    let apostrophe = shell && bytes.contains(&39);
    if apostrophe
        && units(&bytes, unicode).enumerate().all(|(i, (_, c))| {
            printable(c)
                && !r#"!"$&()*;<=>?[^`|\{}"#.contains(c.unwrap())
                && (i == 0 || !matches!(c, Some('#' | '~')))
        })
    {
        return format!("\"{text}\"");
    }
    let (left, right) = if !shell && unicode {
        ('‘', '’')
    } else {
        ('\'', '\'')
    };
    let mut out = left.to_string();
    let mut escaping = apostrophe
        && units(&bytes, unicode)
            .last()
            .is_some_and(|(_, c)| !printable(c));
    for (unit, c) in units(&bytes, unicode) {
        if shell && c == Some('\'') {
            out.push_str("'\\''");
            escaping = false;
        } else if !printable(c) {
            if shell && !escaping {
                out.push_str("'$'");
            }
            escaping = true;
            let escape = match unit {
                [7] => "a",
                [8] => "b",
                [9] => "t",
                [10] => "n",
                [11] => "v",
                [12] => "f",
                [13] => "r",
                _ => "",
            };
            if escape.is_empty() {
                for b in unit {
                    write!(out, "\\{b:03o}").unwrap();
                }
            } else {
                out.push('\\');
                out.push_str(escape);
            }
        } else {
            if shell && escaping {
                out.push_str("''");
            }
            escaping = false;
            let c = c.unwrap();
            if !shell && (c == right || c == '\\') {
                out.push('\\');
            }
            out.push(c);
        }
    }
    out.push(right);
    crate::vfs::bytes_to_stream_string(out.as_bytes())
}
