pub(super) struct Png<'a> {
    pub ihdr: Option<&'a [u8]>,
    pub palette: &'a [u8],
    pub transparency: Option<&'a [u8]>,
    pub density: u32,
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
                    if let Some(dpi) = exif_density(data) {
                        result.density = dpi;
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

fn exif_density(data: &[u8]) -> Option<u32> {
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
    let (mut resolution, mut unit) = (None, 2);
    for entry in ifd[2..].chunks_exact(12).take(entries.into()) {
        let ty = u16_at(&entry[2..]);
        let offset = u32_at(&entry[8..]);
        match u16_at(entry) {
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
    resolution
        .filter(|&n| n > 0.)
        .map(|n| (n * if unit == 3 { 2.54 } else { 1. }).round() as u32)
}

pub(super) fn jpeg(bytes: &[u8]) -> Result<(u32, u32, u8, u32), &'static str> {
    let mut data = &bytes[2..];
    let mut dpi = 72;
    while data.len() >= 4 {
        let Some(start) = data.iter().position(|&b| b == 255) else {
            break;
        };
        let Some(pos) = data[start..].iter().position(|&b| b != 255) else {
            break;
        };
        let marker = data[start + pos];
        data = &data[start + pos + 1..];
        match marker {
            0xd9 => break,
            1 | 0xd0..=0xd8 => continue,
            _ => (),
        }
        let Some(length) = data.get(..2) else {
            break;
        };
        let len = usize::from(u16::from_be_bytes(length.try_into().unwrap()));
        let Some(payload) = data.get(2..len) else {
            break;
        };
        match marker {
            0xe0 if len >= 14 && payload.starts_with(b"JFIF\0") => {
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
                if let Some(d) = exif_density(payload) {
                    dpi = d;
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
                return Ok((w, h, ch, dpi));
            }
            _ => (),
        }
        data = &data[len..];
    }
    Err("Invalid JPEG dimensions")
}
