//! Driver lifecycle and finite terminal geometry.
#[derive(Default)]
pub struct TerminalDriver {
    started: bool,
}
impl TerminalDriver {
    pub fn start(&mut self) -> bool {
        !std::mem::replace(&mut self.started, true)
    }
    pub fn stop(&mut self) -> bool {
        std::mem::replace(&mut self.started, false)
    }
}
pub fn dimension(value: f64) -> f64 {
    if !value.is_finite() || value <= 0. {
        0.
    } else {
        value.floor()
    }
}
