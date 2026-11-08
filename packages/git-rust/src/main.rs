use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs as stdfs;
use std::io::{self, IsTerminal, Read, Write};
#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink as unix_symlink};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use git_rust::cli::execute_git_cli_with_input;
use git_rust::errors::GitError;
use git_rust::fs::{MemoryFs, NodeKind};
use git_rust::http::{GitHttpRequest, GitHttpResponse, HttpClient};

struct NativeCurlHttpClient {
    connect_to: Vec<String>,
}

impl NativeCurlHttpClient {
    fn resolve_git_credentials(url: &str) -> Option<(String, String)> {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))?;
        let protocol = if url.starts_with("https://") {
            "https"
        } else {
            "http"
        };
        let host = rest.split('/').next()?;
        if host.contains('@') {
            return None;
        }
        if let Ok(token) = env::var("GITHUB_TOKEN").or_else(|_| env::var("GH_TOKEN"))
            && (host.contains("github.com") || !token.is_empty())
        {
            return Some(("x-access-token".to_string(), token));
        }
        let mut child = Command::new("git")
            .args(["credential", "fill"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = writeln!(stdin, "protocol={protocol}\nhost={host}\n");
        }
        let out = child.wait_with_output().ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let mut username = None;
        let mut password = None;
        for line in text.lines() {
            if let Some(u) = line.strip_prefix("username=") {
                username = Some(u.trim().to_string());
            } else if let Some(p) = line.strip_prefix("password=") {
                password = Some(p.trim().to_string());
            }
        }
        match (username, password) {
            (Some(u), Some(p)) if !p.is_empty() => Some((u, p)),
            _ => None,
        }
    }
}

impl HttpClient for NativeCurlHttpClient {
    fn request(&self, req: GitHttpRequest) -> Result<GitHttpResponse, GitError> {
        let tmp_dir = env::temp_dir().join(format!("git-rust-http-{}", std::process::id()));
        let _ = stdfs::create_dir_all(&tmp_dir);
        let hdr_file = tmp_dir.join("headers.txt");
        let body_in_file = tmp_dir.join("req_body.bin");
        let body_out_file = tmp_dir.join("resp_body.bin");

        let mut cmd = Command::new("curl");
        cmd.arg("-sS")
            .arg("-L")
            .arg("-X")
            .arg(&req.method)
            .arg("-D")
            .arg(&hdr_file)
            .arg("-o")
            .arg(&body_out_file);

        for ct in &self.connect_to {
            cmd.arg("--connect-to").arg(ct);
        }
        for (k, v) in &req.headers {
            cmd.arg("-H").arg(format!("{k}: {v}"));
        }
        if !req
            .headers
            .keys()
            .any(|k| k.eq_ignore_ascii_case("Authorization"))
            && let Some((user, pass)) = Self::resolve_git_credentials(&req.url)
        {
            cmd.arg("-u").arg(format!("{user}:{pass}"));
        }

        if !req.body.is_empty() {
            let _ = stdfs::write(&body_in_file, &req.body);
            cmd.arg("--data-binary")
                .arg(format!("@{}", body_in_file.display()));
        }
        cmd.arg(&req.url);

        let status = cmd
            .status()
            .map_err(|e| GitError::http(500, &format!("curl execution failed: {e}"), ""))?;
        if !status.success() {
            let _ = stdfs::remove_dir_all(&tmp_dir);
            return Err(GitError::http(502, "curl request failed", &req.url));
        }

        let hdr_text = stdfs::read_to_string(&hdr_file).unwrap_or_default();
        let resp_body = stdfs::read(&body_out_file).unwrap_or_default();
        let _ = stdfs::remove_dir_all(&tmp_dir);

        let mut status_code = 200u16;
        let mut status_message = "OK".to_string();
        let mut headers = BTreeMap::new();
        for line in hdr_text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("HTTP/") {
                headers.clear();
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if let Some(code_str) = parts.get(1)
                    && let Ok(c) = code_str.parse::<u16>()
                {
                    status_code = c;
                }
                status_message = parts.get(2..).map(|s| s.join(" ")).unwrap_or_default();
            } else if let Some((k, v)) = trimmed.split_once(':') {
                headers.insert(k.trim().to_lowercase(), v.trim().to_string());
            }
        }

        Ok(GitHttpResponse {
            url: req.url,
            method: req.method,
            status_code,
            status_message,
            headers,
            body: resp_body,
        })
    }
}

fn find_host_repo_root(start: &Path) -> Option<PathBuf> {
    let mut cur = start.to_path_buf();
    loop {
        if cur.join(".git").exists() || (cur.join("HEAD").is_file() && cur.join("objects").is_dir())
        {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

fn admit_snapshot_path(path: &Path, tracked: &BTreeSet<PathBuf>, tracked_only: bool) -> bool {
    if tracked.range(path.to_path_buf()..).next().is_some_and(|p| p.starts_with(path)) {
        return true;
    }
    if tracked_only {
        return false;
    }
    !matches!(path.file_name().and_then(|s| s.to_str()),
        Some("node_modules" | "target" | "rr-cache" | "lost-found" | "logs"))
}

fn load_host_dir_into_vfs(
    host_dir: &Path,
    vfs_dir: &str,
    fs: &MemoryFs,
    tracked_files: &mut BTreeSet<String>,
    admission: Option<(&Path, &BTreeSet<PathBuf>, bool)>,
) {
    let _ = fs.mkdir(vfs_dir);
    let Ok(entries) = stdfs::read_dir(host_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let admitted = match admission {
            Some((root, tracked, only)) if !entry.path().starts_with(root.join(".git")) => {
                admit_snapshot_path(&entry.path(), tracked, only)
            }
            _ => admit_snapshot_path(&entry.path(), &BTreeSet::new(), false),
        };
        if !admitted {
            continue;
        }
        let host_path = entry.path();
        let vfs_path = if vfs_dir == "/" {
            format!("/{name}")
        } else {
            format!("{}/{name}", vfs_dir.trim_end_matches('/'))
        };
        let Ok(meta) = stdfs::symlink_metadata(&host_path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            if let Ok(target) = stdfs::read_link(&host_path) {
                let target_str = target.to_string_lossy().to_string();
                let _ = fs.writelink(&vfs_path, target_str.as_bytes());
                tracked_files.insert(vfs_path);
            }
        } else if meta.is_dir() {
            load_host_dir_into_vfs(&host_path, &vfs_path, fs, tracked_files, admission);
        } else if meta.is_file() {
            #[cfg(unix)]
            let mode = meta.permissions().mode();
            #[cfg(not(unix))]
            let mode = 0o100644u32;
            fs.register_host_file(&vfs_path, host_path, meta.len(), mode);
            tracked_files.insert(vfs_path);
        }
    }
}

fn sync_vfs_root_to_host(root: &str, fs: &MemoryFs, initial_files: &BTreeSet<String>) {
    let current_paths = fs.list_paths_under(root);
    let current_set: BTreeSet<String> = current_paths.iter().cloned().collect();

    for path in &current_paths {
        let Ok(st) = fs.lstat(path) else { continue };
        let host_path = Path::new(path);
        match st.kind {
            NodeKind::Directory => {
                let _ = stdfs::create_dir_all(host_path);
            }
            NodeKind::Symlink => {
                if let Ok(target_bytes) = fs.readlink(path) {
                    let _target_str = String::from_utf8_lossy(&target_bytes).to_string();
                    if let Some(parent) = host_path.parent() {
                        let _ = stdfs::create_dir_all(parent);
                    }
                    let _ = stdfs::remove_file(host_path);
                    #[cfg(unix)]
                    let _ = unix_symlink(&_target_str, host_path);
                }
            }
            NodeKind::File => {
                if !fs.is_modified_file(path) {
                    continue;
                }
                if let Some(bytes) = fs.read(path) {
                    let unchanged = stdfs::read(host_path).map(|b| b == bytes).unwrap_or(false);
                    if !unchanged {
                        if let Some(parent) = host_path.parent() {
                            let _ = stdfs::create_dir_all(parent);
                        }
                        let _ = stdfs::write(host_path, &bytes);
                    }
                    #[cfg(unix)]
                    {
                        let exec = (st.mode & 0o111) != 0;
                        if let Ok(meta) = stdfs::metadata(host_path) {
                            let mut perms = meta.permissions();
                            let desired = if exec { 0o755 } else { 0o644 };
                            if (perms.mode() & 0o777) != desired {
                                perms.set_mode(desired);
                                let _ = stdfs::set_permissions(host_path, perms);
                            }
                        }
                    }
                }
            }
        }
    }

    for old_path in initial_files {
        if path_is_within(old_path, root) && !current_set.contains(old_path) {
            let _ = stdfs::remove_file(Path::new(old_path));
        }
    }
}

fn load_home_ssh_and_gitconfig(fs: &MemoryFs, repo_gitdir: Option<&str>) {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        return;
    };
    let ssh_dir = home.join(".ssh");
    if ssh_dir.is_dir() {
        let mut ignored = BTreeSet::new();
        load_host_dir_into_vfs(&ssh_dir, "/home/user/.ssh", fs, &mut ignored, None);
    }
    let gitconfig = home.join(".gitconfig");
    if let Ok(global_cfg) = stdfs::read_to_string(&gitconfig) {
        fs.write_str("/home/user/.gitconfig", &global_cfg);
        if let Some(gd) = repo_gitdir
            && fs.exists(&format!("{}/HEAD", gd.trim_end_matches('/')))
        {
            let local_cfg_path = format!("{}/config", gd.trim_end_matches('/'));
            let mut local_cfg = fs.read_str(&local_cfg_path).unwrap_or_default();
            if !local_cfg.contains("[user]") && global_cfg.contains("[user]") {
                local_cfg = format!("{local_cfg}\n{global_cfg}");
                fs.write_str(&local_cfg_path, &local_cfg);
            }
            if let Ok(env_name) =
                env::var("GIT_AUTHOR_NAME").or_else(|_| env::var("GIT_COMMITTER_NAME"))
            {
                let _ = git_rust::set_config(fs, gd, "user.name", Some(&env_name), false);
            }
            if let Ok(env_email) =
                env::var("GIT_AUTHOR_EMAIL").or_else(|_| env::var("GIT_COMMITTER_EMAIL"))
            {
                let _ = git_rust::set_config(fs, gd, "user.email", Some(&env_email), false);
            }
            if let Ok(ssh_cmd) = env::var("GIT_SSH_COMMAND") {
                let _ = git_rust::set_config(fs, gd, "core.sshCommand", Some(&ssh_cmd), false);
            }
        }
    }
}

fn path_is_within(candidate: &str, root: &str) -> bool {
    Path::new(candidate).starts_with(Path::new(root))
}

fn load_argument_path(
    cand: &Path,
    fs: &MemoryFs,
    synced_roots: &mut Vec<String>,
    initial_files: &mut BTreeSet<String>,
) {
    let cand_str = cand.to_string_lossy().to_string();
    if cand.exists() && !synced_roots.iter().any(|r| path_is_within(&cand_str, r)) {
        load_host_dir_into_vfs(cand, &cand_str, fs, initial_files, None);
        synced_roots.push(cand_str);
    } else if !cand.exists() {
        synced_roots.push(cand_str);
    }
}

fn main() {
    let raw_args: Vec<String> = env::args().skip(1).collect();
    if raw_args.iter().any(|a| a == "--version" || a == "-v") && raw_args.len() == 1 {
        println!("git version 2.46.0 (git-rust 0.1.0)");
        return;
    }

    let host_cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let mut effective_cwd = host_cwd.clone();
    let mut idx = 0;
    while idx < raw_args.len() {
        if raw_args[idx] == "-C" && idx + 1 < raw_args.len() {
            let p = Path::new(&raw_args[idx + 1]);
            effective_cwd = if p.is_absolute() {
                p.to_path_buf()
            } else {
                effective_cwd.join(p)
            };
            idx += 2;
        } else {
            break;
        }
    }

    let fs = MemoryFs::new();
    let mut synced_roots: Vec<String> = Vec::new();
    let mut initial_files = BTreeSet::new();

    let subcmd = raw_args.get(idx).map(|s| s.as_str()).unwrap_or("");
    let git_dir_only_cmd = matches!(
        subcmd,
        "log"
            | "rev-parse"
            | "branch"
            | "tag"
            | "config"
            | "remote"
            | "show"
            | "cat-file"
            | "for-each-ref"
            | "symbolic-ref"
            | "update-ref"
            | "verify-commit"
            | "verify-tag"
            | "ls-remote"
            | "ls-tree"
            | "describe"
            | "shortlog"
            | "reflog"
            | "push"
            | "fetch"
            | "hash-object"
            | "var"
            | "check-ref-format"
    );
    let read_only_cmd = matches!(
        subcmd,
        "log"
            | "status"
            | "diff"
            | "rev-parse"
            | "show"
            | "cat-file"
            | "ls-files"
            | "ls-tree"
            | "for-each-ref"
            | "describe"
            | "verify-commit"
            | "verify-tag"
            | "shortlog"
            | "blame"
            | "reflog"
            | "var"
            | "ls-remote"
    );

    let repo_root_path =
        find_host_repo_root(&effective_cwd).unwrap_or_else(|| effective_cwd.clone());
    let repo_root_str = repo_root_path.to_string_lossy().to_string();
    // Read the index before walking the worktree: ignored build/cache names can
    // still contain tracked files. A diff needs no untracked worktree entries.
    let dot_git = repo_root_path.join(".git");
    let index_dir = if dot_git.is_file() {
        stdfs::read_to_string(&dot_git).ok().and_then(|text| {
            text.trim().strip_prefix("gitdir:").map(|dir| repo_root_path.join(dir.trim()))
        })
    } else {
        Some(dot_git)
    };
    let index = index_dir.and_then(|dir| stdfs::read(dir.join("index")).ok())
        .and_then(|bytes| git_rust::models::GitIndex::from_buffer(&bytes).ok());
    let indexed_paths: BTreeSet<PathBuf> = index.as_ref().map(|index| {
        index.entries().into_iter().map(|entry| repo_root_path.join(entry.path)).collect()
    }).unwrap_or_default();
    let _ = fs.mkdir(&repo_root_str);
    let _ = fs.mkdir(&effective_cwd.to_string_lossy());
    if repo_root_path.exists() {
        if git_dir_only_cmd {
            let dot_git = repo_root_path.join(".git");
            let dot_git_vfs = format!("{}/.git", repo_root_str.trim_end_matches('/'));
            if dot_git.is_dir() {
                load_host_dir_into_vfs(&dot_git, &dot_git_vfs, &fs, &mut initial_files, None);
                synced_roots.push(dot_git_vfs);
            } else if dot_git.is_file()
                && let Ok(bytes) = stdfs::read(&dot_git)
            {
                fs.write_with_mode(&dot_git_vfs, &bytes, 0o100644);
                initial_files.insert(dot_git_vfs.clone());
                synced_roots.push(dot_git_vfs);
            } else if repo_root_path.join("HEAD").is_file() {
                load_host_dir_into_vfs(&repo_root_path, &repo_root_str, &fs, &mut initial_files, None);
                synced_roots.push(repo_root_str.clone());
            }
        } else {
            load_host_dir_into_vfs(&repo_root_path, &repo_root_str, &fs, &mut initial_files,
                Some((&repo_root_path, &indexed_paths, subcmd == "diff" && index.is_some())));
            synced_roots.push(repo_root_str.clone());
        }
    } else {
        synced_roots.push(repo_root_str.clone());
    }

    // If `.git` is a gitfile pointing to an external worktree/common gitdir, load that too
    let dot_git = repo_root_path.join(".git");
    if dot_git.is_file()
        && let Ok(text) = stdfs::read_to_string(&dot_git)
        && let Some(gd_raw) = text.trim().strip_prefix("gitdir:")
    {
        let gd_path = Path::new(gd_raw.trim());
        let resolved_gd = if gd_path.is_absolute() {
            gd_path.to_path_buf()
        } else {
            repo_root_path.join(gd_path)
        };
        let gd_str = resolved_gd.to_string_lossy().to_string();
        if resolved_gd.exists() {
            load_host_dir_into_vfs(&resolved_gd, &gd_str, &fs, &mut initial_files, None);
            synced_roots.push(gd_str.clone());
        }
        if let Some(common_parent) = resolved_gd.parent().and_then(|p| p.parent())
            && common_parent.exists()
        {
            let cp_str = common_parent.to_string_lossy().to_string();
            load_host_dir_into_vfs(common_parent, &cp_str, &fs, &mut initial_files, None);
            for shared in ["objects", "refs", "packed-refs", "config", "hooks", "info"] {
                let target = format!("{cp_str}/{shared}");
                let link_path = format!("{gd_str}/{shared}");
                if fs.exists(&target) {
                    if fs.readdir(&link_path).is_ok_and(|c| c.is_empty()) {
                        let _ = fs.rmdir(&link_path);
                    }
                    if !fs.exists(&link_path) {
                        let _ = fs.writelink(&link_path, target.as_bytes());
                    } else if shared == "refs"
                        && let Ok(entries) = fs.readdir(&target)
                    {
                        for child in entries {
                            let child_target = format!("{target}/{child}");
                            let child_link = format!("{link_path}/{child}");
                            if !fs.exists(&child_link) {
                                let _ = fs.writelink(&child_link, child_target.as_bytes());
                            }
                        }
                    }
                }
            }
            synced_roots.push(cp_str);
        }
    }

    // Also load any local filesystem paths referenced in arguments (e.g. `clone /path/to/src /path/to/dst`)
    for arg in &raw_args[idx..] {
        if arg.starts_with('-') {
            continue;
        }
        let cand = if let Some(stripped) = arg.strip_prefix("file://") {
            PathBuf::from(stripped)
        } else if arg.starts_with('/') || arg.starts_with("./") || arg.starts_with("../") {
            let p = Path::new(arg);
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                effective_cwd.join(p)
            }
        } else {
            continue;
        };
        load_argument_path(&cand, &fs, &mut synced_roots, &mut initial_files);
    }

    // If `.git/config` has a local remote URL, load it into VFS as well
    let gitdir_guess = format!("{}/.git", repo_root_str.trim_end_matches('/'));
    if let Some(cfg_text) = fs.read_str(&format!("{gitdir_guess}/config")) {
        for line in cfg_text.lines() {
            if let Some((_, val)) = line.trim().split_once('=') {
                let u = val.trim();
                let p_opt = u.strip_prefix("file://").map(PathBuf::from).or_else(|| {
                    if u.starts_with('/') {
                        Some(PathBuf::from(u))
                    } else {
                        None
                    }
                });
                if let Some(p) = p_opt
                    && p.exists()
                {
                    let p_str = p.to_string_lossy().to_string();
                    if !synced_roots.iter().any(|r| path_is_within(&p_str, r)) {
                        load_host_dir_into_vfs(&p, &p_str, &fs, &mut initial_files, None);
                        synced_roots.push(p_str);
                    }
                }
            }
        }
    }

    load_home_ssh_and_gitconfig(&fs, Some(&gitdir_guess));

    let mut stdin_buf = Vec::new();
    if !io::stdin().is_terminal() {
        let _ = io::stdin().read_to_end(&mut stdin_buf);
    }

    let arg_refs: Vec<&str> = raw_args.iter().map(String::as_str).collect();
    let cwd_str = effective_cwd.to_string_lossy().to_string();
    let mut connect_to = Vec::new();
    for i in 0..raw_args.len() {
        if raw_args[i] == "-c"
            && i + 1 < raw_args.len()
            && let Some((k, v)) = raw_args[i + 1].split_once('=')
            && k.to_lowercase().ends_with(".connectto")
        {
            connect_to.push(v.to_string());
        }
    }
    if let Ok(env_ct) = env::var("GIT_CURL_CONNECT_TO") {
        connect_to.push(env_ct);
    }
    let http_client = NativeCurlHttpClient { connect_to };
    let mut request_env: BTreeMap<String, String> = env::vars()
        .filter(|(name, _)| name.starts_with("GIT_AUTHOR_") || name.starts_with("GIT_COMMITTER_"))
        .collect();
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .expect("system clock precedes Unix epoch").as_secs();
    for role in ["AUTHOR", "COMMITTER"] {
        request_env.entry(format!("GIT_{role}_DATE")).or_insert_with(|| format!("{timestamp} +0000"));
    }
    let _environment = git_rust::environment::EnvironmentScope::new(request_env);
    let res = execute_git_cli_with_input(&fs, &cwd_str, &arg_refs, &http_client, &stdin_buf);

    if !read_only_cmd {
        for root in &synced_roots {
            sync_vfs_root_to_host(root, &fs, &initial_files);
        }
    }

    if let Some(ref raw_bytes) = res.stdout_bytes {
        let _ = io::stdout().write_all(raw_bytes);
    } else if !res.stdout.is_empty() {
        print!("{}", res.stdout);
    }
    if !res.stderr.is_empty() {
        eprint!("{}", res.stderr);
    }
    std::process::exit(res.exit_code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_admits_tracked_paths_below_excluded_names() {
        for name in ["node_modules", "target", "rr-cache", "lost-found", "logs"] {
            for prefix in ["/repo", "/repo/nested"] {
                let dir = PathBuf::from(format!("{prefix}/{name}"));
                let file = dir.join("tracked.txt");
                let tracked = BTreeSet::from([file.clone()]);
                assert!(admit_snapshot_path(&dir, &tracked, false), "{dir:?}");
                assert!(admit_snapshot_path(&file, &tracked, false));
                assert!(!admit_snapshot_path(&dir, &BTreeSet::new(), false));
            }
        }
    }

    #[test]
    fn tracked_snapshot_avoids_unrelated_worktree_entries() {
        let tracked = BTreeSet::from([PathBuf::from("/repo/src/file")]);
        assert!(admit_snapshot_path(Path::new("/repo/src"), &tracked, true));
        assert!(admit_snapshot_path(Path::new("/repo/src/file"), &tracked, true));
        assert!(!admit_snapshot_path(Path::new("/repo/src/untracked"), &tracked, true));
        assert!(!admit_snapshot_path(Path::new("/repo/other"), &tracked, true));
    }

    #[test]
    fn missing_argument_paths_only_register_potential_outputs() {
        let fs = MemoryFs::new();
        let mut roots = vec!["/repo".to_string()];
        let mut initial = BTreeSet::new();
        let missing = "/nonexistent-git-rust-issue-4100/missing.txt";
        load_argument_path(Path::new(missing), &fs, &mut roots, &mut initial);
        assert!(!fs.exists(missing));
        assert_eq!(roots, ["/repo", missing]);
        assert!(initial.is_empty());
    }

    #[test]
    fn root_containment_respects_path_components() {
        assert!(path_is_within("/tmp/repo", "/tmp/repo"));
        assert!(path_is_within("/tmp/repo/sub/file", "/tmp/repo"));
        assert!(path_is_within("/tmp/repo/sub", "/tmp/repo/"));
        assert!(path_is_within("/tmp/repo", "/"));
        assert!(!path_is_within("/tmp/repo-remote", "/tmp/repo"));
        assert!(!path_is_within("/tmp/repository/file", "/tmp/repo"));
    }
}
