// T.88 Annex B Huffman tables, shared with pdf-ast's PDF.js decoder.
use super::{Budget, Reader};
use std::rc::Rc;
#[derive(Clone)]
pub(super) struct Table {
    lines: Rc<[(i64, u32, u32, u32, u8)]>,
}
pub(super) struct Bits<'a> {
    pub data: &'a [u8],
    pub pos: usize,
}
impl Bits<'_> {
    pub fn read(&mut self, n: u32) -> Option<u32> {
        if n > 32 {
            return None;
        }
        let mut out = 0;
        for _ in 0..n {
            out = out << 1 | u32::from((*self.data.get(self.pos / 8)? >> (7 - self.pos % 8)) & 1);
            self.pos = self.pos.checked_add(1)?;
        }
        Some(out)
    }
    pub fn align(&mut self) {
        self.pos = self.pos.div_ceil(8) * 8;
    }
}
impl Table {
    pub fn standard(number: u32) -> Option<Self> {
        let lines: &[(i64, u32, u32, u32, u8)] = match number {
            1 => &[
                (0, 1, 4, 0, 0),
                (16, 2, 8, 2, 0),
                (272, 3, 16, 6, 0),
                (65808, 3, 32, 7, 0),
            ],
            2 => &[
                (0, 1, 0, 0, 0),
                (1, 2, 0, 2, 0),
                (2, 3, 0, 6, 0),
                (3, 4, 3, 14, 0),
                (11, 5, 6, 30, 0),
                (75, 6, 32, 62, 0),
                (0, 6, 0, 63, 2),
            ],
            3 => &[
                (-256, 8, 8, 254, 0),
                (0, 1, 0, 0, 0),
                (1, 2, 0, 2, 0),
                (2, 3, 0, 6, 0),
                (3, 4, 3, 14, 0),
                (11, 5, 6, 30, 0),
                (-257, 8, 32, 255, 1),
                (75, 7, 32, 126, 0),
                (0, 6, 0, 62, 2),
            ],
            4 => &[
                (1, 1, 0, 0, 0),
                (2, 2, 0, 2, 0),
                (3, 3, 0, 6, 0),
                (4, 4, 3, 14, 0),
                (12, 5, 6, 30, 0),
                (76, 5, 32, 31, 0),
            ],
            5 => &[
                (-255, 7, 8, 126, 0),
                (1, 1, 0, 0, 0),
                (2, 2, 0, 2, 0),
                (3, 3, 0, 6, 0),
                (4, 4, 3, 14, 0),
                (12, 5, 6, 30, 0),
                (-256, 7, 32, 127, 1),
                (76, 6, 32, 62, 0),
            ],
            6 => &[
                (-2048, 5, 10, 28, 0),
                (-1024, 4, 9, 8, 0),
                (-512, 4, 8, 9, 0),
                (-256, 4, 7, 10, 0),
                (-128, 5, 6, 29, 0),
                (-64, 5, 5, 30, 0),
                (-32, 4, 5, 11, 0),
                (0, 2, 7, 0, 0),
                (128, 3, 7, 2, 0),
                (256, 3, 8, 3, 0),
                (512, 4, 9, 12, 0),
                (1024, 4, 10, 13, 0),
                (-2049, 6, 32, 62, 1),
                (2048, 6, 32, 63, 0),
            ],
            7 => &[
                (-1024, 4, 9, 8, 0),
                (-512, 3, 8, 0, 0),
                (-256, 4, 7, 9, 0),
                (-128, 5, 6, 26, 0),
                (-64, 5, 5, 27, 0),
                (-32, 4, 5, 10, 0),
                (0, 4, 5, 11, 0),
                (32, 5, 5, 28, 0),
                (64, 5, 6, 29, 0),
                (128, 4, 7, 12, 0),
                (256, 3, 8, 1, 0),
                (512, 3, 9, 2, 0),
                (1024, 3, 10, 3, 0),
                (-1025, 5, 32, 30, 1),
                (2048, 5, 32, 31, 0),
            ],
            8 => &[
                (-15, 8, 3, 252, 0),
                (-7, 9, 1, 508, 0),
                (-5, 8, 1, 253, 0),
                (-3, 9, 0, 509, 0),
                (-2, 7, 0, 124, 0),
                (-1, 4, 0, 10, 0),
                (0, 2, 1, 0, 0),
                (2, 5, 0, 26, 0),
                (3, 6, 0, 58, 0),
                (4, 3, 4, 4, 0),
                (20, 6, 1, 59, 0),
                (22, 4, 4, 11, 0),
                (38, 4, 5, 12, 0),
                (70, 5, 6, 27, 0),
                (134, 5, 7, 28, 0),
                (262, 6, 7, 60, 0),
                (390, 7, 8, 125, 0),
                (646, 6, 10, 61, 0),
                (-16, 9, 32, 510, 1),
                (1670, 9, 32, 511, 0),
                (0, 2, 0, 1, 2),
            ],
            9 => &[
                (-31, 8, 4, 252, 0),
                (-15, 9, 2, 508, 0),
                (-11, 8, 2, 253, 0),
                (-7, 9, 1, 509, 0),
                (-5, 7, 1, 124, 0),
                (-3, 4, 1, 10, 0),
                (-1, 3, 1, 2, 0),
                (1, 3, 1, 3, 0),
                (3, 5, 1, 26, 0),
                (5, 6, 1, 58, 0),
                (7, 3, 5, 4, 0),
                (39, 6, 2, 59, 0),
                (43, 4, 5, 11, 0),
                (75, 4, 6, 12, 0),
                (139, 5, 7, 27, 0),
                (267, 5, 8, 28, 0),
                (523, 6, 8, 60, 0),
                (779, 7, 9, 125, 0),
                (1291, 6, 11, 61, 0),
                (-32, 9, 32, 510, 1),
                (3339, 9, 32, 511, 0),
                (0, 2, 0, 0, 2),
            ],
            10 => &[
                (-21, 7, 4, 122, 0),
                (-5, 8, 0, 252, 0),
                (-4, 7, 0, 123, 0),
                (-3, 5, 0, 24, 0),
                (-2, 2, 2, 0, 0),
                (2, 5, 0, 25, 0),
                (3, 6, 0, 54, 0),
                (4, 7, 0, 124, 0),
                (5, 8, 0, 253, 0),
                (6, 2, 6, 1, 0),
                (70, 5, 5, 26, 0),
                (102, 6, 5, 55, 0),
                (134, 6, 6, 56, 0),
                (198, 6, 7, 57, 0),
                (326, 6, 8, 58, 0),
                (582, 6, 9, 59, 0),
                (1094, 6, 10, 60, 0),
                (2118, 7, 11, 125, 0),
                (-22, 8, 32, 254, 1),
                (4166, 8, 32, 255, 0),
                (0, 2, 0, 2, 2),
            ],
            11 => &[
                (1, 1, 0, 0, 0),
                (2, 2, 1, 2, 0),
                (4, 4, 0, 12, 0),
                (5, 4, 1, 13, 0),
                (7, 5, 1, 28, 0),
                (9, 5, 2, 29, 0),
                (13, 6, 2, 60, 0),
                (17, 7, 2, 122, 0),
                (21, 7, 3, 123, 0),
                (29, 7, 4, 124, 0),
                (45, 7, 5, 125, 0),
                (77, 7, 6, 126, 0),
                (141, 7, 32, 127, 0),
            ],
            12 => &[
                (1, 1, 0, 0, 0),
                (2, 2, 0, 2, 0),
                (3, 3, 1, 6, 0),
                (5, 5, 0, 28, 0),
                (6, 5, 1, 29, 0),
                (8, 6, 1, 60, 0),
                (10, 7, 0, 122, 0),
                (11, 7, 1, 123, 0),
                (13, 7, 2, 124, 0),
                (17, 7, 3, 125, 0),
                (25, 7, 4, 126, 0),
                (41, 8, 5, 254, 0),
                (73, 8, 32, 255, 0),
            ],
            13 => &[
                (1, 1, 0, 0, 0),
                (2, 3, 0, 4, 0),
                (3, 4, 0, 12, 0),
                (4, 5, 0, 28, 0),
                (5, 4, 1, 13, 0),
                (7, 3, 3, 5, 0),
                (15, 6, 1, 58, 0),
                (17, 6, 2, 59, 0),
                (21, 6, 3, 60, 0),
                (29, 6, 4, 61, 0),
                (45, 6, 5, 62, 0),
                (77, 7, 6, 126, 0),
                (141, 7, 32, 127, 0),
            ],
            14 => &[
                (-2, 3, 0, 4, 0),
                (-1, 3, 0, 5, 0),
                (0, 1, 0, 0, 0),
                (1, 3, 0, 6, 0),
                (2, 3, 0, 7, 0),
            ],
            15 => &[
                (-24, 7, 4, 124, 0),
                (-8, 6, 2, 60, 0),
                (-4, 5, 1, 28, 0),
                (-2, 4, 0, 12, 0),
                (-1, 3, 0, 4, 0),
                (0, 1, 0, 0, 0),
                (1, 3, 0, 5, 0),
                (2, 4, 0, 13, 0),
                (3, 5, 1, 29, 0),
                (5, 6, 2, 61, 0),
                (9, 7, 4, 125, 0),
                (-25, 7, 32, 126, 1),
                (25, 7, 32, 127, 0),
            ],
            _ => return None,
        };
        Some(Self {
            lines: lines.into(),
        })
    }
    pub fn canonical(mut lines: Vec<(i64, u32, u32, u32, u8)>) -> Option<Self> {
        let mut counts = [0u64; 33];
        for line in &lines {
            *counts.get_mut(line.1 as usize)? += 1;
        }
        counts[0] = 0;
        let mut code = 0u64;
        for length in 1..=32 {
            code = (code + counts[length - 1]) << 1;
            if code + counts[length] > 1u64 << length {
                return None;
            }
            let mut next = code;
            for line in &mut lines {
                if line.1 == length as u32 {
                    line.3 = next as u32;
                    next += 1;
                }
            }
        }
        Some(Self {
            lines: lines.into(),
        })
    }
    pub fn decode(&self, input: &mut Bits<'_>, budget: &mut Budget) -> Option<Option<i32>> {
        let mut prefix = 0;
        for length in 1..=32 {
            prefix = prefix << 1 | input.read(1)?;
            budget.step(self.lines.len())?;
            if let Some(&(low, _, range, _, flags)) = self
                .lines
                .iter()
                .find(|line| line.1 == length && line.3 == prefix)
            {
                if flags == 2 {
                    return Some(None);
                }
                let offset = i64::from(input.read(range)?);
                return Some(Some(
                    i32::try_from(low + if flags == 1 { -offset } else { offset }).ok()?,
                ));
            }
        }
        None
    }
    pub fn custom(reader: &mut Reader<'_>, budget: &mut Budget) -> Option<Self> {
        let flags = reader.uint(1)?;
        let low = reader.uint(4)? as i32 as i64;
        let high = reader.uint(4)? as i32 as i64;
        if high <= low {
            return None;
        }
        let mut input = Bits {
            data: &reader.data[reader.pos..],
            pos: 0,
        };
        let prefix_bits = (flags >> 1 & 7) + 1;
        let range_bits = (flags >> 4 & 7) + 1;
        let mut lines = Vec::new();
        let mut value = low;
        while value < high {
            budget.alloc(64)?;
            budget.step(1)?;
            let prefix = input.read(prefix_bits)?;
            let range = input.read(range_bits)?;
            if range > 32 {
                return None;
            }
            lines.push((value, prefix, range, 0, 0));
            value += 1i64 << range;
        }
        lines.push((low - 1, input.read(prefix_bits)?, 32, 0, 1));
        lines.push((high, input.read(prefix_bits)?, 32, 0, 0));
        if flags & 1 != 0 {
            lines.push((0, input.read(prefix_bits)?, 0, 0, 2));
        }
        Self::canonical(lines)
    }
    pub fn symbols(input: &mut Bits<'_>, count: usize, budget: &mut Budget) -> Option<Self> {
        budget.alloc(count.checked_mul(64)?.checked_add(35 * 64 + 2048)?)?;
        let mut lengths = Vec::new();
        for i in 0..35 {
            lengths.push((i, input.read(4)?, 0, 0, 0));
        }
        let runs = Self::canonical(lengths)?;
        let mut lines: Vec<(i64, u32, u32, u32, u8)> = Vec::new();
        while lines.len() < count {
            let code = runs.decode(input, budget)??;
            let (length, run) = match code {
                0..=31 => (code as u32, 1),
                32 => (lines.last()?.1, input.read(2)? as usize + 3),
                33 => (0, input.read(3)? as usize + 3),
                34 => (0, input.read(7)? as usize + 11),
                _ => return None,
            };
            if run > count - lines.len() {
                return None;
            }
            for _ in 0..run {
                lines.push((lines.len() as i64, length, 0, 0, 0));
            }
        }
        input.align();
        Self::canonical(lines)
    }
}
