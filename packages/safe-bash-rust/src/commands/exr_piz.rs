/*
 * PIZ wavelet decoding adapted from OpenEXR.
 * Copyright (c) 2002, Industrial Light & Magic, a division of Lucas
 * Digital Ltd. LLC
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 * *       Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 * *       Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 * *       Neither the name of Industrial Light & Magic nor the names of
 * its contributors may be used to endorse or promote products derived
 * from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */
struct Bits<'a> {
    bytes: &'a [u8],
    at: usize,
    end: usize,
}
impl Bits<'_> {
    fn read(&mut self, count: usize) -> Result<u64, &'static str> {
        if count > self.end.saturating_sub(self.at) {
            return Err("Truncated EXR PIZ Huffman bits");
        }
        let mut value = 0;
        for _ in 0..count {
            value = value * 2 + u64::from((self.bytes[self.at / 8] >> (7 - self.at % 8)) & 1);
            self.at += 1;
        }
        Ok(value)
    }
}
fn huffman(bytes: &[u8], words: usize) -> Result<Vec<u16>, &'static str> {
    if bytes.len() < 20 {
        return Err("Truncated EXR PIZ Huffman header");
    }
    let word = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
    let (first, last, table, bits) = (word(0), word(4), word(8), word(12));
    if first > last
        || last > 65536
        || table
            .checked_add(bits.div_ceil(8))
            .and_then(|n| n.checked_add(20))
            != Some(bytes.len())
    {
        return Err("Invalid EXR PIZ Huffman header");
    }
    let mut reader = Bits {
        bytes,
        at: 160,
        end: (20 + table) * 8,
    };
    let mut symbols: [Vec<u32>; 59] = std::array::from_fn(|_| Vec::new());
    let mut symbol = first;
    while symbol <= last {
        let length = reader.read(6)? as usize;
        if length >= 59 {
            symbol += if length == 63 {
                reader.read(8)? as usize + 6
            } else {
                length - 57
            };
            if symbol > last + 1 {
                return Err("Invalid EXR PIZ Huffman zero run");
            }
        } else {
            if length > 0 {
                symbols[length].push(symbol as u32);
            }
            symbol += 1;
        }
    }
    if reader.at.div_ceil(8) != 20 + table {
        return Err("Invalid EXR PIZ Huffman table size");
    }
    let mut starts = [0u64; 59];
    let mut code = 0;
    let mut maximum = 0;
    for length in (1..59).rev() {
        starts[length] = code;
        let next = code + symbols[length].len() as u64;
        if next > 1u64 << length || length > 1 && next & 1 != 0 {
            return Err("Invalid EXR PIZ Huffman codes");
        }
        code = next >> 1;
        if maximum == 0 && !symbols[length].is_empty() {
            maximum = length;
        }
    }
    if code != 1 {
        return Err("Invalid EXR PIZ Huffman codes");
    }
    reader.at = reader.end;
    reader.end += bits;
    let mut out = Vec::with_capacity(words);
    while reader.at < reader.end {
        let mut value = 0;
        let mut symbol = None;
        for length in 1..=maximum {
            value = value * 2 + reader.read(1)?;
            if let Some(index) = value
                .checked_sub(starts[length])
                .filter(|&n| n < symbols[length].len() as u64)
            {
                symbol = Some(symbols[length][index as usize] as usize);
                break;
            }
        }
        let symbol = symbol.ok_or("Invalid EXR PIZ Huffman symbol")?;
        if symbol == last {
            let count = reader.read(8)? as usize;
            let value = *out.last().ok_or("Invalid EXR PIZ Huffman repeat")?;
            if count > words.saturating_sub(out.len()) {
                return Err("Invalid EXR PIZ Huffman repeat");
            }
            out.resize(out.len() + count, value);
        } else {
            if out.len() == words {
                return Err("Invalid EXR PIZ Huffman output size");
            }
            out.push(symbol as u16);
        }
    }
    if out.len() != words {
        return Err("Truncated EXR PIZ Huffman output");
    }
    Ok(out)
}
fn pair(data: &mut [u16], a: usize, b: usize, maximum: usize) {
    let (low, high) = (data[a], data[b]);
    if maximum < 16384 {
        let low = i32::from(low as i16);
        let high = i32::from(high as i16);
        let first = low + (high & 1) + (high >> 1);
        data[a] = first as u16;
        data[b] = (first - high) as u16;
    } else {
        let second = low.wrapping_sub(high >> 1);
        data[a] = high.wrapping_add(second).wrapping_sub(32768);
        data[b] = second;
    }
}
fn wavelet(
    data: &mut [u16],
    start: usize,
    width: usize,
    height: usize,
    stride: usize,
    maximum: usize,
) {
    let mut level = 1;
    while level * 2 <= width.min(height) {
        level *= 2;
    }
    level /= 2;
    while level > 0 {
        let step = level * 2;
        let dx = level * stride;
        let dy = level * width * stride;
        let mut y = 0;
        while y + step <= height {
            let mut x = 0;
            while x + step <= width {
                let p = start + (y * width + x) * stride;
                pair(data, p, p + dy, maximum);
                pair(data, p + dx, p + dx + dy, maximum);
                pair(data, p, p + dx, maximum);
                pair(data, p + dy, p + dx + dy, maximum);
                x += step;
            }
            if width & level != 0 {
                let p = start + (y * width + x) * stride;
                pair(data, p, p + dy, maximum);
            }
            y += step;
        }
        if height & level != 0 {
            let mut x = 0;
            while x + step <= width {
                let p = start + (y * width + x) * stride;
                pair(data, p, p + dx, maximum);
                x += step;
            }
        }
        level /= 2;
    }
}
pub(super) fn unpack(
    bytes: &[u8],
    width: usize,
    height: usize,
    strides: &[usize],
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    if bytes.len() < 8 {
        return Err("Truncated EXR PIZ chunk");
    }
    let first = usize::from(u16::from_le_bytes(bytes[..2].try_into().unwrap()));
    let last = usize::from(u16::from_le_bytes(bytes[2..4].try_into().unwrap()));
    let bitmap = if first <= last { last - first + 1 } else { 0 };
    if last >= 8192 || 8 + bitmap > bytes.len() {
        return Err("Invalid EXR PIZ bitmap");
    }
    let offset = 8 + bitmap;
    let length = u32::from_le_bytes(bytes[4 + bitmap..offset].try_into().unwrap()) as usize;
    if length != bytes.len() - offset {
        return Err("Invalid EXR PIZ Huffman size");
    }
    let words = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(strides.iter().sum()))
        .ok_or("EXR PIZ exceeds memory budget")?;
    // Range table, worst-case Huffman symbol capacity, decoded words and rows.
    words
        .checked_mul(4)
        .and_then(|n| n.checked_add(65536 * 10 + 65536))
        .filter(|&n| n <= limit)
        .ok_or("EXR PIZ exceeds memory budget")?;
    let mut lut = vec![0u16; 65536];
    let mut values = 1;
    for i in 0..bitmap {
        for bit in 0..8 {
            let value = (first + i) * 8 + bit;
            if value != 0 && bytes[4 + i] & (1 << bit) != 0 {
                lut[values] = value as u16;
                values += 1;
            }
        }
    }
    let mut data = huffman(&bytes[offset..], words)?;
    let mut start = 0;
    for &stride in strides {
        for part in 0..stride {
            wavelet(&mut data, start + part, width, height, stride, values - 1);
        }
        start += width * height * stride;
    }
    let mut out = Vec::with_capacity(words * 2);
    for y in 0..height {
        let mut start = 0;
        for &stride in strides {
            let count = width * stride;
            let row = start + y * count;
            for &word in &data[row..row + count] {
                let value = usize::from(word);
                if value >= values {
                    return Err("Invalid EXR PIZ range index");
                }
                out.extend_from_slice(&lut[value].to_le_bytes());
            }
            start += count * height;
        }
    }
    Ok(out)
}
