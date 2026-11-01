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

pub(super) fn format(b: &[u8]) -> Option<&'static str> {
    if b.len() < 16 || &b[4..8] != b"ftyp" {
        return None;
    }
    let size = u32::from_be_bytes(b[..4].try_into().unwrap()) as usize;
    let end = if size == 0 || size > b.len() {
        64.min(b.len())
    } else {
        size
    };
    let compatible = b.get(16..end)?;
    let kind = |brand: &[u8]| match brand {
        b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" | b"hevm" | b"hevs" => {
            Some("heic")
        }
        b"avif" | b"avis" | b"avio" => Some("avif"),
        b"heif" => Some("heif"),
        _ => None,
    };
    let major = &b[8..12];
    if let Some(fmt) = kind(major) {
        return Some(fmt);
    }
    let generic = matches!(major, b"mif1" | b"msf1");
    let (mut avif, mut heic, mut heif, mut mif) = (false, false, false, false);
    for brand in compatible.chunks_exact(4) {
        match kind(brand) {
            Some("heic") => heic = true,
            Some("avif") => avif = true,
            Some("heif") => heif = true,
            _ => mif |= matches!(brand, b"mif1" | b"msf1"),
        }
    }
    if avif && !(generic && heic) {
        Some("avif")
    } else if heic && !(generic && heif) {
        Some("heic")
    } else if generic || heif || mif {
        Some("heif")
    } else {
        None
    }
}

fn boxes(mut data: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    std::iter::from_fn(move || {
        let size = u32::from_be_bytes(data.get(..4)?.try_into().ok()?) as usize;
        let (item, rest) = data.split_at_checked(if size == 0 { data.len() } else { size })?;
        let result = (item.get(4..8)?, &item[8..]);
        data = rest;
        Some(result)
    })
}

fn uint(data: &mut &[u8], len: usize) -> Option<u64> {
    let (n, rest) = data.split_at_checked(len)?;
    *data = rest;
    Some(n.iter().fold(0u64, |v, &b| (v << 8) | u64::from(b)))
}
fn meta(bytes: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    boxes(bytes)
        .filter(|(k, _)| *k == b"meta")
        .flat_map(|(_, b)| boxes(b.get(4..).unwrap_or_default()))
}

pub(super) struct Header {
    pub width: u32,
    pub height: u32,
    pub density: u32,
    pub channels: u8,
    pub depth: u8,
    pub alpha: bool,
    pub orientation: Option<u8>,
}
impl Header {
    pub fn image_meta(&self, fmt: &str) -> super::ImageMeta {
        super::ImageMeta {
            fmt: fmt.to_ascii_uppercase(),
            w: self.width,
            h: self.height,
            cs: if self.channels < 3 { "Gray" } else { "sRGB" }.into(),
            exif: Default::default(),
        }
    }
    fn property(&mut self, kind: &[u8], p: &[u8]) {
        match kind {
            b"ispe" if p.len() >= 12 => {
                let (w, h) = dimensions(p);
                if w != 0
                    && h != 0
                    && u64::from(w) * u64::from(h) >= u64::from(self.width) * u64::from(self.height)
                {
                    (self.width, self.height) = (w, h);
                }
            }
            b"pixi" if p.len() >= 6 => {
                self.channels = p[4].clamp(1, 4);
                self.depth = if p[5] > 8 { 16 } else { 8 };
                self.alpha |= matches!(self.channels, 2 | 4);
            }
            b"irot" if !p.is_empty() && p[0] & 3 != 0 => {
                self.orientation = Some([1, 8, 3, 6][(p[0] & 3) as usize])
            }
            b"auxC" if alpha(p) => {
                self.alpha = true;
                if self.channels == 3 {
                    self.channels = 4
                }
            }
            _ => {}
        }
    }
}
fn dimensions(p: &[u8]) -> (u32, u32) {
    (
        u32::from_be_bytes(p[4..8].try_into().unwrap()),
        u32::from_be_bytes(p[8..12].try_into().unwrap()),
    )
}
fn alpha(p: &[u8]) -> bool {
    p.get(4..).is_some_and(|s| {
        s.windows(5).any(|v| v == b"alpha") || s.windows(7).any(|v| v == b"auxid:1")
    })
}

fn associations(p: &[u8], primary: u64, indices: &mut Option<Vec<usize>>) -> Option<()> {
    let mut rows = p.get(4..)?;
    let count = uint(&mut rows, 4)?;
    let wide = p[3] & 1 != 0;
    for _ in 0..count {
        let id = uint(&mut rows, if p[0] == 0 { 2 } else { 4 })?;
        let n = uint(&mut rows, 1)? as usize;
        let width = if wide { 2 } else { 1 };
        let (values, rest) = rows.split_at_checked(n * width)?;
        rows = rest;
        if id == primary {
            *indices = Some(
                values
                    .chunks_exact(width)
                    .map(|mut v| {
                        (uint(&mut v, width).unwrap() as usize) & if wide { 0x7fff } else { 0x7f }
                    })
                    .collect(),
            )
        }
    }
    Some(())
}

pub(super) fn header(bytes: &[u8]) -> Header {
    use std::collections::{BTreeMap, BTreeSet};
    let mut h = Header {
        width: 0,
        height: 0,
        channels: 3,
        depth: 8,
        density: 72,
        alpha: false,
        orientation: None,
    };
    let mut primary = None;
    let mut exifs = BTreeSet::new();
    let mut idat = bytes;
    for (kind, p) in meta(bytes) {
        match kind {
            b"pitm" if p.len() >= 6 => primary = uint(&mut &p[4..], if p[0] == 0 { 2 } else { 4 }),
            b"idat" => idat = p,
            b"iinf" if p.len() >= 6 => {
                for (_, item) in boxes(p.get(if p[0] == 0 { 6 } else { 8 }..).unwrap_or_default())
                    .filter(|(k, _)| *k == b"infe")
                {
                    if item.len() < 12 || item[0] < 2 {
                        continue;
                    }
                    let mut entry = &item[4..];
                    let id = uint(&mut entry, if item[0] == 2 { 2 } else { 4 }).unwrap();
                    if entry.get(2..6) == Some(b"Exif") {
                        exifs.insert(id);
                    }
                }
            }
            _ => {}
        }
    }
    let groups = || {
        meta(bytes)
            .filter(|(k, _)| *k == b"iprp")
            .flat_map(|(_, b)| boxes(b))
    };
    let mut indices = None;
    if let Some(id) = primary {
        for (_, p) in groups().filter(|(k, _)| *k == b"ipma") {
            associations(p, id, &mut indices);
        }
    }
    // Retain only properties named by the primary item (at most 255), in association order.
    let mut selected: BTreeMap<_, _> = indices.iter().flatten().map(|&i| (i, None)).collect();
    let mut fallback = (0u32, 0u32);
    let mut any_alpha = false;
    for (i, (k, p)) in groups()
        .filter(|(k, _)| *k == b"ipco")
        .flat_map(|(_, b)| boxes(b))
        .enumerate()
    {
        if k == b"ispe" && p.len() >= 12 {
            let (w, h) = dimensions(p);
            if u64::from(w) * u64::from(h) > u64::from(fallback.0) * u64::from(fallback.1) {
                fallback = (w, h);
            }
        } else if k == b"auxC" {
            any_alpha |= alpha(p);
        }
        if indices.is_none() {
            h.property(k, p);
        } else if let Some(prop) = selected.get_mut(&(i + 1)) {
            *prop = Some((k, p));
        }
    }
    for i in indices.into_iter().flatten() {
        if let Some((k, p)) = selected[&i] {
            h.property(k, p);
        }
    }
    if !h.alpha && any_alpha {
        h.alpha = true;
        if h.channels == 3 {
            h.channels = 4;
        }
    }
    if h.width == 0 {
        (h.width, h.height) = if fallback.0 == 0 { (1, 1) } else { fallback };
    }
    if !exifs.is_empty() {
        for (_, p) in meta(bytes).filter(|(k, _)| *k == b"iloc") {
            read_locations(p, bytes, idat, &exifs, &mut h);
        }
    }
    h
}

fn read_locations(
    p: &[u8],
    file: &[u8],
    idat: &[u8],
    ids: &std::collections::BTreeSet<u64>,
    h: &mut Header,
) -> Option<()> {
    let mut rows = p.get(6..)?;
    let id_width = if p[0] < 2 { 2 } else { 4 };
    let versioned = matches!(p[0], 1 | 2);
    let (offset, length, base, index) = (
        p[4] >> 4,
        p[4] & 15,
        p[5] >> 4,
        if versioned { p[5] & 15 } else { 0 },
    );
    let sized = |row: &mut &[u8], w: u8| {
        uint(row, w as usize).map(|n| if matches!(w, 2 | 4 | 8) { n } else { 0 })
    };
    for _ in 0..uint(&mut rows, id_width)? {
        let id = uint(&mut rows, id_width)?;
        let method = if versioned {
            uint(&mut rows, 2)? & 15
        } else {
            0
        };
        uint(&mut rows, 2)?;
        let base = sized(&mut rows, base)?;
        let count = uint(&mut rows, 2)? as usize;
        let (all, rest) = rows.split_at_checked(count * usize::from(index + offset + length))?;
        rows = rest;
        if count == 0 || !ids.contains(&id) {
            continue;
        }
        let mut first = all;
        sized(&mut first, index)?;
        let delta = sized(&mut first, offset)?;
        let len = sized(&mut first, length)?;
        let source = if method == 1 { idat } else { file };
        if len <= 8 {
            continue;
        }
        let Some(data) = base
            .checked_add(delta)
            .and_then(|n| usize::try_from(n).ok())
            .and_then(|n| source.get(n..))
            .and_then(|s| s.get(..usize::try_from(len).ok()?))
        else {
            continue;
        };
        let off = u64::from(u32::from_be_bytes(data[..4].try_into().unwrap())) + 4;
        let skip = if off < len { off as usize } else { 4 };
        if let Some((density, orientation)) = image_header::exif(&data[skip..]) {
            h.density = density.unwrap_or(h.density);
            h.orientation = orientation.or(h.orientation);
        }
    }
    Some(())
}

pub(super) fn decode(bytes: &[u8], limit: usize) -> Result<Raster, &'static str> {
    use crate::commands::codecs::{adler32, inflate_raw_bounded};
    let h = header(bytes);
    let (width, height) = (h.width as usize, h.height as usize);
    let count = width
        .checked_mul(height)
        .filter(|&n| n <= limit / 4)
        .ok_or("image exceeds memory budget")?;
    let pixels = if let Some(i) = bytes.windows(8).position(|s| s == b"POEHEIF1")
        && let z = &bytes[i + 8..]
        && z.len() >= 6
        && z[0] & 15 == 8
        && z[0] >> 4 <= 7
        && z[1] & 32 == 0
        && u16::from_be_bytes([z[0], z[1]]).is_multiple_of(31)
        && let Ok((raw, n)) = inflate_raw_bounded(&z[2..], limit)
        && raw.len() >= count * 4
        && z.get(2 + n..6 + n) == Some(&adler32(&raw).to_be_bytes())
    {
        raw[..count * 4]
            .chunks_exact(4)
            .map(|v| v.try_into().unwrap())
            .collect()
    } else {
        for i in 16..bytes.len().saturating_sub(4) {
            let data = &bytes[i..];
            if (super::jpeg_decode::signature(data) || data.starts_with(b"\x89PNG\r\n\x1a\n"))
                && let Ok(mut preview) = Raster::decode(data, limit)
            {
                preview.orientation = h.orientation.or(preview.orientation);
                preview.density = h.density;
                return Ok(preview);
            }
        }
        vec![[0, 0, 0, 255]; count]
    };
    Ok(Raster {
        width,
        height,
        alpha: h.alpha,
        gray: h.channels < 3,
        density: h.density,
        orientation: h.orientation,
        pixels,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn brands_follow_image_ast_precedence() {
        for (brands, expected) in [
            ("mif1....heicavif", Some("heic")),
            ("mif1....heicavifheif", Some("heif")),
            ("mif1....avifheif", Some("avif")),
            ("mp42....heicavis", Some("avif")),
            ("heix....avif", Some("heic")),
            ("mp42....miaf", None),
        ] {
            let mut bytes = b"\0\0\0\0ftyp".to_vec();
            bytes.extend(brands.bytes());
            assert_eq!(super::format(&bytes), expected);
            assert_eq!(
                super::super::image_header::recognized_image(&bytes),
                expected.is_some()
            );
        }
    }
}
