//! Runtime-independent cooperative futures for bounded document work.
use std::future::Future;
use std::pin::pin;
use std::task::{Context, Poll, Waker};

/// Yield once to the caller. The WASM host schedules the next poll, allowing
/// cancellation and other event-loop work between document processing batches.
pub async fn yield_now() {
    let mut yielded = false;
    std::future::poll_fn(move |cx| {
        if yielded {
            Poll::Ready(())
        } else {
            yielded = true;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    })
    .await
}

/// Execute a cooperative document future for synchronous native callers.
/// These futures yield work, but never wait for external IO.
pub fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(result) = future.as_mut().poll(&mut context) {
            return result;
        }
    }
}
