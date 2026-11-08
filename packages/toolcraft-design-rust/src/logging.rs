//! UTF-16 log rendering, with host-selected format and color capability.
use mcp_protocol_rust::json::{self, Value};
#[derive(Clone, Copy)]
pub enum Format {
    Terminal,
    Markdown,
    Json,
}
pub fn format(raw: &str) -> Format {
    match raw {
        "json" => Format::Json,
        "markdown" => Format::Markdown,
        _ => Format::Terminal,
    }
}
pub fn brand_known(brand: &str) -> bool {
    matches!(brand, "purple" | "blue" | "green")
}
pub fn strip(input: &[u16]) -> Vec<u16> {
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        let unit = input[index];
        if unit == 27 {
            let next = input.get(index + 1).copied();
            index = (index + 2).min(input.len());
            match next {
                Some(91) => skip_csi(input, &mut index),
                Some(93) => {
                    while index < input.len() {
                        if input[index] == 7 {
                            index += 1;
                            break;
                        }
                        if input[index] == 27 && input.get(index + 1) == Some(&92) {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                _ => {}
            }
        } else if unit == 155 {
            index += 1;
            skip_csi(input, &mut index);
        } else {
            output.push(unit);
            index += 1;
        }
    }
    output
}
fn skip_csi(input: &[u16], index: &mut usize) {
    while *index < input.len() {
        let unit = input[*index];
        *index += 1;
        if (64..=126).contains(&unit) {
            break;
        }
    }
}
fn extend(output: &mut Vec<u16>, text: &str) {
    output.extend(text.encode_utf16());
}
pub fn symbol(level: &str, brand: &str, light: bool, color: bool) -> Vec<u16> {
    let (mark, style) = match level {
        "info" => ("●", "35".to_owned()),
        "success" => ("◆", "35".to_owned()),
        "warn" => ("▲", "33".to_owned()),
        "error" => ("■", "31".to_owned()),
        "resolved" => {
            let style = if brand == "purple" && !light {
                "35".to_owned()
            } else {
                format!(
                    "38;2;{}",
                    match brand {
                        "blue" => "47;111;237",
                        "green" => "31;157;87",
                        _ => "162;0;255",
                    }
                )
            };
            ("◇", style)
        }
        "errorResolved" => ("■", if light { "38;2;204;0;0" } else { "31" }.to_owned()),
        _ => ("│", "90".to_owned()),
    };
    if color {
        format!("\x1b[{style}m{mark}\x1b[0m")
            .encode_utf16()
            .collect()
    } else {
        mark.encode_utf16().collect()
    }
}
pub fn render(
    level: &str,
    text: &[u16],
    format: Format,
    symbol: &[u16],
    secondary: &[u16],
) -> Vec<u16> {
    let mut output = Vec::with_capacity(text.len() + 64);
    match format {
        Format::Terminal => {
            output.extend_from_slice(secondary);
            output.push(10);
            for (index, line) in text.split(|unit| *unit == 10).enumerate() {
                let guide = if index == 0 { symbol } else { secondary };
                output.extend_from_slice(guide);
                if !line.is_empty() {
                    extend(&mut output, "  ");
                    output.extend_from_slice(line);
                }
                output.push(10);
            }
        }
        Format::Markdown => {
            extend(&mut output, "- ");
            if level != "message" {
                extend(&mut output, "**");
                extend(&mut output, if level == "warn" { "warning" } else { level });
                extend(&mut output, ":** ");
            }
            let text = strip(text);
            let mut index = 0;
            while index < text.len() {
                let unit = text[index];
                if unit == 13 && text.get(index + 1) == Some(&10) {
                    index += 1;
                }
                output.push(if unit == 10 || unit == 13 { 32 } else { unit });
                index += 1;
            }
            output.push(10);
        }
        Format::Json => {
            let value = Value::Object(vec![
                (
                    "level".encode_utf16().collect(),
                    Value::String(level.encode_utf16().collect()),
                ),
                (
                    "message".encode_utf16().collect(),
                    Value::String(strip(text)),
                ),
            ]);
            extend(&mut output, &json::stringify(&value));
            output.push(10);
        }
    }
    output
}
