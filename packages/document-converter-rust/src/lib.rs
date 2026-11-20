//! Bounded, host-independent conversion of Pandoc JSON or semantic HTML.
pub mod html;
mod pandoc;
pub mod vector;
pub mod drawing;
pub use pandoc::{map as map_pandoc, visible_metadata};

// Pandoc represents GFM tasks with a leading ballot-box character. HTML
// checkboxes lower to the same marker before becoming explicit list-item state.
pub(crate) fn mark_task_item(mut blocks: &mut [document_ast_rust::Block]) {
    use document_ast_rust::{Block, Inline};
    // Inspect the visible prefix across runs before changing any content. None
    // means this scope ended; a marker at the end of the item is an empty task.
    fn boundary(inlines: &[Inline], checked: &mut Option<bool>) -> Option<bool> {
        for inline in inlines {
            match inline {
                Inline::Anchor(_) => {}
                Inline::Direction { inlines, .. } => {
                    if let Some(found) = boundary(inlines, checked) {
                        return Some(found);
                    }
                }
                Inline::Text { text, style } => {
                    if checked.is_none() && style.code {
                        return Some(false);
                    }
                    for c in text.chars() {
                        if checked.is_some() {
                            return Some(c.is_whitespace());
                        }
                        if !c.is_whitespace() {
                            *checked = Some(match c {
                                '☐' => false,
                                '☑' | '☒' => true,
                                _ => return Some(false),
                            });
                        }
                    }
                }
                Inline::Break => return Some(checked.is_some()),
                _ => return Some(false),
            }
        }
        None
    }
    fn remove_prefix(inlines: &mut Vec<Inline>, removed_marker: &mut bool) -> bool {
        let mut index = 0;
        while let Some(inline) = inlines.get_mut(index) {
            match inline {
                Inline::Anchor(_) => index += 1,
                Inline::Direction {
                    inlines: nested, ..
                } => {
                    let finished = remove_prefix(nested, removed_marker);
                    if nested.is_empty() {
                        inlines.remove(index);
                    } else {
                        index += 1;
                    }
                    if finished {
                        return true;
                    }
                }
                Inline::Text { text, style } if !style.code => {
                    let mut rest = text.trim_start();
                    if !*removed_marker && !rest.is_empty() {
                        rest = &rest[rest.chars().next().unwrap().len_utf8()..];
                        *removed_marker = true;
                    }
                    let remove = text.len() - rest.trim_start().len();
                    text.drain(..remove);
                    if !text.is_empty() {
                        return true;
                    }
                    inlines.remove(index);
                }
                _ => return true,
            }
        }
        false
    }
    let paragraph = loop {
        match blocks.first_mut() {
            Some(Block::Direction { blocks: nested, .. }) => blocks = nested,
            Some(Block::Paragraph(paragraph)) => break paragraph,
            _ => return,
        }
    };
    let mut checked = None;
    if boundary(&paragraph.inlines, &mut checked) == Some(false) {
        return;
    }
    if let Some(checked) = checked {
        remove_prefix(&mut paragraph.inlines, &mut false);
        paragraph.list_checked = Some(checked);
    }
}
#[cfg(feature = "wasm-abi")]
mod wasm;
use mcp_protocol_rust::json::{self, Value};
use pdf_ast_rust::{FontFamily, PdfOptions, SuppliedFont};
#[cfg(feature = "wasm-abi")]
pub use wasm::{
    Task, document_alloc, document_drop, document_free, document_result, document_start,
    document_step,
};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Docx,
    Pdf,
}
#[derive(Debug)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}
impl Error {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
pub struct Output {
    pub bytes: Vec<u8>,
    pub diagnostics: Vec<(&'static str, String)>,
    pub usage: Vec<(&'static str, usize)>,
}
pub(crate) type Result<T> = std::result::Result<T, Error>;
pub(crate) fn string(v: &Value) -> Result<String> {
    if let Value::String(s) = v {
        String::from_utf16(s).map_err(|_| Error::new("E_ENCODING", "Invalid Unicode string"))
    } else {
        Err(Error::new("E_AST", "Expected string"))
    }
}
pub(crate) async fn string_async(v: &Value) -> Result<String> {
    let Value::String(units) = v else {
        return Err(Error::new("E_AST", "Expected string"));
    };
    let mut out = String::new();
    let mut start = 0;
    while start < units.len() {
        document_ast_rust::cooperate::yield_now().await;
        let mut end = (start + 4096).min(units.len());
        if end < units.len() && (0xD800..=0xDBFF).contains(&units[end - 1]) {
            end -= 1;
        }
        out.push_str(
            &String::from_utf16(&units[start..end])
                .map_err(|_| Error::new("E_ENCODING", "Invalid Unicode string"))?,
        );
        start = end;
    }
    Ok(out)
}
pub(crate) fn array(v: &Value) -> Result<&[Value]> {
    if let Value::Array(a) = v {
        Ok(a)
    } else {
        Err(Error::new("E_AST", "Expected array"))
    }
}
pub(crate) fn field<'a>(v: &'a Value, k: &str) -> Result<&'a Value> {
    v.get(k)
        .ok_or_else(|| Error::new("E_AST", format!("Missing {k}")))
}
pub(crate) fn at(v: &Value, n: usize) -> Result<&Value> {
    array(v)?
        .get(n)
        .ok_or_else(|| Error::new("E_AST", "Missing array element"))
}
pub(crate) fn number(v: &Value) -> Result<f64> {
    if let Value::Number(n) = v {
        Ok(*n)
    } else {
        Err(Error::new("E_AST", "Expected number"))
    }
}
pub(crate) fn tag(v: &Value) -> Result<String> {
    if matches!(v, Value::String(_)) {
        string(v)
    } else {
        string(field(v, "t")?)
    }
}
fn range<'a>(v: &Value, tail: &'a [u8]) -> Result<&'a [u8]> {
    let start = number(field(v, "offset")?)?;
    let len = number(field(v, "length")?)?;
    if start < 0.
        || len < 0.
        || start.fract() != 0.
        || len.fract() != 0.
        || start + len > tail.len() as f64
    {
        return Err(Error::new("E_AST", "Invalid binary resource range"));
    }
    Ok(&tail[start as usize..(start + len) as usize])
}
fn writer_error(format: Format, message: String) -> Error {
    let code = if message.starts_with("E_LIMIT:") {
        "E_LIMIT"
    } else if message.contains("XML") || message.contains("xml") {
        "E_PARSE"
    } else if format == Format::Pdf {
        "E_CAPABILITY"
    } else {
        "E_UNSUPPORTED_FEATURE"
    };
    Error::new(code, message)
}
pub fn convert(input: &[u8], format: Format) -> Result<Output> {
    document_ast_rust::cooperate::block_on(convert_async(input, format))
}

fn parse_request(input: &[u8]) -> Result<(Value, &[u8])> {
    if input.len() < 4 || input.len() > 256 * 1024 * 1024 {
        return Err(Error::new("E_LIMIT", "Invalid document request size"));
    }
    let length = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
    let json_bytes = input
        .get(4..4usize.saturating_add(length))
        .ok_or_else(|| Error::new("E_AST", "Truncated request"))?;
    let request = json::parse(
        json_bytes,
        json::Limits {
            max_bytes: 64 * 1024 * 1024,
            max_depth: 4096,
            max_nodes: 2_000_000,
        },
    )
    .map_err(|e| Error::new("E_AST", format!("{e:?}")))?;
    Ok((request, &input[4 + length..]))
}

pub async fn convert_async(input: &[u8], format: Format) -> Result<Output> {
    let (request, tail) = parse_request(input)?;
    let limits = request.get("limits");
    let mut retained = 0usize;
    let mut retain = |bytes: usize| -> Result<()> {
        retained += bytes;
        if retained > 256 * 1024 * 1024 {
            return Err(Error::new(
                "E_LIMIT",
                "Document resource copies exceed 256 MiB",
            ));
        }
        bound(limits, "retainedBytes", retained)
    };
    let mut resources = std::collections::BTreeMap::new();
    if let Some(entries) = request.get("resources") {
        let entries = array(entries)?;
        bound(limits, "resources", entries.len())?;
        let mut resource_bytes = 0usize;
        for entry in entries {
            document_ast_rust::cooperate::yield_now().await;
            let bytes = range(entry, tail)?;
            resource_bytes += bytes.len();
            bound(limits, "resourceBytes", resource_bytes)?;
            retain(bytes.len())?;
            resources.insert(string(field(entry, "id")?)?, bytes.to_vec());
        }
    }
    let mut options = PdfOptions::default();
    let mode = string(field(&request, "mode")?)?;
    if mode == "pandoc" {
        options.font_size = 12.;
        options.line_height = 1.2;
    }
    let mut lossy = false;
    if let Some(opts) = request.get("options") {
        lossy = matches!(opts.get("lossy"), Some(Value::Bool(true)));
        if let Some(page) = opts.get("pdfPage") {
            options.page.width = number(field(page, "width")?)?;
            options.page.height = number(field(page, "height")?)?;
            options.page.margin = number(field(page, "margin")?)?;
        }
        if let Some(pdf) = opts.get("pdf") {
            if let Some(v) = pdf.get("fontSize") {
                options.font_size = number(v)?;
            }
            if let Some(v) = pdf.get("lineHeight") {
                options.line_height = number(v)?;
            }
            if let Some(v) = pdf.get("font") {
                options.font_family = match string(v)?.as_str() {
                    "mono" => FontFamily::Mono,
                    "serif" => FontFamily::Serif,
                    _ => FontFamily::Sans,
                };
            }
        }
        if let Some(fonts) = opts.get("pdfFonts") {
            let fonts = array(fonts)?;
            if fonts.is_empty() {
                return Err(Error::new("E_CAPABILITY", "Supply at least one PDF font"));
            }
            bound(limits, "fonts", fonts.len())?;
            let mut font_bytes = 0usize;
            for font in fonts {
                document_ast_rust::cooperate::yield_now().await;
                let bytes = range(font, tail)?;
                font_bytes += bytes.len();
                bound(limits, "binaryBytes", font_bytes)?;
                retain(bytes.len())?;
                options.fonts.push(SuppliedFont {
                    id: string(field(font, "id")?)?,
                    bytes: bytes.to_vec(),
                });
            }
        }
    }
    if let Some(limits) = request.get("limits") {
        macro_rules! limit {
            ($field:ident,$key:literal) => {
                if let Some(v) = limits.get($key) {
                    let n = number(v)?;
                    if n < 0. || n.fract() != 0. {
                        return Err(Error::new("E_OPTION", "Invalid limit"));
                    }
                    options.limits.$field = n as usize;
                }
            };
        }
        limit!(font_bytes, "binaryBytes");
        limit!(fonts, "fonts");
        limit!(glyphs, "glyphs");
        limit!(pages, "pages");
        limit!(objects, "objects");
        limit!(images, "images");
        limit!(image_bytes, "binaryBytes");
        limit!(decoded_image_bytes, "retainedBytes");
        limit!(layout_work, "layoutWork");
        limit!(output_bytes, "outputBytes");
    }
    let mut diagnostics = Vec::new();
    let mut document = if mode == "html" {
        let source = string_async(field(&request, "html")?).await?;
        if source.len() > 64 * 1024 * 1024 {
            return Err(Error::new("E_LIMIT", "Document input exceeds 64 MiB"));
        }
        let nodes = html::dom::bounded_html_dom(&source)
            .ok_or_else(|| Error::new("E_LIMIT", "Document nesting limit exceeded"))?;
        let maximum = |key: &str, default: usize| -> Result<usize> {
            bound(limits, key, 0)?;
            Ok(limits
                .and_then(|limits| limits.get(key))
                .map(number)
                .transpose()?
                .map_or(default, |value| (value as usize).min(default)))
        };
        html::from_html_nodes_async(
            &nodes,
            &resources,
            maximum("nodes", 1_000_000)?,
            maximum("depth", 95)?,
            maximum("images", 200_000)?,
            maximum("retainedBytes", 64 * 1024 * 1024)?,
            format,
        )
        .await
        .map_err(|e| writer_error(format, e))?
    } else if mode == "pandoc" {
        pandoc::map(
            field(&request, "document")?,
            format,
            &resources,
            &mut options,
            lossy,
            request.get("limits"),
            &mut diagnostics,
        )
        .await?
    } else {
        return Err(Error::new("E_OPTION", "Unknown document input mode"));
    };
    if let Some(title) = request.get("title") {
        document.title = string(title)?;
    }
    let (bytes, usage) = match format {
        Format::Docx => docx(&document, request.get("limits")).await?,
        Format::Pdf => {
            let result = pdf_ast_rust::write_pdf_with_usage_async(&document, &options)
                .await
                .map_err(|e| writer_error(format, e))?;
            let u = result.usage;
            (
                result.bytes,
                vec![
                    ("fontBytes", u.font_bytes),
                    ("fonts", u.fonts),
                    ("glyphs", u.glyphs),
                    ("pages", u.pages),
                    ("objects", u.objects),
                    ("imageBytes", u.image_bytes),
                    ("decodedImageBytes", u.decoded_image_bytes),
                    ("layoutWork", u.layout_work),
                ],
            )
        }
    };
    if bytes.len() > options.limits.output_bytes {
        return Err(Error::new("E_LIMIT", "Document output limit exceeded"));
    }
    Ok(Output {
        bytes,
        diagnostics,
        usage,
    })
}
fn bound(limits: Option<&Value>, key: &str, amount: usize) -> Result<()> {
    if let Some(value) = limits.and_then(|v| v.get(key)) {
        if amount as f64 > number(value)? {
            return Err(Error::new(
                "E_LIMIT",
                format!("{key}: document limit exceeded"),
            ));
        }
    }
    Ok(())
}
async fn docx(
    document: &document_ast_rust::Document,
    limits: Option<&Value>,
) -> Result<(Vec<u8>, Vec<(&'static str, usize)>)> {
    let package = docx_ast_rust::to_package_async(document)
        .await
        .map_err(|e| writer_error(Format::Docx, e))?;
    bound(limits, "parts", package.parts.len())?;
    let mut expanded = 0usize;
    let mut serialized = 22usize;
    let mut nodes = 0usize;
    let check_xml =
        limits.is_some_and(|l| l.get("xmlNodes").is_some() || l.get("xmlDepth").is_some());
    for part in &package.parts {
        document_ast_rust::cooperate::yield_now().await;
        expanded = expanded
            .checked_add(part.bytes.len())
            .ok_or_else(|| Error::new("E_LIMIT", "Office package size overflow"))?;
        serialized = serialized
            .checked_add(part.bytes.len() + 76 + 2 * part.name.len())
            .ok_or_else(|| Error::new("E_LIMIT", "Office package size overflow"))?;
        bound(limits, "expandedBytes", expanded)?;
        bound(limits, "compressedBytes", serialized)?;
        bound(limits, "outputBytes", serialized)?;
        if part.name.ends_with(".xml") || part.name.ends_with(".rels") {
            bound(limits, "binaryBytes", part.bytes.len())?;
            if check_xml {
                let source = std::str::from_utf8(&part.bytes)
                    .map_err(|_| Error::new("E_ENCODING", "Invalid Office XML"))?;
                let mut parser = office_package_rust::xml::Parser::new(None, None, true);
                let mut at = 0;
                while at < source.len() {
                    let mut end = (at + 4096).min(source.len());
                    while !source.is_char_boundary(end) {
                        end -= 1;
                    }
                    parser
                        .feed(&source[at..end])
                        .map_err(|e| writer_error(Format::Docx, e))?;
                    at = end;
                    document_ast_rust::cooperate::yield_now().await;
                }
                let tree = parser.finish().map_err(|e| writer_error(Format::Docx, e))?;
                let mut stack = tree
                    .nodes
                    .iter()
                    .map(|node| (node, 1usize))
                    .collect::<Vec<_>>();
                while let Some((node, depth)) = stack.pop() {
                    document_ast_rust::cooperate::yield_now().await;
                    nodes += 1;
                    bound(limits, "xmlNodes", nodes)?;
                    bound(limits, "xmlDepth", depth)?;
                    if let office_package_rust::xml::Node::Element(element) = node {
                        nodes += element.attrs.len();
                        bound(limits, "xmlNodes", nodes)?;
                        for child in &element.children {
                            stack.push((child, depth + 1));
                        }
                    }
                }
            }
        }
    }
    Ok((
        package
            .write_async()
            .await
            .map_err(|e| writer_error(Format::Docx, e))?,
        vec![("parts", package.parts.len()), ("expandedBytes", expanded)],
    ))
}
