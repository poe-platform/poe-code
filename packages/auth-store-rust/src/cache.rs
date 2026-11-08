//! Bounded retention for completed machine-bound encryption keys.
use std::collections::VecDeque;
const KEY_CACHE_CAPACITY: usize = 64;
const MAX_CACHE_KEY_UNITS: usize = 16_384;
#[derive(Default)]
pub struct DerivedKeyCache {
    entries: VecDeque<(Vec<u16>, [u8; 32])>,
}
impl DerivedKeyCache {
    pub fn size(&self) -> usize {
        self.entries.len()
    }
    pub fn lookup(&mut self, key: &[u16]) -> Option<[u8; 32]> {
        let index = self.entries.iter().position(|(stored, _)| stored == key)?;
        let entry = self.entries.remove(index)?;
        let value = entry.1;
        self.entries.push_back(entry);
        Some(value)
    }
    pub fn insert(&mut self, key: &[u16], value: &[u8]) -> Result<(), &'static str> {
        let value: [u8; 32] = value
            .try_into()
            .map_err(|_| "Derived encryption key must contain 32 bytes")?;
        if key.len() > MAX_CACHE_KEY_UNITS {
            return Ok(());
        }
        if let Some(index) = self.entries.iter().position(|(stored, _)| stored == key) {
            self.entries.remove(index);
        }
        if self.entries.len() == KEY_CACHE_CAPACITY {
            self.entries.pop_front();
        }
        self.entries.push_back((key.to_vec(), value));
        Ok(())
    }
}
