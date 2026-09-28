use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::errors::GitError;
use crate::fs::{discover_gitdir, MemoryFs};
use crate::managers::{
    clean_git_ref, is_valid_ref, GitConfigManager, GitRefManager, GitShallowManager,
};
use crate::models::git_config::ConfigValue;
use crate::models::git_object::UnwrappedObject;
use crate::models::{
    CommitObject, GitAnnotatedTag, GitCommit, GitObject, GitPackIndex, GitTree, TagObject,
    TreeEntry,
};
use crate::storage::{
    _read_object, _write_object, resolve_filepath, resolve_filepath_entry, resolve_tree,
};
use crate::utils::{dirname, join, shasum_bytes, zlib_deflate, Author};
use crate::wire::write_refs_ad_response;

pub fn init(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: Option<&str>,
    bare: bool,
    default_branch: Option<&str>,
) -> Result<(), GitError> {
    let gdir = match (gitdir, dir) {
        (Some(g), _) => g.to_string(),
        (None, Some(d)) => {
            if bare {
                d.to_string()
            } else {
                join(&[d, ".git"])
            }
        }
        (None, None) => return Err(GitError::missing_parameter("dir")),
    };
    let gdir = discover_gitdir(fs, &gdir);
    let branch_name = default_branch.unwrap_or("master");
    if !is_valid_ref(branch_name, true) {
        return Err(GitError::invalid_ref_name(
            branch_name,
            &clean_git_ref(branch_name),
        ));
    }

    let config_path = format!("{gdir}/config");
    if fs.exists(&config_path) {
        return Ok(());
    }

    for folder in [
        "hooks",
        "info",
        "objects/info",
        "objects/pack",
        "refs/heads",
        "refs/tags",
    ] {
        let _ = fs.mkdir(&format!("{gdir}/{folder}"));
    }

    let log_all = if bare {
        ""
    } else {
        "\tlogallrefupdates = true\n"
    };
    let cfg_content = format!(
        "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = {bare}\n{log_all}\tsymlinks = false\n\tignorecase = true\n"
    );
    fs.write_str(&config_path, &cfg_content);
    fs.write_str(&format!("{gdir}/HEAD"), &format!("ref: refs/heads/{branch_name}\n"));
    Ok(())
}

pub fn find_root(fs: &MemoryFs, filepath: &str) -> Result<String, GitError> {
    let mut current = filepath.to_string();
    loop {
        if fs.exists(&join(&[&current, ".git"])) {
            return Ok(current);
        }
        let parent = dirname(&current);
        if parent == current {
            return Err(GitError::not_found(&format!("git root for {filepath}")));
        }
        current = parent;
    }
}

pub fn get_config(fs: &MemoryFs, gitdir: &str, path: &str) -> Option<ConfigValue> {
    let gdir = discover_gitdir(fs, gitdir);
    let config = GitConfigManager::get(fs, &gdir);
    config.get(path)
}

pub fn get_config_all(fs: &MemoryFs, gitdir: &str, path: &str) -> Vec<ConfigValue> {
    let gdir = discover_gitdir(fs, gitdir);
    let config = GitConfigManager::get(fs, &gdir);
    config.get_all(path)
}

pub fn set_config(
    fs: &MemoryFs,
    gitdir: &str,
    path: &str,
    value: Option<&str>,
    append: bool,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut config = GitConfigManager::get(fs, &gdir);
    if append {
        config.append(path, value);
    } else {
        config.set(path, value);
    }
    GitConfigManager::save(fs, &gdir, &config);
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashBlobResult {
    pub oid: String,
    pub obj_type: String,
    pub object: Vec<u8>,
    pub format: String,
}

pub fn hash_blob(object: &[u8]) -> HashBlobResult {
    let wrapped = GitObject::wrap("blob", object);
    let oid = crate::utils::shasum(&wrapped);
    HashBlobResult {
        oid,
        obj_type: "blob".to_string(),
        object: wrapped,
        format: "wrapped".to_string(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadBlobResult {
    pub oid: String,
    pub blob: Vec<u8>,
}

pub fn read_blob(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    filepath: Option<&str>,
) -> Result<ReadBlobResult, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut resolved_oid = if let Some(fp) = filepath {
        resolve_filepath(fs, &gdir, oid, fp)?
    } else {
        oid.to_string()
    };
    loop {
        let res = _read_object(fs, &gdir, &resolved_oid, "content")?;
        if res.obj_type == "tag" {
            resolved_oid = GitAnnotatedTag::from_bytes(&res.object).parse().object;
            continue;
        }
        if res.obj_type != "blob" {
            return Err(GitError::object_type(
                &resolved_oid,
                &res.obj_type,
                "blob",
                filepath,
            ));
        }
        return Ok(ReadBlobResult {
            oid: resolved_oid,
            blob: res.object,
        });
    }
}

pub fn write_blob(fs: &MemoryFs, gitdir: &str, blob: &[u8]) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    _write_object(fs, &gdir, "blob", blob, "content", None, false)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadTreeResult {
    pub oid: String,
    pub tree: Vec<TreeEntry>,
}

pub fn read_tree(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    filepath: Option<&str>,
) -> Result<ReadTreeResult, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let resolved_oid = if let Some(fp) = filepath {
        resolve_filepath(fs, &gdir, oid, fp)?
    } else {
        oid.to_string()
    };
    let (tree_oid, tree) = resolve_tree(fs, &gdir, &resolved_oid)?;
    Ok(ReadTreeResult {
        oid: tree_oid,
        tree: tree.entries().to_vec(),
    })
}

pub fn write_tree(fs: &MemoryFs, gitdir: &str, entries: &[TreeEntry]) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let tree_bytes = GitTree::from_entries(entries.to_vec())?.to_object()?;
    _write_object(fs, &gdir, "tree", &tree_bytes, "content", None, false)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadCommitResult {
    pub oid: String,
    pub commit: CommitObject,
    pub payload: String,
}

pub fn read_commit(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
) -> Result<ReadCommitResult, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut actual_oid = oid.to_string();
    let mut obj = _read_object(fs, &gdir, &actual_oid, "content")?;
    let mut visited = BTreeSet::new();
    while obj.obj_type == "tag" {
        if !visited.insert(actual_oid.clone()) {
            return Err(GitError::not_found(oid));
        }
        actual_oid = GitAnnotatedTag::from_bytes(&obj.object).parse().object;
        obj = _read_object(fs, &gdir, &actual_oid, "content")?;
    }
    if obj.obj_type != "commit" {
        return Err(GitError::object_type(&actual_oid, &obj.obj_type, "commit", None));
    }
    let gc = GitCommit::from_bytes(&obj.object);
    Ok(ReadCommitResult {
        oid: actual_oid,
        commit: gc.parse(),
        payload: gc.without_signature(),
    })
}

pub fn write_commit(
    fs: &MemoryFs,
    gitdir: &str,
    commit: &CommitObject,
) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let bytes = GitCommit::from_object(commit).to_object();
    _write_object(fs, &gdir, "commit", &bytes, "content", None, false)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadTagResult {
    pub oid: String,
    pub tag: TagObject,
    pub payload: String,
}

pub fn read_tag(fs: &MemoryFs, gitdir: &str, oid: &str) -> Result<ReadTagResult, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let res = _read_object(fs, &gdir, oid, "content")?;
    if res.obj_type != "tag" {
        return Err(GitError::object_type(oid, &res.obj_type, "tag", None));
    }
    let gt = GitAnnotatedTag::from_bytes(&res.object);
    Ok(ReadTagResult {
        oid: oid.to_string(),
        tag: gt.parse(),
        payload: gt.payload(),
    })
}

pub fn write_tag(fs: &MemoryFs, gitdir: &str, tag: &TagObject) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let bytes = GitAnnotatedTag::from_object(tag).to_object();
    _write_object(fs, &gdir, "tag", &bytes, "content", None, false)
}

pub fn tag(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: &str,
    object: Option<&str>,
    force: bool,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let full_ref = if ref_name.starts_with("refs/tags/") {
        ref_name.to_string()
    } else {
        format!("refs/tags/{ref_name}")
    };
    if !force && GitRefManager::exists(fs, &gdir, &full_ref) {
        return Err(GitError::already_exists("tag", &full_ref, true));
    }
    let target = object.unwrap_or("HEAD");
    let oid = GitRefManager::resolve(fs, &gdir, target, None)?;
    GitRefManager::write_ref(fs, &gdir, &full_ref, &oid)
}

#[allow(clippy::too_many_arguments)]
pub fn annotated_tag(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: &str,
    message: Option<&str>,
    object: Option<&str>,
    tagger: Option<Author>,
    gpgsig: Option<String>,
    force: bool,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let full_ref = if ref_name.starts_with("refs/tags/") {
        ref_name.to_string()
    } else {
        format!("refs/tags/{ref_name}")
    };
    if !force && GitRefManager::exists(fs, &gdir, &full_ref) {
        return Err(GitError::already_exists("tag", &full_ref, true));
    }
    let tagger_author = match tagger {
        Some(a) => a,
        None => {
            let cfg = GitConfigManager::get(fs, &gdir);
            let name = cfg.get("user.name").map(|v| v.as_str().to_string()).unwrap_or_default();
            let email = cfg.get("user.email").map(|v| v.as_str().to_string()).unwrap_or_default();
            if name.is_empty() {
                return Err(GitError::missing_name("tagger"));
            }
            Author {
                name,
                email,
                timestamp: 1502484200,
                timezone_offset: 0.0,
            }
        }
    };
    let target = object.unwrap_or("HEAD");
    let oid = GitRefManager::resolve(fs, &gdir, target, None)?;
    let obj = _read_object(fs, &gdir, &oid, "content")?;
    let mut msg = message.unwrap_or(ref_name).to_string();
    if !msg.ends_with('\n') {
        msg.push('\n');
    }
    let tag_obj = TagObject {
        object: oid,
        object_type: obj.obj_type,
        tag: full_ref.trim_start_matches("refs/tags/").to_string(),
        tagger: tagger_author,
        message: msg,
        gpgsig,
    };
    let tag_oid = write_tag(fs, &gdir, &tag_obj)?;
    GitRefManager::write_ref(fs, &gdir, &full_ref, &tag_oid)
}

pub fn delete_tag(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let full_ref = if ref_name.starts_with("refs/tags/") {
        ref_name.to_string()
    } else {
        format!("refs/tags/{ref_name}")
    };
    GitRefManager::delete_ref(fs, &gdir, &full_ref)
}

pub fn branch(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: &str,
    object: Option<&str>,
    checkout: bool,
    force: bool,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if !is_valid_ref(ref_name, true) {
        return Err(GitError::invalid_ref_name(
            ref_name,
            &clean_git_ref(ref_name),
        ));
    }
    let full_ref = format!("refs/heads/{ref_name}");
    if !force && GitRefManager::exists(fs, &gdir, &full_ref) {
        return Err(GitError::already_exists("branch", ref_name, false));
    }
    let target = object.unwrap_or("HEAD");
    if let Ok(oid) = GitRefManager::resolve(fs, &gdir, target, None) {
        GitRefManager::write_ref(fs, &gdir, &full_ref, &oid)?;
    }
    if checkout {
        GitRefManager::write_symbolic_ref(fs, &gdir, "HEAD", &full_ref)?;
    }
    Ok(())
}

pub fn delete_branch(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let full_ref_input = if ref_name.starts_with("refs/heads/") {
        ref_name.to_string()
    } else {
        format!("refs/heads/{ref_name}")
    };
    if !GitRefManager::exists(fs, &gdir, &full_ref_input) {
        return Err(GitError::not_found(ref_name));
    }
    let full_ref = GitRefManager::expand(fs, &gdir, &full_ref_input)?;
    let current_ref = crate::current_branch(fs, &gdir, true, false)?;
    if current_ref.as_deref() == Some(full_ref.as_str()) {
        let val = GitRefManager::resolve(fs, &gdir, &full_ref, None)?;
        GitRefManager::write_ref(fs, &gdir, "HEAD", &val)?;
    }
    GitRefManager::delete_ref(fs, &gdir, &full_ref)?;
    let abbrev = full_ref.trim_start_matches("refs/heads/");
    let mut cfg = GitConfigManager::get(fs, &gdir);
    cfg.delete_section("branch", Some(abbrev));
    GitConfigManager::save(fs, &gdir, &cfg);
    Ok(())
}

pub fn rename_branch(
    fs: &MemoryFs,
    gitdir: &str,
    oldref: &str,
    ref_name: &str,
    checkout: bool,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if !is_valid_ref(ref_name, true) {
        return Err(GitError::invalid_ref_name(
            ref_name,
            &clean_git_ref(ref_name),
        ));
    }
    if !is_valid_ref(oldref, true) {
        return Err(GitError::invalid_ref_name(oldref, &clean_git_ref(oldref)));
    }
    let full_old = format!("refs/heads/{oldref}");
    let full_new = format!("refs/heads/{ref_name}");
    if GitRefManager::exists(fs, &gdir, &full_new) {
        return Err(GitError::already_exists("branch", ref_name, false));
    }
    let val = GitRefManager::resolve(fs, &gdir, &full_old, Some(1))?;
    GitRefManager::write_ref(fs, &gdir, &full_new, &val)?;
    GitRefManager::delete_ref(fs, &gdir, &full_old)?;
    let current_ref = crate::current_branch(fs, &gdir, true, false)?;
    if checkout || current_ref.as_deref() == Some(full_old.as_str()) {
        GitRefManager::write_symbolic_ref(fs, &gdir, "HEAD", &full_new)?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    pub remote: String,
    pub url: String,
}

pub fn add_remote(
    fs: &MemoryFs,
    gitdir: &str,
    remote: &str,
    url: &str,
    force: bool,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if !is_valid_ref(remote, true) {
        return Err(GitError::invalid_ref_name(remote, &clean_git_ref(remote)));
    }
    let mut cfg = GitConfigManager::get(fs, &gdir);
    if !force {
        let remotes: Vec<String> = cfg
            .get_subsections("remote")
            .into_iter()
            .flatten()
            .collect();
        if remotes.contains(&remote.to_string()) {
            let existing_url = cfg
                .get(&format!("remote.{remote}.url"))
                .map(|v| v.as_str().to_string())
                .unwrap_or_default();
            if existing_url != url {
                return Err(GitError::already_exists("remote", remote, true));
            }
        }
    }
    cfg.set(&format!("remote.{remote}.url"), Some(url));
    cfg.set(
        &format!("remote.{remote}.fetch"),
        Some(&format!("+refs/heads/*:refs/remotes/{remote}/*")),
    );
    GitConfigManager::save(fs, &gdir, &cfg);
    Ok(())
}

pub fn delete_remote(fs: &MemoryFs, gitdir: &str, remote: &str) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut cfg = GitConfigManager::get(fs, &gdir);
    cfg.delete_section("remote", Some(remote));
    GitConfigManager::save(fs, &gdir, &cfg);
    Ok(())
}

pub fn list_remotes(fs: &MemoryFs, gitdir: &str) -> Vec<RemoteEntry> {
    let gdir = discover_gitdir(fs, gitdir);
    let cfg = GitConfigManager::get(fs, &gdir);
    let names: Vec<String> = cfg
        .get_subsections("remote")
        .into_iter()
        .flatten()
        .collect();
    let mut out = Vec::new();
    for remote in names {
        let url = cfg
            .get(&format!("remote.{remote}.url"))
            .map(|v| v.as_str().to_string())
            .unwrap_or_default();
        out.push(RemoteEntry { remote, url });
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteEntry {
    pub target: String,
    pub note: String,
}

#[allow(clippy::too_many_arguments)]
pub fn add_note(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: Option<&str>,
    oid: &str,
    note: &[u8],
    force: bool,
    author: Author,
    committer: Option<Author>,
) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let r = ref_name.unwrap_or("refs/notes/commits");
    let parent = GitRefManager::resolve(fs, &gdir, r, None).ok();
    let tree_oid_base = parent
        .as_deref()
        .unwrap_or("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    let mut entries = read_tree(fs, &gdir, tree_oid_base, None)?.tree;
    if force {
        entries.retain(|e| e.path != oid);
    } else if entries.iter().any(|e| e.path == oid) {
        return Err(GitError::already_exists("note", oid, true));
    }
    let note_oid = write_blob(fs, &gdir, note)?;
    entries.push(TreeEntry {
        mode: "100644".to_string(),
        path: oid.to_string(),
        oid: note_oid,
        entry_type: "blob".to_string(),
    });
    let new_tree_oid = write_tree(fs, &gdir, &entries)?;
    let commit_obj = CommitObject {
        message: "Note added by 'git notes add'\n".to_string(),
        tree: new_tree_oid,
        parent: parent.into_iter().collect(),
        author: author.clone(),
        committer: committer.unwrap_or(author),
        gpgsig: None,
    };
    let commit_oid = write_commit(fs, &gdir, &commit_obj)?;
    GitRefManager::write_ref(fs, &gdir, r, &commit_oid)?;
    Ok(commit_oid)
}

pub fn read_note(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: Option<&str>,
    oid: &str,
) -> Result<Vec<u8>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let r = ref_name.unwrap_or("refs/notes/commits");
    let parent = GitRefManager::resolve(fs, &gdir, r, None)?;
    Ok(read_blob(fs, &gdir, &parent, Some(oid))?.blob)
}

pub fn remove_note(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: Option<&str>,
    oid: &str,
    author: Author,
    committer: Option<Author>,
) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let r = ref_name.unwrap_or("refs/notes/commits");
    let parent = GitRefManager::resolve(fs, &gdir, r, None).ok();
    let tree_oid_base = parent
        .as_deref()
        .unwrap_or("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    let mut entries = read_tree(fs, &gdir, tree_oid_base, None)?.tree;
    entries.retain(|e| e.path != oid);
    let new_tree_oid = write_tree(fs, &gdir, &entries)?;
    let commit_obj = CommitObject {
        message: "Note removed by 'git notes remove'\n".to_string(),
        tree: new_tree_oid,
        parent: parent.into_iter().collect(),
        author: author.clone(),
        committer: committer.unwrap_or(author),
        gpgsig: None,
    };
    let commit_oid = write_commit(fs, &gdir, &commit_obj)?;
    GitRefManager::write_ref(fs, &gdir, r, &commit_oid)?;
    Ok(commit_oid)
}

pub fn list_notes(fs: &MemoryFs, gitdir: &str, ref_name: Option<&str>) -> Result<Vec<NoteEntry>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let r = ref_name.unwrap_or("refs/notes/commits");
    let Ok(parent) = GitRefManager::resolve(fs, &gdir, r, None) else {
        return Ok(Vec::new());
    };
    let entries = read_tree(fs, &gdir, &parent, None)?.tree;
    Ok(entries
        .into_iter()
        .map(|e| NoteEntry {
            target: e.path,
            note: e.oid,
        })
        .collect())
}

fn resolve_file_id_in_tree(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    file_id: &str,
) -> Result<Vec<String>, GitError> {
    if file_id == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391" {
        return Ok(Vec::new());
    }
    let (tree_oid, tree) = resolve_tree(fs, gitdir, oid)?;
    if file_id == tree_oid {
        return Ok(vec![String::new()]);
    }
    let mut filepaths = Vec::new();
    resolve_file_id_recursive(fs, gitdir, &tree, file_id, "", &mut filepaths)?;
    Ok(filepaths)
}

fn resolve_file_id_recursive(
    fs: &MemoryFs,
    gitdir: &str,
    tree: &GitTree,
    file_id: &str,
    parent_path: &str,
    filepaths: &mut Vec<String>,
) -> Result<(), GitError> {
    for entry in tree.entries() {
        let current = if parent_path.is_empty() {
            entry.path.clone()
        } else {
            join(&[parent_path, &entry.path])
        };
        if entry.oid == file_id {
            filepaths.push(current);
        } else if entry.entry_type == "tree" {
            let sub = _read_object(fs, gitdir, &entry.oid, "content")?;
            let subtree = GitTree::from_bytes(&sub.object)?;
            resolve_file_id_recursive(fs, gitdir, &subtree, file_id, &current, filepaths)?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn log(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: Option<&str>,
    filepath: Option<&str>,
    depth: Option<usize>,
    since_timestamp: Option<i64>,
    force: bool,
    follow: bool,
) -> Result<Vec<ReadCommitResult>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let r = ref_name.unwrap_or("HEAD");
    let shallow_commits = GitShallowManager::read(fs, &gdir);
    let start_oid = GitRefManager::resolve(fs, &gdir, r, None)?;
    let mut tips = vec![read_commit(fs, &gdir, &start_oid)?];
    let mut commits: Vec<ReadCommitResult> = Vec::new();
    let mut current_filepath: Option<String> = filepath.map(|s| s.to_string());
    let mut last_file_oid: Option<String> = None;
    let mut last_file_mode: Option<String> = None;
    let mut last_commit: Option<ReadCommitResult> = None;
    let mut is_ok = false;

    while let Some(commit) = tips.pop() {
        if let Some(since_ts) = since_timestamp
            && commit.commit.committer.timestamp <= since_ts {
                break;
            }

        if let Some(ref fp) = current_filepath.clone() {
            match resolve_filepath_entry(fs, &gdir, &commit.commit.tree, fp) {
                Ok(v_file_entry) => {
                    if let Some(ref lc) = last_commit
                        && (last_file_oid.as_deref() != Some(&v_file_entry.oid)
                            || last_file_mode.as_deref() != Some(&v_file_entry.mode))
                        {
                            commits.push(lc.clone());
                        }
                    last_file_oid = Some(v_file_entry.oid);
                    last_file_mode = Some(v_file_entry.mode);
                    last_commit = Some(commit.clone());
                    is_ok = true;
                }
                Err(e) if e.code == crate::errors::ErrorCode::NotFoundError => {
                    let mut found_rename = false;
                    if follow
                        && let Some(ref l_oid) = last_file_oid {
                            let found_list =
                                resolve_file_id_in_tree(fs, &gdir, &commit.commit.tree, l_oid)?;
                            if found_list.len() == 1 {
                                current_filepath = Some(found_list[0].clone());
                                if let Some(ref lc) = last_commit {
                                    commits.push(lc.clone());
                                }
                                found_rename = true;
                            } else if found_list.len() > 1
                                && let Some(ref lc) = last_commit {
                                    let last_found = resolve_file_id_in_tree(
                                        fs,
                                        &gdir,
                                        &lc.commit.tree,
                                        l_oid,
                                    )?;
                                    let diff: Vec<String> = found_list
                                        .into_iter()
                                        .filter(|p| !last_found.contains(p))
                                        .collect();
                                    if diff.len() == 1 {
                                        current_filepath = Some(diff[0].clone());
                                        commits.push(lc.clone());
                                        found_rename = true;
                                    } else {
                                        commits.push(lc.clone());
                                        break;
                                    }
                                }
                        }
                    if !found_rename {
                        if is_ok && last_file_oid.is_some() {
                            if let Some(ref lc) = last_commit {
                                commits.push(lc.clone());
                            }
                            if !force {
                                break;
                            }
                        }
                        if !force && !follow {
                            return Err(e);
                        }
                    }
                    last_commit = Some(commit.clone());
                    is_ok = found_rename;
                }
                Err(e) => return Err(e),
            }
        } else {
            commits.push(commit.clone());
        }

        if let Some(max_d) = depth
            && commits.len() == max_d {
                if is_ok && current_filepath.is_some() {
                    commits.push(commit.clone());
                }
                break;
            }

        if !shallow_commits.contains(&commit.oid) {
            for parent_oid in &commit.commit.parent {
                let p_commit = read_commit(fs, &gdir, parent_oid)?;
                if !tips.iter().any(|t| t.oid == p_commit.oid) {
                    tips.push(p_commit);
                }
            }
        }

        if tips.is_empty() && is_ok && current_filepath.is_some() {
            commits.push(commit);
        }

        tips.sort_by_key(|c| c.commit.committer.timestamp);
    }

    Ok(commits)
}

pub fn is_descendent(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    ancestor: &str,
    depth: Option<isize>,
) -> Result<bool, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if oid.is_empty() {
        return Err(GitError::missing_parameter("oid"));
    }
    if ancestor.is_empty() {
        return Err(GitError::missing_parameter("ancestor"));
    }
    if oid == ancestor {
        return Ok(false);
    }
    let shallows = GitShallowManager::read(fs, &gdir);
    let max_depth = depth.unwrap_or(-1);
    let mut queue = VecDeque::new();
    queue.push_back(oid.to_string());
    let mut visited = BTreeSet::new();
    let mut search_depth: isize = 0;

    while let Some(curr) = queue.pop_front() {
        if max_depth >= 0 && search_depth == max_depth {
            return Err(GitError::max_depth(max_depth as usize));
        }
        search_depth += 1;
        let obj = _read_object(fs, &gdir, &curr, "content")?;
        if obj.obj_type != "commit" {
            return Err(GitError::object_type(&curr, &obj.obj_type, "commit", None));
        }
        let commit = GitCommit::from_bytes(&obj.object).parse();
        for p in &commit.parent {
            if p == ancestor {
                return Ok(true);
            }
        }
        if !shallows.contains(&curr) {
            for p in commit.parent {
                if !visited.contains(&p) {
                    visited.insert(p.clone());
                    queue.push_back(p);
                }
            }
        }
    }
    Ok(false)
}

pub fn find_merge_base(
    fs: &MemoryFs,
    gitdir: &str,
    oids: &[String],
) -> Result<Vec<String>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let passes = oids.len();
    if passes == 0 {
        return Ok(Vec::new());
    }
    let shallows = GitShallowManager::read(fs, &gdir);
    let mut visits: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
    let mut common: Vec<String> = Vec::new();
    let mut parents_cache: BTreeMap<String, Vec<String>> = BTreeMap::new();

    let mut read_parents = |oid: &str| -> Result<Vec<String>, GitError> {
        if let Some(p) = parents_cache.get(oid) {
            return Ok(p.clone());
        }
        let obj = _read_object(fs, &gdir, oid, "content")?;
        if obj.obj_type != "commit" {
            return Err(GitError::object_type(oid, &obj.obj_type, "commit", None));
        }
        let commit = GitCommit::from_bytes(&obj.object).parse();
        let res = if shallows.contains(oid) {
            Vec::new()
        } else {
            commit.parent
        };
        parents_cache.insert(oid.to_string(), res.clone());
        Ok(res)
    };

    let mut heads: Vec<(usize, String)> = oids
        .iter()
        .enumerate()
        .map(|(idx, o)| (idx, o.clone()))
        .collect();

    while !heads.is_empty() {
        for (idx, oid) in &heads {
            read_parents(oid)?;
            let set = visits.entry(oid.clone()).or_default();
            set.insert(*idx);
            if set.len() == passes && !common.contains(oid) {
                common.push(oid.clone());
            }
        }
        let mut new_heads: Vec<(usize, String)> = Vec::new();
        let mut seen_keys = BTreeSet::new();
        for (idx, oid) in &heads {
            if common.contains(oid) {
                continue;
            }
            for parent in read_parents(oid)? {
                let already = visits
                    .get(&parent)
                    .map(|s| s.contains(idx))
                    .unwrap_or(false);
                let key = format!("{parent}:{idx}");
                if !already && !seen_keys.contains(&key) {
                    seen_keys.insert(key);
                    new_heads.push((*idx, parent));
                }
            }
        }
        heads = new_heads;
    }

    if common.len() < 2 {
        return Ok(common);
    }

    let mut redundant = BTreeSet::new();
    for oid in &common {
        let mut stack = read_parents(oid)?;
        let mut seen = BTreeSet::new();
        while let Some(anc) = stack.pop() {
            if !seen.insert(anc.clone()) {
                continue;
            }
            if common.contains(&anc) {
                redundant.insert(anc);
            } else {
                stack.extend(read_parents(&anc)?);
            }
        }
    }

    Ok(common
        .into_iter()
        .filter(|oid| !redundant.contains(oid))
        .collect())
}

pub fn list_commits_and_tags(
    fs: &MemoryFs,
    gitdir: &str,
    start: &[String],
    finish: &[String],
) -> Result<BTreeSet<String>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let shallows = GitShallowManager::read(fs, &gdir);
    let mut starting_set = BTreeSet::new();
    for r in start {
        starting_set.insert(GitRefManager::resolve(fs, &gdir, r, None)?);
    }
    let mut finishing_set = BTreeSet::new();
    for r in finish {
        if let Ok(oid) = GitRefManager::resolve(fs, &gdir, r, None) {
            finishing_set.insert(oid);
        }
    }
    let mut visited = BTreeSet::new();
    let mut stack: Vec<String> = starting_set.into_iter().collect();
    while let Some(oid) = stack.pop() {
        visited.insert(oid.clone());
        let obj = _read_object(fs, &gdir, &oid, "content")?;
        if obj.obj_type == "tag" {
            let tag = GitAnnotatedTag::from_bytes(&obj.object).parse();
            if !visited.contains(&tag.object) {
                stack.push(tag.object);
            }
            continue;
        }
        if obj.obj_type != "commit" {
            return Err(GitError::object_type(&oid, &obj.obj_type, "commit", None));
        }
        if !shallows.contains(&oid) {
            let commit = GitCommit::from_bytes(&obj.object).parse();
            for p in commit.parent {
                if !finishing_set.contains(&p) && !visited.contains(&p) {
                    stack.push(p);
                }
            }
        }
    }
    Ok(visited)
}

pub fn list_objects(
    fs: &MemoryFs,
    gitdir: &str,
    oids: &[String],
) -> Result<BTreeSet<String>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut visited = BTreeSet::new();
    let mut stack: Vec<String> = oids.to_vec();
    while let Some(oid) = stack.pop() {
        if !visited.insert(oid.clone()) {
            continue;
        }
        let obj = _read_object(fs, &gdir, &oid, "content")?;
        match obj.obj_type.as_str() {
            "tag" => {
                let tag = GitAnnotatedTag::from_bytes(&obj.object).parse();
                stack.push(tag.object);
            }
            "commit" => {
                let commit = GitCommit::from_bytes(&obj.object).parse();
                stack.push(commit.tree);
            }
            "tree" => {
                let tree = GitTree::from_bytes(&obj.object)?;
                for entry in tree.entries() {
                    if entry.entry_type == "blob" {
                        visited.insert(entry.oid.clone());
                    } else if entry.entry_type == "tree" {
                        stack.push(entry.oid.clone());
                    }
                }
            }
            _ => {}
        }
    }
    Ok(visited)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackObjectsResult {
    pub filename: String,
    pub packfile: Option<Vec<u8>>,
}

pub fn pack_objects(
    fs: &MemoryFs,
    gitdir: &str,
    oids: &[String],
    write: bool,
) -> Result<PackObjectsResult, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut pack = Vec::new();
    pack.extend_from_slice(b"PACK");
    pack.extend_from_slice(&2u32.to_be_bytes());
    pack.extend_from_slice(&(oids.len() as u32).to_be_bytes());

    for oid in oids {
        let obj = _read_object(fs, &gdir, oid, "content")?;
        let type_num: u8 = match obj.obj_type.as_str() {
            "commit" => 0b001_0000,
            "tree" => 0b010_0000,
            "blob" => 0b011_0000,
            "tag" => 0b100_0000,
            other => return Err(GitError::internal(&format!("Unknown pack type {other}"))),
        };
        let mut length = obj.object.len();
        let mut multibyte = if length > 0b1111 { 0x80u8 } else { 0 };
        let last_four = (length & 0b1111) as u8;
        length >>= 4;
        pack.push(multibyte | type_num | last_four);
        while multibyte != 0 {
            multibyte = if length > 0x7f { 0x80u8 } else { 0 };
            pack.push(multibyte | ((length & 0x7f) as u8));
            length >>= 7;
        }
        pack.extend_from_slice(&zlib_deflate(&obj.object));
    }

    let sha = shasum_bytes(&pack);
    let packfile_sha = crate::utils::to_hex(&sha);
    pack.extend_from_slice(&sha);

    let filename = format!("pack-{packfile_sha}.pack");
    if write {
        fs.write(&join(&[&gdir, "objects/pack", &filename]), &pack);
        Ok(PackObjectsResult {
            filename,
            packfile: None,
        })
    } else {
        Ok(PackObjectsResult {
            filename,
            packfile: Some(pack),
        })
    }
}

pub fn index_pack(
    fs: &MemoryFs,
    dir: &str,
    gitdir: &str,
    filepath: &str,
) -> Result<Vec<String>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let full_path = join(&[dir, filepath]);
    let pack = fs
        .read(&full_path)
        .ok_or_else(|| GitError::not_found(&full_path))?;
    let get_ext = |ext_oid: &str| -> Result<UnwrappedObject, GitError> {
        let r = _read_object(fs, &gdir, ext_oid, "content")?;
        Ok(UnwrappedObject {
            object_type: r.obj_type,
            object: r.object,
        })
    };
    let idx = GitPackIndex::from_pack(&pack, Some(&get_ext))?;
    let idx_path = full_path.trim_end_matches(".pack").to_string() + ".idx";
    fs.write(&idx_path, &idx.to_buffer()?);
    Ok(idx.hashes)
}

pub fn upload_pack(
    fs: &MemoryFs,
    gitdir: &str,
    advertise_refs: bool,
) -> Result<Option<Vec<u8>>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if !advertise_refs {
        return Ok(None);
    }
    let capabilities = &[
        "thin-pack",
        "side-band",
        "side-band-64k",
        "shallow",
        "deepen-since",
        "deepen-not",
        "allow-tip-sha1-in-want",
        "allow-reachable-sha1-in-want",
    ];

    let mut keys: Vec<String> = GitRefManager::list_refs(fs, &gdir, "refs")
        .into_iter()
        .map(|r| format!("refs/{r}"))
        .collect();
    keys.insert(0, "HEAD".to_string());
    let mut refs = BTreeMap::new();
    for key in keys {
        if let Ok(oid) = GitRefManager::resolve(fs, &gdir, &key, None) {
            refs.insert(key, oid);
        }
    }
    let mut symrefs = BTreeMap::new();
    if let Ok(head_target) = GitRefManager::resolve(fs, &gdir, "HEAD", Some(2)) {
        symrefs.insert("HEAD".to_string(), head_target);
    }
    Ok(Some(write_refs_ad_response(capabilities, &refs, &symrefs)))
}
