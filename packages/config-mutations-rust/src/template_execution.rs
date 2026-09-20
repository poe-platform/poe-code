//! Template execution policy. Rendering and foreign document effects are injected.
use crate::{
    config::{
        ConfigMachine, Kind as ConfigKind, Request as ConfigRequest, Response as ConfigResponse,
    },
    execution::Outcome,
};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Write,
    MergeJson,
    MergeToml,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    Loader,
    Resolve,
    Load,
    Context,
    Render,
    ParseRendered,
    Read,
    DryRun,
    Write(Vec<u16>),
    Config(ConfigRequest),
    Done(Outcome),
}
pub enum Response {
    Supported(bool),
    Unit,
    Rendered(Vec<u16>),
    Content(Vec<u16>),
    Missing,
    DryRun(bool),
    InvalidTemplate { id: Vec<u16>, error: Vec<u16> },
    Config(ConfigResponse),
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    New,
    Loader,
    Resolve,
    Load,
    Context,
    Render,
    ParseRendered,
    Read,
    DryRun,
    Write,
    Config,
    Done,
}
pub struct TemplateMachine {
    kind: Kind,
    stage: Stage,
    rendered: Vec<u16>,
    outcome: Option<Outcome>,
    config: Option<ConfigMachine>,
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
impl TemplateMachine {
    pub fn new(kind: Kind) -> Self {
        Self {
            kind,
            stage: Stage::New,
            rendered: vec![],
            outcome: None,
            config: None,
        }
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if self.stage != Stage::New {
            return Err(u("Template mutation already started"));
        }
        self.stage = Stage::Loader;
        Ok(Request::Loader)
    }
    fn done(&mut self, outcome: Outcome) -> Request {
        self.stage = Stage::Done;
        self.rendered = vec![];
        self.outcome = None;
        self.config = None;
        Request::Done(outcome)
    }
    fn failure(&mut self, message: Vec<u16>) -> Result<Request, Vec<u16>> {
        self.done(Outcome::noop());
        Err(message)
    }
    fn compared(&mut self, current: Option<Vec<u16>>) -> Request {
        if current.as_ref() == Some(&self.rendered) {
            return self.done(Outcome::noop());
        }
        self.outcome = Some(Outcome {
            changed: true,
            effect: "write",
            detail: if current.is_none() {
                "create"
            } else {
                "update"
            },
        });
        self.stage = Stage::DryRun;
        Request::DryRun
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        Ok(match (self.stage,response) {
            (Stage::Loader,Response::Supported(false))=>return self.failure(u("Template mutations require a templates loader. Provide templates function to runMutations context.")),
            (Stage::Loader,Response::Supported(true))=>{self.stage=Stage::Resolve;Request::Resolve},
            (Stage::Resolve,Response::Unit)=>{self.stage=Stage::Load;Request::Load},
            (Stage::Load,Response::Unit)=>{self.stage=Stage::Context;Request::Context},
            (Stage::Context,Response::Unit)=>{self.stage=Stage::Render;Request::Render},
            (Stage::Render,Response::Rendered(content))=>{
                if self.kind==Kind::Write {self.rendered=content;self.stage=Stage::Read;Request::Read}
                else {self.stage=Stage::ParseRendered;Request::ParseRendered}
            },
            (Stage::ParseRendered,Response::InvalidTemplate{id,error})=>{
                let mut message=u("Failed to parse rendered template \"");message.extend(id);message.extend(u(if self.kind==Kind::MergeJson {"\" as JSON: "}else{"\" as TOML: "}));message.extend(error);return self.failure(message)
            },
            (Stage::ParseRendered,Response::Unit)=>{
                let mut config=ConfigMachine::new(ConfigKind::TemplateMerge,vec![]);let request=config.start()?;self.config=Some(config);self.stage=Stage::Config;Request::Config(request)
            },
            (Stage::Read,Response::Content(current))=>self.compared(Some(current)),
            (Stage::Read,Response::Missing)=>self.compared(None),
            (Stage::DryRun,Response::DryRun(true))=>{let outcome=self.outcome.take().unwrap();self.done(outcome)},
            (Stage::DryRun,Response::DryRun(false))=>{self.stage=Stage::Write;Request::Write(std::mem::take(&mut self.rendered))},
            (Stage::Write,Response::Unit)=>{let outcome=self.outcome.take().unwrap();self.done(outcome)},
            (Stage::Config,Response::Config(response))=>{
                let request=self.config.as_mut().unwrap().respond(response)?;
                if matches!(request,ConfigRequest::Done(_)){self.stage=Stage::Done;self.config=None;}
                Request::Config(request)
            },
            _=>return Err(u("Unexpected template mutation response")),
        })
    }
}
