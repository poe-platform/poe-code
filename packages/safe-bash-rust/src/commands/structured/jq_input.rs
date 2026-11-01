use super::{JVal, SafeBashFs, jq_json::Parser, read_stream_diag, resolve_posix_path};
use std::borrow::Cow;

pub(super) struct JqInputs<'a> {
    reader: Box<dyn Iterator<Item = Result<JVal, (i32, String)>> + 'a>,
    pub remaining: usize,
    pub file_error: Option<String>,
}

impl<'a> JqInputs<'a> {
    pub fn new(reader: impl Iterator<Item = Result<JVal, (i32, String)>> + 'a) -> Self {
        Self {
            reader: Box::new(reader),
            remaining: usize::MAX,
            file_error: None,
        }
    }

    pub fn next(&mut self) -> Result<Option<JVal>, (i32, String)> {
        if self.remaining == 0 {
            return Ok(None);
        }
        match self.reader.next().transpose() {
            Ok(Some(v)) => {
                self.remaining -= 1;
                Ok(Some(v))
            }
            Err((2, e)) => {
                self.file_error = Some(e.clone());
                Err((2, e))
            }
            r => r,
        }
    }
}

struct Bytes<'a> {
    files: std::vec::IntoIter<String>,
    stdin: Option<&'a [u8]>,
    cwd: &'a str,
    fs: &'a dyn SafeBashFs,
    chunk: Cow<'a, [u8]>,
    at: usize,
}

impl Bytes<'_> {
    fn peek(&mut self) -> Result<Option<u8>, (i32, String)> {
        while self.at == self.chunk.len() {
            let Some(path) = self.files.next() else {
                return Ok(None);
            };
            self.chunk = if path == "-" {
                Cow::Borrowed(self.stdin.take().unwrap_or_default())
            } else {
                let full = resolve_posix_path(self.cwd, &path);
                Cow::Owned(
                    self.fs
                        .read_file(&full)
                        .map_err(|_| (2, read_stream_diag(&full, self.fs)))?,
                )
            };
            self.at = 0;
        }
        Ok(Some(self.chunk[self.at]))
    }
}

struct Values<'a> {
    bytes: Bytes<'a>,
    raw: bool,
    slurp: bool,
    sequence: bool,
    parser: Parser,
    stream_errors: bool,
    failed: bool,
    line: usize,
    column: usize,
    eof: bool,
    done: bool,
}

impl Values<'_> {
    fn value(&mut self) -> Result<Option<JVal>, (i32, String)> {
        if self.raw {
            let mut line = Vec::new();
            while let Some(b) = self.bytes.peek()? {
                self.bytes.at += 1;
                if !self.slurp && b == b'\n' {
                    break;
                }
                line.push(b);
            }
            // A newline terminates even an empty line. Only EOF suppresses an empty result.
            return Ok(Some(JVal::Str(String::from_utf8_lossy(&line).into_owned())));
        }

        loop {
            if let Some(event) = self.parser.events.pop_front() {
                return Ok(Some(event));
            }
            if self.eof {
                return Ok(None);
            }
            let byte = self.bytes.peek()?;
            let parsed = if let Some(b) = byte {
                self.bytes.at += 1;
                if b == b'\n' {
                    self.line += 1;
                    self.column = 0;
                } else {
                    self.column += 1;
                }
                if self.sequence && b == 0x1e {
                    continue;
                }
                if self.failed {
                    if b == b'\n' {
                        self.parser = Parser::new(true, self.line, self.column);
                        self.failed = false;
                    }
                    continue;
                }
                self.parser.feed(b)
            } else {
                self.eof = true;
                if self.failed {
                    return Ok(None);
                }
                self.parser.finish()
            };
            if let Err(detail) = parsed {
                self.parser.events.clear();
                let message = if detail == "Malformed BOM" {
                    detail.into()
                } else {
                    format!(
                        "{detail} at line {}, column {}",
                        self.parser.line, self.parser.column
                    )
                };
                if self.stream_errors {
                    let path = self.parser.path();
                    self.failed = true;
                    if byte == Some(b'\n') {
                        self.parser = Parser::new(true, self.line, self.column);
                        self.failed = false;
                    }
                    return Ok(Some(JVal::Array(vec![
                        JVal::Str(message),
                        JVal::Array(path),
                    ])));
                }
                return Err((5, format!("parse error: {message}")));
            }
        }
    }
    fn pull(&mut self) -> Result<Option<JVal>, (i32, String)> {
        if self.done {
            return Ok(None);
        }
        if self.slurp {
            self.done = true;
            if self.raw {
                return self.value();
            }
            let mut all = Vec::new();
            while let Some(v) = self.value()? {
                all.push(v);
            }
            return Ok(Some(JVal::Array(all)));
        }
        if self.raw && self.bytes.peek()?.is_none() {
            return Ok(None);
        }
        self.value()
    }
}

pub(super) fn files<'a>(
    mut files: Vec<String>,
    stdin: &'a str,
    cwd: &'a str,
    fs: &'a dyn SafeBashFs,
    raw: bool,
    slurp: bool,
    sequence: bool,
    stream: bool,
    stream_errors: bool,
) -> JqInputs<'a> {
    if files.is_empty() {
        files.push("-".into());
    }
    let mut values = Values {
        bytes: Bytes {
            files: files.into_iter(),
            stdin: Some(stdin.as_bytes()),
            cwd,
            fs,
            chunk: Cow::Borrowed(&[]),
            at: 0,
        },
        raw,
        slurp,
        sequence,
        parser: Parser::new(stream, 1, 0),
        stream_errors,
        failed: false,
        line: 1,
        column: 0,
        eof: false,
        done: false,
    };
    JqInputs::new(std::iter::from_fn(move || {
        let r = values.pull();
        if r.is_err() {
            values.done = true;
        }
        r.transpose()
    }))
}
