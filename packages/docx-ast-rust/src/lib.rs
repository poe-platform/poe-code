//! Word output from a portable document tree, with editable OOXML package parts.
mod drawing;
use document_ast_rust::cooperate::{block_on, yield_now};
use document_ast_rust::*;
pub use office_package_rust::{Package, Part};
use std::{collections::HashSet, fmt::Write};

const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

async fn xml(value: &str) -> String {
    let mut out = String::new();
    for (index, c) in value.chars().enumerate() {
        if index % 4096 == 0 {
            yield_now().await;
        }
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' | '\n' | '\r' => out.push(c),
            c if c >= ' ' && c != '\u{fffe}' && c != '\u{ffff}' => out.push(c),
            _ => {}
        }
    }
    out
}
async fn validate_fragment(fragment: &str) -> Result<(), String> {
    let mut parser = office_package_rust::xml::Parser::new(None, None, false);
    parser.feed(&format!(
        r#"<w:body xmlns:w="{WORD}" xmlns:r="{REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">"#
    ))?;
    let mut rest = fragment;
    while !rest.is_empty() {
        yield_now().await;
        let mut end = rest.len().min(4096);
        while !rest.is_char_boundary(end) {
            end -= 1;
        }
        parser.feed(&rest[..end])?;
        rest = &rest[end..];
    }
    parser.feed("</w:body>")?;
    parser.finish().map(|_| ())
}

fn alignment(align: Align) -> &'static str {
    match align {
        Align::Default | Align::Left => "left",
        Align::Center => "center",
        Align::Right => "right",
    }
}

fn direction_name(direction: Direction) -> &'static str {
    match direction {
        Direction::Ltr => "ltr",
        Direction::Rtl => "rtl",
    }
}

fn anchors_only(inlines: &[Inline]) -> bool {
    !inlines.is_empty()
        && inlines.iter().all(|inline| match inline {
            Inline::Anchor(_) => true,
            Inline::Direction { inlines, .. } => anchors_only(inlines),
            _ => false,
        })
}

fn anchor_block(block: &Block) -> bool {
    match block {
        Block::Paragraph(p) => anchors_only(&p.inlines),
        Block::Direction { blocks, .. } => blocks.iter().all(anchor_block),
        _ => false,
    }
}

fn first_paragraph(blocks: &[Block], directed: bool) -> bool {
    let first = if directed {
        blocks
            .iter()
            .find(|b| !anchor_block(b))
            .or_else(|| blocks.first())
    } else {
        blocks.first()
    };
    match first {
        Some(Block::Direction { blocks, .. } | Block::Quote { kind: None, blocks }) => {
            first_paragraph(blocks, directed)
        }
        Some(
            Block::Paragraph(_)
            | Block::Heading { .. }
            | Block::Code { .. }
            | Block::Quote { kind: Some(_), .. },
        ) => true,
        _ => false,
    }
}

fn has_direction(blocks: &[Block]) -> bool {
    blocks.iter().any(|b| match b {
        Block::Direction { .. } => true,
        Block::Quote { blocks, .. } => has_direction(blocks),
        _ => false,
    })
}

fn ends_in_paragraph(blocks: &[Block]) -> bool {
    match blocks.last() {
        Some(Block::Direction { blocks, .. }) => ends_in_paragraph(blocks),
        Some(Block::Paragraph(Paragraph { inlines, .. }) | Block::Heading { inlines, .. }) => {
            !anchors_only(inlines)
        }
        Some(Block::Code { .. } | Block::Image(_) | Block::Vector(_) | Block::Rule) => true,
        _ => false,
    }
}

// Resolve forward and footnote links before emitting any hyperlink. Keep this
// traversal cooperative just like validation and package rendering.
async fn collect_targets(document: &Document) -> HashSet<String> {
    let mut targets = HashSet::new();
    let mut blocks = vec![document.blocks.as_slice()];
    while let Some(nodes) = blocks.pop() {
        for block in nodes {
            yield_now().await;
            let inlines = match block {
                Block::Paragraph(p) => {
                    if !p.id.is_empty() {
                        targets.insert(p.id.clone());
                    }
                    Some(p.inlines.as_slice())
                }
                Block::Heading { id, inlines, .. } => {
                    if !id.is_empty() {
                        targets.insert(id.clone());
                    }
                    Some(inlines.as_slice())
                }
                Block::Direction {
                    blocks: children, ..
                }
                | Block::Quote {
                    blocks: children, ..
                } => {
                    blocks.push(children);
                    None
                }
                Block::List { items, .. } => {
                    for item in items {
                        yield_now().await;
                        blocks.push(item);
                    }
                    None
                }
                Block::Table { rows, .. } => {
                    for row in rows {
                        yield_now().await;
                        for cell in &row.cells {
                            yield_now().await;
                            blocks.push(&cell.blocks);
                        }
                    }
                    None
                }
                Block::Code { .. }
                | Block::Image(_)
                | Block::Vector(_)
                | Block::Rule
                | Block::RawOpenXml(_) => None,
            };
            if let Some(inlines) = inlines {
                let mut scopes = vec![inlines];
                while let Some(inlines) = scopes.pop() {
                    for inline in inlines {
                        yield_now().await;
                        match inline {
                            Inline::Anchor(id) => {
                                if !id.is_empty() {
                                    targets.insert(id.clone());
                                }
                            }
                            Inline::Direction { inlines, .. } => scopes.push(inlines),
                            Inline::Note(children) => blocks.push(children),
                            Inline::Text { .. }
                            | Inline::Break
                            | Inline::Image(_)
                            | Inline::RawOpenXml(_) => {}
                        }
                    }
                }
            }
        }
    }
    targets
}

#[derive(Clone, Copy, Default)]
struct Context {
    direction: Option<Direction>,
    depth: usize,
    quote: usize,
    number: Option<usize>,
    align: Option<Align>,
    header: bool,
    in_cell: bool,
    available_width: Option<f64>,
}
struct Writer {
    body: String,
    relations: String,
    numbering: String,
    number_instances: String,
    images: Vec<(String, Vec<u8>)>,
    relation_id: usize,
    number_id: usize,
    bookmark_id: usize,
    image_id: usize,
    bookmarks: HashSet<String>,
    targets: HashSet<String>,
    notes: Vec<Vec<Block>>,
    note_reference: bool,
}
impl Writer {
    async fn anchor(&mut self, id: &str) {
        if id.is_empty() {
            return;
        }
        let name = id.to_owned();
        if !self.bookmarks.insert(name.clone()) {
            return;
        }
        self.bookmark_id += 1;
        write!(
            self.body,
            "<w:bookmarkStart w:id=\"{}\" w:name=\"{}\"/><w:bookmarkEnd w:id=\"{}\"/>",
            self.bookmark_id,
            xml(&name).await,
            self.bookmark_id
        )
        .unwrap();
    }
    async fn relation(&mut self, kind: &str, target: &str, external: bool) -> String {
        self.relation_id += 1;
        let id = format!("rId{}", self.relation_id);
        write!(
            self.relations,
            "<Relationship Id=\"{id}\" Type=\"{REL}/{kind}\" Target=\"{}\"{}/>",
            xml(target).await,
            if external {
                " TargetMode=\"External\""
            } else {
                ""
            }
        )
        .unwrap();
        id
    }
    async fn image(&mut self, image: &Image) -> Result<(), String> {
        let ext = match image.mime.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/bmp" => "bmp",
            "image/tiff" => "tiff",
            _ => return Err("Unsupported Word image MIME type".into()),
        };
        if !image.width.is_finite()
            || !image.height.is_finite()
            || image.width <= 0.
            || image.height <= 0.
        {
            return Err("Invalid image dimensions".into());
        }
        let mut found = None;
        'images: for (index, (_, bytes)) in self.images.iter().enumerate() {
            yield_now().await;
            if bytes.len() != image.bytes.len() {
                continue;
            }
            for (left, right) in bytes.chunks(65536).zip(image.bytes.chunks(65536)) {
                yield_now().await;
                if left != right {
                    continue 'images;
                }
            }
            found = Some(index);
            break;
        }
        let index = if let Some(index) = found {
            index
        } else {
            let index = self.images.len();
            let mut bytes = Vec::with_capacity(image.bytes.len());
            for chunk in image.bytes.chunks(65536) {
                yield_now().await;
                bytes.extend_from_slice(chunk);
            }
            self.images
                .push((format!("word/media/image-{}.{ext}", index + 1), bytes));
            index
        };
        let target = self.images[index].0.trim_start_matches("word/").to_owned();
        let rel = self.relation("image", &target, false).await;
        self.image_id += 1;
        let scale = (624. / image.width).min(1.).min(864. / image.height);
        let width = (image.width * scale * 9525.).round() as u64;
        let height = (image.height * scale * 9525.).round() as u64;
        if let Some(link) = &image.link {
            if let Some(id) = link.strip_prefix('#') {
                let id = resolve_fragment(id, |candidate| self.targets.contains(candidate))
                    .unwrap_or(std::borrow::Cow::Borrowed(id));
                write!(self.body, "<w:hyperlink w:anchor=\"{}\">", xml(&id).await).unwrap();
            } else {
                let rel = self.relation("hyperlink", link, true).await;
                write!(self.body, "<w:hyperlink r:id=\"{rel}\">").unwrap();
            }
        }
        write!(self.body,r#"<w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{width}" cy="{height}"/><wp:docPr id="{}" name="Picture {}" descr="{}" title="{}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="{}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,self.image_id,self.image_id,xml(&image.alt).await,xml(&image.title).await,xml(&image.alt).await).unwrap();
        if image.link.is_some() {
            self.body.push_str("</w:hyperlink>");
        }
        Ok(())
    }
    async fn runs(
        &mut self,
        inlines: &[Inline],
        header: bool,
        direction: Option<Direction>,
    ) -> Result<(), String> {
        let mut index = 0;
        while let Some(inline) = inlines.get(index) {
            yield_now().await;
            index += 1;
            match inline {
                Inline::Direction {
                    direction,
                    override_order,
                    inlines,
                } => {
                    if anchors_only(inlines) || inlines.is_empty() {
                        Box::pin(self.runs(inlines, header, Some(*direction))).await?;
                        continue;
                    }
                    let control = if *override_order {
                        '\u{2068}'
                    } else if *direction == Direction::Rtl {
                        '\u{2067}'
                    } else {
                        '\u{2066}'
                    };
                    write!(self.body, "<w:r><w:t>{control}</w:t></w:r>").unwrap();
                    if *override_order {
                        write!(
                            self.body,
                            "<w:bdo w:val=\"{}\">",
                            direction_name(*direction)
                        )
                        .unwrap();
                    }
                    Box::pin(self.runs(inlines, header, Some(*direction))).await?;
                    if *override_order {
                        self.body.push_str("</w:bdo>");
                    }
                    self.body.push_str("<w:r><w:t>\u{2069}</w:t></w:r>");
                }
                Inline::Anchor(id) => self.anchor(id).await,
                Inline::Break => self.body.push_str("<w:r><w:br/></w:r>"),
                Inline::Image(image) => self.image(image).await?,
                Inline::Note(blocks) => {
                    self.notes.push(if let Some(direction) = direction {
                        vec![Block::Direction {
                            direction,
                            blocks: blocks.clone(),
                        }]
                    } else {
                        blocks.clone()
                    });
                    write!(self.body,"<w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:footnoteReference w:id=\"{}\"/></w:r>",self.notes.len()).unwrap();
                }
                Inline::RawOpenXml(fragment) => {
                    validate_fragment(fragment).await?;
                    self.body.push_str(fragment);
                }
                Inline::Text { text, style } => {
                    let mut text = std::borrow::Cow::Borrowed(text.as_str());
                    while !style.code {
                        yield_now().await;
                        let Some(Inline::Text {
                            text: next,
                            style: next_style,
                        }) = inlines.get(index)
                        else {
                            break;
                        };
                        if next_style != style {
                            break;
                        }
                        text.to_mut().push_str(next);
                        index += 1;
                    }
                    if let Some(link) = &style.link {
                        if let Some(id) = link.strip_prefix('#') {
                            let id =
                                resolve_fragment(id, |candidate| self.targets.contains(candidate))
                                    .unwrap_or(std::borrow::Cow::Borrowed(id));
                            write!(self.body, "<w:hyperlink w:anchor=\"{}\">", xml(&id).await)
                                .unwrap();
                        } else {
                            let rel = self.relation("hyperlink", link, true).await;
                            write!(self.body, "<w:hyperlink r:id=\"{rel}\">").unwrap();
                        }
                    }
                    self.body.push_str("<w:r><w:rPr>");
                    if style.code {
                        self.body.push_str("<w:rStyle w:val=\"VerbatimChar\"/>");
                    } else if style.link.is_some() {
                        self.body.push_str("<w:rStyle w:val=\"Hyperlink\"/>");
                    }
                    if style.bold || header {
                        self.body.push_str("<w:b/>");
                        if direction.is_some() {
                            self.body.push_str("<w:bCs/>");
                        }
                    }
                    if style.italic {
                        self.body.push_str("<w:i/>");
                        if direction.is_some() {
                            self.body.push_str("<w:iCs/>");
                        }
                    }
                    if style.strike {
                        self.body.push_str("<w:strike/>");
                    }
                    if let Some(color) = &style.color {
                        write!(self.body, "<w:color w:val=\"{}\"/>", xml(color).await).unwrap();
                    }
                    if style.underline {
                        self.body.push_str("<w:u w:val=\"single\"/>");
                    }
                    if let Some(color) = &style.highlight {
                        write!(
                            self.body,
                            "<w:shd w:val=\"clear\" w:fill=\"{}\"/>",
                            xml(color).await
                        )
                        .unwrap();
                    }
                    if style.sub {
                        self.body.push_str("<w:vertAlign w:val=\"subscript\"/>");
                    }
                    if style.sup {
                        self.body.push_str("<w:vertAlign w:val=\"superscript\"/>");
                    }
                    self.body.push_str("</w:rPr>");
                    for (i, line) in text.split('\n').enumerate() {
                        if i > 0 {
                            self.body.push_str("<w:br/>");
                        }
                        for (j, part) in line.split('\t').enumerate() {
                            if j > 0 {
                                self.body.push_str("<w:tab/>");
                            }
                            write!(
                                self.body,
                                "<w:t xml:space=\"preserve\">{}</w:t>",
                                xml(part).await
                            )
                            .unwrap();
                        }
                    }
                    self.body.push_str("</w:r>");
                    if style.link.is_some() {
                        self.body.push_str("</w:hyperlink>");
                    }
                }
            }
        }
        Ok(())
    }
    async fn paragraph(&mut self, p: &Paragraph, style: &str, ctx: Context) -> Result<(), String> {
        if ctx.number.is_none() && !self.note_reference && anchors_only(&p.inlines) {
            self.anchor(&p.id).await;
            self.runs(&p.inlines, ctx.header, ctx.direction).await?;
            return Ok(());
        }
        self.body.push_str("<w:p><w:pPr>");
        write!(self.body, "<w:pStyle w:val=\"{style}\"/>").unwrap();
        if p.keep_with_next {
            self.body.push_str("<w:keepNext/>");
        }
        if let Some(number) = ctx.number {
            write!(
                self.body,
                "<w:numPr><w:ilvl w:val=\"{}\"/><w:numId w:val=\"{number}\"/></w:numPr>",
                ctx.depth.min(8)
            )
            .unwrap();
        }
        if ctx.quote > 0 {
            self.body.push_str("<w:pBdr><w:left w:val=\"single\" w:sz=\"18\" w:space=\"10\" w:color=\"BCC9D8\"/></w:pBdr>");
            if let Some(direction) = ctx.direction {
                write!(
                    self.body,
                    "<w:bidi w:val=\"{}\"/>",
                    direction == Direction::Rtl
                )
                .unwrap();
            }
            write!(
                self.body,
                "<w:ind w:left=\"{}\" w:right=\"240\"/>",
                ctx.quote * 360 + ctx.depth * 360
            )
            .unwrap();
        } else {
            if let Some(direction) = ctx.direction {
                write!(
                    self.body,
                    "<w:bidi w:val=\"{}\"/>",
                    direction == Direction::Rtl
                )
                .unwrap();
            }
            if ctx.depth > 0 && ctx.number.is_none() {
                let side = if ctx.direction.is_some() {
                    "start"
                } else {
                    "left"
                };
                write!(self.body, "<w:ind w:{side}=\"{}\"/>", ctx.depth * 360).unwrap();
            }
        }
        let mut align = ctx.align.unwrap_or(p.align);
        if align == Align::Default && ctx.direction.is_some() {
            align = if ctx.direction == Some(Direction::Rtl) {
                Align::Right
            } else {
                Align::Left
            };
        }
        if align != Align::Default {
            write!(self.body, "<w:jc w:val=\"{}\"/>", alignment(align)).unwrap();
        }
        self.body.push_str("</w:pPr>");
        self.anchor(&p.id).await;
        if self.note_reference {
            self.body.push_str(
                "<w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:footnoteRef/></w:r>",
            );
            self.note_reference = false;
        }
        if let Some(direction) = ctx.direction {
            write!(self.body, "<w:dir w:val=\"{}\">", direction_name(direction)).unwrap();
        }
        self.runs(
            &p.inlines,
            ctx.header || (ctx.direction.is_some() && style.starts_with("Heading")),
            ctx.direction,
        )
        .await?;
        if ctx.direction.is_some() {
            self.body.push_str("</w:dir>");
        }
        self.body.push_str("</w:p>");
        Ok(())
    }
    async fn list_number(
        &mut self,
        start: Option<i64>,
        style: ListStyle,
        delimiter: ListDelimiter,
        depth: usize,
        directed: bool,
        checked: Option<bool>,
    ) -> usize {
        self.number_id += 1;
        let id = self.number_id;
        let depth = depth.min(8);
        write!(
            self.numbering,
            "<w:abstractNum w:abstractNumId=\"{id}\"><w:multiLevelType w:val=\"multilevel\"/>"
        )
        .unwrap();
        for level in 0..=8 {
            let (fmt, marker) = if let Some(checked) = checked {
                ("bullet", if checked { "☑" } else { "☐" }.into())
            } else if start.is_some() {
                (
                    match style {
                        ListStyle::Decimal => "decimal",
                        ListStyle::LowerAlpha => "lowerLetter",
                        ListStyle::UpperAlpha => "upperLetter",
                        ListStyle::LowerRoman => "lowerRoman",
                        ListStyle::UpperRoman => "upperRoman",
                    },
                    delimiter.wrap(&format!("%{}", level + 1)),
                )
            } else {
                ("bullet", ["•", "◦", "▪"][level % 3].into())
            };
            let justification = if directed {
                ""
            } else {
                "<w:lvlJc w:val=\"left\"/>"
            };
            let indent = if directed { "start" } else { "left" };
            let marker_font = if checked.is_some() {
                r#"<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr>"#
            } else {
                ""
            };
            write!(self.numbering,"<w:lvl w:ilvl=\"{level}\"><w:start w:val=\"{}\"/><w:numFmt w:val=\"{fmt}\"/><w:lvlText w:val=\"{marker}\"/>{justification}<w:pPr><w:tabs><w:tab w:val=\"num\" w:pos=\"{}\"/></w:tabs><w:ind w:{indent}=\"{}\" w:hanging=\"240\"/></w:pPr>{marker_font}</w:lvl>",if level==depth{start.unwrap_or(1)}else{1},(level+1)*360,(level+1)*360).unwrap();
        }
        self.numbering.push_str("</w:abstractNum>");
        write!(
            self.number_instances,
            "<w:num w:numId=\"{id}\"><w:abstractNumId w:val=\"{id}\"/></w:num>"
        )
        .unwrap();
        id
    }
    async fn blocks(&mut self, blocks: &[Block], ctx: Context) -> Result<(), String> {
        let first_content = if ctx.direction.is_some() || has_direction(blocks) {
            blocks
                .iter()
                .position(|block| !anchor_block(block))
                .unwrap_or(0)
        } else {
            0
        };
        for (index, block) in blocks.iter().enumerate() {
            yield_now().await;
            let ctx = Context {
                depth: ctx.depth
                    + usize::from(
                        ctx.direction.is_some() && ctx.number.is_some() && index > first_content,
                    ),
                number: if index == first_content {
                    ctx.number
                } else {
                    None
                },
                ..ctx
            };
            match block {
                Block::Direction { direction, blocks } => {
                    Box::pin(self.blocks(blocks, Context { direction: Some(*direction), ..ctx })).await?;
                }
                Block::Paragraph(p) => {
                    let style = if ctx.quote > 0 {
                        "BlockText"
                    } else if p.compact && (ctx.number.is_some() || ctx.in_cell) {
                        "Compact"
                    } else {
                        "BodyText"
                    };
                    self.paragraph(p, style, ctx).await?;
                }
                Block::Heading { level, id, inlines } => {
                    self.paragraph(
                        &Paragraph { id: id.clone(), inlines: inlines.clone(), ..Default::default() },
                        &format!("Heading{}", (*level).clamp(1, 6)), ctx,
                    ).await?;
                }
                Block::Code { text, .. } => {
                    self.paragraph(&Paragraph {
                        inlines: vec![Inline::Text { text: text.clone(), style: TextStyle { code: true, ..Default::default() } }],
                        ..Default::default()
                    }, "SourceCode", ctx).await?;
                }
                Block::Quote { kind, blocks } => {
                    let mut quote = Context { quote: ctx.quote + 1, ..ctx };
                    if let Some(kind) = kind {
                        self.paragraph(&Paragraph {
                            inlines: vec![Inline::Text { text: kind.clone(), style: TextStyle {
                                bold: true, color: Some("355D88".into()), ..Default::default()
                            }}], ..Default::default()
                        }, "Compact", quote).await?;
                        quote.number = None;
                    }
                    Box::pin(self.blocks(blocks, quote)).await?;
                }
                Block::List { start, style, delimiter, items } => {
                    let directed = ctx.direction.is_some() || items.iter().any(|item| has_direction(item));
                    let mut regular_number = None;
                    let mut checkboxes = [None, None];
                    let mut previous_task = false;
                    for (index, item) in items.iter().enumerate() {
                        let content_start = item.iter().position(|block| !anchor_block(block)).unwrap_or(0);
                        self.block_anchors(&item[..content_start], ctx).await?;
                        let item = &item[content_start..];
                        let checked = list_item_checked(item);
                        let id = if let Some(checked) = checked {
                            let cached = &mut checkboxes[usize::from(checked)];
                            if cached.is_none() {
                                *cached = Some(self.list_number(None, *style, *delimiter, ctx.depth, directed, Some(checked)).await);
                            }
                            cached.unwrap()
                        } else {
                            // A checkbox replaces its ordinal. Resume an ordered list at
                            // the original item position after a run of task markers.
                            if regular_number.is_none() || (previous_task && start.is_some()) {
                                let start = start.map(|start| start.saturating_add(index as i64));
                                regular_number = Some(self.list_number(start, *style, *delimiter, ctx.depth, directed, None).await);
                            }
                            regular_number.unwrap()
                        };
                        previous_task = checked.is_some();
                        if !first_paragraph(item, directed) {
                            let mut direction = ctx.direction;
                            let mut first = item.first();
                            while let Some(Block::Direction { direction: value, blocks }) = first {
                                direction = Some(*value);
                                first = blocks.first();
                            }
                            self.paragraph(&Paragraph::default(), "Compact", Context { direction, number: Some(id), ..ctx }).await?;
                            Box::pin(self.blocks(item, Context { depth: ctx.depth + 1, number: None, ..ctx })).await?;
                        } else {
                            for (i, b) in item.iter().enumerate() {
                                Box::pin(self.blocks(std::slice::from_ref(b), Context {
                                    depth: if i == 0 { ctx.depth } else { ctx.depth + 1 },
                                    number: if i == 0 { Some(id) } else { None }, ..ctx
                                })).await?;
                            }
                        }
                    }
                }
                Block::Image(image) => {
                    if ctx.direction.is_some() {
                        self.paragraph(&Paragraph { inlines: vec![Inline::Image(image.clone())], ..Default::default() }, "BodyText", ctx).await?;
                    } else {
                        self.body.push_str("<w:p>");
                        self.image(image).await?;
                        self.body.push_str("</w:p>");
                    }
                }
                Block::Vector(scene) => self.drawing(scene, ctx).await?,
                Block::Rule => self.body.push_str("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:color=\"BCC9D8\"/></w:pBdr></w:pPr></w:p>"),
                Block::Table { rows, width, column_widths } => {
                    Box::pin(self.table(rows, *width, column_widths, ctx.direction)).await?;
                }
                Block::RawOpenXml(fragment) => {
                    validate_fragment(fragment).await?;
                    self.body.push_str(fragment);
                }
            }
            if self.body.len() > 64 * 1024 * 1024 {
                return Err("Word document exceeds 64 MiB".into());
            }
        }
        Ok(())
    }
    async fn block_anchors(&mut self, blocks: &[Block], ctx: Context) -> Result<(), String> {
        for block in blocks {
            match block {
                Block::Paragraph(p) => {
                    self.anchor(&p.id).await;
                    self.runs(&p.inlines, ctx.header, ctx.direction).await?;
                }
                Block::Direction { direction, blocks } => {
                    Box::pin(self.block_anchors(
                        blocks,
                        Context {
                            direction: Some(*direction),
                            ..ctx
                        },
                    ))
                    .await?;
                }
                _ => unreachable!("only anchor blocks are passed here"),
            }
        }
        Ok(())
    }
    async fn table(
        &mut self,
        rows: &[TableRow],
        fraction: Option<f64>,
        column_widths: &[f64],
        direction: Option<Direction>,
    ) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        // Resolve HTML row spans into explicit Word continuation cells.
        let empty_cell = TableCell {
            header: false,
            blocks: Vec::new(),
            align: Align::Default,
            colspan: 1,
            rowspan: 1,
        };
        let mut remaining: Vec<(usize, usize, bool)> = Vec::new();
        let mut physical = Vec::new();
        let mut columns = 0;
        for row in rows {
            yield_now().await;
            let mut cells = Vec::new();
            let mut col = 0;
            for cell in &row.cells {
                yield_now().await;
                while remaining.get(col).is_some_and(|(rows, _, _)| *rows > 0) {
                    let span = remaining[col].1;
                    cells.push((col, span, None, row.header || remaining[col].2));
                    remaining[col].0 -= 1;
                    col += span;
                }
                let span = cell.colspan.max(1).min(1000);
                if col + span > 1000 {
                    return Err("Word table column limit exceeded".into());
                }
                remaining.resize(remaining.len().max(col + span), (0, 0, false));
                let heading = row.header || cell.header;
                remaining[col] = (cell.rowspan.saturating_sub(1), span, heading);
                cells.push((col, span, Some(cell), heading));
                col += span;
            }
            let last_continuation = remaining.iter().rposition(|(rows, _, _)| *rows > 0);
            while col < remaining.len() {
                if remaining[col].0 > 0 {
                    let span = remaining[col].1;
                    cells.push((col, span, None, row.header || remaining[col].2));
                    remaining[col].0 -= 1;
                    col += span;
                } else {
                    if last_continuation.is_some_and(|last| col < last) {
                        cells.push((col, 1, Some(&empty_cell), row.header));
                    }
                    col += 1;
                }
            }
            columns = columns.max(col);
            physical.push((row.header, cells));
        }
        let total = (7920. * fraction.unwrap_or(1.)).floor() as usize;
        let widths = document_ast_rust::table_columns(columns, column_widths)
            .into_iter()
            .map(|w| (total as f64 * w).round() as usize)
            .collect::<Vec<_>>();
        write!(
            self.body,
            "<w:tbl><w:tblPr>{}<w:tblW w:w=\"{}\" w:type=\"{}\"/><w:tblBorders>",
            match direction {
                Some(Direction::Rtl) => "<w:bidiVisual/>",
                Some(Direction::Ltr) => "<w:bidiVisual w:val=\"false\"/>",
                None => "",
            },
            (fraction.unwrap_or(0.) * 5000.).round() as usize,
            if fraction.is_some() { "pct" } else { "auto" }
        )
        .unwrap();
        for edge in ["top", "left", "bottom", "right", "insideH", "insideV"] {
            write!(
                self.body,
                "<w:{edge} w:val=\"single\" w:sz=\"4\" w:color=\"D5DDE5\"/>"
            )
            .unwrap();
        }
        self.body.push_str("</w:tblBorders><w:tblLayout w:type=\"fixed\"/><w:tblCellMar><w:top w:w=\"90\" w:type=\"dxa\"/><w:left w:w=\"110\" w:type=\"dxa\"/><w:bottom w:w=\"90\" w:type=\"dxa\"/><w:right w:w=\"110\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr><w:tblGrid>");
        for width in &widths {
            write!(self.body, "<w:gridCol w:w=\"{width}\"/>").unwrap();
        }
        self.body.push_str("</w:tblGrid>");
        for (header, cells) in physical {
            yield_now().await;
            self.body.push_str("<w:tr><w:trPr>");
            if header {
                self.body.push_str("<w:tblHeader/>");
            }
            self.body.push_str("</w:trPr>");
            for (column, span, cell, heading) in cells {
                yield_now().await;
                write!(
                    self.body,
                    "<w:tc><w:tcPr><w:tcW w:w=\"{}\" w:type=\"dxa\"/>",
                    widths[column..column + span].iter().sum::<usize>()
                )
                .unwrap();
                if span > 1 {
                    write!(self.body, "<w:gridSpan w:val=\"{span}\"/>").unwrap();
                }
                if cell.is_none() {
                    self.body.push_str("<w:vMerge/>");
                } else if cell.unwrap().rowspan > 1 {
                    self.body.push_str("<w:vMerge w:val=\"restart\"/>");
                }
                if heading {
                    self.body
                        .push_str("<w:shd w:val=\"clear\" w:fill=\"EDF2F7\"/>");
                }
                self.body.push_str("<w:tcMar><w:top w:w=\"90\" w:type=\"dxa\"/><w:left w:w=\"110\" w:type=\"dxa\"/><w:bottom w:w=\"90\" w:type=\"dxa\"/><w:right w:w=\"110\" w:type=\"dxa\"/></w:tcMar></w:tcPr>");
                if let Some(cell) = cell {
                    self.blocks(
                        &cell.blocks,
                        Context {
                            direction,
                            align: Some(cell.align),
                            header: heading,
                            number: None,
                            in_cell: true,
                            available_width: Some(
                                (widths[column..column + span].iter().sum::<usize>() as f64 / 20.
                                    - 11.)
                                    .max(1.),
                            ),
                            ..Context::default()
                        },
                    )
                    .await?;
                    if !ends_in_paragraph(&cell.blocks) {
                        self.body.push_str("<w:p/>");
                    }
                } else {
                    self.body.push_str("<w:p/>");
                }
                self.body.push_str("</w:tc>");
            }
            self.body.push_str("</w:tr>");
        }
        self.body.push_str("</w:tbl>");
        Ok(())
    }
}

fn theme() -> String {
    let mut out = String::from(
        r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4><a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink><a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>"#,
    );
    out.push_str(&r#"<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>"#.repeat(3));
    out.push_str("</a:fillStyleLst><a:lnStyleLst>");
    out.push_str(&r#"<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>"#.repeat(3));
    out.push_str("</a:lnStyleLst><a:effectStyleLst>");
    out.push_str(&"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3));
    out.push_str("</a:effectStyleLst><a:bgFillStyleLst>");
    out.push_str(&r#"<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>"#.repeat(3));
    out.push_str("</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>");
    out
}

fn styles() -> String {
    let mut out = format!(
        r#"<w:styles xmlns:w="{WORD}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/><w:color w:val="auto"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>"#
    );
    for (level, size) in [40, 32, 28, 24, 22, 20].into_iter().enumerate() {
        let level = level + 1;
        write!(out,r#"<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="{}" w:after="120"/><w:outlineLvl w:val="{}"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:b/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>"#,if level==1{240}else{280},level-1).unwrap();
    }
    out.push_str(r#"<w:style w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="BlockText"><w:name w:val="Block Text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:right="240"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F3F5F7"/><w:spacing w:before="100" w:after="160" w:line="240" w:lineRule="auto"/><w:ind w:left="160" w:right="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1764A0"/><w:u w:val="single"/></w:rPr></w:style></w:styles>"#);
    out
}

/// Write a complete editable Word document, including styles and embedded media.
pub fn to_package(document: &Document) -> Result<Package, String> {
    block_on(to_package_async(document))
}

/// Build Word package parts while yielding between bounded processing batches.
pub async fn to_package_async(document: &Document) -> Result<Package, String> {
    document_ast_rust::validate_async(document).await?;
    let mut w = Writer {
        body: format!(
            r#"<w:document xmlns:w="{WORD}" xmlns:r="{REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>"#
        ),
        relations: format!("<Relationships xmlns=\"{PACKAGE_REL}\">"),
        numbering: format!("<w:numbering xmlns:w=\"{WORD}\">"),
        number_instances: String::new(),
        images: Vec::new(),
        relation_id: 0,
        number_id: 0,
        bookmark_id: 0,
        image_id: 0,
        bookmarks: HashSet::new(),
        targets: collect_targets(document).await,
        notes: Vec::new(),
        note_reference: false,
    };
    w.blocks(&document.blocks, Context::default()).await?;
    w.body.push_str("<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1080\" w:right=\"1440\" w:bottom=\"1080\" w:left=\"1440\" w:header=\"540\" w:footer=\"540\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>");
    let mut footnotes = None;
    let mut footnote_relations = None;
    if !w.notes.is_empty() {
        let body = std::mem::take(&mut w.body);
        let relations = std::mem::replace(
            &mut w.relations,
            format!("<Relationships xmlns=\"{PACKAGE_REL}\">"),
        );
        write!(w.body,r#"<w:footnotes xmlns:w="{WORD}" xmlns:r="{REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">"#).unwrap();
        let note_count = w.notes.len();
        let mut index = 0;
        while index < note_count {
            let blocks = w.notes[index].clone();
            write!(w.body, "<w:footnote w:id=\"{}\">", index + 1).unwrap();
            w.note_reference = true;
            let mut first = blocks.first();
            while let Some(Block::Direction { blocks, .. }) = first {
                first = blocks.first();
            }
            if !matches!(
                first,
                Some(Block::Paragraph(_) | Block::Heading { .. } | Block::Code { .. })
            ) {
                w.paragraph(&Paragraph::default(), "BodyText", Context::default())
                    .await?;
            }
            w.blocks(&blocks, Context::default()).await?;
            if w.notes.len() > note_count {
                return Err("Nested footnotes are not supported in Word documents".into());
            }
            w.body.push_str("</w:footnote>");
            index += 1;
        }
        w.body.push_str("</w:footnotes>");
        footnotes = Some(std::mem::replace(&mut w.body, body));
        w.relation("numbering", "numbering.xml", false).await;
        w.relations.push_str("</Relationships>");
        footnote_relations = Some(std::mem::replace(&mut w.relations, relations));
        w.relation("footnotes", "footnotes.xml", false).await;
    }
    w.relation("theme", "theme/theme1.xml", false).await;
    w.relation("styles", "styles.xml", false).await;
    w.relation("numbering", "numbering.xml", false).await;
    w.relations.push_str("</Relationships>");
    w.numbering.push_str(&w.number_instances);
    w.numbering.push_str("</w:numbering>");
    let mut types = format!(
        r#"<Types xmlns="{CONTENT_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/><Default Extension="tiff" ContentType="image/tiff"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#
    );
    if footnotes.is_some() {
        let tail = types.len() - "</Types>".len();
        types.truncate(tail);
        types.push_str(r#"<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>"#);
    }
    let root = format!(
        r#"<Relationships xmlns="{PACKAGE_REL}"><Relationship Id="document" Type="{REL}/officeDocument" Target="word/document.xml"/><Relationship Id="metadata" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#
    );
    let core = format!(
        r#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{}</dc:title></cp:coreProperties>"#,
        xml(&document.title).await
    );
    let style = styles();
    let mut parts = vec![
        Part::new("[Content_Types].xml", types.into_bytes()),
        Part::new("_rels/.rels", root.into_bytes()),
        Part::new("docProps/core.xml", core.into_bytes()),
        Part::new("word/document.xml", w.body.into_bytes()),
        Part::new("word/styles.xml", style.into_bytes()),
        Part::new("word/theme/theme1.xml", theme().into_bytes()),
        Part::new("word/numbering.xml", w.numbering.into_bytes()),
        Part::new("word/_rels/document.xml.rels", w.relations.into_bytes()),
    ];
    if let Some(notes) = footnotes {
        parts.push(Part::new("word/footnotes.xml", notes.into_bytes()));
    }
    if let Some(rels) = footnote_relations {
        parts.push(Part::new(
            "word/_rels/footnotes.xml.rels",
            rels.into_bytes(),
        ));
    }
    parts.extend(
        w.images
            .into_iter()
            .map(|(name, bytes)| Part { name, bytes }),
    );
    Ok(Package { parts })
}

/// Serialize a self-contained Word package from semantic document content.
pub fn write_docx(document: &Document) -> Result<Vec<u8>, String> {
    block_on(write_docx_async(document))
}

/// Serialize a Word document while yielding during rendering and ZIP encoding.
pub async fn write_docx_async(document: &Document) -> Result<Vec<u8>, String> {
    to_package_async(document).await?.write_async().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };

    #[test]
    fn target_collection_yields_and_can_be_dropped_without_affecting_the_next_call() {
        let document = Document {
            title: String::new(),
            blocks: (0..512)
                .map(|index| {
                    Block::Paragraph(Paragraph {
                        id: format!("id{index}"),
                        inlines: vec![Inline::Direction {
                            direction: Direction::Ltr,
                            override_order: false,
                            inlines: vec![Inline::Note(vec![Block::Paragraph(Paragraph {
                                inlines: vec![Inline::Anchor(format!("note{index}"))],
                                ..Default::default()
                            })])],
                        }],
                        ..Default::default()
                    })
                })
                .collect(),
        };
        let mut context = Context::from_waker(Waker::noop());
        {
            let mut interrupted = pin!(collect_targets(&document));
            for _ in 0..64 {
                assert!(matches!(
                    interrupted.as_mut().poll(&mut context),
                    Poll::Pending
                ));
            }
        }
        let mut future = pin!(collect_targets(&document));
        let mut yields = 0;
        let targets = loop {
            match future.as_mut().poll(&mut context) {
                Poll::Ready(targets) => break targets,
                Poll::Pending => yields += 1,
            }
        };
        assert!(
            yields >= 1024,
            "collection must yield throughout nested content"
        );
        assert_eq!(targets.len(), 1024);
        assert!(targets.contains("id511") && targets.contains("note511"));
    }
}
