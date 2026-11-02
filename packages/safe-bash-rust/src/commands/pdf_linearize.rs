// The fixed-width fields allow offsets to be filled in after the xref has been written.
use super::super::{Cursor, Value};
use super::{INVALID, TOO_LARGE, write_xref};
use crate::commands::codecs::zlib_compress;
use std::io::Write;

pub(in super::super) fn finish_classic(
    out: Vec<u8>,
    mut rows: Vec<(u8, usize, usize)>,
    trailer: &[u8],
    root: usize,
    limit: usize,
) -> Result<Vec<u8>, String> {
    // A textual match is only a fast negative: a string or stream containing
    // /Linearized does not make the document linearized.
    if !out.windows(11).any(|w| w == b"/Linearized") {
        return write_xref(out, rows, trailer, limit);
    }
    let mut spans = vec![0..0; rows.len()];
    let mut end = out.len();
    for (i, &(ty, start, _)) in rows.iter().enumerate().rev() {
        if ty == 1 {
            spans[i] = start..end;
            end = start;
        }
    }
    let mut marker = None;
    let mut hint = None;
    let mut page = None;
    let mut count = 0;
    let mut tokens = 1_000_000;
    for (id, span) in spans.iter().enumerate().filter(|(_, s)| !s.is_empty()) {
        let mut c = Cursor(&out[span.clone()]);
        c.object_header().ok_or(INVALID)?;
        let v = c.value(0, &mut tokens, false).ok_or(INVALID)?;
        c.skip();
        let stream = c.0.starts_with(b"stream");
        if !stream && v.get(b"Linearized").is_some() {
            marker.get_or_insert(id);
        }
        match (stream, v.get(b"Type").and_then(Value::word)) {
            (true, Some(b"/Hint")) => {
                hint.get_or_insert(id);
            }
            (false, Some(b"/Page")) => {
                page.get_or_insert(id);
                count += 1;
            }
            _ => (),
        }
    }
    let Some(marker) = marker else {
        return write_xref(out, rows, trailer, limit);
    };
    let page = page.unwrap_or(root);
    let hint = hint.unwrap_or(rows.len());
    let dictionary = |len, hs, hl, pe, xr| {
        format!(
            "<<\n/Linearized 1\n/L {len:010}\n/H [ {hs:010} {hl:010} ]\n/O {page}\n/E {pe:010}\n/N {}\n/T {xr:010}\n>>",
            count.max(1)
        )
    };
    let mut sorted = out[..end].to_vec();
    rows[marker].1 = sorted.len();
    writeln!(sorted, "{marker} {} obj", rows[marker].2).unwrap();
    let patch_at = sorted.len();
    sorted.extend_from_slice(dictionary(0, 0, 0, 0, 0).as_bytes());
    sorted.extend_from_slice(b"\nendobj\n\n");
    let mut page_end = sorted.len();
    let hint_start = sorted.len();
    if hint == rows.len() {
        rows.push((1, hint_start, 0));
        let payload = zlib_compress(&[0; 64]);
        write!(
            sorted,
            "{hint} 0 obj\n<<\n/Type /Hint\n/S 32\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            payload.len()
        )
        .unwrap();
        sorted.extend_from_slice(&payload);
        sorted.extend_from_slice(b"\nendstream\nendobj\n\n");
    } else {
        rows[hint].1 = hint_start;
        sorted.extend_from_slice(&out[spans[hint].clone()]);
    }
    let hint_len = sorted.len() - hint_start;
    if page == hint {
        page_end = sorted.len();
    }
    for id in [root, page].into_iter().chain(1..spans.len()) {
        if id == hint || id == marker || spans[id].is_empty() {
            continue;
        }
        rows[id].1 = sorted.len();
        let span = std::mem::take(&mut spans[id]);
        if span.len() > limit.saturating_sub(sorted.len()) {
            return Err(TOO_LARGE.into());
        }
        sorted.extend_from_slice(&out[span]);
        if id == page {
            page_end = sorted.len();
        }
    }
    let xref = sorted.len();
    let mut sorted = write_xref(sorted, rows, trailer, limit)?;
    let patched = dictionary(sorted.len(), hint_start, hint_len, page_end, xref);
    sorted[patch_at..patch_at + patched.len()].copy_from_slice(patched.as_bytes());
    Ok(sorted)
}
