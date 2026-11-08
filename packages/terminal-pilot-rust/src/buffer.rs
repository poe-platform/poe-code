//! Stateful, bounded UTF-16 terminal display independent of the host runtime.
use terminal_png_rust::{grapheme, svg};
#[path = "emoji_tables.rs"]
mod emoji;
fn has(ranges: &[(u32, u32)], cp: u32) -> bool {
    let i = ranges.partition_point(|(_, end)| *end < cp);
    ranges.get(i).is_some_and(|(start, _)| *start <= cp)
}
fn cluster_width(text: &[u16]) -> usize {
    let points = char::decode_utf16(text.iter().copied())
        .map(|c| c.map_or(0xfffd, |c| c as u32))
        .collect::<Vec<_>>();
    let first = points.first().copied().unwrap_or(0);
    if has(emoji::EMOJI_PRESENTATION, first)
        || has(emoji::EMOJI_MODIFIER_BASE, first)
        || has(emoji::EMOJI, first) && points.get(1) == Some(&0xfe0f)
    {
        2
    } else {
        let mut width = 0;
        for point in points {
            if has(emoji::MARKS, point) {
                continue;
            }
            if width >= 2 {
                return 2;
            }
            let mut encoded = [0; 2];
            width += char::from_u32(point)
                .map_or(1, |c| svg::display_width(c.encode_utf16(&mut encoded), 0));
        }
        width
    }
}
#[derive(Clone, Debug)]
pub struct Cell {
    pub text: Vec<u16>,
    pub width: usize,
    pub style: Vec<u16>,
}
#[derive(Clone)]
struct Row {
    id: u64,
    cells: Vec<Option<Box<Cell>>>,
}
#[derive(Clone, Default)]
struct Style {
    flags: [bool; 7],
    fg: Vec<u32>,
    bg: Vec<u32>,
}
impl Style {
    fn sequence(&self) -> Vec<u16> {
        let mut codes = vec![];
        for (flag, code) in self.flags.iter().zip([1, 2, 3, 4, 7, 8, 9]) {
            if *flag {
                codes.push(code)
            }
        }
        codes.extend(&self.fg);
        codes.extend(&self.bg);
        if codes.is_empty() {
            vec![]
        } else {
            format!(
                "\x1b[{}m",
                codes
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(";")
            )
            .encode_utf16()
            .collect()
        }
    }
    fn apply(&mut self, params: &[u32]) {
        let params = if params.is_empty() { &[0][..] } else { params };
        let mut i = 0;
        while i < params.len() {
            let n = params[i];
            match n {
                0 => *self = Self::default(),
                1..=4 => self.flags[n as usize - 1] = true,
                7..=9 => self.flags[n as usize - 3] = true,
                21 | 22 => {
                    self.flags[0] = false;
                    self.flags[1] = false
                }
                23 => self.flags[2] = false,
                24 => self.flags[3] = false,
                27..=29 => self.flags[n as usize - 23] = false,
                39 => self.fg.clear(),
                49 => self.bg.clear(),
                30..=37 | 90..=97 => self.fg = vec![n],
                40..=47 | 100..=107 => self.bg = vec![n],
                38 | 48 => {
                    let count = match params.get(i + 1) {
                        Some(5) => 3,
                        Some(2) => 5,
                        _ => 0,
                    };
                    if count > 0 && i + count <= params.len() {
                        let color = params[i..i + count].to_vec();
                        if n == 38 {
                            self.fg = color
                        } else {
                            self.bg = color
                        }
                        i += count - 1
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
}
#[derive(Clone)]
struct Saved {
    x: usize,
    y: usize,
    auto_wrap: bool,
    style: Style,
}
#[derive(Clone)]
struct Primary {
    rows: Vec<Row>,
    x: usize,
    y: usize,
    pending: bool,
    style: Style,
}
#[derive(Clone, Copy, PartialEq)]
enum State {
    Normal,
    Escape,
    Csi,
    Osc,
    Str,
    StringEscape,
    Charset,
    Hash,
}
pub struct Buffer {
    cols: usize,
    rows: usize,
    screen: Vec<Row>,
    primary: Option<Primary>,
    x: usize,
    y: usize,
    saved: Saved,
    top: usize,
    bottom: usize,
    state: State,
    params: String,
    private: u32,
    auto_wrap: bool,
    pending: bool,
    origin: bool,
    insert: bool,
    tabs: Vec<bool>,
    last: Option<Vec<u16>>,
    grapheme: Option<(u64, usize, Vec<u16>)>,
    high: Option<u16>,
    style: Style,
    string_state: State,
    charset: Option<usize>,
    graphics: [bool; 2],
    shift: bool,
    next_row: u64,
}
fn geometry(cols: usize, rows: usize) -> Result<(), String> {
    if cols == 0
        || rows == 0
        || cols > 1000
        || rows > 1000
        || cols.checked_mul(rows).is_none_or(|n| n > 1_000_000)
    {
        Err("Terminal dimensions must be integers between 1 and 1000.".into())
    } else {
        Ok(())
    }
}
impl Buffer {
    pub fn new(cols: usize, rows: usize) -> Result<Self, String> {
        geometry(cols, rows)?;
        let style = Style::default();
        let mut b = Self {
            cols,
            rows,
            screen: vec![],
            primary: None,
            x: 0,
            y: 0,
            saved: Saved {
                x: 0,
                y: 0,
                auto_wrap: true,
                style: style.clone(),
            },
            top: 0,
            bottom: rows - 1,
            state: State::Normal,
            params: String::new(),
            private: 0,
            auto_wrap: true,
            pending: false,
            origin: false,
            insert: false,
            tabs: (0..cols).map(|c| c > 0 && c % 8 == 0).collect(),
            last: None,
            grapheme: None,
            high: None,
            style,
            string_state: State::Normal,
            charset: None,
            graphics: [false; 2],
            shift: false,
            next_row: 0,
        };
        b.screen = (0..rows).map(|_| b.row()).collect();
        Ok(b)
    }
    fn row(&mut self) -> Row {
        self.next_row += 1;
        Row {
            id: self.next_row,
            cells: vec![None; self.cols],
        }
    }
    pub fn retained_bytes(&self) -> usize {
        fn style_bytes(style: &Style) -> usize {
            (style.fg.capacity() + style.bg.capacity()) * std::mem::size_of::<u32>()
        }
        fn rows_bytes(rows: &Vec<Row>) -> usize {
            rows.capacity() * std::mem::size_of::<Row>()
                + rows
                    .iter()
                    .map(|row| {
                        row.cells.capacity() * std::mem::size_of::<Option<Box<Cell>>>()
                            + row
                                .cells
                                .iter()
                                .filter_map(Option::as_ref)
                                .map(|cell| {
                                    std::mem::size_of::<Cell>()
                                        + (cell.text.capacity() + cell.style.capacity())
                                            * std::mem::size_of::<u16>()
                                })
                                .sum::<usize>()
                    })
                    .sum::<usize>()
        }
        std::mem::size_of::<Self>()
            + rows_bytes(&self.screen)
            + self
                .primary
                .as_ref()
                .map_or(0, |p| rows_bytes(&p.rows) + style_bytes(&p.style))
            + self.params.capacity()
            + self.tabs.capacity() * std::mem::size_of::<bool>()
            + style_bytes(&self.style)
            + style_bytes(&self.saved.style)
            + self
                .last
                .as_ref()
                .map_or(0, |s| s.capacity() * std::mem::size_of::<u16>())
            + self
                .grapheme
                .as_ref()
                .map_or(0, |(_, _, s)| s.capacity() * std::mem::size_of::<u16>())
    }
    pub fn cursor(&self) -> (usize, usize) {
        (self.x, self.y)
    }
    pub fn size(&self) -> (usize, usize) {
        (self.cols, self.rows)
    }
    pub fn cells(&self) -> impl Iterator<Item = &[Option<Box<Cell>>]> {
        self.screen.iter().map(|r| r.cells.as_slice())
    }
    pub fn render_line(&self, row: usize) -> Vec<u16> {
        let Some(row) = self.screen.get(row) else {
            return vec![];
        };
        let Some(last) = row.cells.iter().rposition(Option::is_some) else {
            return vec![];
        };
        let mut text = vec![];
        let mut active: Vec<u16> = vec![];
        let mut x = 0;
        while x <= last {
            let cell = row.cells[x].as_ref();
            let style = cell.map_or(&[][..], |c| &c.style);
            if style != active {
                if !active.is_empty() {
                    text.extend("\x1b[0m".encode_utf16());
                }
                text.extend(style);
                active = style.to_vec();
            }
            text.extend(cell.map_or(&[32][..], |c| &c.text));
            x += cell.map_or(1, |c| c.width);
        }
        if !active.is_empty() {
            text.extend("\x1b[0m".encode_utf16());
        }
        text
    }
    pub fn resize(&mut self, cols: usize, rows: usize) -> Result<(), String> {
        geometry(cols, rows)?;
        self.grapheme = None;
        self.cols = cols;
        while self.screen.len() < rows {
            let row = self.row();
            self.screen.push(row);
        }
        self.screen.truncate(rows);
        for row in &mut self.screen {
            row.cells.resize(cols, None);
            if row.cells[cols - 1].as_ref().is_some_and(|c| c.width == 2) {
                row.cells[cols - 1] = None;
            }
        }
        self.rows = rows;
        self.top = self.top.min(rows - 1);
        self.bottom = self.bottom.min(rows - 1);
        if self.top >= self.bottom {
            self.top = 0;
            self.bottom = rows - 1
        }
        self.x = self.x.min(cols - 1);
        self.y = self.y.min(rows - 1);
        self.tabs.resize(cols, false);
        Ok(())
    }
    pub fn write(&mut self, input: &[u16]) -> Result<(), String> {
        let mut data = Vec::with_capacity(input.len() + 1);
        if let Some(h) = self.high.take() {
            data.push(h)
        }
        data.extend(input);
        if data.last().is_some_and(|u| (0xd800..=0xdbff).contains(u)) {
            self.high = data.pop();
        }
        let mut i = 0;
        while i < data.len() {
            let count = if (0xd800..=0xdbff).contains(&data[i])
                && data
                    .get(i + 1)
                    .is_some_and(|u| (0xdc00..=0xdfff).contains(u))
            {
                2
            } else {
                1
            };
            let ch = &data[i..i + count];
            let cp = if count == 2 {
                0x10000 + ((u32::from(ch[0]) - 0xd800) << 10) + u32::from(ch[1]) - 0xdc00
            } else {
                u32::from(ch[0])
            };
            self.feed(ch, cp)?;
            i += count;
        }
        Ok(())
    }
    fn erase(&mut self, y: usize, mut from: usize, mut to: usize) {
        let Some(row) = self.screen.get_mut(y) else {
            return;
        };
        if from > 0
            && row
                .cells
                .get(from - 1)
                .and_then(Option::as_ref)
                .is_some_and(|c| c.width == 2)
        {
            from -= 1
        }
        if row
            .cells
            .get(to)
            .and_then(Option::as_ref)
            .is_some_and(|c| c.width == 2)
        {
            to = to.saturating_add(1)
        }
        for cell in row.cells.iter_mut().take(to.saturating_add(1)).skip(from) {
            *cell = None
        }
    }
    fn set(&mut self, y: usize, x: usize, text: &[u16], width: usize) {
        if x >= self.cols || y >= self.rows {
            return;
        }
        self.erase(y, x, x + width - 1);
        let text = if self.style.flags[5] {
            vec![32; width]
        } else {
            text.to_vec()
        };
        self.screen[y].cells[x] = Some(Box::new(Cell {
            text,
            width,
            style: self.style.sequence(),
        }));
    }
    fn scroll(&mut self, count: usize, up: bool) {
        for _ in 0..count.min(self.bottom - self.top + 1) {
            let row = self.row();
            if up {
                self.screen.remove(self.top);
                self.screen.insert(self.bottom, row);
            } else {
                self.screen.remove(self.bottom);
                self.screen.insert(self.top, row);
            }
        }
    }
    fn newline(&mut self) {
        self.pending = false;
        if self.y == self.bottom {
            self.scroll(1, true)
        } else {
            self.y = (self.y + 1).min(self.rows - 1)
        }
    }
    fn advance(&mut self, width: usize) {
        if !self.auto_wrap {
            self.x = (self.x + width).min(self.cols - 1);
            self.pending = false
        } else if self.x + width >= self.cols {
            self.x = self.cols - 1;
            self.pending = true
        } else {
            self.x += width;
            self.pending = false
        }
    }
    fn width(&self, text: &[u16], cp: u32) -> usize {
        if text.len() > if cp > 0xffff { 2 } else { 1 } {
            return cluster_width(text.strip_suffix(&[0x200d]).unwrap_or(text))
                .min(2)
                .min(self.cols);
        }
        if matches!(cp,0x0300..=0x036f|0x1ab0..=0x1aff|0x1dc0..=0x1dff|0x20d0..=0x20ff|0xfe20..=0xfe2f)
        {
            return 0;
        }
        if matches!(cp,0x1100..=0x115f|0x2329..=0x232a|0x2e80..=0x303e|0x3041..=0x33bf|0x3400..=0x4dbf|0x4e00..=0xa4cf|0xac00..=0xd7af|0xf900..=0xfaff|0xfe10..=0xfe19|0xfe30..=0xfe6f|0xff00..=0xff60|0xffe0..=0xffe6|0x1f200..=0x1fffd|0x20000..=0x3fffd)
        {
            2.min(self.cols)
        } else {
            1
        }
    }
    fn printable(&mut self, ch: &[u16], cp: u32) -> Result<(), String> {
        if let Some((id, col, previous)) = &self.grapheme
            && *id == self.screen[self.y].id
            && self.screen[self.y].cells[*col].is_some()
        {
            let col = *col;
            let mut text = previous.clone();
            text.extend(ch);
            if text.len() > 16384 {
                return Err("Terminal grapheme exceeds text budget.".into());
            }
            if grapheme::segments(&text).len() == 1 {
                let width = if cp == 0x200d {
                    self.screen[self.y].cells[col].as_ref().unwrap().width
                } else {
                    cluster_width(&text).clamp(1, 2).min(self.cols)
                };
                self.x = col;
                if self.auto_wrap && self.x + width > self.cols {
                    self.erase(self.y, self.x, self.x);
                    self.x = 0;
                    self.newline()
                }
                self.set(self.y, self.x, &text, width);
                self.grapheme = Some((self.screen[self.y].id, self.x, text.clone()));
                self.last = Some(text);
                self.advance(width);
                return Ok(());
            }
        }
        self.grapheme = None;
        let width = self.width(ch, cp);
        if width == 0 {
            let start = if self.pending {
                Some(self.x)
            } else {
                self.x.checked_sub(1)
            };
            for y in (0..=self.y).rev() {
                let end = if y == self.y {
                    start
                } else {
                    Some(self.cols - 1)
                };
                if let Some(end) = end {
                    for x in (0..=end).rev() {
                        if let Some(cell) = self.screen[y].cells[x].as_mut() {
                            if cell.text.len() + ch.len() > 16384 {
                                return Err("Terminal grapheme exceeds text budget.".into());
                            }
                            cell.text.extend(ch);
                            return Ok(());
                        }
                    }
                }
            }
            return Ok(());
        }
        if self.auto_wrap && (self.pending || self.x + width > self.cols) {
            self.x = 0;
            self.newline()
        }
        if self.insert {
            let row = &mut self.screen[self.y].cells;
            for _ in 0..width {
                row.insert(self.x, None);
            }
            row.truncate(self.cols);
            if row[self.cols - 1].as_ref().is_some_and(|c| c.width == 2) {
                row[self.cols - 1] = None
            }
        }
        self.set(self.y, self.x, ch, width);
        self.grapheme = Some((self.screen[self.y].id, self.x, ch.to_vec()));
        self.last = Some(ch.to_vec());
        self.advance(width);
        Ok(())
    }
    fn save(&mut self) {
        self.saved = Saved {
            x: self.x,
            y: self.y,
            auto_wrap: self.auto_wrap,
            style: self.style.clone(),
        }
    }
    fn restore(&mut self) {
        self.x = self.saved.x.min(self.cols - 1);
        self.y = self.saved.y.min(self.rows - 1);
        self.auto_wrap = self.saved.auto_wrap;
        self.style = self.saved.style.clone()
    }
    fn reset_modes(&mut self) {
        self.auto_wrap = true;
        self.origin = false;
        self.insert = false;
        self.pending = false;
        self.tabs = (0..self.cols).map(|c| c > 0 && c % 8 == 0).collect();
        self.graphics = [false; 2];
        self.shift = false;
        self.style = Style::default()
    }
    fn feed(&mut self, ch: &[u16], cp: u32) -> Result<(), String> {
        if self.state != State::Normal && (cp == 0x18 || cp == 0x1a) {
            self.state = State::Normal;
            return Ok(());
        }
        if self.state == State::Csi && cp == 0x1b {
            self.state = State::Escape;
            return Ok(());
        }
        match self.state {
            State::Normal => {
                if cp < 0x20 || (0x7f..=0x9f).contains(&cp) {
                    self.grapheme = None
                }
                match cp {
                    0x1b => self.state = State::Escape,
                    0x9b => {
                        self.params.clear();
                        self.private = 0;
                        self.state = State::Csi
                    }
                    0x9d => self.state = State::Osc,
                    0x90 | 0x98 | 0x9e | 0x9f => self.state = State::Str,
                    0x85 => {
                        self.x = 0;
                        self.newline()
                    }
                    0x9c | 7 | 5 | 6 | 0x7f => {}
                    8 => {
                        self.pending = false;
                        self.x = self.x.saturating_sub(1)
                    }
                    9 => {
                        self.x = self
                            .tabs
                            .iter()
                            .enumerate()
                            .find(|(c, t)| **t && *c > self.x)
                            .map_or(self.cols - 1, |(c, _)| c)
                    }
                    10..=12 => self.newline(),
                    13 => {
                        self.pending = false;
                        self.x = 0
                    }
                    14 | 15 => self.shift = cp == 14,
                    _ if cp >= 0x20 => {
                        let graphics = self.graphics[usize::from(self.shift)];
                        let mapped = if graphics {
                            match cp {
                                0x6a => Some('┘'),
                                0x6b => Some('┐'),
                                0x6c => Some('┌'),
                                0x6d => Some('└'),
                                0x6e => Some('┼'),
                                0x71 => Some('─'),
                                0x74 => Some('├'),
                                0x75 => Some('┤'),
                                0x76 => Some('┴'),
                                0x77 => Some('┬'),
                                0x78 => Some('│'),
                                _ => None,
                            }
                        } else {
                            None
                        };
                        if let Some(c) = mapped {
                            let mut encoded = [0; 2];
                            self.printable(c.encode_utf16(&mut encoded), c as u32)?
                        } else {
                            self.printable(ch, cp)?
                        }
                    }
                    _ => {}
                }
            }
            State::Escape => {
                self.state = State::Normal;
                match cp {
                    0x5b => {
                        self.params.clear();
                        self.private = 0;
                        self.state = State::Csi
                    }
                    0x5d => self.state = State::Osc,
                    0x50 | 0x58 | 0x5e | 0x5f => self.state = State::Str,
                    0x28 | 0x29 | 0x2a | 0x2b | 0x2d | 0x2e => {
                        self.charset = if cp == 0x28 {
                            Some(0)
                        } else if cp == 0x29 {
                            Some(1)
                        } else {
                            None
                        };
                        self.state = State::Charset
                    }
                    0x23 => self.state = State::Hash,
                    0x37 => self.save(),
                    0x38 => self.restore(),
                    0x44 => self.newline(),
                    0x45 => {
                        self.x = 0;
                        self.newline()
                    }
                    0x4d => {
                        if self.y == self.top {
                            self.scroll(1, false)
                        } else {
                            self.y = self.y.saturating_sub(1)
                        }
                    }
                    0x48 => self.tabs[self.x] = true,
                    0x63 => {
                        self.screen = (0..self.rows).map(|_| self.row()).collect();
                        self.x = 0;
                        self.y = 0;
                        self.top = 0;
                        self.bottom = self.rows - 1;
                        self.reset_modes();
                        self.save()
                    }
                    _ => {}
                }
            }
            State::Csi => {
                if (0x40..=0x7e).contains(&cp) {
                    self.csi(cp)?;
                    self.state = State::Normal
                } else if matches!(cp, 0x3f | 0x21 | 0x3e | 0x20) {
                    self.private = cp
                } else if matches!(cp, 0x30..=0x3b) {
                    if self.params.len() >= 8192 {
                        self.params.clear();
                        self.state = State::Normal;
                        return Err("Terminal CSI exceeds parameter budget.".into());
                    }
                    self.params.push(char::from_u32(cp).unwrap())
                }
            }
            State::Osc | State::Str => {
                if cp == 0x9c || self.state == State::Osc && cp == 7 {
                    self.state = State::Normal
                } else if cp == 0x1b {
                    self.string_state = self.state;
                    self.state = State::StringEscape
                }
            }
            State::StringEscape => {
                self.state = if cp == 0x5c {
                    State::Normal
                } else {
                    self.string_state
                }
            }
            State::Charset => {
                if let Some(target) = self.charset.take() {
                    self.graphics[target] = cp == 0x30
                }
                self.state = State::Normal
            }
            State::Hash => {
                if cp == 0x38 {
                    for y in 0..self.rows {
                        for x in 0..self.cols {
                            self.set(y, x, &[69], 1)
                        }
                    }
                    self.x = 0;
                    self.y = 0
                }
                self.state = State::Normal
            }
        }
        Ok(())
    }
    fn csi(&mut self, final_byte: u32) -> Result<(), String> {
        let mut params = vec![];
        if !self.params.is_empty() {
            for segment in self.params.split(';') {
                let mut values = segment
                    .split(':')
                    .map(|p| {
                        p.parse::<u32>()
                            .unwrap_or(if p.is_empty() { 0 } else { u32::MAX })
                    })
                    .collect::<Vec<_>>();
                if values.len() == 6 && matches!(values[0], 38 | 48) && values[1] == 2 {
                    values.remove(2);
                }
                params.extend(values);
            }
        }
        let p0 = params.first().copied().unwrap_or(0) as usize;
        let p1 = params.get(1).copied().unwrap_or(0) as usize;
        let n = p0.max(1);
        let f = final_byte as u8 as char;
        if self.private == 0x3f {
            if f == 'h' || f == 'l' {
                let on = f == 'h';
                if params.contains(&7) {
                    self.auto_wrap = on
                }
                if params.contains(&6) {
                    self.origin = on;
                    self.x = 0;
                    self.y = if on { self.top } else { 0 }
                }
                if params.contains(&1049) {
                    if on {
                        let screen = std::mem::take(&mut self.screen);
                        self.primary = Some(Primary {
                            rows: screen,
                            x: self.x,
                            y: self.y,
                            pending: self.pending,
                            style: self.style.clone(),
                        });
                        self.screen = (0..self.rows).map(|_| self.row()).collect();
                        self.x = 0;
                        self.y = 0;
                        self.pending = false;
                        self.style = Style::default()
                    } else if let Some(primary) = self.primary.take() {
                        self.screen = primary.rows;
                        self.x = primary.x;
                        self.y = primary.y;
                        self.pending = primary.pending;
                        self.style = primary.style;
                        self.resize(self.cols, self.rows)?
                    }
                }
            }
            return Ok(());
        }
        if (f == 'h' || f == 'l') && params.contains(&4) {
            self.insert = f == 'h';
            return Ok(());
        }
        match f {
            'A' => self.y = self.y.saturating_sub(n),
            'B' | 'e' => self.y = self.y.saturating_add(n).min(self.rows - 1),
            'C' | 'a' => self.x = self.x.saturating_add(n).min(self.cols - 1),
            'D' => self.x = self.x.saturating_sub(n),
            'E' => {
                self.y = self.y.saturating_add(n).min(self.rows - 1);
                self.x = 0
            }
            'F' => {
                self.y = self.y.saturating_sub(n);
                self.x = 0
            }
            'G' | '`' => self.x = (n - 1).min(self.cols - 1),
            'H' | 'f' => {
                self.pending = false;
                self.y = if self.origin {
                    self.top.saturating_add(n - 1).clamp(self.top, self.bottom)
                } else {
                    (n - 1).min(self.rows - 1)
                };
                self.x = (p1.max(1) - 1).min(self.cols - 1)
            }
            'I' => {
                for _ in 0..n.min(self.cols) {
                    self.x = ((self.x / 8 + 1) * 8).min(self.cols - 1)
                }
            }
            'J' => match p0 {
                0 => {
                    self.erase(self.y, self.x, self.cols - 1);
                    for y in self.y + 1..self.rows {
                        self.erase(y, 0, self.cols - 1)
                    }
                }
                1 => {
                    for y in 0..self.y {
                        self.erase(y, 0, self.cols - 1)
                    }
                    self.erase(self.y, 0, self.x)
                }
                2 => {
                    for y in 0..self.rows {
                        self.erase(y, 0, self.cols - 1)
                    }
                }
                _ => {}
            },
            'K' => match p0 {
                0 => self.erase(self.y, self.x, self.cols - 1),
                1 => self.erase(self.y, 0, self.x),
                2 => self.erase(self.y, 0, self.cols - 1),
                _ => {}
            },
            'X' => self.erase(self.y, self.x, self.x.saturating_add(n - 1)),
            'L' | 'M' => {
                if self.y >= self.top && self.y <= self.bottom {
                    for _ in 0..n.min(self.bottom - self.y + 1) {
                        let row = self.row();
                        if f == 'L' {
                            self.screen.remove(self.bottom);
                            self.screen.insert(self.y, row);
                        } else {
                            self.screen.remove(self.y);
                            self.screen.insert(self.bottom, row);
                        }
                    }
                }
            }
            'P' | '@' => {
                let row = &mut self.screen[self.y].cells;
                if self.x > 0 && row[self.x - 1].as_ref().is_some_and(|c| c.width == 2) {
                    row[self.x - 1] = None
                }
                if f == 'P' {
                    row.drain(self.x..self.x + n.min(self.cols - self.x));
                    row.resize(self.cols, None);
                } else {
                    for _ in 0..n.min(self.cols) {
                        row.insert(self.x, None);
                    }
                    row.truncate(self.cols);
                    if row[self.cols - 1].as_ref().is_some_and(|c| c.width == 2) {
                        row[self.cols - 1] = None
                    }
                }
            }
            'S' => self.scroll(n, true),
            'T' if params.len() <= 1 => self.scroll(n, false),
            'Z' => {
                for _ in 0..n.min(self.cols) {
                    self.x = self.x.div_ceil(8).saturating_sub(1) * 8
                }
            }
            'b' => {
                if let Some(ch) = self.last.clone() {
                    if n > self.cols * self.rows {
                        return Err("Terminal repeat exceeds display budget.".into());
                    }
                    let cp = char::decode_utf16(ch.iter().copied())
                        .next()
                        .and_then(Result::ok)
                        .map_or(u32::from(ch[0]), |c| c as u32);
                    for _ in 0..n {
                        self.printable(&ch, cp)?
                    }
                }
            }
            'd' => self.y = (n - 1).min(self.rows - 1),
            'r' => {
                let top = (n - 1).min(self.rows - 1);
                let bottom = (if p1 == 0 { self.rows } else { p1 })
                    .saturating_sub(1)
                    .min(self.rows - 1);
                if top < bottom {
                    self.top = top;
                    self.bottom = bottom
                }
                self.x = 0;
                self.y = if self.origin { self.top } else { 0 }
            }
            's' => self.save(),
            'u' => self.restore(),
            'p' if self.private == 0x21 => self.reset_modes(),
            'm' => self.style.apply(&params),
            _ => {}
        }
        Ok(())
    }
}
