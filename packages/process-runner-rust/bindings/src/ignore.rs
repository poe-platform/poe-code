use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi]
pub struct DockerIgnore {
    matcher: process_runner_rust::ignore::DockerIgnore,
}
#[napi]
impl DockerIgnore {
    #[napi(constructor)]
    pub fn new(source: Utf16String) -> Self {
        Self {
            matcher: process_runner_rust::ignore::DockerIgnore::new(&source),
        }
    }
    #[napi]
    pub fn ignores(&self, path: Utf16String, directory: bool) -> bool {
        self.matcher.ignores(&path, directory)
    }
}
