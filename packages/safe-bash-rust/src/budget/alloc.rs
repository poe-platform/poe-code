use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Debug, Default)]
pub struct AllocationGuard {
    allocated_bytes: AtomicUsize,
    max_bytes: usize,
}

impl AllocationGuard {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            allocated_bytes: AtomicUsize::new(0),
            max_bytes,
        }
    }

    pub fn try_reserve(&self, bytes: usize) -> Result<(), String> {
        if self.max_bytes == 0 {
            return Ok(());
        }
        let mut current = self.allocated_bytes.load(Ordering::Relaxed);
        loop {
            let next = current.saturating_add(bytes);
            if next > self.max_bytes {
                return Err(format!(
                    "Memory budget exceeded: requested {bytes} bytes (limit {} bytes)",
                    self.max_bytes
                ));
            }
            match self.allocated_bytes.compare_exchange_weak(
                current,
                next,
                Ordering::SeqCst,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(()),
                Err(actual) => current = actual,
            }
        }
    }

    pub fn release(&self, bytes: usize) {
        self.allocated_bytes.fetch_sub(
            bytes.min(self.allocated_bytes.load(Ordering::Relaxed)),
            Ordering::Relaxed,
        );
    }

    pub fn current_bytes(&self) -> usize {
        self.allocated_bytes.load(Ordering::Relaxed)
    }
}
