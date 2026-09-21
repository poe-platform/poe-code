//! Live prompt callback ordering without host callback ownership.
#[derive(Default)]
pub struct Order {
    handles: Vec<u32>,
}
impl Order {
    pub fn add(&mut self, handle: u32) {
        self.handles.push(handle);
    }
    pub fn get(&self, index: usize) -> Option<u32> {
        self.handles.get(index).copied()
    }
    pub fn snapshot(&self) -> Vec<u32> {
        self.handles.clone()
    }
    pub fn append(&mut self, handles: Vec<u32>, offset: u32) -> Result<(), &'static str> {
        let adjusted = handles
            .into_iter()
            .map(|handle| handle.checked_add(offset).ok_or("Prompt handle overflow."))
            .collect::<Result<Vec<_>, _>>()?;
        self.handles.extend(adjusted);
        Ok(())
    }
}
