use terminal_png_rust::png::{deflate, encode};
#[test]
fn rgba_png_has_chunks_and_bounded_output() {
    let png = encode(2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(&png[12..16], b"IHDR");
    assert_eq!(&png[16..20], &2_u32.to_be_bytes());
    assert!(png.windows(4).any(|v| v == b"IDAT"));
    assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
    assert!(encode(0, 1, &[]).is_err());
    assert!(encode(2, 2, &[0; 4]).is_err());
    assert!(encode(u32::MAX, u32::MAX, &[]).is_err());
}
#[test]
fn fixed_deflate_compresses_repeated_pixels() {
    let input = vec![42; 65536];
    let compressed = deflate(&input);
    assert_eq!(compressed[0], 0x78);
    assert!(compressed.len() < 1024);
}
