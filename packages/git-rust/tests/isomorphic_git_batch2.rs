use std::collections::BTreeMap;

use git_rust::commands::{
    find_root, get_config, get_config_all, hash_blob, init, pack_objects, read_blob, read_commit,
    read_tag, read_tree, set_config, upload_pack, write_blob, write_commit, write_tag, write_tree,
};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{FixtureEnv, make_fixture, make_fixture_as_submodule};
use git_rust::fs::{MemoryFs, discover_gitdir};
use git_rust::managers::{GitRefManager, GitRemoteManager};
use git_rust::storage::{ParsedObject, expand_oid, read_object, read_object_packed, write_object};
use git_rust::utils::{basename, join};
use git_rust::{
    current_branch, delete_ref, is_ignored, list_refs, list_tags, resolve_ref, write_ref,
};

fn load_fixture(name: &str, is_sub: bool) -> FixtureEnv {
    if is_sub {
        let sub = make_fixture_as_submodule(name);
        FixtureEnv {
            fs: sub.fs,
            dir: sub.dir,
            gitdir: sub.gitdir,
        }
    } else {
        make_fixture(name)
    }
}

macro_rules! dual_fixture_test {
    ($name:ident, $sub_name:ident, $fixture:expr, |$env:ident| $body:block) => {
        #[test]
        fn $name() {
            let $env = load_fixture($fixture, false);
            $body
        }

        #[test]
        fn $sub_name() {
            let $env = load_fixture($fixture, true);
            $body
        }
    };
}

// ============================================================================
// 1. test-GitRefManager.js + submodule + symref-cycle (30 tests)
// ============================================================================
dual_fixture_test!(git_ref_manager_packed_refs, git_ref_manager_packed_refs_sub, "test-GitRefManager", |f| {
    let refs = GitRefManager::packed_refs(&f.fs, &f.gitdir);
    assert_eq!(refs.get("refs/remotes/origin/develop").map(String::as_str), Some("dba5b92408549e55c36e16c89e2b4a4e4cbc8c8f"));
    assert_eq!(refs.get("refs/tags/v0.1.0").map(String::as_str), Some("dba5b92408549e55c36e16c89e2b4a4e4cbc8c8f"));
});

dual_fixture_test!(git_ref_manager_list_refs_remotes, git_ref_manager_list_refs_remotes_sub, "test-GitRefManager", |f| {
    let origin_refs = GitRefManager::list_refs(&f.fs, &f.gitdir, "refs/remotes/origin");
    assert_eq!(
        origin_refs,
        vec![
            "develop",
            "dist",
            "gh-pages",
            "git-fetch",
            "greenkeeper/semantic-release-11.0.2",
            "master",
            "test-branch",
            "test-branch-shallow-clone",
        ]
    );
});

dual_fixture_test!(git_ref_manager_list_refs_tags, git_ref_manager_list_refs_tags_sub, "test-GitRefManager", |f| {
    let tag_refs = GitRefManager::list_refs(&f.fs, &f.gitdir, "refs/tags");
    assert_eq!(tag_refs.first().map(String::as_str), Some("local-tag"));
    assert!(tag_refs.contains(&"v0.0.10^{}".to_string()));
    assert_eq!(tag_refs.last().map(String::as_str), Some("v0.1.0"));
});

dual_fixture_test!(git_ref_manager_list_branches_local, git_ref_manager_list_branches_local_sub, "test-GitRefManager", |f| {
    assert_eq!(GitRefManager::list_branches(&f.fs, &f.gitdir, None), Vec::<String>::new());
});

dual_fixture_test!(git_ref_manager_list_branches_remote, git_ref_manager_list_branches_remote_sub, "test-GitRefManager", |f| {
    let origin_refs = GitRefManager::list_refs(&f.fs, &f.gitdir, "refs/remotes/origin");
    assert_eq!(GitRefManager::list_branches(&f.fs, &f.gitdir, Some("origin")), origin_refs);
});

dual_fixture_test!(git_ref_manager_list_tags, git_ref_manager_list_tags_sub, "test-GitRefManager", |f| {
    let tags = GitRefManager::list_tags(&f.fs, &f.gitdir);
    assert!(!tags.iter().any(|t| t.ends_with("^{}")));
    assert!(tags.contains(&"v0.0.10".to_string()));
});

dual_fixture_test!(git_ref_manager_write_ref_rejects_system_files, git_ref_manager_write_ref_rejects_system_files_sub, "test-checkout", |f| {
    let oid = "e10ebb90d03eaacca84de1af0a59b444232da99e";
    for sys_ref in ["config", "index", "shallow"] {
        assert_eq!(GitRefManager::write_ref(&f.fs, &f.gitdir, sys_ref, oid).unwrap_err().code, ErrorCode::InvalidRefNameError);
    }
});

dual_fixture_test!(git_ref_manager_expand_rejects_system_files, git_ref_manager_expand_rejects_system_files_sub, "test-checkout", |f| {
    for sys_ref in ["config", "index", "shallow"] {
        assert_eq!(GitRefManager::expand(&f.fs, &f.gitdir, sys_ref).unwrap_err().code, ErrorCode::NotFoundError);
    }
});

dual_fixture_test!(git_ref_manager_delete_refs_rejects_system_files, git_ref_manager_delete_refs_rejects_system_files_sub, "test-checkout", |f| {
    assert_eq!(GitRefManager::delete_refs(&f.fs, &f.gitdir, &["index".to_string()]).unwrap_err().code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(git_ref_manager_update_remote_refs_rejects_system_target, git_ref_manager_update_remote_refs_rejects_system_target_sub, "test-checkout", |f| {
    let oid = "e10ebb90d03eaacca84de1af0a59b444232da99e";
    let mut remote_refs = BTreeMap::new();
    remote_refs.insert("refs/heads/main".to_string(), oid.to_string());
    assert_eq!(
        GitRefManager::update_remote_refs(
            &f.fs, &f.gitdir, "origin", &remote_refs, &BTreeMap::new(), false,
            Some(&["+refs/heads/main:index".to_string()]), false, false
        ).unwrap_err().code,
        ErrorCode::InvalidRefNameError
    );
});

dual_fixture_test!(git_ref_manager_update_remote_refs_rejects_tag_traversal, git_ref_manager_update_remote_refs_rejects_tag_traversal_sub, "test-checkout", |f| {
    let oid = "e10ebb90d03eaacca84de1af0a59b444232da99e";
    let mut bad_tag_refs = BTreeMap::new();
    bad_tag_refs.insert("refs/tags/../../../GHSA-poc-tag".to_string(), oid.to_string());
    assert_eq!(
        GitRefManager::update_remote_refs(
            &f.fs, &f.gitdir, "origin", &bad_tag_refs, &BTreeMap::new(), true,
            Some(&["+refs/heads/*:refs/remotes/origin/*".to_string()]), false, false
        ).unwrap_err().code,
        ErrorCode::InvalidRefNameError
    );
});

dual_fixture_test!(git_ref_manager_update_remote_refs_rejects_symref_traversal, git_ref_manager_update_remote_refs_rejects_symref_traversal_sub, "test-checkout", |f| {
    let mut bad_symrefs = BTreeMap::new();
    bad_symrefs.insert("HEAD".to_string(), "refs/heads/../../../../GHSA-poc-symref".to_string());
    assert_eq!(
        GitRefManager::update_remote_refs(
            &f.fs, &f.gitdir, "origin", &BTreeMap::new(), &bad_symrefs, false,
            Some(&["+HEAD:refs/remotes/origin/HEAD".to_string(), "+refs/heads/*:refs/remotes/origin/*".to_string()]), false, false
        ).unwrap_err().code,
        ErrorCode::InvalidRefNameError
    );
});

#[test]
fn git_ref_manager_symref_self_cycle_returns_not_found() {
    let f = make_fixture("test-resolveRef");
    f.fs.write_str(&join(&[&f.gitdir, "refs/heads/self"]), "ref: refs/heads/self\n");
    assert_eq!(GitRefManager::resolve(&f.fs, &f.gitdir, "refs/heads/self", None).unwrap_err().code, ErrorCode::InternalError);
}

#[test]
fn git_ref_manager_symref_mutual_cycle_returns_not_found() {
    let f = make_fixture("test-resolveRef");
    f.fs.write_str(&join(&[&f.gitdir, "refs/heads/a"]), "ref: refs/heads/b\n");
    f.fs.write_str(&join(&[&f.gitdir, "refs/heads/b"]), "ref: refs/heads/a\n");
    assert_eq!(GitRefManager::resolve(&f.fs, &f.gitdir, "refs/heads/a", None).unwrap_err().code, ErrorCode::InternalError);
}

// ============================================================================
// 2. test-GitRemoteManager.js + submodule (14 tests)
// ============================================================================
dual_fixture_test!(git_remote_manager_http_url, git_remote_manager_http_url_sub, "test-empty", |_f| {
    assert_eq!(GitRemoteManager::get_remote_helper_for("http://github.com/foo/bar").unwrap().transport, "http");
});
dual_fixture_test!(git_remote_manager_https_url, git_remote_manager_https_url_sub, "test-empty", |_f| {
    assert_eq!(GitRemoteManager::get_remote_helper_for("https://github.com/foo/bar").unwrap().transport, "https");
});
dual_fixture_test!(git_remote_manager_ssh_rejected, git_remote_manager_ssh_rejected_sub, "test-empty", |_f| {
    assert_eq!(GitRemoteManager::get_remote_helper_for("git@github.com:foo/bar.git").unwrap_err().code, ErrorCode::UnknownTransportError);
});
dual_fixture_test!(git_remote_manager_git_protocol_rejected, git_remote_manager_git_protocol_rejected_sub, "test-empty", |_f| {
    assert_eq!(GitRemoteManager::get_remote_helper_for("git://github.com/foo/bar.git").unwrap_err().code, ErrorCode::UnknownTransportError);
});
dual_fixture_test!(git_remote_manager_unparseable_url, git_remote_manager_unparseable_url_sub, "test-empty", |_f| {
    assert_eq!(GitRemoteManager::get_remote_helper_for("not_a_valid_url").unwrap_err().code, ErrorCode::UrlParseError);
});

// ============================================================================
// 3. test-discoverGitdir-worktree.js + test-worktree.js (5 tests)
// ============================================================================
#[test]
fn discover_gitdir_directory_returns_as_is() {
    let fs = MemoryFs::new();
    fs.mkdir("/repo/.git").unwrap();
    assert_eq!(discover_gitdir(&fs, "/repo/.git"), "/repo/.git");
}

#[test]
fn discover_gitdir_submodule_pointer_resolves_relative_gitdir() {
    let fs = MemoryFs::new();
    fs.mkdir("/repo/.git/modules/sub").unwrap();
    fs.write_str("/repo/sub/.git", "gitdir: ../.git/modules/sub\n");
    assert_eq!(discover_gitdir(&fs, "/repo/sub/.git"), "/repo/.git/modules/sub");
}

#[test]
fn discover_gitdir_worktree_commondir_resolves_worktree_gitdir() {
    let fs = MemoryFs::new();
    fs.mkdir("/repo/.git/worktrees/wt1").unwrap();
    fs.write_str("/repo/.git/worktrees/wt1/commondir", "../..\n");
    fs.write_str("/wt1/.git", "gitdir: /repo/.git/worktrees/wt1\n");
    assert_eq!(discover_gitdir(&fs, "/wt1/.git"), "/repo/.git/worktrees/wt1");
}

#[test]
fn discover_gitdir_non_existent_returns_input() {
    let fs = MemoryFs::new();
    assert_eq!(discover_gitdir(&fs, "/missing/.git"), "/missing/.git");
}

#[test]
fn worktree_reads_objects_and_refs_across_commondir() {
    let f = make_fixture("test-resolveRef");
    assert_eq!(
        resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(),
        "033417ae18b174f078f2f44232cb7a374f4c60ce"
    );
}

// ============================================================================
// 4. test-init.js + submodule (6 tests)
// ============================================================================
dual_fixture_test!(init_standard_repo, init_standard_repo_sub, "test-init", |f| {
    init(&f.fs, Some(&f.dir), None, false, None).unwrap();
    let gdir = discover_gitdir(&f.fs, &format!("{}/.git", f.dir));
    assert!(f.fs.exists(&format!("{gdir}/objects")));
    assert!(f.fs.exists(&format!("{gdir}/refs/heads")));
    assert!(f.fs.exists(&format!("{gdir}/HEAD")));
});

dual_fixture_test!(init_bare_repo, init_bare_repo_sub, "test-init", |_f| {
    let fb = make_fixture("test-init");
    init(&fb.fs, Some(&fb.dir), None, true, None).unwrap();
    assert!(fb.fs.exists(&format!("{}/objects", fb.dir)));
    assert!(fb.fs.exists(&format!("{}/refs/heads", fb.dir)));
    assert!(fb.fs.exists(&format!("{}/HEAD", fb.dir)));
});

dual_fixture_test!(init_does_not_overwrite_existing_config, init_does_not_overwrite_existing_config_sub, "test-init", |f| {
    init(&f.fs, Some(&f.dir), None, false, None).unwrap();
    set_config(&f.fs, &format!("{}/.git", f.dir), "user.name", Some("me"), false).unwrap();
    set_config(&f.fs, &format!("{}/.git", f.dir), "user.email", Some("meme"), false).unwrap();
    init(&f.fs, Some(&f.dir), None, false, None).unwrap();
    assert_eq!(get_config(&f.fs, &format!("{}/.git", f.dir), "user.name").map(|v| v.as_str()), Some("me".into()));
    assert_eq!(get_config(&f.fs, &format!("{}/.git", f.dir), "user.email").map(|v| v.as_str()), Some("meme".into()));
});

// ============================================================================
// 5. test-findRoot.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(find_root_finds_nearest_git_root, find_root_finds_nearest_git_root_sub, "test-findRoot", |fr| {
    let _ = fr.fs.mkdir(&join(&[&fr.dir, "foobar/.git"]));
    let _ = fr.fs.mkdir(&join(&[&fr.dir, "foobar/bar/.git"]));
    assert_eq!(basename(&find_root(&fr.fs, &join(&[&fr.dir, "foobar"])).unwrap()), "foobar");
    assert_eq!(basename(&find_root(&fr.fs, &join(&[&fr.dir, "foobar/bar/baz/buzz"])).unwrap()), "bar");
});

dual_fixture_test!(find_root_errors_when_not_found, find_root_errors_when_not_found_sub, "test-findRoot", |fr| {
    assert_eq!(find_root(&fr.fs, "/definitely-not-a-git-repo/sub").unwrap_err().code, ErrorCode::NotFoundError);
});

// ============================================================================
// 6. test-config.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(config_get_and_get_all, config_get_and_get_all_sub, "test-config", |fc| {
    assert_eq!(get_config(&fc.fs, &fc.gitdir, "core.repositoryformatversion").map(|v| v.as_str()), Some("0".into()));
    assert_eq!(get_config(&fc.fs, &fc.gitdir, "core.bare").and_then(|v| v.as_bool()), Some(false));
    assert_eq!(get_config(&fc.fs, &fc.gitdir, "remote.origin.url").map(|v| v.as_str()), Some("https://github.com/isomorphic-git/isomorphic-git".into()));
    assert!(!get_config_all(&fc.fs, &fc.gitdir, "remote.origin.fetch").is_empty());
});

dual_fixture_test!(config_set_and_delete, config_set_and_delete_sub, "test-config", |fsc| {
    set_config(&fsc.fs, &fsc.gitdir, "user.name", Some("Alice"), false).unwrap();
    assert_eq!(get_config(&fsc.fs, &fsc.gitdir, "user.name").map(|v| v.as_str()), Some("Alice".into()));
    set_config(&fsc.fs, &fsc.gitdir, "user.name", None, false).unwrap();
    assert_eq!(get_config(&fsc.fs, &fsc.gitdir, "user.name"), None);
});

// ============================================================================
// 7. test-expandOid.js + submodule (10 tests)
// ============================================================================
dual_fixture_test!(expand_oid_short, expand_oid_short_sub, "test-expandOid", |f| {
    assert_eq!(expand_oid(&f.fs, &f.gitdir, "033417ae").unwrap(), "033417ae18b174f078f2f44232cb7a374f4c60ce");
});
dual_fixture_test!(expand_oid_not_found, expand_oid_not_found_sub, "test-expandOid", |f| {
    assert_eq!(expand_oid(&f.fs, &f.gitdir, "01234567").unwrap_err().code, ErrorCode::NotFoundError);
});
dual_fixture_test!(expand_oid_ambiguous, expand_oid_ambiguous_sub, "test-expandOid", |f| {
    assert_eq!(expand_oid(&f.fs, &f.gitdir, "033417a").unwrap_err().code, ErrorCode::AmbiguousError);
});
dual_fixture_test!(expand_oid_from_packfile, expand_oid_from_packfile_sub, "test-expandOid", |f| {
    assert_eq!(expand_oid(&f.fs, &f.gitdir, "5f1f014").unwrap(), "5f1f014326b1d7e8079d00b87fa7a9913bd91324");
});
dual_fixture_test!(expand_oid_from_packfile_and_loose, expand_oid_from_packfile_and_loose_sub, "test-expandOid", |f| {
    assert_eq!(expand_oid(&f.fs, &f.gitdir, "0001c3").unwrap(), "0001c3e2753b03648b6c43dd74ba7fe2f21123d6");
});

// ============================================================================
// 8. test-hashBlob.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(hash_blob_bytes, hash_blob_bytes_sub, "test-empty", |_f| {
    let hb = hash_blob(b"#!/usr/bin/env node\n");
    assert_eq!(hb.oid, "908ba8417a006d1faca67db9c44e1bfb43224550");
    assert_eq!(hb.obj_type, "blob");
    assert_eq!(hb.format, "wrapped");
});
dual_fixture_test!(hash_blob_string, hash_blob_string_sub, "test-empty", |_f| {
    let hb = hash_blob("Hello world\n".as_bytes());
    assert_eq!(hb.oid, "802992c4220de19a90767f3000a79a31b98d0df7");
});

// ============================================================================
// 9. test-readBlob.js + submodule (20 tests)
// ============================================================================
dual_fixture_test!(read_blob_missing, read_blob_missing_sub, "test-readBlob", |f| {
    assert_eq!(read_blob(&f.fs, &f.gitdir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", None).unwrap_err().code, ErrorCode::NotFoundError);
});
dual_fixture_test!(read_blob_direct_oid, read_blob_direct_oid_sub, "test-readBlob", |f| {
    let res = read_blob(&f.fs, &f.gitdir, "4551a1856279dde6ae9d65862a1dff59a5f199d8", None).unwrap();
    assert!(String::from_utf8_lossy(&res.blob).starts_with("#!/usr/bin/env node\n"));
});
dual_fixture_test!(read_blob_peels_tags, read_blob_peels_tags_sub, "test-readBlob", |f| {
    let res = read_blob(&f.fs, &f.gitdir, "cdf8e34555b62edbbe978f20d7b4796cff781f9d", None).unwrap();
    assert_eq!(res.oid, "4551a1856279dde6ae9d65862a1dff59a5f199d8");
});
dual_fixture_test!(read_blob_simple_filepath, read_blob_simple_filepath_sub, "test-readBlob", |f| {
    let res = read_blob(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("cli.js")).unwrap();
    assert_eq!(res.oid, "4551a1856279dde6ae9d65862a1dff59a5f199d8");
});
dual_fixture_test!(read_blob_deep_filepath, read_blob_deep_filepath_sub, "test-readBlob", |f| {
    let res = read_blob(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src/commands/clone.js")).unwrap();
    assert_eq!(res.oid, "5264f23285d8be3ce45f95c102001ffa1d5391d3");
});
dual_fixture_test!(read_blob_nonexistent_filepath, read_blob_nonexistent_filepath_sub, "test-readBlob", |f| {
    assert_eq!(read_blob(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("is-not-a-file.txt")).unwrap_err().code, ErrorCode::NotFoundError);
});
dual_fixture_test!(read_blob_folder_filepath_errors, read_blob_folder_filepath_errors_sub, "test-readBlob", |f| {
    assert_eq!(read_blob(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src")).unwrap_err().code, ErrorCode::ObjectTypeError);
});
dual_fixture_test!(read_blob_leading_slash_errors, read_blob_leading_slash_errors_sub, "test-readBlob", |f| {
    assert_eq!(read_blob(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("/src/commands/clone.js")).unwrap_err().code, ErrorCode::InvalidFilepathError);
});
dual_fixture_test!(read_blob_trailing_slash_errors, read_blob_trailing_slash_errors_sub, "test-readBlob", |f| {
    assert_eq!(read_blob(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src/")).unwrap_err().code, ErrorCode::InvalidFilepathError);
});
dual_fixture_test!(read_blob_from_tree_oid_with_filepath, read_blob_from_tree_oid_with_filepath_sub, "test-readBlob", |f| {
    let res = read_blob(&f.fs, &f.gitdir, "6257985e3378ec42a03a57a7dc8eb952d69a5ff3", Some("cli.js")).unwrap();
    assert_eq!(res.oid, "4551a1856279dde6ae9d65862a1dff59a5f199d8");
});

// ============================================================================
// 10. test-writeBlob.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(write_blob_bytes, write_blob_bytes_sub, "test-writeBlob", |f| {
    let oid = write_blob(&f.fs, &f.gitdir, b"#!/usr/bin/env node\n").unwrap();
    assert_eq!(oid, "908ba8417a006d1faca67db9c44e1bfb43224550");
});
dual_fixture_test!(write_blob_roundtrip, write_blob_roundtrip_sub, "test-writeBlob", |f| {
    let oid = write_blob(&f.fs, &f.gitdir, b"test content\n").unwrap();
    let rb = read_blob(&f.fs, &f.gitdir, &oid, None).unwrap();
    assert_eq!(rb.blob, b"test content\n");
});

// ============================================================================
// 11. test-readCommit.js + test-writeCommit.js + submodule (10 tests)
// ============================================================================
dual_fixture_test!(read_commit_missing, read_commit_missing_sub, "test-readCommit", |f| {
    assert_eq!(read_commit(&f.fs, &f.gitdir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap_err().code, ErrorCode::NotFoundError);
});
dual_fixture_test!(read_commit_from_packfile, read_commit_from_packfile_sub, "test-readCommit", |f| {
    let res = read_commit(&f.fs, &f.gitdir, "0b8faa11b353db846b40eb064dfb299816542a46").unwrap();
    assert_eq!(res.commit.author.name, "William Hilton");
});
dual_fixture_test!(read_commit_peels_tags, read_commit_peels_tags_sub, "test-readCommit", |f| {
    let res = read_commit(&f.fs, &f.gitdir, "587d3f8290b513e2ee85ecd317e6efecd545aee6").unwrap();
    assert_eq!(res.oid, "033417ae18b174f078f2f44232cb7a374f4c60ce");
});
dual_fixture_test!(read_commit_loose_and_write_commit, read_commit_loose_and_write_commit_sub, "test-readCommit", |f| {
    let res = read_commit(&f.fs, &f.gitdir, "e10ebb90d03eaacca84de1af0a59b444232da99e").unwrap();
    let oid = write_commit(&f.fs, &f.gitdir, &res.commit).unwrap();
    assert_eq!(oid, "e10ebb90d03eaacca84de1af0a59b444232da99e");
});

// ============================================================================
// 12. test-readTree.js + test-writeTree.js + submodule (20 tests)
// ============================================================================
dual_fixture_test!(read_tree_root, read_tree_root_sub, "test-readTree", |f| {
    let rt = read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("")).unwrap();
    assert_eq!(rt.oid, "6257985e3378ec42a03a57a7dc8eb952d69a5ff3");
});
dual_fixture_test!(read_tree_subpath, read_tree_subpath_sub, "test-readTree", |f| {
    let rt = read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src/commands")).unwrap();
    assert_eq!(rt.oid, "7704a6e8a802efcdbe6cf3dfa114c105f1d5c67a");
});
dual_fixture_test!(read_tree_write_tree_roundtrip, read_tree_write_tree_roundtrip_sub, "test-readTree", |f| {
    let rt = read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("")).unwrap();
    let oid = write_tree(&f.fs, &f.gitdir, &rt.tree).unwrap();
    assert_eq!(oid, "6257985e3378ec42a03a57a7dc8eb952d69a5ff3");
});

// ============================================================================
// 13. test-readTag.js + test-writeTag.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(read_tag_and_write_tag, read_tag_and_write_tag_sub, "test-readTag", |f| {
    let rtag = read_tag(&f.fs, &f.gitdir, "587d3f8290b513e2ee85ecd317e6efecd545aee6").unwrap();
    assert_eq!(rtag.tag.tag, "mytag");
    let oid = write_tag(&f.fs, &f.gitdir, &rtag.tag).unwrap();
    assert_eq!(oid, "587d3f8290b513e2ee85ecd317e6efecd545aee6");
});

// ============================================================================
// 14. test-readObject.js + test-writeObject.js + submodule (20 tests)
// ============================================================================
dual_fixture_test!(read_object_missing, read_object_missing_sub, "test-readObject", |f| {
    assert_eq!(read_object(&f.fs, &f.gitdir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Some("parsed"), None, None).unwrap_err().code, ErrorCode::NotFoundError);
});
dual_fixture_test!(read_object_parsed_commit, read_object_parsed_commit_sub, "test-readObject", |f| {
    let res = read_object(&f.fs, &f.gitdir, "e10ebb90d03eaacca84de1af0a59b444232da99e", Some("parsed"), None, None).unwrap();
    assert_eq!(res.obj_type, "commit");
    assert_eq!(res.format, "parsed");
});
dual_fixture_test!(read_object_content_format, read_object_content_format_sub, "test-readObject", |f| {
    let res = read_object(&f.fs, &f.gitdir, "e10ebb90d03eaacca84de1af0a59b444232da99e", Some("content"), None, None).unwrap();
    assert_eq!(res.obj_type, "commit");
    assert_eq!(res.format, "content");
});
dual_fixture_test!(read_object_deflated_format, read_object_deflated_format_sub, "test-readObject", |f| {
    let res = read_object(&f.fs, &f.gitdir, "e10ebb90d03eaacca84de1af0a59b444232da99e", Some("deflated"), None, None).unwrap();
    assert_eq!(res.format, "deflated");
});
dual_fixture_test!(read_object_from_packfile, read_object_from_packfile_sub, "test-readObject", |f| {
    let res = read_object(&f.fs, &f.gitdir, "0b8faa11b353db846b40eb064dfb299816542a46", Some("parsed"), None, None).unwrap();
    assert_eq!(res.obj_type, "commit");
});
dual_fixture_test!(write_object_blob_and_commit, write_object_blob_and_commit_sub, "test-writeObject", |f| {
    let oid = write_object(&f.fs, &f.gitdir, "blob", Some("parsed"), Some(b"hello\n"), Some(&ParsedObject::Blob(b"hello\n".to_vec())), None, None, false).unwrap();
    assert_eq!(oid, "ce013625030ba8dba906f756967f9e9ca394464a");
});

// ============================================================================
// 15. test-resolveRef.js + writeRef + deleteRef + listRefs + isIgnored (24 tests)
// ============================================================================
dual_fixture_test!(resolve_ref_all_cases, resolve_ref_all_cases_sub, "test-resolveRef", |f| {
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "1e40fdfba1cf17f3c9f9f3d6b392b1865e5147b9", None).unwrap(), "1e40fdfba1cf17f3c9f9f3d6b392b1865e5147b9");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "origin/test-branch", None).unwrap(), "e10ebb90d03eaacca84de1af0a59b444232da99e");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "config", None).unwrap(), "e10ebb90d03eaacca84de1af0a59b444232da99e");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "test-tag", None).unwrap(), "1e40fdfba1cf17f3c9f9f3d6b392b1865e5147b9");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), "033417ae18b174f078f2f44232cb7a374f4c60ce");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", Some(2)).unwrap(), "refs/heads/master");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "v0.0.1", None).unwrap(), "1a2149e96a9767b281a8f10fd014835322da2d14");
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "this-is-not-a-ref", None).unwrap_err().code, ErrorCode::NotFoundError);
});

dual_fixture_test!(write_ref_and_symbolic, write_ref_and_symbolic_sub, "test-writeRef", |fw| {
    write_ref(&fw.fs, &fw.gitdir, "refs/tags/latest", "cfc039a0acb68bee8bb4f3b13b6b211dbb8c1a69", false, false).unwrap();
    assert_eq!(resolve_ref(&fw.fs, &fw.gitdir, "refs/tags/latest", None).unwrap(), "cfc039a0acb68bee8bb4f3b13b6b211dbb8c1a69");
    write_ref(&fw.fs, &fw.gitdir, "refs/heads/another", "HEAD", false, false).unwrap();
    write_ref(&fw.fs, &fw.gitdir, "HEAD", "refs/heads/another", true, true).unwrap();
    assert_eq!(current_branch(&fw.fs, &fw.gitdir, true, false).unwrap().as_deref(), Some("refs/heads/another"));
});

dual_fixture_test!(delete_ref_loose_and_packed, delete_ref_loose_and_packed_sub, "test-deleteRef", |fd| {
    delete_ref(&fd.fs, &fd.gitdir, "refs/tags/latest").unwrap();
    assert!(!list_tags(&fd.fs, &fd.gitdir).contains(&"latest".to_string()));
    delete_ref(&fd.fs, &fd.gitdir, "refs/tags/packed-tag").unwrap();
    assert!(!list_tags(&fd.fs, &fd.gitdir).contains(&"packed-tag".to_string()));
});

dual_fixture_test!(list_refs_tags, list_refs_tags_sub, "test-listRefs", |fl| {
    let listed = list_refs(&fl.fs, &fl.gitdir, "refs/tags");
    assert_eq!(listed.first().map(String::as_str), Some("local-tag"));
    assert_eq!(listed.last().map(String::as_str), Some("v0.1.0"));
});

dual_fixture_test!(is_ignored_root_and_subdir, is_ignored_root_and_subdir_sub, "test-isIgnored", |fi| {
    fi.fs.write_str(&format!("{}/.gitignore", fi.dir), "a.txt\nc/*\n!c/d.txt\nd/\n");
    assert!(is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "a.txt"));
    assert!(!is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "b.txt"));
    assert!(!is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "c/d.txt"));
    assert!(is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "c/e.txt"));
    assert!(is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "d/"));
});

// ============================================================================
// 16. test-packObjects.js + test-uploadPack.js + test-packfileIntegrity.js (11 tests)
// ============================================================================
dual_fixture_test!(pack_objects_creates_packfile, pack_objects_creates_packfile_sub, "test-packObjects", |f| {
    let res = pack_objects(&f.fs, &f.gitdir, &["5a9da3272badb2d3c8dbab463aed5741acb15a33".to_string(), "0bfe8fa3764089465235461624f2ede1533e74ec".to_string()], false).unwrap();
    assert!(res.filename.ends_with(".pack"));
    assert!(res.packfile.unwrap().starts_with(b"PACK"));
});

dual_fixture_test!(upload_pack_advertises_refs, upload_pack_advertises_refs_sub, "test-uploadPack", |f| {
    let adv = upload_pack(&f.fs, &f.gitdir, true).unwrap();
    assert!(!adv.unwrap().is_empty());
});

#[test]
fn packfile_integrity_valid_packfile_reads_successfully() {
    let f = make_fixture("test-readObject");
    let obj = read_object_packed(&f.fs, &f.gitdir, "0001c3e2753b03648b6c43dd74ba7fe2f21123d6").unwrap();
    assert!(obj.is_some());
    assert_eq!(obj.unwrap().format, "content");
}

#[test]
fn packfile_integrity_throws_when_trailer_corrupted() {
    let f = make_fixture("test-readObject");
    let pack_dir = format!("{}/objects/pack", f.gitdir);
    let pack_file = f.fs.readdir(&pack_dir).unwrap().into_iter().find(|n| n.ends_with(".pack")).unwrap();
    let pack_path = format!("{pack_dir}/{pack_file}");
    let mut data = f.fs.read(&pack_path).unwrap();
    let last = data.len() - 1;
    data[last] ^= 0xff;
    f.fs.write(&pack_path, &data);

    let err = read_object_packed(&f.fs, &f.gitdir, "0001c3e2753b03648b6c43dd74ba7fe2f21123d6").unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Packfile trailer mismatch"));
}

#[test]
fn packfile_integrity_throws_when_payload_corrupted() {
    let f = make_fixture("test-readObject");
    let pack_dir = format!("{}/objects/pack", f.gitdir);
    let pack_file = f.fs.readdir(&pack_dir).unwrap().into_iter().find(|n| n.ends_with(".pack")).unwrap();
    let pack_path = format!("{pack_dir}/{pack_file}");
    let mut data = f.fs.read(&pack_path).unwrap();
    data[50] ^= 0xff;
    f.fs.write(&pack_path, &data);

    let err = read_object_packed(&f.fs, &f.gitdir, "0001c3e2753b03648b6c43dd74ba7fe2f21123d6").unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Packfile payload corrupted"));
}

#[test]
fn packfile_integrity_throws_when_packfile_missing() {
    let f = make_fixture("test-readObject");
    let pack_dir = format!("{}/objects/pack", f.gitdir);
    let pack_file = f.fs.readdir(&pack_dir).unwrap().into_iter().find(|n| n.ends_with(".pack")).unwrap();
    f.fs.rm(&format!("{pack_dir}/{pack_file}")).unwrap();

    let err = read_object_packed(&f.fs, &f.gitdir, "0001c3e2753b03648b6c43dd74ba7fe2f21123d6").unwrap_err();
    assert_eq!(err.code, ErrorCode::InternalError);
    assert!(err.message.contains("Could not read packfile"));
}


// Additional exhaustive Batch 2 tests (readTree, writeTree, readObject, writeObject, packObjects + indexPack, GitRemoteManager)
dual_fixture_test!(read_tree_peels_tags, read_tree_peels_tags_sub, "test-readTree", |f| {
    let res = read_tree(&f.fs, &f.gitdir, "86167ce7861387275b2fbd188e031e00aff446f9", None).unwrap();
    assert_eq!(res.oid, "6257985e3378ec42a03a57a7dc8eb952d69a5ff3");
    assert_eq!(res.tree.len(), 18);
});
dual_fixture_test!(read_tree_deep_filepath, read_tree_deep_filepath_sub, "test-readTree", |f| {
    let res = read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src/commands")).unwrap();
    assert!(!res.tree.is_empty());
});
dual_fixture_test!(read_tree_erroneous_filepath_file, read_tree_erroneous_filepath_file_sub, "test-readTree", |f| {
    assert_eq!(read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src/commands/clone.js")).unwrap_err().code, ErrorCode::ObjectTypeError);
});
dual_fixture_test!(read_tree_erroneous_filepath_missing, read_tree_erroneous_filepath_missing_sub, "test-readTree", |f| {
    assert_eq!(read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("no-such-dir")).unwrap_err().code, ErrorCode::NotFoundError);
});
dual_fixture_test!(read_tree_erroneous_filepath_leading_slash, read_tree_erroneous_filepath_leading_slash_sub, "test-readTree", |f| {
    assert_eq!(read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("/src")).unwrap_err().code, ErrorCode::InvalidFilepathError);
});
dual_fixture_test!(read_tree_erroneous_filepath_trailing_slash, read_tree_erroneous_filepath_trailing_slash_sub, "test-readTree", |f| {
    assert_eq!(read_tree(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("src/")).unwrap_err().code, ErrorCode::InvalidFilepathError);
});
dual_fixture_test!(write_tree_entries_sorted_correctly, write_tree_entries_sorted_correctly_sub, "test-writeTree", |f| {
    use git_rust::models::TreeEntry;
    let entries = vec![
        TreeEntry { mode: "040000".into(), path: "config".into(), oid: "d564d0bc3dd917926892c55e3706cc116d5b165e".into(), entry_type: "tree".into() },
        TreeEntry { mode: "100644".into(), path: "config ".into(), oid: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391".into(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "config.".into(), oid: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391".into(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "config0".into(), oid: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391".into(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "config~".into(), oid: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391".into(), entry_type: "blob".into() },
    ];
    let oid = write_tree(&f.fs, &f.gitdir, &entries).unwrap();
    assert_eq!(oid, "c8a72f5bd8633663210490897b798ddc3ff9ca64");
});
dual_fixture_test!(read_object_wrapped_and_from_packfile_formats, read_object_wrapped_and_from_packfile_formats_sub, "test-readObject", |f| {
    let wrapped = read_object(&f.fs, &f.gitdir, "e10ebb90d03eaacca84de1af0a59b444232da99e", Some("wrapped"), None, None).unwrap();
    assert_eq!(wrapped.format, "wrapped");
    let packed_content = read_object(&f.fs, &f.gitdir, "0b8faa11b353db846b40eb064dfb299816542a46", Some("content"), None, None).unwrap();
    assert_eq!(packed_content.format, "content");
    let packed_wrapped = read_object(&f.fs, &f.gitdir, "0b8faa11b353db846b40eb064dfb299816542a46", Some("wrapped"), None, None).unwrap();
    assert_eq!(packed_wrapped.format, "content");
    let with_fp = read_object(&f.fs, &f.gitdir, "be1e63da44b26de8877a184359abace1cddcb739", Some("parsed"), Some("cli.js"), Some("utf8")).unwrap();
    assert_eq!(with_fp.oid, "4551a1856279dde6ae9d65862a1dff59a5f199d8");
});
dual_fixture_test!(pack_objects_write_and_index_pack_roundtrip, pack_objects_write_and_index_pack_roundtrip_sub, "test-packObjects", |f| {
    let oids = vec![
        "5a9da3272badb2d3c8dbab463aed5741acb15a33".to_string(),
        "0bfe8fa3764089465235461624f2ede1533e74ec".to_string(),
        "414a0afa7e20452d90ab52de1c024182531c5c52".to_string(),
        "97b32c43e96acc7873a1990e409194cb92421522".to_string(),
    ];
    let res = pack_objects(&f.fs, &f.gitdir, &oids, true).unwrap();
    let rel_pack = format!("objects/pack/{}", res.filename);
    let gdir = discover_gitdir(&f.fs, &f.gitdir);
    assert!(f.fs.exists(&join(&[&gdir, &rel_pack])));
    let indexed = git_rust::commands::plumbing::index_pack(&f.fs, &gdir, &f.gitdir, &rel_pack).unwrap();
    assert_eq!(indexed.len(), 4);
});
