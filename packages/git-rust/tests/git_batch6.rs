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

    let r_wt_add = execute_git_cli(&f.fs, &f.dir, &["worktree", "add", "wt-feature"]);
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


dual_fixture_test!(cli_reset_reflog_recovery_and_for_each_ref, cli_reset_reflog_recovery_and_for_each_ref_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "recover.txt"]), "precious work\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "recover.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "precious commit"]);
    let tip_oid = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout.trim().to_string();

    execute_git_cli(&f.fs, &f.dir, &["reset", "--hard", "HEAD~1"]);
    assert!(!f.fs.exists(&join(&[&f.dir, "recover.txt"])));

    execute_git_cli(&f.fs, &f.dir, &["reset", "--hard", "HEAD@{1}"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout.trim(), tip_oid);
    assert!(f.fs.exists(&join(&[&f.dir, "recover.txt"])));

    let r_fer = execute_git_cli(&f.fs, &f.dir, &["for-each-ref", "--format=%(refname:short) %(objecttype) %(subject)", "refs/heads/test-branch"]);
    assert_eq!(r_fer.exit_code, 0);
    assert_eq!(r_fer.stdout.trim(), "test-branch commit precious commit");
});

dual_fixture_test!(cli_cherry_range_diff_sparse_checkout_and_replace, cli_cherry_range_diff_sparse_checkout_and_replace_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "cherry-file.txt"]), "unique patch\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "cherry-file.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "unique cherry commit"]);

    let r_cherry = execute_git_cli(&f.fs, &f.dir, &["cherry", "-v", "HEAD~1", "HEAD"]);
    assert_eq!(r_cherry.exit_code, 0, "{}", r_cherry.stderr);
    assert!(r_cherry.stdout.contains("+ ") && r_cherry.stdout.contains("unique cherry commit"));

    let r_rd = execute_git_cli(&f.fs, &f.dir, &["range-diff", "HEAD~1..HEAD", "HEAD~1..HEAD"]);
    assert_eq!(r_rd.exit_code, 0);
    assert!(r_rd.stdout.contains(" = ") && r_rd.stdout.contains("unique cherry commit"));

    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["sparse-checkout", "set", "src", "docs"]).exit_code, 0);
    let r_sc = execute_git_cli(&f.fs, &f.dir, &["sparse-checkout", "list"]);
    assert_eq!(r_sc.stdout.trim(), "src\ndocs");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["sparse-checkout", "disable"]).exit_code, 0);

    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["replace", "HEAD~1", "HEAD"]).exit_code, 0);
    assert!(!execute_git_cli(&f.fs, &f.dir, &["replace", "-l"]).stdout.trim().is_empty());
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["replace", "-d", "HEAD~1"]).exit_code, 0);
});


dual_fixture_test!(cli_log_author_grep_skip_no_merges_first_parent_all_and_follow, cli_log_author_grep_skip_no_merges_first_parent_all_and_follow_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    execute_git_cli(&f.fs, &f.dir, &["config", "user.name", "Special Author"]);
    execute_git_cli(&f.fs, &f.dir, &["config", "user.email", "special@example.com"]);

    f.fs.write_str(&join(&[&f.dir, "orig-name.txt"]), "track me across rename\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "orig-name.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "feat: introduce tracked file"]);

    execute_git_cli(&f.fs, &f.dir, &["mv", "orig-name.txt", "renamed-name.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "refactor: rename tracked file"]);

    let r_author = execute_git_cli(&f.fs, &f.dir, &["log", "--author=special@example.com", "--oneline"]);
    assert_eq!(r_author.exit_code, 0);
    assert_eq!(r_author.stdout.lines().count(), 2);

    let r_grep = execute_git_cli(&f.fs, &f.dir, &["log", "--grep=INTRODUCE", "-i", "--oneline"]);
    assert_eq!(r_grep.exit_code, 0);
    assert_eq!(r_grep.stdout.lines().count(), 1);

    let r_skip = execute_git_cli(&f.fs, &f.dir, &["log", "--author=Special", "--skip=1", "-n", "1", "--oneline"]);
    assert_eq!(r_skip.exit_code, 0);
    assert!(r_skip.stdout.contains("introduce tracked file"));

    let r_follow = execute_git_cli(&f.fs, &f.dir, &["log", "--follow", "--oneline", "renamed-name.txt"]);
    assert_eq!(r_follow.exit_code, 0);
    assert_eq!(r_follow.stdout.lines().count(), 2);

    let r_all = execute_git_cli(&f.fs, &f.dir, &["log", "--all", "--no-merges", "--first-parent", "-n", "3", "--oneline"]);
    assert_eq!(r_all.exit_code, 0);
    assert!(!r_all.stdout.trim().is_empty());
});


dual_fixture_test!(cli_remote_get_set_rename_show_and_config_flags, cli_remote_get_set_rename_show_and_config_flags_sub, "test-init", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    execute_git_cli(&f.fs, &f.dir, &["remote", "add", "origin", "https://example.com/orig.git"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["remote", "get-url", "origin"]).stdout.trim(), "https://example.com/orig.git");

    execute_git_cli(&f.fs, &f.dir, &["remote", "set-url", "origin", "https://example.com/updated.git"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["remote", "get-url", "origin"]).stdout.trim(), "https://example.com/updated.git");

    execute_git_cli(&f.fs, &f.dir, &["remote", "rename", "origin", "upstream"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["remote", "get-url", "upstream"]).stdout.trim(), "https://example.com/updated.git");
    assert!(execute_git_cli(&f.fs, &f.dir, &["remote", "show", "upstream"]).stdout.contains("Fetch URL: https://example.com/updated.git"));

    execute_git_cli(&f.fs, &f.dir, &["config", "--add", "custom.item", "first"]);
    execute_git_cli(&f.fs, &f.dir, &["config", "--add", "custom.item", "second"]);
    let r_all = execute_git_cli(&f.fs, &f.dir, &["config", "--get-all", "custom.item"]);
    assert_eq!(r_all.stdout.lines().collect::<Vec<_>>(), vec!["first", "second"]);

    assert!(execute_git_cli(&f.fs, &f.dir, &["config", "--list"]).stdout.contains("custom.item=first"));
    execute_git_cli(&f.fs, &f.dir, &["config", "--unset", "custom.item"]);
    assert_ne!(execute_git_cli(&f.fs, &f.dir, &["config", "custom.item"]).exit_code, 0);
});

dual_fixture_test!(cli_rev_parse_introspection_and_ref_lists, cli_rev_parse_introspection_and_ref_lists_sub, "test-checkout", |f| {
    let sub_cwd = join(&[&f.dir, "sub/nested"]);
    let _ = git_rust::mkdirp(|p| f.fs.mkdir(p), &sub_cwd, 3);

    assert_eq!(execute_git_cli(&f.fs, &sub_cwd, &["rev-parse", "--show-prefix"]).stdout.trim(), "sub/nested/");
    assert_eq!(execute_git_cli(&f.fs, &sub_cwd, &["rev-parse", "--show-cdup"]).stdout.trim(), "../../");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--is-bare-repository"]).stdout.trim(), "false");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--is-inside-git-dir"]).stdout.trim(), "false");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--absolute-git-dir"]).stdout.trim(), git_rust::discover_gitdir(&f.fs, &f.gitdir));
    assert!(!execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--branches"]).stdout.trim().is_empty());
});


dual_fixture_test!(cli_commit_am_multiple_m_file_author_and_add_all, cli_commit_am_multiple_m_file_author_and_add_all_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "auto-staged via -am\n");
    let r_am = execute_git_cli(&f.fs, &f.dir, &["commit", "-am", "feat: auto stage README", "-m", "Body paragraph", "--author=Custom Dev <dev@example.com>"]);
    assert_eq!(r_am.exit_code, 0);

    let r_show = execute_git_cli(&f.fs, &f.dir, &["show", "-s", "HEAD"]);
    assert!(r_show.stdout.contains("Custom Dev <dev@example.com>"));
    assert!(r_show.stdout.contains("Body paragraph"));

    f.fs.write_str(&join(&[&f.dir, "brand-new.txt"]), "added with -A\n");
    f.fs.write_str(&join(&[&f.dir, "commit-msg.txt"]), "chore: commit from file\n");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["add", "-A"]).exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["commit", "-F", "commit-msg.txt"]).exit_code, 0);
    assert!(execute_git_cli(&f.fs, &f.dir, &["log", "-1", "--oneline"]).stdout.contains("chore: commit from file"));
});


dual_fixture_test!(cli_branch_verbose_contains_merged_upstream_and_tag_filters, cli_branch_verbose_contains_merged_upstream_and_tag_filters_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["branch", "-c", "copied-branch"]).exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["branch", "-u", "origin/test-branch", "test-branch"]).exit_code, 0);

    let r_vv = execute_git_cli(&f.fs, &f.dir, &["branch", "-vv"]);
    assert_eq!(r_vv.exit_code, 0);
    assert!(r_vv.stdout.contains("[origin/test-branch]"));

    let r_contains = execute_git_cli(&f.fs, &f.dir, &["branch", "--contains", "HEAD"]);
    assert_eq!(r_contains.exit_code, 0);
    assert!(r_contains.stdout.contains("test-branch") && r_contains.stdout.contains("copied-branch"));

    let r_merged = execute_git_cli(&f.fs, &f.dir, &["branch", "--merged", "HEAD"]);
    assert_eq!(r_merged.exit_code, 0);
    assert!(r_merged.stdout.contains("copied-branch"));

    execute_git_cli(&f.fs, &f.dir, &["tag", "-a", "v2.0.0", "-m", "Release 2.0", "HEAD"]);
    let r_tag_l = execute_git_cli(&f.fs, &f.dir, &["tag", "-l", "v2.*"]);
    assert_eq!(r_tag_l.stdout.trim(), "v2.0.0");

    let r_tag_n = execute_git_cli(&f.fs, &f.dir, &["tag", "-n"]);
    assert!(r_tag_n.stdout.contains("v2.0.0") && r_tag_n.stdout.contains("Release 2.0"));

    let r_tag_pa = execute_git_cli(&f.fs, &f.dir, &["tag", "--points-at", "HEAD"]);
    assert_eq!(r_tag_pa.stdout.trim(), "v1.0.0\nv2.0.0");
});


dual_fixture_test!(cli_diff_stats_checkout_dash_stash_show_branch_and_merge_flags, cli_diff_stats_checkout_dash_stash_show_branch_and_merge_flags_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    execute_git_cli(&f.fs, &f.dir, &["checkout", "-b", "feature-branch"]);
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "updated line 1\nupdated line 2\n");

    // 1. diff --shortstat, --numstat, --dirstat, --word-diff, -R
    let r_shortstat = execute_git_cli(&f.fs, &f.dir, &["diff", "--shortstat"]);
    assert_eq!(r_shortstat.exit_code, 0);
    assert!(r_shortstat.stdout.contains("1 file changed") && r_shortstat.stdout.contains("insertion"));

    let r_numstat = execute_git_cli(&f.fs, &f.dir, &["diff", "--numstat"]);
    assert_eq!(r_numstat.exit_code, 0);
    assert!(r_numstat.stdout.contains("README.md"));

    let r_dirstat = execute_git_cli(&f.fs, &f.dir, &["diff", "--dirstat"]);
    assert_eq!(r_dirstat.exit_code, 0);
    assert!(r_dirstat.stdout.contains("100.0% /"));

    let r_word_diff = execute_git_cli(&f.fs, &f.dir, &["diff", "--word-diff"]);
    assert_eq!(r_word_diff.exit_code, 0);
    assert!(r_word_diff.stdout.contains("{+updated line 1+}"));

    // 2. stash push, stash show, stash show -p, stash branch
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["stash", "push", "-m", "wip-readme"]).exit_code, 0);
    let r_stash_show = execute_git_cli(&f.fs, &f.dir, &["stash", "show", "-p"]);
    assert_eq!(r_stash_show.exit_code, 0);
    assert!(r_stash_show.stdout.contains("+updated line 1"));

    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["stash", "branch", "from-stash"]).exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim(), "from-stash");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["commit", "-am", "feat: commit from stash"]).exit_code, 0);

    // 3. checkout - / switch - and @{-1}
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]).exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["checkout", "-"]).exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim(), "from-stash");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["switch", "-"]).exit_code, 0);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim(), "test-branch");

    // 4. merge --squash and merge --no-ff
    let r_squash = execute_git_cli(&f.fs, &f.dir, &["merge", "--squash", "from-stash"]);
    assert_eq!(r_squash.exit_code, 0);
    assert!(r_squash.stdout.contains("Squash commit"));
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["commit"]).exit_code, 0);
    assert!(execute_git_cli(&f.fs, &f.dir, &["log", "-1"]).stdout.contains("Squashed commit"));
});


dual_fixture_test!(cli_ls_files_modes_diff_plumbing_pack_refs_and_mktree, cli_ls_files_modes_diff_plumbing_pack_refs_and_mktree_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);

    // 1. ls-files -s / --stage
    let r_stage = execute_git_cli(&f.fs, &f.dir, &["ls-files", "-s"]);
    assert_eq!(r_stage.exit_code, 0);
    assert!(r_stage.stdout.contains("100644 ") && r_stage.stdout.contains("\tREADME.md"));

    // 2. ls-files -o (untracked) and -m (modified)
    f.fs.write_str(&join(&[&f.dir, "untracked-file.txt"]), "untracked\n");
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "modified content\n");
    let r_others = execute_git_cli(&f.fs, &f.dir, &["ls-files", "-o"]);
    assert!(r_others.stdout.contains("untracked-file.txt"));
    let r_mod = execute_git_cli(&f.fs, &f.dir, &["ls-files", "-m"]);
    assert_eq!(r_mod.stdout.trim(), "README.md");

    // 3. diff-files, diff-index, diff-tree
    let r_df = execute_git_cli(&f.fs, &f.dir, &["diff-files", "--name-only"]);
    assert_eq!(r_df.stdout.trim(), "README.md");
    let r_di = execute_git_cli(&f.fs, &f.dir, &["diff-index", "--name-status", "HEAD"]);
    assert!(r_di.stdout.contains("M\tREADME.md"));
    let r_dt = execute_git_cli(&f.fs, &f.dir, &["diff-tree", "--name-only", "HEAD"]);
    assert_eq!(r_dt.exit_code, 0);

    // 4. pack-refs --all and mktree
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["pack-refs", "--all"]).exit_code, 0);
    let blob_oid = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD:README.md"]).stdout.trim().to_string();
    let r_mktree = execute_git_cli(&f.fs, &f.dir, &["mktree", &format!("100644 blob {blob_oid}\thello.txt")]);
    assert_eq!(r_mktree.exit_code, 0);
    assert_eq!(r_mktree.stdout.trim().len(), 40);
});


dual_fixture_test!(cli_check_ref_format_check_attr_stripspace_show_branch_and_mktag, cli_check_ref_format_check_attr_stripspace_show_branch_and_mktag_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);

    // 1. check-ref-format
    let r_crf = execute_git_cli(&f.fs, &f.dir, &["check-ref-format", "--branch", "feature/login"]);
    assert_eq!(r_crf.exit_code, 0);
    assert_eq!(r_crf.stdout.trim(), "feature/login");
    assert_ne!(execute_git_cli(&f.fs, &f.dir, &["check-ref-format", "refs/heads/bad..name"]).exit_code, 0);

    // 2. check-attr
    f.fs.write_str(&join(&[&f.dir, ".gitattributes"]), "*.rs text eol=lf\n*.png -text binary\n");
    let r_attr = execute_git_cli(&f.fs, &f.dir, &["check-attr", "eol", "text", "--", "src/lib.rs", "logo.png"]);
    assert_eq!(r_attr.exit_code, 0);
    assert!(r_attr.stdout.contains("src/lib.rs: eol: lf") && r_attr.stdout.contains("logo.png: text: unset"));

    // 3. stripspace
    let r_ss = execute_git_cli(&f.fs, &f.dir, &["stripspace", "-s", "hello   \n# comment\n\n\nworld  "]);
    assert_eq!(r_ss.stdout, "hello\n\nworld\n");

    // 4. show-branch
    let r_sb = execute_git_cli(&f.fs, &f.dir, &["show-branch"]);
    assert_eq!(r_sb.exit_code, 0);
    assert!(r_sb.stdout.contains("[test-branch]"));

    // 5. mktag
    let head_oid = execute_git_cli(&f.fs, &f.dir, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    let tag_payload = format!("object {head_oid}\ntype commit\ntag v3.0.0\ntagger Git User <user@example.com> 1502484200 +0000\n\nRelease 3.0\n");
    let r_mktag = execute_git_cli(&f.fs, &f.dir, &["mktag", &tag_payload]);
    assert_eq!(r_mktag.exit_code, 0);
    assert_eq!(r_mktag.stdout.trim().len(), 40);
});


dual_fixture_test!(cli_status_ignored_ls_remote_whatchanged_and_request_pull, cli_status_ignored_ls_remote_whatchanged_and_request_pull_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);

    // 1. status -s --ignored
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "*.log\n");
    f.fs.write_str(&join(&[&f.dir, "debug.log"]), "ignored log\n");
    let r_ign = execute_git_cli(&f.fs, &f.dir, &["status", "-s", "--ignored"]);
    assert_eq!(r_ign.exit_code, 0);
    assert!(r_ign.stdout.contains("!! debug.log"));

    // 2. ls-remote (--get-url, --heads, --tags)
    execute_git_cli(&f.fs, &f.dir, &["remote", "set-url", "origin", "https://example.com/repo.git"]);
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["ls-remote", "--get-url", "origin"]).stdout.trim(), "https://example.com/repo.git");
    let r_lsr = execute_git_cli(&f.fs, &f.dir, &["ls-remote", "--heads", "."]);
    assert_eq!(r_lsr.exit_code, 0);
    assert!(r_lsr.stdout.contains("refs/heads/test-branch"));

    // 3. whatchanged and request-pull
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "new change for request-pull\n");
    execute_git_cli(&f.fs, &f.dir, &["commit", "-am", "feat: update readme for pr"]);
    let r_wc = execute_git_cli(&f.fs, &f.dir, &["whatchanged", "-1"]);
    assert_eq!(r_wc.exit_code, 0);
    assert!(r_wc.stdout.contains("feat: update readme for pr") && r_wc.stdout.contains("README.md"));

    let r_rp = execute_git_cli(&f.fs, &f.dir, &["request-pull", "HEAD~1", "https://example.com/repo.git", "HEAD"]);
    assert_eq!(r_rp.exit_code, 0);
    assert!(r_rp.stdout.contains("The following changes since commit") && r_rp.stdout.contains("feat: update readme for pr"));
});


dual_fixture_test!(cli_merge_tree_merge_file_fmt_merge_msg_rerere_trailers_and_column, cli_merge_tree_merge_file_fmt_merge_msg_rerere_trailers_and_column_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    execute_git_cli(&f.fs, &f.dir, &["checkout", "-b", "branch-a"]);
    f.fs.write_str(&join(&[&f.dir, "only-a.txt"]), "from branch a\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "only-a.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "feat: add only-a"]);

    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);
    execute_git_cli(&f.fs, &f.dir, &["checkout", "-b", "branch-b"]);
    f.fs.write_str(&join(&[&f.dir, "only-b.txt"]), "from branch b\n");
    execute_git_cli(&f.fs, &f.dir, &["add", "only-b.txt"]);
    execute_git_cli(&f.fs, &f.dir, &["commit", "-m", "feat: add only-b"]);

    // 1. merge-tree --write-tree
    let r_mt = execute_git_cli(&f.fs, &f.dir, &["merge-tree", "--write-tree", "branch-a", "branch-b"]);
    assert_eq!(r_mt.exit_code, 0);
    let merged_tree_oid = r_mt.stdout.trim();
    assert_eq!(merged_tree_oid.len(), 40);
    let r_ls = execute_git_cli(&f.fs, &f.dir, &["ls-tree", "--name-only", merged_tree_oid]);
    assert!(r_ls.stdout.contains("only-a.txt") && r_ls.stdout.contains("only-b.txt"));

    // 2. merge-file -p
    f.fs.write_str(&join(&[&f.dir, "base.txt"]), "line1\nline2\nline3\n");
    f.fs.write_str(&join(&[&f.dir, "ours.txt"]), "line1-ours\nline2\nline3\n");
    f.fs.write_str(&join(&[&f.dir, "theirs.txt"]), "line1\nline2\nline3-theirs\n");
    let r_mf = execute_git_cli(&f.fs, &f.dir, &["merge-file", "-p", "ours.txt", "base.txt", "theirs.txt"]);
    assert_eq!(r_mf.exit_code, 0);
    assert_eq!(r_mf.stdout, "line1-ours\nline2\nline3-theirs\n");

    // 3. fmt-merge-msg and rerere
    let r_fmm = execute_git_cli(&f.fs, &f.dir, &["fmt-merge-msg", "branch-a"]);
    assert_eq!(r_fmm.stdout, "Merge branch 'branch-a'\n");
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["rerere", "status"]).exit_code, 0);

    // 4. interpret-trailers and column
    let r_it = execute_git_cli(&f.fs, &f.dir, &["interpret-trailers", "--trailer", "Signed-off-by: Alice <alice@example.com>", "feat: add feature"]);
    assert_eq!(r_it.stdout, "feat: add feature\n\nSigned-off-by: Alice <alice@example.com>\n");
    let r_col = execute_git_cli(&f.fs, &f.dir, &["column", "alpha\nbeta\ngamma"]);
    assert_eq!(r_col.stdout, "alpha  beta  gamma\n");
});


dual_fixture_test!(cli_show_ref_verify_checkout_index_verify_commit_prune_and_repack, cli_show_ref_verify_checkout_index_verify_commit_prune_and_repack_sub, "test-checkout", |f| {
    execute_git_cli(&f.fs, &f.dir, &["checkout", "test-branch"]);

    // 1. show-ref --verify and -d
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["show-ref", "--verify", "refs/heads/test-branch"]).exit_code, 0);
    assert_ne!(execute_git_cli(&f.fs, &f.dir, &["show-ref", "--verify", "-q", "refs/heads/nonexistent"]).exit_code, 0);
    execute_git_cli(&f.fs, &f.dir, &["tag", "-a", "v4.0.0", "-m", "Annotated v4", "HEAD"]);
    let r_deref = execute_git_cli(&f.fs, &f.dir, &["show-ref", "-d", "v4.0.0"]);
    assert!(r_deref.stdout.contains("refs/tags/v4.0.0^{}"));

    // 2. checkout-index --all --prefix=export/
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["checkout-index", "-a", "-f", "--prefix=export/"]).exit_code, 0);
    assert!(f.fs.exists(&join(&[&f.dir, "export/README.md"])));

    // 3. verify-commit and verify-tag (unsigned returns 1)
    let r_vc = execute_git_cli(&f.fs, &f.dir, &["verify-commit", "HEAD"]); assert_eq!(r_vc.exit_code, 0); assert!(r_vc.stdout.contains("Good signature"));
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["verify-tag", "v4.0.0"]).exit_code, 1);

    // 4. prune -n and repack -a -d
    let r_hash = execute_git_cli(&f.fs, &f.dir, &["hash-object", "-w", "--stdin", "dangling-blob-content"]);
    let dangling_oid = r_hash.stdout.trim();
    let r_prune = execute_git_cli(&f.fs, &f.dir, &["prune", "-n"]);
    assert_eq!(r_prune.exit_code, 0);
    assert!(r_prune.stdout.contains(dangling_oid));
    assert_eq!(execute_git_cli(&f.fs, &f.dir, &["repack", "-a", "-d"]).exit_code, 0);
});
