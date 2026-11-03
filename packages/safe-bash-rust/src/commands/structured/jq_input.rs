use super::{JVal, SafeBashFs, jq_json::Parser, read_jq_file};
use std::borrow::Cow;

#[derive(Default)]
pub(super) struct JqInputs<'a> {
    reader: Option<Values<'a>>,
    pub warnings: String,
    pub reads_input: bool,
    pub file_error: Option<String>,
}

impl JqInputs<'_> {
    pub fn location(&mut self) -> String {
        if let Some(v) = &mut self.reader {
            let b = &mut v.bytes;
            let Some(name) = &b.name else {
                return "<unknown>".into();
            };
            let line = if b.at != 0
                && b.chunk[b.at - 1] != b'\n'
                && *b
                    .more_newlines
                    .get_or_insert_with(|| b.chunk[b.at..].contains(&b'\n'))
            {
                b.line + 1
            } else {
                b.line
            };
            return format!("{}:{line}", diagnostic(name, usize::MAX));
        }
        "<unknown>".into()
    }

    pub fn next(&mut self) -> Result<Option<JVal>, (i32, String)> {
        let Some(values) = &mut self.reader else {
            return Ok(None);
        };
        let result = values.pull(&mut self.warnings);
        if result.is_err() {
            values.done = true;
        }
        match result {
            Err((2, e)) => {
                self.file_error = Some(e.clone());
                Err((2, e))
            }
            r => r,
        }
    }
}

pub(super) enum Source<'a> {
    ShellJson(Option<&'a str>),
    Json(Option<&'a str>),
    Xml(Option<super::super::CommandInput<'a>>),
}

struct Bytes<'a> {
    files: std::vec::IntoIter<String>,
    remaining: usize,
    raw: bool,
    stdin: Source<'a>,
    cwd: &'a str,
    fs: &'a dyn SafeBashFs,
    chunk: Cow<'a, [u8]>,
    at: usize,
    name: Option<String>,
    line: usize,
    more_newlines: Option<bool>,
}

impl Bytes<'_> {
    fn advance(&mut self, b: u8) {
        self.at += 1;
        if b == b'\n' {
            self.line += 1;
            self.more_newlines = None;
        }
    }
    fn peek(&mut self) -> Result<Option<u8>, (i32, String)> {
        while self.at == self.chunk.len() {
            let Some(path) = self.files.next() else {
                return Ok(None);
            };
            if self.raw && path == "-" && matches!(self.stdin, Source::Xml(None)) {
                continue;
            }
            let shell_text = !matches!(self.stdin, Source::Json(_));
            self.name = Some(if path == "-" {
                "<stdin>".into()
            } else {
                if shell_text { crate::vfs::host_text(&path).into_owned() } else { path.clone() }
            });
            self.at = 0;
            self.line = 0;
            self.chunk = Cow::Borrowed(&[]);
            self.chunk = match &mut self.stdin {
                Source::Xml(input) => {
                    let full = (path != "-").then(|| crate::vfs::path::absolute_operand(self.cwd, &path));
                    let parser = super::xml::Parser::new(Some("UTF-8"), None, true);
                    let dom = super::read_xml_operand(self.fs, full.as_deref().map(|p| (p, usize::MAX)), input, &mut self.remaining, parser)
                        .map_err(|(code, msg)| if code == 2 { (code, crate::vfs::host_text(&msg).into_owned()) } else { (code,msg) })?;
                    let mut json = super::xml::to_json(&dom.nodes, false);
                    json.push('\n');
                    Cow::Owned(json.into_bytes())
                }
                Source::Json(input) if path == "-" => Cow::Borrowed(input.take().unwrap_or_default().as_bytes()),
                Source::ShellJson(input) if path == "-" => {
                    let text = input.take().unwrap_or_default();
                    if text.contains(crate::vfs::is_stream_byte) { Cow::Owned(crate::vfs::stream_string_to_bytes(text)) }
                    else { Cow::Borrowed(text.as_bytes()) }
                }
                Source::Json(_) | Source::ShellJson(_) => {
                    let full = crate::vfs::path::absolute_operand(self.cwd, &path);
                    Cow::Owned(read_jq_file(self.fs, &full).map_err(|e| (2, if shell_text { crate::vfs::host_text(&e).into_owned() } else { e }))?)
                }
            };
            self.more_newlines = None;
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
                self.bytes.advance(b);
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
                self.bytes.advance(b);
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
    stdin: Source<'a>,
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
            remaining: fs.max_input_bytes(),
            raw,
            stdin,
            cwd,
            fs,
            chunk: Cow::Borrowed(&[]),
            at: 0,
            name: None,
            line: 0,
            more_newlines: None,
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
        reader: Some(values),
        file_error: None,
        warnings: String::new(),
        reads_input: false,
    }
}

pub(super) fn diagnostic(text: &str, max_units: usize) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let mut units = 0;
    for c in text.chars() {
        if units == max_units {
            break;
        }
        units += c.len_utf16();
        if units > max_units {
            out.push(char::REPLACEMENT_CHARACTER);
            break;
        }
        match c {
            '\x08' => out.push_str("\\b"),
            '\x0b' => out.push_str("\\v"),
            '\x0c' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {
                for b in c.encode_utf8(&mut [0; 4]).bytes() {
                    write!(out, "\\{b:03o}").unwrap();
                }
            }
            c => out.push(c),
        }
    }
    out
}
