use super::*;
use agent_skill_config_rust::discovery::{Machine, Request};

fn request(value: Request) -> NativeJson {
    NativeJson(match value {
        Request::Root(path) => object(vec![("kind", text("root")), ("path", J::String(path))]),
        Request::Names(path) => object(vec![("kind", text("names")), ("path", J::String(path))]),
        Request::Child { root, name } => object(vec![
            ("kind", text("child")),
            ("root", J::String(root)),
            ("name", J::String(name)),
        ]),
        Request::FilePath { .. } => object(vec![("kind", text("filePath"))]),
        Request::File(path) => object(vec![("kind", text("file")), ("path", J::String(path))]),
        Request::Read { name, file } => object(vec![
            ("kind", text("read")),
            ("name", J::String(name)),
            ("file", J::String(file)),
        ]),
        Request::Done => object(vec![("kind", text("done"))]),
    })
}
#[napi]
#[derive(Default)]
pub struct SkillDiscoveryMachine {
    state: Machine,
}

#[napi]
impl SkillDiscoveryMachine {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn start(&mut self, root: Utf16String) -> NativeJson {
        request(self.state.start(root.to_vec()))
    }
    #[napi]
    pub fn root(&self, symbolic: bool) -> NativeJson {
        match self.state.root(symbolic) {
            Ok(value) => request(value),
            Err(error) => NativeJson(object(vec![("error", J::String(error))])),
        }
    }
    #[napi]
    pub fn names(&mut self, names: Vec<Utf16String>) -> NativeJson {
        request(
            self.state
                .names(names.into_iter().map(|name| name.to_vec()).collect()),
        )
    }
    #[napi]
    pub fn directory(&mut self, directory: bool) -> NativeJson {
        request(self.state.directory(directory))
    }
    #[napi]
    pub fn file(&mut self, file: Utf16String) -> NativeJson {
        request(self.state.file(file.to_vec()))
    }
    #[napi]
    pub fn regular(&self, regular: bool) -> NativeJson {
        match self.state.regular(regular) {
            Ok(value) => request(value),
            Err(error) => NativeJson(object(vec![("error", J::String(error))])),
        }
    }
    #[napi]
    pub fn loaded(&mut self) -> NativeJson {
        request(self.state.loaded())
    }
    #[napi]
    pub fn missing(&mut self) -> NativeJson {
        request(self.state.missing())
    }
}
