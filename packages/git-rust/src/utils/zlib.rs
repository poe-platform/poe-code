use crate::errors::GitError;

const LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258,
];
const LENGTH_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
    13, 13,
];
const CL_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

pub fn adler32(data: &[u8]) -> u32 {
    const MOD_ADLER: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for chunk in data.chunks(5552) {
        for &byte in chunk {
            a += byte as u32;
            b += a;
        }
        a %= MOD_ADLER;
        b %= MOD_ADLER;
    }
    (b << 16) | a
}

struct BitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_buf: u64,
    bit_count: u8,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8], start: usize) -> Self {
        Self {
            data,
            byte_pos: start,
            bit_buf: 0,
            bit_count: 0,
        }
    }

    #[inline]
    fn ensure_bits(&mut self, n: u8) -> Result<(), GitError> {
        while self.bit_count < n {
            if self.byte_pos >= self.data.len() {
                return Err(GitError::internal("Unexpected end of deflate stream"));
            }
            self.bit_buf |= (self.data[self.byte_pos] as u64) << self.bit_count;
            self.byte_pos += 1;
            self.bit_count += 8;
        }
        Ok(())
    }

    #[inline]
    fn read_bits(&mut self, n: u8) -> Result<u32, GitError> {
        if n == 0 {
            return Ok(0);
        }
        self.ensure_bits(n)?;
        let mask = (1u64 << n) - 1;
        let val = (self.bit_buf & mask) as u32;
        self.bit_buf >>= n;
        self.bit_count -= n;
        Ok(val)
    }

    fn align_byte(&mut self) {
        let discard = self.bit_count % 8;
        self.bit_buf >>= discard;
        self.bit_count -= discard;
    }

    fn read_aligned_bytes(&mut self, count: usize) -> Result<&'a [u8], GitError> {
        self.align_byte();
        let buffered_bytes = (self.bit_count / 8) as usize;
        self.byte_pos -= buffered_bytes;
        self.bit_buf = 0;
        self.bit_count = 0;
        if self.byte_pos + count > self.data.len() {
            return Err(GitError::internal("Unexpected end of deflate stored block"));
        }
        let slice = &self.data[self.byte_pos..self.byte_pos + count];
        self.byte_pos += count;
        Ok(slice)
    }

    fn consumed_bytes(&mut self) -> usize {
        self.align_byte();
        let buffered_bytes = (self.bit_count / 8) as usize;
        self.byte_pos - buffered_bytes
    }
}

struct HuffmanTable {
    counts: [u16; 16],
    symbols: Vec<u16>,
    fast_sym: [u16; 512],
    fast_len: [u8; 512],
}

impl HuffmanTable {
    fn from_code_lengths(lengths: &[u8]) -> Result<Self, GitError> {
        let mut counts = [0u16; 16];
        for &len in lengths {
            if len > 15 {
                return Err(GitError::internal("Invalid Huffman code length"));
            }
            if len > 0 {
                counts[len as usize] += 1;
            }
        }
        let mut offsets = [0u16; 16];
        let mut total = 0u16;
        for bits in 1..=15 {
            offsets[bits] = total;
            total += counts[bits];
        }
        let mut symbols = vec![0u16; total as usize];
        let mut next_code = [0u16; 16];
        let mut code = 0u16;
        for bits in 1..=15 {
            code = (code + counts[bits - 1]) << 1;
            next_code[bits] = code;
        }
        let mut fast_sym = [0u16; 512];
        let mut fast_len = [0u8; 512];
        let mut cur_offsets = offsets;
        for (sym, &len) in lengths.iter().enumerate() {
            if len > 0 {
                let idx = cur_offsets[len as usize] as usize;
                cur_offsets[len as usize] += 1;
                symbols[idx] = sym as u16;
                let c = next_code[len as usize];
                next_code[len as usize] += 1;
                if len <= 9 {
                    let rev = reverse_bits(c, len);
                    let step = 1usize << len;
                    let mut entry = rev as usize;
                    while entry < 512 {
                        fast_sym[entry] = sym as u16;
                        fast_len[entry] = len;
                        entry += step;
                    }
                }
            }
        }
        Ok(Self {
            counts,
            symbols,
            fast_sym,
            fast_len,
        })
    }

    #[inline]
    fn decode(&self, reader: &mut BitReader<'_>) -> Result<u16, GitError> {
        if reader.bit_count < 15 && reader.byte_pos < reader.data.len() {
            while reader.bit_count <= 56 && reader.byte_pos < reader.data.len() {
                reader.bit_buf |= (reader.data[reader.byte_pos] as u64) << reader.bit_count;
                reader.byte_pos += 1;
                reader.bit_count += 8;
            }
        }
        if reader.bit_count >= 9 {
            let idx = (reader.bit_buf & 0x1ff) as usize;
            let len = self.fast_len[idx];
            if len > 0 {
                reader.bit_buf >>= len;
                reader.bit_count -= len;
                return Ok(self.fast_sym[idx]);
            }
        }
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
        Err(GitError::internal("Invalid Huffman code in deflate stream"))
    }
}

#[inline]
fn reverse_bits(mut val: u16, len: u8) -> u16 {
    let mut res = 0u16;
    for _ in 0..len {
        res = (res << 1) | (val & 1);
        val >>= 1;
    }
    res
}

fn fixed_tables() -> (HuffmanTable, HuffmanTable) {
    let mut lit_lengths = [0u8; 288];
    for l in &mut lit_lengths[0..=143] {
        *l = 8;
    }
    for l in &mut lit_lengths[144..=255] {
        *l = 9;
    }
    for l in &mut lit_lengths[256..=279] {
        *l = 7;
    }
    for l in &mut lit_lengths[280..=287] {
        *l = 8;
    }
    let dist_lengths = [5u8; 32];
    (
        HuffmanTable::from_code_lengths(&lit_lengths).unwrap(),
        HuffmanTable::from_code_lengths(&dist_lengths).unwrap(),
    )
}

pub fn inflate_raw_from(input: &[u8], start_offset: usize) -> Result<(Vec<u8>, usize), GitError> {
    let mut reader = BitReader::new(input, start_offset);
    let mut out = Vec::new();
    loop {
        let bfinal = reader.read_bits(1)?;
        let btype = reader.read_bits(2)?;
        match btype {
            0 => {
                let header = reader.read_aligned_bytes(4)?;
                let len = u16::from_le_bytes([header[0], header[1]]);
                let nlen = u16::from_le_bytes([header[2], header[3]]);
                if len != !nlen {
                    return Err(GitError::internal("Corrupt stored block length in deflate"));
                }
                let data = reader.read_aligned_bytes(len as usize)?;
                out.extend_from_slice(data);
            }
            1 | 2 => {
                let (lit_table, dist_table) = if btype == 1 {
                    fixed_tables()
                } else {
                    let hlit = reader.read_bits(5)? as usize + 257;
                    let hdist = reader.read_bits(5)? as usize + 1;
                    let hclen = reader.read_bits(4)? as usize + 4;
                    let mut cl_lengths = [0u8; 19];
                    for i in 0..hclen {
                        cl_lengths[CL_ORDER[i]] = reader.read_bits(3)? as u8;
                    }
                    let cl_table = HuffmanTable::from_code_lengths(&cl_lengths)?;
                    let mut all_lengths = Vec::with_capacity(hlit + hdist);
                    while all_lengths.len() < hlit + hdist {
                        let sym = cl_table.decode(&mut reader)?;
                        match sym {
                            0..=15 => all_lengths.push(sym as u8),
                            16 => {
                                let prev = *all_lengths.last().ok_or_else(|| {
                                    GitError::internal("Repeat code 16 with no previous length")
                                })?;
                                let repeat = reader.read_bits(2)? as usize + 3;
                                for _ in 0..repeat {
                                    all_lengths.push(prev);
                                }
                            }
                            17 => {
                                let repeat = reader.read_bits(3)? as usize + 3;
                                all_lengths.resize(all_lengths.len() + repeat, 0);
                            }
                            18 => {
                                let repeat = reader.read_bits(7)? as usize + 11;
                                all_lengths.resize(all_lengths.len() + repeat, 0);
                            }
                            _ => return Err(GitError::internal("Invalid code length symbol")),
                        }
                    }
                    let lit_t = HuffmanTable::from_code_lengths(&all_lengths[..hlit])?;
                    let dist_t = HuffmanTable::from_code_lengths(&all_lengths[hlit..hlit + hdist])?;
                    (lit_t, dist_t)
                };

                loop {
                    let sym = lit_table.decode(&mut reader)?;
                    if sym < 256 {
                        out.push(sym as u8);
                    } else if sym == 256 {
                        break;
                    } else {
                        let len_idx = (sym - 257) as usize;
                        if len_idx >= LENGTH_BASE.len() {
                            return Err(GitError::internal("Invalid match length symbol"));
                        }
                        let extra_len = reader.read_bits(LENGTH_EXTRA[len_idx])? as usize;
                        let length = LENGTH_BASE[len_idx] as usize + extra_len;
                        let dist_sym = dist_table.decode(&mut reader)? as usize;
                        if dist_sym >= DIST_BASE.len() {
                            return Err(GitError::internal("Invalid match distance symbol"));
                        }
                        let extra_dist = reader.read_bits(DIST_EXTRA[dist_sym])? as usize;
                        let distance = DIST_BASE[dist_sym] as usize + extra_dist;
                        if distance == 0 || distance > out.len() {
                            return Err(GitError::internal("Match distance out of bounds"));
                        }
                        let start = out.len() - distance;
                        if distance >= length {
                            out.extend_from_within(start..start + length);
                        } else {
                            for i in 0..length {
                                let b = out[start + i];
                                out.push(b);
                            }
                        }
                    }
                }
            }
            _ => return Err(GitError::internal("Invalid deflate block type 3")),
        }
        if bfinal != 0 {
            break;
        }
    }
    let end_pos = reader.consumed_bytes();
    Ok((out, end_pos - start_offset))
}

pub fn zlib_inflate_with_consumed(input: &[u8]) -> Result<(Vec<u8>, usize), GitError> {
    if input.len() < 2 {
        return Err(GitError::internal("Zlib stream too short"));
    }
    let cmf = input[0];
    let flg = input[1];
    let is_zlib_header =
        (cmf & 0x0f) == 8 && (cmf >> 4) <= 7 && ((cmf as u16) << 8 | flg as u16).is_multiple_of(31);

    if is_zlib_header {
        let fdict = (flg & 0x20) != 0;
        let start = if fdict { 6 } else { 2 };
        let (out, raw_consumed) = inflate_raw_from(input, start)?;
        let total = (start + raw_consumed + 4).min(input.len());
        Ok((out, total))
    } else {
        inflate_raw_from(input, 0)
    }
}

pub fn zlib_inflate(input: &[u8]) -> Result<Vec<u8>, GitError> {
    Ok(zlib_inflate_with_consumed(input)?.0)
}

pub fn zlib_deflate(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() / 2 + 16);
    out.push(0x78);
    out.push(0x9c);
    deflate_raw_into(input, &mut out);
    let checksum = adler32(input);
    out.extend_from_slice(&checksum.to_be_bytes());
    out
}

struct BitWriter<'a> {
    out: &'a mut Vec<u8>,
    bit_buf: u32,
    bit_count: u8,
}

impl<'a> BitWriter<'a> {
    fn new(out: &'a mut Vec<u8>) -> Self {
        Self {
            out,
            bit_buf: 0,
            bit_count: 0,
        }
    }

    #[inline]
    fn write_bits(&mut self, val: u32, n: u8) {
        self.bit_buf |= val << self.bit_count;
        self.bit_count += n;
        while self.bit_count >= 8 {
            self.out.push((self.bit_buf & 0xff) as u8);
            self.bit_buf >>= 8;
            self.bit_count -= 8;
        }
    }

    #[inline]
    fn write_huffman(&mut self, code: u16, len: u8) {
        let rev = reverse_bits(code, len) as u32;
        self.write_bits(rev, len);
    }

    fn flush_align(&mut self) {
        if self.bit_count > 0 {
            self.out.push((self.bit_buf & 0xff) as u8);
            self.bit_buf = 0;
            self.bit_count = 0;
        }
    }
}

fn deflate_raw_into(input: &[u8], out: &mut Vec<u8>) {
    let mut writer = BitWriter::new(out);
    // Final block (BFINAL=1), Fixed Huffman (BTYPE=01)
    writer.write_bits(1, 1);
    writer.write_bits(1, 2);

    const HASH_BITS: usize = 14;
    const HASH_SIZE: usize = 1 << HASH_BITS;
    let mut head = vec![usize::MAX; HASH_SIZE];
    let mut prev = vec![usize::MAX; input.len()];

    let hash3 = |pos: usize| -> usize {
        let b0 = input[pos] as usize;
        let b1 = input[pos + 1] as usize;
        let b2 = input[pos + 2] as usize;
        ((b0 << 8) ^ (b1 << 4) ^ b2) & (HASH_SIZE - 1)
    };

    let mut pos = 0;
    while pos < input.len() {
        let mut best_len = 0usize;
        let mut best_dist = 0usize;

        if pos + 3 <= input.len() {
            let h = hash3(pos);
            let mut candidate = head[h];
            head[h] = pos;
            prev[pos] = candidate;

            let max_len = (input.len() - pos).min(258);
            let mut chain = 0;
            while candidate != usize::MAX && pos - candidate <= 32768 && chain < 32 {
                if input[candidate + best_len] == input[pos + best_len]
                    && input[candidate..candidate + 3] == input[pos..pos + 3]
                {
                    let mut l = 3;
                    while l < max_len && input[candidate + l] == input[pos + l] {
                        l += 1;
                    }
                    if l > best_len {
                        best_len = l;
                        best_dist = pos - candidate;
                        if l == max_len {
                            break;
                        }
                    }
                }
                candidate = prev[candidate];
                chain += 1;
            }
        }

        if best_len >= 3 {
            write_fixed_length(&mut writer, best_len);
            write_fixed_distance(&mut writer, best_dist);
            for step in 1..best_len {
                if pos + step + 3 <= input.len() {
                    let h = hash3(pos + step);
                    prev[pos + step] = head[h];
                    head[h] = pos + step;
                }
            }
            pos += best_len;
        } else {
            write_fixed_literal(&mut writer, input[pos] as u16);
            pos += 1;
        }
    }

    // End-of-block symbol 256
    write_fixed_literal(&mut writer, 256);
    writer.flush_align();
}

fn write_fixed_literal(writer: &mut BitWriter<'_>, sym: u16) {
    if sym <= 143 {
        writer.write_huffman(0x30 + sym, 8);
    } else if sym <= 255 {
        writer.write_huffman(0x190 + (sym - 144), 9);
    } else if sym <= 279 {
        writer.write_huffman(sym - 256, 7);
    } else {
        writer.write_huffman(0xc0 + (sym - 280), 8);
    }
}

fn write_fixed_length(writer: &mut BitWriter<'_>, len: usize) {
    let mut idx = 0;
    for i in (0..LENGTH_BASE.len()).rev() {
        if len >= LENGTH_BASE[i] as usize {
            idx = i;
            break;
        }
    }
    write_fixed_literal(writer, 257 + idx as u16);
    let extra = LENGTH_EXTRA[idx];
    if extra > 0 {
        writer.write_bits((len - LENGTH_BASE[idx] as usize) as u32, extra);
    }
}

fn write_fixed_distance(writer: &mut BitWriter<'_>, dist: usize) {
    let mut idx = 0;
    for i in (0..DIST_BASE.len()).rev() {
        if dist >= DIST_BASE[i] as usize {
            idx = i;
            break;
        }
    }
    writer.write_huffman(idx as u16, 5);
    let extra = DIST_EXTRA[idx];
    if extra > 0 {
        writer.write_bits((dist - DIST_BASE[idx] as usize) as u32, extra);
    }
}
