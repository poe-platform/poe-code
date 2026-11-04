// mkdir may create components while following symlinks. Mounted filesystems
// resolve the entire operand before creating anything; plain memory and overlay
// create each component as they walk, so a later error can leave a new parent.
use super::{SafeBashFs, VfsEntryKind, dirname_posix_path};
use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Namespace { Direct, Overlay, Mounted }

pub(super) fn mkdir<'a, F: SafeBashFs + ?Sized + 'a>(
    operand: &str, recursive: bool, mode: u32, ns: Namespace,
    locate: impl Fn(&str) -> (Option<&'a str>, &'a F, String),
) -> Result<(), (String, String)> {
    let mounted = ns == Namespace::Mounted;
    let overlay = ns == Namespace::Overlay;
    let original = if mounted && !operand.starts_with('/') { format!("/{operand}") } else { operand.to_owned() };
    let error = |code: &str, path: &str| (code.split(':').next().unwrap().to_owned(), if overlay { path.to_owned() } else { original.clone() });
    if overlay && mode > 0o7777 { return Err(error("EINVAL", operand)); }
    if operand.is_empty() { return Err(error("ENOENT", operand)); }
    if operand.contains('\0') { return Err(error("EINVAL", operand)); }
    if !mounted && mode > 0o7777 { return Err(error("EINVAL", operand)); }
    let mut parts: Vec<_> = operand.split('/').filter(|s| !s.is_empty()).rev().map(str::to_owned).collect();
    if recursive && operand.ends_with('/') { parts.insert(0, ".".into()); }
    let mut current = String::from("/");
    let mut links = 0;
    let mut boundary = None;
    let mut pending = Vec::new();
    let mut planned = HashSet::new();
    while let Some(part) = parts.pop() {
        let (_, fs, parent) = locate(&current);
        if !planned.contains(&current) {
            let st = fs.lstat(&parent).map_err(|e| error(&e, &current))?;
            if st.kind != VfsEntryKind::Directory { return Err(error("ENOTDIR", &current)); }
            if st.mode & 0o100 == 0 { return Err(error("EACCES", &current)); }
        }
        if part == "." { continue; }
        if part == ".." {
            if boundary == Some(current.as_str()) { return Err(error("EACCES", operand)); }
            current = dirname_posix_path(&current);
            continue;
        }
        if part.len() > 255 { return Err(error("ENAMETOOLONG", operand)); }
        let candidate = format!("{}/{part}", current.trim_end_matches('/'));
        let (mount, fs, local) = locate(&candidate);
        if boundary.is_some() && boundary != mount { return Err(error("EACCES", operand)); }
        let last = parts.is_empty();
        if !planned.contains(&candidate) {
            match fs.lstat(&local) {
                Ok(st) if !recursive && last => {
                    if mounted && operand.ends_with('/') && st.kind != VfsEntryKind::Directory { return Err(error("ENOTDIR", operand)); }
                    if mounted && mount == Some(candidate.as_str()) { return Err(error("EBUSY", operand)); }
                    if mode > 0o7777 && st.mode & 0o170000 != 0o020000 { return Err(error("EINVAL", operand)); }
                    return Err(error("EEXIST", operand));
                }
                Ok(st) if st.kind == VfsEntryKind::Symlink => {
                    links += 1;
                    if links > 40 { return Err(error("ELOOP", operand)); }
                    let target = fs.readlink(&local).map_err(|e| error(&e, operand))?;
                    boundary = mount;
                    if target.starts_with('/') { current = mount.unwrap_or("/").into(); }
                    if target.ends_with('/') { parts.push(".".into()); }
                    parts.extend(target.split('/').filter(|s| !s.is_empty()).rev().map(str::to_owned));
                    continue;
                }
                Ok(st) if last && st.kind != VfsEntryKind::Directory => return Err(error("EEXIST", operand)),
                Ok(_) => {}
                Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => {
                    if !recursive && !last { return Err(error("ENOENT", &candidate)); }
                    if recursive && links != 0 && (overlay || mounted) {
                        return Err(error(if overlay { "ENOTSUP" } else { "ENOENT" }, operand));
                    }
                    if mounted && recursive {
                        planned.insert(candidate.clone());
                        pending.push((fs, local));
                    } else {
                        fs.mkdir_one(&local, mode).map_err(|e| error(&e, if e.starts_with("EACCES") { &current } else { operand }))?;
                        if !recursive { return Ok(()); }
                    }
                }
                Err(e) => return Err(error(&e, operand)),
            }
        }
        current = candidate;
    }
    if !recursive {
        let (mount, _, _) = locate(&current);
        return Err(error(if mounted && mount == Some(&current) { "EBUSY" } else { "EEXIST" }, operand));
    }
    for (fs, local) in pending { fs.mkdir_one(&local, mode).map_err(|e| error(&e, operand))?; }
    Ok(())
}

pub(super) fn creation_mode(path: &str, recursive: bool, query: impl Fn(&str) -> Result<String, String>) -> Result<(), String> {
    let mut candidate = path;
    loop {
        match query(candidate) {
            Err(e) if recursive && e.starts_with("ENOENT:") && candidate != "/" => {
                candidate = candidate.trim_end_matches('/').rsplit_once('/').map_or("/", |(p, _)| if p.is_empty() { "/" } else { p });
            }
            result => return result.map(|_| ()),
        }
    }
}
