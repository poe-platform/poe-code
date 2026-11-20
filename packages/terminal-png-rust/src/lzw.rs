//! Bounded TIFF/PDF LZW and shared MSB bit streams.
use mcp_protocol_rust::cooperate::{block_on, yield_now};
pub struct MsbBitWriter {
    pub bytes: Vec<u8>,
    bit_buf: u64,
    bit_cnt: u8,
}

impl MsbBitWriter {
    pub fn new() -> Self {
        Self {
            bytes: Vec::new(),
            bit_buf: 0,
            bit_cnt: 0,
        }
    }

    pub fn write_bits(&mut self, val: u64, n: u8) {
        if n == 0 {
            return;
        }
        let masked = if n >= 64 {
            val
        } else {
            val & ((1u64 << n) - 1)
        };
        self.bit_buf = (self.bit_buf << n) | masked;
        self.bit_cnt += n;
        while self.bit_cnt >= 8 {
            self.bit_cnt -= 8;
            self.bytes
                .push(((self.bit_buf >> self.bit_cnt) & 0xff) as u8);
        }
    }

    pub fn align(&mut self) {
        if self.bit_cnt > 0 {
            let pad = 8 - self.bit_cnt;
            self.write_bits(0, pad);
        }
    }

    pub fn finish(mut self) -> Vec<u8> {
        self.align();
        self.bytes
    }
}

pub struct MsbBitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_buf: u64,
    bit_cnt: u8,
}

impl<'a> MsbBitReader<'a> {
    pub fn new(data: &'a [u8], start_pos: usize) -> Self {
        Self {
            data,
            byte_pos: start_pos,
            bit_buf: 0,
            bit_cnt: 0,
        }
    }

    pub fn read_bits(&mut self, n: u8) -> Result<u64, String> {
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

    pub fn align_byte(&mut self) {
        let rem = self.bit_cnt % 8;
        self.bit_cnt -= rem;
    }

    pub fn consumed_bytes(&self) -> usize {
        self.byte_pos - ((self.bit_cnt / 8) as usize)
    }
}

pub fn decode(
    input: &[u8],
    early_change: f64,
    limit: usize,
    out: &mut Vec<u8>,
) -> Result<(), &'static str> {
    block_on(decode_async(input, early_change, limit, out))
}
pub async fn decode_async(
    input: &[u8],
    early_change: f64,
    limit: usize,
    out: &mut Vec<u8>,
) -> Result<(), &'static str> {
    let mut bits = MsbBitReader::new(input, 0);
    let mut phrases: Vec<(usize, usize)> = Vec::new();
    let mut previous: Option<(usize, usize)> = None;
    let mut width = 9;
    let mut work = 0usize;
    while let Ok(code) = bits.read_bits(width) {
        work += 1;
        if work % 1024 == 0 {
            yield_now().await;
        }
        let code = code as usize;
        match code {
            256 => {
                phrases.clear();
                previous = None;
                width = 9;
                continue;
            }
            257 => return Ok(()),
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
    Err("Truncated LZW stream")
}
