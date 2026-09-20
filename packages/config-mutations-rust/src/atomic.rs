//! Atomic UTF-16 document writes over injected platform effects. No files are
//! opened by this core; exclusive creation, rename and cleanup are explicit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Exists,
    Other,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteError {
    Host(u32),
    Message(Vec<u16>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    InspectLink(Vec<u16>),
    TempPath,
    WriteExclusive { path: Vec<u16>, content: Vec<u16> },
    Rename { from: Vec<u16>, to: Vec<u16> },
    Cleanup(Vec<u16>),
    Done,
    Error(WriteError),
}
#[derive(Clone, Debug)]
pub enum Response {
    Unit,
    Missing,
    Link(bool),
    Temp { path: Vec<u16>, walk: Vec<Vec<u16>> },
    Failure { kind: Failure, token: u32 },
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    New,
    TargetLink,
    TempPath,
    TempLink,
    Write,
    Rename,
    Cleanup,
    Done,
}
enum Following {
    Retry,
    Error(WriteError),
}
pub struct AtomicMachine {
    target: Vec<u16>,
    content: Vec<u16>,
    walk: Vec<Vec<u16>>,
    index: usize,
    temporary: Vec<u16>,
    stage: Stage,
    attempts: usize,
    created: bool,
    following: Option<Following>,
}
fn text(message: &str) -> Vec<u16> {
    message.encode_utf16().collect()
}
impl AtomicMachine {
    pub fn new(target: Vec<u16>, content: Vec<u16>, walk: Vec<Vec<u16>>) -> Self {
        Self {
            target,
            content,
            walk,
            index: 0,
            temporary: vec![],
            stage: Stage::New,
            attempts: 0,
            created: false,
            following: None,
        }
    }
    /// Target checks and path generation occur outside the retry error boundary.
    pub fn checks_collisions(&self) -> bool {
        matches!(self.stage, Stage::TempLink | Stage::Write | Stage::Rename)
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if self.stage != Stage::New {
            return Err(text("Atomic write already started"));
        }
        if self.walk.is_empty() {
            Ok(self.retry())
        } else {
            self.stage = Stage::TargetLink;
            Ok(Request::InspectLink(self.walk[0].clone()))
        }
    }
    fn release_payload(&mut self) {
        self.target = vec![];
        self.content = vec![];
        self.walk = vec![];
        self.temporary = vec![];
        self.following = None;
    }
    fn error(&mut self, error: WriteError) -> Request {
        self.stage = Stage::Done;
        self.release_payload();
        Request::Error(error)
    }
    fn retry(&mut self) -> Request {
        self.created = false;
        if self.attempts >= 10 {
            let mut message = text("Unable to create temporary mutation file for ");
            message.extend_from_slice(&self.target);
            message.push(46);
            self.error(WriteError::Message(message))
        } else {
            self.stage = Stage::TempPath;
            Request::TempPath
        }
    }
    fn write(&mut self) -> Request {
        self.stage = Stage::Write;
        Request::WriteExclusive {
            path: self.temporary.clone(),
            content: self.content.clone(),
        }
    }
    fn cleanup(&mut self, following: Following) -> Request {
        self.stage = Stage::Cleanup;
        self.following = Some(following);
        Request::Cleanup(self.temporary.clone())
    }
    fn link(&mut self) -> Request {
        self.index += 1;
        if let Some(path) = self.walk.get(self.index) {
            Request::InspectLink(path.clone())
        } else if self.stage == Stage::TargetLink {
            self.retry()
        } else {
            self.write()
        }
    }
    fn failure(&mut self, kind: Failure, token: u32) -> Result<Request, Vec<u16>> {
        match self.stage {
            Stage::New | Stage::Done => Err(text("Unexpected atomic write failure")),
            Stage::Cleanup => Ok(self.after_cleanup()),
            Stage::TargetLink | Stage::TempPath => Ok(self.error(WriteError::Host(token))),
            Stage::TempLink | Stage::Write | Stage::Rename => {
                if kind == Failure::Exists {
                    if self.created {
                        Ok(self.cleanup(Following::Retry))
                    } else {
                        Ok(self.retry())
                    }
                } else {
                    Ok(self.cleanup(Following::Error(WriteError::Host(token))))
                }
            }
        }
    }
    fn after_cleanup(&mut self) -> Request {
        match self.following.take().unwrap() {
            Following::Retry => self.retry(),
            Following::Error(error) => self.error(error),
        }
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Vec<u16>> {
        if let Response::Failure { kind, token } = response {
            return self.failure(kind, token);
        }
        match (self.stage, response) {
            (Stage::TargetLink | Stage::TempLink, Response::Missing | Response::Link(false)) => {
                Ok(self.link())
            }
            (Stage::TargetLink | Stage::TempLink, Response::Link(true)) => {
                let mut message = text("Refusing mutation write through symbolic link: ");
                message.extend_from_slice(&self.walk[self.index]);
                let error = WriteError::Message(message);
                if self.stage == Stage::TargetLink {
                    Ok(self.error(error))
                } else {
                    Ok(self.cleanup(Following::Error(error)))
                }
            }
            (Stage::TempPath, Response::Temp { path, walk }) => {
                self.attempts += 1;
                self.temporary = path;
                self.walk = walk;
                self.index = 0;
                if self.walk.is_empty() {
                    Ok(self.write())
                } else {
                    self.stage = Stage::TempLink;
                    Ok(Request::InspectLink(self.walk[0].clone()))
                }
            }
            (Stage::Write, Response::Unit) => {
                self.created = true;
                self.stage = Stage::Rename;
                Ok(Request::Rename {
                    from: self.temporary.clone(),
                    to: self.target.clone(),
                })
            }
            (Stage::Rename, Response::Unit) => {
                self.created = false;
                self.stage = Stage::Done;
                self.release_payload();
                Ok(Request::Done)
            }
            (Stage::Cleanup, Response::Unit | Response::Missing) => Ok(self.after_cleanup()),
            _ => Err(text("Unexpected atomic write response")),
        }
    }
}
