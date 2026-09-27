use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use crate::commands::plumbing::{index_pack, pack_objects};
use crate::errors::GitError;
use crate::fixtures::make_fixture;
use crate::fs::MemoryFs;
use crate::managers::GitRefManager;
use crate::models::{GitPktLine, GitSideBand, PktLineItem};
use crate::storage::_read_object;
use crate::utils::join;
use crate::wire::{parse_upload_pack_request, ReceivePackTriplet};

#[derive(Debug, Clone)]
pub struct GitHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct GitHttpResponse {
    pub url: String,
    pub method: String,
    pub status_code: u16,
    pub status_message: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

pub trait HttpClient: Send + Sync {
    fn request(&self, req: GitHttpRequest) -> Result<GitHttpResponse, GitError>;
}

#[derive(Clone, Default)]
pub struct MockHttpServer {
    repos: Arc<Mutex<BTreeMap<String, (MemoryFs, String)>>>,
    required_auth: Arc<Mutex<BTreeMap<String, (String, String)>>>,
    custom_advertisements: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
}

impl MockHttpServer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_repo(&self, name: &str, fs: MemoryFs, gitdir: &str) {
        let clean = name.trim_start_matches('/').trim_end_matches(".git").to_string();
        self.repos
            .lock()
            .unwrap()
            .insert(clean, (fs, gitdir.to_string()));
    }

    pub fn require_basic_auth(&self, repo_name: &str, username: &str, password: &str) {
        let clean = repo_name
            .trim_start_matches('/')
            .trim_end_matches(".git")
            .to_string();
        self.required_auth
            .lock()
            .unwrap()
            .insert(clean, (username.to_string(), password.to_string()));
    }

    pub fn set_custom_advertisement(&self, repo_name: &str, body: Vec<u8>) {
        let clean = repo_name
            .trim_start_matches('/')
            .trim_end_matches(".git")
            .to_string();
        self.custom_advertisements
            .lock()
            .unwrap()
            .insert(clean, body);
    }

    pub fn get_or_load_repo(&self, repo_name: &str) -> Option<(MemoryFs, String)> {
        let clean = repo_name
            .trim_start_matches('/')
            .trim_end_matches(".git")
            .to_string();
        let mut guard = self.repos.lock().unwrap();
        if let Some(existing) = guard.get(&clean) {
            return Some(existing.clone());
        }
        if let Ok(fx) = std::panic::catch_unwind(|| make_fixture(&clean)) {
            let pair = (fx.fs, fx.gitdir);
            guard.insert(clean, pair.clone());
            return Some(pair);
        }
        None
    }
}

impl HttpClient for MockHttpServer {
    fn request(&self, req: GitHttpRequest) -> Result<GitHttpResponse, GitError> {
        let mut effective_url = req.url.clone();
        // Unwrap CORS proxy URLs like http://localhost:9999/localhost:8888/...
        if let Some(idx) = effective_url.find(":9999/") {
            let rest = &effective_url[idx + 6..];
            effective_url = if rest.starts_with("http://") || rest.starts_with("https://") {
                rest.to_string()
            } else {
                format!("http://{rest}")
            };
        }

        let is_dumb_port = effective_url.contains(":9876/");
        let path_and_query = if let Some(scheme_pos) = effective_url.find("://") {
            let after_scheme = &effective_url[scheme_pos + 3..];
            if let Some(slash) = after_scheme.find('/') {
                &after_scheme[slash..]
            } else {
                "/"
            }
        } else {
            return Err(GitError::url_parse(&effective_url));
        };

        let (path_only, query) = match path_and_query.split_once('?') {
            Some((p, q)) => (p, q),
            None => (path_and_query, ""),
        };

        let normalized_path = path_only
            .strip_prefix("/base/__tests__/__fixtures__")
            .unwrap_or(path_only);

        // Extract repo name and sub-route
        let trimmed = normalized_path.trim_start_matches('/');
        let (repo_segment, sub_route) = if let Some(git_idx) = trimmed.find(".git/") {
            (&trimmed[..git_idx], &trimmed[git_idx + 5..])
        } else if let Some(stripped) = trimmed.strip_suffix(".git") {
            (stripped, "")
        } else if let Some((first, rest)) = trimmed.split_once('/') {
            (first, rest)
        } else {
            (trimmed, "")
        };

        // Check auth if configured
        if let Some((user, pass)) = self.required_auth.lock().unwrap().get(repo_segment).cloned() {
            let expected = format!(
                "Basic {}",
                base64_encode(format!("{user}:{pass}").as_bytes())
            );
            let provided = req
                .headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("authorization"))
                .map(|(_, v)| v.as_str())
                .unwrap_or("");
            if provided != expected {
                return Ok(GitHttpResponse {
                    url: req.url,
                    method: req.method,
                    status_code: 401,
                    status_message: "Unauthorized".to_string(),
                    headers: BTreeMap::new(),
                    body: b"Unauthorized".to_vec(),
                });
            }
        }

        // Check custom advertisement
        if sub_route == "info/refs" {
            if let Some(custom) = self
                .custom_advertisements
                .lock()
                .unwrap()
                .get(repo_segment)
                .cloned()
            {
                let mut headers = BTreeMap::new();
                headers.insert(
                    "content-type".to_string(),
                    "application/x-git-upload-pack-advertisement".to_string(),
                );
                return Ok(GitHttpResponse {
                    url: req.url,
                    method: req.method,
                    status_code: 200,
                    status_message: "OK".to_string(),
                    headers,
                    body: custom,
                });
            }
        }

        let Some((fs, gitdir)) = self.get_or_load_repo(repo_segment) else {
            return Ok(GitHttpResponse {
                url: req.url,
                method: req.method,
                status_code: 404,
                status_message: "Not Found".to_string(),
                headers: BTreeMap::new(),
                body: b"Not Found".to_vec(),
            });
        };

        let git_protocol = req
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("git-protocol"))
            .map(|(_, v)| v.as_str())
            .unwrap_or("");
        let is_v2 = git_protocol.contains("version=2");

        if is_dumb_port || (sub_route == "info/refs" && query.is_empty()) {
            // Dumb HTTP server response
            let mut lines = String::new();
            for r in GitRefManager::list_refs(&fs, &gitdir, "refs") {
                let full = format!("refs/{r}");
                if let Ok(oid) = GitRefManager::resolve(&fs, &gitdir, &full, None) {
                    lines.push_str(&format!("{oid}\t{full}\n"));
                }
            }
            let mut headers = BTreeMap::new();
            headers.insert("content-type".to_string(), "text/plain".to_string());
            return Ok(GitHttpResponse {
                url: req.url,
                method: req.method,
                status_code: 200,
                status_message: "OK".to_string(),
                headers,
                body: lines.into_bytes(),
            });
        }

        if sub_route == "info/refs" && query.contains("service=git-upload-pack") {
            let mut headers = BTreeMap::new();
            headers.insert(
                "content-type".to_string(),
                "application/x-git-upload-pack-advertisement".to_string(),
            );
            if is_v2 {
                let mut out = Vec::new();
                out.extend_from_slice(&GitPktLine::encode_str("version 2\n"));
                out.extend_from_slice(&GitPktLine::encode_str("agent=git/2.39.0\n"));
                out.extend_from_slice(&GitPktLine::encode_str("ls-refs=unborn\n"));
                out.extend_from_slice(&GitPktLine::encode_str("fetch=shallow wait-for-done\n"));
                out.extend_from_slice(&GitPktLine::encode_str("server-option\n"));
                out.extend_from_slice(&GitPktLine::flush());
                return Ok(GitHttpResponse {
                    url: req.url,
                    method: req.method,
                    status_code: 200,
                    status_message: "OK".to_string(),
                    headers,
                    body: out,
                });
            }

            let body = build_v1_ref_advertisement(&fs, &gitdir, "git-upload-pack");
            return Ok(GitHttpResponse {
                url: req.url,
                method: req.method,
                status_code: 200,
                status_message: "OK".to_string(),
                headers,
                body,
            });
        }

        if sub_route == "info/refs" && query.contains("service=git-receive-pack") {
            let mut headers = BTreeMap::new();
            headers.insert(
                "content-type".to_string(),
                "application/x-git-receive-pack-advertisement".to_string(),
            );
            let body = build_v1_ref_advertisement(&fs, &gitdir, "git-receive-pack");
            return Ok(GitHttpResponse {
                url: req.url,
                method: req.method,
                status_code: 200,
                status_message: "OK".to_string(),
                headers,
                body,
            });
        }

        if sub_route == "git-upload-pack" && req.method == "POST" {
            let body_str = String::from_utf8_lossy(&req.body);
            if is_v2 && body_str.contains("command=ls-refs") {
                let body = handle_v2_ls_refs(&fs, &gitdir, &req.body);
                let mut headers = BTreeMap::new();
                headers.insert(
                    "content-type".to_string(),
                    "application/x-git-upload-pack-result".to_string(),
                );
                return Ok(GitHttpResponse {
                    url: req.url,
                    method: req.method,
                    status_code: 200,
                    status_message: "OK".to_string(),
                    headers,
                    body,
                });
            }

            let up_req = parse_upload_pack_request(&req.body);
            let mut all_oids = Vec::new();
            let mut seen = BTreeSet::new();
            for want in &up_req.wants {
                collect_reachable_objects(&fs, &gitdir, want, &mut seen, &mut all_oids);
            }
            let pack = pack_objects(&fs, &gitdir, &all_oids, false)?;
            let pack_bytes = pack.packfile.unwrap_or_default();
            let muxed = GitSideBand::mux("side-band-64k", &pack_bytes, &[], &[]);
            let mut resp_body = Vec::new();
            resp_body.extend_from_slice(&GitPktLine::encode_str("NAK\n"));
            resp_body.extend_from_slice(&muxed);
            let mut headers = BTreeMap::new();
            headers.insert(
                "content-type".to_string(),
                "application/x-git-upload-pack-result".to_string(),
            );
            return Ok(GitHttpResponse {
                url: req.url,
                method: req.method,
                status_code: 200,
                status_message: "OK".to_string(),
                headers,
                body: resp_body,
            });
        }

        if sub_route == "git-receive-pack" && req.method == "POST" {
            let (triplets, packfile) = decode_receive_pack_body(&req.body);
            if !packfile.is_empty() {
                let rel_pack = "objects/pack/pack-received.pack";
                let full_pack = join(&[&gitdir, rel_pack]);
                fs.write(&full_pack, &packfile);
                let _ = index_pack(&fs, &gitdir, &gitdir, rel_pack);
            }
            let mut result_pkt = Vec::new();
            result_pkt.extend_from_slice(&GitPktLine::encode_str("unpack ok\n"));
            for t in &triplets {
                if t.oid == "0000000000000000000000000000000000000000" {
                    let _ = GitRefManager::delete_ref(&fs, &gitdir, &t.full_ref);
                } else {
                    let _ = GitRefManager::write_ref(&fs, &gitdir, &t.full_ref, &t.oid);
                }
                result_pkt.extend_from_slice(&GitPktLine::encode_str(&format!("ok {}\n", t.full_ref)));
            }
            result_pkt.extend_from_slice(&GitPktLine::flush());
            let progress = [
                b"build started...\n".to_vec(),
                b"build completed...\n".to_vec(),
                b"tests started...\n".to_vec(),
                b"tests completed...\n".to_vec(),
                b"starting server...\n".to_vec(),
            ];
            let muxed = GitSideBand::mux("side-band-64k", &result_pkt, &progress, &[]);
            let mut headers = BTreeMap::new();
            headers.insert(
                "content-type".to_string(),
                "application/x-git-receive-pack-result".to_string(),
            );
            return Ok(GitHttpResponse {
                url: req.url,
                method: req.method,
                status_code: 200,
                status_message: "OK".to_string(),
                headers,
                body: muxed,
            });
        }

        Ok(GitHttpResponse {
            url: req.url,
            method: req.method,
            status_code: 404,
            status_message: "Not Found".to_string(),
            headers: BTreeMap::new(),
            body: b"Not Found".to_vec(),
        })
    }
}

fn build_v1_ref_advertisement(fs: &MemoryFs, gitdir: &str, service: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&GitPktLine::encode_str(&format!("# service={service}\n")));
    out.extend_from_slice(&GitPktLine::flush());

    let mut entries: Vec<(String, String)> = Vec::new();
    let mut head_target: Option<String> = None;
    if let Ok(head_oid) = GitRefManager::resolve(fs, gitdir, "HEAD", None) {
        if let Ok(target) = GitRefManager::resolve(fs, gitdir, "HEAD", Some(2)) {
            if target.starts_with("refs/") {
                head_target = Some(target);
            }
        }
        entries.push(("HEAD".to_string(), head_oid));
    }
    for r in GitRefManager::list_refs(fs, gitdir, "refs") {
        let full = format!("refs/{r}");
        if let Ok(oid) = GitRefManager::resolve(fs, gitdir, &full, None) {
            entries.push((full.clone(), oid.clone()));
            if full.starts_with("refs/tags/") {
                if let Ok(res) = _read_object(fs, gitdir, &oid, "content") {
                    if res.obj_type == "tag" {
                        let tag = crate::models::GitAnnotatedTag::from_bytes(&res.object).parse();
                        entries.push((format!("{full}^{{}}"), tag.object));
                    }
                }
            }
        }
    }

    let symref_cap = head_target
        .map(|t| format!(" symref=HEAD:{t}"))
        .unwrap_or_default();
    let caps = format!(
        "multi_ack thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not deepen-relative no-progress include-tag multi_ack_detailed allow-tip-sha1-in-want allow-reachable-sha1-in-want{symref_cap} report-status delete-refs agent=git/2.39.0"
    );

    for (idx, (r, oid)) in entries.iter().enumerate() {
        if idx == 0 {
            out.extend_from_slice(&GitPktLine::encode_str(&format!("{oid} {r}\0{caps}\n")));
        } else {
            out.extend_from_slice(&GitPktLine::encode_str(&format!("{oid} {r}\n")));
        }
    }
    out.extend_from_slice(&GitPktLine::flush());
    out
}

fn handle_v2_ls_refs(fs: &MemoryFs, gitdir: &str, req_body: &[u8]) -> Vec<u8> {
    let mut want_symrefs = false;
    let mut want_peel = false;
    let mut prefixes: Vec<String> = Vec::new();
    let mut reader = GitPktLine::stream_reader(req_body);
    loop {
        match reader.read() {
            PktLineItem::Eof => break,
            PktLineItem::Flush | PktLineItem::Delim => continue,
            PktLineItem::Line(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if line == "symrefs" {
                    want_symrefs = true;
                } else if line == "peel" {
                    want_peel = true;
                } else if let Some(p) = line.strip_prefix("ref-prefix ") {
                    prefixes.push(p.trim().to_string());
                }
            }
        }
    }

    let mut all_refs: Vec<(String, String, Option<String>, Option<String>)> = Vec::new();
    if let Ok(head_oid) = GitRefManager::resolve(fs, gitdir, "HEAD", None) {
        let target = GitRefManager::resolve(fs, gitdir, "HEAD", Some(2))
            .ok()
            .filter(|t| t.starts_with("refs/"));
        all_refs.push(("HEAD".to_string(), head_oid, target, None));
    }
    for r in GitRefManager::list_refs(fs, gitdir, "refs") {
        let full = format!("refs/{r}");
        if let Ok(oid) = GitRefManager::resolve(fs, gitdir, &full, None) {
            let sym_target = GitRefManager::resolve(fs, gitdir, &full, Some(2))
                .ok()
                .filter(|t| t.starts_with("refs/"));
            let mut peeled = None;
            if full.starts_with("refs/tags/") {
                if let Ok(res) = _read_object(fs, gitdir, &oid, "content") {
                    if res.obj_type == "tag" {
                        let tag = crate::models::GitAnnotatedTag::from_bytes(&res.object).parse();
                        peeled = Some(tag.object);
                    }
                }
            }
            all_refs.push((full, oid, sym_target, peeled));
        }
    }

    let mut out = Vec::new();
    for (ref_name, oid, sym_target, peeled) in all_refs {
        if !prefixes.is_empty() && !prefixes.iter().any(|p| ref_name.starts_with(p)) {
            continue;
        }
        let mut line = format!("{oid} {ref_name}");
        if want_symrefs {
            if let Some(t) = sym_target {
                line.push_str(&format!(" symref-target:{t}"));
            }
        }
        if want_peel {
            if let Some(p) = peeled {
                line.push_str(&format!(" peeled:{p}"));
            }
        }
        line.push('\n');
        out.extend_from_slice(&GitPktLine::encode_str(&line));
    }
    out.extend_from_slice(&GitPktLine::flush());
    out
}

fn decode_receive_pack_body(body: &[u8]) -> (Vec<ReceivePackTriplet>, Vec<u8>) {
    let mut triplets = Vec::new();
    let mut pos = 0usize;
    while pos + 4 <= body.len() {
        let Ok(len_str) = std::str::from_utf8(&body[pos..pos + 4]) else {
            break;
        };
        let Ok(len) = usize::from_str_radix(len_str, 16) else {
            break;
        };
        if len == 0 {
            pos += 4;
            break;
        }
        if len < 4 || pos + len > body.len() {
            break;
        }
        let line = String::from_utf8_lossy(&body[pos + 4..pos + len]);
        let before_nul = line.split('\0').next().unwrap_or("").trim();
        let parts: Vec<&str> = before_nul.split(' ').collect();
        if parts.len() >= 3 {
            triplets.push(ReceivePackTriplet {
                oldoid: parts[0].to_string(),
                oid: parts[1].to_string(),
                full_ref: parts[2].to_string(),
            });
        }
        pos += len;
    }
    let packfile = if pos < body.len() {
        body[pos..].to_vec()
    } else {
        Vec::new()
    };
    let _ = PktLineItem::Eof;
    (triplets, packfile)
}

pub fn collect_reachable_objects(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    seen: &mut BTreeSet<String>,
    out: &mut Vec<String>,
) {
    if !seen.insert(oid.to_string()) {
        return;
    }
    let Ok(res) = _read_object(fs, gitdir, oid, "content") else {
        return;
    };
    out.push(oid.to_string());
    match res.obj_type.as_str() {
        "commit" => {
            let commit = crate::models::GitCommit::from_bytes(&res.object).parse();
            collect_reachable_objects(fs, gitdir, &commit.tree, seen, out);
            for p in commit.parent {
                collect_reachable_objects(fs, gitdir, &p, seen, out);
            }
        }
        "tree" => {
            if let Ok(tree) = crate::models::GitTree::from_bytes(&res.object) {
                for entry in tree.entries() {
                    collect_reachable_objects(fs, gitdir, &entry.oid, seen, out);
                }
            }
        }
        "tag" => {
            let tag = crate::models::GitAnnotatedTag::from_bytes(&res.object).parse();
            collect_reachable_objects(fs, gitdir, &tag.object, seen, out);
        }
        _ => {}
    }
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
