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
}
