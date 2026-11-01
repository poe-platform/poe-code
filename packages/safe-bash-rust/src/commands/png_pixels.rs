use crate::commands::codecs::{adler32, inflate_raw_bounded};

pub(super) struct Raster {
    pub width: usize,
    pub height: usize,
    pub alpha: bool,
    pub pixels: Vec<[u8; 4]>,
}

impl Raster {
    pub fn decode(png: &[u8], limit: usize) -> Result<Self, &'static str> {
        let mut input = png
            .strip_prefix(b"\x89PNG\r\n\x1a\n")
            .ok_or("Invalid PNG header")?;
        let mut header = None;
        let mut palette = &[][..];
        let mut trns = &[][..];
        let mut idat = Vec::new();
        while input.len() >= 12 {
            let size = u32::from_be_bytes(input[..4].try_into().unwrap()) as usize;
            if size > input.len() - 12 {
                return Err("Truncated PNG chunk");
            }
            let data = &input[8..8 + size];
            match &input[4..8] {
                b"IHDR" if size >= 13 => header = Some(data),
                b"PLTE" => palette = data,
                b"tRNS" => trns = data,
                b"IDAT" => {
                    if size > limit - idat.len() {
                        return Err("image exceeds memory budget");
                    }
                    idat.extend_from_slice(data);
                }
                b"IEND" => break,
                _ => {}
            }
            input = &input[size + 12..];
        }
        let h = header.ok_or("Invalid PNG header")?;
        let width = u32::from_be_bytes(h[..4].try_into().unwrap()) as usize;
        let height = u32::from_be_bytes(h[4..8].try_into().unwrap()) as usize;
        let count = width
            .checked_mul(height)
            .filter(|&n| n > 0 && n <= limit / 4)
            .ok_or("image exceeds memory budget")?;
        let depth = h[8] as usize;
        let color = h[9];
        let channels = match (color, depth) {
            (0, 1 | 2 | 4 | 8 | 16) | (3, 1 | 2 | 4 | 8) => 1,
            (2, 8 | 16) => 3,
            (4, 8 | 16) => 2,
            (6, 8 | 16) => 4,
            _ => return Err("Unsupported PNG encoding"),
        };
        let passes: &[(usize, usize, usize, usize)] = match &h[10..13] {
            [0, 0, 0] => &[(0, 0, 1, 1)],
            [0, 0, 1] => &[
                (0, 0, 8, 8),
                (4, 0, 8, 8),
                (0, 4, 4, 8),
                (2, 0, 4, 4),
                (0, 2, 2, 4),
                (1, 0, 2, 2),
                (0, 1, 1, 2),
            ],
            _ => return Err("Unsupported PNG encoding"),
        };
        let stride = (channels * depth).div_ceil(8);
        let mut layout = Vec::new();
        let mut expected = 0usize;
        for &(x, y, dx, dy) in passes {
            let cols = width.saturating_sub(x).div_ceil(dx);
            let rows = height.saturating_sub(y).div_ceil(dy);
            if rows == 0 || cols == 0 {
                continue;
            }
            let bytes = cols
                .checked_mul(channels * depth)
                .ok_or("image exceeds memory budget")?
                .div_ceil(8);
            expected = (bytes + 1)
                .checked_mul(rows)
                .and_then(|n| expected.checked_add(n))
                .filter(|&n| n <= limit)
                .ok_or("image exceeds memory budget")?;
            layout.push((x, y, dx, dy, cols, rows, bytes));
        }
        if idat.len() < 6
            || idat[0] & 15 != 8
            || idat[0] >> 4 > 7
            || u16::from_be_bytes([idat[0], idat[1]]) % 31 != 0
            || idat[1] & 32 != 0
        {
            return Err("Invalid zlib header");
        }
        let (mut raw, end) =
            inflate_raw_bounded(&idat[2..], expected).map_err(|_| "Invalid PNG image data")?;
        if raw.len() != expected {
            return Err("Truncated PNG image data");
        }
        if idat.get(2 + end..6 + end) != Some(adler32(&raw).to_be_bytes().as_slice()) {
            return Err("incorrect data check");
        }
        let mut pixels = vec![[0; 4]; count];
        let mut pos = 0;
        for (x0, y0, dx, dy, cols, rows, bytes) in layout {
            for y in 0..rows {
                let filter = raw[pos];
                pos += 1;
                for i in 0..bytes {
                    let left = if i >= stride {
                        raw[pos + i - stride]
                    } else {
                        0
                    };
                    let up = if y > 0 { raw[pos + i - bytes - 1] } else { 0 };
                    let pred = match filter {
                        0 => 0,
                        1 => left,
                        2 => up,
                        3 => ((u16::from(left) + u16::from(up)) / 2) as u8,
                        4 => {
                            let ul = if y > 0 && i >= stride {
                                raw[pos + i - bytes - 1 - stride]
                            } else {
                                0
                            };
                            let p = i32::from(left) + i32::from(up) - i32::from(ul);
                            [left, up, ul]
                                .into_iter()
                                .min_by_key(|c| (p - i32::from(*c)).abs())
                                .unwrap()
                        }
                        _ => return Err("Invalid PNG filter"),
                    };
                    raw[pos + i] = raw[pos + i].wrapping_add(pred);
                }
                let row = &raw[pos..pos + bytes];
                for x in 0..cols {
                    let sample = |c| -> u16 {
                        let i: usize = x * channels + c;
                        match depth {
                            16 => u16::from_be_bytes([row[i * 2], row[i * 2 + 1]]),
                            8 => row[i].into(),
                            _ => {
                                u16::from(row[i * depth / 8] >> (8 - depth - (i * depth % 8)))
                                    & ((1 << depth) - 1)
                            }
                        }
                    };
                    let byte = |i| match depth {
                        16 => (sample(i) >> 8) as u8,
                        8 => sample(i) as u8,
                        _ => (sample(i) * 255 / ((1 << depth) - 1)) as u8,
                    };
                    let transparent = |n| {
                        trns.len() >= n * 2
                            && (0..n).all(|i| {
                                sample(i) == u16::from_be_bytes([trns[2 * i], trns[2 * i + 1]])
                            })
                    };
                    pixels[(y0 + y * dy) * width + x0 + x * dx] = match color {
                        0 => [
                            byte(0),
                            byte(0),
                            byte(0),
                            if transparent(1) { 0 } else { 255 },
                        ],
                        2 => [
                            byte(0),
                            byte(1),
                            byte(2),
                            if transparent(3) { 0 } else { 255 },
                        ],
                        3 => {
                            let i = sample(0) as usize;
                            [
                                *palette.get(i * 3).unwrap_or(&0),
                                *palette.get(i * 3 + 1).unwrap_or(&0),
                                *palette.get(i * 3 + 2).unwrap_or(&0),
                                *trns.get(i).unwrap_or(&255),
                            ]
                        }
                        4 => [byte(0), byte(0), byte(0), byte(1)],
                        _ => [byte(0), byte(1), byte(2), byte(3)],
                    };
                }
                pos += bytes;
            }
        }
        Ok(Self {
            width,
            height,
            alpha: matches!(color, 4 | 6) || !trns.is_empty(),
            pixels,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adam7_packed_palette_with_filters_and_transparency_is_bounded() {
        let bytes = super::super::hex_dec(
            "89504e470d0a1a0a0000000d494844520000000b000000090203000001ee0d0e280000000c504c5445050c131a21282f363d444b52a0086cc50000000474524e5300010203196e3f950000003749444154789c1dc6c10dc0200c04c1b5cfdda49e5024500fa5f04990413c461a61e88ac3893af57ecec930507d00cffca390962c8dd637e9c90ded1d9867660000000049454e44ae426082",
        );
        assert!(Raster::decode(&bytes, 395).is_err());
        let image = Raster::decode(&bytes, 396).unwrap();
        assert_eq!((image.width, image.height, image.alpha), (11, 9, true));
        for (i, p) in image.pixels.iter().enumerate() {
            let n = ((i / 11) * 7 + (i % 11) * 12) % 4;
            assert_eq!(
                *p,
                [
                    (n * 21 + 5) as u8,
                    (n * 21 + 12) as u8,
                    (n * 21 + 19) as u8,
                    n as u8
                ]
            );
        }
    }
}
