use super::ZeroRegex;

pub(super) fn replace(text: &str, rx: &ZeroRegex, replacement: &str) -> String {
    let mut out = String::new();
    let mut copied = 0;
    let mut previous_end = None;
    rx.scan(
        text.as_bytes(),
        replacement.contains('$'),
        |start, end, caps| {
            // Go ignores empty matches immediately following an earlier match.
            if start == end && previous_end == Some(start) {
                return true;
            }
            out.push_str(&text[copied..start]);
            let mut source = replacement;
            while let Some((literal, rest)) = source.split_once('$') {
                out.push_str(literal);
                if let Some(tail) = rest.strip_prefix('$') {
                    out.push('$');
                    source = tail;
                    continue;
                }
                let braced = rest.starts_with('{');
                let key = if braced { &rest[1..] } else { rest };
                let len = key
                    .find(|c: char| c != '_' && !c.is_alphanumeric())
                    .unwrap_or(key.len());
                if len == 0 || (braced && !key[len..].starts_with('}')) {
                    out.push('$');
                    source = rest;
                    continue;
                }
                source = &key[len + usize::from(braced)..];
                let name = &key[..len];
                let number = if name.len() > 1 && name.starts_with('0') {
                    None
                } else {
                    name.parse::<usize>().ok()
                };
                let span = match number {
                    Some(0) => Some((start, end)),
                    Some(i) => caps.get(i - 1).copied().flatten(),
                    None => rx.capture_names.iter().find_map(|(capture, i)| {
                        (capture == name)
                            .then(|| caps.get(*i).copied().flatten())
                            .flatten()
                    }),
                };
                if let Some((a, b)) = span {
                    out.push_str(&text[a..b]);
                }
            }
            out.push_str(source);
            copied = end;
            previous_end = Some(end);
            true
        },
    );
    out.push_str(&text[copied..]);
    out
}
