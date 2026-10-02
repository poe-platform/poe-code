//! Styled terminal rows and packed screen cells over UTF-16 input.
use crate::terminal::{Text, grapheme_width, params};
use std::sync::Arc;

pub const STYLE_FIELDS: [&str; 5] = ["fg", "bg", "bold", "dim", "inverse"];

#[derive(Clone, Debug, PartialEq)]
pub enum StyleValue {
    Undefined,
    Text(Arc<[u16]>),
    Boolean(bool),
    Number(f64),
    Opaque(u32),
}
#[derive(Clone, Debug)]
pub struct StyleProperty {
    pub name: &'static str,
    pub value: StyleValue,
    /// Original host slot, preserving arbitrary base values without owning them.
    pub base_index: Option<u32>,
}
#[derive(Clone, Debug, Default)]
pub struct Style {
    pub properties: Vec<StyleProperty>,
}
impl PartialEq for Style {
    fn eq(&self, other: &Self) -> bool {
        STYLE_FIELDS
            .iter()
            .all(|name| self.value(name) == other.value(name))
    }
}
const BASIC: [&str; 8] = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
];
const BRIGHT: [&str; 8] = [
    "gray",
    "redBright",
    "greenBright",
    "yellowBright",
    "blueBright",
    "magentaBright",
    "cyanBright",
    "whiteBright",
];
fn rgb(r: i64, g: i64, b: i64) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        r.clamp(0, 255),
        g.clamp(0, 255),
        b.clamp(0, 255)
    )
}
fn palette(value: i64) -> String {
    match value {
        0..=7 => BASIC[value as usize].into(),
        8..=15 => BRIGHT[(value - 8) as usize].into(),
        16..=231 => {
            let offset = value - 16;
            let level = |x| if x == 0 { 0 } else { 55 + x * 40 };
            rgb(
                level(offset / 36),
                level(offset % 36 / 6),
                level(offset % 6),
            )
        }
        232..=255 => {
            let level = 8 + (value - 232) * 10;
            rgb(level, level, level)
        }
        _ => "#000000".into(),
    }
}
impl Style {
    fn value(&self, name: &str) -> &StyleValue {
        self.properties
            .iter()
            .find(|property| property.name == name)
            .map(|property| &property.value)
            .unwrap_or(&StyleValue::Undefined)
    }
    fn set(&mut self, property: StyleProperty) {
        if let Some(existing) = self
            .properties
            .iter_mut()
            .find(|entry| entry.name == property.name)
        {
            *existing = property;
        } else {
            self.properties.push(property);
        }
    }
    fn color(&mut self, name: &'static str, color: &str) {
        self.set(StyleProperty {
            name,
            value: StyleValue::Text(color.encode_utf16().collect::<Vec<_>>().into()),
            base_index: None,
        });
    }
    fn flag(&mut self, name: &'static str) {
        self.set(StyleProperty {
            name,
            value: StyleValue::Boolean(true),
            base_index: None,
        });
    }
    fn remove(&mut self, name: &str) {
        self.properties.retain(|property| property.name != name);
    }
    fn restore(&mut self, name: &str, base: &Self) {
        if let Some(property) = base
            .properties
            .iter()
            .find(|property| property.name == name && property.value != StyleValue::Undefined)
        {
            self.set(property.clone());
        } else {
            self.remove(name);
        }
    }
    fn packed(&self) -> u32 {
        let color = |name| match self.value(name) {
            StyleValue::Text(text) => match String::from_utf16_lossy(text).as_str() {
                "black" | "red" => 1,
                "green" => 2,
                "yellow" => 3,
                "blue" => 4,
                "magenta" => 5,
                "cyan" => 6,
                "white" => 7,
                "gray" => 8,
                _ => 0,
            },
            _ => 0,
        };
        u32::from(self.value("bold") == &StyleValue::Boolean(true))
            | (u32::from(self.value("dim") == &StyleValue::Boolean(true)) << 1)
            | (u32::from(self.value("inverse") == &StyleValue::Boolean(true)) << 3)
            | (color("fg") << 8)
            | (color("bg") << 16)
    }
}
#[derive(Clone)]
pub struct StyledCell {
    pub ch: Text,
    pub style: Style,
}
struct Row {
    cells: Vec<Option<StyledCell>>,
    column: usize,
    style: Style,
    concealed: bool,
    base: Style,
}
impl Row {
    fn cell(&self, ch: Text) -> StyledCell {
        StyledCell {
            ch,
            style: self.style.clone(),
        }
    }
    fn clear(&mut self, pos: usize) {
        if pos >= self.cells.len() {
            self.cells.resize(pos + 1, None);
        }
        if self.cells[pos]
            .as_ref()
            .is_some_and(|cell| cell.ch.is_empty())
            && pos > 0
        {
            self.cells[pos - 1] = Some(self.cell(vec![32]));
        }
        if self
            .cells
            .get(pos + 1)
            .and_then(Option::as_ref)
            .is_some_and(|cell| cell.ch.is_empty())
        {
            self.cells[pos + 1] = Some(self.cell(vec![32]));
        }
        self.cells[pos] = None;
    }
    fn write(&mut self, ch: Text) {
        let width = grapheme_width(&ch);
        if width == 0 {
            let previous = if self.column > 0
                && self
                    .cells
                    .get(self.column - 1)
                    .and_then(Option::as_ref)
                    .is_some_and(|cell| cell.ch.is_empty())
            {
                self.column.checked_sub(2)
            } else {
                self.column.checked_sub(1)
            };
            if !self.concealed
                && let Some(cell) = previous
                    .and_then(|pos| self.cells.get_mut(pos))
                    .and_then(Option::as_mut)
            {
                cell.ch.extend(ch);
            }
            return;
        }
        self.clear(self.column);
        if width == 2 {
            self.clear(self.column + 1);
        }
        self.cells[self.column] = Some(self.cell(if self.concealed { vec![32] } else { ch }));
        if width == 2 {
            self.cells[self.column + 1] =
                Some(self.cell(if self.concealed { vec![32] } else { vec![] }));
        }
        self.column += width;
    }
    fn take(&mut self) -> Vec<StyledCell> {
        let mut segments: Vec<StyledCell> = vec![];
        for cell in std::mem::take(&mut self.cells) {
            let cell = cell.unwrap_or_else(|| StyledCell {
                ch: vec![32],
                style: Style::default(),
            });
            if let Some(last) = segments.last_mut()
                && last.style == cell.style
            {
                last.ch.extend(cell.ch);
            } else {
                segments.push(cell);
            }
        }
        self.column = 0;
        segments
    }
    fn sgr(&mut self, values: &[i64]) {
        let mut index = 0;
        while index < values.len() {
            let code = values[index];
            match code {
                0 => {
                    self.style = self.base.clone();
                    self.concealed = false;
                }
                1 => self.style.flag("bold"),
                2 => self.style.flag("dim"),
                7 => self.style.flag("inverse"),
                22 => {
                    self.style.remove("bold");
                    self.style.remove("dim");
                }
                27 => self.style.remove("inverse"),
                8 => self.concealed = true,
                28 => self.concealed = false,
                30..=37 => self.style.color("fg", BASIC[(code - 30) as usize]),
                40..=47 => self.style.color("bg", BASIC[(code - 40) as usize]),
                90..=97 => self.style.color("fg", BRIGHT[(code - 90) as usize]),
                100..=107 => self.style.color("bg", BRIGHT[(code - 100) as usize]),
                39 => self.style.restore("fg", &self.base),
                49 => self.style.restore("bg", &self.base),
                38 | 48 => {
                    let value = |offset| values.get(index + offset).copied().unwrap_or(0);
                    let (color, skip) = match value(1) {
                        5 => (Some(palette(value(2))), 3),
                        2 => (Some(rgb(value(2), value(3), value(4))), 5),
                        _ => (None, 1),
                    };
                    if let Some(color) = color {
                        if code == 38 {
                            self.style.color("fg", &color);
                        } else {
                            self.style.color("bg", &color);
                        }
                    }
                    index += skip;
                    continue;
                }
                _ => {}
            }
            index += 1;
        }
    }
}
pub fn styled_lines<E>(
    text: &[u16],
    base: Style,
    segment: &mut impl FnMut(&[u16]) -> Result<Vec<Text>, E>,
) -> Result<Vec<Vec<StyledCell>>, E> {
    let mut row = Row {
        cells: vec![],
        column: 0,
        style: base.clone(),
        base,
        concealed: false,
    };
    let mut lines = vec![];
    let mut index = 0;
    while index < text.len() {
        let ch = text[index];
        if (ch == 27 && text.get(index + 1) == Some(&91)) || ch == 155 {
            let start = index + if ch == 27 { 2 } else { 1 };
            let mut end = start;
            while end < text.len() && !(64..=126).contains(&text[end]) {
                end += 1;
            }
            if end == text.len() {
                break;
            }
            let values = params(&text[start..end]);
            if text[end] == 109 {
                row.sgr(&values);
            } else if text[end] == 75 {
                match values.first().copied().unwrap_or(0) {
                    0 => {
                        row.clear(row.column);
                        row.cells.truncate(row.column);
                    }
                    1 => {
                        if !row.cells.is_empty() {
                            for pos in 0..=row.column.min(row.cells.len() - 1) {
                                row.clear(pos);
                            }
                        }
                    }
                    2 => row.cells.clear(),
                    _ => {}
                }
            }
            index = end + 1;
            continue;
        }
        match ch {
            133 | 10 => lines.push(row.take()),
            27 => {
                index += 2;
                continue;
            }
            13 => row.column = 0,
            8 => row.column = row.column.saturating_sub(1),
            9 => {
                for _ in 0..8 - row.column % 8 {
                    if row.cells.get(row.column).is_none_or(Option::is_none) {
                        row.write(vec![32]);
                    } else {
                        row.column += 1;
                    }
                }
            }
            0..=31 | 127..=159 => {}
            _ => {
                let start = index;
                index += 1;
                while index < text.len() && text[index] >= 32 && !(127..=159).contains(&text[index])
                {
                    index += 1;
                }
                for ch in segment(&text[start..index])? {
                    row.write(ch);
                }
                continue;
            }
        }
        index += 1;
    }
    lines.push(row.take());
    Ok(lines)
}

pub fn plain<E>(
    text: &[u16],
    mut segment: impl FnMut(&[u16]) -> Result<Vec<Text>, E>,
) -> Result<Text, E> {
    let text = crate::preview::TerminalStringFilter::default().push(text);
    let mut output = vec![];
    for (index, line) in styled_lines(&text, Style::default(), &mut segment)?
        .into_iter()
        .enumerate()
    {
        if index > 0 {
            output.push(32);
        }
        for cell in line {
            output.extend(cell.ch);
        }
    }
    Ok(output)
}

pub struct Cell {
    pub ch: Text,
    pub width: u32,
    pub style: u32,
}
pub fn cells<E>(
    text: &[u16],
    mut segment: impl FnMut(&[u16]) -> Result<Vec<Text>, E>,
) -> Result<Vec<Cell>, E> {
    let text = crate::preview::TerminalStringFilter::default().push(text);
    let mut output = vec![];
    for (index, line) in styled_lines(&text, Style::default(), &mut segment)?
        .into_iter()
        .enumerate()
    {
        if index > 0 {
            output.push(Cell {
                ch: vec![10],
                width: 1,
                style: 0,
            });
        }
        for cell in line {
            let style = cell.style.packed();
            for ch in segment(&cell.ch)? {
                output.push(Cell {
                    width: if grapheme_width(&ch) > 1 { 2 } else { 1 },
                    ch,
                    style,
                });
            }
        }
    }
    Ok(output)
}
