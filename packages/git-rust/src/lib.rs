#![allow(clippy::too_many_arguments, clippy::should_implement_trait)]

pub mod commands;
pub mod cli;
#[doc(hidden)]
pub mod environment;
pub mod crypto;
#[cfg(not(target_arch = "wasm32"))]
mod openpgp;
pub mod hooks;
pub mod ssh;
mod cli_files;
mod cli_history;
mod cli_patch;
mod cli_refs;
pub mod portable;
pub mod errors;
pub mod fixtures;
pub mod fs;
pub mod http;
pub mod managers;
pub mod models;
pub mod storage;
pub mod utils;
pub mod wire;

pub const VERSION: &str = "0.0.0-development";

pub fn version() -> &'static str {
    VERSION
}

pub use errors::{ErrorCode, GitError};
pub use fixtures::{make_fixture, make_fixture_as_submodule};
pub use fs::{assert_no_symlink_in_leading_path, discover_gitdir, mkdirp, MemoryFs};
pub use managers::{
    assert_writable_ref, clean_git_ref, compare_ref_names, is_valid_ref, translate_ssh_to_http,
    GitConfigManager, GitIgnoreManager, GitIndexManager, GitRefManager, GitRemoteManager,
    GitShallowManager, GitStashManager, RemoteHelper,
};
pub use storage::{
    _read_object, _write_object, expand_oid, has_object, hash_object, read_object,
    resolve_filepath, resolve_filepath_entry, resolve_tree, write_object, ParsedObject,
    ReadObjectResult,
};

pub fn resolve_ref(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: &str,
    depth: Option<i32>,
) -> Result<String, GitError> {
    GitRefManager::resolve(fs, gitdir, ref_name, depth)
}

pub fn write_ref(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: &str,
    value: &str,
    force: bool,
    symbolic: bool,
) -> Result<(), GitError> {
    if !force && GitRefManager::exists(fs, gitdir, ref_name) {
        return Err(GitError::already_exists("ref", ref_name, true));
    }
    if symbolic {
        GitRefManager::write_symbolic_ref(fs, gitdir, ref_name, value)
    } else {
        let resolved = GitRefManager::resolve(fs, gitdir, value, None)?;
        GitRefManager::write_ref(fs, gitdir, ref_name, &resolved)
    }
}

pub fn delete_ref(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> Result<(), GitError> {
    GitRefManager::delete_ref(fs, gitdir, ref_name)
}

pub fn list_refs(fs: &MemoryFs, gitdir: &str, filepath: &str) -> Vec<String> {
    GitRefManager::list_refs(fs, gitdir, filepath)
}

pub fn list_tags(fs: &MemoryFs, gitdir: &str) -> Vec<String> {
    GitRefManager::list_tags(fs, gitdir)
}

pub fn list_branches(fs: &MemoryFs, gitdir: &str, remote: Option<&str>) -> Vec<String> {
    GitRefManager::list_branches(fs, gitdir, remote)
}

pub fn current_branch(
    fs: &MemoryFs,
    gitdir: &str,
    fullname: bool,
    test: bool,
) -> Result<Option<String>, GitError> {
    let Ok(ref_target) = GitRefManager::resolve(fs, gitdir, "HEAD", Some(2)) else {
        return Ok(None);
    };
    if test && GitRefManager::resolve(fs, gitdir, "HEAD", None).is_err() {
        return Ok(None);
    }
    if !ref_target.starts_with("refs/") {
        return Ok(None);
    }
    if fullname {
        Ok(Some(ref_target))
    } else {
        Ok(Some(
            ref_target
                .strip_prefix("refs/heads/")
                .unwrap_or(&ref_target)
                .to_string(),
        ))
    }
}

pub fn is_ignored(fs: &MemoryFs, dir: &str, gitdir: Option<&str>, filepath: &str) -> bool {
    GitIgnoreManager::is_ignored(fs, dir, gitdir, filepath)
}

pub use commands::*;
pub use cli::*;
pub use http::{GitHttpRequest, GitHttpResponse, HttpClient, MockHttpServer};

mod cli_rebase;
mod cli_blame;
mod cli_date;
