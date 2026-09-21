use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use terminal_png_rust::ansi::{Color, Run};
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn obj(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn color(value: Option<Color>) -> Value {
    match value {
        None => Value::Null,
        Some(Color::Ansi4(n)) => obj(vec![
            ("type", s("ansi4")),
            ("index", Value::Number(f64::from(n))),
        ]),
        Some(Color::Ansi8(n)) => obj(vec![
            ("type", s("ansi8")),
            ("index", Value::Number(f64::from(n))),
        ]),
        Some(Color::Rgb(r, g, b)) => obj(vec![
            ("type", s("rgb")),
            ("r", Value::Number(f64::from(r))),
            ("g", Value::Number(f64::from(g))),
            ("b", Value::Number(f64::from(b))),
        ]),
    }
}
fn run(value: Run) -> Value {
    let style = value.style;
    obj(vec![
        ("text", Value::String(value.text)),
        ("fg", color(style.fg)),
        ("bg", color(style.bg)),
        ("bold", Value::Bool(style.bold)),
        ("italic", Value::Bool(style.italic)),
        ("underline", Value::Bool(style.underline)),
        ("strikethrough", Value::Bool(style.strikethrough)),
        ("dim", Value::Bool(style.dim)),
        ("inverse", Value::Bool(style.inverse)),
        ("conceal", Value::Bool(style.conceal)),
    ])
}
#[napi]
pub fn parse_ansi(input: Utf16String) -> NativeJson {
    NativeJson(Value::Array(
        terminal_png_rust::ansi::parse(&input)
            .into_iter()
            .map(run)
            .collect(),
    ))
}
#[napi]
pub fn render_terminal_svg(runs: Utf16String, options: Utf16String) -> Result<Utf16String> {
    let parse = |v: &[u16]| {
        mcp_protocol_rust::json::parse_utf16(v, Default::default())
            .map_err(|_| Error::from_reason("Invalid renderer input"))
    };
    let Value::Array(runs) = parse(&runs)? else {
        return Err(Error::from_reason("runs must be an array"));
    };
    let options = parse(&options)?;
    let padding = if let Some(Value::Number(n)) = options.get("padding") {
        Some(*n)
    } else {
        None
    };
    let window = options.get("window") != Some(&Value::Bool(false));
    let runs = runs
        .iter()
        .map(terminal_png_rust::ansi::run_from_value)
        .collect::<Vec<_>>();
    Ok(
        terminal_png_rust::svg::render(&runs, terminal_png_rust::svg::Options { padding, window })
            .encode_utf16()
            .collect::<Vec<_>>()
            .into(),
    )
}
#[napi]
pub fn terminal_font_face_css() -> &'static str {
    terminal_png_rust::svg::font_face_css()
}
#[napi]
pub fn terminal_regular_base64() -> &'static str {
    terminal_png_rust::svg::REGULAR_BASE64
}
#[napi]
pub fn terminal_graphemes(input: Utf16String) -> Vec<Utf16String> {
    terminal_png_rust::grapheme::segments(&input)
        .into_iter()
        .map(|t| t.to_vec().into())
        .collect()
}
#[napi]
pub fn terminal_deflate(input: Buffer) -> Buffer {
    terminal_png_rust::png::deflate(&input).into()
}
#[napi]
pub fn terminal_encode_png(width: u32, height: u32, rgba: Buffer) -> Result<Buffer> {
    terminal_png_rust::png::encode(width, height, &rgba)
        .map(Into::into)
        .map_err(Error::from_reason)
}
#[napi]
pub fn render_terminal_png_svg(svg: String) -> Result<Buffer> {
    let image = terminal_png_rust::raster::render(&svg).map_err(Error::from_reason)?;
    terminal_png_rust::png::encode(image.width, image.height, &image.rgba)
        .map(Into::into)
        .map_err(Error::from_reason)
}
#[napi]
pub fn terminal_raster_rgba(svg: String) -> Result<Buffer> {
    Ok(terminal_png_rust::raster::render(&svg)
        .map_err(Error::from_reason)?
        .rgba
        .into())
}
#[napi]
pub fn validate_terminal_render_options(options: Utf16String) -> Result<()> {
    let options = mcp_protocol_rust::json::parse_utf16(&options, Default::default())
        .map_err(|_| Error::from_reason("Invalid renderer options"))?;
    terminal_png_rust::publication::validate(&options).map_err(Error::from_reason)
}
#[napi]
pub struct NativeTerminalPublication {
    state: terminal_png_rust::publication::Publication,
}
#[napi]
impl NativeTerminalPublication {
    #[napi(constructor)]
    pub fn new(output: Utf16String, entropy: Utf16String) -> Self {
        Self {
            state: terminal_png_rust::publication::Publication::new(&output, &entropy),
        }
    }
    #[napi(getter)]
    pub fn temporary_path(&self) -> Utf16String {
        self.state.temporary_path().to_vec().into()
    }
    #[napi]
    pub fn written(&mut self) {
        self.state.written();
    }
    #[napi]
    pub fn cleanup(&self, error_instance: bool, own_code: bool, code: Option<String>) -> bool {
        self.state
            .cleanup(error_instance, own_code, code.as_deref().unwrap_or(""))
    }
}
#[napi]
pub fn terminal_cli_options(args: Utf16String) -> Result<NativeJson> {
    let args = mcp_protocol_rust::json::parse_utf16(&args, Default::default())
        .map_err(|_| Error::from_reason("Invalid CLI arguments"))?;
    terminal_png_rust::cli::options(&args)
        .map(NativeJson)
        .map_err(Error::from_reason)
}
#[napi]
pub fn terminal_cli_help() -> &'static str {
    terminal_png_rust::cli::HELP
}
