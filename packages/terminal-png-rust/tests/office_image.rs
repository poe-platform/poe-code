use mcp_protocol_rust::cooperate::block_on;
use terminal_png_rust::office_image::characterize;
fn header(bytes: &[u8]) -> terminal_png_rust::office_image::RasterHeader {
    block_on(characterize(bytes)).unwrap()
}
#[test]
fn gif_bounds_palette_and_preserves_dimensions() {
    let bytes = b"GIF89a\x02\0\x01\0\x80\0\0\0\0\0\xff\xff\xff";
    let image = header(bytes);
    assert_eq!(
        (image.mime, image.width, image.height, image.dpi_x),
        ("image/gif", 2, 1, None)
    );
    assert!(block_on(characterize(&bytes[..18])).is_err());
}
#[test]
fn jpeg_uses_independent_jfif_density_axes() {
    let bytes = [
        255, 216, 255, 224, 0, 16, b'J', b'F', b'I', b'F', 0, 1, 1, 1, 0, 200, 0, 100, 0, 0, 255,
        192, 0, 11, 8, 0, 100, 0, 200, 1, 1, 0x11, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 255, 217,
    ];
    let image = header(&bytes);
    assert_eq!(
        (image.width, image.height, image.dpi_x, image.dpi_y),
        (200, 100, Some(200.), Some(100.))
    );
    assert!(block_on(characterize(&bytes[..bytes.len() - 2])).is_err());
}
#[test]
fn bmp_uses_signed_height_and_physical_density() {
    let mut bytes = vec![0u8; 54];
    bytes[..2].copy_from_slice(b"BM");
    bytes[10..14].copy_from_slice(&54u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
    bytes[18..22].copy_from_slice(&200i32.to_le_bytes());
    bytes[22..26].copy_from_slice(&(-100i32).to_le_bytes());
    bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
    bytes[38..42].copy_from_slice(&10000i32.to_le_bytes());
    bytes[42..46].copy_from_slice(&20000i32.to_le_bytes());
    let image = header(&bytes);
    assert_eq!(
        (image.width, image.height, image.dpi_x, image.dpi_y),
        (200, 100, Some(254.), Some(508.))
    );
    bytes[10..14].copy_from_slice(&999u32.to_le_bytes());
    assert!(block_on(characterize(&bytes)).is_err());
}
#[test]
fn tiff_rejects_cyclic_and_out_of_bounds_directories() {
    let mut bytes = b"II*\0\x08\0\0\0\0\0\0\0\0\0".to_vec();
    bytes[10..14].copy_from_slice(&8u32.to_le_bytes());
    assert!(block_on(characterize(&bytes)).is_err());
    bytes[10..14].copy_from_slice(&10000u32.to_le_bytes());
    assert!(block_on(characterize(&bytes)).is_err());
}

#[test]
fn bmp_core_header_is_admitted_without_density() {
    let mut bytes = vec![0; 26];
    bytes[..2].copy_from_slice(b"BM");
    bytes[10..14].copy_from_slice(&26u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&12u32.to_le_bytes());
    bytes[18..20].copy_from_slice(&3u16.to_le_bytes());
    bytes[20..22].copy_from_slice(&2u16.to_le_bytes());
    bytes[22..24].copy_from_slice(&1u16.to_le_bytes());
    bytes[24..26].copy_from_slice(&24u16.to_le_bytes());
    let image = header(&bytes);
    assert_eq!((image.width, image.height, image.dpi_x), (3, 2, None));
}

#[test]
fn tiff_uses_first_page_dimensions_when_later_pages_differ() {
    let mut bytes = b"II*\0\x08\0\0\0".to_vec();
    for (width, height, next) in [(3u32, 2u32, 38u32), (7, 9, 0)] {
        bytes.extend_from_slice(&2u16.to_le_bytes());
        for (tag, value) in [(256u16, width), (257, height)] {
            bytes.extend_from_slice(&tag.to_le_bytes());
            bytes.extend_from_slice(&4u16.to_le_bytes());
            bytes.extend_from_slice(&1u32.to_le_bytes());
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&next.to_le_bytes());
    }
    let image = header(&bytes);
    assert_eq!((image.width, image.height), (3, 2));
}

#[test]
fn tiff_payload_spans_are_checked_without_requiring_supported_color_profiles() {
    for bytes in [
        include_bytes!("fixtures/tiff/tiff-cmyk.tiff").as_slice(),
        include_bytes!("fixtures/tiff/tiff-palette.tiff").as_slice(),
        include_bytes!("fixtures/tiff/tiff-planar-separate.tiff").as_slice(),
        include_bytes!("fixtures/tiff/tiff-tiled.tiff").as_slice(),
        include_bytes!("fixtures/tiff/tiff-big-endian.tiff").as_slice(),
        include_bytes!("fixtures/tiff/tiff-jpeg.tiff").as_slice(),
    ] {
        assert!(block_on(characterize(bytes)).is_ok());
    }
    let bytes = include_bytes!("fixtures/tiff/tiff-truncated-strip.tiff");
    assert!(block_on(characterize(bytes)).is_err());
    for tag in [273u16, 279] {
        let mut bytes = include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff").to_vec();
        let at = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let count = u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap()) as usize;
        let entry = bytes[at + 2..at + 2 + count * 12]
            .chunks_exact_mut(12)
            .find(|entry| u16::from_le_bytes(entry[..2].try_into().unwrap()) == tag)
            .unwrap();
        entry[2..4].copy_from_slice(&4u16.to_le_bytes());
        entry[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(block_on(characterize(&bytes)).is_err());
    }
}

#[test]
fn bmp_rle8_packet_validation_preserves_office_color_profiles() {
    let mut bytes = vec![0u8; 62];
    bytes[..2].copy_from_slice(b"BM");
    bytes[10..14].copy_from_slice(&62u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
    bytes[18..22].copy_from_slice(&2i32.to_le_bytes());
    bytes[22..26].copy_from_slice(&1i32.to_le_bytes());
    bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&8u16.to_le_bytes());
    bytes[30..34].copy_from_slice(&1u32.to_le_bytes());
    bytes[46..50].copy_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&[2, 1, 0, 1]);
    assert_eq!(header(&bytes).width, 2);
    bytes[62] = 3;
    assert!(block_on(characterize(&bytes)).is_err());
    bytes[62] = 2;
    assert!(block_on(characterize(&bytes[..65])).is_err());
    bytes[63] = 2;
    assert!(block_on(characterize(&bytes)).is_err());
    bytes[63] = 1;
    // A Windows V4 color-space declaration is retained for Office. It does not
    // affect RLE command boundaries and needs no conversion to validate packets.
    bytes.splice(54..54, [0; 68]);
    bytes[14..18].copy_from_slice(&108u32.to_le_bytes());
    bytes[10..14].copy_from_slice(&130u32.to_le_bytes());
    bytes[70..74].copy_from_slice(&0x4d424544u32.to_le_bytes());
    assert_eq!(header(&bytes).width, 2);
}
