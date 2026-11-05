// ITU-T T.4 run codes, used by horizontal mode in T.6 (Group 4).
// Each code has a leading sentinel bit so leading zeroes retain their length.
// Entries 0..64 terminate a run; entries 64..104 add multiples of 64.
const WHITE: [u16; 104] = [
    0x135, 0x47, 0x17, 0x18, 0x1b, 0x1c, 0x1e, 0x1f, 0x33, 0x34, 0x27, 0x28, 0x48, 0x43, 0x74,
    0x75, 0x6a, 0x6b, 0xa7, 0x8c, 0x88, 0x97, 0x83, 0x84, 0xa8, 0xab, 0x93, 0xa4, 0x98, 0x102,
    0x103, 0x11a, 0x11b, 0x112, 0x113, 0x114, 0x115, 0x116, 0x117, 0x128, 0x129, 0x12a, 0x12b,
    0x12c, 0x12d, 0x104, 0x105, 0x10a, 0x10b, 0x152, 0x153, 0x154, 0x155, 0x124, 0x125, 0x158,
    0x159, 0x15a, 0x15b, 0x14a, 0x14b, 0x132, 0x133, 0x134, 0x3b, 0x32, 0x57, 0xb7, 0x136, 0x137,
    0x164, 0x165, 0x168, 0x167, 0x2cc, 0x2cd, 0x2d2, 0x2d3, 0x2d4, 0x2d5, 0x2d6, 0x2d7, 0x2d8,
    0x2d9, 0x2da, 0x2db, 0x298, 0x299, 0x29a, 0x58, 0x29b, 0x808, 0x80c, 0x80d, 0x1012, 0x1013,
    0x1014, 0x1015, 0x1016, 0x1017, 0x101c, 0x101d, 0x101e, 0x101f,
];
const BLACK: [u16; 104] = [
    0x437, 0xa, 0x7, 0x6, 0xb, 0x13, 0x12, 0x23, 0x45, 0x44, 0x84, 0x85, 0x87, 0x104, 0x107, 0x218,
    0x417, 0x418, 0x408, 0x867, 0x868, 0x86c, 0x837, 0x828, 0x817, 0x818, 0x10ca, 0x10cb, 0x10cc,
    0x10cd, 0x1068, 0x1069, 0x106a, 0x106b, 0x10d2, 0x10d3, 0x10d4, 0x10d5, 0x10d6, 0x10d7, 0x106c,
    0x106d, 0x10da, 0x10db, 0x1054, 0x1055, 0x1056, 0x1057, 0x1064, 0x1065, 0x1052, 0x1053, 0x1024,
    0x1037, 0x1038, 0x1027, 0x1028, 0x1058, 0x1059, 0x102b, 0x102c, 0x105a, 0x1066, 0x1067, 0x40f,
    0x10c8, 0x10c9, 0x105b, 0x1033, 0x1034, 0x1035, 0x206c, 0x206d, 0x204a, 0x204b, 0x204c, 0x204d,
    0x2072, 0x2073, 0x2074, 0x2075, 0x2076, 0x2077, 0x2052, 0x2053, 0x2054, 0x2055, 0x205a, 0x205b,
    0x2064, 0x2065, 0x808, 0x80c, 0x80d, 0x1012, 0x1013, 0x1014, 0x1015, 0x1016, 0x1017, 0x101c,
    0x101d, 0x101e, 0x101f,
];

type Tree = [[i16; 2]; 256];
const fn tree(codes: &[u16; 104]) -> Tree {
    let mut nodes = [[0; 2]; 256];
    let mut next = 1;
    let mut i = 0;
    while i < codes.len() {
        let code = codes[i];
        let mut bit = 1 << (code.ilog2() - 1);
        let mut node = 0;
        while bit > 1 {
            let branch = (code & bit != 0) as usize;
            if nodes[node][branch] == 0 {
                nodes[node][branch] = next;
                next += 1;
            }
            node = nodes[node][branch] as usize;
            bit >>= 1;
        }
        nodes[node][(code & 1) as usize] = -1 - i as i16;
        i += 1;
    }
    nodes
}
const RUNS: [Tree; 2] = [tree(&WHITE), tree(&BLACK)];

struct Bits<'a> {
    bytes: &'a [u8],
    pos: usize,
    lsb: bool,
}
impl Bits<'_> {
    fn bit(&mut self) -> Option<usize> {
        let b = *self.bytes.get(self.pos / 8)?;
        let shift = if self.lsb {
            self.pos % 8
        } else {
            7 - self.pos % 8
        };
        self.pos = self.pos.checked_add(1)?;
        Some(((b >> shift) & 1) as usize)
    }

    fn run(&mut self, black: bool, remaining: usize) -> Option<usize> {
        let tree = &RUNS[black as usize];
        let mut total = 0usize;
        loop {
            let mut node = 0;
            let index = loop {
                let child = tree[node][self.bit()?];
                if child < 0 {
                    break (-1 - child) as usize;
                }
                if child == 0 {
                    return None;
                }
                node = child as usize;
            };
            total = total.checked_add(if index < 64 { index } else { (index - 63) * 64 })?;
            if total > remaining {
                return None;
            }
            if index < 64 {
                return Some(total);
            }
        }
    }
}

fn paint(line: &mut [u8], start: usize, end: usize, black: bool) {
    if black {
        for x in start..end {
            line[x / 8] |= 128 >> (x % 8);
        }
    }
}

pub(super) fn decode(
    data: &[u8],
    width: usize,
    bytes: usize,
    lsb: bool,
    limit: usize,
) -> Option<Vec<u8>> {
    if width == 0 || bytes > limit || !bytes.is_multiple_of(width.div_ceil(8)) {
        return None;
    }
    let mut bits = Bits {
        bytes: data,
        pos: 0,
        lsb,
    };
    let mut out = vec![0; bytes];
    let mut previous: &[u8] = &[];
    for line in out.chunks_exact_mut(width.div_ceil(8)) {
        let mut last = false;
        let mut changes = (0..if previous.is_empty() { 0 } else { width })
            .filter(|&x| {
                let black = previous[x / 8] & (128 >> (x % 8)) != 0;
                let changed = black != last;
                last = black;
                changed
            })
            .peekable();
        let mut b = changes.next().unwrap_or(width);
        let mut next = changes.next().unwrap_or(width);
        let mut b_black = true;
        let mut x = 0usize;
        let mut first = true;
        let mut black = false;
        while x < width {
            while b <= x && !first {
                b = next;
                next = changes.next().unwrap_or(width);
                b_black = !b_black;
            }
            let (b1, b2) = if b_black != black {
                (b, next)
            } else {
                (next, *changes.peek().unwrap_or(&width))
            };
            let mut zeros = 0;
            while bits.bit()? == 0 {
                zeros += 1;
                if zeros > 5 {
                    return None;
                } // Extension, premature EOFB or invalid mode.
            }
            match zeros {
                2 => {
                    let middle = x + bits.run(black, width - x)?;
                    let end = middle + bits.run(!black, width - middle)?;
                    if end == x {
                        return None;
                    }
                    paint(line, x, middle, black);
                    paint(line, middle, end, !black);
                    x = end;
                }
                3 => {
                    paint(line, x, b2, black);
                    x = b2;
                }
                _ => {
                    let delta = match zeros {
                        0 => 0,
                        1 => 1,
                        4 => 2,
                        _ => 3,
                    };
                    let end = if delta == 0 {
                        b1
                    } else if bits.bit()? == 1 {
                        b1.checked_add(delta)?
                    } else {
                        b1.checked_sub(delta)?
                    };
                    if end > width || end < x || end == x && !first {
                        return None;
                    }
                    paint(line, x, end, black);
                    x = end;
                    black = !black;
                }
            }
            first = false;
        }
        previous = line;
    }
    Some(out)
}
