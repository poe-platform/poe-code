use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use crate::errors::GitError;
use crate::fs::{discover_gitdir, MemoryFs};
use crate::models::{GitConfig, GitIndex, GitPackedRefs, GitRefSpecSet, GitRefStash};
use crate::utils::{join, Author};

const GIT_FILES: &[&str] = &["config", "description", "index", "shallow", "commondir"];

pub fn refpaths(r: &str) -> Vec<String> {
    vec![
        r.to_string(),
        format!("refs/{r}"),
        format!("refs/tags/{r}"),
        format!("refs/heads/{r}"),
        format!("refs/remotes/{r}"),
        format!("refs/remotes/{r}/HEAD"),
    ]
}

pub fn is_valid_ref(name: &str, onelevel: bool) -> bool {
    if name.is_empty() || name == "@" {
        return false;
    }
    if !onelevel && !name.contains('/') {
        return false;
    }
    if name.starts_with('/')
        || name.starts_with('.')
        || name.ends_with('/')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains(".lock/")
        || name.contains("//")
        || name.contains("..")
        || name.contains("/.")
        || name.contains("./")
        || name.contains("@{")
    {
        return false;
    }
    for b in name.bytes() {
        if b <= 0x20
            || b == 0x7f
            || matches!(b, b'~' | b'^' | b':' | b'?' | b'*' | b'[' | b'\\')
        {
            return false;
        }
    }
    true
}

pub fn clean_git_ref(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if (ch as u32) <= 0x20
            || (ch as u32) == 0x7f
            || matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        {
            continue;
        }
        out.push(ch);
    }
    while out.contains("..") {
        out = out.replace("..", ".");
    }
    while out.contains("//") {
        out = out.replace("//", "/");
    }
    out.trim_matches(|c| c == '/' || c == '.').to_string()
}

pub fn assert_writable_ref(r: &str) -> Result<(), GitError> {
    if GIT_FILES.contains(&r) {
        return Err(GitError::invalid_ref_name(r, &format!("refs/heads/{r}")));
    }
    if !is_valid_ref(r, true) {
        return Err(GitError::invalid_ref_name(r, &clean_git_ref(r)));
    }
    Ok(())
}

pub fn compare_ref_names(a: &str, b: &str) -> Ordering {
    let a_clean = a.strip_suffix("^{}").unwrap_or(a);
    let b_clean = b.strip_suffix("^{}").unwrap_or(b);
    match a_clean.cmp(b_clean) {
        Ordering::Equal => {
            let a_peeled = a.ends_with("^{}");
            let b_peeled = b.ends_with("^{}");
            match (a_peeled, b_peeled) {
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                _ => Ordering::Equal,
            }
        }
        other => other,
    }
}

pub struct GitRefManager;

impl GitRefManager {
    pub fn packed_refs(fs: &MemoryFs, raw_gitdir: &str) -> BTreeMap<String, String> {
        let gitdir = discover_gitdir(fs, raw_gitdir);
        let path = join(&[&gitdir, "packed-refs"]);
        if let Some(text) = fs.read_str(&path) {
            GitPackedRefs::from(&text).refs
        } else {
            BTreeMap::new()
        }
    }

    pub fn write_ref(
        fs: &MemoryFs,
        gitdir: &str,
        ref_name: &str,
        value: &str,
    ) -> Result<(), GitError> {
        assert_writable_ref(ref_name)?;
        let trimmed = value.trim();
        if trimmed.len() != 40 || !trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(GitError::invalid_oid(value));
        }
        let gitdir = discover_gitdir(fs, gitdir);
        let path = join(&[&gitdir, ref_name]);
        fs.write_str(&path, &format!("{trimmed}\n"));
        Ok(())
    }

    pub fn write_symbolic_ref(
        fs: &MemoryFs,
        gitdir: &str,
        ref_name: &str,
        value: &str,
    ) -> Result<(), GitError> {
        assert_writable_ref(ref_name)?;
        let trimmed = value.trim();
        let gitdir = discover_gitdir(fs, gitdir);
        let path = join(&[&gitdir, ref_name]);
        fs.write_str(&path, &format!("ref: {trimmed}\n"));
        Ok(())
    }

    pub fn delete_ref(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> Result<(), GitError> {
        Self::delete_refs(fs, gitdir, &[ref_name.to_string()])
    }

    pub fn delete_refs(fs: &MemoryFs, raw_gitdir: &str, refs: &[String]) -> Result<(), GitError> {
        let gitdir_buf = discover_gitdir(fs, raw_gitdir);
        let gitdir = gitdir_buf.as_str();
        for r in refs {
            assert_writable_ref(r)?;
        }
        for r in refs {
            let _ = fs.rm(&join(&[gitdir, r]));
        }
        let packed_path = join(&[gitdir, "packed-refs"]);
        if let Some(text) = fs.read_str(&packed_path) {
            let mut packed = GitPackedRefs::from(&text);
            let before = packed.refs.len();
            for r in refs {
                if packed.refs.contains_key(r) {
                    packed.delete(r);
                }
            }
            if packed.refs.len() < before {
                fs.write_str(&packed_path, &packed.to_string());
            }
        }
        Ok(())
    }

    pub fn resolve(
        fs: &MemoryFs,
        gitdir: &str,
        ref_name: &str,
        depth: Option<i32>,
    ) -> Result<String, GitError> {
        let gitdir = discover_gitdir(fs, gitdir);
        let mut visited = BTreeSet::new();
        Self::resolve_inner(fs, &gitdir, ref_name, depth, &mut visited)
    }

    fn resolve_inner(
        fs: &MemoryFs,
        gitdir: &str,
        ref_name: &str,
        depth: Option<i32>,
        visited: &mut BTreeSet<String>,
    ) -> Result<String, GitError> {
        let next_depth = if let Some(d) = depth {
            let nd = d - 1;
            if nd == -1 {
                return Ok(ref_name.to_string());
            }
            Some(nd)
        } else {
            None
        };

        if let Some(rest) = ref_name.strip_prefix("ref: ") {
            return Self::resolve_inner(fs, gitdir, rest, next_depth, visited);
        }

        if ref_name.len() == 40
            && ref_name
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Ok(ref_name.to_string());
        }

        let packed_map = Self::packed_refs(fs, gitdir);
        let candidates: Vec<String> = refpaths(ref_name)
            .into_iter()
            .filter(|p| !GIT_FILES.contains(&p.as_str()))
            .collect();

        for candidate in candidates {
            let file_path = join(&[gitdir, &candidate]);
            let sha_opt = if let Some(text) = fs.read_str(&file_path) {
                Some(text)
            } else {
                packed_map.get(&candidate).cloned()
            };

            if let Some(sha) = sha_opt {
                if visited.contains(&candidate) {
                    return Err(GitError::internal(&format!(
                        "Circular reference detected while resolving ref \"{candidate}\""
                    )));
                }
                visited.insert(candidate);
                return Self::resolve_inner(fs, gitdir, sha.trim(), next_depth, visited);
            }
        }

        Err(GitError::not_found(ref_name))
    }

    pub fn is_unborn_branch(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> bool {
        let Ok(target) = Self::resolve(fs, gitdir, "HEAD", Some(2)) else {
            return false;
        };
        if !target.starts_with("refs/heads/") {
            return false;
        }
        ref_name == "HEAD" || refpaths(ref_name).contains(&target)
    }

    pub fn exists(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> bool {
        Self::expand(fs, gitdir, ref_name).is_ok()
    }

    pub fn expand(fs: &MemoryFs, raw_gitdir: &str, ref_name: &str) -> Result<String, GitError> {
        let gitdir_buf = discover_gitdir(fs, raw_gitdir);
        let gitdir = gitdir_buf.as_str();
        if ref_name.len() == 40
            && ref_name
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Ok(ref_name.to_string());
        }
        let packed_map = Self::packed_refs(fs, gitdir);
        let candidates: Vec<String> = refpaths(ref_name)
            .into_iter()
            .filter(|p| !GIT_FILES.contains(&p.as_str()))
            .collect();
        for candidate in candidates {
            let file_path = join(&[gitdir, &candidate]);
            let is_f = fs
                .stat(&file_path)
                .map(|s| s.is_file())
                .unwrap_or(false);
            if is_f || packed_map.contains_key(&candidate) {
                return Ok(candidate);
            }
        }
        Err(GitError::not_found(ref_name))
    }

    pub fn expand_against_map(
        ref_name: &str,
        map: &BTreeMap<String, String>,
    ) -> Result<String, GitError> {
        for candidate in refpaths(ref_name) {
            if map.contains_key(&candidate) {
                return Ok(candidate);
            }
        }
        Err(GitError::not_found(ref_name))
    }

    pub fn resolve_against_map(
        ref_name: &str,
        fullref: Option<&str>,
        depth: Option<i32>,
        map: &BTreeMap<String, String>,
    ) -> Result<(String, String), GitError> {
        let fref = fullref.unwrap_or(ref_name);
        let next_depth = if let Some(d) = depth {
            let nd = d - 1;
            if nd == -1 {
                return Ok((fref.to_string(), ref_name.to_string()));
            }
            Some(nd)
        } else {
            None
        };
        if let Some(rest) = ref_name.strip_prefix("ref: ") {
            return Self::resolve_against_map(rest, Some(fref), next_depth, map);
        }
        if ref_name.len() == 40
            && ref_name
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Ok((fref.to_string(), ref_name.to_string()));
        }
        for candidate in refpaths(ref_name) {
            if let Some(sha) = map.get(&candidate) {
                return Self::resolve_against_map(sha.trim(), Some(&candidate), next_depth, map);
            }
        }
        Err(GitError::not_found(ref_name))
    }

    pub fn list_refs(fs: &MemoryFs, raw_gitdir: &str, filepath: &str) -> Vec<String> {
        let gitdir_buf = discover_gitdir(fs, raw_gitdir);
        let gitdir = gitdir_buf.as_str();
        let packed_map = Self::packed_refs(fs, gitdir);
        let root = join(&[gitdir, filepath]);
        let prefix = format!("{root}/");
        let mut files: Vec<String> = fs
            .readdir_deep(&root)
            .into_iter()
            .filter_map(|p| p.strip_prefix(&prefix).map(|s| s.to_string()))
            .collect();

        let key_prefix = format!("{filepath}/");
        for key in packed_map.keys() {
            if let Some(stripped) = key.strip_prefix(&key_prefix) {
                let s = stripped.to_string();
                if !files.contains(&s) {
                    files.push(s);
                }
            }
        }
        files.sort_by(|a, b| compare_ref_names(a, b));
        files
    }

    pub fn list_branches(fs: &MemoryFs, gitdir: &str, remote: Option<&str>) -> Vec<String> {
        if let Some(rem) = remote {
            Self::list_refs(fs, gitdir, &format!("refs/remotes/{rem}"))
        } else {
            Self::list_refs(fs, gitdir, "refs/heads")
        }
    }

    pub fn list_tags(fs: &MemoryFs, gitdir: &str) -> Vec<String> {
        Self::list_refs(fs, gitdir, "refs/tags")
            .into_iter()
            .filter(|x| !x.ends_with("^{}"))
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_remote_refs(
        fs: &MemoryFs,
        gitdir: &str,
        remote: &str,
        refs: &BTreeMap<String, String>,
        symrefs: &BTreeMap<String, String>,
        tags: bool,
        refspecs: Option<&[String]>,
        prune: bool,
        prune_tags: bool,
    ) -> Result<Vec<String>, GitError> {
        for value in refs.values() {
            if value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(GitError::invalid_oid(value));
            }
        }

        let specs: Vec<String> = if let Some(rs) = refspecs {
            rs.to_vec()
        } else {
            let config = GitConfigManager::get(fs, gitdir);
            let fetched: Vec<String> = config
                .get_all(&format!("remote.{remote}.fetch"))
                .into_iter()
                .map(|v| v.as_str().to_string())
                .collect();
            if fetched.is_empty() {
                return Err(GitError::no_refspec(remote));
            }
            let mut v = fetched;
            v.insert(0, format!("+HEAD:refs/remotes/{remote}/HEAD"));
            v
        };

        let spec_refs: Vec<&str> = specs.iter().map(|s| s.as_str()).collect();
        let refspec_set = GitRefSpecSet::from(&spec_refs);
        let remote_ref_keys: Vec<&str> = refs.keys().map(|s| s.as_str()).collect();
        let ref_translations = refspec_set.translate(&remote_ref_keys);

        let symref_keys: Vec<&str> = symrefs.keys().map(|s| s.as_str()).collect();
        let mut symref_translations = Vec::new();
        for (server_ref, translated_ref) in refspec_set.translate(&symref_keys) {
            if let Some(target) = symrefs.get(&server_ref)
                && let Some(symtarget) = refspec_set.translate_one(target) {
                    assert_writable_ref(&symtarget)?;
                    symref_translations.push((translated_ref, format!("ref: {symtarget}")));
                }
        }

        let tag_refs_to_write: Vec<String> = if tags {
            refs.keys()
                .filter(|r| r.starts_with("refs/tags") && !r.ends_with("^{}"))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };

        for (_, translated_ref) in &ref_translations {
            assert_writable_ref(translated_ref)?;
        }
        for (translated_ref, _) in &symref_translations {
            assert_writable_ref(translated_ref)?;
        }
        for tag_ref in &tag_refs_to_write {
            assert_writable_ref(tag_ref)?;
        }

        if prune_tags {
            let existing_tags: Vec<String> = Self::list_refs(fs, gitdir, "refs/tags")
                .into_iter()
                .map(|t| format!("refs/tags/{t}"))
                .collect();
            Self::delete_refs(fs, gitdir, &existing_tags)?;
        }

        let mut actual_refs_to_write = BTreeMap::new();
        for server_ref in tag_refs_to_write {
            if !Self::exists(fs, gitdir, &server_ref)
                && let Some(oid) = refs.get(&server_ref) {
                    actual_refs_to_write.insert(server_ref, oid.clone());
                }
        }

        for (server_ref, translated_ref) in ref_translations {
            if let Some(val) = refs.get(&server_ref) {
                actual_refs_to_write.insert(translated_ref, val.clone());
            }
        }
        for (translated_ref, val) in symref_translations {
            actual_refs_to_write.insert(translated_ref, val);
        }

        let mut pruned = Vec::new();
        if prune {
            let local_namespaces: Vec<String> = refspec_set
                .rules
                .iter()
                .filter(|r| r.local_path != "HEAD")
                .map(|r| r.local_path.trim_end_matches("/*").to_string())
                .collect();
            for namespace in local_namespaces {
                let existing: Vec<String> = Self::list_refs(fs, gitdir, &namespace)
                    .into_iter()
                    .map(|f| format!("{namespace}/{f}"))
                    .collect();
                for r in existing {
                    if !actual_refs_to_write.contains_key(&r) {
                        pruned.push(r);
                    }
                }
            }
            if !pruned.is_empty() {
                Self::delete_refs(fs, gitdir, &pruned)?;
            }
        }

        for (key, val) in actual_refs_to_write {
            fs.write_str(&join(&[gitdir, &key]), &format!("{}\n", val.trim()));
        }

        Ok(pruned)
    }
}

pub struct GitConfigManager;

impl GitConfigManager {
    pub fn get(fs: &MemoryFs, raw_gitdir: &str) -> GitConfig {
        let gitdir = discover_gitdir(fs, raw_gitdir);
        let path = join(&[&gitdir, "config"]);
        let text = fs.read_str(&path).unwrap_or_default();
        GitConfig::from(&text)
    }

    pub fn save(fs: &MemoryFs, raw_gitdir: &str, config: &GitConfig) {
        let gitdir = discover_gitdir(fs, raw_gitdir);
        let path = join(&[&gitdir, "config"]);
        fs.write_str(&path, &config.to_string());
    }
}

pub struct GitIndexManager;

impl GitIndexManager {
    pub fn acquire<T, F>(fs: &MemoryFs, gitdir: &str, f: F) -> Result<T, GitError>
    where
        F: FnOnce(&mut GitIndex) -> Result<T, GitError>,
    {
        let gitdir = discover_gitdir(fs, gitdir);
        let index_path = join(&[&gitdir, "index"]);
        let mut index = if let Some(bytes) = fs.read(&index_path) {
            GitIndex::from_buffer(&bytes)?
        } else {
            GitIndex::new()
        };
        
        let res = f(&mut index)?;
        {
            let buf = index.to_object()?;
            fs.write(&index_path, &buf);
        }
        Ok(res)
    }
}

pub struct GitShallowManager;

impl GitShallowManager {
    pub fn read(fs: &MemoryFs, gitdir: &str) -> BTreeSet<String> {
        let path = join(&[gitdir, "shallow"]);
        let mut oids = BTreeSet::new();
        if let Some(text) = fs.read_str(&path) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                for line in trimmed.lines() {
                    if !line.trim().is_empty() {
                        oids.insert(line.trim().to_string());
                    }
                }
            }
        }
        oids
    }

    pub fn write(fs: &MemoryFs, gitdir: &str, oids: &BTreeSet<String>) {
        let path = join(&[gitdir, "shallow"]);
        if !oids.is_empty() {
            let mut text = oids.iter().cloned().collect::<Vec<_>>().join("\n");
            text.push('\n');
            fs.write_str(&path, &text);
        } else {
            let _ = fs.rm(&path);
        }
    }
}

pub fn translate_ssh_to_http(url: &str) -> String {
    if let Some((user_host, rest)) = url.split_once(':')
        && !user_host.contains('/')
            && let Some((_user, host)) = user_host.split_once('@')
            && !host.is_empty()
            && !host.contains('@')
        {
            return format!("https://{host}/{rest}");
        }
    if let Some(rest) = url.strip_prefix("ssh://") {
        return format!("https://{rest}");
    }
    url.to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteHelper {
    pub transport: String,
    pub address: String,
}

pub struct GitRemoteManager;

impl GitRemoteManager {
    pub fn get_remote_helper_for(url: &str) -> Result<RemoteHelper, GitError> {
        let parts = parse_remote_url(url).ok_or_else(|| GitError::url_parse(url))?;
        if parts.transport == "http" || parts.transport == "https" {
            return Ok(parts);
        }
        let suggestion = if parts.transport == "ssh" {
            Some(translate_ssh_to_http(url))
        } else {
            None
        };
        Err(GitError::unknown_transport(
            url,
            &parts.transport,
            suggestion.as_deref(),
        ))
    }
}

fn parse_remote_url(url: &str) -> Option<RemoteHelper> {
    if let Some((before_colon, _after_colon)) = url.split_once(':')
        && !before_colon.contains('/')
            && let Some((user, host)) = before_colon.split_once('@')
            && !user.is_empty()
            && !host.is_empty()
            && !host.contains('@')
        {
            return Some(RemoteHelper {
                transport: "ssh".to_string(),
                address: url.to_string(),
            });
        }

    if let Some((scheme, rest)) = url.split_once("://")
        && !scheme.is_empty()
            && scheme
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Some(RemoteHelper {
                transport: scheme.to_string(),
                address: format!("{scheme}://{rest}"),
            });
        }

    if let Some((scheme, rest)) = url.split_once("::")
        && !scheme.is_empty()
            && scheme
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Some(RemoteHelper {
                transport: scheme.to_string(),
                address: rest.to_string(),
            });
        }

    None
}

pub struct GitIgnoreManager;

impl GitIgnoreManager {
    pub fn is_ignored(fs: &MemoryFs, dir: &str, gitdir: Option<&str>, filepath: &str) -> bool {
        let gdir = gitdir
            .map(|s| s.to_string())
            .unwrap_or_else(|| join(&[dir, ".git"]));
        let bname = filepath
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(filepath);
        if bname == ".git" {
            return true;
        }
        if filepath == "." {
            return false;
        }

        let excludes_path = join(&[&gdir, "info", "exclude"]);
        let excludes = fs.read_str(&excludes_path).unwrap_or_default();

        let mut pairs = vec![(join(&[dir, ".gitignore"]), filepath.to_string())];
        let pieces: Vec<&str> = filepath.split('/').filter(|s| !s.is_empty()).collect();
        for i in 1..pieces.len() {
            let folder = pieces[0..i].join("/");
            let file = pieces[i..].join("/") + if filepath.ends_with('/') { "/" } else { "" };
            pairs.push((join(&[dir, &folder, ".gitignore"]), file));
        }

        let mut ignored_status = false;
        for (gitignore_path, rel_filepath) in pairs {
            let Some(file_content) = fs.read_str(&gitignore_path) else {
                continue;
            };
            let rules = parse_ignore_rules(&format!("{excludes}\n{file_content}"));

            let trimmed_rel = rel_filepath.trim_end_matches('/');
            if let Some((parent_dir, _)) = trimmed_rel.rsplit_once('/')
                && !parent_dir.is_empty() && parent_dir != "." {
                    let mut p_parts = Vec::new();
                    for seg in parent_dir.split('/') {
                        p_parts.push(seg);
                        let p_candidate = p_parts.join("/");
                        if evaluate_ignore(&rules, &p_candidate, true).0 {
                            return true;
                        }
                    }
                }

            let is_dir = rel_filepath.ends_with('/');
            let (ignored, unignored) = evaluate_ignore(&rules, trimmed_rel, is_dir);
            if ignored_status {
                ignored_status = !unignored;
            } else {
                ignored_status = ignored;
            }
        }
        ignored_status
    }
}

#[derive(Debug, Clone)]
struct IgnoreRule {
    negated: bool,
    dir_only: bool,
    anchored: bool,
    pattern: String,
}

fn parse_ignore_rules(text: &str) -> Vec<IgnoreRule> {
    let mut rules = Vec::new();
    for raw_line in text.lines() {
        let mut line = raw_line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if !line.ends_with("\\ ") {
            line = line.trim_end_matches(' ');
        }
        if line.is_empty() {
            continue;
        }
        let mut negated = false;
        if let Some(rest) = line.strip_prefix('!') {
            negated = true;
            line = rest;
        } else if let Some(rest) = line.strip_prefix("\\!") {
            line = rest;
        } else if let Some(rest) = line.strip_prefix("\\#") {
            line = rest;
        }
        let mut dir_only = false;
        if let Some(stripped) = line.strip_suffix('/') {
            dir_only = true;
            line = stripped;
        }
        let anchored = if let Some(stripped) = line.strip_prefix('/') {
            line = stripped;
            true
        } else {
            line.contains('/')
        };
        if !line.is_empty() {
            rules.push(IgnoreRule {
                negated,
                dir_only,
                anchored,
                pattern: line.to_string(),
            });
        }
    }
    rules
}

fn evaluate_ignore(rules: &[IgnoreRule], path: &str, is_dir: bool) -> (bool, bool) {
    let mut ignored = false;
    let mut unignored = false;
    for rule in rules {
        if rule_matches(rule, path, is_dir) {
            if rule.negated {
                ignored = false;
                unignored = true;
            } else {
                ignored = true;
                unignored = false;
            }
        }
    }
    (ignored, unignored)
}

fn rule_matches(rule: &IgnoreRule, path: &str, is_dir: bool) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    for idx in 0..segments.len() {
        let candidate = segments[idx..].join("/");
        let candidate_is_dir = if idx + 1 < segments.len() {
            true
        } else {
            is_dir
        };
        if rule.dir_only && !candidate_is_dir {
            continue;
        }
        if rule.anchored {
            if idx == 0 && glob_match(&rule.pattern, &candidate) {
                return true;
            }
        } else if glob_match(&rule.pattern, segments[idx]) || glob_match(&rule.pattern, &candidate)
        {
            return true;
        }
    }
    false
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let p_bytes = pattern.as_bytes();
    let t_bytes = text.as_bytes();
    glob_match_bytes(p_bytes, t_bytes)
}

fn glob_match_bytes(p: &[u8], t: &[u8]) -> bool {
    if p.is_empty() {
        return t.is_empty();
    }
    if p.starts_with(b"**/") {
        if glob_match_bytes(&p[3..], t) {
            return true;
        }
        for i in 0..t.len() {
            if t[i] == b'/' && glob_match_bytes(&p[3..], &t[i + 1..]) {
                return true;
            }
        }
        return false;
    }
    if p == b"**" {
        return true;
    }
    if p[0] == b'*' {
        if p.len() > 1 && p[1] == b'*' {
            return glob_match_bytes(&p[1..], t);
        }
        if glob_match_bytes(&p[1..], t) {
            return true;
        }
        if !t.is_empty() && t[0] != b'/' {
            return glob_match_bytes(p, &t[1..]);
        }
        return false;
    }
    if p[0] == b'?' {
        if !t.is_empty() && t[0] != b'/' {
            return glob_match_bytes(&p[1..], &t[1..]);
        }
        return false;
    }
    if !t.is_empty() && p[0] == t[0] {
        return glob_match_bytes(&p[1..], &t[1..]);
    }
    false
}

pub struct GitStashManager {
    pub dir: String,
    pub gitdir: String,
}

impl GitStashManager {
    pub fn new(dir: &str, gitdir: Option<&str>) -> Self {
        let gdir = gitdir
            .map(|s| s.to_string())
            .unwrap_or_else(|| join(&[dir, ".git"]));
        Self {
            dir: dir.to_string(),
            gitdir: gdir,
        }
    }

    pub fn ref_stash() -> &'static str {
        "refs/stash"
    }

    pub fn ref_logs_stash_path(&self) -> String {
        join(&[&self.gitdir, "logs", "refs", "stash"])
    }

    pub fn get_author(&self, fs: &MemoryFs) -> Result<Author, GitError> {
        let config = GitConfigManager::get(fs, &self.gitdir);
        let name = config
            .get("user.name")
            .map(|v| v.as_str().to_string())
            .unwrap_or_default();
        let email = config
            .get("user.email")
            .map(|v| v.as_str().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            return Err(GitError::missing_name("author"));
        }
        Ok(Author {
            name,
            email,
            timestamp: 1502484200,
            timezone_offset: 0.0,
        })
    }

    pub fn write_stash_ref(&self, fs: &MemoryFs, stash_commit: &str) -> Result<(), GitError> {
        GitRefManager::write_ref(fs, &self.gitdir, Self::ref_stash(), stash_commit)
    }

    pub fn write_stash_reflog_entry(
        &self,
        fs: &MemoryFs,
        stash_commit: &str,
        message: &str,
    ) -> Result<(), GitError> {
        let author = self.get_author(fs)?;
        let entry = GitRefStash::create_stash_reflog_entry(&author, stash_commit, message);
        let filepath = self.ref_logs_stash_path();
        let existing = fs.read_str(&filepath).unwrap_or_default();
        fs.write_str(&filepath, &format!("{existing}{entry}"));
        Ok(())
    }

    pub fn read_stash_reflogs(&self, fs: &MemoryFs, parsed: bool) -> Vec<String> {
        let filepath = self.ref_logs_stash_path();
        let Some(content) = fs.read_str(&filepath) else {
            return Vec::new();
        };
        GitRefStash::parse_stash_reflog(&content, parsed)
    }
}
