use super::png_pixels::Raster;
use crate::commands::codecs::{adler32, inflate_raw_bounded};

pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x76\x2f\x31\x01")
}
fn word(bytes: &[u8], at: usize) -> Result<u32, &'static str> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at + 4)
            .ok_or("Truncated EXR header")?
            .try_into()
            .unwrap(),
    ))
}
fn name<'a>(bytes: &'a [u8], at: &mut usize) -> Result<&'a str, &'static str> {
    let rest = bytes.get(*at..).ok_or("Truncated EXR header")?;
    let end = rest
        .iter()
        .position(|&b| b == 0)
        .filter(|&n| n <= 255)
        .ok_or("Invalid EXR attribute name")?;
    *at += end + 1;
    std::str::from_utf8(&rest[..end]).map_err(|_| "Invalid EXR attribute name")
}
struct Channel<'a> {
    name: &'a str,
    kind: u32,
}
pub(super) struct Image<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub alpha: bool,
    pub gray: bool,
    channels: Vec<Channel<'a>>,
    compression: u8,
    min_x: i32,
    min_y: i32,
    data_width: usize,
    data_height: usize,
    offset: usize,
    pub kind: u32,
    aspect: Option<f32>,
    tags: Vec<(&'a str, &'a str)>,
}
impl<'a> Image<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if !signature(bytes) || word(bytes, 4)? & !0x400 != 2 {
            return Err("Unsupported EXR layout: expected single-part scanlines");
        }
        let mut at = 8;
        let mut channels = Vec::new();
        let mut compression = None;
        let mut window = None;
        let mut display = None;
        let mut aspect = None;
        let mut tags = Vec::new();
        loop {
            let key = name(bytes, &mut at)?;
            if key.is_empty() {
                break;
            }
            let ty = name(bytes, &mut at)?;
            let length = word(bytes, at)? as usize;
            at += 4;
            let end = at
                .checked_add(length)
                .filter(|&end| end <= bytes.len())
                .ok_or("Truncated EXR attribute")?;
            let data = &bytes[at..end];
            at = end;
            match key {
                "channels" => {
                    if ty != "chlist" || !channels.is_empty() {
                        return Err("Invalid EXR channels");
                    }
                    let mut pos = 0;
                    loop {
                        let ch = name(data, &mut pos)?;
                        if ch.is_empty() {
                            break;
                        }
                        let kind = word(data, pos)?;
                        if kind > 2 || word(data, pos + 8)? != 1 || word(data, pos + 12)? != 1 {
                            return Err("Unsupported EXR channel sampling");
                        }
                        if channels.iter().any(|c: &Channel| c.name == ch) {
                            return Err("Duplicate EXR channel");
                        }
                        if (channels.len() + 1) * size_of::<Channel>() > limit {
                            return Err("EXR channels exceed memory budget");
                        }
                        channels
                            .try_reserve_exact(1)
                            .map_err(|_| "EXR channels exceed memory budget")?;
                        channels.push(Channel { name: ch, kind });
                        pos += 16;
                    }
                    if pos != data.len() {
                        return Err("Invalid EXR channel list");
                    }
                }
                "compression" => {
                    if ty != "compression"
                        || data.len() != 1
                        || data[0] > 4
                        || compression.is_some()
                    {
                        return Err("Unsupported EXR compression");
                    }
                    compression = Some(data[0]);
                }
                "dataWindow" => {
                    if ty != "box2i" || data.len() != 16 || window.is_some() {
                        return Err("Invalid EXR data window");
                    }
                    window = Some([
                        word(data, 0)? as i32,
                        word(data, 4)? as i32,
                        word(data, 8)? as i32,
                        word(data, 12)? as i32,
                    ]);
                }
                "displayWindow" => {
                    if ty != "box2i" || data.len() != 16 || display.is_some() {
                        return Err("Invalid EXR display window");
                    }
                    display = Some([
                        word(data, 0)? as i32,
                        word(data, 4)? as i32,
                        word(data, 8)? as i32,
                        word(data, 12)? as i32,
                    ]);
                }
                "pixelAspectRatio" if ty == "float" && data.len() == 4 => {
                    aspect = Some(f32::from_bits(word(data, 0)?));
                }
                _ if ty == "string" && key != "type" => {
                    if let Ok(value) = std::str::from_utf8(data) {
                        if (tags.len() + 1) * size_of::<(&str, &str)>() > limit {
                            return Err("EXR metadata exceeds memory budget");
                        }
                        tags.try_reserve_exact(1)
                            .map_err(|_| "EXR metadata exceeds memory budget")?;
                        tags.push((key, value));
                    }
                }
                _ => {}
            }
        }
        let window = window.ok_or("Missing EXR data window")?;
        let dimensions = |window: [i32; 4]| -> Result<(usize, usize), &'static str> {
            let width = usize::try_from(i64::from(window[2]) - i64::from(window[0]) + 1)
                .map_err(|_| "Invalid EXR dimensions")?;
            let height = usize::try_from(i64::from(window[3]) - i64::from(window[1]) + 1)
                .map_err(|_| "Invalid EXR dimensions")?;
            width
                .checked_mul(height)
                .filter(|&n| n > 0 && n <= limit / 20)
                .ok_or("EXR image exceeds memory budget")?;
            Ok((width, height))
        };
        let (data_width, data_height) = dimensions(window)?;
        let (width, height) = dimensions(display.ok_or("Missing EXR display window")?)?;
        let gray = !channels.iter().any(|c| c.name == "R");
        let kind = channels
            .iter()
            .find(|c| c.name == if gray { "Y" } else { "R" })
            .ok_or("Missing EXR color channel")?
            .kind;
        for key in if gray {
            &["Y"][..]
        } else {
            &["R", "G", "B"][..]
        } {
            if !channels.iter().any(|c| c.name == *key && c.kind == kind) {
                return Err("EXR color channels require matching sample types");
            }
        }
        let alpha = channels.iter().any(|c| c.name == "A");
        Ok(Self {
            data: bytes,
            width,
            height,
            alpha,
            gray,
            channels,
            compression: compression.ok_or("Missing EXR compression")?,
            min_x: window[0],
            min_y: window[1],
            data_width,
            data_height,
            offset: at,
            kind,
            aspect,
            tags,
        })
    }
    pub fn pixel_format(&self) -> &'static str {
        match (self.gray, self.alpha, self.kind) {
            (true, false, 0) => "gray16le",
            (true, true, 0) => "ya16le",
            (false, false, 0) => "rgb48le",
            (false, true, 0) => "rgba64le",
            (true, false, 1) => "grayf16le",
            (true, false, _) => "grayf32le",
            (true, true, 1) => "yaf16le",
            (true, true, _) => "yaf32le",
            (false, true, 1) => "gbrapf16le",
            (false, true, _) => "gbrapf32le",
            (false, false, 1) => "gbrpf16le",
            _ => "gbrpf32le",
        }
    }
    pub fn decode(&self, limit: usize) -> Result<Vec<[f32; 4]>, &'static str> {
        let rows = match self.compression {
            3 => 16,
            4 => 32,
            _ => 1,
        };
        let count = self.data_height.div_ceil(rows);
        let table_end = count
            .checked_mul(8)
            .and_then(|n| n.checked_add(self.offset))
            .filter(|&n| n <= self.data.len())
            .ok_or("Truncated EXR offset table")?;
        let stride = self
            .channels
            .iter()
            .try_fold(0usize, |n, c| {
                n.checked_add(if c.kind == 1 { 2 } else { 4 })
            })
            .ok_or("EXR row exceeds memory budget")?;
        let row_bytes = self
            .data_width
            .checked_mul(stride)
            .ok_or("EXR row exceeds memory budget")?;
        let retained = self.width * self.height * 16
            + self.channels.capacity() * size_of::<Channel>()
            + self.tags.capacity() * size_of::<(&str, &str)>();
        if retained > limit {
            return Err("EXR decoding exceeds memory budget");
        }
        let mut pixels =
            vec![[0., 0., 0., if self.alpha { 0. } else { 1. }]; self.width * self.height];
        for block in 0..count {
            let offset = u64::from_le_bytes(
                self.data[self.offset + block * 8..self.offset + block * 8 + 8]
                    .try_into()
                    .unwrap(),
            );
            let offset = usize::try_from(offset)
                .ok()
                .filter(|&n| n >= table_end && n <= self.data.len().saturating_sub(8))
                .ok_or("Invalid EXR chunk offset")?;
            let y = i64::from(word(self.data, offset)? as i32) - i64::from(self.min_y);
            if y < 0 || y as usize != block * rows {
                return Err("Invalid EXR scanline chunk");
            }
            let y = y as usize;
            let length = word(self.data, offset + 4)? as usize;
            let end = (offset + 8)
                .checked_add(length)
                .filter(|&n| n <= self.data.len())
                .ok_or("Truncated EXR chunk")?;
            let lines = rows.min(self.data_height - y);
            let expected = row_bytes
                .checked_mul(lines)
                .ok_or("EXR chunk exceeds memory budget")?;
            if expected.saturating_mul(2) > limit.saturating_sub(retained) {
                return Err("EXR chunk exceeds memory budget");
            }
            let packed = &self.data[offset + 8..end];
            let raw;
            let data = if packed.len() == expected {
                packed
            } else {
                raw = if self.compression == 4 {
                    let strides = self
                        .channels
                        .iter()
                        .map(|c| if c.kind == 1 { 1 } else { 2 })
                        .collect::<Vec<_>>();
                    super::exr_piz::unpack(
                        packed,
                        self.data_width,
                        lines,
                        &strides,
                        limit.saturating_sub(retained + strides.capacity() * size_of::<usize>()),
                    )?
                } else {
                    unpack(packed, expected, self.compression)?
                };
                &raw
            };
            let mut pos = 0;
            for row in y..y + lines {
                for c in &self.channels {
                    for x in 0..self.data_width {
                        let value = if c.kind == 1 {
                            let v =
                                half(u16::from_le_bytes(data[pos..pos + 2].try_into().unwrap()));
                            pos += 2;
                            v
                        } else {
                            let v = word(data, pos)?;
                            pos += 4;
                            if c.kind == 2 {
                                f32::from_bits(v)
                            } else {
                                (v >> 16) as f32 / 65535.
                            }
                        };
                        let dx = i64::from(self.min_x) + x as i64;
                        let dy = i64::from(self.min_y) + row as i64;
                        if dx < 0 || dy < 0 || dx >= self.width as i64 || dy >= self.height as i64 {
                            continue;
                        }
                        let pixel = &mut pixels[dy as usize * self.width + dx as usize];
                        match c.name {
                            "R" => pixel[0] = value,
                            "G" => pixel[1] = value,
                            "B" => pixel[2] = value,
                            "A" => pixel[3] = value,
                            "Y" if self.gray => pixel[..3].fill(value),
                            _ => {}
                        }
                    }
                }
            }
        }
        Ok(pixels)
    }
    pub fn raster(&self, limit: usize) -> Result<Raster, &'static str> {
        let decoded = self.decode(limit)?;
        let pixels = decoded
            .iter()
            .map(|p| {
                let rgba = p.map(quantize);
                if self.kind == 1 || self.gray && self.kind == 2 {
                    let rgb = converted_rgb(rgba, self.gray, false);
                    [
                        rgb[0] as u8,
                        rgb[1] as u8,
                        rgb[2] as u8,
                        ((rgba[3] + 128) >> 8).min(255) as u8,
                    ]
                } else {
                    rgba.map(|v| ((v + 128) >> 8).min(255) as u8)
                }
            })
            .collect();
        Ok(Raster {
            width: self.width,
            height: self.height,
            alpha: self.alpha,
            gray: self.gray,
            density: 72,
            orientation: None,
            pixels,
        })
    }
}
// FFmpeg's half-float conversion uses a 16-bit BT.601 intermediate.
fn quantize(v: f32) -> i32 {
    (v.clamp(0., 1.) * 65535.).round_ties_even() as i32
}
fn converted_rgb(p: [i32; 4], gray: bool, wide: bool) -> [i32; 3] {
    let [r, g, b, _] = p;
    let (y, u, v) = if gray {
        (r, 32768, 32768)
    } else {
        (
            (8414 * r + 16519 * g + 3208 * b + (0x2001 << 14)) >> 15,
            (-4865 * r - 9528 * g + 14392 * b + (0x10001 << 14)) >> 15,
            (14392 * r - 12061 * g - 2332 * b + (0x10001 << 14)) >> 15,
        )
    };
    rgb_from_yuv(y, u, v, wide)
}
fn rgb_from_yuv(y: i32, u: i32, v: i32, wide: bool) -> [i32; 3] {
    let (y, u, v, round, shift, max) = if wide {
        (2 * y, 2 * (u - 32768), 2 * (v - 32768), 1 << 13, 14, 65535)
    } else {
        (
            4 * (y >> 1),
            4 * ((u >> 1) - 16384),
            4 * ((v >> 1) - 16384),
            1 << 21,
            22,
            255,
        )
    };
    let y = (y - 8192) * 9539 + round;
    [y + v * 13075, y - v * 6660 - u * 3209, y + u * 16525].map(|v| (v >> shift).clamp(0, max))
}
fn unpack(bytes: &[u8], expected: usize, compression: u8) -> Result<Vec<u8>, &'static str> {
    if bytes.len() > expected || compression == 0 {
        return Err("Invalid EXR chunk size");
    }
    let mut predicted = if compression == 1 {
        let mut out = Vec::with_capacity(expected);
        let mut at = 0;
        while at < bytes.len() {
            let count = bytes[at] as i8;
            at += 1;
            let size = if count < 0 {
                -(count as i16) as usize
            } else {
                count as usize + 1
            };
            if size > expected.saturating_sub(out.len()) {
                return Err("Invalid EXR RLE chunk");
            }
            if count < 0 {
                out.extend_from_slice(bytes.get(at..at + size).ok_or("Truncated EXR RLE chunk")?);
                at += size;
            } else {
                let byte = *bytes.get(at).ok_or("Truncated EXR RLE chunk")?;
                at += 1;
                out.resize(out.len() + size, byte);
            }
        }
        out
    } else {
        if bytes.len() < 6
            || bytes[0] & 15 != 8
            || u16::from_be_bytes([bytes[0], bytes[1]]) % 31 != 0
            || bytes[1] & 32 != 0
        {
            return Err("Invalid EXR ZIP header");
        }
        let (out, end) =
            inflate_raw_bounded(&bytes[2..], expected).map_err(|_| "Invalid EXR ZIP data")?;
        if end + 6 != bytes.len()
            || bytes.get(end + 2..end + 6) != Some(adler32(&out).to_be_bytes().as_slice())
        {
            return Err("Invalid EXR ZIP checksum");
        }
        out
    };
    if predicted.len() != expected {
        return Err("Truncated EXR compressed chunk");
    }
    for i in 1..expected {
        predicted[i] = predicted[i - 1]
            .wrapping_add(predicted[i])
            .wrapping_sub(128);
    }
    let mut out = vec![0; expected];
    let half = expected.div_ceil(2);
    for (i, b) in out.iter_mut().enumerate() {
        *b = predicted[if i % 2 == 0 { i / 2 } else { half + i / 2 }];
    }
    Ok(out)
}
fn half(bits: u16) -> f32 {
    let sign = u32::from(bits & 0x8000) << 16;
    let mut exponent = i32::from((bits >> 10) & 31);
    let mut fraction = u32::from(bits & 1023);
    if exponent == 0 {
        if fraction == 0 {
            return f32::from_bits(sign);
        }
        exponent = 1;
        while fraction & 1024 == 0 {
            fraction <<= 1;
            exponent -= 1;
        }
        fraction &= 1023;
    } else if exponent == 31 {
        return f32::from_bits(sign | 0x7f800000 | fraction << 13);
    }
    f32::from_bits(sign | ((exponent + 112) as u32) << 23 | fraction << 13)
}
fn to_half(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 255) as i32 - 112;
    let fraction = bits & 0x7fffff;
    if exponent >= 31 {
        return sign
            | 0x7c00
            | if exponent == 143 && fraction != 0 {
                (fraction >> 13) as u16
            } else {
                0
            };
    }
    if exponent < -10 {
        return sign;
    }
    let (value, shift) = if exponent <= 0 {
        (fraction | 0x800000, (14 - exponent) as u32)
    } else {
        (fraction, 13)
    };
    let rounded = (value + (1 << (shift - 1)) - 1 + ((value >> shift) & 1)) >> shift;
    sign | ((if exponent > 0 {
        (exponent as u32) << 10
    } else {
        0
    }) + rounded) as u16
}

pub(super) fn encode(
    width: usize,
    height: usize,
    alpha: bool,
    gray: bool,
    pixels: &[[f32; 4]],
    aspect: Option<f32>,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    if gray && alpha {
        return Err("EXR grayscale alpha encoding is not supported");
    }
    let channels = if gray {
        &[("Y", 0)][..]
    } else if alpha {
        &[("A", 3), ("B", 2), ("G", 1), ("R", 0)][..]
    } else {
        &[("B", 2), ("G", 1), ("R", 0)][..]
    };
    let size = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(channels.len() * 4))
        .and_then(|n| n.checked_add(height.checked_mul(16)?))
        .and_then(|n| n.checked_add(512))
        .filter(|&n| n <= limit)
        .ok_or("EXR output exceeds memory budget")?;
    if pixels.len() != width * height
        || width == 0
        || height == 0
        || width > i32::MAX as usize
        || height > i32::MAX as usize
    {
        return Err("Invalid EXR dimensions");
    }
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"\x76\x2f\x31\x01\x02\0\0\0");
    let mut attr = |name: &str, ty: &str, data: &[u8]| {
        out.extend_from_slice(name.as_bytes());
        out.push(0);
        out.extend_from_slice(ty.as_bytes());
        out.push(0);
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(data);
    };
    let mut list = Vec::new();
    for &(name, _) in channels {
        list.extend_from_slice(name.as_bytes());
        list.push(0);
        for v in [2u32, 0, 1, 1] {
            list.extend_from_slice(&v.to_le_bytes());
        }
    }
    list.push(0);
    attr("channels", "chlist", &list);
    attr("compression", "compression", &[0]);
    let mut window = [0u8; 16];
    window[8..12].copy_from_slice(&((width - 1) as u32).to_le_bytes());
    window[12..16].copy_from_slice(&((height - 1) as u32).to_le_bytes());
    attr("dataWindow", "box2i", &window);
    attr("displayWindow", "box2i", &window);
    attr("lineOrder", "lineOrder", &[0]);
    attr("screenWindowCenter", "v2f", &[0; 8]);
    attr("screenWindowWidth", "float", &1f32.to_le_bytes());
    if let Some(aspect) = aspect {
        attr("pixelAspectRatio", "float", &aspect.to_le_bytes());
    }
    attr("framesPerSecond", "rational", &[25, 0, 0, 0, 1, 0, 0, 0]);
    attr("gamma", "float", &1f32.to_le_bytes());
    attr("writer", "string", b"lavc");
    out.push(0);
    let start = out.len() + height * 8;
    let row = width * channels.len() * 4;
    for y in 0..height {
        out.extend_from_slice(&((start + y * (row + 8)) as u64).to_le_bytes());
    }
    for y in 0..height {
        out.extend_from_slice(&(y as u32).to_le_bytes());
        out.extend_from_slice(&(row as u32).to_le_bytes());
        for &(_, ch) in channels {
            for p in &pixels[y * width..(y + 1) * width] {
                out.extend_from_slice(&p[ch].to_le_bytes());
            }
        }
    }
    Ok(out)
}

pub(super) fn encode_raster(im: &Raster, limit: usize) -> Result<Vec<u8>, &'static str> {
    if im.pixels.len() > limit / 20 {
        return Err("EXR encoding exceeds memory budget");
    }
    let pixels = im
        .pixels
        .iter()
        .map(|p| {
            if im.gray {
                let v = f32::from(p[0]) * (1. / 255.);
                return [v, v, v, 1.];
            }
            let [r, g, b, a] = p.map(i32::from);
            let y = ((8414 * r + 16519 * g + 3208 * b + (32 << 14) + (1 << 8)) >> 9) * 4;
            let u = ((-4865 * r - 9528 * g + 14392 * b + (256 << 14) + (1 << 8)) >> 9) * 4;
            let v = ((14392 * r - 12061 * g - 2332 * b + (256 << 14) + (1 << 8)) >> 9) * 4;
            let rgb = rgb_from_yuv(y, u, v, true).map(|v| v as f32 * (1. / 65535.));
            let a = if im.alpha {
                ((a << 6 | a >> 2) * 4) as f32 * (1. / 65535.)
            } else {
                1.
            };
            [rgb[0] * a, rgb[1] * a, rgb[2] * a, a]
        })
        .collect::<Vec<_>>();
    encode(
        im.width,
        im.height,
        im.alpha,
        im.gray,
        &pixels,
        None,
        limit.saturating_sub(pixels.capacity() * 16),
    )
}

pub(super) fn render_float(
    bytes: &[u8],
    opts: super::y4m::Options<'_>,
    seek: super::InputTime,
    format: Option<&str>,
    mut emit: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let image = Image::read(bytes, opts.limit)?;
    let mut pixels = image.decode(opts.limit)?;
    for filter in opts.filters.iter().flat_map(|s| s.split(',')) {
        match filter.trim() {
            "null" => {}
            "hflip" => {
                for row in pixels.chunks_exact_mut(image.width) {
                    row.reverse();
                }
            }
            "vflip" => {
                for y in 0..image.height / 2 {
                    for x in 0..image.width {
                        pixels.swap(
                            y * image.width + x,
                            (image.height - 1 - y) * image.width + x,
                        );
                    }
                }
            }
            _ => return Err("EXR float filter is not supported".into()),
        }
    }
    let retained = pixels.capacity() * 16;
    if (format == Some("exr") || format.is_some_and(|s| s.contains("f32"))) && image.kind != 2 {
        for p in &mut pixels {
            let q = p.map(quantize);
            let rgb = if image.gray {
                [q[0]; 3]
            } else {
                converted_rgb(q, false, true)
            };
            *p = [
                rgb[0] as f32 * (1. / 65535.),
                rgb[1] as f32 * (1. / 65535.),
                rgb[2] as f32 * (1. / 65535.),
                q[3] as f32 * (1. / 65535.),
            ];
        }
    }
    let out = if format == Some("exr") {
        encode(
            image.width,
            image.height,
            image.alpha,
            image.gray,
            &pixels,
            image.aspect,
            opts.limit.saturating_sub(retained),
        )?
    } else {
        let fmt = format.unwrap_or(image.pixel_format());
        if fmt.starts_with("gray") != image.gray || image.gray && image.alpha {
            return Err("EXR raw conversion between color models is not supported".into());
        }
        if fmt.contains("f16") && image.kind != 1 {
            return Err("EXR raw half conversion requires half-float input".into());
        }
        let channels = match fmt {
            "gray16le" | "grayf16le" | "grayf32le" => &[0][..],
            "gbrpf16le" | "gbrpf32le" => &[1, 2, 0][..],
            "gbrapf16le" | "gbrapf32le" => &[1, 2, 0, 3][..],
            _ => return Err("Unsupported EXR raw pixel format".into()),
        };
        if fmt == "gray16le" {
            let size = pixels
                .len()
                .checked_mul(2)
                .filter(|&n| n <= opts.limit.saturating_sub(retained))
                .ok_or("EXR output exceeds memory budget")?;
            let mut out = Vec::with_capacity(size);
            for p in &pixels {
                out.extend_from_slice(&(quantize(p[0]) as u16).to_le_bytes());
            }
            out
        } else {
            let wide = fmt.contains("32");
            let size = pixels
                .len()
                .checked_mul(channels.len() * if wide { 4 } else { 2 })
                .filter(|&n| n <= opts.limit.saturating_sub(retained))
                .ok_or("EXR output exceeds memory budget")?;
            let mut out = Vec::with_capacity(size);
            for &ch in channels {
                for p in &pixels {
                    if wide {
                        out.extend_from_slice(&p[ch].to_le_bytes());
                    } else {
                        out.extend_from_slice(&to_half(p[ch]).to_le_bytes());
                    }
                }
            }
            out
        }
    };
    let visible =
        super::frame_output::still_sample(seek.start.unwrap_or(0.), seek.end().unwrap_or(0.04));
    let count = if visible {
        seek.loops
            .checked_add(1)
            .filter(|&n| n <= opts.limit / 16)
            .ok_or("EXR frame index exceeds memory budget")?
    } else {
        0
    };
    for _ in (0..count)
        .filter(|&i| {
            !opts.no_video
                && i as f64 / 25. >= opts.start
                && opts.end.is_none_or(|end| (i as f64 / 25.) < end)
        })
        .take(opts.frames.unwrap_or(u32::MAX) as usize)
    {
        emit(&out)?;
    }
    Ok(())
}

pub(super) fn report(
    bytes: &[u8],
    filename: &str,
    limit: usize,
    mut opts: super::media_probe::ProbeOptions<'_>,
) -> Result<String, &'static str> {
    use super::super::structured::JVal::{Number, Object, Str};
    let frames = [Image::read(bytes, limit)?];
    if opts.show.contains("frame") || opts.counts.0 {
        frames[0].decode(limit)?;
    }
    let first = &frames[0];
    let optional = !matches!(opts.writer, "json" | "xml");
    let counts = (
        opts.show.contains("frame") || opts.counts.0,
        opts.show.contains("packet") || opts.counts.1,
    );
    let enabled = super::media_probe::selected(opts.select, "video", 0, 0);
    if opts.show.contains("frame") && opts.show.contains("packet") {
        opts.show.remove("frame");
        opts.show.remove("packet");
        opts.show.insert("packet_frame");
    }
    super::media_probe::report(opts, |section| match section {
        "stream" if enabled => {
            let mut row = vec![
                ("index", Number(0., None)),
                ("codec_name", Str("exr".into())),
                ("codec_long_name", Str("OpenEXR image".into())),
            ];
            if optional {
                row.push(("profile", Str("unknown".into())));
            }
            row.extend([
                ("codec_type", Str("video".into())),
                ("codec_tag_string", Str("[0][0][0][0]".into())),
                ("codec_tag", Str("0x0000".into())),
                ("width", Number(first.width as f64, None)),
                ("height", Number(first.height as f64, None)),
                ("coded_width", Number(first.width as f64, None)),
                ("coded_height", Number(first.height as f64, None)),
                ("has_b_frames", Number(0., None)),
            ]);
            if first.aspect == Some(1.) {
                let (mut a, mut b) = (first.width, first.height);
                while b != 0 {
                    (a, b) = (b, a % b);
                }
                row.extend([
                    ("sample_aspect_ratio", Str("1:1".into())),
                    (
                        "display_aspect_ratio",
                        Str(format!("{}:{}", first.width / a, first.height / a)),
                    ),
                ]);
            } else if optional {
                row.extend([
                    ("sample_aspect_ratio", Str("N/A".into())),
                    ("display_aspect_ratio", Str("N/A".into())),
                ]);
            }
            row.extend([
                ("pix_fmt", Str(first.pixel_format().into())),
                ("level", Number(-99., None)),
            ]);
            for (k, v) in [
                ("color_range", "unknown"),
                ("color_space", "unknown"),
                ("color_transfer", "linear"),
                ("color_primaries", "unknown"),
                ("chroma_location", "unspecified"),
                ("field_order", "unknown"),
            ] {
                if optional || k == "color_transfer" || k == "alpha_mode" && first.alpha {
                    row.push((k, Str(v.into())));
                }
            }
            row.push(("refs", Number(1., None)));
            if optional {
                row.push(("id", Str("N/A".into())));
            }
            row.extend([
                ("r_frame_rate", Str("25/1".into())),
                ("avg_frame_rate", Str("25/1".into())),
                ("time_base", Str("1/25".into())),
            ]);
            if optional {
                for k in [
                    "start_pts",
                    "start_time",
                    "duration_ts",
                    "duration",
                    "bit_rate",
                    "max_bit_rate",
                    "bits_per_raw_sample",
                    "nb_frames",
                ] {
                    row.push((k, Str("N/A".into())));
                }
            }
            for (k, known) in [("nb_read_frames", counts.0), ("nb_read_packets", counts.1)] {
                if known {
                    row.push((k, Str(frames.len().to_string())));
                } else if optional {
                    row.push((k, Str("N/A".into())));
                }
            }
            let mut disposition = super::media_probe::disposition(false);
            disposition.extend(
                [
                    "non_diegetic",
                    "captions",
                    "descriptions",
                    "metadata",
                    "dependent",
                    "still_image",
                    "multilayer",
                ]
                .map(|k| (k.into(), Number(0., None))),
            );
            row.push(("disposition", Object(disposition)));
            Box::new(std::iter::once(row))
        }
        "format" => {
            let pipe = matches!(filename, "-" | "pipe:" | "pipe:0");
            let mut row = vec![
                ("filename", Str(filename.into())),
                ("nb_streams", Number(1., None)),
                ("nb_programs", Number(0., None)),
                ("nb_stream_groups", Number(0., None)),
                ("format_name", Str("exr_pipe".into())),
                ("format_long_name", Str("piped exr sequence".into())),
            ];
            if optional {
                row.extend([
                    ("start_time", Str("N/A".into())),
                    ("duration", Str("N/A".into())),
                ]);
            }
            if !pipe || filename == "-" {
                row.push((
                    "size",
                    Str(if pipe {
                        "0".into()
                    } else {
                        bytes.len().to_string()
                    }),
                ));
            } else if optional {
                row.push(("size", Str("N/A".into())));
            }
            if optional {
                row.push(("bit_rate", Str("N/A".into())));
            }
            row.push(("probe_score", Number(51., None)));
            Box::new(std::iter::once(row))
        }
        "packet" | "frame" | "packet_frame" if enabled => {
            let combined = section == "packet_frame";
            Box::new(frames.iter().enumerate().flat_map(move |(i, im)| {
                (0..if combined { 2 } else { 1 }).map(move |part| {
                    let frame = section == "frame" || combined && part == 1;
                    let time = format!("{:.6}", i as f64 / 25.);
                    let mut row = if frame {
                        vec![
                            ("media_type", Str("video".into())),
                            ("stream_index", Number(0., None)),
                            ("key_frame", Number(1., None)),
                        ]
                    } else {
                        vec![
                            ("codec_type", Str("video".into())),
                            ("stream_index", Number(0., None)),
                        ]
                    };
                    for k in if frame {
                        &[
                            "pts",
                            "pts_time",
                            "pkt_dts",
                            "pkt_dts_time",
                            "best_effort_timestamp",
                            "best_effort_timestamp_time",
                        ][..]
                    } else {
                        &["pts", "pts_time", "dts", "dts_time"][..]
                    } {
                        row.push((
                            k,
                            if k.ends_with("time") {
                                Str(time.clone())
                            } else {
                                Number(i as f64, None)
                            },
                        ));
                    }
                    row.extend([
                        ("duration", Number(1., None)),
                        ("duration_time", Str("0.040000".into())),
                    ]);
                    let pos = im.data.as_ptr() as usize - bytes.as_ptr() as usize;
                    if frame {
                        row.extend([
                            ("pkt_pos", Str(pos.to_string())),
                            ("pkt_size", Str(im.data.len().to_string())),
                            ("width", Number(im.width as f64, None)),
                            ("height", Number(im.height as f64, None)),
                        ]);
                        for k in ["crop_top", "crop_bottom", "crop_left", "crop_right"] {
                            row.push((k, Number(0., None)));
                        }
                        row.push(("pix_fmt", Str(im.pixel_format().into())));
                        if im.aspect == Some(1.) || optional {
                            row.push((
                                "sample_aspect_ratio",
                                Str(if im.aspect == Some(1.) { "1:1" } else { "N/A" }.into()),
                            ));
                        }
                        row.push(("pict_type", Str("I".into())));
                        for k in [
                            "interlaced_frame",
                            "top_field_first",
                            "lossless",
                            "repeat_pict",
                        ] {
                            row.push((k, Number(0., None)));
                        }
                        for (k, v) in [
                            ("color_range", "unknown"),
                            ("color_space", "unknown"),
                            ("color_primaries", "unknown"),
                            ("color_transfer", "linear"),
                            ("chroma_location", "unspecified"),
                            (
                                "alpha_mode",
                                if im.alpha {
                                    "premultiplied"
                                } else {
                                    "unspecified"
                                },
                            ),
                        ] {
                            if optional || k == "color_transfer" || k == "alpha_mode" && im.alpha {
                                row.push((k, Str(v.into())));
                            }
                        }
                        if !im.tags.is_empty() {
                            row.push((
                                "tags",
                                Object(
                                    im.tags
                                        .iter()
                                        .map(|(k, v)| (k.to_string(), Str(v.to_string())))
                                        .collect(),
                                ),
                            ));
                        }
                    } else {
                        row.extend([
                            ("size", Str(im.data.len().to_string())),
                            ("pos", Str(pos.to_string())),
                            ("flags", Str("K__".into())),
                        ]);
                    }
                    if i > 0 {
                        row.retain_mut(|(key, value)| {
                            if !matches!(*key, "pos" | "pkt_pos") {
                                return true;
                            }
                            *value = Str("N/A".into());
                            optional
                        });
                    }
                    if combined {
                        row.insert(
                            0,
                            ("type", Str(if frame { "frame" } else { "packet" }.into())),
                        );
                    }
                    row
                })
            }))
        }
        _ => Box::new(std::iter::empty()),
    })
}
