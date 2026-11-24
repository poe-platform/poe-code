use super::png_pixels::Raster;

pub(super) struct Image<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
    kind: u8,
    maximum: u32,
    raster: &'a [u8],
}

fn space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\r' | b'\n')
}

fn header_number(bytes: &[u8], at: &mut usize) -> Result<u32, &'static str> {
    loop {
        while bytes.get(*at).is_some_and(|&c| space(c)) {
            *at += 1;
        }
        if bytes.get(*at) != Some(&b'#') {
            break;
        }
        while bytes.get(*at).is_some_and(|&c| c != b'\n') {
            *at += 1;
        }
    }
    let start = *at;
    let mut n = 0u32;
    while let Some(c) = bytes.get(*at).filter(|c| c.is_ascii_digit()) {
        n = n
            .checked_mul(10)
            .and_then(|n| n.checked_add(u32::from(c - b'0')))
            .ok_or("Invalid PNM header")?;
        *at += 1;
    }
    if *at == start || !bytes.get(*at).is_some_and(|&c| space(c)) {
        return Err("Invalid PNM header");
    }
    // FFmpeg consumes one separator byte, including when it is CR in CRLF.
    *at += 1;
    Ok(n)
}

fn ascii_sample(bytes: &[u8], at: &mut usize, bitmap: bool) -> Result<u32, &'static str> {
    while bytes.get(*at).is_some_and(|c| !c.is_ascii_digit()) {
        *at += 1;
    }
    let start = *at;
    let mut value = 0u32;
    while let Some(c) = bytes.get(*at).filter(|c| c.is_ascii_digit()) {
        value = value
            .checked_mul(10)
            .and_then(|v| v.checked_add(u32::from(c - b'0')))
            .ok_or("Invalid PNM sample")?;
        *at += 1;
        if bitmap {
            return Ok(value & 1);
        }
    }
    if *at == start {
        return Err("Truncated PNM raster");
    }
    if *at < bytes.len() {
        *at += 1;
    }
    Ok(value)
}

impl<'a> Image<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if !super::netpbm::signature(bytes) {
            return Err("Invalid PNM header");
        }
        let kind = bytes[1];
        let mut at = 3;
        let width = header_number(bytes, &mut at)? as usize;
        let height = header_number(bytes, &mut at)? as usize;
        let maximum = if matches!(kind, b'1' | b'4') {
            1
        } else {
            header_number(bytes, &mut at)?
        };
        let pixels = width
            .checked_mul(height)
            .filter(|&n| n > 0 && n <= limit / 4)
            .ok_or("image exceeds memory budget")?;
        if maximum == 0 || maximum > 65535 {
            return Err("Invalid PNM maximum sample value");
        }
        let start = at;
        let channels = if matches!(kind, b'3' | b'6') { 3 } else { 1 };
        if kind <= b'3' {
            for _ in 0..pixels * channels {
                if ascii_sample(bytes, &mut at, kind == b'1')? > maximum {
                    return Err("PNM sample exceeds maximum");
                }
            }
            // ASCII packets end at the next image signature, with comments
            // and trailing whitespace retained for stream copying.
            while let Some(&c) = bytes.get(at) {
                if c == b'#' {
                    while bytes.get(at).is_some_and(|&c| c != b'\n') {
                        at += 1;
                    }
                } else if c == b'P' {
                    break;
                } else {
                    at += 1;
                }
            }
        } else {
            let length = if kind == b'4' {
                width.div_ceil(8) * height
            } else {
                pixels
                    .checked_mul(channels * if maximum > 255 { 2 } else { 1 })
                    .ok_or("image exceeds memory budget")?
            };
            at = at
                .checked_add(length)
                .filter(|&n| n <= bytes.len())
                .ok_or("Truncated PNM raster")?;
        }
        Ok(Self {
            data: &bytes[..at],
            width,
            height,
            kind,
            maximum,
            raster: &bytes[start..at],
        })
    }

    pub fn codec(&self) -> &'static [u8; 4] {
        match self.kind {
            b'1' | b'4' => b"pbm ",
            b'2' | b'5' => b"pgm ",
            _ => b"ppm ",
        }
    }

    pub fn wide(&self) -> bool {
        self.maximum > 255
    }

    fn samples(&self) -> impl Iterator<Item = u16> + '_ {
        let mut at = 0;
        let wide = self.wide();
        let channels = if matches!(self.kind, b'3' | b'6') {
            3
        } else {
            1
        };
        (0..self.width * self.height * channels).map(move |i| {
            if self.kind == b'4' {
                let x = i % self.width;
                let bit =
                    self.raster[i / self.width * self.width.div_ceil(8) + x / 8] & (128 >> (x % 8));
                return if bit == 0 { 255 } else { 0 };
            }
            let value = if self.kind <= b'3' {
                let v = ascii_sample(self.raster, &mut at, self.kind == b'1').unwrap();
                if self.kind == b'1' {
                    return if v == 0 { 255 } else { 0 };
                }
                ((if wide { 65535 } else { 255 }) * v + self.maximum / 2) / self.maximum
            } else {
                let v = if wide {
                    let v = u16::from_be_bytes(self.raster[at..at + 2].try_into().unwrap());
                    at += 2;
                    u32::from(v)
                } else {
                    let v = u32::from(self.raster[at]);
                    at += 1;
                    v
                };
                if wide {
                    let factor = (65535 * 32768u32 + self.maximum / 2) / self.maximum;
                    (v.wrapping_mul(factor).wrapping_add(16384) >> 15) & 65535
                } else {
                    let factor = (255 * 128 + self.maximum / 2) / self.maximum;
                    ((v * factor + 64) >> 7) & 255
                }
            };
            value as u16
        })
    }

    pub fn decode(&self) -> Raster {
        let mut samples = self.samples();
        let mut sample = || {
            let value = u32::from(samples.next().unwrap());
            if self.wide() {
                ((value + 128) >> 8).min(255) as u8
            } else {
                value as u8
            }
        };
        let gray = !matches!(self.kind, b'3' | b'6');
        let pixels = (0..self.width * self.height)
            .map(|_| {
                if !gray {
                    [sample(), sample(), sample(), 255]
                } else {
                    let v = sample();
                    [v, v, v, 255]
                }
            })
            .collect();
        Raster {
            width: self.width,
            height: self.height,
            pixels,
            alpha: false,
            gray,
            density: 72,
            orientation: None,
        }
    }
}

pub(super) fn images(mut bytes: &[u8], limit: usize) -> Result<Vec<Image<'_>>, &'static str> {
    let mut out = Vec::new();
    while !bytes.is_empty() {
        if !out.is_empty() && !bytes.starts_with(b"P") {
            break;
        }
        let remaining = limit
            .checked_sub((out.len() + 1) * size_of::<Image>())
            .ok_or("PNM frame index exceeds memory budget")?;
        let im = Image::read(bytes, remaining)?;
        bytes = &bytes[im.data.len()..];
        out.try_reserve_exact(1)
            .map_err(|_| "PNM frame index exceeds memory budget")?;
        out.push(im);
    }
    if out.is_empty() {
        return Err("PNM input has no frames");
    }
    Ok(out)
}

pub(super) fn render(
    bytes: &[u8],
    opts: super::y4m::Options<'_>,
    seek: super::InputTime,
    emit: impl FnMut(super::y4m::Frame, super::y4m::TimedFrame) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let frames = images(bytes, opts.limit)?;
    let (w, h) = (frames[0].width, frames[0].height);
    let start = (seek.start.unwrap_or(0.).max(0.) * 25.).round() as usize;
    let end = seek
        .end()
        .map_or(frames.len(), |s| (s.max(0.) * 25.).round() as usize)
        .min(frames.len());
    let length = if start == 0 { end } else { 0 };
    let count = length
        .checked_mul(seek.loops.saturating_add(1))
        .filter(|&n| n <= opts.limit / size_of::<Image>())
        .ok_or("PNM frame index exceeds memory budget")?;
    super::y4m::render_frames(
        w,
        h,
        (25., None),
        (0..count).map(|i| (i as f64 / 25., 0.04)),
        opts,
        |i| Ok(frames[i % length].decode()),
        emit,
    )?;
    Ok((w, h, 25))
}

pub(super) fn encode(im: &Raster, bitmap: bool, limit: usize) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (im.width, im.height);
    let length = if bitmap { w.div_ceil(8) * h } else { w * h };
    let mut out = if bitmap {
        format!("P4\n{w} {h}\n")
    } else {
        format!("P5\n{w} {h}\n255\n")
    }
    .into_bytes();
    if length > limit.saturating_sub(out.len()) {
        return Err("output byte limit exceeded");
    }
    let start = out.len();
    out.resize(start + length, 0);
    const DITHER: [[i32; 8]; 8] = [
        [117, 62, 158, 103, 113, 58, 155, 100],
        [34, 199, 21, 186, 31, 196, 17, 182],
        [144, 89, 131, 76, 141, 86, 127, 72],
        [0, 165, 41, 206, 10, 175, 52, 217],
        [110, 55, 151, 96, 120, 65, 162, 107],
        [28, 193, 14, 179, 38, 203, 24, 189],
        [138, 83, 124, 69, 148, 93, 134, 79],
        [7, 172, 48, 213, 3, 168, 45, 210],
    ];
    for (i, p) in im.pixels.iter().enumerate() {
        let [r, g, b, _] = p.map(i32::from);
        let limited = (8414 * r + 16519 * g + 3208 * b + (16 << 15) + 256) >> 9;
        if bitmap {
            let (x, y) = (i % w, i / w);
            let luma = if im.gray { r } else { (limited + 32) >> 6 };
            if luma + DITHER[y % 8][x % 8] < 234 {
                out[start + y * w.div_ceil(8) + x / 8] |= 128 >> (x % 8);
            }
        } else {
            let full = (limited * 2 * 19078 - 39084288) >> 14;
            out[start + i] = if im.gray {
                p[0]
            } else {
                ((full + 64) >> 7).clamp(0, 255) as u8
            };
        }
    }
    Ok(out)
}

// Preserve grayscale sample precision without routing it through the RGBA8 renderer.
pub(super) fn render_gray(
    bytes: &[u8],
    opts: super::y4m::Options<'_>,
    seek: super::InputTime,
    (pgm, wide, little): (bool, bool, bool),
    mut emit: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let images = images(bytes, opts.limit)?;
    let (mut horizontal, mut vertical) = (false, false);
    for filter in opts.filters.iter().flat_map(|s| s.split(',')) {
        match filter.trim() {
            "null" => {}
            "hflip" => horizontal = !horizontal,
            "vflip" => vertical = !vertical,
            _ => return Err("PNM high-depth filter is not supported".into()),
        }
    }
    let start = (seek.start.unwrap_or(0.).max(0.) * 25.).round() as usize;
    let length = if start == 0 {
        seek.end()
            .map_or(images.len(), |s| (s.max(0.) * 25.).round() as usize)
            .min(images.len())
    } else {
        0
    };
    let count = length
        .checked_mul(seek.loops.saturating_add(1))
        .filter(|&n| n <= opts.limit / size_of::<Image>())
        .ok_or("PNM frame index exceeds memory budget")?;
    const DITHER: [[u32; 8]; 8] = [
        [36, 68, 60, 92, 34, 66, 58, 90],
        [100, 4, 124, 28, 98, 2, 122, 26],
        [52, 84, 44, 76, 50, 82, 42, 74],
        [116, 20, 108, 12, 114, 18, 106, 10],
        [32, 64, 56, 88, 38, 70, 62, 94],
        [96, 0, 120, 24, 102, 6, 126, 30],
        [48, 80, 40, 72, 54, 86, 46, 78],
        [112, 16, 104, 8, 118, 22, 110, 14],
    ];
    for i in (0..count)
        .filter(|&i| {
            !opts.no_video
                && i as f64 / 25. >= opts.start
                && opts.end.is_none_or(|end| (i as f64 / 25.) < end)
        })
        .take(opts.frames.unwrap_or(u32::MAX) as usize)
    {
        let im = &images[i % length];
        if im.codec() == b"ppm " {
            return Err("PNM high-depth grayscale conversion requires grayscale input".into());
        }
        let (w, h) = (im.width, im.height);
        let mut out = if pgm {
            format!("P5\n{w} {h}\n{}\n", if wide { 65535 } else { 255 }).into_bytes()
        } else {
            Vec::new()
        };
        let length = w * h * if wide { 2 } else { 1 };
        if length
            .saturating_add(w * h * 2)
            .saturating_add(images.capacity() * size_of::<Image>())
            > opts.limit.saturating_sub(out.len())
        {
            return Err("image exceeds memory budget".into());
        }
        let samples = im.samples().collect::<Vec<_>>();
        out.reserve_exact(length);
        for y in 0..h {
            for x in 0..w {
                let v = u32::from(
                    samples[(if vertical { h - 1 - y } else { y }) * w
                        + if horizontal { w - 1 - x } else { x }],
                );
                if wide {
                    let v = if im.wide() {
                        v as u16
                    } else {
                        (v * 257) as u16
                    };
                    out.extend_from_slice(&if little {
                        v.to_le_bytes()
                    } else {
                        v.to_be_bytes()
                    });
                } else {
                    let v = if im.wide() {
                        (v - (v >> 8) + DITHER[y & 7][x & 7]) >> 8
                    } else {
                        v
                    };
                    out.push(v.min(255) as u8);
                }
            }
        }
        emit(&out)?;
    }
    Ok(())
}
