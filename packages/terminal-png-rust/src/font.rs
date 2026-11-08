//! Bounded TrueType cmap/metrics/outline decoding, including composite glyphs.
#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub on: bool,
}
pub type Outline = Vec<Vec<Point>>;
pub type Error = &'static str;
fn bytes(data: &[u8], at: usize, len: usize) -> Result<&[u8], Error> {
    data.get(at..at.checked_add(len).ok_or("invalid font offset")?)
        .ok_or("truncated TrueType data")
}
fn u16(data: &[u8], at: usize) -> Result<u16, Error> {
    let b = bytes(data, at, 2)?;
    Ok(u16::from_be_bytes([b[0], b[1]]))
}
fn i16(data: &[u8], at: usize) -> Result<i16, Error> {
    Ok(u16(data, at)? as i16)
}
fn u32(data: &[u8], at: usize) -> Result<u32, Error> {
    let b = bytes(data, at, 4)?;
    Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}
fn table<'a>(data: &'a [u8], tag: &[u8; 4]) -> Result<&'a [u8], Error> {
    let count = u16(data, 4)? as usize;
    bytes(data, 12, count * 16)?;
    for i in 0..count {
        let at = 12 + i * 16;
        if bytes(data, at, 4)? == tag {
            return bytes(
                data,
                u32(data, at + 8)? as usize,
                u32(data, at + 12)? as usize,
            );
        }
    }
    Err("required TrueType table missing")
}
pub struct Font<'a> {
    head: &'a [u8],
    hmtx: &'a [u8],
    loca: &'a [u8],
    glyf: &'a [u8],
    cmap: &'a [u8],
    format: u16,
    glyphs: u16,
    metrics: u16,
    long_loca: bool,
}
impl<'a> Font<'a> {
    pub fn new(data: &'a [u8]) -> Result<Self, Error> {
        if u32(data, 0)? != 0x00010000 {
            return Err("font must contain TrueType outlines");
        }
        let head = table(data, b"head")?;
        let upem = u16(head, 18)?;
        if !(16..=16384).contains(&upem) {
            return Err("invalid units per em");
        }
        let mode = i16(head, 50)?;
        if mode != 0 && mode != 1 {
            return Err("invalid glyph location format");
        }
        let glyphs = u16(table(data, b"maxp")?, 4)?;
        let metrics = u16(table(data, b"hhea")?, 34)?;
        if glyphs == 0 || metrics == 0 || metrics > glyphs {
            return Err("invalid glyph metrics");
        }
        let loca = table(data, b"loca")?;
        bytes(
            loca,
            0,
            (usize::from(glyphs) + 1) * if mode == 1 { 4 } else { 2 },
        )?;
        let hmtx = table(data, b"hmtx")?;
        bytes(
            hmtx,
            0,
            usize::from(metrics) * 4 + usize::from(glyphs - metrics) * 2,
        )?;
        let maps = table(data, b"cmap")?;
        let count = u16(maps, 2)? as usize;
        bytes(maps, 4, count * 8)?;
        let mut chosen = None;
        for i in 0..count {
            let at = 4 + i * 8;
            let platform = u16(maps, at)?;
            let encoding = u16(maps, at + 2)?;
            if platform != 0 && !(platform == 3 && (encoding == 1 || encoding == 10)) {
                continue;
            }
            let offset = u32(maps, at + 4)? as usize;
            let format = u16(maps, offset)?;
            let length = match format {
                4 => u16(maps, offset + 2)? as usize,
                12 => u32(maps, offset + 4)? as usize,
                _ => continue,
            };
            let map = bytes(maps, offset, length)?;
            if format == 4 {
                let segments = u16(map, 6)? as usize / 2;
                if segments == 0 {
                    return Err("invalid cmap segments");
                }
                bytes(map, 14, segments * 8 + 2)?;
            } else {
                bytes(map, 16, u32(map, 12)? as usize * 12)?;
            }
            if chosen.is_none() || format == 12 {
                chosen = Some((map, format));
            }
        }
        let (cmap, format) = chosen.ok_or("Unicode cmap missing")?;
        Ok(Self {
            head,
            hmtx,
            loca,
            glyf: table(data, b"glyf")?,
            cmap,
            format,
            glyphs,
            metrics,
            long_loca: mode == 1,
        })
    }
    pub fn units_per_em(&self) -> u16 {
        u16(self.head, 18).unwrap()
    }
    pub fn advance(&self, glyph: u16) -> Result<u16, Error> {
        if glyph >= self.glyphs {
            return Err("glyph index outside font");
        }
        u16(self.hmtx, usize::from(glyph.min(self.metrics - 1)) * 4)
    }
    pub fn glyph_index(&self, cp: u32) -> u16 {
        self.lookup(cp).filter(|n| *n < self.glyphs).unwrap_or(0)
    }
    fn lookup(&self, cp: u32) -> Option<u16> {
        if self.format == 12 {
            let count = u32(self.cmap, 12).ok()? as usize;
            let mut lo = 0;
            let mut hi = count;
            while lo < hi {
                let mid = (lo + hi) / 2;
                let at = 16 + mid * 12;
                let first = u32(self.cmap, at).ok()?;
                let last = u32(self.cmap, at + 4).ok()?;
                if cp < first {
                    hi = mid;
                } else if cp > last {
                    lo = mid + 1;
                } else {
                    return u16::try_from(u32(self.cmap, at + 8).ok()?.checked_add(cp - first)?)
                        .ok();
                }
            }
            return None;
        }
        let cp = u16::try_from(cp).ok()?;
        let count = u16(self.cmap, 6).ok()? as usize / 2;
        let mut lo = 0;
        let mut hi = count;
        while lo < hi {
            let mid = (lo + hi) / 2;
            if u16(self.cmap, 14 + mid * 2).ok()? < cp {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo == count {
            return None;
        }
        let start = u16(self.cmap, 16 + count * 2 + lo * 2).ok()?;
        if cp < start {
            return None;
        }
        let delta = u16(self.cmap, 16 + count * 4 + lo * 2).ok()?;
        let at = 16 + count * 6 + lo * 2;
        let range = u16(self.cmap, at).ok()?;
        if range == 0 {
            return Some(cp.wrapping_add(delta));
        }
        let glyph = u16(
            self.cmap,
            at + usize::from(range) + usize::from(cp - start) * 2,
        )
        .ok()?;
        Some(if glyph == 0 {
            0
        } else {
            glyph.wrapping_add(delta)
        })
    }
    fn location(&self, glyph: u16) -> Result<usize, Error> {
        if self.long_loca {
            Ok(u32(self.loca, usize::from(glyph) * 4)? as usize)
        } else {
            Ok(usize::from(u16(self.loca, usize::from(glyph) * 2)?) * 2)
        }
    }
    pub fn outline(&self, glyph: u16) -> Result<Outline, Error> {
        let mut fuel = 1024;
        self.decode(glyph, 0, &mut fuel)
    }
    fn decode(&self, glyph: u16, depth: usize, fuel: &mut usize) -> Result<Outline, Error> {
        if glyph >= self.glyphs || depth > 32 || *fuel == 0 {
            return Err("glyph exceeds outline budget");
        }
        *fuel -= 1;
        let start = self.location(glyph)?;
        let end = self.location(glyph + 1)?;
        if end < start {
            return Err("invalid glyph range");
        }
        if start == end {
            return Ok(vec![]);
        }
        let data = bytes(self.glyf, start, end - start)?;
        let count = i16(data, 0)?;
        bytes(data, 0, 10)?;
        if count < 0 {
            return self.composite(data, depth, fuel);
        }
        let count = count as usize;
        if count == 0 {
            return Ok(vec![]);
        }
        let mut ends = Vec::with_capacity(count);
        for i in 0..count {
            let end = u16(data, 10 + i * 2)? as usize;
            if ends.last().is_some_and(|v| *v >= end) {
                return Err("invalid contour end points");
            }
            ends.push(end);
        }
        let points = ends[count - 1] + 1;
        if points > 65536 {
            return Err("glyph exceeds point budget");
        }
        let at = 10 + count * 2;
        let instructions = u16(data, at)? as usize;
        let mut at = at + 2;
        bytes(data, at, instructions)?;
        at += instructions;
        let mut flags = Vec::with_capacity(points);
        while flags.len() < points {
            let flag = bytes(data, at, 1)?[0];
            at += 1;
            let repeat = if flag & 8 != 0 {
                let n = bytes(data, at, 1)?[0] as usize;
                at += 1;
                n
            } else {
                0
            };
            if flags.len() + repeat + 1 > points {
                return Err("invalid repeated point flags");
            }
            flags.resize(flags.len() + repeat + 1, flag);
        }
        let mut coordinates = |short: u8, same: u8| -> Result<Vec<i32>, Error> {
            let mut values = Vec::with_capacity(points);
            let mut current = 0_i32;
            for flag in &flags {
                let delta = if flag & short != 0 {
                    let n = bytes(data, at, 1)?[0] as i32;
                    at += 1;
                    if flag & same != 0 { n } else { -n }
                } else if flag & same != 0 {
                    0
                } else {
                    let n = i16(data, at)? as i32;
                    at += 2;
                    n
                };
                current = current
                    .checked_add(delta)
                    .ok_or("glyph coordinate overflow")?;
                values.push(current);
            }
            Ok(values)
        };
        let x = coordinates(2, 16)?;
        let y = coordinates(4, 32)?;
        let mut first = 0;
        let mut out = Vec::with_capacity(count);
        for end in ends {
            out.push(
                (first..=end)
                    .map(|i| Point {
                        x: f64::from(x[i]),
                        y: f64::from(y[i]),
                        on: flags[i] & 1 != 0,
                    })
                    .collect(),
            );
            first = end + 1;
        }
        Ok(out)
    }
    fn composite(&self, data: &[u8], depth: usize, fuel: &mut usize) -> Result<Outline, Error> {
        let mut at = 10;
        let mut out: Outline = vec![];
        loop {
            let flags = u16(data, at)?;
            let glyph = u16(data, at + 2)?;
            at += 4;
            let xy = flags & 2 != 0;
            let (arg1, arg2) = if flags & 1 != 0 {
                let one = if xy {
                    i16(data, at)? as i32
                } else {
                    u16(data, at)? as i32
                };
                let two = if xy {
                    i16(data, at + 2)? as i32
                } else {
                    u16(data, at + 2)? as i32
                };
                at += 4;
                (one, two)
            } else {
                let args = bytes(data, at, 2)?;
                at += 2;
                if xy {
                    (args[0] as i8 as i32, args[1] as i8 as i32)
                } else {
                    (args[0] as i32, args[1] as i32)
                }
            };
            let mut read = || -> Result<f64, Error> {
                let n = f64::from(i16(data, at)?) / 16384.0;
                at += 2;
                Ok(n)
            };
            let (a, b, c, d) = if flags & 8 != 0 {
                let scale = read()?;
                (scale, 0.0, 0.0, scale)
            } else if flags & 64 != 0 {
                (read()?, 0.0, 0.0, read()?)
            } else if flags & 128 != 0 {
                (read()?, read()?, read()?, read()?)
            } else {
                (1.0, 0.0, 0.0, 1.0)
            };
            let mut contours = self.decode(glyph, depth + 1, fuel)?;
            for point in contours.iter_mut().flatten() {
                let (x, y) = (point.x, point.y);
                point.x = a * x + c * y;
                point.y = b * x + d * y;
            }
            let (mut x, mut y) = if xy {
                let (x, y) = (f64::from(arg1), f64::from(arg2));
                if flags & 2048 != 0 {
                    (a * x + c * y, b * x + d * y)
                } else {
                    (x, y)
                }
            } else {
                let parent = out
                    .iter()
                    .flatten()
                    .nth(arg1 as usize)
                    .ok_or("invalid parent attachment point")?;
                let child = contours
                    .iter()
                    .flatten()
                    .nth(arg2 as usize)
                    .ok_or("invalid child attachment point")?;
                (parent.x - child.x, parent.y - child.y)
            };
            if flags & 4 != 0 {
                x = x.round();
                y = y.round();
            }
            for point in contours.iter_mut().flatten() {
                point.x += x;
                point.y += y;
            }
            out.extend(contours);
            if out.iter().map(Vec::len).sum::<usize>() > 65536 {
                return Err("glyph exceeds point budget");
            }
            if flags & 32 == 0 {
                break;
            }
        }
        Ok(out)
    }
}
