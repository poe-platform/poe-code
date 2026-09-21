//! Terminal column accounting and visible cursor effects over UTF-16 strings.
pub type Text = Vec<u16>;
fn u(s: &str) -> Text {
    s.encode_utf16().collect()
}
fn point(s: &[u16]) -> Option<u32> {
    let first = *s.first()?;
    Some(
        if (0xd800..=0xdbff).contains(&first)
            && s.get(1).is_some_and(|c| (0xdc00..=0xdfff).contains(c))
        {
            0x10000 + ((u32::from(first) - 0xd800) << 10) + u32::from(s[1]) - 0xdc00
        } else {
            u32::from(first)
        },
    )
}
pub fn grapheme_width(s: &[u16]) -> usize {
    let Some(c) = point(s) else {
        return 0;
    };
    if [
        (0x0300, 0x036f),
        (0x1ab0, 0x1aff),
        (0x1dc0, 0x1dff),
        (0x20d0, 0x20ff),
        (0xfe20, 0xfe2f),
    ]
    .into_iter()
    .any(|(a, b)| (a..=b).contains(&c))
    {
        return 0;
    }
    let flag = s.len() == 4
        && (0x1f1e6..=0x1f1ff).contains(&c)
        && point(&s[2..]).is_some_and(|c| (0x1f1e6..=0x1f1ff).contains(&c));
    let wide = c == 0x2329
        || c == 0x232a
        || c == 0x1f004
        || c == 0x1f0cf
        || [
            (0x1100, 0x115f),
            (0x2e80, 0x303e),
            (0x3041, 0x33bf),
            (0x3400, 0x4dbf),
            (0x4e00, 0xa4cf),
            (0xa960, 0xa97f),
            (0xac00, 0xd7af),
            (0xf900, 0xfaff),
            (0xfe10, 0xfe19),
            (0xfe30, 0xfe6f),
            (0xff00, 0xff60),
            (0xffe0, 0xffe6),
            (0x1b000, 0x1b0ff),
            (0x1f200, 0x1fffd),
            (0x20000, 0x2fffd),
            (0x30000, 0x3fffd),
        ]
        .into_iter()
        .any(|(a, b)| (a..=b).contains(&c));
    if wide || flag || s.contains(&0xfe0f) {
        2
    } else {
        1
    }
}
pub fn display_width(segments: &[Text], start: f64) -> f64 {
    let mut column = start;
    for s in segments {
        column += if s == &[9] {
            8. - column % 8.
        } else {
            grapheme_width(s) as f64
        };
    }
    column - start
}
pub fn truncate(segments: &[Text], width: f64) -> Text {
    if width <= 0. {
        return vec![];
    }
    if display_width(segments, 0.) <= width {
        return segments.concat();
    }
    truncate_overflow(segments, width)
}
pub fn truncate_overflow(segments: &[Text], width: f64) -> Text {
    let target = if width.is_nan() {
        f64::NAN
    } else {
        (width - 1.).max(0.)
    };
    let mut result = vec![];
    let mut used = 0.;
    for s in segments {
        let amount = grapheme_width(s) as f64;
        if used + amount > target {
            break;
        }
        result.extend(s);
        used += amount;
    }
    result.push(0x2026);
    result
}
pub fn expand_tabs(segments: &[Text], start: f64) -> Result<Text, &'static str> {
    let mut column = start;
    let mut out = vec![];
    for s in segments {
        if s == &[9] {
            let count = 8. - column % 8.;
            if count.is_infinite() {
                return Err("Invalid count value: Infinity");
            }
            out.extend(std::iter::repeat_n(32, count as usize));
            column += count;
        } else {
            out.extend(s);
            column += grapheme_width(s) as f64;
        }
    }
    Ok(out)
}
fn number(v: &[u16]) -> i64 {
    let v = mcp_protocol_rust::strings::trim_ecmascript(v);
    let mut i = 0;
    let negative = v.first() == Some(&45);
    if negative || v.first() == Some(&43) {
        i += 1;
    }
    let mut n = 0f64;
    while let Some(c) = v.get(i).filter(|c| (48..=57).contains(*c)) {
        n = n * 10. + f64::from(*c - 48);
        i += 1;
    }
    if n.is_finite() {
        (if negative { -n } else { n }) as i64
    } else {
        0
    }
}
fn params(raw: &[u16]) -> Vec<i64> {
    raw.split(|c| *c == 59)
        .flat_map(|part| {
            let mut values = part.split(|c| *c == 58).collect::<Vec<_>>();
            if values.len() > 2 && values[1] == [50] {
                values.remove(2);
            }
            values.into_iter().map(number).collect::<Vec<_>>()
        })
        .collect()
}
struct Row {
    cells: Vec<Option<Text>>,
    column: usize,
    concealed: bool,
}
impl Row {
    fn clear(&mut self, pos: usize) {
        if pos >= self.cells.len() {
            self.cells.resize(pos + 1, None);
        }
        if self.cells[pos].as_ref().is_some_and(Vec::is_empty) && pos > 0 {
            self.cells[pos - 1] = Some(vec![32]);
        }
        if self
            .cells
            .get(pos + 1)
            .and_then(Option::as_ref)
            .is_some_and(Vec::is_empty)
        {
            self.cells[pos + 1] = Some(vec![32]);
        }
        self.cells[pos] = None;
    }
    fn write(&mut self, text: Text) {
        let width = grapheme_width(&text);
        if width == 0 {
            let previous = if self.column > 0
                && self
                    .cells
                    .get(self.column - 1)
                    .and_then(Option::as_ref)
                    .is_some_and(Vec::is_empty)
            {
                self.column.checked_sub(2)
            } else {
                self.column.checked_sub(1)
            };
            if !self.concealed
                && let Some(cell) = previous
                    .and_then(|p| self.cells.get_mut(p))
                    .and_then(Option::as_mut)
            {
                cell.extend(text);
            }
            return;
        }
        self.clear(self.column);
        if width == 2 {
            self.clear(self.column + 1);
        }
        self.cells[self.column] = Some(if self.concealed { vec![32] } else { text });
        if width == 2 {
            self.cells[self.column + 1] = Some(if self.concealed { vec![32] } else { vec![] });
        }
        self.column += width;
    }
    fn take(&mut self) -> Text {
        let text = std::mem::take(&mut self.cells)
            .into_iter()
            .flat_map(|v| v.unwrap_or_else(|| vec![32]))
            .collect();
        self.column = 0;
        text
    }
    fn sgr(&mut self, values: &[i64]) {
        let mut i = 0;
        while i < values.len() {
            match values[i] {
                0 | 28 => self.concealed = false,
                8 => self.concealed = true,
                38 | 48 => match values.get(i + 1) {
                    Some(5) => {
                        i += 3;
                        continue;
                    }
                    Some(2) => {
                        i += 5;
                        continue;
                    }
                    _ => {}
                },
                _ => {}
            }
            i += 1;
        }
    }
}
pub fn plain<E>(
    text: &[u16],
    mut segment: impl FnMut(&[u16]) -> Result<Vec<Text>, E>,
) -> Result<Text, E> {
    if !text
        .iter()
        .any(|c| (*c < 32 && *c != 9) || (127..=159).contains(c))
    {
        return Ok(text.to_vec());
    }
    let text = crate::preview::TerminalStringFilter::default().push(text);
    let mut row = Row {
        cells: vec![],
        column: 0,
        concealed: false,
    };
    let mut lines = vec![];
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        if (c == 27 && text.get(i + 1) == Some(&91)) || c == 155 {
            let start = i + if c == 27 { 2 } else { 1 };
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
            i = end + 1;
            continue;
        }
        match c {
            133 | 10 => lines.push(row.take()),
            27 => {
                i += 2;
                continue;
            }
            13 => row.column = 0,
            8 => row.column = row.column.saturating_sub(1),
            9 => {
                let spaces = 8 - row.column % 8;
                for _ in 0..spaces {
                    if row.cells.get(row.column).is_none_or(Option::is_none) {
                        row.write(vec![32]);
                    } else {
                        row.column += 1;
                    }
                }
            }
            0..=31 | 127..=159 => {}
            _ => {
                let start = i;
                i += 1;
                while i < text.len() && text[i] >= 32 && !(127..=159).contains(&text[i]) {
                    i += 1;
                }
                for value in segment(&text[start..i])? {
                    row.write(value);
                }
                continue;
            }
        }
        i += 1;
    }
    lines.push(row.take());
    let mut result = vec![];
    for (i, line) in lines.into_iter().enumerate() {
        if i > 0 {
            result.push(32);
        }
        result.extend(line);
    }
    Ok(result)
}
pub fn plan<E>(
    length: usize,
    mut read: impl FnMut(usize, bool) -> Result<Text, E>,
    mut segment: impl FnMut(&[u16]) -> Result<Vec<Text>, E>,
) -> Result<(Text, Option<Text>), E> {
    if length == 0 {
        return Ok((u("Agent checklist cleared"), None));
    }
    let mut completed = 0;
    for i in 0..length {
        if read(i, false)? == u("completed") {
            completed += 1;
        }
    }
    let mut active = None;
    for i in 0..length {
        if read(i, false)? == u("in_progress") {
            active = Some(i);
            break;
        }
    }
    let mut pending = None;
    for i in 0..length {
        if read(i, false)? == u("pending") {
            pending = Some(i);
            break;
        }
    }
    let focus = active.or(pending).unwrap_or(length);
    let start = focus.saturating_sub(1).min(length.saturating_sub(5));
    let end = length.min(start + 5);
    let heading = u(&format!("Agent checklist · {completed}/{length}"));
    let mut lines = vec![heading.clone()];
    let mut full = vec![heading];
    if start > 0 {
        lines.push(u(&format!(
            "  ↑ {start} earlier step{}",
            if start == 1 { "" } else { "s" }
        )));
    }
    let mut shortened = start > 0 || end < length;
    for index in 0..length {
        let status = read(index, false)?;
        let marker = if status == u("completed") {
            "✓"
        } else if status == u("in_progress") {
            "›"
        } else if status == u("pending") {
            "○"
        } else {
            "undefined"
        };
        let content = plain(&read(index, true)?, &mut segment)?;
        let prefix = u(&format!("  {marker} "));
        full.push([prefix.clone(), content.clone()].concat());
        if index < start || index >= end {
            continue;
        }
        let preview = if display_width(&segment(&content)?, 0.) <= 100. {
            content.clone()
        } else {
            truncate_overflow(&segment(&content)?, 100.)
        };
        shortened |= preview != content;
        lines.push([prefix, preview].concat());
    }
    if end < length {
        let count = length - end;
        lines.push(u(&format!(
            "  ↓ {count} more step{} · d Details",
            if count == 1 { "" } else { "s" }
        )));
    }
    let join = |values: Vec<Text>| {
        let mut result = vec![];
        for (i, line) in values.into_iter().enumerate() {
            if i > 0 {
                result.push(10);
            }
            result.extend(line);
        }
        result
    };
    Ok((join(lines), shortened.then(|| join(full))))
}
