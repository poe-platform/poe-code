// SPDX-License-Identifier: 0BSD
// XZ BCJ transforms: Igor Pavlov, Lasse Collin, Jia Tan (XZ Utils v5.8.3).

pub(super) enum Filter {
    Delta(usize),
    X86(u32),
    Arm64(u32),
}

impl Filter {
    pub(super) fn from_header(id: u64, props: &[u8]) -> Option<Self> {
        match (id, props) {
            (3, [n]) => Some(Self::Delta(usize::from(*n) + 1)),
            (4 | 10, _) => {
                let start = if props.is_empty() {
                    0
                } else {
                    u32::from_le_bytes(props.try_into().ok()?)
                };
                if id == 4 {
                    Some(Self::X86(start))
                } else if start % 4 == 0 {
                    Some(Self::Arm64(start))
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    pub(super) fn decode(&self, data: &mut [u8]) {
        match *self {
            Self::Delta(distance) => {
                for i in distance..data.len() {
                    data[i] = data[i].wrapping_add(data[i - distance]);
                }
            }
            Self::X86(start) => x86(data, start),
            Self::Arm64(start) => arm64(data, start),
        }
    }
}

fn x86(data: &mut [u8], start: u32) {
    let mut mask = 0usize;
    let mut previous = start.wrapping_sub(5);
    let mut i = 0;
    while data.len() - i >= 5 {
        if !matches!(data[i], 0xe8 | 0xe9) {
            i += 1;
            continue;
        }
        let pc = start.wrapping_add(i as u32);
        let gap = pc.wrapping_sub(previous);
        previous = pc;
        if gap > 5 {
            mask = 0;
        } else {
            for _ in 0..gap {
                mask = (mask & 0x77) << 1;
            }
        }

        let high = matches!(data[i + 4], 0 | 0xff);
        if !high || mask >> 1 > 4 || mask >> 1 == 3 {
            mask |= if high { 0x11 } else { 1 };
            i += 1;
            continue;
        }
        let mut src = u32::from_le_bytes(data[i + 1..i + 5].try_into().unwrap());
        let dest = loop {
            let dest = src.wrapping_sub(pc.wrapping_add(5));
            if mask == 0 {
                break dest;
            }
            let shift = [0, 8, 16, 16, 24][mask >> 1];
            if !matches!((dest >> (24 - shift)) as u8, 0 | 0xff) {
                break dest;
            }
            src = dest ^ (u32::MAX >> shift);
        };
        let signed = ((dest << 7) as i32) >> 7;
        data[i + 1..i + 5].copy_from_slice(&signed.to_le_bytes());
        i += 5;
        mask = 0;
    }
}

fn arm64(data: &mut [u8], start: u32) {
    for (i, word) in data.chunks_exact_mut(4).enumerate() {
        let pc = start.wrapping_add((i as u32).wrapping_mul(4));
        let instr = u32::from_le_bytes((*word).try_into().unwrap());
        let result = if instr >> 26 == 0x25 {
            0x94000000 | (instr.wrapping_sub(pc >> 2) & 0x03ffffff)
        } else if instr & 0x9f000000 == 0x90000000 {
            let src = (instr >> 29 & 3) | (instr >> 3 & 0x001ffffc);
            if (src + 0x20000) & 0x1c0000 != 0 {
                continue;
            }
            let dest = src.wrapping_sub(pc >> 12);
            (instr & 0x9000001f)
                | ((dest & 3) << 29)
                | ((dest & 0x3fffc) << 3)
                | ((dest & 0x20000).wrapping_neg() & 0xe00000)
        } else {
            continue;
        };
        word.copy_from_slice(&result.to_le_bytes());
    }
}
