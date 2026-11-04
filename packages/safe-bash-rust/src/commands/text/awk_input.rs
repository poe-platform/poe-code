use super::{AwkState, is_valid_awk_ident, Scalar, unescape_sed_text};
use crate::vfs::{ChunkReader, bytes_to_stream_string};

enum Source<'a> {
    Stdin,
    File(ChunkReader<'a>),
    Named(String),
    Getline(String),
    Buffered,
}

pub(super) struct Reader<'a> {
    source: Source<'a>,
    chunk: Vec<u8>,
    at: usize,
}

impl<'a> Reader<'a> {
    fn record(&mut self, rs: Option<u8>, stdin: &mut super::super::CommandInput, output: &mut super::AwkOutput, fs: &'a dyn super::SafeBashFs) -> Result<Option<String>, String> {
        let mut partial = Vec::new();
        let mut newlines = 0;
        loop {
            if self.at == self.chunk.len() {
                if !matches!(self.source, Source::Buffered) && !output.flush() { return Err(String::new()); }
                match &mut self.source {
                    Source::Stdin => stdin.next_stdin_chunk(&mut self.chunk)?,
                    Source::Getline(path) => {
                        let entry = fs.access_path(path, true)
                            .map_err(|e| super::super::coreutils::stream_file_error(e, "readStream", path))?;
                        let mut next = fs.open_chunks(&entry)
                            .map_err(|e| super::super::coreutils::stream_file_error(e, "readStream", path))?;
                        next(&mut self.chunk).map_err(|e| super::super::coreutils::stream_file_error(e, "readStream", path))?;
                        self.source = Source::File(next);
                    }
                    Source::Named(path) => {
                        let mut next = if fs.supplies_single_chunk_input() && path != "/dev" && !path.starts_with("/dev/") {
                            super::super::coreutils::record_chunks(fs, path, path.clone())?
                        } else {
                            super::super::coreutils::open_record_input(path, "/", fs, false)?
                        };
                        next(&mut self.chunk)?;
                        self.source = Source::File(next);
                    }
                    Source::File(next) => next(&mut self.chunk)?,
                    Source::Buffered => self.chunk.clear(),
                }
                self.at = 0;
                if self.chunk.is_empty() {
                    self.source = Source::Buffered;
                    if partial.is_empty() { return Ok(None); }
                    if rs.is_none() { partial.truncate(partial.len() - newlines); }
                    return Ok(Some(bytes_to_stream_string(&partial)));
                }
            }
            let rest = &self.chunk[self.at..];
            if let Some(sep) = rs {
                if let Some(n) = rest.iter().position(|&b| b == sep) {
                    self.at += n + 1;
                    if partial.is_empty() { return Ok(Some(bytes_to_stream_string(&rest[..n]))); }
                    partial.extend_from_slice(&rest[..n]);
                    return Ok(Some(bytes_to_stream_string(&partial)));
                }
                partial.extend_from_slice(rest);
                self.at = self.chunk.len();
            } else {
                for &b in rest {
                    if b != b'\n' && newlines >= 2 {
                        partial.truncate(partial.len() - newlines);
                        return Ok(Some(bytes_to_stream_string(&partial)));
                    }
                    self.at += 1;
                    if partial.is_empty() && b == b'\n' { continue; }
                    newlines = if b == b'\n' { newlines + 1 } else { 0 };
                    partial.push(b);
                }
            }
        }
    }
}

impl AwkState<'_> {
    pub(super) fn read_getline_from_file(&mut self, name: &str, into_var: Option<&str>) -> Scalar {
        if name.is_empty() {
            self.runtime_err = Some("awk: getline requires a nonempty filename\n".into());
            return Scalar::Number(-1.0);
        }
        if name.contains('\0') {
            self.set_var("ERRNO", Scalar::Text(format!("EINVAL: invalid argument '{name}'")));
            return Scalar::Number(-1.0);
        }
        let rs = crate::vfs::stream_string_to_bytes(&self.rs);
        if rs.len() > 1 {
            self.runtime_err = Some("awk: RS must be one byte or empty for paragraph records\n".into());
            return Scalar::Number(-1.0);
        }
        let path = crate::vfs::path::absolute_operand(&self.cwd, name);
        let stdin = matches!(name, "-" | "/dev/stdin");
        let reader = self.getline_files.entry(path.clone()).or_insert_with(|| Reader {
            source: if stdin { Source::Stdin } else { Source::Getline(path.clone()) },
            chunk: Vec::new(), at: 0,
        });
        match reader.record(rs.first().copied(), &mut self.stdin, &mut self.output, self.vfs) {
            Ok(Some(line)) => {
                if let Some(var) = into_var { self.set_var(var, Scalar::input(line)); } else { self.set_line(&line); }
                Scalar::Number(1.0)
            }
            Ok(None) => Scalar::Number(0.0),
            Err(e) => {
                self.getline_files.remove(&path);
                if e.is_empty() || stdin {
                    self.runtime_err = Some(if e.is_empty() { e } else { format!("awk: {e}\n") });
                    self.error_status = 1;
                } else {
                    self.set_var("ERRNO", Scalar::Text(e));
                }
                Scalar::Number(-1.0)
            }
        }
    }

    pub(super) fn read_main(&mut self, mut record_phase_start: bool) -> Option<String> {
        loop {
            if self.reader.is_none() {
                let name = loop {
                    if self.argument as f64 >= self.get_var("ARGC").number() {
                        if self.saw_file { return None; }
                        break "-".to_owned();
                    }
                    let next = self.arrays.get("ARGV").and_then(|a| a.get(&self.argument.to_string())).cloned().unwrap_or_default();
                    let next = self.formatted(next.text(Some(&self.convfmt)));
                    self.argument += 1;
                    if next.is_empty() { continue; }
                    if self.operand_assignments && let Some((k,v)) = next.split_once('=') && is_valid_awk_ident(k) {
                        self.set_var(k, Scalar::input(unescape_sed_text(v)));
                        continue;
                    }
                    break next;
                };
                self.saw_file = true;
                let path = crate::vfs::path::absolute_operand(&self.cwd, &name);
                let reader = if name == "-" || name == "/dev/stdin" {
                    Ok(Reader { source: Source::Stdin, chunk: Vec::new(), at: 0 })
                } else if (record_phase_start || !self.finite_input_quota) && self.vfs.supplies_single_chunk_input() && path != "/dev" && !path.starts_with("/dev/") {
                    self.vfs.read_single_chunk_input(&path, None)
                        .map(|chunk| Reader { source: Source::Buffered, chunk, at: 0 })
                        .map_err(|e| super::super::coreutils::stream_file_error(e, "readStream", &path))
                } else {
                    Ok(Reader { source: Source::Named(path), chunk: Vec::new(), at: 0 })
                };
                match reader {
                    Ok(reader) => self.reader = Some(reader),
                    Err(e) => { self.runtime_err = Some(format!("awk: {e}\n")); self.error_status = 1; return None; }
                }
                self.set_var("FILENAME", Scalar::Text(name));
                self.fnr = 0;
            }
            record_phase_start = false;
            let rs = crate::vfs::stream_string_to_bytes(&self.rs);
            if rs.len() > 1 {
                self.runtime_err = Some("awk: RS must be one byte or empty for paragraph records\n".into());
                return None;
            }
            match self.reader.as_mut().unwrap().record(rs.first().copied(), &mut self.stdin, &mut self.output, self.vfs) {
                Ok(Some(line)) => { self.nr += 1; self.fnr += 1; return Some(line); }
                Ok(None) => self.reader = None,
                Err(e) => { self.runtime_err = Some(format!("awk: {e}\n")); self.error_status = 1; return None; }
            }
        }
    }
}
