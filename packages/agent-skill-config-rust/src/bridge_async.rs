//! Capability-driven async skill ownership. Hosts poll effects on their own event
//! loop; no executor, thread, platform I/O or external dependency is required.
use crate::{Catalog, SupportStatus, bridge::WarningKind, u};
use mcp_oauth_rust::Sha256;
use mcp_protocol_rust::json::Value as J;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    future::Future,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};

#[derive(Clone, Debug, PartialEq)]
pub enum Fault {
    Foreign(u32),
    Policy(Vec<u16>),
}
type Result<T> = std::result::Result<T, Fault>;
pub enum Reply {
    Value(J),
    Bytes(Vec<u8>),
    Error(u32),
}
pub struct Request {
    pub operation: &'static str,
    pub args: Vec<J>,
    pub io: usize,
}
pub enum Step {
    Request(Request),
    Done(Result<()>),
}
#[derive(Default)]
struct Channel {
    request: Option<Request>,
    reply: Option<Reply>,
}
struct Effect {
    channel: Rc<RefCell<Channel>>,
    request: Option<Request>,
}
impl Future for Effect {
    type Output = Reply;
    fn poll(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Reply> {
        if let Some(request) = self.request.take() {
            self.channel.borrow_mut().request = Some(request);
            return Poll::Pending;
        }
        self.channel
            .borrow_mut()
            .reply
            .take()
            .map_or(Poll::Pending, Poll::Ready)
    }
}
#[derive(Clone)]
struct Host {
    channel: Rc<RefCell<Channel>>,
    io: usize,
}
pub struct Machine {
    channel: Rc<RefCell<Channel>>,
    future: Option<Pin<Box<dyn Future<Output = Result<()>>>>>,
}
impl Machine {
    fn new<F, T>(start: F) -> Self
    where
        F: FnOnce(Host) -> T,
        T: Future<Output = Result<()>> + 'static,
    {
        let channel = Rc::new(RefCell::new(Channel::default()));
        let future = Box::pin(start(Host {
            channel: channel.clone(),
            io: 0,
        }));
        Self {
            channel,
            future: Some(future),
        }
    }
    pub fn step(&mut self, reply: Option<Reply>) -> Step {
        self.channel.borrow_mut().reply = reply;
        let Some(future) = self.future.as_mut() else {
            return Step::Done(Err(policy("Async bridge already completed")));
        };
        match future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
        {
            Poll::Ready(result) => {
                self.future = None;
                Step::Done(result)
            }
            Poll::Pending => match self.channel.borrow_mut().request.take() {
                Some(request) => Step::Request(request),
                None => Step::Done(Err(policy("Async bridge requires a host response"))),
            },
        }
    }
}
fn policy(message: &str) -> Fault {
    Fault::Policy(u(message))
}
fn string(value: &[u16]) -> J {
    J::String(value.to_vec())
}
fn text(value: &str) -> J {
    J::String(u(value))
}
fn object(fields: Vec<(&str, J)>) -> J {
    J::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn as_string(value: J) -> Result<Vec<u16>> {
    if let J::String(value) = value {
        Ok(value)
    } else {
        Err(policy("Expected async bridge string"))
    }
}
fn field(value: &J, key: &str) -> Result<Vec<u16>> {
    as_string(value.get(key).cloned().unwrap_or(J::Null))
}
fn array(value: J) -> Result<Vec<J>> {
    if let J::Array(value) = value {
        Ok(value)
    } else {
        Err(policy("Expected async bridge array"))
    }
}
impl Host {
    async fn effect(&self, operation: &'static str, args: Vec<J>) -> Result<Reply> {
        match (Effect {
            channel: self.channel.clone(),
            request: Some(Request {
                operation,
                args,
                io: self.io,
            }),
        })
        .await
        {
            Reply::Error(id) => Err(Fault::Foreign(id)),
            reply => Ok(reply),
        }
    }
    async fn value(&self, operation: &'static str, args: Vec<J>) -> Result<J> {
        match self.effect(operation, args).await? {
            Reply::Value(value) => Ok(value),
            _ => Err(policy("Expected async bridge value response")),
        }
    }
    async fn unit(&self, operation: &'static str, args: Vec<J>) -> Result<()> {
        self.value(operation, args).await.map(|_| ())
    }
    async fn path(&self, operation: &'static str, args: Vec<J>) -> Result<Vec<u16>> {
        as_string(self.value(operation, args).await?)
    }
    async fn acquire(&self, rollback: bool) -> Result<Self> {
        let value = self.value("acquire", vec![J::Bool(rollback)]).await?;
        match value {
            J::Number(id) if id >= 0.0 && id.fract() == 0.0 && id <= usize::MAX as f64 => {
                Ok(Self {
                    channel: self.channel.clone(),
                    io: id as usize,
                })
            }
            _ => Err(policy("Expected async bridge filesystem handle")),
        }
    }
    async fn admits(&self, error: &Fault, codes: &[&str]) -> Result<bool> {
        let error = match error {
            Fault::Foreign(id) => object(vec![("foreignError", J::Number(f64::from(*id)))]),
            Fault::Policy(message) => object(vec![("error", string(message))]),
        };
        Ok(self
            .value(
                "admit",
                vec![
                    error,
                    J::Array(codes.iter().map(|code| text(code)).collect()),
                ],
            )
            .await?
            == J::Bool(true))
    }
    async fn exists(&self, target: &[u16]) -> Result<bool> {
        match self.unit("existsStat", vec![string(target)]).await {
            Ok(()) => Ok(true),
            Err(error) => {
                if self.admits(&error, &["ENOENT"]).await? {
                    Ok(false)
                } else {
                    Err(error)
                }
            }
        }
    }
    async fn inspect(&self, target: &[u16]) -> Result<()> {
        let mut current = target.to_vec();
        loop {
            let result = match self.value("symbolic", vec![string(&current)]).await {
                Ok(J::Bool(true)) => Err(Fault::Policy(
                    [
                        u("Refusing to bridge through symbolic link: "),
                        current.clone(),
                    ]
                    .concat(),
                )),
                Ok(_) => Ok(()),
                Err(error) => Err(error),
            };
            if let Err(error) = result
                && !self.admits(&error, &["ENOENT"]).await?
            {
                return Err(error);
            }
            let parent = self.path("dirname", vec![string(&current)]).await?;
            if parent == current {
                return Ok(());
            }
            current = parent;
        }
    }
    async fn fingerprint(&self, target: &[u16]) -> Result<[u8; 32]> {
        enum Walk {
            Visit(Vec<u16>, Vec<u16>),
            Children(Vec<u16>, Vec<u16>, std::vec::IntoIter<Vec<u16>>),
        }
        let mut hash = Sha256::new();
        let mut work = vec![Walk::Visit(target.to_vec(), u("."))];
        while let Some(item) = work.pop() {
            match item {
                Walk::Visit(current, relative) => {
                    let kind = self.path("kind", vec![string(&current)]).await?;
                    if kind == u("directory") {
                        hash.update(
                            String::from_utf16_lossy(
                                &[u("d:"), relative.clone(), u("\n")].concat(),
                            )
                            .as_bytes(),
                        );
                        let mut names = array(self.value("names", vec![string(&current)]).await?)?
                            .into_iter()
                            .map(as_string)
                            .collect::<Result<Vec<_>>>()?;
                        names.sort();
                        work.push(Walk::Children(current, relative, names.into_iter()));
                    } else if kind == u("file") {
                        hash.update(
                            String::from_utf16_lossy(&[u("f:"), relative, u("\n")].concat())
                                .as_bytes(),
                        );
                        let Reply::Bytes(bytes) =
                            self.effect("readBytes", vec![string(&current)]).await?
                        else {
                            return Err(policy("Expected async bridge file bytes"));
                        };
                        hash.update(&bytes);
                    } else {
                        return Err(Fault::Policy(
                            [u("Unsupported skill entry or symbolic link: "), current].concat(),
                        ));
                    }
                }
                Walk::Children(parent, relative, mut names) => {
                    if let Some(name) = names.next() {
                        let current = self
                            .path("join", vec![string(&parent), string(&name)])
                            .await?;
                        let child_relative = self
                            .path("join", vec![string(&relative), string(&name)])
                            .await?;
                        work.push(Walk::Children(parent, relative, names));
                        work.push(Walk::Visit(current, child_relative));
                    }
                }
            }
        }
        Ok(hash.finalize())
    }
    async fn copy_contents(&self, source: &[u16], target: &[u16]) -> Result<()> {
        let handle = self.value("readEntries", vec![string(source)]).await?;
        let result = async {
            loop {
                let entry = self
                    .value(
                        "copyEntry",
                        vec![handle.clone(), string(source), string(target)],
                    )
                    .await?;
                if entry == J::Null {
                    break;
                }
                let from = field(&entry, "from")?;
                let to = field(&entry, "to")?;
                let kind = field(&entry, "kind")?;
                if kind == u("directory") {
                    self.unit("mkdir", vec![string(&to), J::Bool(false)])
                        .await?;
                    Box::pin(self.copy_contents(&from, &to)).await?;
                } else if kind == u("file") {
                    self.unit("copyFile", vec![string(&from), string(&to)])
                        .await?;
                } else {
                    return Err(Fault::Policy(
                        [u("Unsupported skill entry or symbolic link: "), from].concat(),
                    ));
                }
            }
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = self.unit("closeEntries", vec![handle]).await;
        }
        result
    }
    async fn remove(&self, target: &[u16], parents: &[Vec<u16>]) -> Result<()> {
        self.inspect(target).await?;
        self.unit("removeTree", vec![string(target)]).await?;
        for parent in parents.iter().rev() {
            if let Err(error) = self.unit("rmdir", vec![string(parent)]).await
                && !self
                    .admits(&error, &["ENOENT", "ENOTEMPTY", "EEXIST"])
                    .await?
            {
                return Err(error);
            }
        }
        Ok(())
    }
    async fn unchanged(&self, target: &[u16], owned: &Owned) -> Result<bool> {
        if !self.exists(target).await? {
            return Ok(false);
        }
        self.inspect(target).await?;
        let result = async {
            let owner = self
                .path("join", vec![string(target), text(".poe-code-bridge-owner")])
                .await?;
            if self.path("readText", vec![string(&owner)]).await? != owned.token {
                return Ok(false);
            }
            Ok(self.fingerprint(target).await? == owned.fingerprint)
        }
        .await;
        match result {
            Err(error) => {
                if self.admits(&error, &["ENOENT"]).await? {
                    Ok(false)
                } else {
                    Err(error)
                }
            }
            result => result,
        }
    }
}
#[derive(Clone)]
struct Owned {
    token: Vec<u16>,
    fingerprint: [u8; 32],
    source_fingerprint: [u8; 32],
    source_path: Vec<u16>,
    references: usize,
    parents: Vec<Vec<u16>>,
}
#[derive(Clone, Default)]
pub struct Bridge {
    targets: Rc<RefCell<BTreeMap<Vec<u16>, Owned>>>,
}
impl Bridge {
    pub fn begin(&self, spawn: Vec<u16>, run: Vec<u16>) -> Machine {
        let bridge = self.clone();
        Machine::new(move |host| async move { bridge.begin_inner(host, spawn, run).await })
    }
    pub fn cleanup(&self) -> Machine {
        let bridge = self.clone();
        Machine::new(move |host| async move {
            let block = host.value("blockId", vec![]).await?;
            if matches!(&block,J::String(value) if !value.is_empty()) {
                host.unit("removeExclude", vec![block]).await?;
            }
            let io = host.acquire(false).await?;
            bridge.release(&io).await?;
            host.unit("cleaned", vec![]).await
        })
    }
    async fn release(&self, io: &Host) -> Result<()> {
        io.unit("releaseStart", vec![]).await?;
        loop {
            let value = io.value("releaseNext", vec![]).await?;
            if value == J::Null {
                break;
            }
            let target = as_string(value)?;
            let owned = self.targets.borrow().get(&target).cloned();
            let Some(owned) = owned else {
                continue;
            };
            if owned.references > 1 {
                if let Some(entry) = self.targets.borrow_mut().get_mut(&target) {
                    entry.references -= 1;
                }
                continue;
            }
            let target = io.path("releasePath", vec![]).await?;
            if io.unchanged(&target, &owned).await? {
                let target = io.path("releasePath", vec![]).await?;
                io.remove(&target, &owned.parents).await?;
            }
            let target = io.path("releasePath", vec![]).await?;
            self.targets.borrow_mut().remove(&target);
        }
        Ok(())
    }
    async fn begin_inner(&self, host: Host, spawn: Vec<u16>, run: Vec<u16>) -> Result<()> {
        let catalog = Catalog::builtins().map_err(Fault::Policy)?;
        let support = catalog.resolve(&spawn);
        if support.status != SupportStatus::Supported {
            return Err(Fault::Policy(
                [u("Unsupported spawn agent: "), spawn].concat(),
            ));
        }
        let config = support
            .config
            .expect("supported skill configuration")
            .raw
            .clone();
        let id = support.id.expect("supported skill id");
        let io = host.acquire(false).await?;
        let resolutions = array(host.value("resolveRefs", vec![]).await?)?;
        for source in &resolutions {
            let kind = field(source, "kind")?;
            if kind != u("resolved") {
                return Err(Fault::Policy(
                    [
                        u("Failed to resolve skill "),
                        field(source, "ref")?,
                        u(": "),
                        kind,
                    ]
                    .concat(),
                ));
            }
        }
        let uuid = host.value("uuid", vec![]).await?;
        host.unit("manifest", vec![uuid, string(&spawn), string(&run)])
            .await?;
        let mut claimed = BTreeSet::new();
        let result = async {
            for source in resolutions {
                let source_path = field(&source, "sourcePath")?;
                let reference = field(&source, "ref")?;
                let name = field(&source, "name")?;
                let target = host
                    .path(
                        "skillPath",
                        vec![config.clone(), text("local"), string(&name)],
                    )
                    .await?;
                let global = host
                    .path(
                        "skillPath",
                        vec![config.clone(), text("global"), string(&name)],
                    )
                    .await?;
                let mut collision = if claimed.contains(&target) {
                    Some(WarningKind::IntraBatchCollision)
                } else if source.get("sourceAgentId") == Some(&string(&id)) {
                    Some(WarningKind::SelfReference)
                } else {
                    None
                };
                io.inspect(&source_path).await?;
                let source_fingerprint = io.fingerprint(&source_path).await?;
                let owned = self.targets.borrow().get(&target).cloned();
                if collision.is_none()
                    && let Some(owned) = owned
                    && owned.source_path == source_path
                    && owned.source_fingerprint == source_fingerprint
                    && io.unchanged(&target, &owned).await?
                {
                    if let Some(entry) = self.targets.borrow_mut().get_mut(&target) {
                        entry.references += 1;
                    }
                    claimed.insert(target.clone());
                    host.unit("entry", vec![entry(&reference, &source_path, &target, &[])])
                        .await?;
                    continue;
                }
                if collision.is_none() && io.exists(&target).await? {
                    collision = Some(WarningKind::LocalCollision);
                }
                if collision.is_none() && io.exists(&global).await? {
                    collision = Some(WarningKind::GlobalCollision);
                }
                if let Some(kind) = collision {
                    let conflicting = if kind == WarningKind::GlobalCollision {
                        &global
                    } else {
                        &target
                    };
                    host.unit(
                        "warning",
                        vec![object(vec![
                            ("kind", text(kind.name())),
                            ("ref", string(&reference)),
                            ("sourcePath", string(&source_path)),
                            ("conflictingPath", string(conflicting)),
                            (
                                "message",
                                J::String(
                                    [
                                        u("Skipping "),
                                        reference.clone(),
                                        u(": "),
                                        u(kind.name()),
                                        u(" at "),
                                        conflicting.clone(),
                                        u("."),
                                    ]
                                    .concat(),
                                ),
                            ),
                        ])],
                    )
                    .await?;
                    continue;
                }
                io.inspect(&target).await?;
                let mut parents = vec![];
                let mut parent = io.path("dirname", vec![string(&target)]).await?;
                while !io.exists(&parent).await? {
                    parents.insert(0, parent.clone());
                    parent = io.path("dirname", vec![string(&parent)]).await?;
                }
                let parent = io.path("dirname", vec![string(&target)]).await?;
                io.unit("mkdir", vec![string(&parent), J::Bool(true)])
                    .await?;
                let mut created = false;
                let copy = async {
                    io.unit("mkdir", vec![string(&target), J::Bool(false)])
                        .await?;
                    created = true;
                    io.copy_contents(&source_path, &target).await?;
                    let token = host.path("uuid", vec![]).await?;
                    let owner = io
                        .path(
                            "join",
                            vec![string(&target), text(".poe-code-bridge-owner")],
                        )
                        .await?;
                    io.unit("writeToken", vec![string(&owner), string(&token)])
                        .await?;
                    let fingerprint = io.fingerprint(&target).await?;
                    self.targets.borrow_mut().insert(
                        target.clone(),
                        Owned {
                            token,
                            fingerprint,
                            source_fingerprint,
                            source_path: source_path.clone(),
                            references: 1,
                            parents: parents.clone(),
                        },
                    );
                    claimed.insert(target.clone());
                    host.unit(
                        "entry",
                        vec![entry(&reference, &source_path, &target, &parents)],
                    )
                    .await
                }
                .await;
                if let Err(error) = copy {
                    if created {
                        host.acquire(true).await?.remove(&target, &parents).await?;
                    }
                    return Err(error);
                }
            }
            let entries = host.value("excludePaths", vec![]).await?;
            let block = host
                .value("appendExclude", vec![string(&run), entries])
                .await?;
            host.unit("complete", vec![block]).await
        }
        .await;
        if let Err(error) = result {
            self.release(&host.acquire(true).await?).await?;
            return Err(error);
        }
        Ok(())
    }
}
fn entry(reference: &[u16], source: &[u16], target: &[u16], parents: &[Vec<u16>]) -> J {
    object(vec![
        ("ref", string(reference)),
        ("sourcePath", string(source)),
        ("targetPath", string(target)),
        (
            "createdParents",
            J::Array(parents.iter().map(|path| string(path)).collect()),
        ),
    ])
}
