use std::collections::BTreeMap;

use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::models::{
    ConfigValue, GitAnnotatedTag, GitConfig, GitIndex, GitObject, GitPackIndex, GitPktLine,
    GitRefSpecSet, GitSideBand, GitTree, PktLineItem, TagObject,
};
use git_rust::utils::{Author, shasum};
use git_rust::wire::{
    RefsAdResponse, UploadPackRequest, parse_refs_ad_response, parse_upload_pack_request,
    parse_upload_pack_response, write_refs_ad_response, write_upload_pack_request,
};

const TAG_STRING: &str = "object af4d84a6a9fa7a74acdad07fddf9f17ff3a974ae
type commit
tag v0.0.9
tagger Will Hilton <wmhilton@gmail.com> 1507071414 -0400

0.0.9
-----BEGIN PGP SIGNATURE-----
Version: GnuPG v1

iQIcBAABAgAGBQJZ1BW2AAoJEJYJuKWSi6a5S6EQAJQkK+wIXijDf4ZfVeP1E7Be
aDDdOLga0/gj5p2p081TLLlaKKLcYj2pub8BfFVpEmvT0QRaKaMb+wAtO5PBHTbn
y2s3dCmqqAPQa0AXrChverKomK/gUYZfFzckS8GaJTiw2RyvheXOLOEGSLTHOwy2
wjP8KxGOWfHlXZEhn/Z406OlcYMzMSL70H26pgyggSTe5RNfpXEBAgWmIAA51eEM
9tF9xuijc0mlr6vzxYVmfwat4u38nrwX7JvWp2CvD/qwILMAYGIcZqRXK5jWHemD
/x5RtUGU4cr47++FD3N3zBWx0dBiCMNUwT/v68kmhrBVX20DhcC6UX38yf1sdDfZ
yapht2+TakKQuw/T/K/6bFjoa8MIHdAx7WCnMV84M0qfMr+e9ImeH5Hj592qw4Gh
vSY80gKslkXjRnVes7VHXoL/lVDvCM2VNskWTTLGHqt+rIvSXNFGP05OGtdFYu4d
K9oFVEoRPFTRSeF/9EztyeLb/gtSdBmWP2AhZn9ip0a7rjbyv5yeayZTsedoUfe5
o8cB++UXreD+h3c/F6mTRs8aVELhQTZNZ677PY71HJKsCLbQJAd4n+gS1n8Y/7wv
Zp4YxnShDkMTV3rxZc27vehq2g9gKJzQsueLyZPJTzCHqujumiLbdYV4i4X4CZjy
dBWrLc3kdnemrlhSRzR2
=PrR1
-----END PGP SIGNATURE-----
";

#[test]
fn test_git_annotated_tag_parse_and_render() {
    let tag = GitAnnotatedTag::from_str(TAG_STRING);
    let parsed = tag.parse();
    assert_eq!(parsed.object, "af4d84a6a9fa7a74acdad07fddf9f17ff3a974ae");
    assert_eq!(parsed.object_type, "commit");
    assert_eq!(parsed.tag, "v0.0.9");
    assert_eq!(
        parsed.tagger,
        Author {
            name: "Will Hilton".into(),
            email: "wmhilton@gmail.com".into(),
            timestamp: 1507071414,
            timezone_offset: 240.0,
        }
    );
    assert_eq!(parsed.message, "0.0.9");
    assert!(parsed.gpgsig.as_ref().unwrap().starts_with("-----BEGIN PGP SIGNATURE-----"));

    let rendered = GitAnnotatedTag::from_object(&TagObject { ..parsed });
    assert_eq!(rendered.render(), TAG_STRING);
}

#[test]
fn test_git_annotated_tag_in_submodule() {
    let _sm = make_fixture_as_submodule("test-annotatedTag");
    test_git_annotated_tag_parse_and_render();
}

#[test]
fn test_git_config_parse_get_set_append_delete() {
    let sample = "[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
\tlogallrefupdates = true
\tsymlinks = false
\tignorecase = true
\tbigFileThreshold = 2m
[remote \"origin\"]
\turl = https://github.com/octocat/Hello-World.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch \"master\"]
\tremote = origin
\tmerge = refs/heads/master";

    let mut cfg = GitConfig::from(sample);
    assert_eq!(cfg.get("core.filemode"), Some(ConfigValue::Bool(true)));
    assert_eq!(cfg.get("CORE.FILEMODE"), Some(ConfigValue::Bool(true)));
    assert_eq!(cfg.get("core.bare"), Some(ConfigValue::Bool(false)));
    assert_eq!(
        cfg.get("core.bigFileThreshold"),
        Some(ConfigValue::Int(2 * 1024 * 1024))
    );
    assert_eq!(
        cfg.get("remote.origin.url"),
        Some(ConfigValue::Str(
            "https://github.com/octocat/Hello-World.git".into()
        ))
    );
    assert_eq!(
        cfg.get_subsections("remote"),
        vec![Some("origin".to_string())]
    );

    cfg.set("user.name", Some("Alice"));
    assert_eq!(cfg.get_str("user.name").as_deref(), Some("Alice"));

    cfg.append("remote.origin.fetch", Some("+refs/tags/*:refs/tags/*"));
    assert_eq!(cfg.get_all("remote.origin.fetch").len(), 2);

    cfg.delete_section("branch", Some("master"));
    assert_eq!(cfg.get("branch.master.remote"), None);
}

#[test]
fn test_git_config_in_submodule() {
    let _sm = make_fixture_as_submodule("test-config");
    test_git_config_parse_get_set_append_delete();
}

#[test]
fn test_git_index_from_buffer_render_and_roundtrip() {
    let f = make_fixture("test-GitIndex");
    let buffer = f.fs.read(&format!("{}/index", f.dir)).unwrap();
    let index = GitIndex::from_buffer(&buffer).unwrap();
    let rendering = index.render();
    assert!(rendering.contains("100644 1db939d41956405f755e69ab570296c7ed3cec99    .babelrc"));
    assert!(rendering.contains(
        "100644 80708a513b7808becff0acfd70dbd3b66a4fb537    test/test-resolveRef.js"
    ));
    assert_eq!(index.entries().len(), 32);

    let buffer2 = index.to_object().unwrap();
    assert_eq!(&buffer[..buffer2.len() - 20], &buffer2[..buffer2.len() - 20]);
    let index2 = GitIndex::from_buffer(&buffer2).unwrap();
    let buffer3 = index2.to_object().unwrap();
    assert_eq!(buffer2, buffer3);
}

#[test]
fn test_git_index_unmerged_stages_and_existing_unmerged() {
    let mut index = GitIndex::new();
    assert_eq!(index.entries().len(), 0);
    assert_eq!(index.entries_flat().len(), 0);
    index.insert("a", None, "01", 1);
    index.insert("a", None, "10", 2);
    index.insert("a", None, "11", 3);
    assert_eq!(index.unmerged_paths(), vec!["a".to_string()]);
    let buf = index.to_object().unwrap();
    let reloaded = GitIndex::from_buffer(&buf).unwrap();
    assert_eq!(reloaded.entries().len(), 1);
    assert_eq!(reloaded.entries_flat().len(), 3);
    assert_eq!(reloaded.unmerged_paths(), vec!["a".to_string()]);

    let f_unmerged = make_fixture("test-GitIndex-unmerged");
    let raw_unmerged = f_unmerged
        .fs
        .read(&format!("{}/index", f_unmerged.gitdir))
        .unwrap();
    let unmerged_idx = GitIndex::from_buffer(&raw_unmerged).unwrap();
    assert_eq!(unmerged_idx.unmerged_paths(), vec!["a".to_string(), "b".to_string()]);
    assert_eq!(unmerged_idx.entries_flat().len(), 7);
    assert_eq!(unmerged_idx.entries_map()["a"].stages.len(), 4);
    assert_eq!(unmerged_idx.entries_map()["b"].stages.len(), 4);
    assert_eq!(unmerged_idx.entries_map()["c"].stages.len(), 1);
}

#[test]
fn test_git_index_in_submodule() {
    let _sm = make_fixture_as_submodule("test-GitIndex");
    test_git_index_from_buffer_render_and_roundtrip();
}

#[test]
fn test_git_pack_index_from_idx_and_from_pack_and_read() {
    let f = make_fixture("test-GitPackIndex");
    let idx = f
        .fs
        .read(&format!(
            "{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.idx",
            f.gitdir
        ))
        .unwrap();
    let pack = f
        .fs
        .read(&format!(
            "{}/objects/pack/pack-1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888.pack",
            f.gitdir
        ))
        .unwrap();

    let mut p_idx = GitPackIndex::from_idx(&idx).unwrap().unwrap();
    assert_eq!(
        p_idx.packfile_sha,
        "1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888"
    );
    assert_eq!(
        p_idx
            .offsets
            .get("0b8faa11b353db846b40eb064dfb299816542a46"),
        Some(&40077)
    );
    assert_eq!(
        p_idx
            .offsets
            .get("637c4e69d85e0dcc18898ec251377453d0891585"),
        Some(&39860)
    );
    assert_eq!(
        p_idx
            .offsets
            .get("98e9fde3ee878fa985a143fc5fe05d4e6d8e637b"),
        Some(&39036)
    );
    assert_eq!(
        p_idx
            .offsets
            .get("43c49edb213748626fc363c890c01a9e55a1b8da"),
        Some(&38202)
    );
    assert_eq!(
        p_idx
            .offsets
            .get("5f1f014326b1d7e8079d00b87fa7a9913bd91324"),
        Some(&20855)
    );

    let p_pack =
        GitPackIndex::from_pack::<fn(&str) -> Result<_, _>>(&pack, None).unwrap();
    assert_eq!(p_pack.hashes, p_idx.hashes);
    assert_eq!(
        p_pack.packfile_sha,
        "1a1e70d2f116e8cb0cb42d26019e5c7d0eb01888"
    );
    let idx_buffer = p_pack.to_buffer().unwrap();
    assert_eq!(idx_buffer.len(), idx.len());
    assert_eq!(idx_buffer, idx);

    // Truncated pack
    let p_trunc =
        GitPackIndex::from_pack::<fn(&str) -> Result<_, _>>(&pack[..12], None).unwrap();
    assert_eq!(p_trunc.offsets.len(), 0);

    // Read undeltified object
    p_idx.load(pack);
    let undeltified = p_idx
        .read("637c4e69d85e0dcc18898ec251377453d0891585")
        .unwrap();
    assert_eq!(undeltified.object_type, "commit");
    assert_eq!(
        shasum(&GitObject::wrap(
            &undeltified.object_type,
            &undeltified.object
        )),
        "637c4e69d85e0dcc18898ec251377453d0891585"
    );

    // Read deltified object
    let deltified = p_idx
        .read("0b8faa11b353db846b40eb064dfb299816542a46")
        .unwrap();
    assert_eq!(
        shasum(&GitObject::wrap(&deltified.object_type, &deltified.object)),
        "0b8faa11b353db846b40eb064dfb299816542a46"
    );
}

#[test]
fn test_git_pack_index_in_submodule() {
    let _sm = make_fixture_as_submodule("test-GitPackIndex");
    test_git_pack_index_from_idx_and_from_pack_and_read();
}

#[test]
fn test_git_pkt_line_and_side_band() {
    let mut reader = GitPktLine::stream_reader(b"0010hello world\n");
    assert_eq!(reader.read(), PktLineItem::Line(b"hello world\n".to_vec()));
    assert_eq!(reader.read(), PktLineItem::Eof);

    let err_stream = b"001e# service=git-upload-pack\n0015\x03error in stream\n0000";
    let demux = GitSideBand::demux(err_stream);
    assert_eq!(demux.error.as_deref(), Some("error in stream\n"));
    assert!(demux.packfile.is_empty());
}

#[test]
fn test_git_ref_spec_set() {
    let refspec = GitRefSpecSet::from(&[
        "+refs/heads/*:refs/remotes/origin/*",
        "refs/heads/master:refs/remotes/origin/master",
    ]);
    assert_eq!(
        refspec.translate_one("refs/heads/feature"),
        Some("refs/remotes/origin/feature".to_string())
    );
    assert_eq!(
        refspec.local_names(&["refs/heads/master", "refs/heads/dev"]),
        vec![
            "refs/remotes/origin/master".to_string(),
            "refs/remotes/origin/dev".to_string(),
            "refs/remotes/origin/master".to_string(),
        ]
    );
}

#[test]
fn test_git_tree_entry_name_validation() {
    let oid = [1u8; 20];
    let make_entry = |mode: &str, name: &str| -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(format!("{mode} {name}").as_bytes());
        buf.push(0);
        buf.extend_from_slice(&oid);
        buf
    };
    let rejects = |name: &str| {
        let err = GitTree::from_bytes(&make_entry("40000", name)).unwrap_err();
        assert_eq!(err.code, ErrorCode::UnsafeFilepathError, "expected {name} to be rejected");
    };

    for bad in [
        "..",
        ".",
        ".git",
        ".GIT",
        ".git.",
        ".git ",
        "git~1",
        "GIT~1",
        "git~2",
        "git~9",
        "git~1.",
        "git~1 ",
        ".git::$INDEX_ALLOCATION",
        ".git:$INDEX_ALLOCATION",
        ".git:foo",
        ".git...:alternate-stream",
        ".GIT:$DATA",
        ".git.:stream",
        ".git :stream",
        "git~1::$INDEX_ALLOCATION",
        "git~1:foo",
        "GIT~1:$DATA",
        ".g\u{200C}it",
        ".\u{200D}git",
        ".gi\u{200E}t",
        ".git\u{FEFF}",
        ".\u{200C}",
        ".\u{200C}.",
    ] {
        rejects(bad);
    }

    for good in [
        "foo:bar",
        ".gitignore:bar",
        "git~10",
        "git~0",
        "normal.txt",
        r"back\slash",
        r"..\literal",
        ".gitignore",
    ] {
        let tree = GitTree::from_bytes(&make_entry("100644", good)).unwrap();
        assert_eq!(tree.entries()[0].path, good);
    }
}

#[test]
fn test_wire_protocol_roundtrips() {
    let mut refs = BTreeMap::new();
    refs.insert(
        "HEAD".to_string(),
        "9ea43b479f5fedc679e3eb37803275d727bf51b7".to_string(),
    );
    refs.insert(
        "refs/heads/master".to_string(),
        "9ea43b479f5fedc679e3eb37803275d727bf51b7".to_string(),
    );
    let mut symrefs = BTreeMap::new();
    symrefs.insert("HEAD".to_string(), "refs/heads/master".to_string());

    let mut ad = Vec::new();
    ad.extend_from_slice(&GitPktLine::encode_str("# service=git-upload-pack\n"));
    ad.extend_from_slice(&GitPktLine::flush());
    ad.extend_from_slice(&write_refs_ad_response(
        &["multi_ack", "side-band-64k", "ofs-delta"],
        &refs,
        &symrefs,
    ));

    let parsed = parse_refs_ad_response(&ad, "git-upload-pack").unwrap();
    match parsed {
        RefsAdResponse::V1 {
            protocol_version,
            refs: p_refs,
            symrefs: p_syms,
            ..
        } => {
            assert_eq!(protocol_version, 1);
            assert_eq!(p_refs, refs);
            assert_eq!(p_syms, symrefs);
        }
        _ => panic!("expected v1"),
    }

    let up_req = UploadPackRequest {
        capabilities: vec!["side-band-64k".into(), "ofs-delta".into()],
        wants: vec!["9ea43b479f5fedc679e3eb37803275d727bf51b7".into()],
        haves: vec!["fb74ea1a9b6a9601df18c38d3de751c51f064bf7".into()],
        shallows: vec![],
        depth: Some(1),
        since: None,
        exclude: vec![],
        relative: false,
        done: true,
    };
    let encoded_req = write_upload_pack_request(&up_req);
    let decoded_req = parse_upload_pack_request(&encoded_req);
    assert_eq!(decoded_req.wants, up_req.wants);
    assert_eq!(decoded_req.haves, up_req.haves);
    assert_eq!(decoded_req.depth, Some(1));
    assert!(decoded_req.done);

    let mut up_res_stream = Vec::new();
    up_res_stream.extend_from_slice(&GitPktLine::encode_str("NAK\n"));
    up_res_stream.extend_from_slice(&GitPktLine::encode(b"\x01PACKDATA"));
    up_res_stream.extend_from_slice(&GitPktLine::flush());
    let up_res = parse_upload_pack_response(&up_res_stream).unwrap();
    assert!(up_res.nak);
    assert_eq!(up_res.packfile, b"PACKDATA");
}
