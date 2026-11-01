use super::{InputTime, mp4::mux::Remux};

/// FFmpeg's portable demuxer uses the last data chunk and accepts truncated sample data.
#[derive(Clone, Copy)]
pub(super) struct Wave<'a> {
    pub rate: u32,
    pub channels: usize,
    pub bits: u16,
    pub tag: u16,
    pub data: &'a [u8],
}
impl<'a> Wave<'a> {
    pub fn read(bytes: &'a [u8]) -> Result<Self, &'static str> {
        if !bytes.starts_with(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
            return Err("Invalid WAV file: missing RIFF WAVE signature");
        }
        let mut wave = Self {
            rate: 44100,
            channels: 2,
            bits: 16,
            tag: 1,
            data: &[],
        };
        let mut rest = &bytes[12..];
        while rest.len() >= 8 {
            let size = u32::from_le_bytes(rest[4..8].try_into().unwrap()) as usize;
            let body = &rest[8..][..size.min(rest.len() - 8)];
            match &rest[..4] {
                b"fmt " if size >= 16 => {
                    if body.len() < 16 {
                        return Err("Offset is outside the bounds of the DataView");
                    }
                    let word = |i| u16::from_le_bytes([body[i], body[i + 1]]);
                    wave.tag = word(0);
                    wave.channels = match word(2) {
                        0 => 2,
                        n => usize::from(n),
                    };
                    wave.rate = match u32::from_le_bytes(body[4..8].try_into().unwrap()) {
                        0 => 44100,
                        n => n,
                    };
                    wave.bits = match word(14) {
                        0 => 16,
                        n => n,
                    };
                }
                b"data" => wave.data = body,
                _ => {}
            }
            rest = rest[8 + body.len()..].get(size % 2..).unwrap_or_default();
        }
        Ok(wave)
    }
    pub fn stride(&self) -> usize {
        (self.channels * usize::from(self.bits / 8)).max(1)
    }
    fn sample(&self, frame: usize, ch: usize) -> f32 {
        let width = usize::from(self.bits / 8);
        let pos = frame * self.stride() + ch * width;
        let b = &self.data[pos..];
        match (self.tag, self.bits) {
            (3, 32) => f32::from_le_bytes(b[..4].try_into().unwrap()),
            (_, 8) => (f32::from(b[0]) - 128.) / 128.,
            (_, 16) => f32::from(i16::from_le_bytes(b[..2].try_into().unwrap())) / 32768.,
            (_, 24) => i32::from_le_bytes([0, b[0], b[1], b[2]]) as f32 / 2147483648.,
            (_, 32) => i32::from_le_bytes(b[..4].try_into().unwrap()) as f32 / 2147483648.,
            _ => 0.,
        }
    }
}
pub(super) enum Input<'a> {
    Wave(Wave<'a>),
    Encoded {
        rate: u32,
        channels: usize,
        seconds: f64,
        volume: f64,
    },
    Generated {
        frequency: f64,
        rate: u32,
        channels: usize,
        duration: f64,
    },
}
impl<'a> Input<'a> {
    pub fn parse(kind: &str, bytes: &'a [u8]) -> Result<Option<Self>, &'static str> {
        if kind == "wav" {
            return Ok(Some(Self::Wave(Wave::read(bytes)?)));
        }
        if kind != "lavfi" {
            return Ok(None);
        }
        let spec = std::str::from_utf8(bytes).unwrap_or_default();
        let (name, args) = spec.split_once('=').unwrap_or((spec, ""));
        let sine = match name.trim().to_ascii_lowercase().as_str() {
            "sine" => true,
            "anullsrc" => false,
            _ => return Ok(None),
        };
        let (mut frequency, mut rate, mut layout, mut duration) = (440., 44100, None, 1.);
        for (key, value) in args.split(':').filter_map(|s| s.split_once('=')) {
            let value = value.trim();
            match key.trim().to_ascii_lowercase().as_str() {
                "frequency" | "f" => {
                    frequency = value.parse().ok().filter(|v| *v != 0.).unwrap_or(440.)
                }
                "sample_rate" | "r" => {
                    rate = value.parse().ok().filter(|v| *v != 0).unwrap_or(44100)
                }
                "channel_layout" | "cl" => layout = Some(value),
                "duration" | "d" => {
                    duration = value.parse().ok().filter(|v| *v != 0.).unwrap_or(1.)
                }
                _ => {}
            }
        }
        Ok(Some(Self::Generated {
            frequency: if sine { frequency } else { 0. },
            rate,
            channels: if layout == Some("mono") || sine && layout.is_none() {
                1
            } else {
                2
            },
            duration,
        }))
    }

    pub fn render(&self, seek: InputTime, opts: &Remux) -> Result<Vec<u8>, String> {
        let (rate, channels, decoded, mut ticks) = match self {
            Self::Encoded {
                rate,
                channels,
                seconds,
                ..
            } => {
                let n = (seconds * f64::from(*rate)).round() as usize;
                (*rate, *channels, n, n)
            }
            Self::Wave(w) => {
                let n = w.data.len() / w.stride();
                (w.rate, w.channels, n, n)
            }
            Self::Generated {
                rate,
                channels,
                duration,
                ..
            } => {
                let d = seek.generation_end(opts.source_end).unwrap_or(*duration);
                let r = f64::from(*rate);
                (
                    *rate,
                    *channels,
                    (d * r).round().max(1024.) as usize,
                    ((d * 10.).round().max(1.) / 10. * r).round().max(1024.) as usize,
                )
            }
        };
        let clock = |s: f64| (s * f64::from(rate)).round() as usize;
        let from = seek.start.map_or(0, clock).min(decoded);
        let cut = seek.start.is_some() || seek.end().is_some();
        let until = if cut {
            seek.end().map_or(ticks, clock).min(decoded)
        } else {
            decoded
        };
        let len = until.saturating_sub(from);
        let copies = seek.loops.saturating_add(1);
        if cut {
            let packet_ticks = seek
                .end()
                .map_or(ticks, clock)
                .min(ticks)
                .saturating_sub(seek.start.map_or(0, clock));
            ticks = if copies > 1 && packet_ticks != 0 {
                packet_ticks
            } else {
                len
            };
        }
        let total_ticks = ticks
            .checked_mul(copies)
            .ok_or("audio output exceeds memory budget")?;
        let extent = if copies > 1 { total_ticks } else { len };
        let from_out = opts.start.map_or(0, clock).min(extent);
        let mut count = extent;
        if opts.start.is_some() || opts.end.is_some() || opts.shortest {
            count = opts
                .end
                .map_or(total_ticks, clock)
                .min(extent)
                .saturating_sub(from_out);
        }
        let mut track_ticks = if opts.start.is_some() || opts.end.is_some() || opts.shortest {
            count
        } else {
            total_ticks
        };
        let selected = !opts.strip_audio
            && (opts.maps.is_empty()
                || !super::mp4::mux::select_tracks(opts.maps, 1, |_| 1, |_, _| "audio")?
                    .is_empty());
        let target_rate = if selected {
            opts.rate.unwrap_or(rate)
        } else {
            44100
        };
        let out_ch = if selected {
            opts.channels.map_or(channels, |v| v as usize)
        } else {
            2
        };
        let filtered = selected
            && (opts.rate.is_some() || opts.channels.is_some() || !opts.audio_filters.is_empty());
        let mut volume = if let Self::Encoded { volume, .. } = self {
            *volume
        } else {
            1.
        };
        let (mut tempo, mut reverse) = (1., false);
        if filtered {
            for item in opts
                .audio_filters
                .iter()
                .flat_map(|f| f.split(','))
                .map(str::trim)
            {
                if let Some(v) = item.strip_prefix("volume=") {
                    volume *= if let Some(db) = v.trim().strip_suffix("dB") {
                        10f64.powf(db.parse::<f64>().unwrap_or(0.) / 20.)
                    } else {
                        v.trim()
                            .parse::<f64>()
                            .ok()
                            .filter(|&v| v != 0.)
                            .unwrap_or(1.)
                    }
                } else if let Some(v) = item.strip_prefix("atempo=") {
                    tempo *= v
                        .parse::<f64>()
                        .ok()
                        .filter(|&v| v != 0.)
                        .unwrap_or(1.)
                        .clamp(0.25, 4.);
                } else if item == "areverse" {
                    reverse = true;
                }
            }
            if track_ticks == 0 {
                track_ticks = rate as usize;
            }
        }
        let frames = if !selected {
            44100
        } else if filtered {
            ((track_ticks as f64 / f64::from(rate)).max(0.05) / tempo * f64::from(target_rate))
                .round()
                .max(1.) as usize
        } else {
            count
        };
        let mut out = pcm16(target_rate, out_ch, frames, opts.limit)?;
        for (i, frame) in out[44..].chunks_exact_mut(out_ch * 2).enumerate() {
            let i = if reverse { frames - 1 - i } else { i };
            let index = if filtered {
                ((i as f64 / frames as f64 * count as f64) as usize).min(count.saturating_sub(1))
            } else {
                i
            };
            let src = from_out.saturating_add(index);
            let src = if copies > 1 && ticks > 0 {
                src % ticks
            } else {
                src
            };
            for (ch, sample) in frame.chunks_exact_mut(2).enumerate() {
                let v = if !selected {
                    0.
                } else if (count == 0 || matches!(self, Self::Encoded { .. })) && filtered {
                    (2. * std::f64::consts::PI * 440. * i as f64 / f64::from(target_rate)).sin()
                        * 0.2
                } else if src >= len {
                    0.
                } else {
                    match self {
                        Self::Encoded { .. } => 0.,
                        Self::Wave(w) => f64::from(w.sample(from + src, ch.min(channels - 1))),
                        Self::Generated { frequency, .. } => f64::from(
                            ((2. * std::f64::consts::PI * frequency * (from + src) as f64
                                / f64::from(rate))
                            .sin()
                                * 0.5) as f32,
                        ),
                    }
                };
                let v = if filtered {
                    f64::from((v * volume).clamp(-1., 1.) as f32)
                } else {
                    v
                };
                sample.copy_from_slice(
                    &((v.clamp(-1., 1.) * 32767. + 0.5).floor() as i16).to_le_bytes(),
                );
            }
        }
        Ok(out)
    }
}

pub(super) fn pcm16(
    target_rate: u32,
    out_ch: usize,
    frames: usize,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let align = out_ch
        .checked_mul(2)
        .filter(|&a| a > 0 && a <= u16::MAX.into())
        .ok_or("invalid audio channel count")?;
    let size = frames
        .checked_mul(align)
        .filter(|&s| s <= limit.saturating_sub(44) && s <= u32::MAX as usize - 36)
        .ok_or("audio output exceeds memory budget")?;
    let byte_rate = target_rate
        .checked_mul(align as u32)
        .ok_or("invalid audio sample rate")?;
    let mut out = Vec::with_capacity(44 + size);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + size as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0");
    out.extend_from_slice(&(out_ch as u16).to_le_bytes());
    out.extend_from_slice(&target_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&(align as u16).to_le_bytes());
    out.extend_from_slice(b"\x10\0data");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.resize(44 + size, 0);
    Ok(out)
}
