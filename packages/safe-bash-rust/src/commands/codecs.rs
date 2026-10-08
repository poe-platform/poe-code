
pub fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xedb8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

pub fn crc64_xz(data: &[u8]) -> u64 {
    let mut crc = 0xffff_ffff_ffff_ffffu64;
    for &b in data {
        crc ^= b as u64;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xc96c_5795_d787_0f42;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

pub fn bzip2_crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc ^= (b as u32) << 24;
        for _ in 0..8 {
            if (crc & 0x8000_0000) != 0 {
                crc = (crc << 1) ^ 0x04c1_1db7;
            } else {
                crc <<= 1;
            }
        }
    }
    !crc
}

pub fn xxh64(data: &[u8], seed: u64) -> u64 {
    const P1: u64 = 11400714785074694791;
    const P2: u64 = 14029467366897019727;
    const P3: u64 = 1609587929392839161;
    const P4: u64 = 9650029242287828579;
    const P5: u64 = 2870177450012600261;

    fn round(acc: u64, input: u64) -> u64 {
        acc.wrapping_add(input.wrapping_mul(P2))
            .rotate_left(31)
            .wrapping_mul(P1)
    }

    fn merge_round(mut acc: u64, val: u64) -> u64 {
        let v = round(0, val);
        acc ^= v;
        acc.wrapping_mul(P1).wrapping_add(P4)
    }

    let mut pos = 0usize;
    let mut h64 = if data.len() >= 32 {
        let mut v1 = seed.wrapping_add(P1).wrapping_add(P2);
        let mut v2 = seed.wrapping_add(P2);
        let mut v3 = seed;
        let mut v4 = seed.wrapping_sub(P1);
        while pos + 32 <= data.len() {
            v1 = round(v1, u64::from_le_bytes(data[pos..pos + 8].try_into().unwrap()));
            v2 = round(v2, u64::from_le_bytes(data[pos + 8..pos + 16].try_into().unwrap()));
            v3 = round(v3, u64::from_le_bytes(data[pos + 16..pos + 24].try_into().unwrap()));
            v4 = round(v4, u64::from_le_bytes(data[pos + 24..pos + 32].try_into().unwrap()));
            pos += 32;
        }
        let mut h = v1
            .rotate_left(1)
            .wrapping_add(v2.rotate_left(7))
            .wrapping_add(v3.rotate_left(12))
            .wrapping_add(v4.rotate_left(18));
        h = merge_round(h, v1);
        h = merge_round(h, v2);
        h = merge_round(h, v3);
        h = merge_round(h, v4);
        h
    } else {
        seed.wrapping_add(P5)
    };

    h64 = h64.wrapping_add(data.len() as u64);

    while pos + 8 <= data.len() {
        let k1 = round(0, u64::from_le_bytes(data[pos..pos + 8].try_into().unwrap()));
        h64 ^= k1;
        h64 = h64.rotate_left(27).wrapping_mul(P1).wrapping_add(P4);
        pos += 8;
    }
    if pos + 4 <= data.len() {
        let k1 = (u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as u64).wrapping_mul(P1);
        h64 ^= k1;
        h64 = h64.rotate_left(23).wrapping_mul(P2).wrapping_add(P3);
        pos += 4;
    }
    while pos < data.len() {
        let k1 = (data[pos] as u64).wrapping_mul(P5);
        h64 ^= k1;
        h64 = h64.rotate_left(11).wrapping_mul(P1);
        pos += 1;
    }

    h64 ^= h64 >> 33;
    h64 = h64.wrapping_mul(P2);
    h64 ^= h64 >> 29;
    h64 = h64.wrapping_mul(P3);
    h64 ^= h64 >> 32;
    h64
}

// ============================================================================
// RFC 1951 DEFLATE / INFLATE & RFC 1952 GZIP
// ============================================================================

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

pub fn inflate_raw(data: &[u8]) -> Result<(Vec<u8>, usize), String> {
    const LEN_BASE: [u16; 29] = [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
        131, 163, 195, 227, 258,
    ];
    const LEN_EXTRA: [u8; 29] = [
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

    let mut reader = LsbBitReader::new(data);
    let mut out = Vec::new();

    loop {
        let bfinal = reader.read_bits(1)? != 0;
        let btype = reader.read_bits(2)?;
        match btype {
            0 => {
                let len = reader.read_u16_aligned()?;
                let nlen = reader.read_u16_aligned()?;
                if len != !nlen {
                    return Err("corrupt deflate block length".into());
                }
                for _ in 0..len {
                    out.push(reader.read_bits(8)? as u8);
                }
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
                    let sym = lit_tree.decode(&mut reader)? as usize;
                    if sym < 256 {
                        out.push(sym as u8);
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
                        if dist == 0 || dist > out.len() {
                            return Err("invalid deflate distance".into());
                        }
                        for _ in 0..length {
                            let b = out[out.len() - dist];
                            out.push(b);
                        }
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
    Ok((out, reader.consumed_bytes()))
}

pub fn gzip_compress(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03];
    if data.is_empty() {
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
    } else {
        let chunks: Vec<&[u8]> = data.chunks(65535).collect();
        for (i, chunk) in chunks.iter().enumerate() {
            let is_last = i + 1 == chunks.len();
            out.push(if is_last { 0x01 } else { 0x00 });
            let len = chunk.len() as u16;
            let nlen = !len;
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&nlen.to_le_bytes());
            out.extend_from_slice(chunk);
        }
    }
    let crc = crc32_ieee(data);
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out
}

pub fn gzip_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 18 || data[0] != 0x1f || data[1] != 0x8b {
        return Err("not in gzip format".into());
    }
    let mut pos = 0usize;
    let mut total_out = Vec::new();
    while pos < data.len() {
        if pos + 18 > data.len() || data[pos] != 0x1f || data[pos + 1] != 0x8b {
            return Err("not in gzip format".into());
        }
        if data[pos + 2] != 8 {
            return Err("unknown compression method".into());
        }
        let flg = data[pos + 3];
        if (flg & 0xe0) != 0 {
            return Err("unknown flags".into());
        }
        pos += 10;
        if (flg & 0x04) != 0 {
            if pos + 2 > data.len() {
                return Err("unexpected end of file".into());
            }
            let xlen = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
            pos += 2 + xlen;
        }
        if (flg & 0x08) != 0 {
            while pos < data.len() && data[pos] != 0 {
                pos += 1;
            }
            pos += 1;
        }
        if (flg & 0x10) != 0 {
            while pos < data.len() && data[pos] != 0 {
                pos += 1;
            }
            pos += 1;
        }
        if (flg & 0x02) != 0 {
            pos += 2;
        }
        if pos > data.len() {
            return Err("unexpected end of file".into());
        }
        let (member_out, consumed) = inflate_raw(&data[pos..])?;
        pos += consumed;
        if pos + 8 > data.len() {
            return Err("unexpected end of file".into());
        }
        let expected_crc = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
        let expected_isize = u32::from_le_bytes(data[pos + 4..pos + 8].try_into().unwrap());
        pos += 8;
        let actual_crc = crc32_ieee(&member_out);
        if actual_crc != expected_crc {
            return Err("crc error".into());
        }
        if (member_out.len() as u32) != expected_isize {
            return Err("length error".into());
        }
        total_out.extend_from_slice(&member_out);
    }
    Ok(total_out)
}

// ============================================================================
// BZIP2 (.bz2) COMPRESS & DECOMPRESS
// ============================================================================

struct MsbBitWriter {
    bytes: Vec<u8>,
    bit_buf: u64,
    bit_cnt: u8,
}

impl MsbBitWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            bit_buf: 0,
            bit_cnt: 0,
        }
    }

    fn write_bits(&mut self, val: u64, n: u8) {
        if n == 0 {
            return;
        }
        let masked = if n >= 64 { val } else { val & ((1u64 << n) - 1) };
        self.bit_buf = (self.bit_buf << n) | masked;
        self.bit_cnt += n;
        while self.bit_cnt >= 8 {
            self.bit_cnt -= 8;
            self.bytes.push(((self.bit_buf >> self.bit_cnt) & 0xff) as u8);
        }
    }

    fn finish(mut self) -> Vec<u8> {
        if self.bit_cnt > 0 {
            let pad = 8 - self.bit_cnt;
            self.bytes.push(((self.bit_buf << pad) & 0xff) as u8);
        }
        self.bytes
    }
}

struct MsbBitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_buf: u64,
    bit_cnt: u8,
}

impl<'a> MsbBitReader<'a> {
    fn new(data: &'a [u8], start_pos: usize) -> Self {
        Self {
            data,
            byte_pos: start_pos,
            bit_buf: 0,
            bit_cnt: 0,
        }
    }

    fn read_bits(&mut self, n: u8) -> Result<u64, String> {
        if n == 0 {
            return Ok(0);
        }
        while self.bit_cnt < n {
            if self.byte_pos >= self.data.len() {
                return Err("Compressed data error".into());
            }
            self.bit_buf = (self.bit_buf << 8) | (self.data[self.byte_pos] as u64);
            self.byte_pos += 1;
            self.bit_cnt += 8;
        }
        self.bit_cnt -= n;
        let mask = if n >= 64 { u64::MAX } else { (1u64 << n) - 1 };
        Ok((self.bit_buf >> self.bit_cnt) & mask)
    }

    fn align_byte(&mut self) {
        let rem = self.bit_cnt % 8;
        self.bit_cnt -= rem;
    }

    fn consumed_bytes(&self) -> usize {
        self.byte_pos - ((self.bit_cnt / 8) as usize)
    }
}

pub fn bzip2_compress(data: &[u8], level: u8) -> Vec<u8> {
    let lvl = level.clamp(1, 9);
    let mut bw = MsbBitWriter::new();
    bw.write_bits(b'B' as u64, 8);
    bw.write_bits(b'Z' as u64, 8);
    bw.write_bits(b'h' as u64, 8);
    bw.write_bits((b'0' + lvl) as u64, 8);

    let mut combined_crc = 0u32;
    let block_cap = ((lvl as usize) * 100_000).saturating_sub(20).max(1024);

    for chunk in data.chunks(block_cap) {
        let block_crc = bzip2_crc32(chunk);
        combined_crc = combined_crc.rotate_left(1) ^ block_crc;

        // 1. Initial RLE1
        let mut rle1 = Vec::with_capacity(chunk.len());
        let mut idx = 0usize;
        while idx < chunk.len() {
            let b = chunk[idx];
            let mut run = 1usize;
            while idx + run < chunk.len() && chunk[idx + run] == b && run < 255 {
                run += 1;
            }
            if run >= 4 {
                rle1.extend_from_slice(&[b, b, b, b, (run - 4) as u8]);
            } else {
                for _ in 0..run {
                    rle1.push(b);
                }
            }
            idx += run;
        }

        // 2. Burrows-Wheeler Transform
        let n = rle1.len();
        let mut indices: Vec<usize> = (0..n).collect();
        indices.sort_by(|&a, &b| {
            for k in 0..n {
                let ba = rle1[(a + k) % n];
                let bb = rle1[(b + k) % n];
                if ba != bb {
                    return ba.cmp(&bb);
                }
            }
            a.cmp(&b)
        });
        let orig_ptr = indices.iter().position(|&i| i == 0).unwrap_or(0) as u32;
        let mut bwt_last = Vec::with_capacity(n);
        for &rot in &indices {
            bwt_last.push(rle1[(rot + n - 1) % n]);
        }

        // 3. Symbol map & MTF + RLE2
        let mut in_use = [false; 256];
        for &b in &rle1 {
            in_use[b as usize] = true;
        }
        let mut yy = Vec::new();
        for (sym, &used) in in_use.iter().enumerate() {
            if used {
                yy.push(sym as u8);
            }
        }
        let num_in_use = yy.len();
        let eob = (num_in_use + 1) as u16;
        let alpha_size = num_in_use + 2;

        let mut mtf_syms: Vec<u16> = Vec::with_capacity(n + 2);
        let mut z_run = 0usize;
        let flush_z_run = |mut run: usize, out: &mut Vec<u16>| {
            while run > 0 {
                run -= 1;
                out.push((run & 1) as u16); // 0 = RUNA, 1 = RUNB
                run >>= 1;
            }
        };
        for &b in &bwt_last {
            let pos = yy.iter().position(|&x| x == b).unwrap();
            if pos == 0 {
                z_run += 1;
            } else {
                if z_run > 0 {
                    flush_z_run(z_run, &mut mtf_syms);
                    z_run = 0;
                }
                let v = yy.remove(pos);
                yy.insert(0, v);
                mtf_syms.push((pos + 1) as u16);
            }
        }
        if z_run > 0 {
            flush_z_run(z_run, &mut mtf_syms);
        }
        mtf_syms.push(eob);

        // 4. Exact complete binary tree code lengths (1 <= L <= 9, Kraft sum == 1)
        let k = alpha_size.next_power_of_two().trailing_zeros() as u8;
        let two_pow_k = 1usize << k;
        let num_short = two_pow_k - alpha_size;
        let mut freq = vec![0usize; alpha_size];
        for &s in &mtf_syms {
            freq[s as usize] += 1;
        }
        let mut order: Vec<usize> = (0..alpha_size).collect();
        order.sort_by(|&a, &b| freq[b].cmp(&freq[a]).then_with(|| a.cmp(&b)));
        let mut code_lens = vec![k; alpha_size];
        for &sym_idx in order.iter().take(num_short) {
            code_lens[sym_idx] = k - 1;
        }

        // Canonical Huffman codes from code_lens
        let min_len = *code_lens.iter().min().unwrap();
        let max_len = *code_lens.iter().max().unwrap();
        let mut codes = vec![0u32; alpha_size];
        let mut vec_code = 0u32;
        for l in min_len..=max_len {
            for s in 0..alpha_size {
                if code_lens[s] == l {
                    codes[s] = vec_code;
                    vec_code += 1;
                }
            }
            vec_code <<= 1;
        }

        // 5. Block Header: 0x314159265359
        bw.write_bits(0x3141_5926_5359, 48);
        bw.write_bits(block_crc as u64, 32);
        bw.write_bits(0, 1); // not randomized
        bw.write_bits(orig_ptr as u64, 24);

        // Symbol map
        let mut in_use_16 = 0u16;
        for i in 0..16 {
            if in_use[i * 16..(i + 1) * 16].iter().any(|&u| u) {
                in_use_16 |= 1 << (15 - i);
            }
        }
        bw.write_bits(in_use_16 as u64, 16);
        for i in 0..16 {
            if (in_use_16 & (1 << (15 - i))) != 0 {
                let mut sub = 0u16;
                for j in 0..16 {
                    if in_use[i * 16 + j] {
                        sub |= 1 << (15 - j);
                    }
                }
                bw.write_bits(sub as u64, 16);
            }
        }

        // 2 tables (minimum allowed by bzip2 spec), all groups select table 0
        let n_selectors = mtf_syms.len().div_ceil(50);
        bw.write_bits(2, 3);
        bw.write_bits(n_selectors as u64, 15);
        for _ in 0..n_selectors {
            bw.write_bits(0, 1);
        }

        // Write delta-encoded code lengths for both tables
        for _t in 0..2 {
            let mut curr = code_lens[0] as i32;
            bw.write_bits(curr as u64, 5);
            for &target_u8 in &code_lens {
                let target = target_u8 as i32;
                while curr != target {
                    bw.write_bits(1, 1);
                    if curr < target {
                        bw.write_bits(0, 1);
                        curr += 1;
                    } else {
                        bw.write_bits(1, 1);
                        curr -= 1;
                    }
                }
                bw.write_bits(0, 1);
            }
        }

        // Write Huffman-coded symbols
        for &s in &mtf_syms {
            let idx_s = s as usize;
            bw.write_bits(codes[idx_s] as u64, code_lens[idx_s]);
        }
    }

    // End-of-stream magic: 0x177245385090 + combined CRC32
    bw.write_bits(0x1772_4538_5090, 48);
    bw.write_bits(combined_crc as u64, 32);
    bw.finish()
}

pub fn bzip2_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 14 || &data[0..3] != b"BZh" || !(b'1'..=b'9').contains(&data[3]) {
        return Err("Compressed data error".into());
    }
    let mut pos = 0usize;
    let mut out = Vec::new();

    while pos < data.len() {
        if pos + 4 > data.len() || &data[pos..pos + 3] != b"BZh" || !(b'1'..=b'9').contains(&data[pos + 3]) {
            return Err("Compressed data error".into());
        }
        let max_block_size = ((data[pos + 3] - b'0') as usize) * 100_000;
        let mut br = MsbBitReader::new(data, pos + 4);
        let mut combined_crc = 0u32;

        loop {
            let magic = br.read_bits(48)?;
            if magic == 0x1772_4538_5090 {
                let expected_stream_crc = br.read_bits(32)? as u32;
                if expected_stream_crc != combined_crc {
                    return Err("Compressed data CRC error".into());
                }
                br.align_byte();
                pos = br.consumed_bytes();
                break;
            }
            if magic != 0x3141_5926_5359 {
                return Err("Compressed data error".into());
            }
            let expected_block_crc = br.read_bits(32)? as u32;
            let randomized = br.read_bits(1)? != 0;
            if randomized {
                return Err("Compressed data error".into());
            }
            let orig_ptr = br.read_bits(24)? as usize;

            let in_use_16 = br.read_bits(16)? as u16;
            let mut seq_to_unseq = Vec::with_capacity(256);
            for i in 0..16 {
                if (in_use_16 & (1 << (15 - i))) != 0 {
                    let sub = br.read_bits(16)? as u16;
                    for j in 0..16 {
                        if (sub & (1 << (15 - j))) != 0 {
                            seq_to_unseq.push((i * 16 + j) as u8);
                        }
                    }
                }
            }
            let num_in_use = seq_to_unseq.len();
            if num_in_use == 0 {
                return Err("Compressed data error".into());
            }
            let alpha_size = num_in_use + 2;
            let eob = (num_in_use + 1) as u16;

            let n_tables = br.read_bits(3)? as usize;
            let n_selectors = br.read_bits(15)? as usize;
            if !(2..=6).contains(&n_tables) || n_selectors == 0 {
                return Err("Compressed data error".into());
            }

            let mut mtf_sel: Vec<u8> = (0..n_tables as u8).collect();
            let mut selectors = Vec::with_capacity(n_selectors);
            for _ in 0..n_selectors {
                let mut j = 0usize;
                while br.read_bits(1)? != 0 {
                    j += 1;
                    if j >= n_tables {
                        return Err("Compressed data error".into());
                    }
                }
                let v = mtf_sel.remove(j);
                mtf_sel.insert(0, v);
                selectors.push(v as usize);
            }

            // Read canonical Huffman tables
            struct BzTable {
                min_len: u8,
                max_len: u8,
                base: [i32; 23],
                limit: [i32; 23],
                perm: Vec<u16>,
            }
            let mut tables = Vec::with_capacity(n_tables);
            for _ in 0..n_tables {
                let mut curr = br.read_bits(5)? as i32;
                let mut lens = vec![0u8; alpha_size];
                for slot in lens.iter_mut() {
                    while br.read_bits(1)? != 0 {
                        if br.read_bits(1)? == 0 {
                            curr += 1;
                        } else {
                            curr -= 1;
                        }
                        if !(1..=20).contains(&curr) {
                            return Err("Compressed data error".into());
                        }
                    }
                    *slot = curr as u8;
                }
                let min_len = *lens.iter().min().unwrap();
                let max_len = *lens.iter().max().unwrap();
                let mut perm = Vec::with_capacity(alpha_size);
                for l in min_len..=max_len {
                    for (sym, &sl) in lens.iter().enumerate() {
                        if sl == l {
                            perm.push(sym as u16);
                        }
                    }
                }
                let mut base = [0i32; 23];
                let mut limit = [0i32; 23];
                for &sl in &lens {
                    base[(sl as usize) + 1] += 1;
                }
                for i in 1..23 {
                    base[i] += base[i - 1];
                }
                let mut vec_c = 0i32;
                for i in (min_len as usize)..=(max_len as usize) {
                    vec_c += base[i + 1] - base[i];
                    limit[i] = vec_c - 1;
                    vec_c <<= 1;
                }
                for i in ((min_len as usize) + 1)..=(max_len as usize) {
                    base[i] = ((limit[i - 1] + 1) << 1) - base[i];
                }
                tables.push(BzTable {
                    min_len,
                    max_len,
                    base,
                    limit,
                    perm,
                });
            }

            let decode_bz_sym = |br: &mut MsbBitReader<'_>, tbl: &BzTable| -> Result<u16, String> {
                let mut zn = tbl.min_len as usize;
                let mut zvec = br.read_bits(tbl.min_len)? as i32;
                while zvec > tbl.limit[zn] {
                    zn += 1;
                    if zn > (tbl.max_len as usize) {
                        return Err("Compressed data error".into());
                    }
                    zvec = (zvec << 1) | (br.read_bits(1)? as i32);
                }
                let idx = (zvec - tbl.base[zn]) as usize;
                tbl.perm.get(idx).copied().ok_or_else(|| "Compressed data error".into())
            };

            let mut yy = seq_to_unseq.clone();
            let mut bwt_block: Vec<u8> = Vec::new();
            let mut group_no = 0usize;
            let mut group_pos = 0usize;
            let mut cur_tbl = &tables[selectors[0]];
            let mut next_sym = decode_bz_sym(&mut br, cur_tbl)?;

            loop {
                if next_sym == eob {
                    break;
                }
                if next_sym == 0 || next_sym == 1 {
                    let mut es = -1i64;
                    let mut n_mult = 1i64;
                    while next_sym == 0 || next_sym == 1 {
                        if next_sym == 0 {
                            es += n_mult;
                        } else {
                            es += 2 * n_mult;
                        }
                        n_mult <<= 1;
                        group_pos += 1;
                        if group_pos == 50 {
                            group_pos = 0;
                            group_no += 1;
                            if group_no >= selectors.len() {
                                return Err("Compressed data error".into());
                            }
                            cur_tbl = &tables[selectors[group_no]];
                        }
                        next_sym = decode_bz_sym(&mut br, cur_tbl)?;
                    }
                    es += 1;
                    let uc = yy[0];
                    if bwt_block.len() + (es as usize) > max_block_size {
                        return Err("Compressed data error".into());
                    }
                    bwt_block.resize(bwt_block.len() + (es as usize), uc);
                    continue;
                }

                let mtf_idx = (next_sym as usize) - 1;
                if mtf_idx >= yy.len() || bwt_block.len() >= max_block_size {
                    return Err("Compressed data error".into());
                }
                let uc = yy.remove(mtf_idx);
                yy.insert(0, uc);
                bwt_block.push(uc);

                group_pos += 1;
                if group_pos == 50 {
                    group_pos = 0;
                    group_no += 1;
                    if group_no >= selectors.len() {
                        return Err("Compressed data error".into());
                    }
                    cur_tbl = &tables[selectors[group_no]];
                }
                next_sym = decode_bz_sym(&mut br, cur_tbl)?;
            }

            if orig_ptr >= bwt_block.len() {
                return Err("Compressed data error".into());
            }

            // Inverse BWT
            let n = bwt_block.len();
            let mut cftab = [0usize; 257];
            for &b in &bwt_block {
                cftab[(b as usize) + 1] += 1;
            }
            for i in 1..=256 {
                cftab[i] += cftab[i - 1];
            }
            let mut tt = vec![0u32; n];
            for (i, &b) in bwt_block.iter().enumerate() {
                let slot = cftab[b as usize];
                cftab[b as usize] += 1;
                tt[slot] = i as u32;
            }
            let mut t_pos = tt[orig_ptr] as usize;

            // Inverse RLE1
            let mut block_out = Vec::with_capacity(n);
            let mut prev_ch: Option<u8> = None;
            let mut run_cnt = 0u8;
            for _ in 0..n {
                let uc = bwt_block[t_pos];
                t_pos = tt[t_pos] as usize;
                if run_cnt == 4 {
                    for _ in 0..uc {
                        block_out.push(prev_ch.unwrap());
                    }
                    run_cnt = 0;
                    prev_ch = None;
                } else {
                    if prev_ch == Some(uc) {
                        run_cnt += 1;
                    } else {
                        run_cnt = 1;
                        prev_ch = Some(uc);
                    }
                    block_out.push(uc);
                }
            }

            let actual_block_crc = bzip2_crc32(&block_out);
            if actual_block_crc != expected_block_crc {
                return Err("Compressed data CRC error".into());
            }
            combined_crc = combined_crc.rotate_left(1) ^ actual_block_crc;
            out.extend_from_slice(&block_out);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// XZ (.xz) and LZMA (.lzma)
// ---------------------------------------------------------------------------

fn write_xz_vli(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push(((v as u8) & 0x7f) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn read_xz_vli(data: &[u8], pos: &mut usize) -> Result<u64, String> {
    let mut val = 0u64;
    for shift in (0..63).step_by(7) {
        if *pos >= data.len() {
            return Err("Compressed data is corrupt".into());
        }
        let b = data[*pos];
        *pos += 1;
        val |= ((b & 0x7f) as u64) << shift;
        if (b & 0x80) == 0 {
            if shift > 0 && b == 0 {
                return Err("Compressed data is corrupt".into());
            }
            return Ok(val);
        }
    }
    Err("Compressed data is corrupt".into())
}

pub fn xz_compress(data: &[u8], check_id: u8) -> Vec<u8> {
    let mut out = Vec::new();
    // 12-byte Stream Header
    out.extend_from_slice(&[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    let flags = [0x00u8, check_id];
    out.extend_from_slice(&flags);
    out.extend_from_slice(&crc32_ieee(&flags).to_le_bytes());

    let mut records: Vec<(u64, u64)> = Vec::new();
    if !data.is_empty() {
        let block_start = out.len();
        // Block Header: 12 bytes total ((2 + 1) * 4 = 12), 1 filter: LZMA2 (0x21), props_len=1, dict_prop=0x18 (4 MiB)
        let bh_body = [0x02u8, 0x00, 0x21, 0x01, 0x18, 0x00, 0x00, 0x00];
        out.extend_from_slice(&bh_body);
        out.extend_from_slice(&crc32_ieee(&bh_body).to_le_bytes());

        for (idx, chunk) in data.chunks(65536).enumerate() {
            out.push(if idx == 0 { 0x01 } else { 0x02 });
            let sz_minus_1 = (chunk.len() - 1) as u16;
            out.extend_from_slice(&sz_minus_1.to_be_bytes());
            out.extend_from_slice(chunk);
        }
        out.push(0x00); // End of LZMA2 payload

        let unpadded_no_check = out.len() - block_start;
        while (out.len() - block_start) % 4 != 0 {
            out.push(0x00);
        }
        let check_bytes: Vec<u8> = match check_id {
            0x00 => Vec::new(),
            0x01 => crc32_ieee(data).to_le_bytes().to_vec(),
            0x04 => crc64_xz(data).to_le_bytes().to_vec(),
            0x0a => crate::commands::archive::sha256_bytes(data).to_vec(),
            _ => crc64_xz(data).to_le_bytes().to_vec(),
        };
        out.extend_from_slice(&check_bytes);
        let unpadded_size = (unpadded_no_check + check_bytes.len()) as u64;
        records.push((unpadded_size, data.len() as u64));
    }

    // Index
    let mut index_buf = Vec::new();
    index_buf.push(0x00);
    write_xz_vli(&mut index_buf, records.len() as u64);
    for &(unpadded, uncomp) in &records {
        write_xz_vli(&mut index_buf, unpadded);
        write_xz_vli(&mut index_buf, uncomp);
    }
    while index_buf.len() % 4 != 0 {
        index_buf.push(0x00);
    }
    let index_crc = crc32_ieee(&index_buf);
    index_buf.extend_from_slice(&index_crc.to_le_bytes());
    let index_size = index_buf.len();
    out.extend_from_slice(&index_buf);

    // 12-byte Stream Footer
    let backward_size = ((index_size / 4) - 1) as u32;
    let mut footer_body = Vec::with_capacity(6);
    footer_body.extend_from_slice(&backward_size.to_le_bytes());
    footer_body.extend_from_slice(&flags);
    let footer_crc = crc32_ieee(&footer_body);
    out.extend_from_slice(&footer_crc.to_le_bytes());
    out.extend_from_slice(&footer_body);
    out.extend_from_slice(b"YZ");
    out
}

struct LzmaRangeEncoder {
    low: u64,
    range: u32,
    cache_size: u64,
    cache: u8,
    out: Vec<u8>,
}

impl LzmaRangeEncoder {
    fn new() -> Self {
        Self {
            low: 0,
            range: 0xffff_ffff,
            cache_size: 1,
            cache: 0,
            out: Vec::new(),
        }
    }

    fn shift_low(&mut self) {
        let low_hi = (self.low >> 32) as u8;
        if (self.low as u32) < 0xff00_0000 || low_hi != 0 {
            let mut temp = self.cache;
            loop {
                self.out.push(temp.wrapping_add(low_hi));
                temp = 0xff;
                self.cache_size -= 1;
                if self.cache_size == 0 {
                    break;
                }
            }
            self.cache = ((self.low >> 24) & 0xff) as u8;
        }
        self.cache_size += 1;
        self.low = (self.low & 0x00ff_ffff) << 8;
    }

    fn encode_bit(&mut self, prob: &mut u16, bit: u32) {
        let p = *prob as u32;
        let bound = (self.range >> 11) * p;
        if bit == 0 {
            self.range = bound;
            *prob = (p + ((2048 - p) >> 5)) as u16;
        } else {
            self.low += bound as u64;
            self.range -= bound;
            *prob = (p - (p >> 5)) as u16;
        }
        if (self.range & 0xff00_0000) == 0 {
            self.range <<= 8;
            self.shift_low();
        }
    }

    fn finish(mut self) -> Vec<u8> {
        for _ in 0..5 {
            self.shift_low();
        }
        self.out
    }
}

pub fn lzma_compress(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(13 + data.len() * 2 + 16);
    out.extend_from_slice(&[0x5d, 0x00, 0x00, 0x80, 0x00]);
    out.extend_from_slice(&(data.len() as u64).to_le_bytes());

    let mut rc = LzmaRangeEncoder::new();
    let mut is_match = [[1024u16; 16]; 12];
    let mut lit_probs = vec![[1024u16; 0x300]; 8];
    let mut state = 0usize;
    let mut prev_byte = 0u8;

    for (pos, &b) in data.iter().enumerate() {
        let pos_state = pos & 3;
        rc.encode_bit(&mut is_match[state][pos_state], 0);
        let lit_state = (prev_byte as usize) >> 5;
        let probs = &mut lit_probs[lit_state];
        let mut symbol = (b as usize) | 0x100;
        while symbol < 0x10000 {
            let bit = ((symbol >> 7) & 1) as u32;
            let idx = symbol >> 8;
            rc.encode_bit(&mut probs[idx], bit);
            symbol <<= 1;
        }
        state = match state {
            0..=3 => 0,
            4..=9 => state - 3,
            _ => state - 6,
        };
        prev_byte = b;
    }
    out.extend_from_slice(&rc.finish());
    out
}

struct LzmaRangeDecoder<'a> {
    data: &'a [u8],
    pos: usize,
    range: u32,
    code: u32,
}

impl<'a> LzmaRangeDecoder<'a> {
    fn new(data: &'a [u8]) -> Result<Self, String> {
        if data.len() < 5 || data[0] != 0x00 {
            return Err("Compressed data is corrupt".into());
        }
        let code = u32::from_be_bytes([data[1], data[2], data[3], data[4]]);
        Ok(Self {
            data,
            pos: 5,
            range: 0xffff_ffff,
            code,
        })
    }

    fn normalize(&mut self) -> Result<(), String> {
        if (self.range & 0xff00_0000) == 0 {
            if self.pos >= self.data.len() {
                return Err("Compressed data is corrupt".into());
            }
            self.range <<= 8;
            self.code = (self.code << 8) | (self.data[self.pos] as u32);
            self.pos += 1;
        }
        Ok(())
    }

    fn decode_bit(&mut self, prob: &mut u16) -> Result<u32, String> {
        self.normalize()?;
        let p = *prob as u32;
        let bound = (self.range >> 11) * p;
        if self.code < bound {
            self.range = bound;
            *prob = (p + ((2048 - p) >> 5)) as u16;
            Ok(0)
        } else {
            self.range -= bound;
            self.code -= bound;
            *prob = (p - (p >> 5)) as u16;
            Ok(1)
        }
    }

    fn decode_direct_bits(&mut self, num_bits: usize) -> Result<u32, String> {
        let mut res = 0u32;
        for _ in 0..num_bits {
            self.normalize()?;
            self.range >>= 1;
            self.code = self.code.wrapping_sub(self.range);
            let t = 0u32.wrapping_sub(self.code >> 31);
            self.code = self.code.wrapping_add(self.range & t);
            res = (res << 1) | (1 - (t & 1));
        }
        Ok(res)
    }

    fn decode_bittree(&mut self, probs: &mut [u16], num_bits: usize) -> Result<u32, String> {
        let mut m = 1usize;
        for _ in 0..num_bits {
            let bit = self.decode_bit(&mut probs[m])? as usize;
            m = (m << 1) | bit;
        }
        Ok((m - (1 << num_bits)) as u32)
    }

    fn decode_bittree_reverse(&mut self, probs: &mut [u16], num_bits: usize) -> Result<u32, String> {
        let mut m = 1usize;
        let mut symbol = 0u32;
        for i in 0..num_bits {
            let bit = self.decode_bit(&mut probs[m])?;
            m = (m << 1) | (bit as usize);
            symbol |= bit << i;
        }
        Ok(symbol)
    }
}

struct LzmaLenDecoder {
    choice: u16,
    choice2: u16,
    low: [[u16; 8]; 16],
    mid: [[u16; 8]; 16],
    high: [u16; 256],
}

impl LzmaLenDecoder {
    fn new() -> Self {
        Self {
            choice: 1024,
            choice2: 1024,
            low: [[1024; 8]; 16],
            mid: [[1024; 8]; 16],
            high: [1024; 256],
        }
    }

    fn reset(&mut self) {
        self.choice = 1024;
        self.choice2 = 1024;
        self.low = [[1024; 8]; 16];
        self.mid = [[1024; 8]; 16];
        self.high = [1024; 256];
    }

    fn decode(&mut self, rc: &mut LzmaRangeDecoder<'_>, pos_state: usize) -> Result<usize, String> {
        if rc.decode_bit(&mut self.choice)? == 0 {
            Ok(rc.decode_bittree(&mut self.low[pos_state], 3)? as usize)
        } else if rc.decode_bit(&mut self.choice2)? == 0 {
            Ok(8 + rc.decode_bittree(&mut self.mid[pos_state], 3)? as usize)
        } else {
            Ok(16 + rc.decode_bittree(&mut self.high, 8)? as usize)
        }
    }
}

struct LzmaState {
    lc: u32,
    lp: u32,
    pb: u32,
    state: usize,
    reps: [usize; 4],
    is_match: [[u16; 16]; 12],
    is_rep: [u16; 12],
    is_rep_g0: [u16; 12],
    is_rep_g1: [u16; 12],
    is_rep_g2: [u16; 12],
    is_rep0_long: [[u16; 16]; 12],
    pos_slot: [[u16; 64]; 4],
    pos_special: [u16; 128],
    pos_align: [u16; 16],
    len_dec: LzmaLenDecoder,
    rep_len_dec: LzmaLenDecoder,
    lit_probs: Vec<[u16; 0x300]>,
}

impl LzmaState {
    fn new(prop: u8) -> Result<Self, String> {
        if prop >= 225 {
            return Err("Compressed data is corrupt".into());
        }
        let lc = (prop % 9) as u32;
        let rem = prop / 9;
        let lp = (rem % 5) as u32;
        let pb = (rem / 5) as u32;
        let num_lit_states = 1usize << (lc + lp);
        Ok(Self {
            lc,
            lp,
            pb,
            state: 0,
            reps: [0; 4],
            is_match: [[1024; 16]; 12],
            is_rep: [1024; 12],
            is_rep_g0: [1024; 12],
            is_rep_g1: [1024; 12],
            is_rep_g2: [1024; 12],
            is_rep0_long: [[1024; 16]; 12],
            pos_slot: [[1024; 64]; 4],
            pos_special: [1024; 128],
            pos_align: [1024; 16],
            len_dec: LzmaLenDecoder::new(),
            rep_len_dec: LzmaLenDecoder::new(),
            lit_probs: vec![[1024u16; 0x300]; num_lit_states],
        })
    }

    fn reset_probs(&mut self, prop: Option<u8>) -> Result<(), String> {
        if let Some(p) = prop {
            if p >= 225 {
                return Err("Compressed data is corrupt".into());
            }
            self.lc = (p % 9) as u32;
            let rem = p / 9;
            self.lp = (rem % 5) as u32;
            self.pb = (rem / 5) as u32;
        }
        self.state = 0;
        self.reps = [0; 4];
        self.is_match = [[1024; 16]; 12];
        self.is_rep = [1024; 12];
        self.is_rep_g0 = [1024; 12];
        self.is_rep_g1 = [1024; 12];
        self.is_rep_g2 = [1024; 12];
        self.is_rep0_long = [[1024; 16]; 12];
        self.pos_slot = [[1024; 64]; 4];
        self.pos_special = [1024; 128];
        self.pos_align = [1024; 16];
        self.len_dec.reset();
        self.rep_len_dec.reset();
        let num_lit_states = 1usize << (self.lc + self.lp);
        self.lit_probs = vec![[1024u16; 0x300]; num_lit_states];
        Ok(())
    }

    fn decode_chunk(
        &mut self,
        payload: &[u8],
        out: &mut Vec<u8>,
        expected_len: Option<usize>,
        allow_eopm: bool,
    ) -> Result<(), String> {
        let mut rc = LzmaRangeDecoder::new(payload)?;
        let start_out_len = out.len();
        let pb_mask = (1usize << self.pb) - 1;
        let lp_mask = (1usize << self.lp) - 1;
        loop {
            if let Some(exp) = expected_len && out.len() - start_out_len >= exp {
                break;
            }
            let pos_state = out.len() & pb_mask;
            if rc.decode_bit(&mut self.is_match[self.state][pos_state])? == 0 {
                let prev_byte = out.last().copied().unwrap_or(0) as usize;
                let lit_state =
                    ((out.len() & lp_mask) << self.lc) | (prev_byte >> (8 - self.lc));
                let probs = &mut self.lit_probs[lit_state];
                let mut symbol = 1usize;
                if self.state >= 7 {
                    let match_dist = self.reps[0] + 1;
                    if match_dist > out.len() {
                        return Err("Compressed data is corrupt".into());
                    }
                    let mut match_byte = out[out.len() - match_dist] as usize;
                    while symbol < 0x100 {
                        let match_bit = (match_byte >> 7) & 1;
                        match_byte <<= 1;
                        let bit = rc.decode_bit(&mut probs[((1 + match_bit) << 8) + symbol])? as usize;
                        symbol = (symbol << 1) | bit;
                        if match_bit != bit {
                            break;
                        }
                    }
                }
                while symbol < 0x100 {
                    let bit = rc.decode_bit(&mut probs[symbol])? as usize;
                    symbol = (symbol << 1) | bit;
                }
                out.push((symbol & 0xff) as u8);
                self.state = match self.state {
                    0..=3 => 0,
                    4..=9 => self.state - 3,
                    _ => self.state - 6,
                };
            } else {
                let len: usize;
                if rc.decode_bit(&mut self.is_rep[self.state])? == 1 {
                    if rc.decode_bit(&mut self.is_rep_g0[self.state])? == 0 {
                        if rc.decode_bit(&mut self.is_rep0_long[self.state][pos_state])? == 0 {
                            self.state = if self.state < 7 { 9 } else { 11 };
                            let dist = self.reps[0] + 1;
                            if dist > out.len() {
                                return Err("Compressed data is corrupt".into());
                            }
                            let b = out[out.len() - dist];
                            out.push(b);
                            continue;
                        }
                    } else {
                        let dist: usize;
                        if rc.decode_bit(&mut self.is_rep_g1[self.state])? == 0 {
                            dist = self.reps[1];
                        } else {
                            if rc.decode_bit(&mut self.is_rep_g2[self.state])? == 0 {
                                dist = self.reps[2];
                            } else {
                                dist = self.reps[3];
                                self.reps[3] = self.reps[2];
                            }
                            self.reps[2] = self.reps[1];
                        }
                        self.reps[1] = self.reps[0];
                        self.reps[0] = dist;
                    }
                    len = 2 + self.rep_len_dec.decode(&mut rc, pos_state)?;
                    self.state = if self.state < 7 { 8 } else { 11 };
                } else {
                    self.reps[3] = self.reps[2];
                    self.reps[2] = self.reps[1];
                    self.reps[1] = self.reps[0];
                    len = 2 + self.len_dec.decode(&mut rc, pos_state)?;
                    self.state = if self.state < 7 { 7 } else { 10 };
                    let len_to_pos_state = (len - 2).min(3);
                    let pos_slot = rc.decode_bittree(&mut self.pos_slot[len_to_pos_state], 6)?;
                    if pos_slot >= 4 {
                        let num_direct_bits = ((pos_slot >> 1) - 1) as usize;
                        let mut dist = (2 | (pos_slot & 1)) << num_direct_bits;
                        if pos_slot < 14 {
                            let base = (dist - pos_slot) as usize;
                            dist += rc.decode_bittree_reverse(
                                &mut self.pos_special[base..],
                                num_direct_bits,
                            )?;
                        } else {
                            dist += rc.decode_direct_bits(num_direct_bits - 4)? << 4;
                            dist += rc.decode_bittree_reverse(&mut self.pos_align, 4)?;
                            if dist == 0xffff_ffff {
                                if allow_eopm {
                                    break;
                                }
                                return Err("Compressed data is corrupt".into());
                            }
                        }
                        self.reps[0] = dist as usize;
                    } else {
                        self.reps[0] = pos_slot as usize;
                    }
                }
                let dist = self.reps[0] + 1;
                if dist > out.len() {
                    return Err("Compressed data is corrupt".into());
                }
                for _ in 0..len {
                    let b = out[out.len() - dist];
                    out.push(b);
                }
            }
        }
        rc.normalize()?;
        Ok(())
    }
}

pub fn lzma_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 13 {
        return Err("File format not recognized".into());
    }
    let prop = data[0];
    if prop >= 225 {
        return Err("File format not recognized".into());
    }
    let uncomp_size = u64::from_le_bytes(data[5..13].try_into().unwrap());
    let has_eopm = uncomp_size == u64::MAX;
    let expected = if has_eopm { None } else { Some(uncomp_size as usize) };
    let mut state = LzmaState::new(prop)?;
    let mut out = Vec::with_capacity(expected.unwrap_or(1024).min(1024 * 1024));
    if expected == Some(0) {
        return Ok(out);
    }
    state.decode_chunk(&data[13..], &mut out, expected, true)?;
    if let Some(exp) = expected && out.len() != exp {
        return Err("Compressed data is corrupt".into());
    }
    Ok(out)
}

pub fn xz_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() >= 6 && &data[0..6] == &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] {
        // .xz format
    } else if data.len() >= 13 && data[0] < 225 {
        return lzma_decompress(data);
    } else {
        return Err("File format not recognized".into());
    }

    let mut pos = 0usize;
    let mut out = Vec::new();
    let mut streams = 0usize;

    while pos < data.len() {
        if streams > 0 && data[pos] == 0 {
            let mut pad = 0usize;
            while pos < data.len() && data[pos] == 0 {
                pos += 1;
                pad += 1;
            }
            if pad % 4 != 0 {
                return Err("Compressed data is corrupt".into());
            }
            if pos == data.len() {
                break;
            }
        }
        if pos + 24 > data.len() || &data[pos..pos + 6] != &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] {
            return Err(if streams == 0 {
                "File format not recognized".into()
            } else {
                "Compressed data is corrupt".into()
            });
        }
        let stream_flags = [data[pos + 6], data[pos + 7]];
        if stream_flags[0] != 0 || stream_flags[1] > 15 {
            return Err("Unsupported options in headers".into());
        }
        let header_crc = u32::from_le_bytes(data[pos + 8..pos + 12].try_into().unwrap());
        if header_crc != crc32_ieee(&stream_flags) {
            return Err("Compressed data is corrupt".into());
        }
        let check_id = stream_flags[1];
        let check_size: usize = match check_id {
            0 => 0,
            1..=3 => 4,
            4..=6 => 8,
            7..=9 => 16,
            10..=12 => 32,
            13..=15 => 64,
            _ => return Err("Compressed data is corrupt".into()),
        };
        pos += 12;

        let mut expected_records: Vec<(u64, u64)> = Vec::new();
        while pos < data.len() && data[pos] != 0x00 {
            let block_start = pos;
            let bh_size = ((data[pos] as usize) + 1) * 4;
            if pos + bh_size > data.len() {
                return Err("Compressed data is corrupt".into());
            }
            let bh_crc = u32::from_le_bytes(data[pos + bh_size - 4..pos + bh_size].try_into().unwrap());
            if bh_crc != crc32_ieee(&data[pos..pos + bh_size - 4]) {
                return Err("Compressed data is corrupt".into());
            }
            let bh_flags = data[pos + 1];
            let num_filters = ((bh_flags & 0x03) + 1) as usize;
            if (bh_flags & 0x3c) != 0 {
                return Err("Compressed data is corrupt".into());
            }
            let mut bh_pos = pos + 2;
            if (bh_flags & 0x40) != 0 {
                let _ = read_xz_vli(&data[..pos + bh_size - 4], &mut bh_pos)?;
            }
            if (bh_flags & 0x80) != 0 {
                let _ = read_xz_vli(&data[..pos + bh_size - 4], &mut bh_pos)?;
            }
            for _ in 0..num_filters {
                let fid = read_xz_vli(&data[..pos + bh_size - 4], &mut bh_pos)?;
                let props_len = read_xz_vli(&data[..pos + bh_size - 4], &mut bh_pos)? as usize;
                if bh_pos + props_len > pos + bh_size - 4 {
                    return Err("Compressed data is corrupt".into());
                }
                if fid == 0x21 && props_len != 1 {
                    return Err("Compressed data is corrupt".into());
                }
                bh_pos += props_len;
            }
            while bh_pos < pos + bh_size - 4 {
                if data[bh_pos] != 0 {
                    return Err("Compressed data is corrupt".into());
                }
                bh_pos += 1;
            }
            pos += bh_size;

            let block_out_start = out.len();
            let mut lzma_state: Option<LzmaState> = None;
            loop {
                if pos >= data.len() {
                    return Err("Compressed data is corrupt".into());
                }
                let ctrl = data[pos];
                pos += 1;
                if ctrl == 0x00 {
                    break;
                }
                if ctrl == 0x01 || ctrl == 0x02 {
                    if pos + 2 > data.len() {
                        return Err("Compressed data is corrupt".into());
                    }
                    let chunk_len = (u16::from_be_bytes([data[pos], data[pos + 1]]) as usize) + 1;
                    pos += 2;
                    if pos + chunk_len > data.len() {
                        return Err("Compressed data is corrupt".into());
                    }
                    out.extend_from_slice(&data[pos..pos + chunk_len]);
                    pos += chunk_len;
                } else if ctrl >= 0x80 {
                    let uncomp_hi = ((ctrl & 0x1f) as usize) << 16;
                    if pos + 4 > data.len() {
                        return Err("Compressed data is corrupt".into());
                    }
                    let uncomp_lo = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
                    let comp_len = (u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize) + 1;
                    pos += 4;
                    let uncomp_len = uncomp_hi + uncomp_lo + 1;
                    let need_props = ctrl >= 0xc0;
                    let reset_state = ctrl >= 0xa0;
                    let prop = if need_props {
                        if pos >= data.len() {
                            return Err("Compressed data is corrupt".into());
                        }
                        let p = data[pos];
                        pos += 1;
                        Some(p)
                    } else {
                        None
                    };
                    if pos + comp_len > data.len() {
                        return Err("Compressed data is corrupt".into());
                    }
                    if reset_state {
                        if let Some(ref mut st) = lzma_state {
                            st.reset_probs(prop)?;
                        } else if let Some(p) = prop {
                            lzma_state = Some(LzmaState::new(p)?);
                        } else {
                            return Err("Compressed data is corrupt".into());
                        }
                    }
                    let Some(ref mut st) = lzma_state else {
                        return Err("Compressed data is corrupt".into());
                    };
                    st.decode_chunk(&data[pos..pos + comp_len], &mut out, Some(uncomp_len), false)?;
                    pos += comp_len;
                } else {
                    return Err("Compressed data is corrupt".into());
                }
            }

            let unpadded_no_check = pos - block_start;
            while (pos - block_start) % 4 != 0 {
                if pos >= data.len() || data[pos] != 0 {
                    return Err("Compressed data is corrupt".into());
                }
                pos += 1;
            }
            if pos + check_size > data.len() {
                return Err("Compressed data is corrupt".into());
            }
            let stored_check = &data[pos..pos + check_size];
            pos += check_size;
            let block_slice = &out[block_out_start..];
            match check_id {
                0 => {}
                1 => {
                    if stored_check != crc32_ieee(block_slice).to_le_bytes() {
                        return Err("Compressed data is corrupt".into());
                    }
                }
                4 => {
                    if stored_check != crc64_xz(block_slice).to_le_bytes() {
                        return Err("Compressed data is corrupt".into());
                    }
                }
                10 => {
                    if stored_check != crate::commands::archive::sha256_bytes(block_slice) {
                        return Err("Compressed data is corrupt".into());
                    }
                }
                _ => {}
            }
            expected_records.push(((unpadded_no_check + check_size) as u64, block_slice.len() as u64));
        }

        // Index
        if pos >= data.len() || data[pos] != 0x00 {
            return Err("Compressed data is corrupt".into());
        }
        let index_start = pos;
        pos += 1;
        let record_count = read_xz_vli(data, &mut pos)? as usize;
        if record_count != expected_records.len() {
            return Err("Compressed data is corrupt".into());
        }
        for &(exp_unpadded, exp_uncomp) in &expected_records {
            let unpadded = read_xz_vli(data, &mut pos)?;
            let uncomp = read_xz_vli(data, &mut pos)?;
            if unpadded != exp_unpadded || uncomp != exp_uncomp {
                return Err("Compressed data is corrupt".into());
            }
        }
        while (pos - index_start) % 4 != 0 {
            if pos >= data.len() || data[pos] != 0 {
                return Err("Compressed data is corrupt".into());
            }
            pos += 1;
        }
        if pos + 4 > data.len() {
            return Err("Compressed data is corrupt".into());
        }
        let idx_crc = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
        if idx_crc != crc32_ieee(&data[index_start..pos]) {
            return Err("Compressed data is corrupt".into());
        }
        pos += 4;
        let index_size = pos - index_start;

        // Stream Footer
        if pos + 12 > data.len() {
            return Err("Compressed data is corrupt".into());
        }
        let footer = &data[pos..pos + 12];
        pos += 12;
        if &footer[10..12] != b"YZ" {
            return Err("Compressed data is corrupt".into());
        }
        let footer_crc = u32::from_le_bytes(footer[0..4].try_into().unwrap());
        if footer_crc != crc32_ieee(&footer[4..10]) {
            return Err("Compressed data is corrupt".into());
        }
        let backward_size = ((u32::from_le_bytes(footer[4..8].try_into().unwrap()) as usize) + 1) * 4;
        if backward_size != index_size || footer[8..10] != stream_flags {
            return Err("Compressed data is corrupt".into());
        }
        streams += 1;
    }

    Ok(out)
}

#[derive(Clone, Debug, Default)]
pub struct XzInspectInfo {
    pub streams: usize,
    pub blocks: usize,
    pub compressed: usize,
    pub uncompressed: usize,
    pub padding: usize,
    pub checks: Vec<u8>,
}

impl XzInspectInfo {
    pub fn ratio_str(&self) -> String {
        if self.uncompressed == 0 {
            return "---".to_string();
        }
        let r = (self.compressed as f64) / (self.uncompressed as f64);
        if !r.is_finite() || r > 9.999 {
            "---".to_string()
        } else {
            format!("{r:.3}")
        }
    }

    pub fn checks_str(&self) -> String {
        let mut sorted = self.checks.clone();
        sorted.sort_unstable();
        sorted.dedup();
        if sorted.is_empty() {
            return "None".to_string();
        }
        sorted
            .iter()
            .map(|&c| match c {
                0 => "None".to_string(),
                1 => "CRC32".to_string(),
                4 => "CRC64".to_string(),
                10 => "SHA-256".to_string(),
                other => format!("Unknown-{other}"),
            })
            .collect::<Vec<_>>()
            .join(",")
    }

    pub fn human_line(&self, name: &str) -> String {
        fn fmt_size(bytes: usize) -> String {
            if bytes < 10000 {
                return format!("{bytes} B");
            }
            let units = ["KiB", "MiB", "GiB", "TiB"];
            let mut unit = 0usize;
            let mut amount = (bytes as f64) / 1024.0;
            while amount >= 10000.0 && unit + 1 < units.len() {
                amount /= 1024.0;
                unit += 1;
            }
            format!("{amount:.1} {}", units[unit])
        }
        format!(
            "{:>5} {:>7} {:>12} {:>12} {:>6}  {:<7} {}\n",
            self.streams,
            self.blocks,
            fmt_size(self.compressed),
            fmt_size(self.uncompressed),
            self.ratio_str(),
            self.checks_str(),
            name
        )
    }
}

pub fn inspect_xz_bytes(data: &[u8]) -> Result<XzInspectInfo, String> {
    if data.len() < 24 {
        return Err("File format not recognized".into());
    }
    let mut info = XzInspectInfo {
        compressed: data.len(),
        ..Default::default()
    };
    let mut end = data.len();
    while end > 0 {
        let mut zeros = 0usize;
        while end > zeros && data[end - 1 - zeros] == 0 {
            zeros += 1;
        }
        if zeros % 4 != 0 {
            return Err("Compressed data is corrupt".into());
        }
        info.padding += zeros;
        end -= zeros;
        if end < 24 {
            return Err("Compressed data is corrupt".into());
        }
        let footer = &data[end - 12..end];
        if &footer[10..12] != b"YZ"
            || u32::from_le_bytes(footer[0..4].try_into().unwrap()) != crc32_ieee(&footer[4..10])
            || footer[8] != 0
            || footer[9] > 15
        {
            return Err("Compressed data is corrupt".into());
        }
        let index_size = ((u32::from_le_bytes(footer[4..8].try_into().unwrap()) as usize) + 1) * 4;
        if end < 12 + index_size + 12 {
            return Err("Compressed data is corrupt".into());
        }
        let index_start = end - 12 - index_size;
        let index_end_no_crc = end - 16;
        let stored_idx_crc = u32::from_le_bytes(data[index_end_no_crc..end - 12].try_into().unwrap());
        if stored_idx_crc != crc32_ieee(&data[index_start..index_end_no_crc]) {
            return Err("Compressed data is corrupt".into());
        }
        let mut pos = index_start;
        if data[pos] != 0 {
            return Err("Compressed data is corrupt".into());
        }
        pos += 1;
        let count = read_xz_vli(&data[..index_end_no_crc], &mut pos)? as usize;
        let mut block_bytes = 0usize;
        let mut uncomp = 0usize;
        for _ in 0..count {
            let unpadded = read_xz_vli(&data[..index_end_no_crc], &mut pos)? as usize;
            let decoded = read_xz_vli(&data[..index_end_no_crc], &mut pos)? as usize;
            if unpadded < 5 {
                return Err("Compressed data is corrupt".into());
            }
            block_bytes += (unpadded + 3) & !3;
            uncomp += decoded;
            if block_bytes > index_start - 12 {
                return Err("Compressed data is corrupt".into());
            }
        }
        if index_end_no_crc - pos > 3 || data[pos..index_end_no_crc].iter().any(|&b| b != 0) {
            return Err("Compressed data is corrupt".into());
        }
        let start = index_start - block_bytes - 12;
        let header = &data[start..start + 12];
        if &header[0..6] != &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]
            || header[6..8] != footer[8..10]
            || u32::from_le_bytes(header[8..12].try_into().unwrap()) != crc32_ieee(&header[6..8])
        {
            return Err("Compressed data is corrupt".into());
        }
        info.streams += 1;
        info.blocks += count;
        info.uncompressed += uncomp;
        if !info.checks.contains(&footer[9]) {
            info.checks.push(footer[9]);
        }
        end = start;
    }
    if info.streams == 0 {
        return Err("File format not recognized".into());
    }
    Ok(info)
}

// ---------------------------------------------------------------------------
// Zstandard (.zst) - RFC 8878
// ---------------------------------------------------------------------------

pub fn zstd_compress(data: &[u8], include_checksum: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(18 + data.len() + (data.len() / 131072 + 1) * 3);
    out.extend_from_slice(&[0x28, 0xb5, 0x2f, 0xfd]);
    let fcs_flag = if data.len() <= 255 {
        0u8
    } else if data.len() <= 65535 + 256 {
        1u8
    } else if (data.len() as u64) <= 0xffff_ffff {
        2u8
    } else {
        3u8
    };
    let fhd = (fcs_flag << 6) | 0x20 | (if include_checksum { 0x04 } else { 0x00 });
    out.push(fhd);
    match fcs_flag {
        0 => out.push(data.len() as u8),
        1 => out.extend_from_slice(&((data.len() - 256) as u16).to_le_bytes()),
        2 => out.extend_from_slice(&(data.len() as u32).to_le_bytes()),
        _ => out.extend_from_slice(&(data.len() as u64).to_le_bytes()),
    }

    if data.is_empty() {
        out.extend_from_slice(&[0x01, 0x00, 0x00]);
    } else {
        let chunks: Vec<&[u8]> = data.chunks(131072).collect();
        for (idx, chunk) in chunks.iter().enumerate() {
            let last = if idx + 1 == chunks.len() { 1u32 } else { 0u32 };
            let bh = ((chunk.len() as u32) << 3) | last;
            out.push((bh & 0xff) as u8);
            out.push(((bh >> 8) & 0xff) as u8);
            out.push(((bh >> 16) & 0xff) as u8);
            out.extend_from_slice(chunk);
        }
    }

    if include_checksum {
        let cksum = (xxh64(data, 0) & 0xffff_ffff) as u32;
        out.extend_from_slice(&cksum.to_le_bytes());
    }
    out
}

#[derive(Clone, Copy)]
struct FseEntry {
    symbol: u8,
    num_bits: u8,
    new_state_base: u16,
}

fn build_fse_table(norm: &[i16], accuracy_log: u8) -> Result<Vec<FseEntry>, String> {
    let table_size = 1usize << accuracy_log;
    let mut table_symbol = vec![0u8; table_size];
    let mut state_desc = vec![0u16; norm.len()];
    let mut high_threshold = table_size;

    for (sym, &cnt) in norm.iter().enumerate() {
        if cnt == -1 {
            if high_threshold == 0 {
                return Err("Corrupted block detected".into());
            }
            high_threshold -= 1;
            table_symbol[high_threshold] = sym as u8;
            state_desc[sym] = 1;
        }
    }

    let step = (table_size >> 1) + (table_size >> 3) + 3;
    let mask = table_size - 1;
    let mut pos = 0usize;
    for (sym, &cnt) in norm.iter().enumerate() {
        if cnt > 0 {
            state_desc[sym] = cnt as u16;
            for _ in 0..cnt {
                table_symbol[pos] = sym as u8;
                loop {
                    pos = (pos + step) & mask;
                    if pos < high_threshold {
                        break;
                    }
                }
            }
        }
    }
    if pos != 0 {
        return Err("Corrupted block detected".into());
    }

    let mut table = Vec::with_capacity(table_size);
    for &sym in &table_symbol {
        let next_state = state_desc[sym as usize] as usize;
        state_desc[sym as usize] += 1;
        let highest_bit = (usize::BITS - 1 - next_state.leading_zeros()) as u8;
        let num_bits = accuracy_log - highest_bit;
        let new_state_base = ((next_state << num_bits) - table_size) as u16;
        table.push(FseEntry {
            symbol: sym,
            num_bits,
            new_state_base,
        });
    }
    Ok(table)
}

fn read_fse_table_desc(data: &[u8], max_symbol: usize, max_log: u8) -> Result<(Vec<FseEntry>, u8, usize), String> {
    if data.is_empty() {
        return Err("Corrupted block detected".into());
    }
    let mut bit_pos = 0usize;
    let read_bits = |bpos: &mut usize, n: usize| -> u32 {
        let mut val = 0u32;
        for i in 0..n {
            let byte_idx = *bpos >> 3;
            let bit_idx = *bpos & 7;
            if byte_idx < data.len() {
                val |= (((data[byte_idx] >> bit_idx) & 1) as u32) << i;
            }
            *bpos += 1;
        }
        val
    };
    let accuracy_log = (read_bits(&mut bit_pos, 4) as u8) + 5;
    if accuracy_log > max_log {
        return Err("Corrupted block detected".into());
    }
    let mut remaining = (1i32 << accuracy_log) + 1;
    let mut threshold = 1i32 << accuracy_log;
    let mut nb_bits = (accuracy_log + 1) as usize;
    let mut norm = Vec::new();
    let mut prev_zero = false;

    while remaining > 1 && norm.len() <= max_symbol {
        if prev_zero {
            loop {
                let repeat = read_bits(&mut bit_pos, 2) as usize;
                for _ in 0..repeat {
                    if norm.len() <= max_symbol {
                        norm.push(0);
                    }
                }
                if repeat < 3 {
                    break;
                }
            }
        }
        if norm.len() > max_symbol {
            break;
        }
        let max_val = (2 * threshold - 1) - remaining;
        let small_bits = nb_bits - 1;
        let low = read_bits(&mut bit_pos, small_bits) as i32;
        let count = if low < max_val {
            low
        } else {
            let hi = read_bits(&mut bit_pos, 1) as i32;
            let full = low | (hi << small_bits);
            if full >= threshold {
                full - max_val
            } else {
                full
            }
        };
        let prob = count - 1;
        if prob == -1 {
            remaining -= 1;
        } else {
            remaining -= prob;
        }
        norm.push(prob as i16);
        prev_zero = prob == 0;
        while remaining < threshold && threshold > 1 {
            nb_bits -= 1;
            threshold >>= 1;
        }
    }
    if remaining != 1 {
        return Err("Corrupted block detected".into());
    }
    let bytes_read = (bit_pos + 7) >> 3;
    if bytes_read > data.len() {
        return Err("Corrupted block detected".into());
    }
    let table = build_fse_table(&norm, accuracy_log)?;
    Ok((table, accuracy_log, bytes_read))
}

struct BackwardBitReader<'a> {
    data: &'a [u8],
    bit_pos: isize,
}

impl<'a> BackwardBitReader<'a> {
    fn new(data: &'a [u8]) -> Result<Self, String> {
        if data.is_empty() {
            return Err("Corrupted block detected".into());
        }
        let last = data[data.len() - 1];
        if last == 0 {
            return Err("Corrupted block detected".into());
        }
        let highest = 7 - (last.leading_zeros() as isize);
        let bit_pos = ((data.len() - 1) as isize) * 8 + highest;
        Ok(Self { data, bit_pos })
    }

    fn read_bits(&mut self, n: usize) -> Result<usize, String> {
        if n == 0 {
            return Ok(0);
        }
        let mut val = 0usize;
        for _ in 0..n {
            self.bit_pos -= 1;
            let bit = if self.bit_pos >= 0 {
                let byte_idx = (self.bit_pos as usize) >> 3;
                let bit_idx = (self.bit_pos as usize) & 7;
                ((self.data[byte_idx] >> bit_idx) & 1) as usize
            } else {
                0
            };
            val = (val << 1) | bit;
        }
        Ok(val)
    }

    fn is_empty(&self) -> bool {
        self.bit_pos <= 0
    }
}

#[derive(Clone, Default)]
struct ZstdHufTable {
    max_bits: u8,
    symbols: Vec<u8>,
    num_bits: Vec<u8>,
}

impl ZstdHufTable {
    fn from_weights(weights: &[u8]) -> Result<Self, String> {
        let mut sum = 0u32;
        for &w in weights {
            if w > 0 {
                sum += 1u32 << (w - 1);
            }
        }
        if sum == 0 {
            return Err("Corrupted block detected".into());
        }
        let max_bits = (u32::BITS - sum.leading_zeros()) as u8;
        let total_space = 1u32 << max_bits;
        let rem = total_space.checked_sub(sum).ok_or_else(|| "Corrupted block detected".to_string())?;
        if rem == 0 || (rem & (rem - 1)) != 0 {
            return Err("Corrupted block detected".into());
        }
        let last_weight = (rem.trailing_zeros() as u8) + 1;
        let mut all_weights = weights.to_vec();
        all_weights.push(last_weight);

        let mut rank_count = [0usize; 16];
        for &w in &all_weights {
            if (w as usize) >= rank_count.len() {
                return Err("Corrupted block detected".into());
            }
            rank_count[w as usize] += 1;
        }
        let table_size = 1usize << max_bits;
        let mut symbols = vec![0u8; table_size];
        let mut num_bits = vec![0u8; table_size];

        let mut rank_idx = [0usize; 16];
        let mut cur = 0usize;
        for w in 1..=(max_bits as usize) {
            rank_idx[w] = cur;
            cur += rank_count[w] * (1usize << (w - 1));
        }
        for (sym, &w) in all_weights.iter().enumerate() {
            if w == 0 {
                continue;
            }
            let nb = max_bits + 1 - w;
            let span = 1usize << (w - 1);
            let start = rank_idx[w as usize];
            rank_idx[w as usize] += span;
            for slot in start..start + span {
                symbols[slot] = sym as u8;
                num_bits[slot] = nb;
            }
        }
        Ok(Self {
            max_bits,
            symbols,
            num_bits,
        })
    }

    fn decode_stream(&self, stream: &[u8], out: &mut Vec<u8>, expected: usize) -> Result<(), String> {
        let mut br = BackwardBitReader::new(stream)?;
        let start_len = out.len();
        let max_b = self.max_bits as usize;
        let mask = (1usize << max_b) - 1;
        let mut state = br.read_bits(max_b)?;
        while out.len() - start_len < expected {
            let sym = self.symbols[state];
            let nb = self.num_bits[state] as usize;
            out.push(sym);
            if out.len() - start_len >= expected {
                break;
            }
            let rest = br.read_bits(nb)?;
            state = ((state << nb) & mask) | rest;
        }
        Ok(())
    }
}

fn parse_zstd_huf_tree(data: &[u8]) -> Result<(ZstdHufTable, usize), String> {
    if data.is_empty() {
        return Err("Corrupted block detected".into());
    }
    let hdr = data[0];
    if hdr >= 128 {
        let num_weights = (hdr - 127) as usize;
        let byte_len = (num_weights + 1) / 2;
        if 1 + byte_len > data.len() {
            return Err("Corrupted block detected".into());
        }
        let mut weights = Vec::with_capacity(num_weights);
        for i in 0..num_weights {
            let b = data[1 + i / 2];
            let w = if i % 2 == 0 { b >> 4 } else { b & 0x0f };
            weights.push(w);
        }
        let tbl = ZstdHufTable::from_weights(&weights)?;
        Ok((tbl, 1 + byte_len))
    } else {
        let comp_size = hdr as usize;
        if 1 + comp_size > data.len() {
            return Err("Corrupted block detected".into());
        }
        let sub = &data[1..1 + comp_size];
        let (fse_tbl, acc_log, fse_hdr_len) = read_fse_table_desc(sub, 12, 6)?;
        let stream = &sub[fse_hdr_len..];
        let mut br = BackwardBitReader::new(stream)?;
        let mut state1 = br.read_bits(acc_log as usize)?;
        let mut state2 = br.read_bits(acc_log as usize)?;
        let mut weights = Vec::new();
        loop {
            let e1 = fse_tbl[state1];
            weights.push(e1.symbol);
            if br.bit_pos < (e1.num_bits as isize) {
                weights.push(fse_tbl[state2].symbol);
                break;
            }
            state1 = (e1.new_state_base as usize) + br.read_bits(e1.num_bits as usize)?;
            let e2 = fse_tbl[state2];
            weights.push(e2.symbol);
            if br.bit_pos < (e2.num_bits as isize) {
                weights.push(fse_tbl[state1].symbol);
                break;
            }
            state2 = (e2.new_state_base as usize) + br.read_bits(e2.num_bits as usize)?;
        }
        let tbl = ZstdHufTable::from_weights(&weights)?;
        Ok((tbl, 1 + comp_size))
    }
}

struct ZstdFrameDecoderState {
    huf_table: Option<ZstdHufTable>,
    ll_table: Option<(Vec<FseEntry>, u8)>,
    of_table: Option<(Vec<FseEntry>, u8)>,
    ml_table: Option<(Vec<FseEntry>, u8)>,
    rep: [usize; 3],
}

impl ZstdFrameDecoderState {
    fn new() -> Self {
        Self {
            huf_table: None,
            ll_table: None,
            of_table: None,
            ml_table: None,
            rep: [1, 4, 8],
        }
    }
}

pub fn zstd_decompress(data: &[u8], allow_foreign: bool) -> Result<Vec<u8>, String> {
    if data.is_empty() {
        return Err("unexpected end of file".into());
    }
    let mut pos = 0usize;
    let mut out = Vec::new();
    let mut frames = 0usize;

    while pos < data.len() {
        let rem = &data[pos..];
        if allow_foreign {
            if rem.len() >= 2 && rem[0] == 0x1f && rem[1] == 0x8b {
                let dec = gzip_decompress(rem)?;
                out.extend_from_slice(&dec);
                return Ok(out);
            }
            if rem.len() >= 6 && &rem[0..6] == &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] {
                let dec = xz_decompress(rem)?;
                out.extend_from_slice(&dec);
                return Ok(out);
            }
            if rem.len() >= 13 && rem[0] == 0x5d && rem[1] == 0x00 {
                let dec = lzma_decompress(rem)?;
                out.extend_from_slice(&dec);
                return Ok(out);
            }
            if rem.len() >= 4 && &rem[0..3] == b"BZh" && (b'1'..=b'9').contains(&rem[3]) {
                let dec = bzip2_decompress(rem)?;
                out.extend_from_slice(&dec);
                return Ok(out);
            }
        }

        if rem.len() < 4 {
            return Err("Unknown frame descriptor".into());
        }
        let magic = u32::from_le_bytes([rem[0], rem[1], rem[2], rem[3]]);
        if (0x184d_2a50..=0x184d_2a5f).contains(&magic) {
            if rem.len() < 8 {
                return Err("Src size is incorrect".into());
            }
            let frame_size = u32::from_le_bytes([rem[4], rem[5], rem[6], rem[7]]) as usize;
            if pos + 8 + frame_size > data.len() {
                return Err("Src size is incorrect".into());
            }
            pos += 8 + frame_size;
            frames += 1;
            continue;
        }
        if magic != 0xfd2f_b528 {
            return Err("Unknown frame descriptor".into());
        }
        pos += 4;
        if pos >= data.len() {
            return Err("Src size is incorrect".into());
        }
        let fhd = data[pos];
        pos += 1;
        if (fhd & 0x18) != 0 {
            return Err("Reserved bit set".into());
        }
        let fcs_flag = fhd >> 6;
        let single_segment = (fhd & 0x20) != 0;
        let has_checksum = (fhd & 0x04) != 0;
        let dict_id_flag = fhd & 0x03;

        if !single_segment {
            if pos >= data.len() {
                return Err("Src size is incorrect".into());
            }
            pos += 1;
        }
        let dict_id_bytes = match dict_id_flag {
            0 => 0,
            1 => 1,
            2 => 2,
            _ => 4,
        };
        if pos + dict_id_bytes > data.len() {
            return Err("Src size is incorrect".into());
        }
        if dict_id_bytes > 0 {
            let mut dict_id = 0u32;
            for b in 0..dict_id_bytes {
                dict_id |= (data[pos + b] as u32) << (b * 8);
            }
            if dict_id != 0 {
                return Err("Dictionary mismatch".into());
            }
            pos += dict_id_bytes;
        }

        let expected_fcs: Option<u64> = match (fcs_flag, single_segment) {
            (0, false) => None,
            (0, true) => {
                if pos >= data.len() {
                    return Err("Src size is incorrect".into());
                }
                let v = data[pos] as u64;
                pos += 1;
                Some(v)
            }
            (1, _) => {
                if pos + 2 > data.len() {
                    return Err("Src size is incorrect".into());
                }
                let v = (u16::from_le_bytes([data[pos], data[pos + 1]]) as u64) + 256;
                pos += 2;
                Some(v)
            }
            (2, _) => {
                if pos + 4 > data.len() {
                    return Err("Src size is incorrect".into());
                }
                let v = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as u64;
                pos += 4;
                Some(v)
            }
            _ => {
                if pos + 8 > data.len() {
                    return Err("Src size is incorrect".into());
                }
                let v = u64::from_le_bytes(data[pos..pos + 8].try_into().unwrap());
                pos += 8;
                Some(v)
            }
        };

        let frame_out_start = out.len();
        let mut fstate = ZstdFrameDecoderState::new();
        loop {
            if pos + 3 > data.len() {
                return Err("Src size is incorrect".into());
            }
            let bh = (data[pos] as u32)
                | ((data[pos + 1] as u32) << 8)
                | ((data[pos + 2] as u32) << 16);
            pos += 3;
            let last_block = (bh & 1) != 0;
            let block_type = (bh >> 1) & 3;
            let block_size = (bh >> 3) as usize;
            match block_type {
                0 => {
                    if pos + block_size > data.len() {
                        return Err("Src size is incorrect".into());
                    }
                    out.extend_from_slice(&data[pos..pos + block_size]);
                    pos += block_size;
                }
                1 => {
                    if pos >= data.len() {
                        return Err("Src size is incorrect".into());
                    }
                    let b = data[pos];
                    pos += 1;
                    out.resize(out.len() + block_size, b);
                }
                2 => {
                    if pos + block_size > data.len() {
                        return Err("Src size is incorrect".into());
                    }
                    zstd_decode_compressed_block(
                        &data[pos..pos + block_size],
                        &mut out,
                        frame_out_start,
                        &mut fstate,
                    )?;
                    pos += block_size;
                }
                _ => return Err("Corrupted block detected".into()),
            }
            if last_block {
                break;
            }
        }

        let frame_slice = &out[frame_out_start..];
        if let Some(fcs) = expected_fcs && (frame_slice.len() as u64) != fcs {
            return Err("Restored data doesn't match checksum".into());
        }
        if has_checksum {
            if pos + 4 > data.len() {
                return Err("Src size is incorrect".into());
            }
            let stored = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
            pos += 4;
            let actual = (xxh64(frame_slice, 0) & 0xffff_ffff) as u32;
            if stored != actual {
                return Err("Restored data doesn't match checksum".into());
            }
        }
        frames += 1;
    }

    let _ = frames;
    Ok(out)
}

fn zstd_decode_compressed_block(
    block: &[u8],
    out: &mut Vec<u8>,
    frame_start: usize,
    fstate: &mut ZstdFrameDecoderState,
) -> Result<(), String> {
    if block.is_empty() {
        return Err("Corrupted block detected".into());
    }
    let lit_hdr = block[0];
    let lit_type = lit_hdr & 3;
    let size_fmt = (lit_hdr >> 2) & 3;
    let mut literals = Vec::new();
    let seq_offset: usize;

    match lit_type {
        0 | 1 => {
            let (regen_size, comp_size, hdr_size) = match size_fmt {
                0 | 2 => (
                    (lit_hdr >> 3) as usize,
                    if lit_type == 1 { 1 } else { (lit_hdr >> 3) as usize },
                    1usize,
                ),
                1 => {
                    if block.len() < 2 {
                        return Err("Corrupted block detected".into());
                    }
                    let s = (((lit_hdr >> 4) as usize) | ((block[1] as usize) << 4)) & 0xfff;
                    (s, if lit_type == 1 { 1 } else { s }, 2)
                }
                _ => {
                    if block.len() < 3 {
                        return Err("Corrupted block detected".into());
                    }
                    let s = ((lit_hdr >> 4) as usize)
                        | ((block[1] as usize) << 4)
                        | ((block[2] as usize) << 12);
                    (s, if lit_type == 1 { 1 } else { s }, 3)
                }
            };
            if hdr_size + comp_size > block.len() {
                return Err("Corrupted block detected".into());
            }
            if lit_type == 0 {
                literals.extend_from_slice(&block[hdr_size..hdr_size + comp_size]);
            } else {
                let b = if comp_size > 0 { block[hdr_size] } else { 0 };
                literals.resize(regen_size, b);
            }
            seq_offset = hdr_size + comp_size;
        }
        2 | 3 => {
            let (num_streams, regen_size, comp_size, hdr_size) = match size_fmt {
                0 | 1 => {
                    if block.len() < 3 {
                        return Err("Corrupted block detected".into());
                    }
                    let v = (block[0] as usize)
                        | ((block[1] as usize) << 8)
                        | ((block[2] as usize) << 16);
                    (
                        if size_fmt == 0 { 1usize } else { 4usize },
                        (v >> 4) & 0x3ff,
                        (v >> 14) & 0x3ff,
                        3usize,
                    )
                }
                2 => {
                    if block.len() < 4 {
                        return Err("Corrupted block detected".into());
                    }
                    let v = u32::from_le_bytes(block[0..4].try_into().unwrap()) as usize;
                    (4usize, (v >> 4) & 0x3fff, (v >> 18) & 0x3fff, 4usize)
                }
                _ => {
                    if block.len() < 5 {
                        return Err("Corrupted block detected".into());
                    }
                    let regen = ((block[0] as usize) >> 4)
                        | ((block[1] as usize) << 4)
                        | (((block[2] as usize) & 0x3f) << 12);
                    let comp = ((block[2] as usize) >> 6)
                        | ((block[3] as usize) << 2)
                        | ((block[4] as usize) << 10);
                    (4usize, regen, comp, 5usize)
                }
            };
            if hdr_size + comp_size > block.len() {
                return Err("Corrupted block detected".into());
            }
            let lit_payload = &block[hdr_size..hdr_size + comp_size];
            let tree_bytes = if lit_type == 2 {
                let (tbl, consumed) = parse_zstd_huf_tree(lit_payload)?;
                fstate.huf_table = Some(tbl);
                consumed
            } else {
                0usize
            };
            let Some(ref huf) = fstate.huf_table else {
                return Err("Corrupted block detected".into());
            };
            let streams_data = &lit_payload[tree_bytes..];
            literals.reserve(regen_size);
            if num_streams == 1 {
                huf.decode_stream(streams_data, &mut literals, regen_size)?;
            } else {
                if streams_data.len() < 6 {
                    return Err("Corrupted block detected".into());
                }
                let s1_len = u16::from_le_bytes([streams_data[0], streams_data[1]]) as usize;
                let s2_len = u16::from_le_bytes([streams_data[2], streams_data[3]]) as usize;
                let s3_len = u16::from_le_bytes([streams_data[4], streams_data[5]]) as usize;
                if 6 + s1_len + s2_len + s3_len > streams_data.len() {
                    return Err("Corrupted block detected".into());
                }
                let s4_len = streams_data.len() - (6 + s1_len + s2_len + s3_len);
                let chunk_regen = (regen_size + 3) / 4;
                let rem_regen = regen_size.saturating_sub(chunk_regen * 3);
                let mut spos = 6usize;
                for (slen, exp) in [
                    (s1_len, chunk_regen),
                    (s2_len, chunk_regen),
                    (s3_len, chunk_regen),
                    (s4_len, rem_regen),
                ] {
                    huf.decode_stream(&streams_data[spos..spos + slen], &mut literals, exp)?;
                    spos += slen;
                }
            }
            seq_offset = hdr_size + comp_size;
        }
        _ => unreachable!(),
    }

    let seq_sec = &block[seq_offset..];
    if seq_sec.is_empty() {
        return Err("Corrupted block detected".into());
    }
    let b0 = seq_sec[0] as usize;
    if b0 == 0 {
        if seq_sec.len() != 1 {
            return Err("Corrupted block detected".into());
        }
        out.extend_from_slice(&literals);
        return Ok(());
    }
    let (num_seq, mut spos) = if b0 < 128 {
        (b0, 1usize)
    } else if b0 < 255 {
        if seq_sec.len() < 2 {
            return Err("Corrupted block detected".into());
        }
        (((b0 - 128) << 8) + (seq_sec[1] as usize), 2usize)
    } else {
        if seq_sec.len() < 3 {
            return Err("Corrupted block detected".into());
        }
        (
            (seq_sec[1] as usize) + ((seq_sec[2] as usize) << 8) + 0x7f00,
            3usize,
        )
    };
    if spos >= seq_sec.len() {
        return Err("Corrupted block detected".into());
    }
    let modes = seq_sec[spos];
    spos += 1;
    if (modes & 3) != 0 {
        return Err("Corrupted block detected".into());
    }
    let ll_mode = (modes >> 6) & 3;
    let of_mode = (modes >> 4) & 3;
    let ml_mode = (modes >> 2) & 3;

    const LL_DEFAULT_NORM: [i16; 36] = [
        4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1,
        1, 1, -1, -1, -1, -1,
    ];
    const OF_DEFAULT_NORM: [i16; 29] = [
        1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1,
    ];
    const ML_DEFAULT_NORM: [i16; 53] = [
        1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
    ];

    let resolve_mode = |mode: u8,
                        spos: &mut usize,
                        def_norm: &[i16],
                        def_log: u8,
                        max_sym: usize,
                        max_log: u8,
                        prev: &mut Option<(Vec<FseEntry>, u8)>|
     -> Result<(Vec<FseEntry>, u8), String> {
        let res = match mode {
            0 => (build_fse_table(def_norm, def_log)?, def_log),
            1 => {
                if *spos >= seq_sec.len() {
                    return Err("Corrupted block detected".into());
                }
                let sym = seq_sec[*spos];
                *spos += 1;
                (
                    vec![FseEntry {
                        symbol: sym,
                        num_bits: 0,
                        new_state_base: 0,
                    }],
                    0u8,
                )
            }
            2 => {
                let (tbl, log, read_b) = read_fse_table_desc(&seq_sec[*spos..], max_sym, max_log)?;
                *spos += read_b;
                (tbl, log)
            }
            _ => prev.clone().ok_or_else(|| "Corrupted block detected".to_string())?,
        };
        *prev = Some(res.clone());
        Ok(res)
    };

    let (ll_tbl, ll_log) = resolve_mode(
        ll_mode,
        &mut spos,
        &LL_DEFAULT_NORM,
        6,
        35,
        9,
        &mut fstate.ll_table,
    )?;
    let (of_tbl, of_log) = resolve_mode(
        of_mode,
        &mut spos,
        &OF_DEFAULT_NORM,
        5,
        31,
        8,
        &mut fstate.of_table,
    )?;
    let (ml_tbl, ml_log) = resolve_mode(
        ml_mode,
        &mut spos,
        &ML_DEFAULT_NORM,
        6,
        52,
        9,
        &mut fstate.ml_table,
    )?;

    let mut br = BackwardBitReader::new(&seq_sec[spos..])?;
    let mut ll_state = br.read_bits(ll_log as usize)?;
    let mut of_state = br.read_bits(of_log as usize)?;
    let mut ml_state = br.read_bits(ml_log as usize)?;

    const LL_BASE: [usize; 36] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48,
        64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
    ];
    const LL_BITS: [u8; 36] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10,
        11, 12, 13, 14, 15, 16,
    ];
    const ML_BASE: [usize; 53] = [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
        27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515,
        1027, 2051, 4099, 8195, 16387, 32771, 65539,
    ];
    const ML_BITS: [u8; 53] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ];

    let mut lit_pos = 0usize;
    for seq_idx in 0..num_seq {
        let ll_e = ll_tbl[ll_state];
        let of_e = of_tbl[of_state];
        let ml_e = ml_tbl[ml_state];

        let of_code = of_e.symbol as usize;
        if of_code > 31 {
            return Err("Corrupted block detected".into());
        }
        let of_extra = br.read_bits(of_code)?;
        let raw_offset = (1usize << of_code) + of_extra;

        let ml_code = ml_e.symbol as usize;
        if ml_code >= ML_BASE.len() {
            return Err("Corrupted block detected".into());
        }
        let match_len = ML_BASE[ml_code] + br.read_bits(ML_BITS[ml_code] as usize)?;

        let ll_code = ll_e.symbol as usize;
        if ll_code >= LL_BASE.len() {
            return Err("Corrupted block detected".into());
        }
        let lit_len = LL_BASE[ll_code] + br.read_bits(LL_BITS[ll_code] as usize)?;

        let actual_offset = if raw_offset > 3 {
            let off = raw_offset - 3;
            fstate.rep[2] = fstate.rep[1];
            fstate.rep[1] = fstate.rep[0];
            fstate.rep[0] = off;
            off
        } else {
            let mut idx = raw_offset - 1;
            if lit_len == 0 {
                idx += 1;
            }
            let off = if idx == 0 {
                fstate.rep[0]
            } else {
                let chosen = if idx == 3 {
                    fstate.rep[0].checked_sub(1).ok_or_else(|| "Corrupted block detected".to_string())?
                } else {
                    fstate.rep[idx]
                };
                if idx > 1 {
                    fstate.rep[2] = fstate.rep[1];
                }
                fstate.rep[1] = fstate.rep[0];
                fstate.rep[0] = chosen;
                chosen
            };
            if off == 0 {
                return Err("Corrupted block detected".into());
            }
            off
        };

        if seq_idx + 1 < num_seq {
            ll_state = (ll_e.new_state_base as usize) + br.read_bits(ll_e.num_bits as usize)?;
            ml_state = (ml_e.new_state_base as usize) + br.read_bits(ml_e.num_bits as usize)?;
            of_state = (of_e.new_state_base as usize) + br.read_bits(of_e.num_bits as usize)?;
        }

        if lit_pos + lit_len > literals.len() {
            return Err("Corrupted block detected".into());
        }
        out.extend_from_slice(&literals[lit_pos..lit_pos + lit_len]);
        lit_pos += lit_len;

        if actual_offset > out.len() - frame_start {
            return Err("Corrupted block detected".into());
        }
        for _ in 0..match_len {
            let b = out[out.len() - actual_offset];
            out.push(b);
        }
    }
    if lit_pos < literals.len() {
        out.extend_from_slice(&literals[lit_pos..]);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// PKZIP (.zip)
// ---------------------------------------------------------------------------

fn unix_to_dos_datetime(epoch_secs: u64) -> (u16, u16) {
    let days = (epoch_secs / 86400) as i64;
    let rem = epoch_secs % 86400;
    let hour = (rem / 3600) as u16;
    let min = ((rem % 3600) / 60) as u16;
    let sec = (rem % 60) as u16;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u16;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u16;
    let year = (if m <= 2 { y + 1 } else { y }).clamp(1980, 2107) as u16;
    let dos_date = ((year - 1980) << 9) | (m << 5) | d;
    let dos_time = (hour << 11) | (min << 5) | (sec >> 1);
    (dos_date, dos_time)
}

fn dos_to_unix_secs(dos_date: u16, dos_time: u16) -> u64 {
    if dos_date == 0 && dos_time == 0 {
        return 315532800;
    }
    let y = 1980 + ((dos_date >> 9) as i64);
    let m = ((dos_date >> 5) & 0x0f) as i64;
    let d = (dos_date & 0x1f) as i64;
    let hour = (dos_time >> 11) as u64;
    let min = ((dos_time >> 5) & 0x3f) as u64;
    let sec = ((dos_time & 0x1f) * 2) as u64;
    let y_adj = if m <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = (y_adj - era * 400) as u64;
    let mp = (if m > 2 { m - 3 } else { m + 9 }) as u64;
    let doy = (153 * mp + 2) / 5 + (d as u64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + (doe as i64) - 719468;
    if days < 0 {
        0
    } else {
        (days as u64) * 86400 + hour * 3600 + min * 60 + sec
    }
}

pub fn serialize_zip_archive(entries: &[crate::commands::archive::TarEntry]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    let mut comment = Vec::new();
    let mut count = 0u16;

    for e in entries {
        if e.name == "__ZIP_COMMENT__" {
            comment = e.content.clone();
            continue;
        }
        let mut clean_name = e.name.trim_start_matches('/').to_string();
        while let Some(rest) = clean_name.strip_prefix("./") {
            clean_name = rest.to_string();
        }
        if clean_name.is_empty() || clean_name == "." {
            continue;
        }
        let is_dir = e.typeflag == b'5' || clean_name.ends_with('/');
        let is_symlink = e.typeflag == b'2';
        if is_dir && !clean_name.ends_with('/') {
            clean_name.push('/');
        } else if !is_dir && clean_name.ends_with('/') {
            clean_name = clean_name.trim_end_matches('/').to_string();
        }
        let name_bytes = clean_name.as_bytes();
        let payload: &[u8] = if is_dir {
            &[]
        } else if is_symlink {
            e.linkname.as_bytes()
        } else {
            &e.content
        };
        let crc = crc32_ieee(payload);
        let sz = payload.len() as u32;
        let (dos_date, dos_time) = unix_to_dos_datetime(e.mtime);
        let mut extra = [0u8; 9];
        extra[0..2].copy_from_slice(&0x5455u16.to_le_bytes());
        extra[2..4].copy_from_slice(&5u16.to_le_bytes());
        extra[4] = 1;
        extra[5..9].copy_from_slice(&(e.mtime as i32).to_le_bytes());

        let local_offset = out.len() as u32;
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&10u16.to_le_bytes());
        out.extend_from_slice(&0x0800u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&dos_time.to_le_bytes());
        out.extend_from_slice(&dos_date.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&sz.to_le_bytes());
        out.extend_from_slice(&sz.to_le_bytes());
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&extra);
        out.extend_from_slice(payload);

        let unix_type = if is_dir {
            0o040000u32
        } else if is_symlink {
            0o120000u32
        } else {
            0o100000u32
        };
        let unix_mode = unix_type | (e.mode & 0o7777);
        let ext_attr = (unix_mode << 16) | (if is_dir { 16 } else { 0 });

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&0x031eu16.to_le_bytes());
        central.extend_from_slice(&10u16.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&dos_time.to_le_bytes());
        central.extend_from_slice(&dos_date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&sz.to_le_bytes());
        central.extend_from_slice(&sz.to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&ext_attr.to_le_bytes());
        central.extend_from_slice(&local_offset.to_le_bytes());
        central.extend_from_slice(name_bytes);
        central.extend_from_slice(&extra);
        count = count.saturating_add(1);
    }

    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);

    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&central_size.to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&(comment.len() as u16).to_le_bytes());
    out.extend_from_slice(&comment);
    out
}

pub fn parse_zip_archive(data: &[u8]) -> Result<Vec<crate::commands::archive::TarEntry>, String> {
    if data.len() < 22 {
        return Err("End-of-central-directory signature not found".into());
    }
    let min_eocd = data.len().saturating_sub(22 + 65535);
    let mut eocd_pos: Option<usize> = None;
    for pos in (min_eocd..=data.len() - 22).rev() {
        if u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) == 0x0605_4b50 {
            let cmt_len = u16::from_le_bytes([data[pos + 20], data[pos + 21]]) as usize;
            if pos + 22 + cmt_len == data.len() {
                eocd_pos = Some(pos);
                break;
            }
        }
    }
    let Some(eocd) = eocd_pos else {
        let ustar = crate::commands::archive::parse_ustar_archive(data);
        if !ustar.is_empty() {
            return Ok(ustar);
        }
        return Err("End-of-central-directory signature not found".into());
    };

    let total_entries = u16::from_le_bytes([data[eocd + 10], data[eocd + 11]]) as usize;
    let central_size = u32::from_le_bytes(data[eocd + 12..eocd + 16].try_into().unwrap()) as usize;
    let central_offset = u32::from_le_bytes(data[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
    let cmt_len = u16::from_le_bytes([data[eocd + 20], data[eocd + 21]]) as usize;

    if central_offset + central_size > eocd {
        return Err("corrupt central directory".into());
    }

    let mut out = Vec::with_capacity(total_entries + 1);
    let mut pos = central_offset;
    for _ in 0..total_entries {
        if pos + 46 > central_offset + central_size {
            return Err("truncated central directory".into());
        }
        if u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) != 0x0201_4b50 {
            return Err("invalid central directory header".into());
        }
        let version_made_by = u16::from_le_bytes([data[pos + 4], data[pos + 5]]);
        let method = u16::from_le_bytes([data[pos + 10], data[pos + 11]]);
        let dos_time = u16::from_le_bytes([data[pos + 12], data[pos + 13]]);
        let dos_date = u16::from_le_bytes([data[pos + 14], data[pos + 15]]);
        let crc = u32::from_le_bytes(data[pos + 16..pos + 20].try_into().unwrap());
        let comp_size = u32::from_le_bytes(data[pos + 20..pos + 24].try_into().unwrap()) as usize;
        let uncomp_size = u32::from_le_bytes(data[pos + 24..pos + 28].try_into().unwrap()) as usize;
        let name_len = u16::from_le_bytes([data[pos + 28], data[pos + 29]]) as usize;
        let extra_len = u16::from_le_bytes([data[pos + 30], data[pos + 31]]) as usize;
        let entry_cmt_len = u16::from_le_bytes([data[pos + 32], data[pos + 33]]) as usize;
        let ext_attr = u32::from_le_bytes(data[pos + 38..pos + 42].try_into().unwrap());
        let local_off = u32::from_le_bytes(data[pos + 42..pos + 46].try_into().unwrap()) as usize;

        if pos + 46 + name_len + extra_len + entry_cmt_len > central_offset + central_size {
            return Err("truncated central directory entry".into());
        }
        let name = String::from_utf8_lossy(&data[pos + 46..pos + 46 + name_len]).to_string();
        let central_extra = &data[pos + 46 + name_len..pos + 46 + name_len + extra_len];
        pos += 46 + name_len + extra_len + entry_cmt_len;

        let mut mtime = dos_to_unix_secs(dos_date, dos_time);
        let mut ex_pos = 0usize;
        while ex_pos + 4 <= central_extra.len() {
            let id = u16::from_le_bytes([central_extra[ex_pos], central_extra[ex_pos + 1]]);
            let len = u16::from_le_bytes([central_extra[ex_pos + 2], central_extra[ex_pos + 3]]) as usize;
            ex_pos += 4;
            if ex_pos + len > central_extra.len() {
                break;
            }
            if id == 0x5455 && len >= 5 && (central_extra[ex_pos] & 1) != 0 {
                let ts = i32::from_le_bytes(central_extra[ex_pos + 1..ex_pos + 5].try_into().unwrap());
                if ts >= 0 {
                    mtime = ts as u64;
                }
            }
            ex_pos += len;
        }

        if local_off + 30 > central_offset
            || u32::from_le_bytes(data[local_off..local_off + 4].try_into().unwrap()) != 0x0403_4b50
        {
            return Err("invalid local header".into());
        }
        let l_name_len = u16::from_le_bytes([data[local_off + 26], data[local_off + 27]]) as usize;
        let l_extra_len = u16::from_le_bytes([data[local_off + 28], data[local_off + 29]]) as usize;
        let payload_start = local_off + 30 + l_name_len + l_extra_len;
        if payload_start + comp_size > central_offset {
            return Err("truncated entry data".into());
        }
        let raw_payload = &data[payload_start..payload_start + comp_size];
        let decoded = match method {
            0 => raw_payload.to_vec(),
            8 => inflate_raw(raw_payload)?.0,
            12 => bzip2_decompress(raw_payload)?,
            _ => return Err("unsupported compression method".into()),
        };
        if decoded.len() != uncomp_size || crc32_ieee(&decoded) != crc {
            return Err("CRC or size mismatch".into());
        }

        let host = version_made_by >> 8;
        let unix_mode = if host == 3 || host == 19 {
            ext_attr >> 16
        } else {
            0
        };
        let is_dir = name.ends_with('/') || (unix_mode & 0o170000) == 0o040000;
        let is_symlink = (unix_mode & 0o170000) == 0o120000;
        let mode = if (unix_mode & 0o7777) != 0 {
            unix_mode & 0o7777
        } else if is_dir {
            0o755
        } else {
            0o644
        };

        out.push(crate::commands::archive::TarEntry {
            name,
            typeflag: if is_dir {
                b'5'
            } else if is_symlink {
                b'2'
            } else {
                b'0'
            },
            mode,
            mtime,
            uid: 0,
            gid: 0,
            linkname: if is_symlink {
                String::from_utf8_lossy(&decoded).to_string()
            } else {
                String::new()
            },
            content: if is_symlink { Vec::new() } else { decoded },
        });
    }

    if cmt_len > 0 {
        out.push(crate::commands::archive::TarEntry {
            name: "__ZIP_COMMENT__".to_string(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 1700000000,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: data[eocd + 22..eocd + 22 + cmt_len].to_vec(),
        });
    }

    Ok(out)
}
