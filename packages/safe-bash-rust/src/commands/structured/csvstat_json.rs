use mcp_protocol_rust::json::{Value, stringify};

pub(super) enum Report {
    Token(String),
    Array(Vec<Report>),
    Object(Vec<(&'static str, Report)>),
}

impl Report {
    pub(super) fn string(value: &str) -> Self {
        Self::Token(stringify(&Value::String(value.encode_utf16().collect())))
    }

    pub(super) fn float(n: f64) -> Self {
        let token = if n.is_infinite() {
            if n.is_sign_negative() {
                "-Infinity"
            } else {
                "Infinity"
            }
            .into()
        } else if n.is_finite() && n != 0.0 && !(1e-4..1e16).contains(&n.abs()) {
            let scientific = format!("{n:e}");
            let (digits, power) = scientific.split_once('e').unwrap();
            format!("{digits}e{:+03}", power.parse::<i16>().unwrap())
        } else if n.fract() == 0.0 {
            format!("{n}.0")
        } else {
            n.to_string()
        };
        Self::Token(token)
    }

    pub(super) fn write(
        &self,
        out: &mut String,
        indent: Option<usize>,
        depth: usize,
        limit: usize,
    ) -> Result<(), &'static str> {
        let newline = |out: &mut String, level: usize| -> Result<(), &'static str> {
            if let Some(width) = indent {
                let spaces = width.saturating_mul(level);
                if spaces >= limit.saturating_sub(out.len()) {
                    return Err("JSON indentation budget");
                }
                out.push('\n');
                out.extend(std::iter::repeat_n(' ', spaces));
            }
            Ok(())
        };
        let (close, count) = match self {
            Self::Token(text) => {
                out.push_str(text);
                return Ok(());
            }
            Self::Array(v) => {
                out.push('[');
                (']', v.len())
            }
            Self::Object(v) => {
                out.push('{');
                ('}', v.len())
            }
        };
        for i in 0..count {
            if i > 0 {
                out.push_str(if indent.is_some() { "," } else { ", " });
            }
            newline(out, depth + 1)?;
            let child = match self {
                Self::Array(v) => &v[i],
                Self::Object(v) => {
                    let (key, child) = &v[i];
                    out.push('"');
                    out.push_str(key);
                    out.push_str("\": ");
                    child
                }
                Self::Token(_) => unreachable!(),
            };
            child.write(out, indent, depth + 1, limit)?;
        }
        if count != 0 {
            newline(out, depth)?;
        }
        out.push(close);
        Ok(())
    }
}
