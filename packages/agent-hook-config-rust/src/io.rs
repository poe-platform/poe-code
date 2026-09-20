//! Synchronous filesystem decision loops; hosts supply platform paths and I/O.
use crate::{
    Catalog, GeneratedEntry,
    files::{self, Record},
    message,
    paths::{PathPlan, Scope, plan_hook_path},
    u,
};
use mcp_protocol_rust::json::{self, Limits, Value};
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FsError<E> {
    NotFound(E),
    Exists(E),
    Other(E),
}
impl<E> FsError<E> {
    fn error(self) -> E {
        match self {
            Self::NotFound(error) | Self::Exists(error) | Self::Other(error) => error,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error<E> {
    Policy(Vec<u16>),
    Host(E),
    MalformedJson { path: Vec<u16>, content: Vec<u16> },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stats {
    pub symbolic: bool,
    pub file: bool,
}
pub trait FileHost {
    type Error;
    fn resolve(&mut self, parts: &[&[u16]]) -> std::result::Result<Vec<u16>, Self::Error>;
    fn join(
        &mut self,
        directory: &[u16],
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, Self::Error>;
    fn dirname(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, Self::Error>;
    fn lstat(&mut self, path: &[u16]) -> std::result::Result<Stats, FsError<Self::Error>>;
    fn read(&mut self, path: &[u16]) -> std::result::Result<Vec<u16>, FsError<Self::Error>>;
    fn mkdir(&mut self, path: &[u16]) -> std::result::Result<(), Self::Error>;
    fn write_new(
        &mut self,
        path: &[u16],
        content: &[u16],
    ) -> std::result::Result<(), FsError<Self::Error>>;
    fn rename(&mut self, from: &[u16], to: &[u16]) -> std::result::Result<(), Self::Error>;
    fn unlink(&mut self, path: &[u16]) -> std::result::Result<(), Self::Error>;
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadScope {
    Project,
    User,
    Merged,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Read {
    pub entries: Vec<Record>,
    pub read_paths: Vec<Vec<u16>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Written {
    pub path: Vec<u16>,
    pub file_created: bool,
    pub previous_generated_removed: usize,
    pub generated_written: usize,
}
fn execute<H: FileHost>(
    plan: PathPlan,
    host: &mut H,
) -> std::result::Result<Vec<u16>, Error<H::Error>> {
    match plan {
        PathPlan::Resolve(path) => host.resolve(&[&path]),
        PathPlan::Join { directory, path } => host
            .join(&directory, &path)
            .and_then(|path| host.resolve(&[&path])),
        PathPlan::ResolveFrom { directory, path } => host.resolve(&[&directory, &path]),
    }
    .map_err(Error::Host)
}
fn parse<E>(path: &[u16], content: Vec<u16>) -> std::result::Result<Value, Error<E>> {
    json::parse_utf16(&content, Limits::default()).map_err(|_| Error::MalformedJson {
        path: path.to_vec(),
        content,
    })
}
pub fn read_hooks<H: FileHost>(
    catalog: &Catalog,
    cwd: &[u16],
    home: &[u16],
    scope: ReadScope,
    host: &mut H,
) -> std::result::Result<Read, Error<H::Error>> {
    let config = catalog
        .configs()
        .iter()
        .find(|(_, config)| config.format == u("claude-settings-json"))
        .map(|(_, config)| config)
        .ok_or_else(|| Error::Policy(u("No readable Claude settings hook configuration")))?;
    let mut paths = vec![];
    if matches!(scope, ReadScope::User | ReadScope::Merged)
        && let Some(plan) = plan_hook_path(config, Scope::Global, cwd, home)
    {
        paths.push(execute(plan, host)?);
    }
    if matches!(scope, ReadScope::Project | ReadScope::Merged)
        && let Some(plan) = plan_hook_path(config, Scope::Local, cwd, home)
    {
        paths.push(execute(plan, host)?);
    }
    let mut result = Read {
        entries: vec![],
        read_paths: vec![],
    };
    for path in paths {
        match host.lstat(&path) {
            Ok(stats) if stats.symbolic => {
                return Err(Error::Policy(message(&[
                    &u("Hook settings path must not be a symbolic link: "),
                    &path,
                ])));
            }
            Ok(_) => {}
            Err(FsError::NotFound(_)) => continue,
            Err(error) => return Err(Error::Host(error.error())),
        }
        let content = match host.read(&path) {
            Ok(content) => content,
            Err(FsError::NotFound(_)) => continue,
            Err(error) => return Err(Error::Host(error.error())),
        };
        let value = parse(&path, content)?;
        result
            .entries
            .extend(files::read_settings(&value, &path).map_err(Error::Policy)?);
        result.read_paths.push(path);
    }
    Ok(result)
}
// Format already parsed values, never patch existing text. String escapes come
// from the own JSON serializer; only structural punctuation receives whitespace.
fn pretty(value: &Value) -> Vec<u16> {
    let json = json::stringify(value);
    let source = json.as_bytes();
    let mut output = String::new();
    let mut depth = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (index, ch) in json.char_indices() {
        if quoted {
            output.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        match ch {
            '"' => {
                quoted = true;
                output.push(ch);
            }
            '{' | '[' => {
                output.push(ch);
                if !matches!(source.get(index + 1), Some(b'}' | b']')) {
                    depth += 1;
                    output.push('\n');
                    output.push_str(&"  ".repeat(depth));
                }
            }
            '}' | ']' => {
                if !matches!(source.get(index.wrapping_sub(1)), Some(b'{' | b'[')) {
                    depth -= 1;
                    output.push('\n');
                    output.push_str(&"  ".repeat(depth));
                }
                output.push(ch);
            }
            ',' => {
                output.push_str(",\n");
                output.push_str(&"  ".repeat(depth));
            }
            ':' => output.push_str(": "),
            _ => output.push(ch),
        }
    }
    output.push('\n');
    u(&output)
}
pub fn write_hooks<H: FileHost>(
    path: &[u16],
    incoming: &[GeneratedEntry],
    run_id: &[u16],
    preserve_generated: bool,
    host: &mut H,
) -> std::result::Result<Written, Error<H::Error>> {
    let (file, file_created) = match host.read(path) {
        Ok(content) => (parse(path, content)?, false),
        Err(FsError::NotFound(_)) => (
            Value::Object(vec![(u("hooks"), Value::Object(vec![]))]),
            true,
        ),
        Err(error) => return Err(Error::Host(error.error())),
    };
    let mut mutation = files::mutate_file(file, incoming, run_id, preserve_generated, path)
        .map_err(Error::Policy)?;
    let directory = host.dirname(path).map_err(Error::Host)?;
    host.mkdir(&directory).map_err(Error::Host)?;
    files::canonicalize(&mut mutation.file);
    let content = pretty(&mutation.file);
    let mut index = 0usize;
    let temporary = loop {
        let temporary = message(&[path, &u(".tmp-"), run_id, &u("-"), &u(&index.to_string())]);
        match host.write_new(&temporary, &content) {
            Ok(()) => break temporary,
            Err(FsError::Exists(_)) => {
                index = index
                    .checked_add(1)
                    .ok_or_else(|| Error::Policy(u("Temporary hook file retry index exhausted")))?;
            }
            Err(error) => {
                let _ = host.unlink(&temporary);
                return Err(Error::Host(error.error()));
            }
        }
    };
    if let Err(error) = host.rename(&temporary, path) {
        let _ = host.unlink(&temporary);
        return Err(Error::Host(error));
    }
    Ok(Written {
        path: path.to_vec(),
        file_created,
        previous_generated_removed: mutation.removed,
        generated_written: mutation.written,
    })
}
