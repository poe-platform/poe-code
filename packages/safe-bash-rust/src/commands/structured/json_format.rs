use super::JVal;
use std::fmt::{self, Write};

#[derive(Clone, Copy)]
pub(super) enum JsonStrings {
    Plain,
    JavaScript,
    Jq,
    Ascii,
}

impl JsonStrings {
    pub(super) fn quote(self, text: &str, out: &mut impl Write) -> fmt::Result {
        out.write_char('"')?;
        let mut start = 0;
        for (at, c) in text.char_indices() {
            let escape = match c {
                '"' => r#"\""#,
                '\\' => r"\\",
                '\n' => r"\n",
                '\r' => r"\r",
                '\t' => r"\t",
                '\x08' if !matches!(self, Self::Plain) => r"\b",
                '\x0c' if !matches!(self, Self::Plain) => r"\f",
                c if c < ' ' || (c == '\x7f' && matches!(self, Self::Jq | Self::Ascii))
                    || (!c.is_ascii() && matches!(self, Self::Ascii)) => "",
                _ => continue,
            };
            out.write_str(&text[start..at])?;
            if escape.is_empty() {
                for unit in c.encode_utf16(&mut [0; 2]) { write!(out, "\\u{unit:04x}")?; }
            } else { out.write_str(escape)?; }
            start = at + c.len_utf8();
        }
        out.write_str(&text[start..])?;
        out.write_char('"')
    }
}

pub(super) fn escape_json_str(s: &str) -> String {
    let mut out = String::new();
    JsonStrings::Plain.quote(s, &mut out).unwrap();
    out
}

pub(super) struct JsonFormat<'a> {
    pub(super) indent: &'a str,
    pub(super) strings: JsonStrings,
    pub(super) color: bool,
    pub(super) sort_keys: bool,
}

pub(super) struct LimitedText<'a> {
    pub(super) text: &'a mut String,
    pub(super) limit: usize,
}

impl Write for LimitedText<'_> {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        if text.len() > self.limit.saturating_sub(self.text.len()) { return Err(fmt::Error); }
        self.text.push_str(text);
        Ok(())
    }
}

impl JsonFormat<'_> {
    pub(super) fn write<W: Write>(&self, value: &JVal, depth: usize, out: &mut W) -> fmt::Result {
        let color = |out: &mut W, code: &str| {
            if self.color {
                out.write_str(code)?;
            }
            Ok::<(), fmt::Error>(())
        };
        let pad = |out: &mut W, n: usize| {
            if !self.indent.is_empty() {
                out.write_char('\n')?;
                for _ in 0..n {
                    out.write_str(self.indent)?;
                }
            }
            Ok::<(), fmt::Error>(())
        };
        color(
            out,
            match value {
                JVal::Null => "\x1b[0;90m",
                JVal::Str(_) => "\x1b[0;32m",
                JVal::Array(_) | JVal::Object(_) => "\x1b[1;39m",
                _ => "\x1b[0;39m",
            },
        )?;
        match value {
            JVal::Null => out.write_str("null")?,
            JVal::Bool(b) => out.write_str(if *b { "true" } else { "false" })?,
            JVal::Number(n, decimal) => {
                if n.is_nan() {
                    color(out, "\x1b[0;90m")?;
                }
                if let Some(text) = decimal {
                    out.write_str(text)?;
                } else {
                    out.write_str(&super::jq_number::computed(*n))?;
                }
                if n.is_nan() {
                    color(out, "\x1b[0m")?;
                }
            }
            JVal::Str(s) => self.strings.quote(s, out)?,
            JVal::Array(_) | JVal::Object(_) => {
                let array = matches!(value, JVal::Array(_));
                out.write_char(if array { '[' } else { '{' })?;
                let mut first = true;
                let mut item = |key: Option<&str>, v: &JVal| {
                    if !first {
                        out.write_char(',')?;
                    }
                    first = false;
                    pad(out, depth + 1)?;
                    if let Some(k) = key {
                        color(out, "\x1b[0m\x1b[1;34m")?;
                        self.strings.quote(k, out)?;
                        color(out, "\x1b[0m\x1b[1;39m")?;
                        out.write_str(if self.indent.is_empty() { ":" } else { ": " })?;
                        color(out, "\x1b[0m")?;
                    }
                    self.write(v, depth + 1, out)?;
                    color(out, "\x1b[1;39m")
                };
                match value {
                    JVal::Array(items) => {
                        for v in items {
                            item(None, v)?;
                        }
                    }
                    JVal::Object(entries) if self.sort_keys => {
                        let mut sorted: Vec<_> = entries.iter().collect();
                        sorted.sort_by(|a, b| a.0.cmp(&b.0));
                        for (k, v) in sorted {
                            item(Some(k), v)?;
                        }
                    }
                    JVal::Object(entries) => {
                        for (k, v) in entries {
                            item(Some(k), v)?;
                        }
                    }
                    _ => unreachable!(),
                }
                if !first {
                    pad(out, depth)?;
                    color(out, "\x1b[1;39m")?;
                }
                out.write_char(if array { ']' } else { '}' })?;
            }
        }
        color(out, "\x1b[0m")
    }
}
