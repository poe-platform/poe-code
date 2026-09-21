//! Caller-owned acknowledgement identity; callbacks and arbitrary results stay in the host.
use std::collections::{BTreeSet, HashMap};
#[derive(Default)]
pub struct Pending {
    names: HashMap<Vec<u16>, usize>,
    order: BTreeSet<usize>,
    next: usize,
    units: usize,
}
impl Pending {
    pub fn insert(&mut self, id: Vec<u16>) -> Result<Option<usize>, &'static str> {
        if self.names.contains_key(&id) {
            return Ok(None);
        }
        if self.names.len() >= 4096 || id.len() > 1048576 - self.units {
            return Err("Pending tool acknowledgements exceed the native limit.");
        }
        let index = self.next;
        self.next = self
            .next
            .checked_add(1)
            .ok_or("Tool acknowledgement index overflow.")?;
        self.units += id.len();
        self.names.insert(id, index);
        self.order.insert(index);
        Ok(Some(index))
    }
    pub fn take(&mut self, id: &[u16]) -> Option<usize> {
        let index = self.names.remove(id)?;
        self.units -= id.len();
        self.order.remove(&index);
        if self.names.is_empty() {
            self.next = 0;
        }
        Some(index)
    }
    pub fn drain(&mut self) -> Vec<usize> {
        let indexes = self.order.iter().copied().collect();
        self.names.clear();
        self.order.clear();
        self.next = 0;
        self.units = 0;
        indexes
    }
}
