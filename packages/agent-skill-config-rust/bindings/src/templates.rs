use super::*;
use agent_skill_config_rust::templates::{Machine, Request, Response};
fn request(value: std::result::Result<Request, Vec<u16>>) -> NativeJson {
    NativeJson(match value {
        Err(error) => object(vec![("error", J::String(error))]),
        Ok(Request::Join(parts)) => object(vec![
            ("kind", text("join")),
            (
                "parts",
                J::Array(parts.into_iter().map(J::String).collect()),
            ),
        ]),
        Ok(Request::Parent(path)) => {
            object(vec![("kind", text("parent")), ("path", J::String(path))])
        }
        Ok(Request::Stat(path)) => object(vec![("kind", text("stat")), ("path", J::String(path))]),
        Ok(Request::Read(path)) => object(vec![("kind", text("read")), ("path", J::String(path))]),
        Ok(Request::Done(content)) => object(vec![
            ("kind", text("done")),
            ("content", J::String(content)),
        ]),
    })
}
#[napi]
pub struct SkillTemplateMachine {
    state: std::result::Result<Machine, Vec<u16>>,
}
#[napi]
impl SkillTemplateMachine {
    #[napi(constructor)]
    pub fn new(id: Utf16String, directory: Utf16String) -> Self {
        Self {
            state: Machine::new(&id, directory.to_vec()),
        }
    }
    #[napi]
    pub fn start(&mut self) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.start()),
            Err(error) => NativeJson(object(vec![("error", J::String(error.clone()))])),
        }
    }
    #[napi]
    pub fn path(&mut self, value: Utf16String) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.respond(Response::Path(value.to_vec()))),
            Err(error) => NativeJson(object(vec![("error", J::String(error.clone()))])),
        }
    }
    #[napi]
    pub fn exists(&mut self, value: bool) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.respond(Response::Exists(value))),
            Err(error) => NativeJson(object(vec![("error", J::String(error.clone()))])),
        }
    }
    #[napi]
    pub fn content(&mut self, value: Utf16String) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.respond(Response::Content(value.to_vec()))),
            Err(error) => NativeJson(object(vec![("error", J::String(error.clone()))])),
        }
    }
}
