use super::{
    image_header,
    jpeg::{ZIGZAG, cosines},
    png_pixels::Raster,
};

pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\xff\xd8\xff") && bytes.get(20..29) != Some(b"\n__IMG__:")
}

type Result<T> = std::result::Result<T, &'static str>;

fn take<'a>(data: &mut &'a [u8], n: usize) -> Result<&'a [u8]> {
    let (head, rest) = data.split_at_checked(n).ok_or("Truncated JPEG segment")?;
    *data = rest;
    Ok(head)
}
fn byte(data: &mut &[u8]) -> Result<u8> {
    Ok(take(data, 1)?[0])
}
fn word(data: &mut &[u8]) -> Result<usize> {
    Ok(usize::from(u16::from_be_bytes(
        take(data, 2)?.try_into().unwrap(),
    )))
}

#[derive(Default)]
struct Huffman<'a> {
    counts: &'a [u8],
    values: &'a [u8],
}
struct Bits<'a> {
    data: &'a [u8],
    current: u8,
    left: u8,
    eob: usize,
}
impl Bits<'_> {
    fn bit(&mut self) -> Result<i32> {
        if self.left == 0 {
            self.current = byte(&mut self.data).map_err(|_| "Truncated JPEG entropy data")?;
            if self.current == 255
                && byte(&mut self.data).map_err(|_| "Truncated JPEG entropy escape")? != 0
            {
                return Err("Unexpected JPEG marker in entropy data");
            }
            self.left = 8;
        }
        self.left -= 1;
        Ok(i32::from(self.current >> self.left & 1))
    }
    fn bits(&mut self, n: u8) -> Result<i32> {
        if n > 16 {
            return Err("Invalid JPEG coefficient size");
        }
        let mut v = 0;
        for _ in 0..n {
            v = 2 * v + self.bit()?;
        }
        Ok(v)
    }
    fn signed(&mut self, n: u8) -> Result<i32> {
        let v = self.bits(n)?;
        Ok(if n > 0 && v < (1 << (n - 1)) {
            v + 1 - (1 << n)
        } else {
            v
        })
    }
    fn symbol(&mut self, h: &Huffman) -> Result<u8> {
        let (mut index, mut code) = (0usize, 0usize);
        for &count in h.counts {
            code = 2 * code + self.bit()? as usize;
            if code < usize::from(count) {
                return h
                    .values
                    .get(index + code)
                    .copied()
                    .ok_or("Invalid JPEG Huffman code");
            }
            index += usize::from(count);
            code -= usize::from(count);
        }
        Err("Invalid JPEG Huffman code")
    }
    fn block(
        &mut self,
        dc: &Huffman,
        ac: &Huffman,
        pred: &mut i32,
        block: &mut [i32; 64],
        band: [u8; 3],
        progressive: bool,
    ) -> Result<()> {
        let [lo, hi, approx] = band;
        let shift = approx & 15;
        let step = 1 << shift;
        if lo == 0 {
            if approx >> 4 == 0 {
                let n = self.symbol(dc)?;
                *pred = pred.wrapping_add(self.signed(n)?);
                block[0] = pred.wrapping_shl(shift.into());
            } else if self.bit()? != 0 {
                block[0] |= step;
            }
            if progressive {
                return Ok(());
            }
        }
        let (mut k, end) = (usize::from(lo.max(1)), usize::from(hi));
        let refine = |bits: &mut Self, v: &mut i32| -> Result<()> {
            if bits.bit()? != 0 && *v & step == 0 {
                *v += if *v > 0 { step } else { -step };
            }
            Ok(())
        };
        if self.eob == 0 {
            while k <= end {
                let rs = self.symbol(ac)?;
                let (mut run, n) = (rs >> 4, rs & 15);
                if n == 0 && run != 15 {
                    if progressive {
                        self.eob = (1 << run) + self.bits(run)? as usize;
                    }
                    break;
                }
                if approx >> 4 == 0 {
                    k += usize::from(run);
                    if n != 0 && k <= end {
                        block[k] = self.signed(n)? << shift;
                    }
                } else {
                    let new = match n {
                        0 => 0,
                        1 => {
                            if self.bit()? == 0 {
                                -step
                            } else {
                                step
                            }
                        }
                        _ => return Err("Invalid JPEG refinement coefficient size"),
                    };
                    while k <= end {
                        if block[k] != 0 {
                            refine(self, &mut block[k])?;
                        } else if run == 0 {
                            break;
                        } else {
                            run -= 1;
                        }
                        k += 1;
                    }
                    if k > end {
                        return Err("JPEG refinement run exceeds spectral band");
                    }
                    if new != 0 {
                        block[k] = new;
                    }
                }
                k += 1;
            }
        }
        if self.eob > 0 {
            if approx >> 4 != 0 {
                for v in &mut block[k.min(end + 1)..=end] {
                    if *v != 0 {
                        refine(self, v)?;
                    }
                }
            }
            self.eob -= 1;
        }
        Ok(())
    }
}

fn idct(block: &[i32; 64], quant: &[u16; 64], cos: &[[f64; 8]; 8]) -> [u8; 64] {
    if block[1..].iter().all(|&v| v == 0) {
        return [(f64::from(block[0]) * f64::from(quant[0]) * 0.125 + 128.).round() as u8; 64];
    }
    let mut freq = [0.; 64];
    for i in 0..64 {
        freq[ZIGZAG[i]] = f64::from(block[i]) * f64::from(quant[i]);
    }
    let mut temp = [[0.; 8]; 8];
    for (row, d) in temp.iter_mut().zip(freq.chunks_exact(8)) {
        for (x, v) in row.iter_mut().enumerate() {
            *v = 0.5 * (0..8).map(|u| d[u] * cos[u][x]).sum::<f64>();
        }
    }
    std::array::from_fn(|i| {
        (0.5 * (0..8).map(|u| temp[u][i % 8] * cos[u][i / 8]).sum::<f64>() + 128.).round() as u8
    })
}
struct Plane {
    id: u8,
    h: usize,
    v: usize,
    q: usize,
    cols: usize,
    pred: i32,
    samples: Vec<[u8; 64]>,
    coeff: Vec<[i32; 64]>,
}
impl Plane {
    fn at(&self, x: usize, y: usize) -> i32 {
        i32::from(self.samples[y / 8 * self.cols + x / 8][y % 8 * 8 + x % 8])
    }

    fn interpolated(
        &self,
        x: usize,
        y: usize,
        frame: (usize, usize),
        sampling: (usize, usize),
    ) -> f64 {
        if (self.h, self.v) == sampling {
            return f64::from(self.at(x, y));
        }
        let axis = |p: usize, size: usize, factor: usize, max: usize| {
            let last = (size * factor).div_ceil(max) - 1;
            let raw = (p as f64 + 0.5) * factor as f64 / max as f64 - 0.5;
            let floor = raw.floor();
            (
                (floor as usize).min(last),
                ((floor + 1.) as usize).min(last),
                raw - floor,
            )
        };
        let (x0, x1, fx) = axis(x, frame.0, self.h, sampling.0);
        let (y0, y1, fy) = axis(y, frame.1, self.v, sampling.1);
        let row = |y| {
            let a = f64::from(self.at(x0, y));
            a + (f64::from(self.at(x1, y)) - a) * fx
        };
        let a = row(y0);
        a + (row(y1) - a) * fy
    }
}

pub(super) fn samples(
    bytes: &[u8],
    limit: usize,
    color_transform: Option<bool>,
) -> Result<(image_header::Jpeg, Vec<[u8; 4]>)> {
    if !bytes.starts_with(b"\xff\xd8") {
        return Err("Invalid JPEG signature");
    }
    let header = image_header::jpeg(bytes)?;
    let (w, h) = (header.width as usize, header.height as usize);
    if w.saturating_mul(h) > limit / 4 {
        return Err("image exceeds memory budget");
    }
    let mut data = &bytes[2..];
    let mut tables: [Huffman; 8] = std::array::from_fn(|_| Huffman::default());
    let mut adobe = None;
    let mut jfif = false;
    let mut quant = [None; 4];
    let mut planes = Vec::new();
    let (mut max_h, mut max_v, mut cols, mut rows) = (1, 1, 0, 0);
    let (mut progressive, mut strip, mut restart) = (false, false, 0);
    let cos = cosines();
    while !data.is_empty() {
        if byte(&mut data)? != 255 {
            continue;
        }
        let mut marker = byte(&mut data)?;
        while marker == 255 {
            marker = byte(&mut data)?;
        }
        if marker == 0xd9 {
            break;
        }
        if matches!(marker, 0 | 1 | 0xd0..=0xd8) {
            continue;
        }
        let length = word(&mut data)?
            .checked_sub(2)
            .ok_or("Invalid JPEG segment length")?;
        let mut payload = take(&mut data, length)?;
        match marker {
            0xe0 if payload.starts_with(b"JFIF\0") => jfif = true,
            0xee if payload.starts_with(b"Adobe") && payload.len() >= 12 => {
                adobe = Some(payload[11] != 0)
            }
            0xdb => {
                while !payload.is_empty() {
                    let spec = byte(&mut payload)?;
                    let mut q = [0; 64];
                    for v in &mut q {
                        *v = if spec >> 4 == 0 {
                            u16::from(byte(&mut payload)?)
                        } else {
                            word(&mut payload)? as u16
                        };
                    }
                    *quant
                        .get_mut(usize::from(spec & 15))
                        .ok_or("Invalid JPEG quantization table")? = Some(q);
                }
            }
            0xc4 => {
                while !payload.is_empty() {
                    let spec = byte(&mut payload)?;
                    let counts = take(&mut payload, 16)?;
                    let values = take(&mut payload, counts.iter().map(|&v| usize::from(v)).sum())?;
                    if spec >> 4 > 1 || spec & 15 > 3 {
                        return Err("Invalid JPEG Huffman table");
                    }
                    tables[usize::from((spec >> 4) * 4 + (spec & 15))] = Huffman { counts, values };
                }
            }
            0xdd => restart = word(&mut payload)?,
            0xc0..=0xc2 => {
                if !planes.is_empty() {
                    return Err("Multiple JPEG frames");
                }
                let header = take(&mut payload, 6)?;
                if header[0] != 8 || !matches!(header[5], 1 | 3 | 4) {
                    return Err("Unsupported JPEG frame");
                }
                progressive = marker == 0xc2;
                strip = !progressive && w * h > 512 * 512;
                let specs = take(&mut payload, usize::from(header[5]) * 3)?;
                max_h = specs
                    .chunks_exact(3)
                    .map(|c| usize::from(c[1] >> 4))
                    .max()
                    .unwrap();
                max_v = specs
                    .chunks_exact(3)
                    .map(|c| usize::from(c[1] & 15))
                    .max()
                    .unwrap();
                if max_h == 0 || max_v == 0 {
                    return Err("Invalid JPEG sampling factors");
                }
                cols = w.div_ceil(max_h * 8);
                rows = h.div_ceil(max_v * 8);
                let mut work = 0usize;
                for c in specs.chunks_exact(3) {
                    let (h, v) = (usize::from(c[1] >> 4), usize::from(c[1] & 15));
                    if h == 0 || v == 0 {
                        return Err("Invalid JPEG sampling factors");
                    }
                    let count = cols * rows * h * v;
                    work = work.saturating_add(count.saturating_mul(if progressive {
                        320
                    } else {
                        64
                    }));
                    if work > limit {
                        return Err("image exceeds memory budget");
                    }
                    planes.push(Plane {
                        id: c[0],
                        h,
                        v,
                        q: usize::from(c[2]),
                        cols: cols * h,
                        pred: 0,
                        samples: vec![[0; 64]; count],
                        coeff: if progressive {
                            vec![[0; 64]; count]
                        } else {
                            vec![]
                        },
                    });
                }
            }
            0xda => {
                let n = usize::from(byte(&mut payload)?);
                if n == 0 || n > planes.len() {
                    return Err("Unknown JPEG scan component");
                }
                let mut components = Vec::with_capacity(n);
                for pair in take(&mut payload, n * 2)?.chunks_exact(2) {
                    let i = planes
                        .iter()
                        .position(|p| p.id == pair[0])
                        .ok_or("Unknown JPEG scan component")?;
                    let (dc, ac) = (pair[1] >> 4, pair[1] & 15);
                    if dc > 3 || ac > 3 {
                        return Err("Invalid JPEG Huffman code");
                    }
                    planes[i].pred = 0;
                    components.push((i, usize::from(dc), 4 + usize::from(ac)));
                }
                let mut band: [u8; 3] = take(&mut payload, 3)?.try_into().unwrap();
                if !progressive {
                    band = [0, 63, 0];
                }
                if band[0] > band[1] || band[1] > 63 {
                    return Err("Invalid JPEG spectral band");
                }
                if n < planes.len() {
                    strip = false;
                }
                let single = n == 1;
                let first = &planes[components[0].0];
                let (nx, ny) = if single {
                    (
                        (w * first.h).div_ceil(8 * max_h),
                        (h * first.v).div_ceil(8 * max_v),
                    )
                } else {
                    (cols, rows)
                };
                let mut bits = Bits {
                    data,
                    current: 0,
                    left: 0,
                    eob: 0,
                };
                for m in 0..nx * ny {
                    if restart > 0 && m > 0 && m % restart == 0 {
                        if byte(&mut bits.data)? != 255 {
                            return Err("Missing JPEG restart marker");
                        }
                        while bits.data.first() == Some(&255) {
                            bits.data = &bits.data[1..];
                        }
                        if byte(&mut bits.data)? != 0xd0 + ((m / restart - 1) % 8) as u8 {
                            return Err("Invalid JPEG restart sequence");
                        }
                        bits.left = 0;
                        bits.eob = 0;
                        for p in &mut planes {
                            p.pred = 0;
                        }
                    }
                    for &(i, dc, ac) in &components {
                        let p = &mut planes[i];
                        let (sx, sy) = if single { (1, 1) } else { (p.h, p.v) };
                        for dy in 0..sy {
                            for dx in 0..sx {
                                let j = (m / nx * sy + dy) * p.cols + m % nx * sx + dx;
                                let mut local = [0; 64];
                                let block = if progressive {
                                    &mut p.coeff[j]
                                } else {
                                    &mut local
                                };
                                bits.block(
                                    &tables[dc],
                                    &tables[ac],
                                    &mut p.pred,
                                    block,
                                    band,
                                    progressive,
                                )?;
                                if !progressive {
                                    let q = quant
                                        .get(p.q)
                                        .and_then(Option::as_ref)
                                        .ok_or("Missing JPEG quantization table")?;
                                    p.samples[j] = idct(block, q, &cos);
                                }
                            }
                        }
                    }
                }
                data = bits.data;
            }
            _ => {}
        }
    }
    if planes.is_empty() {
        return Err("Missing JPEG scan");
    }
    for p in planes.iter_mut().filter(|_| progressive) {
        let q = quant
            .get(p.q)
            .and_then(Option::as_ref)
            .ok_or("Missing JPEG quantization table")?;
        for (block, samples) in p.coeff.drain(..).zip(&mut p.samples) {
            *samples = idct(&block, q, &cos);
        }
    }
    let transform = adobe
        .or(color_transform)
        .unwrap_or_else(|| planes.len() == 3 && (jfif || planes.iter().map(|p| p.id).ne(*b"RGB")));
    let mut pixels = Vec::with_capacity(w * h);
    for y in 0..h {
        for x in 0..w {
            let sample = |i: usize| {
                let p = &planes[i];
                p.at(x * p.h / max_h, y * p.v / max_v)
            };
            let l = sample(0);
            let rgb = if planes.len() == 1 {
                [l; 3]
            } else if !transform {
                [l, sample(1), sample(2)]
            } else {
                if strip {
                    let (cb, cr) = (sample(1) - 128, sample(2) - 128);
                    [
                        l + ((91881 * cr + 32768) >> 16),
                        l - ((22554 * cb + 46802 * cr + 32768) >> 16),
                        l + ((116130 * cb + 32768) >> 16),
                    ]
                } else {
                    let plane = |i: usize| planes[i].interpolated(x, y, (w, h), (max_h, max_v));
                    let (l, cb, cr) = (plane(0), plane(1) - 128., plane(2) - 128.);
                    [
                        l + 1.402 * cr,
                        l - 0.344136 * cb - 0.714136 * cr,
                        l + 1.772 * cb,
                    ]
                    .map(|v| v.round() as i32)
                }
            }
            .map(|v| v.clamp(0, 255) as u8);
            if planes.len() == 4 {
                let [c, m, y] = if transform { rgb.map(|v| 255 - v) } else { rgb };
                pixels.push([c, m, y, sample(3) as u8]);
            } else {
                pixels.push([rgb[0], rgb[1], rgb[2], 255]);
            }
        }
    }
    Ok((header, pixels))
}

pub(super) fn decode(bytes: &[u8], limit: usize) -> Result<Raster> {
    let (header, mut pixels) = samples(bytes, limit, None)?;
    if header.channels == 4 {
        // Standalone Adobe JPEGs store inverted ink values.
        for p in &mut pixels {
            let k = u16::from(p[3]);
            for v in &mut p[..3] {
                *v = ((u16::from(*v) * k + 127) / 255) as u8;
            }
            p[3] = 255;
        }
    }
    Ok(Raster {
        width: header.width as usize,
        height: header.height as usize,
        density: header.density,
        orientation: header.orientation,
        gray: header.channels == 1,
        alpha: header.channels == 4,
        pixels,
    })
}
