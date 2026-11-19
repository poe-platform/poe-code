use git_rust::GitError;
use git_rust::models::git_object::UnwrappedObject;
use git_rust::models::{GitPackIndex, GitTree};
use git_rust::utils::{shasum_bytes, zlib_deflate};

fn pack(count: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = b"PACK\0\0\0\x02".to_vec();
    out.extend_from_slice(&count.to_be_bytes());
    out.extend_from_slice(payload);
    let checksum = shasum_bytes(&out);
    out.extend_from_slice(&checksum);
    out
}
fn decode(bytes: &[u8]) -> Result<GitPackIndex, GitError> {
    GitPackIndex::from_pack::<fn(&str) -> Result<UnwrappedObject, GitError>>(bytes, None)
}

#[test]
fn refuses_truncated_pack_instead_of_accepting_a_partial_index() {
    for payload in [
        &[0x30][..],
        &[0xb0],
        &[0x60],
        &[0x70],
        &[0x60, 0xff],
        &[0x70, 0],
    ] {
        assert!(decode(&pack(1, payload)).is_err(), "{payload:?}");
    }
}

#[test]
fn verifies_pack_count_checksum_and_trailing_data() {
    let payload = [vec![0x31], zlib_deflate(b"a")].concat();
    assert_eq!(decode(&pack(1, &payload)).unwrap().hashes.len(), 1);
    assert!(decode(&pack(2, &payload)).is_err());
    assert!(decode(&pack(0, &payload)).is_err());
    assert!(decode(&pack(u32::MAX, &[])).is_err());
    let mut corrupt = pack(1, &payload);
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(decode(&corrupt).is_err());
    assert!(decode(&pack(1, &[payload, vec![0]].concat())).is_err());
    assert!(decode(b"PACK\0\0\0\x02\0\0\0\0").is_err());
}

#[test]
fn rejects_bad_zlib_checksum_and_wrong_declared_size() {
    let mut compressed = zlib_deflate(b"a");
    *compressed.last_mut().unwrap() ^= 1;
    assert!(decode(&pack(1, &[vec![0x31], compressed].concat())).is_err());
    assert!(decode(&pack(1, &[vec![0x32], zlib_deflate(b"a")].concat())).is_err());
    let compressed = zlib_deflate(&vec![0; 4096]);
    assert!(git_rust::utils::zlib::zlib_inflate_bounded(&compressed, 1024).is_err());
}

#[test]
fn rejects_invalid_delta_offsets_and_missing_bases() {
    let delta = zlib_deflate(&[0, 1, 1, b'a']);
    for offset in [0, 13, 127] {
        assert!(decode(&pack(1, &[vec![0x64, offset], delta.clone()].concat())).is_err());
    }
    assert!(decode(&pack(1, &[vec![0x74], vec![0; 20], delta].concat())).is_err());
}

#[test]
fn rejects_overflowing_object_headers_without_panicking() {
    let mut payload = vec![0xb0];
    payload.extend([0xff; 20]);
    payload.push(0);
    payload.extend(zlib_deflate(b""));
    assert!(decode(&pack(1, &payload)).is_err());
}

#[test]
fn tree_parser_rejects_invalid_utf8_duplicate_names_and_misordered_delimiters() {
    assert!(GitTree::from_bytes(&[b"100644 ".as_slice(), &[0xff, 0], &[0; 20]].concat()).is_err());
    assert!(
        GitTree::from_bytes(
            &[b"100644 a\0".as_slice(), &[0; 20], b"100644 a\0", &[0; 20]].concat()
        )
        .is_err()
    );
    assert!(GitTree::from_bytes(b"100644\0 x").is_err());
}

#[test]
fn malformed_small_packs_and_delta_varints_return_errors_without_panicking() {
    let mut state = 42u32;
    for length in 0..64 {
        for _ in 0..16 {
            let payload: Vec<_> = (0..length)
                .map(|_| {
                    state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                    (state >> 24) as u8
                })
                .collect();
            let _ = decode(&pack(1, &payload));
        }
    }
    assert!(git_rust::utils::apply_delta(&[0xff; 30], b"").is_err());
    assert_eq!(git_rust::utils::apply_delta(&[0, 0], b"").unwrap(), b"");
}

#[test]
fn checked_packet_decoder_rejects_truncation_and_invalid_lengths() {
    use git_rust::models::{GitPktLine, PktLineItem};
    for input in [b"".as_slice(), b"000", b"zzzz", b"0003", b"0008hi"] {
        assert!(GitPktLine::decode(input).is_err());
    }
    assert_eq!(
        GitPktLine::decode(b"0008abcdtrailing").unwrap(),
        (PktLineItem::Line(b"abcd".to_vec()), 8)
    );
    assert_eq!(
        GitPktLine::decode(b"0000PACK").unwrap(),
        (PktLineItem::Flush, 4)
    );
}

#[test]
fn valid_offset_and_thin_reference_deltas_are_readable() {
    use git_rust::models::git_object::GitObject;
    use git_rust::utils::{from_hex, shasum};
    let base = b"hello";
    let base_oid = shasum(&GitObject::wrap("blob", base));
    let delta = [5, 6, 0x90, 5, 1, b'!'];
    let direct = [vec![0x35], zlib_deflate(base)].concat();
    let offset = [vec![0x66, direct.len() as u8], zlib_deflate(&delta)].concat();
    let packed = decode(&pack(2, &[direct, offset].concat())).unwrap();
    let expected = shasum(&GitObject::wrap("blob", b"hello!"));
    assert_eq!(packed.read(&expected).unwrap().object, b"hello!");
    let thin = pack(
        1,
        &[
            vec![0x76],
            from_hex(&base_oid).unwrap(),
            zlib_deflate(&delta),
        ]
        .concat(),
    );
    let external = |oid: &str| {
        assert_eq!(oid, base_oid);
        Ok(UnwrappedObject {
            object_type: "blob".into(),
            object: base.to_vec(),
        })
    };
    let packed = GitPackIndex::from_pack(&thin, Some(&external)).unwrap();
    assert_eq!(packed.read(&expected).unwrap().object, b"hello!");
}

#[test]
fn pack_encoding_accepts_an_object_source_without_a_virtual_filesystem() {
    use git_rust::models::{encode_pack, git_object::GitObject};
    use git_rust::utils::shasum;
    let bytes = encode_pack([Ok(UnwrappedObject {
        object_type: "blob".into(),
        object: b"binary\0data".to_vec(),
    })])
    .unwrap();
    let index = decode(&bytes).unwrap();
    let oid = shasum(&GitObject::wrap("blob", b"binary\0data"));
    assert_eq!(index.read(&oid).unwrap().object, b"binary\0data");
    assert!(
        encode_pack([Ok(UnwrappedObject {
            object_type: "unknown".into(),
            object: vec![]
        })])
        .is_err()
    );
    assert!(decode(&encode_pack([]).unwrap()).unwrap().hashes.is_empty());
}
