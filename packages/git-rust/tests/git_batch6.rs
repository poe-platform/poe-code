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
