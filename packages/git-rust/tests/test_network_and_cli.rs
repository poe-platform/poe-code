use git_rust::commands::network::{
    clone, fetch, get_remote_info, get_remote_info2, list_server_refs, pull, push, NestedMap,
};
use git_rust::commands::plumbing::set_config;
use git_rust::fixtures::FixtureEnv;
use git_rust::models::GitPktLine;
use git_rust::utils::{join, Author};
use git_rust::{
    execute_git_cli_with_http, list_branches, make_fixture, make_fixture_as_submodule, mkdirp,
    resolve_ref, ErrorCode, MemoryFs, MockHttpServer,
};

fn load_fixture(name: &str, as_submodule: bool) -> FixtureEnv {
    if as_submodule {
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

#[test]
fn test_get_remote_info_v1_v2_and_list_server_refs() {
    let server = MockHttpServer::new();

    // 1. getRemoteInfo v1
    let info = get_remote_info(
        &server,
        "http://localhost:8888/test-dumb-http-server.git",
        None,
        false,
        None,
    )
    .unwrap();
    assert!(!info.capabilities.is_empty());
    if let Some(NestedMap::Map(heads)) = info.refs.get("heads") {
        assert_eq!(
            heads.get("master"),
            Some(&NestedMap::Leaf(
                "97c024f73eaab2781bf3691597bc7c833cb0e22f".to_string()
            ))
        );
        assert_eq!(
            heads.get("test"),
            Some(&NestedMap::Leaf(
                "5a8905a02e181fe1821068b8c0f48cb6633d5b81".to_string()
            ))
        );
    } else {
        panic!("expected heads map in get_remote_info");
    }

    // Dumb HTTP detection -> SmartHttpError
    let dumb_err = get_remote_info(
        &server,
        "http://localhost:9876/base/__tests__/__fixtures__/test-dumb-http-server.git",
        None,
        false,
        None,
    )
    .unwrap_err();
    assert_eq!(dumb_err.code, ErrorCode::SmartHttpError);

    // SCP-like syntax -> UnknownTransportError
    let scp_err = get_remote_info(
        &server,
        "git@github.com:isomorphic-git/isomorphic-git.git",
        None,
        false,
        None,
    )
    .unwrap_err();
    assert_eq!(scp_err.code, ErrorCode::UnknownTransportError);

    // Malicious ref advertisement -> UnsafeFilepathError
    let mut malicious_ad = Vec::new();
    malicious_ad.extend_from_slice(&GitPktLine::encode_str("# service=git-upload-pack\n"));
    malicious_ad.extend_from_slice(&GitPktLine::flush());
    malicious_ad.extend_from_slice(&GitPktLine::encode_str(
        "97c024f73eaab2781bf3691597bc7c833cb0e22f refs/heads/../../escaped\0side-band-64k\n",
    ));
    malicious_ad.extend_from_slice(&GitPktLine::flush());
    server.set_custom_advertisement("hostile-repo", malicious_ad);
    let hostile_err = get_remote_info(
        &server,
        "http://localhost:8888/hostile-repo.git",
        None,
        false,
        None,
    )
    .unwrap_err();
    assert_eq!(hostile_err.code, ErrorCode::UnsafeFilepathError);

    // 2. getRemoteInfo2 protocol 1 and protocol 2
    let info2_v2 = get_remote_info2(
        &server,
        "http://localhost:8888/test-dumb-http-server.git",
        None,
        false,
        2,
        None,
    )
    .unwrap();
    assert_eq!(info2_v2.protocol_version, 2);
    assert!(info2_v2.capabilities.contains_key("ls-refs"));
    assert!(info2_v2.capabilities.contains_key("fetch"));

    let info2_v1 = get_remote_info2(
        &server,
        "http://localhost:8888/test-dumb-http-server.git",
        None,
        false,
        1,
        None,
    )
    .unwrap();
    assert_eq!(info2_v1.protocol_version, 1);
    let refs_v1 = info2_v1.refs.unwrap();
    assert!(refs_v1.iter().any(|r| r.r#ref == "HEAD" && r.target.as_deref() == Some("refs/heads/master")));
    assert!(refs_v1.iter().any(|r| r.r#ref == "refs/heads/master"));

    // 3. listServerRefs (protocol 1 & 2, symrefs, peel_tags, prefix)
    for proto in [1u8, 2u8] {
        let refs = list_server_refs(
            &server,
            "http://localhost:8888/test-listServerRefs.git",
            None,
            false,
            proto,
            Some("refs/tags/"),
            true,
            true,
            None,
        )
        .unwrap();
        assert!(!refs.is_empty());
        assert!(refs.iter().all(|r| r.r#ref.starts_with("refs/tags/")));
    }
}

#[test]
fn test_fetch_clone_pull_and_push_with_submodules() {
    for is_sub in [false, true] {
        let server = MockHttpServer::new();

        // 1. fetch
        let f_fetch = load_fixture("test-fetch", is_sub);
        let fetch_res = fetch(
            &f_fetch.fs,
            &server,
            Some(&f_fetch.dir),
            Some(&f_fetch.gitdir),
            Some("http://localhost:8888/test-fetch-server.git"),
            Some("origin"),
            Some("master"),
            true,
            true,
            None,
            false,
            Some("http://localhost:9999"),
            None,
        )
        .unwrap();
        assert!(fetch_res.fetch_head.is_some());

        // 2. clone
        let clone_fs = MemoryFs::new();
        let clone_dir = if is_sub { "/clone-sub/sub" } else { "/clone-dir" };
        clone(
            &clone_fs,
            &server,
            clone_dir,
            None,
            "http://localhost:8888/test-dumb-http-server.git",
            Some("http://localhost:9999"),
            Some("master"),
            true,
            false,
            false,
            Some("origin"),
            None,
            None,
        )
        .unwrap();
        let cloned_branches = list_branches(&clone_fs, &join(&[clone_dir, ".git"]), None);
        assert!(cloned_branches.contains(&"master".to_string()));

        // 3. pull
        let f_pull = load_fixture("test-pull", is_sub);
        set_config(
            &f_pull.fs,
            &f_pull.gitdir,
            "remote.origin.url",
            Some("http://localhost:8888/test-pull-server.git"),
            false,
        )
        .unwrap();
        pull(
            &f_pull.fs,
            &server,
            &f_pull.dir,
            Some(&f_pull.gitdir),
            Some("master"),
            Some("http://localhost:8888/test-pull-server.git"),
            Some("origin"),
            true,
            true,
            false,
            None,
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
            None,
        )
        .unwrap();

        // 4. push (matching test-push.js)
        let f_push = load_fixture("test-push", is_sub);
        set_config(
            &f_push.fs,
            &f_push.gitdir,
            "remote.karma.url",
            Some("http://localhost:8888/test-push-server.git"),
            false,
        )
        .unwrap();
        let mut output = Vec::new();
        let mut cb = |msg: String| output.push(msg);
        let push_res = push(
            &f_push.fs,
            &server,
            Some(&f_push.dir),
            Some(&f_push.gitdir),
            Some("refs/heads/master"),
            None,
            Some("karma"),
            None,
            false,
            false,
            None,
            None,
            Some(&mut cb),
        )
        .unwrap();
        assert!(push_res.ok);
        assert!(push_res.refs.get("refs/heads/master").unwrap().ok);
        assert_eq!(
            output,
            vec![
                "build started...\n",
                "build completed...\n",
                "tests started...\n",
                "tests completed...\n",
                "starting server...\n",
            ]
        );
    }
}

#[test]
fn test_safe_bash_git_cli_end_to_end() {
    let server = MockHttpServer::new();
    let fs = MemoryFs::new();
    let cwd = "/workspace/project";
    mkdirp(|p| fs.mkdir(p), cwd, 5).unwrap();

    // git --version
    let ver = execute_git_cli_with_http(&fs, cwd, &["--version"], &server);
    assert_eq!(ver.exit_code, 0);
    assert!(ver.stdout.starts_with("git version "));

    // git init
    let init_res = execute_git_cli_with_http(&fs, cwd, &["init"], &server);
    assert_eq!(init_res.exit_code, 0);

    // git config
    execute_git_cli_with_http(&fs, cwd, &["config", "user.name", "Safe Bash"], &server);
    execute_git_cli_with_http(&fs, cwd, &["config", "user.email", "bash@poe.com"], &server);
    let cfg_res = execute_git_cli_with_http(&fs, cwd, &["config", "user.name"], &server);
    assert_eq!(cfg_res.stdout, "Safe Bash\n");

    // Create file, status -s, add, commit
    fs.write_str(&join(&[cwd, "README.md"]), "# Hello Git Rust\n");
    let st1 = execute_git_cli_with_http(&fs, cwd, &["status", "-s"], &server);
    assert_eq!(st1.stdout, "?? README.md\n");

    assert_eq!(
        execute_git_cli_with_http(&fs, cwd, &["add", "README.md"], &server).exit_code,
        0
    );
    let c1 = execute_git_cli_with_http(&fs, cwd, &["commit", "-m", "Initial commit"], &server);
    assert_eq!(c1.exit_code, 0);

    // git log --oneline &ls-files & rev-parse
    let log_res = execute_git_cli_with_http(&fs, cwd, &["log", "--oneline"], &server);
    assert!(log_res.stdout.contains("Initial commit"));
    let ls_res = execute_git_cli_with_http(&fs, cwd, &["ls-files"], &server);
    assert_eq!(ls_res.stdout, "README.md\n");
    let rp_res = execute_git_cli_with_http(&fs, cwd, &["rev-parse", "HEAD"], &server);
    assert_eq!(rp_res.stdout.trim().len(), 40);

    // git checkout -b feature, modify, commit, checkout master, merge feature
    assert_eq!(
        execute_git_cli_with_http(&fs, cwd, &["checkout", "-b", "feature"], &server).exit_code,
        0
    );
    fs.write_str(&join(&[cwd, "feature.txt"]), "feature work\n");
    execute_git_cli_with_http(&fs, cwd, &["add", "feature.txt"], &server);
    execute_git_cli_with_http(&fs, cwd, &["commit", "-m", "Add feature"], &server);

    execute_git_cli_with_http(&fs, cwd, &["checkout", "master"], &server);
    let merge_res = execute_git_cli_with_http(&fs, cwd, &["merge", "feature"], &server);
    assert_eq!(merge_res.exit_code, 0);
    assert!(fs.exists(&join(&[cwd, "feature.txt"])));

    // Register repo on MockHttpServer and test git clone via CLI
    let head_oid = resolve_ref(&fs, &join(&[cwd, ".git"]), "HEAD", None).unwrap();
    server.register_repo("project", fs.clone(), &join(&[cwd, ".git"]));
    let clone_res = execute_git_cli_with_http(
        &fs,
        "/workspace",
        &["clone", "http://localhost:8888/project.git", "/workspace/cloned"],
        &server,
    );
    assert_eq!(clone_res.exit_code, 0);
    let cloned_head = resolve_ref(&fs, "/workspace/cloned/.git", "HEAD", None).unwrap();
    assert_eq!(cloned_head, head_oid);
}
