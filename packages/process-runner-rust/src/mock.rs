//! Deterministic mock-run admission independent of Node timers and streams.
pub const EXHAUSTED_ERROR: &str = "No mock run behaviors left";
pub const DELAY_ERROR: &str = "Mock run exitAfterMs must be a finite non-negative number.";
pub fn missing_command(command: &[u16]) -> Vec<u16> {
    let mut text = "No mock run behavior found for command \""
        .encode_utf16()
        .collect::<Vec<_>>();
    text.extend(command);
    text.push(34);
    text
}
pub struct Queue {
    next: u32,
    length: u32,
}
impl Queue {
    pub fn new(length: u32) -> Self {
        Self { next: 0, length }
    }
    pub fn next_index(&mut self) -> Option<u32> {
        if self.next == self.length {
            return None;
        }
        let index = self.next;
        self.next += 1;
        Some(index)
    }
}
#[derive(Default)]
pub struct Run {
    finished: bool,
}
impl Run {
    pub fn finish(&mut self) -> bool {
        if self.finished {
            return false;
        }
        self.finished = true;
        true
    }
}
#[derive(Default)]
pub struct Stream {
    stopped: bool,
}
impl Stream {
    pub fn emit(&self) -> bool {
        !self.stopped
    }
    pub fn stop(&mut self) -> bool {
        if self.stopped {
            return false;
        }
        self.stopped = true;
        true
    }
}
#[derive(Debug, PartialEq)]
pub enum Completion {
    Output,
    Microtask,
    Timer(f64),
}
pub fn completion(delay: Option<f64>) -> Result<Completion, &'static str> {
    match delay {
        None => Ok(Completion::Output),
        Some(value) if !value.is_finite() || value < 0.0 => Err(DELAY_ERROR),
        Some(0.0) => Ok(Completion::Microtask),
        Some(value) => Ok(Completion::Timer(value)),
    }
}
