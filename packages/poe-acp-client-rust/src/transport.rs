use std::collections::VecDeque;
#[derive(Default)]
enum Phase {
    #[default]
    Live,
    TermEffect,
    TermWait(f64),
    KillEffect,
    KillWait(f64),
    Closed,
}
#[derive(Default)]
pub struct Transport {
    phase: Phase,
    stderr: VecDeque<u16>,
}
#[derive(Debug, PartialEq)]
pub enum Step {
    None,
    Wait(f64),
    Kill,
    Close,
    ForceClose,
}
impl Transport {
    pub fn closed(&self) -> bool {
        matches!(self.phase, Phase::Closed)
    }
    pub fn disposing(&self) -> bool {
        !matches!(self.phase, Phase::Live)
    }
    pub fn stderr(&mut self, chunk: &[u16]) {
        for unit in chunk {
            if self.stderr.len() == 65536 {
                self.stderr.pop_front();
            }
            self.stderr.push_back(*unit);
        }
    }
    pub fn stderr_output(&self) -> Vec<u16> {
        self.stderr.iter().copied().collect()
    }
    pub fn begin_dispose(&mut self) -> bool {
        if !matches!(self.phase, Phase::Live) {
            return false;
        }
        self.phase = Phase::TermEffect;
        true
    }
    pub fn signal_result(&mut self, accepted: bool, now: f64) -> Step {
        if self.closed() {
            return Step::None;
        }
        if !accepted {
            return Step::Close;
        }
        match self.phase {
            Phase::TermEffect => self.phase = Phase::TermWait(now + 1000.0),
            Phase::KillEffect => self.phase = Phase::KillWait(now + 1000.0),
            _ => return Step::None,
        };
        Step::Wait(1000.0)
    }
    pub fn step(&mut self, now: f64) -> Step {
        match self.phase {
            Phase::TermWait(deadline) if now >= deadline => {
                self.phase = Phase::KillEffect;
                Step::Kill
            }
            Phase::KillWait(deadline) if now >= deadline => Step::ForceClose,
            Phase::TermWait(deadline) | Phase::KillWait(deadline) => Step::Wait(deadline - now),
            _ => Step::None,
        }
    }
    pub fn close(&mut self) -> bool {
        if self.closed() {
            return false;
        }
        self.phase = Phase::Closed;
        true
    }
}
