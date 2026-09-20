//! Configuration execution policy with injected document/value and platform effects.
use crate::execution::Outcome;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Json,
    Toml,
    Yaml,
}
impl Format {
    pub fn name(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Toml => "toml",
            Self::Yaml => "yaml",
        }
    }
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
pub fn detect_format(path: &[u16]) -> Option<Format> {
    let dot = path.iter().rposition(|c| *c == 46)?;
    let extension: Vec<_> = path[dot..]
        .iter()
        .map(|c| if (65..=90).contains(c) { c + 32 } else { *c })
        .collect();
    if extension == u(".json") {
        Some(Format::Json)
    } else if extension == u(".toml") {
        Some(Format::Toml)
    } else if extension == u(".yaml") || extension == u(".yml") {
        Some(Format::Yaml)
    } else {
        None
    }
}
pub fn select_format(raw: &[u16], explicit: Option<&[u16]>) -> Result<Format, Vec<u16>> {
    let selected = explicit
        .map(|s| s.to_vec())
        .or_else(|| detect_format(raw).map(|f| u(f.name())));
    let Some(selected) = selected.filter(|s| !s.is_empty()) else {
        let mut message = u("Cannot detect config format for \"");
        message.extend_from_slice(raw);
        message.extend(u("\". Provide explicit format option."));
        return Err(message);
    };
    for format in [Format::Json, Format::Toml, Format::Yaml] {
        if selected == u(format.name()) {
            return Ok(format);
        }
    }
    if let Some(format) = detect_format(&selected) {
        return Ok(format);
    }
    let mut message = u("Unsupported config format. Cannot detect format from \"");
    message.extend(selected);
    message.extend(u("\". Supported extensions: .json, .toml, .yaml, .yml. Supported format names: json, toml, yaml."));
    Err(message)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Merge,
    Prune,
    Transform,
    TemplateMerge,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    Format,
    Read,
    Parse(Vec<u16>),
    Fresh,
    BackupInvalid(Vec<u16>),
    Guard,
    Value,
    Merge,
    Prune,
    Transform,
    Serialize(Option<Vec<u16>>),
    DryRun,
    WriteAtomically(Vec<u16>),
    Unlink,
    Done(Outcome),
}
#[derive(Clone, Debug)]
pub enum Response {
    Unit,
    Missing,
    Content(Vec<u16>),
    Parsed(bool),
    Bool(bool),
    Pruned { changed: bool, empty: bool },
    Transformed { changed: bool, deleted: bool },
    Serialized(Vec<u16>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    New,
    Format,
    Read,
    Parse,
    Fresh,
    DryInvalid,
    BackupInvalid,
    Guard,
    Value,
    Merge,
    Prune,
    Transform,
    Serialize,
    DryEffect,
    Effect,
    Done,
}
pub struct ConfigMachine {
    kind: Kind,
    raw_target: Vec<u16>,
    stage: Stage,
    raw: Option<Vec<u16>>,
    preserve: bool,
    pending_effect: Option<Request>,
    outcome: Option<Outcome>,
}
impl ConfigMachine {
    pub fn new(kind: Kind, raw_target: Vec<u16>) -> Self {
        Self {
            kind,
            raw_target,
            stage: Stage::New,
            raw: None,
            preserve: false,
            pending_effect: None,
            outcome: None,
        }
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if self.stage != Stage::New {
            return Err(u("Config mutation already started"));
        }
        if matches!(self.kind, Kind::Prune | Kind::TemplateMerge) {
            self.stage = Stage::Read;
            Ok(Request::Read)
        } else {
            self.stage = Stage::Format;
            Ok(Request::Format)
        }
    }
    fn release(&mut self) {
        self.raw_target = vec![];
        self.raw = None;
        self.pending_effect = None;
        self.outcome = None;
    }
    fn done(&mut self, outcome: Outcome) -> Request {
        self.stage = Stage::Done;
        self.release();
        Request::Done(outcome)
    }
    fn operation(&mut self) -> Request {
        match self.kind {
            Kind::Merge => {
                self.stage = Stage::Value;
                Request::Value
            }
            Kind::Prune => {
                self.stage = Stage::Guard;
                Request::Guard
            }
            Kind::Transform => {
                self.stage = Stage::Transform;
                Request::Transform
            }
            Kind::TemplateMerge => {
                self.stage = Stage::Merge;
                Request::Merge
            }
        }
    }
    fn serialize(&mut self) -> Request {
        self.stage = Stage::Serialize;
        Request::Serialize(if self.preserve {
            self.raw.clone()
        } else {
            None
        })
    }
    fn fresh(&mut self) -> Request {
        self.preserve = false;
        self.stage = Stage::Fresh;
        Request::Fresh
    }
    fn effect(&mut self, effect: Request, outcome: Outcome) -> Request {
        self.stage = Stage::DryEffect;
        self.pending_effect = Some(effect);
        self.outcome = Some(outcome);
        Request::DryRun
    }
    fn deletion(&mut self) -> Request {
        self.effect(
            Request::Unlink,
            Outcome {
                changed: true,
                effect: "delete",
                detail: "delete",
            },
        )
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        Ok(match (self.stage, response) {
            (Stage::Format, Response::Unit) => {
                if let Some(raw) = &self.raw {
                    self.stage = Stage::Parse;
                    Request::Parse(raw.clone())
                } else {
                    self.stage = Stage::Read;
                    Request::Read
                }
            }
            (Stage::Read, Response::Missing) => {
                if self.kind == Kind::Prune {
                    self.done(Outcome::noop())
                } else {
                    self.fresh()
                }
            }
            (Stage::Read, Response::Content(content)) => {
                self.raw = Some(content.clone());
                self.preserve = self.kind != Kind::TemplateMerge;
                if self.kind == Kind::Prune {
                    self.stage = Stage::Format;
                    Request::Format
                } else {
                    self.stage = Stage::Parse;
                    Request::Parse(content)
                }
            }
            (Stage::Parse, Response::Parsed(true)) => self.operation(),
            (Stage::Parse, Response::Parsed(false)) => {
                if self.kind == Kind::Prune {
                    self.done(Outcome::noop())
                } else {
                    self.stage = Stage::DryInvalid;
                    Request::DryRun
                }
            }
            (Stage::DryInvalid, Response::Bool(dry)) => {
                if dry {
                    self.fresh()
                } else {
                    self.stage = Stage::BackupInvalid;
                    Request::BackupInvalid(self.raw.clone().unwrap())
                }
            }
            (Stage::BackupInvalid, Response::Unit) => self.fresh(),
            (Stage::Fresh, Response::Unit) => self.operation(),
            (Stage::Guard, Response::Bool(admitted)) => {
                if admitted {
                    self.stage = Stage::Prune;
                    Request::Prune
                } else {
                    self.done(Outcome::noop())
                }
            }
            (Stage::Value, Response::Bool(true)) => {
                self.stage = Stage::Merge;
                Request::Merge
            }
            (Stage::Value, Response::Bool(false)) => {
                let mut message = u("configMerge value must be an object for \"");
                message.extend_from_slice(&self.raw_target);
                message.extend(u("\"."));
                self.stage = Stage::Done;
                self.release();
                return Err(message);
            }
            (Stage::Merge, Response::Unit) => self.serialize(),
            (Stage::Prune, Response::Pruned { changed, empty }) => {
                if !changed {
                    self.done(Outcome::noop())
                } else if empty {
                    self.deletion()
                } else {
                    self.serialize()
                }
            }
            (Stage::Transform, Response::Transformed { changed, deleted }) => {
                if !changed || deleted && self.raw.is_none() {
                    self.done(Outcome::noop())
                } else if deleted {
                    self.deletion()
                } else {
                    self.serialize()
                }
            }
            (Stage::Serialize, Response::Serialized(serialized)) => {
                let changed = self.kind == Kind::Prune || self.raw.as_ref() != Some(&serialized);
                if !changed {
                    self.done(Outcome::noop())
                } else {
                    let detail = if self.raw.is_none() {
                        "create"
                    } else {
                        "update"
                    };
                    self.effect(
                        Request::WriteAtomically(serialized),
                        Outcome {
                            changed: true,
                            effect: "write",
                            detail,
                        },
                    )
                }
            }
            (Stage::DryEffect, Response::Bool(dry)) => {
                if dry {
                    let outcome = self.outcome.take().unwrap();
                    self.done(outcome)
                } else {
                    self.stage = Stage::Effect;
                    self.pending_effect.take().unwrap()
                }
            }
            (Stage::Effect, Response::Unit) => {
                let outcome = self.outcome.take().unwrap();
                self.done(outcome)
            }
            _ => return Err(u("Unexpected config mutation response")),
        })
    }
}
