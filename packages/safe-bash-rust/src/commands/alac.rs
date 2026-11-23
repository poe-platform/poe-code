struct Bits<'a> {
    bytes: &'a [u8],
    position: usize,
}
impl Bits<'_> {
    fn read(&mut self, width: u32) -> Result<u32, &'static str> {
        if width > 32 || self.bytes.len().saturating_mul(8).saturating_sub(self.position) < width as usize {
            return Err("Truncated ALAC packet");
        }
        let mut value = 0;
        for _ in 0..width {
            value = (value << 1) | u32::from((self.bytes[self.position / 8] >> (7 - self.position % 8)) & 1);
            self.position += 1;
        }
        Ok(value)
    }
    fn scalar(&mut self, k: u32, escape: u32) -> Result<u64, &'static str> {
        let mut prefix = 0u64;
        while prefix < 9 && self.read(1)? != 0 { prefix += 1; }
        if prefix == 9 { return self.read(escape).map(u64::from); }
        if k == 1 { return Ok(prefix); }
        let extra = self.read(k)?;
        if extra <= 1 { self.position -= 1; }
        Ok(prefix * ((1u64 << k) - 1) + u64::from(extra.saturating_sub(1)))
    }
}

pub(super) struct Config {
    pub frames: u32,
    pub bits: u32,
    pub channels: usize,
    pub rate: u32,
    history_multiplier: u32,
    history: u32,
    rice_limit: u32,
}
impl Config {
    pub fn packet_frames(&self, packet: &[u8]) -> Result<u32, &'static str> {
        let mut reader = Bits { bytes: packet, position: 19 };
        let explicit = reader.read(1)? != 0;
        reader.read(3)?;
        let frames = if explicit { reader.read(32)? } else { self.frames };
        if frames == 0 || frames > self.frames { return Err("Invalid ALAC frame length"); }
        Ok(frames)
    }
    pub fn read(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() != 24 { return Err("Unsupported ALAC configuration"); }
        let config = Self {
            frames: u32::from_be_bytes(bytes[..4].try_into().unwrap()),
            bits: bytes[5].into(), channels: bytes[9].into(),
            rate: u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
            history_multiplier: bytes[6].into(), history: bytes[7].into(), rice_limit: bytes[8].into(),
        };
        if !matches!(config.bits, 16 | 20 | 24 | 32) || !(1..=2).contains(&config.channels) || config.frames == 0 || config.rate == 0 {
            return Err("Unsupported ALAC configuration");
        }
        Ok(config)
    }

    /// Interleaved, left-aligned signed PCM32 retains every decoded ALAC bit.
    pub fn decode<'a>(&self, packets: impl Iterator<Item = (&'a [u8], u32)>, limit: usize) -> Result<Vec<u8>, &'static str> {
        let mut output = Vec::new();
        for (packet, duration) in packets {
            let mut reader = Bits { bytes: packet, position: 0 };
            if reader.read(3)? as usize != self.channels - 1 { return Err("Unsupported ALAC channel element"); }
            reader.read(16)?;
            let explicit = reader.read(1)? != 0;
            let mut low_bits = reader.read(2)? * 8;
            let verbatim = reader.read(1)? != 0;
            let frames = if explicit { reader.read(32)? } else { self.frames };
            if frames == 0 || frames > self.frames || frames != duration { return Err("Invalid ALAC frame length"); }
            let width = self.bits as i32 - low_bits as i32 + self.channels as i32 - 1;
            if !verbatim && !(1..=32).contains(&width) { return Err("Invalid ALAC sample width"); }
            let frames = frames as usize;
            let count = frames.checked_mul(self.channels).ok_or("ALAC exceeds memory budget")?;
            let size = count.checked_mul(4).ok_or("ALAC exceeds memory budget")?;
            let end = output.len().checked_add(size).ok_or("ALAC exceeds memory budget")?;
            if end.checked_add(size.saturating_mul(2)).is_none_or(|n| n > limit) { return Err("ALAC exceeds memory budget"); }
            output.try_reserve_exact(size).map_err(|_| "ALAC exceeds memory budget")?;
            let mut values = vec![0i32; count];
            let mut lows = vec![0u32; count];
            let (mut shift, mut weight) = (0, 0);
            if verbatim {
                low_bits = 0;
                for i in 0..frames { for ch in 0..self.channels { values[ch * frames + i] = signed(reader.read(self.bits)?, self.bits); } }
            } else {
                shift = reader.read(8)?; weight = reader.read(8)?;
                if shift > 31 || !(1..=31).contains(&self.rice_limit) { return Err("Invalid ALAC Rice configuration"); }
                let mut predictors = [(0u32, 0u32, 0u32, 0usize, [0i32; 31]); 2];
                for (kind, quant, multiplier, order, coefficients) in &mut predictors[..self.channels] {
                    *kind = reader.read(4)?; *quant = reader.read(4)?;
                    *multiplier = reader.read(3)?; *order = reader.read(5)? as usize;
                    if !matches!(*kind, 0 | 15) || *quant == 0 || *order as u32 >= self.frames { return Err("Unsupported ALAC predictor"); }
                    for coefficient in coefficients[..*order].iter_mut().rev() { *coefficient = signed(reader.read(16)?, 16); }
                }
                for i in 0..frames { for ch in 0..self.channels { lows[ch * frames + i] = reader.read(low_bits)?; } }
                for (ch, (kind, quant, multiplier, order, coefficients)) in predictors[..self.channels].iter_mut().enumerate() {
                    let data = &mut values[ch * frames..(ch + 1) * frames];
                    let (mut history, mut modifier) = (self.history, 0);
                    let multiplier = *multiplier * self.history_multiplier / 4;
                    let mut i = 0;
                    while i < frames {
                        let k = ((history >> 9) + 3).ilog2().min(self.rice_limit);
                        let value = reader.scalar(k, width as u32)? + modifier;
                        data[i] = ((value as u32 >> 1) as i32) ^ -((value & 1) as i32);
                        modifier = 0;
                        history = if value > 65535 { 65535 } else {
                            history.wrapping_add(value as u32 * multiplier).wrapping_sub(history.wrapping_mul(multiplier) >> 9)
                        };
                        if history < 128 && i + 1 < frames {
                            let k = (7 - if history == 0 { 0 } else { history.ilog2() } + ((history + 16) >> 6)).min(self.rice_limit);
                            let run = reader.scalar(k, 16)?;
                            if run >= (frames - i) as u64 { return Err("Invalid ALAC zero run"); }
                            i += run as usize;
                            modifier = u64::from(run <= 65535);
                            history = 0;
                        }
                        i += 1;
                    }
                    if *kind == 15 { for i in 1..frames { data[i] = signed(data[i].wrapping_add(data[i - 1]) as u32, width as u32); } }
                    if *order == 31 {
                        for i in 1..frames { data[i] = signed(data[i].wrapping_add(data[i - 1]) as u32, width as u32); }
                    } else if *order > 0 {
                        for i in 1..=(*order).min(frames - 1) { data[i] = signed(data[i].wrapping_add(data[i - 1]) as u32, width as u32); }
                        for i in *order + 1..frames {
                            let base = data[i - *order - 1];
                            let mut prediction = 0i32;
                            let mut error = i64::from(data[i]);
                            for (j, coefficient) in coefficients[..*order].iter().enumerate() {
                                prediction = prediction.wrapping_add(((i64::from(data[i - *order + j]) - i64::from(base)) * i64::from(*coefficient)) as i32);
                            }
                            let predicted = ((i64::from(prediction) + (1 << (*quant - 1))) >> *quant) + i64::from(base) + error;
                            data[i] = signed(predicted as u32, width as u32);
                            let direction = error.signum();
                            for (j, coefficient) in coefficients[..*order].iter_mut().enumerate() {
                                if error * direction <= 0 { break; }
                                let delta = i64::from(base) - i64::from(data[i - *order + j]);
                                let adjustment = delta.signum() * direction;
                                *coefficient = signed((*coefficient - adjustment as i32) as u32, 16);
                                error -= i64::from((delta * adjustment) as i32 >> *quant) * (j + 1) as i64;
                            }
                        }
                    }
                }
            }
            if reader.read(3)? != 7 { return Err("Missing ALAC end element"); }
            for i in 0..frames {
                if self.channels == 2 && weight != 0 {
                    let difference = values[frames + i];
                    let right = i64::from(values[i]) - ((i64::from(difference) * i64::from(weight)) >> shift);
                    values[i] = (right + i64::from(difference)) as i32;
                    values[frames + i] = right as i32;
                }
                for ch in 0..self.channels {
                    let index = ch * frames + i;
                    let sample = (values[index] as u32).wrapping_shl(low_bits).wrapping_add(lows[index]);
                    output.extend_from_slice(&(sample << (32 - self.bits)).to_le_bytes());
                }
            }
        }
        Ok(output)
    }
}
fn signed(value: u32, width: u32) -> i32 { ((value << (32 - width)) as i32) >> (32 - width) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alac_rejects_invalid_configuration_truncation_and_memory_exhaustion() {
        let mut bytes = [0u8; 24];
        bytes[..4].copy_from_slice(&4096u32.to_be_bytes());
        bytes[5] = 16;
        bytes[9] = 1;
        bytes[20..].copy_from_slice(&8000u32.to_be_bytes());
        assert!(Config::read(&bytes[..23]).is_err());
        for (offset, value) in [(5, 8), (9, 0), (9, 3)] {
            let mut invalid = bytes;
            invalid[offset] = value;
            assert!(Config::read(&invalid).is_err());
        }
        let config = Config::read(&bytes).unwrap();
        let mut packet = Vec::new();
        let mut position = 0;
        for (value, width) in [(0u32, 3), (0, 16), (1, 1), (0, 2), (1, 1), (1, 32), (0x8001, 16), (7, 3)] {
            for bit in (0..width).rev() {
                if position % 8 == 0 { packet.push(0); }
                packet[position / 8] |= (((value >> bit) & 1) as u8) << (7 - position % 8);
                position += 1;
            }
        }
        let decode = |packet: &[u8], duration, limit| config.decode(std::iter::once((packet, duration)), limit);
        assert_eq!(decode(&packet, 1, 12).unwrap(), (-32767i32 << 16).to_le_bytes());
        assert_eq!(decode(&packet, 1, 11).unwrap_err(), "ALAC exceeds memory budget");
        assert_eq!(decode(&packet, 2, 12).unwrap_err(), "Invalid ALAC frame length");
        for length in 0..packet.len() { assert!(decode(&packet[..length], 1, 12).is_err()); }
        let last = packet.len() - 1;
        packet[last] = 0;
        assert_eq!(decode(&packet, 1, 12).unwrap_err(), "Missing ALAC end element");
    }
}
