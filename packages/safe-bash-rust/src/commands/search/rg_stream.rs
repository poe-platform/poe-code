use super::*;
use std::borrow::Cow;
use std::collections::VecDeque;

const BUFFER: usize = 64 * 1024;

struct Output<'a, 'b> {
    buffered: String,
    bytes: usize,
    write: &'a mut CommandWriter<'b>,
    result: BuiltinOutcome,
    writable: bool,
}

impl Output<'_, '_> {
    fn flush(&mut self) -> bool {
        if !self.buffered.is_empty() {
            self.writable = (self.write)(1, &self.buffered, &mut self.result);
            self.buffered.clear();
            self.bytes = 0;
        }
        self.writable
    }

    fn put(&mut self, text: &str) -> bool {
        let len = stream_byte_len(text);
        if self.bytes + len > BUFFER && !self.flush() { return false; }
        if len >= BUFFER {
            self.writable = (self.write)(1, text, &mut self.result);
        } else {
            self.bytes += len;
            self.buffered.push_str(text);
        }
        self.writable
    }
}

pub(super) fn lines(cfg: &GrepConfig, rx: &ZeroRegex, mut stdin: CommandInput, replacement: Option<&[RgReplacementPart]>,
    capture: bool, write: &mut CommandWriter) -> BuiltinOutcome {
    let mut out = Output { buffered: String::new(), bytes: 0, write, result: ok_out(""), writable: true };
    let term = if cfg.null_data { '\0' } else { '\n' };
    let detects_binary = !cfg.null_data && cfg.binary != RgBinary::Text;
    let delimiter = |&b: &u8| b == term as u8 || detects_binary && b == 0;
    let filename = cfg.with_filename && !cfg.no_filename;
    let limit = cfg.max_count.unwrap_or(usize::MAX);
    let (mut number, mut offset, mut count, mut after, mut last_printed) = (0, 0, 0, 0, 0);
    let mut before = VecDeque::<(Vec<u8>, Vec<(usize,usize)>, usize, usize)>::new();
    let mut pending = Vec::new();
    let mut binary_offset = None;
    let mut received = 0;
    let mut piece = String::new();
    let mut batch = |rows: &[Cow<[u8]>], terminated: bool, binary: Option<usize>| {
        let rx = cfg.ascii_record_rx.as_ref().filter(|_| rows.iter().all(|r| r.is_ascii() && !r.contains(&0))).unwrap_or(rx);
        for row in rows {
            number += 1;
            let base = offset;
            offset += row.len() + usize::from(terminated);
            let subject = if cfg.crlf { row.strip_suffix(b"\r").unwrap_or(row) } else { row };
            let mut replacements = BTreeMap::new();
            let spans = match_spans(rx, subject, base, !terminated, true, capture, replacement, &mut replacements);
            let selected = spans.is_empty() == cfg.invert || (cfg.invert && count >= limit && after != 0 && !terminated);
            if let Some(off) = binary {
                if count > 0 || selected {
                    count = count.max(1);
                    if out.put(&format!("{}binary file matches (found \"\\0\" byte around offset {off})\n", if filename { "<stdin>: " } else { "" })) { out.flush(); }
                    return false;
                }
                if cfg.before_ctx != 0 { return false; }
                continue;
            }
            let mut emit = |line: &[u8], spans: &[(usize,usize)], n: usize, off: usize, selected, ending| {
                if last_printed == 0 && cfg.heading && filename {
                    if !out.put(if cfg.null_delim { "<stdin>\0" } else { "<stdin>\n" }) { return false; }
                } else if last_printed != 0 && n > last_printed + 1 && (cfg.before_ctx != 0 || cfg.after_ctx != 0)
                    && let Some(sep) = &cfg.context_separator && !out.put(&format!("{sep}\n")) { return false; }
                last_printed = n;
                piece.clear();
                render_search_record(cfg, &mut piece, line, spans, off, n, ending, selected, (filename && !cfg.heading).then_some("<stdin>"),
                    true, replacement.is_some(), &replacements, term, |record| {
                        let ok = out.put(record);
                        record.clear();
                        ok
                    })
            };
            if selected && count < limit {
                count += 1;
                while let Some((prev, matches, n, off)) = before.pop_front() {
                    if !emit(&prev, &matches, n, off, false, 1) { return false; }
                }
                if !emit(row, &spans, number, base, true, usize::from(terminated)) { return false; }
                after = cfg.after_ctx;
            } else if after > 0 {
                if !emit(row, &spans, number, base, selected, usize::from(terminated)) { return false; }
                after -= 1;
            } else if cfg.before_ctx > 0 {
                if before.len() == cfg.before_ctx { before.pop_front(); }
                before.push_back((row.to_vec(), spans, number, base));
            }
            if count >= limit && after == 0 { out.flush(); return false; }
        }
        out.flush()
    };
    let read = stdin.read_stdin(|chunk| {
        if detects_binary && binary_offset.is_none() { binary_offset = chunk.iter().position(|&b| b == 0).map(|n| received + n); }
        received += chunk.len();
        let size = if cfg.max_count.is_some() || binary_offset.is_some() { 1 } else { 128 };
        let mut rows = Vec::new();
        let mut bytes = 0;
        let mut parts = chunk.split_inclusive(delimiter).peekable();
        while let Some(part) = parts.next() {
            if !part.last().is_some_and(delimiter) { pending.extend_from_slice(part); break; }
            let line = &part[..part.len()-1];
            let row = if pending.is_empty() { Cow::Borrowed(line) } else {
                pending.extend_from_slice(line); Cow::Owned(std::mem::take(&mut pending))
            };
            bytes += row.len();
            rows.push(row);
            if rows.len() == size || bytes >= BUFFER || parts.peek().is_none_or(|p| !p.last().is_some_and(delimiter) || bytes + p.len() - 1 > BUFFER) {
                if !batch(&rows, true, binary_offset) { return false; }
                rows.clear(); bytes = 0;
            }
        }
        true
    });
    if read.is_ok() && !pending.is_empty() { batch(&[Cow::Owned(pending)], false, binary_offset); }
    if !out.writable { out.result.exit_code = 2; }
    else if let Err(e) = read {
        if !cfg.no_messages { (out.write)(2, &format!("rg: {e}\n"), &mut out.result); }
        out.result.exit_code = 2;
    } else { out.result.exit_code = i32::from(count == 0); }
    out.result
}
