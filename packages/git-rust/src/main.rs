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

struct NativeCurlHttpClient;

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

        for (k, v) in &req.headers {
            cmd.arg("-H").arg(format!("{k}: {v}"));
        }
        if !req.headers.keys().any(|k| k.eq_ignore_ascii_case("Authorization"))
            && let Some((user, pass)) = Self::resolve_git_credentials(&req.url)
        {
            cmd.arg("-u").arg(format!("{user}:{pass}"));
        }

        if !req.body.is_empty() {
            let _ = stdfs::write(&body_in_file, &req.body);
            cmd.arg("--data-binary").arg(format!("@{}", body_in_file.display()));
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
        if cur.join(".git").exists() || (cur.join("HEAD").is_file() && cur.join("objects").is_dir()) {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

fn load_host_dir_into_vfs(host_dir: &Path, vfs_dir: &str, fs: &MemoryFs, tracked_files: &mut BTreeSet<String>) {
    let _ = fs.mkdir(vfs_dir);
    let Ok(entries) = stdfs::read_dir(host_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name == "target" {
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
            load_host_dir_into_vfs(&host_path, &vfs_path, fs, tracked_files);
        } else if meta.is_file() {
            if let Ok(bytes) = stdfs::read(&host_path) {
                #[cfg(unix)]
                let mode = meta.permissions().mode();
                #[cfg(not(unix))]
                let mode = 0o100644u32;
                fs.write_with_mode(&vfs_path, &bytes, mode);
                tracked_files.insert(vfs_path);
            }
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
                    let target_str = String::from_utf8_lossy(&target_bytes).to_string();
                    if let Some(parent) = host_path.parent() {
                        let _ = stdfs::create_dir_all(parent);
                    }
                    let _ = stdfs::remove_file(host_path);
                    #[cfg(unix)]
                    let _ = unix_symlink(&target_str, host_path);
                }
            }
            NodeKind::File => {
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
        if old_path.starts_with(root) && !current_set.contains(old_path) {
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
        load_host_dir_into_vfs(&ssh_dir, "/home/user/.ssh", fs, &mut ignored);
    }
    let gitconfig = home.join(".gitconfig");
    if let Ok(global_cfg) = stdfs::read_to_string(&gitconfig) {
        fs.write_str("/home/user/.gitconfig", &global_cfg);
        if let Some(gd) = repo_gitdir && fs.exists(&format!("{}/HEAD", gd.trim_end_matches('/'))) {
            let local_cfg_path = format!("{}/config", gd.trim_end_matches('/'));
            let local_cfg = fs.read_str(&local_cfg_path).unwrap_or_default();
            if !local_cfg.contains("[user]") && global_cfg.contains("[user]") {
                fs.write_str(&local_cfg_path, &format!("{local_cfg}\n{global_cfg}"));
            }
        }
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

    let repo_root_path = find_host_repo_root(&effective_cwd).unwrap_or_else(|| effective_cwd.clone());
    let repo_root_str = repo_root_path.to_string_lossy().to_string();
    if repo_root_path.exists() {
        load_host_dir_into_vfs(&repo_root_path, &repo_root_str, &fs, &mut initial_files);
    }
    synced_roots.push(repo_root_str.clone());

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
        if let Some(common_parent) = resolved_gd.parent().and_then(|p| p.parent())
            && common_parent.exists()
        {
            let cp_str = common_parent.to_string_lossy().to_string();
            load_host_dir_into_vfs(common_parent, &cp_str, &fs, &mut initial_files);
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
        let cand_str = cand.to_string_lossy().to_string();
        if cand.exists() && !synced_roots.iter().any(|r| cand_str.starts_with(r)) {
            load_host_dir_into_vfs(&cand, &cand_str, &fs, &mut initial_files);
            synced_roots.push(cand_str);
        } else if !cand.exists() {
            let _ = fs.mkdir(&cand_str);
            synced_roots.push(cand_str);
        }
    }

    // If `.git/config` has a local remote URL, load it into VFS as well
    let gitdir_guess = format!("{}/.git", repo_root_str.trim_end_matches('/'));
    if let Some(cfg_text) = fs.read_str(&format!("{gitdir_guess}/config")) {
        for line in cfg_text.lines() {
            if let Some((_, val)) = line.trim().split_once('=') {
                let u = val.trim();
                let p_opt = u
                    .strip_prefix("file://")
                    .map(PathBuf::from)
                    .or_else(|| if u.starts_with('/') { Some(PathBuf::from(u)) } else { None });
                if let Some(p) = p_opt
                    && p.exists()
                {
                    let p_str = p.to_string_lossy().to_string();
                    if !synced_roots.iter().any(|r| p_str.starts_with(r)) {
                        load_host_dir_into_vfs(&p, &p_str, &fs, &mut initial_files);
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
    let cwd_str = host_cwd.to_string_lossy().to_string();
    let http_client = NativeCurlHttpClient;
    let res = execute_git_cli_with_input(
        &fs,
        &cwd_str,
        &arg_refs,
        &http_client,
        &stdin_buf,
    );

    for root in &synced_roots {
        sync_vfs_root_to_host(root, &fs, &initial_files);
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
