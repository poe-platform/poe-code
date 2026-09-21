use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::template::{self, Environment, Lookup, Partials, ValueKind};
#[napi]
pub fn design_color_names() -> Vec<String> {
    toolcraft_design_rust::color::style_names()
        .iter()
        .map(|s| (*s).to_owned())
        .collect()
}
#[napi]
pub fn design_color_style(name: String) -> Option<Utf16String> {
    toolcraft_design_rust::color::style(&name).map(Into::into)
}
#[napi]
pub fn design_color_apply(text: Utf16String, open: Utf16String) -> Utf16String {
    toolcraft_design_rust::color::apply(&text, &open).into()
}
#[napi]
pub fn design_rgb_style(r: f64, g: f64, b: f64, background: bool) -> Utf16String {
    toolcraft_design_rust::color::rgb([r, g, b], background).into()
}
#[napi]
pub fn design_hex_style(text: Utf16String, background: bool) -> Result<Utf16String> {
    toolcraft_design_rust::color::hex(&text, background)
        .map(Into::into)
        .map_err(Error::from_reason)
}
#[napi]
pub fn design_markdown_inline(text: Utf16String, code: bool) -> Utf16String {
    if code {
        toolcraft_design_rust::color::markdown_code(&text)
    } else {
        toolcraft_design_rust::color::markdown_link(&text)
    }
    .into()
}
#[napi]
pub fn design_theme_hint(kind: String, text: String) -> Option<String> {
    toolcraft_design_rust::color::theme_hint(&kind, &text).map(str::to_owned)
}
#[napi]
pub fn design_palette(name: String, primary: Utf16String, light: bool) -> Result<NativeJson> {
    toolcraft_design_rust::palette::palette(&name, &primary, light)
        .map(NativeJson)
        .map_err(Error::from_reason)
}
#[napi]
pub fn design_text_markdown(kind: String, text: Utf16String) -> Utf16String {
    toolcraft_design_rust::color::text_markdown(&kind, &text).into()
}
#[napi(object)]
pub struct Reply {
    pub hit: bool,
    pub truthy: bool,
    pub nullish: bool,
    pub kind: u32,
    pub handle: u32,
    pub empty: bool,
    pub done: bool,
    pub text: Utf16String,
}
type Callback<'a> = Function<'a, FnArgs<(u32, u32, u32, Utf16String, Vec<Utf16String>)>, Reply>;
struct Host<'a> {
    callback: Callback<'a>,
    error: Option<Error>,
}
impl Host<'_> {
    fn call(
        &mut self,
        op: u32,
        handle: usize,
        context: usize,
        text: &[u16],
        stack: &[Vec<u16>],
    ) -> std::result::Result<Reply, template::Error> {
        self.callback
            .call(FnArgs::from((
                op,
                handle as u32,
                context as u32,
                text.to_vec().into(),
                stack.iter().cloned().map(Into::into).collect(),
            )))
            .map_err(|error| {
                if self.error.is_none() {
                    self.error = Some(error);
                }
                template::Error {
                    description: "Template host callback failed".encode_utf16().collect(),
                    line: None,
                    column: None,
                }
            })
    }
}
impl Partials for Host<'_> {
    fn has(&mut self, name: &[u16]) -> std::result::Result<bool, template::Error> {
        Ok(self.call(6, 0, 0, name, &[])?.hit)
    }
    fn get(&mut self, name: &[u16]) -> std::result::Result<Vec<u16>, template::Error> {
        Ok(self.call(7, 0, 0, name, &[])?.text.to_vec())
    }
}
impl Environment for Host<'_> {
    fn lookup(
        &mut self,
        context: usize,
        name: &[u16],
    ) -> std::result::Result<Lookup, template::Error> {
        let value = self.call(0, 0, context, name, &[])?;
        Ok(Lookup {
            hit: value.hit,
            truthy: value.truthy,
            nullish: value.nullish,
            kind: match value.kind {
                1 => ValueKind::Object,
                2 => ValueKind::String,
                3 => ValueKind::Number,
                4 => ValueKind::Array,
                5 => ValueKind::Function,
                _ => ValueKind::Other,
            },
            handle: value.handle as usize,
            empty: value.empty,
        })
    }
    fn text(&mut self, handle: usize) -> std::result::Result<Vec<u16>, template::Error> {
        Ok(self.call(1, handle, 0, &[], &[])?.text.to_vec())
    }
    fn push(
        &mut self,
        parent: usize,
        handle: usize,
    ) -> std::result::Result<usize, template::Error> {
        Ok(self.call(2, handle, parent, &[], &[])?.handle as usize)
    }
    fn iterate(&mut self, handle: usize) -> std::result::Result<usize, template::Error> {
        Ok(self.call(3, handle, 0, &[], &[])?.handle as usize)
    }
    fn next(&mut self, iterator: usize) -> std::result::Result<Option<usize>, template::Error> {
        let value = self.call(4, iterator, 0, &[], &[])?;
        Ok(if value.done {
            None
        } else {
            Some(value.handle as usize)
        })
    }
    fn close(&mut self, iterator: usize) {
        let _ = self.call(5, iterator, 0, &[], &[]);
    }
    fn lambda(
        &mut self,
        handle: usize,
        context: usize,
        raw: &[u16],
        stack: &[Vec<u16>],
    ) -> std::result::Result<Vec<u16>, template::Error> {
        Ok(self.call(8, handle, context, raw, stack)?.text.to_vec())
    }
}
fn object(parts: Vec<(&str, Value)>) -> Value {
    Value::Object(
        parts
            .into_iter()
            .map(|(key, v)| (key.encode_utf16().collect(), v))
            .collect(),
    )
}
fn result(value: std::result::Result<Value, template::Error>) -> NativeJson {
    NativeJson(match value {
        Ok(value) => object(vec![("value", value)]),
        Err(error) => object(vec![(
            "error",
            object(vec![
                ("description", Value::String(error.description)),
                (
                    "line",
                    error
                        .line
                        .map_or(Value::Null, |line| Value::Number(line as f64)),
                ),
                (
                    "column",
                    error
                        .column
                        .map_or(Value::Null, |column| Value::Number(column as f64)),
                ),
            ]),
        )]),
    })
}
#[napi]
pub fn template_partial_names(source: Utf16String) -> NativeJson {
    result(
        template::partial_names(&source)
            .map(|names| Value::Array(names.into_iter().map(Value::String).collect())),
    )
}
#[napi]
pub fn template_expand(source: Utf16String, callback: Callback<'_>) -> Result<NativeJson> {
    let mut host = Host {
        callback,
        error: None,
    };
    let value = template::expand_with(&source, &mut host);
    if let Some(error) = host.error {
        return Err(error);
    }
    Ok(result(value.map(Value::String)))
}
#[napi(object)]
pub struct NativeRenderOptions {
    pub context: u32,
    pub escape_none: bool,
    pub validate: bool,
    pub yield_text: Option<Utf16String>,
    pub in_context: bool,
    pub stack: Vec<Utf16String>,
}
#[napi]
pub fn template_render(
    source: Utf16String,
    callback: Callback<'_>,
    options: NativeRenderOptions,
) -> Result<NativeJson> {
    let mut host = Host {
        callback,
        error: None,
    };
    let value = template::render(
        &source,
        options.context as usize,
        &mut host,
        template::RenderOptions {
            escape_none: options.escape_none,
            validate: options.validate,
            yield_text: options.yield_text.as_ref().map(|s| s.as_ref()),
            in_context: options.in_context,
            partial_stack: options.stack.into_iter().map(|s| s.to_vec()).collect(),
        },
    );
    if let Some(error) = host.error {
        return Err(error);
    }
    Ok(result(value.map(Value::String)))
}

impl toolcraft_design_rust::data::DataHost for Host<'_> {
    fn coerce(&mut self, handle: usize) -> std::result::Result<Option<Vec<u16>>, template::Error> {
        Ok(Some(self.call(1, handle, 0, &[], &[])?.text.to_vec()))
    }
}
#[napi]
pub fn template_render_data(
    source: Utf16String,
    snapshot: Buffer,
    callback: Callback<'_>,
    options: NativeRenderOptions,
) -> Result<NativeJson> {
    use toolcraft_design_rust::data;
    let mut host = Host {
        callback,
        error: None,
    };
    let value = (|| {
        let graph = data::decode(&snapshot)?;
        let mut env = data::DataEnvironment::new(&graph, &mut host)?;
        template::render(
            &source,
            0,
            &mut env,
            template::RenderOptions {
                escape_none: options.escape_none,
                validate: options.validate,
                yield_text: options.yield_text.as_ref().map(|s| s.as_ref()),
                in_context: false,
                partial_stack: vec![],
            },
        )
    })();
    if let Some(error) = host.error {
        return Err(error);
    }
    Ok(result(value.map(Value::String)))
}

#[napi]
pub fn dashboard_layout(
    width: f64,
    height: f64,
    border: f64,
    footer: f64,
    right: f64,
) -> Float64Array {
    Float64Array::new(
        toolcraft_design_rust::layout::geometry([width, height, border, footer, right]).to_vec(),
    )
}

#[napi(object)]
pub struct TerminalFilterReply {
    pub text: Utf16String,
    pub active: bool,
}
#[derive(Default)]
#[napi]
pub struct NativeTerminalStringFilter {
    filter: toolcraft_design_rust::preview::TerminalStringFilter,
}
#[napi]
impl NativeTerminalStringFilter {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            filter: Default::default(),
        }
    }
    #[napi]
    pub fn push(&mut self, text: Utf16String) -> TerminalFilterReply {
        let output = self.filter.push(&text);
        TerminalFilterReply {
            text: output.into(),
            active: self.filter.active(),
        }
    }
}
#[derive(Default)]
#[napi]
pub struct NativeOutputPreviewBuffer {
    buffer: toolcraft_design_rust::preview::PreviewBuffer,
}
#[napi]
impl NativeOutputPreviewBuffer {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            buffer: Default::default(),
        }
    }
    #[napi]
    pub fn push(&mut self, text: Utf16String) {
        self.buffer.push(&text);
    }
    #[napi]
    pub fn text(&self) -> Utf16String {
        self.buffer.text().into()
    }
}
#[napi]
pub fn output_preview_policy() -> NativeJson {
    use toolcraft_design_rust::preview;
    NativeJson(Value::Object(vec![
        (
            "maxChars".encode_utf16().collect(),
            Value::Number(preview::MAX_CHARS as f64),
        ),
        (
            "notice".encode_utf16().collect(),
            Value::String(preview::NOTICE.encode_utf16().collect()),
        ),
        (
            "controls".encode_utf16().collect(),
            Value::Array(
                preview::CONTROL_STARTS
                    .into_iter()
                    .map(|unit| Value::String(vec![unit]))
                    .collect(),
            ),
        ),
    ]))
}
#[napi]
pub fn output_preview_limit(text: Utf16String) -> Utf16String {
    toolcraft_design_rust::preview::limit(&text).into()
}
#[napi]
pub fn output_preview_retain_start(text: Utf16String, start: f64) -> Utf16String {
    toolcraft_design_rust::preview::retain_from_start(&text, start).into()
}
#[napi]
pub fn design_strip_ansi(text: Utf16String) -> Utf16String {
    toolcraft_design_rust::logging::strip(&text).into()
}
#[napi]
pub fn design_brand_known(brand: String) -> bool {
    toolcraft_design_rust::logging::brand_known(&brand)
}
#[napi]
pub fn design_log_symbol(level: String, brand: String, light: bool, color: bool) -> Utf16String {
    toolcraft_design_rust::logging::symbol(&level, &brand, light, color).into()
}
#[napi]
pub fn design_log_render(
    level: String,
    text: Utf16String,
    format: String,
    symbol: Utf16String,
    secondary: Utf16String,
) -> Utf16String {
    toolcraft_design_rust::logging::render(
        &level,
        &text,
        toolcraft_design_rust::logging::format(&format),
        &symbol,
        &secondary,
    )
    .into()
}
#[napi(object)]
pub struct DesignSegmentsReply {
    pub segments: Vec<Utf16String>,
    pub error: bool,
}
#[napi(object)]
pub struct DesignPlanReadReply {
    pub text: Utf16String,
    pub error: bool,
}
fn design_segments(
    segment: &Function<'_, Utf16String, DesignSegmentsReply>,
    text: &[u16],
) -> Result<Vec<Vec<u16>>> {
    let reply = segment.call(text.to_vec().into())?;
    if reply.error {
        return Err(Error::from_reason("Terminal grapheme host failed"));
    }
    Ok(reply.segments.into_iter().map(|s| s.to_vec()).collect())
}
#[napi]
pub fn design_grapheme_width(text: Utf16String) -> u32 {
    toolcraft_design_rust::terminal::grapheme_width(&text) as u32
}
#[napi]
pub fn design_display_width(segments: Vec<Utf16String>, start: f64) -> f64 {
    toolcraft_design_rust::terminal::display_width(
        &segments.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
        start,
    )
}
#[napi]
pub fn design_expand_tabs(segments: Vec<Utf16String>, start: f64) -> Result<Utf16String> {
    toolcraft_design_rust::terminal::expand_tabs(
        &segments.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
        start,
    )
    .map(Into::into)
    .map_err(|reason| Error::new(Status::GenericFailure, reason))
}
#[napi]
pub fn design_truncate_width(segments: Vec<Utf16String>, width: f64) -> Utf16String {
    toolcraft_design_rust::terminal::truncate_overflow(
        &segments.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
        width,
    )
    .into()
}
#[napi]
pub fn design_plain_terminal_text(
    text: Utf16String,
    segment: Function<'_, Utf16String, DesignSegmentsReply>,
) -> Result<Utf16String> {
    toolcraft_design_rust::terminal::plain(&text, |text| design_segments(&segment, text))
        .map(Into::into)
}
#[napi]
pub fn design_agent_plan(
    length: u32,
    read: Function<'_, FnArgs<(u32, bool)>, DesignPlanReadReply>,
    segment: Function<'_, Utf16String, DesignSegmentsReply>,
) -> Result<NativeJson> {
    let (text, detail) = toolcraft_design_rust::terminal::plan(
        length as usize,
        |index, content| {
            let reply = read.call((index as u32, content).into())?;
            if reply.error {
                Err(Error::from_reason("Plan entry host failed"))
            } else {
                Ok(reply.text.to_vec())
            }
        },
        |text| design_segments(&segment, text),
    )?;
    let mut fields = vec![("text".encode_utf16().collect(), Value::String(text))];
    if let Some(detail) = detail {
        fields.push(("detail".encode_utf16().collect(), Value::String(detail)));
    }
    Ok(NativeJson(Value::Object(fields)))
}

#[napi(object)]
pub struct DashboardLineBatch {
    pub lines: Vec<Utf16String>,
    pub remaining: Utf16String,
}
#[derive(Default)]
#[napi]
pub struct NativeDashboardLineBuffer {
    buffer: toolcraft_design_rust::line_buffer::LineBuffer,
}
#[napi]
impl NativeDashboardLineBuffer {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn prepare(&mut self, chunk: Utf16String) -> DashboardLineBatch {
        let (lines, remaining) = self.buffer.prepare(&chunk);
        DashboardLineBatch {
            lines: lines.into_iter().map(Into::into).collect(),
            remaining: remaining.into(),
        }
    }
    #[napi]
    pub fn line(&self, raw: Utf16String) -> Utf16String {
        self.buffer.line(&raw).into()
    }
    #[napi]
    pub fn line_emitted(&mut self) {
        self.buffer.line_emitted();
    }
    #[napi]
    pub fn finish(&mut self, remaining: Utf16String) {
        self.buffer.finish(&remaining);
    }
    #[napi]
    pub fn preview(&self) -> Utf16String {
        self.buffer.preview().into()
    }
    #[napi]
    pub fn has_pending(&self) -> bool {
        self.buffer.has_pending()
    }
    #[napi]
    pub fn reset_pending(&mut self) {
        self.buffer.reset_pending();
    }
}
