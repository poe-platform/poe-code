//! Bounded RFC 1951 decoder extracted from the Rust shell codecs.
use mcp_protocol_rust::cooperate::{block_on, yield_now};
struct LsbBitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_buf: u64,
    bit_cnt: u8,
}

impl<'a> LsbBitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            byte_pos: 0,
            bit_buf: 0,
            bit_cnt: 0,
        }
    }

    fn ensure_bits(&mut self, n: u8) -> Result<(), String> {
        while self.bit_cnt < n {
            if self.byte_pos >= self.data.len() {
                return Err("unexpected end of file".into());
            }
            self.bit_buf |= (self.data[self.byte_pos] as u64) << self.bit_cnt;
            self.byte_pos += 1;
            self.bit_cnt += 8;
        }
        Ok(())
    }

    fn read_bits(&mut self, n: u8) -> Result<u32, String> {
        if n == 0 {
            return Ok(0);
        }
        self.ensure_bits(n)?;
        let val = (self.bit_buf & ((1u64 << n) - 1)) as u32;
        self.bit_buf >>= n;
        self.bit_cnt -= n;
        Ok(val)
    }

    fn align_byte(&mut self) {
        let drop_bits = self.bit_cnt & 7;
        self.bit_buf >>= drop_bits;
        self.bit_cnt -= drop_bits;
    }

    fn read_u16_aligned(&mut self) -> Result<u16, String> {
        self.align_byte();
        let lo = self.read_bits(8)? as u16;
        let hi = self.read_bits(8)? as u16;
        Ok(lo | (hi << 8))
    }

    fn consumed_bytes(&self) -> usize {
        self.byte_pos - ((self.bit_cnt / 8) as usize)
    }
}

struct HuffTree {
    counts: [u16; 16],
    symbols: Vec<u16>,
}

impl HuffTree {
    fn from_lengths(lengths: &[u8]) -> Result<Self, String> {
        let mut counts = [0u16; 16];
        for &l in lengths {
            if l > 15 {
                return Err("invalid deflate code length".into());
            }
            if l > 0 {
                counts[l as usize] += 1;
            }
        }
        let mut offsets = [0u16; 16];
        let mut total = 0u16;
        for bits in 1..=15 {
            offsets[bits] = total;
            total += counts[bits];
        }
        let mut symbols = vec![0u16; total as usize];
        for (sym, &l) in lengths.iter().enumerate() {
            if l > 0 {
                let idx = offsets[l as usize] as usize;
                symbols[idx] = sym as u16;
                offsets[l as usize] += 1;
            }
        }
        Ok(Self { counts, symbols })
    }

    fn decode(&self, reader: &mut LsbBitReader<'_>) -> Result<u16, String> {
        let mut code = 0i32;
        let mut first = 0i32;
        let mut index = 0i32;
        for len in 1..=15 {
            code |= reader.read_bits(1)? as i32;
            let count = self.counts[len] as i32;
            if code - count < first {
                return Ok(self.symbols[(index + (code - first)) as usize]);
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        Err("invalid deflate Huffman code".into())
    }
}

pub const LEN_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
pub const LEN_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
pub const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
pub const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];

pub fn inflate_raw(data: &[u8]) -> Result<(Vec<u8>, usize), String> {
    inflate_raw_bounded(data, usize::MAX)
}

pub fn inflate_raw_bounded(data: &[u8], limit: usize) -> Result<(Vec<u8>, usize), String> {
    block_on(inflate_raw_bounded_async(data, limit))
}

pub async fn inflate_raw_bounded_async(
    data: &[u8],
    limit: usize,
) -> Result<(Vec<u8>, usize), String> {
    let mut out = Vec::new();
    let used = deflate_member_async(data, limit, Some(&mut out)).await?;
    Ok((out, used))
}

// PDF inline streams have no encoded length. Walking the same codes without
// copying expansion bytes locates the final block even for very large runs.
pub fn deflate_member(
    data: &[u8],
    limit: usize,
    output: Option<&mut Vec<u8>>,
) -> Result<usize, String> {
    block_on(deflate_member_async(data, limit, output))
}

async fn deflate_member_async(
    data: &[u8],
    limit: usize,
    mut output: Option<&mut Vec<u8>>,
) -> Result<usize, String> {
    const CL_ORDER: [usize; 19] = [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
    ];

    let mut reader = LsbBitReader::new(data);
    let mut produced = 0;
    let mut symbols = 0usize;

    loop {
        yield_now().await;
        let bfinal = reader.read_bits(1)? != 0;
        let btype = reader.read_bits(2)?;
        match btype {
            0 => {
                let len = reader.read_u16_aligned()?;
                let nlen = reader.read_u16_aligned()?;
                if len != !nlen {
                    return Err("corrupt deflate block length".into());
                }
                if len as usize > limit - produced {
                    return Err("inflated data exceeds input limit".into());
                }
                // Stored blocks start byte-aligned and the two lengths end byte-aligned.
                let end = reader
                    .byte_pos
                    .checked_add(usize::from(len))
                    .ok_or("invalid block length")?;
                let block = data
                    .get(reader.byte_pos..end)
                    .ok_or("unexpected end of file")?;
                if let Some(out) = &mut output {
                    out.extend_from_slice(block);
                }
                reader.byte_pos = end;
                produced += usize::from(len);
            }
            1 | 2 => {
                let (lit_tree, dist_tree) = if btype == 1 {
                    let mut lit_lens = vec![0u8; 288];
                    lit_lens[0..=143].fill(8);
                    lit_lens[144..=255].fill(9);
                    lit_lens[256..=279].fill(7);
                    lit_lens[280..=287].fill(8);
                    let dist_lens = vec![5u8; 32];
                    (
                        HuffTree::from_lengths(&lit_lens)?,
                        HuffTree::from_lengths(&dist_lens)?,
                    )
                } else {
                    let hlit = (reader.read_bits(5)? as usize) + 257;
                    let hdist = (reader.read_bits(5)? as usize) + 1;
                    let hclen = (reader.read_bits(4)? as usize) + 4;
                    let mut cl_lens = [0u8; 19];
                    for i in 0..hclen {
                        cl_lens[CL_ORDER[i]] = reader.read_bits(3)? as u8;
                    }
                    let cl_tree = HuffTree::from_lengths(&cl_lens)?;
                    let mut all_lens = Vec::with_capacity(hlit + hdist);
                    while all_lens.len() < hlit + hdist {
                        let sym = cl_tree.decode(&mut reader)?;
                        match sym {
                            0..=15 => all_lens.push(sym as u8),
                            16 => {
                                let prev = *all_lens
                                    .last()
                                    .ok_or_else(|| "invalid deflate repeat".to_string())?;
                                let rep = (reader.read_bits(2)? as usize) + 3;
                                for _ in 0..rep {
                                    all_lens.push(prev);
                                }
                            }
                            17 => {
                                let rep = (reader.read_bits(3)? as usize) + 3;
                                all_lens.resize(all_lens.len() + rep, 0);
                            }
                            18 => {
                                let rep = (reader.read_bits(7)? as usize) + 11;
                                all_lens.resize(all_lens.len() + rep, 0);
                            }
                            _ => return Err("invalid deflate code length symbol".into()),
                        }
                    }
                    if all_lens.len() > hlit + hdist {
                        return Err("invalid deflate code length table".into());
                    }
                    (
                        HuffTree::from_lengths(&all_lens[..hlit])?,
                        HuffTree::from_lengths(&all_lens[hlit..])?,
                    )
                };

                loop {
                    if symbols % 1024 == 0 {
                        yield_now().await;
                    }
                    symbols += 1;
                    let sym = lit_tree.decode(&mut reader)? as usize;
                    if sym < 256 {
                        if produced == limit {
                            return Err("inflated data exceeds input limit".into());
                        }
                        if let Some(out) = &mut output {
                            out.push(sym as u8);
                        }
                        produced += 1;
                    } else if sym == 256 {
                        break;
                    } else {
                        let l_idx = sym - 257;
                        if l_idx >= LEN_BASE.len() {
                            return Err("invalid deflate length code".into());
                        }
                        let length = (LEN_BASE[l_idx] as usize)
                            + (reader.read_bits(LEN_EXTRA[l_idx])? as usize);
                        let d_sym = dist_tree.decode(&mut reader)? as usize;
                        if d_sym >= DIST_BASE.len() {
                            return Err("invalid deflate distance code".into());
                        }
                        let dist = (DIST_BASE[d_sym] as usize)
                            + (reader.read_bits(DIST_EXTRA[d_sym])? as usize);
                        if dist == 0 || dist > produced {
                            return Err("invalid deflate distance".into());
                        }
                        if length > limit - produced {
                            return Err("inflated data exceeds input limit".into());
                        }
                        if let Some(out) = &mut output {
                            for _ in 0..length {
                                let b = out[out.len() - dist];
                                out.push(b);
                            }
                        }
                        produced += length;
                    }
                }
            }
            _ => return Err("invalid deflate block type".into()),
        }
        if bfinal {
            break;
        }
    }
    reader.align_byte();
    Ok(reader.consumed_bytes())
}
