//! Per-resource transaction ticket policy; hosts own asynchronous effects.
use std::collections::{HashMap, VecDeque};
pub fn timeout(value: f64) -> Result<u32, &'static str> {
    if value.is_finite() && value.fract() == 0.0 && (1.0..=2_147_483_647.0).contains(&value) {
        Ok(value as u32)
    } else {
        Err("sessionLockTimeoutMs must be an integer from 1 to 2147483647 milliseconds")
    }
}
pub struct Ticket {
    pub id: u32,
    pub previous: Option<u32>,
}
#[derive(Default)]
pub struct Queue {
    next: u32,
    resources: HashMap<Vec<u16>, VecDeque<u32>>,
}
impl Queue {
    pub fn enqueue(&mut self, resource: &[u16]) -> Result<Ticket, &'static str> {
        if self.resources.is_empty() {
            self.next = 0;
        }
        self.next = self
            .next
            .checked_add(1)
            .ok_or("OAuth transaction ticket capacity exceeded")?;
        let queue = self.resources.entry(resource.to_vec()).or_default();
        let ticket = Ticket {
            id: self.next,
            previous: queue.back().copied(),
        };
        queue.push_back(ticket.id);
        Ok(ticket)
    }
    pub fn retire(&mut self, resource: &[u16], id: u32) -> bool {
        let Some(queue) = self.resources.get_mut(resource) else {
            return false;
        };
        let old = queue.len();
        queue.retain(|ticket| *ticket != id);
        let retired = old != queue.len();
        if queue.is_empty() {
            self.resources.remove(resource);
        }
        retired
    }
    pub fn resources(&self) -> usize {
        self.resources.len()
    }
}
