//! Transactional line framing; no host callbacks run while state is borrowed.
use crate::preview::{MAX_CHARS, NOTICE, TerminalStringFilter, limit, retain_tail};
#[derive(Default)]
pub struct LineBuffer {
    pending: Vec<u16>,
    omitted: bool,
    strings: TerminalStringFilter,
}
impl LineBuffer {
    pub fn prepare(&mut self, chunk: &[u16]) -> (Vec<Vec<u16>>, Vec<u16>) {
        let mut text = self.pending.clone();
        text.extend(self.strings.push(chunk));
        let mut start = 0;
        let mut lines = Vec::new();
        for (index, unit) in text.iter().enumerate() {
            if *unit == 10 {
                let mut end = index;
                if end > start && text[end - 1] == 13 {
                    end -= 1;
                }
                lines.push(text[start..end].to_vec());
                start = index + 1;
            }
        }
        (lines, text[start..].to_vec())
    }
    pub fn line(&self, raw: &[u16]) -> Vec<u16> {
        let mut text = Vec::new();
        if self.omitted {
            text.extend(NOTICE.encode_utf16());
        }
        text.extend(raw);
        limit(&text)
    }
    pub fn line_emitted(&mut self) {
        self.omitted = false;
    }
    pub fn finish(&mut self, remaining: &[u16]) {
        if remaining.len() > MAX_CHARS {
            self.omitted = true;
        }
        let budget = MAX_CHARS
            - if self.omitted {
                NOTICE.encode_utf16().count()
            } else {
                0
            };
        self.pending = retain_tail(remaining, budget as f64);
    }
    pub fn preview(&self) -> Vec<u16> {
        let end = self.pending.len() - usize::from(self.pending.last() == Some(&13));
        let mut text = Vec::new();
        if self.omitted {
            text.extend(NOTICE.encode_utf16());
        }
        text.extend(&self.pending[..end]);
        text
    }
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }
    pub fn reset_pending(&mut self) {
        self.pending.clear();
        self.omitted = false;
    }
}
