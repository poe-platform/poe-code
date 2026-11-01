use super::{
    JVal, SafeBashFs, collect_jq_stream_events, parse_single_json_strict, read_stream_diag,
    resolve_posix_path,
};
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
    stream: bool,
    events: std::vec::IntoIter<JVal>,
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

        if let Some(event) = self.events.next() {
            return Ok(Some(event));
        }
        let first = loop {
            let Some(b) = self.bytes.peek()? else {
                return Ok(None);
            };
            if !b.is_ascii_whitespace() && !(self.sequence && b == 0x1e) {
                break b;
            }
            self.bytes.at += 1;
        };
        let scalar = !matches!(first, b'[' | b'{' | b'"');
        let mut buf = Vec::new();
        let mut depth = 0usize;
        let mut quoted = false;
        let mut escape = false;
        while let Some(b) = self.bytes.peek()? {
            if scalar
                && !buf.is_empty()
                && (b.is_ascii_whitespace() || matches!(b, b'[' | b'{' | b'"' | b']' | b'}' | 0x1e))
            {
                break;
            }
            self.bytes.at += 1;
            buf.push(b);
            if scalar {
                continue;
            }
            if quoted {
                if escape {
                    escape = false;
                } else if b == b'\\' {
                    escape = true;
                } else if b == b'"' {
                    quoted = false;
                }
            } else {
                match b {
                    b'[' | b'{' => {
                        depth += 1;
                        if depth > 256 {
                            return Err((4, "parse error: maxDepth limit exceeded".into()));
                        }
                    }
                    b']' | b'}' => depth = depth.saturating_sub(1),
                    b'"' => quoted = true,
                    _ => {}
                }
            }
            if depth == 0 && !quoted {
                break;
            }
        }
        let value = parse_single_json_strict(&String::from_utf8_lossy(&buf))
            .map_err(|e| (4, format!("parse error: {e}")))?;
        if self.stream {
            let mut events = Vec::new();
            collect_jq_stream_events(&value, &mut Vec::new(), &mut events);
            self.events = events.into_iter();
            return Ok(self.events.next());
        }
        Ok(Some(value))
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
        stream,
        events: Vec::new().into_iter(),
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
