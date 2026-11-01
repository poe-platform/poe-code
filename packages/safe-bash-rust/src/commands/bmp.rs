use super::png_pixels::Raster;

pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.len() >= 26 && bytes.starts_with(b"BM") && bytes.get(6..15) != Some(b"\n__IMG__:")
}

pub(super) struct Bmp<'a> {
    bytes: &'a [u8],
    pub width: usize,
    pub height: usize,
    top_down: bool,
    pub bpp: usize,
    offset: u64,
    dib: u32,
    pub density: u32,
}

impl<'a> Bmp<'a> {
    pub fn parse(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if bytes.len() < 42 {
            return Err("Offset is outside the bounds of the DataView");
        }
        let word = |i: usize| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        let width = (word(18) as i32).unsigned_abs() as usize;
        let raw_height = word(22) as i32;
        let height = raw_height.unsigned_abs() as usize;
        if width.saturating_mul(height) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        if width == 0 || height == 0 {
            return Err("invalid image dimensions");
        }
        let ppm = word(38) as i32;
        Ok(Self {
            bytes,
            width,
            height,
            top_down: raw_height < 0,
            bpp: u16::from_le_bytes(bytes[28..30].try_into().unwrap()).into(),
            offset: word(10).into(),
            dib: word(14),
            density: if ppm > 0 {
                (f64::from(ppm) * 0.0254).round().max(1.) as u32
            } else {
                72
            },
        })
    }

    pub fn decode(self) -> Raster {
        // Offsets in a malformed BMP can exceed the Wasm address space.
        let at = |i: u64| {
            usize::try_from(i)
                .ok()
                .and_then(|i| self.bytes.get(i))
                .copied()
        };
        let stride = (self.width as u64 * self.bpp as u64).div_ceil(32) * 4;
        let mut pixels = Vec::with_capacity(self.width * self.height);
        for y in 0..self.height {
            let row = self.offset
                + stride
                    * (if self.top_down {
                        y
                    } else {
                        self.height - 1 - y
                    }) as u64;
            for x in 0..self.width as u64 {
                let pos = if self.bpp <= 8 {
                    let idx = match self.bpp {
                        8 => at(row + x).unwrap_or(0),
                        4 => (at(row + x / 2).unwrap_or(0) >> (4 * (1 - x % 2))) & 15,
                        1 => (at(row + x / 8).unwrap_or(0) >> (7 - x % 8)) & 1,
                        _ => 0,
                    };
                    14 + u64::from(self.dib) + u64::from(idx) * if self.dib == 12 { 3 } else { 4 }
                } else {
                    row + x * (self.bpp / 8) as u64
                };
                let alpha = if self.bpp / 8 == 4 {
                    at(pos + 3).unwrap_or(255)
                } else {
                    255
                };
                pixels.push([
                    at(pos + 2).unwrap_or(0),
                    at(pos + 1).unwrap_or(0),
                    at(pos).unwrap_or(0),
                    alpha,
                ]);
            }
        }
        Raster {
            width: self.width,
            height: self.height,
            pixels,
            density: self.density,
            alpha: self.bpp == 32,
            gray: false,
        }
    }
}
