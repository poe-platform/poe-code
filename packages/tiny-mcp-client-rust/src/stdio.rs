//! Bounded UTF-16 stderr diagnostics shared by process hosts.
use std::collections::VecDeque;
const STDERR_MAX_LENGTH: usize = 65_536;
#[derive(Default)]
pub struct StderrTail {
    units: VecDeque<u16>,
}
impl StderrTail {
    pub fn append(&mut self, chunk: &[u16]) {
        if chunk.len() >= STDERR_MAX_LENGTH {
            self.units.clear();
            self.units
                .extend(chunk[chunk.len() - STDERR_MAX_LENGTH..].iter().copied());
            return;
        }
        let drop = (self.units.len() + chunk.len()).saturating_sub(STDERR_MAX_LENGTH);
        self.units.drain(..drop);
        self.units.extend(chunk.iter().copied());
    }
    pub fn snapshot(&self) -> Vec<u16> {
        self.units.iter().copied().collect()
    }
}
