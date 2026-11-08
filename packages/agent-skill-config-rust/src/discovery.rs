//! Async-host skill discovery: ordered traversal, file admission and deduplication.
use crate::u;
use std::collections::BTreeSet;

#[derive(Debug, PartialEq)]
pub enum Request {
    Root(Vec<u16>),
    Names(Vec<u16>),
    Child { root: Vec<u16>, name: Vec<u16> },
    FilePath { root: Vec<u16>, name: Vec<u16> },
    File(Vec<u16>),
    Read { name: Vec<u16>, file: Vec<u16> },
    Done,
}

/// Content remains with the host; only successfully read file paths are retained.
#[derive(Default)]
pub struct Machine {
    seen: BTreeSet<Vec<u16>>,
    root: Vec<u16>,
    names: std::vec::IntoIter<Vec<u16>>,
    name: Vec<u16>,
    file: Vec<u16>,
    listing: bool,
}
impl Machine {
    pub fn start(&mut self, root: Vec<u16>) -> Request {
        self.root = root;
        self.names = Vec::new().into_iter();
        self.listing = true;
        Request::Root(self.root.clone())
    }
    pub fn root(&self, symbolic: bool) -> Result<Request, Vec<u16>> {
        if symbolic {
            let mut error = u("Skill directory must not be a symbolic link: ");
            error.extend(&self.root);
            Err(error)
        } else {
            Ok(Request::Names(self.root.clone()))
        }
    }
    pub fn names(&mut self, mut names: Vec<Vec<u16>>) -> Request {
        names.sort();
        self.names = names.into_iter();
        self.listing = false;
        self.advance()
    }
    fn advance(&mut self) -> Request {
        match self.names.next() {
            Some(name) => {
                self.name = name;
                Request::Child {
                    root: self.root.clone(),
                    name: self.name.clone(),
                }
            }
            None => Request::Done,
        }
    }
    pub fn directory(&mut self, directory: bool) -> Request {
        if directory {
            Request::FilePath {
                root: self.root.clone(),
                name: self.name.clone(),
            }
        } else {
            self.advance()
        }
    }
    pub fn file(&mut self, file: Vec<u16>) -> Request {
        if self.seen.contains(&file) {
            self.advance()
        } else {
            self.file = file;
            Request::File(self.file.clone())
        }
    }
    pub fn regular(&self, regular: bool) -> Result<Request, Vec<u16>> {
        if regular {
            Ok(Request::Read {
                name: self.name.clone(),
                file: self.file.clone(),
            })
        } else {
            let mut error = u("Skill file must be a regular file: ");
            error.extend(&self.file);
            Err(error)
        }
    }
    pub fn loaded(&mut self) -> Request {
        self.seen.insert(self.file.clone());
        self.advance()
    }
    pub fn missing(&mut self) -> Request {
        if self.listing {
            Request::Done
        } else {
            self.advance()
        }
    }
}
