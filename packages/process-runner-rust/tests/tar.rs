use process_runner_rust::tar::{self, Entry};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn ustar_headers_have_deterministic_modes_checksum_padding_and_empty_tail() {
    let bytes = tar::create(&[Entry {
        path: &u("a.txt"),
        content: &[0, 255, 128],
    }])
    .unwrap();
    assert_eq!(bytes.len(), 2048);
    assert_eq!(&bytes[..6], b"a.txt\0");
    assert_eq!(&bytes[100..108], b"0000644\0");
    assert_eq!(&bytes[124..136], b"00000000003\0");
    assert_eq!(&bytes[257..265], b"ustar\x0000");
    assert_eq!(&bytes[512..515], &[0, 255, 128]);
    assert!(bytes[515..].iter().all(|byte| *byte == 0));
    let expected = bytes[..512]
        .iter()
        .enumerate()
        .map(|(index, byte)| {
            if (148..156).contains(&index) {
                32
            } else {
                *byte as u32
            }
        })
        .sum::<u32>();
    assert_eq!(
        u32::from_str_radix(std::str::from_utf8(&bytes[148..155]).unwrap(), 8).unwrap(),
        expected
    );
    assert_eq!(tar::create(&[]).unwrap(), vec![0; 1024]);
}
#[test]
fn ustar_path_split_checks_utf8_byte_limits_and_preserves_original_error_text() {
    let path = format!("{}/{}", "p".repeat(155), "f".repeat(100));
    let header = tar::header(&u(&path), 512).unwrap();
    assert_eq!(&header[..100], "f".repeat(100).as_bytes());
    assert_eq!(&header[345..500], "p".repeat(155).as_bytes());
    let error = tar::header(&u(&"é".repeat(51)), 1).unwrap_err();
    assert_eq!(
        error,
        u(&format!(
            "Workspace tar path is too long to represent: {}",
            "é".repeat(51)
        ))
    );
    let error = tar::header(&[0xd800; 34], 0).unwrap_err();
    let mut expected = u("Workspace tar path is too long to represent: ");
    expected.extend(vec![0xd800; 34]);
    assert_eq!(error, expected);
    assert_eq!(
        &tar::header(&[0xd800], 0).unwrap()[..3],
        &[0xef, 0xbf, 0xbd]
    );
}
#[test]
fn archive_alignment_covers_boundary_sizes_without_recursive_processing() {
    for size in [0, 1, 511, 512, 513, 1024, 65535] {
        let bytes = tar::create(&[Entry {
            path: &u("file"),
            content: &vec![42; size],
        }])
        .unwrap();
        assert_eq!(bytes.len(), 512 + size.div_ceil(512) * 512 + 1024);
        assert_eq!(&bytes[512..512 + size], vec![42; size]);
        assert!(bytes[512 + size..].iter().all(|byte| *byte == 0));
    }
}
