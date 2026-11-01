pub(super) struct Header<'a> {
    pub ihdr: Option<&'a [u8]>,
    pub palette: &'a [u8],
    pub transparency: Option<&'a [u8]>,
    pub density: u32,
    pub truncated: bool,
}

impl<'a> Header<'a> {
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
