use process_runner_rust::workspace_state::State;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
struct MeasuredAllocator;
static MEASURE: AtomicBool = AtomicBool::new(false);
static BYTES: AtomicUsize = AtomicUsize::new(0);
// The wrapper delegates every allocation/deallocation to System unchanged.
unsafe impl GlobalAlloc for MeasuredAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if MEASURE.load(Ordering::Relaxed) {
            BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        }
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }
}
#[global_allocator]
static ALLOCATOR: MeasuredAllocator = MeasuredAllocator;
#[test]
fn hashing_large_payloads_does_not_allocate_a_second_payload_copy() {
    let content = vec![42u8; 8 * 1024 * 1024];
    let mut state = State::default();
    BYTES.store(0, Ordering::SeqCst);
    MEASURE.store(true, Ordering::SeqCst);
    let accepted = state.admit(&[97], &content, f64::INFINITY);
    MEASURE.store(false, Ordering::SeqCst);
    assert!(accepted);
    let allocated = BYTES.load(Ordering::SeqCst);
    assert!(
        allocated < 32 * 1024,
        "8MiB hashing allocated {allocated} bytes"
    );
}
