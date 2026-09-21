//! Dependency-free terminal renderer CLI grammar and value policies.
use mcp_protocol_rust::json::Value;
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
pub fn options(args: &Value) -> Result<Value, String> {
    let Value::Array(args) = args else {
        return Err("error: invalid arguments".into());
    };
    let args = args
        .iter()
        .map(|v| {
            if let Value::String(t) = v {
                Ok(String::from_utf16_lossy(t))
            } else {
                Err("error: invalid argument".to_string())
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut input = None;
    let mut output = None;
    let mut padding = None;
    let mut window = true;
    let mut help = false;
    let mut i = 0;
    let mut positionals = false;
    while i < args.len() {
        let arg = &args[i];
        if !positionals && arg == "--" {
            positionals = true;
            i += 1;
            continue;
        }
        if !positionals && matches!(arg.as_str(), "--help" | "-h") {
            help = true;
            i += 1;
            continue;
        }
        if !positionals && arg == "--window" {
            window = true;
            i += 1;
            continue;
        }
        if !positionals && arg == "--no-window" {
            window = false;
            i += 1;
            continue;
        }
        let (flag, inline) = if !positionals {
            arg.split_once('=')
                .map_or((arg.as_str(), None), |(a, b)| (a, Some(b)))
        } else {
            (arg.as_str(), None)
        };
        if !positionals && matches!(flag, "--output" | "-o" | "--padding") {
            let value = if let Some(v) = inline {
                v.to_string()
            } else {
                i += 1;
                args.get(i).cloned().ok_or_else(|| {
                    format!(
                        "error: option '{}' argument missing",
                        if flag == "--padding" {
                            "--padding <n>"
                        } else {
                            "-o, --output <output>"
                        }
                    )
                })?
            };
            if flag == "--padding" {
                if value.is_empty()
                    || value != "0" && value.starts_with('0')
                    || value.bytes().any(|c| !c.is_ascii_digit())
                {
                    return Err(format!(
                        "error: option '--padding <n>' argument '{value}' is invalid. padding must be a non-negative decimal integer"
                    ));
                }
                padding = Some(value.parse::<f64>().unwrap_or(f64::INFINITY));
            } else {
                if value.is_empty() {
                    return Err("error: option '-o, --output <output>' argument '' is invalid. output path must not be empty".into());
                }
                output = Some(value);
            }
            i += 1;
            continue;
        }
        if !positionals && arg.starts_with("-o") && arg.len() > 2 {
            output = Some(arg[2..].to_string());
            i += 1;
            continue;
        }
        if !positionals && arg.starts_with('-') {
            return Err(format!("error: unknown option '{arg}'"));
        }
        if input.is_some() {
            return Err("error: too many arguments. Expected 1 argument".into());
        }
        input = Some(arg.clone());
        i += 1;
    }
    if help {
        return Ok(Value::Object(vec![(
            "help".encode_utf16().collect(),
            Value::Bool(true),
        )]));
    }
    let output = output.ok_or("error: required option '-o, --output <output>' not specified")?;
    let input = input.ok_or("error: missing required argument 'input'")?;
    let mut fields = vec![
        ("input", s(&input)),
        ("output", s(&output)),
        ("window", Value::Bool(window)),
    ];
    if let Some(padding) = padding {
        fields.push((
            "padding",
            if padding.is_finite() {
                Value::Number(padding)
            } else {
                Value::Object(vec![(
                    "nativeNonFinite".encode_utf16().collect(),
                    Value::Bool(true),
                )])
            },
        ));
    }
    Ok(Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    ))
}
pub const HELP: &str = "Usage: terminal-png-rust [options] <input>\n\nRender a PNG image from ANSI terminal output\n\nArguments:\n  input                  Path to the ANSI input file\n\nOptions:\n  -o, --output <output>  Path to the output PNG file\n  --window               Include terminal window chrome (default: true)\n  --no-window            Exclude terminal window chrome\n  --padding <n>          Padding around terminal content\n  -h, --help              Display help\n";
