use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::mock;
#[napi]
pub const MOCK_EXHAUSTED_ERROR: &str = mock::EXHAUSTED_ERROR;
#[napi]
pub fn mock_missing_command(command: Utf16String) -> Utf16String {
    mock::missing_command(&command).into()
}
#[napi]
pub fn mock_completion(delay: Option<f64>) -> Result<String> {
    mock::completion(delay)
        .map(|plan| {
            match plan {
                mock::Completion::Output => "output",
                mock::Completion::Microtask => "microtask",
                mock::Completion::Timer(_) => "timer",
            }
            .to_owned()
        })
        .map_err(Error::from_reason)
}
#[napi]
pub struct MockQueue {
    queue: mock::Queue,
}
#[napi]
impl MockQueue {
    #[napi(constructor)]
    pub fn new(length: u32) -> Self {
        Self {
            queue: mock::Queue::new(length),
        }
    }
    #[napi]
    pub fn next_index(&mut self) -> Option<u32> {
        self.queue.next_index()
    }
}
#[napi]
#[derive(Default)]
pub struct MockRun {
    run: mock::Run,
}
#[napi]
impl MockRun {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            run: mock::Run::default(),
        }
    }
    #[napi]
    pub fn finish(&mut self) -> bool {
        self.run.finish()
    }
}
#[napi]
#[derive(Default)]
pub struct MockStream {
    stream: mock::Stream,
}
#[napi]
impl MockStream {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            stream: mock::Stream::default(),
        }
    }
    #[napi]
    pub fn emit(&self) -> bool {
        self.stream.emit()
    }
    #[napi]
    pub fn stop(&mut self) -> bool {
        self.stream.stop()
    }
}
