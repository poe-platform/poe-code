use std::sync::mpsc;
use std::time::Duration;

use git_rust::models::GitPackIndex;
use git_rust::{_write_object, MemoryFs, init, pack_objects, read_blob, write_blob};

fn cyclic_tags(edges: &[(&str, &str)]) -> MemoryFs {
    let fs = MemoryFs::new();
    let gitdir = "/repo/.git";
    init(&fs, Some("/repo"), None, false, None).unwrap();
    let oids: Vec<_> = edges
        .iter()
        .map(|(_, target)| {
            let tag = format!("object {target}\ntype tag\ntag cycle\n\ncycle\n");
            _write_object(&fs, gitdir, "tag", tag.as_bytes(), "content", None, false).unwrap()
        })
        .collect();
    let packed = pack_objects(&fs, gitdir, &oids, false).unwrap();
    let bytes = packed.packfile.unwrap();
    let mut index =
        GitPackIndex::from_pack::<fn(&str) -> Result<_, git_rust::GitError>>(&bytes, None).unwrap();
    // A corrupt index can assign a tag's bytes to an OID that closes a cycle.
    for (oid, (alias, _)) in oids.iter().zip(edges) {
        let offset = index.offsets.remove(oid).unwrap();
        let crc = index.crcs.remove(oid).unwrap();
        index.offsets.insert(alias.to_string(), offset);
        index.crcs.insert(alias.to_string(), crc);
    }
    index.hashes = index.offsets.keys().cloned().collect();
    fs.write(&format!("{gitdir}/objects/pack/cycle.pack"), &bytes);
    fs.write(
        &format!("{gitdir}/objects/pack/cycle.idx"),
        &index.to_buffer().unwrap(),
    );
    fs
}

#[test]
fn read_blob_rejects_self_and_two_tag_cycles() {
    let a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    for edges in [vec![(a, a)], vec![(a, b), (b, a)]] {
        let fs = cyclic_tags(&edges);
        let reader = fs.clone();
        let (sender, receiver) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            sender
                .send(read_blob(&reader, "/repo/.git", a, None))
                .unwrap();
        });
        let result = receiver.recv_timeout(Duration::from_millis(200));
        // Stop the old infinite loop before reporting the regression failure.
        if result.is_err() {
            fs.rm_recursive("/repo/.git/objects/pack").unwrap();
        }
        thread.join().unwrap();
        let err = result.expect("tag cycles must terminate").unwrap_err();
        assert!(err.message.contains("cycle"), "{err:?}");
    }
}

#[test]
fn read_blob_still_peels_nested_valid_tags() {
    let fs = MemoryFs::new();
    let gitdir = "/repo/.git";
    init(&fs, Some("/repo"), None, false, None).unwrap();
    let blob = write_blob(&fs, gitdir, b"content").unwrap();
    let mut target = blob.clone();
    for depth in 0..64 {
        let tag = format!(
            "object {target}\ntype {}\ntag t{depth}\n\nmessage\n",
            if depth == 0 { "blob" } else { "tag" }
        );
        target = _write_object(&fs, gitdir, "tag", tag.as_bytes(), "content", None, false).unwrap();
    }
    let result = read_blob(&fs, gitdir, &target, None).unwrap();
    assert_eq!(result.oid, blob);
    assert_eq!(result.blob, b"content");
}
