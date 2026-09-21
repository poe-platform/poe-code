//! UTF-16 terminal styles and inline Markdown formatting.
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
pub fn style(name: &str) -> Option<Vec<u16>> {
    let code = match name {
        "reset" => 0,
        "bold" => 1,
        "dim" => 2,
        "italic" => 3,
        "underline" => 4,
        "inverse" => 7,
        "strikethrough" => 9,
        "black" => 30,
        "red" => 31,
        "green" => 32,
        "yellow" => 33,
        "blue" => 34,
        "magenta" => 35,
        "cyan" => 36,
        "white" => 37,
        "gray" => 90,
        "magentaBright" => 95,
        "cyanBright" => 96,
        "bgRed" => 41,
        "bgGreen" => 42,
        "bgYellow" => 43,
        "bgBlue" => 44,
        "bgMagenta" => 45,
        _ => return None,
    };
    Some(u(&format!("\x1b[{code}m")))
}
pub fn style_names() -> &'static [&'static str] {
    &[
        "reset",
        "bold",
        "dim",
        "italic",
        "underline",
        "inverse",
        "strikethrough",
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
        "gray",
        "magentaBright",
        "cyanBright",
        "bgRed",
        "bgGreen",
        "bgYellow",
        "bgBlue",
        "bgMagenta",
    ]
}
pub fn apply(text: &[u16], open: &[u16]) -> Vec<u16> {
    if open.is_empty() {
        return text.to_vec();
    }
    let reset = [27, 91, 48, 109];
    let mut output = Vec::with_capacity(open.len() + text.len() + reset.len());
    output.extend(open);
    let mut index = 0;
    while index < text.len() {
        if text[index..].starts_with(&reset) {
            output.extend(reset);
            output.extend(open);
            index += reset.len();
        } else {
            output.push(text[index]);
            index += 1;
        }
    }
    output.extend(reset);
    output
}
fn clamp(value: f64) -> u8 {
    if value.is_nan() {
        0
    } else {
        value.round().clamp(0., 255.) as u8
    }
}
pub fn rgb(channels: [f64; 3], background: bool) -> Vec<u16> {
    let [r, g, b] = channels.map(clamp);
    u(&format!(
        "\x1b[{};2;{r};{g};{b}m",
        if background { 48 } else { 38 }
    ))
}
pub fn hex(value: &[u16], background: bool) -> Result<Vec<u16>, String> {
    let input = if value.first() == Some(&35) {
        &value[1..]
    } else {
        value
    };
    let digits = input
        .iter()
        .map(|v| match *v {
            48..=57 => Some((*v - 48) as u8),
            65..=70 => Some((*v - 65 + 10) as u8),
            97..=102 => Some((*v - 97 + 10) as u8),
            _ => None,
        })
        .collect::<Option<Vec<_>>>();
    let Some(digits) = digits.filter(|v| v.len() == 3 || v.len() == 6) else {
        return Err(format!(
            "Invalid hexadecimal color: {}",
            String::from_utf16_lossy(value)
        ));
    };
    let channels = if digits.len() == 3 {
        [digits[0] * 17, digits[1] * 17, digits[2] * 17]
    } else {
        [
            digits[0] * 16 + digits[1],
            digits[2] * 16 + digits[3],
            digits[4] * 16 + digits[5],
        ]
    };
    Ok(rgb(channels.map(f64::from), background))
}
fn inline(input: &[u16]) -> Vec<u16> {
    let mut result = vec![];
    let mut i = 0;
    while i < input.len() {
        let ch = input[i];
        if ch == 13 && input.get(i + 1) == Some(&10) {
            i += 1;
        }
        result.push(if ch == 13 || ch == 10 { 32 } else { ch });
        i += 1;
    }
    result
}
pub fn markdown_code(input: &[u16]) -> Vec<u16> {
    let value = inline(input);
    let mut longest = 0;
    let mut current = 0;
    for ch in &value {
        if *ch == 96 {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }
    let delimiter = vec![96; longest + 1];
    let pad = value.first() == Some(&96) || value.last() == Some(&96);
    let mut result = delimiter.clone();
    if pad {
        result.push(32);
    }
    result.extend(value);
    if pad {
        result.push(32);
    }
    result.extend(delimiter);
    result
}
pub fn markdown_link(input: &[u16]) -> Vec<u16> {
    let value = inline(input);
    let escape = |characters: &[u16]| {
        let mut result = vec![];
        for ch in &value {
            if characters.contains(ch) {
                result.push(92);
            }
            result.push(*ch);
        }
        result
    };
    [
        vec![91],
        escape(&[92, 91, 93]),
        vec![93, 40],
        escape(&[92, 40, 41]),
        vec![41],
    ]
    .concat()
}
pub fn text_markdown(kind: &str, content: &[u16]) -> Vec<u16> {
    let (prefix, suffix) = match kind {
        "intro" | "section" | "error" => ("**", "**"),
        "heading" | "sectionHeader" => ("## ", ""),
        "command" | "option" | "example" | "usageCommand" => return markdown_code(content),
        "link" => return markdown_link(content),
        "argument" => ("<", ">"),
        "muted" => ("*", "*"),
        "badge" => ("[", "]"),
        _ => return content.to_vec(),
    };
    [u(prefix), content.to_vec(), u(suffix)].concat()
}
/// Classify one lazily observed environment hint; host preserves getter ordering.
pub fn theme_hint(kind: &str, value: &str) -> Option<&'static str> {
    let lower = value.to_lowercase();
    match kind {
        "explicit" => match lower.as_str() {
            "light" => Some("light"),
            "dark" => Some("dark"),
            _ => None,
        },
        "apple" => Some(if lower == "dark" { "dark" } else { "light" }),
        "vscode" => {
            if lower.contains("light") {
                Some("light")
            } else if lower.contains("dark") {
                Some("dark")
            } else {
                None
            }
        }
        "background" => {
            let last = value.rsplit(';').next().unwrap_or("");
            let units = last.encode_utf16().collect::<Vec<_>>();
            let trimmed = mcp_protocol_rust::strings::trim_ecmascript(&units);
            let s = String::from_utf16_lossy(trimmed);
            let (negative, digits) = if let Some(rest) = s.strip_prefix('-') {
                (true, rest)
            } else {
                (false, s.strip_prefix('+').unwrap_or(&s))
            };
            let mut any = false;
            let mut number = 0f64;
            for byte in digits.bytes() {
                if !byte.is_ascii_digit() {
                    break;
                }
                any = true;
                number = number * 10. + f64::from(byte - b'0');
            }
            if any && number.is_finite() {
                Some(if !negative && number >= 8. {
                    "light"
                } else {
                    "dark"
                })
            } else {
                None
            }
        }
        _ => None,
    }
}
