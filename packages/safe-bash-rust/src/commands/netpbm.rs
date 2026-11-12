use super::png_pixels::Raster;

pub(super) fn signature(b: &[u8]) -> bool {
    b.len() >= 7
        && b[0] == b'P'
        && matches!(b[1], b'1'..=b'6')
        && matches!(b[2], b' ' | b'\t' | b'\r' | b'\n')
}

pub(super) struct Netpbm<'a> {
    magic: u8,
    pub width: usize,
    pub height: usize,
    max: f64,
    data: &'a [u8],
}

fn number(b: &mut &[u8], header: bool) -> Option<f64> {
    while let Some((&c, rest)) = b.split_first() {
        if c == b'#' {
            *b = &rest[rest
                .iter()
                .position(|&v| v == b'\n' || header && v == b'\r')
                .unwrap_or(rest.len())..];
        } else if matches!(c, b' ' | b'\t' | b'\r' | b'\n') || !header && c <= b' ' {
            *b = rest;
        } else {
            break;
        }
    }
    let mut n = None;
    while let Some((&c, rest)) = b.split_first() {
        if !c.is_ascii_digit() {
            break;
        }
        n = Some(n.unwrap_or(0.) * 10. + f64::from(c - b'0'));
        *b = rest;
    }
    n
}

impl<'a> Netpbm<'a> {
    pub fn parse(b: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        let magic = b[1];
        let mut data = &b[2..];
        let w = number(&mut data, true).unwrap_or(0.) as usize;
        let h = number(&mut data, true).unwrap_or(0.) as usize;
        let max = if matches!(magic, b'1' | b'4') {
            1.
        } else {
            number(&mut data, true).unwrap_or(255.)
        };
        if w.saturating_mul(h) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        if w == 0 || h == 0 {
            return Err("invalid image dimensions");
        }
        // Consume a trailing header comment without skipping whitespace-valued binary pixels.
        let look = data
            .iter()
            .position(|c| !matches!(c, b' ' | b'\t'))
            .unwrap_or(data.len());
        let end = &data[look..];
        if end.starts_with(b"#") {
            data = &end[end
                .iter()
                .position(|c| matches!(c, b'\r' | b'\n'))
                .unwrap_or(end.len())..];
        }
        if data.starts_with(b"\r\n") {
            data = &data[2..];
        } else if matches!(data.first(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            data = &data[1..];
        }
        if magic == b'6' && data.len() < w.saturating_mul(h).saturating_mul(if max > 255. { 6 } else { 3 }) {
            return Err("Truncated PPM raster");
        }
        Ok(Self {
            magic,
            width: w,
            height: h,
            max,
            data,
        })
    }

    pub fn bit_depth(&self) -> u8 {
        if matches!(self.magic, b'1' | b'4') {
            1
        } else if self.max > 255. {
            16
        } else {
            8
        }
    }

    pub fn codec(&self) -> &'static [u8; 4] {
        match self.magic {
            b'1' | b'4' => b"pbm ",
            b'2' | b'5' => b"pgm ",
            _ => b"ppm ",
        }
    }

    pub fn decode(self) -> Raster {
        let mut data = self.data;
        let mut sample = || {
            let n = if self.magic <= b'3' {
                number(&mut data, false).unwrap_or(0.)
            } else {
                let mut byte = || {
                    data.split_first().map_or(0, |(&c, r)| {
                        data = r;
                        u16::from(c)
                    })
                };
                f64::from(if self.max > 255. {
                    (byte() << 8) | byte()
                } else {
                    byte()
                })
            };
            if self.magic == b'1' {
                if n == 1. { 0 } else { 255 }
            } else if self.max == 255. && n <= 255. {
                n as u8
            } else {
                ((n * 255. / self.max).round() % 256.) as u8
            }
        };
        let pixels = (0..self.width * self.height)
            .map(|i| match self.magic {
                b'4' => {
                    let x = i % self.width;
                    let byte = self
                        .data
                        .get(i / self.width * self.width.div_ceil(8) + x / 8)
                        .copied()
                        .unwrap_or(0);
                    let v = if byte & (0x80 >> (x % 8)) != 0 {
                        0
                    } else {
                        255
                    };
                    [v, v, v, 255]
                }
                b'3' | b'6' => [sample(), sample(), sample(), 255],
                _ => {
                    let v = sample();
                    [v, v, v, 255]
                }
            })
            .collect();
        Raster {
            width: self.width,
            height: self.height,
            alpha: false,
            gray: !matches!(self.magic, b'3' | b'6'),
            density: 72,
            orientation: None,
            pixels,
        }
    }
}
