use std::collections::{BTreeMap, BTreeSet};

use crate::commands::plumbing::{init, set_config};
use crate::commands::worktree::checkout;
use crate::crypto::{
    base64_decode, ed25519_public_key, parse_openssh_ed25519_private_key,
    parse_openssh_ed25519_public_key, sha1_hmac, ssh_key_fingerprint_sha256,
};
use crate::errors::{ErrorCode, GitError};
use crate::fs::{discover_gitdir, MemoryFs};
use crate::hooks::run_hook;
use crate::http::collect_reachable_objects;
use crate::managers::{GitConfigManager, GitRefManager};
use crate::storage::{read_object, write_object};
use crate::utils::{join, ServerRef};
use crate::commands::network::FetchResult;
use crate::wire::{PushResult, RefUpdateStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshEndpoint {
    pub user: String,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub is_local_path: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshHostConfig {
    pub host_name: String,
    pub user: String,
    pub port: u16,
    pub identity_file: Option<String>,
    pub strict_host_key_checking: String,
    pub user_known_hosts_file: String,
}

pub fn is_ssh_or_local_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("git://") || trimmed.starts_with("oid:") {
        return false;
    }
    if trimmed.starts_with("ssh://") || trimmed.starts_with("file://") || trimmed.starts_with('/') || trimmed.starts_with("./") || trimmed.starts_with("../") {
        return true;
    }
    if let Some((before_colon, after_colon)) = trimmed.split_once(':')
        && !before_colon.contains('/')
        && !after_colon.is_empty()
        && before_colon.contains('@')
    {
        return true;
    }
    false
}

pub fn parse_ssh_url(url: &str) -> Option<SshEndpoint> {
    let trimmed = url.trim();
    if let Some(rest) = trimmed.strip_prefix("file://") {
        return Some(SshEndpoint {
            user: String::new(),
            host: "localhost".to_string(),
            port: 22,
            path: rest.to_string(),
            is_local_path: true,
        });
    }
    if trimmed.starts_with('/') || trimmed.starts_with("./") || trimmed.starts_with("../") {
        return Some(SshEndpoint {
            user: String::new(),
            host: "localhost".to_string(),
            port: 22,
            path: trimmed.to_string(),
            is_local_path: true,
        });
    }
    if let Some(rest) = trimmed.strip_prefix("ssh://") {
        let (authority, path_part) = match rest.split_once('/') {
            Some((a, p)) => (a, format!("/{p}")),
            None => return None,
        };
        let (user, host_port) = match authority.split_once('@') {
            Some((u, hp)) => (u.to_string(), hp),
            None => ("git".to_string(), authority),
        };
        let (host, port) = match host_port.split_once(':') {
            Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(22)),
            None => (host_port.to_string(), 22),
        };
        if host.is_empty() {
            return None;
        }
        return Some(SshEndpoint {
            user,
            host,
            port,
            path: path_part.trim_start_matches('/').to_string(),
            is_local_path: false,
        });
    }
    if let Some((before_colon, after_colon)) = trimmed.split_once(':')
        && !before_colon.contains('/')
        && !after_colon.is_empty()
    {
        let (user, host) = match before_colon.split_once('@') {
            Some((u, h)) => (u.to_string(), h.to_string()),
            None => return None,
        };
        if user.is_empty() || host.is_empty() {
            return None;
        }
        return Some(SshEndpoint {
            user,
            host,
            port: 22,
            path: after_colon.trim_start_matches('/').to_string(),
            is_local_path: false,
        });
    }
    None
}

fn glob_match(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star_pi, mut star_ti) = (None, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_pi = Some(pi);
            pi += 1;
            star_ti = ti;
        } else if let Some(sp) = star_pi {
            pi = sp + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

pub fn resolve_ssh_config(
    fs: &MemoryFs,
    repo_root: Option<&str>,
    gitdir: Option<&str>,
    endpoint: &SshEndpoint,
) -> SshHostConfig {
    let mut cfg = SshHostConfig {
        host_name: endpoint.host.clone(),
        user: if endpoint.user.is_empty() {
            "git".to_string()
        } else {
            endpoint.user.clone()
        },
        port: endpoint.port,
        identity_file: None,
        strict_host_key_checking: "accept-new".to_string(),
        user_known_hosts_file: "/home/user/.ssh/known_hosts".to_string(),
    };

    // Check core.sshCommand in git config first
    if let Some(gd) = gitdir
        && let Some(ssh_cmd_val) = GitConfigManager::get(fs, gd).get("core.sshCommand")
    {
        apply_ssh_command_flags(&ssh_cmd_val.as_str(), &mut cfg);
    }

    // Candidate ssh config files in MemoryFs
    let mut config_paths = vec![
        "/home/user/.ssh/config".to_string(),
        "/root/.ssh/config".to_string(),
        "/.ssh/config".to_string(),
    ];
    if let Some(root) = repo_root {
        config_paths.insert(0, format!("{root}/.ssh/config"));
    }

    for path in config_paths {
        if let Some(text) = fs.read_str(&path) {
            parse_ssh_config_text(&text, &endpoint.host, &mut cfg);
            break;
        }
    }

    if cfg.identity_file.is_none() {
        let default_keys = [
            repo_root.map(|r| format!("{r}/.ssh/id_ed25519")).unwrap_or_default(),
            "/home/user/.ssh/id_ed25519".to_string(),
            "/root/.ssh/id_ed25519".to_string(),
            "/.ssh/id_ed25519".to_string(),
        ];
        for k in default_keys {
            if !k.is_empty() && fs.exists(&k) {
                cfg.identity_file = Some(k);
                break;
            }
        }
    }

    cfg
}

fn apply_ssh_command_flags(cmd: &str, cfg: &mut SshHostConfig) {
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    let mut i = 0;
    while i < parts.len() {
        match parts[i] {
            "-i" if i + 1 < parts.len() => {
                cfg.identity_file = Some(parts[i + 1].trim_matches(&['\'', '"'][..]).to_string());
                i += 2;
            }
            "-p" if i + 1 < parts.len() => {
                if let Ok(p) = parts[i + 1].parse::<u16>() {
                    cfg.port = p;
                }
                i += 2;
            }
            "-o" if i + 1 < parts.len() => {
                let opt = parts[i + 1].trim_matches(&['\'', '"'][..]);
                if let Some((k, v)) = opt.split_once('=') {
                    if k.eq_ignore_ascii_case("StrictHostKeyChecking") {
                        cfg.strict_host_key_checking = v.to_lowercase();
                    } else if k.eq_ignore_ascii_case("UserKnownHostsFile") {
                        cfg.user_known_hosts_file = v.to_string();
                    } else if k.eq_ignore_ascii_case("IdentityFile") {
                        cfg.identity_file = Some(v.to_string());
                    }
                }
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }
}

pub fn parse_ssh_config_text(text: &str, target_host: &str, cfg: &mut SshHostConfig) {
    let mut active = true;
    let mut seen_hostname = false;
    let mut seen_user = false;
    let mut seen_port = false;
    let mut seen_identity = false;
    let mut seen_strict = false;
    let mut seen_known_hosts = false;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(2, |c: char| c.is_ascii_whitespace() || c == '=');
        let Some(key) = parts.next() else { continue };
        let Some(val) = parts.next().map(|v| v.trim().trim_matches('"')) else { continue };

        if key.eq_ignore_ascii_case("Host") {
            active = val
                .split_whitespace()
                .any(|pat| glob_match(pat, target_host));
            continue;
        }
        if !active {
            continue;
        }
        if key.eq_ignore_ascii_case("HostName") && !seen_hostname {
            cfg.host_name = val.to_string();
            seen_hostname = true;
        } else if key.eq_ignore_ascii_case("User") && !seen_user {
            cfg.user = val.to_string();
            seen_user = true;
        } else if key.eq_ignore_ascii_case("Port") && !seen_port {
            if let Ok(p) = val.parse::<u16>() {
                cfg.port = p;
                seen_port = true;
            }
        } else if key.eq_ignore_ascii_case("IdentityFile") && !seen_identity {
            let expanded = if let Some(rest) = val.strip_prefix("~/") {
                format!("/home/user/{rest}")
            } else {
                val.to_string()
            };
            cfg.identity_file = Some(expanded);
            seen_identity = true;
        } else if key.eq_ignore_ascii_case("StrictHostKeyChecking") && !seen_strict {
            cfg.strict_host_key_checking = val.to_lowercase();
            seen_strict = true;
        } else if key.eq_ignore_ascii_case("UserKnownHostsFile") && !seen_known_hosts {
            let expanded = if let Some(rest) = val.strip_prefix("~/") {
                format!("/home/user/{rest}")
            } else {
                val.to_string()
            };
            cfg.user_known_hosts_file = expanded;
            seen_known_hosts = true;
        }
    }
}

pub fn host_matches_known_hosts_entry(entry_hosts: &str, host: &str, port: u16) -> bool {
    let bracketed = format!("[{host}]:{port}");
    if let Some(rest) = entry_hosts.strip_prefix("|1|") {
        let mut parts = rest.split('|');
        let Some(salt_b64) = parts.next() else { return false };
        let Some(hash_b64) = parts.next() else { return false };
        let Some(salt) = base64_decode(salt_b64) else { return false };
        let Some(expected) = base64_decode(hash_b64) else { return false };
        let mac_host = sha1_hmac(&salt, host.as_bytes());
        if mac_host.as_slice() == expected.as_slice() {
            return true;
        }
        let mac_bracket = sha1_hmac(&salt, bracketed.as_bytes());
        return mac_bracket.as_slice() == expected.as_slice();
    }
    for token in entry_hosts.split(',') {
        let t = token.trim();
        if t == host || t == bracketed || (port == 22 && t == format!("[{host}]:22")) {
            return true;
        }
    }
    false
}

pub fn verify_host_and_auth(
    fs: &MemoryFs,
    cfg: &SshHostConfig,
    remote_gitdir: &str,
) -> Result<(), GitError> {
    // 1. Check host key if server exposes host_key.pub
    let host_key_candidates = [
        format!("/remotes/{}/host_key.pub", cfg.host_name),
        format!("{remote_gitdir}/host_key.pub"),
    ];
    let server_host_key = host_key_candidates
        .iter()
        .find_map(|p| fs.read_str(p))
        .map(|s| s.trim().to_string());

    if let Some(ref server_pub_line) = server_host_key
        && cfg.strict_host_key_checking != "no"
    {
        let server_parts: Vec<&str> = server_pub_line.split_whitespace().collect();
        let server_key_b64 = server_parts.get(1).copied().unwrap_or("");
        let known_text = fs.read_str(&cfg.user_known_hosts_file).unwrap_or_default();
        let mut matched_host = false;
        let mut key_matched = false;
        for line in known_text.lines() {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') {
                continue;
            }
            let cols: Vec<&str> = l.split_whitespace().collect();
            if cols.len() >= 3 && host_matches_known_hosts_entry(cols[0], &cfg.host_name, cfg.port) {
                matched_host = true;
                if cols[2] == server_key_b64 {
                    key_matched = true;
                    break;
                }
            }
        }
        if matched_host && !key_matched {
            return Err(GitError::new(ErrorCode::InternalError, format!(
                    "Host key verification failed for {}: REMOTE HOST IDENTIFICATION HAS CHANGED!",
                    cfg.host_name
                ), BTreeMap::new()));
        }
        if !matched_host {
            if cfg.strict_host_key_checking == "yes" {
                return Err(GitError::new(ErrorCode::InternalError, format!(
                        "Host key verification failed: No ED25519 host key is known for {}",
                        cfg.host_name
                    ), BTreeMap::new()));
            } else if cfg.strict_host_key_checking == "accept-new" && !server_key_b64.is_empty() {
                let ktype = server_parts.first().copied().unwrap_or("ssh-ed25519");
                let host_token = if cfg.port == 22 {
                    cfg.host_name.clone()
                } else {
                    format!("[{}]:{}", cfg.host_name, cfg.port)
                };
                let new_line = format!("{host_token} {ktype} {server_key_b64}\n");
                let updated = format!("{known_text}{new_line}");
                fs.write_str(&cfg.user_known_hosts_file, &updated);
            }
        }
    }

    // 2. Check authorized_keys if server defines one
    let auth_keys_candidates = [
        format!("{remote_gitdir}/authorized_keys"),
        format!("/remotes/{}/authorized_keys", cfg.host_name),
    ];
    if let Some(auth_keys_text) = auth_keys_candidates.iter().find_map(|p| fs.read_str(p)) {
        let Some(ref id_path) = cfg.identity_file else {
            return Err(GitError::new(ErrorCode::InternalError, format!("{}@{}: Permission denied (publickey).", cfg.user, cfg.host_name), BTreeMap::new()));
        };
        let Some(priv_pem) = fs.read_str(id_path) else {
            return Err(GitError::new(ErrorCode::InternalError, format!("{}@{}: Identity file {} not found.", cfg.user, cfg.host_name, id_path), BTreeMap::new()));
        };
        let Some((seed, _pub_key, _comment)) = parse_openssh_ed25519_private_key(&priv_pem) else {
            return Err(GitError::new(ErrorCode::InternalError, format!("{}@{}: Invalid SSH private key in {}.", cfg.user, cfg.host_name, id_path), BTreeMap::new()));
        };
        let pub_bytes = ed25519_public_key(&seed);
        let client_fp = ssh_key_fingerprint_sha256(&pub_bytes);
        let authorized = auth_keys_text.lines().any(|line| {
            parse_openssh_ed25519_public_key(line)
                .map(|(pk, _)| ssh_key_fingerprint_sha256(&pk) == client_fp)
                .unwrap_or(false)
        });
        if !authorized {
            return Err(GitError::new(ErrorCode::InternalError, format!("{}@{}: Permission denied (publickey).", cfg.user, cfg.host_name), BTreeMap::new()));
        }
    }

    Ok(())
}

pub fn resolve_virtual_remote_gitdir(
    fs: &MemoryFs,
    repo_root: Option<&str>,
    gitdir: Option<&str>,
    url: &str,
) -> Result<(String, SshEndpoint, SshHostConfig), GitError> {
    let endpoint = parse_ssh_url(url).ok_or_else(|| GitError::url_parse(url))?;
    let cfg = resolve_ssh_config(fs, repo_root, gitdir, &endpoint);

    let clean_path = endpoint.path.trim_start_matches('/');
    let stripped_git = clean_path.strip_prefix('/').unwrap_or(clean_path).trim_end_matches(".git");

    let mut candidates = Vec::new();
    if endpoint.is_local_path {
        if endpoint.path.starts_with('/') {
            candidates.push(endpoint.path.clone());
            candidates.push(format!("{}/.git", endpoint.path.trim_end_matches('/')));
        } else if let Some(root) = repo_root {
            let joined = join(&[root, &endpoint.path]);
            candidates.push(joined.clone());
            candidates.push(format!("{}/.git", joined.trim_end_matches('/')));
        }
    } else {
        for h in [&cfg.host_name, &endpoint.host] {
            candidates.push(format!("/remotes/{h}/{clean_path}"));
            candidates.push(format!("/remotes/{h}/{clean_path}/.git"));
            candidates.push(format!("/remotes/{h}/{stripped_git}.git"));
            candidates.push(format!("/remotes/{h}/{stripped_git}"));
            candidates.push(format!("/remotes/{h}/{stripped_git}/.git"));
            candidates.push(format!("/ssh/{h}/{clean_path}"));
            candidates.push(format!("/srv/git/{clean_path}"));
        }
        candidates.push(format!("/{clean_path}"));
        candidates.push(format!("/{clean_path}/.git"));
    }

    for cand in candidates {
        if fs.exists(&join(&[&cand, "HEAD"])) || fs.exists(&join(&[&cand, "objects"])) {
            let gdir = discover_gitdir(fs, &cand);
            verify_host_and_auth(fs, &cfg, &gdir)?;
            return Ok((gdir, endpoint, cfg));
        }
    }

    Err(GitError::new(ErrorCode::NotFoundError, format!("fatal: '{url}' does not appear to be a git repository"), BTreeMap::new()))
}

pub fn copy_reachable_objects(
    fs: &MemoryFs,
    src_gitdir: &str,
    dst_gitdir: &str,
    tip_oids: &[String],
) -> Result<usize, GitError> {
    let mut oids = Vec::new();
    let mut seen = BTreeSet::new();
    for tip in tip_oids {
        if tip != "0000000000000000000000000000000000000000" && !tip.is_empty() {
            collect_reachable_objects(fs, src_gitdir, tip, &mut seen, &mut oids);
        }
    }
    let mut count = 0usize;
    for oid in oids {
        if let Ok(obj) = read_object(fs, src_gitdir, &oid, Some("content"), None, None) {
            let _ = write_object(fs, dst_gitdir, &obj.obj_type, Some("content"), Some(&obj.object), None, None, None, false)?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn collect_gitdir_refs(fs: &MemoryFs, remote_gitdir: &str) -> Vec<ServerRef> {
    let mut out = Vec::new();
    let head_target = fs
        .read_str(&join(&[remote_gitdir, "HEAD"]))
        .and_then(|s| s.trim().strip_prefix("ref: ").map(|r| r.to_string()));
    if let Ok(head_oid) = GitRefManager::resolve(fs, remote_gitdir, "HEAD", None) {
        out.push(ServerRef {
            r#ref: "HEAD".to_string(),
            oid: head_oid,
            target: head_target,
            peeled: None,
        });
    }
    for b in GitRefManager::list_branches(fs, remote_gitdir, None) {
        {
            let full = format!("refs/heads/{b}");
            if let Ok(oid) = GitRefManager::resolve(fs, remote_gitdir, &full, None) {
                out.push(ServerRef {
                    r#ref: full,
                    oid,
                    target: None,
                    peeled: None,
                });
            }
        }
    }
    for t in GitRefManager::list_tags(fs, remote_gitdir) {
        {
            let full = format!("refs/tags/{t}");
            if let Ok(oid) = GitRefManager::resolve(fs, remote_gitdir, &full, None) {
                out.push(ServerRef {
                    r#ref: full,
                    oid,
                    target: None,
                    peeled: None,
                });
            }
        }
    }
    out
}

pub fn ssh_list_server_refs(
    fs: &MemoryFs,
    repo_root: Option<&str>,
    gitdir: Option<&str>,
    url: &str,
) -> Result<Vec<ServerRef>, GitError> {
    let (remote_gitdir, _, _) = resolve_virtual_remote_gitdir(fs, repo_root, gitdir, url)?;
    Ok(collect_gitdir_refs(fs, &remote_gitdir))
}

pub fn ssh_fetch(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: Option<&str>,
    url: &str,
    remote: Option<&str>,
    ref_name: Option<&str>,
    single_branch: bool,
    tags: bool,
) -> Result<FetchResult, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .or_else(|| dir.map(|d| join(&[d, ".git"])))
        .ok_or_else(|| GitError::missing_parameter("gitdir"))?;
    let local_gitdir = discover_gitdir(fs, &raw_gdir);
    let remote_name = remote.unwrap_or("origin");
    let (remote_gitdir, _, _) = resolve_virtual_remote_gitdir(fs, dir, Some(&local_gitdir), url)?;

    let server_refs = collect_gitdir_refs(fs, &remote_gitdir);
    let default_branch = server_refs
        .iter()
        .find(|r| r.r#ref == "HEAD")
        .and_then(|r| r.target.clone())
        .or_else(|| {
            server_refs
                .iter()
                .find(|r| r.r#ref.starts_with("refs/heads/"))
                .map(|r| r.r#ref.clone())
        });

    let target_ref = match ref_name {
        Some(r) if r.starts_with("refs/") => Some(r.to_string()),
        Some(r) => Some(format!("refs/heads/{r}")),
        None => default_branch.clone(),
    };

    let mut tips = Vec::new();
    for sr in &server_refs {
        if sr.r#ref == "HEAD" {
            continue;
        }
        if single_branch
            && let Some(ref tr) = target_ref
            && &sr.r#ref != tr
        {
            continue;
        }
        if !tags && sr.r#ref.starts_with("refs/tags/") {
            continue;
        }
        tips.push(sr.oid.clone());
    }
    copy_reachable_objects(fs, &remote_gitdir, &local_gitdir, &tips)?;

    let mut fetch_head = None;
    let mut fetch_head_description = None;
    for sr in &server_refs {
        if let Some(branch) = sr.r#ref.strip_prefix("refs/heads/") {
            if single_branch
                && let Some(ref tr) = target_ref
                && &sr.r#ref != tr
            {
                continue;
            }
            let tracking = format!("refs/remotes/{remote_name}/{branch}");
            GitRefManager::write_ref(fs, &local_gitdir, &tracking, &sr.oid)?;
            if Some(&sr.r#ref) == target_ref.as_ref() || fetch_head.is_none() {
                fetch_head = Some(sr.oid.clone());
                fetch_head_description = Some(format!("branch '{branch}' of {url}"));
                fs.write_str(
                    &join(&[&local_gitdir, "FETCH_HEAD"]),
                    &format!("{}\t\tbranch '{branch}' of {url}\n", sr.oid),
                );
            }
        } else if tags && sr.r#ref.starts_with("refs/tags/") {
            GitRefManager::write_ref(fs, &local_gitdir, &sr.r#ref, &sr.oid)?;
        }
    }

    Ok(FetchResult {
        default_branch,
        fetch_head,
        fetch_head_description,
        headers: BTreeMap::new(),
        pruned: Vec::new(),
    })
}

pub fn ssh_clone(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    url: &str,
    remote: Option<&str>,
    ref_name: Option<&str>,
    single_branch: bool,
    no_checkout: bool,
    no_tags: bool,
) -> Result<(), GitError> {
    let gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let remote_name = remote.unwrap_or("origin");
    init(fs, Some(dir), Some(&gdir), false, Some("master"))?;
    set_config(
        fs,
        &gdir,
        &format!("remote.{remote_name}.url"),
        Some(url),
        false,
    )?;
    set_config(
        fs,
        &gdir,
        &format!("remote.{remote_name}.fetch"),
        Some(&format!("+refs/heads/*:refs/remotes/{remote_name}/*")),
        false,
    )?;

    let fetch_res = ssh_fetch(
        fs,
        Some(dir),
        Some(&gdir),
        url,
        Some(remote_name),
        ref_name,
        single_branch,
        !no_tags,
    )?;

    if let Some(target_full) = ref_name
        .map(|r| {
            if r.starts_with("refs/") {
                r.to_string()
            } else {
                format!("refs/heads/{r}")
            }
        })
        .or(fetch_res.default_branch)
        && let Some(oid) = fetch_res.fetch_head
    {
        let short = target_full.strip_prefix("refs/heads/").unwrap_or(&target_full);
        GitRefManager::write_ref(fs, &gdir, &target_full, &oid)?;
        GitRefManager::write_symbolic_ref(fs, &gdir, "HEAD", &target_full)?;
        set_config(
            fs,
            &gdir,
            &format!("branch.{short}.remote"),
            Some(remote_name),
            false,
        )?;
        set_config(
            fs,
            &gdir,
            &format!("branch.{short}.merge"),
            Some(&target_full),
            false,
        )?;
        if !no_checkout {
            checkout(
                fs,
                dir,
                Some(&gdir),
                Some(short),
                None,
                Some(remote_name),
                true,
                false,
                false,
                true,
                false,
            )?;
        }
    }
    Ok(())
}

pub fn ssh_push(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: Option<&str>,
    url: &str,
    remote: Option<&str>,
    ref_name: Option<&str>,
    remote_ref: Option<&str>,
    force: bool,
    delete: bool,
) -> Result<PushResult, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .or_else(|| dir.map(|d| join(&[d, ".git"])))
        .ok_or_else(|| GitError::missing_parameter("gitdir"))?;
    let local_gitdir = discover_gitdir(fs, &raw_gdir);
    let remote_name = remote.unwrap_or("origin");
    let (remote_gitdir, _, _) = resolve_virtual_remote_gitdir(fs, dir, Some(&local_gitdir), url)?;

    let local_ref = match ref_name {
        Some(r) => r.to_string(),
        None => crate::current_branch(fs, &local_gitdir, false, false)?
            .ok_or_else(|| GitError::missing_parameter("ref"))?,
    };
    let full_local_ref = if local_ref.starts_with("refs/") {
        local_ref.clone()
    } else {
        GitRefManager::expand(fs, &local_gitdir, &local_ref)
            .unwrap_or_else(|_| format!("refs/heads/{local_ref}"))
    };
    let full_remote_ref = match remote_ref {
        Some(rr) => {
            if rr.starts_with("refs/") {
                rr.to_string()
            } else {
                format!("refs/heads/{rr}")
            }
        }
        None => full_local_ref.clone(),
    };

    let new_oid = if delete {
        "0000000000000000000000000000000000000000".to_string()
    } else {
        GitRefManager::resolve(fs, &local_gitdir, &full_local_ref, None)?
    };
    let old_oid = GitRefManager::resolve(fs, &remote_gitdir, &full_remote_ref, None)
        .unwrap_or_else(|_| "0000000000000000000000000000000000000000".to_string());

    if !delete {
        copy_reachable_objects(fs, &local_gitdir, &remote_gitdir, std::slice::from_ref(&new_oid))?;
    }

    if !delete
        && !force
        && old_oid != "0000000000000000000000000000000000000000"
        && old_oid != new_oid
        && !crate::commands::plumbing::is_descendent(fs, &remote_gitdir, &new_oid, &old_oid, None)
            .unwrap_or(false)
    {
        return Err(GitError::push_rejected("not-fast-forward"));
    }

    let remote_root = remote_gitdir
        .strip_suffix("/.git")
        .unwrap_or(&remote_gitdir)
        .to_string();
    let hook_stdin = format!("{old_oid} {new_oid} {full_remote_ref}\n");

    // Server-side pre-receive hook
    let pre_recv = run_hook(
        fs,
        &remote_root,
        &remote_gitdir,
        "pre-receive",
        &[],
        Some(&hook_stdin),
    );
    if pre_recv.ran && pre_recv.exit_code != 0 {
        return Err(GitError::new(ErrorCode::PushRejectedError, format!(
                "remote: {}{}",
                pre_recv.stdout, pre_recv.stderr
            ), BTreeMap::new()));
    }

    // Server-side update hook
    let upd = run_hook(
        fs,
        &remote_root,
        &remote_gitdir,
        "update",
        &[&full_remote_ref, &old_oid, &new_oid],
        None,
    );
    if upd.ran && upd.exit_code != 0 {
        return Err(GitError::new(ErrorCode::PushRejectedError, format!("remote: {}{}", upd.stdout, upd.stderr), BTreeMap::new()));
    }

    if delete {
        GitRefManager::delete_ref(fs, &remote_gitdir, &full_remote_ref)?;
    } else {
        GitRefManager::write_ref(fs, &remote_gitdir, &full_remote_ref, &new_oid)?;
        if !fs.exists(&join(&[&remote_gitdir, "HEAD"])) {
            GitRefManager::write_symbolic_ref(fs, &remote_gitdir, "HEAD", &full_remote_ref)?;
        }
        if let Some(short) = full_remote_ref.strip_prefix("refs/heads/") {
            let tracking = format!("refs/remotes/{remote_name}/{short}");
            let _ = GitRefManager::write_ref(fs, &local_gitdir, &tracking, &new_oid);
        }
    }

    // Server-side post-receive hook
    let _ = run_hook(
        fs,
        &remote_root,
        &remote_gitdir,
        "post-receive",
        &[],
        Some(&hook_stdin),
    );

    let mut refs = BTreeMap::new();
    refs.insert(
        full_remote_ref,
        RefUpdateStatus {
            ok: true,
            error: String::new(),
        },
    );
    Ok(PushResult {
        ok: true,
        error: None,
        refs,
    })
}
