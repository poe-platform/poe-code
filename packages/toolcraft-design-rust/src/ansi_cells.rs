//! Styled terminal rows and packed screen cells over UTF-16 input.
use crate::terminal::{Text, grapheme_width, params};

#[derive(Clone, Debug, Default, PartialEq)]
struct Style {
    fg: Option<String>,
    bg: Option<String>,
    bold: bool,
    dim: bool,
    inverse: bool,
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
    fn packed(&self) -> u32 {
        let color = |value: &Option<String>| match value.as_deref() {
            Some("black" | "red") => 1,
            Some("green") => 2,
            Some("yellow") => 3,
            Some("blue") => 4,
            Some("magenta") => 5,
            Some("cyan") => 6,
            Some("white") => 7,
            Some("gray") => 8,
            _ => 0,
        };
        u32::from(self.bold)
            | (u32::from(self.dim) << 1)
            | (u32::from(self.inverse) << 3)
            | (color(&self.fg) << 8)
            | (color(&self.bg) << 16)
    }
}
#[derive(Clone)]
struct StyledCell {
    ch: Text,
    style: Style,
}
struct Row {
    cells: Vec<Option<StyledCell>>,
    column: usize,
    style: Style,
    concealed: bool,
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
                    self.style = Style::default();
                    self.concealed = false;
                }
                1 => self.style.bold = true,
                2 => self.style.dim = true,
                7 => self.style.inverse = true,
                22 => {
                    self.style.bold = false;
                    self.style.dim = false;
                }
                27 => self.style.inverse = false,
                8 => self.concealed = true,
                28 => self.concealed = false,
                30..=37 => self.style.fg = Some(BASIC[(code - 30) as usize].into()),
                40..=47 => self.style.bg = Some(BASIC[(code - 40) as usize].into()),
                90..=97 => self.style.fg = Some(BRIGHT[(code - 90) as usize].into()),
                100..=107 => self.style.bg = Some(BRIGHT[(code - 100) as usize].into()),
                39 => self.style.fg = None,
                49 => self.style.bg = None,
                38 | 48 => {
                    let value = |offset| values.get(index + offset).copied().unwrap_or(0);
                    let (color, skip) = match value(1) {
                        5 => (Some(palette(value(2))), 3),
                        2 => (Some(rgb(value(2), value(3), value(4))), 5),
                        _ => (None, 1),
                    };
                    if let Some(color) = color {
                        if code == 38 {
                            self.style.fg = Some(color);
                        } else {
                            self.style.bg = Some(color);
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
fn lines<E>(
    text: &[u16],
    segment: &mut impl FnMut(&[u16]) -> Result<Vec<Text>, E>,
) -> Result<Vec<Vec<StyledCell>>, E> {
    let text = crate::preview::TerminalStringFilter::default().push(text);
    let mut row = Row {
        cells: vec![],
        column: 0,
        style: Style::default(),
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
    let mut output = vec![];
    for (index, line) in lines(text, &mut segment)?.into_iter().enumerate() {
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
    let mut output = vec![];
    for (index, line) in lines(text, &mut segment)?.into_iter().enumerate() {
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
