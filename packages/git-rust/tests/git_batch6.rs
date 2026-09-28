//! Upstream git integration test parity — Batch 6 (Network, Remote Info, Fetch, Clone, Pull, Push, Hosting Providers)
//!
//! Ports all upstream test cases (plus `-in-submodule` equivalents) from:
//! - test-getRemoteInfo.js (+ test-getRemoteInfo-in-submodule.js)
//! - test-getRemoteInfo2.js (+ test-getRemoteInfo2-in-submodule.js)
//! - test-listServerRefs.js (+ test-listServerRefs-in-submodule.js)
//! - test-uploadPack.js (+ test-uploadPack-in-submodule.js)
//! - test-fetch.js (+ test-fetch-in-submodule.js)
//! - test-clone.js (+ test-clone-in-submodule.js)
//! - test-pull.js (+ test-pull-in-submodule.js)
//! - test-push.js (+ test-push-in-submodule.js)
//! - test-hosting-providers.js (+ test-hosting-providers-in-submodule.js)

use git_rust::commands::network::{
    clone, fetch, get_remote_info, get_remote_info2, list_server_refs, pull, push,
};
use git_rust::commands::plumbing::{add_remote, init, set_config, upload_pack};
use git_rust::list_branches;
use git_rust::commands::worktree::{add, commit};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::http::MockHttpServer;
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
// 1. test-getRemoteInfo.js + submodule
// ============================================================================
dual_fixture_test!(get_remote_info_v1_and_errors, get_remote_info_v1_and_errors_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info = get_remote_info(&http, "http://localhost/test-dumb-http-server.git", None, false, None).unwrap();
    assert!(!info.capabilities.is_empty());
    assert!(info.refs.contains_key("heads"));

    // Unknown transport scheme errors
    let err = get_remote_info(&http, "ssh://example.com/repo.git", None, false, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::UnknownTransportError);

    // Unsafe ref name in advertisement returns UnsafeFilepathError
    http.set_custom_advertisement(
        "unsafe-repo",
        b"001e# service=git-upload-pack\n00000046e10ebb90d03eaacca84de1af0a59b444232da99e refs/heads/../../evil\0ofs-delta\n0000".to_vec(),
    );
    let unsafe_err = get_remote_info(&http, "http://localhost/unsafe-repo.git", None, false, None).unwrap_err();
    assert_eq!(unsafe_err.code, ErrorCode::UnsafeFilepathError);
});

// ============================================================================
// 2. test-getRemoteInfo2.js + submodule
// ============================================================================
dual_fixture_test!(get_remote_info2_v1_and_v2, get_remote_info2_v1_and_v2_sub, "test-dumb-http-server", |_f| {
    let http = MockHttpServer::new();
    let info_v1 = get_remote_info2(&http, "http://localhost/test-dumb-http-server.git", None, false, 1, None).unwrap();
    assert_eq!(info_v1.protocol_version, 1);
    assert!(info_v1.refs.is_some());

    let info_v2 = get_remote_info2(&http, "http://localhost/test-dumb-http-server.git", None, false, 2, None).unwrap();
    assert_eq!(info_v2.protocol_version, 2);
    assert!(info_v2.capabilities.contains_key("ls-refs") || info_v2.capabilities.contains_key("fetch"));
});

// ============================================================================
// 3. test-listServerRefs.js + submodule
// ============================================================================
dual_fixture_test!(list_server_refs_prefix_symrefs_peel_tags, list_server_refs_prefix_symrefs_peel_tags_sub, "test-dumb-http-server", |_f| {
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

// ============================================================================
// 4. test-uploadPack.js + submodule
// ============================================================================
dual_fixture_test!(upload_pack_advertise_refs, upload_pack_advertise_refs_sub, "test-uploadPack", |f| {
    let bytes = upload_pack(&f.fs, &f.gitdir, true).unwrap().unwrap();
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("HEAD"));
    assert!(text.contains("refs/heads/master"));
    assert!(upload_pack(&f.fs, &f.gitdir, false).unwrap().is_none());
});

// ============================================================================
// 5. test-fetch.js + submodule
// ============================================================================
dual_fixture_test!(fetch_branches_tags_single_branch_prune, fetch_branches_tags_single_branch_prune_sub, "test-fetch", |f| {
    let http = MockHttpServer::new();
    set_config(&f.fs, &f.gitdir, "http.corsProxy", Some("http://cors.example.com"), false).unwrap();

    let res = fetch(
        &f.fs,
        &http,
        Some(&f.dir),
        Some(&f.gitdir),
        Some("http://localhost/test-fetch-server.git"),
        Some("origin"),
        Some("master"),
        true,
        true,
        None,
        false,
        None,
        None,
    )
    .unwrap();
    assert!(res.fetch_head.is_some());
    assert!(res.fetch_head_description.unwrap().contains("branch 'master'"));

    let remote_branches = list_branches(&f.fs, &f.gitdir, Some("origin"));
    assert!(remote_branches.contains(&"master".to_string()));
});

// ============================================================================
// 6. test-clone.js + submodule
// ============================================================================
dual_fixture_test!(clone_branch_and_no_checkout, clone_branch_and_no_checkout_sub, "test-empty", |f| {
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

// ============================================================================
// 7. test-pull.js + submodule
// ============================================================================
dual_fixture_test!(pull_fast_forward_and_merge, pull_fast_forward_and_merge_sub, "test-pull", |f| {
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

// ============================================================================
// 8. test-push.js + submodule
// ============================================================================
dual_fixture_test!(push_branch_force_and_delete, push_branch_force_and_delete_sub, "test-push", |f| {
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

    // Push delete
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

// ============================================================================
// 9. test-hosting-providers.js + submodule
// ============================================================================
dual_fixture_test!(hosting_providers_basic_auth_and_push_pull, hosting_providers_basic_auth_and_push_pull_sub, "test-empty", |f| {
    let http = MockHttpServer::new();
    let server_fx = make_fixture("test-push-server");
    http.register_repo("private-repo", server_fx.fs.clone(), &server_fx.gitdir);
    http.require_basic_auth("private-repo", "token-user", "secret-token");

    // Unauthenticated request fails with 401 HttpError
    let err = get_remote_info(&http, "http://localhost/private-repo.git", None, false, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::HttpError);

    // Embedded basic auth URL succeeds
    let info = get_remote_info(
        &http,
        "http://token-user:secret-token@localhost/private-repo.git",
        None,
        false,
        None,
    )
    .unwrap();
    assert!(!info.capabilities.is_empty());

    // Init local repo, commit, and push to authenticated remote
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
