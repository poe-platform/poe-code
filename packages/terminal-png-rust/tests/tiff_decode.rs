use terminal_png_rust::{png, tiff};
// Independently encoded Pillow/libtiff fixtures; reference PNGs contain decoded RGBA.

#[test]
fn tiff_rgb_raw() {
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-rgb-raw-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_rgb_packbits() {
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb-packbits.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-rgb-packbits-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_rgb_tiff_lzw() {
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb-tiff_lzw.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-rgb-tiff_lzw-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_rgb_tiff_adobe_deflate() {
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb-tiff_adobe_deflate.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-rgb-tiff_adobe_deflate-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_rgb_predictor() {
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb-predictor.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-rgb-predictor-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_multiple_strips() {
    let bytes = include_bytes!("fixtures/tiff/tiff-multiple-strips.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-multiple-strips-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_tiled() {
    let bytes = include_bytes!("fixtures/tiff/tiff-tiled.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-tiled-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_big_endian() {
    let bytes = include_bytes!("fixtures/tiff/tiff-big-endian.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-big-endian-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_straight_alpha() {
    let bytes = include_bytes!("fixtures/tiff/tiff-straight-alpha.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-straight-alpha-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_associated_alpha() {
    let bytes = include_bytes!("fixtures/tiff/tiff-associated-alpha.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-associated-alpha-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    for (actual, expected) in actual.pixels.iter().zip(&expected.pixels) {
        assert_eq!(actual[3], expected[3]);
        for c in 0..3 {
            assert!(
                (u32::from(actual[c]) * u32::from(actual[3]))
                    .abs_diff(u32::from(expected[c]) * u32::from(expected[3]))
                    <= 255
            );
        }
    }
}

#[test]
fn tiff_gray8() {
    let bytes = include_bytes!("fixtures/tiff/tiff-gray8.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-gray8-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_white_is_zero8() {
    let bytes = include_bytes!("fixtures/tiff/tiff-white-is-zero8.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-white-is-zero8-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_white_is_zero1() {
    let bytes = include_bytes!("fixtures/tiff/tiff-white-is-zero1.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-white-is-zero1-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_gray16() {
    let bytes = include_bytes!("fixtures/tiff/tiff-gray16.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-gray16-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_rgb16() {
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb16.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-rgb16-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_palette() {
    let bytes = include_bytes!("fixtures/tiff/tiff-palette.tiff");
    assert!(tiff::decode(bytes, 1 << 20).is_err());
}

#[test]
fn tiff_cmyk() {
    let bytes = include_bytes!("fixtures/tiff/tiff-cmyk.tiff");
    assert!(tiff::decode(bytes, 1 << 20).is_err());
}

#[test]
fn tiff_planar_separate() {
    let bytes = include_bytes!("fixtures/tiff/tiff-planar-separate.tiff");
    assert!(tiff::decode(bytes, 1 << 20).is_err());
}

#[test]
fn tiff_multipage_first() {
    let bytes = include_bytes!("fixtures/tiff/tiff-multipage-first.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-multipage-first-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_jpeg() {
    let bytes = include_bytes!("fixtures/tiff/tiff-jpeg.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-jpeg-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    let difference = actual
        .pixels
        .iter()
        .zip(&expected.pixels)
        .flat_map(|(a, b)| a.iter().zip(b).map(|(a, b)| a.abs_diff(*b)))
        .max()
        .unwrap();
    assert!(difference <= 3, "JPEG channel difference {difference}");
}

#[test]
fn tiff_ccitt_g4() {
    let bytes = include_bytes!("fixtures/tiff/tiff-ccitt-g4.tiff");
    let expected = png::decode(
        include_bytes!("fixtures/tiff/tiff-ccitt-g4-reference.png"),
        1 << 20,
    )
    .unwrap();
    let actual = tiff::decode(bytes, 1 << 20).unwrap();
    assert_eq!(
        (actual.width, actual.height),
        (expected.width, expected.height)
    );
    assert_eq!(actual.pixels, expected.pixels);
}

#[test]
fn tiff_truncated_strip() {
    let bytes = include_bytes!("fixtures/tiff/tiff-truncated-strip.tiff");
    assert!(tiff::decode(bytes, 1 << 20).is_err());
}

#[test]
fn dimensions_admitted_before_allocation() {
    let mut bytes = include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff").to_vec();
    let off = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let count = u16::from_le_bytes(bytes[off..off + 2].try_into().unwrap()) as usize;
    for field in bytes[off + 2..off + 2 + count * 12].chunks_exact_mut(12) {
        if u16::from_le_bytes(field[..2].try_into().unwrap()) == 256 {
            field[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        }
    }
    assert_eq!(
        tiff::decode(&bytes, 4096).unwrap_err(),
        "image exceeds memory budget"
    );
}

fn field_mut(bytes: &mut [u8], tag: u16) -> &mut [u8] {
    let directory = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let count = u16::from_le_bytes(bytes[directory..directory + 2].try_into().unwrap()) as usize;
    bytes[directory + 2..directory + 2 + count * 12]
        .chunks_exact_mut(12)
        .find(|entry| u16::from_le_bytes(entry[..2].try_into().unwrap()) == tag)
        .unwrap()
}

#[test]
fn rejects_ambiguous_sample_metadata_and_unsupported_color_profiles() {
    for (tag, value) in [(258, 12u32), (277, 9), (284, 2), (262, 5)] {
        let mut bytes = include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff").to_vec();
        field_mut(&mut bytes, tag)[8..12].copy_from_slice(&value.to_le_bytes());
        assert!(tiff::decode(&bytes, 1 << 20).is_err(), "tag {tag}");
    }
    for tag in [318u16, 319, 34675] {
        let mut bytes = include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff").to_vec();
        field_mut(&mut bytes, 284)[..2].copy_from_slice(&tag.to_le_bytes());
        assert_eq!(
            tiff::decode(&bytes, 1 << 20).unwrap_err(),
            "Unsupported TIFF encoding"
        );
    }
    let mut bytes = include_bytes!("fixtures/tiff/tiff-straight-alpha.tiff").to_vec();
    field_mut(&mut bytes, 338)[8..12].copy_from_slice(&3u32.to_le_bytes());
    assert!(tiff::decode(&bytes, 1 << 20).is_err());
}

#[test]
fn corrupted_compressed_strips_never_produce_partial_images() {
    let fixtures: &[&[u8]] = &[
        include_bytes!("fixtures/tiff/tiff-rgb-packbits.tiff"),
        include_bytes!("fixtures/tiff/tiff-rgb-tiff_lzw.tiff"),
        include_bytes!("fixtures/tiff/tiff-rgb-tiff_adobe_deflate.tiff"),
        include_bytes!("fixtures/tiff/tiff-ccitt-g4.tiff"),
        include_bytes!("fixtures/tiff/tiff-jpeg.tiff"),
    ];
    for source in fixtures {
        let mut bytes = source.to_vec();
        let entry = field_mut(&mut bytes, 273);
        let offset = u32::from_le_bytes(entry[8..12].try_into().unwrap()) as usize;
        field_mut(&mut bytes, 279)[8..12].copy_from_slice(&1u32.to_le_bytes());
        bytes[offset] = 0;
        assert!(tiff::decode(&bytes, 1 << 20).is_err());
    }
    let mut stream = terminal_png_rust::lzw::MsbBitWriter::new();
    stream.write_bits(256, 9);
    stream.write_bits(42, 9);
    let mut out = Vec::new();
    assert!(terminal_png_rust::lzw::decode(&stream.finish(), 1., 100, &mut out).is_err());
}

#[test]
fn raw_images_fit_exact_pixel_budget_and_compressed_scratch_is_bounded() {
    for bytes in [
        include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff").as_slice(),
        include_bytes!("fixtures/tiff/tiff-tiled.tiff").as_slice(),
    ] {
        let image = tiff::decode(bytes, 1 << 20).unwrap();
        let exact = image.width * image.height * 4;
        assert_eq!(tiff::decode(bytes, exact).unwrap().pixels, image.pixels);
        assert_eq!(
            tiff::decode(bytes, exact - 1).unwrap_err(),
            "image exceeds memory budget"
        );
    }
    let bytes = include_bytes!("fixtures/tiff/tiff-rgb-packbits.tiff");
    let image = tiff::decode(bytes, 1 << 20).unwrap();
    let pixels = image.width * image.height;
    assert_eq!(
        tiff::decode(bytes, pixels * 7).unwrap().pixels,
        image.pixels
    );
    assert_eq!(
        tiff::decode(bytes, pixels * 7 - 1).unwrap_err(),
        "image exceeds memory budget"
    );
}

#[test]
fn every_codec_yields_while_decoding_and_recovers_after_drop() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let fixtures: &[&[u8]] = &[
        include_bytes!("fixtures/tiff/tiff-rgb-raw.tiff"),
        include_bytes!("fixtures/tiff/tiff-tiled.tiff"),
        include_bytes!("fixtures/tiff/tiff-rgb-packbits.tiff"),
        include_bytes!("fixtures/tiff/tiff-rgb-tiff_lzw.tiff"),
        include_bytes!("fixtures/tiff/tiff-rgb-tiff_adobe_deflate.tiff"),
        include_bytes!("fixtures/tiff/tiff-ccitt-g4.tiff"),
        include_bytes!("fixtures/tiff/tiff-jpeg.tiff"),
    ];
    for bytes in fixtures {
        let image = tiff::Tiff::parse(bytes, 1 << 20).unwrap();
        let expected = image.decode().unwrap();
        let mut context = Context::from_waker(Waker::noop());
        {
            let mut future = pin!(image.decode_async());
            for _ in 0..4 {
                assert!(future.as_mut().poll(&mut context).is_pending());
            }
        }
        let mut future = pin!(image.decode_async());
        let mut polls = 0;
        let actual = loop {
            polls += 1;
            match future.as_mut().poll(&mut context) {
                Poll::Ready(result) => break result.unwrap(),
                Poll::Pending => assert!(polls < 100_000),
            }
        };
        assert!(polls > image.height);
        assert_eq!(actual.pixels, expected.pixels);
    }
}

#[test]
fn repeated_padded_tiles_obey_a_cumulative_decompression_budget() {
    // A narrow visible image must not decompress arbitrarily wide padded tiles
    // repeatedly just because each individual tile fits the scratch buffer.
    let mut bytes = b"II*\0\x08\0\0\0".to_vec();
    let fields = [
        (256u16, 1u32),
        (257, 100),
        (258, 8),
        (259, 32773),
        (262, 1),
        (277, 1),
        (322, 1024),
        (323, 1),
        (324, 134),
        (325, 534),
    ];
    bytes.extend_from_slice(&(fields.len() as u16).to_le_bytes());
    for (tag, value) in fields {
        bytes.extend_from_slice(&tag.to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&(if matches!(tag, 324 | 325) { 100u32 } else { 1 }).to_le_bytes());
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes.extend_from_slice(&0u32.to_le_bytes());
    for value in [934u32, 16] {
        for _ in 0..100 {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    for _ in 0..8 {
        bytes.extend_from_slice(&[129, 0]);
    }
    assert_eq!(
        tiff::decode(&bytes, 2048).unwrap_err(),
        "E_LIMIT: TIFF decompression work limit exceeded"
    );
    assert_eq!(
        tiff::decode(&bytes, 16384).unwrap().pixels,
        vec![[0, 0, 0, 255]; 100]
    );
}
