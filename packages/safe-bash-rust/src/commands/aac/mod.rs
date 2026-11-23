// AAC-LC synthesis adapts Symphonia 0.5.5 under MPL-2.0; see LICENSE.AAC.
mod codebooks;
mod encoder;
pub(super) use encoder::encode;
mod common;
mod cpe;
mod dsp;
mod ics;
mod imdct;
mod window;
use common::GASubbandInfo;
use std::borrow::Cow;
type Result<T> = std::result::Result<T, &'static str>;
pub(super) struct Bits<'a> {
    pub bytes: &'a [u8],
    pub at: usize,
}
impl Bits<'_> {
    pub fn read_bits_leq32(&mut self, n: u32) -> Result<u32> {
        if n > 32 || n as usize > self.bytes.len().saturating_mul(8).saturating_sub(self.at) {
            return Err("Truncated AAC bitstream");
        }
        let mut value = 0;
        for _ in 0..n {
            value = value << 1 | u32::from(self.bytes[self.at / 8] >> (7 - self.at % 8) & 1);
            self.at += 1;
        }
        Ok(value)
    }
    pub fn read_bool(&mut self) -> Result<bool> {
        Ok(self.read_bits_leq32(1)? != 0)
    }
    pub fn read_unary_ones(&mut self) -> Result<u32> {
        for n in 0..9 {
            if !self.read_bool()? {
                return Ok(n);
            }
        }
        Err("Invalid AAC escape code")
    }
    fn skip(&mut self, count: usize) -> Result<()> {
        if count > self.bytes.len() * 8 - self.at {
            return Err("Truncated AAC bitstream");
        }
        self.at += count;
        Ok(())
    }
}
pub(super) fn decode<'a>(
    config: &[u8],
    packets: impl Iterator<Item = Result<(bool, Cow<'a, [u8]>)>>,
    limit: usize,
) -> Result<(u32, u32, Vec<u8>)> {
    let mut bits = Bits {
        bytes: config,
        at: 0,
    };
    if bits.read_bits_leq32(5)? != 2 {
        return Err("AAC decoding currently requires AAC-LC");
    }
    let frequency = bits.read_bits_leq32(4)?;
    let rate = if frequency == 15 {
        bits.read_bits_leq32(24)?
    } else {
        *super::adts::RATES
            .get(frequency as usize)
            .ok_or("Invalid AAC frequency")?
    };
    let channels = bits.read_bits_leq32(4)? as usize;
    if !(1..=2).contains(&channels) || rate == 0 || bits.read_bits_leq32(3)? != 0 {
        return Err("Unsupported AAC channel or frame configuration");
    }
    if config.len() * 8 - bits.at >= 16
        && bits.read_bits_leq32(11)? == 0x2b7
        && bits.read_bits_leq32(5)? == 5
        && bits.read_bool()?
    {
        return Err("AAC SBR decoding is not supported");
    }
    // Two channel pairs, spectral/Huffman tables, MDCT scratch, windows and PCM.
    let retained = 2 * size_of::<cpe::ChannelPair>() + size_of::<dsp::Dsp>() + 128 * 1024;
    let available = limit
        .checked_sub(retained)
        .ok_or("AAC decoder exceeds memory budget")?;
    let mut rng = common::Lcg::new(0x1f2e3d4c);
    let mut dsp = dsp::Dsp::new();
    let mut pairs = Vec::<cpe::ChannelPair>::with_capacity(2);
    let mut samples = vec![0f32; channels * 1024];
    let mut out = Vec::new();
    let sbinfo = GASubbandInfo::find(rate);
    let rate_idx = GASubbandInfo::find_idx(rate);
    for packet in packets {
        let (flush, packet) = packet?;
        if flush {
            for pair in &mut pairs {
                pair.flush();
            }
        }
        if channels * 1024 * 4 > available.saturating_sub(out.len() + packet.len()) {
            return Err("AAC PCM exceeds memory budget");
        }
        let mut bits = Bits {
            bytes: &packet,
            at: 0,
        };
        let mut channel = 0;
        let mut pair_index = 0;
        loop {
            match bits.read_bits_leq32(3)? {
                kind @ (0 | 1 | 3) => {
                    bits.read_bits_leq32(4)?;
                    let pair = kind == 1;
                    if channel + if pair { 2 } else { 1 } > channels {
                        return Err("AAC channel elements exceed configuration");
                    }
                    if pair_index == pairs.len() {
                        pairs.push(cpe::ChannelPair::new(pair, channel, sbinfo));
                    }
                    let state = &mut pairs[pair_index];
                    if state.channel != channel || state.is_pair != pair {
                        return Err("Changing AAC channel elements is not supported");
                    }
                    state.decode(&mut bits, &mut rng)?;
                    channel += if pair { 2 } else { 1 };
                    pair_index += 1;
                }
                4 => {
                    bits.read_bits_leq32(4)?;
                    let align = bits.read_bool()?;
                    let mut count = bits.read_bits_leq32(8)? as usize;
                    if count == 255 {
                        count += bits.read_bits_leq32(8)? as usize;
                    }
                    if align {
                        bits.skip((8 - bits.at % 8) % 8)?;
                    }
                    bits.skip(count * 8)?;
                }
                6 => {
                    let mut count = bits.read_bits_leq32(4)? as usize;
                    if count == 15 {
                        count += bits.read_bits_leq32(8)? as usize;
                        count -= 1;
                    }
                    if count > 0 {
                        let extension = bits.read_bits_leq32(4)?;
                        if matches!(extension, 13 | 14) {
                            return Err("AAC SBR decoding is not supported");
                        }
                        bits.skip(count * 8 - 4)?;
                    }
                }
                7 => break,
                _ => return Err("Unsupported AAC coupling or program configuration"),
            }
        }
        if channel != channels {
            return Err("Incomplete AAC channel elements");
        }
        for pair in &mut pairs[..pair_index] {
            pair.synth_audio(&mut dsp, &mut samples, rate_idx);
        }
        out.try_reserve_exact(channels * 4096)
            .map_err(|_| "AAC PCM exceeds memory budget")?;
        for frame in 0..1024 {
            for channel in 0..channels {
                let sample = samples[channel * 1024 + frame];
                if !sample.is_finite() {
                    return Err("Invalid AAC spectral data");
                }
                out.extend_from_slice(&sample.to_le_bytes());
            }
        }
    }
    Ok((rate, channels as u32, out))
}
pub(super) fn decode_adts(bytes: &[u8], loops: usize, limit: usize) -> Result<(u32, u32, Vec<u8>)> {
    if bytes.len() < 7 {
        return Err("Truncated ADTS header");
    }
    let object = (bytes[2] >> 6) + 1;
    let frequency = bytes[2] >> 2 & 15;
    let channels = (bytes[2] & 1) << 2 | bytes[3] >> 6;
    let config = [object << 3 | frequency >> 1, frequency << 7 | channels << 3];
    let copies = loops
        .checked_add(1)
        .ok_or("AAC loop count exceeds memory budget")?;
    let packets = (0..copies).flat_map(|_| {
        let mut rest = bytes;
        let mut first = true;
        std::iter::from_fn(move || {
            if rest.is_empty() {
                return None;
            }
            let result = (|| {
                if rest.len() < 7 || rest[0] != 255 || rest[1] & 0xf6 != 0xf0 {
                    return Err("Invalid or truncated ADTS header");
                }
                if rest[6] & 3 != 0 {
                    return Err("Multiple AAC raw blocks are not supported");
                }
                if (rest[2] >> 6) + 1 != object
                    || rest[2] >> 2 & 15 != frequency
                    || (rest[2] & 1) << 2 | rest[3] >> 6 != channels
                {
                    return Err("Changing AAC configuration is not supported");
                }
                let header = if rest[1] & 1 == 0 { 9 } else { 7 };
                let len = usize::from(rest[3] & 3) << 11
                    | usize::from(rest[4]) << 3
                    | usize::from(rest[5] >> 5);
                if len <= header || len > rest.len() {
                    return Err("Truncated ADTS packet");
                }
                let packet = &rest[header..len];
                rest = &rest[len..];
                let flush = first;
                first = false;
                Ok((flush, Cow::Borrowed(packet)))
            })();
            if result.is_err() {
                rest = &[];
            }
            Some(result)
        })
    });
    decode(&config, packets, limit)
}
