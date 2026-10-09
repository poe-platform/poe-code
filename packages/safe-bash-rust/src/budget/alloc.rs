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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocation_guard_tracks_reservations_and_enforces_limit() {
        let guard = AllocationGuard::new(1024);
        assert_eq!(guard.current_bytes(), 0);

        guard.try_reserve(400).unwrap();
        assert_eq!(guard.current_bytes(), 400);

        guard.try_reserve(624).unwrap();
        assert_eq!(guard.current_bytes(), 1024);

        let err = guard.try_reserve(1).unwrap_err();
        assert!(err.contains("Memory budget exceeded"));
        assert_eq!(guard.current_bytes(), 1024);

        guard.release(500);
        assert_eq!(guard.current_bytes(), 524);

        guard.try_reserve(500).unwrap();
        assert_eq!(guard.current_bytes(), 1024);

        guard.release(2048);
        assert_eq!(guard.current_bytes(), 0);
    }

    #[test]
    fn allocation_guard_unlimited_when_max_bytes_is_zero() {
        let guard = AllocationGuard::new(0);
        guard.try_reserve(10 * 1024 * 1024).unwrap();
        assert_eq!(guard.current_bytes(), 0);
    }

    #[test]
    fn allocation_guard_exact_boundary_and_saturating_release() {
        let guard = AllocationGuard::new(256);
        assert!(guard.try_reserve(256).is_ok());
        assert!(guard.try_reserve(1).is_err());
        guard.release(512);
        assert_eq!(guard.current_bytes(), 0);
    }
}
