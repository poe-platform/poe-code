// image-ast stores lossless RGBA in its HEIF primary item using POEHEIF1.
// Item locations are absolute offsets from the start of the container.
use super::{image_header, mp4::mux::atom, png_pixels::Raster};
use crate::commands::codecs::zlib_compress;

pub(super) fn encode(
    im: &Raster,
    format: &str,
    density: u32,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let pixels = zlib_compress(im.pixels.as_flattened());
    let primary = 8 + pixels.len();
    let (brand, compat, item) = match format {
        "avif" => (b"avif", b"miaf", b"av01"),
        "heif" => (b"heif", b"msf1", b"hvc1"),
        _ => (b"heic", b"heix", b"hvc1"),
    };
    let mut out = Vec::new();
    atom(&mut out, b"ftyp", |b| {
        b.extend(brand);
        b.extend(b"\0\0\0\0mif1");
        b.extend(brand);
        b.extend(compat);
    });
    let mut locations = 0;
    atom(&mut out, b"meta", |b| {
        b.extend([0; 4]);
        atom(b, b"hdlr", |b| {
            b.extend([0; 8]);
            b.extend(b"pict");
            b.extend([0; 14]);
        });
        atom(b, b"pitm", |b| b.extend([0, 0, 0, 0, 0, 1]));
        atom(b, b"iinf", |b| {
            b.extend([0, 0, 0, 0, 0, 2]);
            for (id, kind) in [(1, item), (2, b"Exif")] {
                atom(b, b"infe", |b| {
                    b.extend([2, 0, 0, 0, 0, id, 0, 0]);
                    b.extend(kind);
                    b.push(0);
                });
            }
        });
        atom(b, b"iref", |b| {
            b.extend([0; 4]);
            atom(b, b"cdsc", |b| b.extend([0, 2, 0, 1, 0, 1]));
        });
        atom(b, b"iprp", |b| {
            let mut count = 2;
            atom(b, b"ipco", |b| {
                atom(b, b"ispe", |b| {
                    b.extend([0; 4]);
                    b.extend((im.width as u32).to_be_bytes());
                    b.extend((im.height as u32).to_be_bytes());
                });
                atom(b, b"pixi", |b| {
                    let channels = if im.gray { 1 } else { 3 } + u8::from(im.alpha);
                    b.extend([0, 0, 0, 0, channels]);
                    b.extend(std::iter::repeat_n(8, usize::from(channels)));
                });
                if let Some(code) = match im.orientation {
                    Some(6) => Some(3),
                    Some(3) => Some(2),
                    Some(8) => Some(1),
                    _ => None,
                } {
                    atom(b, b"irot", |b| b.push(code));
                    count += 1;
                }
                if im.alpha {
                    atom(b, b"auxC", |b| {
                        b.extend([0; 4]);
                        b.extend(b"urn:mpeg:hevc:2015:auxid:1\0");
                    });
                    count += 1;
                }
            });
            atom(b, b"ipma", |b| {
                b.extend([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, count]);
                b.extend((1..=count).map(|v| v | 0x80));
            });
        });
        atom(b, b"iloc", |b| {
            b.extend([0, 0, 0, 0, 0x44, 0, 0, 2]);
            locations = b.len();
            for id in [1, 2] {
                b.extend([0, id, 0, 0, 0, 1]);
                b.extend([0; 8]);
            }
        });
    });
    let exif = image_header::encode_exif(im.orientation.unwrap_or(1), density);
    let exif_size = 10 + exif.len();
    let offset = out.len() + 8;
    let size = offset.saturating_add(primary).saturating_add(exif_size);
    if size > limit || size > u32::MAX as usize {
        return Err("output byte limit exceeded");
    }
    for (at, value) in [
        (6, offset),
        (10, primary),
        (20, offset + primary),
        (24, exif_size),
    ] {
        out[locations + at..locations + at + 4].copy_from_slice(&(value as u32).to_be_bytes());
    }
    atom(&mut out, b"mdat", |b| {
        b.extend(b"POEHEIF1");
        b.extend(pixels);
        b.extend(b"\0\0\0\x06Exif\0\0");
        b.extend(exif);
    });
    Ok(out)
}
