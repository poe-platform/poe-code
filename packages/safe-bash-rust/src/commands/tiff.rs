use super::png_pixels::Raster;
use std::borrow::Cow;

pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.len() >= 8
        && matches!(bytes.get(..4), Some(b"II*\0" | b"MM\0*"))
        && bytes.get(8..17) != Some(b"\n__IMG__:")
}

fn word(bytes: &[u8], little: bool) -> u32 {
    if little {
        bytes.iter().rev().fold(0, |n, b| n << 8 | u32::from(*b))
    } else {
        bytes.iter().fold(0, |n, b| n << 8 | u32::from(*b))
    }
}

// TIFF LZW reads its codes most-significant bit first. Every dictionary
// phrase is a previous output span followed by the first byte of the next span.
fn lzw(input: &[u8], expected: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(expected);
    let mut phrases: Vec<(usize, usize)> = Vec::new();
    let mut previous: Option<(usize, usize)> = None;
    let (mut bit, mut width) = (0u64, 9usize);
    while out.len() < expected && bit + width as u64 <= input.len() as u64 * 8 {
        let mut code = 0usize;
        for _ in 0..width {
            code = code * 2 + usize::from(input[(bit / 8) as usize] >> (7 - bit % 8) & 1);
            bit += 1;
        }
        if code == 256 {
            phrases.clear();
            previous = None;
            width = 9;
            continue;
        }
        if code == 257 {
            break;
        }
        let at = out.len();
        if code < 256 {
            out.push(code as u8);
        } else if let Some(&(from, n)) = phrases.get(code - 258) {
            out.extend_from_within(from..from + n.min(expected - at));
        } else if code == 258 + phrases.len()
            && let Some((from, n)) = previous
        {
            out.extend_from_within(from..from + n.min(expected - at));
            if out.len() < expected {
                out.push(out[from]);
            }
        } else {
            break;
        }
        if let Some((from, n)) = previous
            && phrases.len() < 4096 - 258
        {
            phrases.push((from, n + 1));
            if phrases.len() + 258 == (1 << width) - 1 && width < 12 {
                width += 1;
            }
        }
        previous = Some((at, out.len() - at));
    }
    out.resize(expected, 0);
    out
}

fn strip(
    input: &[u8],
    compression: usize,
    expected: usize,
    limit: usize,
) -> Result<Cow<'_, [u8]>, &'static str> {
    use crate::commands::codecs::{adler32, gzip_decompress_bounded, inflate_raw_bounded};
    if compression == 1 {
        return Ok(Cow::Borrowed(input));
    }
    if expected > limit {
        return Err("image exceeds memory budget");
    }
    match compression {
        5 => Ok(Cow::Owned(lzw(input, expected))),
        32773 => {
            let mut out = Vec::with_capacity(expected);
            let mut data = input;
            while out.len() < expected
                && let Some((&n, rest)) = data.split_first()
            {
                data = rest;
                let left = expected - out.len();
                match n {
                    0..=127 => {
                        let n = (usize::from(n) + 1).min(left).min(data.len());
                        out.extend_from_slice(&data[..n]);
                        data = &data[n..];
                    }
                    129..=255 => {
                        let count = (257 - usize::from(n)).min(left);
                        out.resize(out.len() + count, data.first().copied().unwrap_or(0));
                        data = data.get(1..).unwrap_or_default();
                    }
                    _ => {}
                }
            }
            out.resize(expected, 0);
            Ok(Cow::Owned(out))
        }
        _ => {
            let decoded = if input.starts_with(&[31, 139]) {
                gzip_decompress_bounded(input, limit)
            } else if input.len() >= 6
                && input[0] & 15 == 8
                && u16::from_be_bytes([input[0], input[1]]) % 31 == 0
            {
                inflate_raw_bounded(&input[2..], limit).and_then(|(v, n)| {
                    if input.get(2 + n..6 + n) == Some(&adler32(&v).to_be_bytes()) {
                        Ok(v)
                    } else {
                        Err("checksum".into())
                    }
                })
            } else {
                return Ok(Cow::Borrowed(input));
            };
            match decoded {
                Ok(v) => Ok(Cow::Owned(v)),
                Err(e) if e.contains("limit") => Err("image exceeds memory budget"),
                Err(_) => Ok(Cow::Borrowed(input)), // The JS TIFF reader falls back to the original strip.
            }
        }
    }
}

#[derive(Clone, Copy)]
struct Field<'a> {
    bytes: &'a [u8],
    stride: usize,
}
impl Field<'_> {
    fn values(&self, little: bool) -> impl Iterator<Item = usize> {
        self.bytes
            .chunks_exact(self.stride)
            .map(move |b| word(b, little) as usize)
    }
}

pub(super) struct Tiff<'a> {
    bytes: &'a [u8],
    little: bool,
    pub width: usize,
    pub height: usize,
    pub depth: u8,
    pub samples: usize,
    pub density: u32,
    orientation: Option<u8>,
    limit: usize,
    compression: usize,
    rows_per_strip: usize,
    tile: Option<(usize, usize)>,
    white_zero: bool,
    predictor: bool,
    offsets: Option<Field<'a>>,
    counts: Option<Field<'a>>,
}

impl<'a> Tiff<'a> {
    pub fn parse(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        let err = "Offset is outside the bounds of the DataView";
        let little = bytes.starts_with(b"II");
        let directory = word(bytes.get(4..8).ok_or(err)?, little) as usize;
        let dir = bytes.get(directory..).ok_or(err)?;
        let count = word(dir.get(..2).ok_or(err)?, little) as usize;
        let entries = dir.get(2..2 + 12 * count).ok_or(err)?;
        let field = |tag: usize| -> Option<Field<'a>> {
            let e = entries
                .chunks_exact(12)
                .rev()
                .find(|e| word(&e[..2], little) as usize == tag)?;
            let stride = match word(&e[2..4], little) {
                3 => 2,
                4 => 4,
                _ => 1,
            };
            let size = (word(&e[4..8], little) as usize).checked_mul(stride)?;
            let data = if size <= 4 {
                &e[8..]
            } else {
                bytes.get(word(&e[8..], little) as usize..)?
            };
            Some(Field {
                bytes: &data[..data.len().min(size)],
                stride,
            })
        };
        let get = |tag, fallback| {
            field(tag)
                .and_then(|f| f.values(little).next())
                .unwrap_or(fallback)
        };
        let (width, height) = (get(256, 0), get(257, 0));
        if width == 0 || height == 0 {
            return Err("invalid image dimensions");
        }
        if width.saturating_mul(height) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        let samples = get(277, 4);
        let depth = get(258, 8);
        if !(1..=4).contains(&samples)
            || !matches!(depth, 8 | 16)
            || !matches!(get(259, 1), 1 | 5 | 8 | 32946 | 32773)
        {
            return Err("unsupported TIFF encoding");
        }
        let tile = match (get(322, 0), get(323, 0)) {
            (w, h) if w > 0 && h > 0 && field(324).is_some() => Some((w, h)),
            _ => None,
        };
        let (dpi, orientation) = super::image_header::exif(bytes).unwrap_or_default();
        Ok(Self {
            bytes,
            little,
            width,
            height,
            depth: depth as u8,
            samples,
            density: dpi.unwrap_or(72).max(1),
            orientation,
            limit,
            compression: get(259, 1),
            rows_per_strip: get(278, height).clamp(1, height),
            white_zero: get(262, 2) == 0,
            predictor: get(317, 1) == 2,
            tile,
            offsets: field(if tile.is_some() { 324 } else { 273 }),
            counts: field(if tile.is_some() { 325 } else { 279 }),
        })
    }

    fn row(
        &self,
        row: &mut [[u8; 4]],
        mut byte: impl FnMut() -> Result<u8, &'static str>,
    ) -> Result<(), &'static str> {
        let mut prev = [0u16; 4];
        for dst in row {
            let mut pixel = [0, 0, 0, 255];
            for c in 0..self.samples {
                let first = byte()?;
                let value = if self.depth == 16 {
                    let b = [first, byte()?];
                    if self.little {
                        u16::from_le_bytes(b)
                    } else {
                        u16::from_be_bytes(b)
                    }
                } else {
                    u16::from(first)
                };
                prev[c] = if self.predictor {
                    prev[c].wrapping_add(value)
                } else {
                    value
                };
                pixel[c] = (prev[c] >> (self.depth - 8)) as u8;
            }
            if self.samples < 3 {
                let g = if self.white_zero {
                    255 - pixel[0]
                } else {
                    pixel[0]
                };
                pixel = [g, g, g, if self.samples == 2 { pixel[1] } else { 255 }];
            }
            *dst = pixel;
        }
        Ok(())
    }

    pub fn decode(&self) -> Result<Raster, &'static str> {
        let default = [8u8];
        let offsets = self.offsets.unwrap_or(Field {
            bytes: &default,
            stride: 1,
        });
        let counts = self.counts.unwrap_or(Field {
            bytes: &[],
            stride: 1,
        });
        let mut counts = counts.values(self.little);
        let mut offsets = offsets.values(self.little);
        let bpp = self.samples * usize::from(self.depth / 8);
        let scratch = self.limit - self.width * self.height * 4;
        let mut work = self.limit.saturating_mul(8);
        let mut next = |expected: usize| -> Result<Option<Cow<'a, [u8]>>, &'static str> {
            let Some(off) = offsets.next() else {
                return Ok(None);
            };
            let data = self.bytes.get(off..).unwrap_or_default();
            let n = counts.next().unwrap_or(data.len()).min(data.len());
            if self.compression != 1 {
                work = work
                    .checked_sub(n.max(expected))
                    .ok_or("image decompression work limit exceeded")?;
            }
            strip(&data[..n], self.compression, expected, scratch).map(Some)
        };
        let mut missing = [0; 4];
        self.row(std::slice::from_mut(&mut missing), || Ok(0))?;
        let mut pixels = vec![missing; self.width * self.height];
        if let Some((w, h)) = self.tile {
            let stride = w.checked_mul(bpp).ok_or("image exceeds memory budget")?;
            let expected = h.checked_mul(stride).ok_or("image exceeds memory budget")?;
            'tiles: for y in (0..self.height).step_by(h) {
                for x in (0..self.width).step_by(w) {
                    let Some(data) = next(expected)? else {
                        break 'tiles;
                    };
                    let cols = w.min(self.width - x);
                    for (k, raw) in data.chunks(stride).take(h.min(self.height - y)).enumerate() {
                        if let Some(raw) = raw.get(..cols * bpp) {
                            let start = (y + k) * self.width + x;
                            let mut bytes = raw.iter();
                            self.row(&mut pixels[start..start + cols], || {
                                Ok(*bytes.next().unwrap())
                            })?;
                        }
                    }
                }
            }
        } else {
            let total = pixels
                .len()
                .checked_mul(bpp)
                .ok_or("image exceeds memory budget")?;
            let mut decoded = Cow::Borrowed(&[][..]);
            let (mut pos, mut read) = (0usize, 0usize);
            let mut byte = || {
                while pos == decoded.len() {
                    drop(std::mem::replace(&mut decoded, Cow::Borrowed(&[])));
                    let Some(data) =
                        next((total - read).min(self.width * self.rows_per_strip * bpp))?
                    else {
                        return Ok(0);
                    };
                    decoded = data;
                    pos = 0;
                }
                let v = decoded[pos];
                pos += 1;
                read += 1;
                Ok(v)
            };
            for row in pixels.chunks_exact_mut(self.width) {
                self.row(row, &mut byte)?;
            }
        }
        Ok(Raster {
            width: self.width,
            height: self.height,
            pixels,
            density: self.density,
            orientation: self.orientation,
            alpha: matches!(self.samples, 2 | 4),
            gray: self.samples == 1 || self.samples == 2 && self.depth == 8,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_tiff_tiles_at_their_visible_edges() {
        let fields = [
            (256u16, 3u32),
            (257, 3),
            (277, 1),
            (262, 1),
            (322, 2),
            (323, 2),
            (324, 110),
            (325, 126),
        ];
        let mut b = b"MM\0*\0\0\0\x08".to_vec();
        b.extend_from_slice(&(fields.len() as u16).to_be_bytes());
        for (tag, v) in fields {
            b.extend_from_slice(&tag.to_be_bytes());
            b.extend_from_slice(&4u16.to_be_bytes());
            b.extend_from_slice(&(if matches!(tag, 324 | 325) { 4u32 } else { 1 }).to_be_bytes());
            b.extend_from_slice(&v.to_be_bytes());
        }
        for v in [0u32, 142, 146, 150, 154, 4, 4, 4, 4] {
            b.extend_from_slice(&v.to_be_bytes());
        }
        b.extend_from_slice(&[1, 2, 4, 5, 3, 99, 6, 99, 7, 8, 99, 99, 9, 99, 99, 99]);
        let image = Tiff::parse(&b, 8192).unwrap().decode().unwrap();
        assert_eq!(
            image.pixels,
            [1, 2, 3, 4, 5, 6, 7, 8, 9].map(|g| [g, g, g, 255])
        );
    }

    #[test]
    fn decompresses_predictor_encoded_big_endian_strips() {
        // Two grayscale rows; each strip resets the horizontal predictor.
        let rows = [[8u8, 2, 4], [20, 254, 3]];
        for compression in [5u32, 8, 32773] {
            let mut strips = Vec::new();
            for row in rows {
                strips.push(match compression {
                    5 => {
                        let mut bits = 0u64;
                        for code in [256, row[0] as u16, row[1] as u16, row[2] as u16, 257] {
                            bits = bits << 9 | u64::from(code);
                        }
                        (bits << 3).to_be_bytes()[2..].to_vec()
                    }
                    8 => crate::commands::codecs::zlib_compress(&row),
                    _ => [vec![2], row.to_vec()].concat(),
                });
            }
            let mut b = b"MM\0*\0\0\0\x08".to_vec();
            let fields = [
                (256, 3),
                (257, 2),
                (259, compression),
                (273, 122),
                (277, 1),
                (278, 1),
                (279, 130),
                (317, 2),
                (262, 1),
            ];
            b.extend_from_slice(&(fields.len() as u16).to_be_bytes());
            for (tag, v) in fields {
                b.extend_from_slice(&(tag as u16).to_be_bytes());
                b.extend_from_slice(&4u16.to_be_bytes());
                b.extend_from_slice(
                    &(if matches!(tag, 273 | 279) { 2u32 } else { 1 }).to_be_bytes(),
                );
                b.extend_from_slice(&v.to_be_bytes());
            }
            for v in [
                0u32,
                138,
                138 + strips[0].len() as u32,
                strips[0].len() as u32,
                strips[1].len() as u32,
            ] {
                b.extend_from_slice(&v.to_be_bytes());
            }
            for strip in strips {
                b.extend(strip);
            }
            let image = Tiff::parse(&b, 8192).unwrap().decode().unwrap();
            assert_eq!(
                image.pixels,
                [8, 10, 14, 20, 18, 21].map(|g| [g, g, g, 255]),
                "compression {compression}"
            );
        }
    }
}
