//! Dependency-injected file mutation state machine. The caller executes only
//! requested effects and reads host controls when requested, preserving lazy
//! getters and mutations across awaited I/O without retaining a foreign runtime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    EnsureDirectory,
    RemoveDirectory,
    RemoveFile,
    Chmod,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub changed: bool,
    pub effect: &'static str,
    pub detail: &'static str,
}
impl Outcome {
    pub fn noop() -> Self {
        Self {
            changed: false,
            effect: "none",
            detail: "noop",
        }
    }
    fn deleted() -> Self {
        Self {
            changed: true,
            effect: "delete",
            detail: "delete",
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    ChmodSupported,
    DirectoryOptions,
    Mode,
    DryRun,
    InspectLink(Vec<u16>),
    Stat,
    ReadFile,
    ReadEntries,
    Guard(Vec<u16>),
    MakeDirectory,
    RemoveDirectory,
    Unlink,
    SetMode(f64),
    Done(Outcome),
}
#[derive(Clone, Debug)]
pub enum Response {
    Unit,
    Missing,
    Link(bool),
    Stat(Option<f64>),
    Content(Vec<u16>),
    Count(usize),
    ChmodSupported(bool),
    DirectoryOptions { supported: bool, force: bool },
    Mode(f64),
    Guard { matches: bool, when_empty: bool },
    DryRun(bool),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    New,
    ChmodSupported,
    DirectoryOptions,
    Mode,
    DryRun,
    Link,
    Stat,
    ReadFile,
    ReadEntries,
    Guard,
    Effect,
    Done,
}
pub struct FileMachine {
    kind: Kind,
    write_walk: Vec<Vec<u16>>,
    link_index: usize,
    stage: Stage,
    outcome: Option<Outcome>,
    pending_effect: Option<Request>,
    content_empty: bool,
    current_mode: Option<f64>,
}
fn error(message: &str) -> Vec<u16> {
    message.encode_utf16().collect()
}
impl FileMachine {
    pub fn new(kind: Kind, write_walk: Vec<Vec<u16>>) -> Self {
        Self {
            kind,
            write_walk,
            link_index: 0,
            stage: Stage::New,
            outcome: None,
            pending_effect: None,
            content_empty: false,
            current_mode: None,
        }
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if self.stage != Stage::New {
            return Err(error("File mutation already started"));
        }
        if self.kind == Kind::Chmod {
            self.stage = Stage::ChmodSupported;
            return Ok(Request::ChmodSupported);
        }
        Ok(self.begin_walk())
    }
    fn begin_walk(&mut self) -> Request {
        if matches!(self.kind, Kind::EnsureDirectory | Kind::Chmod) && !self.write_walk.is_empty() {
            self.stage = Stage::Link;
            Request::InspectLink(self.write_walk[0].clone())
        } else {
            self.begin_inspection()
        }
    }
    fn begin_inspection(&mut self) -> Request {
        if self.kind == Kind::RemoveFile {
            self.stage = Stage::ReadFile;
            Request::ReadFile
        } else {
            self.stage = Stage::Stat;
            Request::Stat
        }
    }
    fn done(&mut self, outcome: Outcome) -> Request {
        self.stage = Stage::Done;
        self.write_walk = vec![];
        Request::Done(outcome)
    }
    fn effect(&mut self, request: Request, outcome: Outcome) -> Request {
        self.stage = Stage::DryRun;
        self.outcome = Some(outcome);
        self.pending_effect = Some(request);
        Request::DryRun
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        match (self.stage, response) {
            (Stage::ChmodSupported, Response::ChmodSupported(supported)) => {
                if supported {
                    Ok(self.begin_walk())
                } else {
                    Ok(self.done(Outcome::noop()))
                }
            }
            (Stage::Link, Response::Link(true)) => {
                let mut message = error("Refusing mutation write through symbolic link: ");
                message.extend_from_slice(&self.write_walk[self.link_index]);
                self.stage = Stage::Done;
                self.write_walk = vec![];
                Err(message)
            }
            (Stage::Link, Response::Link(false) | Response::Missing) => {
                self.link_index += 1;
                if let Some(path) = self.write_walk.get(self.link_index) {
                    Ok(Request::InspectLink(path.clone()))
                } else {
                    Ok(self.begin_inspection())
                }
            }
            (Stage::Stat, Response::Missing) => {
                if self.kind == Kind::EnsureDirectory {
                    Ok(self.effect(
                        Request::MakeDirectory,
                        Outcome {
                            changed: true,
                            effect: "mkdir",
                            detail: "create",
                        },
                    ))
                } else {
                    Ok(self.done(Outcome::noop()))
                }
            }
            (Stage::Stat, Response::Stat(mode)) => match self.kind {
                Kind::EnsureDirectory => Ok(self.effect(
                    Request::MakeDirectory,
                    Outcome {
                        changed: false,
                        effect: "mkdir",
                        detail: "noop",
                    },
                )),
                Kind::RemoveDirectory => {
                    self.stage = Stage::DirectoryOptions;
                    Ok(Request::DirectoryOptions)
                }
                Kind::Chmod => {
                    self.current_mode = mode.map(|n| {
                        if n.is_finite() {
                            (n.trunc().rem_euclid(4294967296.0) as u32 & 0o777) as f64
                        } else {
                            0.0
                        }
                    });
                    self.stage = Stage::Mode;
                    Ok(Request::Mode)
                }
                Kind::RemoveFile => unreachable!(),
            },
            (Stage::DirectoryOptions, Response::DirectoryOptions { supported, force }) => {
                if !supported {
                    Ok(self.done(Outcome::noop()))
                } else if force {
                    Ok(self.effect(Request::RemoveDirectory, Outcome::deleted()))
                } else {
                    self.stage = Stage::ReadEntries;
                    Ok(Request::ReadEntries)
                }
            }
            (Stage::Mode, Response::Mode(mode)) => {
                if self.current_mode == Some(mode) {
                    Ok(self.done(Outcome::noop()))
                } else {
                    Ok(self.effect(
                        Request::SetMode(mode),
                        Outcome {
                            changed: true,
                            effect: "chmod",
                            detail: "update",
                        },
                    ))
                }
            }
            (Stage::ReadEntries, Response::Count(count)) => {
                if count > 0 {
                    Ok(self.done(Outcome::noop()))
                } else {
                    Ok(self.effect(Request::RemoveDirectory, Outcome::deleted()))
                }
            }
            (Stage::ReadFile, Response::Content(content)) => {
                let content = trim(&content).to_vec();
                self.content_empty = content.is_empty();
                self.stage = Stage::Guard;
                Ok(Request::Guard(content))
            }
            (Stage::ReadFile | Stage::Guard | Stage::Mode | Stage::DryRun, Response::Missing)
                if matches!(self.kind, Kind::RemoveFile | Kind::Chmod) =>
            {
                Ok(self.done(Outcome::noop()))
            }
            (
                Stage::Guard,
                Response::Guard {
                    matches,
                    when_empty,
                },
            ) => {
                if !matches || when_empty && !self.content_empty {
                    Ok(self.done(Outcome::noop()))
                } else {
                    Ok(self.effect(Request::Unlink, Outcome::deleted()))
                }
            }
            (Stage::DryRun, Response::DryRun(dry_run)) => {
                if dry_run {
                    self.pending_effect.take();
                    let outcome = self.outcome.take().unwrap();
                    Ok(self.done(outcome))
                } else {
                    self.stage = Stage::Effect;
                    Ok(self.pending_effect.take().unwrap())
                }
            }
            (Stage::Effect, Response::Unit) => {
                let outcome = self.outcome.take().unwrap();
                Ok(self.done(outcome))
            }
            (Stage::Effect, Response::Missing)
                if matches!(self.kind, Kind::RemoveFile | Kind::Chmod) =>
            {
                Ok(self.done(Outcome::noop()))
            }
            _ => Err(error("Unexpected file mutation response")),
        }
    }
}
/// ECMAScript trim removes whitespace and line terminators, including BOM,
/// but not zero-width space or the former Mongolian vowel separator.
fn trim(source: &[u16]) -> &[u16] {
    fn whitespace(unit: u16) -> bool {
        matches!(unit,0x0009..=0x000d|0x0020|0x00a0|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
    }
    let start = source
        .iter()
        .position(|u| !whitespace(*u))
        .unwrap_or(source.len());
    let end = source
        .iter()
        .rposition(|u| !whitespace(*u))
        .map_or(start, |n| n + 1);
    &source[start..end]
}

/// Declarative host factory layouts preserve foreign resolver/guard identities.
pub struct Factory {
    pub name: &'static str,
    pub kind: &'static str,
    pub fields: &'static [&'static str],
}
pub const FILE_FACTORIES: &[Factory] = &[
    Factory {
        name: "ensureDirectory",
        kind: "ensureDirectory",
        fields: &["path", "label"],
    },
    Factory {
        name: "remove",
        kind: "removeFile",
        fields: &["target", "whenEmpty", "whenContentMatches", "label"],
    },
    Factory {
        name: "removeDirectory",
        kind: "removeDirectory",
        fields: &["path", "force", "label"],
    },
    Factory {
        name: "chmod",
        kind: "chmod",
        fields: &["target", "mode", "label"],
    },
    Factory {
        name: "backup",
        kind: "backup",
        fields: &["target", "once", "label"],
    },
    Factory {
        name: "restoreBackup",
        kind: "restoreBackup",
        fields: &["target", "label"],
    },
];

pub const CONFIG_FACTORIES: &[Factory] = &[
    Factory {
        name: "merge",
        kind: "configMerge",
        fields: &["target", "value", "format", "pruneByPrefix", "label"],
    },
    Factory {
        name: "prune",
        kind: "configPrune",
        fields: &["target", "shape", "format", "onlyIf", "label"],
    },
    Factory {
        name: "transform",
        kind: "configTransform",
        fields: &["target", "format", "transform", "label"],
    },
];
