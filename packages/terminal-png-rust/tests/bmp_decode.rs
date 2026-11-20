use terminal_png_rust::bmp::{decode, decode_async};

fn bmp(
    width: i32,
    height: i32,
    depth: u16,
    compression: u32,
    palette: &[[u8; 3]],
    data: &[u8],
) -> Vec<u8> {
    let offset = 54 + palette.len() * 4;
    let mut bytes = vec![0; offset];
    bytes[..2].copy_from_slice(b"BM");
    bytes[2..6].copy_from_slice(&((offset + data.len()) as u32).to_le_bytes());
    bytes[10..14].copy_from_slice(&(offset as u32).to_le_bytes());
    bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
    bytes[18..22].copy_from_slice(&width.to_le_bytes());
    bytes[22..26].copy_from_slice(&height.to_le_bytes());
    bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&depth.to_le_bytes());
    bytes[30..34].copy_from_slice(&compression.to_le_bytes());
    bytes[34..38].copy_from_slice(&(data.len() as u32).to_le_bytes());
    bytes[46..50].copy_from_slice(&(palette.len() as u32).to_le_bytes());
    for (index, [r, g, b]) in palette.iter().enumerate() {
        bytes[54 + index * 4..58 + index * 4].copy_from_slice(&[*b, *g, *r, 0]);
    }
    bytes.extend_from_slice(data);
    bytes
}

const COLORS: [[u8; 3]; 3] = [[0, 0, 0], [0, 255, 0], [255, 0, 0]];

#[test]
fn rle8_runs_are_pixels_instead_of_palette_and_command_bytes() {
    let bytes = bmp(2, 1, 8, 1, &COLORS[..2], &[2, 1, 0, 1]);
    assert_eq!(decode(&bytes, 8).unwrap().pixels, [[0, 255, 0, 255]; 2]);
}

#[test]
fn rgb32_reserved_byte_is_opaque_and_rgb16_is_rgb555() {
    assert_eq!(
        decode(&bmp(1, 1, 32, 0, &[], &[3, 2, 1, 0]), 4)
            .unwrap()
            .pixels,
        [[1, 2, 3, 255]]
    );
    assert_eq!(
        decode(&bmp(1, 1, 16, 0, &[], &[0, 124, 0, 0]), 4)
            .unwrap()
            .pixels,
        [[255, 0, 0, 255]]
    );
}

#[test]
fn truncated_and_unsupported_input_is_rejected_instead_of_black_filled() {
    let full = bmp(2, 2, 24, 0, &[], &[0; 16]);
    for length in 0..full.len() {
        assert!(
            decode(&full[..length], 16).is_err(),
            "truncation at {length}"
        );
    }
    for compression in [2, 4, 5, 7, 99] {
        assert!(
            decode(&bmp(2, 1, 8, compression, &COLORS, &[0; 4]), 8).is_err(),
            "compression {compression}"
        );
    }
    assert!(decode(&bmp(-2, 1, 24, 0, &[], &[0; 8]), 8).is_err());
}

#[test]
fn os2_core_header_uses_unsigned_dimensions_and_three_byte_palette() {
    let mut bytes = vec![0; 36];
    bytes[..2].copy_from_slice(b"BM");
    bytes[2..6].copy_from_slice(&36u32.to_le_bytes());
    bytes[10..14].copy_from_slice(&32u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&12u32.to_le_bytes());
    bytes[18..20].copy_from_slice(&2u16.to_le_bytes());
    bytes[20..22].copy_from_slice(&1u16.to_le_bytes());
    bytes[22..24].copy_from_slice(&1u16.to_le_bytes());
    bytes[24..26].copy_from_slice(&1u16.to_le_bytes());
    bytes[29..32].copy_from_slice(&[0, 255, 0]);
    bytes[32] = 0b0100_0000;
    assert_eq!(
        decode(&bytes, 8).unwrap().pixels,
        [[0, 0, 0, 255], [0, 255, 0, 255]]
    );
}

#[test]
fn output_byte_limit_is_applied_before_decoding() {
    let bytes = bmp(2, 2, 24, 0, &[], &[0; 16]);
    assert!(decode(&bytes, 15).is_err());
    assert_eq!(decode(&bytes, 16).unwrap().pixels.len(), 4);
    let async_image = mcp_protocol_rust::cooperate::block_on(decode_async(&bytes, 16)).unwrap();
    assert_eq!(async_image.pixels, decode(&bytes, 16).unwrap().pixels);
}

fn bitfields(depth: u16, dib: usize, compression: u32, masks: [u32; 4], pixel: u32) -> Vec<u8> {
    let mut bytes = bmp(1, 1, depth, compression, &[], &pixel.to_le_bytes());
    let growth = if dib == 40 {
        if compression == 6 { 16 } else { 12 }
    } else {
        dib - 40
    };
    bytes.splice(54..54, vec![0; growth]);
    let length = bytes.len() as u32;
    bytes[2..6].copy_from_slice(&length.to_le_bytes());
    bytes[10..14].copy_from_slice(&((54 + growth) as u32).to_le_bytes());
    bytes[14..18].copy_from_slice(&(dib as u32).to_le_bytes());
    let count = if dib >= 56 || compression == 6 { 4 } else { 3 };
    for (i, mask) in masks[..count].iter().enumerate() {
        bytes[54 + i * 4..58 + i * 4].copy_from_slice(&mask.to_le_bytes());
    }
    bytes
}

#[test]
fn bitfields_honor_component_order_depth_and_explicit_alpha() {
    for dib in [40, 52, 56, 108, 124] {
        let bytes = bitfields(16, dib, 3, [0xf800, 0x07e0, 0x001f, 0], 0xf800);
        assert_eq!(
            decode(&bytes, 4).unwrap().pixels,
            [[255, 0, 0, 255]],
            "dib {dib}"
        );
    }
    for (dib, compression) in [(40, 6), (56, 3), (108, 3), (124, 3)] {
        let bytes = bitfields(
            32,
            dib,
            compression,
            [0xff, 0xff00, 0xff0000, 0xff000000],
            0x80030201,
        );
        let image = decode(&bytes, 4).unwrap();
        assert_eq!(image.pixels, [[1, 2, 3, 128]], "dib {dib}");
        assert!(image.alpha);
        let transparent = bitfields(
            32,
            dib,
            compression,
            [0xff, 0xff00, 0xff0000, 0xff000000],
            0x00030201,
        );
        assert_eq!(decode(&transparent, 4).unwrap().pixels[0][3], 0);
    }
}

#[test]
fn reduced_depth_components_match_pandoc_nearest_sample_scaling() {
    // Pandoc/pdflatex preserves the full 5-bit range with nearest rounding;
    // Pillow's BMP reader instead truncates sample 3 to 24.
    let rgb555 = bmp(1, 1, 16, 0, &[], &(3u32 << 10).to_le_bytes());
    assert_eq!(decode(&rgb555, 4).unwrap().pixels, [[25, 0, 0, 255]]);
    let rgb565 = bitfields(
        16,
        40,
        3,
        [0xf800, 0x07e0, 0x001f, 0],
        (15 << 11) | (31 << 5) | 3,
    );
    assert_eq!(decode(&rgb565, 4).unwrap().pixels, [[123, 125, 25, 255]]);
}

#[test]
fn invalid_or_missing_bitfields_do_not_publish_guessed_colors() {
    for masks in [
        [0, 0x07e0, 0x001f, 0],
        [0xf800, 0xf800, 0x001f, 0],
        [0xa800, 0x07e0, 0x001f, 0],
        [0x1f0000, 0x07e0, 0x001f, 0],
    ] {
        assert!(
            decode(&bitfields(16, 40, 3, masks, 0), 4).is_err(),
            "{masks:?}"
        );
    }
    assert!(decode(&bitfields(32, 40, 6, [0xff0000, 0xff00, 0xff, 0], 0), 4).is_err());
    let mut profiled = bitfields(32, 124, 3, [0xff0000, 0xff00, 0xff, 0], 0);
    profiled[70..74].copy_from_slice(&0x4d424544u32.to_le_bytes());
    assert!(decode(&profiled, 4).is_err());
}

#[test]
fn indexed_rows_honor_padding_nibbles_and_top_down_order() {
    let bytes = bmp(3, -2, 4, 0, &COLORS, &[0x12, 0x10, 0, 0, 0x21, 0x20, 0, 0]);
    let image = decode(&bytes, 24).unwrap();
    let g = [0, 255, 0, 255];
    let r = [255, 0, 0, 255];
    assert_eq!(image.pixels, [g, r, g, r, g, r]);
    let mut bytes = bmp(1, 1, 24, 0, &[], &[3, 2, 1, 0]);
    bytes[38..42].copy_from_slice(&11811u32.to_le_bytes());
    assert_eq!(decode(&bytes, 4).unwrap().density, 300);
}

#[test]
fn rle8_handles_absolute_padding_delta_rows_and_early_end() {
    let bytes = bmp(
        5,
        3,
        8,
        1,
        &COLORS,
        &[
            2, 1, 0, 2, 1, 0, 2, 2, 0, 0, 0, 5, 1, 2, 0, 2, 1, 0, 0, 0, 0, 2, 1, 0, 3, 2, 0, 1,
        ],
    );
    let g = [0, 255, 0, 255];
    let r = [255, 0, 0, 255];
    let k = [0, 0, 0, 255];
    assert_eq!(
        decode(&bytes, 60).unwrap().pixels,
        [k, r, r, r, k, g, r, k, r, g, g, g, k, r, r]
    );
    let bytes = bmp(4, 2, 8, 1, &COLORS, &[0, 2, 1, 1, 2, 1, 0, 1]);
    assert_eq!(decode(&bytes, 32).unwrap().pixels, [k, g, g, k, k, k, k, k]);
}

#[test]
fn rle8_rejects_truncated_commands_out_of_bounds_runs_and_bad_palette_indexes() {
    for data in [
        vec![3, 1, 0, 1],
        vec![0, 3, 1, 1, 1, 0, 0, 1],
        vec![0],
        vec![0, 2, 1],
        vec![0, 2, 3, 0, 0, 1],
        vec![0, 2, 0, 1, 0, 1],
        vec![0, 0, 0, 0, 0, 1],
        vec![2, 3, 0, 1],
        vec![2, 1],
        vec![0, 3, 1, 2, 1],
    ] {
        assert!(
            decode(&bmp(2, 1, 8, 1, &COLORS, &data), 8).is_err(),
            "{data:?}"
        );
    }
    assert!(decode(&bmp(3, 1, 8, 1, &COLORS, &[0, 3, 1, 2, 3, 0, 0, 1]), 12).is_err());
    assert!(decode(&bmp(3, 1, 8, 1, &COLORS, &[0, 3, 1, 2, 1]), 12).is_err());
    assert!(decode(&bmp(2, -1, 8, 1, &COLORS, &[2, 1, 0, 1]), 8).is_err());
}

#[test]
fn malformed_header_palette_and_pixel_offsets_are_rejected() {
    let valid = bmp(2, 1, 8, 0, &COLORS, &[0, 1, 0, 0]);
    for (at, value) in [
        (10, 54u32),
        (10, u32::MAX),
        (14, 64),
        (18, 0),
        (22, 0),
        (26, 0x00080002),
        (28, 2),
        (34, 1),
        (46, 257),
        (2, 54),
    ] {
        let mut bytes = valid.clone();
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
        assert!(decode(&bytes, 8).is_err(), "field {at} = {value}");
    }
    assert!(decode(&bmp(2, 1, 8, 0, &COLORS, &[0, 3, 0, 0]), 8).is_err());
    let mut huge = valid;
    huge[18..22].copy_from_slice(&i32::MAX.to_le_bytes());
    huge[22..26].copy_from_slice(&i32::MIN.to_le_bytes());
    assert!(decode(&huge, 1024).is_err());
}

#[test]
fn asynchronous_decoder_yields_between_pixel_batches() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let bytes = bmp(256, 128, 24, 0, &[], &vec![0; 256 * 128 * 3]);
    let mut future = pin!(decode_async(&bytes, 256 * 128 * 4));
    let mut context = Context::from_waker(Waker::noop());
    let mut yields = 0;
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Pending => yields += 1,
            Poll::Ready(result) => {
                assert_eq!(result.unwrap().pixels.len(), 256 * 128);
                break;
            }
        }
    }
    assert!(yields >= 8, "only {yields} cooperative yields");
}
