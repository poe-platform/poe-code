use super::{InputTime, ffmpeg_pcm::Format, mp4::mux::Remux};

pub(super) const W64_RIFF: &[u8; 16] = b"riff\x2e\x91\xcf\x11\xa5\xd6\x28\xdb\x04\xc1\x00\x00";
pub(super) const W64_WAVE: &[u8; 16] = b"wave\xf3\xac\xd3\x11\x8c\xd1\x00\xc0\x4f\x8e\xdb\x8a";
const W64_SUFFIX: &[u8] = b"\xf3\xac\xd3\x11\x8c\xd1\x00\xc0\x4f\x8e\xdb\x8a";

pub(super) struct Packet {
    pub pos: usize,
    pub size: usize,
    pub pts: u64,
}

pub(super) struct Frame {
    pub start: usize,
    pub len: usize,
    pub pts: i128,
}

/// RIFF uses the last data chunk; Wave64 uses the first. Both accept truncated sample data.
#[derive(Clone, Copy)]
pub(super) struct Wave<'a> {
    pub rate: u32,
    pub channels: usize,
    pub bits: u16,
    pub tag: u16,
    pub block_align: u16,
    pub fmt: &'a [u8],
    pub data: &'a [u8],
    pub data_pos: usize,
    pub truncated: bool,
    pub fact: Option<u64>,
    pub channel_mask: u32,
    pub channel_order: &'a [u16],
    pub raw: Option<Format>,
    pub packet_frames: Option<usize>,
    pub packets: &'a [Packet],
    pub frames: &'a [Frame],
}
impl<'a> Wave<'a> {
    pub(super) fn output_frames(self, rate: u32, count: usize, start: Option<f64>, end: Option<f64>)
        -> impl Iterator<Item = (std::ops::Range<usize>, i128)> + 'a {
        let ratio = f64::from(self.rate) / f64::from(rate);
        let delay = if self.rate == rate { 0 } else { (16. / (0.97 / ratio).min(1.)).ceil() as usize };
        let from = (start.unwrap_or(0.) * f64::from(rate)).round() as i128;
        let first = self.frames.first().map_or(0, |p| (p.pts as f64 / ratio).round() as i128);
        let until = end.map(|time| (if start.is_some() { from } else { first }) + (((time - start.unwrap_or(0.)) * 1_000_000.).round() * f64::from(rate) / 1_000_000.).round() as i128);
        let end_time = end.map(|time| (time * f64::from(rate)).round() as i128);
        (0..=self.frames.len()).scan((0usize, false), move |(previous, done), i| {
            if *done { return None; }
            let packet = self.frames.get(i).or_else(|| self.frames.last());
            let begin = *previous;
            let pts = packet.map_or(begin as i128, |p| (begin as f64 - (p.start as f64 - p.pts as f64) / ratio).round() as i128);
            let shift = begin as i128 - pts;
            let end = self.frames.get(i).map_or(count, |p| {
                ((p.start + p.len).saturating_sub(delay) as f64 / ratio).ceil() as usize
            }).min(count);
            *previous = end;
            if end > begin && (until.is_some_and(|until| pts >= until)
                || end_time.is_some_and(|end| pts >= end)) { *done = true; return None; }
            let lo = if start.is_some() { (begin as i128).max(from + shift).min(end as i128).max(0) as usize } else { begin };
            let hi = until.map_or(end, |until| (end as i128).min(until + shift).max(lo as i128) as usize);
            Some((lo..hi, lo as i128 - shift - from))
        }).filter(|(range, _)| !range.is_empty())
    }
    pub(super) fn input_packets(self, seek: InputTime, mut work: usize)
        -> impl Iterator<Item = Result<(std::ops::Range<usize>, i128), &'static str>> + 'a {
        let stride = self.stride();
        let start = (seek.start.unwrap_or(0.) * f64::from(self.rate)).round() as i128;
        let mut position = (start.max(0) as usize).saturating_mul(stride).min(self.data.len());
        let (mut pass, mut offset, mut done) = (0, -start, false);
        let (mut earliest, mut latest) = (None::<i128>, None::<i128>);
        std::iter::from_fn(move || {
            if done { return None; }
            if position == self.data.len() {
                if pass == seek.loops || self.data.is_empty() { done = true; return None; }
                pass += 1;
                position = 0;
                offset = latest.zip(earliest).map_or(0, |(end, begin)| end - begin) - start;
            }
            let Some(remaining) = work.checked_sub(1) else {
                done = true; return Some(Err("audio packet work limit exceeded"));
            };
            work = remaining;
            let end = position.saturating_add(self.packet_frames() * stride).min(self.data.len());
            let pts = (position / stride) as i128 + offset;
            let duration = (end - position) / stride;
            earliest = Some(earliest.map_or(pts, |old| old.min(pts)));
            latest = Some(latest.map_or(pts + duration as i128, |old| old.max(pts + duration as i128)));
            let range = position..end;
            position = end;
            Some(Ok((range, pts)))
        })
    }
    pub(super) fn loop_pcm(self, seek: InputTime, limit: usize) -> Result<(Vec<u8>, Vec<Frame>), String> {
        let stride = self.stride();
        let until = seek.end().map(|end| ((end - seek.start.unwrap_or(0.)) * f64::from(self.rate)).round() as i128);
        let mut data = Vec::new();
        let mut frames = Vec::new();
        for packet in self.input_packets(seek, limit.saturating_mul(8)) {
            let (range, pts) = packet?;
            let length = range.len() / stride;
            if until.is_some_and(|end| pts >= end) { break; }
            let lo = (-pts).max(0).min(length as i128) as usize;
            let hi = until.map_or(length, |end| (end - pts).max(0).min(length as i128) as usize).max(lo);
            if hi == lo { continue; }
            let size = (hi - lo).checked_mul(stride).ok_or("audio output exceeds memory budget")?;
            let needed = data.len().checked_add(size).ok_or("audio output exceeds memory budget")?;
            needed.max(data.capacity()).checked_add((frames.len() + 1) * size_of::<Frame>())
                .filter(|&n| n <= limit).ok_or("audio timeline exceeds memory budget")?;
            data.try_reserve_exact(size).map_err(|_| "audio output exceeds memory budget")?;
            frames.try_reserve_exact(1).map_err(|_| "audio timeline exceeds memory budget")?;
            frames.push(Frame { start: data.len() / stride, len: hi - lo, pts: pts + lo as i128 });
            data.extend_from_slice(&self.data[range.start + lo * stride..range.start + hi * stride]);
        }
        Ok((data, frames))
    }
    pub fn read(bytes: &'a [u8]) -> Result<Self, &'static str> {
        let w64 = bytes.starts_with(W64_RIFF);
        if w64 {
            if bytes.get(24..40) != Some(W64_WAVE)
                || u64::from_le_bytes(bytes[16..24].try_into().unwrap()) < 40
                || bytes[23] & 0x80 != 0
            {
                return Err("Invalid Wave64 header");
            }
        } else if !bytes.starts_with(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
            return Err("Invalid WAV file: missing RIFF WAVE signature");
        }
        let mut wave = Self {
            rate: 44100,
            channels: 2,
            bits: 16,
            tag: 1,
            block_align: 0,
            fmt: &[],
            data: &[],
            data_pos: 0,
            truncated: false,
            fact: None,
            channel_mask: 0,
            channel_order: &[],
            raw: None,
            packet_frames: None,
            packets: &[], frames: &[],
        };
        let header = if w64 { 24 } else { 8 };
        let mut rest = &bytes[if w64 { 40 } else { 12 }..];
        let mut fmt = false;
        while rest.len() >= header {
            let size = if w64 {
                u64::from_le_bytes(rest[16..24].try_into().unwrap())
                    .checked_sub(24)
                    .filter(|&size| size > 0)
                    .ok_or("Invalid Wave64 chunk size")?
            } else {
                u64::from(u32::from_le_bytes(rest[4..8].try_into().unwrap()))
            };
            let available = (rest.len() - header) as u64;
            let body = &rest[header..][..size.min(available) as usize];
            let id = if !w64 || &rest[4..16] == W64_SUFFIX {
                &rest[..4]
            } else {
                &[]
            };
            match id {
                b"fmt " if size >= 16 => {
                    if body.len() < 16 {
                        return Err("Offset is outside the bounds of the DataView");
                    }
                    fmt = true;
                    let word = |i| u16::from_le_bytes([body[i], body[i + 1]]);
                    wave.tag = word(0);
                    wave.block_align = word(12);
                    wave.fmt = body;
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
                    if wave.tag == 0xfffe {
                        if body.len() < 40 || word(16) < 22 {
                            return Err("Short extensible WAV fmt");
                        }
                        if body[26..40] != [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113] {
                            return Err("Unsupported WAV subformat GUID");
                        }
                        wave.tag = word(24);
                        wave.channel_mask = u32::from_le_bytes(body[20..24].try_into().unwrap());
                    }
                }
                b"data" => {
                    wave.data = body;
                    wave.truncated = size > available;
                    wave.data_pos = bytes.len() - rest.len() + header;
                    if w64 {
                        break;
                    }
                }
                b"fact" if !w64 && body.len() >= 4 && matches!(wave.tag,2|3|17|32|69) => {wave.fact=Some(u64::from(u32::from_le_bytes(body[..4].try_into().unwrap())));}
                b"fact" if w64 && body.len() >= 8 => {
                    wave.fact = Some(u64::from_le_bytes(body[..8].try_into().unwrap()));
                }
                _ => {}
            }
            if size > available {
                break;
            }
            let alignment = if w64 { 8 } else { 2 };
            let padding = (alignment - size % alignment) % alignment;
            rest = rest[header + body.len()..]
                .get(padding as usize..)
                .unwrap_or_default();
        }
        if w64
            && (!fmt
                || wave.data_pos == 0
                || !matches!((wave.tag, wave.bits), (1, 8 | 16 | 24 | 32) | (3, 32 | 64)))
        {
            return Err("Invalid or unsupported Wave64 PCM stream");
        }
        if !w64 && wave.tag == 3 && !wave.data.is_empty() { wave.fact = None; }
        Ok(wave)
    }
    pub fn raw(
        format: Format,
        bytes: &'a [u8],
        rate: u32,
        channels: u32,
    ) -> Result<Self, &'static str> {
        if rate == 0 || channels == 0 || channels > 65535 {
            return Err("Invalid raw audio sample rate or channel count");
        }
        let (tag, bits) = format.wave_encoding().unwrap_or((1, format.bits()));
        Ok(Self {
            rate,
            channels: channels as usize,
            bits,
            tag,
            block_align: 0,
            fmt: &[],
            data: bytes,
            data_pos: 0,
            truncated: false,
            fact: None,
            channel_mask: 0,
            channel_order: &[],
            raw: Some(format),
            packet_frames: None,
            packets: &[], frames: &[],
        })
    }
    pub fn format(&self) -> Format {
        self.raw
            .unwrap_or_else(|| Format::wave(self.tag, self.bits))
    }
    pub fn packet_frames(&self) -> usize {
        if let Some(frames)=self.packet_frames { return frames; }
        let target = (self.rate as usize / 10)
            .min(i32::MAX as usize / self.stride())
            .max(1);
        1 << target.ilog2()
    }
    pub fn report(
        &self,
        filename: &str,
        bytes: usize,
        container: &str,
        tags: &[(String, String)],
        mut opts: super::media_probe::ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        if matches!(self.tag,2|17|32|69) {return super::adpcm_wav::report(*self,filename,bytes,opts);}
        use super::super::structured::JVal::{Number, Object, Str};
        use super::media_probe::{format_row, report, selected};
        let stride = self.stride();
        if !matches!(container, "ircam" | "nistsphere" | "voc") && self.raw.is_some() && !self.data.is_empty() && self.data.len() < stride {
            return Err("Incomplete raw audio sample frame");
        }
        let ticks = self.fact.filter(|&n| n > 0 || container == "nistsphere").unwrap_or(
            ((self.data.len() + if self.raw.is_some() { 0 } else { stride / 2 }) / stride) as u64,
        );
        let duration = ticks as f64 / f64::from(self.rate);
        let packet_size = self.packet_frames() * stride;
        let packets = if self.packets.is_empty() { self.data.len().div_ceil(packet_size) } else { self.packets.len() };
        let frames = if self.raw.is_some() {
            packets
        } else {
            (self.data.len() / stride).div_ceil(packet_size / stride)
        };
        let enabled = selected(opts.select, "audio", 0, 0);
        let counts = (
            opts.counts.0 || opts.show.contains("frame"),
            opts.counts.1 || opts.show.contains("packet"),
        );
        let optional = !matches!(opts.writer, "json" | "xml");
        if (self.raw.is_some() || container == "wav") && opts.show.contains("packet") && opts.show.contains("frame") {
            opts.show.remove("packet");
            opts.show.remove("frame");
            opts.show.insert("packet_frame");
        }
        let sample_fmt = match self.format() {
            Format::Float(32, _) => "flt",
            Format::Float(64, _) => "dbl",
            Format::Mulaw | Format::Alaw | Format::Vidc | Format::Signed(16, _) | Format::Unsigned(16, _) => "s16",
            Format::Signed(8, _) | Format::Unsigned(8, _) => "u8",
            _ => "s32",
        };
        report(opts, |section| match section {
            "stream" if enabled && self.raw.is_some() => {
                let raw = self.raw.unwrap();
                let codec = format!("pcm_{}", raw.name());
                let long = match raw {
                    Format::Signed(16, big) => format!(
                        "PCM signed 16-bit {}-endian",
                        if big { "big" } else { "little" }
                    ),
                    _ => codec.clone(),
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
                    ("codec_name", Str(codec)),
                    ("codec_long_name", Str(long)),
                    ("codec_type", Str("audio".into())),
                    ("codec_tag_string", Str("raw ".into())),
                    ("codec_tag", Str("0x20776172".into())),
                    ("sample_fmt", Str(sample_fmt.into())),
                    ("sample_rate", Str(self.rate.to_string())),
                    ("channels", Number(self.channels as f64, None)),
                    (
                        "channel_layout",
                        Str(if self.channels == 1 { "mono" } else { "stereo" }.into()),
                    ),
                    ("bits_per_sample", Number(f64::from(self.bits), None)),
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("1/{}", self.rate))),
                    ("start_pts", Number(0., None)),
                    ("start_time", Str("0.000000".into())),
                    ("duration_ts", Number(ticks as f64, None)),
                    ("duration", Str(format!("{duration:.6}"))),
                    (
                        "bit_rate",
                        Str(if duration > 0. {
                            (self.data.len() as f64 * 8. / duration).round().to_string()
                        } else {
                            "0".into()
                        }),
                    ),
                    ("nb_frames", Str(packets.to_string())),
                    ("disposition", Object(disposition)),
                    ("tags", Object(vec![("language".into(), Str("und".into()))])),
                ];
                if counts.0 && packets > 0 {
                    row.push(("nb_read_frames", Str(frames.to_string())));
                }
                if counts.1 && packets > 0 {
                    row.push(("nb_read_packets", Str(packets.to_string())));
                }
                Box::new(std::iter::once(row))
            }
            "stream" if enabled => {
                let bits = self.bits;
                let codec = if self.tag == 3 {
                    format!("pcm_f{bits}le")
                } else if bits == 8 {
                    "pcm_u8".into()
                } else {
                    format!("pcm_s{bits}le")
                };
                let encoding = if self.tag == 3 {
                    "floating point"
                } else if bits == 8 {
                    "unsigned"
                } else {
                    "signed"
                };
                let mut row = vec![
                    ("index", Number(0., None)),
                    ("codec_name", Str(codec)),
                    (
                        "codec_long_name",
                        Str(format!(
                            "PCM {encoding} {bits}-bit{}",
                            if bits == 8 { "" } else { " little-endian" }
                        )),
                    ),
                    ("codec_type", Str("audio".into())),
                    ("codec_tag_string", Str(format!("[{}][0][0][0]", self.tag))),
                    ("codec_tag", Str(format!("0x{:04x}", self.tag))),
                    ("sample_fmt", Str(sample_fmt.into())),
                    ("sample_rate", Str(self.rate.to_string())),
                    ("channels", Number(self.channels as f64, None)),
                    ("bits_per_sample", Number(f64::from(bits), None)),
                    ("initial_padding", Number(0., None)),
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("1/{}", self.rate))),
                    ("duration_ts", Number(ticks as f64, None)),
                    ("duration", Str(format!("{duration:.6}"))),
                    (
                        "bit_rate",
                        Str(
                            (u64::from(self.rate) * self.channels as u64 * u64::from(bits))
                                .to_string(),
                        ),
                    ),
                ];
                if let Some(layout) = super::audio_remix::describe_layout(self.channel_mask) {
                    row.insert(9, ("channel_layout", Str(layout)));
                }
                if self.tag == 1 && bits > 16 {
                    row.push(("bits_per_raw_sample", Str(bits.to_string())));
                }
                if container == "wav" && optional {
                    row.insert(3, ("profile", Str("unknown".into())));
                    if self.channel_mask == 0 {
                        let index = row.iter().position(|(key, _)| *key == "bits_per_sample").unwrap();
                        row.insert(index, ("channel_layout", Str("unknown".into())));
                    }
                    for (before, key) in [("r_frame_rate", "id"), ("duration_ts", "start_pts"), ("duration_ts", "start_time")] {
                        let index = row.iter().position(|(key, _)| *key == before).unwrap();
                        row.insert(index, (key, Str("N/A".into())));
                    }
                    let index = row.iter().position(|(key, _)| *key == "bit_rate").unwrap() + 1;
                    row.insert(index, ("max_bit_rate", Str("N/A".into())));
                    if !row.iter().any(|(key, _)| *key == "bits_per_raw_sample") { row.push(("bits_per_raw_sample", Str("N/A".into()))); }
                    row.push(("nb_frames", Str("N/A".into())));
                }
                if counts.0 && frames > 0 { row.push(("nb_read_frames", Str(frames.to_string()))); }
                else if container == "wav" && optional { row.push(("nb_read_frames", Str("N/A".into()))); }
                if counts.1 && packets > 0 { row.push(("nb_read_packets", Str(packets.to_string()))); }
                else if container == "wav" && optional { row.push(("nb_read_packets", Str("N/A".into()))); }
                if container == "wav" {
                    let mut disposition = super::media_probe::disposition(false);
                    disposition.extend(["non_diegetic", "captions", "descriptions", "metadata", "dependent", "still_image"].map(|key| (key.into(), Number(0., None))));
                    row.push(("disposition", Object(disposition)));
                }
                Box::new(std::iter::once(row))
            }
            "format" if self.raw.is_some() => {
                let name = self.raw.unwrap().name();
                let format = if container == "ircam" {
                    ("ircam", "Berkeley/IRCAM/CARL Sound Format")
                } else if container == "voc" { ("voc", "Creative Voice")
                } else if container == "nistsphere" {
                    ("nistsphere", "NIST SPeech HEader REsources")
                } else { (name.as_str(), "QuickTime / MOV") };
                let mut row = format_row(
                    filename,
                    bytes,
                    format,
                    1,
                    duration,
                    tags.iter().map(|(k, v)| (k.clone(), Str(v.clone()))).collect(),
                );
                row.insert(3, ("nb_stream_groups", Number(0., None)));
                Box::new(std::iter::once(row))
            }
            "format" => {
                let mut row = format_row(
                    filename,
                    bytes,
                    if container == "wav" { ("wav", "WAV / WAVE (Waveform Audio)") } else { ("w64", "Sony Wave64") },
                    1,
                    duration,
                    Vec::new(),
                );
                row.retain(|(k, _)| !matches!(*k, "start_time" | "tags"));
                if container == "wav" {
                    row.insert(3, ("nb_stream_groups", Number(0., None)));
                    if optional { row.insert(6, ("start_time", Str("N/A".into()))); }
                    if let Some((_, value)) = row.iter_mut().find(|(k, _)| *k == "probe_score") { *value = Number(99., None); }
                    if !tags.is_empty() { row.push(("tags", Object(tags.iter().map(|(k, v)| (k.clone(), Str(v.clone()))).collect()))); }
                }
                if let Some((_, value)) = row.iter_mut().find(|(k, _)| *k == "bit_rate") {
                    *value = Str(if duration > 0. {
                        (bytes as f64 * 8. / duration).floor().to_string()
                    } else {
                        "0".into()
                    });
                }
                Box::new(std::iter::once(row))
            }
            "packet" | "frame" | "packet_frame" if enabled => {
                let combined = section == "packet_frame";
                let count = if combined {
                    packets * 2
                } else if section == "frame" {
                    frames
                } else {
                    packets
                };
                Box::new((0..count).map(move |i| {
                    let frame = section == "frame" || combined && i % 2 == 1;
                    let i = if combined { i / 2 } else { i };
                    let offset = if self.packets.is_empty() { i * packet_size } else { 0 };
                    let packet = self.packets.get(i);
                    let size = packet.map_or_else(|| packet_size.min(self.data.len() - offset), |packet| packet.size);
                    let samples = size / stride;
                    let pts = packet.map_or((offset / stride) as u64, |packet| packet.pts);
                    let time = format!("{:.6}", pts as f64 / f64::from(self.rate));
                    let duration = format!("{:.6}", samples as f64 / f64::from(self.rate));
                    let pos = packet.map_or(self.data_pos + offset, |packet| packet.pos).to_string();
                    let mut row = if frame {
                        let mut row = vec![
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
                            ("pkt_pos", Str(pos)),
                            ("pkt_size", Str(size.to_string())),
                            ("sample_fmt", Str(sample_fmt.into())),
                            ("nb_samples", Number(samples as f64, None)),
                            ("channels", Number(self.channels as f64, None)),
                        ];
                        if container == "wav" {
                            row.retain(|(key, _)| !matches!(*key, "pkt_duration" | "pkt_duration_time"));
                            if let Some(layout) = super::audio_remix::describe_layout(self.channel_mask) { row.push(("channel_layout", Str(layout))); }
                            else if optional { row.push(("channel_layout", Str("unknown".into()))); }
                        }
                        if self.raw.is_some() {
                            row.retain(|(key, _)| {
                                !matches!(*key, "duration" | "duration_time" | "pkt_pos")
                            });
                        }
                        row
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
                            ("pos", Str(pos)),
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

    pub fn stride(&self) -> usize {
        (self.channels * usize::from(self.bits / 8)).max(1)
    }
    fn write_sample(
        &self,
        frame: usize,
        ch: usize,
        encoding: Format,
        vectorized: bool,
        output: &mut [u8],
    ) {
        let pos = frame * self.stride() + ch * usize::from(self.bits / 8);
        encoding.convert(self.format(), &self.data[pos..], vectorized, output);
    }
    pub(super) fn sample(&self, frame: usize, ch: usize) -> f32 {
        let pos = frame * self.stride() + ch * usize::from(self.bits / 8);
        self.format().sample(&self.data[pos..]) as f32
    }
}
pub(super) enum Input<'a> {
    Wave(Wave<'a>),
    Generated {
        frequency: f64,
        rate: u32,
        channels: usize,
        duration: f64,
    },
}
impl<'a> Input<'a> {
    pub fn parse(kind: &str, bytes: &'a [u8]) -> Result<Option<Self>, &'static str> {
        if matches!(kind, "wav" | "w64") {
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
        if opts.strip_audio || super::mp4::mux::select_tracks(opts.maps, 1, |_| 1, |_, _| "audio")?.len() != 1 {
            return Err(super::ffmpeg_pcm::STREAMS_ERROR.into());
        }
        if seek.loops > 0 && matches!(self, Self::Generated { .. }) {
            return Err("Generated audio does not support loop seeking".into());
        }
        if let Self::Wave(w)=self && matches!(w.tag,2|17|32|69) {
            if opts.audio_codec==Some("copy") {
                if seek.start.is_some() || seek.end().is_some() || seek.loops>0 || opts.start.is_some() || opts.end.is_some() {return Err("ADPCM packet-copy seeking is not supported".into());}
                return super::adpcm_wav::write(w.fmt,w.data,super::adpcm_wav::frames(*w)? as u64,opts);
            }
            let mut seek=seek;
            let pcm=if w.tag==69 {
                let block=usize::from(w.block_align).max(1);
                let byte_rate=u32::from_le_bytes(w.fmt[8..12].try_into().unwrap()) as f64;
                let offset=seek.start.map_or(0,|start|((start*byte_rate/block as f64).floor().max(0.) as usize).saturating_mul(block)).min(w.data.len());
                let time=(offset as f64*8./f64::from(w.bits)).round()/f64::from(w.rate);
                seek.start=seek.start.map(|start|(start-time).max(0.));
                seek.to=seek.to.map(|end|(end-time).max(0.));
                super::adpcm_wav::frames(*w)?;
                let pcm=super::g726::decode(w.data,w.bits as u8,false,super::adpcm_wav::packet_size(*w)?,seek.loops,offset,opts.limit)?;
                seek.loops=0;
                pcm
            } else {super::adpcm_wav::decode(*w,opts.limit)?};
            if matches!(w.tag,2|17) && let Some(start)=seek.start {
                let byte_rate=u32::from_le_bytes(w.fmt[8..12].try_into().unwrap());
                if byte_rate>0 {
                    // WAV input seeking uses the advertised byte rate, then aligns
                    // down to a compressed block. Accurate seeking discards the
                    // remaining timestamp offset after decoding that block.
                    let tick=(start*f64::from(w.rate)).round().max(0.) as u64;
                    let blocks=(tick*u64::from(byte_rate)/u64::from(w.rate)/u64::from(w.block_align)) as usize;
                    let packet_time=(blocks as f64*f64::from(w.block_align)*f64::from(w.rate)/f64::from(byte_rate)).round() as u64;
                    let block_frames=super::adpcm_wav::frames(Wave {data:&w.data[..w.data.len().min(usize::from(w.block_align))],..*w})?;
                    let position=blocks.saturating_mul(block_frames).saturating_add(tick.saturating_sub(packet_time) as usize);
                    let adjusted=position as f64/f64::from(w.rate);
                    seek.start=Some(adjusted);seek.to=seek.to.map(|end|end+adjusted-start);
                }
            }
            return Input::Wave(Wave::raw(Format::Signed(16,false),&pcm,w.rate,w.channels as u32)?).render(seek,&Remux {limit:opts.limit.saturating_sub(pcm.capacity()),hls:None,concat:None,..*opts});
        }
        if matches!(opts.audio_codec,Some("adpcm_ima_wav"|"adpcm_ms"|"adpcm_yamaha"|"g726")) {
            let (rate,channels)=match self {Self::Wave(w)=>(w.rate,w.channels),Self::Generated{rate,channels,..}=>(*rate,*channels as usize)};
            let pcm=self.render(seek,&Remux {format:"s16le",audio_codec:Some("pcm_s16le"),hls:None,concat:None,..*opts})?;
            return super::adpcm_wav::encode(&pcm,opts.rate.unwrap_or(rate),opts.channels.map_or(channels,|c|c as usize),&Remux {limit:opts.limit.saturating_sub(pcm.capacity()),hls:None,concat:None,..*opts});
        }
        if opts.audio_codec == Some("copy")
            && let Self::Wave(w) = self
        {
            let source = w.format();
            if let Some(raw) = Format::parse(opts.format) {
                let expected = if raw == Format::Vidc {
                    Format::Mulaw
                } else {
                    raw
                };
                if source != expected {
                    return Err(format!(
                        "{} muxer supports only codec pcm_{}",
                        opts.format,
                        expected.name()
                    ));
                }
            } else if opts.format=="caf" {
                super::caf::encoding(&format!("pcm_{}",source.name()))?;
            } else if opts.format=="au" {
                super::au::encoding(source)?;
            } else if opts.format=="voc" {
                super::voc::encoding(source)?;
            } else if opts.format=="aiff" {
                super::aiff::encoding(&format!("pcm_{}",source.name()))?;
            } else if opts.format=="ircam" {
                super::ircam::encoding(source)?;
            } else if source.wave_encoding().is_none() {
                return Err("Unsupported PCM codec in WAV".into());
            }
            let stride = w.stride();
            let clock = |s: f64| (s.max(0.) * f64::from(w.rate)).round() as usize;
            let start = seek.start.map_or(0, clock).min(w.data.len() / stride);
            let from = opts.start.map_or(0, clock);
            let end = opts.end.map(clock).unwrap_or(usize::MAX);
            let mut data = Vec::new();
            let (mut max_pts, mut last_duration, mut first_pts) = (0usize, 0usize, None);
            if !w.packets.is_empty() {
                let copies=seek.loops.checked_add(1).ok_or("audio output exceeds memory budget")?;
                copies.checked_mul(w.packets.len()).filter(|&n|n<=opts.limit/size_of::<Packet>())
                    .ok_or("audio packet traversal exceeds memory budget")?;
                let input_end=seek.end().map(clock).unwrap_or(usize::MAX);
                let mut tick=0usize;
                for _ in 0..copies {
                    let mut offset=0;
                    let mut first=true;
                    for packet in w.packets {
                        let duration=packet.size/stride;
                        let pts=packet.pts as usize;
                        let keep=(seek.start.is_none() || pts.saturating_add(duration)>start) && pts<input_end;
                        if keep {
                            if first { tick=tick.saturating_add(pts.saturating_sub(start)); first=false; }
                            if tick>=from && tick<end {
                                if data.len().saturating_add(packet.size)>opts.limit { return Err("audio output exceeds memory budget".into()); }
                                data.extend_from_slice(&w.data[offset..offset+packet.size]);
                            }
                            tick=tick.saturating_add(duration);
                        }
                        offset+=packet.size;
                    }
                    if tick>=end { break; }
                }
            } else {
                let input_end = seek.end().map(|time| ((time - seek.start.unwrap_or(0.)) * f64::from(w.rate)).round() as i128);
                for packet in w.input_packets(seek, opts.limit.saturating_mul(8)) {
                    let (range, pts) = packet?;
                    if input_end.is_some_and(|end| pts >= end) || pts >= end as i128 { break; }
                    if first_pts.is_none() && opts.start.is_some() && pts < from as i128 { continue; }
                    let needed = data.len().checked_add(range.len()).filter(|&n| n <= opts.limit)
                        .ok_or("audio output exceeds memory budget")?;
                    data.try_reserve_exact(needed - data.len()).map_err(|_| "audio output exceeds memory budget")?;
                    let pts = (pts - from as i128).max(0) as usize;
                    first_pts.get_or_insert(pts);
                    max_pts = max_pts.max(pts);
                    last_duration = range.len() / stride;
                    data.extend_from_slice(&w.data[range]);
                }
            }
            if Format::parse(opts.format).is_some() {
                return Ok(data);
            }
            if opts.format=="caf" { return super::caf::write(&format!("pcm_{}",source.name()),(w.rate,w.channels,w.channel_mask),&data,None,opts); }
            if opts.format=="au" { return super::au::write(super::au::encoding(source)?,w.rate,w.channels,&data,opts); }
            if opts.format=="voc" { return super::voc::write(source,w.rate,w.channels,&data,opts.limit); }
            if opts.format=="aiff" { return super::aiff::write(&format!("pcm_{}",source.name()),w.rate,w.channels,&data,opts); }
            if opts.format=="ircam" { return super::ircam::write(source,w.rate,w.channels,&data,opts.limit); }
            let mut output = pcm_header(
                w.rate,
                w.channels,
                (data.len(), if w.packets.is_empty() { max_pts + last_duration - if opts.format == "w64" { 0 } else { first_pts.unwrap_or(0) } } else { data.len() / stride }),
                if w.channel_order.is_empty() { (w.channel_mask != 0).then_some(w.channel_mask) } else { Some(0) },
                source.wave_encoding().unwrap(),
                opts,
            )?;
            output.extend_from_slice(&data);
            output.resize(
                output
                    .len()
                    .next_multiple_of(if opts.format == "w64" && !opts.stdout {
                        8
                    } else {
                        2
                    }),
                0,
            );
            return Ok(output);
        }
        if let Self::Wave(w) = self && seek.loops > 0 && w.frames.is_empty() && w.packets.is_empty() {
            let (data, frames) = w.loop_pcm(seek, opts.limit)?;
            let limit = opts.limit.saturating_sub(data.capacity() + frames.capacity() * size_of::<Frame>());
            let wave = Wave { data: &data, frames: &frames, raw: Some(w.format()), ..*w };
            return Input::Wave(wave).render(InputTime::default(), &Remux { limit, hls: None, concat: None, ..*opts });
        }
        let (rate, channels, decoded, mut ticks) = match self {
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
        let repeat_from_start = copies > 1 && from > 0 && seek.end().is_none() && matches!(self, Self::Wave(_));
        let extent = if repeat_from_start {
            decoded.checked_mul(copies - 1).and_then(|n| n.checked_add(len)).ok_or("audio output exceeds memory budget")?
        } else if copies > 1 { total_ticks } else { len };
        let source_frame = |src: usize| {
            if repeat_from_start && src >= len && decoded > 0 { ((src - len) % decoded, 0, decoded) }
            else { (if copies > 1 && ticks > 0 { src % ticks } else { src }, from, len) }
        };
        let timed = matches!(self, Self::Wave(w) if !w.frames.is_empty()) && seek.loops == 0 && !cut;
        let from_out = if timed { 0 } else { opts.start.map_or(0, clock).min(extent) };
        let mut count = extent;
        if !timed && (opts.start.is_some() || opts.end.is_some() || opts.shortest) {
            count = opts
                .end
                .map_or(total_ticks, clock)
                .min(extent)
                .saturating_sub(from_out);
        }
        let track_ticks = if opts.start.is_some() || opts.end.is_some() || opts.shortest {
            count
        } else {
            total_ticks
        };
        let target_rate = opts.rate.unwrap_or(rate);
        let out_ch = opts.channels.map_or(channels, |v| v as usize);
        let mut filtered = target_rate != rate || out_ch != channels;
        let mut volume = 1.;
        let (mut tempo, mut reverse) = (1., false);
        for item in opts
            .audio_filters
            .iter()
            .flat_map(|f| f.split(','))
            .map(str::trim)
        {
            if item == "anull" {
                continue;
            }
            if item == "areverse" {
                reverse = !reverse;
                continue;
            }
            filtered = true;
            if let Some(v) = item.strip_prefix("volume=") {
                volume *= if let Some(db) = v.trim().strip_suffix("dB") {
                    10f64.powf(db.parse::<f64>().unwrap_or(0.) / 20.)
                } else {
                    v.trim()
                        .parse::<f64>()
                        .ok()
                        .filter(|v| v.is_finite())
                        .unwrap_or(1.)
                }
            } else if let Some(v) = item.strip_prefix("atempo=") {
                tempo *= v
                    .parse::<f64>()
                    .ok()
                    .filter(|&v| v != 0.)
                    .unwrap_or(1.)
                    .clamp(0.25, 4.);
            }
        }
        let mask = if opts.channels.is_some() { super::audio_remix::default_mask(out_ch) } else { match self {
            Self::Wave(w) if out_ch == w.channels => w.channel_mask,
            _ => 0,
        } };
        let au_code=if opts.format=="au" {
            Some(match opts.audio_codec.unwrap_or("pcm_s16be") {
                "g726le"=>{
                    if out_ch!=1 || target_rate!=8000 { return Err("G.726 requires mono audio at 8000 Hz".into()); }
                    if opts.audio_bitrate.is_some_and(|s| !matches!(s,"32000"|"32k"|"32K")) { return Err("AU G.726 encoding requires a 32000 bit/s bitrate".into()); }
                    23
                }
                "g722"=>{if out_ch!=1 {return Err("G.722 requires mono audio".into());}24}
                codec=>super::au::encoding(Format::parse(codec.strip_prefix("pcm_").unwrap_or("")).ok_or_else(||format!("Unsupported AU audio codec '{codec}'"))?)?,
            })
        }else{None};
        let encoding = if opts.format == "caf" {
            super::caf::encoding(opts.audio_codec.unwrap_or("pcm_s16be"))?
        } else if opts.format == "aiff" {
            super::aiff::encoding(opts.audio_codec.unwrap_or("pcm_s16be"))?
        } else if opts.format == "voc" {
            let codec=opts.audio_codec.unwrap_or("pcm_s16le");
            let format=Format::parse(codec.strip_prefix("pcm_").unwrap_or("")).ok_or_else(||format!("Unsupported VOC audio codec '{codec}'"))?;
            super::voc::encoding(format)?;
            format
        } else if opts.format == "ircam" {
            let codec = opts.audio_codec.unwrap_or("pcm_s16le");
            let format = Format::parse(codec.strip_prefix("pcm_").unwrap_or("")).ok_or_else(||format!("Unsupported IRCAM audio codec '{codec}'"))?;
            super::ircam::encoding(format)?;
            format
        } else if let Some(code)=au_code { super::au::pcm(code).unwrap_or(Format::Signed(16,false)) } else if opts.audio_codec == Some("copy") {
            match self {
                Self::Wave(w) => w.format(),
                _ => return Err("PCM stream copy requires a PCM source".into()),
            }
        } else {
            if let Some(raw) = Format::parse(opts.format) {
                let default = if raw == Format::Vidc {
                    Format::Mulaw
                } else {
                    raw
                };
                match opts.audio_codec {
                    Some(codec) => Format::parse(codec.strip_prefix("pcm_").unwrap_or(""))
                        .filter(|f| *f == default)
                        .ok_or_else(|| {
                            format!(
                                "{} muxer supports only codec pcm_{}",
                                opts.format,
                                default.name()
                            )
                        })?,
                    None => default,
                }
            } else {
                let (tag, bits) = encoding(opts.audio_codec)?;
                Format::wave(tag, bits)
            }
        };
        let order = match self { Self::Wave(w) => w.channel_order, _ => &[] };
        let input_mask = if opts.channels.is_some() && !order.is_empty() {
            order.iter().try_fold(0u32, |mask, &speaker| {
                let bit = 1u32.checked_shl(u32::from(speaker)).ok_or("Unsupported PCM channel layout")?;
                if mask & bit != 0 { return Err("Duplicate PCM speakers cannot be mixed"); }
                Ok(mask | bit)
            })?
        } else { match self {
            Self::Wave(w) if w.channel_mask == 0x60000000 => 3,
            Self::Wave(w) if w.channel_mask!=0=>w.channel_mask,
            _=>super::audio_remix::default_mask(channels),
        }};
        let remix=if opts.channels.is_some() && (!order.is_empty() || channels>2 || input_mask!=super::audio_remix::default_mask(channels) || matches!(encoding,Format::Float(32,_))) && (!order.is_empty() || channels!=out_ch || input_mask!=mask) {
            if input_mask.count_ones() as usize!=channels {
                return Err("Invalid PCM channel layout".into());
            }
            let mut weights = super::audio_remix::matrix(input_mask,mask,!matches!(encoding,Format::Float(..)))?;
            if !order.is_empty() {
                for row in &mut weights {
                    let canonical = *row;
                    for (column, &speaker) in order.iter().enumerate() {
                        row[column] = canonical[(input_mask & ((1u32 << speaker) - 1)).count_ones() as usize];
                    }
                }
            }
            Some(weights)
        } else {None};
        filtered |= remix.is_some();
        let mut audio_work = opts.limit.saturating_mul(8);
        let processed_double = if let Self::Wave(w) = self && matches!(w.format(), Format::Float(64, _) | Format::Signed(64, _)) && filtered && tempo == 1.
            && opts.audio_filters.iter().flat_map(|f| f.split(',')).all(|f| matches!(f.trim(), "anull" | "areverse")) {
            count.checked_mul(channels).and_then(|n| n.checked_mul(8))
                .and_then(|n| n.checked_add(channels * size_of::<Vec<f64>>()))
                .filter(|&n| n <= opts.limit).ok_or("audio conversion exceeds memory budget")?;
            let mut pcm = vec![vec![0.; count]; channels];
            for (ch, channel) in pcm.iter_mut().enumerate() {
                for (i, value) in channel.iter_mut().enumerate() {
                    let (src, from, len) = source_frame(from_out + i);
                    if src < len { *value = w.format().sample(&w.data[(from + src) * w.stride() + ch * 8..]); }
                }
            }
            let weights = if remix.is_none() && channels != out_ch {
                Some(super::audio_remix::matrix(input_mask, mask, !matches!(encoding, Format::Float(..)))?)
            } else { remix };
            let resample_first = weights.is_none() || ((out_ch / channels) as f64) < f64::from(target_rate) / f64::from(rate);
            if target_rate != rate && resample_first { pcm = super::audio_resample::resample_f64(&pcm, rate, target_rate, opts.limit, &mut audio_work)?; }
            if let Some(weights) = &weights {
                audio_work = audio_work.checked_sub(pcm[0].len().saturating_mul(channels).saturating_mul(out_ch)).ok_or("audio mixing work limit exceeded")?;
                pcm = super::audio_remix::mix_f64(&pcm, weights, out_ch, out_ch == 2 && order.is_empty() && matches!(input_mask, 0x3f | 0x60f | 0x63f), opts.limit)?;
            }
            if target_rate != rate && !resample_first { pcm = super::audio_resample::resample_f64(&pcm, rate, target_rate, opts.limit, &mut audio_work)?; }
            Some(pcm)
        } else { None };
        let processed = if processed_double.is_none() && let Self::Wave(w) = self && (w.raw.is_some() || remix.is_some()) && filtered && tempo == 1. {
            count.checked_mul(channels).filter(|&n| n <= opts.limit / 4)
                .ok_or("audio conversion exceeds memory budget")?;
            let mut pcm = vec![vec![0f32; count]; channels];
            for (ch, channel) in pcm.iter_mut().enumerate() {
                for (i, value) in channel.iter_mut().enumerate() {
                    let (src, from, len) = source_frame(from_out + i);
                    if src < len { *value = (f64::from(w.sample(from + src, ch)) * volume) as f32; }
                }
            }
            let resample_first=remix.is_none() && out_ch == channels || ((out_ch/channels) as f32) < target_rate as f32/rate as f32;
            if target_rate != rate && resample_first { pcm = super::audio_resample::resample(&pcm, rate, target_rate, opts.limit, &mut audio_work)?; }
            let integer_mix = target_rate == rate && opts.audio_filters.is_empty()
                && matches!(w.format(), Format::Signed(16, _) | Format::Unsigned(16, _))
                && matches!(encoding, Format::Signed(16, _) | Format::Unsigned(16, _));
            if let Some(weights)=&remix {
                pcm=super::audio_remix::mix(&pcm,weights,out_ch,integer_mix,
                    out_ch==2 && order.is_empty() && matches!(input_mask,0x3f|0x60f|0x63f),opts.limit)?;
            } else if channels == 2 && out_ch == 1 {
                let right = pcm.pop().unwrap();
                // Front-center/LFE downmix keeps the center and discards LFE.
                if w.channel_mask != 12 {
                    for (left, right) in pcm[0].iter_mut().zip(right) {
                        *left = if integer_mix { ((*left + right) * 16384. + 0.5).floor() / 32768. }
                            else if opts.format=="aiff" || matches!(w.channel_mask, 0 | 3) { (*left+right)*0.5 } else { (*left + right) * std::f32::consts::FRAC_1_SQRT_2 };
                    }
                }
            } else if channels == 1 && matches!(out_ch, 2 | 3) {
                pcm[0].len().checked_mul(out_ch).filter(|&n| n <= opts.limit / 4)
                    .ok_or("audio conversion exceeds memory budget")?;
                for sample in &mut pcm[0] {
                    *sample = if integer_mix { ((((*sample * 32768.) as i64 * 23170 + 16384) >> 15) as f32) / 32768. }
                        else { *sample * std::f32::consts::FRAC_1_SQRT_2 };
                }
                pcm.push(pcm[0].clone());
                if out_ch == 3 { pcm.push(vec![0.; pcm[0].len()]); }
            } else if channels <= 2 && (3..=8).contains(&out_ch) {
                let frames = pcm[0].len();
                frames.checked_mul(out_ch).filter(|&n| n <= opts.limit / 4)
                    .ok_or("audio conversion exceeds memory budget")?;
                if channels == 1 {
                    // Layouts with a front-center channel keep mono there.
                    pcm.insert(0, vec![0.; frames]);
                    pcm.insert(0, vec![0.; frames]);
                }
                pcm.resize_with(out_ch, || vec![0.; frames]);
            } else if channels != out_ch {
                return Err("PCM conversion between these channel layouts is not supported".into());
            }
            if target_rate != rate && !resample_first {
                let limit = opts.limit.saturating_sub((pcm.capacity() - pcm.len()) * size_of::<Vec<f32>>());
                pcm = super::audio_resample::resample(&pcm, rate, target_rate, limit, &mut audio_work)?;
            }
            Some(pcm)
        } else { None };
        let frames = if let Some(pcm) = &processed_double { pcm.first().map_or(0, Vec::len) }
        else if let Some(pcm) = &processed { pcm.first().map_or(0, Vec::len) } else if filtered {
            (track_ticks as f64 / f64::from(rate) / tempo * f64::from(target_rate)).round() as usize
        } else {
            count
        };
        let untrimmed_frames = frames;
        let timed_wave = match self { Self::Wave(w) if timed => Some(*w), _ => None };
        let frames = timed_wave.map_or(frames, |w| w.output_frames(target_rate, frames, opts.start, opts.end).map(|(range, _)| range.len()).sum());
        let mut indices = timed_wave.into_iter().flat_map(|w| w.output_frames(target_rate, untrimmed_frames, opts.start, opts.end)).flat_map(|(range, _)| range);
        let width = usize::from(encoding.bits() / 8);
        if matches!(self, Self::Wave(w) if w.raw.is_some() && !w.data.is_empty() && w.data.len() < w.stride())
        {
            return Err("Incomplete raw audio sample frame".into());
        }
        let (mut out, offset) = if au_code.is_some() || matches!(opts.format, "caf" | "aiff" | "ircam" | "voc") {
            let size=frames.checked_mul(out_ch).and_then(|n|n.checked_mul(width)).filter(|&n|n<=opts.limit).ok_or("audio output exceeds memory budget")?;
            (vec![0;size],0)
        } else if let Some(raw) = Format::parse(opts.format) {
            let expected = if raw == Format::Vidc {
                Format::Mulaw
            } else {
                raw
            };
            if encoding != expected {
                return Err(format!(
                    "{} muxer supports only codec pcm_{}",
                    opts.format,
                    expected.name()
                ));
            }
            let size = frames
                .checked_mul(out_ch)
                .and_then(|n| n.checked_mul(width))
                .filter(|&n| n <= opts.limit)
                .ok_or("audio output exceeds memory budget")?;
            (vec![0; size], 0)
        } else {
            pcm(
                target_rate,
                out_ch,
                frames,
                if opts.channels.is_none() && !order.is_empty() { Some(0) } else { (mask != 0).then_some(mask) },
                encoding
                    .wave_encoding()
                    .ok_or("Unsupported PCM codec in WAV")?,
                opts,
            )?
        };
        for (output_frame, frame) in out[offset..offset + frames * out_ch * width]
            .chunks_exact_mut(out_ch * width)
            .enumerate()
        {
            let selected_frame = if timed { indices.next().unwrap() } else { output_frame };
            let i = if reverse { untrimmed_frames - 1 - selected_frame } else { selected_frame };
            let index = if filtered {
                ((i as f64 / untrimmed_frames as f64 * count as f64) as usize).min(count.saturating_sub(1))
            } else {
                i
            };
            let (src, from, len) = source_frame(from_out.saturating_add(index));
            for (ch, sample) in frame.chunks_exact_mut(width).enumerate() {
                if let Some(pcm) = &processed_double {
                    encoding.write_float(pcm[ch][i], sample);
                    continue;
                }
                if let Some(pcm) = &processed {
                    encoding.write_float(f64::from(pcm[ch][i]), sample);
                    continue;
                }
                if !filtered
                    && src < len
                    && let Self::Wave(w) = self
                {
                    let packet_frames = w.packet_frames();
                    let tail = len % packet_frames;
                    let (packet_frame, packet_len) = if reverse && tail > 0 {
                        if output_frame < tail {
                            (output_frame, tail)
                        } else {
                            ((output_frame - tail) % packet_frames, packet_frames)
                        }
                    } else {
                        (
                            src % packet_frames,
                            len.saturating_sub(src / packet_frames * packet_frames)
                                .min(packet_frames),
                        )
                    };
                    w.write_sample(
                        from + src,
                        ch.min(channels - 1),
                        encoding,
                        packet_frame < packet_len / 16 * 16,
                        sample,
                    );
                    continue;
                }
                let v = if src >= len {
                    0.
                } else {
                    match self {
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
                if encoding == Format::Signed(16, false) {
                    sample.copy_from_slice(
                        &((v.clamp(-1., 1.) * 32767. + 0.5).floor() as i16).to_le_bytes(),
                    );
                } else {
                    encoding.write_float(v, sample);
                }
            }
        }
        if let Some(code)=au_code {
            let encoded;
            let data=match code {
                23=>{encoded=super::g726::encode(&out,4,true,opts.limit.saturating_sub(out.len()))?;encoded.as_slice()}
                24=>{encoded=super::g722::encode(&out,opts.limit.saturating_sub(out.len()))?;encoded.as_slice()}
                _=>out.as_slice(),
            };
            return super::au::write(code,target_rate,out_ch,data,opts);
        }
        if opts.format == "caf" { return super::caf::write(opts.audio_codec.unwrap_or("pcm_s16be"),(target_rate,out_ch,mask),&out,None,opts); }
        if opts.format == "voc" { return super::voc::write(encoding,target_rate,out_ch,&out,opts.limit); }
        if opts.format == "aiff" { return super::aiff::write(opts.audio_codec.unwrap_or("pcm_s16be"),target_rate,out_ch,&out,opts); }
        if opts.format == "ircam" { return super::ircam::write(encoding,target_rate,out_ch,&out,opts.limit); }
        Ok(out)
    }
}

pub(super) fn encoding(codec: Option<&str>) -> Result<(u16, u16), String> {
    match codec.unwrap_or("pcm_s16le") {
        "pcm_u8" => Ok((1, 8)),
        "pcm_s16le" | "copy" => Ok((1, 16)),
        "pcm_s24le" => Ok((1, 24)),
        "pcm_s32le" => Ok((1, 32)),
        "pcm_f32le" => Ok((3, 32)),
        "pcm_f64le" => Ok((3, 64)),
        name => Err(format!("Unsupported PCM output codec: {name}")),
    }
}

pub(super) fn pcm(
    target_rate: u32,
    out_ch: usize,
    frames: usize,
    channel_mask: Option<u32>,
    encoding: (u16, u16),
    opts: &Remux,
) -> Result<(Vec<u8>, usize), String> {
    let size = frames
        .checked_mul(out_ch)
        .and_then(|n| n.checked_mul(usize::from(encoding.1 / 8)))
        .ok_or("audio output exceeds memory budget")?;
    let mut out = pcm_header(target_rate, out_ch, (size, frames), channel_mask, encoding, opts)?;
    let offset = out.len();
    let total = offset + size;
    let alignment = if opts.format == "w64" {
        if opts.stdout { 1 } else { 8 }
    } else {
        2
    };
    out.resize(total.next_multiple_of(alignment), 0);
    if encoding == (1, 8) {
        out[offset..offset + size].fill(128);
    }
    Ok((out, offset))
}

fn pcm_header(
    target_rate: u32,
    out_ch: usize,
    (size, ticks): (usize, usize),
    channel_mask: Option<u32>,
    (tag, bits): (u16, u16),
    opts: &Remux,
) -> Result<Vec<u8>, String> {
    let align = out_ch
        .checked_mul(usize::from(bits / 8))
        .filter(|&a| a > 0 && a <= u16::MAX.into())
        .ok_or("invalid audio channel count")?;
    let w64 = opts.format == "w64";
    let extensible = out_ch > 2
        || target_rate > 48000
        || tag == 1 && bits > 16
        || !matches!(channel_mask.unwrap_or(0), 0 | 3 | 4);
    let fmt_size = if extensible {
        40
    } else if tag == 3 || !w64 && matches!(tag,6|7) && !opts.metadata.is_empty() {
        18
    } else {
        16
    };
    let fmt_padded = if w64 {
        (fmt_size + 7) / 8 * 8
    } else {
        fmt_size
    };
    let fact = tag != 1 && !opts.stdout;
    let mut info=Vec::new();
    if !w64 {
        for (key,tag) in [("artist",b"IART"),("comment",b"ICMT"),("copyright",b"ICOP"),("title",b"INAM"),("album",b"IPRD"),("encoder",b"ISFT")] {
            if let Some((_,value))=opts.metadata.iter().rev().find(|(k,v)|k==key&&!v.is_empty()) {
                if info.len().saturating_add(value.len()).saturating_add(10)>opts.limit {return Err("WAV metadata exceeds memory budget".into());}
                info.extend_from_slice(tag);info.extend_from_slice(&((value.len()+1) as u32).to_le_bytes());info.extend_from_slice(value.as_bytes());info.push(0);if info.len()%2!=0 {info.push(0);}
            }
        }
    }
    let info_size=if info.is_empty(){0}else{12+info.len()};
    let header = if w64 {
        40 + 24 + fmt_padded + if fact { 32 } else { 0 } + 24
    } else {
        12 + 8 + fmt_padded + if fact { 12 } else { 0 } + 8 + info_size
    };
    let alignment = if w64 {
        if opts.stdout { 1 } else { 8 }
    } else {
        2
    };
    let padded = size
        .checked_add(alignment - 1)
        .map(|n| n / alignment * alignment)
        .ok_or("audio output exceeds memory budget")?;
    if opts.limit < header
        || padded > opts.limit - header
        || !w64 && header + padded > u32::MAX as usize
    {
        return Err("audio output exceeds memory budget".into());
    }
    let byte_rate = target_rate
        .checked_mul(align as u32)
        .ok_or("invalid audio sample rate")?;
    let mut out = Vec::with_capacity(header + padded);
    if w64 {
        out.extend_from_slice(W64_RIFF);
        out.extend_from_slice(
            &(if opts.stdout {
                u64::MAX
            } else {
                (header + padded) as u64
            })
            .to_le_bytes(),
        );
        out.extend_from_slice(W64_WAVE);
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(W64_SUFFIX);
        out.extend_from_slice(&(24 + fmt_padded as u64).to_le_bytes());
    } else {
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(
            &(if opts.stdout {
                u32::MAX
            } else {
                (header + padded - 8) as u32
            })
            .to_le_bytes(),
        );
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&(fmt_size as u32).to_le_bytes());
    }
    out.extend_from_slice(&(if extensible { 0xfffe } else { tag }).to_le_bytes());
    out.extend_from_slice(&(out_ch as u16).to_le_bytes());
    out.extend_from_slice(&target_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&(align as u16).to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    if extensible {
        let mask = channel_mask.unwrap_or(match out_ch {
            1 => 4,
            2 => 3,
            3 => 7,
            4 => 0x107,
            5 => 0x37,
            6 => 0x3f,
            7 => 0x70f,
            8 => 0x63f,
            _ => 0,
        });
        let mask = if mask < 0x40000 { mask } else { 0 };
        out.extend_from_slice(&22u16.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(&mask.to_le_bytes());
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(b"\0\0\0\0\x10\0\x80\0\0\xaa\0\x38\x9b\x71");
    } else if fmt_size==18 {
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out.resize(out.len() + fmt_padded - fmt_size, 0);
    if fact {
        out.extend_from_slice(b"fact");
        if w64 {
            out.extend_from_slice(W64_SUFFIX);
            out.extend_from_slice(&32u64.to_le_bytes());
            out.extend_from_slice(&(ticks as u64).to_le_bytes());
        } else {
            out.extend_from_slice(&4u32.to_le_bytes());
            // Native WAV's empty-stream timestamp sentinel leaves one tick in
            // fact; the data chunk remains empty and decodes to no samples.
            out.extend_from_slice(&(ticks.max(1) as u32).to_le_bytes());
        }
    }
    if !info.is_empty() {out.extend_from_slice(b"LIST");out.extend_from_slice(&((info.len()+4) as u32).to_le_bytes());out.extend_from_slice(b"INFO");out.extend_from_slice(&info);}
    out.extend_from_slice(b"data");
    if w64 {
        out.extend_from_slice(W64_SUFFIX);
        out.extend_from_slice(
            &(if opts.stdout {
                i64::MAX as u64
            } else {
                24 + padded as u64
            })
            .to_le_bytes(),
        );
    } else {
        out.extend_from_slice(&(if opts.stdout { u32::MAX } else { size as u32 }).to_le_bytes());
    }
    Ok(out)
}
