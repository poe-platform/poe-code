use super::fax;
use super::png_pixels::Raster;
use std::borrow::Cow;

pub(super) fn signature(bytes: &[u8]) -> bool {
    matches!(bytes.get(..4), Some(b"II*\0" | b"MM\0*"))
        && bytes.get(8..17) != Some(b"\n__IMG__:")
}

fn packbits(row: &[u8], out: &mut Vec<u8>) {
    let mut i = 0;
    while i < row.len() {
        let run = row[i..].iter().take(128).take_while(|&&b| b == row[i]).count();
        if run >= 3 {
            out.extend([1u8.wrapping_sub(run as u8), row[i]]);
            i += run;
        } else {
            let start = i;
            i += 1;
            while i < row.len() && i - start < 128
                && !(i + 2 < row.len() && row[i] == row[i + 1] && row[i] == row[i + 2]) { i += 1; }
            out.push((i - start - 1) as u8);
            out.extend_from_slice(&row[start..i]);
        }
    }
}

pub(super) fn encode(
    pixels: &[[u8; 4]], width: usize, dpi: [f64; 2], color: &str,
    compression: &str, dither: bool, limit: usize,
) -> Option<Vec<u8>> {
    let height = pixels.len() / width;
    let samples: u32 = if color == "rgba" { 4 } else if color == "rgb" { 3 } else { 1 };
    let mono = samples == 1 && color == "mono";
    let bits = if mono { 1 } else { 8 };
    let codec = match compression { "none" => 1, "ccittrle" => 2, "ccittfax3" | "ccittt4" => 3, "ccittfax4" | "ccittt6" => 4, "lzw" => 5, "jpeg" => 7, "deflate" => 32946, "packbits" => 32773, _ => return None };
    if matches!(codec, 2..=4) && !mono { return None; }
    let strip = if codec == 7 {
        if samples == 4 || mono { return None; }
        super::jpeg::encode(super::jpeg::Input::Page { width, height, pixels, quality: 75,
            dpi: dpi.map(|v| v as u16), gray: samples == 1 }, limit).ok()?
    } else {
        let stride = if mono { width.div_ceil(8) } else { width.checked_mul(samples as usize)? };
        if stride.checked_mul(height)? > limit { return None; }
        let mut raw = Vec::new();
        let mut row = Vec::with_capacity(stride);
        for (y, line) in pixels.chunks_exact(width).enumerate() {
            row.clear();
            for (x, &[r, g, b, a]) in line.iter().enumerate() {
                if samples == 4 {
                    row.extend([r, g, b].map(|v| ((u16::from(v) * u16::from(a) + 127) / 255) as u8));
                    row.push(a);
                } else if samples == 3 {
                    row.extend([r, g, b]);
                } else {
                    let gray = ((30 * u32::from(r) + 59 * u32::from(g) + 11 * u32::from(b) + 50) / 100) as u8;
                    if mono {
                        // Splash's default screen at ordinary raster resolutions.
                        const SCREEN: [[u8; 4]; 4] = [[17,255,34,204],[153,85,170,102],[51,221,1,238],[187,119,136,68]];
                        if x % 8 == 0 { row.push(0); }
                        if gray >= if dither { SCREEN[y % 4][x % 4] } else { 128 } {
                            row[x / 8] |= 128 >> (x % 8);
                        }
                    } else { row.push(gray); }
                }
            }
            if codec == 32773 { packbits(&row, &mut raw); } else { raw.extend_from_slice(&row); }
            if raw.len() > limit { return None; }
        }
        match codec {
            2..=4 => fax::encode(&raw, width, codec, limit)?,
            5 => crate::commands::codecs::tiff_lzw(&raw),
            32946 => crate::commands::codecs::zlib_compress(&raw),
            _ => raw,
        }
    };
    let mut out = b"II*\0\0\0\0\0".to_vec();
    let strip_len = u32::try_from(strip.len()).ok()?;
    if strip.len().checked_add(8)? > limit { return None; }
    out.extend_from_slice(&strip);
    if out.len() % 2 != 0 { out.push(0); }
    let bits_field = if samples == 1 { bits } else {
        let offset = u32::try_from(out.len()).ok()?;
        for _ in 0..samples { out.extend_from_slice(&(bits as u16).to_le_bytes()); }
        offset
    };
    let resolutions = u32::try_from(out.len()).ok()?;
    for value in dpi {
        let den = (f64::from(u32::MAX) / value.max(1.)).clamp(1., 65536.) as u32;
        out.extend_from_slice(&((value * f64::from(den)).round() as u32).to_le_bytes());
        out.extend_from_slice(&den.to_le_bytes());
    }
    let directory = u32::try_from(out.len()).ok()?;
    out[4..8].copy_from_slice(&directory.to_le_bytes());
    let ycbcr = codec == 7 && samples == 3;
    let tags = [(256u16,4u16,1,width as u32), (257,4,1,height as u32),
        (258,3,samples,bits_field), (259,3,1,codec),
        (262,3,1,if samples == 1 {1} else if ycbcr {6} else {2}),
        (273,4,1,8), (277,3,1,samples), (278,4,1,height as u32), (279,4,1,strip_len),
        (282,5,1,resolutions), (283,5,1,resolutions.checked_add(8)?), (284,3,1,1), (296,3,1,2)];
    out.extend_from_slice(&(tags.len() as u16 + u16::from(samples == 4 || ycbcr)).to_le_bytes());
    for (tag, ty, count, value) in tags.into_iter().chain((samples == 4).then_some((338,3,1,1)))
        .chain(ycbcr.then_some((530,3,2,0x00010001))) {
        out.extend_from_slice(&tag.to_le_bytes()); out.extend_from_slice(&ty.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes()); out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&0u32.to_le_bytes());
    (out.len() <= limit).then_some(out)
}

fn word(bytes: &[u8], little: bool) -> u32 {
    if little {
        bytes.iter().rev().fold(0, |n, b| n << 8 | u32::from(*b))
    } else {
        bytes.iter().fold(0, |n, b| n << 8 | u32::from(*b))
    }
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
        5 => {
            let mut decoded = Vec::with_capacity(expected);
            // TIFF readers keep a partial strip and zero-fill missing pixels.
            let _ = crate::commands::codecs::decode_lzw(input, 1., expected, &mut decoded);
            decoded.resize(expected, 0);
            Ok(Cow::Owned(decoded))
        }
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
    jpeg_tables: &'a [u8],
    rows_per_strip: usize,
    tile: Option<(usize, usize)>,
    white_zero: bool,
    lsb_first: bool,
    group3_mixed: bool,
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
        if width.max(1).saturating_mul(height.max(1)) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        let photo = get(262, 2);
        let samples = get(277, if photo <= 1 { 1 } else { 4 });
        let compression = get(259, 1);
        let fax = matches!(compression, 2..=4);
        let depth = get(258, if fax || photo <= 1 && field(277).is_none() { 1 } else { 8 });
        if !(1..=4).contains(&samples)
            || !matches!(depth, 1 | 8 | 16)
            || fax && depth != 1
            || depth == 1 && (samples != 1 || photo > 1 || get(317, 1) != 1 || matches!(get(259, 1), 6 | 7) || (get(266, 1) == 2 && !matches!(compression, 1..=4)))
            || !matches!(compression, 1..=8 | 32946 | 32773)
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
            compression,
            jpeg_tables: field(347).map_or(&[][..], |f| f.bytes),
            rows_per_strip: get(278, height).clamp(1, height.max(1)),
            white_zero: photo == 0,
            lsb_first: get(266, 1) == 2,
            group3_mixed: get(292, 0) & 1 != 0,
            predictor: get(317, 1) == 2,
            tile,
            offsets: field(if tile.is_some() { 324 } else { 273 }),
            counts: field(if tile.is_some() { 325 } else { 279 }),
        })
    }

    fn jpeg_chunk(
        &self,
        input: &[u8],
        expected: usize,
        limit: usize,
        work: &mut usize,
    ) -> Result<Vec<u8>, &'static str> {
        let limit = limit
            .checked_sub(expected)
            .ok_or("image exceeds memory budget")?;
        let mut owned = Vec::new();
        let jpeg = if self.jpeg_tables.starts_with(&[255, 216])
            && self.jpeg_tables.len() > 4
            && input.starts_with(&[255, 216])
            && input.len() > 2
        {
            let tables = &self.jpeg_tables[2..self.jpeg_tables.len() - 2];
            let len = tables
                .len()
                .checked_add(input.len())
                .filter(|n| *n <= limit)
                .ok_or("image exceeds memory budget")?;
            *work = work
                .checked_sub(len)
                .ok_or("image decompression work limit exceeded")?;
            owned.reserve_exact(len);
            owned.extend_from_slice(&input[..2]);
            owned.extend_from_slice(tables);
            owned.extend_from_slice(&input[2..]);
            owned.as_slice()
        } else {
            input
        };
        let h = super::image_header::jpeg(jpeg)?;
        *work = work
            .checked_sub(
                (h.width as usize)
                    .saturating_mul(h.height as usize)
                    .saturating_mul(4),
            )
            .ok_or("image decompression work limit exceeded")?;
        let im = super::jpeg_decode::decode(jpeg, limit - owned.len())?;
        let mut bytes = vec![0; expected];
        for (pixel, dst) in im.pixels.iter().zip(bytes.chunks_exact_mut(self.samples)) {
            dst.copy_from_slice(&pixel[..self.samples]);
        }
        Ok(bytes)
    }

    fn row(
        &self,
        row: &mut [[u8; 4]],
        mut byte: impl FnMut() -> Result<u8, &'static str>,
    ) -> Result<(), &'static str> {
        if self.depth == 1 {
            for group in row.chunks_mut(8) {
                let bits = byte()?;
                let bits = if self.lsb_first && self.compression == 1 { bits.reverse_bits() } else { bits };
                for (bit, dst) in group.iter_mut().enumerate() {
                    let g = if (bits & (128 >> bit) != 0) != self.white_zero { 255 } else { 0 };
                    *dst = [g, g, g, 255];
                }
            }
            return Ok(());
        }
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
        if self.width==0 || self.height==0 {return Err("Invalid TIFF dimensions");}
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
        let row_bytes = |width: usize| {
            if self.depth == 1 { Ok(width.div_ceil(8)) }
            else { width.checked_mul(self.samples * usize::from(self.depth / 8)).ok_or("image exceeds memory budget") }
        };
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
            if matches!(self.compression, 2..=4) {
                let coding = match self.compression {
                    2 => fax::Coding::Rle,
                    3 => fax::Coding::Group3 { mixed: self.group3_mixed },
                    _ => fax::Coding::Group4,
                };
                let width = self.tile.map_or(self.width, |(w, _)| w);
                return fax::decode(&data[..n], coding, width, expected, self.lsb_first, scratch)
                    .map(|v| Some(Cow::Owned(v))).ok_or("invalid or oversized fax TIFF strip");
            }
            if matches!(self.compression, 6 | 7) {
                return Ok(Some(Cow::Owned(self.jpeg_chunk(
                    &data[..n],
                    expected,
                    scratch,
                    &mut work,
                )?)));
            }
            strip(&data[..n], self.compression, expected, scratch).map(Some)
        };
        let mut missing = [0; 4];
        self.row(std::slice::from_mut(&mut missing), || Ok(0))?;
        let mut pixels = vec![missing; self.width * self.height];
        if let Some((w, h)) = self.tile {
            let stride = row_bytes(w)?;
            let expected = h.checked_mul(stride).ok_or("image exceeds memory budget")?;
            'tiles: for y in (0..self.height).step_by(h) {
                for x in (0..self.width).step_by(w) {
                    let Some(data) = next(expected)? else {
                        break 'tiles;
                    };
                    let cols = w.min(self.width - x);
                    for (k, raw) in data.chunks(stride).take(h.min(self.height - y)).enumerate() {
                        if let Some(raw) = raw.get(..row_bytes(cols)?) {
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
            let stride = row_bytes(self.width)?;
            let total = self.height
                .checked_mul(stride)
                .ok_or("image exceeds memory budget")?;
            let mut decoded = Cow::Borrowed(&[][..]);
            let (mut pos, mut read) = (0usize, 0usize);
            let mut byte = || {
                while pos == decoded.len() {
                    drop(std::mem::replace(&mut decoded, Cow::Borrowed(&[])));
                    let Some(data) =
                        next((total - read).min(stride * self.rows_per_strip))?
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
    fn jpeg_strips_share_tables_from_the_tiff_directory() {
        let im = Raster {
            width: 3,
            height: 1,
            alpha: false,
            gray: false,
            orientation: None,
            density: 72,
            pixels: vec![[200, 30, 40, 255], [9, 27, 100, 255], [88, 111, 55, 255]],
        };
        let jpeg = super::super::jpeg::encode(super::super::jpeg::Input::Raster(&im, 85., 72), 1 << 20).unwrap();
        let expected = super::super::jpeg_decode::decode(&jpeg, 1 << 20)
            .unwrap()
            .pixels;
        let start = jpeg.windows(2).position(|v| v == [255, 219]).unwrap();
        let end = start + 2 + word(&jpeg[start + 2..start + 4], false) as usize;
        let tables = [&[255, 216], &jpeg[start..end], &[255, 217]].concat();
        let packet = [&jpeg[..start], &jpeg[end..]].concat();
        let fields = [
            (256u16, 4u16, 1, 3),
            (257, 4, 1, 1),
            (259, 4, 1, 7),
            (277, 4, 1, 3),
            (347, 7, tables.len() as u32, 86),
            (273, 4, 1, 86 + tables.len() as u32),
        ];
        let mut bytes = b"MM\0*\0\0\0\x08".to_vec();
        bytes.extend_from_slice(&(fields.len() as u16).to_be_bytes());
        for (tag, ty, n, v) in fields {
            bytes.extend_from_slice(&tag.to_be_bytes());
            bytes.extend_from_slice(&ty.to_be_bytes());
            bytes.extend_from_slice(&n.to_be_bytes());
            bytes.extend_from_slice(&v.to_be_bytes());
        }
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend(tables);
        bytes.extend(packet);
        assert_eq!(
            Tiff::parse(&bytes, 1 << 20)
                .unwrap()
                .decode()
                .unwrap()
                .pixels,
            expected
        );
    }

    #[test]
    fn decodes_libtiff_rle_group3_and_group4_strips() {
        // Same 19x7 bitmap, encoded by libtiff with different strip and fax settings.
        for encoded in [
            // ref
            "49492a001c000000935cdc6ed249622466a0cd66ba492a492500100109000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000040000000601030001000000010000001101040001000000080000001601030001000000070000001701040001000000140000001c010300010000000100000000000000",
            // strips
            "49492a0024000000c93a3b764b92022000026485399835eb92a4000880c463c72e0002200a000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000040000000601030001000000010000000a01030001000000020000001101040003000000ae0000001601030001000000030000001701040003000000a20000001c0103000100000001000000000000000a0000000b0000000700000008000000120000001d000000",
            // tiff_ccitt-0
            "49492a001e00000018ac775d00aceaba06ac300751d7035ed701785d87030a000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000020000000601030001000000010000000a01030001000000020000001101040003000000a800000016010300010000000300000017010400030000009c0000001c01030001000000010000000000000009000000090000000400000008000000110000001a000000",
            // group3-0
            "49492a002600000000880140d6bb2e0090555dd700c80a73008cba1e00bdae030088d77538000b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000bc0000001601030001000000030000001701040003000000b00000001c0103000100000001000000240104000100000000000000000000000c0000000c00000005000000080000001400000020000000",
            // group3-1
            "49492a002800000000180380c83a3b760130abbaae01009815e60008cc9a7500ec751d0018afeb700b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000be0000001601030001000000030000001701040003000000b20000001c0103000100000001000000240104000100000001000000000000000e0000000d00000005000000080000001600000023000000",
            // group3-4
            "49492a002a0000000080180080ac775d0080aceaba060080ac30078051d703805ed7010080785d8703000b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000c00000001601030001000000030000001701040003000000b40000001c0103000100000001000000240104000100000004000000000000000e0000000d00000006000000080000001600000023000000",
            // group3-5
            "49492a002c0000000080310080c83a3b76018059d5750d008059610e80c0ac590780bdae030080f1ba0e07000b000001030001000000130000000101030001000000070000000201030001000000010000000301030001000000030000000601030001000000010000000a01030001000000020000001101040003000000c20000001601030001000000030000001701040003000000b60000001c0103000100000001000000240104000100000005000000000000000f0000000e00000006000000080000001700000025000000",
        ] {
            let bytes = super::super::hex_dec(encoded);
            let image = Tiff::parse(&bytes, 4096).unwrap().decode().unwrap();
            for (y, row) in image.pixels.chunks_exact(19).enumerate() {
                for (x, &pixel) in row.iter().enumerate() {
                    let v = if y == 3 || y > 0 && (x+y)%7 < 3 {255} else {0};
                    assert_eq!(pixel, [v,v,v,255], "{x},{y}");
                }
            }
        }
    }

    #[test]
    fn bilevel_strips_respect_row_padding_fill_order_and_photometric_interpretation() {
        for order in [1, 2] {
            for photo in [0, 1] {
                let fields = [(256u16,9u32),(257,2),(258,1),(259,1),(262,photo),(266,order),(273,8),(277,1),(279,4)];
                let mut bytes = b"II*\0\x0c\0\0\0".to_vec();
                for b in [0xaau8,0xff,0x55,0x7f] { bytes.push(if order == 2 { b.reverse_bits() } else { b }); }
                bytes.extend_from_slice(&(fields.len() as u16).to_le_bytes());
                for (tag,v) in fields {
                    bytes.extend_from_slice(&tag.to_le_bytes()); bytes.extend_from_slice(&4u16.to_le_bytes());
                    bytes.extend_from_slice(&1u32.to_le_bytes()); bytes.extend_from_slice(&v.to_le_bytes());
                }
                bytes.extend_from_slice(&[0;4]);
                let image = Tiff::parse(&bytes, 4096).unwrap().decode().unwrap();
                for (i,pixel) in image.pixels.iter().enumerate() {
                    let g = if (i % 2 == 0) == (photo == 1) { 255 } else { 0 };
                    assert_eq!(*pixel,[g,g,g,255], "pixel {i}, order {order}, photometric {photo}");
                }
            }
        }
    }

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
