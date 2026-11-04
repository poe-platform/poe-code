use super::*;
use std::borrow::Cow;
use std::collections::VecDeque;
use std::fmt::Write;

const BUFFER: usize = 65536;
const INVALID: &str = "bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes";

struct Output<'a, 'b> {
    bytes: Vec<u8>,
    write: &'a mut CommandWriter<'b>,
    result: BuiltinOutcome,
    line_buffered: bool,
}

impl Output<'_, '_> {
    fn flush(&mut self) -> Result<(), String> {
        if !self.bytes.is_empty() {
            let ok = (self.write)(1, &bytes_to_stream_string(&self.bytes), &mut self.result);
            self.bytes.clear();
            if !ok { return Err(String::new()); }
        }
        Ok(())
    }

    fn piece(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty() { return Ok(()); }
        if self.line_buffered || bytes.len() > 16384 {
            self.flush()?;
            if !(self.write)(1, &bytes_to_stream_string(bytes), &mut self.result) { return Err(String::new()); }
        } else {
            if self.bytes.len() + bytes.len() > BUFFER { self.flush()?; }
            self.bytes.extend_from_slice(bytes);
        }
        Ok(())
    }
}

struct Records<'a> {
    label: &'a str,
    named: bool,
    delimiter: u8,
    number: usize,
    offset: usize,
    count: usize,
    covered: usize,
    after: usize,
    before: VecDeque<(usize, usize, Vec<u8>)>,
}

impl Records<'_> {
    fn prefix(&self, cfg: &GrepConfig, number: usize, offset: usize, sep: char) -> String {
        let mut s = String::new();
        if self.named { s.push_str(self.label); s.push(if cfg.null_delim { '\0' } else { sep }); }
        if cfg.line_number { let _ = write!(s, "{number}{sep}"); }
        if cfg.byte_offset { let _ = write!(s, "{offset}{sep}"); }
        if !s.is_empty() && cfg.initial_tab { s.push('\t'); }
        s
    }

    fn batch(&mut self, cfg: &GrepConfig, rx: &ZeroRegex, rows: &[Cow<[u8]>], end: bool, pooled: bool,
        group: &mut bool, selected: &mut bool, out: &mut Output) -> Result<bool, String> {
        if cfg.ignore_binary && rows.iter().any(|r| r.contains(&0)) { self.count = 0; return Ok(false); }
        if matches!(cfg.grep_input, GrepInput::Bounded(_)) && rows.iter().any(|r| r.contains(&0) || std::str::from_utf8(r).is_err()) {
            return Err(INVALID.into());
        }
        let limit = cfg.max_count.unwrap_or(usize::MAX);
        let display = !(cfg.count_only || cfg.files_without_match || cfg.files_with_matches || cfg.quiet);
        let context = display && (cfg.before_ctx != 0 || cfg.after_ctx != 0) && !(cfg.invert && cfg.only_matching);
        let mut spans = Vec::new();
        for line in rows {
            self.number += 1;
            let offset = self.offset;
            self.offset += line.len() + 1;
            spans.clear();
            let extract = display && cfg.only_matching && !cfg.invert;
            let found = self.count < limit && rx.scan(line, false, |a,b,_| {
                if extract && a < b { spans.push((a,b)); }
                extract
            }) != cfg.invert;
            if found {
                self.count += 1;
                *selected = true;
                if cfg.quiet || cfg.files_with_matches || cfg.files_without_match { return Ok(false); }
                if context {
                    let first = self.before.front().map_or(self.number, |r| r.0);
                    if *group && (self.covered == 0 || first > self.covered + 1) && let Some(sep) = &cfg.context_separator {
                        let mut sep = sep.as_bytes().to_vec();
                        sep.push(self.delimiter);
                        out.piece(&sep)?;
                    }
                    *group = true;
                    while let Some((n, off, prev)) = self.before.pop_front() {
                        if !cfg.only_matching {
                            out.piece(self.prefix(cfg, n, off, '-').as_bytes())?;
                            out.piece(&prev)?;
                            out.piece(&[self.delimiter])?;
                        }
                    }
                    self.covered = self.number;
                    self.after = cfg.after_ctx;
                }
                if display && cfg.only_matching {
                    for &(a,b) in &spans {
                        out.piece(self.prefix(cfg, self.number, offset + a, ':').as_bytes())?;
                        out.piece(&line[a..b])?;
                        out.piece(&[self.delimiter])?;
                    }
                } else if display {
                    if pooled && !(self.named || cfg.line_number || cfg.byte_offset || out.line_buffered)
                        && out.bytes.len() + line.len() < BUFFER {
                        out.bytes.extend_from_slice(line);
                        out.bytes.push(self.delimiter);
                    } else {
                        out.piece(self.prefix(cfg, self.number, offset, ':').as_bytes())?;
                        out.piece(line)?;
                        out.piece(&[self.delimiter])?;
                    }
                }
            } else if self.after > 0 {
                if !cfg.only_matching {
                    out.piece(self.prefix(cfg, self.number, offset, '-').as_bytes())?;
                    out.piece(line)?;
                    out.piece(&[self.delimiter])?;
                }
                self.covered = self.number;
                self.after -= 1;
            } else if context && cfg.before_ctx > 0 {
                if self.before.len() == cfg.before_ctx { self.before.pop_front(); }
                self.before.push_back((self.number, offset, line.to_vec()));
            }
            if self.count == limit && self.after == 0 { return Ok(false); }
        }
        if end || out.line_buffered || out.bytes.len() >= 8192 { out.flush()?; }
        Ok(true)
    }
}

pub(super) fn run(rx: ZeroRegex, targets: Vec<String>, mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs,
    cfg: &GrepConfig, line_buffered: bool, finite_input_quota: bool, write: &mut CommandWriter) -> BuiltinOutcome {
    let SearchFiles::Grep(files) = &cfg.files else { unreachable!() };
    let mut out = Output { bytes: Vec::new(), write, result: ok_out(""), line_buffered: line_buffered || cfg.only_matching };
    let mut failed = false;
    let mut selected = false;
    let mut group = false;
    let delimiter = if cfg.null_data { 0 } else { b'\n' };
    for input in files.inputs(&targets, cwd, fs) {
        let (label, path, explicit) = match input {
            SearchInput::Stdin => (cfg.stdin_label.as_deref().unwrap_or("(standard input)").to_owned(), None, true),
            SearchInput::File(name, path, explicit) => (name, Some(path), explicit),
            SearchInput::Error(e) => {
                failed = true;
                if !cfg.no_messages && !(out.write)(2, &e, &mut out.result) { break; }
                continue;
            }
        };
        let named = !cfg.no_filename && (cfg.with_filename || targets.len() > 1 || !explicit);
        let mut records = Records { label: &label, named, delimiter, count: 0, number: 0, offset: 0, covered: 0, after: 0, before: VecDeque::new() };
        let mut pending = Vec::new();
        let size = if cfg.max_count.is_some() || cfg.quiet || cfg.files_with_matches || cfg.files_without_match { 1 } else { 128 };
        let mut active = true;
        let mut batch_error = None;
        let mut scan = |chunk: &[u8]| {
            let mut batch = Vec::new();
            let mut length = 0;
            let mut pooled = pending.is_empty();
            let mut parts = chunk.split_inclusive(|&b| b == delimiter).peekable();
            while let Some(part) = parts.next() {
                let Some(line) = part.strip_suffix(&[delimiter]) else { pending.extend_from_slice(part); break };
                let row = if pending.is_empty() { Cow::Borrowed(line) } else {
                    pending.extend_from_slice(line); Cow::Owned(std::mem::take(&mut pending))
                };
                length += row.len();
                batch.push(row);
                let next = parts.peek().and_then(|p| p.strip_suffix(&[delimiter]));
                if batch.len() == size || length >= BUFFER || next.is_none_or(|r| length + r.len() > BUFFER) {
                    match records.batch(cfg, &rx, &batch, next.is_none(), pooled, &mut group, &mut selected, &mut out) {
                        Ok(true) => {}
                        Ok(false) => { active = false; return false; }
                        Err(e) => { batch_error = Some(e); return false; }
                    }
                    batch.clear(); length = 0; pooled = true;
                }
            }
            true
        };
        let read = if let Some(path) = path {
                (|| {
                    let memory = fs.supplies_single_chunk_input() && path != "/dev" && !path.starts_with("/dev/");
                    if cfg.max_count == Some(0) {
                        // An unbounded memory source is prepared eagerly, but read errors are
                        // only delivered when pulled. An empty operand fails during path lookup.
                        if memory && !finite_input_quota {
                            if path.is_empty() { return Err("ENOENT: no such file or directory ''".into()); }
                            let _ = fs.access_path(&path, true);
                        }
                        return Ok(());
                    }
                    let mut next = if memory {
                        if path.is_empty() { return Err("ENOENT: no such file or directory ''".into()); }
                        // The metered source queries capabilities before opening its byte stream.
                        if finite_input_quota { let _ = fs.access_path(&path, true); }
                        super::super::coreutils::record_chunks(fs, &path, path.clone())?
                    } else { super::super::coreutils::open_record_input(&path, "/", fs, false)? };
                    let mut bytes = Vec::new();
                    loop { next(&mut bytes)?; if bytes.is_empty() || !scan(&bytes) { return Ok(()); } }
                })()
            } else if cfg.max_count == Some(0) { Ok(()) } else { stdin.read_stdin(&mut scan) };
        let mut error = batch_error.or_else(|| read.err());
        if active && error.is_none() && !pending.is_empty() {
            error = records.batch(cfg, &rx, &[Cow::Owned(pending)], true, false, &mut group, &mut selected, &mut out).err();
        }
        if out.flush().is_err() { failed = true; break; }
        if let Some(e) = error {
            failed = true;
            if e.is_empty() { break; }
            if (!cfg.no_messages || e == INVALID) && !(out.write)(2, &format!("{}: {e}\n", files.name), &mut out.result) { break; }
            if e == INVALID { break; }
            continue;
        }
        if cfg.quiet {
            if records.count != 0 { out.result.exit_code = 0; return out.result; }
        } else if cfg.files_with_matches || cfg.files_without_match {
            if cfg.files_with_matches && records.count > 0 || cfg.files_without_match && records.count == 0 {
                let sep = if cfg.null_delim { '\0' } else { '\n' };
                if !(out.write)(1, &format!("{label}{sep}"), &mut out.result) { failed = true; break; }
            }
        } else if cfg.count_only {
            let mut s = String::new();
            if named { s.push_str(&label); s.push(if cfg.null_delim { '\0' } else { ':' }); }
            let _ = write!(s, "{}{}", records.count, delimiter as char);
            if !(out.write)(1, &s, &mut out.result) { failed = true; break; }
        }
    }
    out.result.exit_code = if failed { 2 } else { i32::from(!selected) };
    out.result
}
