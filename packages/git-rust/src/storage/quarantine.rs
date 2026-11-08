//! Incoming push objects stay outside the repository object store until accepted.
use std::{
    cell::RefCell,
    collections::BTreeMap,
    sync::atomic::{AtomicU64, Ordering},
};

use crate::fs::MemoryFs;

thread_local! {
    static INCOMING: RefCell<BTreeMap<String, String>> = const { RefCell::new(BTreeMap::new()) };
}
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

pub(crate) struct ObjectQuarantine {
    fs: MemoryFs,
    remote_gitdir: String,
    gitdir: String,
    previous: Option<String>,
}

impl ObjectQuarantine {
    pub(crate) fn new(fs: &MemoryFs, remote_gitdir: &str) -> Self {
        let gitdir = loop {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path = format!("{remote_gitdir}/incoming-{id}");
            if !fs.exists(&path) {
                break path;
            }
        };
        let previous = INCOMING.with(|incoming| {
            incoming
                .borrow_mut()
                .insert(remote_gitdir.to_string(), gitdir.clone())
        });
        Self {
            fs: fs.clone(),
            remote_gitdir: remote_gitdir.to_string(),
            gitdir,
            previous,
        }
    }

    pub(crate) fn gitdir(&self) -> &str {
        &self.gitdir
    }
}

impl Drop for ObjectQuarantine {
    fn drop(&mut self) {
        INCOMING.with(|incoming| {
            let mut incoming = incoming.borrow_mut();
            if let Some(previous) = self.previous.take() {
                incoming.insert(self.remote_gitdir.clone(), previous);
            } else {
                incoming.remove(&self.remote_gitdir);
            }
        });
        let _ = self.fs.rm_recursive(&self.gitdir);
    }
}

pub(super) fn read_incoming(fs: &MemoryFs, gitdir: &str, source: &str) -> Option<Vec<u8>> {
    INCOMING.with(|incoming| {
        let incoming = incoming.borrow();
        let path = incoming.get(gitdir)?;
        fs.read(&format!("{path}/{source}"))
    })
}
