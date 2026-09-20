use super::*;
use agent_skill_config_rust::apply::{self, Machine, Operation, Options, Request, Response};
fn failure(error: &apply::Error) -> NativeJson {
    NativeJson(object(vec![
        ("error", J::String(error.message.clone())),
        ("user", J::Bool(error.user)),
        ("unsupported", J::Bool(error.unsupported)),
    ]))
}
fn request(value: std::result::Result<Request, apply::Error>) -> NativeJson {
    match value {
        Err(error) => failure(&error),
        Ok(Request::Stat(path)) => NativeJson(object(vec![
            ("kind", text("stat")),
            ("path", J::String(path)),
        ])),
        Ok(Request::Read(path)) => NativeJson(object(vec![
            ("kind", text("read")),
            ("path", J::String(path)),
        ])),
        Ok(Request::Template(id)) => NativeJson(object(vec![
            ("kind", text("template")),
            ("id", J::String(id)),
        ])),
        Ok(Request::Done(plan)) => NativeJson(object(vec![
            ("kind", text("done")),
            ("home", J::String(plan.home)),
            ("mutations", J::Array(plan.mutations)),
            ("template", plan.template.map_or(J::Null, J::String)),
            ("result", plan.result.unwrap_or(J::Null)),
        ])),
    }
}
#[napi]
pub struct SkillApplyMachine {
    state: std::result::Result<Machine, apply::Error>,
}
#[napi(object)]
pub struct SkillApplyOptions {
    pub cwd: Utf16String,
    pub home: Utf16String,
    pub global: Option<bool>,
    pub force: bool,
    pub name: Option<Utf16String>,
    pub content: Option<Utf16String>,
}
#[napi]
impl SkillApplyMachine {
    #[napi(constructor)]
    pub fn new(operation: String, agent: Utf16String, options: SkillApplyOptions) -> Self {
        let operation = match operation.as_str() {
            "configure" => Operation::Configure,
            "unconfigure" => Operation::Unconfigure,
            _ => Operation::Install {
                name: options.name.map_or_else(Vec::new, |value| value.to_vec()),
                content: options
                    .content
                    .map_or_else(Vec::new, |value| value.to_vec()),
            },
        };
        Self {
            state: Machine::new(
                catalog(),
                &agent,
                operation,
                Options {
                    cwd: options.cwd.to_vec(),
                    home: options.home.to_vec(),
                    global: options.global,
                    force: options.force,
                },
            ),
        }
    }
    #[napi]
    pub fn start(&mut self) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.start()),
            Err(error) => failure(error),
        }
    }
    #[napi]
    pub fn exists(&mut self, value: bool) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.respond(Response::Exists(value))),
            Err(error) => failure(error),
        }
    }
    #[napi]
    pub fn content(&mut self, value: Utf16String) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.respond(Response::Content(value.to_vec()))),
            Err(error) => failure(error),
        }
    }
    #[napi]
    pub fn template(&mut self, value: Utf16String) -> NativeJson {
        match &mut self.state {
            Ok(machine) => request(machine.respond(Response::Template(value.to_vec()))),
            Err(error) => failure(error),
        }
    }
}
