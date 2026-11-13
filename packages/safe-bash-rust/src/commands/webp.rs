use super::{image_header, png_pixels::Raster};

pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
}

fn chunks(bytes: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    let mut tail = bytes.get(12..).unwrap_or_default();
    std::iter::from_fn(move || {
        let kind = tail.get(..4)?;
        let len = u32::from_le_bytes(tail.get(4..8)?.try_into().ok()?) as usize;
        let data = tail[8..].get(..len)?;
        tail = tail[8 + len..].get(len & 1..).unwrap_or_default();
        Some((kind, data))
    })
}

pub(super) struct Header {
    pub width: u32,
    pub height: u32,
    pub alpha: bool,
    pub density: u32,
    pub orientation: Option<u8>,
}

pub(super) fn header(bytes: &[u8]) -> Result<Header, &'static str> {
    let mut h = Header {
        width: 0,
        height: 0,
        alpha: false,
        density: 72,
        orientation: None,
    };
    for (kind, data) in chunks(bytes) {
        match kind {
            b"VP8X" if data.len() >= 10 => {
                let dim = |i| 1 + u32::from_le_bytes([data[i], data[i + 1], data[i + 2], 0]);
                (h.width, h.height, h.alpha) = (dim(4), dim(7), data[0] & 16 != 0);
            }
            b"VP8L" if data.len() >= 5 && data[0] == 0x2f => {
                let bits = u32::from_le_bytes(data[1..5].try_into().unwrap());
                (h.width, h.height, h.alpha) = (
                    1 + (bits & 0x3fff),
                    1 + ((bits >> 14) & 0x3fff),
                    bits & (1 << 28) != 0,
                );
            }
            b"VP8 " if data.len() >= 10 && data[3..6] == [0x9d, 1, 0x2a] => {
                let dim = |i| u32::from(u16::from_le_bytes([data[i], data[i + 1]]) & 0x3fff);
                (h.width, h.height) = (dim(6), dim(8));
            }
            b"EXIF" => {
                if let Some((dpi, orientation)) = image_header::exif(data) {
                    h.density = dpi.unwrap_or(h.density);
                    h.orientation = orientation.or(h.orientation);
                }
            }
            _ => {}
        }
    }
    if h.width == 0 || h.height == 0 {
        return Err("Invalid WebP dimensions");
    }
    Ok(h)
}

pub(super) fn encode(im: &Raster, density: u32, limit: usize) -> Result<Vec<u8>, &'static str> {
    if im.width == 0 || im.height == 0 {
        return Err("Invalid WebP dimensions");
    }
    let alpha = im.pixels.iter().any(|p| p[3] != 255);
    let orientation = im.orientation.unwrap_or(1);
    let exif = (orientation != 1 || density != 72)
        .then(|| image_header::encode_exif(orientation, density));
    // 5 header bytes, 3 flags, four literal Huffman trees (42 bits each
    // plus one bit per alphabet entry), then the four-bit distance tree.
    const PREFIX_BITS: usize = 40 + 3 + 4 * 42 + 280 + 3 * 256 + 4;
    let len = PREFIX_BITS.div_ceil(8) + im.pixels.len() * 4;
    let size = 20 + len.next_multiple_of(2) + exif.as_ref().map_or(0, |v| 18 + 8 + v.len());
    if size > limit {
        return Err("output byte limit exceeded");
    }
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((size - 8) as u32).to_le_bytes());
    out.extend_from_slice(b"WEBP");
    let (w, h) = ((im.width - 1) as u32, (im.height - 1) as u32);
    if exif.is_some() {
        out.extend_from_slice(b"VP8X\x0a\0\0\0");
        out.extend_from_slice(&[8 | (u8::from(alpha) << 4), 0, 0, 0]);
        out.extend_from_slice(&w.to_le_bytes()[..3]);
        out.extend_from_slice(&h.to_le_bytes()[..3]);
    }
    out.extend_from_slice(b"VP8L");
    out.extend_from_slice(&(len as u32).to_le_bytes());
    out.push(0x2f);
    out.extend_from_slice(
        &((w & 0x3fff) | ((h & 0x3fff) << 14) | (u32::from(alpha) << 28)).to_le_bytes(),
    );
    let mut pending = 0u16;
    let mut count = 0;
    let mut bits = |value: u8, width: usize| {
        pending |= u16::from(value) << count;
        count += width;
        if count >= 8 {
            out.push(pending as u8);
            pending >>= 8;
            count -= 8;
        }
    };
    bits(0, 3);
    for alphabet in [280, 256, 256, 256] {
        bits(0, 1);
        bits(8, 4);
        for i in 0..12 {
            bits(u8::from(i == 2 || i == 11), 3);
        }
        bits(0, 1);
        for i in 0..alphabet {
            bits(u8::from(i < 256), 1);
        }
    }
    bits(1, 4);
    for &[r, g, b, a] in &im.pixels {
        for channel in [g, r, b, a] {
            bits(channel.reverse_bits(), 8);
        }
    }
    if count != 0 {
        out.push(pending as u8);
    }
    if len % 2 != 0 {
        out.push(0);
    }
    if let Some(exif) = exif {
        out.extend_from_slice(b"EXIF");
        out.extend_from_slice(&(exif.len() as u32).to_le_bytes());
        out.extend_from_slice(&exif);
    }
    Ok(out)
}

#[path = "webp_lossless.rs"]
mod lossless;

pub(super) fn decode(bytes: &[u8], limit: usize) -> Result<Raster, &'static str> {
    if !signature(bytes)
        || bytes.len() < 12
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize != bytes.len() - 8
        || chunks(bytes)
            .map(|(_, data)| 8 + data.len().next_multiple_of(2))
            .sum::<usize>()
            != bytes.len() - 12
    {
        return Err("Invalid WebP container");
    }
    let hdr = header(bytes)?;
    let (w, h) = (hdr.width as usize, hdr.height as usize);
    let count = w
        .checked_mul(h)
        .filter(|&n| n <= limit / 4)
        .ok_or("image exceeds memory budget")?;
    let mut im = Raster {
        width: w,
        height: h,
        alpha: hdr.alpha,
        gray: false,
        density: hdr.density,
        orientation: hdr.orientation,
        pixels: Vec::new(),
    };
    for (kind, data) in chunks(bytes) {
        if kind == b"VP8 " {
            return Err("Unsupported lossy WebP");
        }
        if kind != b"VP8L" {
            continue;
        }
        if data.len() < 5 || data[0] != 0x2f || data[4] >> 5 != 0 {
            return Err("Invalid WebP lossless header");
        }
        if data.get(5..7) == Some(&[0, 0x78])
            && data.len() > 8
            && let Ok((raw, end)) =
                crate::commands::codecs::inflate_raw_bounded(&data[8..], count * 4)
            && raw.len() == count * 4
            && data.get(8 + end..12 + end)
                == Some(&crate::commands::codecs::adler32(&raw).to_be_bytes())
        {
            im.pixels = raw.chunks_exact(4).map(|p| p.try_into().unwrap()).collect();
            return Ok(im);
        }
        im.pixels = lossless::decode(data, w, h, limit)?;
        return Ok(im);
    }
    Err("Unsupported WebP image")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::{MemoryVfs, SafeBashFs};

    // Pillow/libwebp controls, independently decoded with libwebp:
    // lossy: every pixel [231, 39, 81, 255]; lossless: [230, 40, 80, 255].
    const LOSSY: &[u8] = &[
        82, 73, 70, 70, 58, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 46, 0, 0, 0, 144, 1, 0, 157,
        1, 42, 8, 0, 6, 0, 0, 192, 18, 37, 160, 2, 116, 186, 0, 3, 152, 0, 254, 241, 77, 175, 198,
        243, 121, 173, 107, 127, 253, 245, 83, 255, 125, 84, 255, 223, 85, 63, 239, 100, 128, 0,
    ];
    const LOSSLESS: &[u8] = &[
        82, 73, 70, 70, 34, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 22, 0, 0, 0, 47, 7, 64, 1, 0,
        7, 80, 148, 154, 23, 170, 255, 1, 128, 32, 252, 111, 155, 136, 232, 127, 8,
    ];

    fn convert(fs: &MemoryVfs) -> crate::commands::BuiltinOutcome {
        crate::commands::archive::try_run_archive_command(
            "convert",
            &["/source.webp".into(), "/result.png".into()],
            "",
            "/",
            &Default::default(),
            fs,
        )
        .unwrap()
    }

    fn rejects_without_publication(bytes: &[u8]) {
        let fs = MemoryVfs::new();
        fs.write_file("/source.webp", bytes).unwrap();
        assert_ne!(convert(&fs).exit_code, 0, "input: {bytes:?}");
        assert!(fs.read_file("/result.png").is_err());
        fs.write_file("/result.png", b"existing image").unwrap();
        assert_ne!(convert(&fs).exit_code, 0, "input: {bytes:?}");
        assert_eq!(fs.read_file("/result.png").unwrap(), b"existing image");
    }

    #[test]
    fn webp_lossy_is_explicitly_unsupported() {
        assert!(matches!(decode(LOSSY, 4096), Err("Unsupported lossy WebP")));
        rejects_without_publication(LOSSY);
    }

    #[test]
    fn webp_lossless_matches_independent_pixels() {
        let fs = MemoryVfs::new();
        fs.write_file("/source.webp", LOSSLESS).unwrap();
        assert_eq!(convert(&fs).exit_code, 0);
        let im = Raster::decode(&fs.read_file("/result.png").unwrap(), 4096).unwrap();
        assert_eq!((im.width, im.height), (8, 6));
        assert_eq!(im.pixels, vec![[230, 40, 80, 255]; 48]);
    }

    #[test]
    fn webp_truncation_and_corruption_do_not_publish() {
        for bytes in [LOSSY, LOSSLESS] {
            for end in 0..bytes.len() {
                assert!(decode(&bytes[..end], 4096).is_err());
                if signature(&bytes[..end]) {
                    rejects_without_publication(&bytes[..end]);
                }
            }
        }
        let mut corrupt = LOSSLESS.to_vec();
        corrupt[24] |= 0x20; // Reserved VP8L version.
        rejects_without_publication(&corrupt);
        let mut truncated = LOSSLESS[..30].to_vec();
        truncated[4..8].copy_from_slice(&22u32.to_le_bytes());
        truncated[16..20].copy_from_slice(&10u32.to_le_bytes());
        rejects_without_publication(&truncated);
    }
}
