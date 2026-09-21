//! Stable native slots for opaque host execution factories.
use std::collections::BTreeMap;
pub const MAX_FACTORIES: usize = 65_536;
#[derive(Default)]
pub struct Registry {
    slots: BTreeMap<Vec<u16>, u32>,
}
impl Registry {
    pub fn register(&mut self, key: Vec<u16>) -> Result<u32, &'static str> {
        if let Some(id) = self.slots.get(&key) {
            return Ok(*id);
        }
        if self.slots.len() == MAX_FACTORIES {
            return Err("Execution factory registry exceeds 65,536 runtime types.");
        }
        let id = self.slots.len() as u32;
        self.slots.insert(key, id);
        Ok(id)
    }
    pub fn get(&self, key: &[u16]) -> Option<u32> {
        self.slots.get(key).copied()
    }
}
