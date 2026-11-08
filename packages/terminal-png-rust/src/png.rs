//! Bounded RGBA PNG encoding with std-only RFC 1950/1951 compression.
const MAX_PIXELS: usize = 32 * 1024 * 1024;
const LENGTH_BASE: [usize; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const LENGTH_BITS: [u32; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE: [usize; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_BITS: [u32; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
struct Bits {
    bytes: Vec<u8>,
    buffer: u64,
    count: u32,
}
impl Bits {
    fn push(&mut self, value: u32, count: u32) {
        self.buffer |= u64::from(value) << self.count;
        self.count += count;
        while self.count >= 8 {
            self.bytes.push(self.buffer as u8);
            self.buffer >>= 8;
            self.count -= 8;
        }
    }
    fn code(&mut self, value: u32, count: u32) {
        self.push(value.reverse_bits() >> (32 - count), count);
    }
    fn symbol(&mut self, value: usize) {
        match value {
            0..=143 => self.code(0x30 + value as u32, 8),
            144..=255 => self.code(0x190 + (value - 144) as u32, 9),
            256..=279 => self.code((value - 256) as u32, 7),
            _ => self.code(0xc0 + (value - 280) as u32, 8),
        }
    }
    fn finish(mut self) -> Vec<u8> {
        if self.count > 0 {
            self.bytes.push(self.buffer as u8);
        }
        self.bytes
    }
}
fn hash(input: &[u8], i: usize) -> usize {
    let v = (u32::from(input[i]) << 16) | (u32::from(input[i + 1]) << 8) | u32::from(input[i + 2]);
    ((v.wrapping_mul(2654435761) >> 16) & 65535) as usize
}
fn adler32(input: &[u8]) -> u32 {
    let (mut a, mut b) = (1_u32, 0_u32);
    for block in input.chunks(5552) {
        for byte in block {
            a += u32::from(*byte);
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    (b << 16) | a
}
pub fn deflate(input: &[u8]) -> Vec<u8> {
    let mut bits = Bits {
        bytes: vec![0x78, 0x01],
        buffer: 0,
        count: 0,
    };
    bits.push(1, 1);
    bits.push(1, 2);
    let mut head = vec![usize::MAX; 65536];
    let mut previous = vec![usize::MAX; 32768];
    let mut i = 0;
    while i < input.len() {
        let mut length = 0;
        let mut distance = 0;
        if i + 2 < input.len() {
            let mut candidate = head[hash(input, i)];
            let mut attempts = 0;
            let limit = (input.len() - i).min(258);
            while candidate != usize::MAX
                && candidate < i
                && i - candidate <= 32768
                && attempts < 16
            {
                attempts += 1;
                if input[candidate + length] != input[i + length] {
                    let next = previous[candidate & 32767];
                    if next >= candidate {
                        break;
                    }
                    candidate = next;
                    continue;
                }
                let mut matched = 0;
                while matched < limit && input[candidate + matched] == input[i + matched] {
                    matched += 1;
                }
                if matched > length {
                    length = matched;
                    distance = i - candidate;
                    if length == limit {
                        break;
                    }
                }
                let next = previous[candidate & 32767];
                if next >= candidate {
                    break;
                }
                candidate = next;
            }
        }
        let consumed = if length >= 3 {
            let n = LENGTH_BASE.iter().rposition(|v| *v <= length).unwrap();
            bits.symbol(257 + n);
            bits.push((length - LENGTH_BASE[n]) as u32, LENGTH_BITS[n]);
            let n = DISTANCE_BASE.iter().rposition(|v| *v <= distance).unwrap();
            bits.code(n as u32, 5);
            bits.push((distance - DISTANCE_BASE[n]) as u32, DISTANCE_BITS[n]);
            length
        } else {
            bits.symbol(usize::from(input[i]));
            1
        };
        for offset in (0..consumed).step_by(consumed.saturating_sub(1).max(1)) {
            let at = i + offset;
            if at + 2 < input.len() {
                let h = hash(input, at);
                previous[at & 32767] = head[h];
                head[h] = at;
            }
        }
        i += consumed;
    }
    bits.symbol(256);
    let mut output = bits.finish();
    output.extend(adler32(input).to_be_bytes());
    output
}
fn crc32(input: &[u8]) -> u32 {
    let mut crc = !0_u32;
    for byte in input {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb88320 } else { 0 };
        }
    }
    !crc
}
fn chunk(output: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]) {
    output.extend((data.len() as u32).to_be_bytes());
    let start = output.len();
    output.extend(tag);
    output.extend(data);
    output.extend(crc32(&output[start..]).to_be_bytes());
}
pub fn encode(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, &'static str> {
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .filter(|n| *n > 0 && *n <= MAX_PIXELS)
        .ok_or("PNG dimensions exceed the pixel budget")?;
    if rgba.len() != pixels * 4 {
        return Err("RGBA length does not match PNG dimensions");
    }
    let row = width as usize * 4;
    let mut data = Vec::with_capacity(rgba.len() + height as usize);
    for (y, bytes) in rgba.chunks(row).enumerate() {
        if y == 0 {
            data.push(0);
            data.extend(bytes);
        } else {
            data.push(2);
            let previous = &rgba[(y - 1) * row..y * row];
            data.extend(bytes.iter().zip(previous).map(|(a, b)| a.wrapping_sub(*b)));
        }
    }
    let mut header = Vec::with_capacity(13);
    header.extend(width.to_be_bytes());
    header.extend(height.to_be_bytes());
    header.extend([8, 6, 0, 0, 0]);
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &deflate(&data));
    chunk(&mut png, b"IEND", &[]);
    Ok(png)
}
