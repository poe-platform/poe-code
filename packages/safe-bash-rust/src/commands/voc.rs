use super::{
    ffmpeg_pcm::Format,
    ffmpeg_wave::{Packet, Wave},
};

const SIGNATURE: &[u8] = b"Creative Voice File\x1a";

fn pcm(code: u16) -> Option<Format> {
    match code {
        0 => Some(Format::Unsigned(8, false)),
        4 => Some(Format::Signed(16, false)),
        6 => Some(Format::Alaw),
        7 => Some(Format::Mulaw),
        _ => None,
    }
}

pub(super) fn encoding(format: Format) -> Result<u16, String> {
    [0, 4, 6, 7]
        .into_iter()
        .find(|&code| pcm(code) == Some(format))
        .ok_or_else(|| format!("Unsupported VOC audio codec 'pcm_{}'", format.name()))
}

pub(super) struct Document {
    pub rate: u32,
    pub channels: u32,
    format: Format,
    data: Vec<u8>,
    packets: Vec<Packet>,
}

impl Document {
    pub fn read(bytes: &[u8], limit: usize) -> Result<Self, String> {
        if bytes.len() < 26 || !bytes.starts_with(SIGNATURE) {
            return Err("Invalid VOC header".into());
        }
        let word = |i| u16::from_le_bytes(bytes[i..i + 2].try_into().unwrap());
        let mut offset = usize::from(word(20));
        if offset < 26 || offset > bytes.len() {
            return Err("Invalid VOC data offset".into());
        }
        let mut audio = None;
        let mut extension = None;
        let mut data = Vec::new();
        let mut packets = Vec::new();
        let mut pts = 0;
        while offset < bytes.len() {
            let kind = bytes[offset];
            offset += 1;
            if kind == 0 {
                break;
            }
            let header = bytes
                .get(offset..offset + 3)
                .ok_or("Truncated VOC block header")?;
            let length =
                usize::from(header[0]) | usize::from(header[1]) << 8 | usize::from(header[2]) << 16;
            offset += 3;
            let end = offset
                .checked_add(length)
                .filter(|&end| end <= bytes.len())
                .ok_or("Truncated VOC block")?;
            if kind == 8 {
                if length < 4 {
                    return Err("Invalid VOC extended block".into());
                }
                let channels = u32::from(bytes[offset + 3]) + 1;
                extension = Some((
                    256_000_000 / (65536 - u32::from(word(offset))) / channels,
                    channels,
                    u16::from(bytes[offset + 2]),
                ));
                offset = end;
                continue;
            }
            if matches!(kind, 1 | 9) {
                let header_size = if kind == 9 { 12 } else { 2 };
                if length < header_size {
                    return Err("Invalid VOC sound block".into());
                }
                let (rate, channels, code) = if kind == 9 {
                    (
                        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()),
                        u32::from(bytes[offset + 5]),
                        word(offset + 6),
                    )
                } else {
                    extension.unwrap_or((
                        1_000_000 / (256 - u32::from(bytes[offset])),
                        1,
                        u16::from(bytes[offset + 1]),
                    ))
                };
                let format = pcm(code).ok_or("Unsupported VOC audio encoding")?;
                if kind == 9 && u16::from(bytes[offset + 4]) != format.bits() {
                    return Err("Unsupported VOC audio encoding".into());
                }
                if rate == 0 || channels == 0 {
                    return Err("Invalid VOC sample rate or channel count".into());
                }
                if audio.is_some_and(|previous| previous != (format, rate, channels)) {
                    return Err("Changing VOC audio format is not supported".into());
                }
                audio = Some((format, rate, channels));
                offset += header_size;
                extension = None;
            } else if kind != 2 {
                if kind == 3 && length < 3 {
                    return Err("Invalid VOC silence block".into());
                }
                if !matches!(kind, 3..=5) {
                    return Err(format!("Unsupported VOC block type {kind}"));
                }
                offset = end;
                continue;
            }
            let (format, _, channels) = audio.ok_or("VOC continuation without sound format")?;
            let stride = channels as usize * usize::from(format.bits() / 8);
            while offset < end {
                let size = (end - offset).min(2048);
                if data
                    .len()
                    .saturating_add(size)
                    .saturating_add((packets.len() + 1).saturating_mul(size_of::<Packet>()))
                    > limit
                {
                    return Err("VOC audio exceeds memory budget".into());
                }
                packets.push(Packet {
                    pos: offset,
                    size,
                    pts,
                });
                pts += (size / stride) as u64;
                data.extend_from_slice(&bytes[offset..offset + size]);
                offset += size;
            }
        }
        let (format, rate, channels) = audio.ok_or("VOC contains no audio")?;
        Ok(Self {
            rate,
            channels,
            format,
            data,
            packets,
        })
    }

    pub fn wave(&self) -> Wave<'_> {
        let (tag, bits) = self.format.wave_encoding().unwrap();
        Wave {
            block_align: 0, fmt: &[],
            rate: self.rate,
            channels: self.channels as usize,
            bits,
            tag,
            data: &self.data,
            data_pos: 0, truncated: false,
            fact: None,
            channel_mask: 0, channel_order: &[],
            raw: Some(self.format),
            packet_frames: None,
            packets: &self.packets, frames: &[],
        }
    }
}

pub(super) fn write(
    format: Format,
    rate: u32,
    channels: usize,
    data: &[u8],
    limit: usize,
) -> Result<Vec<u8>, String> {
    let code = encoding(format)?;
    if rate == 0 || rate > i32::MAX as u32 || channels == 0 || channels > 255 {
        return Err("Invalid VOC sample rate or channel count".into());
    }
    let stride = channels * usize::from(format.bits() / 8);
    if !data.len().is_multiple_of(stride) {
        return Err("Incomplete VOC audio frame".into());
    }
    let block_size = (0xffffff - 12) / stride * stride;
    let blocks = data.len().div_ceil(block_size).max(1);
    let size = blocks
        .checked_mul(16)
        .and_then(|n| n.checked_add(data.len()))
        .and_then(|n| n.checked_add(27))
        .filter(|&n| n <= limit)
        .ok_or("audio output exceeds memory budget")?;
    let mut out = vec![0; size];
    out[..20].copy_from_slice(SIGNATURE);
    out[20..26].copy_from_slice(&[26, 0, 0x14, 1, 0x1f, 0x11]);
    let mut offset = 26;
    for block in 0..blocks {
        let from = block * block_size;
        let payload = &data[from..data.len().min(from + block_size)];
        let length = (12 + payload.len()) as u32;
        out[offset] = 9;
        out[offset + 1..offset + 4].copy_from_slice(&length.to_le_bytes()[..3]);
        out[offset + 4..offset + 8].copy_from_slice(&rate.to_le_bytes());
        out[offset + 8] = format.bits() as u8;
        out[offset + 9] = channels as u8;
        out[offset + 10..offset + 12].copy_from_slice(&code.to_le_bytes());
        out[offset + 16..offset + 16 + payload.len()].copy_from_slice(payload);
        offset += 16 + payload.len();
    }
    Ok(out)
}
