use super::{BIG_NUM_RAW, JVal};

fn json_number(n: &f64) -> String {
    if n.is_nan() {
        return "null".to_string();
    }
    if n.is_infinite() {
        return if *n > 0.0 {
            "1.7976931348623157e+308".to_string()
        } else {
            "-1.7976931348623157e+308".to_string()
        };
    }
    if n.abs() >= 1e15
        && let Ok(guard) = BIG_NUM_RAW.lock()
        && let Some(ref map) = *guard
        && let Some(raw) = map.get(&n.to_bits())
    {
        return raw.clone();
    }
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", *n as i64)
    } else if (n - n.round()).abs() < 1e-11 && (n.to_bits() & 1) == 1 && n.abs() < 1e15 {
        format!("{:.1}", n.round())
    } else {
        format!("{n}")
    }
}

#[derive(Clone, Copy)]
pub(super) enum JsonStrings {
    Plain,
    Jq,
    Ascii,
}

impl JsonStrings {
    fn quote(self, text: &str, out: &mut String) {
        use std::fmt::Write;
        out.push('"');
        for c in text.chars() {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                '\x08' if !matches!(self, Self::Plain) => out.push_str("\\b"),
                '\x0c' if !matches!(self, Self::Plain) => out.push_str("\\f"),
                c if c < ' '
                    || (c == '\x7f' && !matches!(self, Self::Plain))
                    || (!c.is_ascii() && matches!(self, Self::Ascii)) =>
                {
                    for unit in c.encode_utf16(&mut [0; 2]) {
                        write!(out, "\\u{unit:04x}").unwrap();
                    }
                }
                c => out.push(c),
            }
        }
        out.push('"');
    }
}

pub(super) fn escape_json_str(s: &str) -> String {
    let mut out = String::new();
    JsonStrings::Plain.quote(s, &mut out);
    out
}

pub(super) struct JsonFormat<'a> {
    pub(super) indent: &'a str,
    pub(super) strings: JsonStrings,
    pub(super) color: bool,
    pub(super) sort_keys: bool,
}

impl JsonFormat<'_> {
    pub(super) fn write(&self, value: &JVal, depth: usize, out: &mut String) {
        let color = |out: &mut String, code: &str| {
            if self.color {
                out.push_str(code);
            }
        };
        let pad = |out: &mut String, n: usize| {
            if !self.indent.is_empty() {
                out.push('\n');
                for _ in 0..n {
                    out.push_str(self.indent);
                }
            }
        };
        color(
            out,
            match value {
                JVal::Null => "\x1b[0;90m",
                JVal::Str(_) => "\x1b[0;32m",
                JVal::Array(_) | JVal::Object(_) => "\x1b[1;39m",
                _ => "\x1b[0;39m",
            },
        );
        match value {
            JVal::Null => out.push_str("null"),
            JVal::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            JVal::Number(n) => {
                if n.is_nan() {
                    color(out, "\x1b[0;90m");
                }
                out.push_str(&json_number(n));
                if n.is_nan() {
                    color(out, "\x1b[0m");
                }
            }
            JVal::Str(s) => self.strings.quote(s, out),
            JVal::Array(_) | JVal::Object(_) => {
                let array = matches!(value, JVal::Array(_));
                out.push(if array { '[' } else { '{' });
                let mut first = true;
                let mut item = |key: Option<&str>, v: &JVal| {
                    if !first {
                        out.push(',');
                    }
                    first = false;
                    pad(out, depth + 1);
                    if let Some(k) = key {
                        color(out, "\x1b[0m\x1b[1;34m");
                        self.strings.quote(k, out);
                        color(out, "\x1b[0m\x1b[1;39m");
                        out.push_str(if self.indent.is_empty() { ":" } else { ": " });
                        color(out, "\x1b[0m");
                    }
                    self.write(v, depth + 1, out);
                    color(out, "\x1b[1;39m");
                };
                match value {
                    JVal::Array(items) => {
                        for v in items {
                            item(None, v);
                        }
                    }
                    JVal::Object(entries) if self.sort_keys => {
                        let mut sorted: Vec<_> = entries.iter().collect();
                        sorted.sort_by(|a, b| a.0.cmp(&b.0));
                        for (k, v) in sorted {
                            item(Some(k), v);
                        }
                    }
                    JVal::Object(entries) => {
                        for (k, v) in entries {
                            item(Some(k), v);
                        }
                    }
                    _ => unreachable!(),
                }
                if !first {
                    pad(out, depth);
                    color(out, "\x1b[1;39m");
                }
                out.push(if array { ']' } else { '}' });
            }
        }
        color(out, "\x1b[0m");
    }
}
