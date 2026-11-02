// SPDX-License-Identifier: 0BSD
// XZ BCJ transforms: Igor Pavlov, Lasse Collin, Jia Tan (XZ Utils v5.8.3).

pub(super) enum Filter {
    Delta(usize),
    X86(u32),
    PowerPc(u32),
    Ia64(u32),
    Arm(u32),
    Thumb(u32),
    Sparc(u32),
    Arm64(u32),
}

impl Filter {
    pub(super) fn from_header(id: u64, props: &[u8]) -> Option<Self> {
        match (id, props) {
            (3, [n]) => Some(Self::Delta(usize::from(*n) + 1)),
            (4..=10, _) => {
                let start = if props.is_empty() {
                    0
                } else {
                    u32::from_le_bytes(props.try_into().ok()?)
                };
                match id {
                    4 => Some(Self::X86(start)),
                    5 if start % 4 == 0 => Some(Self::PowerPc(start)),
                    6 if start % 16 == 0 => Some(Self::Ia64(start)),
                    7 if start % 4 == 0 => Some(Self::Arm(start)),
                    8 if start % 2 == 0 => Some(Self::Thumb(start)),
                    9 if start % 4 == 0 => Some(Self::Sparc(start)),
                    10 if start % 4 == 0 => Some(Self::Arm64(start)),
                    _ => None,
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
            Self::PowerPc(start) => {
                for (i, word) in data.chunks_exact_mut(4).enumerate() {
                    let instr = u32::from_be_bytes((*word).try_into().unwrap());
                    if instr & 0xfc000003 == 0x48000001 {
                        let pc = start.wrapping_add((i as u32).wrapping_mul(4));
                        word.copy_from_slice(
                            &(0x48000001 | (instr.wrapping_sub(pc) & 0x03fffffc)).to_be_bytes(),
                        );
                    }
                }
            }
            Self::Arm(start) => {
                let mut pc = start.wrapping_add(8);
                for word in data.chunks_exact_mut(4) {
                    if word[3] == 0xeb {
                        let dest =
                            u32::from_le_bytes((*word).try_into().unwrap()).wrapping_sub(pc >> 2);
                        word[..3].copy_from_slice(&dest.to_le_bytes()[..3]);
                    }
                    pc = pc.wrapping_add(4);
                }
            }
            Self::Sparc(start) => {
                for (i, word) in data.chunks_exact_mut(4).enumerate() {
                    let instr = u32::from_be_bytes((*word).try_into().unwrap());
                    if matches!(instr >> 22, 0x100 | 0x1ff) {
                        let dest = instr.wrapping_sub((start >> 2).wrapping_add(i as u32));
                        let signed = ((dest << 9) as i32 >> 9) as u32;
                        word.copy_from_slice(&(0x40000000 | (signed & 0x3fffffff)).to_be_bytes());
                    }
                }
            }
            Self::Thumb(start) => thumb(data, start),
            Self::Ia64(start) => ia64(data, start),
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

fn thumb(data: &mut [u8], start: u32) {
    let mut i = 0;
    while data.len() - i >= 4 {
        if data[i + 1] & 0xf8 != 0xf0 || data[i + 3] & 0xf8 != 0xf8 {
            i += 2;
            continue;
        }
        let hi = u16::from_le_bytes([data[i], data[i + 1]]) & 0x7ff;
        let lo = u16::from_le_bytes([data[i + 2], data[i + 3]]) & 0x7ff;
        let pc = start.wrapping_add(i as u32).wrapping_add(4);
        let dest = ((u32::from(hi) << 11) | u32::from(lo)).wrapping_sub(pc >> 1);
        data[i..i + 2].copy_from_slice(&(0xf000 | ((dest >> 11) as u16 & 0x7ff)).to_le_bytes());
        data[i + 2..i + 4].copy_from_slice(&(0xf800 | (dest as u16 & 0x7ff)).to_le_bytes());
        i += 4;
    }
}

fn ia64(data: &mut [u8], start: u32) {
    for (i, bundle) in data.chunks_exact_mut(16).enumerate() {
        // The template selects which of the three 41-bit instruction slots may contain branches.
        let first = match bundle[0] & 0x1f {
            16 | 17 | 24 | 25 | 28 | 29 => 2,
            18 | 19 => 1,
            22 | 23 => 0,
            _ => continue,
        };
        let mut bits = u128::from_le_bytes((*bundle).try_into().unwrap());
        for slot in first..3 {
            let shift = 5 + 41 * slot;
            let instr: u128 = bits >> shift;
            if instr >> 37 & 15 == 5 && instr >> 9 & 7 == 0 {
                let src = ((instr >> 13) & 0xfffff) | ((instr >> 16) & 0x100000);
                let dest = (src as u32).wrapping_sub((start >> 4).wrapping_add(i as u32));
                bits &= !(0x8fffff_u128 << (13 + shift));
                bits |= (u128::from(dest & 0xfffff) << (13 + shift))
                    | (u128::from(dest & 0x100000) << (16 + shift));
            }
        }
        bundle.copy_from_slice(&bits.to_le_bytes());
    }
}
