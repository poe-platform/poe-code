//! Live migration search and rate policy; callers retain effects and timers.
use std::collections::{HashSet, VecDeque};
type Frame = (Vec<u16>, Vec<Vec<u16>>);
pub struct Search {
    queue: VecDeque<Frame>,
    visited: HashSet<Vec<u16>>,
    queue_units: usize,
    visited_units: usize,
}
const MAX_SEARCH_UNITS: usize = 1_048_576;
const MAX_SEARCH_ENTRIES: usize = 65_536;
const SEARCH_BUDGET_ERROR: &str = "Task migration search resource budget exceeded.";
fn frame_units(state: &[u16], events: &[Vec<u16>]) -> usize {
    state.len().saturating_add(
        events
            .iter()
            .map(|event| event.len().max(1))
            .fold(0usize, usize::saturating_add),
    )
}
impl Search {
    pub fn new(initial: Vec<u16>) -> Result<Self, &'static str> {
        let units = initial.len();
        if units.saturating_mul(2) > MAX_SEARCH_UNITS {
            return Err(SEARCH_BUDGET_ERROR);
        }
        Ok(Self {
            queue: VecDeque::from([(initial.clone(), vec![])]),
            visited: HashSet::from([initial]),
            queue_units: units,
            visited_units: units,
        })
    }
    pub fn has(&self, state: &[u16]) -> bool {
        self.visited.contains(state)
    }
    pub fn mark(&mut self, state: Vec<u16>) -> Result<(), &'static str> {
        if self.has(&state) {
            return Ok(());
        }
        let units = self.visited_units.saturating_add(state.len());
        if self.visited.len() >= MAX_SEARCH_ENTRIES
            || units.saturating_add(self.queue_units) > MAX_SEARCH_UNITS
        {
            return Err(SEARCH_BUDGET_ERROR);
        }
        self.visited_units = units;
        self.visited.insert(state);
        Ok(())
    }
    pub fn push(&mut self, state: Vec<u16>, events: Vec<Vec<u16>>) -> Result<(), &'static str> {
        let units = self
            .queue_units
            .saturating_add(frame_units(&state, &events));
        if self.queue.len() >= MAX_SEARCH_ENTRIES
            || units.saturating_add(self.visited_units) > MAX_SEARCH_UNITS
        {
            return Err(SEARCH_BUDGET_ERROR);
        }
        self.queue_units = units;
        self.queue.push_back((state, events));
        Ok(())
    }
}
impl Iterator for Search {
    type Item = Frame;
    fn next(&mut self) -> Option<Frame> {
        let frame = self.queue.pop_front()?;
        self.queue_units -= frame_units(&frame.0, &frame.1);
        Some(frame)
    }
}
pub struct TokenBucket {
    capacity: f64,
    interval_ms: f64,
    tokens: f64,
    last_refill: f64,
}
impl TokenBucket {
    pub fn new(rate: f64, now: f64) -> Result<Self, &'static str> {
        if !rate.is_finite() || rate <= 0.0 {
            return Err("moveTasks rate must be a positive number.");
        }
        let capacity = rate.max(1.0);
        Ok(Self {
            capacity,
            interval_ms: 60_000.0 / rate,
            tokens: capacity,
            last_refill: now,
        })
    }
    /// None admits one operation; Some gives a host timer delay in milliseconds.
    pub fn take(&mut self, now: f64) -> Option<f64> {
        let refill = self.tokens + (now - self.last_refill) / self.interval_ms;
        self.tokens = if refill.is_nan() {
            f64::NAN
        } else {
            self.capacity.min(refill)
        };
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            None
        } else {
            Some(((1.0 - self.tokens) * self.interval_ms).ceil())
        }
    }
}
