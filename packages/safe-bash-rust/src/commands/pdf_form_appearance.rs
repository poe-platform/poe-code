// Draw editable form text in the widget's local coordinate system.
use super::{Cursor, Value, pdf_string};
use std::fmt::Write;
pub(super) fn appearance(
    text: &str,
    w: f64,
    h: f64,
    da: &str,
    align: f64,
    flags: i32,
    max_len: Option<f64>,
    limit: usize,
) -> Option<(String, String)> {
    let mut font = "Helvetica".to_owned();
    let mut size = 11.;
    let mut color = String::new();
    let mut cursor = Cursor(da.as_bytes());
    let mut tokens = da.len() + 1;
    let mut previous = std::collections::VecDeque::<Value>::new();
    while !cursor.0.is_empty() {
        let Some(v) = cursor.value(0, &mut tokens, false) else {
            break;
        };
        match v.word() {
            Some(b"Tf") if previous.len() >= 2 => {
                let i = previous.len() - 2;
                if let Some(name) = previous[i].word().and_then(|s| s.strip_prefix(b"/")) {
                    let decoded = pdf_string::name(name);
                    font = match decoded.as_str() {
                        "Helv" => "Helvetica",
                        "HeBo" => "Helvetica-Bold",
                        "HeOb" => "Helvetica-Oblique",
                        "HeBI" => "Helvetica-BoldOblique",
                        "Cour" => "Courier",
                        "CoBo" => "Courier-Bold",
                        "CoOb" => "Courier-Oblique",
                        "CoBI" => "Courier-BoldOblique",
                        "TiRo" => "Times-Roman",
                        "TiBo" => "Times-Bold",
                        "TiIt" => "Times-Italic",
                        "TiBI" => "Times-BoldItalic",
                        "Symb" => "Symbol",
                        "ZaDb" => "ZapfDingbats",
                        other => other,
                    }
                    .to_owned();
                }
                if let Some(n) = previous[i + 1].number() {
                    size = if n > 0. {
                        n
                    } else {
                        (h * 0.65).floor().clamp(6., 18.)
                    };
                }
            }
            Some(op @ (b"g" | b"G" | b"rg" | b"RG" | b"k" | b"K")) => {
                let n = match op {
                    b"g" | b"G" => 1,
                    b"k" | b"K" => 4,
                    _ => 3,
                };
                if previous.len() >= n
                    && let Some(nums) = previous
                        .iter()
                        .skip(previous.len() - n)
                        .map(Value::number)
                        .collect::<Option<Vec<_>>>()
                {
                    color = nums
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(" ")
                        + " "
                        + std::str::from_utf8(op).ok()?
                        + " ";
                }
            }
            _ => (),
        }
        if previous.len() == 4 {
            previous.pop_front();
        }
        previous.push_back(v);
    }
    let mask;
    let text = if flags & (1 << 13) != 0 {
        mask = "*".repeat(text.encode_utf16().count());
        &mask
    } else {
        text
    };
    let mut out = format!("/Tx BMC q BT {color}/F1 {size} Tf ");
    let escape = |s: &str, out: &mut String| {
        for ch in s.chars() {
            if matches!(ch, '(' | ')' | '\\') {
                out.push('\\');
            }
            out.push(ch);
        }
    };
    if flags & (1 << 24) != 0
        && let Some(n) = max_len.filter(|n| *n > 0.)
        && !text.contains('\n')
    {
        let cell = w / n;
        for (i, ch) in text.chars().take(n.floor() as usize).enumerate() {
            if i != 0 {
                out.push(' ');
            }
            let x = format!("{:.2}", i as f64 * cell + ((cell - 6.) / 2.).max(1.))
                .parse::<f64>()
                .ok()?;
            write!(out, "1 0 0 1 {x} 4 Tm (").ok()?;
            escape(ch.encode_utf8(&mut [0; 4]), &mut out);
            out.push_str(") Tj");
            if out.len() > limit {
                return None;
            }
        }
    } else {
        let mut lines = text.split('\n').peekable();
        let mut last = 0.;
        let mut first = true;
        while let Some(line) = lines.next() {
            let line = if lines.peek().is_some() {
                line.strip_suffix('\r').unwrap_or(line)
            } else {
                line
            };
            let width = line.encode_utf16().count() as f64 * 6.;
            let x = if align == 1. {
                ((w - width) / 2.).round().max(2.)
            } else if align == 2. {
                (w - width - 2.).round().max(2.)
            } else {
                2.
            };
            let y = if first {
                if lines.peek().is_some() {
                    (h - 13.).round().max(4.)
                } else {
                    4.
                }
            } else {
                -13.
            };
            if !first {
                out.push(' ');
            }
            write!(out, "{} {y} Td (", x - last).ok()?;
            escape(line, &mut out);
            out.push_str(") Tj");
            if out.len() > limit {
                return None;
            }
            last = x;
            first = false;
        }
    }
    out.push_str(" ET Q EMC\n");
    Some((font, out))
}
