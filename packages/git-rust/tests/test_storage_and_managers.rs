
use git_rust::fixtures::FixtureEnv;
fn load_fixture(name: &str, is_sub: bool) -> FixtureEnv {
    if is_sub {
        let sub = make_fixture_as_submodule(name);
        FixtureEnv { fs: sub.fs, dir: sub.dir, gitdir: sub.gitdir }
    } else {
        make_fixture(name)
    }
}

use std::collections::BTreeMap;

use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::managers::{GitRefManager, GitRemoteManager};
use git_rust::models::CommitObject;
use git_rust::storage::{expand_oid, read_object, write_object, ParsedObject};
use git_rust::utils::{join, Author};
use git_rust::{
    current_branch, delete_ref, is_ignored, list_refs, list_tags, resolve_ref, write_ref,
};

#[test]
fn test_git_ref_manager_and_in_submodule() {
    for is_sub in [false, true] {
        let f = load_fixture("test-GitRefManager", is_sub);
        let refs = GitRefManager::packed_refs(&f.fs, &f.gitdir);
        assert_eq!(
            refs.get("refs/remotes/origin/develop").map(|s| s.as_str()),
            Some("dba5b92408549e55c36e16c89e2b4a4e4cbc8c8f")
        );
        assert_eq!(
            refs.get("refs/tags/v0.1.0").map(|s| s.as_str()),
            Some("dba5b92408549e55c36e16c89e2b4a4e4cbc8c8f")
        );

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

        let tag_refs = GitRefManager::list_refs(&f.fs, &f.gitdir, "refs/tags");
        assert_eq!(tag_refs.first().map(|s| s.as_str()), Some("local-tag"));
        assert!(tag_refs.contains(&"v0.0.10^{}".to_string()));
        assert_eq!(tag_refs.last().map(|s| s.as_str()), Some("v0.1.0"));

        assert_eq!(
            GitRefManager::list_branches(&f.fs, &f.gitdir, None),
            Vec::<String>::new()
        );
        assert_eq!(
            GitRefManager::list_branches(&f.fs, &f.gitdir, Some("origin")),
            origin_refs
        );

        let tags = GitRefManager::list_tags(&f.fs, &f.gitdir);
        assert!(!tags.iter().any(|t| t.ends_with("^{}")));
        assert!(tags.contains(&"v0.0.10".to_string()));
    }

    // Security / system file tests
    let f = make_fixture("test-checkout");
    let oid = "e10ebb90d03eaacca84de1af0a59b444232da99e";
    let before = f.fs.read(&format!("{}/index", f.gitdir)).unwrap();
    for sys_ref in ["config", "index", "shallow"] {
        let err = GitRefManager::write_ref(&f.fs, &f.gitdir, sys_ref, oid).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidRefNameError);
        let err2 = GitRefManager::expand(&f.fs, &f.gitdir, sys_ref).unwrap_err();
        assert_eq!(err2.code, ErrorCode::NotFoundError);
    }
    assert_eq!(
        GitRefManager::delete_refs(&f.fs, &f.gitdir, &["index".to_string()])
            .unwrap_err()
            .code,
        ErrorCode::InvalidRefNameError
    );
    assert_eq!(f.fs.read(&format!("{}/index", f.gitdir)).unwrap(), before);

    // GHSA-h3c3-jh3g-8hcc traversal & system file refspec guards
    let mut remote_refs = BTreeMap::new();
    remote_refs.insert("refs/heads/main".to_string(), oid.to_string());
    assert_eq!(
        GitRefManager::update_remote_refs(
            &f.fs,
            &f.gitdir,
            "origin",
            &remote_refs,
            &BTreeMap::new(),
            false,
            Some(&["+refs/heads/main:index".to_string()]),
            false,
            false
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidRefNameError
    );

    let mut bad_tag_refs = BTreeMap::new();
    bad_tag_refs.insert(
        "refs/tags/../../../GHSA-h3c3-jh3g-8hcc-poc-tag".to_string(),
        oid.to_string(),
    );
    assert_eq!(
        GitRefManager::update_remote_refs(
            &f.fs,
            &f.gitdir,
            "origin",
            &bad_tag_refs,
            &BTreeMap::new(),
            true,
            Some(&["+refs/heads/*:refs/remotes/origin/*".to_string()]),
            false,
            false
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidRefNameError
    );
    assert!(!f.fs.exists(&join(&[&f.gitdir, "..", "GHSA-h3c3-jh3g-8hcc-poc-tag"])));

    let mut bad_symrefs = BTreeMap::new();
    bad_symrefs.insert(
        "HEAD".to_string(),
        "refs/heads/../../../../GHSA-h3c3-jh3g-8hcc-poc-symref".to_string(),
    );
    assert_eq!(
        GitRefManager::update_remote_refs(
            &f.fs,
            &f.gitdir,
            "origin",
            &BTreeMap::new(),
            &bad_symrefs,
            false,
            Some(&[
                "+HEAD:refs/remotes/origin/HEAD".to_string(),
                "+refs/heads/*:refs/remotes/origin/*".to_string()
            ]),
            false,
            false
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidRefNameError
    );
}

#[test]
fn test_git_ref_manager_symref_cycle() {
    let f = make_fixture("test-GitRefManager-symref-cycle");
    f.fs.write_str(
        &format!("{}/refs/remotes/origin/a", f.gitdir),
        "ref: refs/remotes/origin/b\n",
    );
    f.fs.write_str(
        &format!("{}/refs/remotes/origin/b", f.gitdir),
        "ref: refs/remotes/origin/a\n",
    );

    let err = GitRefManager::resolve(&f.fs, &f.gitdir, "refs/remotes/origin/a", None).unwrap_err();
    assert!(err.message.to_lowercase().contains("circular"));

    let f_ok = make_fixture("test-GitRefManager-symref-ok");
    let sha = "0123456789abcdef0123456789abcdef01234567";
    f_ok.fs
        .write_str(&format!("{}/refs/heads/main", f_ok.gitdir), &format!("{sha}\n"));
    f_ok.fs
        .write_str(&format!("{}/HEAD", f_ok.gitdir), "ref: refs/heads/main\n");
    assert_eq!(
        GitRefManager::resolve(&f_ok.fs, &f_ok.gitdir, "HEAD", None).unwrap(),
        sha
    );
}

#[test]
fn test_git_remote_manager() {
    assert_eq!(
        GitRemoteManager::get_remote_helper_for("http://github.com/git-repo")
            .unwrap()
            .transport,
        "http"
    );
    assert_eq!(
        GitRemoteManager::get_remote_helper_for(
            "http::https://github.com/git-repo"
        )
        .unwrap()
        .transport,
        "http"
    );
    assert_eq!(
        GitRemoteManager::get_remote_helper_for("https://github.com/git-repo")
            .unwrap()
            .transport,
        "https"
    );
    assert_eq!(
        GitRemoteManager::get_remote_helper_for(
            "hypergit://5701a1c08ae15dba17e181b1a9a28bdfb8b95200d77a25be6051bb018e25439a"
        )
        .unwrap_err()
        .code,
        ErrorCode::UnknownTransportError
    );
    assert_eq!(
        GitRemoteManager::get_remote_helper_for("oid::c3c2a92aa2bda58d667cb57493270b83bd14d1ed")
            .unwrap_err()
            .code,
        ErrorCode::UnknownTransportError
    );
    assert_eq!(
        GitRemoteManager::get_remote_helper_for("oid:c3c2a92aa2bda58d667cb57493270b83bd14d1ed")
            .unwrap_err()
            .code,
        ErrorCode::UrlParseError
    );

    for url in [
        "git@github.com:owner/repo.git",
        "gitolite@git.example.com:team/repo.git",
        "ubuntu@10.0.0.5:repo.git",
    ] {
        let err = GitRemoteManager::get_remote_helper_for(url).unwrap_err();
        assert_eq!(err.code, ErrorCode::UnknownTransportError);
    }
}

#[test]
fn test_read_object_and_write_object_and_in_submodule() {
    for is_sub in [false, true] {
        let f = load_fixture("test-readObject", is_sub);

        let parsed_res = read_object(
            &f.fs,
            &f.gitdir,
            "e10ebb90d03eaacca84de1af0a59b444232da99e",
            Some("parsed"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(parsed_res.format, "parsed");
        assert_eq!(parsed_res.obj_type, "commit");
        assert_eq!(
            parsed_res.source.as_deref(),
            Some("objects/e1/0ebb90d03eaacca84de1af0a59b444232da99e")
        );

        let content_res = read_object(
            &f.fs,
            &f.gitdir,
            "e10ebb90d03eaacca84de1af0a59b444232da99e",
            Some("content"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(content_res.format, "content");
        assert_eq!(content_res.obj_type, "commit");

        let wrapped_res = read_object(
            &f.fs,
            &f.gitdir,
            "e10ebb90d03eaacca84de1af0a59b444232da99e",
            Some("wrapped"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(wrapped_res.format, "wrapped");

        let deflated_res = read_object(
            &f.fs,
            &f.gitdir,
            "e10ebb90d03eaacca84de1af0a59b444232da99e",
            Some("deflated"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(deflated_res.format, "deflated");

        // Packed object with filepath to blob
        let blob_res = read_object(
            &f.fs,
            &f.gitdir,
            "be1e63da44b26de8877a184359abace1cddcb739",
            Some("parsed"),
            Some("cli.js"),
            None,
        )
        .unwrap();
        assert_eq!(blob_res.format, "content");
        assert_eq!(blob_res.obj_type, "blob");
        assert_eq!(blob_res.oid, "4551a1856279dde6ae9d65862a1dff59a5f199d8");
        assert_eq!(
            blob_res.source.as_deref(),
            Some("objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.pack")
        );

        // Deep filepath to blob
        let deep_blob = read_object(
            &f.fs,
            &f.gitdir,
            "be1e63da44b26de8877a184359abace1cddcb739",
            Some("parsed"),
            Some("src/commands/clone.js"),
            None,
        )
        .unwrap();
        assert_eq!(deep_blob.oid, "5264f23285d8be3ce45f95c102001ffa1d5391d3");

        // Simple filepath to tree
        let tree_res = read_object(
            &f.fs,
            &f.gitdir,
            "be1e63da44b26de8877a184359abace1cddcb739",
            Some("parsed"),
            Some(""),
            None,
        )
        .unwrap();
        assert_eq!(tree_res.format, "parsed");
        assert_eq!(tree_res.obj_type, "tree");
        assert_eq!(tree_res.oid, "6257985e3378ec42a03a57a7dc8eb952d69a5ff3");
    }

    // writeObject tests
    let fw = make_fixture("test-writeObject");
    let commit_obj = CommitObject {
        message: "Improve resolveRef to handle more kinds of refs. Add tests\n".to_string(),
        tree: "e0b8f3574060ee24e03e4af3896f65dd208a60cc".to_string(),
        parent: vec!["b4f8206d9e359416b0f34238cbeb400f7da889a8".to_string()],
        author: Author {
            name: "Will Hilton".to_string(),
            email: "wmhilton@gmail.com".to_string(),
            timestamp: 1502484200,
            timezone_offset: 240.0,
        },
        committer: Author {
            name: "Will Hilton".to_string(),
            email: "wmhilton@gmail.com".to_string(),
            timestamp: 1502484200,
            timezone_offset: 240.0,
        },
        gpgsig: Some(
            "-----BEGIN PGP SIGNATURE-----\nVersion: GnuPG v1\n\niQIcBAABAgAGBQJZjhboAAoJEJYJuKWSi6a5V5UP/040SfemJ13PRBXst2eB59gs\n3hPx29DRKBhFtvk+uS+8523/hUfry2oeWWd6YRkcnkxxAUtBnfzVkI9AgRIc1NTM\nh5XtLMQubCAKw8JWvVvoXETzwVAODmdmvC4WSQCLu+opoe6/W7RvkrTD0pbkwH4E\nMXoha59sIWZ/FacZX6ByYqhFykfJL8gCFvRSzjiqBIbsP7Xq2Mh4jkAKYl5zxV3u\nqCk26hnhL++kwfXlu2YdGtB9+lj3pk1NeWqR379zRzh4P10FxXJ18qSxczbkAFOY\n6o5h7a/Mql1KqWB9EFBupCpjydmpAtPo6l1Us4a3liB5LJvCh9xgR2HtShR4b97O\nnIpXP4ngy4z9UyrXXxxpiQQn/kVn/uKgtvGp8nOFioo61PCi9js2QmQxcsuBOeO+\nDdFq5k2PMNZLwizt4P8EGfVJoPbLhdYP4oWiMCuYV/2fNh0ozl/q176HGszlfrke\n332Z0maJ3A5xIRj0b7vRNHV8AAl9Dheo3LspjeovP2iycCHFP03gSpCKdLRBRC4T\nX10BBFD8noCMXJxb5qenrf+eKRd8d4g7JtcyzqVgkBQ68GIG844VWRBolOzx4By5\ncAaw/SYIZG3RorAc11iZ7sva0jFISejmEzIebuChSzdWO2OOWRVvMdhyZwDLUgAb\nQixh2bmPgr3h9nxq2Dmn\n=4+DN\n-----END PGP SIGNATURE-----"
                .to_string(),
        ),
    };
    let oid = write_object(
        &fw.fs,
        &fw.gitdir,
        "commit",
        Some("parsed"),
        None,
        Some(&ParsedObject::Commit(commit_obj)),
        None,
        None,
        false,
    )
    .unwrap();
    assert_eq!(oid, "e10ebb90d03eaacca84de1af0a59b444232da99e");
}

#[test]
fn test_expand_oid_resolve_write_delete_list_refs_and_is_ignored() {
    // expandOid (+ submodule)
    for is_sub in [false, true] {
        let f = load_fixture("test-expandOid", is_sub);
        assert_eq!(
            expand_oid(&f.fs, &f.gitdir, "033417ae").unwrap(),
            "033417ae18b174f078f2f44232cb7a374f4c60ce"
        );
        assert_eq!(
            expand_oid(&f.fs, &f.gitdir, "01234567").unwrap_err().code,
            ErrorCode::NotFoundError
        );
        assert_eq!(
            expand_oid(&f.fs, &f.gitdir, "033417a").unwrap_err().code,
            ErrorCode::AmbiguousError
        );
        assert_eq!(
            expand_oid(&f.fs, &f.gitdir, "5f1f014").unwrap(),
            "5f1f014326b1d7e8079d00b87fa7a9913bd91324"
        );
        assert_eq!(
            expand_oid(&f.fs, &f.gitdir, "0001c3").unwrap(),
            "0001c3e2753b03648b6c43dd74ba7fe2f21123d6"
        );
    }

    // resolveRef (+ submodule)
    for is_sub in [false, true] {
        let f = load_fixture("test-resolveRef", is_sub);
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "1e40fdfba1cf17f3c9f9f3d6b392b1865e5147b9", None).unwrap(),
            "1e40fdfba1cf17f3c9f9f3d6b392b1865e5147b9"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "origin/test-branch", None).unwrap(),
            "e10ebb90d03eaacca84de1af0a59b444232da99e"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "config", None).unwrap(),
            "e10ebb90d03eaacca84de1af0a59b444232da99e"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "test-tag", None).unwrap(),
            "1e40fdfba1cf17f3c9f9f3d6b392b1865e5147b9"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(),
            "033417ae18b174f078f2f44232cb7a374f4c60ce"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "HEAD", Some(2)).unwrap(),
            "refs/heads/master"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "v0.0.1", None).unwrap(),
            "1a2149e96a9767b281a8f10fd014835322da2d14"
        );
        assert_eq!(
            resolve_ref(&f.fs, &f.gitdir, "this-is-not-a-ref", None)
                .unwrap_err()
                .code,
            ErrorCode::NotFoundError
        );
    }

    // writeRef (+ submodule)
    let fw = make_fixture("test-writeRef");
    write_ref(
        &fw.fs,
        &fw.gitdir,
        "refs/tags/latest",
        "cfc039a0acb68bee8bb4f3b13b6b211dbb8c1a69",
        false,
        false,
    )
    .unwrap();
    assert_eq!(
        resolve_ref(&fw.fs, &fw.gitdir, "refs/tags/latest", None).unwrap(),
        "cfc039a0acb68bee8bb4f3b13b6b211dbb8c1a69"
    );
    write_ref(&fw.fs, &fw.gitdir, "refs/heads/another", "HEAD", false, false).unwrap();
    write_ref(&fw.fs, &fw.gitdir, "HEAD", "refs/heads/another", true, true).unwrap();
    let cb = current_branch(&fw.fs, &fw.gitdir, true, false).unwrap();
    assert_eq!(cb.as_deref(), Some("refs/heads/another"));

    // deleteRef (+ submodule)
    let fd = make_fixture("test-deleteRef");
    delete_ref(&fd.fs, &fd.gitdir, "refs/tags/latest").unwrap();
    assert!(!list_tags(&fd.fs, &fd.gitdir).contains(&"latest".to_string()));
    delete_ref(&fd.fs, &fd.gitdir, "refs/tags/packed-tag").unwrap();
    assert!(!list_tags(&fd.fs, &fd.gitdir).contains(&"packed-tag".to_string()));
    delete_ref(&fd.fs, &fd.gitdir, "refs/tags/packed-and-loose").unwrap();
    assert!(!list_tags(&fd.fs, &fd.gitdir).contains(&"packed-and-loose".to_string()));

    // listRefs
    let fl = make_fixture("test-listRefs");
    let listed = list_refs(&fl.fs, &fl.gitdir, "refs/tags");
    assert_eq!(listed.first().map(|s| s.as_str()), Some("local-tag"));
    assert_eq!(listed.last().map(|s| s.as_str()), Some("v0.1.0"));

    // isIgnored (+ submodule)
    let fi = make_fixture("test-isIgnored");
    fi.fs.write_str(
        &format!("{}/.gitignore", fi.dir),
        "a.txt\nc/*\n!c/d.txt\nd/\n",
    );
    assert!(is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "a.txt"));
    assert!(!is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "b.txt"));
    assert!(!is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "c/d.txt"));
    assert!(is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "c/e.txt"));
    assert!(is_ignored(&fi.fs, &fi.dir, Some(&fi.gitdir), "d/"));

    let fi2 = make_fixture("test-isIgnored");
    fi2.fs
        .write_str(&format!("{}/.gitignore", fi2.dir), "a.txt\n");
    fi2.fs
        .write_str(&format!("{}/c/.gitignore", fi2.dir), "d.txt\n");
    assert!(is_ignored(&fi2.fs, &fi2.dir, Some(&fi2.gitdir), "a.txt"));
    assert!(!is_ignored(&fi2.fs, &fi2.dir, Some(&fi2.gitdir), "b.txt"));
    assert!(is_ignored(&fi2.fs, &fi2.dir, Some(&fi2.gitdir), "c/d.txt"));
    assert!(!is_ignored(&fi2.fs, &fi2.dir, Some(&fi2.gitdir), "c/e.txt"));
}
