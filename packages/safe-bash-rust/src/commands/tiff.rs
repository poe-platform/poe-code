use super::png_pixels::Raster;

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
            || get(259, 1) != 1
            || field(324).is_some()
        {
            return Err("unsupported TIFF encoding");
        }
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
            white_zero: get(262, 2) == 0,
            predictor: get(317, 1) == 2,
            offsets: field(273),
            counts: field(279),
        })
    }

    pub fn decode(&self) -> Raster {
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
        let mut raw = offsets.values(self.little).flat_map(|off| {
            let strip = self.bytes.get(off..).unwrap_or_default();
            let n = counts.next().unwrap_or(strip.len()).min(strip.len());
            strip[..n].iter().copied()
        });
        let mut pixels = Vec::with_capacity(self.width * self.height);
        for _ in 0..self.height {
            let mut prev = [0u16; 4];
            for _ in 0..self.width {
                let mut pixel = [0, 0, 0, 255];
                for c in 0..self.samples {
                    let first = raw.next().unwrap_or(0);
                    let value = if self.depth == 16 {
                        let b = [first, raw.next().unwrap_or(0)];
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
                pixels.push(pixel);
            }
        }
        Raster {
            width: self.width,
            height: self.height,
            pixels,
            density: self.density,
            orientation: self.orientation,
            alpha: matches!(self.samples, 2 | 4),
            gray: self.samples == 1 || self.samples == 2 && self.depth == 8,
        }
    }
}
