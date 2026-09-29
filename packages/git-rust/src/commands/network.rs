use std::collections::{BTreeMap, BTreeSet};

use crate::commands::plumbing::{add_remote, index_pack, init, pack_objects, set_config};
use crate::commands::worktree::{checkout, fast_forward, merge};
use crate::errors::GitError;
use crate::fs::{discover_gitdir, MemoryFs};
use crate::http::{collect_reachable_objects, GitHttpRequest, HttpClient};
use crate::managers::{GitConfigManager, GitRefManager, GitRemoteManager};
use crate::models::GitSideBand;
use crate::utils::{extract_auth_from_url, format_info_refs, join, Author, ServerRef};
use crate::wire::{
    parse_list_refs_response, parse_receive_pack_response, parse_refs_ad_response,
    parse_upload_pack_response, write_list_refs_request, write_receive_pack_request,
    write_upload_pack_request, PushResult, ReceivePackTriplet, RefsAdResponse, UploadPackRequest,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NestedMap {
    Leaf(String),
    Map(BTreeMap<String, NestedMap>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(non_snake_case)]
pub struct RemoteInfo1 {
    pub capabilities: BTreeSet<String>,
    pub HEAD: Option<String>,
    pub refs: BTreeMap<String, NestedMap>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteInfo2 {
    pub protocol_version: u8,
    pub capabilities: BTreeMap<String, Option<String>>,
    pub refs: Option<Vec<ServerRef>>,
}

fn apply_cors_proxy(url: &str, cors_proxy: Option<&str>) -> String {
    if let Some(proxy) = cors_proxy {
        let stripped = url
            .strip_prefix("http://")
            .or_else(|| url.strip_prefix("https://"))
            .unwrap_or(url);
        format!("{}/{}", proxy.trim_end_matches('/'), stripped)
    } else {
        url.to_string()
    }
}

fn build_auth_headers(
    url: &str,
    extra_headers: Option<&BTreeMap<String, String>>,
) -> (String, BTreeMap<String, String>) {
    let parsed = extract_auth_from_url(url);
    let mut headers = extra_headers.cloned().unwrap_or_default();
    if let Some(auth) = parsed.auth.username.as_ref() {
        let pass = parsed.auth.password.as_deref().unwrap_or("");
        let raw = format!("{auth}:{pass}");
        headers.insert(
            "Authorization".to_string(),
            format!("Basic {}", base64_encode(raw.as_bytes())),
        );
    }
    (parsed.url, headers)
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub fn get_remote_info(
    http: &dyn HttpClient,
    url: &str,
    cors_proxy: Option<&str>,
    for_push: bool,
    headers: Option<&BTreeMap<String, String>>,
) -> Result<RemoteInfo1, GitError> {
    let _ = GitRemoteManager::get_remote_helper_for(url)?;
    let service = if for_push {
        "git-receive-pack"
    } else {
        "git-upload-pack"
    };
    let (clean_url, req_headers) = build_auth_headers(url, headers);
    let full_url = apply_cors_proxy(
        &format!("{}/info/refs?service={service}", clean_url.trim_end_matches('/')),
        cors_proxy,
    );
    let res = http.request(GitHttpRequest {
        url: full_url,
        method: "GET".to_string(),
        headers: req_headers,
        body: Vec::new(),
    })?;
    if res.status_code != 200 {
        return Err(GitError::http(
            res.status_code,
            &res.status_message,
            &String::from_utf8_lossy(&res.body),
        ));
    }
    let expected_ct = format!("application/x-{service}-advertisement");
    let actual_ct = res
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.as_str())
        .unwrap_or("");
    if actual_ct != expected_ct {
        let preview = String::from_utf8_lossy(&res.body);
        return Err(GitError::smart_http(&preview, &preview));
    }

    let ad = parse_refs_ad_response(&res.body, service)?;
    let (capabilities, refs, symrefs) = match ad {
        RefsAdResponse::V1 {
            capabilities,
            refs,
            symrefs,
            ..
        } => (capabilities, refs, symrefs),
        RefsAdResponse::V2 { capabilities2, .. } => {
            let caps = capabilities2.keys().cloned().collect();
            (caps, BTreeMap::new(), BTreeMap::new())
        }
    };
    for r in refs.keys() {
        if r.contains("..") || r.starts_with('/') {
            return Err(GitError::unsafe_filepath(r));
        }
    }
    let mut nested: BTreeMap<String, NestedMap> = BTreeMap::new();
    for (r, oid) in &refs {
        if r == "HEAD" {
            continue;
        }
        let rel = r.strip_prefix("refs/").unwrap_or(r);
        let parts: Vec<&str> = rel.split('/').collect();
        if parts.len() == 2 {
            let sub = nested
                .entry(parts[0].to_string())
                .or_insert_with(|| NestedMap::Map(BTreeMap::new()));
            if let NestedMap::Map(m) = sub {
                m.insert(parts[1].to_string(), NestedMap::Leaf(oid.clone()));
            }
        } else {
            nested.insert(rel.to_string(), NestedMap::Leaf(oid.clone()));
        }
    }
    let head_sym = symrefs.get("HEAD").cloned().or_else(|| refs.get("HEAD").cloned());
    Ok(RemoteInfo1 {
        capabilities,
        HEAD: head_sym,
        refs: nested,
    })
}

pub fn get_remote_info2(
    http: &dyn HttpClient,
    url: &str,
    cors_proxy: Option<&str>,
    for_push: bool,
    protocol_version: u8,
    headers: Option<&BTreeMap<String, String>>,
) -> Result<RemoteInfo2, GitError> {
    let _ = GitRemoteManager::get_remote_helper_for(url)?;
    let service = if for_push {
        "git-receive-pack"
    } else {
        "git-upload-pack"
    };
    let (clean_url, mut req_headers) = build_auth_headers(url, headers);
    if protocol_version == 2 {
        req_headers.insert("Git-Protocol".to_string(), "version=2".to_string());
    }
    let full_url = apply_cors_proxy(
        &format!("{}/info/refs?service={service}", clean_url.trim_end_matches('/')),
        cors_proxy,
    );
    let res = http.request(GitHttpRequest {
        url: full_url,
        method: "GET".to_string(),
        headers: req_headers,
        body: Vec::new(),
    })?;
    if res.status_code != 200 {
        return Err(GitError::http(
            res.status_code,
            &res.status_message,
            &String::from_utf8_lossy(&res.body),
        ));
    }
    let expected_ct = format!("application/x-{service}-advertisement");
    let actual_ct = res
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.as_str())
        .unwrap_or("");
    if actual_ct != expected_ct {
        let preview = String::from_utf8_lossy(&res.body);
        return Err(GitError::smart_http(&preview, &preview));
    }

    let ad = parse_refs_ad_response(&res.body, service)?;
    match ad {
        RefsAdResponse::V2 { capabilities2, .. } => Ok(RemoteInfo2 {
            protocol_version: 2,
            capabilities: capabilities2,
            refs: None,
        }),
        RefsAdResponse::V1 {
            capabilities,
            refs,
            symrefs,
            ..
        } => {
            for r in refs.keys() {
                if r.contains("..") || r.starts_with('/') {
                    return Err(GitError::unsafe_filepath(r));
                }
            }
            let mut cap_map = BTreeMap::new();
            for c in &capabilities {
                if let Some((k, v)) = c.split_once('=') {
                    cap_map.insert(k.to_string(), Some(v.to_string()));
                } else {
                    cap_map.insert(c.to_string(), None);
                }
            }
            let pairs: Vec<(String, String)> =
                refs.into_iter().collect();
            let refs_list = format_info_refs(&pairs, &symrefs, "", true, true);
            Ok(RemoteInfo2 {
                protocol_version: 1,
                capabilities: cap_map,
                refs: Some(refs_list),
            })
        }
    }
}

pub fn list_server_refs(
    http: &dyn HttpClient,
    url: &str,
    cors_proxy: Option<&str>,
    for_push: bool,
    protocol_version: u8,
    prefix: Option<&str>,
    symrefs: bool,
    peel_tags: bool,
    headers: Option<&BTreeMap<String, String>>,
) -> Result<Vec<ServerRef>, GitError> {
    let _ = GitRemoteManager::get_remote_helper_for(url)?;
    if protocol_version == 2 && !for_push {
        let (clean_url, mut req_headers) = build_auth_headers(url, headers);
        req_headers.insert("Git-Protocol".to_string(), "version=2".to_string());
        let body = write_list_refs_request(prefix, symrefs, peel_tags);
        let post_url = apply_cors_proxy(
            &format!("{}/git-upload-pack", clean_url.trim_end_matches('/')),
            cors_proxy,
        );
        let res = http.request(GitHttpRequest {
            url: post_url,
            method: "POST".to_string(),
            headers: req_headers,
            body,
        })?;
        if res.status_code != 200 {
            return Err(GitError::http(
                res.status_code,
                &res.status_message,
                &String::from_utf8_lossy(&res.body),
            ));
        }
        return Ok(parse_list_refs_response(&res.body));
    }

    let info = get_remote_info2(http, url, cors_proxy, for_push, 1, headers)?;
    let mut out = Vec::new();
    for mut r in info.refs.unwrap_or_default() {
        if let Some(p) = prefix
            && !r.r#ref.starts_with(p) {
                continue;
            }
        if !symrefs {
            r.target = None;
        }
        if !peel_tags {
            r.peeled = None;
        }
        out.push(r);
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchResult {
    pub default_branch: Option<String>,
    pub fetch_head: Option<String>,
    pub fetch_head_description: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub pruned: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn fetch(
    fs: &MemoryFs,
    http: &dyn HttpClient,
    dir: Option<&str>,
    gitdir: Option<&str>,
    url: Option<&str>,
    remote: Option<&str>,
    ref_name: Option<&str>,
    single_branch: bool,
    tags: bool,
    depth: Option<usize>,
    prune: bool,
    cors_proxy: Option<&str>,
    headers: Option<&BTreeMap<String, String>>,
) -> Result<FetchResult, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .or_else(|| dir.map(|d| join(&[d, ".git"])))
        .ok_or_else(|| GitError::missing_parameter("gitdir"))?;
    let gdir = discover_gitdir(fs, &raw_gdir);
    let remote_name = remote.unwrap_or("origin");
    let cfg = GitConfigManager::get(fs, &gdir);
    let resolved_url = match url {
        Some(u) => u.to_string(),
        None => cfg
            .get(&format!("remote.{remote_name}.url"))
            .map(|v| v.as_str().to_string())
            .ok_or_else(|| GitError::missing_parameter("url"))?,
    };

    if crate::ssh::is_ssh_or_local_url(&resolved_url) {
        match crate::ssh::ssh_fetch(
            fs,
            dir,
            Some(&gdir),
            &resolved_url,
            Some(remote_name),
            ref_name,
            single_branch,
            tags,
        ) {
            Ok(res) => return Ok(res),
            Err(e) => {
                if e.code == crate::errors::ErrorCode::NotFoundError && let Some(https_url) = crate::ssh::translate_ssh_to_https(&resolved_url) {
                    return fetch(
                        fs,
                        http,
                        dir,
                        Some(&gdir),
                        Some(&https_url),
                        Some(remote_name),
                        ref_name,
                        single_branch,
                        tags,
                        depth,
                        prune,
                        cors_proxy,
                        headers,
                    );
                }
                return Err(e);
            }
        }
    }

    let server_refs = list_server_refs(
        http,
        &resolved_url,
        cors_proxy,
        false,
        1,
        None,
        true,
        true,
        headers,
    )?;

    let default_branch = server_refs
        .iter()
        .find(|r| r.r#ref == "HEAD")
        .and_then(|r| r.target.clone())
        .or_else(|| {
            server_refs
                .iter()
                .find(|r| r.r#ref == "refs/heads/master" || r.r#ref == "refs/heads/main")
                .map(|r| r.r#ref.clone())
        });

    let target_ref_full = match ref_name {
        Some(r) => {
            if r.starts_with("refs/") {
                Some(r.to_string())
            } else {
                Some(format!("refs/heads/{r}"))
            }
        }
        None => default_branch.clone(),
    };

    let mut wants = Vec::new();
    let mut selected_refs: Vec<ServerRef> = Vec::new();
    for sr in &server_refs {
        if sr.r#ref == "HEAD" {
            continue;
        }
        if single_branch {
            if Some(&sr.r#ref) == target_ref_full.as_ref() {
                wants.push(sr.oid.clone());
                selected_refs.push(sr.clone());
            }
        } else if sr.r#ref.starts_with("refs/heads/")
            || (tags && sr.r#ref.starts_with("refs/tags/"))
        {
            wants.push(sr.oid.clone());
            selected_refs.push(sr.clone());
        }
    }

    if wants.is_empty()
        && let Some(head_sr) = server_refs.iter().find(|r| r.r#ref == "HEAD") {
            wants.push(head_sr.oid.clone());
            selected_refs.push(head_sr.clone());
        }

    let mut fetch_head = None;
    let mut fetch_head_desc = None;
    if let Some(tf) = &target_ref_full
        && let Some(sr) = server_refs.iter().find(|r| &r.r#ref == tf) {
            fetch_head = Some(sr.oid.clone());
            let short = tf.trim_start_matches("refs/heads/");
            fetch_head_desc = Some(format!("branch '{short}' of {resolved_url}"));
        }

    if !wants.is_empty() {
        let req_body = write_upload_pack_request(&UploadPackRequest {
            capabilities: vec!["side-band-64k".to_string(), "ofs-delta".to_string()],
            wants,
            depth,
            done: true,
            ..Default::default()
        });
        let (clean_url, req_headers) = build_auth_headers(&resolved_url, headers);
        let post_url = apply_cors_proxy(
            &format!("{}/git-upload-pack", clean_url.trim_end_matches('/')),
            cors_proxy,
        );
        let res = http.request(GitHttpRequest {
            url: post_url,
            method: "POST".to_string(),
            headers: req_headers,
            body: req_body,
        })?;
        if res.status_code != 200 {
            return Err(GitError::http(
                res.status_code,
                &res.status_message,
                &String::from_utf8_lossy(&res.body),
            ));
        }
        let parsed = parse_upload_pack_response(&res.body)?;
        if !parsed.packfile.is_empty() {
            let rel_pack = "objects/pack/pack-fetched.pack";
            let full_pack = join(&[&gdir, rel_pack]);
            fs.write(&full_pack, &parsed.packfile);
            let _ = index_pack(fs, &gdir, &gdir, rel_pack);
        }
    }

    for sr in &selected_refs {
        if let Some(branch) = sr.r#ref.strip_prefix("refs/heads/") {
            let remote_tracking = format!("refs/remotes/{remote_name}/{branch}");
            let _ = GitRefManager::write_ref(fs, &gdir, &remote_tracking, &sr.oid);
        } else if sr.r#ref.starts_with("refs/tags/") {
            let _ = GitRefManager::write_ref(fs, &gdir, &sr.r#ref, &sr.oid);
        }
    }

    let mut pruned = Vec::new();
    if prune {
        let remote_prefix = format!("refs/remotes/{remote_name}");
        let local_remote_refs = GitRefManager::list_refs(fs, &gdir, &remote_prefix);
        for lr in local_remote_refs {
            let expected_server = format!("refs/heads/{lr}");
            if !server_refs.iter().any(|s| s.r#ref == expected_server) {
                let full_local = format!("{remote_prefix}/{lr}");
                let _ = GitRefManager::delete_ref(fs, &gdir, &full_local);
                pruned.push(full_local);
            }
        }
    }

    if let Some(fh) = &fetch_head {
        fs.write_str(&join(&[&gdir, "FETCH_HEAD"]), &format!("{fh}\n"));
    }

    Ok(FetchResult {
        default_branch,
        fetch_head,
        fetch_head_description: fetch_head_desc,
        headers: BTreeMap::new(),
        pruned,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn clone(
    fs: &MemoryFs,
    http: &dyn HttpClient,
    dir: &str,
    gitdir: Option<&str>,
    url: &str,
    cors_proxy: Option<&str>,
    ref_name: Option<&str>,
    single_branch: bool,
    no_checkout: bool,
    no_tags: bool,
    remote: Option<&str>,
    depth: Option<usize>,
    headers: Option<&BTreeMap<String, String>>,
) -> Result<(), GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    init(fs, Some(dir), Some(&raw_gdir), false, Some("master"))?;
    let remote_name = remote.unwrap_or("origin");
    add_remote(fs, &raw_gdir, remote_name, url, true)?;
    if let Some(cp) = cors_proxy {
        set_config(fs, &raw_gdir, "http.corsProxy", Some(cp), false)?;
    }

    let fetch_res = fetch(
        fs,
        http,
        Some(dir),
        Some(&raw_gdir),
        Some(url),
        Some(remote_name),
        ref_name,
        single_branch,
        !no_tags,
        depth,
        false,
        cors_proxy,
        headers,
    )?;

    let checkout_ref = ref_name
        .map(|s| s.to_string())
        .or_else(|| {
            fetch_res
                .default_branch
                .as_ref()
                .map(|b| b.trim_start_matches("refs/heads/").to_string())
        })
        .unwrap_or_else(|| "master".to_string());

    if let Some(fh) = &fetch_res.fetch_head {
        let full_branch = if checkout_ref.starts_with("refs/") {
            checkout_ref.clone()
        } else {
            format!("refs/heads/{checkout_ref}")
        };
        GitRefManager::write_ref(fs, &raw_gdir, &full_branch, fh)?;
        GitRefManager::write_symbolic_ref(fs, &raw_gdir, "HEAD", &full_branch)?;
        let short = full_branch.trim_start_matches("refs/heads/");
        set_config(
            fs,
            &raw_gdir,
            &format!("branch.{short}.remote"),
            Some(remote_name),
            false,
        )?;
        set_config(
            fs,
            &raw_gdir,
            &format!("branch.{short}.merge"),
            Some(&full_branch),
            false,
        )?;
    }

    if !no_checkout && fetch_res.fetch_head.is_some() {
        checkout(
            fs,
            dir,
            Some(&raw_gdir),
            Some(&checkout_ref),
            None,
            Some(remote_name),
            false,
            false,
            false,
            true,
            true,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn pull(
    fs: &MemoryFs,
    http: &dyn HttpClient,
    dir: &str,
    gitdir: Option<&str>,
    ref_name: Option<&str>,
    url: Option<&str>,
    remote: Option<&str>,
    single_branch: bool,
    fast_forward_flag: bool,
    fast_forward_only: bool,
    cors_proxy: Option<&str>,
    author: Option<Author>,
    committer: Option<Author>,
    headers: Option<&BTreeMap<String, String>>,
) -> Result<(), GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let target_branch = match ref_name {
        Some(r) => r.to_string(),
        None => crate::current_branch(fs, &gdir, false, false)?
            .ok_or_else(|| GitError::missing_parameter("ref"))?,
    };

    let fetch_res = fetch(
        fs,
        http,
        Some(dir),
        Some(&gdir),
        url,
        remote,
        Some(&target_branch),
        single_branch,
        false,
        None,
        false,
        cors_proxy,
        headers,
    )?;

    if let Some(their_oid) = fetch_res.fetch_head {
        if fast_forward_only {
            fast_forward(fs, dir, Some(&gdir), Some(&target_branch), &their_oid, false)?;
        } else {
            merge(
                fs,
                Some(dir),
                &gdir,
                Some(&target_branch),
                &their_oid,
                fast_forward_flag,
                fast_forward_only,
                false,
                false,
                false,
                None,
                author,
                committer,
            )?;
            checkout(
                fs,
                dir,
                Some(&gdir),
                Some(&target_branch),
                None,
                None,
                false,
                false,
                false,
                true,
                false,
            )?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn push(
    fs: &MemoryFs,
    http: &dyn HttpClient,
    dir: Option<&str>,
    gitdir: Option<&str>,
    ref_name: Option<&str>,
    remote_ref: Option<&str>,
    remote: Option<&str>,
    url: Option<&str>,
    force: bool,
    delete: bool,
    cors_proxy: Option<&str>,
    headers: Option<&BTreeMap<String, String>>,
    mut on_message: Option<&mut dyn FnMut(String)>,
) -> Result<PushResult, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .or_else(|| dir.map(|d| join(&[d, ".git"])))
        .ok_or_else(|| GitError::missing_parameter("gitdir"))?;
    let gdir = discover_gitdir(fs, &raw_gdir);
    let remote_name = remote.unwrap_or("origin");
    let cfg = GitConfigManager::get(fs, &gdir);
    let resolved_url = match url {
        Some(u) => u.to_string(),
        None => cfg
            .get(&format!("remote.{remote_name}.url"))
            .map(|v| v.as_str().to_string())
            .ok_or_else(|| GitError::missing_parameter("url"))?,
    };

    if crate::ssh::is_ssh_or_local_url(&resolved_url) {
        match crate::ssh::ssh_push(
            fs,
            dir,
            Some(&gdir),
            &resolved_url,
            Some(remote_name),
            ref_name,
            remote_ref,
            force,
            delete,
        ) {
            Ok(res) => return Ok(res),
            Err(e) => {
                if e.code == crate::errors::ErrorCode::NotFoundError && let Some(https_url) = crate::ssh::translate_ssh_to_https(&resolved_url) {
                    return push(
                        fs,
                        http,
                        dir,
                        Some(&gdir),
                        ref_name,
                        remote_ref,
                        Some(remote_name),
                        Some(&https_url),
                        force,
                        delete,
                        cors_proxy,
                        headers,
                        on_message,
                    );
                }
                return Err(e);
            }
        }
    }

    let local_ref = match ref_name {
        Some(r) => r.to_string(),
        None => crate::current_branch(fs, &gdir, false, false)?
            .ok_or_else(|| GitError::missing_parameter("ref"))?,
    };
    let full_local_ref = if local_ref.starts_with("refs/") {
        local_ref.clone()
    } else {
        GitRefManager::expand(fs, &gdir, &local_ref).unwrap_or_else(|_| format!("refs/heads/{local_ref}"))
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
        GitRefManager::resolve(fs, &gdir, &full_local_ref, None)?
    };

    let server_refs = list_server_refs(
        http,
        &resolved_url,
        cors_proxy,
        true,
        1,
        None,
        false,
        false,
        headers,
    )?;
    let old_oid = server_refs
        .iter()
        .find(|r| r.r#ref == full_remote_ref)
        .map(|r| r.oid.clone())
        .unwrap_or_else(|| "0000000000000000000000000000000000000000".to_string());

    if !delete && !force && old_oid != "0000000000000000000000000000000000000000" && old_oid != new_oid
        && !crate::commands::plumbing::is_descendent(fs, &gdir, &new_oid, &old_oid, None).unwrap_or(false) {
            return Err(GitError::push_rejected("not-fast-forward"));
        }

    let packfile = if delete {
        Vec::new()
    } else {
        let mut oids = Vec::new();
        let mut seen = BTreeSet::new();
        collect_reachable_objects(fs, &gdir, &new_oid, &mut seen, &mut oids);
        pack_objects(fs, &gdir, &oids, false)?
            .packfile
            .unwrap_or_default()
    };

    let triplet = ReceivePackTriplet {
        oldoid: old_oid,
        oid: new_oid,
        full_ref: full_remote_ref,
    };
    let mut body = write_receive_pack_request(&["report-status", "side-band-64k"], &[triplet]);
    body.extend_from_slice(&packfile);
    let (clean_url, req_headers) = build_auth_headers(&resolved_url, headers);
    let post_url = apply_cors_proxy(
        &format!("{}/git-receive-pack", clean_url.trim_end_matches('/')),
        cors_proxy,
    );
    let res = http.request(GitHttpRequest {
        url: post_url,
        method: "POST".to_string(),
        headers: req_headers,
        body,
    })?;
    if res.status_code != 200 {
        return Err(GitError::http(
            res.status_code,
            &res.status_message,
            &String::from_utf8_lossy(&res.body),
        ));
    }

    let demux = GitSideBand::demux(&res.body);
    if let Some(cb) = on_message.as_mut() {
        for msg in &demux.progress {
            let text = String::from_utf8_lossy(msg).to_string();
            for line in crate::utils::split_lines(&text) {
                cb(line);
            }
        }
    }
    let data: Vec<u8> = if !demux.packfile.is_empty() {
        demux.packfile
    } else {
        res.body
    };
    parse_receive_pack_response(&data)
}
