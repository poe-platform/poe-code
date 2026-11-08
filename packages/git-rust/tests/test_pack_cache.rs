use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use git_rust::storage::read_object_packed;
use git_rust::{MemoryFs, index_pack, init, pack_objects, write_blob};

struct CountingAllocator;
thread_local! {
    static ALLOCATED: Cell<Option<usize>> = const { Cell::new(None) };
}

// Count bytes on the current test thread, without timing assumptions or disk I/O.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCATED.try_with(|count| {
            if let Some(bytes) = count.get() {
                count.set(Some(bytes + layout.size()));
            }
        });
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let _ = ALLOCATED.try_with(|count| {
            if let Some(bytes) = count.get() {
                count.set(Some(bytes + new_size));
            }
        });
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn repository() -> (MemoryFs, Vec<String>, String) {
    let fs = MemoryFs::new();
    init(&fs, Some("/repo"), None, false, None).unwrap();
    let mut oids: Vec<_> = (0..128)
        .map(|i| write_blob(&fs, "/repo/.git", format!("blob {i}").as_bytes()).unwrap())
        .collect();
    let large = write_blob(&fs, "/repo/.git", &vec![b'x'; 256 * 1024]).unwrap();
    oids.push(large);
    let pack = pack_objects(&fs, "/repo/.git", &oids, true).unwrap();
    let path = format!("/repo/.git/objects/pack/{}", pack.filename);
    index_pack(
        &fs,
        "/repo/.git",
        "/repo/.git",
        &format!("objects/pack/{}", pack.filename),
    )
    .unwrap();
    (fs, oids, path)
}

#[test]
fn repeated_reads_and_misses_do_not_reparse_or_copy_the_pack() {
    let (fs, oids, _) = repository();
    read_object_packed(&fs, "/repo/.git", &oids[0])
        .unwrap()
        .unwrap();
    for oid in oids[1..5]
        .iter()
        .map(String::as_str)
        .chain(["ffffffffffffffffffffffffffffffffffffffff"])
    {
        ALLOCATED.with(|count| count.set(Some(0)));
        let result = read_object_packed(&fs, "/repo/.git", oid);
        let allocated = ALLOCATED.with(|count| count.take().unwrap());
        assert!(result.is_ok());
        assert!(
            allocated < 32 * 1024,
            "packed lookup allocated {allocated} bytes"
        );
    }
    // Worktree edits must not invalidate an unchanged archive.
    fs.write_str("/repo/file", "new working content");
    ALLOCATED.with(|count| count.set(Some(0)));
    let result = read_object_packed(&fs, "/repo/.git", &oids[6]);
    let allocated = ALLOCATED.with(|count| count.take().unwrap());
    assert!(result.unwrap().is_some());
    assert!(
        allocated < 32 * 1024,
        "worktree edit invalidated pack cache: {allocated}"
    );
}

#[test]
fn cached_pack_is_invalidated_on_rewrite_removal_and_index_change() {
    let (fs, oids, path) = repository();
    let expected = read_object_packed(&fs, "/repo/.git", &oids[0])
        .unwrap()
        .unwrap();
    let original = fs.read(&path).unwrap();
    let mut corrupted = original.clone();
    corrupted[15] ^= 1;
    fs.write(&path, &corrupted);
    assert!(
        read_object_packed(&fs, "/repo/.git", &oids[0])
            .unwrap_err()
            .message
            .contains("payload corrupted")
    );
    fs.write(&path, &original);
    assert_eq!(
        read_object_packed(&fs, "/repo/.git", &oids[0])
            .unwrap()
            .unwrap(),
        expected
    );

    let index_path = path.trim_end_matches(".pack").to_string() + ".idx";
    let index = fs.read(&index_path).unwrap();
    let mut changed = index.clone();
    let sha_offset = changed.len() - 40;
    changed[sha_offset] ^= 1;
    fs.write(&index_path, &changed);
    assert!(
        read_object_packed(&fs, "/repo/.git", &oids[0])
            .unwrap_err()
            .message
            .contains("trailer mismatch")
    );
    fs.write(&index_path, &index);
    fs.unlink(&path).unwrap();
    assert!(read_object_packed(&fs, "/repo/.git", &oids[0]).is_err());
    fs.write(&path, &original);
    assert_eq!(
        read_object_packed(&fs, "/repo/.git", &oids[0])
            .unwrap()
            .unwrap(),
        expected
    );

    fs.unlink(&index_path).unwrap();
    assert_eq!(
        read_object_packed(&fs, "/repo/.git", &oids[0])
            .unwrap()
            .unwrap()
            .object,
        expected.object
    );
    fs.unlink(&path).unwrap();
    assert!(
        read_object_packed(&fs, "/repo/.git", &oids[0])
            .unwrap()
            .is_none()
    );
}

#[test]
fn deep_clones_and_independent_filesystems_do_not_share_stale_packs() {
    let (fs, oids, path) = repository();
    let expected = read_object_packed(&fs, "/repo/.git", &oids[0])
        .unwrap()
        .unwrap();
    let copy = fs.deep_clone();
    fs.write(&path, b"broken");
    assert!(read_object_packed(&fs, "/repo/.git", &oids[0]).is_err());
    assert_eq!(
        read_object_packed(&copy, "/repo/.git", &oids[0])
            .unwrap()
            .unwrap(),
        expected
    );
    assert!(
        read_object_packed(&MemoryFs::new(), "/repo/.git", &oids[0])
            .unwrap()
            .is_none()
    );
}

#[test]
fn ref_deltas_can_resolve_bases_in_another_cached_pack() {
    use git_rust::models::GitPackIndex;
    use git_rust::models::git_object::UnwrappedObject;
    use git_rust::utils::{from_hex, shasum_bytes, zlib_deflate};

    let fs = MemoryFs::new();
    let gitdir = "/repo/.git";
    init(&fs, Some("/repo"), None, false, None).unwrap();
    let base = write_blob(&fs, gitdir, b"base").unwrap();
    let packed = pack_objects(&fs, gitdir, std::slice::from_ref(&base), true).unwrap();
    index_pack(
        &fs,
        gitdir,
        gitdir,
        &format!("objects/pack/{}", packed.filename),
    )
    .unwrap();
    fs.unlink(&format!("{gitdir}/objects/{}/{}", &base[..2], &base[2..]))
        .unwrap();

    let delta = [4, 5, 0x90, 4, 1, b'!'];
    let mut pack = b"PACK\0\0\0\x02\0\0\0\x01".to_vec();
    pack.push(0x70 | delta.len() as u8);
    pack.extend(from_hex(&base).unwrap());
    pack.extend(zlib_deflate(&delta));
    pack.extend(shasum_bytes(&pack));
    let external = |oid: &str| -> Result<UnwrappedObject, git_rust::GitError> {
        assert_eq!(oid, base);
        Ok(UnwrappedObject {
            object_type: "blob".into(),
            object: b"base".to_vec(),
        })
    };
    let index = GitPackIndex::from_pack(&pack, Some(&external)).unwrap();
    let target = index.hashes[0].clone();
    fs.write(&format!("{gitdir}/objects/pack/a-delta.pack"), &pack);
    fs.write(
        &format!("{gitdir}/objects/pack/a-delta.idx"),
        &index.to_buffer().unwrap(),
    );
    for _ in 0..3 {
        let object = read_object_packed(&fs, gitdir, &target).unwrap().unwrap();
        assert_eq!(object.object, b"base!");
    }
}

#[test]
fn index_misses_and_unindexed_packs_are_cached_too() {
    let (fs, oids, pack_path) = repository();
    let missing = "ffffffffffffffffffffffffffffffffffffffff";
    for indexed in [true, false] {
        if !indexed {
            fs.unlink(&(pack_path.trim_end_matches(".pack").to_string() + ".idx"))
                .unwrap();
        }
        assert!(
            read_object_packed(&fs, "/repo/.git", missing)
                .unwrap()
                .is_none()
        );
        ALLOCATED.with(|count| count.set(Some(0)));
        let result = read_object_packed(&fs, "/repo/.git", missing);
        let allocated = ALLOCATED.with(|count| count.take().unwrap());
        assert!(result.unwrap().is_none());
        assert!(
            allocated < 32 * 1024,
            "index miss allocated {allocated} bytes"
        );
        assert!(
            read_object_packed(&fs, "/repo/.git", &oids[0])
                .unwrap()
                .is_some()
        );
    }
}
