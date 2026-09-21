//! Disposal registration ownership, reverse attempts and failed-hook retirement.
#[derive(Default)]
pub struct Disposal {
    handles: Vec<u32>,
}
impl Disposal {
    pub fn add(&mut self, handle: u32) {
        self.handles.push(handle);
    }
    pub fn snapshot(&self) -> Vec<u32> {
        self.handles.clone()
    }
    pub fn attempts(&self) -> Vec<u32> {
        self.handles.iter().rev().copied().collect()
    }
    pub fn retain_failed(&mut self, mut failures: Vec<u32>) {
        failures.reverse();
        self.handles = failures;
    }
    pub fn clear(&mut self) {
        self.handles.clear();
    }
}
