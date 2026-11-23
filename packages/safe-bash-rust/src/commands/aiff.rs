#[path = "aiff_id3.rs"]
mod id3;

use super::{
    InputTime,
    ffmpeg_pcm::Format,
    ffmpeg_wave::{Input, Wave},
    mp4::mux::Remux,
};

pub(super) const METADATA_FIELDS: &[&str] = &[
    "title",
    "artist",
    "albumArtist",
    "composer",
    "album",
    "date",
    "comment",
    "genre",
    "encoder",
    "compilation",
    "copyright",
    "description",
    "track",
    "disc",
];

pub(super) struct Document<'a> {
    pub rate: u32,
    pub channels: u32,
    pub frames: u32,
    pub format: Option<Format>,
    pub compressed: bool,
    pub data: &'a [u8],
    pub offset: usize,
    pub tags: Vec<(String, String)>,
    pub channel_mask: u32,
    layout: Option<String>,
}
pub(super) fn signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"FORM") && matches!(bytes.get(8..12), Some(b"AIFF" | b"AIFC"))
}
impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], pipe: bool, limit: usize) -> Result<Self, String> {
        if bytes.len() > limit {
            return Err("input byte limit exceeded".into());
        }
        if !signature(bytes) {
            return Err("Invalid or unsupported AIFF header".into());
        }
        let word = |i| u32::from_be_bytes(bytes[i..i + 4].try_into().unwrap());
        let end = (u64::from(word(4)) + 8).min(bytes.len() as u64) as usize;
        if end < 12 {
            return Err("Truncated AIFF FORM".into());
        }
        let compressed = &bytes[8..12] == b"AIFC";
        let mut doc = Self {
            rate: 0,
            channels: 0,
            frames: 0,
            format: None,
            compressed,
            data: &[],
            offset: 0,
            tags: Vec::new(),
            channel_mask: 0,
            layout: None,
        };
        let mut sound = false;
        let mut bits = 0;
        let mut special = None;
        let mut little = false;
        let mut at = 12usize;
        while at < end {
            let Some(h) = bytes.get(at..at.saturating_add(8)) else {
                if doc.channels > 0 && sound {
                    break;
                }
                return Err("Truncated AIFF chunk header".into());
            };
            let tag = &h[..4];
            let size = word(at + 4) as usize;
            let start = at + 8;
            let next = start.saturating_add(size).saturating_add(size % 2);
            if tag != b"SSND" && next > bytes.len() {
                if doc.channels > 0
                    && sound
                    && !matches!(tag, b"COMM" | b"NAME" | b"AUTH" | b"(c) " | b"ANNO")
                {
                    break;
                }
                return Err("Truncated AIFF chunk".into());
            }
            match tag {
                b"COMM" => {
                    if size < if compressed { 22 } else { 18 } {
                        return Err("Invalid AIFF COMM chunk".into());
                    }
                    if compressed {
                        let code = &bytes[start + 18..start + 22];
                        little = code == b"sowt";
                        special = match code {
                            b"NONE" | b"sowt" => None,
                            b"fl32" => Some("f32be"),
                            b"fl64" => Some("f64be"),
                            b"alaw" => Some("alaw"),
                            b"ulaw" => Some("mulaw"),
                            b"ima4" => Some("ima4"),
                            _ => {
                                return Err(format!(
                                    "Unsupported AIFF-C compression: {}",
                                    String::from_utf8_lossy(code)
                                ));
                            }
                        };
                    }
                    doc.channels = u32::from(u16::from_be_bytes(
                        bytes[start..start + 2].try_into().unwrap(),
                    ));
                    doc.frames = word(start + 2);
                    bits = u16::from_be_bytes(bytes[start + 6..start + 8].try_into().unwrap());
                    let exponent =
                        u16::from_be_bytes(bytes[start + 8..start + 10].try_into().unwrap());
                    let mantissa =
                        f64::from(word(start + 10)) * 4294967296. + f64::from(word(start + 14));
                    let rate = (mantissa * 2f64.powi(i32::from(exponent) - 16383 - 63)).round();
                    if exponent & 0x8000 != 0
                        || !rate.is_finite()
                        || !(1. ..=f64::from(u32::MAX)).contains(&rate)
                    {
                        return Err("Invalid AIFF sample rate".into());
                    }
                    doc.rate = rate as u32;
                }
                b"SSND" => {
                    if pipe && doc.channels == 0 {
                        return Err("AIFF file is not seekable: SSND precedes COMM".into());
                    }
                    let available = size.min(bytes.len() - start);
                    if available < 8 {
                        return Err("Invalid AIFF SSND chunk".into());
                    }
                    doc.offset = start
                        .saturating_add(8)
                        .saturating_add(word(start) as usize)
                        .min(start + available);
                    doc.data = &bytes[doc.offset..start + available];
                    sound = true;
                    if pipe && doc.channels > 0 {
                        break;
                    }
                }
                b"ID3 " => id3::read(&bytes[start..start + size], &mut doc.tags, limit)?,
                b"NAME" | b"AUTH" | b"(c) " | b"ANNO" => {
                    let key = match tag {
                        b"NAME" => "title",
                        b"AUTH" => "author",
                        b"(c) " => "copyright",
                        _ => "comment",
                    };
                    let data = &bytes[start..start + size];
                    let data = &data[..data.iter().position(|&b| b == 0).unwrap_or(data.len())];
                    if data.len() > limit / 2 {
                        return Err("AIFF metadata exceeds memory budget".into());
                    }
                    let value = String::from_utf8_lossy(data).into_owned();
                    if let Some((_, old)) = doc.tags.iter_mut().find(|(k, _)| k == key) {
                        *old = value;
                    } else {
                        doc.tags.push((key.into(), value));
                    }
                }
                b"CHAN" if size >= 12 => {
                    doc.layout = match word(start) {
                        0x00640001 => Some("mono".into()),
                        0x00650002 => Some("stereo".into()),
                        _ => None,
                    };
                    let mask = word(start + 4);
                    doc.channel_mask = if word(start) == 0x10000 && mask > 0 && mask < 0x40000 {
                        mask
                    } else {
                        0
                    };
                }
                _ => (),
            }
            at = next;
        }
        if doc.channels == 0 || !sound || special.is_none() && !(1..=32).contains(&bits) {
            return Err("Missing or unsupported AIFF audio format".into());
        }
        doc.format = match special {
            Some("ima4") => None,
            Some(s) => Format::parse(s),
            None => Some(Format::Signed(bits.div_ceil(8) * 8, bits > 8 && !little)),
        };
        if doc.channel_mask.count_ones() != doc.channels {
            doc.channel_mask = 0;
        }
        if doc.channel_mask != 0 {
            let layout = match doc.channel_mask {
                4 => "mono",
                3 => "stereo",
                11 => "2.1",
                7 => "3.0",
                259 => "3.0(back)",
                15 => "3.1",
                263 => "4.0",
                51 => "quad",
                1539 => "quad(side)",
                271 => "4.1",
                55 => "5.0",
                1543 => "5.0(side)",
                63 => "5.1",
                1551 => "5.1(side)",
                1799 => "6.0",
                1807 => "6.1",
                1591 => "7.0",
                1599 => "7.1",
                255 => "7.1(wide)",
                _ => "",
            };
            doc.layout = Some(if layout.is_empty() {
                let speakers = [
                    "FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC",
                    "TFL", "TFC", "TFR", "TBL", "TBC", "TBR",
                ]
                .into_iter()
                .enumerate()
                .filter_map(|(bit, name)| (doc.channel_mask & (1 << bit) != 0).then_some(name))
                .collect::<Vec<_>>();
                format!("{} channels ({})", doc.channels, speakers.join("+"))
            } else {
                layout.into()
            });
        }
        if doc
            .tags
            .iter()
            .map(|(k, v)| k.len() + v.len() + size_of::<(String, String)>())
            .sum::<usize>()
            > limit
        {
            return Err("AIFF metadata exceeds memory budget".into());
        }
        if doc.format.is_none() {
            if !doc.data.len().is_multiple_of(doc.channels as usize * 34) {
                return Err("Truncated QuickTime IMA packet".into());
            }
            if doc.data.chunks_exact(34).any(|p| p[1] & 127 > 88) {
                return Err("Invalid QuickTime IMA step index".into());
            }
        }
        Ok(doc)
    }
    pub fn ticks(&self) -> u64 {
        u64::from(self.frames) * if self.format.is_none() { 64 } else { 1 }
    }
    pub fn wave(&self) -> Result<Wave<'_>, String> {
        let format = self.format.ok_or("QuickTime IMA requires decoding")?;
        let mut wave = Wave::raw(format, self.data, self.rate, self.channels)?;
        wave.data_pos = self.offset;
        wave.fact = Some(self.ticks());
        wave.packet_frames = Some((4096 / wave.stride()).max(1));
        wave.channel_mask = self.channel_mask;
        Ok(wave)
    }
    pub fn render(&self, seek: InputTime, opts: &Remux) -> Result<Vec<u8>, String> {
        if self.format.is_some() {
            let mut wave = self.wave()?;
            if self
                .data
                .len()
                .div_ceil(wave.packet_frames() * wave.stride())
                > opts.limit / size_of::<super::ffmpeg_wave::Packet>()
            {
                return Err("AIFF packets exceed memory budget".into());
            }
            let packets: Vec<_> = self
                .data
                .chunks(wave.packet_frames() * wave.stride())
                .enumerate()
                .map(|(i, p)| super::ffmpeg_wave::Packet {
                    pos: self.offset + i * wave.packet_frames() * wave.stride(),
                    size: p.len(),
                    pts: (i * wave.packet_frames()) as u64,
                })
                .collect();
            wave.packets = &packets;
            if opts.audio_codec == Some("copy")
                && opts.format == "wav"
                && self.format == Some(Format::Signed(8, false))
            {
                wave.raw = Some(Format::Unsigned(8, false));
            }
            return Input::Wave(wave).render(seek, opts);
        }
        if opts.audio_codec == Some("copy") {
            if opts.format != "aiff" {
                return Err("QuickTime IMA stream copy requires AIFF output".into());
            }
            let clock = |s: f64| (s.max(0.) * f64::from(self.rate)).round() as usize;
            let start = seek.start.map_or(0, clock);
            let end = seek.end().map(clock).unwrap_or(usize::MAX);
            let from = opts.start.map_or(0, clock);
            let until = opts.end.map(clock).unwrap_or(usize::MAX);
            let stride = self.channels as usize * 34;
            let packets = self.data.len() / stride;
            let copies = seek
                .loops
                .checked_add(1)
                .ok_or("AIFF packet traversal exceeds memory budget")?;
            copies
                .checked_mul(packets)
                .filter(|&n| n <= opts.limit)
                .ok_or("AIFF packet traversal exceeds memory budget")?;
            let mut data = Vec::new();
            let mut tick = 0usize;
            for _ in 0..copies {
                let mut first = true;
                for (i, packet) in self.data.chunks_exact(stride).enumerate() {
                    let pts = i * 64;
                    if pts + 64 <= start || pts >= end {
                        continue;
                    }
                    if first {
                        tick = tick.saturating_add(pts.saturating_sub(start));
                        first = false;
                    }
                    if tick >= from && tick < until {
                        if data.len().saturating_add(stride) > opts.limit {
                            return Err("AIFF output exceeds memory budget".into());
                        }
                        data.extend_from_slice(packet);
                    }
                    tick = tick.saturating_add(64);
                }
                if tick >= until {
                    break;
                }
            }
            return write(
                "adpcm_ima_qt",
                self.rate,
                self.channels as usize,
                &data,
                opts,
            );
        }
        let data = decode_ima(self.data, self.channels as usize, opts.limit)?;
        let mut wave = Wave::raw(Format::Signed(16, false), &data, self.rate, self.channels)?;
        wave.packet_frames = Some(64);
        wave.fact = Some(self.ticks());
        wave.channel_mask = self.channel_mask;
        Input::Wave(wave).render(seek, opts)
    }
    pub fn report(
        &self,
        filename: &str,
        bytes: usize,
        mut opts: super::media_probe::ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        use super::super::structured::JVal::{Number, Object, Str};
        use super::media_probe::{format_row, report, selected};
        let bits = self.format.map_or(4, Format::bits);
        let ticks = self.ticks();
        let duration = ticks as f64 / f64::from(self.rate);
        let adpcm = self.format.is_none();
        let stride = self.channels as usize * if adpcm { 34 } else { usize::from(bits / 8) };
        let packet_size = if adpcm {
            stride
        } else {
            (4096 / stride).max(1) * stride
        };
        let packets = self.data.len().div_ceil(packet_size);
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
        let codec = self
            .format
            .map_or_else(|| "adpcm_ima_qt".into(), |f| format!("pcm_{}", f.name()));
        let sample_fmt = match self.format {
            Some(Format::Signed(8, _)) => "u8",
            Some(Format::Signed(16, _) | Format::Alaw | Format::Mulaw) => "s16",
            Some(Format::Float(32, _)) => "flt",
            Some(Format::Float(64, _)) => "dbl",
            None => "fltp",
            _ => "s32",
        };
        let bit_rate = if adpcm {
            if duration > 0. {
                (self.data.len() as f64 * 8. / duration).round().to_string()
            } else {
                "0".into()
            }
        } else {
            (u64::from(self.rate) * u64::from(self.channels) * u64::from(bits)).to_string()
        };
        report(opts, |section| match section {
            "stream" if enabled => {
                let long = match self.format {
                    Some(Format::Signed(16, true)) => "PCM signed 16-bit big-endian",
                    Some(Format::Signed(16, false)) => "PCM signed 16-bit little-endian",
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
                let mut row = vec![
                    ("index", Number(0., None)),
                    ("id", Str("0x1".into())),
                    ("codec_name", Str(codec.clone())),
                    ("codec_long_name", Str(long.into())),
                    ("codec_type", Str("audio".into())),
                    (
                        "codec_tag_string",
                        Str(if adpcm {
                            "ima4"
                        } else if self.compressed {
                            "raw "
                        } else {
                            "[0][0][0][0]"
                        }
                        .into()),
                    ),
                    (
                        "codec_tag",
                        Str(if adpcm {
                            "0x34616d69"
                        } else if self.compressed {
                            "0x20776172"
                        } else {
                            "0x0000"
                        }
                        .into()),
                    ),
                    ("sample_fmt", Str(sample_fmt.into())),
                    ("sample_rate", Str(self.rate.to_string())),
                    ("channels", Number(f64::from(self.channels), None)),
                    ("bits_per_sample", Number(f64::from(bits), None)),
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("1/{}", self.rate))),
                    ("start_pts", Number(0., None)),
                    ("start_time", Str("0.000000".into())),
                    ("duration_ts", Number(ticks as f64, None)),
                    ("duration", Str(format!("{duration:.6}"))),
                    ("bit_rate", Str(bit_rate.clone())),
                    ("nb_frames", Str(self.frames.to_string())),
                    ("disposition", Object(disposition)),
                    ("tags", Object(vec![("language".into(), Str("und".into()))])),
                ];
                if let Some(layout) = &self.layout {
                    row.push(("channel_layout", Str(layout.clone())));
                }
                if self.frames == 0 {
                    row.retain(|(k, _)| *k != "nb_frames");
                }
                if counts.0 && packets > 0 {
                    row.push(("nb_read_frames", Str(packets.to_string())));
                }
                if counts.1 && packets > 0 {
                    row.push(("nb_read_packets", Str(packets.to_string())));
                }
                Box::new(std::iter::once(row))
            }
            "format" => {
                let tags = self
                    .tags
                    .iter()
                    .filter(|(k, v)| !v.is_empty() || !METADATA_FIELDS.contains(&k.as_str()))
                    .map(|(k, v)| {
                        (
                            if k == "albumArtist" {
                                "album_artist".into()
                            } else {
                                k.clone()
                            },
                            Str(v.clone()),
                        )
                    })
                    .collect();
                let mut row = format_row(filename, bytes, ("aiff", "Audio IFF"), 1, duration, tags);
                row.insert(3, ("nb_stream_groups", Number(0., None)));
                if ticks == 0 {
                    row.retain(|(k, _)| !matches!(*k, "duration" | "bit_rate"));
                } else if !self.compressed
                    && let Some((_, value)) = row.iter_mut().find(|(k, _)| *k == "bit_rate")
                {
                    *value = Str((bytes as f64 * 8. / duration).floor().to_string());
                }
                Box::new(std::iter::once(row))
            }
            "packet" | "frame" | "packet_frame" if enabled => {
                let combined = section == "packet_frame";
                Box::new((0..packets * if combined { 2 } else { 1 }).map(move |i| {
                    let frame = section == "frame" || combined && i % 2 == 1;
                    let i = if combined { i / 2 } else { i };
                    let offset = i * packet_size;
                    let size = packet_size.min(self.data.len() - offset);
                    let samples = (size / stride) as u64 * if adpcm { 64 } else { 1 };
                    let pts = (offset / stride) as u64 * if adpcm { 64 } else { 1 };
                    let time = format!("{:.6}", pts as f64 / f64::from(self.rate));
                    let duration = format!("{:.6}", samples as f64 / f64::from(self.rate));
                    let mut row = if frame {
                        vec![
                            ("media_type", Str("audio".into())),
                            ("stream_index", Number(0., None)),
                            ("key_frame", Number(1., None)),
                            ("pts", Number(pts as f64, None)),
                            ("pts_time", Str(time.clone())),
                            ("pkt_dts", Number(pts as f64, None)),
                            ("pkt_dts_time", Str(time.clone())),
                            ("best_effort_timestamp", Number(pts as f64, None)),
                            ("best_effort_timestamp_time", Str(time)),
                            ("pkt_duration", Number(samples as f64, None)),
                            ("pkt_duration_time", Str(duration.clone())),
                            ("duration", Number(samples as f64, None)),
                            ("duration_time", Str(duration)),
                            ("pkt_size", Str(size.to_string())),
                            ("pkt_pos", Str((self.offset + offset).to_string())),
                            ("sample_fmt", Str(sample_fmt.into())),
                            ("nb_samples", Number(samples as f64, None)),
                            ("channels", Number(f64::from(self.channels), None)),
                        ]
                    } else {
                        vec![
                            ("codec_type", Str("audio".into())),
                            ("stream_index", Number(0., None)),
                            ("pts", Number(pts as f64, None)),
                            ("pts_time", Str(time.clone())),
                            ("dts", Number(pts as f64, None)),
                            ("dts_time", Str(time)),
                            ("duration", Number(samples as f64, None)),
                            ("duration_time", Str(duration)),
                            ("size", Str(size.to_string())),
                            ("pos", Str((self.offset + offset).to_string())),
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
                }))
            }
            _ => Box::new(std::iter::empty()),
        })
    }
}
pub(super) fn encoding(codec: &str) -> Result<Format, String> {
    match codec {
        "pcm_s8" | "pcm_s16be" | "pcm_s24be" | "pcm_s32be" | "pcm_s16le" | "pcm_f32be"
        | "pcm_f64be" | "pcm_alaw" | "pcm_mulaw" => Ok(Format::parse(&codec[4..]).unwrap()),
        "adpcm_ima_qt" => Ok(Format::Signed(16, false)),
        _ => Err(format!("Codec {codec} not supported in AIFF format")),
    }
}
pub(super) fn write(
    codec: &str,
    rate: u32,
    channels: usize,
    data: &[u8],
    opts: &Remux,
) -> Result<Vec<u8>, String> {
    if !matches!(opts.id3_version, 3 | 4) {
        return Err("Invalid AIFF ID3v2 version: expected 3 or 4".into());
    }
    let format = encoding(codec)?;
    let ima = codec == "adpcm_ima_qt";
    let encoded;
    let data = if ima && opts.audio_codec != Some("copy") {
        encoded = encode_ima(data, channels, opts.limit.saturating_sub(data.len()))?;
        encoded.as_slice()
    } else {
        data
    };
    let bits = if ima { 4 } else { format.bits() };
    let stride = channels * if ima { 34 } else { usize::from(bits / 8) };
    if channels == 0 || channels > 65535 || rate == 0 || !data.len().is_multiple_of(stride) {
        return Err("Invalid AIFF audio dimensions".into());
    }
    let frames = u32::try_from(data.len() / stride).map_err(|_| "Invalid AIFF audio dimensions")?;
    let code = match codec {
        "adpcm_ima_qt" => Some(b"ima4"),
        "pcm_s16le" => Some(b"sowt"),
        "pcm_f32be" => Some(b"fl32"),
        "pcm_f64be" => Some(b"fl64"),
        "pcm_alaw" => Some(b"alaw"),
        "pcm_mulaw" => Some(b"ulaw"),
        _ => None,
    };
    let mut out = b"FORM\0\0\0\0".to_vec();
    out.extend_from_slice(if code.is_some() { b"AIFC" } else { b"AIFF" });
    let chunk = |out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]| -> Result<(), String> {
        if out
            .len()
            .saturating_add(8)
            .saturating_add(data.len())
            .saturating_add(data.len() % 2)
            > opts.limit
        {
            return Err("AIFF output exceeds memory budget".into());
        }
        out.extend_from_slice(tag);
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(data);
        if data.len() % 2 != 0 {
            out.push(0);
        }
        Ok(())
    };
    if code.is_some() {
        chunk(&mut out, b"FVER", &0xa2805140u32.to_be_bytes())?;
    }
    for (tag, key) in [
        (b"NAME", "title"),
        (b"AUTH", "author"),
        (b"(c) ", "copyright"),
        (b"ANNO", "comment"),
    ] {
        if let Some((_, value)) = opts.metadata.iter().rev().find(|(k, _)| k == key)
            && !value.is_empty()
        {
            chunk(&mut out, tag, value.as_bytes())?;
        }
    }
    let mut comm = Vec::new();
    comm.extend_from_slice(&(channels as u16).to_be_bytes());
    comm.extend_from_slice(&if opts.stdout { 0 } else { frames }.to_be_bytes());
    comm.extend_from_slice(&bits.to_be_bytes());
    let exponent = rate.ilog2();
    comm.extend_from_slice(&((exponent + 16383) as u16).to_be_bytes());
    comm.extend_from_slice(&(u64::from(rate) << (63 - exponent)).to_be_bytes());
    if let Some(code) = code {
        comm.extend_from_slice(code);
        comm.extend_from_slice(&[0, 0]);
    }
    chunk(&mut out, b"COMM", &comm)?;
    if out
        .len()
        .saturating_add(16)
        .saturating_add(data.len())
        .saturating_add(data.len() % 2)
        > opts.limit
    {
        return Err("AIFF output exceeds memory budget".into());
    }
    out.extend_from_slice(b"SSND");
    out.extend_from_slice(
        &if opts.stdout {
            0
        } else {
            u32::try_from(data.len() + 8).map_err(|_| "AIFF output exceeds FORM size limit")?
        }
        .to_be_bytes(),
    );
    out.extend_from_slice(&[0; 8]);
    out.extend_from_slice(data);
    if data.len() % 2 != 0 {
        out.push(0);
    }
    if opts.write_id3 {
        let id3 = id3::write(
            opts.metadata,
            opts.id3_version,
            opts.limit.saturating_sub(out.len()).saturating_sub(8),
        )?;
        chunk(&mut out, b"ID3 ", &id3)?;
    }
    let length = u32::try_from(out.len() - 8).map_err(|_| "AIFF output exceeds FORM size limit")?;
    if !opts.stdout {
        out[4..8].copy_from_slice(&length.to_be_bytes());
    }
    Ok(out)
}
const STEPS: [i32; 89] = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
    494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
    2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
    10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const CHANGES: [i32; 8] = [-1, -1, -1, -1, 2, 4, 6, 8];
pub(super) fn decode_ima(data: &[u8], channels: usize, limit: usize) -> Result<Vec<u8>, String> {
    let frames = data.len() / (34 * channels) * 64;
    let size = frames
        .checked_mul(channels)
        .and_then(|n| n.checked_mul(2))
        .filter(|&n| n.saturating_add(channels * size_of::<(i32, i32)>()) <= limit)
        .ok_or("QuickTime IMA exceeds memory budget")?;
    let mut out = vec![0; size];
    let mut states = vec![(0i32, 0i32); channels];
    for (block, packet) in data.chunks_exact(channels * 34).enumerate() {
        for (channel, (predictor, index)) in states.iter_mut().enumerate() {
            let p = &packet[channel * 34..][..34];
            let header = i32::from(i16::from_be_bytes([p[0], p[1]]));
            let next = header & 127;
            if next > 88 {
                return Err("Invalid QuickTime IMA step index".into());
            }
            let start = header & !127;
            if *index != next || (*predictor - start).abs() > 127 {
                *predictor = start;
            }
            *index = next;
            for sample in 0..64 {
                let nibble = i32::from(p[2 + sample / 2] >> ((sample % 2) * 4) & 15);
                let step = STEPS[*index as usize];
                let delta = (step >> 3)
                    + if nibble & 1 != 0 { step >> 2 } else { 0 }
                    + if nibble & 2 != 0 { step >> 1 } else { 0 }
                    + if nibble & 4 != 0 { step } else { 0 };
                *predictor = (*predictor + if nibble & 8 != 0 { -delta } else { delta })
                    .clamp(-32768, 32767);
                *index = (*index + CHANGES[(nibble & 7) as usize]).clamp(0, 88);
                let at = ((block * 64 + sample) * channels + channel) * 2;
                out[at..at + 2].copy_from_slice(&(*predictor as i16).to_le_bytes());
            }
        }
    }
    Ok(out)
}
pub(super) fn encode_ima(data: &[u8], channels: usize, limit: usize) -> Result<Vec<u8>, String> {
    if !(1..=2).contains(&channels) {
        return Err("QuickTime IMA encoding supports mono or stereo audio".into());
    }
    let frames = data.len() / (channels * 2);
    let size = frames
        .div_ceil(64)
        .checked_mul(channels * 34)
        .filter(|&n| n.saturating_add(channels * size_of::<(i32, i32)>()) <= limit)
        .ok_or("QuickTime IMA exceeds memory budget")?;
    let mut out = vec![0; size];
    let mut states = vec![(0i32, 0i32); channels];
    for block in 0..frames.div_ceil(64) {
        for (channel, (predictor, index)) in states.iter_mut().enumerate() {
            let at = (block * channels + channel) * 34;
            out[at..at + 2].copy_from_slice(&(((*predictor & !127) | *index) as i16).to_be_bytes());
            for sample in 0..64 {
                let source = ((block * 64 + sample) * channels + channel) * 2;
                let target = data
                    .get(source..source + 2)
                    .map_or(0, |b| i32::from(i16::from_le_bytes(b.try_into().unwrap())));
                let mut difference = target - *predictor;
                let mut nibble = if difference < 0 { 8 } else { 0 };
                difference = difference.abs();
                let step = STEPS[*index as usize];
                let mut delta = step >> 3;
                for (bit, threshold) in [(4, step), (2, step >> 1), (1, step >> 2)] {
                    if difference >= threshold {
                        nibble |= bit;
                        difference -= threshold;
                        delta += threshold;
                    }
                }
                *predictor = (*predictor + if nibble & 8 != 0 { -delta } else { delta })
                    .clamp(-32768, 32767);
                *index = (*index + CHANGES[(nibble & 7) as usize]).clamp(0, 88);
                out[at + 2 + sample / 2] |= (nibble as u8) << ((sample % 2) * 4);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ima_accounts_for_predictor_storage_before_allocating() {
        assert!(decode_ima(&[], 65535, 1024).is_err());
        assert!(decode_ima(&[0; 34], 1, 128).is_err());
        assert_eq!(decode_ima(&[0; 34], 1, 136).unwrap(), vec![0; 128]);
        assert!(encode_ima(&[0; 128], 1, 34).is_err());
        assert_eq!(encode_ima(&[0; 128], 1, 42).unwrap(), vec![0; 34]);
    }
}
