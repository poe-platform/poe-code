use terminal_png_rust::gif;

fn header(w: u16, h: u16, background: u8) -> Vec<u8> {
    let mut out = b"GIF89a".to_vec();
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&[
        0x81, background, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]);
    out
}

fn frame(
    out: &mut Vec<u8>,
    size: (u16, u16),
    offset: (u16, u16),
    pixels: &[u8],
    transparent: Option<u8>,
    disposal: u8,
) {
    if transparent.is_some() || disposal != 0 {
        out.extend_from_slice(&[
            33,
            249,
            4,
            (disposal << 2) | u8::from(transparent.is_some()),
            0,
            0,
            transparent.unwrap_or(0),
            0,
        ]);
    }
    out.push(44);
    for v in [offset.0, offset.1, size.0, size.1] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&[0, 2]);
    let mut data = Vec::new();
    let mut pending = 0u32;
    let mut bits = 0;
    for code in pixels.iter().flat_map(|&i| [4, i]).chain([5]) {
        pending |= u32::from(code) << bits;
        bits += 3;
        while bits >= 8 {
            data.push(pending as u8);
            pending >>= 8;
            bits -= 8;
        }
    }
    if bits != 0 {
        data.push(pending as u8);
    }
    for chunk in data.chunks(255) {
        out.push(chunk.len() as u8);
        out.extend_from_slice(chunk);
    }
    out.push(0);
}

fn one(w: u16, h: u16, pixels: &[u8]) -> Vec<u8> {
    let mut out = header(w, h, 0);
    frame(&mut out, (w, h), (0, 0), pixels, None, 0);
    out.push(59);
    out
}

#[test]
fn malformed_gif_rasters_and_descriptors_fail_instead_of_being_padded_or_clipped() {
    let mut bad_minimum = one(1, 1, &[1]);
    bad_minimum[35] = 9;
    let mut bad_palette = one(1, 1, &[3]);
    bad_palette[10] = 0x80;
    bad_palette.drain(19..25);
    let mut outside = header(2, 1, 0);
    frame(&mut outside, (2, 1), (1, 0), &[1, 2], None, 0);
    outside.push(59);
    let mut bad_transparency = header(1, 1, 0);
    frame(&mut bad_transparency, (1, 1), (0, 0), &[1], Some(255), 0);
    bad_transparency.push(59);
    for bytes in [
        one(2, 1, &[1]),
        one(1, 1, &[1, 2]),
        bad_minimum,
        bad_palette,
        outside,
        bad_transparency,
        header(0, 1, 0),
    ] {
        assert!(
            gif::decode(&bytes, 1, 1 << 20, |_, _| Ok(())).is_err(),
            "invalid GIF was accepted"
        );
    }
    let valid = one(2, 1, &[1, 2]);
    for end in 0..valid.len() {
        assert!(
            gif::decode(&valid[..end], 1, 1 << 20, |_, _| Ok(())).is_err(),
            "truncated at {end}"
        );
    }
}

#[test]
fn gif_lzw_accepts_the_next_dictionary_code_but_rejects_unknown_codes() {
    let mut next_code = one(3, 1, &[1]);
    // 3-bit codes: clear=4, red=1, next dictionary entry=6, end=5.
    next_code[37..39].copy_from_slice(&[0x8c, 0x0b]);
    let image = gif::decode(&next_code, 1, 12, |_, _| Ok(())).unwrap();
    assert_eq!(image.pixels, vec![[255, 0, 0, 255]; 3]);
    let mut unknown = next_code;
    unknown[37..39].copy_from_slice(&[0xcc, 0x0b]); // 7 is beyond the next entry (6).
    assert!(
        gif::decode(&unknown, 1, 12, |_, _| Ok(()))
            .unwrap_err()
            .contains("dictionary")
    );
    for minimum in [0, 1, 9, 12] {
        let mut bytes = one(1, 1, &[1]);
        bytes[35] = minimum;
        assert!(
            gif::decode(&bytes, 1, 4, |_, _| Ok(()))
                .unwrap_err()
                .contains("minimum code size")
        );
    }
}

fn visible_pixels(mut pixels: Vec<[u8; 4]>) -> Vec<[u8; 4]> {
    for pixel in &mut pixels {
        if pixel[3] == 0 {
            *pixel = [0; 4];
        }
    }
    pixels
}

#[test]
fn gif_palette_interlace_transparency_offsets_and_first_frame_match_independent_pixels() {
    macro_rules! fixture {
        ($name:literal) => {
            (
                $name,
                include_bytes!(concat!("fixtures/gif/", $name, ".gif")).as_slice(),
                include_bytes!(concat!("fixtures/gif/", $name, ".png")).as_slice(),
            )
        };
    }
    for (name, gif, png) in [
        fixture!("palette"),
        fixture!("transparent"),
        fixture!("interlaced"),
        fixture!("local-palette"),
        fixture!("animation-first"),
        fixture!("dictionary-growth"),
        fixture!("offset-canvas"),
        fixture!("offset-opaque-background"),
        fixture!("offset-other-transparency"),
        fixture!("offset-local-only"),
    ] {
        let actual = gif::decode(gif, 1, 1 << 20, |_, _| Ok(())).unwrap();
        let expected = terminal_png_rust::png::decode(png, 1 << 20).unwrap();
        assert_eq!(
            (actual.width, actual.height),
            (expected.width, expected.height),
            "{name}"
        );
        assert!(
            visible_pixels(actual.pixels) == visible_pixels(expected.pixels),
            "pixels differ for {name}"
        );
    }
}

#[test]
fn gif_animation_frames_match_independent_disposal_references() {
    macro_rules! fixture {
        ($name:literal) => {
            (
                $name,
                include_bytes!(concat!("fixtures/gif/", $name, ".gif")).as_slice(),
                [
                    include_bytes!(concat!("fixtures/gif/", $name, "-0.png")).as_slice(),
                    include_bytes!(concat!("fixtures/gif/", $name, "-1.png")).as_slice(),
                    include_bytes!(concat!("fixtures/gif/", $name, "-2.png")).as_slice(),
                ],
            )
        };
    }
    for (name, gif, references) in [
        fixture!("disposal2-opaque"),
        fixture!("disposal2-transparent"),
        fixture!("disposal3-opaque"),
        fixture!("disposal3-transparent"),
    ] {
        let mut frames = Vec::new();
        gif::decode(gif, usize::MAX, 1 << 20, |pixels, _| {
            frames.push(pixels.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(frames.len(), references.len());
        for (n, (actual, png)) in frames.into_iter().zip(references).enumerate() {
            let expected = terminal_png_rust::png::decode(png, 1 << 20).unwrap();
            assert!(
                visible_pixels(actual) == visible_pixels(expected.pixels),
                "pixels differ for {name} frame {n}"
            );
        }
        let (w, h) = gif::dimensions(gif).unwrap();
        if name.starts_with("disposal3") {
            assert!(
                gif::decode(gif, usize::MAX, (w * h * 4) as usize, |_, _| Ok(()))
                    .unwrap_err()
                    .contains("memory budget")
            );
        }
    }
}

#[test]
fn gif_first_frame_keeps_unpainted_logical_canvas_transparent_like_browsers() {
    for transparent in [None, Some(2)] {
        let mut bytes = header(3, 2, 1);
        frame(&mut bytes, (1, 1), (1, 1), &[3], transparent, 0);
        bytes.push(59);
        let image = gif::decode(&bytes, 1, 24, |_, _| Ok(())).unwrap();
        let bg = [0; 4];
        assert_eq!(image.pixels, vec![bg, bg, bg, bg, [0, 0, 255, 255], bg]);
        assert!(image.alpha);
    }
}

#[test]
fn gif_animation_disposal_and_first_frame_selection_share_the_same_decoder() {
    for disposal in [2, 3] {
        let mut bytes = header(3, 1, 1);
        frame(&mut bytes, (3, 1), (0, 0), &[2, 2, 2], None, 0);
        frame(&mut bytes, (1, 1), (0, 0), &[3], None, disposal);
        frame(&mut bytes, (1, 1), (2, 0), &[3], None, 0);
        bytes.push(59);
        let first = gif::decode(&bytes, 1, 12, |_, _| Ok(())).unwrap();
        assert_eq!(first.pixels, vec![[0, 255, 0, 255]; 3]);
        let mut seen = Vec::new();
        let last = gif::decode(&bytes, usize::MAX, 24, |pixels, _| {
            seen.push(pixels.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(seen.len(), 3);
        let left = if disposal == 2 {
            [255, 0, 0, 255]
        } else {
            [0, 255, 0, 255]
        };
        assert_eq!(last.pixels, vec![left, [0, 255, 0, 255], [0, 0, 255, 255]]);
    }
}

#[test]
fn gif_budget_and_async_yields_are_enforced_inside_pixel_decoding() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let bytes = one(128, 64, &vec![1; 8192]);
    assert!(
        gif::decode(&bytes, 1, 8192 * 4 - 1, |_, _| Ok(()))
            .unwrap_err()
            .contains("memory budget")
    );
    let mut future = pin!(gif::decode_async(&bytes, 1, 8192 * 4, |_, _| Ok(())));
    let mut cx = Context::from_waker(Waker::noop());
    let mut yields = 0;
    let image = loop {
        match future.as_mut().poll(&mut cx) {
            Poll::Pending => yields += 1,
            Poll::Ready(result) => break result.unwrap(),
        }
    };
    assert!(yields > 4, "GIF decoding must yield within LZW/pixel work");
    assert_eq!(image.pixels, vec![[255, 0, 0, 255]; 8192]);
    assert!(gif::decode(&bytes, 0, 8192 * 4, |_, _| Ok(())).is_err());
    assert_eq!(
        gif::decode(&bytes, 1, 8192 * 4, |_, _| Err("visitor stopped")).unwrap_err(),
        "visitor stopped"
    );
}
