//! UTF-16 terminal display interpretation compatible with the source ANSI dialect.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Color {
    Ansi4(u8),
    Ansi8(u8),
    Rgb(u8, u8, u8),
}
impl Color {
    pub fn rgb(&self) -> Option<(u8, u8, u8)> {
        if let Self::Rgb(r, g, b) = self {
            Some((*r, *g, *b))
        } else {
            None
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub dim: bool,
    pub inverse: bool,
    pub conceal: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub text: Vec<u16>,
    pub style: Style,
}
#[derive(Clone)]
struct Cell {
    text: Vec<u16>,
    style: Style,
}
fn decimal(raw: &[u16]) -> Option<f64> {
    if raw.is_empty() || raw.iter().any(|c| !(48..=57).contains(c)) {
        None
    } else {
        String::from_utf16_lossy(raw).parse().ok()
    }
}
fn byte(n: f64) -> u8 {
    n.clamp(0.0, 255.0) as u8
}
fn colon(raw: &[u16]) -> Option<(bool, Color)> {
    let parts = raw.split(|c| *c == 58).collect::<Vec<_>>();
    let number = |i: usize| parts.get(i).and_then(|v| decimal(v));
    let target = number(0)?;
    if target != 38.0 && target != 48.0 {
        return None;
    }
    let mode = number(1)?;
    let color = if mode == 5.0 {
        Color::Ansi8(byte(number(2)?))
    } else if mode == 2.0 {
        let offset = if parts.get(2).is_some_and(|v| v.is_empty()) {
            3
        } else {
            2
        };
        Color::Rgb(
            byte(number(offset)?),
            byte(number(offset + 1)?),
            byte(number(offset + 2)?),
        )
    } else {
        return None;
    };
    Some((target == 38.0, color))
}
fn sgr(style: &mut Style, params: &[u16]) {
    let default = [48];
    let raw = if params.is_empty() {
        default.as_slice()
    } else {
        params
    };
    let parts = raw.split(|c| *c == 59).collect::<Vec<_>>();
    let mut i = 0;
    while i < parts.len() {
        let part = parts[i];
        if part.contains(&58) {
            if let Some((fg, color)) = colon(part) {
                if fg {
                    style.fg = Some(color);
                } else {
                    style.bg = Some(color);
                }
            }
            i += 1;
            continue;
        }
        let Some(n) = (if part.is_empty() {
            Some(0.0)
        } else {
            decimal(part)
        }) else {
            return;
        };
        match n as u64 {
            0 if n == 0.0 => *style = Style::default(),
            1 => style.bold = true,
            2 => style.dim = true,
            22 => {
                style.bold = false;
                style.dim = false;
            }
            3 => style.italic = true,
            23 => style.italic = false,
            4 => style.underline = true,
            24 => style.underline = false,
            9 => style.strikethrough = true,
            29 => style.strikethrough = false,
            7 => style.inverse = true,
            27 => style.inverse = false,
            8 => style.conceal = true,
            28 => style.conceal = false,
            39 => style.fg = None,
            49 => style.bg = None,
            30..=37 => style.fg = Some(Color::Ansi4(n as u8 - 30)),
            90..=97 => style.fg = Some(Color::Ansi4(n as u8 - 90 + 8)),
            40..=47 => style.bg = Some(Color::Ansi4(n as u8 - 40)),
            100..=107 => style.bg = Some(Color::Ansi4(n as u8 - 100 + 8)),
            38 | 48 => {
                let numbers = parts.iter().map(|p| decimal(p)).collect::<Option<Vec<_>>>();
                let extended = numbers.and_then(|v| {
                    let mode = *v.get(i + 1)?;
                    if mode == 5.0 {
                        Some((Color::Ansi8(byte(*v.get(i + 2)?)), 2))
                    } else if mode == 2.0 {
                        Some((
                            Color::Rgb(
                                byte(*v.get(i + 2)?),
                                byte(*v.get(i + 3)?),
                                byte(*v.get(i + 4)?),
                            ),
                            4,
                        ))
                    } else {
                        None
                    }
                });
                if let Some((color, consumed)) = extended {
                    if n == 38.0 {
                        style.fg = Some(color);
                    } else {
                        style.bg = Some(color);
                    }
                    i += consumed;
                } else if parts.get(i + 1).is_some_and(|v| *v == [50] || *v == [53]) {
                    break;
                }
            }
            _ => {}
        }
        i += 1;
    }
}
fn wide(cp: u32) -> bool {
    matches!(cp,0x1100..=0x115f|0x2329..=0x232a|0x2e80..=0x303e|0x3040..=0xa4cf|0xac00..=0xd7a3|0xf900..=0xfaff|0xfe10..=0xfe19|0xfe30..=0xfe6f|0xff00..=0xff60|0xffe0..=0xffe6|0x1f300..=0x1f64f|0x1f900..=0x1f9ff|0x20000..=0x3fffd)
}
fn push(runs: &mut Vec<Run>, style: Style, text: Vec<u16>) {
    if text.is_empty() {
        return;
    }
    if text != [10]
        && let Some(last) = runs.last_mut()
        && last.text != [10]
        && last.style == style
    {
        last.text.extend(text);
        return;
    }
    runs.push(Run { text, style });
}
struct Display {
    lines: Vec<Vec<Option<Cell>>>,
    breaks: Vec<Option<Style>>,
    style: Style,
    row: usize,
    column: usize,
    saved: (usize, usize),
}
impl Display {
    fn ensure(&mut self) {
        self.lines
            .resize_with(self.lines.len().max(self.row + 1), Vec::new);
    }
    fn down(&mut self, keep: bool) {
        self.breaks
            .resize_with(self.breaks.len().max(self.row + 1), || None);
        self.breaks[self.row] = Some(self.style.clone());
        self.row = (self.row + 1).min(999);
        if !keep {
            self.column = 0;
        }
        self.ensure();
    }
    fn write(&mut self, text: Vec<u16>, width: usize) {
        let line = &mut self.lines[self.row];
        line.resize_with(line.len().max(self.column + width).min(1000), || None);
        line[self.column] = Some(Cell {
            text,
            style: self.style.clone(),
        });
        for offset in 1..width {
            if self.column + offset < 1000 {
                line[self.column + offset] = Some(Cell {
                    text: vec![],
                    style: self.style.clone(),
                });
            }
        }
        self.column = (self.column + width).min(999);
    }
    fn erase_line(&mut self, mode: usize) {
        let line = &mut self.lines[self.row];
        match mode {
            1 => {
                let end = (self.column + 1).min(line.len());
                line[..end].fill(None);
            }
            2 => line.clear(),
            _ => line.truncate(self.column),
        }
    }
    fn erase_display(&mut self, mode: usize) {
        match mode {
            1 => {
                for line in &mut self.lines[..self.row] {
                    line.clear();
                }
                self.erase_line(1);
            }
            2 | 3 => {
                self.lines.clear();
                self.breaks.clear();
                self.ensure();
            }
            _ => {
                self.erase_line(0);
                self.lines.truncate(self.row + 1);
                self.breaks.truncate(self.row);
            }
        }
    }
    fn finish(self) -> Vec<Run> {
        let default = Style::default();
        let mut last = self.lines.len() - 1;
        while last > 0
            && !self.lines[last]
                .iter()
                .any(|v| v.as_ref().is_some_and(|c| !c.text.is_empty()))
            && self.breaks.get(last - 1).is_none_or(Option::is_none)
        {
            last -= 1;
        }
        let mut runs = Vec::new();
        for row in 0..=last {
            let line = &self.lines[row];
            if let Some(last) = line.iter().rposition(Option::is_some) {
                for cell in &line[..=last] {
                    if let Some(cell) = cell {
                        push(&mut runs, cell.style.clone(), cell.text.clone());
                    } else {
                        push(&mut runs, default.clone(), vec![32]);
                    }
                }
            }
            if row < last {
                push(
                    &mut runs,
                    self.breaks
                        .get(row)
                        .and_then(Option::as_ref)
                        .unwrap_or(&default)
                        .clone(),
                    vec![10],
                );
            }
        }
        runs
    }
}
pub fn parse(input: &[u16]) -> Vec<Run> {
    let mut d = Display {
        lines: vec![vec![]],
        breaks: vec![],
        style: Style::default(),
        row: 0,
        column: 0,
        saved: (0, 0),
    };
    let mut i = 0;
    while i < input.len() {
        let ch = input[i];
        match ch {
            10 => {
                d.down(false);
                i += 1;
                continue;
            }
            11 => {
                d.down(true);
                i += 1;
                continue;
            }
            13 => {
                d.column = 0;
                i += 1;
                continue;
            }
            8 => {
                d.column = d.column.saturating_sub(1);
                i += 1;
                continue;
            }
            9 => {
                let stop = (d.column / 8 * 8 + 8).min(1000);
                while d.column < stop {
                    let before = d.column;
                    d.write(vec![32], 1);
                    if d.column == before {
                        break;
                    }
                }
                i += 1;
                continue;
            }
            _ => {}
        }
        if ch == 27 && input.get(i + 1) == Some(&93) {
            i += 2;
            while i < input.len() {
                if input[i] == 7 {
                    i += 1;
                    break;
                }
                if input[i] == 27 && input.get(i + 1) == Some(&92) {
                    i += 2;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if ch == 27 && matches!(input.get(i + 1), Some(55 | 56)) {
            if input[i + 1] == 55 {
                d.saved = (d.row, d.column);
            } else {
                (d.row, d.column) = d.saved;
                d.ensure();
            }
            i += 2;
            continue;
        }
        let prefix = if ch == 155 {
            1
        } else if ch == 27 && input.get(i + 1) == Some(&91) {
            2
        } else {
            0
        };
        if prefix > 0 {
            let start = i + prefix;
            let mut end = start;
            while end < input.len() && !(64..=126).contains(&input[end]) {
                end += 1;
            }
            let params = &input[start..end];
            let position = |index| {
                params
                    .split(|c| *c == 59)
                    .nth(index)
                    .and_then(decimal)
                    .filter(|n| *n >= 1.0)
                    .unwrap_or(1.0) as usize
            };
            let mode = params
                .split(|c| *c == 59)
                .next()
                .and_then(decimal)
                .unwrap_or(0.0) as usize;
            match input.get(end).copied() {
                Some(109) => sgr(&mut d.style, params),
                Some(71) => d.column = position(0).saturating_sub(1).min(999),
                Some(67) => d.column = d.column.saturating_add(position(0)).min(999),
                Some(68) => d.column = d.column.saturating_sub(position(0)),
                Some(65) => d.row = d.row.saturating_sub(position(0)),
                Some(66) => {
                    d.row = d.row.saturating_add(position(0)).min(999);
                    d.ensure();
                }
                Some(69) => {
                    d.row = d.row.saturating_add(position(0)).min(999);
                    d.column = 0;
                    d.ensure();
                }
                Some(70) => {
                    d.row = d.row.saturating_sub(position(0));
                    d.column = 0;
                }
                Some(72 | 102) => {
                    d.row = position(0).saturating_sub(1).min(999);
                    d.column = position(1).saturating_sub(1).min(999);
                    d.ensure();
                }
                Some(75) => d.erase_line(mode),
                Some(74) => d.erase_display(mode),
                Some(115) => d.saved = (d.row, d.column),
                Some(117) => {
                    (d.row, d.column) = d.saved;
                    d.ensure();
                }
                _ => {}
            }
            i = if end < input.len() { end + 1 } else { end };
            continue;
        }
        let paired = (0xd800..=0xdbff).contains(&ch)
            && input
                .get(i + 1)
                .is_some_and(|c| (0xdc00..=0xdfff).contains(c));
        let (cp, length) = if paired {
            (
                0x10000 + (u32::from(ch) - 0xd800) * 1024 + (u32::from(input[i + 1]) - 0xdc00),
                2,
            )
        } else {
            (u32::from(ch), 1)
        };
        d.write(input[i..i + length].to_vec(), if wide(cp) { 2 } else { 1 });
        i += length;
    }
    d.finish()
}
/// Adapt a typed host run into the portable display model.
pub fn run_from_value(v: &mcp_protocol_rust::json::Value) -> Run {
    use mcp_protocol_rust::json::Value;
    let field = |key: &str| v.get(key).unwrap_or(&Value::Null);
    let flag = |key| field(key) == &Value::Bool(true);
    fn color(v: &Value) -> Option<Color> {
        let Value::Object(_) = v else {
            return None;
        };
        let numeric = |key| {
            if let Some(Value::Number(n)) = v.get(key) {
                *n
            } else {
                f64::NAN
            }
        };
        let kind = if let Some(Value::String(t)) = v.get("type") {
            String::from_utf16_lossy(t)
        } else {
            String::new()
        };
        let i = numeric("index");
        match kind.as_str() {
            "ansi4" => Some(Color::Ansi4(
                if i.is_finite() && i >= 0.0 && i.fract() == 0.0 {
                    i.min(255.0) as u8
                } else {
                    255
                },
            )),
            "ansi8" => Some(
                if i.is_finite() && (0.0..=255.0).contains(&i) && i.fract() == 0.0 {
                    Color::Ansi8(i as u8)
                } else {
                    Color::Ansi4(255)
                },
            ),
            _ => Some(Color::Rgb(
                byte(numeric("r")),
                byte(numeric("g")),
                byte(numeric("b")),
            )),
        }
    }
    Run {
        text: if let Value::String(t) = field("text") {
            t.clone()
        } else {
            vec![]
        },
        style: Style {
            fg: color(field("fg")),
            bg: color(field("bg")),
            bold: flag("bold"),
            italic: flag("italic"),
            underline: flag("underline"),
            strikethrough: flag("strikethrough"),
            dim: flag("dim"),
            inverse: flag("inverse"),
            conceal: flag("conceal"),
        },
    }
}
