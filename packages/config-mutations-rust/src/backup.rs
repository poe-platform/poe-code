//! Backup/restore policy with lazy controls and injected filesystem/calendar effects.
pub use crate::atomic::WriteError;
use crate::execution::Outcome;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Backup,
    Restore,
    Invalid,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    InspectLink(Vec<u16>),
    Once,
    List(Vec<u16>),
    ValidateTimestamp(Vec<u16>),
    DryRun,
    Timestamp,
    Walk(Vec<u16>),
    Read {
        path: Vec<u16>,
        missing_allowed: bool,
    },
    WriteExclusive {
        path: Vec<u16>,
        content: Vec<u16>,
    },
    WriteAtomically {
        path: Vec<u16>,
        content: Vec<u16>,
    },
    Unlink {
        path: Vec<u16>,
        ignore_missing: bool,
        cleanup: bool,
    },
    Done(Outcome),
    Error(WriteError),
}
#[derive(Clone, Debug)]
pub enum Response {
    Unit,
    Missing,
    Link(bool),
    Bool(bool),
    Content(Vec<u16>),
    Entries(Vec<Vec<u16>>),
    Walk(Vec<Vec<u16>>),
    Timestamp(Vec<u16>),
    Failure { exists: bool, token: u32 },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    New,
    TargetLink,
    Once,
    List,
    Validate,
    ReadTarget,
    MissingOnce,
    DryBackup,
    Timestamp,
    WalkWrite,
    LinkWrite,
    Write,
    Cleanup,
    DryRestore,
    WalkRestore,
    LinkRestore,
    ReadRestore,
    AtomicRestore,
    DeleteMissing,
    Consume,
    Done,
}
pub struct BackupMachine {
    kind: Kind,
    target: Vec<u16>,
    directory: Vec<u16>,
    name: Vec<u16>,
    walk: Vec<Vec<u16>>,
    link_index: usize,
    stage: Stage,
    entries: Vec<Vec<u16>>,
    entry_index: usize,
    selected: Option<Vec<u16>>,
    backup: Vec<u16>,
    missing_marker: bool,
    content: Option<Vec<u16>>,
    base_backup: Vec<u16>,
    collision: usize,
    pending_error: Option<WriteError>,
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
impl BackupMachine {
    pub fn new(kind: Kind, target: Vec<u16>, walk: Vec<Vec<u16>>) -> Self {
        let separator = target.iter().rposition(|c| *c == 47);
        let directory = match separator {
            Some(i) if i > 0 => target[..i].to_vec(),
            _ => u("/"),
        };
        let name = target[separator.map_or(0, |i| i + 1)..].to_vec();
        Self {
            kind,
            target,
            directory,
            name,
            walk,
            link_index: 0,
            stage: Stage::New,
            entries: vec![],
            entry_index: 0,
            selected: None,
            backup: vec![],
            missing_marker: false,
            content: None,
            base_backup: vec![],
            collision: 0,
            pending_error: None,
        }
    }
    pub fn new_invalid(target: Vec<u16>, content: Vec<u16>) -> Self {
        let mut machine = Self::new(Kind::Invalid, target, vec![]);
        machine.content = Some(content);
        machine
    }
    pub fn checks_collisions(&self) -> bool {
        self.stage == Stage::Write
            || self.kind == Kind::Backup
                && matches!(self.stage, Stage::WalkWrite | Stage::LinkWrite)
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if self.stage != Stage::New {
            return Err(u("Backup mutation already started"));
        }
        if self.kind == Kind::Invalid {
            self.stage = Stage::Timestamp;
            return Ok(Request::Timestamp);
        }
        if self.kind == Kind::Restore {
            self.stage = Stage::List;
            Ok(Request::List(self.directory.clone()))
        } else if self.walk.is_empty() {
            self.stage = Stage::Once;
            Ok(Request::Once)
        } else {
            self.stage = Stage::TargetLink;
            Ok(Request::InspectLink(self.walk[0].clone()))
        }
    }
    fn release(&mut self) {
        self.target = vec![];
        self.directory = vec![];
        self.name = vec![];
        self.walk = vec![];
        self.entries = vec![];
        self.selected = None;
        self.backup = vec![];
        self.content = None;
        self.base_backup = vec![];
        self.pending_error = None;
    }
    fn done(&mut self, changed: bool) -> Request {
        self.stage = Stage::Done;
        self.release();
        Request::Done(if changed {
            Outcome {
                changed: true,
                effect: "copy",
                detail: if self.kind == Kind::Restore {
                    "restore"
                } else {
                    "backup"
                },
            }
        } else {
            Outcome::noop()
        })
    }
    fn error(&mut self, error: WriteError) -> Request {
        self.stage = Stage::Done;
        self.release();
        Request::Error(error)
    }
    fn read_target(&mut self) -> Request {
        self.stage = Stage::ReadTarget;
        Request::Read {
            path: self.target.clone(),
            missing_allowed: true,
        }
    }
    fn timestamp(&self, entry: &[u16]) -> Option<Vec<u16>> {
        let mut prefix = self.name.clone();
        prefix.extend(u(".backup-"));
        if !entry.starts_with(&prefix) {
            return None;
        }
        let timestamp = entry.get(prefix.len()..prefix.len() + 24)?;
        if timestamp[4] != 45
            || timestamp[7] != 45
            || timestamp[10] != 84
            || timestamp[13] != 45
            || timestamp[16] != 45
            || timestamp[19] != 45
            || timestamp[23] != 90
        {
            return None;
        }
        let mut timestamp = timestamp.to_vec();
        timestamp[13] = 58;
        timestamp[16] = 58;
        timestamp[19] = 46;
        Some(timestamp)
    }
    fn suffix_valid(&self, entry: &[u16]) -> bool {
        let suffix = &entry[self.name.len() + 8 + 24..];
        suffix.is_empty()
            || suffix == u(".missing")
            || suffix[0] == 45
                && suffix.len() > 1
                && suffix[1..].iter().all(|c| (48..=57).contains(c))
    }
    fn next_entry(&mut self) -> Request {
        while let Some(entry) = self.entries.get(self.entry_index) {
            if let Some(timestamp) = self.timestamp(entry) {
                self.stage = Stage::Validate;
                return Request::ValidateTimestamp(timestamp);
            }
            self.entry_index += 1;
        }
        self.entries = vec![];
        if self.kind == Kind::Backup {
            if self.selected.is_some() {
                self.done(false)
            } else {
                self.read_target()
            }
        } else if let Some(selected) = self.selected.take() {
            self.missing_marker = selected.ends_with(&u(".missing"));
            self.backup = self.directory.clone();
            self.backup.push(47);
            self.backup.extend(selected);
            self.stage = Stage::DryRestore;
            Request::DryRun
        } else {
            self.done(false)
        }
    }
    fn begin_write(&mut self) -> Request {
        self.backup = self.base_backup.clone();
        if self.collision > 0 {
            self.backup.push(45);
            self.backup.extend(u(&self.collision.to_string()));
        }
        self.stage = Stage::WalkWrite;
        Request::Walk(self.backup.clone())
    }
    fn write(&mut self) -> Request {
        self.stage = Stage::Write;
        Request::WriteExclusive {
            path: self.backup.clone(),
            content: self.content.clone().unwrap_or_default(),
        }
    }
    fn cleanup(&mut self, error: WriteError) -> Request {
        self.pending_error = Some(error);
        self.stage = Stage::Cleanup;
        Request::Unlink {
            path: self.backup.clone(),
            ignore_missing: false,
            cleanup: true,
        }
    }
    fn after_restore_walk(&mut self) -> Request {
        if self.missing_marker {
            self.stage = Stage::DeleteMissing;
            Request::Unlink {
                path: self.target.clone(),
                ignore_missing: true,
                cleanup: false,
            }
        } else {
            self.stage = Stage::ReadRestore;
            Request::Read {
                path: self.backup.clone(),
                missing_allowed: false,
            }
        }
    }
    fn consume(&mut self) -> Request {
        self.stage = Stage::Consume;
        Request::Unlink {
            path: self.backup.clone(),
            ignore_missing: false,
            cleanup: false,
        }
    }
    fn link_done(&mut self) -> Request {
        match self.stage {
            Stage::TargetLink => {
                self.stage = Stage::Once;
                Request::Once
            }
            Stage::LinkWrite => self.write(),
            Stage::LinkRestore => self.after_restore_walk(),
            _ => unreachable!(),
        }
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        if let Response::Failure { exists, token } = response {
            return Ok(match self.stage {
                Stage::Cleanup => {
                    let error = self.pending_error.take().unwrap();
                    self.error(error)
                }
                Stage::WalkWrite | Stage::LinkWrite | Stage::Write => {
                    if self.kind == Kind::Invalid && self.stage != Stage::Write {
                        self.error(WriteError::Host(token))
                    } else if exists {
                        self.collision = self.collision.saturating_add(1);
                        self.begin_write()
                    } else {
                        self.cleanup(WriteError::Host(token))
                    }
                }
                Stage::New | Stage::Done => return Err(u("Unexpected backup failure")),
                _ => self.error(WriteError::Host(token)),
            });
        }
        Ok(match (self.stage, response) {
            (
                Stage::TargetLink | Stage::LinkWrite | Stage::LinkRestore,
                Response::Link(false) | Response::Missing,
            ) => {
                self.link_index += 1;
                if let Some(path) = self.walk.get(self.link_index) {
                    Request::InspectLink(path.clone())
                } else {
                    self.walk = vec![];
                    self.link_done()
                }
            }
            (Stage::TargetLink | Stage::LinkWrite | Stage::LinkRestore, Response::Link(true)) => {
                let mut message = u("Refusing mutation write through symbolic link: ");
                message.extend_from_slice(&self.walk[self.link_index]);
                let error = WriteError::Message(message);
                if self.stage == Stage::LinkWrite && self.kind != Kind::Invalid {
                    self.cleanup(error)
                } else {
                    self.error(error)
                }
            }
            (Stage::Once, Response::Bool(once)) => {
                if once {
                    self.stage = Stage::List;
                    Request::List(self.directory.clone())
                } else {
                    self.read_target()
                }
            }
            (Stage::List, Response::Entries(entries)) => {
                self.entries = entries;
                self.entry_index = 0;
                self.selected = None;
                self.next_entry()
            }
            (Stage::List, Response::Missing) => {
                self.entries = vec![];
                self.selected = None;
                self.next_entry()
            }
            (Stage::Validate, Response::Bool(valid)) => {
                let entry = &self.entries[self.entry_index];
                if valid
                    && self.suffix_valid(entry)
                    && self
                        .selected
                        .as_ref()
                        .is_none_or(|selected| entry > selected)
                {
                    self.selected = Some(entry.clone());
                }
                self.entry_index += 1;
                self.next_entry()
            }
            (Stage::ReadTarget, Response::Content(content)) => {
                self.content = Some(content);
                self.stage = Stage::DryBackup;
                Request::DryRun
            }
            (Stage::ReadTarget, Response::Missing) => {
                self.content = None;
                self.stage = Stage::MissingOnce;
                Request::Once
            }
            (Stage::MissingOnce, Response::Bool(once)) => {
                if once {
                    self.stage = Stage::DryBackup;
                    Request::DryRun
                } else {
                    self.done(false)
                }
            }
            (Stage::DryBackup, Response::Bool(dry)) => {
                if dry {
                    self.done(true)
                } else {
                    self.stage = Stage::Timestamp;
                    Request::Timestamp
                }
            }
            (Stage::Timestamp, Response::Timestamp(timestamp)) => {
                self.base_backup = self.target.clone();
                self.base_backup.extend(u(if self.kind == Kind::Invalid {
                    ".invalid-"
                } else {
                    ".backup-"
                }));
                self.base_backup.extend(
                    timestamp
                        .into_iter()
                        .map(|c| if matches!(c, 58 | 46) { 45 } else { c }),
                );
                if self.kind == Kind::Invalid {
                    self.base_backup.push(46);
                    let extension = self
                        .target
                        .iter()
                        .rposition(|c| *c == 46)
                        .map(|dot| self.target[dot + 1..].to_vec())
                        .unwrap_or_else(|| u("bak"));
                    self.base_backup.extend(extension);
                } else if self.content.is_none() {
                    self.base_backup.extend(u(".missing"));
                }
                self.begin_write()
            }
            (Stage::WalkWrite | Stage::WalkRestore, Response::Walk(walk)) => {
                let write = self.stage == Stage::WalkWrite;
                self.walk = walk;
                self.link_index = 0;
                if self.walk.is_empty() {
                    if write {
                        self.write()
                    } else {
                        self.after_restore_walk()
                    }
                } else {
                    self.stage = if write {
                        Stage::LinkWrite
                    } else {
                        Stage::LinkRestore
                    };
                    Request::InspectLink(self.walk[0].clone())
                }
            }
            (Stage::Write, Response::Unit) => self.done(true),
            (Stage::Cleanup, Response::Unit | Response::Missing) => {
                let error = self.pending_error.take().unwrap();
                self.error(error)
            }
            (Stage::DryRestore, Response::Bool(dry)) => {
                if dry {
                    self.done(true)
                } else {
                    self.stage = Stage::WalkRestore;
                    Request::Walk(self.backup.clone())
                }
            }
            (Stage::ReadRestore, Response::Content(content)) => {
                self.stage = Stage::AtomicRestore;
                Request::WriteAtomically {
                    path: self.target.clone(),
                    content,
                }
            }
            (Stage::AtomicRestore, Response::Unit)
            | (Stage::DeleteMissing, Response::Unit | Response::Missing) => self.consume(),
            (Stage::Consume, Response::Unit) => self.done(true),
            _ => return Err(u("Unexpected backup mutation response")),
        })
    }
}
