//! Testing filesystem policy. Host-visible files, directory Sets and platform
//! path/Buffer behavior remain injected; owned admission and errors stay here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Read,
    Write,
    Mkdir,
    Unlink,
    Rename,
    Stat,
    Lstat,
    List,
    Chmod,
    Exists,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub code: &'static str,
    pub message: Vec<u16>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Read,
    Write,
    Mkdir(bool),
    Delete,
    Rename,
    Stat(u32),
    Link,
    List,
    Noop,
    Exists(bool),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    Exclusive,
    Recursive,
    File,
    Directory,
    Parent,
    Done(Action),
    Error(Error),
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    New,
    Exclusive,
    Recursive,
    File,
    Directory,
    Parent,
    Done,
}
pub struct MockMachine {
    operation: Operation,
    target: Vec<u16>,
    stage: Stage,
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
impl MockMachine {
    pub fn new(operation: Operation, target: Vec<u16>) -> Self {
        Self {
            operation,
            target,
            stage: Stage::New,
        }
    }
    pub fn start(&mut self) -> Result<Request, Vec<u16>> {
        if self.stage != Stage::New {
            return Err(u("Mock operation already started"));
        }
        Ok(match self.operation {
            Operation::Write => {
                self.stage = Stage::Exclusive;
                Request::Exclusive
            }
            Operation::Mkdir => {
                self.stage = Stage::Recursive;
                Request::Recursive
            }
            _ => {
                self.stage = Stage::File;
                Request::File
            }
        })
    }
    fn done(&mut self, action: Action) -> Request {
        self.target = vec![];
        self.stage = Stage::Done;
        Request::Done(action)
    }
    fn error(&mut self, code: &'static str, description: &str) -> Request {
        let method = match self.operation {
            Operation::Read | Operation::Write => "open",
            Operation::Mkdir => "mkdir",
            Operation::Unlink => "unlink",
            Operation::Rename => "rename",
            Operation::Stat => "stat",
            Operation::Lstat => "lstat",
            Operation::List => "scandir",
            Operation::Chmod => "chmod",
            Operation::Exists => unreachable!(),
        };
        let mut message = u(&format!("{code}: {description}, {method} '"));
        message.append(&mut self.target);
        message.push(39);
        self.target = vec![];
        self.stage = Stage::Done;
        Request::Error(Error { code, message })
    }
    fn parent(&mut self) -> Request {
        self.stage = Stage::Parent;
        Request::Parent
    }
    pub fn respond(&mut self, flag: bool) -> Result<Request, Vec<u16>> {
        Ok(match self.stage {
            Stage::Exclusive => {
                if flag {
                    self.stage = Stage::File;
                    Request::File
                } else {
                    self.parent()
                }
            }
            Stage::Recursive => {
                if flag {
                    self.done(Action::Mkdir(true))
                } else {
                    self.parent()
                }
            }
            Stage::Parent => {
                if !flag {
                    self.error("ENOENT", "no such file or directory")
                } else if self.operation == Operation::Mkdir {
                    self.done(Action::Mkdir(false))
                } else {
                    self.done(Action::Write)
                }
            }
            Stage::File => match self.operation {
                Operation::Write => {
                    if flag {
                        self.error("EEXIST", "file already exists")
                    } else {
                        self.parent()
                    }
                }
                Operation::Read | Operation::Unlink | Operation::Rename => {
                    if !flag {
                        self.error("ENOENT", "no such file or directory")
                    } else {
                        self.done(match self.operation {
                            Operation::Read => Action::Read,
                            Operation::Unlink => Action::Delete,
                            _ => Action::Rename,
                        })
                    }
                }
                Operation::List if flag => self.error("ENOTDIR", "not a directory"),
                Operation::Stat | Operation::Lstat | Operation::Chmod | Operation::Exists
                    if flag =>
                {
                    self.done(match self.operation {
                        Operation::Stat => Action::Stat(0o644),
                        Operation::Lstat => Action::Link,
                        Operation::Chmod => Action::Noop,
                        _ => Action::Exists(true),
                    })
                }
                Operation::Stat
                | Operation::Lstat
                | Operation::List
                | Operation::Chmod
                | Operation::Exists => {
                    self.stage = Stage::Directory;
                    Request::Directory
                }
                Operation::Mkdir => return Err(u("Unexpected mock file admission")),
            },
            Stage::Directory => {
                if self.operation == Operation::Exists {
                    self.done(Action::Exists(flag))
                } else if !flag {
                    self.error("ENOENT", "no such file or directory")
                } else {
                    self.done(match self.operation {
                        Operation::Stat => Action::Stat(0o755),
                        Operation::Lstat => Action::Link,
                        Operation::List => Action::List,
                        Operation::Chmod => Action::Noop,
                        _ => return Err(u("Unexpected mock directory admission")),
                    })
                }
            }
            _ => return Err(u("Unexpected mock admission response")),
        })
    }
}
pub fn directory_parts(path: &[u16], separator: u16) -> Vec<Vec<u16>> {
    path.split(|unit| *unit == separator)
        .filter(|part| !part.is_empty())
        .map(|part| part.to_vec())
        .collect()
}
