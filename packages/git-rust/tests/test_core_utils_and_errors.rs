use std::collections::{BTreeMap, BTreeSet};

use git_rust::errors::{ErrorCode, ErrorDataValue, GitError};
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::fs::{FsError, MemoryFs, discover_gitdir, mkdirp};
use git_rust::utils::{
    ExtractedAuth, ServerRef, apply_delta, extract_auth_from_url,
    flat_file_list_to_directory_structure, format_info_refs, is_binary, join, merge_file,
    split_lines,
};
use git_rust::version;

fn varint_le(mut n: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = (n & 0x7f) as u8;
        n >>= 7;
        if n != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if n == 0 {
            break;
        }
    }
    bytes
}

// === test-GitError.js & test-GitError-in-submodule.js ===
#[test]
fn test_git_error_static_codes_and_constructors() {
    for code in ErrorCode::ALL {
        assert!(!code.as_str().is_empty());
        assert_eq!(code.to_string(), code.as_str());
    }

    let e = GitError::not_found("foobar.txt");
    assert_eq!(e.code, ErrorCode::NotFoundError);
    assert_eq!(e.code.as_str(), "NotFoundError");
    assert_eq!(e.caller, "");
    assert_eq!(e.message, "Could not find foobar.txt.");
    assert_eq!(
        e.data.get("what"),
        Some(&ErrorDataValue::Str("foobar.txt".to_string()))
    );

    let internal = GitError::internal("Something unexpected happened.");
    assert!(
        internal
            .message
            .contains("If you're using an application that depends on git-rust")
    );
    assert!(
        internal
            .message
            .contains("If you're a developer and you believe this is a bug in git")
    );
    assert!(internal.message.contains("Something unexpected happened."));
}

#[test]
fn test_git_error_in_submodule() {
    let _sm = make_fixture_as_submodule("test-init");
    test_git_error_static_codes_and_constructors();
}

// === test-applyDelta-bounded-allocation.js ===
#[test]
fn test_apply_delta_valid_multi_op() {
    let mut delta = Vec::new();
    delta.extend_from_slice(&varint_le(0));
    delta.extend_from_slice(&varint_le(2));
    delta.extend_from_slice(&[0x01, 0x61, 0x01, 0x62]);
    let res = apply_delta(&delta, &[]).unwrap();
    assert_eq!(String::from_utf8(res).unwrap(), "ab");
}

#[test]
fn test_apply_delta_bounded_allocation_throws_without_allocating_header_size() {
    let mut delta = Vec::new();
    delta.extend_from_slice(&varint_le(0));
    delta.extend_from_slice(&varint_le(0x7fffffff));
    delta.extend_from_slice(&[0x01, 0x00]);
    let res = apply_delta(&delta, &[]);
    assert!(res.is_err());
}

// === test-utils-extractAuthFromUrl.js ===
#[test]
fn test_extract_auth_from_url() {
    let r = extract_auth_from_url("https://github.com/git/git.git");
    assert_eq!(
        r.url,
        "https://github.com/git/git.git"
    );
    assert_eq!(r.auth, ExtractedAuth::default());

    let r = extract_auth_from_url("https://user:pass@github.com/owner/repo.git");
    assert_eq!(r.url, "https://github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("user".into()),
            password: Some("pass".into()),
        }
    );

    let r = extract_auth_from_url("https://user:pa:ss:word@github.com/owner/repo.git");
    assert_eq!(r.url, "https://github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("user".into()),
            password: Some("pa:ss:word".into()),
        }
    );

    let r = extract_auth_from_url("https://token@github.com/owner/repo.git");
    assert_eq!(r.url, "https://github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("token".into()),
            password: None,
        }
    );

    let r = extract_auth_from_url("https://user:@github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("user".into()),
            password: Some("".into()),
        }
    );

    let r = extract_auth_from_url("HTTPS://user:pass@github.com/owner/repo.git");
    assert_eq!(r.url, "HTTPS://github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("user".into()),
            password: Some("pass".into()),
        }
    );

    let r = extract_auth_from_url("https://us%40er:100%25@github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("us@er".into()),
            password: Some("100%".into()),
        }
    );

    let r = extract_auth_from_url("https://user:100%@github.com/owner/repo.git");
    assert_eq!(
        r.auth,
        ExtractedAuth {
            username: Some("user".into()),
            password: Some("100%".into()),
        }
    );

    for (given, expected) in [
        (
            "https://user:pass@github.com:443/owner/repo.git",
            "https://github.com:443/owner/repo.git",
        ),
        (
            "https://user:pass@GitHub.com/owner/repo.git",
            "https://GitHub.com/owner/repo.git",
        ),
        ("https://user:pass@github.com", "https://github.com"),
        (
            "https://user:pass@github.com/owner/repo.git?a=b#c",
            "https://github.com/owner/repo.git?a=b#c",
        ),
    ] {
        assert_eq!(extract_auth_from_url(given).url, expected);
    }

    for url in [
        "https://github.com?account=user@example.com",
        "https://github.com#user@example.com",
    ] {
        let extracted = extract_auth_from_url(url);
        assert_eq!(extracted.url, url);
        assert_eq!(extracted.auth, ExtractedAuth::default());
    }
}

// === test-utils-formatInfoRefs.js ===
#[test]
fn test_format_info_refs() {
    let refs = vec![
        ("refs/tags/v1".to_string(), "aaaaaaa".to_string()),
        ("refs/tags/v1^{}".to_string(), "bbbbbbb".to_string()),
    ];
    let symrefs = BTreeMap::new();

    assert_eq!(
        format_info_refs(&refs, &symrefs, "", false, true),
        vec![ServerRef {
            r#ref: "refs/tags/v1".into(),
            oid: "aaaaaaa".into(),
            target: None,
            peeled: Some("bbbbbbb".into()),
        }]
    );

    assert_eq!(
        format_info_refs(&refs, &symrefs, "", false, false),
        vec![ServerRef {
            r#ref: "refs/tags/v1".into(),
            oid: "aaaaaaa".into(),
            target: None,
            peeled: None,
        }]
    );

    assert_eq!(
        format_info_refs(&refs, &symrefs, "refs/tags/v1^", false, true),
        vec![]
    );
}

// === test-utils-join.js & test-utils-join-in-submodule.js ===
#[test]
fn test_utils_join() {
    assert_eq!(join(&["foo", "bar", "baz"]), "foo/bar/baz");
    assert_eq!(join(&["/foo", "bar", "../baz"]), "/foo/baz");
    assert_eq!(join(&["foo", "/bar"]), "foo/bar");
    assert_eq!(join(&["C:\\foo\\bar", "baz"]), "C:/foo/bar/baz");
    assert_eq!(
        join(&["/repo/worktree/.git", "C:/repo/.git/worktrees/wt"]),
        "C:/repo/.git/worktrees/wt"
    );
    assert_eq!(join(&[]), ".");
}

#[test]
fn test_utils_join_in_submodule() {
    let _sm = make_fixture_as_submodule("test-init");
    test_utils_join();
}

// === test-utils-mkdirp.js ===
#[test]
fn test_utils_mkdirp_all_cases() {
    // 1. creates all missing parent directories & 2. idempotent
    let mut dirs: BTreeSet<String> = BTreeSet::from(["".to_string()]);
    mkdirp(
        |filepath| {
            let parent = &filepath[..filepath.rfind('/').unwrap_or(0)];
            if !dirs.contains(parent) {
                return Err(FsError::new("ENOENT", "ENOENT"));
            }
            if dirs.contains(filepath) {
                return Err(FsError::new("EEXIST", "EEXIST"));
            }
            dirs.insert(filepath.to_string());
            Ok(())
        },
        "/a/b/c",
        10,
    )
    .unwrap();
    assert!(dirs.contains("/a"));
    assert!(dirs.contains("/a/b"));
    assert!(dirs.contains("/a/b/c"));

    // Idempotent second call
    mkdirp(
        |filepath| {
            let parent = &filepath[..filepath.rfind('/').unwrap_or(0)];
            if !dirs.contains(parent) {
                return Err(FsError::new("ENOENT", "ENOENT"));
            }
            if dirs.contains(filepath) {
                return Err(FsError::new("EEXIST", "EEXIST"));
            }
            dirs.insert(filepath.to_string());
            Ok(())
        },
        "/a/b",
        10,
    )
    .unwrap();

    // 3. retries transient ENOENT
    let mut dirs2: BTreeSet<String> = BTreeSet::from(["".to_string()]);
    let mut flaky = 3usize;
    mkdirp(
        |filepath| {
            if filepath == "/a/b" && dirs2.contains("/a") && flaky > 0 {
                flaky -= 1;
                return Err(FsError::new("ENOENT", "ENOENT"));
            }
            let parent = &filepath[..filepath.rfind('/').unwrap_or(0)];
            if !dirs2.contains(parent) {
                return Err(FsError::new("ENOENT", "ENOENT"));
            }
            if dirs2.contains(filepath) {
                return Err(FsError::new("EEXIST", "EEXIST"));
            }
            dirs2.insert(filepath.to_string());
            Ok(())
        },
        "/a/b",
        10,
    )
    .unwrap();
    assert!(dirs2.contains("/a/b"));
    assert_eq!(flaky, 0);

    // 4. honors retry limit when too few
    let mut dirs3: BTreeSet<String> = BTreeSet::from(["".to_string()]);
    let mut remaining = 3usize;
    let err = mkdirp(
        |filepath| {
            if filepath == "/a/b" && dirs3.contains("/a") && remaining > 0 {
                remaining -= 1;
                return Err(FsError::new("ENOENT", "ENOENT"));
            }
            let parent = &filepath[..filepath.rfind('/').unwrap_or(0)];
            if !dirs3.contains(parent) {
                return Err(FsError::new("ENOENT", "ENOENT"));
            }
            dirs3.insert(filepath.to_string());
            Ok(())
        },
        "/a/b/c",
        1,
    )
    .unwrap_err();
    assert_eq!(err.code, "ENOENT");

    // 5. propagates EACCES immediately
    let err = mkdirp(|_| Err(FsError::new("EACCES", "EACCES")), "/a", 10).unwrap_err();
    assert_eq!(err.code, "EACCES");

    // 6. treats null error as success
    mkdirp(|_| Err(FsError::new("NULL", "")), "/a", 10).unwrap();
}

// === test-utils-splitLines.js ===
#[test]
fn test_utils_split_lines() {
    assert_eq!(
        split_lines("a\nb\r\nc\rd"),
        vec!["a\n", "b\r\n", "c\r", "d"]
    );
    assert!(split_lines("").is_empty());
}

// === test-version.js & test-version-in-submodule.js ===
#[test]
fn test_version() {
    assert_eq!(version(), "0.0.0-development");
    let _sm = make_fixture_as_submodule("test-init");
    assert_eq!(version(), "0.0.0-development");
}

// === test-isBinary.js & test-isBinary-in-submodule.js ===
#[test]
fn test_is_binary() {
    let f = make_fixture("test-isBinary");
    for name in f.fs.readdir(&f.dir).unwrap() {
        let bytes = f.fs.read(&format!("{}/{name}", f.dir)).unwrap();
        if name.ends_with(".png") || name.ends_with(".gz") || name.ends_with(".zip") {
            assert!(is_binary(&bytes), "expected {name} to be binary");
        } else if name.ends_with(".txt") || name.ends_with(".js") || name.ends_with(".json") {
            assert!(!is_binary(&bytes), "expected {name} to be non-binary");
        }
    }
}

#[test]
fn test_is_binary_in_submodule() {
    let sm = make_fixture_as_submodule("test-isBinary");
    for name in sm.fs.readdir(&sm.dir).unwrap() {
        if name == ".git" {
            continue;
        }
        let bytes = sm.fs.read(&format!("{}/{name}", sm.dir)).unwrap();
        if name.ends_with(".png") || name.ends_with(".gz") || name.ends_with(".zip") {
            assert!(is_binary(&bytes), "expected {name} to be binary");
        }
    }
}

// === test-flatFileListToDirectoryStructure.js & in-submodule ===
#[test]
fn test_flat_file_list_to_directory_structure() {
    let files = vec![
        ("src/index.js".to_string(), 1),
        ("src/commands/init.js".to_string(), 2),
        ("test/test-init.js".to_string(), 3),
    ];
    let nodes = flat_file_list_to_directory_structure(&files);
    assert!(nodes.contains_key("."));
    assert!(nodes.contains_key("src"));
    assert!(nodes.contains_key("src/commands"));
    assert!(nodes.contains_key("src/commands/init.js"));
    assert_eq!(nodes["src/commands/init.js"].node_type, "blob");
    assert_eq!(nodes["src/commands"].node_type, "tree");
    assert_eq!(nodes["."].children, vec!["src".to_string(), "test".to_string()]);
}

// === test-mergeFile.js & test-mergeFile-in-submodule.js ===
#[test]
fn test_merge_file_a_o_b_and_a_o_c() {
    let f = make_fixture("test-mergeFile");
    let our_content = f.fs.read_str(&format!("{}/a.txt", f.dir)).unwrap();
    let base_content = f.fs.read_str(&format!("{}/o.txt", f.dir)).unwrap();
    let their_b = f.fs.read_str(&format!("{}/b.txt", f.dir)).unwrap();
    let expected_aob = f.fs.read_str(&format!("{}/aob.txt", f.dir)).unwrap();

    let res = merge_file(
        ["base", "ours", "theirs"],
        [&base_content, &our_content, &their_b],
    );
    assert!(res.clean_merge);
    assert_eq!(res.merged_text, expected_aob);

    let their_c = f.fs.read_str(&format!("{}/c.txt", f.dir)).unwrap();
    let expected_aoc = f.fs.read_str(&format!("{}/aoc.txt", f.dir)).unwrap();
    let res_conflict = merge_file(
        ["base", "ours", "theirs"],
        [&base_content, &our_content, &their_c],
    );
    assert!(!res_conflict.clean_merge);
    assert_eq!(res_conflict.merged_text, expected_aoc);
}

#[test]
fn test_merge_file_in_submodule() {
    let sm = make_fixture_as_submodule("test-mergeFile");
    let our_content = sm.fs.read_str(&format!("{}/a.txt", sm.dir)).unwrap();
    let base_content = sm.fs.read_str(&format!("{}/o.txt", sm.dir)).unwrap();
    let their_b = sm.fs.read_str(&format!("{}/b.txt", sm.dir)).unwrap();
    let expected_aob = sm.fs.read_str(&format!("{}/aob.txt", sm.dir)).unwrap();
    let res = merge_file(
        ["base", "ours", "theirs"],
        [&base_content, &our_content, &their_b],
    );
    assert!(res.clean_merge);
    assert_eq!(res.merged_text, expected_aob);
}

// === test-discoverGitdir-worktree.js ===
#[test]
fn test_discover_gitdir_worktree_and_submodule() {
    let fs = MemoryFs::new();
    let dotgit = "/tmp/repo/.git";
    fs.mkdir(dotgit).unwrap();
    assert_eq!(discover_gitdir(&fs, dotgit), dotgit);

    let submodule_dotgit = "/tmp/repo/mysubmodule/.git";
    fs.write_str(submodule_dotgit, "gitdir: ../.git/modules/mysubmodule\n");
    assert_eq!(
        discover_gitdir(&fs, submodule_dotgit),
        "/tmp/repo/.git/modules/mysubmodule"
    );

    let worktree_dotgit = "/tmp/my-worktree/.git";
    let main_gitdir = "/tmp/main-repo/.git/worktrees/my-worktree";
    fs.mkdir(main_gitdir).unwrap();
    fs.write_str(worktree_dotgit, &format!("gitdir: {main_gitdir}\n"));
    assert_eq!(discover_gitdir(&fs, worktree_dotgit), main_gitdir);
}
