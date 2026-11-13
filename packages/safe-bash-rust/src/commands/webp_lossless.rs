// VP8L: literal prefix codes, LZ77 distances and spatial transforms.
type Pixel = [u8; 4];
type Result<T> = std::result::Result<T, &'static str>;

struct Decoder<'a> {
    data: &'a [u8],
    bit: usize,
    remaining: usize,
}
enum Tree {
    One(u16),
    Pair(u16, u16),
    Literal,
    Codes {
        counts: [u16; 16],
        symbols: Vec<u16>,
    },
}

impl Tree {
    fn canonical(lengths: &[u8]) -> Self {
        let mut counts = [0u16; 16];
        for &n in lengths {
            if n != 0 {
                counts[n as usize] += 1;
            }
        }
        if counts.iter().sum::<u16>() <= 1 {
            return Self::One(lengths.iter().position(|&n| n != 0).unwrap_or(0) as u16);
        }
        if lengths.len() >= 256
            && lengths[..256].iter().all(|&n| n == 8)
            && lengths[256..].iter().all(|&n| n == 0)
        {
            return Self::Literal;
        }
        let mut symbols = Vec::with_capacity(counts.iter().sum::<u16>() as usize);
        for n in 1..16 {
            if counts[n as usize] != 0 {
                symbols.extend(
                    lengths
                        .iter()
                        .enumerate()
                        .filter_map(|(i, &len)| (len == n).then_some(i as u16)),
                );
            }
        }
        Self::Codes { counts, symbols }
    }
    fn symbol(&self, d: &mut Decoder<'_>) -> usize {
        match self {
            Self::One(v) => *v as usize,
            Self::Pair(a, b) => {
                if d.read(1) == 0 {
                    *a as usize
                } else {
                    *b as usize
                }
            }
            Self::Literal => (d.read(8) as u8).reverse_bits() as usize,
            Self::Codes { counts, symbols } => {
                let (mut code, mut first, mut index) = (0, 0, 0);
                for &n in &counts[1..] {
                    code = code * 2 + d.read(1);
                    let n = n as usize;
                    if code < first + n {
                        return symbols[index + code - first] as usize;
                    }
                    index += n;
                    first = (first + n) * 2;
                }
                0
            }
        }
    }
}

impl Decoder<'_> {
    fn read(&mut self, n: usize) -> usize {
        let mut value = 0;
        let mut shift = 0;
        while shift < n {
            let i = self.bit / 8;
            let Some(&v) = self.data.get(i) else {
                self.bit += n - shift;
                break;
            };
            let offset = self.bit % 8;
            let take = (8 - offset).min(n - shift);
            value |= ((usize::from(v) >> offset) & ((1 << take) - 1)) << shift;
            shift += take;
            self.bit += take;
        }
        value
    }
    fn charge(&mut self, n: usize) -> Result<()> {
        self.remaining = self
            .remaining
            .checked_sub(n)
            .ok_or("image exceeds memory budget")?;
        Ok(())
    }
    fn tree(&mut self, size: usize) -> Result<Tree> {
        if self.read(1) != 0 {
            let pair = self.read(1) != 0;
            let bits = if self.read(1) == 0 { 1 } else { 8 };
            let a = self.read(bits) as u16;
            return Ok(if pair {
                Tree::Pair(a, self.read(8) as u16)
            } else {
                Tree::One(a)
            });
        }
        let mut lengths = [0; 19];
        for &i in &[
            17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        ][..4 + self.read(4)]
        {
            lengths[i] = self.read(3) as u8;
        }
        let tree = Tree::canonical(&lengths);
        let max = if self.read(1) == 0 {
            size
        } else {
            let n = 2 + 2 * self.read(3);
            size.min(2 + self.read(n))
        };
        self.charge(size * 3)?;
        let mut lengths = vec![0; size];
        let mut i = 0;
        let mut prev = 8;
        for _ in 0..max {
            if i >= size {
                break;
            }
            match tree.symbol(self) {
                v @ 0..=15 => {
                    lengths[i] = v as u8;
                    i += 1;
                    if v != 0 {
                        prev = v as u8;
                    }
                }
                16 => {
                    let end = size.min(i + 3 + self.read(2));
                    lengths[i..end].fill(prev);
                    i = end;
                }
                17 => i += 3 + self.read(3),
                _ => i += 11 + self.read(7),
            }
        }
        Ok(Tree::canonical(&lengths))
    }
    fn value(&mut self, code: usize) -> Result<usize> {
        if code < 4 {
            return Ok(code + 1);
        }
        if code >= 40 {
            return Err("Invalid WebP distance");
        }
        let extra = (code - 2) / 2;
        Ok(((2 + (code & 1)) << extra) + self.read(extra) + 1)
    }
    fn image(&mut self, mut w: usize, h: usize, main: bool) -> Result<Vec<Pixel>> {
        let mut transforms = Vec::new();
        while main && self.read(1) != 0 {
            if transforms.len() == 4 {
                return Err("Invalid WebP transforms");
            }
            let kind = self.read(2);
            let old = w;
            let (bits, mut data) = match kind {
                0 | 1 => {
                    let n = 2 + self.read(3);
                    (
                        n,
                        self.image(w.div_ceil(1 << n), h.div_ceil(1 << n), false)?,
                    )
                }
                2 => (0, Vec::new()),
                _ => {
                    let count = 1 + self.read(8);
                    let bits = match count {
                        1..=2 => 3,
                        3..=4 => 2,
                        5..=16 => 1,
                        _ => 0,
                    };
                    w = w.div_ceil(1 << bits);
                    (bits, self.image(count, 1, false)?)
                }
            };
            if kind == 3 {
                for i in 1..data.len() {
                    data[i] = add(data[i], data[i - 1]);
                }
            }
            transforms.push((kind, bits, old, data));
        }
        let cache_bits = if self.read(1) == 0 { 0 } else { self.read(4) };
        let cache_size = if cache_bits == 0 { 0 } else { 1 << cache_bits };
        self.charge(cache_size * 4)?;
        let mut cache = vec![[0; 4]; cache_size];
        let mut tile = 0;
        let mut cols = 0;
        let mut groups = 1;
        let group_id = |p: Pixel| (usize::from(p[0]) << 8) | usize::from(p[1]);
        let meta = if main && self.read(1) != 0 {
            tile = 2 + self.read(3);
            cols = w.div_ceil(1 << tile);
            let im = self.image(cols, h.div_ceil(1 << tile), false)?;
            groups = im.iter().copied().map(group_id).max().unwrap_or(0) + 1;
            im
        } else {
            Vec::new()
        };
        self.charge(groups * size_of::<[Tree; 5]>())?;
        let mut codes = Vec::with_capacity(groups);
        for _ in 0..groups {
            codes.push([
                self.tree(280 + cache_size)?,
                self.tree(256)?,
                self.tree(256)?,
                self.tree(256)?,
                self.tree(40)?,
            ]);
        }
        let n = w.checked_mul(h).ok_or("image exceeds memory budget")?;
        self.charge(n.checked_mul(4).ok_or("image exceeds memory budget")?)?;
        let mut pixels = Vec::with_capacity(n);
        let append = |pixels: &mut Vec<Pixel>, cache: &mut [Pixel], p: Pixel| {
            pixels.push(p);
            if cache_bits != 0 {
                let [r, g, b, a] = p;
                let hash = u32::from_be_bytes([a, r, g, b]).wrapping_mul(0x1e35a7bd);
                cache[(hash >> (32 - cache_bits)) as usize] = p;
            }
        };
        while pixels.len() < n {
            let at = pixels.len();
            let i = if meta.is_empty() {
                0
            } else {
                group_id(meta[((at / w) >> tile) * cols + ((at % w) >> tile)])
            };
            let group = &codes[i];
            match group[0].symbol(self) {
                g @ 0..=255 => {
                    let r = group[1].symbol(self);
                    let b = group[2].symbol(self);
                    let a = group[3].symbol(self);
                    append(
                        &mut pixels,
                        &mut cache,
                        [r as u8, g as u8, b as u8, a as u8],
                    );
                }
                c @ 256..=279 => {
                    let len = self.value(c - 256)?.min(n - at);
                    let symbol = group[4].symbol(self);
                    let dist = self.value(symbol)?;
                    let dist = if dist > 120 {
                        dist - 120
                    } else {
                        let (dx, dy) = DIST[dist - 1];
                        (dy as i64 * w as i64 + dx as i64).max(1) as usize
                    };
                    for _ in 0..len {
                        let p = pixels
                            .get(pixels.len().saturating_sub(dist))
                            .copied()
                            .unwrap_or([0; 4]);
                        append(&mut pixels, &mut cache, p);
                    }
                }
                c => {
                    let p = cache.get(c - 280).copied().unwrap_or([0; 4]);
                    append(&mut pixels, &mut cache, p);
                }
            }
        }
        for (kind, bits, old, data) in transforms.into_iter().rev() {
            if kind == 3 {
                self.charge(old * h * 4)?;
                let mut expanded = Vec::with_capacity(old * h);
                let per = 1 << bits;
                let step = 8 / per;
                for y in 0..h {
                    for x in 0..old {
                        let g = usize::from(pixels[y * w + x / per][1]);
                        expanded.push(
                            data.get((g >> ((x % per) * step)) & ((1 << step) - 1))
                                .copied()
                                .unwrap_or([0; 4]),
                        );
                    }
                }
                pixels = expanded;
                w = old;
            } else if kind == 2 {
                for p in &mut pixels {
                    p[0] = p[0].wrapping_add(p[1]);
                    p[2] = p[2].wrapping_add(p[1]);
                }
            } else {
                let cols = w.div_ceil(1 << bits);
                for i in 0..pixels.len() {
                    let (x, y) = (i % w, i / w);
                    let m = data[(y >> bits) * cols + (x >> bits)];
                    if kind == 1 {
                        let p = &mut pixels[i];
                        let delta =
                            |t: u8, c: u8| ((i16::from(t as i8) * i16::from(c as i8)) >> 5) as u8;
                        p[0] = p[0].wrapping_add(delta(m[2], p[1]));
                        p[2] = p[2]
                            .wrapping_add(delta(m[1], p[1]))
                            .wrapping_add(delta(m[0], p[0]));
                    } else {
                        let pred = if i == 0 {
                            [0, 0, 0, 255]
                        } else if y == 0 {
                            pixels[i - 1]
                        } else if x == 0 {
                            pixels[i - w]
                        } else {
                            predict(
                                m[1] & 15,
                                pixels[i - 1],
                                pixels[i - w],
                                pixels[i - w - 1],
                                pixels[i - w + 1],
                            )
                        };
                        pixels[i] = add(pixels[i], pred);
                    }
                }
            }
        }
        Ok(pixels)
    }
}
fn add(a: Pixel, b: Pixel) -> Pixel {
    std::array::from_fn(|i| a[i].wrapping_add(b[i]))
}
fn predict(mode: u8, l: Pixel, t: Pixel, tl: Pixel, tr: Pixel) -> Pixel {
    let avg = |a: Pixel, b: Pixel| {
        std::array::from_fn(|i| ((u16::from(a[i]) + u16::from(b[i])) / 2) as u8)
    };
    match mode {
        0 => [0, 0, 0, 255],
        2 => t,
        3 => tr,
        4 => tl,
        5 => avg(avg(l, tr), t),
        6 => avg(l, tl),
        7 => avg(l, t),
        8 => avg(tl, t),
        9 => avg(t, tr),
        10 => avg(avg(l, tl), avg(t, tr)),
        11 => {
            let delta = |p: Pixel| {
                p.iter()
                    .zip(tl)
                    .map(|(c, b)| u16::from(c.abs_diff(b)))
                    .sum::<u16>()
            };
            if delta(t) <= delta(l) { l } else { t }
        }
        12 => std::array::from_fn(|i| {
            (i16::from(l[i]) + i16::from(t[i]) - i16::from(tl[i])).clamp(0, 255) as u8
        }),
        13 => {
            let a = avg(l, t);
            std::array::from_fn(|i| {
                (i16::from(a[i]) + (i16::from(a[i]) - i16::from(tl[i])) / 2).clamp(0, 255) as u8
            })
        }
        _ => l,
    }
}
pub(super) fn decode(payload: &[u8], w: usize, h: usize, limit: usize) -> Result<Vec<Pixel>> {
    let mut decoder = Decoder {
        data: payload,
        bit: 40,
        remaining: limit,
    };
    let pixels = decoder.image(w, h, true)?;
    if decoder.bit > payload.len() * 8 {
        return Err("Truncated WebP lossless bitstream");
    }
    Ok(pixels)
}

const DIST: [(i8, i8); 120] = [
    (0, 1),
    (1, 0),
    (1, 1),
    (-1, 1),
    (0, 2),
    (2, 0),
    (1, 2),
    (-1, 2),
    (2, 1),
    (-2, 1),
    (2, 2),
    (-2, 2),
    (0, 3),
    (3, 0),
    (1, 3),
    (-1, 3),
    (3, 1),
    (-3, 1),
    (2, 3),
    (-2, 3),
    (3, 2),
    (-3, 2),
    (0, 4),
    (4, 0),
    (1, 4),
    (-1, 4),
    (4, 1),
    (-4, 1),
    (3, 3),
    (-3, 3),
    (2, 4),
    (-2, 4),
    (4, 2),
    (-4, 2),
    (0, 5),
    (3, 4),
    (-3, 4),
    (4, 3),
    (-4, 3),
    (5, 0),
    (1, 5),
    (-1, 5),
    (5, 1),
    (-5, 1),
    (2, 5),
    (-2, 5),
    (5, 2),
    (-5, 2),
    (4, 4),
    (-4, 4),
    (3, 5),
    (-3, 5),
    (5, 3),
    (-5, 3),
    (0, 6),
    (6, 0),
    (1, 6),
    (-1, 6),
    (6, 1),
    (-6, 1),
    (2, 6),
    (-2, 6),
    (6, 2),
    (-6, 2),
    (4, 5),
    (-4, 5),
    (5, 4),
    (-5, 4),
    (3, 6),
    (-3, 6),
    (6, 3),
    (-6, 3),
    (0, 7),
    (7, 0),
    (1, 7),
    (-1, 7),
    (5, 5),
    (-5, 5),
    (7, 1),
    (-7, 1),
    (4, 6),
    (-4, 6),
    (6, 4),
    (-6, 4),
    (2, 7),
    (-2, 7),
    (7, 2),
    (-7, 2),
    (3, 7),
    (-3, 7),
    (7, 3),
    (-7, 3),
    (5, 6),
    (-5, 6),
    (6, 5),
    (-6, 5),
    (8, 0),
    (4, 7),
    (-4, 7),
    (7, 4),
    (-7, 4),
    (8, 1),
    (8, 2),
    (6, 6),
    (-6, 6),
    (8, 3),
    (5, 7),
    (-5, 7),
    (7, 5),
    (-7, 5),
    (8, 4),
    (6, 7),
    (-6, 7),
    (7, 6),
    (-7, 6),
    (8, 5),
    (7, 7),
    (-7, 7),
    (8, 6),
    (8, 7),
];
