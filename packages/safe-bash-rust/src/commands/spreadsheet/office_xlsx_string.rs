#[cfg(test)]
use std::fmt::Write;

fn code(source: &str) -> Option<u16> {
    let token = source.as_bytes().get(..7)?;
    if token[0] != b'_'
        || !token[1].eq_ignore_ascii_case(&b'x')
        || token[6] != b'_'
        || !token[2..6].iter().all(u8::is_ascii_hexdigit)
    {
        return None;
    }
    u16::from_str_radix(&source[2..6], 16).ok()
}

#[cfg(test)]
pub(super) fn encode(mut source: &str, work: &mut usize) -> Option<String> {
    let mut output = String::new();
    while !source.is_empty() {
        if let Some(value) = code(source) {
            *work = work.checked_sub(13)?;
            // Calc recognizes an already escaped underscore followed by a
            // complete token, including the shared underscore between them.
            let end = if value == 0x5f && code(&source[6..]).is_some() {
                output.push_str(&source[..13]);
                13
            } else {
                output.push_str("_x005F_");
                output.push_str(&source[1..7]);
                7
            };
            source = &source[end..];
        } else {
            let c = source.chars().next().unwrap();
            if c < ' ' && !matches!(c, '\t' | '\n' | '\r') || matches!(c, '\u{fffe}' | '\u{ffff}') {
                *work = work.checked_sub(7)?;
                write!(output, "_x{:04x}_", c as u32).unwrap();
            } else {
                *work = work.checked_sub(c.len_utf8())?;
                output.push(c);
            }
            source = &source[c.len_utf8()..];
        }
    }
    Some(output)
}

pub(super) fn decode(mut source: &str) -> String {
    if !source.contains("_x") {
        return source.into();
    }
    let mut units = Vec::new();
    while !source.is_empty() {
        // Unlike export, import recognizes only a lowercase 'x'. The editable
        // workbook also decodes formulas and cached strings; Calc conversion
        // intentionally retains those raw strings.
        if source.starts_with("_x")
            && let Some(value) = code(source)
        {
            units.push(value);
            source = &source[7..];
        } else {
            let c = source.chars().next().unwrap();
            units.extend_from_slice(c.encode_utf16(&mut [0; 2]));
            source = &source[c.len_utf8()..];
        }
    }
    // Calc drops isolated surrogate units while retaining valid pairs.
    char::decode_utf16(units).filter_map(Result::ok).collect()
}
