//! Bounded per-session replay records with immutable request snapshots.
use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};
#[derive(Clone)]
pub struct Event {
    pub id: u64,
    pub data: Arc<Vec<u16>>,
}
pub struct History {
    limit: usize,
    sessions: HashMap<Vec<u16>, VecDeque<Event>>,
}
impl History {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            sessions: HashMap::new(),
        }
    }
    pub fn record(&mut self, session: Vec<u16>, id: u64, data: Arc<Vec<u16>>) {
        if self.limit == 0 {
            return;
        }
        let events = self.sessions.entry(session).or_default();
        if events.len() == self.limit {
            events.pop_front();
        }
        events.push_back(Event { id, data });
    }
    pub fn replay(&self, session: &[u16], last: u64) -> Vec<Event> {
        self.sessions
            .get(session)
            .map(|events| events.iter().filter(|e| e.id > last).cloned().collect())
            .unwrap_or_default()
    }
    pub fn len(&self, session: &[u16]) -> usize {
        self.sessions.get(session).map_or(0, VecDeque::len)
    }
    pub fn remove(&mut self, session: &[u16]) {
        self.sessions.remove(session);
    }
    pub fn clear(&mut self) {
        self.sessions.clear();
    }
}
