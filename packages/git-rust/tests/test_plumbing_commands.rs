use git_rust::fixtures::{make_fixture, make_fixture_as_submodule, FixtureEnv};
use git_rust::storage::read_object_packed;
use git_rust::utils::{basename, join, Author};
use git_rust::*;

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

#[test]
fn test_init_find_root_and_config_commands() {
    for is_sub in [false, true] {
        let f = load_fixture("test-init", is_sub);
        init(&f.fs, Some(&f.dir), None, false, None).unwrap();
        let resolved_gdir = discover_gitdir(&f.fs, &format!("{}/.git", f.dir));
        assert!(f.fs.exists(&f.dir));
        assert!(f.fs.exists(&format!("{resolved_gdir}/objects")));
        assert!(f.fs.exists(&format!("{resolved_gdir}/refs/heads")));
        assert!(f.fs.exists(&format!("{resolved_gdir}/HEAD")));

        let f_bare = load_fixture("test-init", false);
        init(&f_bare.fs, Some(&f_bare.dir), None, true, None).unwrap();
        assert!(f_bare.fs.exists(&format!("{}/objects", f_bare.dir)));
        assert!(f_bare.fs.exists(&format!("{}/refs/heads", f_bare.dir)));
        assert!(f_bare.fs.exists(&format!("{}/HEAD", f_bare.dir)));

        set_config(&f.fs, &format!("{}/.git", f.dir), "user.name", Some("me"), false).unwrap();
        set_config(&f.fs, &format!("{}/.git", f.dir), "user.email", Some("meme"), false).unwrap();
        init(&f.fs, Some(&f.dir), None, false, None).unwrap();
        assert_eq!(
            get_config(&f.fs, &format!("{}/.git", f.dir), "user.name")
                .map(|v| v.as_str().to_string()),
            Some("me".to_string())
        );
        assert_eq!(
            get_config(&f.fs, &format!("{}/.git", f.dir), "user.email")
                .map(|v| v.as_str().to_string()),
            Some("meme".to_string())
        );
    }

    // findRoot (+ submodule)
    let fr = make_fixture("test-findRoot");
    let _ = fr.fs.mkdir(&join(&[&fr.dir, "foobar/.git"]));
    let _ = fr.fs.mkdir(&join(&[&fr.dir, "foobar/bar/.git"]));
    assert_eq!(
        basename(&find_root(&fr.fs, &join(&[&fr.dir, "foobar"])).unwrap()),
        "foobar"
    );
    assert_eq!(
        basename(&find_root(&fr.fs, &join(&[&fr.dir, "foobar/bar/baz/buzz"])).unwrap()),
        "bar"
    );

    // getConfig / getConfigAll / setConfig (+ submodule)
    for is_sub in [false, true] {
        let fc = load_fixture("test-config", is_sub);
        assert_eq!(
            get_config(&fc.fs, &fc.gitdir, "core.repositoryformatversion").map(|v| v.as_str().to_string()),
            Some("0".to_string())
        );
        assert_eq!(
            get_config(&fc.fs, &fc.gitdir, "core.bare").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            get_config(&fc.fs, &fc.gitdir, "remote.origin.url").map(|v| v.as_str().to_string()),
            Some("https://github.com/isomorphic-git/isomorphic-git".to_string())
        );

        let fca = load_fixture("test-config", is_sub);
        let all_vals: Vec<String> = get_config_all(&fca.fs, &fca.gitdir, "remote.origin.fetch")
            .into_iter()
            .map(|v| v.as_str().to_string())
            .collect();
        assert!(!all_vals.is_empty());

        let fsc = load_fixture("test-config", is_sub);
        set_config(&fsc.fs, &fsc.gitdir, "user.name", Some("Alice"), false).unwrap();
        assert_eq!(
            get_config(&fsc.fs, &fsc.gitdir, "user.name").map(|v| v.as_str().to_string()),
            Some("Alice".to_string())
        );
    }
}

#[test]
fn test_blob_tree_commit_tag_object_commands() {
    // hashBlob
    let hb = hash_blob(b"#!/usr/bin/env node\n");
    assert_eq!(hb.oid, "908ba8417a006d1faca67db9c44e1bfb43224550");
    assert_eq!(hb.obj_type, "blob");
    assert_eq!(hb.format, "wrapped");

    for is_sub in [false, true] {
        // readBlob & writeBlob
        let fb = load_fixture("test-readBlob", is_sub);
        let rb = read_blob(
            &fb.fs,
            &fb.gitdir,
            "be1e63da44b26de8877a184359abace1cddcb739",
            Some("cli.js"),
        )
        .unwrap();
        assert_eq!(rb.oid, "4551a1856279dde6ae9d65862a1dff59a5f199d8");
        let wb_oid = write_blob(&fb.fs, &fb.gitdir, &rb.blob).unwrap();
        assert_eq!(wb_oid, rb.oid);

        // readTree & writeTree
        let ft = load_fixture("test-readTree", is_sub);
        let rt = read_tree(
            &ft.fs,
            &ft.gitdir,
            "be1e63da44b26de8877a184359abace1cddcb739",
            Some(""),
        )
        .unwrap();
        assert_eq!(rt.oid, "6257985e3378ec42a03a57a7dc8eb952d69a5ff3");
        let wt_oid = write_tree(&ft.fs, &ft.gitdir, &rt.tree).unwrap();
        assert_eq!(wt_oid, rt.oid);

        // readCommit & writeCommit
        let fc = load_fixture("test-readCommit", is_sub);
        let rc = read_commit(
            &fc.fs,
            &fc.gitdir,
            "e10ebb90d03eaacca84de1af0a59b444232da99e",
        )
        .unwrap();
        assert_eq!(rc.commit.author.name, "Will Hilton");
        let wc_oid = write_commit(&fc.fs, &fc.gitdir, &rc.commit).unwrap();
        assert_eq!(wc_oid, "e10ebb90d03eaacca84de1af0a59b444232da99e");

        // readTag & writeTag
        let ftag = load_fixture("test-readTag", is_sub);
        let rtag = read_tag(
            &ftag.fs,
            &ftag.gitdir,
            "587d3f8290b513e2ee85ecd317e6efecd545aee6",
        )
        .unwrap();
        assert_eq!(rtag.tag.tag, "mytag");
        let wtag_oid = write_tag(&ftag.fs, &ftag.gitdir, &rtag.tag).unwrap();
        assert_eq!(wtag_oid, "587d3f8290b513e2ee85ecd317e6efecd545aee6");
    }
}

#[test]
fn test_branch_tag_remote_and_note_commands() {
    for is_sub in [false, true] {
        let fb = load_fixture("test-branch", is_sub);
        branch(&fb.fs, &fb.gitdir, "test-branch", None, false, false).unwrap();
        assert!(list_branches(&fb.fs, &fb.gitdir, None).contains(&"test-branch".to_string()));
        assert_eq!(
            current_branch(&fb.fs, &fb.gitdir, false, false).unwrap().as_deref(),
            Some("master")
        );

        rename_branch(&fb.fs, &fb.gitdir, "test-branch", "renamed-branch", false).unwrap();
        assert!(list_branches(&fb.fs, &fb.gitdir, None).contains(&"renamed-branch".to_string()));
        delete_branch(&fb.fs, &fb.gitdir, "renamed-branch").unwrap();
        assert!(!list_branches(&fb.fs, &fb.gitdir, None).contains(&"renamed-branch".to_string()));

        // tag, annotatedTag, deleteTag
        let ft = load_fixture("test-tag", is_sub);
        tag(&ft.fs, &ft.gitdir, "test-lightweight-tag", None, false).unwrap();
        assert!(list_tags(&ft.fs, &ft.gitdir).contains(&"test-lightweight-tag".to_string()));
        delete_tag(&ft.fs, &ft.gitdir, "test-lightweight-tag").unwrap();
        assert!(!list_tags(&ft.fs, &ft.gitdir).contains(&"test-lightweight-tag".to_string()));

        let fat = load_fixture("test-annotatedTag", is_sub);
        annotated_tag(
            &fat.fs,
            &fat.gitdir,
            "test-annotated",
            Some("Annotated tag message\n"),
            None,
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
            false,
        )
        .unwrap();
        assert!(list_tags(&fat.fs, &fat.gitdir).contains(&"test-annotated".to_string()));

        // addRemote, listRemotes, deleteRemote
        let fr = load_fixture("test-addRemote", is_sub);
        add_remote(
            &fr.fs,
            &fr.gitdir,
            "baz",
            "git@github.com:baz/baz.git",
            false,
        )
        .unwrap();
        assert!(list_remotes(&fr.fs, &fr.gitdir)
            .iter()
            .any(|r| r.remote == "baz" && r.url == "git@github.com:baz/baz.git"));
        delete_remote(&fr.fs, &fr.gitdir, "baz").unwrap();
        assert!(!list_remotes(&fr.fs, &fr.gitdir).iter().any(|r| r.remote == "baz"));

        // addNote, readNote, listNotes, removeNote
        let fn_env = load_fixture("test-addNote", is_sub);
        let note_commit = add_note(
            &fn_env.fs,
            &fn_env.gitdir,
            None,
            "f6d51b1f9a449079f6999be1fb249c359511f164",
            b"This is a note about a commit.",
            false,
            Author {
                name: "William Hilton".to_string(),
                email: "wmhilton@gmail.com".to_string(),
                timestamp: 1578937310,
                timezone_offset: 300.0,
            },
            None,
        )
        .unwrap();
        assert_eq!(note_commit, "3b4b7a6c2382ea60a0b4c7ff69920af9a2e6408d");
        let note_data = read_note(
            &fn_env.fs,
            &fn_env.gitdir,
            None,
            "f6d51b1f9a449079f6999be1fb249c359511f164",
        )
        .unwrap();
        assert_eq!(note_data, b"This is a note about a commit.");
        let notes = list_notes(&fn_env.fs, &fn_env.gitdir, None).unwrap();
        assert!(notes
            .iter()
            .any(|n| n.target == "f6d51b1f9a449079f6999be1fb249c359511f164"));
        remove_note(
            &fn_env.fs,
            &fn_env.gitdir,
            None,
            "f6d51b1f9a449079f6999be1fb249c359511f164",
            Author {
                name: "William Hilton".to_string(),
                email: "wmhilton@gmail.com".to_string(),
                timestamp: 1578937310,
                timezone_offset: 300.0,
            },
            None,
        )
        .unwrap();
        assert!(read_note(
            &fn_env.fs,
            &fn_env.gitdir,
            None,
            "f6d51b1f9a449079f6999be1fb249c359511f164"
        )
        .is_err());
    }
}

#[test]
fn test_log_is_descendent_find_merge_base_pack_objects_and_upload_pack() {
    for is_sub in [false, true] {
        let fl = load_fixture("test-log", is_sub);
        let commits = log(
            &fl.fs,
            &fl.gitdir,
            Some("HEAD"),
            None,
            Some(5),
            None,
            false,
            false,
        )
        .unwrap();
        assert_eq!(commits.len(), 5);
        assert_eq!(commits[0].oid, "3c945912219e6fc27a9100bf099687c69c88afed");
        let newer = commits[0].oid.clone();
        let older = commits[4].oid.clone();

        // isDescendent
        assert!(is_descendent(&fl.fs, &fl.gitdir, &newer, &older, None).unwrap());
        assert!(!is_descendent(&fl.fs, &fl.gitdir, &older, &newer, None).unwrap());

        // findMergeBase
        let fmb = load_fixture("test-findMergeBase", is_sub);
        let b_list = list_branches(&fmb.fs, &fmb.gitdir, None);
        let oid1 = resolve_ref(&fmb.fs, &fmb.gitdir, &b_list[0], None).unwrap();
        let oid2 = resolve_ref(&fmb.fs, &fmb.gitdir, &b_list[1], None).unwrap();
        let bases = find_merge_base(&fmb.fs, &fmb.gitdir, &[oid1, oid2]).unwrap();
        assert!(!bases.is_empty());

        // listCommitsAndTags & listObjects
        let flct = load_fixture("test-listCommitsAndTags", is_sub);
        let c_set = list_commits_and_tags(
            &flct.fs,
            &flct.gitdir,
            &["c60bbbe99e96578105c57c4b3f2b6ebdf863edbc".to_string()],
            &["c77052f99c33dbe3d2a120805fcebe9e2194b6f9".to_string()],
        )
        .unwrap();
        assert_eq!(c_set.len(), 4);
        assert!(c_set.contains("c60bbbe99e96578105c57c4b3f2b6ebdf863edbc"));

        let flo = load_fixture("test-listObjects", is_sub);
        let o_set = list_objects(
            &flo.fs,
            &flo.gitdir,
            &[
                "c60bbbe99e96578105c57c4b3f2b6ebdf863edbc".to_string(),
                "e05547ea87ea55eff079de295ff56f483e5b4439".to_string(),
                "ebdedf722a3ec938da3fd53eb74fdea55c48a19d".to_string(),
                "0518502faba1c63489562641c36a989e0f574d95".to_string(),
            ],
        )
        .unwrap();
        assert!(o_set.len() > 50);
    }

    // packObjects & indexPack
    let fp = make_fixture("test-packObjects");
    let oids = vec![
        "5a9da3272badb2d3c8dbab463aed5741acb15a33".to_string(),
        "0bfe8fa3764089465235461624f2ede1533e74ec".to_string(),
        "414a0afa7e20452d90ab52de1c024182531c5c52".to_string(),
    ];
    let packed_mem = pack_objects(&fp.fs, &fp.gitdir, &oids, false).unwrap();
    assert!(packed_mem.packfile.is_some());
    let packed_disk = pack_objects(&fp.fs, &fp.gitdir, &oids, true).unwrap();
    let rel_pack_path = format!("objects/pack/{}", packed_disk.filename);
    let indexed_oids = index_pack(&fp.fs, &fp.gitdir, &fp.gitdir, &rel_pack_path).unwrap();
    assert_eq!(indexed_oids.len(), 3);
    let read_from_pack =
        read_object_packed(&fp.fs, &fp.gitdir, "5a9da3272badb2d3c8dbab463aed5741acb15a33")
            .unwrap()
            .unwrap();
    assert_eq!(read_from_pack.oid, "5a9da3272badb2d3c8dbab463aed5741acb15a33");

    // uploadPack
    let fup = make_fixture("test-uploadPack");
    let ad = upload_pack(&fup.fs, &fup.gitdir, true).unwrap().unwrap();
    assert_eq!(
        String::from_utf8_lossy(&ad),
        "00f15a8905a02e181fe1821068b8c0f48cb6633d5b81 HEAD\0thin-pack side-band side-band-64k shallow deepen-since deepen-not allow-tip-sha1-in-want allow-reachable-sha1-in-want symref=HEAD:refs/heads/master agent=git/isomorphic-git@0.0.0-development\n003f5a8905a02e181fe1821068b8c0f48cb6633d5b81 refs/heads/master\n0000"
    );
}
