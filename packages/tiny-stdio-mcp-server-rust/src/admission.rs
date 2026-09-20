//! Shared FIFO tool capacity. Cancellation removes waiting work only; running
//! callbacks release their slot when the underlying callback actually settles.
use std::collections::{HashSet, VecDeque};

#[derive(Debug, PartialEq, Eq)]
pub enum Admission {
    Running,
    Queued,
}

pub struct ToolAdmission {
    maximum_active: usize,
    maximum_queued: usize,
    active: HashSet<u64>,
    waiting: VecDeque<u64>,
}

impl ToolAdmission {
    pub fn new(maximum_active: usize, maximum_queued: usize) -> Result<Self, String> {
        if maximum_active == 0 {
            return Err(
                "maxConcurrentToolCalls must be a safe integer greater than or equal to 1.".into(),
            );
        }
        Ok(Self {
            maximum_active,
            maximum_queued,
            active: HashSet::new(),
            waiting: VecDeque::new(),
        })
    }

    pub fn acquire(&mut self, token: u64) -> Result<Admission, String> {
        if self.active.contains(&token) || self.waiting.contains(&token) {
            return Err("Tool request is already admitted".into());
        }
        if self.active.len() < self.maximum_active {
            self.active.insert(token);
            Ok(Admission::Running)
        } else if self.waiting.len() < self.maximum_queued {
            self.waiting.push_back(token);
            Ok(Admission::Queued)
        } else {
            Err("Too many queued tool calls".into())
        }
    }

    pub fn cancel_queued(&mut self, token: u64) -> bool {
        let Some(index) = self.waiting.iter().position(|waiting| *waiting == token) else {
            return false;
        };
        self.waiting.remove(index);
        true
    }

    /// Idempotently release running work and atomically promote the oldest waiter.
    pub fn release(&mut self, token: u64) -> Option<u64> {
        if !self.active.remove(&token) {
            return None;
        }
        let next = self.waiting.pop_front()?;
        self.active.insert(next);
        Some(next)
    }
}
