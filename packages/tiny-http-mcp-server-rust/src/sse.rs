//! Format SSE using UTF-16 units so JavaScript strings retain lone surrogates.
pub fn format_event(data: &[u16], id: Option<&[u16]>, event: Option<&[u16]>) -> Vec<u16> {
    let mut out = Vec::new();
    for (prefix, value) in [("id: ", id), ("event: ", event)] {
        if let Some(value) = value {
            out.extend(prefix.encode_utf16());
            out.extend(value);
            out.push(10)
        }
    }
    out.extend("data: ".encode_utf16());
    let mut cursor = 0;
    while cursor < data.len() {
        let unit = data[cursor];
        cursor += 1;
        if unit == 13 || unit == 10 {
            if unit == 13 && data.get(cursor) == Some(&10) {
                cursor += 1
            }
            out.extend("\ndata: ".encode_utf16())
        } else {
            out.push(unit)
        }
    }
    out.extend("\n\n".encode_utf16());
    out
}
