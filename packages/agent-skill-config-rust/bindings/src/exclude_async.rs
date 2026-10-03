use super::*;
use agent_skill_config_rust::exclude_async::{Machine, Request, Response};

fn request(result: std::result::Result<Request, Vec<u16>>) -> NativeJson {
    NativeJson(match result {
        Err(error) => object(vec![("error", J::String(error))]),
        Ok(Request::Join(parts)) => object(vec![
            ("kind", text("join")),
            (
                "parts",
                J::Array(parts.into_iter().map(J::String).collect()),
            ),
        ]),
        Ok(Request::Resolve { directory, target }) => object(vec![
            ("kind", text("resolve")),
            ("directory", J::String(directory)),
            ("target", J::String(target)),
        ]),
        Ok(Request::Parent(path)) => {
            object(vec![("kind", text("parent")), ("path", J::String(path))])
        }
        Ok(Request::GitStat(path)) => {
            object(vec![("kind", text("gitStat")), ("path", J::String(path))])
        }
        Ok(Request::GitRead(path)) => {
            object(vec![("kind", text("gitRead")), ("path", J::String(path))])
        }
        Ok(Request::AcquireFs) => object(vec![("kind", text("acquire"))]),
        Ok(Request::Read(path)) => object(vec![("kind", text("read")), ("path", J::String(path))]),
        Ok(Request::Entries) => object(vec![("kind", text("entries"))]),
        Ok(Request::Inspect(path)) => {
            object(vec![("kind", text("inspect")), ("path", J::String(path))])
        }
        Ok(Request::Mkdir(path)) => {
            object(vec![("kind", text("mkdir")), ("path", J::String(path))])
        }
        Ok(Request::Temporary(path)) => {
            object(vec![("kind", text("temporary")), ("path", J::String(path))])
        }
        Ok(Request::Write { path, content }) => object(vec![
            ("kind", text("write")),
            ("path", J::String(path)),
            ("content", J::String(content)),
        ]),
        Ok(Request::Rename { from, to }) => object(vec![
            ("kind", text("rename")),
            ("from", J::String(from)),
            ("to", J::String(to)),
        ]),
        Ok(Request::Cleanup(path)) => {
            object(vec![("kind", text("cleanup")), ("path", J::String(path))])
        }
        Ok(Request::Done(block)) => object(vec![
            ("kind", text("done")),
            ("block", block.map_or(J::Null, J::String)),
        ]),
    })
}
#[napi]
pub fn skill_exclude_line_error(value: Utf16String, label: String) -> NativeJson {
    NativeJson(
        exclude::single(&value, &label)
            .err()
            .map_or(J::Null, J::String),
    )
}
#[napi]
pub struct SkillExcludeMachine {
    state: Machine,
}
#[napi]
impl SkillExcludeMachine {
    #[napi(constructor)]
    pub fn new(run: Utf16String, prefix: Utf16String, remove: bool) -> Self {
        Self {
            state: Machine::new(run.to_vec(), prefix.to_vec(), remove),
        }
    }
    #[napi]
    pub fn start(&mut self, cwd: Utf16String) -> NativeJson {
        request(Ok(self.state.start(cwd.to_vec())))
    }
    #[napi]
    pub fn path(&mut self, path: Utf16String) -> NativeJson {
        request(self.state.respond(Response::Path(path.to_vec())))
    }
    #[napi]
    pub fn stat(&mut self, symbolic: bool, directory: bool) -> NativeJson {
        request(self.state.respond(Response::Stat {
            symbolic,
            directory,
        }))
    }
    #[napi]
    pub fn content(&mut self, value: Option<Utf16String>) -> NativeJson {
        request(
            self.state
                .respond(Response::Content(value.map(|value| value.to_vec()))),
        )
    }
    #[napi]
    pub fn entries(&mut self, entries: Vec<Utf16String>) -> NativeJson {
        request(self.state.respond(Response::Entries(
            entries.into_iter().map(|value| value.to_vec()).collect(),
        )))
    }
    #[napi]
    pub fn advance(&mut self) -> NativeJson {
        request(self.state.respond(Response::Unit))
    }
    #[napi]
    pub fn admits_missing(&self) -> bool {
        self.state.admits_missing()
    }
    #[napi]
    pub fn missing(&mut self) -> NativeJson {
        request(self.state.missing())
    }
    #[napi]
    pub fn failed(&mut self) -> NativeJson {
        self.state
            .failed()
            .map_or(NativeJson(J::Null), |value| request(Ok(value)))
    }
}
