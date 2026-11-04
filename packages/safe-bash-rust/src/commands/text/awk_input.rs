use super::{AwkState, is_valid_awk_ident, parse_awk_f64, unescape_sed_text};
use crate::vfs::{ChunkReader, bytes_to_stream_string};

pub(super) struct Reader<'a> {
    file: Option<ChunkReader<'a>>,
    chunk: Vec<u8>,
    at: usize,
}

impl Reader<'_> {
    fn record(&mut self, rs: Option<u8>, stdin: &mut super::super::CommandInput) -> Result<Option<String>, String> {
        let mut partial = Vec::new();
        let mut newlines = 0;
        loop {
            if self.at == self.chunk.len() {
                if let Some(next) = &mut self.file { next(&mut self.chunk)?; }
                else { stdin.next_stdin_chunk(&mut self.chunk)?; }
                self.at = 0;
                if self.chunk.is_empty() {
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
    pub(super) fn read_main(&mut self) -> Option<String> {
        loop {
            if self.reader.is_none() {
                let name = loop {
                    if self.argument as f64 >= parse_awk_f64(&self.get_var("ARGC")) {
                        if self.saw_file { return None; }
                        break "-".to_owned();
                    }
                    let next = self.arrays.get("ARGV").and_then(|a| a.get(&self.argument.to_string())).cloned().unwrap_or_default();
                    self.argument += 1;
                    if next.is_empty() { continue; }
                    if self.operand_assignments && let Some((k,v)) = next.split_once('=') && is_valid_awk_ident(k) {
                        self.set_var(k, unescape_sed_text(v));
                        continue;
                    }
                    break next;
                };
                self.saw_file = true;
                let file = if name == "-" { None } else {
                    match super::super::coreutils::open_record_input(&name, &self.cwd, self.vfs, false) {
                        Ok(next) => Some(next),
                        Err(e) => { self.runtime_err = Some(format!("awk: {e}\n")); self.error_status = 1; return None; }
                    }
                };
                self.reader = Some(Reader { file, chunk: Vec::new(), at: 0 });
                self.set_var("FILENAME", name);
                self.fnr = 0;
            }
            let rs = crate::vfs::stream_string_to_bytes(&self.rs);
            if rs.len() > 1 {
                self.runtime_err = Some("awk: RS must be one byte or empty for paragraph records\n".into());
                return None;
            }
            match self.reader.as_mut().unwrap().record(rs.first().copied(), &mut self.stdin) {
                Ok(Some(line)) => { self.nr += 1; self.fnr += 1; return Some(line); }
                Ok(None) => self.reader = None,
                Err(e) => { self.runtime_err = Some(format!("awk: {e}\n")); self.error_status = 1; return None; }
            }
        }
    }
}
