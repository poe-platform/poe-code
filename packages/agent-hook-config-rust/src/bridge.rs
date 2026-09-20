//! Hook bridge lifecycle with platform I/O and reusable Git-exclude policies.
use crate::{
    Catalog, Config, Handler, SourceEntry,
    files::{self, Record},
    io::{self, FileHost, FsError, ReadScope},
    lifecycle::{self, Owners, PriorGroups},
    links::{self, LinkHost},
    message, u,
};
use agent_skill_config_rust::exclude::{self, Host as ExcludeHost};
use mcp_protocol_rust::json::Value;
pub const EXCLUDE_PREFIX: &str = "poe-code-spawn-hooks";
#[derive(Debug)]
pub enum Error<E> {
    Policy(Vec<u16>),
    Host(E),
    MalformedJson { path: Vec<u16>, content: Vec<u16> },
    Link(links::Error<E>),
}
impl<E> From<io::Error<E>> for Error<E> {
    fn from(error: io::Error<E>) -> Self {
        match error {
            io::Error::Policy(message) => Self::Policy(message),
            io::Error::Host(error) => Self::Host(error),
            io::Error::MalformedJson { path, content } => Self::MalformedJson { path, content },
        }
    }
}
impl<E> From<exclude::Error<E>> for Error<E> {
    fn from(error: exclude::Error<E>) -> Self {
        match error {
            exclude::Error::Policy(message) => Self::Policy(message),
            exclude::Error::Host(error) => Self::Host(error),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrategyRequest {
    Auto,
    Symlink,
    Transform,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strategy {
    Symlink,
    Transform,
    Skip,
}
pub struct Agent {
    pub input: Vec<u16>,
    pub id: Option<Vec<u16>>,
    pub config: Option<Config>,
}
pub struct Request {
    pub source: Agent,
    pub target: Agent,
    pub cwd: Vec<u16>,
    pub home: Vec<u16>,
    pub run_id: Vec<u16>,
    pub strategy: StrategyRequest,
    pub scope: ReadScope,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Drop {
    pub reason: &'static str,
    pub detail: Vec<u16>,
    pub source: Record,
}
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub ownership_id: Vec<u16>,
    pub exclude_block_id: Option<Vec<u16>>,
    pub cleaned: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Manifest {
    pub source_agent_id: Vec<u16>,
    pub target_agent_id: Vec<u16>,
    pub cwd: Vec<u16>,
    pub run_id: Vec<u16>,
    pub strategy: Strategy,
    pub drops: Vec<Drop>,
    pub written_path: Option<Vec<u16>>,
    pub generated_entry_ids: Option<Vec<Vec<u16>>>,
    pub symlink_path: Option<Vec<u16>>,
    pub symlink_target: Option<Vec<u16>>,
    pub symlink_replaced: Option<links::Replaced>,
    pub symlink_created: Option<bool>,
    pub warnings: Option<Vec<Vec<u16>>>,
    pub created_parents: Option<Vec<Vec<u16>>>,
    pub prior: Option<PriorGroups>,
    pub file_created: Option<bool>,
    pub state: Option<State>,
}
pub enum DirectoryError<E> {
    Ignore(E),
    Other(E),
}
pub trait Host: LinkHost + ExcludeHost<Error = <Self as FileHost>::Error> {
    fn remove_empty_directory(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<(), DirectoryError<<Self as FileHost>::Error>>;
    fn cleanup_temporary_path(
        &mut self,
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, <Self as FileHost>::Error>;
}
#[derive(Default)]
pub struct Bridge {
    owners: Owners,
}
fn fs_error<E>(error: FsError<E>) -> Error<E> {
    Error::Host(match error {
        FsError::NotFound(error) | FsError::Exists(error) | FsError::Other(error) => error,
    })
}
fn require<'a, E>(
    catalog: &Catalog,
    agent: &'a Agent,
    role: &str,
) -> std::result::Result<(&'a [u16], &'a Config), Error<E>> {
    match (&agent.id, &agent.config) {
        (Some(id), Some(config)) => Ok((id, config)),
        _ => Err(Error::Policy(message(&[
            &u("Unsupported "),
            &u(role),
            &u(" hook agent \""),
            &agent.input,
            &u("\". Supported hook agents: "),
            &catalog.supported_agents().join(&u(", ")[..]),
            &u("."),
        ]))),
    }
}
fn target_path<H: Host>(
    id: &[u16],
    config: &Config,
    cwd: &[u16],
    host: &mut H,
) -> std::result::Result<Vec<u16>, Error<<H as FileHost>::Error>> {
    let local = config
        .local_path
        .as_ref()
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            Error::Policy(message(&[
                &u("Agent \""),
                id,
                &u("\" has no project hook path"),
            ]))
        })?;
    FileHost::resolve(host, &[cwd, local]).map_err(Error::Host)
}
fn read_file<H: Host>(
    path: &[u16],
    host: &mut H,
) -> std::result::Result<Option<Value>, Error<<H as FileHost>::Error>> {
    match FileHost::read(host, path) {
        Ok(content) => io::parse(path, content).map(Some).map_err(Error::from),
        Err(FsError::NotFound(_)) => Ok(None),
        Err(error) => Err(fs_error(error)),
    }
}
fn link_target<H: Host>(
    path: &[u16],
    host: &mut H,
) -> std::result::Result<Option<Vec<u16>>, Error<<H as FileHost>::Error>> {
    match FileHost::lstat(host, path) {
        Ok(stats) if stats.symbolic => match host.read_link(path) {
            Ok(target) => Ok(Some(target)),
            Err(FsError::NotFound(_)) => Ok(None),
            Err(error) => Err(fs_error(error)),
        },
        Ok(_) | Err(FsError::NotFound(_)) => Ok(None),
        Err(error) => Err(fs_error(error)),
    }
}
fn missing_parents<H: Host>(
    path: &[u16],
    host: &mut H,
) -> std::result::Result<Vec<Vec<u16>>, Error<<H as FileHost>::Error>> {
    let mut current = FileHost::dirname(host, path).map_err(Error::Host)?;
    let mut parents = vec![];
    loop {
        match FileHost::lstat(host, &current) {
            Ok(_) => break,
            Err(FsError::NotFound(_)) => {}
            Err(error) => return Err(fs_error(error)),
        }
        parents.push(current.clone());
        let parent = FileHost::dirname(host, &current).map_err(Error::Host)?;
        if parent == current {
            break;
        }
        current = parent;
    }
    parents.reverse();
    Ok(parents)
}
fn remove_parents<H: Host>(
    parents: &[Vec<u16>],
    host: &mut H,
) -> std::result::Result<(), Error<<H as FileHost>::Error>> {
    for parent in parents.iter().rev() {
        match host.remove_empty_directory(parent) {
            Ok(()) | Err(DirectoryError::Ignore(_)) => {}
            Err(DirectoryError::Other(error)) => return Err(Error::Host(error)),
        }
    }
    Ok(())
}
fn write_cleanup<H: Host>(
    path: &[u16],
    mut file: Value,
    host: &mut H,
) -> std::result::Result<(), Error<<H as FileHost>::Error>> {
    files::canonicalize(&mut file);
    let temporary = host.cleanup_temporary_path(path).map_err(Error::Host)?;
    links::assert_no_symbolic_link(&temporary, None, host).map_err(Error::Link)?;
    match FileHost::write_new(host, &temporary, &io::pretty(&file)) {
        Ok(()) => {}
        Err(FsError::Exists(error)) => return Err(Error::Host(error)),
        Err(error) => {
            let _ = FileHost::unlink(host, &temporary);
            return Err(fs_error(error));
        }
    }
    if let Err(error) = FileHost::rename(host, &temporary, path) {
        let _ = FileHost::unlink(host, &temporary);
        return Err(Error::Host(error));
    }
    Ok(())
}
fn typed(records: &[Record]) -> crate::Result<Vec<SourceEntry>> {
    records
        .iter()
        .map(|entry| {
            let handler = &entry.handler;
            let string = |key| match handler.get(key) {
                Some(Value::String(value)) => Ok(Some(value.clone())),
                None => Ok(None),
                _ => Err(u(&format!("Expected optional hook string field {key}"))),
            };
            let kind = string("type")?.ok_or_else(|| u("Expected hook string field type"))?;
            let args = match handler.get("args") {
                None => None,
                Some(Value::Array(values)) => Some(
                    values
                        .iter()
                        .map(|value| match value {
                            Value::String(value) => Ok(value.clone()),
                            _ => Err(u("Expected string hook arguments")),
                        })
                        .collect::<crate::Result<_>>()?,
                ),
                _ => return Err(u("Expected hook argument array")),
            };
            let timeout = match handler.get("timeout") {
                None => None,
                Some(Value::Number(value)) => Some(*value),
                _ => return Err(u("Expected numeric hook timeout")),
            };
            let matcher = match &entry.matcher {
                None => None,
                Some(Value::String(value)) => Some(value.clone()),
                _ => return Err(u("Expected optional hook string field matcher")),
            };
            Ok(SourceEntry {
                event: entry.event.clone(),
                matcher,
                handler: Handler {
                    kind,
                    command: string("command")?,
                    args,
                    timeout,
                    status_message: string("statusMessage")?,
                },
            })
        })
        .collect()
}
impl Bridge {
    pub fn owners_are_empty(&self) -> bool {
        self.owners.is_empty()
    }
    pub fn begin<H: Host>(
        &mut self,
        catalog: &Catalog,
        request: Request,
        host: &mut H,
    ) -> std::result::Result<Manifest, Error<<H as FileHost>::Error>> {
        let (source_id, source) = require(catalog, &request.source, "source")?;
        let (target_id, target) = require(catalog, &request.target, "target")?;
        let strategy = match request.strategy {
            StrategyRequest::Auto => {
                if source.format == target.format {
                    Strategy::Symlink
                } else {
                    Strategy::Transform
                }
            }
            StrategyRequest::Symlink => Strategy::Symlink,
            StrategyRequest::Transform => Strategy::Transform,
        };
        let mut manifest = Manifest {
            source_agent_id: request.source.input.clone(),
            target_agent_id: request.target.input.clone(),
            cwd: request.cwd.clone(),
            run_id: request.run_id.clone(),
            strategy,
            drops: vec![],
            written_path: None,
            generated_entry_ids: None,
            symlink_path: None,
            symlink_target: None,
            symlink_replaced: None,
            symlink_created: None,
            warnings: None,
            created_parents: None,
            prior: None,
            file_created: None,
            state: None,
        };
        if strategy == Strategy::Symlink {
            let path = target_path(target_id, target, &request.cwd, host)?;
            let parent = FileHost::dirname(host, &path).map_err(Error::Host)?;
            links::assert_no_symbolic_link(&parent, Some(&request.cwd), host)
                .map_err(Error::Link)?;
            let prior = link_target(&path, host)?;
            manifest.created_parents = Some(missing_parents(&path, host)?);
            let linked = match links::symlink_hooks(
                Some(source),
                Some(target),
                source_id,
                target_id,
                &request.cwd,
                &request.home,
                links::Scope::Project,
                host,
            ) {
                Ok(result) => result,
                Err(links::Error::UserAuthored(_)) if request.strategy == StrategyRequest::Auto => {
                    manifest.strategy = Strategy::Skip;
                    manifest.warnings = Some(vec![message(&[
                        &u("Skipped bridging hooks from \""),
                        source_id,
                        &u("\": kept the user-authored hook file at "),
                        &path,
                        &u(". Move or remove that file to bridge hooks for this run."),
                    ])]);
                    return Ok(manifest);
                }
                Err(error) => return Err(Error::Link(error)),
            };
            manifest.symlink_created = Some(
                !(linked.replaced == links::Replaced::None
                    && prior.as_ref() == Some(&linked.target_path)),
            );
            manifest.symlink_path = Some(linked.symlink_path.clone());
            manifest.symlink_target = Some(linked.target_path);
            manifest.symlink_replaced = Some(linked.replaced);
            let facts = LinkHost::path_facts(host, &linked.symlink_path, Some(&request.cwd))
                .map_err(Error::Host)?;
            match exclude::append_file(
                &request.cwd,
                &request.run_id,
                &[facts.relative],
                Some(&u(EXCLUDE_PREFIX)),
                host,
            ) {
                Ok(exclude) => {
                    manifest.state = Some(State {
                        ownership_id: request.run_id.clone(),
                        exclude_block_id: exclude,
                        cleaned: false,
                    })
                }
                Err(error) => {
                    if FileHost::lstat(host, &linked.symlink_path)
                        .map_err(fs_error)?
                        .symbolic
                    {
                        FileHost::unlink(host, &linked.symlink_path).map_err(Error::Host)?;
                    }
                    return Err(error.into());
                }
            }
            return Ok(manifest);
        }
        if !source.can_transform_to(target) {
            let pairs = catalog
                .transform_pairs()
                .into_iter()
                .map(|(source, target)| message(&[&source, &u(" -> "), &target]))
                .collect::<Vec<_>>()
                .join(&u(", ")[..]);
            return Err(Error::Policy(message(&[
                &u("Cannot transform hooks from \""),
                source_id,
                &u("\" to \""),
                target_id,
                &u("\". Supported transforms: "),
                &pairs,
                &u("."),
            ])));
        }
        let path = target_path(target_id, target, &request.cwd, host)?;
        let parent = FileHost::dirname(host, &path).map_err(Error::Host)?;
        links::assert_no_symbolic_link(&parent, Some(&request.cwd), host).map_err(Error::Link)?;
        let prior = read_file(&path, host)?;
        let source_hooks =
            io::read_hooks(catalog, &request.cwd, &request.home, request.scope, host)?;
        let ownership = self
            .owners
            .acquire(&path, &request.run_id)
            .map_err(Error::Policy)?;
        let preparation = (|| {
            let incoming = typed(&source_hooks.entries).map_err(Error::Policy)?;
            let transformed =
                crate::transform_hooks(catalog, &incoming, source_id, target_id, &ownership.id)
                    .map_err(Error::Policy)?;
            let parents = missing_parents(&path, host)?;
            Ok::<_, Error<<H as FileHost>::Error>>((transformed, parents))
        })();
        let (transformed, parents) = match preparation {
            Ok(result) => result,
            Err(error) => {
                self.owners.release(&path, &ownership.id);
                return Err(error);
            }
        };
        let written = match io::write_hooks(
            &path,
            &transformed.entries,
            &ownership.id,
            ownership.overlaps,
            host,
        ) {
            Ok(result) => result,
            Err(error) => {
                self.owners.release(&path, &ownership.id);
                return Err(error.into());
            }
        };
        manifest.written_path = Some(path.clone());
        manifest.generated_entry_ids = Some(
            transformed
                .entries
                .iter()
                .map(|entry| entry.generated_id.clone())
                .collect(),
        );
        manifest.drops = transformed
            .drops
            .into_iter()
            .map(|drop| Drop {
                reason: drop.reason,
                detail: drop.detail,
                source: source_hooks.entries[drop.source_index].clone(),
            })
            .collect();
        manifest.created_parents = Some(parents.clone());
        manifest.file_created = Some(written.file_created);
        manifest.prior = Some(PriorGroups::from_file(prior.as_ref()).map_err(Error::Policy)?);
        let facts = LinkHost::path_facts(host, &path, Some(&request.cwd)).map_err(Error::Host)?;
        match exclude::append_file(
            &request.cwd,
            &request.run_id,
            &[facts.relative],
            Some(&u(EXCLUDE_PREFIX)),
            host,
        ) {
            Ok(exclude) => {
                manifest.state = Some(State {
                    ownership_id: ownership.id,
                    exclude_block_id: exclude,
                    cleaned: false,
                })
            }
            Err(error) => {
                self.owners.release(&path, &ownership.id);
                if let Some(file) = prior {
                    write_cleanup(&path, file, host)?;
                } else {
                    FileHost::unlink(host, &path).map_err(Error::Host)?;
                }
                remove_parents(&parents, host)?;
                return Err(error.into());
            }
        }
        Ok(manifest)
    }
    pub fn cleanup<H: Host>(
        &mut self,
        manifest: &mut Manifest,
        host: &mut H,
    ) -> std::result::Result<(), Error<<H as FileHost>::Error>> {
        if manifest.state.as_ref().is_some_and(|state| state.cleaned) {
            return Ok(());
        }
        if manifest.strategy == Strategy::Symlink
            && let (Some(path), Some(target)) = (&manifest.symlink_path, &manifest.symlink_target)
            && manifest.symlink_created != Some(false)
        {
            if link_target(path, host)?.as_ref() == Some(target) {
                FileHost::unlink(host, path).map_err(Error::Host)?;
            }
            remove_parents(manifest.created_parents.as_deref().unwrap_or(&[]), host)?;
        }
        if manifest.strategy == Strategy::Transform
            && let Some(path) = &manifest.written_path
        {
            let owner = manifest
                .state
                .as_ref()
                .map_or(&manifest.run_id, |state| &state.ownership_id);
            if let Some(file) = read_file(path, host)? {
                let empty = PriorGroups::default();
                let cleaned = lifecycle::cleanup_file(
                    file,
                    owner,
                    manifest.prior.as_ref().unwrap_or(&empty),
                    path,
                )
                .map_err(Error::Policy)?;
                if manifest.file_created == Some(true) && cleaned.only_empty_hooks {
                    FileHost::unlink(host, path).map_err(Error::Host)?;
                } else {
                    write_cleanup(path, cleaned.file, host)?;
                }
            }
            remove_parents(manifest.created_parents.as_deref().unwrap_or(&[]), host)?;
            self.owners.release(path, owner);
        }
        let exclude = manifest
            .state
            .as_ref()
            .and_then(|state| state.exclude_block_id.as_ref())
            .unwrap_or(&manifest.run_id);
        exclude::remove_file(&manifest.cwd, exclude, Some(&u(EXCLUDE_PREFIX)), host)?;
        if let Some(state) = &mut manifest.state {
            state.cleaned = true;
        }
        Ok(())
    }
}
