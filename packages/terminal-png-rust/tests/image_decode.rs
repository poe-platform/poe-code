use terminal_png_rust::png;

#[test]
fn rgba_png_preserves_pixels_and_metadata() {
    let pixels = [
        255, 0, 0, 255, 0, 255, 0, 120, 0, 0, 255, 0, 255, 255, 255, 255,
    ];
    let bytes = png::encode(2, 2, &pixels).unwrap();
    let image = png::decode(&bytes, 1024).unwrap();
    assert_eq!((image.width, image.height), (2, 2));
    assert_eq!(
        image.pixels.iter().flatten().copied().collect::<Vec<_>>(),
        pixels
    );
    assert!(png::decode(&bytes, 15).is_err());
}

#[test]
fn bounded_inflate_and_png_crc_fail_closed() {
    let bytes = png::encode(1, 1, &[1, 2, 3, 255]).unwrap();
    let mut corrupt = bytes.clone();
    corrupt[20] ^= 1;
    assert!(png::decode(&corrupt, 1024).unwrap_err().contains("CRC"));
    let compressed = png::deflate(&vec![42; 1000]);
    assert!(terminal_png_rust::inflate::inflate_raw_bounded(&compressed[2..], 999).is_err());
}

#[test]
fn progressive_jpeg_matches_independent_reference_pixels() {
    let bytes = include_bytes!("fixtures/subsampled-progressive.jpg");
    let image = terminal_png_rust::jpeg::decode(bytes, 65536).unwrap();
    assert_eq!((image.width, image.height), (19, 13));
    // Pillow/libjpeg samples from the original subsampled progressive fixture.
    for ((x, y), expected) in [
        ((0, 0), [15u8, 27, 17]),
        ((5, 5), [153, 181, 159]),
        ((10, 10), [49, 54, 73]),
    ] {
        for (actual, expected) in image.pixels[y * image.width + x][..3].iter().zip(expected) {
            assert!(
                (i16::from(*actual) - i16::from(expected)).abs() <= 4,
                "{x},{y}: {:?}",
                image.pixels[y * image.width + x]
            );
        }
    }
    assert!(terminal_png_rust::jpeg::decode(bytes, 16).is_err());
}

fn poll_with_yield_count<F: std::future::Future>(future: F) -> (F::Output, usize) {
    use std::task::{Context, Poll, Waker};
    let mut future = std::pin::pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    let mut yields = 0;
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(result) => return (result, yields),
            Poll::Pending => yields += 1,
        }
    }
}

#[test]
fn async_compression_and_png_decoding_preserve_pixels_and_yield() {
    // One wide row exercises cooperation inside filtering and pixel conversion.
    let pixels: Vec<_> = (0..8192 * 4)
        .map(|index| (index * 37 % 251) as u8)
        .collect();
    let (compressed, yields) = poll_with_yield_count(png::deflate_async(&pixels));
    assert_eq!(compressed, png::deflate(&pixels));
    assert!(yields >= 8, "compression did not yield bounded work");
    let (raw, consumed) =
        terminal_png_rust::inflate::inflate_raw_bounded(&compressed[2..], pixels.len()).unwrap();
    assert_eq!(raw, pixels);
    assert_eq!(consumed + 6, compressed.len());
    let encoded = png::encode(8192, 1, &pixels).unwrap();
    let (decoded, yields) = poll_with_yield_count(png::decode_async(&encoded, 128 * 1024));
    let decoded = decoded.unwrap();
    assert_eq!(
        decoded.pixels,
        png::decode(&encoded, 128 * 1024).unwrap().pixels
    );
    assert_eq!(
        decoded.pixels.iter().flatten().copied().collect::<Vec<_>>(),
        pixels
    );
    assert!(yields >= 16, "PNG decoding did not yield bounded work");
    assert!(
        poll_with_yield_count(png::decode_async(&encoded, 128))
            .0
            .is_err()
    );
}

#[test]
fn async_progressive_jpeg_preserves_pixels_and_yields() {
    let bytes = include_bytes!("fixtures/subsampled-progressive.jpg");
    let (decoded, yields) =
        poll_with_yield_count(terminal_png_rust::jpeg::decode_async(bytes, 65536));
    assert_eq!(
        decoded.unwrap().pixels,
        terminal_png_rust::jpeg::decode(bytes, 65536)
            .unwrap()
            .pixels
    );
    assert!(yields > 8, "JPEG reconstruction did not yield bounded work");
    assert!(
        poll_with_yield_count(terminal_png_rust::jpeg::decode_async(bytes, 16))
            .0
            .is_err()
    );
}

#[test]
fn missing_png_end_and_jpeg_scan_are_rejected() {
    let png = png::encode(1, 1, &[1, 2, 3, 255]).unwrap();
    assert!(png::decode(&png[..png.len() - 12], 1024).is_err());
    let jpeg = include_bytes!("fixtures/subsampled-progressive.jpg");
    let first_scan = jpeg
        .windows(2)
        .position(|pair| pair == b"\xff\xda")
        .unwrap();
    let mut no_scan = jpeg[..first_scan].to_vec();
    no_scan.extend_from_slice(b"\xff\xd9");
    assert!(terminal_png_rust::jpeg::decode(&no_scan, 65536).is_err());
}
