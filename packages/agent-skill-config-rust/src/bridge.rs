//! Active skill copies with shared ownership, fingerprints and selective cleanup.
use crate::{
    Catalog, SupportStatus,
    exclude::{self, FsError, Host as ExcludeHost},
    paths::{self, Scope},
    resolve::{self, Host as ResolveHost, Resolution},
    u,
};
use mcp_oauth_rust::Sha256;
use std::collections::{BTreeMap, BTreeSet};
type Fault<H> = <H as ExcludeHost>::Error;
#[derive(Debug)]
pub enum Error<E> {
    Policy { message: Vec<u16>, user: bool },
    Host(E),
}
impl<E> From<exclude::Error<E>> for Error<E> {
    fn from(error: exclude::Error<E>) -> Self {
        match error {
            exclude::Error::Host(error) => Self::Host(error),
            exclude::Error::Policy(message) => Self::Policy {
                message,
                user: false,
            },
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Link,
    Directory,
    File,
    Other,
}
pub struct Relation {
    pub root: Vec<u16>,
    pub target: Vec<u16>,
    pub relative: Vec<u16>,
    pub absolute: bool,
    pub separator: u16,
}
pub enum DirectoryError<E> {
    Ignore(E),
    Other(E),
}
pub trait Host: ExcludeHost + ResolveHost<Error = <Self as ExcludeHost>::Error> {
    fn exists(&mut self, path: &[u16]) -> Result<bool, Fault<Self>>;
    fn bridge_directory(&mut self, path: &[u16]) -> Result<bool, Fault<Self>>;
    fn relation(&mut self, root: &[u16], target: &[u16]) -> Result<Relation, Fault<Self>>;
    fn kind(&mut self, path: &[u16]) -> Result<Kind, Fault<Self>>;
    fn names(&mut self, path: &[u16]) -> Result<Vec<Vec<u16>>, Fault<Self>>;
    fn entries(&mut self, path: &[u16]) -> Result<Vec<(Vec<u16>, Kind)>, Fault<Self>>;
    fn read_bytes(&mut self, path: &[u16]) -> Result<Vec<u8>, Fault<Self>>;
    fn copy_file(&mut self, source: &[u16], target: &[u16]) -> Result<(), Fault<Self>>;
    fn write_token(&mut self, path: &[u16], token: &[u16]) -> Result<(), Fault<Self>>;
    fn uuid(&mut self) -> Result<Vec<u16>, Fault<Self>>;
    fn remove_tree(&mut self, path: &[u16]) -> Result<(), Fault<Self>>;
    fn remove_empty(&mut self, path: &[u16]) -> Result<(), DirectoryError<Fault<Self>>>;
}
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub reference: Vec<u16>,
    pub source_path: Vec<u16>,
    pub target_path: Vec<u16>,
    pub created_parents: Vec<Vec<u16>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WarningKind {
    LocalCollision,
    GlobalCollision,
    SelfReference,
    IntraBatchCollision,
}
impl WarningKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::LocalCollision => "local-collision",
            Self::GlobalCollision => "global-collision",
            Self::SelfReference => "self-reference",
            Self::IntraBatchCollision => "intra-batch-collision",
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Warning {
    pub kind: WarningKind,
    pub reference: Vec<u16>,
    pub source_path: Vec<u16>,
    pub conflicting_path: Vec<u16>,
    pub message: Vec<u16>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Manifest {
    pub spawn_agent_id: Vec<u16>,
    pub cwd: Vec<u16>,
    pub run_id: Vec<u16>,
    pub exclude_block_id: Option<Vec<u16>>,
    pub entries: Vec<Entry>,
    pub warnings: Vec<Warning>,
}
pub struct Request {
    pub spawn_agent: Vec<u16>,
    pub cwd: Vec<u16>,
    pub home: Vec<u16>,
    pub run_id: Vec<u16>,
    pub references: Vec<Vec<u16>>,
}
#[derive(Clone)]
struct Active {
    parents: Vec<Vec<u16>>,
    fingerprint: [u8; 32],
    source_fingerprint: [u8; 32],
    source_path: Vec<u16>,
    references: usize,
    token: Vec<u16>,
}
#[derive(Default)]
pub struct Bridge {
    targets: BTreeMap<Vec<u16>, Active>,
}
fn concat(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
fn policy<E>(parts: &[&[u16]]) -> Error<E> {
    Error::Policy {
        message: concat(parts),
        user: false,
    }
}
fn owned_path<H: Host>(target: &[u16], host: &mut H) -> Result<Vec<u16>, Error<Fault<H>>> {
    ExcludeHost::join(host, target, &u(".poe-code-bridge-owner")).map_err(Error::Host)
}
fn token_matches<H: Host>(
    target: &[u16],
    token: &[u16],
    host: &mut H,
) -> Result<bool, Error<Fault<H>>> {
    let path = owned_path(target, host)?;
    match host.read(&path) {
        Ok(text) => Ok(text == token),
        Err(FsError::NotFound(_)) => Ok(false),
        Err(FsError::Exists(error) | FsError::Other(error)) => Err(Error::Host(error)),
    }
}
fn no_links<H: Host>(root: &[u16], target: &[u16], host: &mut H) -> Result<(), Error<Fault<H>>> {
    let facts = host.relation(root, target).map_err(Error::Host)?;
    if facts.relative.starts_with(&u("..")) || facts.absolute {
        return Err(policy(&[
            &u("Refusing to bridge skills outside root "),
            &facts.root,
            &u(": "),
            &facts.target,
        ]));
    }
    let mut current = facts.root;
    for part in facts.relative.split(|unit| *unit == facts.separator) {
        if part.is_empty() {
            continue;
        }
        current = ExcludeHost::join(host, &current, part).map_err(Error::Host)?;
        match host.symbolic(&current) {
            Ok(true) => {
                return Err(policy(&[
                    &u("Refusing to bridge skills through symbolic link: "),
                    &current,
                ]));
            }
            Ok(false) => {}
            Err(FsError::NotFound(_)) => return Ok(()),
            Err(FsError::Exists(error) | FsError::Other(error)) => return Err(Error::Host(error)),
        }
    }
    Ok(())
}
fn visit<H: Host>(
    path: &[u16],
    relative: &[u16],
    host: &mut H,
    hash: &mut Sha256,
) -> Result<(), Error<Fault<H>>> {
    match host.kind(path).map_err(Error::Host)? {
        Kind::Link => Err(policy(&[
            &u("Refusing to inspect bridged skill through symbolic link: "),
            path,
        ])),
        Kind::Directory => {
            hash.update(
                String::from_utf16_lossy(&concat(&[&u("d:"), relative, &u("\n")])).as_bytes(),
            );
            let mut names = host.names(path).map_err(Error::Host)?;
            names.sort();
            for name in names {
                let child = ExcludeHost::join(host, path, &name).map_err(Error::Host)?;
                let child_relative =
                    ExcludeHost::join(host, relative, &name).map_err(Error::Host)?;
                visit(&child, &child_relative, host, hash)?;
            }
            Ok(())
        }
        Kind::File => {
            hash.update(
                String::from_utf16_lossy(&concat(&[&u("f:"), relative, &u("\n")])).as_bytes(),
            );
            hash.update(&host.read_bytes(path).map_err(Error::Host)?);
            Ok(())
        }
        Kind::Other => Err(policy(&[
            &u("Refusing to bridge unsupported filesystem entry: "),
            path,
        ])),
    }
}
fn fingerprint<H: Host>(path: &[u16], host: &mut H) -> Result<[u8; 32], Error<Fault<H>>> {
    let mut hash = Sha256::new();
    visit(path, &u("."), host, &mut hash)?;
    Ok(hash.finalize())
}
fn copy_directory<H: Host>(
    source: &[u16],
    target: &[u16],
    host: &mut H,
) -> Result<(), Error<Fault<H>>> {
    host.mkdir(target).map_err(Error::Host)?;
    for (name, kind) in host.entries(source).map_err(Error::Host)? {
        let child_source = ExcludeHost::join(host, source, &name).map_err(Error::Host)?;
        let child_target = ExcludeHost::join(host, target, &name).map_err(Error::Host)?;
        match kind {
            Kind::Link => {
                return Err(policy(&[
                    &u("Refusing to bridge skill containing symbolic link: "),
                    &child_source,
                ]));
            }
            Kind::Directory => copy_directory(&child_source, &child_target, host)?,
            Kind::File => host
                .copy_file(&child_source, &child_target)
                .map_err(Error::Host)?,
            Kind::Other => {
                return Err(policy(&[
                    &u("Refusing to bridge unsupported filesystem entry: "),
                    &child_source,
                ]));
            }
        }
    }
    Ok(())
}
fn missing_parents<H: Host>(
    target: &[u16],
    host: &mut H,
) -> Result<Vec<Vec<u16>>, Error<Fault<H>>> {
    let mut parents = vec![];
    let mut current = host.dirname(target).map_err(Error::Host)?;
    while !host.exists(&current).map_err(Error::Host)? {
        parents.push(current.clone());
        let parent = host.dirname(&current).map_err(Error::Host)?;
        if parent == current {
            break;
        }
        current = parent;
    }
    parents.reverse();
    Ok(parents)
}
fn remove_parents<H: Host>(parents: &[Vec<u16>], host: &mut H) -> Result<(), Error<Fault<H>>> {
    for parent in parents.iter().rev() {
        match host.remove_empty(parent) {
            Ok(()) | Err(DirectoryError::Ignore(_)) => {}
            Err(DirectoryError::Other(error)) => return Err(Error::Host(error)),
        }
    }
    Ok(())
}
fn warning(kind: WarningKind, reference: &[u16], source: &[u16], conflict: &[u16]) -> Warning {
    let detail = match kind {
        WarningKind::LocalCollision => "local skill already exists at ",
        WarningKind::GlobalCollision => "global skill already exists at ",
        WarningKind::SelfReference => "spawning agent already sees this native skill at ",
        WarningKind::IntraBatchCollision => "an earlier bridged skill already targets ",
    };
    Warning {
        kind,
        reference: reference.to_vec(),
        source_path: source.to_vec(),
        conflicting_path: conflict.to_vec(),
        message: concat(&[
            &u("Skipping "),
            reference,
            &u(": "),
            &u(detail),
            conflict,
            &u("."),
        ]),
    }
}
fn joined_agents(catalog: &Catalog) -> Vec<u16> {
    catalog.supported_agents().join(&u(", ")[..])
}
pub fn resolution_failure(catalog: &Catalog, failures: &[Resolution]) -> Vec<u16> {
    let mut lines = vec![u(&format!(
        "Failed to bridge active skills: {} skill reference(s) could not be resolved.",
        failures.len()
    ))];
    if failures
        .iter()
        .any(|value| matches!(value, Resolution::Malformed { .. }))
    {
        lines.push(vec![]);
        lines.push(u("Malformed skill references:"));
        for value in failures {
            if let Resolution::Malformed { reference } = value {
                lines.push(concat(&[&u("- "), reference]));
            }
        }
        lines.push(u("Expected syntax: \"<name>\" or \"<agentId>/<name>\"."));
    }
    if failures
        .iter()
        .any(|value| matches!(value, Resolution::UnknownAgent { .. }))
    {
        lines.push(vec![]);
        lines.push(u("Unknown agent references:"));
        for value in failures {
            if let Resolution::UnknownAgent {
                reference,
                agent_input,
            } = value
            {
                lines.push(concat(&[
                    &u("- "),
                    reference,
                    &u(" (agent token: "),
                    agent_input,
                    &u(")"),
                ]));
            }
        }
        lines.push(concat(&[
            &u("Supported agents: "),
            &joined_agents(catalog),
            &u("."),
        ]));
    }
    if failures
        .iter()
        .any(|value| matches!(value, Resolution::NotFound { .. }))
    {
        lines.push(vec![]);
        lines.push(u("Not found skill references."));
        for value in failures {
            if let Resolution::NotFound {
                reference,
                searched_paths,
            } = value
            {
                lines.push(concat(&[&u("- "), reference]));
                lines.push(u("  searched paths:"));
                for path in searched_paths {
                    lines.push(concat(&[&u("  - "), path]));
                }
            }
        }
        lines.push(u(
            "Install one with poe-code skill install <agent> --name <name> --file <path>.",
        ));
    }
    lines.join(&[10][..])
}
impl Bridge {
    pub fn begin<H: Host>(
        &mut self,
        catalog: &Catalog,
        request: Request,
        host: &mut H,
    ) -> Result<Manifest, Error<Fault<H>>> {
        let support = catalog.resolve(&request.spawn_agent);
        let Some(config) = support
            .config
            .filter(|_| support.status == SupportStatus::Supported)
        else {
            return Err(policy(&[
                &u("Unsupported spawn agent \""),
                &request.spawn_agent,
                &u("\". Supported agents: "),
                &joined_agents(catalog),
                &u("."),
            ]));
        };
        let target_dir = resolve::execute(
            paths::plan_skill_dir(config, Scope::Local, &request.cwd, &request.home),
            host,
        )
        .map_err(Error::Host)?;
        let global_dir = resolve::execute(
            paths::plan_skill_dir(config, Scope::Global, &request.cwd, &request.home),
            host,
        )
        .map_err(Error::Host)?;
        let resolutions = request
            .references
            .iter()
            .map(|reference| {
                resolve::resolve_skill_reference(
                    catalog,
                    reference,
                    &request.cwd,
                    &request.home,
                    host,
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(Error::Host)?;
        let failures = resolutions
            .iter()
            .filter(|value| !matches!(value, Resolution::Resolved { .. }))
            .cloned()
            .collect::<Vec<_>>();
        if !failures.is_empty() {
            return Err(Error::Policy {
                message: resolution_failure(catalog, &failures),
                user: true,
            });
        }
        let mut sources = vec![];
        for resolution in resolutions {
            if let Resolution::Resolved {
                reference,
                name,
                source_agent_id,
                source_path,
                scope,
            } = resolution
            {
                let target =
                    ResolveHost::resolve(host, &[&target_dir, &name]).map_err(Error::Host)?;
                let global =
                    ResolveHost::resolve(host, &[&global_dir, &name]).map_err(Error::Host)?;
                sources.push((
                    reference,
                    source_agent_id,
                    source_path,
                    scope,
                    target,
                    global,
                ));
            }
        }
        let mut manifest = Manifest {
            spawn_agent_id: request.spawn_agent,
            cwd: request.cwd,
            run_id: request.run_id,
            exclude_block_id: None,
            entries: vec![],
            warnings: vec![],
        };
        let mut claimed = BTreeSet::new();
        let outcome = (|| {
            for (reference, source_agent, source, scope, target, global) in sources {
                if claimed.contains(&target) {
                    manifest.warnings.push(warning(
                        WarningKind::IntraBatchCollision,
                        &reference,
                        &source,
                        &target,
                    ));
                    continue;
                }
                if source_agent.is_some() && source_agent == support.id {
                    manifest.warnings.push(warning(
                        WarningKind::SelfReference,
                        &reference,
                        &source,
                        &source,
                    ));
                    continue;
                }
                if let Some(active) = self.targets.get(&target).cloned()
                    && host.exists(&target).map_err(Error::Host)?
                {
                    if active.source_path == source {
                        no_links(
                            if scope == Scope::Local {
                                &manifest.cwd
                            } else {
                                &request.home
                            },
                            &source,
                            host,
                        )?;
                        let source_hash = fingerprint(&source, host)?;
                        if source_hash == active.source_fingerprint
                            && token_matches(&target, &active.token, host)?
                            && fingerprint(&target, host)? == active.fingerprint
                        {
                            self.targets
                                .get_mut(&target)
                                .expect("live target")
                                .references += 1;
                            claimed.insert(target.clone());
                            manifest.entries.push(Entry {
                                reference,
                                source_path: source,
                                target_path: target,
                                created_parents: vec![],
                            });
                            continue;
                        }
                        manifest.warnings.push(warning(
                            WarningKind::LocalCollision,
                            &reference,
                            &source,
                            &target,
                        ));
                        continue;
                    }
                    self.targets.remove(&target);
                }
                if host.exists(&target).map_err(Error::Host)? {
                    manifest.warnings.push(warning(
                        WarningKind::LocalCollision,
                        &reference,
                        &source,
                        &target,
                    ));
                    continue;
                }
                if host.bridge_directory(&global).map_err(Error::Host)? {
                    manifest.warnings.push(warning(
                        WarningKind::GlobalCollision,
                        &reference,
                        &source,
                        &global,
                    ));
                    continue;
                }
                no_links(
                    if scope == Scope::Local {
                        &manifest.cwd
                    } else {
                        &request.home
                    },
                    &source,
                    host,
                )?;
                let source_hash = fingerprint(&source, host)?;
                let parents = missing_parents(&target, host)?;
                let parent = host.dirname(&target).map_err(Error::Host)?;
                no_links(&manifest.cwd, &parent, host)?;
                host.mkdir(&parent).map_err(Error::Host)?;
                let token = host.uuid().map_err(Error::Host)?;
                let copied = (|| {
                    copy_directory(&source, &target, host)?;
                    let owner = owned_path(&target, host)?;
                    host.write_token(&owner, &token).map_err(Error::Host)?;
                    fingerprint(&target, host)
                })();
                let hash = match copied {
                    Ok(hash) => hash,
                    Err(error) => {
                        host.remove_tree(&target).map_err(Error::Host)?;
                        remove_parents(&parents, host)?;
                        return Err(error);
                    }
                };
                claimed.insert(target.clone());
                manifest.entries.push(Entry {
                    reference,
                    source_path: source.clone(),
                    target_path: target.clone(),
                    created_parents: parents.clone(),
                });
                self.targets.insert(
                    target,
                    Active {
                        parents,
                        fingerprint: hash,
                        source_fingerprint: source_hash,
                        source_path: source,
                        references: 1,
                        token,
                    },
                );
            }
            if !manifest.entries.is_empty() {
                let mut paths = vec![];
                for entry in &manifest.entries {
                    paths.push(
                        host.relation(&manifest.cwd, &entry.target_path)
                            .map_err(Error::Host)?
                            .relative,
                    );
                }
                manifest.exclude_block_id =
                    exclude::append_file(&manifest.cwd, &manifest.run_id, &paths, None, host)?;
            }
            Ok(())
        })();
        if let Err(error) = outcome {
            self.rollback(&manifest.entries, host)?;
            return Err(error);
        }
        Ok(manifest)
    }
    fn rollback<H: Host>(
        &mut self,
        entries: &[Entry],
        host: &mut H,
    ) -> Result<(), Error<Fault<H>>> {
        for entry in entries.iter().rev() {
            if let Some(active) = self.targets.get_mut(&entry.target_path)
                && active.references > 1
            {
                active.references -= 1;
                continue;
            }
            let parents = self
                .targets
                .remove(&entry.target_path)
                .map_or_else(|| entry.created_parents.clone(), |active| active.parents);
            host.remove_tree(&entry.target_path).map_err(Error::Host)?;
            remove_parents(&parents, host)?;
        }
        Ok(())
    }
    /// Hidden state/cleaned admission is the binding host's responsibility.
    pub fn cleanup<H: Host>(
        &mut self,
        cwd: &[u16],
        run: &[u16],
        exclude: Option<&[u16]>,
        targets: &[Vec<u16>],
        host: &mut H,
    ) -> Result<(), Error<Fault<H>>> {
        exclude::remove_file(cwd, exclude.unwrap_or(run), None, host)?;
        for target in targets {
            let Some(active) = self.targets.get_mut(target) else {
                continue;
            };
            if active.references > 1 {
                active.references -= 1;
                continue;
            }
            let active = self.targets.remove(target).expect("live target");
            if host.exists(target).map_err(Error::Host)?
                && token_matches(target, &active.token, host)?
                && fingerprint(target, host)? == active.fingerprint
            {
                host.remove_tree(target).map_err(Error::Host)?;
                remove_parents(&active.parents, host)?;
            }
        }
        Ok(())
    }
}
