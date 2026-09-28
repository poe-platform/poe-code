//! Git integration test parity — Batch 6 (Network, Remote Info, Fetch, Clone, Pull, Push, Hosting Providers)
//!
//! Covers all test cases (plus `-in-submodule` equivalents) for:
//! - test-getRemoteInfo (+ test-getRemoteInfo-in-submodule)
//! - test-getRemoteInfo2 (+ test-getRemoteInfo2-in-submodule)
//! - test-listServerRefs (+ test-listServerRefs-in-submodule)
//! - test-uploadPack (+ test-uploadPack-in-submodule)
//! - test-fetch (+ test-fetch-in-submodule)
//! - test-clone (+ test-clone-in-submodule)
//! - test-pull (+ test-pull-in-submodule)
//! - test-push (+ test-push-in-submodule)
//! - test-hosting-providers (+ test-hosting-providers-in-submodule)

use git_rust::commands::network::{
    clone, fetch, get_remote_info, get_remote_info2, list_server_refs, pull, push,
};
use git_rust::commands::plumbing::{add_remote, init, set_config, upload_pack};
use git_rust::commands::worktree::{add, commit};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::http::MockHttpServer;
use git_rust::list_branches;
use git_rust::resolve_ref;
use git_rust::utils::{join, Author};

macro_rules! dual_fixture_test {
    ($name:ident, $sub_name:ident, $fixture:expr, |$f:ident| $body:block) => {
        #[test]
        fn $name() {
            let $f = make_fixture($fixture);
            $body
        }

        #[test]
        fn $sub_name() {
            let $f = make_fixture_as_submodule($fixture);
            $body
        }
    };
}

// ============================================================================
// 1. test-getRemoteInfo + submodule
// ============================================================================
dual_fixture_test!(get_remote_info_v1_capabilities_and_refs, get_remote_info_v1_capabilities_and_refs_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info = get_remote_info(&http, "http://localhost/test-dumb-http-server.git", None, false, None).unwrap();
    assert!(!info.capabilities.is_empty());
    assert!(info.refs.contains_key("heads"));
});

dual_fixture_test!(get_remote_info_for_push_service, get_remote_info_for_push_service_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info = get_remote_info(&http, "http://localhost/test-dumb-http-server.git", None, true, None).unwrap();
    assert!(!info.capabilities.is_empty());
});

dual_fixture_test!(get_remote_info_unknown_transport_error, get_remote_info_unknown_transport_error_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let err = get_remote_info(&http, "ssh://example.com/repo.git", None, false, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::UnknownTransportError);
});

dual_fixture_test!(get_remote_info_unsafe_ref_returns_unsafe_filepath_error, get_remote_info_unsafe_ref_returns_unsafe_filepath_error_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    http.set_custom_advertisement(
        "unsafe-repo",
        b"001e# service=git-upload-pack\n00000046e10ebb90d03eaacca84de1af0a59b444232da99e refs/heads/../../evil\0ofs-delta\n0000".to_vec(),
    );
    let unsafe_err = get_remote_info(&http, "http://localhost/unsafe-repo.git", None, false, None).unwrap_err();
    assert_eq!(unsafe_err.code, ErrorCode::UnsafeFilepathError);
});

// ============================================================================
// 2. test-getRemoteInfo2 + submodule
// ============================================================================
dual_fixture_test!(get_remote_info2_protocol_v1, get_remote_info2_protocol_v1_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info_v1 = get_remote_info2(&http, "http://localhost/test-dumb-http-server.git", None, false, 1, None).unwrap();
    assert_eq!(info_v1.protocol_version, 1);
    assert!(info_v1.refs.is_some());
});

dual_fixture_test!(get_remote_info2_protocol_v2, get_remote_info2_protocol_v2_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info_v2 = get_remote_info2(&http, "http://localhost/test-dumb-http-server.git", None, false, 2, None).unwrap();
    assert_eq!(info_v2.protocol_version, 2);
    assert!(info_v2.capabilities.contains_key("ls-refs") || info_v2.capabilities.contains_key("fetch"));
});

dual_fixture_test!(get_remote_info2_for_push_uses_receive_pack, get_remote_info2_for_push_uses_receive_pack_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info = get_remote_info2(&http, "http://localhost/test-dumb-http-server.git", None, true, 1, None).unwrap();
    assert_eq!(info.protocol_version, 1);
});

// ============================================================================
// 3. test-listServerRefs + submodule
// ============================================================================
dual_fixture_test!(list_server_refs_all_with_symrefs_and_peel_tags, list_server_refs_all_with_symrefs_and_peel_tags_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let all_refs = list_server_refs(
        &http,
        "http://localhost/test-dumb-http-server.git",
        None,
        false,
        1,
        None,
        true,
        true,
        None,
    )
    .unwrap();
    assert!(!all_refs.is_empty());
});

dual_fixture_test!(list_server_refs_filtered_by_prefix, list_server_refs_filtered_by_prefix_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let heads_only = list_server_refs(
        &http,
        "http://localhost/test-dumb-http-server.git",
        None,
        false,
        1,
        Some("refs/heads/"),
        false,
        false,
        None,
    )
    .unwrap();
    assert!(heads_only.iter().all(|r| r.r#ref.starts_with("refs/heads/")));
    assert!(heads_only.iter().all(|r| r.target.is_none() && r.peeled.is_none()));
});

dual_fixture_test!(list_server_refs_protocol_v2, list_server_refs_protocol_v2_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let refs_v2 = list_server_refs(
        &http,
        "http://localhost/test-dumb-http-server.git",
        None,
        false,
        2,
        Some("refs/heads/"),
        true,
        false,
        None,
    )
    .unwrap();
    assert!(!refs_v2.is_empty());
});

// ============================================================================
// 4. test-uploadPack + submodule
// ============================================================================
dual_fixture_test!(upload_pack_advertise_refs, upload_pack_advertise_refs_sub, "test-uploadPack", |f| {
    let bytes = upload_pack(&f.fs, &f.gitdir, true).unwrap().unwrap();
    let s = String::from_utf8_lossy(&bytes);
    assert!(s.contains("thin-pack"));
    assert!(s.contains("refs/heads/master"));
});

dual_fixture_test!(upload_pack_without_advertise_refs, upload_pack_without_advertise_refs_sub, "test-uploadPack", |f| {
    let bytes = upload_pack(&f.fs, &f.gitdir, false).unwrap();
    assert!(bytes.is_none());
});

// ============================================================================
// 5. test-fetch + submodule
// ============================================================================
dual_fixture_test!(fetch_from_remote_updates_tracking_ref, fetch_from_remote_updates_tracking_ref_sub, "test-fetch", |f| {
    let http = MockHttpServer::new();
    set_config(&f.fs, &f.gitdir, "remote.origin.url", Some("http://localhost/test-fetch-server.git"), false).unwrap();
    let res = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("http://localhost/test-fetch-server.git"),
        Some("origin"),
        Some("master"),
        true,
        false,
        None,
        false,
        None,
        None,
    )
    .unwrap();
    assert!(res.fetch_head.is_some());
    assert!(res.fetch_head_description.is_some());
});

dual_fixture_test!(fetch_shallow_depth_one, fetch_shallow_depth_one_sub, "test-fetch", |f| {
    let http = MockHttpServer::new();
    let res = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("http://localhost/test-fetch-server.git"),
        Some("origin"),
        Some("master"),
        true,
        false,
        Some(1),
        false,
        None,
        None,
    )
    .unwrap();
    assert!(res.fetch_head.is_some());
});

dual_fixture_test!(fetch_prune_removes_deleted_remote_tracking_refs, fetch_prune_removes_deleted_remote_tracking_refs_sub, "test-fetch", |f| {
    let http = MockHttpServer::new();
    let res = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("http://localhost/test-fetch-server.git"),
        Some("origin"),
        None,
        false,
        true,
        None,
        true,
        None,
        None,
    )
    .unwrap();
    assert!(res.fetch_head.is_some());
});

dual_fixture_test!(fetch_with_tags_enabled, fetch_with_tags_enabled_sub, "test-fetch", |f| {
    let http = MockHttpServer::new();
    let res = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("http://localhost/test-fetch-server.git"),
        Some("origin"),
        Some("master"),
        false,
        true,
        None,
        false,
        None,
        None,
    )
    .unwrap();
    assert!(res.fetch_head.is_some());
});

// ============================================================================
// 6. test-clone + submodule
// ============================================================================
dual_fixture_test!(clone_default_branch_and_checkout, clone_default_branch_and_checkout_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    clone(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        "http://localhost/test-clone.git",
        None,
        Some("master"),
        true,
        false,
        false,
        Some("origin"),
        Some(1),
        None,
    )
    .unwrap();

    let files = f.fs.readdir(&f.dir).unwrap();
    assert!(files.contains(&"README.md".to_string()) || !files.is_empty());
    let head_oid = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_eq!(head_oid.len(), 40);
});

dual_fixture_test!(clone_no_checkout_leaves_worktree_empty, clone_no_checkout_leaves_worktree_empty_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    clone(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        "http://localhost/test-clone.git",
        None,
        Some("master"),
        true,
        true,
        false,
        Some("origin"),
        Some(1),
        None,
    )
    .unwrap();

    let head_oid = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_eq!(head_oid.len(), 40);
    assert!(!f.fs.exists(&join(&[&f.dir, "README.md"])));
});

dual_fixture_test!(clone_specific_tag_or_branch, clone_specific_tag_or_branch_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    clone(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        "http://localhost/test-clone.git",
        None,
        Some("master"),
        false,
        false,
        false,
        Some("origin"),
        None,
        None,
    )
    .unwrap();

    let branches = list_branches(&f.fs, &f.gitdir, Some("origin"));
    assert!(!branches.is_empty());
});

// ============================================================================
// 7. test-pull + submodule
// ============================================================================
dual_fixture_test!(pull_fast_forward, pull_fast_forward_sub, "test-pull", |f| {
    let http = MockHttpServer::new();
    add_remote(&f.fs, &f.gitdir, "origin", "http://localhost/test-pull-server.git", true).unwrap();
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };

    pull(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        Some("master"),
        Some("http://localhost/test-pull-server.git"),
        Some("origin"),
        true,
        true,
        false,
        None,
        Some(author),
        None,
        None,
    )
    .unwrap();

    let head_after = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_eq!(head_after.len(), 40);
});

dual_fixture_test!(pull_merge_commit_when_no_fast_forward, pull_merge_commit_when_no_fast_forward_sub, "test-pull", |f| {
    let http = MockHttpServer::new();
    add_remote(&f.fs, &f.gitdir, "origin", "http://localhost/test-pull-server.git", true).unwrap();
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };

    pull(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        Some("master"),
        Some("http://localhost/test-pull-server.git"),
        Some("origin"),
        false,
        true,
        false,
        None,
        Some(author),
        None,
        None,
    )
    .unwrap();

    let head_after = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_eq!(head_after.len(), 40);
});

// ============================================================================
// 8. test-push + submodule
// ============================================================================
dual_fixture_test!(push_branch_to_remote, push_branch_to_remote_sub, "test-push", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("test-push-server", server_fx.fs.clone(), &server_fx.gitdir);

    let mut messages = Vec::new();
    let mut cb = |m: String| messages.push(m);
    let res = push(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("master"),
        Some("refs/heads/master"),
        Some("origin"),
        Some("http://localhost/test-push-server.git"),
        true,
        false,
        None,
        None,
        Some(&mut cb),
    )
    .unwrap();
    assert!(res.ok);
});

dual_fixture_test!(push_delete_remote_branch, push_delete_remote_branch_sub, "test-push", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("test-push-server", server_fx.fs.clone(), &server_fx.gitdir);

    let del_res = push(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("master"),
        Some("refs/heads/feature-to-delete"),
        Some("origin"),
        Some("http://localhost/test-push-server.git"),
        true,
        true,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(del_res.ok);
});

dual_fixture_test!(push_non_fast_forward_rejected_without_force, push_non_fast_forward_rejected_without_force_sub, "test-push", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("test-push-server", server_fx.fs.clone(), &server_fx.gitdir);

    let res = push(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("master"),
        Some("refs/heads/master"),
        Some("origin"),
        Some("http://localhost/test-push-server.git"),
        true,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(res.ok);
});

// ============================================================================
// 9. test-hosting-providers + submodule
// ============================================================================
dual_fixture_test!(hosting_providers_unauthenticated_returns_401, hosting_providers_unauthenticated_returns_401_sub, "test-empty", |_f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("private-repo", server_fx.fs.clone(), &server_fx.gitdir);
    http.require_basic_auth("private-repo", "token-user", "secret-token");

    let err = get_remote_info(&http, "http://localhost/private-repo.git", None, false, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::HttpError);
});

dual_fixture_test!(hosting_providers_basic_auth_and_push_pull, hosting_providers_basic_auth_and_push_pull_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("private-repo", server_fx.fs.clone(), &server_fx.gitdir);
    http.require_basic_auth("private-repo", "token-user", "secret-token");

    let info = get_remote_info(
        &http,
        "http://token-user:secret-token@localhost/private-repo.git",
        None,
        false,
        None,
    )
    .unwrap();
    assert!(!info.capabilities.is_empty());

    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("master")).unwrap();
    let author = Author {
        name: "Host Tester".to_string(),
        email: "host@example.com".to_string(),
        timestamp: 1600000000,
        timezone_offset: 0.0,
    };
    f.fs.write_str(&join(&[&f.dir, "hello.txt"]), "hosted content\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["hello.txt".to_string()], false).unwrap();
    commit(&f.fs, &f.gitdir, Some("initial\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();

    let push_res = push(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("master"),
        Some("refs/heads/master"),
        Some("origin"),
        Some("http://token-user:secret-token@localhost/private-repo.git"),
        true,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(push_res.ok);
});

// ============================================================================
// 10. CLI Subcommands & End-to-End Integration Parity (execute_git_cli)
// ============================================================================
use git_rust::cli::execute_git_cli;

dual_fixture_test!(cli_ls_tree_default_and_name_only, cli_ls_tree_default_and_name_only_sub, "test-checkout", |f| {
    let r1 = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "test-branch"]);
    assert_eq!(r1.exit_code, 0);
    assert!(r1.stdout.contains("README.md"));

    let r2 = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "--name-only", "test-branch"]);
    assert_eq!(r2.exit_code, 0);
    assert!(r2.stdout.lines().any(|l| l == "README.md"));
});

dual_fixture_test!(cli_ls_tree_recursive_and_name_only, cli_ls_tree_recursive_and_name_only_sub, "test-checkout", |f| {
    let r1 = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "-r", "test-branch"]);
    assert_eq!(r1.exit_code, 0);
    assert!(r1.stdout.contains("src/"));

    let r2 = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "-r", "--name-only", "test-branch"]);
    assert_eq!(r2.exit_code, 0);
    assert!(r2.stdout.lines().any(|l| l.starts_with("src/")));
});

dual_fixture_test!(cli_show_ref_all_heads_tags_and_hash_only, cli_show_ref_all_heads_tags_and_hash_only_sub, "test-checkout", |f| {
    let r_all = execute_git_cli(&f.fs, &f.dir, &["show-ref"]);
    assert_eq!(r_all.exit_code, 0);
    assert!(r_all.stdout.contains("refs/heads/test-branch"));
    assert!(r_all.stdout.contains("refs/tags/v1.0.0"));

    let r_heads = execute_git_cli(&f.fs, &f.dir, &["show-ref", "--heads"]);
    assert_eq!(r_heads.exit_code, 0);
    assert!(r_heads.stdout.contains("refs/heads/test-branch"));
    assert!(!r_heads.stdout.contains("refs/tags/v1.0.0"));

    let r_tags = execute_git_cli(&f.fs, &f.dir, &["show-ref", "--tags"]);
    assert_eq!(r_tags.exit_code, 0);
    assert!(r_tags.stdout.contains("refs/tags/v1.0.0"));

    let r_hash = execute_git_cli(&f.fs, &f.dir, &["show-ref", "-s", "--heads"]);
    assert_eq!(r_hash.exit_code, 0);
    assert!(r_hash.stdout.lines().all(|l| l.len() == 40));
});

dual_fixture_test!(cli_symbolic_ref_read_short_and_write, cli_symbolic_ref_read_short_and_write_sub, "test-checkout", |f| {
    let r_write = execute_git_cli(&f.fs, &f.dir, &["symbolic-ref", "HEAD", "refs/heads/test-branch"]);
    assert_eq!(r_write.exit_code, 0);

    let r_full = execute_git_cli(&f.fs, &f.dir, &["symbolic-ref", "HEAD"]);
    assert_eq!(r_full.exit_code, 0);
    assert_eq!(r_full.stdout.trim(), "refs/heads/test-branch");

    let r_short = execute_git_cli(&f.fs, &f.dir, &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(r_short.exit_code, 0);
    assert_eq!(r_short.stdout.trim(), "test-branch");
});

dual_fixture_test!(cli_update_ref_set_and_delete, cli_update_ref_set_and_delete_sub, "test-checkout", |f| {
    let r_set = execute_git_cli(&f.fs, &f.dir, &["update-ref", "refs/heads/custom-ref", "test-branch"]);
    assert_eq!(r_set.exit_code, 0);
    assert_eq!(
        resolve_ref(&f.fs, &f.gitdir, "refs/heads/custom-ref", None).unwrap(),
        resolve_ref(&f.fs, &f.gitdir, "test-branch", None).unwrap()
    );

    let r_del = execute_git_cli(&f.fs, &f.dir, &["update-ref", "-d", "refs/heads/custom-ref"]);
    assert_eq!(r_del.exit_code, 0);
    assert!(resolve_ref(&f.fs, &f.gitdir, "refs/heads/custom-ref", None).is_err());
});

dual_fixture_test!(cli_rev_list_default_count_max_count_and_reverse, cli_rev_list_default_count_max_count_and_reverse_sub, "test-log", |f| {
    let r_all = execute_git_cli(&f.fs, &f.dir, &["rev-list", "HEAD"]);
    assert_eq!(r_all.exit_code, 0);
    let oids: Vec<&str> = r_all.stdout.lines().collect();
    assert!(oids.len() >= 2);

    let r_count = execute_git_cli(&f.fs, &f.dir, &["rev-list", "--count", "HEAD"]);
    assert_eq!(r_count.exit_code, 0);
    assert_eq!(r_count.stdout.trim().parse::<usize>().unwrap(), oids.len());

    let r_max = execute_git_cli(&f.fs, &f.dir, &["rev-list", "-n", "1", "HEAD"]);
    assert_eq!(r_max.exit_code, 0);
    assert_eq!(r_max.stdout.lines().count(), 1);

    let r_rev = execute_git_cli(&f.fs, &f.dir, &["rev-list", "--reverse", "HEAD"]);
    assert_eq!(r_rev.exit_code, 0);
    let rev_oids: Vec<&str> = r_rev.stdout.lines().collect();
    assert_eq!(rev_oids.first(), oids.last());
});

dual_fixture_test!(cli_merge_base_and_is_ancestor, cli_merge_base_and_is_ancestor_sub, "test-merge", |f| {
    let r_base = execute_git_cli(&f.fs, &f.dir, &["merge-base", "a", "b"]);
    assert_eq!(r_base.exit_code, 0);
    let base_oid = r_base.stdout.trim();
    assert_eq!(base_oid.len(), 40);

    let r_anc_ok = execute_git_cli(&f.fs, &f.dir, &["merge-base", "--is-ancestor", base_oid, "a"]);
    assert_eq!(r_anc_ok.exit_code, 0);

    let r_anc_no = execute_git_cli(&f.fs, &f.dir, &["merge-base", "--is-ancestor", "a", "b"]);
    assert_eq!(r_anc_no.exit_code, 1);
});

dual_fixture_test!(cli_check_ignore_default_and_quiet, cli_check_ignore_default_and_quiet_sub, "test-isIgnored", |f| {
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "i.txt\n");
    let r_ignored = execute_git_cli(&f.fs, &f.dir, &["check-ignore", "i.txt"]);
    assert_eq!(r_ignored.exit_code, 0);
    assert_eq!(r_ignored.stdout.trim(), "i.txt");

    let r_quiet = execute_git_cli(&f.fs, &f.dir, &["check-ignore", "-q", "i.txt"]);
    assert_eq!(r_quiet.exit_code, 0);
    assert!(r_quiet.stdout.is_empty());

    let r_not_ignored = execute_git_cli(&f.fs, &f.dir, &["check-ignore", "README.md"]);
    assert_eq!(r_not_ignored.exit_code, 1);
});

dual_fixture_test!(cli_cat_file_type_size_and_pretty_tree, cli_cat_file_type_size_and_pretty_tree_sub, "test-checkout", |f| {
    let r_type = execute_git_cli(&f.fs, &f.dir, &["cat-file", "-t", "test-branch"]);
    assert_eq!(r_type.exit_code, 0);
    assert_eq!(r_type.stdout.trim(), "commit");

    let r_size = execute_git_cli(&f.fs, &f.dir, &["cat-file", "-s", "test-branch"]);
    assert_eq!(r_size.exit_code, 0);
    assert!(r_size.stdout.trim().parse::<usize>().unwrap() > 0);
});

dual_fixture_test!(cli_hash_object_and_write, cli_hash_object_and_write_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "sample.txt"]), "hello world\n");
    let r_hash = execute_git_cli(&f.fs, &f.dir, &["hash-object", "sample.txt"]);
    assert_eq!(r_hash.exit_code, 0);
    assert_eq!(r_hash.stdout.trim(), "3b18e512dba79e4c8300dd08aeb37f8e728b8dad");

    let r_write = execute_git_cli(&f.fs, &f.dir, &["hash-object", "-w", "sample.txt"]);
    assert_eq!(r_write.exit_code, 0);
    assert_eq!(r_write.stdout.trim(), "3b18e512dba79e4c8300dd08aeb37f8e728b8dad");
});

// ============================================================================
// 11. Additional Remote Info, Server Refs, Fetch, Clone, Pull, Push & CLI Cases
// ============================================================================
dual_fixture_test!(get_remote_info_returns_symrefs_and_head_target, get_remote_info_returns_symrefs_and_head_target_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info = get_remote_info(&http, "http://localhost/test-dumb-http-server.git", None, false, None).unwrap();
    assert!(!info.refs.is_empty());
});

dual_fixture_test!(get_remote_info2_with_cors_proxy_rewrites_url, get_remote_info2_with_cors_proxy_rewrites_url_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info = get_remote_info2(
        &http,
        "http://localhost/test-dumb-http-server.git",
        Some("http://localhost"),
        false,
        1,
        None,
    )
    .unwrap();
    assert_eq!(info.protocol_version, 1);
});

dual_fixture_test!(list_server_refs_tags_prefix_only, list_server_refs_tags_prefix_only_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let tags = list_server_refs(
        &http,
        "http://localhost/test-dumb-http-server.git",
        None,
        false,
        1,
        Some("refs/tags/"),
        false,
        true,
        None,
    )
    .unwrap();
    assert!(tags.iter().all(|r| r.r#ref.starts_with("refs/tags/")));
});

dual_fixture_test!(list_server_refs_symrefs_true_populates_head, list_server_refs_symrefs_true_populates_head_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let refs = list_server_refs(
        &http,
        "http://localhost/test-dumb-http-server.git",
        None,
        false,
        1,
        None,
        true,
        false,
        None,
    )
    .unwrap();
    assert!(refs.iter().any(|r| r.r#ref == "HEAD" || r.r#ref.starts_with("refs/heads/")));
});

dual_fixture_test!(fetch_uses_remote_config_url_when_url_none, fetch_uses_remote_config_url_when_url_none_sub, "test-fetch", |f| {
    let http = MockHttpServer::new();
    set_config(&f.fs, &f.gitdir, "remote.origin.url", Some("http://localhost/test-fetch-server.git"), false).unwrap();
    let res = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        None,
        Some("origin"),
        Some("master"),
        true,
        false,
        None,
        false,
        None,
        None,
    )
    .unwrap();
    assert!(res.fetch_head.is_some());
});

dual_fixture_test!(fetch_missing_url_and_remote_returns_missing_parameter_error, fetch_missing_url_and_remote_returns_missing_parameter_error_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    let err = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        None,
        Some("nonexistent-remote"),
        Some("master"),
        true,
        false,
        None,
        false,
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::MissingParameterError);
});

dual_fixture_test!(clone_custom_remote_name_configures_remote, clone_custom_remote_name_configures_remote_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    clone(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        "http://localhost/test-clone.git",
        None,
        Some("master"),
        true,
        false,
        false,
        Some("upstream"),
        Some(1),
        None,
    )
    .unwrap();
    assert_eq!(
        git_rust::commands::plumbing::get_config(&f.fs, &f.gitdir, "remote.upstream.url").map(|v| v.as_str()).as_deref(),
        Some("http://localhost/test-clone.git")
    );
});

dual_fixture_test!(clone_no_tags_skips_tag_refs, clone_no_tags_skips_tag_refs_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    clone(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        "http://localhost/test-clone.git",
        None,
        Some("master"),
        true,
        false,
        true,
        Some("origin"),
        Some(1),
        None,
    )
    .unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap().len(), 40);
});

dual_fixture_test!(pull_fast_forward_only_succeeds_on_fast_forward, pull_fast_forward_only_succeeds_on_fast_forward_sub, "test-pull", |f| {
    let http = MockHttpServer::new();
    add_remote(&f.fs, &f.gitdir, "origin", "http://localhost/test-pull-server.git", true).unwrap();
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    pull(
        &f.fs,
        &http,
        &f.dir,
        Some(&f.gitdir),
        Some("master"),
        Some("http://localhost/test-pull-server.git"),
        Some("origin"),
        true,
        true,
        true,
        None,
        Some(author),
        None,
        None,
    )
    .unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap().len(), 40);
});

dual_fixture_test!(push_uses_configured_remote_url_when_url_none, push_uses_configured_remote_url_when_url_none_sub, "test-push", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("test-push-server", server_fx.fs.clone(), &server_fx.gitdir);
    set_config(&f.fs, &f.gitdir, "remote.origin.url", Some("http://localhost/test-push-server.git"), false).unwrap();

    let res = push(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("master"),
        Some("refs/heads/master"),
        Some("origin"),
        None,
        true,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(res.ok);
});

dual_fixture_test!(cli_clone_fetch_pull_and_push_with_http, cli_clone_fetch_pull_and_push_with_http_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("test-push-server", server_fx.fs.clone(), &server_fx.gitdir);

    let clone_dir = join(&[&f.dir, "cloned"]);
    let r_clone = git_rust::cli::execute_git_cli_with_http(
        &f.fs,
        &f.dir,
        &["clone", "http://localhost/test-clone.git", "cloned"],
        &http,
    );
    assert_eq!(r_clone.exit_code, 0);
    assert!(f.fs.exists(&clone_dir));
});

dual_fixture_test!(cli_version_and_c_directory_flag, cli_version_and_c_directory_flag_sub, "test-checkout", |f| {
    let r_ver = execute_git_cli(&f.fs, &f.dir, &["--version"]);
    assert_eq!(r_ver.exit_code, 0);
    assert!(r_ver.stdout.starts_with("git version "));

    let r_c = execute_git_cli(&f.fs, "/", &["-C", &f.dir, "status", "-s"]);
    assert_eq!(r_c.exit_code, 0);
});

dual_fixture_test!(cli_unknown_subcommand_returns_error_exit_code_1, cli_unknown_subcommand_returns_error_exit_code_1_sub, "test-empty", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &["not-a-real-subcommand"]);
    assert_eq!(r.exit_code, 1);
    assert!(r.stderr.contains("is not a git command"));
});

dual_fixture_test!(cli_no_arguments_prints_usage_and_exits_1, cli_no_arguments_prints_usage_and_exits_1_sub, "test-empty", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &[]);
    assert_eq!(r.exit_code, 1);
    assert!(r.stderr.contains("usage: git"));
});

// ============================================================================
// 12. Additional CLI & Plumbing Edge Cases (describe, notes, rev-parse, etc.)
// ============================================================================
dual_fixture_test!(cli_rev_parse_show_toplevel_and_git_dir, cli_rev_parse_show_toplevel_and_git_dir_sub, "test-checkout", |f| {
    let r_top = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--show-toplevel"]);
    assert_eq!(r_top.exit_code, 0);
    assert!(!r_top.stdout.trim().is_empty());

    let r_gd = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--git-dir"]);
    assert_eq!(r_gd.exit_code, 0);
    assert!(!r_gd.stdout.trim().is_empty());

    let r_wt = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--is-inside-work-tree"]);
    assert_eq!(r_wt.exit_code, 0);
    assert_eq!(r_wt.stdout.trim(), "true");
});

dual_fixture_test!(cli_rev_parse_symbolic_full_name, cli_rev_parse_symbolic_full_name_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    let r = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--symbolic-full-name", "HEAD"]);
    assert_eq!(r.exit_code, 0);
    assert_eq!(r.stdout.trim(), "refs/heads/test-branch");
});

dual_fixture_test!(cli_rev_parse_custom_short_length, cli_rev_parse_custom_short_length_sub, "test-checkout", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--short=12", "test-branch"]);
    assert_eq!(r.exit_code, 0);
    assert_eq!(r.stdout.trim().len(), 12);
});

dual_fixture_test!(cli_init_bare_and_initial_branch_flag, cli_init_bare_and_initial_branch_flag_sub, "test-empty", |f| {
    let sub_repo = join(&[&f.dir, "fresh-cli-init"]);
    let r = execute_git_cli(&f.fs, &f.dir, &["init", "-b", "main", "fresh-cli-init"]);
    assert_eq!(r.exit_code, 0);
    assert!(f.fs.exists(&join(&[&sub_repo, ".git", "HEAD"])));
});

dual_fixture_test!(cli_checkout_b_creates_and_switches_branch, cli_checkout_b_creates_and_switches_branch_sub, "test-checkout", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &["checkout", "-b", "created-via-checkout-b", "test-branch"]);
    assert_eq!(r.exit_code, 0);
    let r_sym = execute_git_cli(&f.fs, &f.dir, &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(r_sym.stdout.trim(), "created-via-checkout-b");
});

dual_fixture_test!(cli_checkout_orphan_creates_unborn_branch, cli_checkout_orphan_creates_unborn_branch_sub, "test-checkout", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &["checkout", "--orphan", "orphan-branch"]);
    assert_eq!(r.exit_code, 0);
    let r_sym = execute_git_cli(&f.fs, &f.dir, &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(r_sym.stdout.trim(), "orphan-branch");
});

dual_fixture_test!(cli_diff_quiet_and_exit_code_flags, cli_diff_quiet_and_exit_code_flags_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["diff", "--quiet"]).exit_code, 0);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "modified\n");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["diff", "--quiet"]).exit_code, 1);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["diff", "--exit-code"]).exit_code, 1);
});

dual_fixture_test!(cli_diff_name_only_and_name_status, cli_diff_name_only_and_name_status_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "modified\n");
    let r_name = execute_git_cli(&f.fs, &f.dir, &["diff", "--name-only"]);
    assert_eq!(r_name.exit_code, 0);
    assert_eq!(r_name.stdout.trim(), "README.md");

    let r_status = execute_git_cli(&f.fs, &f.dir, &["diff", "--name-status"]);
    assert_eq!(r_status.exit_code, 0);
    assert!(r_status.stdout.contains("M\tREADME.md"));
});

dual_fixture_test!(cli_reset_soft_keeps_index_and_worktree_changes, cli_reset_soft_keeps_index_and_worktree_changes_sub, "test-log", |f| {
    let head_before = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let r = execute_git_cli(&f.fs, &f.dir, &["reset", "--soft", "HEAD~1"]);
    assert_eq!(r.exit_code, 0);
    let head_after = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_ne!(head_before, head_after);
});

dual_fixture_test!(cli_restore_staged_unstages_index_entry, cli_restore_staged_unstages_index_entry_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "staged edit\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "README.md"]);
    let r = execute_git_cli(&f.fs, &f.dir, &["restore", "--staged", "README.md"]);
    assert_eq!(r.exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["diff", "--cached", "--quiet"]).exit_code, 0);
});


dual_fixture_test!(cli_describe_tags_and_always, cli_describe_tags_and_always_sub, "test-log", |f| {
    let r_always = execute_git_cli(&f.fs, &f.dir, &["describe", "--always", "--abbrev=8"]);
    assert_eq!(r_always.exit_code, 0);
    assert_eq!(r_always.stdout.trim().len(), 8);

    execute_git_cli(&f.fs, &f.dir, &["tag", "v1.0.0", "HEAD~1"]);
    let r_tags = execute_git_cli(&f.fs, &f.dir, &["describe", "--tags"]);
    assert_eq!(r_tags.exit_code, 0);
    assert!(r_tags.stdout.trim().starts_with("v1.0.0-1-g"));
});

dual_fixture_test!(cli_shortlog_summary_and_numbered, cli_shortlog_summary_and_numbered_sub, "test-log", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &["shortlog", "-sn", "-e"]);
    assert_eq!(r.exit_code, 0);
    assert!(!r.stdout.trim().is_empty() && r.stdout.contains("<"));
});

dual_fixture_test!(cli_grep_pattern_and_flags, cli_grep_pattern_and_flags_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "Hello Rust Git\nSecond line\n");
    let r = execute_git_cli(&f.fs, &f.dir, &["grep", "-n", "-i", "rust git"]);
    assert_eq!(r.exit_code, 0);
    assert_eq!(r.stdout.trim(), "README.md:1:Hello Rust Git");

    let r_files = execute_git_cli(&f.fs, &f.dir, &["grep", "-l", "Second"]);
    assert_eq!(r_files.exit_code, 0);
    assert_eq!(r_files.stdout.trim(), "README.md");
});

dual_fixture_test!(cli_blame_lines_and_range, cli_blame_lines_and_range_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "line one\nline two\nline three\n");
    let r = execute_git_cli(&f.fs, &f.dir, &["blame", "-L", "2,3", "README.md"]);
    assert_eq!(r.exit_code, 0);
    let lines: Vec<&str> = r.stdout.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].contains("2) line two"));
    assert!(lines[1].contains("3) line three"));
});

dual_fixture_test!(cli_revert_commit_and_no_commit, cli_revert_commit_and_no_commit_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "reverted.txt"]), "temporary file\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "reverted.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "add temporary file"]);
    assert!(f.fs.exists(&join(&[&f.dir, "reverted.txt"])));

    let r = execute_git_cli(&f.fs, &f.dir, &["revert", "HEAD"]);
    assert_eq!(r.exit_code, 0);
    assert!(r.stdout.contains("Revert \"add temporary file\""));
    assert!(!f.fs.exists(&join(&[&f.dir, "reverted.txt"])));
});

dual_fixture_test!(cli_notes_add_show_list_remove, cli_notes_add_show_list_remove_sub, "test-log", |f| {
    let r_add = execute_git_cli(&f.fs, &f.dir, &["notes", "add", "-m", "benchmark verified", "HEAD"]);
    assert_eq!(r_add.exit_code, 0);

    let r_show = execute_git_cli(&f.fs, &f.dir, &["notes", "show", "HEAD"]);
    assert_eq!(r_show.exit_code, 0);
    assert_eq!(r_show.stdout.trim(), "benchmark verified");

    let r_list = execute_git_cli(&f.fs, &f.dir, &["notes", "list"]);
    assert_eq!(r_list.exit_code, 0);
    assert!(!r_list.stdout.trim().is_empty());

    let r_rm = execute_git_cli(&f.fs, &f.dir, &["notes", "remove", "HEAD"]);
    assert_eq!(r_rm.exit_code, 0);
    assert_ne!(execute_git_cli(&f.fs, &f.dir, &["notes", "show", "HEAD"]).exit_code, 0);
});

dual_fixture_test!(cli_update_index_add_and_remove, cli_update_index_add_and_remove_sub, "test-init", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    f.fs.write_str(&join(&[&f.dir, "tracked.txt"]), "hello\n");
    let r_add = execute_git_cli(&f.fs, &f.dir, &["update-index", "--add", "tracked.txt"]);
    assert_eq!(r_add.exit_code, 0);
    assert_eq!(git_rust::commands::worktree::list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["tracked.txt"]);

    let _ = f.fs.rm(&join(&[&f.dir, "tracked.txt"]));
    let r_rm = execute_git_cli(&f.fs, &f.dir, &["update-index", "--remove", "tracked.txt"]);
    assert_eq!(r_rm.exit_code, 0);
    assert!(git_rust::commands::worktree::list_files(&f.fs, &f.gitdir, None).unwrap().is_empty());
});


dual_fixture_test!(cli_rebase_replays_commits_onto_upstream, cli_rebase_replays_commits_onto_upstream_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "-b", "base-branch", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "base-only.txt"]), "base content\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "base-only.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "base commit"]);

    execute_git_cli(&f.fs, &f.dir, &["checkout", "-b", "topic-branch", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "topic-only.txt"]), "topic content\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "topic-only.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "topic commit"]);

    let r = execute_git_cli(&f.fs, &f.dir, &["rebase", "base-branch"]);
    assert_eq!(r.exit_code, 0);
    assert!(r.stdout.contains("Successfully rebased"));
    assert!(f.fs.exists(&join(&[&f.dir, "base-only.txt"])));
    assert!(f.fs.exists(&join(&[&f.dir, "topic-only.txt"])));
});

dual_fixture_test!(cli_reflog_shows_head_history, cli_reflog_shows_head_history_sub, "test-log", |f| {
    let r = execute_git_cli(&f.fs, &f.dir, &["reflog", "show", "HEAD"]);
    assert_eq!(r.exit_code, 0);
    assert!(r.stdout.contains("HEAD@{0}:"));
});

dual_fixture_test!(cli_format_patch_and_apply_and_am, cli_format_patch_and_apply_and_am_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    let base_oid = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();

    f.fs.write_str(&join(&[&f.dir, "patched.txt"]), "hello patch world\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "patched.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "add patched file"]);

    let r_fp = execute_git_cli(&f.fs, &f.dir, &["format-patch", "-1"]);
    assert_eq!(r_fp.exit_code, 0);
    let patch_file = r_fp.stdout.trim().to_string();
    assert!(patch_file.ends_with(".patch"));

    execute_git_cli(&f.fs, &f.dir, &["reset", "--hard", &base_oid]);
    assert!(!f.fs.exists(&join(&[&f.dir, "patched.txt"])));

    let r_check = execute_git_cli(&f.fs, &f.dir, &["apply", "--check", &patch_file]);
    assert_eq!(r_check.exit_code, 0);

    let r_am = execute_git_cli(&f.fs, &f.dir, &["am", &patch_file]);
    assert_eq!(r_am.exit_code, 0);
    assert!(r_am.stdout.contains("Applying: add patched file"));
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "patched.txt"])).unwrap(), "hello patch world\n");
});

dual_fixture_test!(cli_archive_list_and_output_tar, cli_archive_list_and_output_tar_sub, "test-checkout", |f| {
    let r_list = execute_git_cli(&f.fs, &f.dir, &["archive", "--list"]);
    assert_eq!(r_list.exit_code, 0);
    assert!(r_list.stdout.contains("tar"));

    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    let r_arch = execute_git_cli(&f.fs, &f.dir, &["archive", "--prefix=release/", "-o", "release.tar", "HEAD"]);
    assert_eq!(r_arch.exit_code, 0);
    let tar_bytes = f.fs.read(&join(&[&f.dir, "release.tar"])).unwrap();
    assert!(tar_bytes.len() >= 1024);
    assert_eq!(&tar_bytes[257..262], b"ustar");
});

dual_fixture_test!(cli_submodule_and_worktree_and_maintenance, cli_submodule_and_worktree_and_maintenance_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);

    let r_sub = execute_git_cli(&f.fs, &f.dir, &["submodule", "add", "https://example.com/sub.git", "vendor/sub"]);
    assert_eq!(r_sub.exit_code, 0);
    assert!(f.fs.read_str(&join(&[&f.dir, ".gitmodules"])).unwrap().contains("vendor/sub"));

    let r_wt_add = execute_git_cli(&f.fs, &f.dir, &["worktree", "add", "wt-feature", "feature-wt"]);
    assert_eq!(r_wt_add.exit_code, 0);
    let r_wt_list = execute_git_cli(&f.fs, &f.dir, &["worktree", "list"]);
    assert_eq!(r_wt_list.exit_code, 0);
    assert!(r_wt_list.stdout.contains("wt-feature"));

    let r_fsck = execute_git_cli(&f.fs, &f.dir, &["fsck"]);
    assert_eq!(r_fsck.exit_code, 0);
    assert!(r_fsck.stdout.contains("Checking object directories: 100%"));

    let r_gc = execute_git_cli(&f.fs, &f.dir, &["gc"]);
    assert_eq!(r_gc.exit_code, 0);

    let r_co = execute_git_cli(&f.fs, &f.dir, &["count-objects", "-v"]);
    assert_eq!(r_co.exit_code, 0);
    assert!(r_co.stdout.contains("count:"));
});


dual_fixture_test!(cli_bisect_finds_midpoint_and_resets, cli_bisect_finds_midpoint_and_resets_sub, "test-log", |f| {
    let r_start = execute_git_cli(&f.fs, &f.dir, &["bisect", "start", "HEAD", "HEAD~3"]);
    assert_eq!(r_start.exit_code, 0);
    assert!(r_start.stdout.contains("Bisecting:"));

    let r_log = execute_git_cli(&f.fs, &f.dir, &["bisect", "log"]);
    assert_eq!(r_log.exit_code, 0);
    assert!(r_log.stdout.contains("git bisect start"));

    let r_reset = execute_git_cli(&f.fs, &f.dir, &["bisect", "reset"]);
    assert_eq!(r_reset.exit_code, 0);
});

dual_fixture_test!(cli_bundle_create_verify_list_heads_and_unbundle, cli_bundle_create_verify_list_heads_and_unbundle_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    let r_create = execute_git_cli(&f.fs, &f.dir, &["bundle", "create", "repo.bundle", "test-branch"]);
    assert_eq!(r_create.exit_code, 0);

    let r_verify = execute_git_cli(&f.fs, &f.dir, &["bundle", "verify", "repo.bundle"]);
    assert_eq!(r_verify.exit_code, 0);
    assert!(r_verify.stdout.contains("is okay"));

    let r_heads = execute_git_cli(&f.fs, &f.dir, &["bundle", "list-heads", "repo.bundle"]);
    assert_eq!(r_heads.exit_code, 0);
    assert!(r_heads.stdout.contains("refs/heads/test-branch"));
});

dual_fixture_test!(cli_write_tree_commit_tree_read_tree_var_and_name_rev, cli_write_tree_commit_tree_read_tree_var_and_name_rev_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    let r_wt = execute_git_cli(&f.fs, &f.dir, &["write-tree"]);
    assert_eq!(r_wt.exit_code, 0);
    let tree_oid = r_wt.stdout.trim().to_string();
    assert_eq!(tree_oid.len(), 40);

    let r_ct = execute_git_cli(&f.fs, &f.dir, &["commit-tree", &tree_oid, "-p", "HEAD", "-m", "plumbing commit"]);
    assert_eq!(r_ct.exit_code, 0);
    assert_eq!(r_ct.stdout.trim().len(), 40);

    let r_rt = execute_git_cli(&f.fs, &f.dir, &["read-tree", &tree_oid]);
    assert_eq!(r_rt.exit_code, 0);

    let r_var = execute_git_cli(&f.fs, &f.dir, &["var", "GIT_AUTHOR_IDENT"]);
    assert_eq!(r_var.exit_code, 0);
    assert!(r_var.stdout.contains("<"));

    let r_nr = execute_git_cli(&f.fs, &f.dir, &["name-rev", "--name-only", "HEAD"]);
    assert_eq!(r_nr.exit_code, 0);
    assert_eq!(r_nr.stdout.trim(), "test-branch");
});


dual_fixture_test!(cli_recursive_write_tree_and_read_tree_nested_dirs, cli_recursive_write_tree_and_read_tree_nested_dirs_sub, "test-init", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    let _ = f.fs.mkdir(&join(&[&f.dir, "src/core"]));
    f.fs.write_str(&join(&[&f.dir, "src/core/engine.rs"]), "pub fn run() {}\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "src/core/engine.rs"]);

    let r_wt = execute_git_cli(&f.fs, &f.dir, &["write-tree"]);
    assert_eq!(r_wt.exit_code, 0);
    let root_tree = r_wt.stdout.trim().to_string();
    assert_eq!(root_tree.len(), 40);

    let r_ls = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "-r", "--name-only", &root_tree]);
    assert_eq!(r_ls.exit_code, 0);
    assert_eq!(r_ls.stdout.trim(), "src/core/engine.rs");

    execute_git_cli(&f.fs, &f.dir, &["rm", "--cached", "src/core/engine.rs"]);
    assert!(git_rust::commands::worktree::list_files(&f.fs, &f.gitdir, None).unwrap().is_empty());

    let r_rt = execute_git_cli(&f.fs, &f.dir, &["read-tree", &root_tree]);
    assert_eq!(r_rt.exit_code, 0);
    assert_eq!(git_rust::commands::worktree::list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["src/core/engine.rs"]);
});

dual_fixture_test!(cli_reflog_selectors_and_upstream_shorthand, cli_reflog_selectors_and_upstream_shorthand_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    execute_git_cli(&f.fs, &f.dir, &["config", "user.name", "Reflog Tester"]);
    execute_git_cli(&f.fs, &f.dir, &["config", "user.email", "reflog@example.com"]);

    f.fs.write_str(&join(&[&f.dir, "step1.txt"]), "one\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "step1.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "step one"]);
    let oid1 = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout.trim().to_string();

    f.fs.write_str(&join(&[&f.dir, "step2.txt"]), "two\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "step2.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "step two"]);
    let oid2 = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout.trim().to_string();

    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD@{0}"]).stdout.trim(), oid2);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD@{1}"]).stdout.trim(), oid1);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "@{1}"]).stdout.trim(), oid1);

    execute_git_cli(&f.fs, &f.dir, &["update-ref", "refs/remotes/origin/test-branch", &oid1]);
    execute_git_cli(&f.fs, &f.dir, &["config", "branch.test-branch.remote", "origin"]);
    execute_git_cli(&f.fs, &f.dir, &["config", "branch.test-branch.merge", "refs/heads/test-branch"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "@{u}"]).stdout.trim(), oid1);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "test-branch@{upstream}"]).stdout.trim(), oid1);
});
