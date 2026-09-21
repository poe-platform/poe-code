//! Run admission and FIFO event ownership. Host promises and callbacks stay outside the core.
use std::collections::VecDeque;

#[derive(Debug, PartialEq, Eq)]
pub enum Push<T, R> {
    Buffered,
    Deliver { waiter: R, item: T },
    Discard(T),
}
#[derive(Debug, PartialEq, Eq)]
pub enum Next<T> {
    Item(T),
    Wait,
    Closed,
}
pub struct EventQueue<T, R> {
    items: VecDeque<T>,
    waiters: VecDeque<R>,
    closed: bool,
}
impl<T, R> Default for EventQueue<T, R> {
    fn default() -> Self {
        Self {
            items: VecDeque::new(),
            waiters: VecDeque::new(),
            closed: false,
        }
    }
}
impl<T, R> EventQueue<T, R> {
    pub fn push(&mut self, item: T) -> Push<T, R> {
        if self.closed {
            return Push::Discard(item);
        }
        if let Some(waiter) = self.waiters.pop_front() {
            return Push::Deliver { waiter, item };
        }
        self.items.push_back(item);
        Push::Buffered
    }
    pub fn take(&mut self) -> Next<T> {
        if let Some(item) = self.items.pop_front() {
            return Next::Item(item);
        }
        if self.closed {
            Next::Closed
        } else {
            Next::Wait
        }
    }
    pub fn wait(&mut self, waiter: R) {
        self.waiters.push_back(waiter);
    }
    pub fn close(&mut self) -> Vec<R> {
        if self.closed {
            return Vec::new();
        }
        self.closed = true;
        self.waiters.drain(..).collect()
    }
}
#[derive(Default)]
pub struct RunState {
    terminal: bool,
    stop_started: bool,
    disposed: bool,
    iteration: f64,
}
impl RunState {
    pub fn accept_event(&self) -> bool {
        !self.terminal
    }
    pub fn accept_terminal(&mut self) -> bool {
        if self.terminal {
            return false;
        }
        self.terminal = true;
        true
    }
    pub fn start_stop(&mut self) {
        self.stop_started = true;
    }
    pub fn stop_started(&self) -> bool {
        self.stop_started
    }
    pub fn disposed(&self) -> bool {
        self.disposed
    }
    pub fn finish_disposal(&mut self) {
        self.disposed = true;
    }
    pub fn next_iteration(&mut self, maximum: Option<f64>) -> Result<f64, IterationLimit> {
        self.iteration += 1.0;
        if maximum.is_some_and(|maximum| self.iteration > maximum) {
            return Err(IterationLimit);
        }
        Ok(self.iteration)
    }
    pub fn iteration(&self) -> f64 {
        self.iteration
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct IterationLimit;
#[derive(Debug, PartialEq, Eq)]
pub enum StopFailure {
    Model,
    TokenLimit,
}
impl StopFailure {
    pub fn classify(reason: &str) -> Option<Self> {
        match reason {
            "error" => Some(Self::Model),
            "max_tokens" => Some(Self::TokenLimit),
            _ => None,
        }
    }
    pub fn message(&self) -> &'static str {
        match self {
            Self::Model => "Model response failed.",
            Self::TokenLimit => "Model response exceeded the maximum token limit.",
        }
    }
}
