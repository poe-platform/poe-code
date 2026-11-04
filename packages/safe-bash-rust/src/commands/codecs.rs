#[path = "xz_filters.rs"]
mod xz_filters;

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

const LEN_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const LEN_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];

pub fn inflate_raw(data: &[u8]) -> Result<(Vec<u8>, usize), String> {
    inflate_raw_bounded(data, usize::MAX)
}

pub(super) fn inflate_raw_bounded(data: &[u8], limit: usize) -> Result<(Vec<u8>, usize), String> {
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
                if len as usize > limit - out.len() {
                    return Err("inflated data exceeds input limit".into());
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
                        if out.len() == limit {
                            return Err("inflated data exceeds input limit".into());
                        }
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
                        if length > limit - out.len() {
                            return Err("inflated data exceeds input limit".into());
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

// RFC 1951: pack fields least-significant bit first, Huffman codes most-significant bit first.
struct DeflateWriter {
    bytes: Vec<u8>,
    pending: u32,
    bits: u8,
}

impl DeflateWriter {
    fn bits(&mut self, value: u16, count: u8) {
        self.pending |= (value as u32) << self.bits;
        self.bits += count;
        while self.bits >= 8 {
            self.bytes.push(self.pending as u8);
            self.pending >>= 8;
            self.bits -= 8;
        }
    }

    fn symbol(&mut self, symbol: u16) {
        let (code, count) = match symbol {
            0..=143 => (0x30 + symbol, 8),
            144..=255 => (0x190 + symbol - 144, 9),
            256..=279 => (symbol - 256, 7),
            _ => (0xc0 + symbol - 280, 8),
        };
        self.bits(code.reverse_bits() >> (16 - count), count);
    }
}

pub fn gzip_compress(data: &[u8]) -> Vec<u8> {
    gzip_compress_level(data, 6)
}

pub fn gzip_compress_level(data: &[u8], level: u8) -> Vec<u8> {
    let flags = match level {
        1 => 4,
        9 => 2,
        _ => 0,
    };
    let mut out = deflate(data, level, vec![0x1f, 0x8b, 8, 0, 0, 0, 0, 0, flags, 255], |_| {});
    let crc = crc32_ieee(data);
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out
}

#[path = "deflate.rs"]
mod deflate_encoder;
use deflate_encoder::deflate;

pub(super) fn zlib_compress(data: &[u8]) -> Vec<u8> {
    let mut out = deflate(data, 6, vec![0x78, 0x9c], |_| {});
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

// A row-wise PNG encoder drains each completed block before supplying more
// input. The final push also includes the zlib checksum.
pub(super) fn png_zlib_chunks(data: &[u8], mut emit: impl FnMut(&[u8])) {
    emit(&[0x78, 0x9c]);
    let mut sent=0;
    let mut out=deflate(data, 6, Vec::new(), |block| {
        sent+=block.len();
        for chunk in block.chunks(4084) {emit(chunk);}
    });
    out.extend_from_slice(&adler32(data).to_be_bytes());
    for chunk in out[sent..].chunks(4084) {emit(chunk);}
}

// Mermaid writes one fixed Huffman block, matching runs at distances 1 and 4.
pub(super) fn zlib_pixel_runs(data:&[u8])->Vec<u8>{
    let mut w=DeflateWriter{bytes:vec![0x78,1],bits:0,pending:0};
    w.bits(3,3);
    let mut i=0;
    while i<data.len(){
        let mut matched=0;
        for distance in [1usize,4]{
            if i<distance{continue;}
            let mut n=0;
            while n<(data.len()-i).min(258) && data[i+n]==data[i+n-distance]{n+=1;}
            if n>=distance.max(3){
                let l=LEN_BASE.partition_point(|&b|usize::from(b)<=n)-1;
                w.symbol(257+l as u16);w.bits(n as u16-LEN_BASE[l],LEN_EXTRA[l]);
                w.bits(((distance-1) as u16).reverse_bits()>>11,5);
                matched=n;break;
            }
        }
        if matched==0{w.symbol(data[i].into());i+=1;}else{i+=matched;}
    }
    w.symbol(256);if w.bits!=0{w.bytes.push(w.pending as u8);}
    w.bytes.extend_from_slice(&adler32(data).to_be_bytes());w.bytes
}

pub(super) fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for &x in chunk { a += u32::from(x); b += a; }
        a %= 65521; b %= 65521;
    }
    (b << 16) | a
}

pub fn gzip_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    gzip_decompress_bounded(data, usize::MAX)
}

pub(super) fn gzip_decompress_bounded(data: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let mut remaining = data;
    let mut out = Vec::new();
    loop {
        let (member, consumed) = gzip_member(remaining, limit - out.len())?;
        out.extend_from_slice(&member);
        remaining = &remaining[consumed..];
        if remaining.is_empty() { return Ok(out); }
    }
}

fn gzip_member(data: &[u8], limit: usize) -> Result<(Vec<u8>, usize), String> {
    let eof = "unexpected end of file";
    if data.get(..2).ok_or(eof)? != [0x1f, 0x8b] {
        return Err("not in gzip format".into());
    }
    let header = data.get(..10).ok_or(eof)?;
    if header[2] != 8 {
        return Err("unknown compression method".into());
    }
    let flags = header[3];
    if flags & 0xe0 != 0 {
        return Err("invalid gzip header flags".into());
    }
    let mut pos = 10;
    if flags & 4 != 0 {
        let len = u16::from_le_bytes(data.get(pos..pos + 2).ok_or(eof)?.try_into().unwrap());
        pos += 2;
        data.get(pos..pos + usize::from(len)).ok_or(eof)?;
        pos += usize::from(len);
    }
    for flag in [8, 16] {
        if flags & flag != 0 {
            pos += data[pos..].iter().position(|&b| b == 0).ok_or(eof)? + 1;
        }
    }
    if flags & 2 != 0 {
        let expected = u16::from_le_bytes(data.get(pos..pos + 2).ok_or(eof)?.try_into().unwrap());
        if crc32_ieee(&data[..pos]) as u16 != expected {
            return Err("header crc mismatch".into());
        }
        pos += 2;
    }
    let (member_out, consumed) = inflate_raw_bounded(&data[pos..], limit)?;
    pos += consumed;
    if pos + 8 > data.len() {
        return Err("unexpected end of file".into());
    }
    let expected_crc = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
    let expected_isize = u32::from_le_bytes(data[pos + 4..pos + 8].try_into().unwrap());
    pos += 8;
    let actual_crc = crc32_ieee(&member_out);
    if actual_crc != expected_crc {
        return Err("incorrect data check (CRC)".into());
    }
    if (member_out.len() as u32) != expected_isize {
        return Err("incorrect length check".into());
    }
    Ok((member_out, pos))
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
                return Err("unexpected end of file".into());
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

// TIFF and PDF pack LZW codes most significant bit first. Dictionary phrases
// are spans of the decoded output, with at most 4096 codes in use.
pub(super) fn decode_lzw(
    input: &[u8],
    early_change: f64,
    limit: usize,
    out: &mut Vec<u8>,
) -> Result<(), &'static str> {
    let mut bits = MsbBitReader::new(input, 0);
    let mut phrases: Vec<(usize, usize)> = Vec::new();
    let mut previous: Option<(usize, usize)> = None;
    let mut width = 9;
    while let Ok(code) = bits.read_bits(width) {
        let code = code as usize;
        match code {
            256 => {
                phrases.clear();
                previous = None;
                width = 9;
                continue;
            }
            257 => break,
            _ => {}
        }
        let at = out.len();
        if at >= limit {
            return Err("LZW output exceeds byte limit");
        }
        if code < 256 {
            out.push(code as u8);
        } else {
            let special = code == 258 + phrases.len();
            let (from, count) = if special {
                previous
            } else {
                phrases.get(code - 258).copied()
            }
            .ok_or("Invalid LZW code")?;
            let take = count.min(limit - at);
            out.extend_from_within(from..from + take);
            if take != count || (special && out.len() == limit) {
                return Err("LZW output exceeds byte limit");
            }
            if special {
                out.push(out[from]);
            }
        }
        if let Some((from, n)) = previous
            && phrases.len() < 4096 - 258
        {
            phrases.push((from, n + 1));
            if width < 12 && (phrases.len() + 258) as f64 == f64::from(1 << width) - early_change {
                width += 1;
            }
        }
        previous = Some((at, out.len() - at));
    }
    Ok(())
}

pub fn bzip2_compress(data: &[u8], level: u8) -> Vec<u8> {
    let lvl = level.clamp(1, 9);
    let mut bw = MsbBitWriter::new();
    bw.write_bits(b'B' as u64, 8);
    bw.write_bits(b'Z' as u64, 8);
    bw.write_bits(b'h' as u64, 8);
    bw.write_bits((b'0' + lvl) as u64, 8);

    let mut combined_crc = 0u32;
    let block_cap = usize::from(lvl) * 100_000 - 19;
    let mut remaining = data;

    while !remaining.is_empty() {
        // The block limit applies after RLE1. Reserve room for the final five-byte run.
        let mut rle1 = Vec::with_capacity(remaining.len().min(block_cap));
        let mut idx = 0;
        while idx < remaining.len() && rle1.len() < block_cap {
            let b = remaining[idx];
            let mut run = 1;
            while run < 255 && idx + run < remaining.len() && remaining[idx + run] == b {
                run += 1;
            }
            if run >= 4 {
                rle1.extend_from_slice(&[b, b, b, b, (run - 4) as u8]);
            } else {
                rle1.extend_from_slice(&remaining[idx..idx + run]);
            }
            idx += run;
        }
        let block_crc = bzip2_crc32(&remaining[..idx]);
        combined_crc = combined_crc.rotate_left(1) ^ block_crc;
        remaining = &remaining[idx..];

        // 2. Burrows-Wheeler Transform
        let n = rle1.len();
        let mut indices: Vec<usize> = (0..n).collect();
        // Rank cyclic prefixes in pairs instead of rescanning equal rotations byte by byte.
        let mut ranks: Vec<usize> = rle1.iter().copied().map(usize::from).collect();
        let mut next = vec![0; n];
        let mut width = 1;
        let mut previous_classes = 0;
        while width < n {
            let pair = |i: usize| (ranks[i], ranks[(i + width) % n]);
            indices.sort_unstable_by_key(|&i| (pair(i), i));
            let mut class = 0;
            next[indices[0]] = class;
            for group in indices.windows(2) {
                class += usize::from(pair(group[0]) != pair(group[1]));
                next[group[1]] = class;
            }
            let classes = class + 1;
            if classes == n || classes == previous_classes { break; }
            previous_classes = classes;
            std::mem::swap(&mut ranks, &mut next);
            width *= 2;
        }
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

pub(super) fn bzip2_header_prefix(data: &[u8]) -> bool {
    b"BZh".iter().zip(data).all(|(a, b)| a == b)
        && data.get(3).is_none_or(|level| (b'1'..=b'9').contains(level))
}

pub fn bzip2_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut pos = 0usize;
    let mut out = Vec::new();

    loop {
        if !bzip2_header_prefix(&data[pos..]) {
            return Err("Compressed data error".into());
        }
        if data.len() - pos < 4 {
            return Err("unexpected end of file".into());
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
                if pos == data.len() { return Ok(out); }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::archive::TarEntry;

    #[test]
    fn lzw_preserves_only_the_bounded_prefix_on_a_bad_or_oversized_phrase() {
        for (codes, limit, expected, valid) in [
            (vec![256, 65, 258, 257], 3, b"AAA".as_slice(), true),
            (vec![256, 65, 258, 257], 2, b"AA", false),
            (vec![256, 65, 258, 257], 1, b"A", false),
            (vec![65, 256, 258], 6, b"A", false),
        ] {
            let mut encoded = MsbBitWriter::new();
            for code in codes {
                encoded.write_bits(code, 9);
            }
            let mut decoded = Vec::new();
            assert_eq!(
                decode_lzw(&encoded.finish(), 1., limit, &mut decoded).is_ok(),
                valid
            );
            assert_eq!(decoded, expected);
        }
    }

    #[test]
    fn zlib_streams_match_production_fixed_dynamic_and_stored_blocks() {
        let mixed = (0usize..120000).map(|i| ((if i%5000 < 4300 { (i>>5) ^ (i%5) } else { i*7919 }) ^ (i>>9)) as u8).collect();
        let mut seed = 1u32;
        let noise = (0..70000).map(|_| { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); (seed>>24) as u8 }).collect();
        for (data, expected) in [
            (b"hello hello hello".to_vec(), "98437c7b782ac27a3898e0b4b4bc2f5db19e2f88bfa993e9da97a50a27d332e4"),
            (b"alpha,bravo,charlie\n".repeat(600), "f9115b4273133fd97a36e3e8e823f1316f72d3c0f7a832fc0d21b2d280352568"),
            (mixed, "7ec635ecd5325f6726482fe28b5b1c6dfb898bf4f9780a9b24c0778852834179"),
            (noise, "a188c3fcf293ab3cd8927db33e076930b964d295413275278ee0f83bc5819334"),
        ] {
            let encoded = zlib_compress(&data);
            assert_eq!(inflate_raw(&encoded[2..]).unwrap().0, data);
            let digest: String = crate::commands::archive::sha256_bytes(&encoded).iter().map(|b|format!("{b:02x}")).collect();
            assert_eq!(digest, expected, "{} input bytes", data.len());
        }
    }

    #[test]
    fn gzip_levels_match_production_match_selection() {
        let data: Vec<u8> = (0usize..12000).map(|i| ((if i%5000 < 4300 { (i>>5) ^ (i%5) } else { i*7919 }) ^ (i>>9)) as u8).collect();
        let mut streams = Vec::new();
        for level in 1..=9 {
            let compressed = gzip_compress_level(&data,level);
            assert_eq!(gzip_decompress(&compressed).unwrap(),data);
            streams.extend(compressed);
        }
        let digest: String = crate::commands::archive::sha256_bytes(&streams).iter().map(|b|format!("{b:02x}")).collect();
        assert_eq!(digest, "ad8e50f82127d77a8568a7fdc2e96c9c8895895fde6f1ba12475da7cd779762e");
    }

    #[test]
    fn checksum_primitives_match_standard_vectors() {
        assert_eq!(crc32_ieee(b"123456789"), 0xCBF43926);
        assert_eq!(crc64_xz(b"123456789"), 0x995DC9BBDF1939FA);
        assert_eq!(bzip2_crc32(b"123456789"), 0xFC891918);
        let h0 = xxh64(b"", 0);
        let h1 = xxh64(b"123456789", 0);
        assert_ne!(h0, h1);
    }

    #[test]
    fn gzip_magic_header_and_all_256_byte_roundtrip() {
        let payload: Vec<u8> = (0u16..512).map(|i| (i & 0xff) as u8).collect();
        let compressed = gzip_compress(&payload);
        assert!(compressed.starts_with(&[0x1f, 0x8b, 0x08]));
        let decoded = gzip_decompress(&compressed).unwrap();
        assert_eq!(decoded, payload);

        // Concatenated gzip members
        let mut concat = gzip_compress(b"first-");
        concat.extend_from_slice(&gzip_compress(b"second"));
        assert_eq!(gzip_decompress(&concat).unwrap(), b"first-second");
        assert!(gzip_decompress_bounded(&concat, 11).is_err());

        // Reject non-gzip magic
        assert!(gzip_decompress(b"not-gzip").is_err());
    }

    #[test]
    fn bzip2_produces_genuine_bzh_header_not_gzip_and_roundtrips() {
        for level in [1u8, 6, 9] {
            let payload = b"BWT + MTF + Huffman bzip2 payload with repeated words repeated words\n";
            let bz = bzip2_compress(payload, level);
            assert_eq!(&bz[..3], b"BZh");
            assert_eq!(bz[3], b'0' + level);
            // Block magic 0x314159265359 ("1AY&SY")
            assert_eq!(&bz[4..10], &[0x31, 0x41, 0x59, 0x26, 0x53, 0x59]);
            assert_ne!(&bz[..2], &[0x1f, 0x8b]);
            let decoded = bzip2_decompress(&bz).unwrap();
            assert_eq!(decoded, payload);
        }

        // Empty bzip2 stream (EOS magic 0x177245385090)
        let empty_bz = bzip2_compress(b"", 9);
        assert_eq!(&empty_bz[..4], b"BZh9");
        assert_eq!(bzip2_decompress(&empty_bz).unwrap(), b"");

        // All 256 byte values
        let all_bytes: Vec<u8> = (0u8..=255).collect();
        let bz_all = bzip2_compress(&all_bytes, 9);
        assert_eq!(bzip2_decompress(&bz_all).unwrap(), all_bytes);

        // Reject gzip bytes passed to bzip2_decompress
        let gz = gzip_compress(b"hello");
        assert!(bzip2_decompress(&gz).is_err());
    }

    #[test]
    fn xz_and_lzma_produce_genuine_headers_and_inspect_cleanly() {
        let payload = b" genuine xz and lzma stream verification payload 0123456789 ";
        for check_id in [0u8, 1, 4, 10] {
            let xz = xz_compress(payload, check_id);
            assert_eq!(&xz[..6], &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
            assert_eq!(&xz[xz.len() - 2..], b"YZ");
            assert_ne!(&xz[..2], &[0x1f, 0x8b]);
            let info = inspect_xz_bytes(&xz).unwrap();
            assert_eq!(info.streams, 1);
            assert_eq!(info.uncompressed, payload.len());
            let decoded = xz_decompress(&xz).unwrap();
            assert_eq!(decoded, payload);
        }

        let lzma = lzma_compress(payload);
        assert_eq!(&lzma[..3], &[0x5d, 0x00, 0x00]);
        assert_eq!(lzma_decompress(&lzma).unwrap(), payload);
        assert!(xz_decompress(&gzip_compress(b"wrong")).is_err());
    }

    #[test]
    fn zstd_produces_rfc8878_frame_and_handles_multiblock_payloads() {
        let payload = vec![0x5au8; 140_000]; // > 128 KiB block boundary
        let zst = zstd_compress(&payload, true);
        assert_eq!(&zst[..4], &[0x28, 0xb5, 0x2f, 0xfd]);
        assert_ne!(&zst[..2], &[0x1f, 0x8b]);
        let decoded = zstd_decompress(&zst, false).unwrap();
        assert_eq!(decoded, payload);
        assert!(zstd_decompress(&gzip_compress(b"wrong"), false).is_err());
    }

    #[test]
    fn pkzip_archive_serializes_and_parses_files_dirs_and_comments() {
        let entries = vec![
            TarEntry {
                name: "dir/".into(),
                typeflag: b'5',
                mode: 0o755,
                mtime: 1_700_000_000.,
                atime: None,
                uid: 0,
                gid: 0,
                linkname: String::new(),
                content: Vec::new(),
            },
            TarEntry {
                name: "dir/hello.txt".into(),
                typeflag: b'0',
                mode: 0o640,
                mtime: 1_700_000_000.,
                atime: None,
                uid: 0,
                gid: 0,
                linkname: String::new(),
                content: b"hello pkzip".to_vec(),
            },
        ];
        let zip_bytes = serialize_zip_archive(&entries);
        assert_eq!(&zip_bytes[..4], &[0x50, 0x4b, 0x03, 0x04]);
        let parsed = parse_zip_archive(&zip_bytes).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "dir/");
        assert_eq!(parsed[0].typeflag, b'5');
        assert_eq!(parsed[1].name, "dir/hello.txt");
        assert_eq!(parsed[1].content, b"hello pkzip");
    }

    #[test]
    fn zip_directory_rejects_ambiguous_end_or_absent_volumes() {
        let empty = serialize_zip_archive(&[]);
        let mut ambiguous = empty.clone();
        ambiguous[20] = 22;
        ambiguous.extend(&empty);
        assert_eq!(parse_zip_archive(&ambiguous).err().as_deref(), Some("ZIP ambiguous end records"));
        let mut split = empty;
        split[4] = 1;
        assert_eq!(parse_zip_archive(&split).err().as_deref(), Some("ZIP multi-disk archive requires an explicit VFS volume resolver"));
    }

    #[test]
    fn unit_deflate_empty_single_byte_and_repeating_runs() {
        for sample in [&b""[..], &b"A"[..], &[b"X"[0]; 4096][..]] {
            let gz = gzip_compress(sample);
            assert_eq!(&gz[..2], &[0x1f, 0x8b]);
            assert_eq!(gzip_decompress(&gz).unwrap(), sample);

            let bz = bzip2_compress(sample, 9);
            assert_eq!(&bz[..3], b"BZh");
            assert_eq!(bzip2_decompress(&bz).unwrap(), sample);

            let xz = xz_compress(sample, 0x04);
            assert_eq!(&xz[..6], &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
            assert_eq!(xz_decompress(&xz).unwrap(), sample);

            let zs = zstd_compress(sample, true);
            assert_eq!(&zs[..4], &[0x28, 0xb5, 0x2f, 0xfd]);
            assert_eq!(zstd_decompress(&zs, false).unwrap(), sample);
        }
        assert!(gzip_decompress(b"not-gzip").is_err());
        assert!(bzip2_decompress(b"not-bzip2").is_err());
        assert!(xz_decompress(b"not-xz").is_err());
        assert!(zstd_decompress(b"not-zstd", false).is_err());
    }
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
            return Err("unexpected end of file".into());
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
    xz_compress_level(data, check_id, 1)
}

pub(super) fn xz_compress_level(data: &[u8], check_id: u8, level: u8) -> Vec<u8> {
    let mut out = Vec::new();
    // 12-byte Stream Header
    out.extend_from_slice(&[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    let flags = [0x00u8, check_id];
    out.extend_from_slice(&flags);
    out.extend_from_slice(&crc32_ieee(&flags).to_le_bytes());

    let mut records: Vec<(u64, u64)> = Vec::new();
    if !data.is_empty() {
        let block_start = out.len();
        let dict_log = LZMA_DICT_LOG[level as usize];
        let bh_body = [0x02, 0x00, 0x21, 0x01, 2 * (dict_log - 12), 0x00, 0x00, 0x00];
        out.extend_from_slice(&bh_body);
        out.extend_from_slice(&crc32_ieee(&bh_body).to_le_bytes());

        let mut pos = 0;
        while pos < data.len() {
            let remaining = &data[pos..];
            let (packed, used) = encode_lzma_chunk(&remaining[..remaining.len().min(1 << 21)], 1 << dict_log, false);
            if packed.len() + 3 < used && packed.len() <= 65536 {
                let size = used - 1;
                out.push(0xe0 | (size >> 16) as u8); // Reset dictionary, state and properties.
                out.extend_from_slice(&(size as u16).to_be_bytes());
                out.extend_from_slice(&((packed.len() - 1) as u16).to_be_bytes());
                out.push(0x5d);
                out.extend_from_slice(&packed);
            } else {
                for (i, raw) in remaining[..used].chunks(65536).enumerate() {
                    out.push(if pos == 0 && i == 0 { 1 } else { 2 });
                    out.extend_from_slice(&((raw.len() - 1) as u16).to_be_bytes());
                    out.extend_from_slice(raw);
                }
            }
            pos += used;
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

    fn tree(&mut self, probs: &mut [u16], bits: u32, value: u32, reverse: bool) {
        let mut node = 1;
        for i in 0..bits {
            let bit = (value >> if reverse { i } else { bits - 1 - i }) & 1;
            self.encode_bit(&mut probs[node], bit);
            node = (node << 1) | bit as usize;
        }
    }

    fn distance(&mut self, model: &mut LzmaState, len: usize, dist: u32) {
        let slot = if dist < 4 { dist } else {
            let high = dist.ilog2();
            2 * high + ((dist >> (high - 1)) & 1)
        };
        self.tree(&mut model.pos_slot[(len - 2).min(3)], 6, slot, false);
        if slot < 4 { return; }
        let bits = (slot >> 1) - 1;
        let base = (2 | (slot & 1)) << bits;
        let extra = dist - base;
        if slot < 14 {
            self.tree(&mut model.pos_special[(base - slot) as usize..], bits, extra, true);
        } else {
            for i in (4..bits).rev() {
                self.range >>= 1;
                if extra >> i & 1 != 0 { self.low += u64::from(self.range); }
                if self.range < 1 << 24 { self.range <<= 8; self.shift_low(); }
            }
            self.tree(&mut model.pos_align, 4, extra, true);
        }
    }

    fn finish(mut self) -> Vec<u8> {
        for _ in 0..5 {
            self.shift_low();
        }
        self.out
    }
}

const LZMA_DICT_LOG: [u8; 10] = [18, 20, 21, 22, 22, 23, 23, 24, 25, 26];

pub fn lzma_compress(data: &[u8]) -> Vec<u8> {
    lzma_compress_level(data, 1)
}

pub(super) fn lzma_compress_level(data: &[u8], level: u8) -> Vec<u8> {
    let dictionary = 1u32 << LZMA_DICT_LOG[level as usize];
    let mut out = vec![0x5d];
    out.extend_from_slice(&dictionary.to_le_bytes());
    out.extend_from_slice(&u64::MAX.to_le_bytes());
    out.extend_from_slice(&encode_lzma_chunk(data, dictionary as usize, true).0);
    out
}

fn encode_lzma_chunk(data: &[u8], dictionary: usize, standalone: bool) -> (Vec<u8>, usize) {
    let mut rc = LzmaRangeEncoder::new();
    let mut m = LzmaState::new(0x5d).unwrap();
    let mut recent = std::collections::HashMap::new();
    let mut pos = 0;
    loop {
        let pos_state = pos & 3;
        let remaining = data.len() - pos;
        // LZMA2 stores the packed length in 16 bits. Leave room for the last symbol and range flush.
        if !standalone && (remaining == 0 || rc.out.len() + rc.cache_size as usize >= 65536 - 32) { break; }
        if remaining == 0 {
            rc.encode_bit(&mut m.is_match[m.state][pos_state], 1);
            rc.encode_bit(&mut m.is_rep[m.state], 0);
            m.len_dec.encode(&mut rc, pos_state, 2);
            rc.distance(&mut m, 2, u32::MAX);
            break;
        }
        let match_len = |dist: usize| {
            if dist >= pos { return 0; }
            let at = pos - dist - 1;
            let max = remaining.min(273);
            data[pos..pos + max].iter().zip(&data[at..at + max])
                .position(|(a, b)| a != b).unwrap_or(max)
        };
        let mut rep = None;
        let mut len = 0;
        let mut distance = 0;
        for (i, &dist) in m.reps.iter().enumerate() {
            let n = match_len(dist);
            if n > len && (i == 0 || n >= 2) {
                len = n;
                rep = Some(i);
                if n == remaining.min(273) { break; }
            }
        }
        if remaining >= 2 && len < remaining.min(273)
            && let Some(&prev) = recent.get(&[data[pos], data[pos + 1]])
            && pos - prev <= dictionary {
            let dist = pos - prev - 1;
            let n = match_len(dist);
            if n > len {
                distance = dist;
                len = n;
                rep = None;
            }
        }
        rc.encode_bit(&mut m.is_match[m.state][pos_state], u32::from(len != 0));
        if len == 0 {
            let prev = if pos == 0 { 0 } else { data[pos - 1] };
            let probs = &mut m.lit_probs[(prev >> 5) as usize];
            let mut node = 1usize;
            let mut matched = m.state >= 7;
            let prediction = if matched { data[pos - m.reps[0] - 1] } else { 0 };
            for shift in (0..8).rev() {
                let bit = (data[pos] >> shift) & 1;
                let expect = (prediction >> shift) & 1;
                let index = if matched { ((1 + usize::from(expect)) << 8) + node } else { node };
                rc.encode_bit(&mut probs[index], u32::from(bit));
                matched &= expect == bit;
                node = (node << 1) | usize::from(bit);
            }
            m.state = match m.state { 0..=3 => 0, 4..=9 => m.state - 3, _ => m.state - 6 };
            len = 1;
        } else {
            rc.encode_bit(&mut m.is_rep[m.state], u32::from(rep.is_some()));
            if let Some(i) = rep {
                rc.encode_bit(&mut m.is_rep_g0[m.state], u32::from(i != 0));
                if i == 0 {
                    rc.encode_bit(&mut m.is_rep0_long[m.state][pos_state], u32::from(len != 1));
                } else {
                    rc.encode_bit(&mut m.is_rep_g1[m.state], u32::from(i != 1));
                    if i >= 2 { rc.encode_bit(&mut m.is_rep_g2[m.state], u32::from(i == 3)); }
                    m.reps[..=i].rotate_right(1);
                }
                if len > 1 { m.rep_len_dec.encode(&mut rc, pos_state, len); }
                m.state = if m.state >= 7 { 11 } else if len == 1 { 9 } else { 8 };
            } else {
                m.len_dec.encode(&mut rc, pos_state, len);
                rc.distance(&mut m, len, distance as u32);
                m.reps.rotate_right(1);
                m.reps[0] = distance;
                m.state = if m.state < 7 { 7 } else { 10 };
            }
        }
        for at in pos..(pos + len).min(data.len() - 1) {
            recent.insert([data[at], data[at + 1]], at);
        }
        pos += len;
    }
    (rc.finish(), pos)
}

struct LzmaRangeDecoder<'a> {
    data: &'a [u8],
    pos: usize,
    range: u32,
    code: u32,
}

impl<'a> LzmaRangeDecoder<'a> {
    fn new(data: &'a [u8]) -> Result<Self, String> {
        if data.first().is_some_and(|&b| b != 0) {
            return Err("Compressed data is corrupt".into());
        }
        if data.len() < 5 { return Err("unexpected end of file".into()); }
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
                return Err("unexpected end of file".into());
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

    fn encode(&mut self, rc: &mut LzmaRangeEncoder, pos_state: usize, len: usize) {
        let value = (len - 2) as u32;
        rc.encode_bit(&mut self.choice, u32::from(value >= 8));
        if value < 8 {
            rc.tree(&mut self.low[pos_state], 3, value, false);
        } else {
            rc.encode_bit(&mut self.choice2, u32::from(value >= 16));
            if value < 16 { rc.tree(&mut self.mid[pos_state], 3, value - 8, false); }
            else { rc.tree(&mut self.high, 8, value - 16, false); }
        }
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
        if !valid_lzma_properties(prop) {
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
            if !valid_lzma_properties(p) {
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
        dictionary_start: usize,
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
            let history = &out[dictionary_start..];
            let pos_state = history.len() & pb_mask;
            if rc.decode_bit(&mut self.is_match[self.state][pos_state])? == 0 {
                let prev_byte = history.last().copied().unwrap_or(0) as usize;
                let lit_state =
                    ((history.len() & lp_mask) << self.lc) | (prev_byte >> (8 - self.lc));
                let probs = &mut self.lit_probs[lit_state];
                let mut symbol = 1usize;
                if self.state >= 7 {
                    let match_dist = self.reps[0] + 1;
                    if match_dist > history.len() {
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
                            if dist > history.len() {
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
                if dist > history.len() {
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

pub(super) const XZ_MAGIC: &[u8; 6] = b"\xfd7zXZ\0";

fn valid_lzma_properties(prop: u8) -> bool {
    prop < 225 && prop % 9 + prop / 9 % 5 <= 4
}

pub(super) fn lzma_auto_header_prefix(data: &[u8]) -> bool {
    if data.first().is_some_and(|&prop| !valid_lzma_properties(prop)) {
        return false;
    }
    if let Some(dict) = data.get(1..5) {
        let dict = u32::from_le_bytes(dict.try_into().unwrap());
        let base = if dict % 3 == 0 { dict / 3 } else { dict };
        if dict != u32::MAX && !base.is_power_of_two() { return false; }
    }
    data.get(5..13).is_none_or(|size| {
        let size = u64::from_le_bytes(size.try_into().unwrap());
        size == u64::MAX || size <= 0x40_0000_0000
    })
}

pub fn lzma_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.first().is_some_and(|&prop| !valid_lzma_properties(prop)) {
        return Err("Compressed data is corrupt".into());
    }
    if data.len() < 13 {
        return Err("unexpected end of file".into());
    }
    let prop = data[0];
    let uncomp_size = u64::from_le_bytes(data[5..13].try_into().unwrap());
    let has_eopm = uncomp_size == u64::MAX;
    let expected = if has_eopm { None } else { Some(uncomp_size as usize) };
    let mut state = LzmaState::new(prop)?;
    let mut out = Vec::with_capacity(expected.unwrap_or(1024).min(1024 * 1024));
    state.decode_chunk(&data[13..], &mut out, 0, expected, true)?;
    if let Some(exp) = expected && out.len() != exp {
        return Err("Compressed data is corrupt".into());
    }
    Ok(out)
}

pub fn xz_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.first() != XZ_MAGIC.first() {
        if lzma_auto_header_prefix(data) {
            return lzma_decompress(data);
        }
        return Err("Compressed data is corrupt".into());
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
        if data.len() - pos < 12 { return Err("unexpected end of file".into()); }
        if !data[pos..].starts_with(XZ_MAGIC) {
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
                return Err("unexpected end of file".into());
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
            let field = |offset: &mut usize| read_xz_vli(&data[..pos + bh_size - 4], offset)
                .map_err(|_| "Compressed data is corrupt");
            let packed_size = (bh_flags & 0x40 != 0).then(|| field(&mut bh_pos)).transpose()?;
            let unpacked_size = (bh_flags & 0x80 != 0).then(|| field(&mut bh_pos)).transpose()?;
            let mut filters = Vec::new();
            for i in 0..num_filters {
                let id = field(&mut bh_pos)?;
                let len = usize::try_from(field(&mut bh_pos)?).map_err(|_| "Compressed data is corrupt")?;
                let props = data[bh_pos..pos + bh_size - 4].get(..len).ok_or("Compressed data is corrupt")?;
                if i + 1 == num_filters {
                    if id != 0x21 || !matches!(props, [0..=40]) {
                        return Err("Unsupported options in headers".into());
                    }
                } else {
                    filters.push(xz_filters::Filter::from_header(id, props).ok_or("Unsupported options in headers")?);
                }
                bh_pos += len;
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
            let mut dictionary_start = out.len();
            loop {
                if pos >= data.len() {
                    return Err("unexpected end of file".into());
                }
                let ctrl = data[pos];
                pos += 1;
                if ctrl == 0x00 {
                    break;
                }
                if ctrl == 1 || ctrl >= 0xe0 { dictionary_start = out.len(); }
                if ctrl == 0x01 || ctrl == 0x02 {
                    if pos + 2 > data.len() {
                        return Err("unexpected end of file".into());
                    }
                    let chunk_len = (u16::from_be_bytes([data[pos], data[pos + 1]]) as usize) + 1;
                    pos += 2;
                    if pos + chunk_len > data.len() {
                        return Err("unexpected end of file".into());
                    }
                    out.extend_from_slice(&data[pos..pos + chunk_len]);
                    pos += chunk_len;
                } else if ctrl >= 0x80 {
                    let uncomp_hi = ((ctrl & 0x1f) as usize) << 16;
                    if pos + 4 > data.len() {
                        return Err("unexpected end of file".into());
                    }
                    let uncomp_lo = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
                    let comp_len = (u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize) + 1;
                    pos += 4;
                    let uncomp_len = uncomp_hi + uncomp_lo + 1;
                    let need_props = ctrl >= 0xc0;
                    let reset_state = ctrl >= 0xa0;
                    let prop = if need_props {
                        if pos >= data.len() {
                            return Err("unexpected end of file".into());
                        }
                        let p = data[pos];
                        pos += 1;
                        Some(p)
                    } else {
                        None
                    };
                    if pos + comp_len > data.len() {
                        return Err("unexpected end of file".into());
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
                    st.decode_chunk(&data[pos..pos + comp_len], &mut out, dictionary_start, Some(uncomp_len), false)?;
                    pos += comp_len;
                } else {
                    return Err("Compressed data is corrupt".into());
                }
            }

            if packed_size.is_some_and(|n| n != (pos - block_start - bh_size) as u64)
                || unpacked_size.is_some_and(|n| n != (out.len() - block_out_start) as u64)
            {
                return Err("Compressed data is corrupt".into());
            }
            let unpadded_no_check = pos - block_start;
            while (pos - block_start) % 4 != 0 {
                if pos >= data.len() || data[pos] != 0 {
                    return Err("Compressed data is corrupt".into());
                }
                pos += 1;
            }
            if pos + check_size > data.len() {
                return Err("unexpected end of file".into());
            }
            let stored_check = &data[pos..pos + check_size];
            pos += check_size;
            let block_slice = &mut out[block_out_start..];
            for filter in filters.iter().rev() {
                filter.decode(block_slice);
            }
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
        if pos >= data.len() { return Err("unexpected end of file".into()); }
        if data[pos] != 0x00 {
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
            if *data.get(pos).ok_or("unexpected end of file")? != 0 {
                return Err("Compressed data is corrupt".into());
            }
            pos += 1;
        }
        if pos + 4 > data.len() {
            return Err("unexpected end of file".into());
        }
        let idx_crc = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
        if idx_crc != crc32_ieee(&data[index_start..pos]) {
            return Err("Compressed data is corrupt".into());
        }
        pos += 4;
        let index_size = pos - index_start;

        // Stream Footer
        if pos + 12 > data.len() {
            return Err("unexpected end of file".into());
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

    #[allow(dead_code)]
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

    while pos < data.len() {
        let rem = &data[pos..];
        if allow_foreign {
            if rem.len() >= 2 && rem[0] == 0x1f && rem[1] == 0x8b {
                let (member, consumed) = gzip_member(rem, usize::MAX)?;
                out.extend_from_slice(&member);
                pos += consumed;
                continue;
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
            let incomplete = 0xfd2fb528u32.to_le_bytes().starts_with(rem)
                || (0x184d2a50u32..=0x184d2a5f).any(|magic| magic.to_le_bytes().starts_with(rem));
            return Err(if incomplete { "unexpected end of file" } else { "Unknown frame descriptor" }.into());
        }
        let magic = u32::from_le_bytes([rem[0], rem[1], rem[2], rem[3]]);
        if (0x184d_2a50..=0x184d_2a5f).contains(&magic) {
            if rem.len() < 8 {
                return Err("Src size is incorrect".into());
            }
            let frame_size = u32::from_le_bytes([rem[4], rem[5], rem[6], rem[7]]) as usize;
            // The production wasm32 Zstandard decoder reserves the top 119 size_t values for errors.
            if frame_size > (u32::MAX - 119) as usize {
                return Err("Corrupted block detected".into());
            }
            if frame_size > rem.len() - 8 {
                return Err("Src size is incorrect".into());
            }
            pos += 8 + frame_size;
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

        if fhd & 0x08 != 0 {
            return Err("Reserved bit set".into());
        }
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
    }

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

/// The local header and compressed payload (without a trailing descriptor), and
/// the central record. Both borrow the validated input archive during an edit.
pub(super) struct ZipRecord<'a> {
    local: &'a [u8],
    central: &'a [u8],
}
pub(super) type ZipRecords<'a> = std::collections::BTreeMap<String,ZipRecord<'a>>;

pub fn serialize_zip_archive(entries: &[crate::commands::archive::TarEntry]) -> Vec<u8> {
    encode_zip_members(entries, 0, &[], false, &ZipRecords::new(), |_,_,_,_| {})
}

pub(super) fn encode_zip_members(entries: &[crate::commands::archive::TarEntry], level: u8, store_suffixes: &[&str], document: bool, retained: &ZipRecords<'_>, mut report: impl FnMut(&str,u16,usize,usize)) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    let mut comment = Vec::new();
    let mut count = 0u16;

    for e in entries {
        if e.name == "__ZIP_COMMENT__" {
            comment = e.content.clone();
            continue;
        }
        if let Some(record) = retained.get(&e.name) {
            let local = out.len();
            out.extend_from_slice(record.local);
            let start = central.len();
            central.extend_from_slice(record.central);
            central[start+42..start+46].copy_from_slice(&(local as u32).to_le_bytes());
            // Named output already knows the sizes. Like the JS writer, put them
            // in the local header and drop any streaming descriptor on plain members.
            if record.central[8] & 8 != 0 {
                out[local+6] &= !8;
                central[start+8] &= !8;
                out[local+14..local+26].copy_from_slice(&record.central[16..28]);
            }
            let method = u16::from_le_bytes(record.central[10..12].try_into().unwrap());
            let size = u32::from_le_bytes(record.central[24..28].try_into().unwrap());
            let stored = u32::from_le_bytes(record.central[20..24].try_into().unwrap());
            report(&e.name,method,size as usize,stored as usize);
            count = count.saturating_add(1);
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
        let compress = level != 0 && !is_dir && !is_symlink && !payload.is_empty()
            && (level == 9 || !store_suffixes.iter().any(|suffix| clean_name.ends_with(suffix)));
        let compressed = if compress { deflate(payload, level, Vec::new(), |_| {}) } else { Vec::new() };
        let (method, version, stored): (u16, u16, &[u8]) = if compress && compressed.len() < payload.len() {
            (8, 20, &compressed)
        } else { (0, 10, payload) };
        report(&e.name,method,payload.len(),stored.len());
        let text_attr = u16::from(!document && compress && payload.iter().all(|b| !matches!(b, 0..=6 | 14..=25 | 28..=31))
            && payload.iter().any(|b| matches!(b, 9 | 10 | 13 | 32..=255)));
        let crc = crc32_ieee(payload);
        let sz = payload.len() as u32;
        let (dos_date, dos_time) = unix_to_dos_datetime(e.mtime as u64);
        let mut extra = [0u8; 9];
        extra[0..2].copy_from_slice(&0x5455u16.to_le_bytes());
        extra[2..4].copy_from_slice(&5u16.to_le_bytes());
        extra[4] = 1;
        extra[5..9].copy_from_slice(&(e.mtime as u64 as i32).to_le_bytes());

        let local_offset = out.len() as u32;
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&version.to_le_bytes());
        out.extend_from_slice(&0x0800u16.to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&dos_time.to_le_bytes());
        out.extend_from_slice(&dos_date.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(stored.len() as u32).to_le_bytes());
        out.extend_from_slice(&sz.to_le_bytes());
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&extra);
        out.extend_from_slice(stored);

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
        central.extend_from_slice(&version.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&method.to_le_bytes());
        central.extend_from_slice(&dos_time.to_le_bytes());
        central.extend_from_slice(&dos_date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(stored.len() as u32).to_le_bytes());
        central.extend_from_slice(&sz.to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&text_attr.to_le_bytes());
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
    read_zip_members(data, None)
}

pub(super) fn read_zip_members<'a>(data: &'a [u8], mut retained: Option<&mut ZipRecords<'a>>) -> Result<Vec<crate::commands::archive::TarEntry>, String> {
    if data.len() < 22 {
        return Err("ZIP missing end record".into());
    }
    let min_eocd = data.len().saturating_sub(22 + 65535);
    let mut eocd_pos: Option<usize> = None;
    for pos in (min_eocd..=data.len() - 22).rev() {
        if u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) == 0x0605_4b50 {
            let cmt_len = u16::from_le_bytes([data[pos + 20], data[pos + 21]]) as usize;
            if data.len() - pos - 22 == cmt_len && eocd_pos.replace(pos).is_some() {
                return Err("ZIP ambiguous end records".into());
            }
        }
    }
    let Some(eocd) = eocd_pos else {
        return Err("ZIP missing end record".into());
    };

    if data[eocd + 4..eocd + 8] != [0; 4] {
        return Err("ZIP multi-disk archive requires an explicit VFS volume resolver".into());
    }
    let total_entries = u16::from_le_bytes([data[eocd + 10], data[eocd + 11]]) as usize;
    let central_size = u32::from_le_bytes(data[eocd + 12..eocd + 16].try_into().unwrap()) as usize;
    let central_offset = u32::from_le_bytes(data[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
    let cmt_len = u16::from_le_bytes([data[eocd + 20], data[eocd + 21]]) as usize;

    if central_offset.checked_add(central_size) != Some(eocd) {
        return Err("corrupt central directory".into());
    }

    let mut out = Vec::with_capacity(total_entries + 1);
    let mut pos = central_offset;
    for _ in 0..total_entries {
        if eocd - pos < 46 {
            return Err("truncated central directory".into());
        }
        if u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) != 0x0201_4b50 {
            return Err("invalid central directory header".into());
        }
        let central_start = pos;
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

        if name_len + extra_len + entry_cmt_len > eocd - pos - 46 {
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

        if local_off.checked_add(30).is_none_or(|end| end > central_offset)
            || u32::from_le_bytes(data[local_off..local_off + 4].try_into().unwrap()) != 0x0403_4b50
        {
            return Err("invalid local header".into());
        }
        let l_name_len = u16::from_le_bytes([data[local_off + 26], data[local_off + 27]]) as usize;
        let l_extra_len = u16::from_le_bytes([data[local_off + 28], data[local_off + 29]]) as usize;
        let payload_start = (local_off + 30).checked_add(l_name_len + l_extra_len).ok_or("invalid local header")?;
        if payload_start.checked_add(comp_size).is_none_or(|end| end > central_offset) {
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

        if let Some(records) = retained.as_deref_mut() {
            let central = &data[central_start..pos];
            let local = &data[local_off..payload_start+comp_size];
            if local[4..14] != central[6..16] { return Err("ZIP central/local metadata mismatch".into()); }
            if local[30..30+l_name_len] != central[46..46+name_len] { return Err("ZIP central/local filename mismatch".into()); }
            if central[8] & 1 != 0 { return Err("ZIP encrypted member requires a password".into()); }
            let descriptor = central[8] & 8 != 0;
            if local[14..26].chunks_exact(4).zip(central[16..28].chunks_exact(4))
                .any(|(a,b)| a != b && !(descriptor && a == [0;4])) {
                return Err("ZIP central/local size or CRC mismatch".into());
            }
            if descriptor {
                let tail = &data[payload_start+comp_size..central_offset];
                let unsigned = tail.starts_with(&central[16..28]);
                let signed = tail.strip_prefix(&0x08074b50u32.to_le_bytes()).is_some_and(|t|t.starts_with(&central[16..28]));
                if unsigned == signed { return Err("ZIP truncated, ambiguous or mismatched data descriptor".into()); }
            }
            if records.insert(name.clone(),ZipRecord {local,central}).is_some() {
                return Err("ZIP duplicate member name".into());
            }
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
            mtime: mtime as f64,
            atime: None,
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

    if pos != eocd {
        return Err("ZIP central directory size or member count mismatch".into());
    }
    if cmt_len > 0 {
        out.push(crate::commands::archive::TarEntry {
            name: "__ZIP_COMMENT__".to_string(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 1700000000.,
            atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: data[eocd + 22..eocd + 22 + cmt_len].to_vec(),
        });
    }

    Ok(out)
}
