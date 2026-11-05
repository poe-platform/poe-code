pub(super) fn recognized_image(b: &[u8]) -> bool {
    if b.starts_with(b"\x89PNG\r\n\x1a\n")
        || super::netpbm::signature(b)
        || b.starts_with(b"\xff\xd8\xff")
        || matches!(b.get(..6), Some(b"GIF87a" | b"GIF89a"))
        || b.len() >= 26 && b.starts_with(b"BM")
        || b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP")
        || b.len() >= 8 && matches!(b.get(..4), Some(b"II*\0" | b"MM\0*"))
    {
        return true;
    }
    if super::heif::format(b).is_some() { return true; }
    if b[..b.len().min(1029)].windows(5).any(|v| v == b"%PDF-") {
        return true;
    }
    let head = String::from_utf8_lossy(&b[..b.len().min(512)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    b.len() >= 5 && (head.starts_with("<svg") || head.starts_with("<?xml") && head.contains("<svg"))
}

pub(super) struct Png<'a> {
    pub ihdr: Option<&'a [u8]>,
    pub palette: &'a [u8],
    pub transparency: Option<&'a [u8]>,
    pub density: u32,
    pub orientation: Option<u8>,
    pub truncated: bool,
}

impl<'a> Png<'a> {
    pub fn read(
        bytes: &'a [u8],
        mut idat: impl FnMut(&[u8]) -> Result<(), &'static str>,
    ) -> Result<Self, &'static str> {
        let mut chunks = bytes
            .strip_prefix(b"\x89PNG\r\n\x1a\n")
            .ok_or("Input buffer contains unsupported image format")?;
        let mut result = Self {
            ihdr: None,
            palette: &[],
            transparency: None,
            density: 72,
            orientation: None,
            truncated: false,
        };
        while chunks.len() >= 8 {
            let len = u32::from_be_bytes(chunks[..4].try_into().unwrap()) as usize;
            let Some(data) = chunks[8..].get(..len) else {
                result.truncated = true;
                break;
            };
            match &chunks[4..8] {
                b"IHDR" if len >= 13 => result.ihdr = Some(data),
                b"pHYs" if len >= 9 => {
                    let x = u32::from_be_bytes(data[..4].try_into().unwrap());
                    if x > 0 {
                        result.density = if data[8] == 1 {
                            (f64::from(x) * 0.0254).round().max(1.) as u32
                        } else {
                            x
                        };
                    }
                }
                b"eXIf" => {
                    if let Some((dpi, orientation)) = exif(data) {
                        result.density = dpi.unwrap_or(result.density);
                        result.orientation = orientation.or(result.orientation);
                    }
                }
                b"PLTE" => result.palette = data,
                b"tRNS" => result.transparency = Some(data),
                b"IDAT" => idat(data)?,
                b"IEND" => break,
                _ => {}
            }
            let Some(rest) = chunks[8 + len..].get(4..) else {
                result.truncated = true;
                break;
            };
            chunks = rest;
        }
        Ok(result)
    }
}

pub(super) fn exif(data: &[u8]) -> Option<(Option<u32>, Option<u8>)> {
    let tiff = data.strip_prefix(b"Exif\0\0").unwrap_or(data);
    let little = match tiff.get(..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |b: &[u8]| {
        let pair = [b[0], b[1]];
        if little {
            u16::from_le_bytes(pair)
        } else {
            u16::from_be_bytes(pair)
        }
    };
    let u32_at = |b: &[u8]| {
        let word = b[..4].try_into().unwrap();
        if little {
            u32::from_le_bytes(word)
        } else {
            u32::from_be_bytes(word)
        }
    };
    let header = tiff.get(..8)?;
    if u16_at(&header[2..]) != 42 {
        return None;
    }
    let ifd = tiff.get(u32_at(&header[4..]) as usize..)?;
    let entries = u16_at(ifd.get(..2)?);
    let (mut resolution, mut unit, mut orientation) = (None, 2, None);
    for entry in ifd[2..].chunks_exact(12).take(entries.into()) {
        let ty = u16_at(&entry[2..]);
        let offset = u32_at(&entry[8..]);
        match u16_at(entry) {
            0x0112 => {
                let value = if ty == 3 {
                    u32::from(u16_at(&entry[8..]))
                } else {
                    offset
                };
                if (1..=8).contains(&value) {
                    orientation = Some(value as u8);
                }
            }
            0x0128 => {
                let units = if ty == 3 {
                    u32::from(u16_at(&entry[8..]))
                } else {
                    offset
                };
                if matches!(units, 2 | 3) {
                    unit = units;
                }
            }
            0x011a if ty == 5 => {
                if let Some(r) = tiff.get(offset as usize..).and_then(|b| b.get(..8)) {
                    let denominator = u32_at(&r[4..]);
                    if denominator != 0 {
                        resolution = Some(f64::from(u32_at(r)) / f64::from(denominator));
                    }
                }
            }
            _ => {}
        }
    }
    let density = resolution
        .filter(|&n| n > 0.)
        .map(|n| (n * if unit == 3 { 2.54 } else { 1. }).round() as u32);
    Some((density, orientation))
}

pub(super) struct Jpeg {
    pub width: u32,
    pub height: u32,
    pub channels: u8,
    pub density: u32,
    pub orientation: Option<u8>,
}

// Length-bearing segments may contain any bytes, including EOI. Within an
// entropy-coded scan FF00 is an escaped FF and restart markers have no length.
fn jpeg_segment<'a>(data: &mut &'a [u8]) -> Option<(u8, &'a [u8])> {
    let start = data.iter().position(|&b| b == 255)?;
    let index = start + data[start..].iter().position(|&b| b != 255)?;
    let marker = data[index];
    *data = &data[index + 1..];
    if matches!(marker, 0 | 1 | 0xd0..=0xd9) {
        return Some((marker, &[]));
    }
    let length = usize::from(u16::from_be_bytes(data.get(..2)?.try_into().ok()?));
    let payload = data.get(2..length)?;
    *data = &data[length..];
    Some((marker, payload))
}

pub(super) fn jpeg_length(bytes: &[u8]) -> Option<usize> {
    let mut data = bytes.strip_prefix(b"\xff\xd8")?;
    loop {
        if jpeg_segment(&mut data)?.0 == 0xd9 {
            return Some(bytes.len() - data.len());
        }
    }
}

pub(super) fn jpeg(bytes: &[u8]) -> Result<Jpeg, &'static str> {
    let mut data = &bytes[2..];
    let mut dpi = 72;
    let mut orientation = None;
    while let Some((marker, payload)) = jpeg_segment(&mut data) {
        match marker {
            0xd9 => break,
            0xe0 if payload.len() >= 12 && payload.starts_with(b"JFIF\0") => {
                let x = u16::from_be_bytes([payload[8], payload[9]]);
                if x > 0 {
                    dpi = match payload[7] {
                        1 => x.into(),
                        2 => (f64::from(x) * 2.54).round() as u32,
                        _ => dpi,
                    };
                }
            }
            0xe1 => {
                if let Some((d, o)) = exif(payload) {
                    dpi = d.unwrap_or(dpi);
                    orientation = o.or(orientation);
                }
            }
            0xc0..=0xc2 => {
                let byte = |i: usize| u32::from(payload.get(i).copied().unwrap_or(0));
                let (w, h) = ((byte(3) << 8) | byte(4), (byte(1) << 8) | byte(2));
                if w == 0 || h == 0 {
                    break;
                }
                let ch = match byte(5) {
                    1 => 1,
                    4 => 4,
                    _ => 3,
                };
                return Ok(Jpeg {
                    width: w,
                    height: h,
                    channels: ch,
                    density: dpi,
                    orientation,
                });
            }
            _ => (),
        }
    }
    Err("Invalid JPEG dimensions")
}

pub(super) fn encode_exif(orientation: u8, density: u32) -> Vec<u8> {
    let mut tiff = b"II\x2a\0\x08\0\0\0\x04\0".to_vec();
    // Two rationals follow the four IFD entries and the next-IFD offset.
    for (tag, ty, value) in [
        (0x0112u16, 3u16, u32::from(orientation)),
        (0x011a, 5, 62),
        (0x011b, 5, 70),
        (0x0128, 3, 2),
    ] {
        tiff.extend_from_slice(&tag.to_le_bytes());
        tiff.extend_from_slice(&ty.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&value.to_le_bytes());
    }
    for value in [0, density.max(1), 1, density.max(1), 1] {
        tiff.extend_from_slice(&value.to_le_bytes());
    }
    tiff
}
