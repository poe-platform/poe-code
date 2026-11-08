//! Line-level Markdown grammar shared by native block construction and lookahead.
use crate::markdown_scan::{self as inline, ascii_whitespace as space, digit};

#[derive(Clone, Copy, Debug)]
pub struct Line {
    pub start: usize,
    pub end: usize,
    pub next: usize,
}
pub fn read_line(input: &[u16], start: usize) -> Line {
    let mut end = start;
    while end < input.len() && !matches!(input[end], 10 | 13) {
        end += 1;
    }
    let next = if end >= input.len() {
        input.len()
    } else if input[end] == 13 && input.get(end + 1) == Some(&10) {
        end + 2
    } else {
        end + 1
    };
    Line { start, end, next }
}

pub fn leading_whitespace(input: &[u16]) -> (usize, usize) {
    let mut columns = 0;
    let mut offset = 0;
    while offset < input.len() {
        columns += match input[offset] {
            32 => 1,
            9 => 4,
            _ => break,
        };
        offset += 1;
    }
    (columns, offset)
}
pub fn block_indent(input: &[u16]) -> Option<usize> {
    let bom = usize::from(input.first() == Some(&0xfeff));
    let (columns, offset) = leading_whitespace(&input[bom..]);
    (columns <= 3).then_some(bom + offset)
}
pub fn trim_range(input: &[u16]) -> (usize, usize) {
    let start = input
        .iter()
        .position(|unit| !space(*unit))
        .unwrap_or(input.len());
    let end = input
        .iter()
        .rposition(|unit| !space(*unit))
        .map_or(start, |index| index + 1);
    (start, end)
}

#[derive(Clone, Debug)]
pub struct Fence {
    pub marker: u16,
    pub length: usize,
    pub lang: Option<Vec<u16>>,
    pub meta: Option<Vec<u16>>,
}
pub fn opening_fence(input: &[u16]) -> Option<Fence> {
    let start = block_indent(input)?;
    let marker = *input.get(start)?;
    if !matches!(marker, 96 | 126) {
        return None;
    }
    let length = inline::run_length(input, start, marker);
    if length < 3 {
        return None;
    }
    let rest = &input[start + length..];
    let (begin, end) = trim_range(rest);
    let info = &rest[begin..end];
    let split = info
        .iter()
        .position(|unit| space(*unit))
        .unwrap_or(info.len());
    let meta = &info[split..];
    let meta_start = meta
        .iter()
        .position(|unit| !space(*unit))
        .unwrap_or(meta.len());
    Some(Fence {
        marker,
        length,
        lang: (!info.is_empty()).then(|| info[..split].to_vec()),
        meta: (meta_start < meta.len()).then(|| meta[meta_start..].to_vec()),
    })
}
pub fn closing_fence(input: &[u16], marker: u16, length: usize) -> bool {
    let Some(start) = block_indent(input) else {
        return false;
    };
    let count = inline::run_length(input, start, marker);
    count > 0 && count >= length && input[start + count..].iter().all(|unit| space(*unit))
}

#[derive(Clone, Copy, Debug)]
pub struct Heading {
    pub depth: usize,
    pub start: usize,
    pub end: usize,
}
pub fn heading(input: &[u16]) -> Option<Heading> {
    let start = block_indent(input)?;
    let depth = inline::run_length(input, start, 35);
    if !(1..=6).contains(&depth) {
        return None;
    }
    let mut content_start = start + depth;
    if input.get(content_start).is_some_and(|unit| !space(*unit)) {
        return None;
    }
    while input.get(content_start).copied().is_some_and(space) {
        content_start += 1;
    }
    let mut end = input.len();
    while end > content_start && space(input[end - 1]) {
        end -= 1;
    }
    let mut hash_start = end;
    while hash_start > content_start && input[hash_start - 1] == 35 {
        hash_start -= 1;
    }
    if hash_start == content_start {
        end = content_start;
    } else if hash_start < end && space(input[hash_start - 1]) {
        end = hash_start - 1;
        while end > content_start && space(input[end - 1]) {
            end -= 1;
        }
    }
    Some(Heading {
        depth,
        start: content_start,
        end,
    })
}
pub fn thematic_break(input: &[u16]) -> bool {
    let Some(start) = block_indent(input) else {
        return false;
    };
    let Some(marker @ (45 | 42 | 95)) = input.get(start).copied() else {
        return false;
    };
    let mut count = 0;
    for unit in &input[start..] {
        if *unit == marker {
            count += 1;
        } else if !space(*unit) {
            return false;
        }
    }
    count >= 3
}
pub fn setext(input: &[u16]) -> Option<usize> {
    let start = block_indent(input)?;
    let marker = *input.get(start)?;
    if !matches!(marker, 61 | 45) {
        return None;
    }
    let length = inline::run_length(input, start, marker);
    input[start + length..]
        .iter()
        .all(|unit| space(*unit))
        .then_some(if marker == 61 { 1 } else { 2 })
}

#[derive(Clone, Debug)]
pub struct Cell {
    pub value: Vec<u16>,
    pub start: usize,
    pub end: usize,
}
pub fn table_cells(input: &[u16]) -> Option<Vec<Cell>> {
    let start = block_indent(input)?;
    if start >= input.len() {
        return None;
    }
    let mut end = input.len();
    while end > start && space(input[end - 1]) {
        end -= 1;
    }
    let mut cells = Vec::new();
    let mut cell_start = start;
    let mut index = start;
    while index < end {
        if input[index] == 92 && input.get(index + 1) == Some(&124) {
            index += 2;
            continue;
        }
        if input[index] == 124 {
            cells.push((cell_start, index));
            cell_start = index + 1;
        }
        index += 1;
    }
    if cells.is_empty() {
        return None;
    }
    cells.push((cell_start, end));
    if input[start] == 124 {
        cells.remove(0);
    }
    if input[end - 1] == 124 {
        cells.pop();
    }
    if cells.is_empty() {
        return None;
    }
    Some(
        cells
            .into_iter()
            .map(|(start, end)| {
                let (left, right) = trim_range(&input[start..end]);
                let mut value = Vec::new();
                let mut index = start + left;
                while index < start + right {
                    if input[index] == 92 && input.get(index + 1) == Some(&124) {
                        index += 1;
                    }
                    value.push(input[index]);
                    index += 1;
                }
                Cell {
                    value,
                    start: start + left,
                    end: start + right,
                }
            })
            .collect(),
    )
}
pub fn table_separator(input: &[u16]) -> Option<Vec<Option<&'static str>>> {
    table_cells(input)?
        .into_iter()
        .map(|cell| {
            let leading = cell.value.first() == Some(&58);
            let trailing = cell.value.last() == Some(&58);
            let start = usize::from(leading);
            let end = cell.value.len().saturating_sub(usize::from(trailing));
            if end < start + 3 || !cell.value[start..end].iter().all(|unit| *unit == 45) {
                return None;
            }
            Some(match (leading, trailing) {
                (true, true) => Some("center"),
                (true, false) => Some("left"),
                (false, true) => Some("right"),
                _ => None,
            })
        })
        .collect()
}
pub fn table_header(
    header: &[u16],
    separator: &[u16],
) -> Option<(Vec<Cell>, Vec<Option<&'static str>>)> {
    let cells = table_cells(header)?;
    let align = table_separator(separator)?;
    (cells.len() == align.len()).then_some((cells, align))
}
pub fn blockquote(input: &[u16]) -> Option<usize> {
    let start = block_indent(input)?;
    if input.get(start) != Some(&62) {
        return None;
    }
    Some(start + 1 + usize::from(input.get(start + 1).copied().is_some_and(space)))
}
pub fn alert(input: &[u16]) -> Option<(&'static str, usize)> {
    if !input.starts_with(&[91, 33]) {
        return None;
    }
    let end = input.iter().position(|unit| *unit == 93)?;
    if end < 2 {
        return None;
    }
    let kind = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]
        .into_iter()
        .find(|name| input[2..end].iter().copied().eq(name.encode_utf16()))?;
    let mut start = end + 1;
    while input.get(start).copied().is_some_and(space) {
        start += 1;
    }
    Some((kind, start))
}
pub fn footnote(input: &[u16]) -> Option<(Vec<u16>, usize)> {
    let start = block_indent(input)?;
    if start + 3 >= input.len() || !input[start..].starts_with(&[91, 94]) {
        return None;
    }
    let mut end = start + 2;
    while end < input.len() && input[end] != 93 {
        if !inline::ascii_letter(input[end]) && !digit(input[end]) && !matches!(input[end], 45 | 95)
        {
            return None;
        }
        end += 1;
    }
    if end == start + 2 || input.get(end + 1) != Some(&58) {
        return None;
    }
    let mut content = end + 2;
    while input.get(content).copied().is_some_and(space) {
        content += 1;
    }
    Some((input[start + 2..end].to_vec(), content))
}

const HTML_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];
pub fn html_tag(input: &[u16]) -> Option<inline::HtmlTag> {
    inline::read_html_tag(input, block_indent(input)?, HTML_TAGS)
}
pub fn void_html_tag(name: &str) -> bool {
    matches!(
        name,
        "base" | "basefont" | "col" | "hr" | "link" | "param" | "track"
    )
}
pub fn contains_closing_html(input: &[u16], name: &[u16], from: usize) -> bool {
    let mut lower = Vec::new();
    for character in char::decode_utf16(input.iter().copied()) {
        match character {
            Ok(character) => {
                for lowered in character.to_lowercase() {
                    lower.extend_from_slice(lowered.encode_utf16(&mut [0; 2]));
                }
            }
            Err(error) => lower.push(error.unpaired_surrogate()),
        }
    }
    let needle: Vec<_> = [60, 47].into_iter().chain(name.iter().copied()).collect();
    for start in from..lower.len() {
        if !lower[start..].starts_with(&needle) {
            continue;
        }
        let mut end = start + needle.len();
        while lower.get(end).copied().is_some_and(space) {
            end += 1;
        }
        if lower.get(end) == Some(&62) {
            return true;
        }
    }
    false
}

#[derive(Clone, Copy, Debug)]
pub struct ListMarker {
    pub ordered: bool,
    pub start: Option<f64>,
    pub indent: usize,
    pub content_indent: usize,
    pub content_start: usize,
}
pub fn list_marker(input: &[u16]) -> Option<ListMarker> {
    let start = block_indent(input)?;
    let marker = *input.get(start)?;
    let ordered = digit(marker);
    let mut after = start + 1;
    let mut number = None;
    if ordered {
        while input.get(after).copied().is_some_and(digit) {
            after += 1;
        }
        if !input.get(after).is_some_and(|unit| matches!(unit, 46 | 41)) {
            return None;
        }
        number = Some(
            String::from_utf16_lossy(&input[start..after])
                .parse::<f64>()
                .unwrap_or(f64::NAN),
        );
        after += 1;
    } else if !matches!(marker, 45 | 43 | 42) {
        return None;
    }
    if input.get(after).is_some_and(|unit| !space(*unit)) {
        return None;
    }
    while input.get(after).copied().is_some_and(space) {
        after += 1;
    }
    let columns = |units: &[u16]| {
        units
            .iter()
            .map(|unit| if *unit == 9 { 4 } else { 1 })
            .sum()
    };
    Some(ListMarker {
        ordered,
        start: number,
        indent: columns(&input[..start]),
        content_indent: columns(&input[..after]),
        content_start: after,
    })
}
pub fn task(input: &[u16]) -> Option<(bool, usize)> {
    if input.len() < 3 || input[0] != 91 || input[2] != 93 || !matches!(input[1], 32 | 120 | 88) {
        return None;
    }
    if input.get(3).is_some_and(|unit| !space(*unit)) {
        return None;
    }
    let mut start = 3;
    while input.get(start).copied().is_some_and(space) {
        start += 1;
    }
    Some((input[1] != 32, start))
}
pub fn simple_block(input: &[u16]) -> bool {
    opening_fence(input).is_some()
        || heading(input).is_some()
        || html_tag(input).is_some()
        || footnote(input).is_some()
        || blockquote(input).is_some()
        || thematic_break(input)
        || list_marker(input).is_some()
}
