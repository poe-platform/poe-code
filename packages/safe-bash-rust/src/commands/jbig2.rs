// ITU-T T.88 bitmap decoding. Arithmetic procedures and templates follow the
// existing PDF.js implementation in pdf-ast. Copyright 2023 Mozilla Foundation.
// Licensed under Apache-2.0; see ../../LICENSE.PDFJS. This Rust adaptation
// uses packed bitmaps and bounded memory/work instead of JavaScript row arrays.
use std::{
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};
#[path = "jbig2_huffman.rs"]
mod huffman;
use huffman::{Bits, Table};

struct Budget {
    bytes: usize,
    work: usize,
}
impl Budget {
    fn alloc(&mut self, n: usize) -> Option<()> {
        self.bytes = self.bytes.checked_sub(n)?;
        Some(())
    }
    fn step(&mut self, n: usize) -> Option<()> {
        self.work = self.work.checked_sub(n)?;
        Some(())
    }
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let out = self.data.get(self.pos..end)?;
        self.pos = end;
        Some(out)
    }
    fn uint(&mut self, n: usize) -> Option<u32> {
        Some(self.take(n)?.iter().fold(0, |a, b| a << 8 | u32::from(*b)))
    }
    fn at(&mut self, n: usize) -> Option<Vec<(i32, i32)>> {
        (0..n)
            .map(|_| Some((self.uint(1)? as i8 as i32, self.uint(1)? as i8 as i32)))
            .collect()
    }
}

struct Bitmap {
    width: usize,
    height: usize,
    data: Vec<u8>,
}
impl Bitmap {
    fn new(width: usize, height: usize, fill: u8, budget: &mut Budget) -> Option<Self> {
        if width == 0 || height == 0 || width > i32::MAX as usize || height > i32::MAX as usize {
            return None;
        }
        budget.step(width.checked_mul(height)?)?;
        let bytes = width.div_ceil(8).checked_mul(height)?;
        budget.alloc(bytes.checked_add(64)?)?;
        Some(Self {
            width,
            height,
            data: vec![fill; bytes],
        })
    }
    fn pixel(&self, x: i64, y: i64) -> u8 {
        if x < 0 || y < 0 || x >= self.width as i64 || y >= self.height as i64 {
            return 0;
        }
        (self.data[y as usize * self.width.div_ceil(8) + x as usize / 8] >> (7 - x as usize % 8))
            & 1
    }
    fn set(&mut self, x: usize, y: usize, bit: u8) {
        let v = &mut self.data[y * self.width.div_ceil(8) + x / 8];
        let mask = 128 >> (x % 8);
        *v = (*v & !mask) | (if bit != 0 { mask } else { 0 });
    }
    fn draw(&mut self, src: &Self, x: i64, y: i64, op: u32, budget: &mut Budget) -> Option<()> {
        if !matches!(op, 0 | 2) {
            return None;
        }
        let left = x.saturating_neg().max(0).min(src.width as i64);
        let top = y.saturating_neg().max(0).min(src.height as i64);
        let right = (self.width as i64)
            .saturating_sub(x)
            .max(0)
            .min(src.width as i64);
        let bottom = (self.height as i64)
            .saturating_sub(y)
            .max(0)
            .min(src.height as i64);
        budget
            .step(((right - left).max(0) as usize).checked_mul((bottom - top).max(0) as usize)?)?;
        for sy in top..bottom {
            for sx in left..right {
                let old = self.pixel(sx + x, sy + y);
                let v = src.pixel(sx, sy);
                self.set(
                    (sx + x) as usize,
                    (sy + y) as usize,
                    if op == 0 { old | v } else { old ^ v },
                );
            }
        }
        Some(())
    }
}

// Qe, next MPS state, next LPS state, exchange MPS/LPS.
const QE: [(u32, u8, u8, u8); 47] = [
    (0x5601, 1, 1, 1),
    (0x3401, 2, 6, 0),
    (0x1801, 3, 9, 0),
    (0x0ac1, 4, 12, 0),
    (0x0521, 5, 29, 0),
    (0x0221, 38, 33, 0),
    (0x5601, 7, 6, 1),
    (0x5401, 8, 14, 0),
    (0x4801, 9, 14, 0),
    (0x3801, 10, 14, 0),
    (0x3001, 11, 17, 0),
    (0x2401, 12, 18, 0),
    (0x1c01, 13, 20, 0),
    (0x1601, 29, 21, 0),
    (0x5601, 15, 14, 1),
    (0x5401, 16, 14, 0),
    (0x5101, 17, 15, 0),
    (0x4801, 18, 16, 0),
    (0x3801, 19, 17, 0),
    (0x3401, 20, 18, 0),
    (0x3001, 21, 19, 0),
    (0x2801, 22, 19, 0),
    (0x2401, 23, 20, 0),
    (0x2201, 24, 21, 0),
    (0x1c01, 25, 22, 0),
    (0x1801, 26, 23, 0),
    (0x1601, 27, 24, 0),
    (0x1401, 28, 25, 0),
    (0x1201, 29, 26, 0),
    (0x1101, 30, 27, 0),
    (0x0ac1, 31, 28, 0),
    (0x09c1, 32, 29, 0),
    (0x08a1, 33, 30, 0),
    (0x0521, 34, 31, 0),
    (0x0441, 35, 32, 0),
    (0x02a1, 36, 33, 0),
    (0x0221, 37, 34, 0),
    (0x0141, 38, 35, 0),
    (0x0111, 39, 36, 0),
    (0x0085, 40, 37, 0),
    (0x0049, 41, 38, 0),
    (0x0025, 42, 39, 0),
    (0x0015, 43, 40, 0),
    (0x0009, 44, 41, 0),
    (0x0005, 45, 42, 0),
    (0x0001, 45, 43, 0),
    (0x5601, 46, 46, 0),
];
struct Arithmetic<'a> {
    data: &'a [u8],
    pos: usize,
    high: u32,
    low: u32,
    ct: u32,
    a: u32,
    contexts: BTreeMap<&'static str, Vec<u8>>,
}
impl<'a> Arithmetic<'a> {
    fn new(data: &'a [u8]) -> Option<Self> {
        let mut s = Self {
            data,
            pos: 0,
            high: u32::from(*data.first()?),
            low: 0,
            ct: 0,
            a: 0x8000,
            contexts: BTreeMap::new(),
        };
        s.byte_in();
        s.high = (s.high << 7 & 0xffff) | (s.low >> 9 & 0x7f);
        s.low = s.low << 7 & 0xffff;
        s.ct -= 7;
        Some(s)
    }
    fn byte_in(&mut self) {
        if self.data.get(self.pos) == Some(&255) {
            let next = self.data.get(self.pos + 1).copied().unwrap_or(255);
            if next > 0x8f {
                self.low += 0xff00;
                self.ct = 8;
            } else {
                self.pos += 1;
                self.low += u32::from(next) << 9;
                self.ct = 7;
            }
        } else {
            self.pos += 1;
            self.low += u32::from(self.data.get(self.pos).copied().unwrap_or(255)) << 8;
            self.ct = 8;
        }
        self.high += self.low >> 16;
        self.low &= 0xffff;
    }
    fn bit(&mut self, name: &'static str, pos: usize, budget: &mut Budget) -> Option<u8> {
        budget.step(1)?;
        if !self.contexts.contains_key(name) {
            budget.alloc(65536 + 128)?;
            self.contexts.insert(name, vec![0; 65536]);
        }
        let context = *self.contexts.get(name)?.get(pos)?;
        let (qe, nmps, nlps, switch) = *QE.get((context >> 1) as usize)?;
        let mut mps = context & 1;
        let mut a = self.a - qe;
        let (d, state);
        if self.high < qe {
            if a < qe {
                d = mps;
                state = nmps;
            } else {
                d = 1 ^ mps;
                mps ^= switch;
                state = nlps;
            }
            a = qe;
        } else {
            self.high -= qe;
            if a & 0x8000 != 0 {
                self.a = a;
                return Some(mps);
            }
            if a < qe {
                d = 1 ^ mps;
                mps ^= switch;
                state = nlps;
            } else {
                d = mps;
                state = nmps;
            }
        }
        loop {
            if self.ct == 0 {
                self.byte_in();
            }
            a <<= 1;
            self.high = (self.high << 1 & 0xffff) | (self.low >> 15 & 1);
            self.low = self.low << 1 & 0xffff;
            self.ct -= 1;
            if a & 0x8000 != 0 {
                break;
            }
        }
        self.a = a;
        self.contexts.get_mut(name)?[pos] = state << 1 | mps;
        Some(d)
    }
    fn integer(&mut self, name: &'static str, budget: &mut Budget) -> Option<Option<i32>> {
        let mut prev = 1;
        let mut bits = |n| -> Option<u64> {
            let mut v = 0;
            for _ in 0..n {
                let bit = self.bit(name, prev, budget)? as usize;
                prev = if prev < 256 {
                    prev << 1 | bit
                } else {
                    ((prev << 1 | bit) & 511) | 256
                };
                v = v << 1 | bit as u64;
            }
            Some(v)
        };
        let sign = bits(1)?;
        let mut category = 0;
        while category < 5 && bits(1)? != 0 {
            category += 1;
        }
        let (n, offset) = [(2, 0), (4, 4), (6, 20), (8, 84), (12, 340), (32, 4436)][category];
        let value = (bits(n)? + offset) as i64;
        if sign != 0 && value == 0 {
            return Some(None);
        }
        Some(i32::try_from(if sign == 0 { value } else { -value }).ok())
    }
    // Width/spacing callers inspect OOB explicitly. Other procedures use the
    // reference decoder's null-as-zero recovery, without dropping budget errors.
    fn int(&mut self, name: &'static str, budget: &mut Budget) -> Option<i32> {
        Some(self.integer(name, budget)?.unwrap_or(0))
    }
    fn id(&mut self, bits: u32, budget: &mut Budget) -> Option<usize> {
        if bits > 16 {
            return None;
        }
        let mut prev = 1;
        for _ in 0..bits {
            prev = prev << 1 | self.bit("IAID", prev, budget)? as usize;
        }
        Some(prev - (1 << bits))
    }
}

const TEMPLATES: [&[(i32, i32)]; 4] = [
    &[
        (-1, -2),
        (0, -2),
        (1, -2),
        (-2, -1),
        (-1, -1),
        (0, -1),
        (1, -1),
        (2, -1),
        (-4, 0),
        (-3, 0),
        (-2, 0),
        (-1, 0),
    ],
    &[
        (-1, -2),
        (0, -2),
        (1, -2),
        (2, -2),
        (-2, -1),
        (-1, -1),
        (0, -1),
        (1, -1),
        (2, -1),
        (-3, 0),
        (-2, 0),
        (-1, 0),
    ],
    &[
        (-1, -2),
        (0, -2),
        (1, -2),
        (-2, -1),
        (-1, -1),
        (0, -1),
        (1, -1),
        (-2, 0),
        (-1, 0),
    ],
    &[
        (-3, -1),
        (-2, -1),
        (-1, -1),
        (0, -1),
        (1, -1),
        (-4, 0),
        (-3, 0),
        (-2, 0),
        (-1, 0),
    ],
];
fn generic(
    width: usize,
    height: usize,
    template: usize,
    prediction: bool,
    at: &[(i32, i32)],
    decoder: &mut Arithmetic<'_>,
    budget: &mut Budget,
) -> Option<Bitmap> {
    let mut coordinates = TEMPLATES.get(template)?.to_vec();
    if at.iter().any(|&(x, y)| y > 0 || y == 0 && x >= 0) {
        return None;
    }
    coordinates.extend_from_slice(at);
    if coordinates.len() > 16 {
        return None;
    }
    coordinates.sort_unstable_by_key(|&(x, y)| (y, x));
    let mut out = Bitmap::new(width, height, 0, budget)?;
    let mut ltp = 0;
    for y in 0..height {
        if prediction {
            ltp ^= decoder.bit("GB", [0x9b25, 0x0795, 0x00e5, 0x0195][template], budget)?;
        }
        for x in 0..width {
            let pixel = if ltp != 0 {
                out.pixel(x as i64, y as i64 - 1)
            } else {
                let ctx = coordinates.iter().fold(0, |v, &(dx, dy)| {
                    v << 1 | out.pixel(x as i64 + i64::from(dx), y as i64 + i64::from(dy)) as usize
                });
                decoder.bit("GB", ctx, budget)?
            };
            out.set(x, y, pixel);
        }
    }
    Some(out)
}
fn mmr(data: &[u8], width: usize, height: usize, budget: &mut Budget) -> Option<Bitmap> {
    let mut out = Bitmap::new(width, height, 0, budget)?;
    let size = out.data.len();
    out.data = Vec::new();
    out.data = super::fax::decode(data, super::fax::Coding::Group4, width, size, false, size)?;
    Some(out)
}

fn refinement(
    width: usize,
    height: usize,
    template: usize,
    reference: &Bitmap,
    offset: (i32, i32),
    at: &[(i32, i32)],
    decoder: &mut Arithmetic<'_>,
    budget: &mut Budget,
) -> Option<Bitmap> {
    let (mut coding, mut refs) = if template == 0 {
        (
            vec![(0, -1), (1, -1), (-1, 0)],
            vec![
                (0, -1),
                (1, -1),
                (-1, 0),
                (0, 0),
                (1, 0),
                (-1, 1),
                (0, 1),
                (1, 1),
            ],
        )
    } else {
        (
            vec![(-1, -1), (0, -1), (1, -1), (-1, 0)],
            vec![(0, -1), (-1, 0), (0, 0), (1, 0), (0, 1), (1, 1)],
        )
    };
    if template == 0 {
        coding.push(*at.first()?);
        refs.push(*at.get(1)?);
    }
    if coding.iter().any(|&(x, y)| y > 0 || y == 0 && x >= 0) {
        return None;
    }
    let mut out = Bitmap::new(width, height, 0, budget)?;
    for y in 0..height {
        for x in 0..width {
            let mut ctx = 0;
            for &(dx, dy) in &coding {
                ctx = ctx << 1
                    | out.pixel(x as i64 + i64::from(dx), y as i64 + i64::from(dy)) as usize;
            }
            for &(dx, dy) in &refs {
                ctx = ctx << 1
                    | reference.pixel(
                        x as i64 + i64::from(dx) - i64::from(offset.0),
                        y as i64 + i64::from(dy) - i64::from(offset.1),
                    ) as usize;
            }
            out.set(x, y, decoder.bit("GR", ctx, budget)?);
        }
    }
    Some(out)
}

struct Text {
    flags: u32,
    instances: usize,
    refinement_at: Vec<(i32, i32)>,
}
struct TextHuffman<'a> {
    input: Bits<'a>,
    ids: Table,
    first: Table,
    delta_s: Table,
    delta_t: Table,
}
fn select_table(
    selector: u32,
    base: u32,
    choices: u32,
    custom: &[&Table],
    index: &mut usize,
) -> Option<Table> {
    if selector < choices {
        Table::standard(base + selector)
    } else if selector == 3 {
        let table = (*custom.get(*index)?).clone();
        *index += 1;
        Some(table)
    } else {
        None
    }
}
fn code_length(n: usize) -> u32 {
    if n <= 1 {
        0
    } else {
        usize::BITS - (n - 1).leading_zeros()
    }
}
fn text_region(
    width: usize,
    height: usize,
    params: &Text,
    symbols: &[Rc<Bitmap>],
    bits: u32,
    decoder: &mut Arithmetic<'_>,
    mut huffman: Option<TextHuffman<'_>>,
    budget: &mut Budget,
) -> Option<Bitmap> {
    let flags = params.flags;
    if flags & 3 == 3 {
        return None;
    }
    let refine = flags & 2 != 0;
    let strip_size = 1i64 << (flags >> 2 & 3);
    let corner = flags >> 4 & 3;
    let transposed = flags & 64 != 0;
    let op = flags >> 7 & 3;
    let ds_offset = ((flags as i32) << 17 >> 27) as i64;
    let mut out = Bitmap::new(
        width,
        height,
        if flags & 512 != 0 { 255 } else { 0 },
        budget,
    )?;
    let mut strip_t = -i64::from(if let Some(h) = &mut huffman {
        h.delta_t.decode(&mut h.input, budget)??
    } else {
        decoder.int("IADT", budget)?
    });
    let mut first_s = 0i64;
    let mut count = 0;
    while count < params.instances {
        strip_t = strip_t.checked_add(i64::from(if let Some(h) = &mut huffman {
            h.delta_t.decode(&mut h.input, budget)??
        } else {
            decoder.int("IADT", budget)?
        }))?;
        first_s = first_s.checked_add(i64::from(if let Some(h) = &mut huffman {
            h.first.decode(&mut h.input, budget)??
        } else {
            decoder.int("IAFS", budget)?
        }))?;
        let mut current_s = first_s;
        loop {
            budget.step(1)?;
            let current_t = if strip_size > 1 {
                if let Some(h) = &mut huffman {
                    i64::from(h.input.read(flags >> 2 & 3)?)
                } else {
                    i64::from(decoder.int("IAIT", budget)?)
                }
            } else {
                0
            };
            let t = strip_size.checked_mul(strip_t)?.checked_add(current_t)?;
            let id = if let Some(h) = &mut huffman {
                usize::try_from(h.ids.decode(&mut h.input, budget)??).ok()?
            } else {
                decoder.id(bits, budget)?
            };
            let mut symbol = Rc::clone(symbols.get(id)?);
            if refine && decoder.int("IARI", budget)? != 0 {
                let dw = decoder.int("IARDW", budget)?;
                let dh = decoder.int("IARDH", budget)?;
                let dx = decoder.int("IARDX", budget)?;
                let dy = decoder.int("IARDY", budget)?;
                symbol = Rc::new(refinement(
                    usize::try_from(symbol.width as i64 + i64::from(dw)).ok()?,
                    usize::try_from(symbol.height as i64 + i64::from(dh)).ok()?,
                    (flags >> 15 & 1) as usize,
                    &symbol,
                    ((dw >> 1).checked_add(dx)?, (dh >> 1).checked_add(dy)?),
                    &params.refinement_at,
                    decoder,
                    budget,
                )?);
            }
            let sw = symbol.width as i64;
            let sh = symbol.height as i64;
            let mut increment = 0;
            if !transposed {
                if corner > 1 {
                    current_s = current_s.checked_add(sw - 1)?;
                } else {
                    increment = sw - 1;
                }
            } else if corner & 1 == 0 {
                current_s = current_s.checked_add(sh - 1)?;
            } else {
                increment = sh - 1;
            }
            let offset_t = t.checked_sub(if corner & 1 != 0 { 0 } else { sh - 1 })?;
            let offset_s = current_s.checked_sub(if corner & 2 != 0 { sw - 1 } else { 0 })?;
            let (left, top) = if transposed {
                (offset_t, offset_s)
            } else {
                (offset_s, offset_t)
            };
            out.draw(&symbol, left, top, op, budget)?;
            count += 1;
            let delta = if let Some(h) = &mut huffman {
                h.delta_s.decode(&mut h.input, budget)?
            } else {
                decoder.integer("IADS", budget)?
            };
            let Some(delta) = delta else { break };
            current_s = current_s.checked_add(increment + i64::from(delta) + ds_offset)?;
        }
    }
    Some(out)
}

fn dictionary(
    reader: &mut Reader<'_>,
    mut symbols: Vec<Rc<Bitmap>>,
    custom: &[&Table],
    budget: &mut Budget,
) -> Option<Vec<Rc<Bitmap>>> {
    budget.alloc(4096)?;
    let flags = reader.uint(2)?;
    if flags & 256 != 0 || flags & 3 == 3 {
        return None;
    }
    let huffman = flags & 1 != 0;
    let template = (flags >> 10 & 3) as usize;
    let at = if huffman {
        vec![]
    } else {
        reader.at(if template == 0 { 4 } else { 1 })?
    };
    let refine = flags & 2 != 0;
    let refinement_template = (flags >> 12 & 1) as usize;
    let refinement_at = if refine && refinement_template == 0 {
        reader.at(2)?
    } else {
        vec![]
    };
    let exported = reader.uint(4)? as usize;
    let new_count = reader.uint(4)? as usize;
    let input_count = symbols.len();
    let total = input_count.checked_add(new_count)?;
    if exported > total {
        return None;
    }
    budget.alloc(total.checked_mul(32)?)?;
    if huffman {
        let mut index = 0;
        let dh = select_table(flags >> 2 & 3, 4, 2, custom, &mut index)?;
        let dw = select_table(flags >> 4 & 3, 2, 2, custom, &mut index)?;
        let size = if flags & 64 != 0 {
            let table = (*custom.get(index)?).clone();
            index += 1;
            table
        } else {
            Table::standard(1)?
        };
        // The aggregation selector still consumes its referred table even though
        // Huffman refinement is outside the reference decoder's supported scope.
        if flags & 128 != 0 {
            custom.get(index)?;
        }
        let export = Table::standard(1)?;
        let mut input = Bits {
            data: &reader.data[reader.pos..],
            pos: 0,
        };
        let mut height = 0i32;
        while symbols.len() < total {
            height = height.checked_add(dh.decode(&mut input, budget)??)?;
            let h = usize::try_from(height).ok()?;
            let mut widths = Vec::new();
            let mut width = 0i32;
            let mut full_width = 0usize;
            while let Some(delta) = dw.decode(&mut input, budget)? {
                if widths.len() >= total - symbols.len() {
                    return None;
                }
                width = width.checked_add(delta)?;
                let w = usize::try_from(width).ok()?;
                full_width = full_width.checked_add(w)?;
                budget.alloc(16)?;
                widths.push(w);
            }
            if widths.is_empty() {
                return None;
            }
            let size = usize::try_from(size.decode(&mut input, budget)??).ok()?;
            input.align();
            let collective = if size == 0 {
                let mut bitmap = Bitmap::new(full_width, h, 0, budget)?;
                for y in 0..h {
                    for x in 0..full_width {
                        bitmap.set(x, y, input.read(1)? as u8);
                    }
                    input.align();
                }
                bitmap
            } else {
                let end = (input.pos / 8).checked_add(size)?;
                let bitmap = mmr(input.data.get(input.pos / 8..end)?, full_width, h, budget)?;
                input.pos = end.checked_mul(8)?;
                bitmap
            };
            let mut left = 0;
            for width in widths {
                let mut bitmap = Bitmap::new(width, h, 0, budget)?;
                for y in 0..h {
                    for x in 0..width {
                        bitmap.set(x, y, collective.pixel((left + x) as i64, y as i64));
                    }
                }
                symbols.push(Rc::new(bitmap));
                left += width;
            }
        }
        let mut selected = false;
        let mut index = 0;
        let mut out = Vec::new();
        while index < total {
            budget.step(1)?;
            let run = usize::try_from(export.decode(&mut input, budget)??).ok()?;
            let end = index.checked_add(run)?;
            if end > total {
                return None;
            }
            if selected {
                out.extend(symbols[index..end].iter().cloned());
            }
            index = end;
            selected = !selected;
        }
        return (out.len() == exported).then_some(out);
    }
    let bits = code_length(total);
    let mut decoder = Arithmetic::new(&reader.data[reader.pos..])?;
    let mut height = 0i32;
    while symbols.len() < total {
        budget.step(1)?;
        height = height.checked_add(decoder.int("IADH", budget)?)?;
        let mut width = 0i32;
        while let Some(delta) = decoder.integer("IADW", budget)? {
            if symbols.len() >= total {
                return None;
            }
            width = width.checked_add(delta)?;
            let (w, h) = (usize::try_from(width).ok()?, usize::try_from(height).ok()?);
            let bitmap = if refine {
                let instances = decoder.int("IAAI", budget)?;
                if instances > 1 {
                    let params = Text {
                        flags: 2 | 16 | ((refinement_template as u32) << 15),
                        instances: instances as usize,
                        refinement_at: refinement_at.clone(),
                    };
                    text_region(w, h, &params, &symbols, bits, &mut decoder, None, budget)?
                } else if instances == 1 {
                    let id = decoder.id(bits, budget)?;
                    let dx = decoder.int("IARDX", budget)?;
                    let dy = decoder.int("IARDY", budget)?;
                    refinement(
                        w,
                        h,
                        refinement_template,
                        symbols.get(id)?,
                        (dx, dy),
                        &refinement_at,
                        &mut decoder,
                        budget,
                    )?
                } else {
                    return None;
                }
            } else {
                generic(w, h, template, false, &at, &mut decoder, budget)?
            };
            symbols.push(Rc::new(bitmap));
        }
    }
    let mut selected = false;
    let mut index = 0;
    let mut out = Vec::new();
    while index < total {
        budget.step(1)?;
        let run = usize::try_from(decoder.int("IAEX", budget)?).ok()?;
        let end = index.checked_add(run)?;
        if end > total {
            return None;
        }
        if selected {
            out.extend(symbols[index..end].iter().cloned());
        }
        index = end;
        selected = !selected;
    }
    if out.len() != exported {
        return None;
    }
    Some(out)
}

struct Patterns {
    bitmap: Bitmap,
    width: usize,
    height: usize,
    count: usize,
}
fn halftone(
    r: &mut Reader<'_>,
    width: usize,
    height: usize,
    patterns: &Patterns,
    budget: &mut Budget,
) -> Option<Bitmap> {
    let flags = r.uint(1)?;
    // Skip and non-OR halftone composition are unsupported by PDF.js as well.
    if flags & 0x78 != 0 {
        return None;
    }
    let template = (flags >> 1 & 3) as usize;
    let gw = r.uint(4)? as usize;
    let gh = r.uint(4)? as usize;
    let ox = r.uint(4)? as i32 as i64;
    let oy = r.uint(4)? as i32 as i64;
    let vx = r.uint(2)? as i64;
    let vy = r.uint(2)? as i64;
    let mut at = vec![(if template <= 1 { 3 } else { 2 }, -1)];
    if template == 0 {
        at.extend_from_slice(&[(-3, -1), (2, -2), (-2, -2)]);
    }
    let mut planes = Vec::new();
    let count = code_length(patterns.count);
    if flags & 1 != 0 {
        for _ in 0..count {
            let mut plane = Bitmap::new(gw, gh, 0, budget)?;
            let size = plane.data.len();
            plane.data = Vec::new();
            let (pixels, consumed) = super::fax::jbig2_plane(&r.data[r.pos..], gw, gh, size)?;
            plane.data = pixels;
            r.take(consumed)?;
            planes.push(plane);
        }
    } else if count != 0 {
        let mut decoder = Arithmetic::new(&r.data[r.pos..])?;
        for _ in 0..count {
            planes.push(generic(gw, gh, template, false, &at, &mut decoder, budget)?);
        }
    }
    let mut out = Bitmap::new(
        width,
        height,
        if flags & 128 != 0 { 255 } else { 0 },
        budget,
    )?;
    budget.step(
        gw.checked_mul(gh)?
            .checked_mul(patterns.width.checked_mul(patterns.height)?)?,
    )?;
    for m in 0..gh {
        for n in 0..gw {
            let mut index = 0;
            let mut bit = 0;
            for plane in &planes {
                bit ^= plane.pixel(n as i64, m as i64) as usize;
                index = index << 1 | bit;
            }
            if index >= patterns.count {
                return None;
            }
            let x = (ox + m as i64 * vy + n as i64 * vx) >> 8;
            let y = (oy + m as i64 * vx - n as i64 * vy) >> 8;
            for py in 0..patterns.height {
                for px in 0..patterns.width {
                    let (dx, dy) = (x + px as i64, y + py as i64);
                    if dx >= 0 && dy >= 0 && dx < width as i64 && dy < height as i64 {
                        let pixel = patterns
                            .bitmap
                            .pixel((index * patterns.width + px) as i64, py as i64);
                        out.set(dx as usize, dy as usize, out.pixel(dx, dy) | pixel);
                    }
                }
            }
        }
    }
    Some(out)
}

pub(super) fn decode(
    data: &[u8],
    globals: Option<&[u8]>,
    width: usize,
    height: usize,
    limit: usize,
) -> Option<Vec<u8>> {
    let mut budget = Budget {
        bytes: limit,
        work: limit.saturating_mul(32),
    };
    let mut symbols: BTreeMap<u32, Vec<Rc<Bitmap>>> = BTreeMap::new();
    let mut tables = BTreeMap::new();
    let mut patterns = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut page = None;
    let mut page_flags = 0;
    for chunk in globals.into_iter().chain(std::iter::once(data)) {
        let mut input = Reader {
            data: chunk,
            pos: 0,
        };
        while input.pos < input.data.len() {
            budget.step(1)?;
            let number = input.uint(4)?;
            let flags = input.uint(1)?;
            let kind = flags & 63;
            let count_flags = input.uint(1)?;
            let mut count = count_flags >> 5;
            if count == 7 {
                input.pos -= 1;
                count = input.uint(4)? & 0x1fffffff;
                input.take((count as usize + 1).div_ceil(8))?;
            } else if count > 4 {
                return None;
            }
            budget.alloc((count as usize).checked_mul(32)?.checked_add(256)?)?;
            let mut refs = Vec::new();
            for _ in 0..count {
                refs.push(input.uint(if number <= 256 {
                    1
                } else if number <= 65536 {
                    2
                } else {
                    4
                })?);
            }
            if refs.iter().any(|id| !seen.contains(id)) || !seen.insert(number) {
                return None;
            }
            input.uint(if flags & 64 != 0 { 4 } else { 1 })?;
            let len = input.uint(4)? as usize;
            let payload = input.take(len)?;
            let mut r = Reader {
                data: payload,
                pos: 0,
            };
            match kind {
                0 => {
                    let mut imported = Vec::new();
                    for id in &refs {
                        if let Some(list) = symbols.get(id) {
                            budget.alloc(list.len().checked_mul(16)?)?;
                            imported.extend(list.iter().cloned());
                        }
                    }
                    let custom: Vec<&Table> = refs.iter().filter_map(|id| tables.get(id)).collect();
                    let decoded = dictionary(&mut r, imported, &custom, &mut budget)?;
                    if symbols.insert(number, decoded).is_some() {
                        return None;
                    }
                }
                16 => {
                    let flags = r.uint(1)?;
                    let pw = r.uint(1)? as usize;
                    let ph = r.uint(1)? as usize;
                    let count = (r.uint(4)? as usize).checked_add(1)?;
                    let width = pw.checked_mul(count)?;
                    if pw == 0 || ph == 0 {
                        return None;
                    }
                    let template = (flags >> 1 & 3) as usize;
                    let bitmap = if flags & 1 != 0 {
                        mmr(&r.data[r.pos..], width, ph, &mut budget)?
                    } else {
                        let mut at = vec![(-(pw as i32), 0)];
                        if template == 0 {
                            at.extend_from_slice(&[(-3, -1), (2, -2), (-2, -2)]);
                        }
                        generic(
                            width,
                            ph,
                            template,
                            false,
                            &at,
                            &mut Arithmetic::new(&r.data[r.pos..])?,
                            &mut budget,
                        )?
                    };
                    if patterns
                        .insert(
                            number,
                            Patterns {
                                bitmap,
                                width: pw,
                                height: ph,
                                count,
                            },
                        )
                        .is_some()
                    {
                        return None;
                    }
                }
                6 | 7 | 22 | 23 | 38 | 39 => {
                    let (w, h, x, y, op) = (
                        r.uint(4)? as usize,
                        r.uint(4)? as usize,
                        r.uint(4)? as i64,
                        r.uint(4)? as i64,
                        r.uint(1)? & 7,
                    );
                    let bitmap = if kind == 38 || kind == 39 {
                        let flags = r.uint(1)?;
                        if flags & 1 != 0 {
                            mmr(&r.data[r.pos..], w, h, &mut budget)?
                        } else {
                            let template = (flags >> 1 & 3) as usize;
                            let at = r.at(if template == 0 { 4 } else { 1 })?;
                            generic(
                                w,
                                h,
                                template,
                                flags & 8 != 0,
                                &at,
                                &mut Arithmetic::new(&r.data[r.pos..])?,
                                &mut budget,
                            )?
                        }
                    } else if kind == 22 || kind == 23 {
                        halftone(&mut r, w, h, patterns.get(refs.first()?)?, &mut budget)?
                    } else {
                        let flags = r.uint(2)?;
                        let huffman_flags = if flags & 1 != 0 { r.uint(2)? } else { 0 };
                        let refinement_at = if flags & 2 != 0 && flags & 0x8000 == 0 {
                            r.at(2)?
                        } else {
                            vec![]
                        };
                        let params = Text {
                            flags,
                            instances: r.uint(4)? as usize,
                            refinement_at,
                        };
                        let mut imported = Vec::new();
                        for id in &refs {
                            if let Some(list) = symbols.get(id) {
                                budget.alloc(list.len().checked_mul(16)?)?;
                                imported.extend(list.iter().cloned());
                            }
                        }
                        let huffman = if flags & 1 != 0 {
                            let custom: Vec<&Table> =
                                refs.iter().filter_map(|id| tables.get(id)).collect();
                            let mut index = 0;
                            let mut input = Bits {
                                data: &r.data[r.pos..],
                                pos: 0,
                            };
                            let ids = Table::symbols(&mut input, imported.len(), &mut budget)?;
                            Some(TextHuffman {
                                input,
                                ids,
                                first: select_table(huffman_flags & 3, 6, 2, &custom, &mut index)?,
                                delta_s: select_table(
                                    huffman_flags >> 2 & 3,
                                    8,
                                    3,
                                    &custom,
                                    &mut index,
                                )?,
                                delta_t: select_table(
                                    huffman_flags >> 4 & 3,
                                    11,
                                    3,
                                    &custom,
                                    &mut index,
                                )?,
                            })
                        } else {
                            None
                        };
                        text_region(
                            w,
                            h,
                            &params,
                            &imported,
                            code_length(imported.len()),
                            &mut Arithmetic::new(&r.data[r.pos..])?,
                            huffman,
                            &mut budget,
                        )?
                    };
                    let target: &mut Bitmap = page.as_mut()?;
                    target.draw(
                        &bitmap,
                        x,
                        y,
                        if page_flags & 64 != 0 {
                            op
                        } else {
                            page_flags >> 3 & 3
                        },
                        &mut budget,
                    )?;
                }
                48 => {
                    if page.is_some()
                        || r.uint(4)? as usize != width
                        || r.uint(4)? as usize != height
                    {
                        return None;
                    }
                    r.take(8)?;
                    page_flags = r.uint(1)?;
                    r.take(2)?;
                    page = Some(Bitmap::new(
                        width,
                        height,
                        if page_flags & 4 != 0 { 255 } else { 0 },
                        &mut budget,
                    )?);
                }
                49 | 50 | 51 | 62 => {}
                53 => {
                    if tables
                        .insert(number, Table::custom(&mut r, &mut budget)?)
                        .is_some()
                    {
                        return None;
                    }
                }
                _ => return None,
            }
        }
    }
    Some(page?.data)
}

#[cfg(test)]
mod tests {
    use super::*;
    const GENERIC: &[u8] = include_bytes!("../../../pdf-ast/src/fixtures/jbig2-generic-stream.bin");
    const SYMBOLS: &[u8] = include_bytes!("../../../pdf-ast/src/fixtures/jbig2-symbols.0000");
    const GLOBALS: &[u8] = include_bytes!("../../../pdf-ast/src/fixtures/jbig2-symbols.sym");

    #[test]
    fn images_reject_truncated_headers_dimensions_and_budget_exhaustion() {
        assert!(decode(GENERIC, None, 64, 32, 1 << 20).is_some());
        assert!(decode(SYMBOLS, Some(GLOBALS), 64, 32, 1 << 20).is_some());
        assert!(decode(GENERIC, None, 63, 32, 1 << 20).is_none());
        assert!(decode(GENERIC, None, 64, 32, 1024).is_none());
        for length in 0..30 {
            assert!(decode(&GENERIC[..length], None, 64, 32, 1 << 20).is_none());
        }
        assert!(decode(&GENERIC[..GENERIC.len() - 1], None, 64, 32, 1 << 20).is_none());
        let mut data = GENERIC.to_vec();
        data[35] = 5 << 5;
        assert!(decode(&data, None, 64, 32, 1 << 20).is_none());
        data.copy_from_slice(GENERIC);
        data[37..41].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(decode(&data, None, 64, 32, 1 << 20).is_none());
    }
    #[test]
    fn symbol_references_must_exist_and_cannot_be_self_referential() {
        assert!(decode(SYMBOLS, None, 64, 32, 1 << 20).is_none());
        let mut data = SYMBOLS.to_vec();
        // Text segment 2 refers to global dictionary 0 in the original stream.
        data[36] = 2;
        assert!(decode(&data, Some(GLOBALS), 64, 32, 1 << 20).is_none());
    }
    #[test]
    fn zero_area_and_large_bitmaps_are_rejected_before_work() {
        let mut budget = Budget {
            bytes: 1024,
            work: 1024,
        };
        assert!(Bitmap::new(0, i32::MAX as usize, 0, &mut budget).is_none());
        assert!(Bitmap::new(usize::MAX, 2, 0, &mut budget).is_none());
        assert!(Bitmap::new(64, 64, 0, &mut budget).is_none());
    }
}
