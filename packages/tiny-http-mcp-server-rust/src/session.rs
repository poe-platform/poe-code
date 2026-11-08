//! Ordered retention of opaque session payloads, independent of Node and Python.
use std::collections::{BTreeMap, HashMap};
pub struct SessionTable<T> {
    values: HashMap<Vec<u16>, (u64, T)>,
    order: BTreeMap<u64, Vec<u16>>,
    sequence: u64,
}
impl<T> Default for SessionTable<T> {
    fn default() -> Self {
        Self {
            values: HashMap::new(),
            order: BTreeMap::new(),
            sequence: 0,
        }
    }
}
impl<T> SessionTable<T> {
    pub fn insert(&mut self, key: Vec<u16>, value: T) -> Result<Option<T>, &'static str> {
        if let Some((_, stored)) = self.values.get_mut(&key) {
            return Ok(Some(std::mem::replace(stored, value)));
        }
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or("Session sequence exhausted")?;
        self.sequence = sequence;
        self.order.insert(sequence, key.clone());
        self.values.insert(key, (sequence, value));
        Ok(None)
    }
    pub fn get(&self, key: &[u16]) -> Option<&T> {
        self.values.get(key).map(|(_, v)| v)
    }
    pub fn remove(&mut self, key: &[u16]) -> Option<T> {
        let (sequence, value) = self.values.remove(key)?;
        self.order.remove(&sequence);
        Some(value)
    }
    pub fn next_after(&self, sequence: Option<u64>) -> Option<(u64, &T)> {
        use std::ops::Bound::{Excluded, Unbounded};
        let (sequence, key) = self
            .order
            .range((sequence.map_or(Unbounded, Excluded), Unbounded))
            .next()?;
        self.values.get(key).map(|(_, value)| (*sequence, value))
    }
    pub fn len(&self) -> usize {
        self.values.len()
    }
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }
    pub fn index_len(&self) -> usize {
        self.order.len()
    }
    pub fn into_values(self) -> impl Iterator<Item = T> {
        self.values.into_values().map(|(_, v)| v)
    }
}
