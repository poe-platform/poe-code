//! Run-owned Git exclude blocks and synchronous atomic update policies.
pub const DEFAULT_MARKER_PREFIX: &str = "poe-code-spawn-skills";
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn concat(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
fn single(value: &[u16], label: &str) -> Result<(), Vec<u16>> {
    if value.contains(&10) || value.contains(&13) {
        Err(concat(&[&u(label), &u(" must be a single line")]))
    } else {
        Ok(())
    }
}
pub fn validate(run: &[u16], entries: &[Vec<u16>], prefix: &[u16]) -> Result<(), Vec<u16>> {
    single(run, "runId")?;
    single(prefix, "markerPrefix")?;
    for entry in entries {
        single(entry, "exclude entry")?;
    }
    Ok(())
}
fn marker(run: &[u16], prefix: &[u16], suffix: &str) -> Vec<u16> {
    concat(&[&u("# "), prefix, &u(":"), run, &u(suffix)])
}
fn contains(source: &[u16], pattern: &[u16]) -> bool {
    source.windows(pattern.len()).any(|part| part == pattern)
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Appended {
    pub id: Vec<u16>,
    pub content: Vec<u16>,
}
pub fn append(
    content: Option<&[u16]>,
    run: &[u16],
    entries: &[Vec<u16>],
    prefix: &[u16],
) -> Result<Appended, Vec<u16>> {
    validate(run, entries, prefix)?;
    let content = content.unwrap_or(&[]);
    let mut id = run.to_vec();
    let mut suffix = 1usize;
    while contains(content, &marker(&id, prefix, " begin")) {
        id = concat(&[run, &u(":"), &u(&suffix.to_string())]);
        suffix = suffix
            .checked_add(1)
            .ok_or_else(|| u("Git exclude block suffix exhausted"))?;
    }
    let mut output = content.to_vec();
    if !output.is_empty() && output.last() != Some(&10) {
        output.push(10);
    }
    output.extend(marker(&id, prefix, " begin"));
    output.push(10);
    for entry in entries {
        output.extend(entry);
        output.push(10);
    }
    output.extend(marker(&id, prefix, " end"));
    output.push(10);
    Ok(Appended {
        id,
        content: output,
    })
}
pub fn remove(content: &[u16], run: &[u16], prefix: &[u16]) -> Result<Vec<u16>, Vec<u16>> {
    validate(run, &[], prefix)?;
    let begin = marker(run, prefix, " begin");
    let end = marker(run, prefix, " end");
    let lines = content.split(|unit| *unit == 10).collect::<Vec<_>>();
    let mut result = vec![];
    let mut index = 0;
    while index < lines.len() {
        if lines[index] == begin
            && let Some(end_index) = lines[index + 1..].iter().position(|line| *line == end)
        {
            index += end_index + 2;
            continue;
        }
        result.push(lines[index]);
        index += 1;
    }
    Ok(result.join(&[10][..]))
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FsError<E> {
    NotFound(E),
    Exists(E),
    Other(E),
}
#[derive(Debug, PartialEq)]
pub enum Error<E> {
    Policy(Vec<u16>),
    Host(E),
}
fn error<E>(value: FsError<E>) -> Error<E> {
    Error::Host(match value {
        FsError::NotFound(error) | FsError::Exists(error) | FsError::Other(error) => error,
    })
}
pub struct PathFacts {
    pub resolved: Vec<u16>,
    pub root: Vec<u16>,
    pub separator: u16,
    pub absolute: bool,
}
pub trait Host {
    type Error;
    fn git_dir(&mut self, cwd: &[u16]) -> Result<Option<Vec<u16>>, Self::Error>;
    fn path_facts(&mut self, path: &[u16]) -> Result<PathFacts, Self::Error>;
    fn resolve(&mut self, cwd: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn join(&mut self, directory: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn dirname(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn symbolic(&mut self, path: &[u16]) -> Result<bool, FsError<Self::Error>>;
    fn read(&mut self, path: &[u16]) -> Result<Vec<u16>, FsError<Self::Error>>;
    fn mkdir(&mut self, path: &[u16]) -> Result<(), Self::Error>;
    fn temporary_path(&mut self, path: &[u16]) -> Result<Vec<u16>, Self::Error>;
    fn write_new(&mut self, path: &[u16], content: &[u16]) -> Result<(), FsError<Self::Error>>;
    fn rename(&mut self, from: &[u16], to: &[u16]) -> Result<(), Self::Error>;
    fn remove_force(&mut self, path: &[u16]) -> Result<(), Self::Error>;
}
fn exclude_path<H: Host>(cwd: &[u16], host: &mut H) -> Result<Option<Vec<u16>>, Error<H::Error>> {
    let Some(git) = host
        .git_dir(cwd)
        .map_err(Error::Host)?
        .filter(|git| !git.is_empty())
    else {
        return Ok(None);
    };
    let facts = host.path_facts(&git).map_err(Error::Host)?;
    let directory = if facts.absolute {
        git
    } else {
        host.resolve(cwd, &git).map_err(Error::Host)?
    };
    host.join(&directory, &u("info/exclude"))
        .map(Some)
        .map_err(Error::Host)
}
pub fn assert_no_symbolic_link<H: Host>(path: &[u16], host: &mut H) -> Result<(), Error<H::Error>> {
    let facts = host.path_facts(path).map_err(Error::Host)?;
    let mut current = facts.root.clone();
    for segment in facts.resolved[facts.root.len()..].split(|unit| *unit == facts.separator) {
        if segment.is_empty() {
            continue;
        }
        current = host.join(&current, segment).map_err(Error::Host)?;
        match host.symbolic(&current) {
            Ok(true) => {
                return Err(Error::Policy(concat(&[
                    &u("Refusing to update Git exclude path through symbolic link: "),
                    &current,
                ])));
            }
            Ok(false) => {}
            Err(FsError::NotFound(_)) => return Ok(()),
            Err(error_value) => return Err(error(error_value)),
        }
    }
    Ok(())
}
fn read<H: Host>(path: &[u16], host: &mut H) -> Result<Option<Vec<u16>>, Error<H::Error>> {
    match host.read(path) {
        Ok(content) => Ok(Some(content)),
        Err(FsError::NotFound(_)) => Ok(None),
        Err(value) => Err(error(value)),
    }
}
pub fn write_file<H: Host>(
    path: &[u16],
    content: &[u16],
    host: &mut H,
) -> Result<(), Error<H::Error>> {
    assert_no_symbolic_link(path, host)?;
    let directory = host.dirname(path).map_err(Error::Host)?;
    host.mkdir(&directory).map_err(Error::Host)?;
    assert_no_symbolic_link(path, host)?;
    let temporary = host.temporary_path(path).map_err(Error::Host)?;
    if let Err(original) = assert_no_symbolic_link(&temporary, host) {
        let _ = host.remove_force(&temporary);
        return Err(original);
    }
    match host.write_new(&temporary, content) {
        Ok(()) => {}
        Err(FsError::Exists(original)) => return Err(Error::Host(original)),
        Err(original) => {
            let _ = host.remove_force(&temporary);
            return Err(error(original));
        }
    }
    if let Err(original) = host.rename(&temporary, path) {
        let _ = host.remove_force(&temporary);
        return Err(Error::Host(original));
    }
    Ok(())
}
pub fn append_file<H: Host>(
    cwd: &[u16],
    run: &[u16],
    entries: &[Vec<u16>],
    prefix: Option<&[u16]>,
    host: &mut H,
) -> Result<Option<Vec<u16>>, Error<H::Error>> {
    let default = u(DEFAULT_MARKER_PREFIX);
    let prefix = prefix.unwrap_or(&default);
    validate(run, entries, prefix).map_err(Error::Policy)?;
    let Some(path) = exclude_path(cwd, host)? else {
        return Ok(None);
    };
    assert_no_symbolic_link(&path, host)?;
    let content = read(&path, host)?;
    let appended = append(content.as_deref(), run, entries, prefix).map_err(Error::Policy)?;
    write_file(&path, &appended.content, host)?;
    Ok(Some(appended.id))
}
pub fn remove_file<H: Host>(
    cwd: &[u16],
    run: &[u16],
    prefix: Option<&[u16]>,
    host: &mut H,
) -> Result<(), Error<H::Error>> {
    let default = u(DEFAULT_MARKER_PREFIX);
    let prefix = prefix.unwrap_or(&default);
    validate(run, &[], prefix).map_err(Error::Policy)?;
    let Some(path) = exclude_path(cwd, host)? else {
        return Ok(());
    };
    let Some(content) = read(&path, host)? else {
        return Ok(());
    };
    let cleaned = remove(&content, run, prefix).map_err(Error::Policy)?;
    write_file(&path, &cleaned, host)
}
