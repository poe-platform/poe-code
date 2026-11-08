//! Same-format symlink decisions, ownership admission and exclusive rollback.
use crate::{
    Config, files,
    io::{FileHost, FsError},
    message,
    paths::{self, PathPlan},
    u,
};
use mcp_protocol_rust::json::{self, Limits};
pub const USER_AUTHORED_CODE: &str = "POE_USER_AUTHORED_HOOK_FILE";
pub const ORIGINAL_FAILURE_PREFIX: &str = "Hook symlink replacement failed: ";
pub const RESTORE_FAILURE_PREFIX: &str = "Generated hook file restore failed: ";
#[derive(Debug, PartialEq)]
pub enum Error<E> {
    Policy(Vec<u16>),
    UserAuthored(Vec<u16>),
    Host(E),
    Restore {
        original: Box<Error<E>>,
        restore: Box<Error<E>>,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Project,
    User,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Replaced {
    None,
    StaleSymlink,
    GeneratedFile,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Linked {
    pub symlink_path: Vec<u16>,
    pub target_path: Vec<u16>,
    pub replaced: Replaced,
}
pub struct PathFacts {
    pub root: Vec<u16>,
    pub relative: Vec<u16>,
    pub absolute_relative: bool,
    pub separator: u16,
}
pub trait LinkHost: FileHost {
    fn path_facts(
        &mut self,
        resolved: &[u16],
        root: Option<&[u16]>,
    ) -> Result<PathFacts, Self::Error>;
    fn read_link(&mut self, path: &[u16]) -> Result<Vec<u16>, FsError<Self::Error>>;
    fn symlink(&mut self, target: &[u16], path: &[u16]) -> Result<(), Self::Error>;
}
fn fs_error<E>(error: FsError<E>) -> Error<E> {
    Error::Host(match error {
        FsError::NotFound(error) | FsError::Exists(error) | FsError::Other(error) => error,
    })
}
pub fn assert_no_symbolic_link<H: LinkHost>(
    path: &[u16],
    root: Option<&[u16]>,
    host: &mut H,
) -> Result<(), Error<H::Error>> {
    let resolved = host.resolve(&[path]).map_err(Error::Host)?;
    let checked = root
        .map(|root| host.resolve(&[root]))
        .transpose()
        .map_err(Error::Host)?;
    let facts = host
        .path_facts(&resolved, checked.as_deref())
        .map_err(Error::Host)?;
    let outside = checked.is_some()
        && (facts.relative == u("..")
            || facts.relative.starts_with(&[46, 46, facts.separator])
            || facts.absolute_relative);
    let current = if outside {
        facts.root.clone()
    } else {
        checked.unwrap_or_else(|| facts.root.clone())
    };
    let segments = if outside {
        &resolved[facts.root.len()..]
    } else {
        &facts.relative
    };
    let mut current = current;
    for segment in segments.split(|unit| *unit == facts.separator) {
        if segment.is_empty() || segment == [46] {
            continue;
        }
        current = host.join(&current, segment).map_err(Error::Host)?;
        match host.lstat(&current) {
            Ok(stats) if stats.symbolic => {
                return Err(Error::Policy(message(&[
                    &u("Hook path must not traverse a symbolic link: "),
                    &current,
                ])));
            }
            Ok(_) => {}
            Err(FsError::NotFound(_)) => return Ok(()),
            Err(error) => return Err(fs_error(error)),
        }
    }
    Ok(())
}
fn scoped<H: LinkHost>(
    config: &Config,
    id: &[u16],
    cwd: &[u16],
    home: &[u16],
    scope: Scope,
    host: &mut H,
) -> Result<Vec<u16>, Error<H::Error>> {
    let plan = paths::plan_hook_path(
        config,
        if scope == Scope::Project {
            paths::Scope::Local
        } else {
            paths::Scope::Global
        },
        cwd,
        home,
    )
    .ok_or_else(|| {
        Error::Policy(message(&[
            &u("Agent \""),
            id,
            &u(if scope == Scope::Project {
                "\" has no project hook path"
            } else {
                "\" has no user hook path"
            }),
        ]))
    })?;
    match plan {
        PathPlan::Resolve(path) => host.resolve(&[&path]),
        PathPlan::Join { directory, path } => host
            .join(&directory, &path)
            .and_then(|path| host.resolve(&[&path])),
        PathPlan::ResolveFrom { directory, path } => host.resolve(&[&directory, &path]),
    }
    .map_err(Error::Host)
}
fn config<'a, E>(config: Option<&'a Config>, id: &[u16]) -> Result<&'a Config, Error<E>> {
    config.ok_or_else(|| {
        Error::Policy(message(&[
            &u("No hook configuration found for agent \""),
            id,
            &u("\""),
        ]))
    })
}
#[allow(clippy::too_many_arguments)]
pub fn symlink_hooks<H: LinkHost>(
    source: Option<&Config>,
    target: Option<&Config>,
    source_id: &[u16],
    target_id: &[u16],
    cwd: &[u16],
    home: &[u16],
    scope: Scope,
    host: &mut H,
) -> Result<Linked, Error<H::Error>> {
    let source = config(source, source_id)?;
    let target = config(target, target_id)?;
    if source.format != target.format {
        return Err(Error::Policy(message(&[
            &u("Cannot symlink hook formats \""),
            &source.format,
            &u("\" and \""),
            &target.format,
            &u("\"; use transformation instead"),
        ])));
    }
    let target_path = scoped(
        source,
        source_id,
        cwd,
        home,
        if source_id == target_id && scope == Scope::Project {
            Scope::User
        } else {
            scope
        },
        host,
    )?;
    let symlink_path = scoped(target, target_id, cwd, home, scope, host)?;
    let parent = host.dirname(&symlink_path).map_err(Error::Host)?;
    let mut result = Linked {
        symlink_path,
        target_path,
        replaced: Replaced::None,
    };
    assert_no_symbolic_link(&parent, Some(cwd), host)?;
    let mut contents = None;
    // ENOENT during inspection or removal follows the same missing-path policy.
    enum Inspection {
        Create,
        MatchingLink,
        UserFile,
    }
    let inspection = (|| -> Result<Inspection, FsError<H::Error>> {
        let existing = host.lstat(&result.symlink_path)?;
        if existing.symbolic {
            if host.read_link(&result.symlink_path)? == result.target_path {
                return Ok(Inspection::MatchingLink);
            }
            host.unlink(&result.symlink_path).map_err(FsError::Other)?;
            result.replaced = Replaced::StaleSymlink;
        } else {
            let generated = existing.file
                && host
                    .read(&result.symlink_path)
                    .ok()
                    .and_then(|content| json::parse_utf16(&content, Limits::default()).ok())
                    .is_some_and(|file| files::is_fully_generated(&file));
            if !generated {
                return Ok(Inspection::UserFile);
            }
            contents = Some(host.read(&result.symlink_path)?);
            host.unlink(&result.symlink_path).map_err(FsError::Other)?;
            result.replaced = Replaced::GeneratedFile;
        }
        Ok(Inspection::Create)
    })();
    match inspection {
        Ok(Inspection::MatchingLink) => return Ok(result),
        Ok(Inspection::UserFile) => {
            return Err(Error::UserAuthored(message(&[
                &u("Refuse to replace user-authored hook file at "),
                &result.symlink_path,
                &u(
                    ": it was not generated by poe-code, so replacing it would discard your own hooks. Move or back up that file, pick another scope with --hooks-scope, or use --hooks-strategy auto to skip bridging and keep the file.",
                ),
            ])));
        }
        Ok(Inspection::Create) | Err(FsError::NotFound(_)) => {}
        Err(error) => return Err(fs_error(error)),
    }
    let create = host
        .mkdir(&parent)
        .map_err(Error::Host)
        .and_then(|_| assert_no_symbolic_link(&parent, Some(cwd), host))
        .and_then(|_| {
            host.symlink(&result.target_path, &result.symlink_path)
                .map_err(Error::Host)
        });
    if let Err(original) = create {
        if let Some(contents) = contents {
            let restore = assert_no_symbolic_link(&parent, Some(cwd), host).and_then(|_| {
                host.write_new(&result.symlink_path, &contents)
                    .map_err(fs_error)
            });
            if let Err(restore) = restore {
                return Err(Error::Restore {
                    original: Box::new(original),
                    restore: Box::new(restore),
                });
            }
        }
        return Err(original);
    }
    Ok(result)
}
