use super::ZeroRegex;

pub(super) fn replace(text: &str, rx: &ZeroRegex, replacement: &str) -> String {
    let mut out = String::new();
    let mut copied = 0;
    let mut matched = false;
    rx.scan(
        text.as_bytes(),
        replacement.contains('$'),
        |start, end, caps| {
            // Go ignores empty matches immediately following another match.
            if matched && start == end && start == copied {
                return true;
            }
            out.push_str(&text[copied..start]);
            let mut rest = replacement;
            while let Some(dollar) = rest.find('$') {
                out.push_str(&rest[..dollar]);
                rest = &rest[dollar + 1..];
                if let Some(tail) = rest.strip_prefix('$') {
                    out.push('$');
                    rest = tail;
                    continue;
                }
                let braced = rest.starts_with('{');
                let name_start = usize::from(braced);
                let name_end = rest[name_start..]
                    .char_indices()
                    .find(|(_, ch)| !ch.is_alphanumeric() && *ch != '_')
                    .map_or(rest.len(), |(i, _)| name_start + i);
                if name_start == name_end || braced && !rest[name_end..].starts_with('}') {
                    out.push('$');
                    continue;
                }
                let name = &rest[name_start..name_end];
                let capture = if name == "0" {
                    Some((start, end))
                } else {
                    let index = if name.bytes().all(|ch| ch.is_ascii_digit()) {
                        if name.starts_with('0') {
                            None
                        } else {
                            name.parse::<usize>().ok().and_then(|n| n.checked_sub(1))
                        }
                    } else {
                        rx.capture_names
                            .iter()
                            .find(|(n, _)| n == name)
                            .map(|(_, i)| *i)
                    };
                    index.and_then(|i| caps.get(i).copied().flatten())
                };
                if let Some((lo, hi)) = capture {
                    out.push_str(&text[lo..hi]);
                }
                rest = &rest[name_end + usize::from(braced)..];
            }
            out.push_str(rest);
            copied = end;
            matched = true;
            true
        },
    );
    out.push_str(&text[copied..]);
    out
}
