use std::{
    future::Future,
    task::{Context, Poll, Waker},
};
/// Ready in-memory hosts must finish in one poll; pending I/O has separate tests.
pub fn complete<F: Future>(future: F) -> F::Output {
    match std::pin::pin!(future)
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(output) => output,
        Poll::Pending => panic!("In-memory host unexpectedly suspended"),
    }
}
