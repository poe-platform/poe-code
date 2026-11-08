//! Bounded UTF-16 preview ownership and streaming terminal-string filtering.
use std::collections::VecDeque;
pub const MAX_CHARS: usize = 16_384;
pub const NOTICE: &str = "[Output truncated: showing latest text]\n";
pub const CONTROL_STARTS: [u16; 7] = [27, 155, 144, 152, 157, 158, 159];
const MAX_CONTROL: usize = 1024;
#[derive(Default)]
pub struct TerminalStringFilter {
    hidden: bool,
    allow_bell: bool,
    escape: bool,
    csi: Option<Vec<u16>>,
    oversized: bool,
}
impl TerminalStringFilter {
    pub fn active(&self) -> bool {
        self.hidden || self.escape || self.csi.is_some()
    }
    pub fn retained_units(&self) -> usize {
        self.csi.as_ref().map_or(0, Vec::len)
    }
    pub fn push(&mut self, text: &[u16]) -> Vec<u16> {
        if !self.active() && !text.iter().any(|unit| CONTROL_STARTS.contains(unit)) {
            return text.to_vec();
        }
        let mut output = Vec::with_capacity(text.len());
        for &unit in text {
            if matches!(unit, 24 | 26) && self.active() {
                self.hidden = false;
                self.escape = false;
                self.csi = None;
                self.oversized = false;
                continue;
            }
            if let Some(csi) = self.csi.as_mut() {
                if unit == 27 {
                    self.csi = None;
                    self.oversized = false;
                    self.escape = true;
                    continue;
                }
                if !self.oversized {
                    if csi.len() == MAX_CONTROL {
                        self.oversized = true;
                        csi.clear();
                    } else {
                        csi.push(unit);
                    }
                }
                if (64..=126).contains(&unit) {
                    if !self.oversized {
                        output.extend(csi.iter());
                    }
                    self.csi = None;
                    self.oversized = false;
                }
                continue;
            }
            if self.hidden {
                if unit == 156 || self.allow_bell && unit == 7 || self.escape && unit == 92 {
                    self.hidden = false;
                    self.escape = false;
                } else {
                    self.escape = unit == 27;
                }
                continue;
            }
            if self.escape {
                self.escape = false;
                if unit == 91 {
                    self.csi = Some(vec![27, 91]);
                    continue;
                }
                if matches!(unit, 93 | 80 | 88 | 94 | 95) {
                    self.hidden = true;
                    self.allow_bell = unit == 93;
                    continue;
                }
                output.push(27);
            }
            match unit {
                27 => self.escape = true,
                155 => self.csi = Some(vec![155]),
                144 | 152 | 157 | 158 | 159 => {
                    self.hidden = true;
                    self.allow_bell = unit == 157;
                }
                _ => output.push(unit),
            }
        }
        output
    }
}
fn maximum(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}
fn slice_start(value: f64, length: usize) -> usize {
    if value.is_nan() {
        0
    } else {
        (value.max(0.0).trunc() as usize).min(length)
    }
}
fn control_tail_start(text: &[u16], start: f64) -> f64 {
    if !text.iter().any(|unit| matches!(unit, 27 | 155)) {
        return start;
    }
    let mut index = 0;
    while index < text.len() && (index as f64) < start {
        let unit = text[index];
        if !matches!(unit, 27 | 155) {
            index += 1;
            continue;
        }
        let mut end = index + 1;
        if unit == 155 || text.get(end) == Some(&91) {
            if unit == 27 {
                end += 1;
            }
            while end < text.len() && !(64..=126).contains(&text[end]) {
                end += 1;
            }
        }
        if start <= end as f64 {
            return (end + 1).min(text.len()) as f64;
        }
        index = end + 1;
    }
    start
}
pub fn retain_tail(text: &[u16], max_chars: f64) -> Vec<u16> {
    retain_from_start(text, text.len() as f64 - max_chars)
}
pub fn retain_from_start(text: &[u16], start: f64) -> Vec<u16> {
    let mut start = maximum(0.0, start);
    if start > 0.0 {
        let offset = slice_start(start, text.len());
        if let Some(newline) = text[offset..]
            .iter()
            .position(|unit| *unit == 10)
            .map(|index| offset + index)
            && newline < text.len().saturating_sub(1)
        {
            start = (newline + 1) as f64;
        }
        start = control_tail_start(text, start);
        if text
            .get(slice_start(start, text.len()))
            .is_some_and(|unit| (0xdc00..=0xdfff).contains(unit))
        {
            start += 1.0;
        }
    }
    text[slice_start(start, text.len())..].to_vec()
}
pub fn limit(text: &[u16]) -> Vec<u16> {
    let text = TerminalStringFilter::default().push(text);
    if text.len() <= MAX_CHARS {
        return text;
    }
    let mut output: Vec<u16> = NOTICE.encode_utf16().collect();
    output.extend(retain_tail(&text, (MAX_CHARS - output.len()) as f64));
    output
}
#[derive(Default)]
pub struct PreviewBuffer {
    strings: TerminalStringFilter,
    chunks: VecDeque<Vec<u16>>,
    chars: usize,
    omitted: bool,
}
impl PreviewBuffer {
    pub fn retained_units(&self) -> usize {
        self.chars + self.strings.retained_units()
    }
    pub fn push(&mut self, text: &[u16]) {
        let mut text = self.strings.push(text);
        if text.is_empty() {
            return;
        }
        let budget = MAX_CHARS - NOTICE.encode_utf16().count() + 1;
        if text.len() > MAX_CHARS {
            self.chunks.clear();
            self.chars = 0;
            self.omitted = true;
            text = retain_tail(&text, budget as f64);
        }
        self.chars += text.len();
        self.chunks.push_back(text);
        if self.chars > MAX_CHARS {
            self.omitted = true;
        }
        if !self.omitted {
            return;
        }
        while self.chars > budget {
            let first = self.chunks.pop_front().expect("counted preview chunk");
            let excess = self.chars - budget;
            if first.len() <= excess {
                self.chars -= first.len();
            } else {
                let start = slice_start(control_tail_start(&first, excess as f64), first.len());
                self.chars -= start;
                self.chunks.push_front(first[start..].to_vec());
            }
        }
    }
    pub fn text(&self) -> Vec<u16> {
        let mut text = Vec::with_capacity(MAX_CHARS + 1);
        if self.omitted {
            text.extend(NOTICE.encode_utf16());
        }
        for chunk in &self.chunks {
            text.extend(chunk);
        }
        limit(&text)
    }
}
