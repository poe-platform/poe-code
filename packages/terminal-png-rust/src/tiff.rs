//! Classic TIFF raster decoding shared with the Rust shell.
use crate::{fax, image::DecodedImage, image_header, inflate, jpeg, lzw, png};
use mcp_protocol_rust::cooperate::{block_on, yield_now};
use std::borrow::Cow;
type Result<T> = std::result::Result<T, &'static str>;
const INVALID: &str = "Invalid or truncated TIFF image";
const UNSUPPORTED: &str = "Unsupported TIFF encoding";
const LIMIT: &str = "image exceeds memory budget";
const WORK_LIMIT: &str = "E_LIMIT: TIFF decompression work limit exceeded";

pub fn signature(bytes: &[u8]) -> bool {
    matches!(bytes.get(..4), Some(b"II*\0" | b"MM\0*")) && bytes.get(8..17) != Some(b"\n__IMG__:")
}
fn word(bytes: &[u8], little: bool) -> u32 {
    if little {
        bytes.iter().rev().fold(0, |n, b| n << 8 | u32::from(*b))
    } else {
        bytes.iter().fold(0, |n, b| n << 8 | u32::from(*b))
    }
}
#[derive(Clone, Copy)]
struct Field<'a> {
    bytes: &'a [u8],
    stride: usize,
}
impl Field<'_> {
    fn len(self) -> usize {
        self.bytes.len() / self.stride
    }
    fn get(self, index: usize, little: bool) -> Option<usize> {
        let start = index.checked_mul(self.stride)?;
        self.bytes
            .get(start..start.checked_add(self.stride)?)
            .map(|b| word(b, little) as usize)
    }
}

pub struct Tiff<'a> {
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
    jpeg_tables: &'a [u8],
    rows_per_strip: usize,
    tile: Option<(usize, usize)>,
    white_zero: bool,
    lsb_first: bool,
    group3_mixed: bool,
    predictor: bool,
    alpha: usize,
    offsets: Field<'a>,
    counts: Option<Field<'a>>,
}
impl<'a> Tiff<'a> {
    pub fn parse(bytes: &'a [u8], limit: usize) -> Result<Self> {
        block_on(Self::parse_async(bytes, limit))
    }
    pub async fn parse_async(bytes: &'a [u8], limit: usize) -> Result<Self> {
        if !signature(bytes) {
            return Err(INVALID);
        }
        let little = bytes.starts_with(b"II");
        let directory = word(bytes.get(4..8).ok_or(INVALID)?, little) as usize;
        if directory < 8 {
            return Err(INVALID);
        }
        let dir = bytes.get(directory..).ok_or(INVALID)?;
        let count = word(dir.get(..2).ok_or(INVALID)?, little) as usize;
        let entries = dir.get(2..2 + 12 * count).ok_or(INVALID)?;
        dir.get(2 + 12 * count..6 + 12 * count).ok_or(INVALID)?;
        // Validate field spans before the borrowed field lookup can return a value.
        const NUMERIC: &[u32] = &[
            256, 257, 258, 259, 262, 266, 273, 274, 277, 278, 279, 284, 292, 317, 322, 323, 324,
            325, 338, 339,
        ];
        let mut seen = 0u32;
        for entry in entries.chunks_exact(12) {
            yield_now().await;
            let tag = word(&entry[..2], little);
            let kind = word(&entry[2..4], little);
            if let Some(index) = NUMERIC.iter().position(|value| *value == tag) {
                if !matches!(kind, 3 | 4) || seen & (1 << index) != 0 {
                    return Err(INVALID);
                }
                seen |= 1 << index;
            }
            if matches!(tag, 318 | 319 | 34675) {
                return Err(UNSUPPORTED);
            }
            let stride = match kind {
                1 | 2 | 6 | 7 => 1,
                3 | 8 => 2,
                4 | 9 | 11 => 4,
                5 | 10 | 12 => 8,
                _ => return Err(UNSUPPORTED),
            };
            let size = (word(&entry[4..8], little) as usize)
                .checked_mul(stride)
                .ok_or(INVALID)?;
            if size == 0 {
                return Err(INVALID);
            }
            if size > 4 {
                let offset = word(&entry[8..], little) as usize;
                if offset < 8 {
                    return Err(INVALID);
                }
                bytes
                    .get(offset..offset.checked_add(size).ok_or(INVALID)?)
                    .ok_or(INVALID)?;
            }
        }
        let field = |tag: usize| -> Option<Field<'a>> {
            let entry = entries
                .chunks_exact(12)
                .rev()
                .find(|e| word(&e[..2], little) as usize == tag)?;
            let stride = match word(&entry[2..4], little) {
                3 => 2,
                4 => 4,
                _ => 1,
            };
            let size = (word(&entry[4..8], little) as usize).checked_mul(stride)?;
            let data = if size <= 4 {
                &entry[8..]
            } else {
                bytes.get(word(&entry[8..], little) as usize..)?
            };
            Some(Field {
                bytes: data.get(..size)?,
                stride,
            })
        };
        let get = |tag, fallback| {
            field(tag)
                .and_then(|f| f.get(0, little))
                .unwrap_or(fallback)
        };
        let (width, height) = (get(256, 0), get(257, 0));
        if width == 0 || height == 0 {
            return Err(INVALID);
        }
        width
            .checked_mul(height)
            .and_then(|v| v.checked_mul(4))
            .filter(|n| *n <= limit)
            .ok_or(LIMIT)?;
        let photo = get(262, 2);
        let samples = get(277, if photo <= 1 { 1 } else { 3 });
        let compression = get(259, 1);
        let fax = matches!(compression, 2..=4);
        let is_jpeg = matches!(compression, 6 | 7);
        let depth = get(258, if is_jpeg { 8 } else { 1 });
        let base = if photo <= 1 { 1 } else { 3 };
        if !matches!(photo, 0..=2) && !(photo == 6 && is_jpeg)
            || get(284, 1) != 1
            || !(samples == base || samples == base + 1)
            || !matches!(depth, 1 | 8 | 16)
            || depth == 1 && (samples != 1 || photo > 1)
            || fax && depth != 1
            || is_jpeg && (depth != 8 || samples != base)
            || !matches!(compression, 1..=8 | 32946 | 32773)
            || !matches!(get(317, 1), 1 | 2)
            || get(317, 1) == 2 && (depth == 1 || fax || is_jpeg)
            || !matches!(get(266, 1), 1 | 2)
            || get(266, 1) == 2 && (depth != 1 || !matches!(compression, 1..=4))
        {
            return Err(UNSUPPORTED);
        }
        if let Some(bits) = field(258) {
            if bits.len() != 1 && bits.len() != samples {
                return Err(UNSUPPORTED);
            }
            for i in 0..bits.len() {
                if bits.get(i, little) != Some(depth) {
                    return Err(UNSUPPORTED);
                }
            }
        }
        if let Some(format) = field(339) {
            for i in 0..format.len() {
                if format.len() != 1 && format.len() != samples || format.get(i, little) != Some(1)
                {
                    return Err(UNSUPPORTED);
                }
            }
        }
        let alpha = if samples == base + 1 {
            let extra = field(338).ok_or(UNSUPPORTED)?;
            if extra.len() != 1 {
                return Err(UNSUPPORTED);
            }
            let alpha = extra.get(0, little).ok_or(INVALID)?;
            if alpha > 2 || photo == 0 && alpha == 1 {
                return Err(UNSUPPORTED);
            }
            alpha
        } else {
            if field(338).is_some() {
                return Err(UNSUPPORTED);
            }
            0
        };
        let tile = match (get(322, 0), get(323, 0)) {
            (0, 0) => None,
            (w, h) if w > 0 && h > 0 => Some((w, h)),
            _ => return Err(INVALID),
        };
        let offsets = field(if tile.is_some() { 324 } else { 273 }).ok_or(INVALID)?;
        let counts = field(if tile.is_some() { 325 } else { 279 });
        let rows_per_strip = get(278, height).min(height);
        if rows_per_strip == 0 {
            return Err(INVALID);
        }
        let pieces = if let Some((w, h)) = tile {
            width
                .div_ceil(w)
                .checked_mul(height.div_ceil(h))
                .ok_or(LIMIT)?
        } else {
            height.div_ceil(rows_per_strip)
        };
        if offsets.len() != pieces
            || counts.is_some_and(|c| c.len() != pieces)
            || counts.is_none() && (!is_jpeg || pieces != 1)
        {
            return Err(INVALID);
        }
        for i in 0..pieces {
            yield_now().await;
            let off = offsets.get(i, little).ok_or(INVALID)?;
            let len = counts
                .and_then(|c| c.get(i, little))
                .unwrap_or(bytes.len().saturating_sub(off));
            if off < 8 || len == 0 {
                return Err(INVALID);
            }
            bytes
                .get(off..off.checked_add(len).ok_or(INVALID)?)
                .ok_or(INVALID)?;
        }
        let (dpi, orientation) = image_header::exif(bytes).unwrap_or_default();
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
            compression,
            jpeg_tables: field(347).map_or(&[][..], |f| f.bytes),
            rows_per_strip,
            tile,
            white_zero: photo == 0,
            lsb_first: get(266, 1) == 2,
            group3_mixed: get(292, 0) & 1 != 0,
            predictor: get(317, 1) == 2,
            alpha,
            offsets,
            counts,
        })
    }
    fn stride(&self, width: usize) -> Result<usize> {
        if self.depth == 1 {
            Ok(width.div_ceil(8))
        } else {
            width
                .checked_mul(self.samples * usize::from(self.depth / 8))
                .ok_or(LIMIT)
        }
    }
    async fn chunk(
        &self,
        index: usize,
        width: usize,
        rows: usize,
        scratch: usize,
        work: &mut usize,
    ) -> Result<Cow<'a, [u8]>> {
        let expected = self.stride(width)?.checked_mul(rows).ok_or(LIMIT)?;
        let off = self.offsets.get(index, self.little).ok_or(INVALID)?;
        let len = self
            .counts
            .and_then(|c| c.get(index, self.little))
            .unwrap_or(self.bytes.len() - off);
        let input = self.bytes.get(off..off + len).ok_or(INVALID)?;
        if self.compression == 1 {
            return Ok(Cow::Borrowed(input.get(..expected).ok_or(INVALID)?));
        }
        if expected > scratch {
            return Err(LIMIT);
        }
        *work = work.checked_sub(len.max(expected)).ok_or(WORK_LIMIT)?;
        yield_now().await;
        let decoded = match self.compression {
            2..=4 => {
                let coding = match self.compression {
                    2 => fax::Coding::Rle,
                    3 => fax::Coding::Group3 {
                        mixed: self.group3_mixed,
                    },
                    _ => fax::Coding::Group4,
                };
                fax::decode_async(input, coding, width, expected, self.lsb_first, scratch)
                    .await
                    .ok_or(INVALID)?
            }
            5 => {
                let mut out = Vec::with_capacity(expected);
                lzw::decode_async(input, 1., expected, &mut out).await?;
                out
            }
            6 | 7 => {
                let mut owned = Vec::new();
                let data = if self.jpeg_tables.starts_with(&[255, 216])
                    && self.jpeg_tables.len() > 4
                    && input.starts_with(&[255, 216])
                    && input.len() > 2
                {
                    let tables = &self.jpeg_tables[2..self.jpeg_tables.len() - 2];
                    let size = tables
                        .len()
                        .checked_add(input.len())
                        .filter(|n| *n <= scratch - expected)
                        .ok_or(LIMIT)?;
                    *work = work.checked_sub(size).ok_or(WORK_LIMIT)?;
                    owned.reserve_exact(size);
                    owned.extend_from_slice(&input[..2]);
                    for chunk in tables.chunks(65536) {
                        yield_now().await;
                        owned.extend_from_slice(chunk);
                    }
                    for chunk in input[2..].chunks(65536) {
                        yield_now().await;
                        owned.extend_from_slice(chunk);
                    }
                    owned.as_slice()
                } else {
                    input
                };
                let header = image_header::jpeg(data)?;
                if header.width as usize != width || header.height as usize != rows {
                    return Err(INVALID);
                }
                let pixel_cost = width
                    .checked_mul(rows)
                    .and_then(|n| n.checked_mul(4))
                    .ok_or(WORK_LIMIT)?;
                *work = work.checked_sub(pixel_cost).ok_or(WORK_LIMIT)?;
                let im = jpeg::decode_async(data, scratch - expected - owned.len()).await?;
                let mut out = Vec::with_capacity(expected);
                for pixels in im.pixels.chunks(4096) {
                    yield_now().await;
                    for pixel in pixels {
                        out.extend_from_slice(&pixel[..self.samples]);
                    }
                }
                out
            }
            32773 => {
                let mut out = Vec::with_capacity(expected);
                let mut at = 0;
                while at < input.len() && out.len() < expected {
                    yield_now().await;
                    let n = input[at];
                    at += 1;
                    match n {
                        0..=127 => {
                            let n = n as usize + 1;
                            if out.len() + n > expected {
                                return Err(INVALID);
                            }
                            out.extend_from_slice(input.get(at..at + n).ok_or(INVALID)?);
                            at += n;
                        }
                        129..=255 => {
                            let n = 257 - n as usize;
                            if out.len() + n > expected {
                                return Err(INVALID);
                            }
                            let v = *input.get(at).ok_or(INVALID)?;
                            at += 1;
                            out.resize(out.len() + n, v);
                        }
                        _ => {}
                    }
                }
                out
            }
            8 | 32946 => {
                let zlib = input.len() >= 6
                    && input[0] & 15 == 8
                    && u16::from_be_bytes([input[0], input[1]]) % 31 == 0;
                if zlib && input[1] & 32 != 0 {
                    return Err(UNSUPPORTED);
                }
                let data = if zlib { &input[2..] } else { input };
                let (out, used) = inflate::inflate_raw_bounded_async(data, expected)
                    .await
                    .map_err(|e| if e.contains("limit") { LIMIT } else { INVALID })?;
                if zlib
                    && input.get(2 + used..6 + used)
                        != Some(png::adler32_async(&out).await.to_be_bytes().as_slice())
                {
                    return Err(INVALID);
                }
                out
            }
            _ => return Err(UNSUPPORTED),
        };
        if decoded.len() != expected {
            return Err(INVALID);
        }
        Ok(Cow::Owned(decoded))
    }
    async fn row(&self, row: &mut [[u8; 4]], raw: &[u8]) -> Result<()> {
        if self.depth == 1 {
            for (i, dst) in row.iter_mut().enumerate() {
                if i % 4096 == 0 {
                    yield_now().await;
                }
                let bits = *raw.get(i / 8).ok_or(INVALID)?;
                let bits = if self.lsb_first && self.compression == 1 {
                    bits.reverse_bits()
                } else {
                    bits
                };
                let gray = if (bits & (128 >> (i % 8)) != 0) != self.white_zero {
                    255
                } else {
                    0
                };
                *dst = [gray, gray, gray, 255];
            }
            return Ok(());
        }
        let mut prev = [0u16; 4];
        let mut at = 0;
        let maximum = if self.depth == 16 { 65535u32 } else { 255 };
        for (i, dst) in row.iter_mut().enumerate() {
            if i % 4096 == 0 {
                yield_now().await;
            }
            let mut values = [0u32; 4];
            for c in 0..self.samples {
                let value = if self.depth == 16 {
                    let b: [u8; 2] = raw.get(at..at + 2).ok_or(INVALID)?.try_into().unwrap();
                    at += 2;
                    if self.little {
                        u16::from_le_bytes(b)
                    } else {
                        u16::from_be_bytes(b)
                    }
                } else {
                    let v = *raw.get(at).ok_or(INVALID)?;
                    at += 1;
                    u16::from(v)
                };
                prev[c] = if self.predictor {
                    prev[c].wrapping_add(value)
                } else {
                    value
                };
                values[c] = u32::from(prev[c]) & maximum;
            }
            let base = if self.samples < 3 { 1 } else { 3 };
            let alpha = if self.alpha != 0 {
                values[base]
            } else {
                maximum
            };
            let mut pixel = [0, 0, 0, (alpha >> (self.depth - 8)) as u8];
            for c in 0..base {
                let mut value = if self.white_zero {
                    maximum - values[c]
                } else {
                    values[c]
                };
                if self.alpha == 1 {
                    value = if alpha == 0 {
                        0
                    } else {
                        ((value * maximum + alpha / 2) / alpha).min(maximum)
                    };
                }
                pixel[c] = (value >> (self.depth - 8)) as u8;
            }
            if base == 1 {
                pixel[1] = pixel[0];
                pixel[2] = pixel[0];
            }
            *dst = pixel;
        }
        Ok(())
    }
    pub fn decode(&self) -> Result<DecodedImage> {
        block_on(self.decode_async())
    }
    pub async fn decode_async(&self) -> Result<DecodedImage> {
        let count = self.width.checked_mul(self.height).ok_or(LIMIT)?;
        let scratch = self
            .limit
            .checked_sub(count.checked_mul(4).ok_or(LIMIT)?)
            .ok_or(LIMIT)?;
        let mut work = self.limit.saturating_mul(8);
        let mut pixels = Vec::with_capacity(count);
        while pixels.len() < count {
            yield_now().await;
            pixels.resize((pixels.len() + 4096).min(count), [0; 4]);
        }
        if let Some((width, height)) = self.tile {
            let stride = self.stride(width)?;
            let mut index = 0;
            for y in (0..self.height).step_by(height) {
                for x in (0..self.width).step_by(width) {
                    let data = self.chunk(index, width, height, scratch, &mut work).await?;
                    index += 1;
                    let columns = width.min(self.width - x);
                    // Visible columns are the prefix of each tile row, so predictor
                    // reconstruction needs no clipped pixels or extra row buffer.
                    for k in 0..height.min(self.height - y) {
                        let start = (y + k) * self.width + x;
                        self.row(
                            &mut pixels[start..start + columns],
                            &data[k * stride..(k + 1) * stride],
                        )
                        .await?;
                    }
                }
            }
        } else {
            let stride = self.stride(self.width)?;
            for (index, y) in (0..self.height).step_by(self.rows_per_strip).enumerate() {
                let rows = self.rows_per_strip.min(self.height - y);
                let data = self
                    .chunk(index, self.width, rows, scratch, &mut work)
                    .await?;
                for k in 0..rows {
                    let start = (y + k) * self.width;
                    self.row(
                        &mut pixels[start..start + self.width],
                        &data[k * stride..(k + 1) * stride],
                    )
                    .await?;
                }
            }
        }
        Ok(DecodedImage {
            width: self.width,
            height: self.height,
            pixels,
            density: self.density,
            orientation: self.orientation,
            alpha: self.alpha != 0,
            gray: self.samples < 3,
        })
    }
}
pub fn decode(bytes: &[u8], limit: usize) -> Result<DecodedImage> {
    block_on(decode_async(bytes, limit))
}
pub async fn decode_async(bytes: &[u8], limit: usize) -> Result<DecodedImage> {
    Tiff::parse_async(bytes, limit).await?.decode_async().await
}
