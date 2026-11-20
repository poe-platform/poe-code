//! Portable document authoring nodes shared by Word and PDF.
pub use mcp_protocol_rust::cooperate;
pub mod vector;
#[derive(Clone, Debug, Default)]
pub struct Document {
    pub title: String,
    pub blocks: Vec<Block>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Ltr,
    Rtl,
}
#[derive(Clone, Debug)]
pub enum Block {
    /// Inherited paragraph and table direction, including explicit LTR resets.
    Direction {
        direction: Direction,
        blocks: Vec<Block>,
    },
    Paragraph(Paragraph),
    Heading {
        level: u8,
        id: String,
        inlines: Vec<Inline>,
    },
    List {
        start: Option<i64>,
        style: ListStyle,
        delimiter: ListDelimiter,
        items: Vec<Vec<Block>>,
    },
    Quote {
        kind: Option<String>,
        blocks: Vec<Block>,
    },
    Code {
        language: String,
        text: String,
    },
    Table {
        rows: Vec<TableRow>,
        /// Fraction of available width, from 0 (exclusive) to 1.
        width: Option<f64>,
        /// Column width fractions; zero leaves a column automatic.
        column_widths: Vec<f64>,
    },
    Image(Image),
    Vector(vector::Scene),
    Rule,
    /// Validated by the Word writer; other formats choose their own fallback.
    RawOpenXml(String),
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ListStyle {
    #[default]
    Decimal,
    LowerAlpha,
    UpperAlpha,
    LowerRoman,
    UpperRoman,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ListDelimiter {
    #[default]
    Period,
    OneParen,
    TwoParens,
}
impl ListDelimiter {
    pub fn wrap(self, number: &str) -> String {
        match self {
            Self::Period => format!("{number}."),
            Self::OneParen => format!("{number})"),
            Self::TwoParens => format!("({number})"),
        }
    }
}
impl ListStyle {
    pub fn marker(self, number: i64, delimiter: ListDelimiter) -> String {
        let mut text = number.to_string();
        match self {
            Self::LowerAlpha | Self::UpperAlpha if number > 0 => {
                let mut digits = Vec::new();
                let mut n = number as u64;
                let base = if self == Self::LowerAlpha { b'a' } else { b'A' };
                while n > 0 {
                    n -= 1;
                    digits.push(char::from(base + (n % 26) as u8));
                    n /= 26;
                }
                text = digits.into_iter().rev().collect();
            }
            Self::LowerRoman | Self::UpperRoman if (1..4000).contains(&number) => {
                text.clear();
                let mut n = number;
                for (value, digits) in [
                    (1000, "M"),
                    (900, "CM"),
                    (500, "D"),
                    (400, "CD"),
                    (100, "C"),
                    (90, "XC"),
                    (50, "L"),
                    (40, "XL"),
                    (10, "X"),
                    (9, "IX"),
                    (5, "V"),
                    (4, "IV"),
                    (1, "I"),
                ] {
                    while n >= value {
                        text.push_str(digits);
                        n -= value;
                    }
                }
                if self == Self::LowerRoman {
                    text.make_ascii_lowercase();
                }
            }
            _ => {}
        }
        delimiter.wrap(&text)
    }
}
#[derive(Clone, Debug, Default)]
pub struct Paragraph {
    pub id: String,
    pub inlines: Vec<Inline>,
    pub align: Align,
    pub compact: bool,
    /// Keep this paragraph with the following block when they fit on a page.
    pub keep_with_next: bool,
    /// Checkbox state when this paragraph starts a task-list item. Replaces its list marker.
    pub list_checked: Option<bool>,
}

pub fn list_item_checked(mut blocks: &[Block]) -> Option<bool> {
    loop {
        match blocks.first()? {
            Block::Direction { blocks: nested, .. } => blocks = nested,
            Block::Paragraph(paragraph) => return paragraph.list_checked,
            _ => return None,
        }
    }
}
#[derive(Clone, Debug)]
pub enum Inline {
    /// An HTML bidi isolate; override_order additionally overrides character order.
    Direction {
        direction: Direction,
        override_order: bool,
        inlines: Vec<Inline>,
    },
    Text {
        text: String,
        style: TextStyle,
    },
    Break,
    Image(Image),
    Anchor(String),
    Note(Vec<Block>),
    RawOpenXml(String),
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub code: bool,
    pub sub: bool,
    pub sup: bool,
    pub highlight: Option<String>,
    pub color: Option<String>,
    /// URI reference; fragment links resolve against literal IDs via `resolve_fragment`.
    pub link: Option<String>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Align {
    #[default]
    Default,
    Left,
    Center,
    Right,
}
#[derive(Clone, Debug)]
pub struct Image {
    pub bytes: Vec<u8>,
    pub mime: String,
    /// Display dimensions in CSS pixels (96 dpi).
    pub width: f64,
    pub height: f64,
    pub alt: String,
    pub title: String,
    /// URI reference; fragment links resolve against literal IDs via `resolve_fragment`.
    pub link: Option<String>,
}
#[derive(Clone, Debug)]
pub struct TableRow {
    /// A leading column-header row repeated on subsequent pages; also styles its cells.
    pub header: bool,
    pub cells: Vec<TableCell>,
}
#[derive(Clone, Debug)]
pub struct TableCell {
    /// A heading cell (including row and body-section headings), without row repetition.
    pub header: bool,
    pub blocks: Vec<Block>,
    pub align: Align,
    pub colspan: usize,
    pub rowspan: usize,
}

// Public AST callers receive the same bounded behavior as HTML callers.
pub fn validate(document: &Document) -> Result<(), String> {
    cooperate::block_on(validate_async(document))
}

pub async fn validate_async(document: &Document) -> Result<(), String> {
    let mut stack = vec![(document.blocks.as_slice(), 0usize)];
    let mut count = 0usize;
    let mut bytes = document.title.len();
    if bytes > 64 * 1024 * 1024 {
        return Err("Document content limit exceeded".into());
    }
    let image = |image: &Image| -> Result<usize, String> {
        if !image.width.is_finite()
            || !image.height.is_finite()
            || image.width <= 0.
            || image.height <= 0.
            || image.width > 100000.
            || image.height > 100000.
        {
            return Err("Invalid image dimensions".into());
        }
        if !matches!(
            image.mime.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/tiff"
        ) {
            return Err("Unsupported document image MIME type".into());
        }
        Ok(image
            .bytes
            .len()
            .saturating_add(image.alt.len())
            .saturating_add(image.title.len())
            .saturating_add(image.link.as_ref().map_or(0, String::len)))
    };
    while let Some((blocks, depth)) = stack.pop() {
        if depth > 64 {
            return Err("Document nesting limit exceeded".into());
        }
        for block in blocks {
            cooperate::yield_now().await;
            count = count.saturating_add(1);
            let runs = match block {
                Block::Paragraph(p) => {
                    bytes = bytes.saturating_add(p.id.len());
                    Some(&p.inlines)
                }
                Block::Heading { id, inlines, .. } => {
                    bytes = bytes.saturating_add(id.len());
                    Some(inlines)
                }
                Block::List { items, .. } => {
                    for item in items {
                        stack.push((item, depth + 1));
                    }
                    None
                }
                Block::Quote { kind, blocks } => {
                    bytes = bytes.saturating_add(kind.as_ref().map_or(0, String::len));
                    stack.push((blocks, depth + 1));
                    None
                }
                Block::Direction { blocks, .. } => {
                    stack.push((blocks, depth + 1));
                    None
                }
                Block::Code { text, language } => {
                    bytes = bytes
                        .saturating_add(text.len())
                        .saturating_add(language.len());
                    None
                }
                Block::Table {
                    rows,
                    width,
                    column_widths,
                } => {
                    if width.is_some_and(|w| !w.is_finite() || w <= 0. || w > 1.)
                        || column_widths.len() > 1000
                        || column_widths
                            .iter()
                            .any(|w| !w.is_finite() || *w < 0. || *w > 1.)
                    {
                        return Err("Invalid document table widths".into());
                    }
                    let mut body_started = false;
                    for row in rows {
                        cooperate::yield_now().await;
                        if row.header && body_started {
                            return Err("Repeating table header rows must precede body rows; use TableCell.header for body headings".into());
                        }
                        body_started |= !row.header;
                        for cell in &row.cells {
                            if cell.colspan == 0
                                || cell.rowspan == 0
                                || cell.colspan > 1000
                                || cell.rowspan > 10000
                            {
                                return Err("Invalid document table span".into());
                            }
                            count = count.saturating_add(1);
                            stack.push((&cell.blocks, depth + 1));
                        }
                    }
                    None
                }
                Block::Image(i) => {
                    bytes = bytes.saturating_add(image(i)?);
                    None
                }
                Block::Vector(scene) => {
                    vector::validate_content(scene, depth + 1, &mut count, &mut bytes).await?;
                    None
                }
                Block::Rule => None,
                Block::RawOpenXml(xml) => {
                    bytes = bytes.saturating_add(xml.len());
                    None
                }
            };
            if let Some(runs) = runs {
                let mut inline_stack = vec![(runs.as_slice(), depth)];
                while let Some((runs, inline_depth)) = inline_stack.pop() {
                    if inline_depth > 64 {
                        return Err("Document nesting limit exceeded".into());
                    }
                    for run in runs {
                        cooperate::yield_now().await;
                        count = count.saturating_add(1);
                        bytes = bytes.saturating_add(match run {
                            Inline::Direction { inlines, .. } => {
                                inline_stack.push((inlines, inline_depth + 1));
                                0
                            }
                            Inline::Text { text, style } => {
                                if style.sub && style.sup {
                                    return Err(
                                        "Text cannot be both subscript and superscript".into()
                                    );
                                }
                                for color in [&style.color, &style.highlight].into_iter().flatten()
                                {
                                    if color.len() != 6
                                        || !color.bytes().all(|b| b.is_ascii_hexdigit())
                                    {
                                        return Err(
                                            "Document colors must be six hexadecimal digits".into(),
                                        );
                                    }
                                }
                                text.len()
                                    .saturating_add(style.link.as_ref().map_or(0, String::len))
                            }
                            Inline::Image(i) => image(i)?,
                            Inline::Anchor(id) => id.len(),
                            Inline::Break => 0,
                            Inline::Note(blocks) => {
                                stack.push((blocks, inline_depth + 1));
                                0
                            }
                            Inline::RawOpenXml(xml) => xml.len(),
                        });
                        if count > 200000 || bytes > 64 * 1024 * 1024 {
                            return Err("Document content limit exceeded".into());
                        }
                    }
                }
            }
            if count > 200000 || bytes > 64 * 1024 * 1024 {
                return Err("Document content limit exceeded".into());
            }
        }
    }
    Ok(())
}

/// Resolve partial column percentages to a complete grid without changing their
/// ratios. Both formats use this layout rule.
pub fn table_columns(columns: usize, widths: &[f64]) -> Vec<f64> {
    let columns = columns.max(1);
    let mut out = (0..columns)
        .map(|i| widths.get(i).copied().unwrap_or(0.))
        .collect::<Vec<_>>();
    let total = out.iter().sum::<f64>();
    let automatic = out.iter().filter(|w| **w == 0.).count();
    if automatic > 0 {
        let rest = if total < 1. {
            (1. - total) / automatic as f64
        } else {
            1. / columns as f64
        };
        for width in &mut out {
            if *width == 0. {
                *width = rest;
            }
        }
    }
    let total = out.iter().sum::<f64>();
    for width in &mut out {
        *width /= total;
    }
    out
}

/// Attach a source identifier to the first rendered block, without adding visible text.
pub fn anchor_blocks(out: &mut Vec<Block>, start: usize, anchor: String) {
    if anchor.is_empty() {
        return;
    }
    if let Some(first) = out.get_mut(start) {
        match first {
            Block::Paragraph(p) => {
                if p.id.is_empty() {
                    p.id = anchor;
                } else {
                    p.inlines.insert(0, Inline::Anchor(anchor));
                }
                return;
            }
            Block::Heading { inlines, .. } => {
                inlines.insert(0, Inline::Anchor(anchor));
                return;
            }
            Block::List { items, .. } => {
                if let Some(item) = items.first_mut() {
                    anchor_blocks(item, 0, anchor);
                    return;
                }
            }
            Block::Quote { blocks, .. } | Block::Direction { blocks, .. } => {
                anchor_blocks(blocks, 0, anchor);
                return;
            }
            Block::Table { rows, .. } => {
                if let Some(cell) = rows.first_mut().and_then(|row| row.cells.first_mut()) {
                    anchor_blocks(&mut cell.blocks, 0, anchor);
                    return;
                }
            }
            _ => {}
        }
    }
    out.insert(
        start,
        Block::Paragraph(Paragraph {
            inlines: vec![Inline::Anchor(anchor)],
            ..Default::default()
        }),
    );
}

/// Resolve a fragment (without `#`) against literal document IDs. Exact IDs win;
/// otherwise apply URL percent-decoding once and UTF-8 decoding with replacement.
/// Keep malformed percent escapes and `+` literal. Never normalize the source ID.
pub fn resolve_fragment<'a>(
    fragment: &'a str,
    exists: impl Fn(&str) -> bool,
) -> Option<std::borrow::Cow<'a, str>> {
    use std::borrow::Cow;
    if exists(fragment) {
        return Some(Cow::Borrowed(fragment));
    }
    if !fragment.contains('%') {
        return None;
    }
    let hex = |byte: u8| match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    };
    let bytes = fragment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && let Some(pair) = bytes.get(index + 1..index + 3)
            && let (Some(high), Some(low)) = (hex(pair[0]), hex(pair[1]))
        {
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let decoded = String::from_utf8_lossy(&decoded);
    exists(&decoded).then(|| Cow::Owned(decoded.into_owned()))
}
