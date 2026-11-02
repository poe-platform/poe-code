pub fn normalize_posix_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

/// Keep dot components and trailing slashes for filesystem traversal.
pub(crate) fn absolute_operand(cwd: &str, operand: &str) -> String {
    if operand.is_empty() || operand.starts_with('/') { operand.to_owned() }
    else { format!("{}/{operand}", cwd.trim_end_matches('/')) }
}

pub fn resolve_posix_path(cwd: &str, target: &str) -> String {
    if target.starts_with('/') {
        normalize_posix_path(target)
    } else if cwd == "/" {
        normalize_posix_path(&format!("/{target}"))
    } else {
        normalize_posix_path(&format!("{cwd}/{target}"))
    }
}

pub fn parent_posix_path(path: &str) -> Option<String> {
    let norm = normalize_posix_path(path);
    if norm == "/" {
        return None;
    }
    match norm.rsplit_once('/') {
        Some(("", _)) => Some("/".to_string()),
        Some((parent, _)) => Some(parent.to_string()),
        None => Some("/".to_string()),
    }
}

pub fn basename_posix_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rsplit_once('/') {
        Some((_, base)) => base.to_string(),
        None => trimmed.to_string(),
    }
}

pub fn dirname_posix_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rsplit_once('/') {
        Some(("", _)) => "/".to_string(),
        Some((dir, _)) => {
            let d = dir.trim_end_matches('/');
            if d.is_empty() {
                "/".to_string()
            } else {
                d.to_string()
            }
        }
        None => ".".to_string(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum WalkPurpose {
    AllowMissingParents,
    OverlayAccess,
    Access,
    Rename,
}

// Absolute link targets are rooted at their own mount. Once a link is
// followed, neither ".." nor the remaining path may enter another mount.
pub(super) fn walk_path<'a, F: super::SafeBashFs + ?Sized + 'a>(
    path: &str,
    follow_final: bool,
    purpose: WalkPurpose,
    location: impl Fn(&str) -> (Option<&'a str>, &'a F, String),
    mount_parent: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let access = matches!(purpose, WalkPurpose::Access | WalkPurpose::OverlayAccess);
    let mut link_checks = Vec::new();
    let mut current = "/".to_string();
    let mut pending: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .rev()
        .map(str::to_owned)
        .collect();
    let mut boundary = None;
    let mut followed_final_mount_link = false;
    let mut links = 0;
    if purpose != WalkPurpose::AllowMissingParents && path.is_empty() { return Err("ENOENT: no such file or directory".into()); }
    if path.contains('\0') { return Err("EINVAL: invalid argument".into()); }
    if access && path.ends_with('/') { pending.insert(0, ".".into()); }
    while let Some(part) = pending.pop() {
        if purpose != WalkPurpose::AllowMissingParents {
            let (mount, backend, local) = location(&current);
            let st = match backend.stat(&local) {
                Ok(st) => Some(st),
                Err(e) if (e.starts_with("ENOENT:") || e.ends_with("(os error 2)")) && mount_parent(&current) => None,
                Err(e) if purpose == WalkPurpose::OverlayAccess => {
                    return Err(format!("{}, overlay '{current}'", e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)));
                }
                Err(e) => return Err(e),
            };
            if let Some(ref st) = st && st.kind != super::VfsEntryKind::Directory {
                if purpose == WalkPurpose::Access && mount.is_none() && st.mode & 0o170000 == 0o020000 && st.allocated_bytes == Some(0) {
                    return Err(format!("ENOTDIR: not a directory '{path}'"));
                }
                return Err(if purpose == WalkPurpose::OverlayAccess { format!("ENOTDIR: not a directory, overlay '{current}'") } else { "ENOTDIR: not a directory".into() });
            }
            if st.is_some_and(|st| st.mode & 0o100 == 0) {
                if purpose == WalkPurpose::OverlayAccess { return Err(format!("EACCES: permission denied, overlay '{current}'")); }
                if access {
                    if matches!(part.as_str(), "." | "..") { return Err("EACCES: permission denied".into()); }
                    let denied = format!("{}/{part}", current.trim_end_matches('/'));
                    return Err(format!("EACCES: permission denied, lstat '{denied}'"));
                }
                return Err("EACCES: permission denied".into());
            }
            if purpose == WalkPurpose::Rename && pending.is_empty() && matches!(part.as_str(), "." | "..") {
                return Err("EINVAL: invalid argument".into());
            }
        }
        if part == "." {
            continue;
        }
        if part == ".." {
            if boundary == Some(current.as_str()) {
                return Err("EACCES: Permission denied".into());
            }
            current = dirname_posix_path(&current);
            continue;
        }
        let candidate = format!("{}/{part}", current.trim_end_matches('/'));
        let (prefix, backend, relative) = location(&candidate);
        if part.len() > 255 {
            return Err(if prefix.is_none() && purpose == WalkPurpose::Access { format!("ENAMETOOLONG: name too long, lstat '{candidate}'") } else { "ENAMETOOLONG: name too long".into() });
        }
        if boundary.is_some() && boundary != prefix {
            return Err("EACCES: Permission denied".into());
        }
        if !follow_final && pending.is_empty() {
            current = candidate;
            break;
        }
        match backend.lstat(&relative) {
            Ok(st) if st.kind == super::VfsEntryKind::Symlink => {
                links += 1;
                if links > 40 {
                    return Err("ELOOP: too many symbolic links".into());
                }
                if purpose == WalkPurpose::OverlayAccess {
                    let final_name = pending.first().filter(|p| !follow_final && *p != "." && *p != "..").cloned();
                    let mut remaining = relative.clone();
                    for part in pending[usize::from(final_name.is_some())..].iter().rev() {
                        remaining.push('/'); remaining.push_str(part);
                    }
                    link_checks.push((backend, remaining, final_name));
                }
                let target = backend.readlink(&relative)?;
                followed_final_mount_link |= prefix.is_some() && pending.is_empty();
                boundary = prefix;
                if target.starts_with('/') {
                    current = prefix.unwrap_or("/").to_owned();
                }
                if access && target.ends_with('/') { pending.push(".".into()); }
                pending.extend(
                    target
                        .split('/')
                        .filter(|s| !s.is_empty())
                        .rev()
                        .map(str::to_owned),
                );
            }
            Ok(_) => current = candidate,
            Err(error) if error.starts_with("ENOENT:") || error.ends_with("(os error 2)") => {
                if access && followed_final_mount_link { return Err(error); }
                current = candidate
            }
            Err(error) => return Err(error),
        }
    }
    if !link_checks.is_empty() {
        let (_, visible, local) = location(&current);
        let missing = match visible.lstat(&local) {
            Ok(_) => false,
            Err(e) if e.starts_with("ENOENT:") => true,
            Err(e) => return Err(e),
        };
        if missing && follow_final {
            return Err(format!("ENOENT: no such file or directory, overlay '{current}'"));
        }
        for (backend, remaining, final_name) in link_checks {
            let checked = backend.access_path(&remaining, true).and_then(|p| backend.lstat(&p).map(|_| p))
                .map_err(|e| format!("{}, realpath '{remaining}'", e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)))?;
            let expected = if let Some(name) = final_name {
                let child = format!("{}/{name}", checked.trim_end_matches('/'));
                if let Err(e) = backend.lstat(&child) && !(missing && e.starts_with("ENOENT:")) {
                    let reason = e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason);
                    return Err(format!("{reason}, lstat '{remaining}/{name}'"));
                }
                child
            } else { checked };
            if expected != current { return Err(format!("ENOTSUP: backend cannot confirm the overlay symlink namespace, overlay '{path}'")); }
        }
    }
    Ok(current)
}

// Resolve parents before interpreting "..", without following the entry being moved.
pub(super) fn rename_entry(
    path: &str,
    max_hops: usize,
    parent_link: impl Fn(&str) -> Result<Option<String>, String>,
) -> Result<String, String> {
    if path.is_empty() { return Err("ENOENT: no such file or directory".into()); }
    if path.contains('\0') { return Err("EINVAL: invalid argument".into()); }
    let mut parts: Vec<_> = path.split('/').filter(|s| !s.is_empty()).rev().map(str::to_owned).collect();
    let mut current = String::from("/");
    let mut hops = 0;
    while let Some(part) = parts.pop() {
        if let Some(target) = parent_link(&current)? {
            hops += 1;
            if hops > max_hops { return Err("ELOOP: too many symbolic links encountered".into()); }
            current = if target.starts_with('/') { "/".into() } else { dirname_posix_path(&current) };
            parts.push(part);
            parts.extend(target.split('/').filter(|s| !s.is_empty()).rev().map(str::to_owned));
            continue;
        }
        if part.len() > 255 { return Err("ENAMETOOLONG: name too long".into()); }
        match part.as_str() {
            "." | ".." if parts.is_empty() => return Err("EINVAL: invalid argument".into()),
            "." => {}
            ".." => current = dirname_posix_path(&current),
            _ => {
                if current != "/" { current.push('/'); }
                current.push_str(&part);
            }
        }
    }
    Ok(current)
}

pub fn is_path_within(root: &str, candidate: &str) -> bool {
    let r = normalize_posix_path(root);
    let c = normalize_posix_path(candidate);
    if r == "/" {
        return true;
    }
    c == r || c.starts_with(&format!("{r}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_and_resolve_posix_paths_handle_dots_and_roots() {
        assert_eq!(normalize_posix_path(""), "/");
        assert_eq!(normalize_posix_path("///a/./b/../c//"), "/a/c");
        assert_eq!(normalize_posix_path("/../../escape"), "/escape");
        assert_eq!(resolve_posix_path("/workspace/sub", "../file.txt"), "/workspace/file.txt");
        assert_eq!(resolve_posix_path("/", "rel/path"), "/rel/path");
        assert_eq!(resolve_posix_path("/workspace", "/abs/path"), "/abs/path");
    }

    #[test]
    fn parent_basename_dirname_and_is_path_within_edge_cases() {
        assert_eq!(parent_posix_path("/"), None);
        assert_eq!(parent_posix_path("/a"), Some("/".into()));
        assert_eq!(parent_posix_path("/a/b/c"), Some("/a/b".into()));
        assert_eq!(basename_posix_path("/"), "/");
        assert_eq!(basename_posix_path("/a/b/c.txt/"), "c.txt");
        assert_eq!(dirname_posix_path("/"), "/");
        assert_eq!(dirname_posix_path("/a"), "/");
        assert_eq!(dirname_posix_path("bare.txt"), ".");
        assert!(is_path_within("/workspace", "/workspace/sub/file"));
        assert!(is_path_within("/workspace", "/workspace"));
        assert!(!is_path_within("/workspace", "/workspace2/file"));
    }

    #[test]
    fn resolve_posix_path_handles_nested_parent_references_and_trailing_slashes() {
        assert_eq!(resolve_posix_path("/a/b/c/", "../../d/./e/"), "/a/d/e");
        assert_eq!(basename_posix_path("///"), "/");
        assert_eq!(dirname_posix_path("relative_only.txt"), ".");
        assert!(is_path_within("/", "/any/path"));
    }
}
