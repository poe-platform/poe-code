#[derive(Default)]
pub struct LineBuffer {
    buffer: Vec<u16>,
    ended: bool,
}
impl LineBuffer {
    pub fn push(&mut self, chunk: &[u16]) -> Vec<Vec<u16>> {
        if self.ended {
            return vec![];
        }
        let old = self.buffer.len();
        self.buffer.extend_from_slice(chunk);
        let mut start = 0;
        let mut result = vec![];
        for index in old..self.buffer.len() {
            if self.buffer[index] == 10 {
                result.push(self.buffer[start..index].to_vec());
                start = index + 1;
            }
        }
        if start == self.buffer.len() {
            self.buffer = vec![];
        } else if start > 0 {
            let remaining = self.buffer.len() - start;
            if self.buffer.capacity() > remaining.saturating_mul(4).max(4096) {
                self.buffer = self.buffer[start..].to_vec();
            } else {
                self.buffer.drain(..start);
            }
        }
        result
    }
    pub fn end(&mut self) -> Option<Vec<u16>> {
        self.ended = true;
        let remaining = std::mem::take(&mut self.buffer);
        if remaining.is_empty() {
            None
        } else {
            Some(remaining)
        }
    }
    pub fn retained_capacity(&self) -> usize {
        self.buffer.capacity()
    }
}
#[derive(Default)]
pub struct Dispatch {
    last: Option<usize>,
}
impl Dispatch {
    pub fn enter(&mut self, position: usize, count: usize) -> Result<bool, String> {
        if self.last.is_some_and(|last| position <= last) {
            return Err("next() called multiple times".into());
        }
        self.last = Some(position);
        Ok(position != count)
    }
}
pub fn validate_callback(position: usize, callable: bool) -> Result<(), String> {
    if !callable {
        Err(format!("Invalid ACP middleware at index {position}"))
    } else {
        Ok(())
    }
}
