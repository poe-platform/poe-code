use super::{
    InputTime, aiff, alac,
    ffmpeg_pcm::Format,
    ffmpeg_wave::{Input, Packet, Wave},
    mp4::mux::Remux,
};
use std::borrow::Cow;

pub(super) struct Document<'a> {
    pub rate: u32,
    pub channels: u32,
    pub frames: u64,
    pub tags: Vec<(String, String)>,
    format: Option<Format>,
    config: Option<&'a [u8]>,
    data: &'a [u8],
    offset: usize,
    packets: Vec<Packet>,
    durations: Vec<u32>,
    mask: u32,
    layout: Option<&'static str>,
    table_before_data: bool,
}

fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap())
}
fn variable(bytes: &[u8], cursor: &mut usize) -> Result<usize, &'static str> {
    let mut value = 0usize;
    for _ in 0..8 {
        let byte = *bytes.get(*cursor).ok_or("Invalid CAF packet integer")?;
        *cursor += 1;
        value = value
            .checked_mul(128)
            .and_then(|n| n.checked_add(usize::from(byte & 127)))
            .ok_or("Invalid CAF packet integer")?;
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    Err("Invalid CAF packet integer")
}
impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], pipe: bool, limit: usize) -> Result<Self, &'static str> {
        if bytes.len() > limit {
            return Err("input byte limit exceeded");
        }
        if bytes.len() < 8 || &bytes[..6] != b"caff\0\x01" {
            return Err("Invalid CAF header");
        }
        let mut doc = Self {
            rate: 0,
            channels: 0,
            frames: 0,
            tags: Vec::new(),
            format: None,
            config: None,
            data: &[],
            offset: 0,
            packets: Vec::new(),
            durations: Vec::new(),
            mask: 0,
            layout: None,
            table_before_data: false,
        };
        let (mut cookie, mut table) = (&[][..], &[][..]);
        let (mut packet_bytes, mut packet_frames, mut bits) = (0usize, 0u32, 0u32);
        let mut encoding = &[][..];
        let mut remaining = limit;
        let mut at = 8usize;
        while at < bytes.len() {
            let Some(header) = bytes.get(at..at.saturating_add(12)) else {
                if doc.offset > 0 {
                    break;
                }
                return Err("Truncated CAF chunk header");
            };
            let id = &header[..4];
            if at == 8 && id != b"desc" {
                return Err("CAF description must be the first chunk");
            }
            let start = at + 12;
            let size = i64::from_be_bytes(header[4..].try_into().unwrap());
            let size = if id == b"data" && (size == -1 || size > (bytes.len() - start) as i64) {
                bytes.len() - start
            } else {
                usize::try_from(size)
                    .ok()
                    .filter(|&n| n <= bytes.len() - start)
                    .ok_or("Invalid CAF chunk bounds")?
            };
            let body = &bytes[start..start + size];
            match id {
                b"desc" if at == 8 => {
                    if size != 32 {
                        return Err("Invalid CAF description");
                    }
                    let rate = f64::from_be_bytes(body[..8].try_into().unwrap()).trunc();
                    if !rate.is_finite() || !(1. ..=f64::from(u32::MAX)).contains(&rate) {
                        return Err("Invalid CAF sample rate");
                    }
                    doc.rate = rate as u32;
                    doc.channels = word(body, 24);
                    if !(1..=65535).contains(&doc.channels) {
                        return Err("Unsupported CAF audio encoding");
                    }
                    bits = word(body, 28);
                    encoding = &body[8..12];
                    let flags = word(body, 12);
                    packet_bytes = word(body, 16) as usize;
                    packet_frames = word(body, 20);
                    doc.format = match encoding {
                        b"alac" if packet_frames > 0 => None,
                        b"ima4"
                            if packet_frames == 64
                                && packet_bytes == doc.channels as usize * 34 =>
                        {
                            None
                        }
                        b"alaw" | b"ulaw"
                            if flags == 0 && bits == 8 && packet_bytes > 0 && packet_frames > 0 =>
                        {
                            Some(if encoding == b"alaw" {
                                Format::Alaw
                            } else {
                                Format::Mulaw
                            })
                        }
                        b"lpcm" if flags <= 7 => Some(match (flags & 1 != 0, bits) {
                            (true, 32 | 64) => Format::Float(bits as u16, flags & 2 == 0),
                            (false, 8 | 16 | 24 | 32) => {
                                Format::Signed(bits as u16, bits != 8 && flags & 2 == 0)
                            }
                            _ => return Err("Unsupported CAF audio encoding"),
                        }),
                        _ => return Err("Unsupported CAF audio encoding"),
                    };
                    if doc.format.is_some()
                        && packet_bytes != 0
                        && packet_frames != 0
                        && packet_bytes as u64
                            != u64::from(packet_frames)
                                * u64::from(doc.channels)
                                * u64::from(bits / 8)
                    {
                        return Err("Unsupported CAF audio encoding");
                    }
                }
                b"kuki" => cookie = body,
                b"pakt" => {
                    if size < 24 {
                        return Err("Invalid CAF packet table header");
                    }
                    if body[0] & 128 != 0 {
                        return Err("Invalid CAF packet count");
                    }
                    table = body;
                    if doc.offset == 0 {
                        doc.table_before_data = true;
                    }
                }
                b"data" => {
                    if size < 4 {
                        return Err("Invalid CAF data chunk");
                    }
                    doc.data = &body[4..];
                    doc.offset = start + 4;
                }
                b"chan" if !(pipe && doc.offset > 0) => {
                    if size < 12 {
                        return Err("Invalid CAF channel layout chunk");
                    }
                    let tag = word(body, 0);
                    let bitmap = if tag == 0x10000 { word(body, 4) } else { 0 };
                    doc.mask = if bitmap < 0x40000 && bitmap.count_ones() == doc.channels {
                        bitmap
                    } else {
                        0
                    };
                    doc.layout = if tag & 0xffff != doc.channels {
                        None
                    } else {
                        match tag {
                            0x640001 => Some("mono"),
                            0x650002 => Some("stereo"),
                            0x730004 => Some("4.0"),
                            0x6c0004 => Some("quad"),
                            0x840004 => Some("quad(side)"),
                            _ => None,
                        }
                    };
                }
                b"info" => {
                    if size < 4 {
                        return Err("Invalid CAF info chunk");
                    }
                    let mut cursor = 4;
                    for _ in 0..word(body, 0) {
                        let key_end = body[cursor..]
                            .iter()
                            .position(|&b| b == 0)
                            .map(|n| cursor + n)
                            .ok_or("Truncated CAF info entry")?;
                        let value_end = body[key_end + 1..]
                            .iter()
                            .position(|&b| b == 0)
                            .map(|n| key_end + 1 + n)
                            .ok_or("Truncated CAF info entry")?;
                        remaining = remaining
                            .checked_sub(
                                (value_end - cursor).saturating_mul(3)
                                    + size_of::<(String, String)>(),
                            )
                            .ok_or("CAF metadata exceeds memory budget")?;
                        let key = String::from_utf8_lossy(&body[cursor..key_end]).into_owned();
                        let value =
                            String::from_utf8_lossy(&body[key_end + 1..value_end]).into_owned();
                        if let Some((_, old)) = doc.tags.iter_mut().find(|(k, _)| k == &key) {
                            *old = value;
                        } else {
                            doc.tags.push((key, value));
                        }
                        cursor = value_end + 1;
                    }
                }
                _ => {}
            }
            at = start + size;
        }
        if encoding.is_empty() || doc.offset == 0 {
            return Err("Missing CAF description or data");
        }
        if encoding == b"ima4" {
            if doc.data.len() % packet_bytes != 0 {
                return Err("Truncated QuickTime IMA packet");
            }
            if doc.data.chunks_exact(34).any(|p| p[1] & 127 > 88) {
                return Err("Invalid QuickTime IMA step index");
            }
        }
        if encoding == b"alac" {
            doc.config = if cookie.len() == 24 {
                Some(cookie)
            } else {
                let mut found = None;
                let mut at = 0;
                while at + 8 <= cookie.len() {
                    let size = word(cookie, at) as usize;
                    if size < 8 || size > cookie.len() - at {
                        return Err("Invalid CAF ALAC cookie");
                    }
                    if &cookie[at + 4..at + 8] == b"alac" && size == 36 {
                        found = Some(&cookie[at + 12..at + size]);
                    }
                    at += size;
                }
                found
            };
            let config = alac::Config::read(doc.config.ok_or("Missing CAF ALAC configuration")?)?;
            if config.frames != packet_frames
                || config.channels != doc.channels as usize
                || config.rate != doc.rate
            {
                return Err("Invalid CAF ALAC configuration");
            }
        }
        let variable_packets = packet_bytes == 0 || packet_frames == 0;
        if doc.config.is_some() || variable_packets {
            if table.is_empty() {
                return Err("Missing CAF packet table");
            }
            let count = usize::try_from(u64::from_be_bytes(table[..8].try_into().unwrap()))
                .map_err(|_| "Invalid CAF packet count")?;
            if count > remaining / (size_of::<Packet>() + 4) {
                return Err("CAF packets exceed memory budget");
            }
            doc.packets
                .try_reserve_exact(count)
                .map_err(|_| "CAF packets exceed memory budget")?;
            doc.durations
                .try_reserve_exact(count)
                .map_err(|_| "CAF packets exceed memory budget")?;
            let mut cursor = 24;
            let mut offset = 0;
            for _ in 0..count {
                let size = if packet_bytes == 0 {
                    variable(table, &mut cursor)?
                } else {
                    packet_bytes
                };
                let frames = if let Some(config) = doc.config {
                    if size < 3 || size > doc.data.len() - offset {
                        return Err("Invalid CAF packet bounds");
                    }
                    alac::Config::read(config)?.packet_frames(&doc.data[offset..offset + size])?
                } else if packet_frames == 0 {
                    u32::try_from(variable(table, &mut cursor)?)
                        .map_err(|_| "Invalid CAF packet integer")?
                } else {
                    packet_frames
                };
                if size == 0
                    || frames == 0
                    || size > doc.data.len() - offset
                    || doc.format.is_some()
                        && size as u64
                            != u64::from(frames) * u64::from(doc.channels) * u64::from(bits / 8)
                {
                    return Err("Invalid CAF packet bounds");
                }
                doc.packets.push(Packet {
                    pos: doc.offset + offset,
                    size,
                    pts: doc.frames,
                });
                doc.durations.push(frames);
                doc.frames = doc
                    .frames
                    .checked_add(u64::from(frames))
                    .ok_or("Invalid CAF packet duration")?;
                offset += size;
            }
            if offset != doc.data.len() || cursor != table.len() {
                return Err("Invalid CAF packet table length");
            }
        } else {
            let size = if packet_frames == 1 {
                (4096 / packet_bytes).max(1) * packet_bytes
            } else {
                packet_bytes
            };
            if doc.data.len().div_ceil(size) > remaining / (size_of::<Packet>() + 4) {
                return Err("CAF packets exceed memory budget");
            }
            doc.packets
                .try_reserve_exact(doc.data.len().div_ceil(size))
                .map_err(|_| "CAF packets exceed memory budget")?;
            doc.durations
                .try_reserve_exact(doc.data.len().div_ceil(size))
                .map_err(|_| "CAF packets exceed memory budget")?;
            for offset in (0..doc.data.len()).step_by(size) {
                let count = size.min(doc.data.len() - offset);
                let frames = (count as u64 * u64::from(packet_frames) / packet_bytes as u64) as u32;
                doc.packets.push(Packet {
                    pos: doc.offset + offset,
                    size: count,
                    pts: doc.frames,
                });
                doc.durations.push(frames);
                doc.frames += u64::from(frames);
            }
            if encoding != b"ima4" {
                doc.frames = if table.is_empty() {
                    ((bytes.len() - doc.offset) as f64 * f64::from(packet_frames)
                        / packet_bytes as f64)
                        .round() as u64
                } else {
                    u64::from_be_bytes(table[..8].try_into().unwrap())
                        .checked_mul(u64::from(packet_frames))
                        .ok_or("Invalid CAF packet duration")?
                };
            }
        }
        Ok(doc)
    }
    pub fn render(&self, seek: InputTime, opts: &Remux) -> Result<Vec<u8>, String> {
        if self.format.is_some_and(|format| {
            !self.data.is_empty()
                && self.data.len() < self.channels as usize * usize::from(format.bits() / 8)
        }) {
            return Err("Incomplete raw audio sample frame".into());
        }
        let mut tags = if opts.strip_metadata {
            Vec::new()
        } else {
            self.tags.clone()
        };
        if matches!(opts.format, "wav" | "caf") && !opts.bitexact {
            tags.push(("encoder".into(), "Lavf61.7.100".into()));
        }
        tags.extend_from_slice(opts.metadata);
        let opts = Remux {
            metadata: &tags,
            hls: None,
            concat: None,
            ..*opts
        };
        if opts.audio_codec == Some("copy") && self.format.is_none() {
            if opts.format != "caf" {
                return Err("Compressed CAF stream copy requires CAF output".into());
            }
            let clock = |s: f64| (s.max(0.) * f64::from(self.rate)).round() as u64;
            let start = seek.start.map_or(0, clock);
            let end = seek.end().map_or(u64::MAX, clock);
            let from = opts.start.map_or(0, clock);
            let until = opts.end.map_or(u64::MAX, clock);
            let copies = seek
                .loops
                .checked_add(1)
                .ok_or("CAF packet traversal exceeds memory budget")?;
            copies
                .checked_mul(self.packets.len())
                .filter(|&n| n <= opts.limit / (size_of::<Packet>() + 4))
                .ok_or("CAF packet traversal exceeds memory budget")?;
            let mut data = Vec::new();
            let mut packets = Vec::new();
            let mut tick = 0;
            for _ in 0..copies {
                for (p, &frames) in self.packets.iter().zip(&self.durations) {
                    if p.pts + u64::from(frames) <= start || p.pts >= end {
                        continue;
                    }
                    if tick >= from && tick < until {
                        if data.len().saturating_add(p.size) > opts.limit {
                            return Err("CAF output exceeds memory budget".into());
                        }
                        data.extend_from_slice(
                            &self.data[p.pos - self.offset..p.pos - self.offset + p.size],
                        );
                        packets.push((p.size, frames));
                    }
                    tick = tick.saturating_add(u64::from(frames));
                }
            }
            return write(
                if self.config.is_some() {
                    "alac"
                } else {
                    "adpcm_ima_qt"
                },
                (self.rate, self.channels as usize, self.channel_mask()),
                &data,
                self.config.map(|c| (c, packets.as_slice())),
                &opts,
            );
        }
        let decoded = if let Some(config) = self.config {
            Cow::Owned(
                alac::Config::read(config)?.decode(
                    self.packets
                        .iter()
                        .zip(&self.durations)
                        .map(|(p, &frames)| {
                            (
                                &self.data[p.pos - self.offset..p.pos - self.offset + p.size],
                                frames,
                            )
                        }),
                    opts.limit,
                )?,
            )
        } else if self.format.is_none() {
            Cow::Owned(aiff::decode_ima(
                self.data,
                self.channels as usize,
                opts.limit,
            )?)
        } else {
            Cow::Borrowed(self.data)
        };
        let format = self.format.unwrap_or(Format::Signed(
            if self.config.is_some() { 32 } else { 16 },
            false,
        ));
        let mut wave = Wave::raw(format, &decoded, self.rate, self.channels)?;
        wave.channel_mask = self.channel_mask();
        wave.fact = Some(self.frames);
        if self.format.is_some() {
            wave.data_pos = self.offset;
            wave.packets = &self.packets;
        } else {
            wave.packet_frames = Some(if self.config.is_some() { 4096 } else { 64 });
        }
        Input::Wave(wave).render(
            seek,
            &Remux {
                limit: opts
                    .limit
                    .saturating_sub(if matches!(decoded, Cow::Owned(_)) {
                        decoded.len()
                    } else {
                        0
                    }),
                ..opts
            },
        )
    }
    pub(super) fn channel_mask(&self) -> u32 {
        if self.mask != 0 {
            self.mask
        } else {
            match self.layout {
                Some("mono") => 4,
                Some("stereo") => 3,
                Some("4.0") => 0x107,
                Some("quad") => 0x33,
                Some("quad(side)") => 0x603,
                _ => 0,
            }
        }
    }
}

pub(super) fn encoding(codec: &str) -> Result<Format, String> {
    if codec == "adpcm_ima_qt" {
        return Ok(Format::Signed(16, false));
    }
    match codec.strip_prefix("pcm_").and_then(Format::parse) {
        Some(f @ (Format::Signed(..) | Format::Float(..) | Format::Mulaw | Format::Alaw)) => Ok(f),
        _ => Err(format!("Unsupported CAF audio codec '{codec}'")),
    }
}

pub(super) fn write(
    codec: &str,
    (rate, channels, mask): (u32, usize, u32),
    data: &[u8],
    alac: Option<(&[u8], &[(usize, u32)])>,
    opts: &Remux,
) -> Result<Vec<u8>, String> {
    let format = if alac.is_some() {
        None
    } else {
        Some(encoding(codec)?)
    };
    let ima = codec == "adpcm_ima_qt";
    let data = if ima && opts.audio_codec != Some("copy") {
        Cow::Owned(aiff::encode_ima(data, channels, opts.limit)?)
    } else {
        Cow::Borrowed(data)
    };
    let mut out = Vec::new();
    let mut chunk = |id: &[u8], body: &[u8]| -> Result<(), String> {
        let size = out
            .len()
            .checked_add(12)
            .and_then(|n| n.checked_add(body.len()))
            .filter(|&n| n <= opts.limit)
            .ok_or("CAF output exceeds memory budget")?;
        out.try_reserve_exact(size - out.len())
            .map_err(|_| "CAF output exceeds memory budget")?;
        out.extend_from_slice(id);
        out.extend_from_slice(&(body.len() as u64).to_be_bytes());
        out.extend_from_slice(body);
        Ok(())
    };
    let mut desc = Vec::from(f64::from(rate).to_be_bytes());
    let bits = if alac.is_some() || ima {
        0
    } else {
        u32::from(format.unwrap().bits())
    };
    desc.extend_from_slice(if alac.is_some() {
        b"alac"
    } else if ima {
        b"ima4"
    } else {
        match format.unwrap() {
            Format::Alaw => b"alaw",
            Format::Mulaw => b"ulaw",
            _ => b"lpcm",
        }
    });
    let flags = match format {
        Some(Format::Float(_, big)) => 1 + if big { 0 } else { 2 },
        Some(Format::Signed(bits, false)) if bits > 8 && !ima => 2,
        _ => 0,
    };
    let frames = if let Some((config, _)) = alac {
        word(config, 0)
    } else if ima {
        64
    } else {
        1
    };
    for value in [
        flags,
        if ima {
            channels as u32 * 34
        } else {
            channels as u32 * (bits / 8)
        },
        frames,
        channels as u32,
        bits,
    ] {
        desc.extend_from_slice(&value.to_be_bytes());
    }
    chunk(b"desc", &desc)?;
    let tag: u32 = match mask {
        4 => 0x640001,
        3 => 0x650002,
        0x107 => 0x730004,
        0x33 | 0x603 => 0x840004,
        _ => 0,
    };
    if tag != 0 && tag & 0xffff == channels as u32 {
        let mut body = [0; 12];
        body[..4].copy_from_slice(&tag.to_be_bytes());
        chunk(b"chan", &body)?;
    }
    let mut info = Vec::from(0u32.to_be_bytes());
    let mut count = 0u32;
    for key in ["title", "artist", "album", "comment", "encoder"] {
        let value = if key == "encoder" {
            (!opts.bitexact).then_some("Lavf61.7.100")
        } else {
            opts.metadata
                .iter()
                .rev()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.as_str())
        };
        if let Some(value) = value {
            if value.is_empty() {
                continue;
            }
            if value.contains('\0') {
                return Err("CAF metadata cannot contain null bytes".into());
            }
            if info
                .len()
                .saturating_add(key.len())
                .saturating_add(value.len())
                .saturating_add(2)
                > opts.limit
            {
                return Err("CAF metadata exceeds memory budget".into());
            }
            info.extend_from_slice(key.as_bytes());
            info.push(0);
            info.extend_from_slice(value.as_bytes());
            info.push(0);
            count += 1;
        }
    }
    info[..4].copy_from_slice(&count.to_be_bytes());
    if count > 0 {
        chunk(b"info", &info)?;
    }
    if let Some((config, packets)) = alac {
        let mut cookie = Vec::from(&b"\0\0\0\x0cfrmaalac\0\0\0\x24alac\0\0\0\0"[..]);
        cookie.extend_from_slice(config);
        chunk(b"kuki", &cookie)?;
        let valid: u64 = packets.iter().map(|(_, frames)| u64::from(*frames)).sum();
        let remainder = (packets.len() as u64 * u64::from(frames))
            .checked_sub(valid)
            .filter(|&n| n <= i32::MAX as u64)
            .ok_or("Invalid CAF ALAC duration")?;
        let mut table = Vec::from((packets.len() as u64).to_be_bytes());
        table.extend_from_slice(&valid.to_be_bytes());
        table.extend_from_slice(&0u32.to_be_bytes());
        table.extend_from_slice(&(remainder as u32).to_be_bytes());
        for &(size, _) in packets {
            let mut value = size;
            let mut encoded = [0u8; 10];
            let mut at = 9;
            encoded[at] = (value & 127) as u8;
            value >>= 7;
            while value > 0 {
                at -= 1;
                encoded[at] = (value & 127) as u8 | 128;
                value >>= 7;
            }
            if table.len() + 10 > opts.limit {
                return Err("CAF packet table exceeds memory budget".into());
            }
            table.extend_from_slice(&encoded[at..]);
        }
        chunk(b"pakt", &table)?;
    }
    let size = out
        .len()
        .checked_add(24)
        .and_then(|n| n.checked_add(data.len()))
        .filter(|&n| n <= opts.limit)
        .ok_or("CAF output exceeds memory budget")?;
    let mut result = Vec::with_capacity(size);
    result.extend_from_slice(b"caff\0\x01\0\0");
    result.extend_from_slice(&out);
    result.extend_from_slice(b"data");
    result.extend_from_slice(
        &if opts.stdout {
            -1i64
        } else {
            data.len() as i64 + 4
        }
        .to_be_bytes(),
    );
    result.extend_from_slice(&0u32.to_be_bytes());
    result.extend_from_slice(&data);
    Ok(result)
}

impl Document<'_> {
    pub fn report(
        &self,
        filename: &str,
        bytes: usize,
        mut opts: super::media_probe::ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        use super::super::structured::JVal::{Number, Object, Str};
        use super::media_probe::{format_row, report, selected};
        let counts = (
            opts.counts.0 || opts.show.contains("frame"),
            opts.counts.1 || opts.show.contains("packet"),
        );
        if opts.show.contains("frame") && opts.show.contains("packet") {
            opts.show.remove("frame");
            opts.show.remove("packet");
            opts.show.insert("packet_frame");
        }
        let enabled = selected(opts.select, "audio", 0, 0);
        let declared_frames = self.config.map_or(Ok(self.frames), |config| {
            (self.packets.len() as u64)
                .checked_mul(u64::from(word(config, 0)))
                .ok_or("Invalid CAF packet duration")
        })?;
        let duration = declared_frames as f64 / f64::from(self.rate);
        let bits = self
            .format
            .map_or_else(|| self.config.map_or(4, |c| u16::from(c[5])), Format::bits);
        let codec = self.format.map_or_else(
            || {
                if self.config.is_some() {
                    "alac".into()
                } else {
                    "adpcm_ima_qt".into()
                }
            },
            |f| format!("pcm_{}", f.name()),
        );
        let sample_fmt = match self.format {
            Some(Format::Signed(8, _)) => "u8",
            Some(Format::Signed(16, _) | Format::Alaw | Format::Mulaw) => "s16",
            Some(Format::Float(32, _)) => "flt",
            Some(Format::Float(64, _)) => "dbl",
            None if self.config.is_some() && bits > 16 => "s32p",
            None => "s16p",
            _ => "s32",
        };
        let pipe = matches!(filename, "-" | "pipe:" | "pipe:0");
        let known = (!pipe || self.table_before_data)
            && !(self.format.is_some() && self.frames == 0 && self.packets.is_empty());
        let bit_rate = if duration > 0. {
            (self.data.len() as f64 * 8. / duration).round().to_string()
        } else {
            (u64::from(self.rate) * u64::from(self.channels) * u64::from(bits)).to_string()
        };
        report(opts, |section| match section {
            "stream" if enabled => {
                let long = match self.format {
                    Some(Format::Signed(16, true)) => "PCM signed 16-bit big-endian",
                    Some(Format::Signed(16, false)) => "PCM signed 16-bit little-endian",
                    _ if self.config.is_some() => "ALAC (Apple Lossless Audio Codec)",
                    _ => &codec,
                };
                let mut disposition = super::media_probe::disposition(true);
                disposition.extend(
                    [
                        "non_diegetic",
                        "captions",
                        "descriptions",
                        "metadata",
                        "dependent",
                        "still_image",
                        "multilayer",
                    ]
                    .map(|key| (key.into(), Number(0., None))),
                );
                let (tag, hex) = if self.config.is_some() {
                    ("alac", "0x63616c61")
                } else if self.format.is_none() {
                    ("ima4", "0x34616d69")
                } else {
                    match self.format {
                        Some(Format::Alaw) => ("alaw", "0x77616c61"),
                        Some(Format::Mulaw) => ("ulaw", "0x77616c75"),
                        _ => ("lpcm", "0x6d63706c"),
                    }
                };
                let mut row = vec![
                    ("index", Number(0., None)),
                    ("id", Str("0x1".into())),
                    ("codec_name", Str(codec.clone())),
                    ("codec_long_name", Str(long.into())),
                    ("codec_type", Str("audio".into())),
                    ("codec_tag_string", Str(tag.into())),
                    ("codec_tag", Str(hex.into())),
                    ("sample_fmt", Str(sample_fmt.into())),
                    ("sample_rate", Str(self.rate.to_string())),
                    ("channels", Number(f64::from(self.channels), None)),
                    (
                        "bits_per_sample",
                        Number(
                            if self.config.is_some() {
                                0.
                            } else {
                                f64::from(bits)
                            },
                            None,
                        ),
                    ),
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("1/{}", self.rate))),
                    ("start_pts", Number(0., None)),
                    ("start_time", Str("0.000000".into())),
                    ("disposition", Object(disposition)),
                    ("tags", Object(vec![("language".into(), Str("und".into()))])),
                ];
                if self.config.is_none() {
                    row.push(("bit_rate", Str(bit_rate.clone())));
                }
                if let Some(layout) = self.layout {
                    row.push(("channel_layout", Str(layout.into())));
                }
                if known {
                    row.extend([
                        ("duration_ts", Number(declared_frames as f64, None)),
                        ("duration", Str(format!("{duration:.6}"))),
                    ]);
                }
                let frames = self.format.map_or(declared_frames, |format| {
                    (self.data.len() / (self.channels as usize * usize::from(format.bits() / 8)))
                        as u64
                });
                if frames > 0 {
                    row.push(("nb_frames", Str(frames.to_string())));
                }
                if counts.0 && !self.packets.is_empty() {
                    row.push(("nb_read_frames", Str(self.packets.len().to_string())));
                }
                if counts.1 && !self.packets.is_empty() {
                    row.push(("nb_read_packets", Str(self.packets.len().to_string())));
                }
                Box::new(std::iter::once(row))
            }
            "format" => {
                let mut row = format_row(
                    filename,
                    bytes,
                    ("caf", "Apple CAF (Core Audio Format)"),
                    1,
                    duration,
                    self.tags
                        .iter()
                        .map(|(k, v)| (k.clone(), Str(v.clone())))
                        .collect(),
                );
                row.insert(3, ("nb_stream_groups", Number(0., None)));
                if duration > 0.
                    && let Some((_, rate)) = row.iter_mut().find(|(key, _)| *key == "bit_rate")
                {
                    *rate = Str((bytes as f64 * 8. / duration).trunc().to_string());
                }
                if pipe {
                    row.retain(|(k, _)| *k != "size" && *k != "bit_rate");
                }
                if !known {
                    row.retain(|(k, _)| *k != "duration" && *k != "bit_rate");
                    if self.config.is_none() {
                        row.push(("bit_rate", Str(bit_rate.clone())));
                    }
                }
                Box::new(std::iter::once(row))
            }
            "packet" | "frame" | "packet_frame" if enabled => {
                let combined = section == "packet_frame";
                Box::new(
                    (0..self.packets.len() * if combined { 2 } else { 1 }).map(move |index| {
                        let frame = section == "frame" || combined && index % 2 == 1;
                        let i = if combined { index / 2 } else { index };
                        let p = &self.packets[i];
                        let frames = self.durations[i];
                        let time = format!("{:.6}", p.pts as f64 / f64::from(self.rate));
                        let duration = format!("{:.6}", f64::from(frames) / f64::from(self.rate));
                        let mut row = if frame {
                            vec![
                                ("media_type", Str("audio".into())),
                                ("stream_index", Number(0., None)),
                                ("key_frame", Number(1., None)),
                                ("pts", Number(p.pts as f64, None)),
                                ("pts_time", Str(time.clone())),
                                ("pkt_dts", Number(p.pts as f64, None)),
                                ("pkt_dts_time", Str(time.clone())),
                                ("best_effort_timestamp", Number(p.pts as f64, None)),
                                ("best_effort_timestamp_time", Str(time)),
                                ("pkt_duration", Number(f64::from(frames), None)),
                                ("pkt_duration_time", Str(duration)),
                                ("pkt_size", Str(p.size.to_string())),
                                ("sample_fmt", Str(sample_fmt.into())),
                                ("nb_samples", Number(f64::from(frames), None)),
                                ("channels", Number(f64::from(self.channels), None)),
                            ]
                        } else {
                            vec![
                                ("codec_type", Str("audio".into())),
                                ("stream_index", Number(0., None)),
                                ("pts", Number(p.pts as f64, None)),
                                ("pts_time", Str(time.clone())),
                                ("dts", Number(p.pts as f64, None)),
                                ("dts_time", Str(time)),
                                ("duration", Number(f64::from(frames), None)),
                                ("duration_time", Str(duration)),
                                ("size", Str(p.size.to_string())),
                                ("pos", Str(p.pos.to_string())),
                                ("flags", Str("K__".into())),
                            ]
                        };
                        if combined {
                            row.insert(
                                0,
                                ("type", Str(if frame { "frame" } else { "packet" }.into())),
                            );
                        }
                        row
                    }),
                )
            }
            _ => Box::new(std::iter::empty()),
        })
    }
}
