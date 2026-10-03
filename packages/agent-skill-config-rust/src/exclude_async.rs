//! Async capability-based Git discovery and exclude publication lifecycle.
use crate::{exclude, u};
use mcp_protocol_rust::strings::trim_ecmascript;

#[derive(Debug, PartialEq)]
pub enum Request {
    Join(Vec<Vec<u16>>),
    Resolve {
        directory: Vec<u16>,
        target: Vec<u16>,
    },
    Parent(Vec<u16>),
    GitStat(Vec<u16>),
    GitRead(Vec<u16>),
    AcquireFs,
    Read(Vec<u16>),
    Entries,
    Inspect(Vec<u16>),
    Mkdir(Vec<u16>),
    Temporary(Vec<u16>),
    Write {
        path: Vec<u16>,
        content: Vec<u16>,
    },
    Rename {
        from: Vec<u16>,
        to: Vec<u16>,
    },
    Cleanup(Vec<u16>),
    Done(Option<Vec<u16>>),
}
pub enum Response {
    Path(Vec<u16>),
    Stat { symbolic: bool, directory: bool },
    Content(Option<Vec<u16>>),
    Entries(Vec<Vec<u16>>),
    Unit,
}
#[derive(Clone, Copy)]
enum Stage {
    GitPath,
    GitStat,
    GitRead,
    GitResolve,
    GitParent,
    ExcludePath,
    Acquire,
    Read,
    Entries,
    Inspect,
    InspectParent,
    OutputParent,
    Mkdir,
    Temporary,
    Write,
    Rename,
    Cleanup,
    Done,
}
pub struct Machine {
    run: Vec<u16>,
    prefix: Vec<u16>,
    remove: bool,
    stage: Stage,
    directory: Vec<u16>,
    git: Vec<u16>,
    target: Vec<u16>,
    current: Vec<u16>,
    temporary: Vec<u16>,
    original: Option<Vec<u16>>,
    content: Vec<u16>,
    block: Option<Vec<u16>>,
}
impl Machine {
    pub fn new(run: Vec<u16>, prefix: Vec<u16>, remove: bool) -> Self {
        Self {
            run,
            prefix,
            remove,
            stage: Stage::Done,
            directory: vec![],
            git: vec![],
            target: vec![],
            current: vec![],
            temporary: vec![],
            original: None,
            content: vec![],
            block: None,
        }
    }
    pub fn start(&mut self, directory: Vec<u16>) -> Request {
        self.directory = directory;
        self.stage = Stage::GitPath;
        Request::Join(vec![self.directory.clone(), u(".git")])
    }
    fn inspect(&mut self) -> Request {
        self.current = self.target.clone();
        self.stage = Stage::Inspect;
        Request::Inspect(self.current.clone())
    }
    pub fn admits_missing(&self) -> bool {
        matches!(
            self.stage,
            Stage::GitStat
                | Stage::GitRead
                | Stage::GitResolve
                | Stage::ExcludePath
                | Stage::Read
                | Stage::Inspect
        )
    }
    pub fn missing(&mut self) -> Result<Request, Vec<u16>> {
        match self.stage {
            Stage::GitStat | Stage::GitRead | Stage::GitResolve | Stage::ExcludePath => {
                self.stage = Stage::GitParent;
                Ok(Request::Parent(self.directory.clone()))
            }
            Stage::Read => self.respond(Response::Content(None)),
            Stage::Inspect => self.respond(Response::Stat {
                symbolic: false,
                directory: false,
            }),
            _ => Err(u("Unexpected missing async exclude response")),
        }
    }
    /// Only a completed write owns the temporary file. Cleanup failures replace
    /// any rename error, as with the reference host's finally block.
    pub fn failed(&mut self) -> Option<Request> {
        if matches!(self.stage, Stage::Rename) {
            self.stage = Stage::Cleanup;
            Some(Request::Cleanup(self.temporary.clone()))
        } else {
            None
        }
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        Ok(match (self.stage, response) {
            (Stage::GitPath, Response::Path(path)) => {
                self.git = path;
                self.stage = Stage::GitStat;
                Request::GitStat(self.git.clone())
            }
            (
                Stage::GitStat,
                Response::Stat {
                    symbolic,
                    directory,
                },
            ) => {
                if symbolic {
                    return Err(u("Refusing symbolic Git directory"));
                }
                if directory {
                    self.stage = Stage::ExcludePath;
                    Request::Join(vec![self.git.clone(), u("info/exclude")])
                } else {
                    self.stage = Stage::GitRead;
                    Request::GitRead(self.git.clone())
                }
            }
            (Stage::GitRead, Response::Content(Some(content))) => {
                let marker = u("gitdir: ");
                if !content.starts_with(&marker) {
                    return Err(u("Invalid Git directory file"));
                }
                self.stage = Stage::GitResolve;
                Request::Resolve {
                    directory: self.directory.clone(),
                    target: trim_ecmascript(&content[marker.len()..]).to_vec(),
                }
            }
            (Stage::GitResolve, Response::Path(path)) => {
                self.stage = Stage::ExcludePath;
                Request::Join(vec![path, u("info/exclude")])
            }
            (Stage::GitParent, Response::Path(path)) => {
                if path == self.directory {
                    self.stage = Stage::Done;
                    Request::Done(None)
                } else {
                    self.start(path)
                }
            }
            (Stage::ExcludePath, Response::Path(path)) => {
                self.target = path;
                self.stage = Stage::Acquire;
                Request::AcquireFs
            }
            (Stage::Acquire, Response::Unit) => {
                self.stage = Stage::Read;
                Request::Read(self.target.clone())
            }
            (Stage::Read, Response::Content(content)) => {
                if self.remove {
                    let Some(content) = content else {
                        self.stage = Stage::Done;
                        return Ok(Request::Done(None));
                    };
                    self.content = exclude::remove_block(&content, &self.run, &self.prefix);
                    self.inspect()
                } else {
                    self.original = content;
                    self.stage = Stage::Entries;
                    Request::Entries
                }
            }
            (Stage::Entries, Response::Entries(entries)) => {
                let appended = exclude::append_block(
                    self.original.as_deref(),
                    &self.run,
                    &entries,
                    &self.prefix,
                )?;
                self.content = appended.content;
                self.block = Some(appended.id);
                self.inspect()
            }
            (Stage::Inspect, Response::Stat { symbolic, .. }) => {
                if symbolic {
                    return Err(u("Refusing symbolic Git exclude path"));
                }
                self.stage = Stage::InspectParent;
                Request::Parent(self.current.clone())
            }
            (Stage::InspectParent, Response::Path(path)) => {
                if path == self.current {
                    self.stage = Stage::OutputParent;
                    Request::Parent(self.target.clone())
                } else {
                    self.current = path;
                    self.stage = Stage::Inspect;
                    Request::Inspect(self.current.clone())
                }
            }
            (Stage::OutputParent, Response::Path(path)) => {
                self.stage = Stage::Mkdir;
                Request::Mkdir(path)
            }
            (Stage::Mkdir, Response::Unit) => {
                self.stage = Stage::Temporary;
                Request::Temporary(self.target.clone())
            }
            (Stage::Temporary, Response::Path(path)) => {
                self.temporary = path;
                self.stage = Stage::Write;
                Request::Write {
                    path: self.temporary.clone(),
                    content: std::mem::take(&mut self.content),
                }
            }
            (Stage::Write, Response::Unit) => {
                self.stage = Stage::Rename;
                Request::Rename {
                    from: self.temporary.clone(),
                    to: self.target.clone(),
                }
            }
            (Stage::Rename, Response::Unit) => {
                self.stage = Stage::Cleanup;
                Request::Cleanup(self.temporary.clone())
            }
            (Stage::Cleanup, Response::Unit) => {
                self.stage = Stage::Done;
                Request::Done(self.block.clone())
            }
            _ => return Err(u("Unexpected async exclude response")),
        })
    }
}
