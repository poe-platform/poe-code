use document_ast_rust::{Block, Document, Image, cooperate::block_on};
use pdf_ast_rust::{PdfOptions, write_pdf_with_options, write_pdf_with_usage_async};

fn document(images: impl IntoIterator<Item = Vec<u8>>) -> Document {
    Document {
        title: String::new(),
        blocks: images
            .into_iter()
            .map(|bytes| {
                Block::Image(Image {
                    mime: block_on(terminal_png_rust::office_image::characterize(&bytes))
                        .unwrap()
                        .mime
                        .into(),
                    bytes,
                    width: 120.,
                    height: 80.,
                    alt: String::new(),
                    title: String::new(),
                    link: None,
                })
            })
            .collect(),
    }
}

fn find(bytes: &[u8], needle: &[u8]) -> usize {
    bytes
        .windows(needle.len())
        .position(|w| w == needle)
        .expect("PDF token")
}

// Read the actual emitted XObject streams, not the decoder that the writer calls.
fn image_streams(pdf: &[u8]) -> Vec<(usize, usize, bool, Vec<u8>)> {
    let mut rest = pdf;
    let mut images = Vec::new();
    while let Some(at) = rest.windows(15).position(|w| w == b"/Subtype /Image") {
        rest = &rest[at..];
        let stream = find(rest, b"stream\n");
        let header = std::str::from_utf8(&rest[..stream]).unwrap();
        let number = |name: &str| {
            header
                .split_once(name)
                .unwrap()
                .1
                .split_whitespace()
                .next()
                .unwrap()
                .parse::<usize>()
                .unwrap()
        };
        let length = number("/Length");
        let encoded = &rest[stream + 7..stream + 7 + length];
        let (pixels, _) =
            terminal_png_rust::inflate::inflate_raw_bounded(&encoded[2..], 16 * 1024 * 1024)
                .unwrap();
        images.push((
            number("/Width"),
            number("/Height"),
            header.contains("/DeviceGray"),
            pixels,
        ));
        rest = &rest[stream + 7 + length..];
    }
    images
}

fn assert_reference(pdf: &[u8], reference: &[u8], tolerance: u8) {
    let expected = terminal_png_rust::png::decode(reference, 16 * 1024 * 1024).unwrap();
    let streams = image_streams(pdf);
    let color = streams.iter().find(|s| !s.2).expect("RGB image stream");
    assert_eq!((color.0, color.1), (expected.width, expected.height));
    assert_eq!(color.3.len(), expected.pixels.len() * 3);
    let mask = streams.iter().find(|s| s.2);
    if expected.pixels.iter().any(|p| p[3] != 255) {
        let mask = mask.expect("transparent image must emit a soft mask");
        assert_eq!((mask.0, mask.1), (color.0, color.1));
        assert_eq!(
            mask.3,
            expected.pixels.iter().map(|p| p[3]).collect::<Vec<_>>()
        );
        assert!(String::from_utf8_lossy(pdf).contains("/SMask "));
    } else {
        assert!(mask.is_none(), "opaque images need no soft mask");
    }
    for (actual, expected) in color.3.chunks_exact(3).zip(expected.pixels) {
        if expected[3] != 0 {
            assert!(
                actual
                    .iter()
                    .zip(expected)
                    .all(|(&a, b)| a.abs_diff(b) <= tolerance),
                "pixel {actual:?} != {expected:?}"
            );
        }
    }
}

fn bmp(width: u32, height: u32) -> Vec<u8> {
    let stride = (width as usize * 3 + 3) & !3;
    let mut bytes = vec![0; 54 + stride * height as usize];
    let len = bytes.len() as u32;
    bytes[..2].copy_from_slice(b"BM");
    bytes[2..6].copy_from_slice(&len.to_le_bytes());
    bytes[10..14].copy_from_slice(&54u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
    bytes[18..22].copy_from_slice(&width.to_le_bytes());
    bytes[22..26].copy_from_slice(&height.to_le_bytes());
    bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&24u16.to_le_bytes());
    for row in bytes[54..].chunks_exact_mut(stride) {
        for (x, pixel) in row[..width as usize * 3].chunks_exact_mut(3).enumerate() {
            pixel.copy_from_slice(if x % 2 == 0 {
                &[0, 0, 255]
            } else {
                &[255, 0, 0]
            });
        }
    }
    bytes
}

#[test]
fn gif_bmp_and_tiff_embed_real_rgb_and_transparency_streams() {
    for (bytes, reference) in [
        (
            include_bytes!("../../terminal-png-rust/tests/fixtures/gif/transparent.gif").as_slice(),
            include_bytes!("../../terminal-png-rust/tests/fixtures/gif/transparent.png").as_slice(),
        ),
        (
            include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-straight-alpha.tiff")
                .as_slice(),
            include_bytes!(
                "../../terminal-png-rust/tests/fixtures/tiff/tiff-straight-alpha-reference.png"
            )
            .as_slice(),
        ),
    ] {
        let pdf =
            write_pdf_with_options(&document([bytes.to_vec()]), &PdfOptions::default()).unwrap();
        assert_reference(&pdf, reference, 0);
    }
    let pdf = write_pdf_with_options(&document([bmp(2, 1)]), &PdfOptions::default()).unwrap();
    assert_eq!(
        image_streams(&pdf),
        vec![(2, 1, false, vec![255, 0, 0, 0, 0, 255])]
    );
}

#[test]
fn all_exif_orientations_reach_pdf_pixels_without_changing_authored_geometry() {
    macro_rules! cases { ($($n:literal),*) => { [$(
        (include_bytes!(concat!("fixtures/orientation/",$n,".png")).as_slice(), include_bytes!(concat!("fixtures/orientation/",$n,".png.reference.png")).as_slice(),0),
        (include_bytes!(concat!("fixtures/orientation/",$n,".jpg")).as_slice(), include_bytes!(concat!("fixtures/orientation/",$n,".jpg.reference.png")).as_slice(),3),
        (include_bytes!(concat!("fixtures/orientation/",$n,".tiff")).as_slice(), include_bytes!(concat!("fixtures/orientation/",$n,".tiff.reference.png")).as_slice(),0),
    )*] }; }
    for (index, (bytes, reference, tolerance)) in
        cases!(1, 2, 3, 4, 5, 6, 7, 8).into_iter().enumerate()
    {
        let input = document([bytes.to_vec()]);
        let options = PdfOptions::default();
        let layout = pdf_ast_rust::layout_document(&input, &options).unwrap();
        assert!(layout.pages[0].paints.iter().any(|p| matches!(p,pdf_ast_rust::Paint::Image{width,height,..} if *width==90. && *height==60.)), "case {index}: authored dimensions changed");
        let pdf = write_pdf_with_options(&input, &options).unwrap();
        assert_reference(&pdf, reference, tolerance);
    }
}

#[test]
fn mixed_formats_deduplicate_and_charge_aggregate_pixel_and_decode_budgets() {
    let images = [
        include_bytes!("../../terminal-png-rust/tests/fixtures/gif/transparent.gif").to_vec(),
        bmp(2, 1),
        include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-straight-alpha.tiff")
            .to_vec(),
        include_bytes!("fixtures/orientation/6.png").to_vec(),
        include_bytes!("fixtures/orientation/6.jpg").to_vec(),
        include_bytes!("fixtures/orientation/6.tiff").to_vec(),
    ];
    let mut options = PdfOptions::default();
    let individual = images
        .iter()
        .map(|bytes| {
            block_on(write_pdf_with_usage_async(
                &document([bytes.clone()]),
                &options,
            ))
            .unwrap()
            .usage
        })
        .collect::<Vec<_>>();
    let pixels = individual.iter().map(|u| u.image_pixels).sum::<usize>();
    let decoded = individual
        .iter()
        .map(|u| u.decoded_image_bytes)
        .sum::<usize>();
    let input = document(images.iter().chain(images.iter()).cloned());
    options.limits.images = images.len();
    options.limits.image_pixels = pixels;
    options.limits.decoded_image_bytes = decoded;
    let output = block_on(write_pdf_with_usage_async(&input, &options)).unwrap();
    assert_eq!(output.usage.images, images.len());
    assert_eq!(output.usage.image_pixels, pixels);
    assert_eq!(output.usage.decoded_image_bytes, decoded);
    assert_eq!(
        image_streams(&output.bytes).iter().filter(|s| !s.2).count(),
        images.len()
    );
    options.limits.image_pixels -= 1;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("E_LIMIT: PDF imagePixels")
    );
    options.limits.image_pixels += 1;
    options.limits.decoded_image_bytes -= 1;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("E_LIMIT: PDF decodedImageBytes")
    );
}

#[test]
fn gif_bmp_and_tiff_pdf_futures_yield_and_cancel_without_leaking_resources() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    for bytes in [
        include_bytes!("../../terminal-png-rust/tests/fixtures/gif/dictionary-growth.gif").to_vec(),
        bmp(256, 128),
        include_bytes!("fixtures/orientation/7.tiff").to_vec(),
    ] {
        let input = document([bytes]);
        let options = PdfOptions::default();
        let mut cx = Context::from_waker(Waker::noop());
        {
            let mut cancelled = pin!(pdf_ast_rust::write_pdf_with_options_async(&input, &options));
            for _ in 0..16 {
                assert!(cancelled.as_mut().poll(&mut cx).is_pending());
            }
        }
        let mut future = pin!(pdf_ast_rust::write_pdf_with_options_async(&input, &options));
        let mut polls = 0;
        let actual = loop {
            polls += 1;
            match future.as_mut().poll(&mut cx) {
                Poll::Pending => assert!(polls < 100000),
                Poll::Ready(result) => break result.unwrap(),
            }
        };
        assert!(polls > 32, "image processing should yield repeatedly");
        assert_eq!(actual, write_pdf_with_options(&input, &options).unwrap());
    }
}

#[test]
fn image_interpolation_preserves_embedded_pixels_and_source_bytes() {
    let bytes = terminal_png_rust::png::encode(
        2,
        2,
        &[
            255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 255, 0, 255,
        ],
    )
    .unwrap();
    let options = PdfOptions::default();
    let layout = pdf_ast_rust::layout_document(&document([bytes.clone()]), &options).unwrap();
    assert_eq!(layout.images[0].bytes, bytes);
    let pdf = pdf_ast_rust::serialize_pdf(&layout, &options.limits).unwrap();
    assert_reference(&pdf, &bytes, 0);
    let raw = String::from_utf8_lossy(&pdf);
    assert_eq!(
        raw.matches("/Subtype /Image").count(),
        2,
        "RGB and soft mask"
    );
    assert_eq!(
        raw.matches("/Interpolate true").count(),
        2,
        "both RGB and alpha need interpolation"
    );
}

#[test]
#[ignore = "requires independent pypdfium2"]
fn independent_pdfium_interpolates_enlarged_color_and_alpha_samples() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    for rgba in [
        vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
        ],
        vec![255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0],
    ] {
        let alpha = rgba[7] == 0;
        let image = Image {
            bytes: terminal_png_rust::png::encode(2, 2, &rgba).unwrap(),
            mime: "image/png".into(),
            width: 160.,
            height: 160.,
            alt: String::new(),
            title: String::new(),
            link: None,
        };
        let input = Document {
            blocks: vec![Block::Image(image)],
            ..Default::default()
        };
        let options = PdfOptions {
            page: pdf_ast_rust::PageBox {
                width: 160.,
                height: 200.,
                margin: 20.,
            },
            ..Default::default()
        };
        let bytes = write_pdf_with_options(&input, &options).unwrap();
        let mut child = Command::new("python3")
            .args([
                "-c",
                r#"
import sys,pypdfium2 as pdfium
pdf=pdfium.PdfDocument(sys.stdin.buffer.read())
im=pdf[0].render(scale=2).to_pil().convert('RGB')
pixel=im.getpixel((160,100))
expected=(255,128,128) if sys.argv[1]=='alpha' else (128,128,0)
assert all(abs(a-b)<8 for a,b in zip(pixel,expected)),(pixel,expected)
"#,
                if alpha { "alpha" } else { "color" },
            ])
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&bytes).unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
