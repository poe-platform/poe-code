use git_rust::models::GitObject;
use git_rust::utils::zlib_inflate;
use git_rust::{MemoryFs, index_pack, init, pack_objects, read_object, write_blob};

#[test]
fn loose_packed_and_virtual_objects_honor_all_formats() {
    let fs = MemoryFs::new();
    let gitdir = "/repo/.git";
    init(&fs, Some("/repo"), None, false, None).unwrap();
    let bytes = b"binary\0blob\xff\n";
    let oid = write_blob(&fs, gitdir, bytes).unwrap();
    let packed = pack_objects(&fs, gitdir, std::slice::from_ref(&oid), true).unwrap();
    index_pack(
        &fs,
        gitdir,
        gitdir,
        &format!("objects/pack/{}", packed.filename),
    )
    .unwrap();

    for storage in ["loose", "packed", "virtual"] {
        if storage == "packed" {
            fs.unlink(&format!("{gitdir}/objects/{}/{}", &oid[..2], &oid[2..]))
                .unwrap();
        }
        let (oid, obj_type, content): (&str, &str, &[u8]) = if storage == "virtual" {
            ("4b825dc642cb6eb9a060e54bf8d69288fbee4904", "tree", b"")
        } else {
            (&oid, "blob", bytes)
        };
        let wrapped = GitObject::wrap(obj_type, content);
        for format in ["content", "wrapped", "deflated"] {
            let result = read_object(&fs, gitdir, oid, Some(format), None, None).unwrap();
            assert_eq!(result.format, format, "{storage} {format}");
            match format {
                "content" => {
                    assert_eq!(result.obj_type, obj_type);
                    assert_eq!(result.object, content);
                }
                "wrapped" => {
                    assert_eq!(result.obj_type, "wrapped");
                    assert_eq!(result.object, wrapped);
                }
                _ => {
                    assert_eq!(result.obj_type, "deflated");
                    assert_eq!(zlib_inflate(&result.object).unwrap(), wrapped);
                }
            }
            if storage == "packed" {
                assert_eq!(
                    result.source,
                    Some(format!("objects/pack/{}", packed.filename))
                );
            } else if storage == "virtual" {
                assert_eq!(result.source, None);
            }
        }
    }
}

#[test]
fn virtual_empty_tree_deflated_bytes_are_zlib_wrapped() {
    let result = read_object(
        &MemoryFs::new(),
        "/repo/.git",
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        Some("deflated"),
        None,
        None,
    )
    .unwrap();
    assert_eq!(result.format, "deflated");
    assert_eq!(zlib_inflate(&result.object).unwrap(), b"tree 0\0");
}
