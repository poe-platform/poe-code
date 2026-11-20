//! Bounded Windows/OS2 BMP pixel decoding, including RLE8 and RGB bitfields.
use crate::image::DecodedImage;
use mcp_protocol_rust::cooperate::{block_on, yield_now};

type Result<T> = std::result::Result<T, &'static str>;
const INVALID: &str = "Invalid or truncated BMP";
const LIMIT: &str = "image exceeds memory budget";

pub fn signature(bytes: &[u8]) -> bool {
    bytes.len() >= 26 && bytes.starts_with(b"BM") && bytes.get(6..15) != Some(b"\n__IMG__:")
}
fn word(bytes: &[u8], at: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at.checked_add(4).ok_or(INVALID)?)
            .ok_or(INVALID)?
            .try_into()
            .unwrap(),
    ))
}
fn short(bytes: &[u8], at: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        bytes
            .get(at..at.checked_add(2).ok_or(INVALID)?)
            .ok_or(INVALID)?
            .try_into()
            .unwrap(),
    ))
}
fn take<'a>(bytes: &mut &'a [u8], count: usize) -> Result<&'a [u8]> {
    let (head, tail) = bytes.split_at_checked(count).ok_or(INVALID)?;
    *bytes = tail;
    Ok(head)
}

pub struct Bmp<'a> {
    bytes: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub bpp: usize,
    pub density: u32,
    top_down: bool,
    compression: u32,
    offset: usize,
    end: usize,
    stride: usize,
    palette: usize,
    palette_count: usize,
    palette_entry: usize,
    masks: [u32; 4],
}
impl<'a> Bmp<'a> {
    pub fn parse(bytes: &'a [u8], limit: usize) -> Result<Self> {
        if !signature(bytes) {
            return Err(INVALID);
        }
        let declared = word(bytes, 2)? as usize;
        let bytes = if declared == 0 {
            bytes
        } else {
            bytes.get(..declared).ok_or(INVALID)?
        };
        let dib = word(bytes, 14)? as usize;
        if !matches!(dib, 12 | 40 | 52 | 56 | 108 | 124) {
            return Err("Unsupported BMP header");
        }
        let header_end = 14 + dib;
        bytes.get(..header_end).ok_or(INVALID)?;
        let core = dib == 12;
        let (width, height, top_down, planes, bpp) = if core {
            (
                usize::from(short(bytes, 18)?),
                usize::from(short(bytes, 20)?),
                false,
                short(bytes, 22)?,
                usize::from(short(bytes, 24)?),
            )
        } else {
            let width = word(bytes, 18)? as i32;
            let height = word(bytes, 22)? as i32;
            if width <= 0 {
                return Err(INVALID);
            }
            (
                width as usize,
                height.unsigned_abs() as usize,
                height < 0,
                short(bytes, 26)?,
                usize::from(short(bytes, 28)?),
            )
        };
        if width == 0 || height == 0 || planes != 1 {
            return Err(INVALID);
        }
        let count = width.checked_mul(height).ok_or(LIMIT)?;
        if count.checked_mul(4).ok_or(LIMIT)? > limit {
            return Err(LIMIT);
        }
        if !matches!(bpp, 1 | 4 | 8 | 16 | 24 | 32) || (core && !matches!(bpp, 1 | 4 | 8 | 24)) {
            return Err("Unsupported BMP bit depth");
        }
        let compression = if core { 0 } else { word(bytes, 30)? };
        match compression {
            0 => {}
            1 if bpp == 8 && !top_down => {}
            3 | 6 if matches!(bpp, 16 | 32) => {}
            _ => return Err("Unsupported BMP compression"),
        }
        // Calibrated or profiled color needs a color transform, not raw RGB decoding.
        if dib >= 108 {
            let space = word(bytes, 70)?;
            if !matches!(space, 0 | 0x7352_4742 | 0x5769_6e20)
                || (space == 0 && bytes[74..122].iter().any(|b| *b != 0))
                || (dib == 124 && (word(bytes, 126)? != 0 || word(bytes, 130)? != 0))
            {
                return Err("Unsupported BMP color profile");
            }
        }
        let mut masks = match bpp {
            16 => [0x7c00, 0x03e0, 0x001f, 0],
            32 => [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0],
            _ => [0; 4],
        };
        let mut palette = header_end;
        if matches!(compression, 3 | 6) {
            if dib == 40 {
                masks = [
                    word(bytes, 54)?,
                    word(bytes, 58)?,
                    word(bytes, 62)?,
                    if compression == 6 {
                        word(bytes, 66)?
                    } else {
                        0
                    },
                ];
                palette += if compression == 6 { 16 } else { 12 };
            } else {
                masks = [
                    word(bytes, 54)?,
                    word(bytes, 58)?,
                    word(bytes, 62)?,
                    if dib >= 56 { word(bytes, 66)? } else { 0 },
                ];
            }
            let mut used = 0;
            for (index, mask) in masks.iter().copied().enumerate() {
                if mask == 0 {
                    if index < 3 || compression == 6 {
                        return Err(INVALID);
                    }
                    continue;
                }
                let shifted = mask >> mask.trailing_zeros();
                if (shifted & shifted.wrapping_add(1)) != 0
                    || mask & used != 0
                    || (bpp == 16 && mask > 0xffff)
                {
                    return Err(INVALID);
                }
                used |= mask;
            }
        }
        let used_colors = if core { 0 } else { word(bytes, 46)? as usize };
        let palette_count = if bpp <= 8 {
            if used_colors == 0 {
                1 << bpp
            } else if used_colors <= 1 << bpp {
                used_colors
            } else {
                return Err(INVALID);
            }
        } else {
            used_colors
        };
        let palette_entry = if core { 3 } else { 4 };
        let palette_end = palette
            .checked_add(palette_count.checked_mul(palette_entry).ok_or(INVALID)?)
            .ok_or(INVALID)?;
        let offset = word(bytes, 10)? as usize;
        if offset < palette_end || offset > bytes.len() {
            return Err(INVALID);
        }
        let stride = width
            .checked_mul(bpp)
            .and_then(|bits| bits.checked_add(31))
            .map(|bits| bits / 32 * 4)
            .ok_or(LIMIT)?;
        let size = if core { 0 } else { word(bytes, 34)? as usize };
        let end = if size == 0 {
            bytes.len()
        } else {
            offset
                .checked_add(size)
                .filter(|end| *end <= bytes.len())
                .ok_or(INVALID)?
        };
        if compression != 1
            && stride
                .checked_mul(height)
                .and_then(|length| offset.checked_add(length))
                .is_none_or(|end_pixels| end_pixels > end)
        {
            return Err(INVALID);
        }
        let ppm = if core { 0 } else { word(bytes, 38)? as i32 };
        Ok(Self {
            bytes,
            width,
            height,
            bpp,
            density: if ppm > 0 {
                (f64::from(ppm) * 0.0254).round().max(1.) as u32
            } else {
                72
            },
            top_down,
            compression,
            offset,
            end,
            stride,
            palette,
            palette_count,
            palette_entry,
            masks,
        })
    }
    fn color(&self, index: usize) -> Result<[u8; 4]> {
        if index >= self.palette_count {
            return Err(INVALID);
        }
        let at = self.palette + index * self.palette_entry;
        Ok([self.bytes[at + 2], self.bytes[at + 1], self.bytes[at], 255])
    }
    fn bitfield(&self, value: u32) -> [u8; 4] {
        std::array::from_fn(|index| {
            let mask = self.masks[index];
            if mask == 0 {
                return 255;
            }
            let bits = mask >> mask.trailing_zeros();
            let sample = (value & mask) >> mask.trailing_zeros();
            ((u64::from(sample) * 255 + u64::from(bits) / 2) / u64::from(bits)) as u8
        })
    }
}

/// Walk RLE8 packets without expanding their pixels. Office admission uses a
/// no-op visitor; the pixel decoder writes the same admitted runs to its raster.
/// A one-index slice is an encoded run; longer slices are absolute packets.
pub(crate) async fn rle8_packets(
    mut data: &[u8],
    width: usize,
    height: usize,
    palette_count: usize,
    mut emit: impl FnMut(usize, usize, usize, &[u8]) -> Result<()>,
) -> Result<()> {
    if width == 0 || height == 0 || palette_count == 0 || palette_count > 256 {
        return Err(INVALID);
    }
    let (mut x, mut y) = (0usize, 0usize);
    loop {
        yield_now().await;
        let command = take(&mut data, 2)?;
        let n = usize::from(command[0]);
        if n != 0 {
            if y >= height || x > width || n > width - x || usize::from(command[1]) >= palette_count
            {
                return Err(INVALID);
            }
            emit(x, y, n, &command[1..2])?;
            x += n;
        } else {
            match command[1] {
                0 => {
                    if y >= height {
                        return Err(INVALID);
                    }
                    x = 0;
                    y += 1;
                }
                1 => return Ok(()),
                2 => {
                    let delta = take(&mut data, 2)?;
                    x = x.checked_add(usize::from(delta[0])).ok_or(INVALID)?;
                    y = y.checked_add(usize::from(delta[1])).ok_or(INVALID)?;
                    if x > width || y >= height {
                        return Err(INVALID);
                    }
                }
                literal => {
                    let n = usize::from(literal);
                    if y >= height || x > width || n > width - x {
                        return Err(INVALID);
                    }
                    let indexes = take(&mut data, n + (n & 1))?;
                    if indexes[..n]
                        .iter()
                        .any(|index| usize::from(*index) >= palette_count)
                    {
                        return Err(INVALID);
                    }
                    emit(x, y, n, &indexes[..n])?;
                    x += n;
                }
            }
        }
    }
}

pub fn decode(bytes: &[u8], limit: usize) -> Result<DecodedImage> {
    block_on(decode_async(bytes, limit))
}

pub async fn decode_async(bytes: &[u8], limit: usize) -> Result<DecodedImage> {
    let bmp = Bmp::parse(bytes, limit)?;
    yield_now().await;
    let count = bmp.width * bmp.height;
    let mut pixels = Vec::new();
    pixels.try_reserve_exact(count).map_err(|_| LIMIT)?;
    if bmp.compression == 1 {
        let background = bmp.color(0)?;
        while pixels.len() < count {
            yield_now().await;
            pixels.resize((pixels.len() + 4096).min(count), background);
        }
        rle8_packets(
            &bmp.bytes[bmp.offset..bmp.end],
            bmp.width,
            bmp.height,
            bmp.palette_count,
            |x, y, n, indexes| {
                let start = (bmp.height - 1 - y) * bmp.width + x;
                if indexes.len() == 1 {
                    pixels[start..start + n].fill(bmp.color(usize::from(indexes[0]))?);
                } else {
                    for (at, index) in indexes.iter().enumerate() {
                        pixels[start + at] = bmp.color(usize::from(*index))?;
                    }
                }
                Ok(())
            },
        )
        .await?;
    } else {
        for y in 0..bmp.height {
            let row_y = if bmp.top_down { y } else { bmp.height - 1 - y };
            let row = bmp.offset + row_y * bmp.stride;
            for x in 0..bmp.width {
                if pixels.len() % 4096 == 0 {
                    yield_now().await;
                }
                let pixel = match bmp.bpp {
                    1 => bmp.color(usize::from((bmp.bytes[row + x / 8] >> (7 - x % 8)) & 1))?,
                    4 => bmp.color(usize::from(
                        (bmp.bytes[row + x / 2] >> (4 * (1 - x % 2))) & 15,
                    ))?,
                    8 => bmp.color(usize::from(bmp.bytes[row + x]))?,
                    16 => bmp.bitfield(u32::from(short(bmp.bytes, row + x * 2)?)),
                    24 => {
                        let at = row + x * 3;
                        [bmp.bytes[at + 2], bmp.bytes[at + 1], bmp.bytes[at], 255]
                    }
                    32 => bmp.bitfield(word(bmp.bytes, row + x * 4)?),
                    _ => unreachable!(),
                };
                pixels.push(pixel);
            }
        }
    }
    Ok(DecodedImage {
        width: bmp.width,
        height: bmp.height,
        alpha: bmp.masks[3] != 0,
        gray: false,
        density: bmp.density,
        orientation: None,
        pixels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rle_admission_does_not_expand_or_multiply_image_dimensions() {
        let mut runs = 0;
        block_on(rle8_packets(
            &[1, 1, 0, 1],
            usize::MAX,
            usize::MAX,
            2,
            |x, y, count, indexes| {
                assert_eq!((x, y, count, indexes), (0, 0, 1, &[1][..]));
                runs += 1;
                Ok(())
            },
        ))
        .unwrap();
        assert_eq!(runs, 1);
        assert!(block_on(rle8_packets(&[3, 1, 0, 1], 2, 1, 2, |_, _, _, _| Ok(()))).is_err());
        assert!(block_on(rle8_packets(&[2, 1], 2, 1, 2, |_, _, _, _| Ok(()))).is_err());
    }
}
