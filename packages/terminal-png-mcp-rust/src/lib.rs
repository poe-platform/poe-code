//! Portable terminal MCP tool definition, input admission and rendering.
use mcp_protocol_rust::json::{self, Value};
use terminal_png_rust::{ansi, png, publication, raster, svg};
pub fn definition() -> Value {
    json::parse_utf16(&r#"{"name":"render_terminal_png","description":"Renders ANSI terminal output as a PNG image","inputSchema":{"type":"object","properties":{"ansiText":{"type":"string","description":"ANSI-formatted terminal output to render"},"padding":{"type":"integer","minimum":0,"description":"Padding in pixels around the content"},"window":{"type":"boolean","description":"Whether to render a window chrome around the screenshot"}},"required":["ansiText"]}}"#.encode_utf16().collect::<Vec<_>>(), Default::default()).expect("static tool definition")
}
pub fn render(arguments: &Value) -> Result<Vec<u8>, &'static str> {
    let Some(Value::String(text)) = arguments.get("ansiText") else {
        return Err("ansiText must be a string.");
    };
    publication::validate(arguments)?;
    if arguments
        .get("window")
        .is_some_and(|v| !matches!(v, Value::Bool(_)))
    {
        return Err("window must be a boolean.");
    }
    let padding = match arguments.get("padding") {
        Some(Value::Number(n)) => Some(*n),
        _ => None,
    };
    let source = svg::render(
        &ansi::parse(text),
        svg::Options {
            padding,
            window: arguments.get("window") != Some(&Value::Bool(false)),
        },
    );
    let image = raster::render(&source)?;
    png::encode(image.width, image.height, &image.rgba)
}
pub fn cli(arguments: &[String]) -> Result<bool, String> {
    let mut help = false;
    let mut positionals = false;
    for arg in arguments {
        if !positionals && arg == "--" {
            positionals = true;
            continue;
        }
        if !positionals && arg == "--help" {
            help = true;
        } else if !positionals && arg.starts_with("--help=") {
            return Err("Option '-h, --help' does not take an argument".into());
        } else if !positionals && arg.starts_with("--") {
            let name = arg.split_once('=').map_or(arg.as_str(), |(name, _)| name);
            return Err(format!("Unknown option '{name}'"));
        } else if !positionals && arg.starts_with('-') && arg.len() > 1 {
            for short in arg[1..].chars() {
                if short != 'h' {
                    return Err(format!("Unknown option '-{short}'"));
                }
                help = true;
            }
        } else {
            return Err(format!(
                "Unexpected argument '{arg}'. This command does not take positional arguments"
            ));
        }
    }
    Ok(help)
}
pub const HELP: &str = "Usage: terminal-png-mcp-rust [options]\n\nServe MCP over stdio.\n\nOptions:\n  -h, --help  Show this help message\n";
