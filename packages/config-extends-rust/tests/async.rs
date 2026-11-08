//! Manually driven I/O proves that resolution suspends without replaying prior work.
use config_extends_rust::{
    discover,
    resolve::{self, BaseLayer, ChainLayer, DocumentLayer, Host, Options},
};
use std::{
    cell::RefCell,
    future::Future,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[derive(Default)]
struct Io {
    requests: Vec<Vec<u16>>,
    response: Option<Option<Vec<u16>>>,
    waker: Option<Waker>,
}
struct Read {
    io: Rc<RefCell<Io>>,
}
impl Future for Read {
    type Output = Result<Option<Vec<u16>>, &'static str>;
    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let mut io = self.io.borrow_mut();
        if let Some(response) = io.response.take() {
            Poll::Ready(Ok(response))
        } else {
            io.waker = Some(context.waker().clone());
            Poll::Pending
        }
    }
}
struct Files {
    io: Rc<RefCell<Io>>,
}
impl discover::Host for Files {
    type Error = &'static str;
    fn join(&mut self, directory: &[u16], file: &[u16]) -> Vec<u16> {
        let mut output = directory.to_vec();
        output.push(47);
        output.extend(file);
        output
    }
    fn contains(&mut self, directory: &[u16], file: &[u16]) -> bool {
        file.starts_with(directory)
    }
    async fn read(&mut self, file: &[u16]) -> Result<Option<Vec<u16>>, Self::Error> {
        self.io.borrow_mut().requests.push(file.to_vec());
        Read {
            io: self.io.clone(),
        }
        .await
    }
}
impl Host for Files {
    fn resolve(&mut self, path: &[u16]) -> Vec<u16> {
        path.to_vec()
    }
    fn dirname(&mut self, path: &[u16]) -> Vec<u16> {
        path[..path.iter().rposition(|unit| *unit == 47).unwrap()].to_vec()
    }
    fn basename(&mut self, _path: &[u16]) -> Vec<u16> {
        u("review")
    }
    fn extension(&mut self, path: &[u16]) -> Vec<u16> {
        path[path.iter().rposition(|unit| *unit == 46).unwrap()..].to_vec()
    }
    fn is_absolute(&mut self, path: &[u16]) -> bool {
        path.first() == Some(&47)
    }
}
fn response(io: &Rc<RefCell<Io>>, value: Option<&str>) {
    let waker = {
        let mut io = io.borrow_mut();
        io.response = Some(value.map(u));
        io.waker.take()
    };
    if let Some(waker) = waker {
        waker.wake();
    }
}
#[test]
fn resolver_suspends_each_read_once_and_resumes_without_replaying_paths() {
    let io = Rc::new(RefCell::new(Io::default()));
    let mut fs = Files { io: io.clone() };
    let options = Options::default();
    let chain = [
        ChainLayer::Document(DocumentLayer {
            source: u("document"),
            file_path: u("/project/review.md"),
            content: u("---\nextends: true\n---\nDoc({{yield}})"),
            base_name: None,
        }),
        ChainLayer::Base(BaseLayer {
            source: u("base"),
            path: u("/bases"),
        }),
    ];
    let mut future = Box::pin(resolve::resolve(&chain, &options, &mut fs));
    let mut context = Context::from_waker(Waker::noop());
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(io.borrow().requests, [u("/bases/review.md")]);
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(io.borrow().requests.len(), 1);
    response(&io, None);
    assert!(future.as_mut().poll(&mut context).is_pending());
    assert_eq!(
        io.borrow().requests,
        [u("/bases/review.md"), u("/bases/review.yaml")]
    );
    response(&io, Some("prompt: Base"));
    let Poll::Ready(result) = future.as_mut().poll(&mut context) else {
        panic!("Final read resumes resolution")
    };
    assert_eq!(
        result.unwrap().chain,
        [u("/project/review.md"), u("/bases/review.yaml")]
    );
    assert_eq!(io.borrow().requests.len(), 2);
}
#[test]
fn dropping_a_pending_resolver_stops_all_later_reads() {
    let io = Rc::new(RefCell::new(Io::default()));
    let mut fs = Files { io: io.clone() };
    let options = Options::default();
    let chain = [
        ChainLayer::Document(DocumentLayer {
            source: u("document"),
            file_path: u("/project/review.md"),
            content: u("---\nextends: true\n---\nBody"),
            base_name: None,
        }),
        ChainLayer::Base(BaseLayer {
            source: u("base"),
            path: u("/bases"),
        }),
    ];
    let mut future = Box::pin(resolve::resolve(&chain, &options, &mut fs));
    assert!(
        future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending()
    );
    drop(future);
    response(&io, None);
    assert_eq!(io.borrow().requests.len(), 1);
}
