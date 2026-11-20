use super::*;
use crate::html::{
    HtmlImages, HtmlScope, HtmlToken, append_html_text, apply_css_text_style, css_property,
    html_notes, html_tokens, raw_html_blocks_async, raw_html_nodes,
};
use document_ast_rust::*;
use std::collections::BTreeMap;
struct Mapper<'a> {
    format: Format,
    resources: &'a BTreeMap<String, Vec<u8>>,
    html_images: HtmlImages<'a>,
    lossy: bool,
    diagnostics: &'a mut Vec<(&'static str, String)>,
    page_width: f64,
    limits: Option<&'a Value>,
    nodes: usize,
    images: usize,
    image_bytes: usize,
    raw_html: bool,
    forced_bold: bool,
}
pub async fn map(
    input: &Value,
    format: Format,
    resources: &BTreeMap<String, Vec<u8>>,
    options: &mut PdfOptions,
    lossy: bool,
    limits: Option<&Value>,
    diagnostics: &mut Vec<(&'static str, String)>,
) -> Result<Document> {
    let direction = input
        .get("direction")
        .map(|value| direction_value(&string(value)?))
        .transpose()?;
    let mut mapper = Mapper {
        format,
        resources,
        html_images: HtmlImages::new(resources, format),
        lossy,
        diagnostics,
        page_width: options.page.width - 2. * options.page.margin,
        limits,
        nodes: 0,
        images: 0,
        image_bytes: 0,
        raw_html: false,
        forced_bold: false,
    };
    let metadata = input
        .get("metadata")
        .map(visible_metadata)
        .transpose()?
        .unwrap_or(Value::Object(vec![]));
    let mut blocks = Vec::new();
    for key in ["title", "subtitle", "author", "date"] {
        let Some(value) = metadata.get(key) else {
            continue;
        };
        let values = if tag(value)? == "MetaList" {
            array(field(value, "c")?)?
        } else {
            std::slice::from_ref(value)
        };
        for value in values {
            document_ast_rust::cooperate::yield_now().await;
            mapper.account_node()?;
            let style = TextStyle {
                bold: key == "title",
                italic: key == "subtitle",
                ..Default::default()
            };
            let inlines = if tag(value)? == "MetaString" {
                mapper.account_node()?;
                mapper.depth(1)?;
                vec![text(string_async(field(value, "c")?).await?, style)]
            } else {
                Box::pin(mapper.inlines(metadata_inlines(value)?.unwrap(), style, 1)).await?
            };
            blocks.push(Block::Paragraph(Paragraph {
                inlines,
                align: Align::Center,
                keep_with_next: true,
                ..Default::default()
            }));
        }
    }
    blocks.extend(
        Box::pin(mapper.blocks(field(input, "blocks")?, TextStyle::default(), 0, 0)).await?,
    );
    if let Some(direction) = direction {
        blocks = vec![Block::Direction { direction, blocks }];
    }
    let title = metadata
        .get("title")
        .map(meta_text)
        .transpose()?
        .unwrap_or_default();
    if format == Format::Pdf {
        if metadata.get("title").is_some() {
            options.metadata.title = Some(title.clone());
        }
        if let Some(value) = metadata.get("author") {
            let values = if tag(value)? == "MetaList" {
                array(field(value, "c")?)?
            } else {
                std::slice::from_ref(value)
            };
            options.metadata.author = Some(
                values
                    .iter()
                    .map(meta_text)
                    .collect::<Result<Vec<_>>>()?
                    .join("; "),
            );
        }
        if let Some(meta) = input.get("metadata") {
            for key in ["subject", "keywords"] {
                if let Some(value) = meta.get(key) {
                    let values = if tag(value)? == "MetaList" {
                        array(field(value, "c")?)?
                    } else {
                        std::slice::from_ref(value)
                    };
                    let mut texts = Vec::new();
                    for value in values {
                        if inline_metadata(value, true)? {
                            texts.push(meta_text(value)?);
                        }
                    }
                    if key == "subject" {
                        options.metadata.subject = Some(texts.join(" "));
                    } else {
                        options.metadata.keywords = texts;
                    }
                }
            }
        }
    }
    Ok(Document { title, blocks })
}

/// Select the title block using Pandoc's inline-compatible metadata shapes.
/// Resource discovery must use this same selection before rendering metadata.
pub fn visible_metadata(metadata: &Value) -> Result<Value> {
    let mut selected = Vec::new();
    for key in ["title", "subtitle", "author", "date"] {
        let Some(value) = metadata.get(key) else {
            continue;
        };
        let value = if key == "author" && tag(value)? == "MetaList" {
            let mut authors = Vec::new();
            for author in array(field(value, "c")?)? {
                if inline_metadata(author, true)? {
                    authors.push(author.clone());
                }
            }
            Value::Object(vec![
                (
                    "t".encode_utf16().collect(),
                    Value::String("MetaList".encode_utf16().collect()),
                ),
                ("c".encode_utf16().collect(), Value::Array(authors)),
            ])
        } else if inline_metadata(value, key != "author")? {
            value.clone()
        } else {
            continue;
        };
        selected.push((key.encode_utf16().collect(), value));
    }
    Ok(Value::Object(selected))
}
fn metadata_inlines(value: &Value) -> Result<Option<&Value>> {
    match tag(value)?.as_str() {
        "MetaInlines" => Ok(Some(field(value, "c")?)),
        "MetaBlocks" => {
            let blocks = array(field(value, "c")?)?;
            if blocks.len() == 1 && matches!(tag(&blocks[0])?.as_str(), "Para" | "Plain") {
                Ok(Some(field(&blocks[0], "c")?))
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}
fn inline_metadata(value: &Value, blocks: bool) -> Result<bool> {
    Ok(match tag(value)?.as_str() {
        "MetaString" | "MetaInlines" => true,
        "MetaBlocks" if blocks => metadata_inlines(value)?.is_some(),
        _ => false,
    })
}

fn text(text: String, style: TextStyle) -> Inline {
    Inline::Text { text, style }
}
fn inline_tail(inlines: &[Inline]) -> Option<char> {
    inlines.iter().rev().find_map(|inline| match inline {
        Inline::Text { text, .. } => text.chars().next_back(),
        Inline::Direction { inlines, .. } => inline_tail(inlines),
        Inline::Anchor(_) => None,
        Inline::Break => Some('\n'),
        Inline::Image(_) | Inline::Note(_) | Inline::RawOpenXml(_) => Some('\u{fffc}'),
    })
}
fn meta_text(value: &Value) -> Result<String> {
    if tag(value)? == "MetaString" {
        string(field(value, "c")?)
    } else if let Some(inlines) = metadata_inlines(value)? {
        plain(inlines)
    } else {
        Ok(String::new())
    }
}
fn plain(nodes: &Value) -> Result<String> {
    let mut out = String::new();
    for node in array(nodes)? {
        let t = tag(node)?;
        let c = node.get("c");
        match t.as_str() {
            "Note" | "RawInline" => {}
            "Str" => out.push_str(&string(field(node, "c")?)?),
            "Space" | "SoftBreak" => out.push(' '),
            "LineBreak" => out.push('\n'),
            "Code" => out.push_str(&string(at(field(node, "c")?, 1)?)?),
            "Span" | "Link" | "Image" | "Cite" => out.push_str(&plain(at(field(node, "c")?, 1)?)?),
            "Quoted" => {
                let content = field(node, "c")?;
                let single = tag(at(content, 0)?)? == "SingleQuote";
                out.push(if single { '‘' } else { '“' });
                out.push_str(&plain(at(content, 1)?)?);
                out.push(if single { '’' } else { '”' });
            }
            _ => {
                if let Some(v) = c {
                    if matches!(v, Value::Array(_)) {
                        out.push_str(&plain(v)?);
                    }
                }
            }
        }
    }
    Ok(out)
}
fn attrs(value: &Value) -> Result<BTreeMap<String, String>> {
    let mut result = BTreeMap::new();
    for pair in array(at(value, 2)?)? {
        result.insert(string(at(pair, 0)?)?, string(at(pair, 1)?)?);
    }
    Ok(result)
}
fn direction_value(value: &str) -> Result<Direction> {
    match value.to_ascii_lowercase().as_str() {
        "ltr" => Ok(Direction::Ltr),
        "rtl" => Ok(Direction::Rtl),
        _ => Err(Error::new(
            "E_CAPABILITY",
            format!("Unsupported or unresolved document direction: {value}"),
        )),
    }
}
fn attr_direction(value: &Value, inline: bool) -> Result<Option<(Direction, bool)>> {
    let attributes = attrs(value)?;
    let html_direction = attributes
        .get("dir")
        .map(|value| direction_value(value))
        .transpose()?;
    let mut css_direction = None;
    let mut bidi = None;
    if let Some(style) = attributes.get("style") {
        for declaration in style.split(';') {
            if let Some((name, value)) = declaration.split_once(':') {
                match name.trim().to_ascii_lowercase().as_str() {
                    "direction" => css_direction = Some(value),
                    "unicode-bidi" => bidi = Some(value.trim().to_ascii_lowercase()),
                    _ => {}
                }
            }
        }
    }
    let css_direction = css_direction
        .map(|value| direction_value(value.trim()))
        .transpose()?;
    let direction = css_direction.or(html_direction);
    let override_order = match bidi.as_deref() {
        None => false,
        Some("isolate") if direction.is_some() => false,
        Some("isolate-override") if inline && direction.is_some() => true,
        Some(value) => {
            return Err(Error::new(
                "E_CAPABILITY",
                format!("Unsupported document unicode-bidi scope: {value}"),
            ));
        }
    };
    if inline && html_direction.is_none() && css_direction.is_some() && bidi.is_none() {
        return Err(Error::new(
            "E_CAPABILITY",
            "Inline CSS direction requires explicit isolation",
        ));
    }
    Ok(direction.map(|direction| (direction, override_order)))
}
fn alignment(value: &Value) -> Result<Align> {
    Ok(match tag(value)?.as_str() {
        "AlignLeft" => Align::Left,
        "AlignRight" => Align::Right,
        "AlignCenter" => Align::Center,
        _ => Align::Default,
    })
}
impl Mapper<'_> {
    fn html_error(&self, message: String) -> Error {
        writer_error(self.format, message)
    }
    fn account_node(&mut self) -> Result<()> {
        self.nodes = self.nodes.saturating_add(1);
        bound(self.limits, "nodes", self.nodes)
    }
    fn account_image(&mut self) -> Result<()> {
        self.images = self.images.saturating_add(1);
        bound(self.limits, "images", self.images)
    }
    fn bound_image_memory(&self) -> Result<()> {
        let maximum = if self.raw_html { 64 } else { 256 } * 1024 * 1024;
        if self.image_bytes > maximum {
            return Err(Error::new(
                "E_LIMIT",
                "Document image content limit exceeded",
            ));
        }
        bound(self.limits, "retainedBytes", self.image_bytes)
    }
    async fn raw_tokens(
        &mut self,
        tokens: Vec<(std::ops::Range<usize>, HtmlToken)>,
        depth: usize,
        scopes: usize,
    ) -> Result<Vec<(std::ops::Range<usize>, HtmlToken)>> {
        self.raw_html = true;
        bound(self.limits, "nodes", self.nodes)?;
        bound(self.limits, "images", self.images)?;
        self.bound_image_memory()?;
        let mut nesting = scopes;
        for (_, token) in &tokens {
            document_ast_rust::cooperate::yield_now().await;
            match token {
                HtmlToken::Open(scope) => {
                    if scope.has_footnotes() {
                        return self.fail("Raw HTML footnotes require one complete RawBlock");
                    }
                    self.account_node()?;
                    if self.forced_bold && scope.resets_bold() {
                        return self.fail("Raw HTML font-weight reset cannot override heading or table-header emphasis");
                    }
                    if scope.tag() == "img" {
                        self.account_image()?;
                        if let Some(source) = scope.image_source() {
                            let bytes = self
                                .html_images
                                .byte_len(source)
                                .map_err(|error| self.html_error(error))?;
                            self.image_bytes = self.image_bytes.saturating_add(bytes);
                            self.bound_image_memory()?;
                        }
                    }
                    if !scope.is_void() {
                        nesting += 1;
                    }
                    if depth.saturating_add(nesting) > 96 {
                        return Err(Error::new("E_LIMIT", "Raw HTML nesting limit exceeded"));
                    }
                    bound(self.limits, "depth", depth.saturating_add(nesting))?;
                }
                HtmlToken::Close(_) => nesting = nesting.saturating_sub(1),
                HtmlToken::Text(_) => self.account_node()?,
            }
        }
        Ok(tokens)
    }
    async fn raw_note_blocks(
        &mut self,
        html: &str,
        tokens: &[(std::ops::Range<usize>, HtmlToken)],
        inherited: &TextStyle,
        depth: usize,
    ) -> Result<Vec<Block>> {
        self.raw_html = true;
        self.bound_image_memory()?;
        let remaining = |key: &str, used: usize, maximum: usize| -> Result<usize> {
            bound(self.limits, key, used)?;
            Ok(self
                .limits
                .and_then(|limits| limits.get(key))
                .map(number)
                .transpose()?
                .map_or(maximum, |value| (value as usize).min(maximum))
                .saturating_sub(used))
        };
        let max_nodes = remaining("nodes", self.nodes, usize::MAX)?.min(1_000_000);
        let max_images = remaining("images", self.images, usize::MAX)?;
        let max_bytes = remaining("retainedBytes", self.image_bytes, 64 * 1024 * 1024)?;
        let depth = depth.saturating_add(1);
        bound(self.limits, "depth", depth)?;
        if depth > 96 {
            return Err(Error::new("E_LIMIT", "Raw HTML nesting limit exceeded"));
        }
        let max_depth = remaining("depth", depth, 96)?;
        let nodes = raw_html_nodes(html, tokens, inherited, self.forced_bold)
            .await
            .map_err(|error| self.html_error(error))?;
        let notes = html_notes(&nodes, inherited, max_nodes, max_depth, 64 * 1024 * 1024)
            .await
            .map_err(|error| self.html_error(error))?;
        let (nodes_used, images_used, bytes_used) = self
            .html_images
            .admit_nodes(&nodes, max_nodes, max_depth, max_images, max_bytes, &notes)
            .await
            .map_err(|error| self.html_error(error))?;
        let source_nodes = tokens
            .iter()
            .filter(|(_, token)| !matches!(token, HtmlToken::Close(_)))
            .count();
        self.nodes = self.nodes.saturating_add(nodes_used.max(source_nodes));
        bound(self.limits, "nodes", self.nodes)?;
        self.images = self.images.saturating_add(images_used);
        self.image_bytes = self.image_bytes.saturating_add(bytes_used);
        let blocks = crate::html::blocks(&nodes, inherited, &self.html_images, &notes, false)
            .map_err(|error| self.html_error(error))?;
        Ok(blocks)
    }
    fn fail<T>(&self, message: impl Into<String>) -> Result<T> {
        Err(Error::new(
            if self.format == Format::Pdf {
                "E_CAPABILITY"
            } else {
                "E_UNSUPPORTED_FEATURE"
            },
            message,
        ))
    }
    fn attr_style(&self, attr: &Value, mut inherited: TextStyle) -> Result<TextStyle> {
        if let Some(css) = attrs(attr)?.get("style") {
            if self.forced_bold
                && css_property(css, "font-weight")
                    .is_some_and(|value| value.eq_ignore_ascii_case("normal") || value == "400")
            {
                return self.fail(
                    "CSS font-weight reset cannot override heading or table-header emphasis",
                );
            }
            apply_css_text_style(css, &mut inherited);
        }
        Ok(inherited)
    }
    fn depth(&self, depth: usize) -> Result<()> {
        if depth > 1024 {
            Err(Error::new("E_LIMIT", "Document nesting limit exceeded"))
        } else {
            bound(self.limits, "depth", depth)
        }
    }
    async fn inlines(
        &mut self,
        nodes: &Value,
        mut style: TextStyle,
        depth: usize,
    ) -> Result<Vec<Inline>> {
        self.depth(depth)?;
        let mut out = Vec::new();
        let mut scopes: Vec<(HtmlScope, TextStyle, Vec<Inline>)> = Vec::new();
        for node in array(nodes)? {
            document_ast_rust::cooperate::yield_now().await;
            self.account_node()?;
            let child_depth = depth.saturating_add(scopes.len()).saturating_add(1);
            let t = tag(node)?;
            let c = node.get("c").unwrap_or(&Value::Null);
            let start = out.len();
            let direction = if matches!(t.as_str(), "Code" | "Span" | "Link" | "Image") {
                attr_direction(at(c, 0)?, true)?
            } else {
                None
            };
            match t.as_str() {
                "Str" => out.push(text(string_async(c).await?, style.clone())),
                "Space" | "SoftBreak" => out.push(text(" ".into(), style.clone())),
                "LineBreak" => out.push(Inline::Break),
                "Code" => {
                    let id = string(at(at(c, 0)?, 0)?)?;
                    if !id.is_empty() {
                        out.push(Inline::Anchor(id));
                    }
                    let mut s = style.clone();
                    s.code = true;
                    out.push(text(string_async(at(c, 1)?).await?, s));
                }
                "Strong" | "Emph" | "Underline" | "Strikeout" | "Superscript" | "Subscript" => {
                    let mut s = style.clone();
                    match t.as_str() {
                        "Strong" => s.bold = true,
                        "Emph" => s.italic = true,
                        "Underline" => s.underline = true,
                        "Strikeout" => s.strike = true,
                        "Superscript" => {
                            s.sup = true;
                            s.sub = false;
                        }
                        _ => {
                            s.sub = true;
                            s.sup = false;
                        }
                    }
                    out.extend(Box::pin(self.inlines(c, s, child_depth)).await?);
                }
                "Span" | "Link" => {
                    let attr = at(c, 0)?;
                    let id = string(at(attr, 0)?)?;
                    if !id.is_empty() {
                        out.push(Inline::Anchor(id));
                    }
                    let mut s = style.clone();
                    if t == "Link" {
                        s.link = Some(string(at(at(c, 2)?, 0)?)?);
                        if self.format == Format::Pdf {
                            s.color = Some("0563C1".into());
                            s.underline = true;
                        }
                    } else {
                        if array(at(attr, 1)?)?
                            .iter()
                            .any(|v| string(v).ok().as_deref() == Some("mark"))
                        {
                            s.highlight = Some("FFF3A3".into());
                        }
                        s = self.attr_style(attr, s)?;
                    }
                    out.extend(Box::pin(self.inlines(at(c, 1)?, s, child_depth)).await?);
                }
                "Cite" => {
                    out.extend(Box::pin(self.inlines(at(c, 1)?, style.clone(), child_depth)).await?)
                }
                "Quoted" => {
                    let single = tag(at(c, 0)?)? == "SingleQuote";
                    out.push(text(if single { "‘" } else { "“" }.into(), style.clone()));
                    out.extend(
                        Box::pin(self.inlines(at(c, 1)?, style.clone(), child_depth)).await?,
                    );
                    out.push(text(if single { "’" } else { "”" }.into(), style.clone()));
                }
                "Image" => {
                    self.account_image()?;
                    let id = string(at(at(c, 0)?, 0)?)?;
                    if !id.is_empty() {
                        out.push(Inline::Anchor(id));
                    }
                    let mut image = self.image(c).await?;
                    image.link = style.link.clone();
                    out.push(Inline::Image(image));
                }
                "Note" => {
                    let forced_bold = std::mem::replace(&mut self.forced_bold, false);
                    let blocks =
                        Box::pin(self.blocks(c, TextStyle::default(), child_depth, 0)).await;
                    self.forced_bold = forced_bold;
                    out.push(Inline::Note(blocks?));
                }
                "RawInline" => {
                    let format = string(at(c, 0)?)?;
                    if format == "openxml" && self.format == Format::Docx {
                        out.push(Inline::RawOpenXml(string_async(at(c, 1)?).await?));
                    } else if format == "html" {
                        let html = string_async(at(c, 1)?).await?;
                        let tokens = html_tokens(&html).map_err(|error| self.html_error(error))?;
                        for (_, token) in self.raw_tokens(tokens, depth, scopes.len()).await? {
                            document_ast_rust::cooperate::yield_now().await;
                            match token {
                                HtmlToken::Text(value) => {
                                    let previous = inline_tail(&out).or_else(|| {
                                        scopes
                                            .iter()
                                            .rev()
                                            .find_map(|(_, _, prefix)| inline_tail(prefix))
                                    });
                                    append_html_text(&mut out, &value, &style, previous);
                                }
                                HtmlToken::Open(scope) if scope.is_void() => {
                                    out.extend(
                                        scope
                                            .finish_inlines_async(
                                                Vec::new(),
                                                &style,
                                                &mut self.html_images,
                                            )
                                            .await
                                            .map_err(|error| self.html_error(error))?,
                                    );
                                }
                                HtmlToken::Open(scope) => {
                                    if scope.tag() == "a"
                                        && (style.link.is_some()
                                            || scopes.iter().any(|(scope, ..)| scope.tag() == "a"))
                                    {
                                        return self.fail("Nested raw HTML links are unsupported");
                                    }
                                    let next = scope
                                        .inline_style(&style)
                                        .map_err(|error| self.html_error(error))?;
                                    scopes.push((
                                        scope,
                                        std::mem::replace(&mut style, next),
                                        std::mem::take(&mut out),
                                    ));
                                }
                                HtmlToken::Close(tag) => {
                                    let Some((scope, parent, mut prior)) = scopes.pop() else {
                                        return self.fail(format!(
                                            "Unmatched raw HTML closing tag: {tag}"
                                        ));
                                    };
                                    if scope.tag() != tag {
                                        return self.fail(format!(
                                            "Mismatched raw HTML closing tag: {tag}; expected {}",
                                            scope.tag()
                                        ));
                                    }
                                    prior.extend(
                                        scope
                                            .finish_inlines_async(
                                                out,
                                                &parent,
                                                &mut self.html_images,
                                            )
                                            .await
                                            .map_err(|error| self.html_error(error))?,
                                    );
                                    out = prior;
                                    style = parent;
                                }
                            }
                        }
                    } else {
                        return self.fail(format!(
                            "Unsupported {:?} raw inline format: {format}",
                            self.format
                        ));
                    }
                }
                "Math" if self.format == Format::Pdf && self.lossy => {
                    self.diagnostics.push((
                        "W_TABLE_LOSS",
                        "Rendered readable math source; no mathematical typesetting".into(),
                    ));
                    out.push(text(
                        format!("[math source: {}]", string(at(c, 1)?)?),
                        style.clone(),
                    ));
                }
                _ => return self.fail(format!("Unsupported {:?} inline: {t}", self.format)),
            }
            if let Some((direction, override_order)) = direction {
                let inlines = out.split_off(start);
                out.push(Inline::Direction {
                    direction,
                    override_order,
                    inlines,
                });
            }
        }
        if let Some((scope, ..)) = scopes.last() {
            return self.fail(format!("Unclosed raw HTML inline tag: {}", scope.tag()));
        }
        Ok(out)
    }
    async fn blocks(
        &mut self,
        nodes: &Value,
        mut style: TextStyle,
        depth: usize,
        list_depth: usize,
    ) -> Result<Vec<Block>> {
        self.depth(depth)?;
        let mut out = Vec::new();
        let mut scopes: Vec<(HtmlScope, TextStyle, Vec<Block>)> = Vec::new();
        for node in array(nodes)? {
            document_ast_rust::cooperate::yield_now().await;
            self.account_node()?;
            let child_depth = depth.saturating_add(scopes.len()).saturating_add(1);
            let t = tag(node)?;
            let c = node.get("c").unwrap_or(&Value::Null);
            let start = out.len();
            let direction = match t.as_str() {
                "Header" => attr_direction(at(c, 1)?, false)?,
                "CodeBlock" | "Div" | "Figure" | "Table" => attr_direction(at(c, 0)?, false)?,
                _ => None,
            };
            match t.as_str() {
                "Null" => {}
                "Vector" => {
                    let scene = crate::vector::from_json(c).await?;
                    let mut pending = vec![(scene.nodes.as_slice(), child_depth)];
                    while let Some((nodes, level)) = pending.pop() {
                        self.depth(level)?;
                        for node in nodes {
                            document_ast_rust::cooperate::yield_now().await;
                            self.account_node()?;
                            self.nodes = self.nodes.saturating_add(node.clip.as_ref().map_or(0, |p| p.segments.len()));
                            match &node.kind {
                                document_ast_rust::vector::NodeKind::Group(children) => pending.push((children, level + 1)),
                                document_ast_rust::vector::NodeKind::Path { path, stroke, .. } => {
                                    self.nodes = self.nodes.saturating_add(path.segments.len()).saturating_add(stroke.as_ref().map_or(0, |s| s.dash.len()));
                                }
                                document_ast_rust::vector::NodeKind::Raster(image) => {
                                    self.account_image()?;
                                    self.image_bytes = self.image_bytes.saturating_add(image.bytes.len());
                                    self.bound_image_memory()?;
                                }
                                document_ast_rust::vector::NodeKind::Text(_) => {}
                            }
                            bound(self.limits, "nodes", self.nodes)?;
                        }
                    }
                    out.push(Block::Vector(scene));
                }
                "Plain" | "Para" => out.push(Block::Paragraph(Paragraph {
                    inlines: Box::pin(self.inlines(c, style.clone(), child_depth)).await?,
                    compact: t == "Plain" && list_depth > 0,
                    ..Default::default()
                })),
                "Header" => {
                    let level = number(at(c, 0)?)?;
                    if !(1. ..=6.).contains(&level) || level.fract() != 0. {
                        return Err(Error::new(
                            "E_AST",
                            "Header level must be an integer from 1 to 6",
                        ));
                    }
                    let forced_bold = std::mem::replace(&mut self.forced_bold, true);
                    let inlines =
                        Box::pin(self.inlines(at(c, 2)?, style.clone(), child_depth)).await;
                    self.forced_bold = forced_bold;
                    out.push(Block::Heading {
                        level: level as u8,
                        id: string(at(at(c, 1)?, 0)?)?,
                        inlines: inlines?,
                    });
                }
                "CodeBlock" => {
                    if style != TextStyle::default() {
                        return self.fail(
                            "Inherited raw HTML text styling cannot be represented on a code block",
                        );
                    }
                    let start = out.len();
                    out.push(Block::Code {
                        language: array(at(at(c, 0)?, 1)?)?
                            .first()
                            .map(string)
                            .transpose()?
                            .unwrap_or_default(),
                        text: string_async(at(c, 1)?).await?,
                    });
                    anchor_blocks(&mut out, start, string(at(at(c, 0)?, 0)?)?);
                }
                "Div" => {
                    let start = out.len();
                    let attributes = attrs(at(c, 0)?)?;
                    let align = attributes
                        .get("style")
                        .and_then(|style| css_property(style, "text-align"))
                        .or_else(|| attributes.get("align").map(String::as_str))
                        .map(str::to_ascii_lowercase);
                    let align = match align.as_deref() {
                        Some("left") => Align::Left,
                        Some("center") => Align::Center,
                        Some("right") => Align::Right,
                        _ => Align::Default,
                    };
                    let style = self.attr_style(at(c, 0)?, style.clone())?;
                    out.extend(
                        Box::pin(self.blocks(at(c, 1)?, style, child_depth, list_depth)).await?,
                    );
                    crate::html::apply_alignment(&mut out[start..], align);
                    anchor_blocks(&mut out, start, string(at(at(c, 0)?, 0)?)?);
                }
                "BlockQuote" => out.push(Block::Quote {
                    kind: None,
                    blocks: Box::pin(self.blocks(c, style.clone(), child_depth, list_depth))
                        .await?,
                }),
                "HorizontalRule" => out.push(Block::Rule),
                "RawBlock" if string(at(c, 0)?)? == "html" => {
                    let html = string_async(at(c, 1)?).await?;
                    let tokens = html_tokens(&html).map_err(|error| self.html_error(error))?;
                    if tokens.iter().any(|(_, token)| matches!(token, HtmlToken::Open(scope) if scope.has_footnotes())) {
                        out.extend(self.raw_note_blocks(&html, &tokens, &style, depth.saturating_add(scopes.len())).await?);
                        continue;
                    }
                    let tokens = self.raw_tokens(tokens, depth, scopes.len()).await?;
                    let mut index = 0;
                    while index < tokens.len() {
                        document_ast_rust::cooperate::yield_now().await;
                        let (range, token) = &tokens[index];
                        match token {
                            HtmlToken::Text(value) => {
                                if !value.trim().is_empty() {
                                    out.extend(
                                        raw_html_blocks_async(
                                            &html[range.clone()],
                                            &mut self.html_images,
                                            &style,
                                        )
                                        .await
                                        .map_err(|error| self.html_error(error))?,
                                    );
                                }
                            }
                            HtmlToken::Close(tag) => {
                                let Some((scope, parent, mut prior)) = scopes.pop() else {
                                    return self
                                        .fail(format!("Unmatched raw HTML closing tag: {tag}"));
                                };
                                if scope.tag() != tag {
                                    return self.fail(format!(
                                        "Mismatched raw HTML closing tag: {tag}; expected {}",
                                        scope.tag()
                                    ));
                                }
                                prior.extend(
                                    scope
                                        .finish_blocks(out)
                                        .map_err(|error| self.html_error(error))?,
                                );
                                out = prior;
                                style = parent;
                            }
                            HtmlToken::Open(scope) => {
                                let mut pending = Vec::new();
                                let mut end = None;
                                for (offset, (_, next)) in tokens[index..].iter().enumerate() {
                                    document_ast_rust::cooperate::yield_now().await;
                                    match next {
                                        HtmlToken::Open(next) if !next.is_void() => {
                                            pending.push(next.tag())
                                        }
                                        HtmlToken::Close(tag) => {
                                            if pending.pop() != Some(tag.as_str()) {
                                                return self.fail(format!(
                                                    "Mismatched raw HTML closing tag: {tag}"
                                                ));
                                            }
                                        }
                                        _ => {}
                                    }
                                    if pending.is_empty() {
                                        end = Some(index + offset);
                                        break;
                                    }
                                }
                                if let Some(end) = end {
                                    out.extend(
                                        raw_html_blocks_async(
                                            &html[range.start..tokens[end].0.end],
                                            &mut self.html_images,
                                            &style,
                                        )
                                        .await
                                        .map_err(|error| self.html_error(error))?,
                                    );
                                    index = end;
                                } else {
                                    let next = scope
                                        .inline_style(&style)
                                        .map_err(|error| self.html_error(error))?;
                                    scopes.push((
                                        scope.clone(),
                                        std::mem::replace(&mut style, next),
                                        std::mem::take(&mut out),
                                    ));
                                }
                            }
                        }
                        index += 1;
                    }
                }
                "BulletList" | "OrderedList" => {
                    if self.format == Format::Docx && list_depth > 8 {
                        return self.fail("DOCX lists support at most nine levels");
                    }
                    let ordered = t == "OrderedList";
                    let (start, list_style, delimiter) = if ordered {
                        let a = at(c, 0)?;
                        let style = match tag(at(a, 1)?)?.as_str() {
                            "DefaultStyle" | "Decimal" => ListStyle::Decimal,
                            "LowerAlpha" => ListStyle::LowerAlpha,
                            "UpperAlpha" => ListStyle::UpperAlpha,
                            "LowerRoman" => ListStyle::LowerRoman,
                            "UpperRoman" => ListStyle::UpperRoman,
                            _ => return self.fail("Unsupported list style"),
                        };
                        (
                            Some(number(at(a, 0)?)? as i64),
                            style,
                            match tag(at(a, 2)?)?.as_str() {
                                "OneParen" => ListDelimiter::OneParen,
                                "TwoParens" => ListDelimiter::TwoParens,
                                _ => ListDelimiter::Period,
                            },
                        )
                    } else {
                        (None, ListStyle::Decimal, ListDelimiter::Period)
                    };
                    let mut items = Vec::new();
                    for item in array(if ordered { at(c, 1)? } else { c })? {
                        let mut content = Box::pin(self.blocks(item, style.clone(), child_depth, list_depth + 1)).await?;
                        crate::mark_task_item(&mut content);
                        items.push(content);
                    }
                    out.push(Block::List {
                        start,
                        style: list_style,
                        delimiter,
                        items,
                    });
                }
                "Figure" => {
                    let start = out.len();
                    out.extend(
                        Box::pin(self.blocks(at(c, 2)?, style.clone(), child_depth, list_depth))
                            .await?,
                    );
                    out.extend(
                        Box::pin(self.caption(at(c, 1)?, style.clone(), child_depth)).await?,
                    );
                    anchor_blocks(&mut out, start, string(at(at(c, 0)?, 0)?)?);
                }
                "Table" => {
                    let start = out.len();
                    let mut caption =
                        Box::pin(self.caption(at(c, 1)?, style.clone(), child_depth)).await?;
                    for block in &mut caption {
                        if let Block::Paragraph(paragraph) = block {
                            paragraph.keep_with_next = true;
                        }
                    }
                    out.extend(caption);
                    out.extend(Box::pin(self.table(c, style.clone(), child_depth)).await?);
                    anchor_blocks(&mut out, start, string(at(at(c, 0)?, 0)?)?);
                }
                "LineBlock" if self.format == Format::Pdf => {
                    for line in array(c)? {
                        out.push(Block::Paragraph(Paragraph {
                            inlines: Box::pin(self.inlines(line, style.clone(), child_depth))
                                .await?,
                            compact: true,
                            ..Default::default()
                        }));
                    }
                }
                _ => return self.fail(format!("Unsupported {:?} block: {t}", self.format)),
            }
            if let Some((direction, _)) = direction {
                let blocks = out.split_off(start);
                out.push(Block::Direction { direction, blocks });
            }
        }
        if let Some((scope, ..)) = scopes.last() {
            return self.fail(format!("Unclosed raw HTML block tag: {}", scope.tag()));
        }
        Ok(out)
    }
    async fn caption(&mut self, c: &Value, style: TextStyle, depth: usize) -> Result<Vec<Block>> {
        if !array(at(c, 1)?)?.is_empty() {
            Box::pin(self.blocks(at(c, 1)?, style.clone(), depth, 0)).await
        } else if !matches!(at(c, 0)?, Value::Null) {
            Ok(vec![Block::Paragraph(Paragraph {
                inlines: Box::pin(self.inlines(at(c, 0)?, style.clone(), depth)).await?,
                ..Default::default()
            })])
        } else {
            Ok(Vec::new())
        }
    }
    async fn table(&mut self, c: &Value, style: TextStyle, depth: usize) -> Result<Vec<Block>> {
        let specs = array(at(c, 2)?)?;
        if specs.is_empty() {
            return self.fail("Empty table");
        }
        if specs.len() > 1000 {
            return Err(Error::new("E_AST", "Document table column limit exceeded"));
        }
        let mut widths = Vec::new();
        let mut alignments = Vec::new();
        for spec in specs {
            alignments.push(alignment(at(spec, 0)?)?);
            let w = at(spec, 1)?;
            widths.push(if tag(w)? == "ColWidth" {
                number(field(w, "c")?)?
            } else {
                0.
            });
        }
        let total = widths.iter().sum::<f64>();
        let mut rows = Vec::new();
        let mut active = vec![0usize; specs.len()];
        // Empty groups/rows have no authored cell to carry their destination.
        // Keep their anchors until the next cell, without changing the grid.
        let mut pending = vec![string(at(at(at(c, 3)?, 0)?, 0)?)?];
        Box::pin(self.rows(
            at(at(c, 3)?, 1)?,
            true,
            0,
            attr_direction(at(at(c, 3)?, 0)?, false)?.map(|scope| scope.0),
            &alignments,
            &mut rows,
            &mut active,
            &mut pending,
            &style,
            depth,
        ))
        .await?;
        for body in array(at(c, 4)?)? {
            pending.push(string(at(at(body, 0)?, 0)?)?);
            let direction = attr_direction(at(body, 0)?, false)?.map(|scope| scope.0);
            let header_columns = number(at(body, 1)?)?;
            if !(0. ..=specs.len() as f64).contains(&header_columns) || header_columns.fract() != 0.
            {
                return Err(Error::new(
                    "E_AST",
                    "Invalid document table row-header column count",
                ));
            }
            let header_columns = header_columns as usize;
            Box::pin(self.rows(
                at(body, 2)?,
                false,
                specs.len(),
                direction,
                &alignments,
                &mut rows,
                &mut active,
                &mut pending,
                &style,
                depth,
            ))
            .await?;
            Box::pin(self.rows(
                at(body, 3)?,
                false,
                header_columns,
                direction,
                &alignments,
                &mut rows,
                &mut active,
                &mut pending,
                &style,
                depth,
            ))
            .await?;
        }
        pending.push(string(at(at(at(c, 5)?, 0)?, 0)?)?);
        Box::pin(self.rows(
            at(at(c, 5)?, 1)?,
            false,
            0,
            attr_direction(at(at(c, 5)?, 0)?, false)?.map(|scope| scope.0),
            &alignments,
            &mut rows,
            &mut active,
            &mut pending,
            &style,
            depth,
        ))
        .await?;
        let mut blocks = vec![Block::Table {
            rows,
            width: if total > 0. {
                Some(total.min(1.))
            } else {
                None
            },
            column_widths: widths,
        }];
        for anchor in pending {
            anchor_blocks(&mut blocks, 1, anchor);
        }
        Ok(blocks)
    }
    async fn rows(
        &mut self,
        input: &Value,
        header: bool,
        header_columns: usize,
        group_direction: Option<Direction>,
        alignments: &[Align],
        rows: &mut Vec<TableRow>,
        active: &mut Vec<usize>,
        pending: &mut Vec<String>,
        style: &TextStyle,
        depth: usize,
    ) -> Result<()> {
        let input = array(input)?;
        for (row_index, row) in input.iter().enumerate() {
            document_ast_rust::cooperate::yield_now().await;
            pending.push(string(at(at(row, 0)?, 0)?)?);
            let row_direction = attr_direction(at(row, 0)?, false)?
                .map(|scope| scope.0)
                .or(group_direction);
            let mut cells = Vec::new();
            let mut col = 0;
            for cell in array(at(row, 1)?)? {
                document_ast_rust::cooperate::yield_now().await;
                while active.get(col).is_some_and(|n| *n > 0) {
                    col += 1;
                }
                let rowspan = number(at(cell, 2)?)?;
                let colspan = number(at(cell, 3)?)?;
                if !(1. ..=10000.).contains(&rowspan)
                    || rowspan.fract() != 0.
                    || !(1. ..=1000.).contains(&colspan)
                    || colspan.fract() != 0.
                {
                    return Err(Error::new("E_AST", "Invalid document table span"));
                }
                let rowspan = rowspan as usize;
                let colspan = colspan as usize;
                if rowspan > input.len() - row_index {
                    return Err(Error::new(
                        "E_AST",
                        "Document table row span exceeds its row section",
                    ));
                }
                let end = col
                    .checked_add(colspan)
                    .filter(|end| *end <= alignments.len())
                    .ok_or_else(|| Error::new("E_AST", "Document table column limit exceeded"))?;
                if col < header_columns && end > header_columns {
                    return Err(Error::new(
                        "E_AST",
                        "Document table cell crosses the row-header column boundary",
                    ));
                }
                let attributes = attrs(at(cell, 0)?)?;
                let header_hint = attributes
                    .get("role")
                    .is_some_and(|role| matches!(role.trim(), "rowheader" | "columnheader"))
                    || attributes.get("scope").is_some_and(|scope| {
                        matches!(
                            scope.trim().to_ascii_lowercase().as_str(),
                            "row" | "rowgroup" | "col" | "colgroup"
                        )
                    });
                let mut align = alignment(at(cell, 1)?)?;
                if align == Align::Default {
                    align = alignments.get(col).copied().unwrap_or_default();
                }
                let cell_header = header || col < header_columns || header_hint;
                let forced_bold = self.forced_bold;
                self.forced_bold |= cell_header;
                let blocks = Box::pin(self.blocks(at(cell, 4)?, style.clone(), depth + 1, 0)).await;
                self.forced_bold = forced_bold;
                let mut blocks = blocks?;
                anchor_blocks(&mut blocks, 0, string(at(at(cell, 0)?, 0)?)?);
                if let Some(direction) = attr_direction(at(cell, 0)?, false)?
                    .map(|scope| scope.0)
                    .or(row_direction)
                {
                    blocks = vec![Block::Direction { direction, blocks }];
                }
                cells.push(TableCell {
                    header: cell_header,
                    blocks,
                    align,
                    colspan,
                    rowspan,
                });
                for value in active.iter_mut().skip(col).take(colspan) {
                    *value = rowspan;
                }
                col = end;
            }
            if let Some(cell) = cells.first_mut() {
                for anchor in pending.drain(..) {
                    anchor_blocks(&mut cell.blocks, 0, anchor);
                }
            }
            rows.push(TableRow { header, cells });
            for value in active.iter_mut() {
                *value = value.saturating_sub(1);
            }
        }
        Ok(())
    }
    async fn image(&mut self, c: &Value) -> Result<Image> {
        let source = string(at(at(c, 2)?, 0)?)?;
        let bytes = self.resources.get(&source).ok_or_else(|| {
            Error::new(
                if self.format == Format::Pdf {
                    "E_CAPABILITY"
                } else {
                    "E_RESOURCE"
                },
                format!("Missing image resource: {source}"),
            )
        })?;
        self.image_bytes = self.image_bytes.saturating_add(bytes.len());
        self.bound_image_memory()?;
        let header = self
            .html_images
            .prepare(&source)
            .await
            .map_err(|message| Error::new("E_PARSE", message))?;
        let mime = header.mime;
        let (mut width, mut height) = if self.format == Format::Docx {
            (
                header.width as f64 * 96. / header.dpi_x.unwrap_or(72.),
                header.height as f64 * 96. / header.dpi_y.unwrap_or(72.),
            )
        } else if header.orientation.is_some_and(|o| o >= 5) {
            (header.height as f64, header.width as f64)
        } else {
            (header.width as f64, header.height as f64)
        };
        let a = attrs(at(c, 0)?)?;
        let natural = (width, height);
        if let Some(v) = a.get("width") {
            width = self.dimension(v)?;
        }
        if let Some(v) = a.get("height") {
            height = self.dimension(v)?;
        }
        if a.contains_key("width") && !a.contains_key("height") {
            height = width * natural.1 / natural.0;
        }
        if a.contains_key("height") && !a.contains_key("width") {
            width = height * natural.0 / natural.1;
        }
        if self.format == Format::Pdf
            && !a.contains_key("width")
            && !a.contains_key("height")
            && width * 0.75 > self.page_width
        {
            height *= self.page_width / (width * 0.75);
            width = self.page_width / 0.75;
        }
        let mut data = Vec::with_capacity(bytes.len());
        for chunk in bytes.chunks(65536) {
            document_ast_rust::cooperate::yield_now().await;
            data.extend_from_slice(chunk);
        }
        Ok(Image {
            bytes: data,
            mime: mime.into(),
            width,
            height,
            alt: plain(at(c, 1)?)?,
            title: string(at(at(c, 2)?, 1)?)?,
            link: None,
        })
    }
    fn dimension(&self, value: &str) -> Result<f64> {
        let v = value.trim();
        let units = [
            ("px", 1.),
            ("pt", 96. / 72.),
            ("in", 96.),
            ("cm", 96. / 2.54),
            ("mm", 96. / 25.4),
        ];
        for (suffix, multiplier) in units {
            if let Some(number) = v.strip_suffix(suffix) {
                if let Ok(n) = number.trim().parse::<f64>() {
                    if n.is_finite() && n > 0. {
                        return Ok(n * multiplier);
                    }
                }
            }
        }
        if self.format == Format::Pdf {
            if let Some(p) = v.strip_suffix('%') {
                if let Ok(n) = p.parse::<f64>() {
                    if n.is_finite() && n > 0. {
                        return Ok(n * self.page_width / 100. / 0.75);
                    }
                }
            }
            if let Ok(n) = v.parse::<f64>() {
                if n.is_finite() && n > 0. {
                    return Ok(n / 0.75);
                }
            }
        }
        Err(Error::new(
            if self.format == Format::Pdf {
                "E_CAPABILITY"
            } else {
                "E_OPTION"
            },
            "Images require explicit width/height units (px, pt, in, cm, mm)",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_ast_rust::{PageBox, Paint, layout_document};

    fn map_fixture(source: &str) -> Result<Document> {
        let input = crate::json::parse(source.as_bytes(), crate::json::Limits::default()).unwrap();
        document_ast_rust::cooperate::block_on(map(
            &input,
            Format::Docx,
            &BTreeMap::from([(
                "pixel.png".into(),
                terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
            )]),
            &mut PdfOptions::default(),
            false,
            None,
            &mut Vec::new(),
        ))
    }

    #[test]
    fn descriptive_image_notes_skip_figure_bodies_and_missing_resources() {
        let body = r#"{"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[{"t":"Str","c":"ALT"}NOTE],["pixel.png",""]]}]}],"metadata":{}}"#;
        let note = r#",{"t":"Note","c":[{"t":"Figure","c":[["hidden",[],[]],[null,[{"t":"Plain","c":[{"t":"Str","c":"HIDDEN CAPTION"}]}]],[{"t":"Plain","c":[{"t":"Image","c":[["",[],[]],[{"t":"Str","c":"HIDDEN IMAGE"}],["missing.png",""]]}]}]]}]}"#;
        let resources = BTreeMap::from([(
            "pixel.png".into(),
            terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
        )]);
        for format in [Format::Docx, Format::Pdf] {
            let mut outputs = Vec::new();
            for note in ["", note] {
                let input = crate::json::parse(
                    body.replace("NOTE", note).as_bytes(),
                    crate::json::Limits::default(),
                )
                .unwrap();
                let document = document_ast_rust::cooperate::block_on(map(
                    &input,
                    format,
                    &resources,
                    &mut PdfOptions::default(),
                    false,
                    None,
                    &mut Vec::new(),
                ))
                .unwrap();
                let [Block::Paragraph(paragraph)] = document.blocks.as_slice() else {
                    panic!("extra descriptive blocks")
                };
                assert!(
                    matches!(paragraph.inlines.as_slice(), [Inline::Image(image)] if image.alt == "ALT")
                );
                outputs.push(match format {
                    Format::Docx => docx_ast_rust::write_docx(&document).unwrap(),
                    Format::Pdf => pdf_ast_rust::write_pdf(&document).unwrap(),
                });
            }
            assert_eq!(
                outputs[0], outputs[1],
                "{format:?}: descriptive notes changed the document"
            );
        }
    }

    #[test]
    fn raw_html_inherited_code_styling_fails_instead_of_disappearing() {
        let source = r#"{"blocks":[{"t":"RawBlock","c":["html","<div style='STYLE'>"]},{"t":"CodeBlock","c":[["",[],[]],"CODE"]},{"t":"RawBlock","c":["html","</div>"]}],"metadata":{}}"#;
        for style in [
            "font-weight:bold",
            "font-style:italic",
            "color:#123456",
            "background-color:#123456",
        ] {
            let error = map_fixture(&source.replace("STYLE", style))
                .err()
                .expect("code silently lost inherited styling");
            assert!(
                error
                    .message
                    .contains("styling cannot be represented on a code block"),
                "{style}: {}",
                error.message
            );
        }
        let plain = source.replace(" style='STYLE'", "");
        let document = map_fixture(&plain).unwrap();
        assert!(matches!(&document.blocks[0], Block::Code { text, .. } if text == "CODE"));
        assert!(docx_ast_rust::write_docx(&document).is_ok());
        assert!(layout_document(&document, &PdfOptions::default()).is_ok());
    }

    #[test]
    fn raw_html_cannot_reset_forced_heading_or_table_header_bold() {
        let inlines = r#"[{"t":"RawInline","c":["html","<span style='font-weight:normal'>"]},{"t":"Str","c":"NORMAL"},{"t":"RawInline","c":["html","</span>"]}]"#;
        let heading = r#"{"blocks":[{"t":"Header","c":[1,["",[],[]],INLINES]}],"metadata":{}}"#
            .replace("INLINES", inlines);
        let error = map_fixture(&heading)
            .err()
            .expect("heading reset was silently ignored");
        assert!(
            error.message.contains("font-weight reset"),
            "{}",
            error.message
        );
        let table = r#"{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],HEAD],[[["",[],[]],COUNT,[],BODY]],[["",[],[]],[]]]}],"metadata":{}}"#;
        for (head, columns, attributes) in [
            (true, 0, "[]"),
            (false, 1, "[]"),
            (false, 0, r#"[["role","rowheader"]]"#),
        ] {
            let row =
                r#"[["",[],[]],[[["",[],ATTRS],"AlignDefault",1,1,[{"t":"Plain","c":INLINES}]]]]"#
                    .replace("ATTRS", attributes)
                    .replace("INLINES", inlines);
            let rows = format!("[{row}]");
            let source = table
                .replace("HEAD", if head { &rows } else { "[]" })
                .replace("BODY", if head { "[]" } else { &rows })
                .replace("COUNT", &columns.to_string());
            let error = map_fixture(&source)
                .err()
                .expect("header cell reset was silently ignored");
            assert!(
                error.message.contains("font-weight reset"),
                "{}",
                error.message
            );
        }
    }

    #[test]
    fn raw_html_normal_weight_remains_supported_in_paragraphs_and_footnotes() {
        let inlines = r#"[{"t":"RawInline","c":["html","<span style='font-weight:normal'>"]},{"t":"Str","c":"NORMAL"},{"t":"RawInline","c":["html","</span>"]}]"#;
        let paragraph =
            r#"{"blocks":[{"t":"Para","c":[{"t":"Strong","c":INLINES}]}],"metadata":{}}"#
                .replace("INLINES", inlines);
        let document = map_fixture(&paragraph).unwrap();
        let Block::Paragraph(paragraph) = &document.blocks[0] else {
            panic!("expected paragraph")
        };
        assert!(matches!(&paragraph.inlines[0], Inline::Text { style, .. } if !style.bold));
        let heading = r#"{"blocks":[{"t":"Header","c":[1,["",[],[]],[{"t":"Str","c":"HEADING"},{"t":"Note","c":[{"t":"Para","c":INLINES}]}]]}],"metadata":{}}"#.replace("INLINES", inlines);
        let document = map_fixture(&heading).unwrap();
        assert!(docx_ast_rust::write_docx(&document).is_ok());
        assert!(layout_document(&document, &PdfOptions::default()).is_ok());
    }

    #[test]
    fn raw_html_scope_boundaries_preserve_spaces_between_typed_and_raw_text() {
        let document = map_fixture(r#"{"blocks":[{"t":"Para","c":[{"t":"Str","c":"ONE"},{"t":"RawInline","c":["html","<strong> two</strong>"]},{"t":"Space"},{"t":"RawInline","c":["html","<span><i> three</i></span>"]},{"t":"RawInline","c":["html","<em> four</em>"]}]}],"metadata":{}}"#).unwrap();
        let Block::Paragraph(paragraph) = &document.blocks[0] else {
            panic!("expected paragraph")
        };
        let text: String = paragraph
            .inlines
            .iter()
            .filter_map(|inline| match inline {
                Inline::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "ONE two three four");
    }

    #[test]
    fn raw_html_inline_scopes_preserve_typed_emphasis_links_images_and_notes() {
        let document = map_fixture(r##"{"blocks":[{"t":"Para","c":[{"t":"Str","c":"BEFORE"},{"t":"RawInline","c":["html","<del id='cut'><span style='color:#123456'>"]},{"t":"Emph","c":[{"t":"Str","c":"MIXED"}]},{"t":"RawInline","c":["html","</span></del><br><a href='#cut'>"]},{"t":"Image","c":[["",[],[["width","12px"],["height","6px"]]],[{"t":"Str","c":"Pixel"}],["pixel.png",""]]},{"t":"RawInline","c":["html","</a><strong>"]},{"t":"Str","c":"MARKER"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"NOTEBODY"}]}]},{"t":"RawInline","c":["html","</strong>"]},{"t":"Str","c":"AFTER"}]}],"metadata":{}}"##).unwrap();
        let Block::Paragraph(paragraph) = &document.blocks[0] else {
            panic!("expected paragraph")
        };
        let style = |label| {
            paragraph
                .inlines
                .iter()
                .find_map(|inline| match inline {
                    Inline::Text { text, style } if text == label => Some(style),
                    _ => None,
                })
                .unwrap()
        };
        assert!(style("MIXED").italic && style("MIXED").strike);
        assert_eq!(style("MIXED").color.as_deref(), Some("123456"));
        assert!(!style("BEFORE").strike && !style("AFTER").bold);
        assert!(style("MARKER").bold);
        assert!(
            paragraph
                .inlines
                .iter()
                .any(|inline| matches!(inline, Inline::Break))
        );
        assert!(paragraph.inlines.iter().any(
            |inline| matches!(inline, Inline::Image(image) if image.link.as_deref() == Some("#cut"))
        ));
        let note = paragraph
            .inlines
            .iter()
            .find_map(|inline| {
                if let Inline::Note(blocks) = inline {
                    Some(blocks)
                } else {
                    None
                }
            })
            .unwrap();
        let Block::Paragraph(note) = &note[0] else {
            panic!("expected note paragraph")
        };
        assert!(
            matches!(&note.inlines[0], Inline::Text { text, style } if text == "NOTEBODY" && !style.bold)
        );
        let word = docx_ast_rust::write_docx(&document).unwrap();
        let xml = String::from_utf8_lossy(&word);
        assert!(xml.contains("w:name=\"cut\"") && xml.contains("w:anchor=\"cut\""));
        assert!(xml.contains("w:footnoteReference"));
        let pdf = layout_document(&document, &PdfOptions::default()).unwrap();
        assert!(pdf.anchors.contains_key("cut"));
    }

    #[test]
    fn raw_html_split_containers_keep_typed_lists_notes_and_inherited_style() {
        let document = map_fixture(r##"{"blocks":[{"t":"RawBlock","c":["html","<div id='outer' style='color:#123456'><blockquote>"]},{"t":"OrderedList","c":[[3,"LowerAlpha","OneParen"],[[{"t":"Para","c":[{"t":"Str","c":"ITEM"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"NOTE"}]}]}]}]]]},{"t":"RawBlock","c":["html","</blockquote><p id='raw'>RAW</p></div>"]},{"t":"Para","c":[{"t":"Str","c":"AFTER"}]}],"metadata":{}}"##).unwrap();
        let word = docx_ast_rust::write_docx(&document).unwrap();
        let xml = String::from_utf8_lossy(&word);
        assert!(xml.contains("w:name=\"outer\"") && xml.contains("w:name=\"raw\""));
        assert!(xml.contains("w:numFmt w:val=\"lowerLetter\""));
        assert!(xml.contains("w:start w:val=\"3\""));
        assert!(xml.contains("w:lvlText w:val=\"%1)\""));
        assert!(xml.contains("w:footnoteReference"));
        let pdf = layout_document(&document, &PdfOptions::default()).unwrap();
        let styles: BTreeMap<_, _> = pdf
            .pages
            .iter()
            .flat_map(|page| &page.paints)
            .filter_map(|paint| match paint {
                Paint::Text { text, style, .. } => Some((text.as_str(), style)),
                _ => None,
            })
            .collect();
        assert_eq!(styles["ITEM"].color.as_deref(), Some("123456"));
        assert_eq!(styles["RAW"].color.as_deref(), Some("123456"));
        assert_eq!(styles["AFTER"].color, None);
        assert_eq!(styles["[1] NOTE"].color, None);
        assert!(pdf.anchors.contains_key("outer") && pdf.anchors.contains_key("raw"));
    }

    #[test]
    fn raw_html_complete_islands_keep_tables_code_and_supplied_images() {
        let document = map_fixture(r#"{"blocks":[{"t":"RawBlock","c":["html","<!--separator--><table><thead><tr><th>HEAD</th></tr></thead><tbody><tr><td>CELL</td></tr></tbody></table><pre><code>line &amp; one\n  two</code></pre><p><img src='pixel.png' width='48' height='24' alt='Pixel'></p>"]}],"metadata":{}}"#).unwrap();
        assert!(
            matches!(&document.blocks[0], Block::Table { rows, .. } if rows.len() == 2 && rows[0].header && !rows[1].header)
        );
        assert!(
            matches!(&document.blocks[1], Block::Code { text, .. } if text == "line & one\n  two")
        );
        let Block::Paragraph(paragraph) = &document.blocks[2] else {
            panic!("expected image paragraph")
        };
        assert!(
            matches!(&paragraph.inlines[0], Inline::Image(image) if image.width == 48. && image.height == 24. && image.alt == "Pixel")
        );
        assert!(docx_ast_rust::write_docx(&document).is_ok());
        assert!(layout_document(&document, &PdfOptions::default()).is_ok());
    }

    #[test]
    fn raw_html_comments_do_not_add_blocks_or_merge_adjacent_lists() {
        let document = map_fixture(r#"{"blocks":[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"ONE"}]}]]},{"t":"RawBlock","c":["html","<!-- separated lists -->"]},{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"TWO"}]}]]}],"metadata":{}}"#).unwrap();
        assert_eq!(document.blocks.len(), 2);
        assert!(
            document
                .blocks
                .iter()
                .all(|block| matches!(block, Block::List { items, .. } if items.len() == 1))
        );
    }

    #[test]
    fn raw_html_unsafe_unknown_and_unbalanced_scopes_fail_explicitly() {
        for fragment in [
            "<strong>",
            "</strong>",
            "<strong></em>",
            "<widget>text</widget>",
            "<script>danger()</script>",
            "<input>",
            "<span onclick='danger()'>text</span>",
            "<a href='javascript:danger()'>text</a>",
            "<a href='#x'><a href='#y'>text</a></a>",
            "<div>text</div>",
        ] {
            let source = format!(
                r#"{{"blocks":[{{"t":"Para","c":[{{"t":"RawInline","c":["html","{fragment}"]}}]}}],"metadata":{{}}}}"#
            );
            assert!(
                map_fixture(&source).is_err(),
                "silently accepted {fragment}"
            );
        }
        for fragment in ["<div>", "</div>", "<div></blockquote>", "<table>", "<pre>"] {
            let source = format!(
                r#"{{"blocks":[{{"t":"RawBlock","c":["html","{fragment}"]}}],"metadata":{{}}}}"#
            );
            assert!(
                map_fixture(&source).is_err(),
                "silently accepted {fragment}"
            );
        }
    }

    #[test]
    fn raw_html_scopes_preserve_authored_direction_and_openxml() {
        let document = map_fixture(r#"{"blocks":[{"t":"Para","c":[{"t":"RawInline","c":["html","<span id='direction' dir='ltr'>"]},{"t":"Span","c":[["typed",[],[["dir","rtl"]]],[{"t":"Str","c":"ABC"}]]},{"t":"RawInline","c":["html","</span>"]},{"t":"RawInline","c":["openxml","<w:r><w:t>XML</w:t></w:r>"]}]}],"metadata":{}}"#).unwrap();
        let word = docx_ast_rust::write_docx(&document).unwrap();
        let xml = String::from_utf8_lossy(&word);
        for marker in [
            "w:name=\"direction\"",
            "w:name=\"typed\"",
            "\u{2067}",
            "<w:t>XML</w:t>",
        ] {
            assert!(xml.contains(marker), "missing {marker}");
        }
        assert!(layout_document(&document, &PdfOptions::default()).is_err());
    }

    #[test]
    fn body_section_and_row_headers_have_cell_roles_without_repeatable_rows() {
        let source = r#"{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"ColumnA"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"ColumnB"}]}]]]]]],[[["",[],[]],1,[[["",[],[]],[[["",[],[]],"AlignDefault",1,2,[{"t":"Plain","c":[{"t":"Str","c":"SectionOne"}]}]]]]],[[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"RowLabel"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"RegularValue"}]}]]]]]],[["",[],[]],0,[[["",[],[]],[[["",[],[]],"AlignDefault",1,2,[{"t":"Plain","c":[{"t":"Str","c":"SectionTwo"}]}]]]]],[[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"AnotherLabel"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"AnotherValue"}]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}"#;
        let document = map_fixture(source).unwrap();
        let Block::Table { rows, .. } = &document.blocks[0] else {
            panic!("expected table")
        };
        assert_eq!(
            rows.iter().map(|row| row.header).collect::<Vec<_>>(),
            [true, false, false, false, false]
        );
        assert_eq!(
            rows.iter()
                .map(|row| row.cells.iter().map(|cell| cell.header).collect::<Vec<_>>())
                .collect::<Vec<_>>(),
            vec![
                vec![true, true],
                vec![true],
                vec![true, false],
                vec![true],
                vec![false, false]
            ]
        );
        let pdf = layout_document(&document, &PdfOptions::default()).unwrap();
        let actual: BTreeMap<_, _> = pdf
            .pages
            .iter()
            .flat_map(|page| &page.paints)
            .filter_map(|paint| match paint {
                Paint::Text { text, style, .. } => Some((text.as_str(), style.bold)),
                _ => None,
            })
            .collect();
        for (text, bold) in [
            ("ColumnA", true),
            ("ColumnB", true),
            ("SectionOne", true),
            ("RowLabel", true),
            ("RegularValue", false),
            ("SectionTwo", true),
            ("AnotherLabel", false),
            ("AnotherValue", false),
        ] {
            assert_eq!(actual.get(text), Some(&bold), "{text}");
        }
    }

    #[test]
    fn row_header_columns_follow_geometric_positions_after_rowspans() {
        let source = r#"{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],2,[],[[["",[],[]],[[["",[],[]],"AlignDefault",2,1,[{"t":"Plain","c":[{"t":"Str","c":"LabelA"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"LabelB"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"ValueOne"}]}]]]],[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"LabelC"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"ValueTwo"}]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}"#;
        let document = map_fixture(source).unwrap();
        let Block::Table { rows, .. } = &document.blocks[0] else {
            panic!("expected table")
        };
        assert_eq!(
            rows.iter()
                .map(|row| row.cells.iter().map(|cell| cell.header).collect::<Vec<_>>())
                .collect::<Vec<_>>(),
            vec![vec![true, true, false], vec![true, false]]
        );
        assert_eq!(rows[0].cells[0].rowspan, 2);
        assert!(!rows.iter().any(|row| row.header));
        assert!(layout_document(&document, &PdfOptions::default()).is_ok());
    }

    #[test]
    fn malformed_row_header_counts_and_boundary_spans_fail_before_cell_mapping() {
        let source = r#"{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],COUNT,[],[[["",[],[]],[[["",[],[]],"AlignDefault",1,SPAN,[{"t":"UnsupportedBlock"}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}"#;
        for count in ["-1", "0.5", "3", "1e100"] {
            let error =
                map_fixture(&source.replace("COUNT", count).replace("SPAN", "1")).unwrap_err();
            assert_eq!(error.code, "E_AST", "{count}");
            assert!(error.message.contains("row-header column count"));
        }
        let error = map_fixture(&source.replace("COUNT", "1").replace("SPAN", "2")).unwrap_err();
        assert_eq!(error.code, "E_AST");
        assert!(error.message.contains("row-header column boundary"));
        let error = map_fixture(&source.replace("COUNT", "0").replace("SPAN", "3")).unwrap_err();
        assert_eq!(error.code, "E_AST");
        assert!(error.message.contains("column limit"));
        let cross_section = source
            .replace("\"AlignDefault\",1,SPAN", "\"AlignDefault\",2,SPAN")
            .replace("COUNT", "0")
            .replace("SPAN", "1");
        let error = map_fixture(&cross_section).unwrap_err();
        assert_eq!(error.code, "E_AST");
        assert!(error.message.contains("row section"));
    }

    #[test]
    fn explicit_cell_roles_and_scope_hints_preserve_rich_header_content() {
        let source = r#"{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[[["",[],ATTRS],"AlignDefault",1,1,[{"t":"CodeBlock","c":[["",[],[]],"ROLECODE"]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}"#;
        for (attributes, expected) in [
            (r#"[["role","rowheader"]]"#, true),
            (r#"[["role"," columnheader "]]"#, true),
            (r#"[["role","cell"],["scope","col"]]"#, true),
            (r#"[["scope","row"]]"#, true),
            (r#"[["scope","colgroup"]]"#, true),
            (r#"[["scope","rowgroup"]]"#, true),
            (r#"[["role","cell"]]"#, false),
            (r#"[["role","cell rowheader"]]"#, false),
            (r#"[["scope","auto"]]"#, false),
            ("[]", false),
        ] {
            let document = map_fixture(&source.replace("ATTRS", attributes)).unwrap();
            let Block::Table { rows, .. } = &document.blocks[0] else {
                panic!("expected table")
            };
            assert!(!rows[0].header);
            assert_eq!(rows[0].cells[0].header, expected, "{attributes}");
            let pdf = layout_document(&document, &PdfOptions::default()).unwrap();
            let bold =
                pdf.pages
                    .iter()
                    .flat_map(|page| &page.paints)
                    .find_map(|paint| match paint {
                        Paint::Text { text, style, .. } if text == "ROLECODE" => Some(style.bold),
                        _ => None,
                    });
            assert_eq!(bold, Some(expected), "{attributes}");
        }
    }

    #[test]
    fn document_and_nested_pandoc_directions_preserve_logical_order_and_resets() {
        let source = r#"{"direction":"rtl","blocks":[{"t":"Div","c":[["",[],[["dir","ltr"]]],[{"t":"Header","c":[2,["heading",[],[["dir","rtl"]]],[{"t":"Span","c":[["",[],[["dir","ltr"]]],[{"t":"Str","c":"ABC 123"},{"t":"Link","c":[["",[],[["dir","ltr"],["style","direction:inherit;direction:rtl;unicode-bidi:isolate;unicode-bidi:isolate-override"]]],[{"t":"Str","c":"XYZ 456"}],["https://example.com",""]]}]]}]]}]]}],"metadata":{}}"#;
        let document = map_fixture(source).unwrap();
        let Block::Direction {
            direction: Direction::Rtl,
            blocks,
        } = &document.blocks[0]
        else {
            panic!("document direction lost")
        };
        let Block::Direction {
            direction: Direction::Ltr,
            blocks,
        } = &blocks[0]
        else {
            panic!("Div reset lost")
        };
        let Block::Direction {
            direction: Direction::Rtl,
            blocks,
        } = &blocks[0]
        else {
            panic!("heading direction lost")
        };
        let Block::Heading { id, inlines, .. } = &blocks[0] else {
            panic!("heading flattened")
        };
        assert_eq!(id, "heading");
        let Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            inlines,
        } = &inlines[0]
        else {
            panic!("Span reset lost")
        };
        assert!(matches!(&inlines[0], Inline::Text { text, .. } if text == "ABC 123"));
        let Inline::Direction {
            direction: Direction::Rtl,
            override_order: true,
            inlines,
        } = &inlines[1]
        else {
            panic!("Link override lost")
        };
        assert!(
            matches!(&inlines[0], Inline::Text { text, style } if text == "XYZ 456" && style.link.as_deref() == Some("https://example.com"))
        );
    }

    #[test]
    fn code_image_and_figure_attributes_keep_direction_scopes() {
        let document = map_fixture(r#"{"blocks":[{"t":"CodeBlock","c":[["",[],[["style","direction:rtl"]]],"CODE 123"]},{"t":"Figure","c":[["",[],[["dir","rtl"]]],[null,[]],[{"t":"Para","c":[{"t":"Code","c":[["",[],[["dir","ltr"]]],"INLINE 456"]},{"t":"Image","c":[["",[],[["dir","rtl"]]],[{"t":"Str","c":"pixel"}],["pixel.png",""]]}]}]]}],"metadata":{}}"#).unwrap();
        let Block::Direction {
            direction: Direction::Rtl,
            blocks,
        } = &document.blocks[0]
        else {
            panic!("code direction lost")
        };
        assert!(matches!(&blocks[0], Block::Code { text, .. } if text == "CODE 123"));
        let Block::Direction {
            direction: Direction::Rtl,
            blocks,
        } = &document.blocks[1]
        else {
            panic!("figure direction lost")
        };
        let Block::Paragraph(paragraph) = &blocks[0] else {
            panic!("figure paragraph lost")
        };
        let Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            inlines,
        } = &paragraph.inlines[0]
        else {
            panic!("inline code reset lost")
        };
        assert!(
            matches!(&inlines[0], Inline::Text { text, style } if text == "INLINE 456" && style.code)
        );
        let Inline::Direction {
            direction: Direction::Rtl,
            override_order: false,
            inlines,
        } = &paragraph.inlines[1]
        else {
            panic!("image direction lost")
        };
        assert!(matches!(&inlines[0], Inline::Image(_)));
    }

    #[test]
    fn table_group_row_and_cell_directions_override_inherited_scopes() {
        let source = r#"{"blocks":[{"t":"Table","c":[["",[],[["dir","rtl"]]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[["dir","ltr"]]],0,[],[[["",[],[["dir","rtl"]]],[[["",[],[["dir","ltr"]]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"CELL RESET"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"ROW RTL"}]}]]]],[["",[],[]],[[["",[],[]],"AlignDefault",1,2,[{"t":"Plain","c":[{"t":"Str","c":"GROUP LTR"}]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}"#;
        let document = map_fixture(source).unwrap();
        let Block::Direction {
            direction: Direction::Rtl,
            blocks,
        } = &document.blocks[0]
        else {
            panic!("table direction lost")
        };
        let Block::Table { rows, .. } = &blocks[0] else {
            panic!("table flattened")
        };
        for (row, cell, direction, text) in [
            (0, 0, Direction::Ltr, "CELL RESET"),
            (0, 1, Direction::Rtl, "ROW RTL"),
            (1, 0, Direction::Ltr, "GROUP LTR"),
        ] {
            let Block::Direction {
                direction: actual,
                blocks,
            } = &rows[row].cells[cell].blocks[0]
            else {
                panic!("cell scope lost")
            };
            assert_eq!(*actual, direction);
            let Block::Paragraph(paragraph) = &blocks[0] else {
                panic!("cell paragraph lost")
            };
            assert!(
                matches!(&paragraph.inlines[0], Inline::Text { text: actual, .. } if actual == text)
            );
        }
    }

    #[test]
    fn unresolved_direction_and_unrepresentable_css_fail_explicitly() {
        for attributes in [
            r#"[["dir","auto"]]"#,
            r#"[["dir","auto"],["style","direction:ltr;unicode-bidi:isolate"]]"#,
            r#"[["dir",""]]"#,
            r#"[["dir"," rtl "]]"#,
            r#"[["dir","unknown"]]"#,
            r#"[["style","direction:rtl"]]"#,
            r#"[["dir","rtl"],["style","unicode-bidi:normal"]]"#,
            r#"[["dir","rtl"],["style","unicode-bidi:embed"]]"#,
            r#"[["dir","rtl"],["style","unicode-bidi:plaintext"]]"#,
            r#"[["dir","rtl"],["style","unicode-bidi:bidi-override"]]"#,
            r#"[["style","unicode-bidi:isolate"]]"#,
        ] {
            let source = format!(
                r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Span","c":[["",[],{attributes}],[{{"t":"Str","c":"ABC"}}]]}}]}}],"metadata":{{}}}}"#
            );
            let error = map_fixture(&source).unwrap_err();
            assert_eq!(error.code, "E_CAPABILITY", "{attributes}");
        }
        for source in [
            r#"{"direction":"auto","blocks":[],"metadata":{}}"#,
            r#"{"direction":" rtl ","blocks":[],"metadata":{}}"#,
            r#"{"blocks":[{"t":"Div","c":[["",[],[["dir","rtl"],["style","unicode-bidi:isolate-override"]]],[]]}],"metadata":{}}"#,
        ] {
            assert_eq!(map_fixture(source).unwrap_err().code, "E_CAPABILITY");
        }
        for attributes in [
            r#"[["style","direction:rtl;unicode-bidi:isolate"]]"#,
            r#"[["style","direction: RTL ;unicode-bidi: isolate "]]"#,
            r#"[["dir","rtl"],["style","direction:ltr"]]"#,
        ] {
            let source = format!(
                r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Span","c":[["",[],{attributes}],[{{"t":"Str","c":"ABC"}}]]}}]}}],"metadata":{{}}}}"#
            );
            assert!(map_fixture(&source).is_ok(), "{attributes}");
        }
        let block_isolate = map_fixture(r#"{"blocks":[{"t":"Div","c":[["",[],[["dir","rtl"],["style","unicode-bidi:isolate"]]],[]]}],"metadata":{}}"#).unwrap();
        assert!(matches!(
            &block_isolate.blocks[0],
            Block::Direction {
                direction: Direction::Rtl,
                ..
            }
        ));
    }

    #[test]
    fn div_destinations_follow_content_without_adding_paragraph_spacing() {
        for introductory_paragraphs in [0, 4, 6] {
            let intro =
                r#"{"t":"Para","c":[{"t":"Str","c":"Intro"}]},"#.repeat(introductory_paragraphs);
            let source = r##"{"blocks":[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"LINK"}],["#target",""]]}]},INTRO{"t":"Div","c":[["IDENTIFIER",[],[]],[{"t":"Para","c":[{"t":"Str","c":"TARGETBODY"}]}]]}],"metadata":{}}"##.replace("INTRO", &intro);
            let render = |identifier| {
                let input = crate::json::parse(
                    source.replace("IDENTIFIER", identifier).as_bytes(),
                    crate::json::Limits::default(),
                )
                .unwrap();
                let mut options = PdfOptions {
                    page: PageBox {
                        width: 300.,
                        height: 180.,
                        margin: 20.,
                    },
                    font_size: 12.,
                    line_height: 1.2,
                    ..Default::default()
                };
                let document = document_ast_rust::cooperate::block_on(map(
                    &input,
                    Format::Pdf,
                    &BTreeMap::new(),
                    &mut options,
                    false,
                    None,
                    &mut Vec::new(),
                ))
                .unwrap();
                layout_document(&document, &options).unwrap()
            };
            let identified = render("target");
            let control = render("");
            let positions = |document: &pdf_ast_rust::PdfDocument| {
                document
                    .pages
                    .iter()
                    .enumerate()
                    .flat_map(|(page, contents)| {
                        contents.paints.iter().filter_map(move |paint| match paint {
                            Paint::Text {
                                text, x, y, size, ..
                            } => Some((page, text.clone(), *x, *y, *size)),
                            _ => None,
                        })
                    })
                    .collect::<Vec<_>>()
            };
            let actual = positions(&identified);
            assert_eq!(
                actual,
                positions(&control),
                "identifier changed content layout after {introductory_paragraphs} paragraphs"
            );
            let (page, _, _, y, size) = actual
                .iter()
                .find(|(_, text, ..)| text == "TARGETBODY")
                .unwrap();
            let anchor = identified.anchors["target"];
            assert_eq!(anchor.0, *page);
            assert!((anchor.1 - (y - size)).abs() < 1e-7);
            if introductory_paragraphs == 4 {
                assert_eq!(
                    identified.pages.len(),
                    1,
                    "the original orphaned-destination reproduction stays on one page"
                );
            }
            if introductory_paragraphs == 6 {
                assert!(*page > 0, "also exercise an actual content page break");
            }
        }
    }
    #[test]
    fn supported_attr_nodes_preserve_destinations_without_changing_layout() {
        let source = r##"{"blocks":[{"t":"Para","c":[{"t":"Link","c":[["link-id",[],[]],[{"t":"Str","c":"JUMP"}],["#block-code-id",""]]}]},{"t":"Header","c":[2,["heading-id",[],[]],[{"t":"Span","c":[["span-id",[],[]],[{"t":"Str","c":"HEADING"}]]}]]},{"t":"Div","c":[["div-id",[],[]],[{"t":"Para","c":[{"t":"Code","c":[["inline-code-id",[],[]],"INLINECODE"]},{"t":"Space"},{"t":"Image","c":[["image-id",[],[["width","16px"],["height","16px"]]],[{"t":"Str","c":"pixel"}],["pixel.png",""]]}]}]]},{"t":"CodeBlock","c":[["block-code-id",[],[]],"BLOCKCODE"]},{"t":"Figure","c":[["figure-id",[],[]],[null,[{"t":"Para","c":[{"t":"Str","c":"CAPTION"}]}]],[{"t":"Para","c":[{"t":"Str","c":"FIGUREBODY"}]}]]}],"metadata":{}}"##;
        let ids = [
            "link-id",
            "heading-id",
            "span-id",
            "div-id",
            "inline-code-id",
            "image-id",
            "block-code-id",
            "figure-id",
        ];
        let control_source = ids.iter().fold(source.to_string(), |json, id| {
            json.replace(&format!("\"{id}\""), "\"\"")
        });
        let resources = BTreeMap::from([(
            "pixel.png".into(),
            terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
        )]);
        let mapped = |source: &str, format| {
            let input =
                crate::json::parse(source.as_bytes(), crate::json::Limits::default()).unwrap();
            document_ast_rust::cooperate::block_on(map(
                &input,
                format,
                &resources,
                &mut PdfOptions::default(),
                false,
                None,
                &mut Vec::new(),
            ))
            .unwrap()
        };
        let identified =
            layout_document(&mapped(source, Format::Pdf), &PdfOptions::default()).unwrap();
        let control = layout_document(
            &mapped(&control_source, Format::Pdf),
            &PdfOptions::default(),
        )
        .unwrap();
        let missing = ids
            .iter()
            .filter(|id| !identified.anchors.contains_key(**id))
            .collect::<Vec<_>>();
        assert!(
            missing.is_empty(),
            "missing authored destinations: {missing:?}"
        );
        assert_eq!(
            format!("{:?}", identified.pages),
            format!("{:?}", control.pages),
            "identifiers must not change painting or link rectangles"
        );
        for (id, label) in [
            ("link-id", "JUMP"),
            ("heading-id", "HEADING"),
            ("span-id", "HEADING"),
            ("div-id", "INLINECODE"),
            ("inline-code-id", "INLINECODE"),
            ("block-code-id", "BLOCKCODE"),
            ("figure-id", "FIGUREBODY"),
        ] {
            let target = identified
                .pages
                .iter()
                .enumerate()
                .find_map(|(page, contents)| {
                    contents.paints.iter().find_map(|paint| {
                        if let Paint::Text { text, y, size, .. } = paint {
                            (text == label).then_some((page, y - size))
                        } else {
                            None
                        }
                    })
                })
                .unwrap();
            let anchor = identified.anchors[id];
            assert_eq!(anchor.0, target.0, "wrong page for {id}");
            // Inline code uses 88% of the body size inside the body line box.
            // Code blocks use their own code-sized line box.
            let gap = if matches!(id, "div-id" | "inline-code-id") {
                PdfOptions::default().font_size * 0.12
            } else {
                0.
            };
            assert!(
                (target.1 - anchor.1 - gap).abs() < 1e-7,
                "misplaced {id}: {anchor:?}, text {target:?}"
            );
        }
        let image = identified
            .pages
            .iter()
            .enumerate()
            .find_map(|(page, contents)| {
                contents.paints.iter().find_map(|paint| {
                    if let Paint::Image { y, .. } = paint {
                        Some((page, *y))
                    } else {
                        None
                    }
                })
            })
            .unwrap();
        assert_eq!(identified.anchors.get("image-id"), Some(&image));
        let docx = docx_ast_rust::write_docx(&mapped(source, Format::Docx)).unwrap();
        let xml = String::from_utf8_lossy(&docx);
        let control_docx =
            docx_ast_rust::write_docx(&mapped(&control_source, Format::Docx)).unwrap();
        assert_eq!(
            xml.matches("<w:p>").count(),
            String::from_utf8_lossy(&control_docx)
                .matches("<w:p>")
                .count(),
            "identifiers must not add empty Word paragraphs"
        );
        for id in ids {
            assert_eq!(
                xml.matches(&format!("w:name=\"{id}\"")).count(),
                1,
                "missing or duplicate Word bookmark {id}"
            );
        }
    }
}
