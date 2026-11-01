use super::{JVal, SafeBashFs, jq_json::Parser, read_stream_diag, resolve_posix_path};
use std::borrow::Cow;

pub(super) struct JqInputs<'a> {
    reader: Reader<'a>,
    pub warnings: String,
    pub remaining: usize,
    pub file_error: Option<String>,
}

enum Reader<'a> {
    Documents(std::vec::IntoIter<JVal>),
    Files(Box<Values<'a>>),
}

impl JqInputs<'_> {
    pub fn documents(values: Vec<JVal>) -> Self {
        Self {
            reader: Reader::Documents(values.into_iter()),
            remaining: usize::MAX,
            file_error: None,
            warnings: String::new(),
        }
    }

    pub fn next(&mut self) -> Result<Option<JVal>, (i32, String)> {
        if self.remaining == 0 {
            return Ok(None);
        }
        let result = match &mut self.reader {
            Reader::Documents(docs) => Ok(docs.next()),
            Reader::Files(values) => {
                let result = values.pull(&mut self.warnings);
                if result.is_err() {
                    values.done = true;
                }
                result
            }
        };
        match result {
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
    stream: bool,
    failed: bool,
    line: usize,
    column: usize,
    eof: bool,
    done: bool,
}

impl Values<'_> {
    fn value(&mut self, warnings: &mut String) -> Result<Option<JVal>, (i32, String)> {
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
            let separator = self.sequence && byte == Some(0x1e);
            if let Some(b) = byte {
                self.bytes.at += 1;
                if b == b'\n' {
                    self.line += 1;
                    self.column = 0;
                } else {
                    self.column += 1;
                }
            } else {
                self.eof = true;
            }
            let mut reported = None;
            if !self.failed {
                let parsed = match byte {
                    Some(b) if !separator => self.parser.feed(b),
                    _ => self.parser.finish(self.sequence, self.eof),
                };
                if let Err(detail) = parsed {
                    self.parser.events.clear();
                    let (line, column) = if detail.starts_with("Potentially truncated")
                        || detail == "Truncated value"
                    {
                        (self.line, self.column)
                    } else {
                        (self.parser.line, self.parser.column)
                    };
                    let message = if detail == "Malformed BOM" {
                        detail.into()
                    } else {
                        format!("{detail} at line {line}, column {column}")
                    };
                    if self.stream_errors {
                        reported = Some(JVal::Array(vec![
                            JVal::Str(message),
                            JVal::Array(self.parser.path()),
                        ]));
                    } else if self.sequence {
                        use std::fmt::Write;
                        writeln!(
                            warnings,
                            "jq: ignoring parse error: {message}{}",
                            if separator || self.eof {
                                ""
                            } else {
                                " (need RS to resync)"
                            }
                        )
                        .unwrap();
                    } else {
                        return Err((5, format!("parse error: {message}")));
                    }
                    self.failed = true;
                }
            }
            if separator || (!self.sequence && self.failed && byte == Some(b'\n')) {
                let events = std::mem::take(&mut self.parser.events);
                self.parser = Parser::new(self.stream, self.line, self.column);
                self.parser.events = events;
                self.failed = false;
            }
            if reported.is_some() {
                return Ok(reported);
            }
        }
    }
    fn pull(&mut self, warnings: &mut String) -> Result<Option<JVal>, (i32, String)> {
        if self.done {
            return Ok(None);
        }
        if self.slurp {
            self.done = true;
            if self.raw {
                return self.value(warnings);
            }
            let mut all = Vec::new();
            while let Some(v) = self.value(warnings)? {
                all.push(v);
            }
            return Ok(Some(JVal::Array(all)));
        }
        if self.raw && self.bytes.peek()?.is_none() {
            return Ok(None);
        }
        self.value(warnings)
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
    let values = Values {
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
        stream,
        failed: sequence,
        line: 1,
        column: 0,
        eof: false,
        done: false,
    };
    JqInputs {
        reader: Reader::Files(Box::new(values)),
        remaining: usize::MAX,
        file_error: None,
        warnings: String::new(),
    }
}
