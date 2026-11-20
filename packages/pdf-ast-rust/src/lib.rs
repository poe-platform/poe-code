//! Vector PDF layout for the portable document tree. Fonts and images travel
//! inside the file; no browser, filesystem, network, or platform fonts are used.
use document_ast_rust::cooperate::{block_on, yield_now};
use document_ast_rust::{
    Align, Block, Direction, Document, Image, Inline, ListDelimiter, ListStyle, TableRow,
    TextStyle, list_item_checked,
};
mod vector;
use document_ast_rust::vector as scene;
mod images;
use images::image_pixels;
use terminal_png_rust::png::deflate_async as zlib_compress;
mod options;
use options::charge;
pub use options::*;
use std::{collections::BTreeMap, fmt::Write, sync::Arc};
use terminal_png_rust::font::Font;

/// Shared document faces: sans regular/bold/italic/bold-italic, then mono in
/// the same order, followed by the two symbol fallback faces.
pub const FONT_DATA: [&[u8]; 11] = [
    include_bytes!("fonts/LiberationSans-Regular.ttf"),
    include_bytes!("fonts/LiberationSans-Bold.ttf"),
    include_bytes!("fonts/LiberationSans-Italic.ttf"),
    include_bytes!("fonts/LiberationSans-BoldItalic.ttf"),
    include_bytes!("../../terminal-png-rust/assets/jetbrains-mono-400-normal.ttf"),
    include_bytes!("../../terminal-png-rust/assets/jetbrains-mono-700-normal.ttf"),
    include_bytes!("../../terminal-png-rust/assets/jetbrains-mono-400-italic.ttf"),
    include_bytes!("../../terminal-png-rust/assets/jetbrains-mono-700-italic.ttf"),
    include_bytes!("fonts/DejaVuSans.ttf"),
    include_bytes!("fonts/DocumentSymbolFallback.ttf"),
    include_bytes!("fonts/DejaVuSerif.ttf"),
];
const FONT_NAMES: [&str; 11] = [
    "LiberationSans",
    "LiberationSans-Bold",
    "LiberationSans-Italic",
    "LiberationSans-BoldItalic",
    "JetBrainsMono-Regular",
    "JetBrainsMono-Bold",
    "JetBrainsMono-Italic",
    "JetBrainsMono-BoldItalic",
    "DejaVuSans",
    "DocumentSymbolFallback",
    "DejaVuSerif",
];

#[derive(Clone)]
enum Content {
    Char(char),
    Checkbox(bool),
    Vector(Arc<Paint>, f64),
    Image(usize, f64),
    Table(Arc<TableLayout>, std::ops::Range<usize>),
    Anchor(String),
    Rule,
    Break,
}
#[derive(Clone)]
struct Atom {
    content: Content,
    width: f64,
    size: f64,
    font: usize,
    style: TextStyle,
}
#[derive(Clone, Default)]
struct Line {
    atoms: Vec<Atom>,
    anchors: Vec<String>,
    keep_with_next: bool,
    markers: Vec<(f64, Vec<Atom>)>,
    inset: f64,
    width: f64,
    height: f64,
    baseline: f64,
}
#[derive(Clone, Debug)]
pub enum Paint {
    Path {
        x: f64,
        y: f64,
        path: scene::Path,
        fill: Option<scene::Color>,
        stroke: Option<scene::Stroke>,
    },
    Group {
        x: f64,
        y: f64,
        bounds: [f64; 4],
        transform: [f64; 6],
        clip: Option<scene::Path>,
        opacity: f64,
        paints: Vec<Paint>,
    },
    Text {
        x: f64,
        y: f64,
        size: f64,
        font: usize,
        text: String,
        style: TextStyle,
    },
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        color: [f64; 3],
    },
    Stroke {
        x: f64,
        y: f64,
        width: f64,
        color: [f64; 3],
        weight: f64,
    },
    /// A font-independent task marker; x/y are its top-left corner.
    Checkbox {
        x: f64,
        y: f64,
        size: f64,
        checked: bool,
    },
    Image {
        id: usize,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}
#[derive(Clone, Debug)]
pub struct Page {
    pub width: f64,
    pub height: f64,
    pub paints: Vec<Paint>,
    /// Link target and rectangle [left, top, width, height] in points.
    pub links: Vec<(String, [f64; 4])>,
}
impl Page {
    fn new(box_: PageBox) -> Self {
        Self {
            width: box_.width,
            height: box_.height,
            paints: Vec::new(),
            links: Vec::new(),
        }
    }
}
#[derive(Clone, Debug)]
pub struct FontResource {
    pub id: String,
    pub bytes: Vec<u8>,
    pub synthetic: bool,
}
#[derive(Clone, Debug)]
pub struct Outline {
    pub title: String,
    pub page: usize,
    pub y: f64,
}
/// A reusable PDF display tree. Coordinates are points measured from the
/// page's top-left; resource indices reference this document's owned assets.
#[derive(Clone, Debug, Default)]
pub struct PdfDocument {
    pub pages: Vec<Page>,
    pub fonts: Vec<FontResource>,
    pub images: Vec<Image>,
    pub anchors: BTreeMap<String, (usize, f64)>,
    pub outlines: Vec<Outline>,
    pub metadata: PdfMetadata,
}
#[derive(Clone)]
struct CellLayout {
    header: bool,
    offset: f64,
    width: f64,
    lines: Vec<Line>,
    align: Align,
    rowspan: usize,
}
#[derive(Clone)]
struct TableLayout {
    cells: Vec<Vec<CellLayout>>,
    heights: Vec<f64>,
    headers: Vec<bool>,
}
impl TableLayout {
    fn section_header(&self, row: usize) -> bool {
        !self.headers[row]
            && !self.cells[row].is_empty()
            && self.cells[row].iter().all(|cell| cell.header)
            && self
                .cells
                .get(row + 1)
                .is_some_and(|cells| cells.iter().any(|cell| !cell.header))
    }
    fn header_count(&self) -> usize {
        self.headers.iter().take_while(|&&header| header).count()
    }
    fn group_end(&self, row: usize) -> usize {
        let mut end = row + 1;
        let mut cursor = row;
        while cursor < end {
            end = end.max(
                self.cells[cursor]
                    .iter()
                    .map(|cell| cursor + cell.rowspan)
                    .max()
                    .unwrap_or(cursor + 1),
            );
            cursor += 1;
        }
        end
    }
}
struct FontUse {
    glyphs: BTreeMap<char, u16>,
}
struct Layout<'a> {
    options: &'a PdfOptions,
    sources: Vec<&'a [u8]>,
    fonts: Vec<Font<'a>>,
    outlines: Vec<Outline>,
    notes: Vec<Vec<Block>>,
    glyphs: usize,
    work: usize,
    image_bytes: usize,
    pages: Vec<Page>,
    y: f64,
    images: Vec<Image>,
    anchors: BTreeMap<String, (usize, f64)>,
    pending_anchors: Vec<String>,
    text: usize,
}

// Scalar-only text, including standalone Emoticons with supplied font coverage.
// Font coverage alone cannot establish correct bidi order or contextual shaping.
fn admit_text_scalar(c: char) -> Result<(), String> {
    let point = c as u32;
    if !matches!(point, 0x20..=0x7e | 0xa0..=0x2af | 0x370..=0x52f | 0x1e00..=0x1fff | 0x2000..=0x2bff | 0xfffd | 0x1f600..=0x1f64f)
        || matches!(point, 0x483..=0x489)
    {
        return Err(format!(
            "Unsupported PDF script or combining sequence U+{point:04X}; text shaping is not available"
        ));
    }
    Ok(())
}

fn rgb(source: &str, fallback: [f64; 3]) -> [f64; 3] {
    let named = match source.to_ascii_lowercase().as_str() {
        "yellow" => Some([1., 0.95, 0.64]),
        "red" => Some([0.8, 0.1, 0.1]),
        "blue" => Some([0.1, 0.3, 0.7]),
        "green" => Some([0.1, 0.5, 0.25]),
        "black" => Some([0., 0., 0.]),
        "white" => Some([1., 1., 1.]),
        _ => None,
    };
    if let Some(color) = named {
        return color;
    }
    let hex = source.strip_prefix('#').unwrap_or(source);
    if hex.len() == 6 {
        if let Ok(n) = u32::from_str_radix(hex, 16) {
            return [
                ((n >> 16) & 255) as f64 / 255.,
                ((n >> 8) & 255) as f64 / 255.,
                (n & 255) as f64 / 255.,
            ];
        }
    } else if hex.len() == 3
        && let Ok(n) = u16::from_str_radix(hex, 16)
    {
        return [
            ((n >> 8) & 15) as f64 / 15.,
            ((n >> 4) & 15) as f64 / 15.,
            (n & 15) as f64 / 15.,
        ];
    }
    fallback
}

fn admit_direction(direction: Direction, override_order: bool) -> Result<(), String> {
    if override_order {
        return Err("PDF export does not yet support directional overrides; export DOCX to preserve this content".into());
    }
    if direction == Direction::Rtl {
        return Err("PDF export does not yet support right-to-left direction; export DOCX to preserve this content".into());
    }
    Ok(())
}

async fn direction_blocks(blocks: &[Block]) -> Result<Vec<&Block>, String> {
    let mut pending = vec![blocks.iter()];
    let mut out = Vec::new();
    while let Some(iter) = pending.last_mut() {
        yield_now().await;
        match iter.next() {
            Some(Block::Direction { direction, blocks }) => {
                admit_direction(*direction, false)?;
                pending.push(blocks.iter());
            }
            Some(block) => out.push(block),
            None => {
                pending.pop();
            }
        }
    }
    Ok(out)
}

async fn direction_inlines(inlines: &[Inline]) -> Result<Vec<&Inline>, String> {
    let mut pending = vec![inlines.iter()];
    let mut out = Vec::new();
    while let Some(iter) = pending.last_mut() {
        yield_now().await;
        match iter.next() {
            Some(Inline::Direction {
                direction,
                override_order,
                inlines,
            }) => {
                admit_direction(*direction, *override_order)?;
                pending.push(inlines.iter());
            }
            Some(inline) => out.push(inline),
            None => {
                pending.pop();
            }
        }
    }
    Ok(out)
}

impl<'a> Layout<'a> {
    async fn new(options: &'a PdfOptions) -> Result<Self, String> {
        options.validate()?;
        let sources: Vec<&[u8]> = if options.fonts.is_empty() {
            FONT_DATA.to_vec()
        } else {
            options.fonts.iter().map(|f| f.bytes.as_slice()).collect()
        };
        // Unused packaged font faces are not charged or embedded. Supplied
        // resources are admitted before parsing, including fallback faces.
        if !options.fonts.is_empty() {
            let mut used = 0;
            charge(&mut used, sources.len(), options.limits.fonts, "fonts")?;
            let mut bytes = 0;
            for source in &sources {
                charge(
                    &mut bytes,
                    source.len(),
                    options.limits.font_bytes,
                    "fontBytes",
                )?;
            }
        }
        let mut parsed_fonts = Vec::new();
        for source in &sources {
            yield_now().await;
            parsed_fonts.push(Font::new(source).map_err(str::to_owned)?);
        }
        Ok(Self {
            options,
            sources: sources.clone(),
            fonts: parsed_fonts,
            pages: vec![Page::new(options.page)],
            y: options.page.margin,
            images: Vec::new(),
            anchors: BTreeMap::new(),
            pending_anchors: Vec::new(),
            outlines: Vec::new(),
            notes: Vec::new(),
            text: 0,
            glyphs: 0,
            work: 0,
            image_bytes: 0,
        })
    }
    fn bottom(&self) -> f64 {
        self.options.page.height - self.options.page.margin
    }
    fn page(&mut self) -> &mut Page {
        self.pages.last_mut().unwrap()
    }
    fn next_page(&mut self) -> Result<(), String> {
        if self.pages.len() >= self.options.limits.pages {
            return Err("E_LIMIT: PDF pages limit exceeded".into());
        }
        self.pages.push(Page::new(self.options.page));
        self.y = self.options.page.margin;
        Ok(())
    }
    fn ensure(&mut self, height: f64) -> Result<(), String> {
        if height > self.bottom() - self.options.page.margin {
            return Err("PDF content exceeds page bounds (printable page height)".into());
        }
        if self.y + height > self.bottom() && self.y > self.options.page.margin {
            self.next_page()?;
        }
        Ok(())
    }
    fn anchor(&mut self, id: &str, y: f64) {
        if !id.is_empty() {
            self.anchors
                .entry(id.to_owned())
                .or_insert((self.pages.len() - 1, y));
        }
    }
    fn flush_pending_anchors(&mut self, y: f64) {
        for id in std::mem::take(&mut self.pending_anchors) {
            self.anchor(&id, y);
        }
    }
    fn image(&mut self, image: &Image) -> Result<usize, String> {
        if !image.width.is_finite()
            || !image.height.is_finite()
            || image.width <= 0.
            || image.height <= 0.
        {
            return Err("Image has invalid display dimensions".into());
        }
        if let Some(id) = self
            .images
            .iter()
            .position(|other| other.bytes == image.bytes)
        {
            return Ok(id);
        }
        if self.images.len() >= self.options.limits.images {
            return Err("E_LIMIT: PDF images limit exceeded".into());
        }
        charge(
            &mut self.image_bytes,
            image.bytes.len(),
            self.options.limits.image_bytes,
            "imageBytes",
        )?;
        self.images.push(image.clone());
        Ok(self.images.len() - 1)
    }
    async fn atoms(
        &mut self,
        inlines: &[Inline],
        size: f64,
        strong: bool,
        width: f64,
    ) -> Result<Vec<Atom>, String> {
        let mut atoms = Vec::new();
        for inline in direction_inlines(inlines).await? {
            yield_now().await;
            match inline {
                Inline::Direction { .. } => unreachable!("direction scopes were admitted above"),
                Inline::RawOpenXml(_) => return Err("Raw OpenXML is not PDF content".into()),
                Inline::Note(blocks) => {
                    let number = self.notes.len() + 1;
                    self.notes.push(
                        direction_blocks(blocks)
                            .await?
                            .into_iter()
                            .cloned()
                            .collect(),
                    );
                    let marker = [Inline::Text {
                        text: format!("[{number}]"),
                        style: TextStyle::default(),
                    }];
                    atoms.extend(Box::pin(self.atoms(&marker, size, strong, width)).await?);
                }
                Inline::Text { text, style } => {
                    self.text = self
                        .text
                        .checked_add(text.len())
                        .ok_or("Document is too large")?;
                    charge(
                        &mut self.work,
                        text.len(),
                        self.options.limits.layout_work,
                        "layoutWork",
                    )?;
                    let mut style = style.clone();
                    style.bold |= strong;
                    let preferred = if !self.options.fonts.is_empty() {
                        0
                    } else if style.code || self.options.font_family == FontFamily::Mono {
                        4 + usize::from(style.bold) + 2 * usize::from(style.italic)
                    } else {
                        usize::from(style.bold) + 2 * usize::from(style.italic)
                    };
                    let size = size
                        * if style.sub || style.sup {
                            0.72
                        } else if style.code {
                            0.88
                        } else {
                            1.
                        };
                    for (character_index, c) in text.chars().enumerate() {
                        if character_index % 512 == 0 {
                            yield_now().await;
                        }
                        if c == '\r' {
                            continue;
                        }
                        if c == '\n' {
                            atoms.push(Atom {
                                content: Content::Break,
                                width: 0.,
                                size,
                                font: preferred,
                                style: style.clone(),
                            });
                            continue;
                        }
                        let c = if c == '\t' { ' ' } else { c };
                        admit_text_scalar(c)?;
                        charge(&mut self.glyphs, 1, self.options.limits.glyphs, "glyphs")?;
                        let font = std::iter::once(preferred)
                            .chain(self.options.fonts.is_empty().then_some(8))
                            .chain(0..self.fonts.len())
                            .find(|&i| self.fonts[i].glyph_index(c as u32) != 0)
                            .ok_or_else(|| {
                                format!("No supplied PDF font covers U+{:04X}", c as u32)
                            })?;
                        let glyph = self.fonts[font].glyph_index(c as u32);
                        let advance =
                            f64::from(self.fonts[font].advance(glyph).map_err(str::to_owned)?)
                                / f64::from(self.fonts[font].units_per_em())
                                * size;
                        if advance <= 0. {
                            return Err(format!("Nonadvancing PDF glyph U+{:04X}", c as u32));
                        }
                        atoms.push(Atom {
                            content: Content::Char(c),
                            width: advance,
                            size,
                            font,
                            style: style.clone(),
                        });
                    }
                }
                Inline::Break => atoms.push(Atom {
                    content: Content::Break,
                    width: 0.,
                    size,
                    font: 0,
                    style: TextStyle::default(),
                }),
                Inline::Anchor(id) => atoms.push(Atom {
                    content: Content::Anchor(id.clone()),
                    width: 0.,
                    size,
                    font: 0,
                    style: TextStyle::default(),
                }),
                Inline::Image(image) => {
                    let scale = (width / (image.width * 0.75))
                        .min(
                            (self.bottom() - self.options.page.margin - 24.)
                                / (image.height * 0.75),
                        )
                        .min(1.);
                    let w = image.width * 0.75 * scale;
                    let h = image.height * 0.75 * scale;
                    let id = self.image(image)?;
                    atoms.push(Atom {
                        content: Content::Image(id, h),
                        width: w,
                        size,
                        font: 0,
                        style: TextStyle {
                            link: image.link.clone(),
                            ..Default::default()
                        },
                    });
                }
            }
        }
        Ok(atoms)
    }
    async fn lines(
        &mut self,
        inlines: &[Inline],
        size: f64,
        strong: bool,
        width: f64,
        literal: bool,
    ) -> Result<Vec<Line>, String> {
        if width < 12. {
            return Err("Document nesting leaves no room for text".into());
        }
        let atoms = self.atoms(inlines, size, strong, width).await?;
        let size = if literal { size * 0.88 } else { size };
        let line_height = if literal {
            1.5
        } else {
            self.options.line_height
        };
        let mut lines = Vec::new();
        let mut line = Vec::new();
        let mut used = 0.;
        let mut boundary = None;
        for (atom_index, atom) in atoms.into_iter().enumerate() {
            if atom_index % 512 == 0 {
                yield_now().await;
            }
            if matches!(atom.content, Content::Break) {
                lines.push(make_line(std::mem::take(&mut line), size, line_height));
                used = 0.;
                boundary = None;
                continue;
            }
            if used + atom.width > width && !line.is_empty() {
                let tail = if !literal {
                    boundary.map(|n| line.split_off(n)).unwrap_or_default()
                } else {
                    Vec::new()
                };
                if !literal {
                    while line.last().is_some_and(whitespace) {
                        line.pop();
                    }
                }
                lines.push(make_line(std::mem::take(&mut line), size, line_height));
                line = tail;
                if !literal {
                    while line.first().is_some_and(whitespace) {
                        line.remove(0);
                    }
                }
                used = line.iter().map(|a| a.width).sum();
                boundary = None;
            }
            if !literal && line.is_empty() && whitespace(&atom) {
                continue;
            }
            used += atom.width;
            line.push(atom);
            if line.last().is_some_and(whitespace) {
                boundary = Some(line.len());
            }
        }
        if !line.is_empty() || lines.is_empty() {
            lines.push(make_line(line, size, line_height));
        }
        Ok(lines)
    }
    async fn paint_line(&mut self, line: &Line, x: f64, y: f64, width: f64, align: Align) {
        self.flush_pending_anchors(y);
        for id in &line.anchors {
            self.anchor(id, y);
        }
        let mut x = x + match align {
            Align::Default | Align::Left => 0.,
            Align::Center => (width - line.width).max(0.) / 2.,
            Align::Right => (width - line.width).max(0.),
        };
        for (inset, atoms) in &line.markers {
            let mut marker = make_line(atoms.clone(), 10., self.options.line_height);
            marker.baseline = first_visible_baseline(line).unwrap_or(marker.baseline);
            Box::pin(self.paint_line(&marker, x + inset, y, marker.width, Align::Left)).await;
        }
        x += line.inset;
        let mut index = 0;
        while index < line.atoms.len() {
            if index % 512 == 0 {
                yield_now().await;
            }
            let atom = &line.atoms[index];
            match &atom.content {
                Content::Checkbox(checked) => {
                    self.page().paints.push(Paint::Checkbox {
                        x,
                        y: y + line.baseline - atom.size * 0.9,
                        size: atom.size,
                        checked: *checked,
                    });
                    x += atom.width;
                    index += 1;
                }
                Content::Rule => {
                    self.page().paints.push(Paint::Stroke {
                        x,
                        y: y + line.height / 2.,
                        width: atom.width,
                        color: [0.76, 0.78, 0.81],
                        weight: 0.7,
                    });
                    x += atom.width;
                    index += 1;
                }
                Content::Anchor(id) => {
                    self.anchor(id, y);
                    index += 1;
                }
                Content::Vector(paint, height) => {
                    let mut paint = (**paint).clone();
                    let Paint::Group {
                        x: left, y: top, ..
                    } = &mut paint
                    else {
                        unreachable!()
                    };
                    *left += x;
                    *top += y + line.baseline - height;
                    self.page().paints.push(paint);
                    x += atom.width;
                    index += 1;
                }
                Content::Image(id, height) => {
                    self.page().paints.push(Paint::Image {
                        id: *id,
                        x,
                        y: y + line.baseline - height,
                        width: atom.width,
                        height: *height,
                    });
                    if let Some(link) = &atom.style.link {
                        self.page().links.push((
                            link.clone(),
                            [x, y + line.baseline - height, atom.width, *height],
                        ));
                    }
                    x += atom.width;
                    index += 1;
                }
                Content::Table(table, rows) => {
                    let height = table.heights[rows.clone()].iter().sum::<f64>();
                    let mut top = y + line.baseline - height;
                    for row in rows.clone() {
                        for cell in &table.cells[row] {
                            let height = table.heights[row..row + cell.rowspan].iter().sum();
                            Box::pin(self.table_cell(
                                cell,
                                x,
                                top,
                                height,
                                table.headers[row],
                                None,
                            ))
                            .await;
                        }
                        top += table.heights[row];
                    }
                    x += atom.width;
                    index += 1;
                }
                Content::Char(_) => {
                    let mut text = String::new();
                    let mut run_width = 0.;
                    while let Some(next) = line.atoms.get(index) {
                        let Content::Char(c) = next.content else {
                            break;
                        };
                        if next.font != atom.font
                            || next.size != atom.size
                            || next.style != atom.style
                        {
                            break;
                        }
                        if index % 512 == 0 {
                            yield_now().await;
                        }
                        text.push(c);
                        run_width += next.width;
                        index += 1;
                    }
                    let baseline = y
                        + line.baseline
                        + if atom.style.sub {
                            atom.size * 0.3
                        } else if atom.style.sup {
                            -atom.size * 0.5
                        } else {
                            0.
                        };
                    if atom.style.highlight.is_some() || atom.style.code {
                        self.page().paints.push(Paint::Rect {
                            x: x - 0.8,
                            y: baseline - atom.size * 0.88,
                            width: run_width + 1.6,
                            height: atom.size * 1.15,
                            color: atom
                                .style
                                .highlight
                                .as_deref()
                                .map(|c| rgb(c, [1., 0.95, 0.64]))
                                .unwrap_or([0.95, 0.96, 0.97]),
                        });
                    }
                    self.page().paints.push(Paint::Text {
                        x,
                        y: baseline,
                        size: atom.size,
                        font: atom.font,
                        text,
                        style: atom.style.clone(),
                    });
                    let color = atom
                        .style
                        .color
                        .as_deref()
                        .map(|s| rgb(s, [13. / 255.; 3]))
                        .unwrap_or(if atom.style.link.is_some() {
                            [0.12, 0.29, 0.57]
                        } else {
                            [13. / 255.; 3]
                        });
                    for offset in [
                        atom.style.underline.then_some(atom.size * 0.12),
                        atom.style.strike.then_some(-atom.size * 0.3),
                    ]
                    .into_iter()
                    .flatten()
                    {
                        self.page().paints.push(Paint::Stroke {
                            x,
                            y: baseline + offset,
                            width: run_width,
                            color,
                            weight: 0.55,
                        });
                    }
                    if let Some(link) = &atom.style.link {
                        self.page().links.push((
                            link.clone(),
                            [x, baseline - atom.size, run_width, atom.size * 1.3],
                        ));
                    }
                    x += run_width;
                }
                Content::Break => {
                    index += 1;
                }
            }
        }
    }
    async fn paragraph(
        &mut self,
        inlines: &[Inline],
        x: f64,
        width: f64,
        size: f64,
        strong: bool,
        align: Align,
        literal: bool,
        shaded: bool,
    ) -> Result<(usize, f64), String> {
        let mut lines = self.lines(inlines, size, strong, width, literal).await?;
        if strong {
            for line in &mut lines {
                line.height = (line.baseline + size * 0.2).max(size * 1.25);
            }
        }
        self.ensure(first_lines_height(
            &lines,
            self.bottom() - self.options.page.margin,
        ))?;
        let start = (self.pages.len() - 1, self.y);
        for (i, line) in lines.iter().enumerate() {
            let needed = if i + 2 == lines.len()
                && line.height + lines[i + 1].height <= self.bottom() - self.options.page.margin
            {
                line.height + lines[i + 1].height
            } else {
                line.height
            };
            self.ensure(needed)?;
            if shaded {
                let y = self.y;
                self.page().paints.push(Paint::Rect {
                    x: x - 8.,
                    y,
                    width: width + 16.,
                    height: line.height,
                    color: [0.955, 0.96, 0.97],
                });
            }
            self.paint_line(line, x, self.y, width, align).await;
            self.y += line.height;
        }
        Ok(start)
    }
    async fn list_markers(
        &mut self,
        start: Option<i64>,
        style: ListStyle,
        delimiter: ListDelimiter,
        items: &[Vec<Block>],
        width: f64,
        size: f64,
        strong: bool,
        cell: bool,
    ) -> Result<(f64, Vec<Line>), String> {
        let mut markers = Vec::new();
        let mut marker_width: f64 = if cell { 0. } else { 20. };
        for (index, item) in items.iter().enumerate() {
            yield_now().await;
            let atoms = if let Some(checked) = list_item_checked(item) {
                charge(
                    &mut self.work,
                    1,
                    self.options.limits.layout_work,
                    "layoutWork",
                )?;
                vec![Atom {
                    content: Content::Checkbox(checked),
                    width: size,
                    size,
                    font: 0,
                    style: TextStyle::default(),
                }]
            } else {
                let mut text = start.map_or_else(
                    || "•".to_owned(),
                    |start| style.marker(start.saturating_add(index as i64), delimiter),
                );
                if cell {
                    text.push(' ');
                }
                self.atoms(
                    &[Inline::Text {
                        text,
                        style: TextStyle::default(),
                    }],
                    size,
                    strong,
                    width,
                )
                .await?
            };
            let line = make_line(atoms, size, self.options.line_height);
            marker_width = marker_width.max(line.width);
            markers.push(line);
        }
        if width - marker_width - 7. < 12. {
            return Err("PDF list marker exceeds page text width".into());
        }
        Ok((marker_width, markers))
    }
    async fn keep_height(
        &self,
        blocks: &[&Block],
        x: f64,
        width: f64,
        depth: usize,
        list_item: bool,
    ) -> Result<f64, String> {
        // Measure in isolation so notes, resource deduplication and work counters
        // are not changed before the actual document order is laid out.
        let mut measure = Layout::new(self.options).await?;
        measure.notes = vec![Vec::new(); self.notes.len()];
        measure
            .measure_keep(blocks, x, width, depth, list_item)
            .await?;
        if measure.pages.len() > 1 {
            return Ok(f64::INFINITY);
        }
        Ok(measure.y - self.options.page.margin)
    }
    async fn measure_keep(
        &mut self,
        blocks: &[&Block],
        x: f64,
        width: f64,
        depth: usize,
        list_item: bool,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("Document nesting exceeds the PDF limit".into());
        }
        let capacity = self.bottom() - self.options.page.margin;
        let mut trailing_margin = 0.;
        for block in blocks {
            if self.pages.len() > 1 || self.y > self.bottom() {
                break;
            }
            yield_now().await;
            if let Block::Paragraph(p) = block {
                let inlines = direction_inlines(&p.inlines).await?;
                if !inlines.is_empty() && inlines.iter().all(|i| matches!(i, Inline::Anchor(_))) {
                    continue;
                }
                if p.keep_with_next {
                    self.paragraph(
                        &p.inlines,
                        x,
                        width,
                        self.options.font_size,
                        false,
                        p.align,
                        false,
                        false,
                    )
                    .await?;
                    trailing_margin = self.options.font_size * if list_item { 0.3 } else { 0.8 };
                    self.y += trailing_margin;
                    continue;
                }
            }
            if let Block::Heading { level, inlines, .. } = block {
                let size = heading_size(*level, self.options.font_size);
                if self.y > self.options.page.margin {
                    self.y += (size * 1.3 - trailing_margin).max(0.);
                }
                self.paragraph(inlines, x, width, size, true, Align::Left, false, false)
                    .await?;
                trailing_margin = size * 0.35;
                self.y += trailing_margin;
                continue;
            }
            if let Block::Table {
                rows,
                column_widths,
                width: fraction,
            } = block
            {
                if rows.is_empty() {
                    self.y += 10.;
                    continue;
                }
                let prepared = self
                    .prepare_table(
                        rows,
                        column_widths,
                        width * fraction.unwrap_or(1.),
                        depth + 1,
                    )
                    .await?;
                let prepared = Arc::new(prepared);
                let mut leading = Vec::new();
                let mut row = 0;
                while row < rows.len() {
                    let end = prepared.group_end(row);
                    leading.push(table_line(
                        prepared.clone(),
                        row..end,
                        width * fraction.unwrap_or(1.),
                    ));
                    if end > prepared.header_count()
                        && (end != row + 1 || !prepared.section_header(row))
                    {
                        break;
                    }
                    row = end;
                }
                // Reserve the preceding heading/caption when deciding whether
                // the first body row needs to split instead of moving intact.
                self.y += required_lines_height(&leading, self.bottom() - self.y);
            } else if let Block::Paragraph(p) = block {
                let lines = self
                    .lines(&p.inlines, self.options.font_size, false, width, false)
                    .await?;
                self.y += first_lines_height(&lines, capacity).max(18.);
            } else if let Block::Vector(scene) = block {
                self.y += self.vector_line(scene, width).await?.height;
            } else if let Block::Image(image) = block {
                let lines = self
                    .lines(
                        &[Inline::Image(image.clone())],
                        self.options.font_size,
                        false,
                        width,
                        false,
                    )
                    .await?;
                self.y += first_lines_height(&lines, capacity);
            } else if let Block::Code { text, .. } = block {
                let lines = self
                    .lines(
                        &[Inline::Text {
                            text: text.clone(),
                            style: TextStyle {
                                code: true,
                                ..Default::default()
                            },
                        }],
                        self.options.font_size,
                        false,
                        width - 16.,
                        true,
                    )
                    .await?;
                self.y += 5. + first_lines_height(&lines, capacity);
            } else if let Block::Rule = block {
                self.y += 18.;
            } else if let Block::Quote { kind, blocks } = block {
                let start = self.y;
                if let Some(kind) = kind {
                    let size = self.options.font_size;
                    let mut lines = self
                        .lines(
                            &[Inline::Text {
                                text: kind.clone(),
                                style: TextStyle::default(),
                            }],
                            size,
                            true,
                            width - 18.,
                            false,
                        )
                        .await?;
                    for line in &mut lines {
                        line.height = (line.baseline + size * 0.2).max(size * 1.25);
                    }
                    self.y += first_lines_height(&lines, capacity);
                } else {
                    Box::pin(self.measure_keep(
                        &direction_blocks(blocks).await?,
                        x + 13.,
                        width - 18.,
                        depth + 1,
                        false,
                    ))
                    .await?;
                }
                self.y = self.y.max(start + 36.);
            } else if let Block::List {
                start,
                style,
                delimiter,
                items,
            } = block
            {
                let Some(first) = items.first() else {
                    self.y += 5.;
                    continue;
                };
                let (marker_width, _) = self
                    .list_markers(
                        *start,
                        *style,
                        *delimiter,
                        items,
                        width,
                        self.options.font_size,
                        false,
                        false,
                    )
                    .await?;
                let inset = marker_width + 7.;
                let start = self.y;
                Box::pin(self.measure_keep(
                    &direction_blocks(first).await?,
                    x + inset,
                    width - inset,
                    depth + 1,
                    true,
                ))
                .await?;
                self.y = self.y.max(
                    start
                        + (self.options.font_size * self.options.line_height * 2.)
                            .max(32.)
                            .min(capacity),
                );
            } else {
                Box::pin(self.blocks(std::slice::from_ref(*block), x, width, depth, list_item))
                    .await?;
            }
            break;
        }
        Ok(())
    }
    async fn blocks(
        &mut self,
        blocks: &[Block],
        x: f64,
        width: f64,
        depth: usize,
        list_item: bool,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("Document nesting exceeds the PDF limit".into());
        }
        let mut keeping = false;
        let mut trailing_margin = 0.;
        let blocks = direction_blocks(blocks).await?;
        for (index, block) in blocks.iter().enumerate() {
            yield_now().await;
            let keep = matches!(block, Block::Heading { .. })
                || matches!(block, Block::Paragraph(p) if p.keep_with_next);
            if keep && !keeping {
                let height =
                    Box::pin(self.keep_height(&blocks[index..], x, width, depth, list_item))
                        .await?;
                keeping = height <= self.bottom() - self.options.page.margin;
                if keeping {
                    let gap = if self.y > self.options.page.margin {
                        match block {
                            Block::Heading { level, .. } => {
                                (heading_size(*level, self.options.font_size) * 1.3
                                    - trailing_margin)
                                    .max(0.)
                            }
                            _ => 0.,
                        }
                    } else {
                        0.
                    };
                    // The leading heading gap disappears when this group moves to a new page.
                    self.ensure((height + gap).min(self.bottom() - self.options.page.margin))?;
                }
            }
            let keep_with_previous = keeping;
            if !keep {
                keeping = false;
            }
            match block {
                Block::Direction { .. } => unreachable!("direction scopes were admitted above"),
                Block::RawOpenXml(_) => return Err("Raw OpenXML is not PDF content".into()),
                Block::Paragraph(p) => {
                    let inlines = direction_inlines(&p.inlines).await?;
                    if !inlines.is_empty() && inlines.iter().all(|i| matches!(i, Inline::Anchor(_)))
                    {
                        if !p.id.is_empty() {
                            self.pending_anchors.push(p.id.clone());
                        }
                        for inline in inlines {
                            if let Inline::Anchor(id) = inline {
                                self.pending_anchors.push(id.clone());
                            }
                        }
                        continue;
                    }
                    self.ensure(18.)?;
                    let start = self
                        .paragraph(
                            &p.inlines,
                            x,
                            width,
                            self.options.font_size,
                            false,
                            p.align,
                            false,
                            false,
                        )
                        .await?;
                    if !p.id.is_empty() {
                        self.anchors.entry(p.id.clone()).or_insert(start);
                    }
                    trailing_margin = self.options.font_size * if list_item { 0.3 } else { 0.8 };
                    self.y += trailing_margin;
                }
                Block::Heading { level, id, inlines } => {
                    let size = heading_size(*level, self.options.font_size);
                    if self.y > self.options.page.margin {
                        self.y += (size * 1.3 - trailing_margin).max(0.);
                    }
                    let start = self
                        .paragraph(inlines, x, width, size, true, Align::Left, false, false)
                        .await?;
                    if !id.is_empty() {
                        self.anchors.entry(id.clone()).or_insert(start);
                    }
                    self.outlines.push(Outline {
                        title: direction_inlines(inlines)
                            .await?
                            .into_iter()
                            .filter_map(|i| {
                                if let Inline::Text { text, .. } = i {
                                    Some(text.as_str())
                                } else {
                                    None
                                }
                            })
                            .collect(),
                        page: start.0,
                        y: start.1,
                    });
                    trailing_margin = size * 0.35;
                    self.y += trailing_margin;
                }
                Block::List {
                    start,
                    style,
                    delimiter,
                    items,
                } => {
                    let (marker_width, markers) = self
                        .list_markers(
                            *start,
                            *style,
                            *delimiter,
                            items,
                            width,
                            self.options.font_size,
                            false,
                            false,
                        )
                        .await?;
                    let inset = marker_width + 7.;
                    for (item, marker) in items.iter().zip(&markers) {
                        self.ensure(
                            (self.options.font_size * self.options.line_height * 2.)
                                .max(32.)
                                .min(self.bottom() - self.options.page.margin),
                        )?;
                        let start_page = self.pages.len() - 1;
                        let start_paint = self.pages[start_page].paints.len();
                        let before = self.y;
                        let pending = std::mem::take(&mut self.pending_anchors);
                        self.paint_line(marker, x, before, marker_width, Align::Right)
                            .await;
                        self.pending_anchors = pending;
                        let mut marker_paints =
                            self.pages[start_page].paints.split_off(start_paint);
                        Box::pin(self.blocks(item, x + inset, width - inset, depth + 1, true))
                            .await?;
                        // Item layout may move its first block to another page.
                        // Insert the marker before that page's first item paint.
                        let target = (start_page..self.pages.len()).find_map(|page| {
                            let start = if page == start_page { start_paint } else { 0 };
                            let paints = &self.pages[page].paints[start..];
                            let baseline = paints
                                .iter()
                                .find_map(|paint| match paint {
                                    Paint::Text { y, size, style, .. } => Some(
                                        *y - if style.sub {
                                            *size * 0.3
                                        } else if style.sup {
                                            -*size * 0.5
                                        } else {
                                            0.
                                        },
                                    ),
                                    Paint::Image { y, .. } => Some(*y + self.options.font_size),
                                    _ => None,
                                })
                                .or_else(|| {
                                    paints.first().map(|paint| {
                                        let y = match paint {
                                            Paint::Text { y, .. }
                                            | Paint::Image { y, .. }
                                            | Paint::Rect { y, .. }
                                            | Paint::Stroke { y, .. }
                                            | Paint::Checkbox { y, .. }
                                            | Paint::Path { y, .. }
                                            | Paint::Group { y, .. } => *y,
                                        };
                                        y + self.options.font_size
                                    })
                                });
                            baseline.map(|y| (page, start, y))
                        });
                        if target.is_none() {
                            // An empty item still paints its marker, which owns any pending IDs.
                            for id in std::mem::take(&mut self.pending_anchors) {
                                if !id.is_empty() {
                                    self.anchors.entry(id).or_insert((start_page, before));
                                }
                            }
                        }
                        let target =
                            target.unwrap_or((start_page, start_paint, before + marker.baseline));
                        for paint in &mut marker_paints {
                            let (Paint::Text { y, .. }
                            | Paint::Image { y, .. }
                            | Paint::Rect { y, .. }
                            | Paint::Stroke { y, .. }
                            | Paint::Checkbox { y, .. }
                            | Paint::Path { y, .. }
                            | Paint::Group { y, .. }) = paint;
                            *y += target.2 - before - marker.baseline;
                        }
                        self.pages[target.0]
                            .paints
                            .splice(target.1..target.1, marker_paints);
                        if self.y == before {
                            self.y += 15.;
                        }
                    }
                    self.y += 5.;
                }
                Block::Quote { kind, blocks } => {
                    self.ensure(36.)?;
                    let first = self.pages.len() - 1;
                    let top = self.y;
                    if let Some(kind) = kind {
                        self.paragraph(
                            &[Inline::Text {
                                text: kind.clone(),
                                style: TextStyle {
                                    bold: true,
                                    color: Some("355d88".into()),
                                    ..Default::default()
                                },
                            }],
                            x + 13.,
                            width - 18.,
                            self.options.font_size,
                            true,
                            Align::Left,
                            false,
                            false,
                        )
                        .await?;
                        self.y += 4.;
                    }
                    Box::pin(self.blocks(blocks, x + 13., width - 18., depth + 1, false)).await?;
                    let last = self.pages.len() - 1;
                    for page in first..=last {
                        let start = if page == first {
                            top
                        } else {
                            self.options.page.margin
                        };
                        let end = if page == last {
                            self.y - 3.
                        } else {
                            self.bottom()
                        };
                        self.pages[page].paints.push(Paint::Rect {
                            x,
                            y: start,
                            width: 2.,
                            height: (end - start).max(4.),
                            color: if kind.is_some() {
                                [0.36, 0.53, 0.72]
                            } else {
                                [0.72, 0.75, 0.79]
                            },
                        });
                    }
                    self.y += 4.;
                }
                Block::Code { text, .. } => {
                    self.y += 5.;
                    self.paragraph(
                        &[Inline::Text {
                            text: text.clone(),
                            style: TextStyle {
                                code: true,
                                ..Default::default()
                            },
                        }],
                        x + 8.,
                        width - 16.,
                        self.options.font_size,
                        false,
                        Align::Left,
                        true,
                        true,
                    )
                    .await?;
                    self.y += 10.;
                }
                Block::Table {
                    rows,
                    width: fraction,
                    column_widths,
                } => {
                    self.table(
                        rows,
                        column_widths,
                        x,
                        width * fraction.unwrap_or(1.),
                        depth + 1,
                        keep_with_previous,
                    )
                    .await?
                }
                Block::Vector(scene) => {
                    let line = self.vector_line(scene, width).await?;
                    self.ensure(line.height)?;
                    self.paint_line(&line, x, self.y, width, Align::Left).await;
                    self.y += line.height + 8.;
                }
                Block::Image(image) => {
                    self.paragraph(
                        &[Inline::Image(image.clone())],
                        x,
                        width,
                        self.options.font_size,
                        false,
                        Align::Left,
                        false,
                        false,
                    )
                    .await?;
                    self.y += 8.;
                }
                Block::Rule => {
                    self.ensure(18.)?;
                    self.flush_pending_anchors(self.y);
                    self.y += 7.;
                    let y = self.y;
                    self.page().paints.push(Paint::Stroke {
                        x,
                        y,
                        width,
                        color: [0.76, 0.78, 0.81],
                        weight: 0.7,
                    });
                    self.y += 10.;
                }
            }
            if !matches!(block, Block::Paragraph(_) | Block::Heading { .. }) {
                trailing_margin = 0.;
            }
        }
        Ok(())
    }
    async fn cell_lines(
        &mut self,
        blocks: &[Block],
        width: f64,
        header: bool,
        depth: usize,
    ) -> Result<Vec<Line>, String> {
        if depth > 32 {
            return Err("Table nesting exceeds the PDF limit".into());
        }
        let mut lines = Vec::new();
        let mut anchors = Vec::new();
        for block in direction_blocks(blocks).await? {
            yield_now().await;
            let (inlines, size, strong, literal) = match block {
                Block::Direction { .. } => unreachable!("direction scopes were admitted above"),
                Block::RawOpenXml(_) => return Err("Raw OpenXML is not PDF content".into()),
                Block::Paragraph(p) => {
                    let mut inlines = direction_inlines(&p.inlines)
                        .await?
                        .into_iter()
                        .cloned()
                        .collect::<Vec<_>>();
                    if !p.id.is_empty() {
                        inlines.insert(0, Inline::Anchor(p.id.clone()));
                    }
                    if !inlines.is_empty()
                        && inlines
                            .iter()
                            .all(|inline| matches!(inline, Inline::Anchor(_)))
                    {
                        for inline in inlines {
                            if let Inline::Anchor(id) = inline {
                                anchors.push((lines.len(), id));
                            }
                        }
                        continue;
                    }
                    (inlines, 10., header, false)
                }
                Block::Heading { level, id, inlines } => {
                    let mut inlines = direction_inlines(inlines)
                        .await?
                        .into_iter()
                        .cloned()
                        .collect::<Vec<_>>();
                    if !id.is_empty() {
                        inlines.insert(0, Inline::Anchor(id.clone()));
                    }
                    (inlines, heading_size(*level, 10.), true, false)
                }
                Block::Code { text, .. } => (
                    vec![Inline::Text {
                        text: text.clone(),
                        style: TextStyle {
                            code: true,
                            ..Default::default()
                        },
                    }],
                    10.,
                    header,
                    true,
                ),
                Block::Vector(scene) => {
                    lines.push(self.vector_line(scene, width).await?);
                    continue;
                }
                Block::Image(image) => (vec![Inline::Image(image.clone())], 10., false, false),
                Block::Quote { kind, blocks } => {
                    let mut quoted = Vec::new();
                    if let Some(kind) = kind {
                        quoted.extend(
                            self.lines(
                                &[Inline::Text {
                                    text: kind.clone(),
                                    style: TextStyle::default(),
                                }],
                                10.,
                                true,
                                width - 18.,
                                false,
                            )
                            .await?,
                        );
                    }
                    quoted.extend(
                        Box::pin(self.cell_lines(blocks, width - 18., header, depth + 1)).await?,
                    );
                    for line in &mut quoted {
                        line.inset += 13.;
                        line.width += 18.;
                        for (inset, _) in &mut line.markers {
                            *inset += 13.;
                        }
                    }
                    lines.extend(quoted);
                    continue;
                }
                Block::List {
                    start,
                    style,
                    delimiter,
                    items,
                } => {
                    let (marker_width, markers) = self
                        .list_markers(*start, *style, *delimiter, items, width, 10., header, true)
                        .await?;
                    let inset = marker_width + 7.;
                    for (item, marker) in items.iter().zip(markers) {
                        let mut nested =
                            Box::pin(self.cell_lines(item, width - inset, header, depth + 1))
                                .await?;
                        for line in &mut nested {
                            line.inset += inset;
                            line.width += inset;
                            for (inset, _) in &mut line.markers {
                                *inset += marker_width + 7.;
                            }
                        }
                        if let Some(first) = nested.first_mut() {
                            first.markers.insert(0, (0., marker.atoms));
                        }
                        lines.extend(nested);
                    }
                    continue;
                }
                Block::Table {
                    rows,
                    width: fraction,
                    column_widths,
                } => {
                    let width = width * fraction.unwrap_or(1.);
                    let table = Arc::new(
                        Box::pin(self.prepare_table(rows, column_widths, width, depth + 1)).await?,
                    );
                    let mut row = 0;
                    while row < rows.len() {
                        let end = table.group_end(row);
                        lines.push(table_line(table.clone(), row..end, width));
                        row = end;
                    }
                    continue;
                }
                Block::Rule => {
                    lines.push(make_line(
                        vec![Atom {
                            content: Content::Rule,
                            width,
                            size: 5.,
                            font: 0,
                            style: TextStyle::default(),
                        }],
                        5.,
                        self.options.line_height,
                    ));
                    continue;
                }
            };
            let mut block_lines = self.lines(&inlines, size, strong, width, literal).await?;
            if matches!(block, Block::Heading { .. }) {
                for line in &mut block_lines {
                    line.height = (line.baseline + size * 0.2).max(size * 1.25);
                }
            }
            if matches!(block, Block::Heading { .. })
                || matches!(block, Block::Paragraph(p) if p.keep_with_next)
            {
                for line in &mut block_lines {
                    line.keep_with_next = true;
                }
            }
            lines.extend(block_lines);
        }
        if lines.is_empty() {
            lines.push(make_line(Vec::new(), 10., self.options.line_height));
        }
        for (index, id) in anchors {
            if index == lines.len() {
                lines.push(Line::default());
            }
            lines[index].anchors.push(id);
        }
        Ok(lines)
    }
    async fn prepare_table(
        &mut self,
        rows: &[TableRow],
        column_widths: &[f64],
        width: f64,
        depth: usize,
    ) -> Result<TableLayout, String> {
        // Place cells in the actual grid before measuring. Continuation rows
        // skip the columns occupied by a rowspan instead of shifting left.
        let mut occupied = [0usize; 64];
        let mut positions = Vec::new();
        let mut columns = 0;
        for (r, row) in rows.iter().enumerate() {
            yield_now().await;
            let mut column = 0;
            let mut placed = Vec::new();
            for cell in &row.cells {
                let span = cell.colspan.max(1);
                let rowspan = cell.rowspan.max(1).min(rows.len() - r);
                while column < occupied.len() && occupied[column] > r {
                    column += 1;
                }
                if span > 64
                    || column + span > 64
                    || occupied[column..column + span].iter().any(|&end| end > r)
                {
                    return Err("PDF table has an invalid or oversized cell span".into());
                }
                for end in &mut occupied[column..column + span] {
                    *end = r + rowspan;
                }
                placed.push((column, span, rowspan));
                column += span;
                columns = columns.max(column);
            }
            positions.push(placed);
        }
        let widths = document_ast_rust::table_columns(columns, column_widths)
            .into_iter()
            .map(|w| w * width)
            .collect::<Vec<_>>();
        let mut offsets = vec![0.];
        for width in &widths {
            offsets.push(offsets.last().unwrap() + width);
        }
        let mut prepared = Vec::new();
        let mut heights = vec![24.; rows.len()];
        for (r, row) in rows.iter().enumerate() {
            yield_now().await;
            let mut cells = Vec::new();
            for (cell, &(column, span, rowspan)) in row.cells.iter().zip(&positions[r]) {
                let width = widths[column..column + span].iter().sum::<f64>();
                let header = row.header || cell.header;
                let lines =
                    Box::pin(self.cell_lines(&cell.blocks, width - 12., header, depth)).await?;
                let height = lines.iter().map(|l| l.height).sum::<f64>() + 12.;
                if rowspan == 1 {
                    heights[r] = f64::max(heights[r], height);
                }
                cells.push(CellLayout {
                    header,
                    offset: offsets[column],
                    width,
                    lines,
                    align: cell.align,
                    rowspan,
                });
            }
            prepared.push(cells);
        }
        for (r, cells) in prepared.iter().enumerate() {
            for cell in cells.iter().filter(|c| c.rowspan > 1) {
                let needed = cell.lines.iter().map(|l| l.height).sum::<f64>() + 12.;
                let available = heights[r..r + cell.rowspan].iter().sum::<f64>();
                if needed > available {
                    heights[r + cell.rowspan - 1] += needed - available;
                }
            }
        }
        Ok(TableLayout {
            cells: prepared,
            heights,
            headers: rows.iter().map(|r| r.header).collect(),
        })
    }
    async fn take_cell_lines(
        &mut self,
        lines: &[Line],
        available: f64,
        page_capacity: f64,
    ) -> Result<(Vec<Line>, Vec<Line>), String> {
        let mut head = Vec::new();
        let mut used = 0.;
        for (index, line) in lines.iter().enumerate() {
            yield_now().await;
            if required_lines_height(&lines[index..], page_capacity) > available - used + 0.001 {
                return Ok((head, clone_lines(&lines[index..]).await));
            }
            if line.height <= available - used + 0.001 {
                head.push(line.clone());
                used += line.height;
            } else if let Some((first, rest)) = Box::pin(self.split_table_line(
                line,
                available - used,
                line_capacity(line, page_capacity),
            ))
            .await?
            {
                head.push(first);
                let mut tail = vec![rest];
                tail.extend(clone_lines(&lines[index + 1..]).await);
                return Ok((head, tail));
            } else {
                return Ok((head, clone_lines(&lines[index..]).await));
            }
        }
        Ok((head, Vec::new()))
    }
    async fn split_table_line(
        &mut self,
        line: &Line,
        available: f64,
        page_capacity: f64,
    ) -> Result<Option<(Line, Line)>, String> {
        let [atom] = line.atoms.as_slice() else {
            return Ok(None);
        };
        let Content::Table(table, range) = &atom.content else {
            return Ok(None);
        };
        let header_count = table.header_count();
        if range.len() != 1
            || range.start < header_count
            || table.cells[range.start].iter().any(|c| c.rowspan != 1)
        {
            return Ok(None);
        }
        let mut head_cells = Vec::new();
        let mut tail_cells = Vec::new();
        for cell in &table.cells[range.start] {
            let (head, mut tail) =
                Box::pin(self.take_cell_lines(&cell.lines, available - 12., page_capacity - 12.))
                    .await?;
            prepend_table_header(&mut tail);
            let copy = |lines| CellLayout {
                header: cell.header,
                offset: cell.offset,
                width: cell.width,
                align: cell.align,
                rowspan: 1,
                lines,
            };
            head_cells.push(copy(head));
            tail_cells.push(copy(tail));
        }
        if head_cells.iter().all(|cell| cell.lines.is_empty()) {
            return Ok(None);
        }
        let fragment = |cells: Vec<CellLayout>| {
            let height = cells
                .iter()
                .map(|cell| cell.lines.iter().map(|line| line.height).sum::<f64>() + 12.)
                .fold(24., f64::max);
            let mut rows = table.cells[..header_count].to_vec();
            rows.push(cells);
            let mut heights = table.heights[..header_count].to_vec();
            heights.push(height);
            let mut headers = vec![true; header_count];
            headers.push(false);
            table_line(
                Arc::new(TableLayout {
                    cells: rows,
                    heights,
                    headers,
                }),
                header_count..header_count + 1,
                atom.width,
            )
        };
        let mut head = fragment(head_cells);
        head.anchors = line.anchors.clone();
        head.markers = line.markers.clone();
        head.inset = line.inset;
        head.width += line.width - atom.width;
        let mut tail = fragment(tail_cells);
        tail.inset = line.inset;
        tail.width += line.width - atom.width;
        Ok(Some((head, tail)))
    }
    async fn table(
        &mut self,
        rows: &[TableRow],
        column_widths: &[f64],
        x: f64,
        width: f64,
        depth: usize,
        mut keep_with_previous: bool,
    ) -> Result<(), String> {
        let table = Arc::new(
            self.prepare_table(rows, column_widths, width, depth)
                .await?,
        );
        let mut remaining = Vec::new();
        let mut row = 0;
        while row < rows.len() {
            let end = table.group_end(row);
            remaining.push(table_line(table.clone(), row..end, width));
            row = end;
        }
        while !remaining.is_empty() {
            yield_now().await;
            let capacity = self.bottom()
                - if keep_with_previous {
                    self.y
                } else {
                    self.options.page.margin
                };
            let (head, mut tail) = self
                .take_cell_lines(&remaining, self.bottom() - self.y, capacity)
                .await?;
            keep_with_previous = false;
            if head.is_empty() {
                if self.y > self.options.page.margin {
                    self.next_page()?;
                    prepend_table_header(&mut remaining);
                    continue;
                }
                return Err("Table cell content or vertically merged group exceeds page bounds (printable page height)".into());
            }
            for line in &head {
                self.paint_line(line, x, self.y, width, Align::Left).await;
                self.y += line.height;
            }
            if !tail.is_empty() {
                self.next_page()?;
                prepend_table_header(&mut tail);
            }
            remaining = tail;
        }
        self.y += 10.;
        Ok(())
    }
    async fn table_cell(
        &mut self,
        cell: &CellLayout,
        x: f64,
        top: f64,
        height: f64,
        header: bool,
        slice: Option<std::ops::Range<usize>>,
    ) {
        let left = x + cell.offset;
        if header || cell.header {
            self.page().paints.push(Paint::Rect {
                x: left,
                y: top,
                width: cell.width,
                height,
                color: [0.93, 0.95, 0.97],
            });
        }
        for y in [top, top + height] {
            self.page().paints.push(Paint::Stroke {
                x: left,
                y,
                width: cell.width,
                color: [0.75, 0.79, 0.83],
                weight: 0.5,
            });
        }
        for x in [left, left + cell.width] {
            self.page().paints.push(Paint::Rect {
                x,
                y: top,
                width: 0.5,
                height,
                color: [0.75, 0.79, 0.83],
            });
        }
        let mut y = top + 6.;
        for line in &cell.lines[slice.unwrap_or(0..cell.lines.len())] {
            self.paint_line(line, left + 6., y, cell.width - 12., cell.align)
                .await;
            y += line.height;
        }
    }
}

async fn clone_lines(lines: &[Line]) -> Vec<Line> {
    let mut result = Vec::with_capacity(lines.len());
    for chunk in lines.chunks(32) {
        yield_now().await;
        result.extend_from_slice(chunk);
    }
    result
}
fn first_visible_baseline(line: &Line) -> Option<f64> {
    let mut first: Option<f64> = None;
    for atom in &line.atoms {
        let baseline = match &atom.content {
            Content::Checkbox(_) => Some(line.baseline),
            Content::Char(c) if !c.is_whitespace() => Some(line.baseline),
            Content::Image(_, height) | Content::Vector(_, height) => {
                Some(line.baseline - height + atom.size)
            }
            Content::Table(table, rows) => {
                let mut top = line.baseline - table.heights[rows.clone()].iter().sum::<f64>();
                let mut result: Option<f64> = None;
                for row in rows.clone() {
                    for cell in &table.cells[row] {
                        let mut y = top + 6.;
                        for line in &cell.lines {
                            if let Some(baseline) = first_visible_baseline(line) {
                                let baseline = y + baseline;
                                result = Some(result.map_or(baseline, |prior| prior.min(baseline)));
                                break;
                            }
                            y += line.height;
                        }
                    }
                    if result.is_some() {
                        break;
                    }
                    top += table.heights[row];
                }
                result
            }
            _ => None,
        };
        if let Some(baseline) = baseline {
            first = Some(first.map_or(baseline, |prior| prior.min(baseline)));
        }
    }
    first
}
fn table_line(table: Arc<TableLayout>, rows: std::ops::Range<usize>, width: f64) -> Line {
    let height = table.heights[rows.clone()].iter().sum();
    Line {
        atoms: vec![Atom {
            content: Content::Table(table, rows),
            width,
            size: 10.,
            font: 0,
            style: TextStyle::default(),
        }],
        width,
        height,
        baseline: height,
        ..Default::default()
    }
}
fn is_header_line(line: &Line) -> bool {
    matches!(line.atoms.as_slice(),[Atom{content:Content::Table(table,rows),..}] if rows.end<=table.header_count())
}
fn line_capacity(line: &Line, page_capacity: f64) -> f64 {
    if let [
        Atom {
            content: Content::Table(table, rows),
            ..
        },
    ] = line.atoms.as_slice()
    {
        let count = table.header_count();
        if rows.start >= count {
            return page_capacity - table.heights[..count].iter().sum::<f64>();
        }
    }
    page_capacity
}
fn required_lines_height(lines: &[Line], page_capacity: f64) -> f64 {
    let mut height = 0.;
    let mut minimum = None;
    for (index, line) in lines.iter().enumerate() {
        if is_header_line(line) {
            height += line.height;
            if height > page_capacity {
                return minimum.unwrap_or(height);
            }
            continue;
        }
        let capacity = line_capacity(line, page_capacity);
        let needed = if line.height <= capacity {
            line.height
        } else if let [
            Atom {
                content: Content::Table(table, rows),
                ..
            },
        ] = line.atoms.as_slice()
        {
            if rows.len() == 1 && table.cells[rows.start].iter().all(|cell| cell.rowspan == 1) {
                table.cells[rows.start]
                    .iter()
                    .map(|cell| required_lines_height(&cell.lines, capacity - 12.) + 12.)
                    .fold(24., f64::max)
            } else {
                line.height
            }
        } else {
            line.height
        };
        height += needed;
        let minimum = *minimum.get_or_insert(height);
        if height > page_capacity {
            return minimum;
        }
        if line.keep_with_next && index + 1 < lines.len() {
            continue;
        }
        if let [
            Atom {
                content: Content::Table(table, rows),
                ..
            },
        ] = line.atoms.as_slice()
            && rows.len() == 1
            && table.section_header(rows.start)
            && let Some(next) = lines.get(index + 1)
            && matches!(next.atoms.as_slice(), [Atom { content: Content::Table(next_table, next_rows), .. }] if Arc::ptr_eq(table, next_table) && next_rows.start == rows.end)
        {
            let next = required_lines_height(&lines[index + 1..], page_capacity);
            if needed + next <= capacity {
                height += next;
            }
        }
        if height > page_capacity {
            return minimum;
        }
        break;
    }
    height
}
fn prepend_table_header(lines: &mut Vec<Line>) {
    let Some(line) = lines.first() else {
        return;
    };
    let [
        Atom {
            content: Content::Table(table, rows),
            width,
            ..
        },
    ] = line.atoms.as_slice()
    else {
        return;
    };
    let count = table.header_count();
    if count > 0
        && rows.start >= count
        && table.cells[..count]
            .iter()
            .enumerate()
            .all(|(row, cells)| cells.iter().all(|cell| row + cell.rowspan <= count))
    {
        let mut header = table_line(table.clone(), 0..count, *width);
        header.inset = line.inset;
        header.width += line.width - width;
        lines.insert(0, header);
    }
}
fn whitespace(atom: &Atom) -> bool {
    // Unicode no-break spaces are visible content, not wrapping or trimming
    // opportunities. This also preserves them at the start of a line.
    matches!(atom.content, Content::Char(c)
        if c.is_whitespace() && !matches!(c, '\u{00a0}' | '\u{2007}' | '\u{202f}'))
        && !atom.style.code
}
fn heading_size(level: u8, font_size: f64) -> f64 {
    font_size
        * match level {
            1 => 2.,
            2 => 1.5,
            3 => 1.25,
            4 => 1.1,
            _ => 1.,
        }
}
fn first_lines_height(lines: &[Line], capacity: f64) -> f64 {
    let first = lines.first().map_or(0., |line| line.height);
    let together = first + lines.get(1).map_or(0., |line| line.height);
    if together <= capacity {
        together
    } else {
        first
    }
}
fn make_line(atoms: Vec<Atom>, size: f64, multiplier: f64) -> Line {
    let baseline = atoms
        .iter()
        .map(|a| match a.content {
            Content::Image(_, h) | Content::Vector(_, h) => h,
            Content::Table(ref table, ref rows) => table.heights[rows.clone()].iter().sum(),
            _ => a.size,
        })
        .fold(size, f64::max);
    let height = (baseline + size * 0.2).max(size * multiplier);
    Line {
        width: atoms.iter().map(|a| a.width).sum(),
        atoms,
        height,
        baseline,
        ..Default::default()
    }
}

struct Objects {
    bodies: Vec<Vec<u8>>,
}
impl Objects {
    fn reserve(&mut self) -> usize {
        self.bodies.push(Vec::new());
        self.bodies.len()
    }
    fn add(&mut self, body: impl Into<Vec<u8>>) -> usize {
        let id = self.reserve();
        self.bodies[id - 1] = body.into();
        id
    }
    fn set(&mut self, id: usize, body: impl Into<Vec<u8>>) {
        self.bodies[id - 1] = body.into();
    }
    async fn stream(&mut self, dict: &str, bytes: &[u8], compress: bool) -> usize {
        let compressed;
        let data = if compress {
            compressed = zlib_compress(bytes).await;
            compressed.as_slice()
        } else {
            bytes
        };
        let mut body = format!(
            "<< {dict} /Length {} {} >>\nstream\n",
            data.len(),
            if compress { "/Filter /FlateDecode" } else { "" }
        )
        .into_bytes();
        body.extend_from_slice(data);
        body.extend_from_slice(b"\nendstream");
        self.add(body)
    }
    async fn finish(self, catalog: usize, info: usize) -> Vec<u8> {
        let mut out = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets = vec![0];
        for (i, body) in self.bodies.iter().enumerate() {
            yield_now().await;
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        }
        let xref = out.len();
        out.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes(),
        );
        for offset in &offsets[1..] {
            out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(format!("trailer\n<< /Size {} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n",offsets.len()).as_bytes());
        out
    }
}
fn literal(text: &str) -> String {
    let mut out = "(".to_owned();
    for c in text.chars() {
        match c {
            '(' | ')' | '\\' => {
                out.push('\\');
                out.push(c)
            }
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(c),
        }
    }
    out.push(')');
    out
}
fn unicode(text: &str) -> String {
    let mut out = "<FEFF".to_owned();
    for n in text.encode_utf16() {
        write!(out, "{n:04X}").unwrap();
    }
    out.push('>');
    out
}

async fn font_object(
    objects: &mut Objects,
    font: &Font<'_>,
    resource: &FontResource,
    usage: &FontUse,
) -> Result<usize, String> {
    let name = resource
        .id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let font_bytes = resource.bytes.as_slice();
    let file = objects
        .stream(&format!("/Length1 {}", font_bytes.len()), font_bytes, true)
        .await;
    let scale = 1000. / f64::from(font.units_per_em());
    let bbox = font.bounding_box().map(|v| f64::from(v) * scale);
    let descriptor=objects.add(format!("<< /Type /FontDescriptor /FontName /{name} /Flags 32 /FontBBox [{} {} {} {}] /ItalicAngle 0 /Ascent {} /Descent {} /CapHeight {} /StemV 80 /FontFile2 {file} 0 R >>",bbox[0],bbox[1],bbox[2],bbox[3],f64::from(font.ascent())*scale,f64::from(font.descent())*scale,f64::from(font.ascent())*scale).into_bytes());

    let mut mapping = vec![0u8; (usage.glyphs.len() + 1) * 2];
    let mut widths = BTreeMap::new();
    let mut cmap = String::from(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PortableUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
    );
    for chunk in usage.glyphs.iter().collect::<Vec<_>>().chunks(100) {
        yield_now().await;
        writeln!(cmap, "{} beginbfchar", chunk.len()).unwrap();
        for &(c, cid) in chunk {
            let glyph = font.glyph_index(*c as u32);
            mapping[usize::from(*cid) * 2..usize::from(*cid) * 2 + 2]
                .copy_from_slice(&glyph.to_be_bytes());
            widths.insert(
                *cid,
                f64::from(font.advance(glyph).map_err(str::to_owned)?)
                    / f64::from(font.units_per_em())
                    * 1000.,
            );
            let mut units = [0u16; 2];
            let encoded = c.encode_utf16(&mut units);
            write!(cmap, "<{cid:04X}> <").unwrap();
            for unit in encoded {
                write!(cmap, "{unit:04X}").unwrap();
            }
            cmap.push_str(">\n");
        }
        cmap.push_str("endbfchar\n");
    }
    cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    let to_unicode = objects.stream("", cmap.as_bytes(), false).await;
    let gid = objects.stream("", &mapping, true).await;
    let mut w = String::from("[1 [");
    for width in widths.values() {
        write!(w, "{width:.3} ").unwrap();
    }
    w.push_str("]]");
    let cidfont=objects.add(format!("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor {descriptor} 0 R /CIDToGIDMap {gid} 0 R /DW 1000 /W {w} >>").into_bytes());
    Ok(objects.add(format!("<< /Type /Font /Subtype /Type0 /BaseFont /{name} /Encoding /Identity-H /DescendantFonts [{cidfont} 0 R] /ToUnicode {to_unicode} 0 R >>").into_bytes()))
}

/// Lay out portable authoring nodes into an editable PDF page display tree.
pub async fn layout_document_async(
    document: &Document,
    options: &PdfOptions,
) -> Result<PdfDocument, String> {
    document_ast_rust::validate_async(document).await?;
    if options.limits.pages == 0 {
        return Err("E_LIMIT: PDF pages limit exceeded".into());
    }
    let mut layout = Layout::new(options).await?;
    layout
        .blocks(
            &document.blocks,
            options.page.margin,
            options.page.width - 2. * options.page.margin,
            0,
            false,
        )
        .await?;
    layout.flush_pending_anchors(layout.y);
    if !layout.notes.is_empty() {
        let heading = [Block::Heading {
            level: 2,
            id: String::new(),
            inlines: vec![Inline::Text {
                text: "Notes".into(),
                style: TextStyle::default(),
            }],
        }];
        layout
            .blocks(
                &heading,
                options.page.margin,
                options.page.width - 2. * options.page.margin,
                0,
                false,
            )
            .await?;
        let mut i = 0;
        while i < layout.notes.len() {
            yield_now().await;
            let mut blocks = layout.notes[i].clone();
            let marker = Inline::Text {
                text: format!("[{}] ", i + 1),
                style: TextStyle::default(),
            };
            if let Some(Block::Paragraph(p)) = blocks.first_mut() {
                p.inlines.insert(0, marker);
            } else {
                blocks.insert(
                    0,
                    Block::Paragraph(document_ast_rust::Paragraph {
                        inlines: vec![marker],
                        ..Default::default()
                    }),
                );
            }
            layout
                .blocks(
                    &blocks,
                    options.page.margin,
                    options.page.width - 2. * options.page.margin,
                    0,
                    false,
                )
                .await?;
            i += 1;
        }
    }
    layout.flush_pending_anchors(layout.y);
    let mut metadata = options.metadata.clone();
    if metadata.title.is_none() && !document.title.is_empty() {
        metadata.title = Some(document.title.clone());
    }
    let used = layout
        .pages
        .iter()
        .flat_map(|page| {
            vector::paints(&page.paints).filter_map(|p| {
                if let Paint::Text { font, .. } = p {
                    Some(*font)
                } else {
                    None
                }
            })
        })
        .collect::<std::collections::BTreeSet<_>>();
    let mut font_map = BTreeMap::new();
    let mut fonts = Vec::new();
    for i in used {
        font_map.insert(i, fonts.len());
        fonts.push(FontResource {
            id: options
                .fonts
                .get(i)
                .map(|f| f.id.clone())
                .unwrap_or_else(|| FONT_NAMES[i].into()),
            bytes: layout.sources[i].to_vec(),
            synthetic: !options.fonts.is_empty() || matches!(i, 8 | 10),
        });
    }
    for page in &mut layout.pages {
        vector::remap_fonts(&mut page.paints, &font_map);
    }
    Ok(PdfDocument {
        pages: layout.pages,
        fonts,
        images: layout.images,
        anchors: layout.anchors,
        outlines: layout.outlines,
        metadata,
    })
}
/// Synchronous facade over the same cooperative layout implementation.
pub fn layout_document(document: &Document, options: &PdfOptions) -> Result<PdfDocument, String> {
    block_on(layout_document_async(document, options))
}
/// The editor's portable default uses A4 pages and bundled sans/mono fonts.
pub fn write_pdf(document: &Document) -> Result<Vec<u8>, String> {
    write_pdf_with_options(document, &PdfOptions::default())
}
pub fn write_pdf_with_options(
    document: &Document,
    options: &PdfOptions,
) -> Result<Vec<u8>, String> {
    block_on(write_pdf_with_options_async(document, options))
}
pub async fn write_pdf_with_options_async(
    document: &Document,
    options: &PdfOptions,
) -> Result<Vec<u8>, String> {
    Ok(write_pdf_with_usage_async(document, options).await?.bytes)
}
pub async fn write_pdf_with_usage_async(
    document: &Document,
    options: &PdfOptions,
) -> Result<PdfOutput, String> {
    let layout = layout_document_async(document, options).await?;
    serialize_pdf_with_usage_async(&layout, &options.limits).await
}
/// Serialize an independently constructed or edited PDF display tree.
pub fn serialize_pdf(layout: &PdfDocument, limits: &PdfLimits) -> Result<Vec<u8>, String> {
    block_on(serialize_pdf_async(layout, limits))
}
pub async fn serialize_pdf_async(
    layout: &PdfDocument,
    limits: &PdfLimits,
) -> Result<Vec<u8>, String> {
    Ok(serialize_pdf_with_usage_async(layout, limits).await?.bytes)
}
pub async fn serialize_pdf_with_usage_async(
    layout: &PdfDocument,
    limits: &PdfLimits,
) -> Result<PdfOutput, String> {
    yield_now().await;
    validate_display(layout, limits).await?;
    let parsed_fonts = layout
        .fonts
        .iter()
        .map(|resource| Font::new(&resource.bytes).map_err(str::to_owned))
        .collect::<Result<Vec<_>, _>>()?;
    let mut usages: Vec<_> = (0..layout.fonts.len())
        .map(|_| FontUse {
            glyphs: BTreeMap::new(),
        })
        .collect();
    // CIDs represent Unicode characters across the entire document, not a
    // face-local insertion order. Each face still owns its glyph widths.
    let mut characters = BTreeMap::new();
    for page in &layout.pages {
        yield_now().await;
        for paint in vector::paints(&page.paints) {
            if let Paint::Text { font, text, .. } = paint {
                for (i, c) in text.chars().enumerate() {
                    if i % 512 == 0 {
                        yield_now().await;
                    }
                    if parsed_fonts[*font].glyph_index(c as u32) == 0 {
                        return Err(format!(
                            "PDF font {} does not cover U+{:04X}",
                            layout.fonts[*font].id, c as u32
                        ));
                    }
                    if parsed_fonts[*font]
                        .advance(parsed_fonts[*font].glyph_index(c as u32))
                        .map_err(str::to_owned)?
                        == 0
                    {
                        return Err(format!("Nonadvancing PDF glyph U+{:04X}", c as u32));
                    }
                    let next = characters.len() + 1;
                    if next > u16::MAX as usize {
                        return Err("PDF contains too many distinct glyphs".into());
                    }
                    let cid = *characters.entry(c).or_insert(next as u16);
                    usages[*font].glyphs.entry(c).or_insert(cid);
                }
            }
        }
    }
    for usage in &mut usages {
        if !usage.glyphs.is_empty() {
            usage.glyphs = characters.clone();
        }
    }
    let mut font_count = 0;
    let mut font_bytes = 0;
    for (i, usage) in usages.iter().enumerate() {
        if !usage.glyphs.is_empty() {
            charge(&mut font_count, 1, limits.fonts, "fonts")?;
            charge(
                &mut font_bytes,
                layout.fonts[i].bytes.len(),
                limits.font_bytes,
                "fontBytes",
            )?;
        }
    }
    if limits.objects < 3 {
        return Err("E_LIMIT: PDF objects limit exceeded".into());
    }
    let mut objects = Objects { bodies: Vec::new() };
    let catalog = objects.reserve();
    let pages_root = objects.reserve();
    let page_ids: Vec<_> = layout.pages.iter().map(|_| objects.reserve()).collect();
    let mut fonts = Vec::new();
    for (index, usage) in usages.iter().enumerate() {
        yield_now().await;
        fonts.push(if usage.glyphs.is_empty() {
            0
        } else {
            font_object(
                &mut objects,
                &parsed_fonts[index],
                &layout.fonts[index],
                usage,
            )
            .await?
        });
    }
    let mut images = Vec::new();
    let mut image_pixels_total = 0usize;
    let mut decoded_image_bytes = 0usize;
    for image in &layout.images {
        yield_now().await;
        let (width, height) = images::dimensions(&image.bytes)
            .await
            .map_err(str::to_owned)?;
        let pixels_count = width
            .checked_mul(height)
            .ok_or("E_LIMIT: PDF imagePixels limit exceeded")?;
        charge(
            &mut image_pixels_total,
            pixels_count,
            limits.image_pixels,
            "imagePixels",
        )?;
        let decoded_cost = pixels_count
            .checked_mul(16)
            .and_then(|n| n.checked_add(65536))
            .ok_or("E_LIMIT: PDF decodedImageBytes limit exceeded")?;
        let remaining_decoded_bytes = limits
            .decoded_image_bytes
            .saturating_sub(decoded_image_bytes);
        charge(
            &mut decoded_image_bytes,
            decoded_cost,
            limits.decoded_image_bytes,
            "decodedImageBytes",
        )?;
        yield_now().await;
        let (image_width, image_height, pixels) =
            image_pixels(&image.bytes, remaining_decoded_bytes)
                .await
                .map_err(|error| {
                    if error == "image exceeds memory budget" {
                        "E_LIMIT: PDF decodedImageBytes limit exceeded".to_owned()
                    } else {
                        error.to_owned()
                    }
                })?;
        let mut rgb = Vec::with_capacity(pixels.len() * 3);
        let mut alpha = Vec::with_capacity(pixels.len());
        let mut transparent = false;
        for chunk in pixels.chunks(4096) {
            yield_now().await;
            for pixel in chunk {
                rgb.extend_from_slice(&pixel[..3]);
                alpha.push(pixel[3]);
                transparent |= pixel[3] != 255;
            }
        }
        let mask = if transparent {
            Some(objects.stream(&format!("/Type /XObject /Subtype /Image /Interpolate true /Width {} /Height {} /ColorSpace /DeviceGray /BitsPerComponent 8",image_width,image_height),&alpha,true).await)
        } else {
            None
        };
        images.push(objects.stream(&format!("/Type /XObject /Subtype /Image /Interpolate true /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 {}",image_width,image_height,mask.map(|id|format!("/SMask {id} 0 R")).unwrap_or_default()),&rgb,true).await);
    }
    let font_resources = fonts
        .iter()
        .enumerate()
        .filter(|(_, id)| **id != 0)
        .map(|(i, id)| format!("/F{i} {id} 0 R "))
        .collect::<String>();
    let image_resources = images
        .iter()
        .enumerate()
        .map(|(i, id)| format!("/Im{i} {id} 0 R "))
        .collect::<String>();
    let mut vector_resources = vector::Resources::default();
    for (page_index, page) in layout.pages.iter().enumerate() {
        yield_now().await;
        let width = page.width;
        let height = page.height;
        let mut content = String::new();
        write_paints(
            &page.paints,
            page.height,
            &mut content,
            &mut objects,
            &mut vector_resources,
            layout,
            &usages,
            &font_resources,
            &image_resources,
        )
        .await;
        let stream = objects.stream("", content.as_bytes(), true).await;
        let mut annotations = Vec::new();
        for (target, [x, y, width, height]) in &page.links {
            // PDF 1.7, Table 8.57: without a catalog /Base, relative URI
            // references resolve against the PDF's own location. A colon only
            // selects a scheme in the first path component (RFC 3986 §4.2).
            let first = target.split(['/', '?', '#']).next().unwrap_or_default();
            if target.bytes().any(|byte| byte.is_ascii_control())
                || first.split_once(':').is_some_and(|(scheme, _)| {
                    !["http", "https", "mailto"]
                        .iter()
                        .any(|allowed| scheme.eq_ignore_ascii_case(allowed))
                })
            {
                return Err(format!("Invalid or unsupported PDF link: {target}"));
            }
            let action = if let Some(anchor) = target.strip_prefix('#') {
                let Some((page, y)) = document_ast_rust::resolve_fragment(anchor, |id| {
                    layout.anchors.contains_key(id)
                })
                .and_then(|id| layout.anchors.get(id.as_ref())) else {
                    continue;
                };
                format!(
                    "/Dest [{} 0 R /XYZ null {:.3} null]",
                    page_ids[*page],
                    layout.pages[*page].height - y
                )
            } else {
                format!("/A << /S /URI /URI {} >>", literal(target))
            };
            annotations.push(objects.add(format!("<< /Type /Annot /Subtype /Link /Rect [{x:.3} {:.3} {:.3} {:.3}] /Border [0 0 0] {action} >>",page.height-y-height,x+width,page.height-y).into_bytes()));
        }
        objects.set(page_ids[page_index],format!("<< /Type /Page /Parent {pages_root} 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << {font_resources} >> /XObject << {image_resources} {} >> {} >> /Contents [{stream} 0 R] /Annots [{}] >>",vector::Resources::forms(&content),vector::Resources::entries(&content),annotations.iter().map(|id|format!("{id} 0 R ")).collect::<String>()).into_bytes());
    }
    objects.set(
        pages_root,
        format!(
            "<< /Type /Pages /Count {} /Kids [{}] >>",
            page_ids.len(),
            page_ids
                .iter()
                .map(|id| format!("{id} 0 R "))
                .collect::<String>()
        )
        .into_bytes(),
    );
    let outline_root = if layout.outlines.is_empty() {
        None
    } else {
        let root = objects.reserve();
        let entries: Vec<_> = layout.outlines.iter().map(|_| objects.reserve()).collect();
        for (i, entry) in layout.outlines.iter().enumerate() {
            objects.set(
                entries[i],
                format!(
                    "<< /Title {} /Parent {root} 0 R /Dest [{} 0 R /XYZ null {} null] {} {} >>",
                    unicode(&entry.title),
                    page_ids[entry.page],
                    layout.pages[entry.page].height - entry.y,
                    if i > 0 {
                        format!("/Prev {} 0 R", entries[i - 1])
                    } else {
                        String::new()
                    },
                    if i + 1 < entries.len() {
                        format!("/Next {} 0 R", entries[i + 1])
                    } else {
                        String::new()
                    }
                )
                .into_bytes(),
            );
        }
        objects.set(
            root,
            format!(
                "<< /Type /Outlines /Count {} /First {} 0 R /Last {} 0 R >>",
                entries.len(),
                entries[0],
                entries[entries.len() - 1]
            )
            .into_bytes(),
        );
        Some(root)
    };
    objects.set(
        catalog,
        format!(
            "<< /Type /Catalog /Pages {pages_root} 0 R {} >>",
            outline_root
                .map(|id| format!("/Outlines {id} 0 R"))
                .unwrap_or_default()
        )
        .into_bytes(),
    );
    let mut metadata =
        String::from("<< /Producer (poe-code Rust PDF) /Creator (poe-code Rust PDF)");
    for (key, value) in [
        ("Title", &layout.metadata.title),
        ("Author", &layout.metadata.author),
        ("Subject", &layout.metadata.subject),
    ] {
        if let Some(value) = value {
            write!(metadata, " /{key} {}", unicode(value)).unwrap();
        }
    }
    if !layout.metadata.keywords.is_empty() {
        write!(
            metadata,
            " /Keywords {}",
            unicode(&layout.metadata.keywords.join(" "))
        )
        .unwrap();
    }
    metadata.push_str(" >>");
    let info = objects.add(metadata.into_bytes());
    if objects.bodies.len() > limits.objects {
        return Err("E_LIMIT: PDF objects limit exceeded".into());
    }
    let minimum = objects
        .bodies
        .iter()
        .try_fold(0usize, |sum, b| sum.checked_add(b.len()))
        .ok_or("E_LIMIT: PDF outputBytes limit exceeded")?;
    if minimum > limits.output_bytes {
        return Err("E_LIMIT: PDF outputBytes limit exceeded".into());
    }
    let object_count = objects.bodies.len();
    let output = objects.finish(catalog, info).await;
    if output.len() > limits.output_bytes {
        return Err("E_LIMIT: PDF outputBytes limit exceeded".into());
    }
    let glyphs = layout
        .pages
        .iter()
        .flat_map(|p| vector::paints(&p.paints))
        .filter_map(|p| {
            if let Paint::Text { text, .. } = p {
                Some(text.chars().count())
            } else {
                None
            }
        })
        .sum();
    let usage = PdfUsage {
        fonts: font_count,
        font_bytes,
        glyphs,
        pages: layout.pages.len(),
        objects: object_count,
        images: layout.images.len(),
        image_bytes: layout.images.iter().map(|i| i.bytes.len()).sum(),
        image_pixels: image_pixels_total,
        decoded_image_bytes,
        layout_work: glyphs
            + object_count
            + layout
                .pages
                .iter()
                .flat_map(|p| vector::paints(&p.paints))
                .map(|paint| {
                    1 + match paint {
                        Paint::Path { path, stroke, .. } => {
                            path.segments.len() + stroke.as_ref().map_or(0, |s| s.dash.len())
                        }
                        Paint::Group { clip, .. } => clip.as_ref().map_or(0, |p| p.segments.len()),
                        _ => 0,
                    }
                })
                .sum::<usize>(),
        output_bytes: output.len(),
    };
    Ok(PdfOutput {
        bytes: output,
        usage,
    })
}
async fn validate_display(document: &PdfDocument, limits: &PdfLimits) -> Result<(), String> {
    if document.pages.is_empty() {
        return Err("A PDF requires at least one page".into());
    }
    let mut pages = 0;
    charge(&mut pages, document.pages.len(), limits.pages, "pages")?;
    let mut images = 0;
    charge(&mut images, document.images.len(), limits.images, "images")?;
    let mut bytes = 0;
    for image in &document.images {
        charge(
            &mut bytes,
            image.bytes.len(),
            limits.image_bytes,
            "imageBytes",
        )?;
    }
    let mut glyphs = 0;
    let mut work = 0;
    for page in &document.pages {
        yield_now().await;
        if !page.width.is_finite()
            || !page.height.is_finite()
            || page.width <= 0.
            || page.height <= 0.
        {
            return Err("Invalid PDF page dimensions".into());
        }
        vector::validate_depth(&page.paints)?;
        for (index, paint) in vector::paints(&page.paints).enumerate() {
            if index % 128 == 0 {
                yield_now().await;
            }
            charge(&mut work, 1, limits.layout_work, "layoutWork")?;
            let (x, y, w, h) = match paint {
                Paint::Path {
                    x, y, path, stroke, ..
                } => {
                    scene::validate_path(path).await?;
                    charge(
                        &mut work,
                        path.segments.len(),
                        limits.layout_work,
                        "layoutWork",
                    )?;
                    if let Some(stroke) = stroke {
                        scene::validate_stroke(stroke)?;
                        charge(
                            &mut work,
                            stroke.dash.len(),
                            limits.layout_work,
                            "layoutWork",
                        )?;
                    }
                    (*x, *y, 0., 0.)
                }
                Paint::Group {
                    x,
                    y,
                    bounds,
                    transform,
                    clip,
                    opacity,
                    ..
                } => {
                    if bounds
                        .iter()
                        .chain(transform)
                        .any(|v| !v.is_finite() || v.abs() > 1e9)
                        || bounds[2] < 0.
                        || bounds[3] < 0.
                        || !opacity.is_finite()
                        || !(0.0..=1.0).contains(opacity)
                    {
                        return Err("Invalid PDF vector group".into());
                    }
                    if let Some(clip) = clip {
                        scene::validate_path(clip).await?;
                        charge(
                            &mut work,
                            clip.segments.len(),
                            limits.layout_work,
                            "layoutWork",
                        )?;
                    }
                    (*x, *y, bounds[2], bounds[3])
                }
                Paint::Text {
                    x,
                    y,
                    size,
                    font,
                    text,
                    style,
                } => {
                    if *font >= document.fonts.len() {
                        return Err("Unknown PDF font resource".into());
                    }
                    if *size <= 0. {
                        return Err("Invalid PDF text size".into());
                    }
                    for color in [&style.color, &style.highlight].into_iter().flatten() {
                        if color.len() != 6 || !color.bytes().all(|b| b.is_ascii_hexdigit()) {
                            return Err("PDF text colors must be six hexadecimal digits".into());
                        }
                    }
                    for (i, c) in text.chars().enumerate() {
                        if i % 512 == 0 {
                            yield_now().await;
                        }
                        admit_text_scalar(c)?;
                        charge(&mut glyphs, 1, limits.glyphs, "glyphs")?;
                    }
                    (*x, *y, *size, *size)
                }
                Paint::Rect {
                    x,
                    y,
                    width,
                    height,
                    color,
                } => {
                    if color
                        .iter()
                        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
                    {
                        return Err("Invalid PDF paint color".into());
                    }
                    (*x, *y, *width, *height)
                }
                Paint::Stroke {
                    x,
                    y,
                    width,
                    weight,
                    color,
                } => {
                    if color
                        .iter()
                        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
                    {
                        return Err("Invalid PDF paint color".into());
                    }
                    (*x, *y, *width, *weight)
                }
                Paint::Checkbox { x, y, size, .. } => {
                    if *size <= 0. {
                        return Err("Invalid PDF checkbox size".into());
                    }
                    (*x, *y, *size, *size)
                }
                Paint::Image {
                    x,
                    y,
                    width,
                    height,
                    id,
                } => {
                    if *id >= document.images.len() {
                        return Err("Unknown PDF image resource".into());
                    }
                    (*x, *y, *width, *height)
                }
            };
            if !x.is_finite()
                || !y.is_finite()
                || !w.is_finite()
                || !h.is_finite()
                || w < 0.
                || h < 0.
            {
                return Err("Invalid PDF paint geometry".into());
            }
        }
    }
    for page in &document.pages {
        for (_, rect) in &page.links {
            if rect.iter().any(|v| !v.is_finite()) || rect[2] < 0. || rect[3] < 0. {
                return Err("Invalid PDF link rectangle".into());
            }
        }
    }
    if document
        .outlines
        .iter()
        .any(|o| o.page >= document.pages.len() || !o.y.is_finite())
        || document
            .anchors
            .values()
            .any(|(p, y)| *p >= document.pages.len() || !y.is_finite())
    {
        return Err("Invalid PDF destination".into());
    }
    Ok(())
}

async fn write_paints(
    paints: &[Paint],
    page_height: f64,
    content: &mut String,
    objects: &mut Objects,
    resources: &mut vector::Resources,
    layout: &PdfDocument,
    usages: &[FontUse],
    font_resources: &str,
    image_resources: &str,
) {
    for (paint_index, paint) in paints.iter().enumerate() {
        if paint_index % 64 == 0 {
            yield_now().await;
        }
        match paint {
            Paint::Path { .. } | Paint::Group { .. } => {
                vector::write_vector(
                    paint,
                    page_height,
                    content,
                    objects,
                    resources,
                    layout,
                    usages,
                    font_resources,
                    image_resources,
                )
                .await;
            }
            Paint::Text {
                x,
                y,
                size,
                font,
                text,
                style,
            } => {
                let color = style
                    .color
                    .as_deref()
                    .map(|s| rgb(s, [13. / 255.; 3]))
                    .unwrap_or(if style.link.is_some() {
                        [0.12, 0.29, 0.57]
                    } else {
                        [13. / 255.; 3]
                    });
                let mut encoded = String::new();
                for (character_index, c) in text.chars().enumerate() {
                    if character_index % 512 == 0 {
                        yield_now().await;
                    }
                    write!(encoded, "{:04X}", usages[*font].glyphs[&c]).unwrap();
                }
                writeln!(content,"q {} {} {} rg {} {} {} RG BT /F{font} {size} Tf {} Tr {:.3} w 1 0 {:.3} 1 {x:.3} {:.3} Tm\n<{encoded}> Tj\nET Q",color[0],color[1],color[2],color[0],color[1],color[2],if layout.fonts[*font].synthetic && style.bold {2}else{0},if layout.fonts[*font].synthetic && style.bold{size*0.025}else{0.},if layout.fonts[*font].synthetic && style.italic{0.21}else{0.},page_height-y).unwrap();
            }
            Paint::Rect {
                x,
                y,
                width,
                height,
                color,
            } => {
                writeln!(
                        content,
                        "q {} {} {} rg\n{x:.3} {:.3} m\n{:.3} {:.3} l\n{:.3} {:.3} l\n{x:.3} {:.3} l\nh\nf\nQ",
                        color[0], color[1], color[2],
                        page_height-y-height,x+width,page_height-y-height,
                        x+width,page_height-y,page_height-y
                    )
                    .unwrap();
            }
            Paint::Stroke {
                x,
                y,
                width,
                color,
                weight,
            } => {
                writeln!(
                    content,
                    "q {} {} {} RG {weight:.3} w {x:.3} {:.3} m {:.3} {:.3} l S Q",
                    color[0],
                    color[1],
                    color[2],
                    page_height - y,
                    x + width,
                    page_height - y
                )
                .unwrap();
            }
            Paint::Checkbox {
                x,
                y,
                size,
                checked,
            } => {
                let weight = size * 0.07;
                let inset = weight / 2.;
                let bottom = page_height - y - size;
                let color = if *checked {
                    "0.05098 0.05098 0.05098"
                } else {
                    "0.45 0.47 0.50"
                };
                writeln!(
                    content,
                    "q {color} RG {} rg {weight:.3} w {:.3} {:.3} {:.3} {:.3} re B",
                    if *checked { color } else { "1 1 1" },
                    x + inset,
                    bottom + inset,
                    size - weight,
                    size - weight
                )
                .unwrap();
                if *checked {
                    writeln!(
                        content,
                        "1 1 1 RG {:.3} w 1 J 1 j {:.3} {:.3} m {:.3} {:.3} l {:.3} {:.3} l S",
                        size * 0.14,
                        x + size * 0.22,
                        bottom + size * 0.48,
                        x + size * 0.43,
                        bottom + size * 0.27,
                        x + size * 0.80,
                        bottom + size * 0.73
                    )
                    .unwrap();
                }
                content.push_str("Q\n");
            }
            Paint::Image {
                id,
                x,
                y,
                width,
                height,
            } => {
                writeln!(
                    content,
                    "q {width:.3} 0 0 {height:.3} {x:.3} {:.3} cm /Im{id} Do Q",
                    page_height - y - height
                )
                .unwrap();
            }
        }
    }
}
