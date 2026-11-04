use super::*;
use std::borrow::Cow;
use std::collections::VecDeque;

const BUFFER: usize = 64 * 1024;

pub(super) struct Output<'a, 'b> {
    buffered: String,
    bytes: usize,
    pub(super) total: usize,
    write: &'a mut CommandWriter<'b>,
    pub(super) result: BuiltinOutcome,
    pub(super) writable: bool,
}

impl<'a, 'b> Output<'a, 'b> {
    pub(super) fn new(write: &'a mut CommandWriter<'b>) -> Self {
        Self { buffered: String::new(), bytes: 0, total: 0, write, result: ok_out(""), writable: true }
    }

    pub(super) fn flush(&mut self) -> bool {
        if !self.buffered.is_empty() {
            self.writable = (self.write)(1, &self.buffered, &mut self.result);
            self.buffered.clear();
            self.bytes = 0;
        }
        self.writable
    }

    pub(super) fn report(&mut self, message: &str, silent: bool) {
        if self.flush() && !silent { self.writable = (self.write)(2, message, &mut self.result); }
    }

    pub(super) fn put(&mut self, text: &str) -> bool {
        let len = stream_byte_len(text);
        self.total += len;
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

#[allow(clippy::too_many_arguments)]
pub(super) fn lines(cfg: &GrepConfig, rx: &ZeroRegex, inputs: impl Iterator<Item = SearchInput>, multiple_files: bool,
    mut stdin: CommandInput, fs: &dyn SafeBashFs, cwd: &str, replacement: Option<&[RgReplacementPart]>,
    capture: bool, write: &mut CommandWriter) -> BuiltinOutcome {
    let mut out = Output::new(write);
    let term = if cfg.null_data { '\0' } else { '\n' };
    let detects_binary = !cfg.null_data && cfg.binary != RgBinary::Text;
    let delimiter = |&b: &u8| b == term as u8 || detects_binary && b == 0;
    let limit = cfg.max_count.unwrap_or(usize::MAX);
    let display = !cfg.quiet && !(cfg.count_only || cfg.files_with_matches || cfg.files_without_match);
    let mut headings = std::collections::BTreeSet::new();
    let mut previous_label = String::new();
    let mut previous_line = 0;
    let (mut searches, mut matched_files, mut matched_lines, mut total_matches, mut total_searched, mut total_printed) = (0,0,0,0,0,0);
    let (mut found, mut failed) = (false, false);
    for input in inputs {
        let (label, path, explicit) = match input {
            SearchInput::Stdin => ("<stdin>".to_owned(), None, true),
            SearchInput::File(label, path, explicit) => (label, Some(path), explicit),
            SearchInput::Error(e) => {
                failed = true; out.report(&e, cfg.no_messages);
                if !out.writable { break; }
                continue;
            }
        };
        let filename = !cfg.no_filename && (cfg.with_filename || multiple_files || !explicit);
        let escaped = if cfg.json_output { json_escape_str(&label) } else { String::new() };
        let fast = !display && !cfg.json_output && cfg.before_ctx == 0 && cfg.after_ctx == 0
            && path.as_deref().is_some_and(|p| p != "/dev" && !p.starts_with("/dev/") && fs.indexed_directory_entry(&search_path(cwd, &label)) == Some(true));
        let output_start = out.total;
        let (mut number, mut offset, mut count, mut after, mut last_printed) = (0, 0, 0, 0, 0);
        let (mut matches, mut searched, mut last_selected_end) = (0, 0, 0);
        let mut before = VecDeque::<(Vec<u8>, Vec<(usize,usize)>, usize, usize)>::new();
        let mut pending = Vec::new();
        let mut binary_offset = None;
        let mut received = 0;
        let mut skipped = false;
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
                searched = offset;
                let inverted_tail = cfg.invert && count >= limit && after != 0 && !terminated;
                let selected = spans.is_empty() == cfg.invert || inverted_tail;
                if selected { last_selected_end = offset; }
                if let Some(off) = binary.filter(|_| display && !cfg.json_output) {
                    if count > 0 || selected {
                        if count == 0 { count = 1; if !cfg.invert { matches += spans.len(); } }
                        out.put(&format!("{}binary file matches (found \"\\0\" byte around offset {off})\n", if filename { format!("{label}: ") } else { String::new() }));
                        return false;
                    }
                    if cfg.before_ctx != 0 { return false; }
                    continue;
                }
                let mut emit = |line: &[u8], spans: &[(usize,usize)], n: usize, off: usize, selected, ending| {
                    if cfg.json_output {
                        if cfg.quiet { return true; }
                        if last_printed == 0 && !out.put(&rg_json_begin(&escaped)) { return false; }
                        last_printed = n;
                        return out.put(&rg_json_record(&escaped, line, (ending != 0).then_some(term as u8), n, off, selected, spans));
                    }
                    if cfg.heading && filename && !headings.contains(&label) {
                        if !headings.is_empty() && !out.put("\n") { return false; }
                        if !out.put(&format!("{label}{}", if cfg.null_delim { '\0' } else { '\n' })) { return false; }
                        headings.insert(label.clone());
                    } else if previous_line != 0 && (previous_label != label || n > previous_line + 1) && (cfg.before_ctx != 0 || cfg.after_ctx != 0)
                        && let Some(sep) = &cfg.context_separator && !out.put(&format!("{sep}\n")) { return false; }
                    last_printed = n;
                    if cfg.before_ctx != 0 || cfg.after_ctx != 0 {
                        if previous_label != label { previous_label.clone_from(&label); }
                        previous_line = n;
                    }
                    piece.clear();
                    render_search_record(cfg, &mut piece, line, spans, off, n, ending, selected, (filename && !cfg.heading).then_some(label.as_str()),
                        true, replacement.is_some(), &replacements, term, |record| {
                            let ok = out.put(record);
                            record.clear();
                            ok
                        })
                };
                if selected && count < limit {
                    count += 1;
                    if !cfg.invert { matches += spans.len(); }
                    if !cfg.stats && (cfg.quiet && !cfg.json_output || cfg.files_with_matches || cfg.files_without_match) { return false; }
                    if display {
                        while let Some((prev, matches, n, off)) = before.pop_front() {
                            if !emit(&prev, &matches, n, off, false, 1) { return false; }
                        }
                        if !emit(row, &spans, number, base, true, usize::from(terminated)) { return false; }
                        after = cfg.after_ctx;
                    }
                } else if after > 0 {
                    if selected {
                        count += 1;
                        if !cfg.invert || inverted_tail { matches += spans.len(); }
                    }
                    if !emit(row, &spans, number, base, selected, usize::from(terminated)) { return false; }
                    after -= 1;
                } else if cfg.before_ctx > 0 && display {
                    if before.len() == cfg.before_ctx { before.pop_front(); }
                    before.push_back((row.to_vec(), spans, number, base));
                }
                if count >= limit && after == 0 {
                    searched = last_selected_end.max(if cfg.invert || !terminated { base } else { 0 });
                    return false;
                }
            }
            fast || out.flush()
        };
        let mut consume = |chunk: &[u8]| {
            if detects_binary && binary_offset.is_none() { binary_offset = chunk.iter().position(|&b| b == 0).map(|n| received + n); }
            if binary_offset.is_some() && !explicit && cfg.binary == RgBinary::Auto { skipped = true; return false; }
            received += chunk.len();
            let size = if cfg.max_count.is_some() || cfg.quiet && !cfg.json_output || cfg.files_with_matches || cfg.files_without_match || binary_offset.is_some() && display && !cfg.json_output { 1 } else { 128 };
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
        };
        let read = if let Some(path) = &path {
            if fast {
                read_memory_search_file(fs, path).map(|bytes| { consume(&bytes); })
                    .map_err(|e| super::super::coreutils::stream_file_error(e, "readFile", &search_path(cwd, &label)))
            } else {
                (|| {
                    let mut reader = super::super::coreutils::record_chunks(fs, path, search_path(cwd, &label))?;
                    let mut chunk = Vec::new();
                    loop { reader(&mut chunk)?; if chunk.is_empty() || !consume(&chunk) { return Ok(()); } }
                })()
            }
        } else { stdin.read_stdin(consume) };
        if read.is_ok() && !skipped && !pending.is_empty() { batch(&[Cow::Owned(pending)], false, binary_offset); }
        if !out.writable { break; }
        if let Err(e) = read {
            failed = true; out.report(&format!("rg: {e}\n"), cfg.no_messages);
            if !out.writable { break; }
            continue;
        }
        searches += 1;
        let matched = count != 0;
        let select_file = if cfg.files_without_match { !matched && !skipped } else { matched };
        found |= select_file;
        matched_files += usize::from(matched);
        matched_lines += count;
        total_matches += matches;
        total_searched += searched;
        let printed = if display { out.total - output_start } else { 0 };
        total_printed += printed;
        if cfg.json_output && last_printed != 0 {
            out.put(&rg_json_end(&escaped, binary_offset, searched, printed, count, matches));
        } else if !cfg.quiet {
            if (cfg.files_with_matches || cfg.files_without_match) && select_file {
                out.put(&format!("{label}{}", if cfg.null_delim { '\0' } else { '\n' }));
            } else if cfg.count_only && (matched || cfg.include_zero) && !skipped {
                let amount = if !cfg.invert && (cfg.only_matching || cfg.count_matches) { matches } else { count };
                let prefix = if filename { format!("{label}{}", if cfg.null_delim { '\0' } else { ':' }) } else { String::new() };
                out.put(&format!("{prefix}{amount}\n"));
            }
        }
        if !out.writable || cfg.quiet && found && !cfg.json_output && !cfg.stats { break; }
    }
    if out.writable {
        if cfg.json_output {
            out.put(&rg_json_summary(total_printed, total_searched, matched_lines, total_matches, searches, matched_files));
        } else if cfg.stats {
            out.put(&rg_stats(total_matches, matched_lines, matched_files, searches, total_printed, total_searched));
        }
        if out.writable { out.flush(); }
    }
    out.result.exit_code = if !out.writable || failed && !(cfg.quiet && found) { 2 } else { i32::from(!found) };
    out.result
}
