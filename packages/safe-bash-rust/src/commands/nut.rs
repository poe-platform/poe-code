use super::{
    InputTime,
    ffmpeg_pcm::Format,
    ffmpeg_wave::{Input, Wave},
    mp4::mux::Remux,
};
use std::borrow::Cow;

pub(super) const SIGNATURE: &[u8] = b"nut/multimedia container\0";
const CODES: [u64; 5] = [
    0x4e4d7a561f5f04ad,
    0x4e5311405bf2f9db,
    0x4e4be4adeeca4569,
    0x4e49ab68b596ba78,
    0x4e58dd672f23e64e,
];

pub(super) struct Packet<'a> {
    pub data: Cow<'a, [u8]>,
    pub offset: usize,
    pub pts: i64,
    pub ticks: f64,
    pub key: bool,
}
pub(super) struct Track<'a> {
    pub format: Option<Format>,
    pub rate: u32,
    pub channels: u32,
    pub width: usize,
    pub height: usize,
    pub scale: u32,
    pub duration: f64,
    pub packets: Vec<Packet<'a>>,
    tag: [u8; 4],
    sar: (u32, u32),
    numerator: u32,
    shift: u32,
    last_pts: i64,
}
pub(super) struct Document<'a> {
    pub tracks: Vec<Track<'a>>,
}
#[derive(Clone, Copy, Default)]
struct FrameCode {
    flags: u64,
    delta: i64,
    mul: u64,
    stream: usize,
    size: u64,
    reserved: u64,
    header: usize,
}
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    end: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, size: usize) -> Result<&'a [u8], &'static str> {
        if size > self.end.saturating_sub(self.pos) {
            return Err("Invalid NUT data bounds");
        }
        let data = &self.bytes[self.pos..self.pos + size];
        self.pos += size;
        Ok(data)
    }
    fn v(&mut self) -> Result<u64, &'static str> {
        let mut value = 0u64;
        for _ in 0..8 {
            let byte = self.take(1)?[0];
            value = value
                .checked_mul(128)
                .and_then(|v| v.checked_add(u64::from(byte & 127)))
                .filter(|&n| n < 1 << 53)
                .ok_or("Invalid NUT integer")?;
            if byte < 128 {
                return Ok(value);
            }
        }
        Err("Invalid NUT integer")
    }
    fn size(&mut self) -> Result<usize, &'static str> {
        usize::try_from(self.v()?).map_err(|_| "Invalid NUT integer")
    }
    fn word(&mut self) -> Result<u32, &'static str> {
        u32::try_from(self.v()?).map_err(|_| "Invalid NUT integer")
    }
    fn s(&mut self) -> Result<i64, &'static str> {
        let v = self.v()? + 1;
        Ok(if v & 1 == 1 {
            -((v / 2) as i64)
        } else {
            (v / 2) as i64
        })
    }
}
fn checksum(bytes: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &byte in bytes {
        crc ^= u32::from(byte) << 24;
        for _ in 0..8 {
            crc = (crc << 1) ^ if crc & 0x80000000 != 0 { 0x04c11db7 } else { 0 };
        }
    }
    crc
}
impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if bytes.len() > limit {
            return Err("input byte limit exceeded");
        }
        if !bytes.starts_with(SIGNATURE) {
            return Err("Invalid NUT signature");
        }
        let mut reader = Reader {
            bytes,
            pos: SIGNATURE.len(),
            end: bytes.len(),
        };
        let mut bases = Vec::new();
        let mut codes = [FrameCode {
            flags: 8192,
            ..FrameCode::default()
        }; 256];
        let mut headers = vec![&[][..]];
        let mut streams: Vec<Option<Track>> = Vec::new();
        let mut remaining = limit;
        while reader.pos < bytes.len() {
            let start = reader.pos;
            if bytes[start] == b'N' {
                let code = u64::from_be_bytes(reader.take(8)?.try_into().unwrap());
                if !CODES.contains(&code) {
                    return Err("Invalid NUT startcode");
                }
                let length = reader.size()?;
                if length > 4096 {
                    reader.take(4)?;
                    if checksum(&bytes[start..reader.pos]) != 0 {
                        return Err("Invalid NUT header checksum");
                    }
                }
                if length < 4 || length > bytes.len() - reader.pos {
                    return Err("Invalid NUT header bounds");
                }
                let end = reader.pos + length;
                if checksum(&bytes[reader.pos..end]) != 0 {
                    return Err("Invalid NUT header checksum");
                }
                reader.end = end - 4;
                if code == CODES[0] && streams.is_empty() {
                    if reader.v()? != 3 {
                        return Err("Unsupported NUT version");
                    }
                    let count = reader.size()?;
                    if count == 0 || count > 32 || count > remaining / size_of::<Option<Track>>() {
                        return Err("Invalid NUT stream count");
                    }
                    remaining -= count * size_of::<Option<Track>>();
                    streams
                        .try_reserve_exact(count)
                        .map_err(|_| "NUT streams exceed memory budget")?;
                    streams.resize_with(count, || None);
                    reader.v()?;
                    let count = reader.size()?;
                    if count == 0 || count > (reader.end - reader.pos) / 2 || count > remaining / 8
                    {
                        return Err("Invalid NUT time bases");
                    }
                    remaining -= count * 8;
                    bases
                        .try_reserve_exact(count)
                        .map_err(|_| "NUT time bases exceed memory budget")?;
                    for _ in 0..count {
                        let num = reader.word()?;
                        let den = reader.word()?;
                        if num == 0 || den == 0 || num >= 1 << 31 || den >= 1 << 31 {
                            return Err("Invalid NUT time base");
                        }
                        bases.push((num, den));
                    }
                    let (mut delta, mut mul, mut stream, mut header) = (0, 1, 0, 0);
                    let mut i = 0;
                    while i < 256 {
                        let flags = reader.v()?;
                        let fields = reader.v()?;
                        if fields > 0 {
                            delta = reader.s()?;
                        }
                        if fields > 1 {
                            mul = reader.v()?;
                        }
                        if fields > 2 {
                            stream = reader.size()?;
                        }
                        let size = if fields > 3 { reader.v()? } else { 0 };
                        let reserved = if fields > 4 { reader.v()? } else { 0 };
                        let count = if fields > 5 {
                            reader.v()?
                        } else {
                            mul.checked_sub(size).ok_or("Invalid NUT frame table")?
                        };
                        if fields > 6 {
                            reader.s()?;
                        }
                        if fields > 7 {
                            header = reader.size()?;
                        }
                        for _ in 8..fields {
                            reader.v()?;
                        }
                        if count == 0
                            || count > (256 - i - usize::from(i <= 78)) as u64
                            || stream >= streams.len()
                        {
                            return Err("Invalid NUT frame table");
                        }
                        let mut j = 0;
                        while j < count {
                            if i != 78 {
                                codes[i] = FrameCode {
                                    flags,
                                    delta,
                                    mul,
                                    stream,
                                    size: size.checked_add(j).ok_or("Invalid NUT frame table")?,
                                    reserved,
                                    header,
                                };
                                j += 1;
                            }
                            i += 1;
                        }
                    }
                    if reader.pos < reader.end {
                        let count = reader.size()?;
                        if count >= 128 {
                            return Err("Invalid NUT elision headers");
                        }
                        let mut total = 0;
                        for _ in 0..count {
                            let n = reader.size()?;
                            total += n;
                            if n == 0 || n >= 256 || total > 1024 {
                                return Err("Invalid NUT elision header");
                            }
                            headers.push(reader.take(n)?);
                        }
                    }
                } else if code == CODES[1] {
                    let id = reader.size()?;
                    let kind = reader.v()?;
                    if id >= streams.len() {
                        return Err("Invalid NUT stream id");
                    }
                    let length = reader.size()?;
                    if length != 4 {
                        return Err("Unsupported NUT codec tag");
                    }
                    let tag: [u8; 4] = reader.take(4)?.try_into().unwrap();
                    let base = *bases
                        .get(reader.size()?)
                        .ok_or("Invalid NUT stream time base")?;
                    let shift = reader.word()?;
                    if shift >= 16 {
                        return Err("Invalid NUT stream time base");
                    }
                    reader.v()?;
                    reader.v()?;
                    reader.v()?;
                    let length = reader.size()?;
                    reader.take(length)?;
                    let mut track = Track {
                        format: None,
                        rate: 0,
                        channels: 0,
                        width: 0,
                        height: 0,
                        scale: base.1,
                        numerator: base.0,
                        duration: 0.,
                        shift,
                        last_pts: 0,
                        tag,
                        sar: (0, 0),
                        packets: Vec::new(),
                    };
                    if kind == 1 {
                        let le = tag[0] == b'P';
                        let (bits, ty, d, p) = if le {
                            (tag[3], tag[1], tag[2], tag[0])
                        } else {
                            (tag[0], tag[2], tag[1], tag[3])
                        };
                        if d != b'D' || p != b'P' {
                            return Err("Unsupported NUT audio codec");
                        }
                        let format = match ty {
                            b'S' if matches!(bits, 8 | 16 | 24 | 32 | 64) => {
                                Format::Signed(bits.into(), !le && bits != 8)
                            }
                            b'U' if matches!(bits, 8 | 16 | 24 | 32) => {
                                Format::Unsigned(bits.into(), !le && bits != 8)
                            }
                            b'F' if matches!(bits, 32 | 64) => Format::Float(bits.into(), !le),
                            _ => return Err("Unsupported NUT PCM format"),
                        };
                        track.format = Some(format);
                        track.rate = reader.word()?;
                        let denominator = reader.v()?;
                        track.channels = reader.word()?;
                        if track.rate == 0
                            || denominator != 1
                            || track.channels == 0
                            || track.channels > 65535
                        {
                            return Err("Invalid NUT audio parameters");
                        }
                    } else if kind == 0 && matches!(&tag, b"RGB\x18" | b"BGR\x18") {
                        track.width = reader.size()?;
                        track.height = reader.size()?;
                        track.sar = (reader.word()?, reader.word()?);
                        reader.v()?;
                        if track.width == 0
                            || track.height == 0
                            || track.width.checked_mul(track.height).is_none()
                        {
                            return Err("Invalid NUT video dimensions");
                        }
                    } else {
                        return Err("Unsupported NUT stream codec");
                    }
                    if streams[id].is_none() {
                        streams[id] = Some(track);
                    }
                } else if code == CODES[2] {
                    let timestamp = reader.v()?;
                    if bases.is_empty() {
                        return Err("Invalid NUT syncpoint");
                    }
                    let (num, den) = bases[(timestamp % bases.len() as u64) as usize];
                    reader.v()?;
                    for stream in &mut streams {
                        let stream = stream.as_mut().ok_or("Missing NUT stream header")?;
                        let pts = ((timestamp / bases.len() as u64) as f64 * f64::from(num)
                            / f64::from(den)
                            * f64::from(stream.scale)
                            / f64::from(stream.numerator))
                        .floor();
                        if pts >= (1u64 << 53) as f64 {
                            return Err("Invalid NUT syncpoint timestamp");
                        }
                        stream.last_pts = pts as i64;
                    }
                }
                reader.pos = end;
                reader.end = bytes.len();
                continue;
            }
            let code = codes[reader.take(1)?[0] as usize];
            if code.flags & 8192 != 0 {
                return Err("Invalid NUT frame code");
            }
            let FrameCode {
                mut flags,
                stream: mut id,
                mut size,
                mut reserved,
                mut header,
                ..
            } = code;
            if flags & 4096 != 0 {
                flags ^= reader.v()?;
            }
            if flags & 16 != 0 {
                id = reader.size()?;
            }
            let stream = streams
                .get_mut(id)
                .and_then(Option::as_mut)
                .ok_or("Invalid NUT frame stream")?;
            if flags & (8192 | 256) != 0 {
                return Err("Unsupported NUT frame flags");
            }
            let mut pts = stream
                .last_pts
                .checked_add(code.delta)
                .ok_or("Invalid NUT timestamp")?;
            if flags & 8 != 0 {
                let coded = reader.v()? as i64;
                let wrap = 1i64 << stream.shift;
                let origin = stream
                    .last_pts
                    .checked_sub(wrap / 2)
                    .ok_or("Invalid NUT timestamp")?;
                pts = if coded < wrap {
                    (coded - origin).rem_euclid(wrap) + origin
                } else {
                    coded - wrap
                };
            }
            if flags & 32 != 0 {
                size = code
                    .mul
                    .checked_mul(reader.v()?)
                    .and_then(|n| n.checked_add(size))
                    .ok_or("Invalid NUT frame size")?;
            }
            if flags & 2048 != 0 {
                reader.s()?;
            }
            if flags & 1024 != 0 {
                header = reader.size()?;
            }
            if flags & 128 != 0 {
                reserved = reader.v()?;
            }
            for _ in 0..reserved {
                reader.v()?;
            }
            if header >= headers.len() {
                return Err("Invalid NUT elision index");
            }
            if size > 4096 {
                header = 0;
            }
            if flags & 64 != 0 {
                reader.take(4)?;
                if checksum(&bytes[start..reader.pos]) != 0 {
                    return Err("Invalid NUT frame checksum");
                }
            }
            let size = usize::try_from(size).map_err(|_| "Invalid NUT frame size")?;
            let prefix = headers[header];
            let offset = reader.pos;
            let payload = reader.take(
                size.checked_sub(prefix.len())
                    .ok_or("Invalid NUT frame size")?,
            )?;
            remaining = remaining
                .checked_sub(if prefix.is_empty() { 0 } else { size })
                .ok_or("NUT packets exceed memory budget")?;
            if stream.packets.len() == stream.packets.capacity() {
                let extra = stream
                    .packets
                    .capacity()
                    .max(1)
                    .min(remaining / size_of::<Packet>());
                if extra == 0 {
                    return Err("NUT packets exceed memory budget");
                }
                stream
                    .packets
                    .try_reserve_exact(extra)
                    .map_err(|_| "NUT packets exceed memory budget")?;
                remaining -= extra * size_of::<Packet>();
            }
            let data = if prefix.is_empty() {
                Cow::Borrowed(payload)
            } else {
                let mut data = Vec::new();
                data.try_reserve_exact(size)
                    .map_err(|_| "NUT packets exceed memory budget")?;
                data.extend_from_slice(prefix);
                data.extend_from_slice(payload);
                Cow::Owned(data)
            };
            stream.last_pts = pts;
            pts = pts
                .checked_mul(i64::from(stream.numerator))
                .filter(|p| p.unsigned_abs() < 1 << 53)
                .ok_or("Invalid NUT timestamp")?;
            stream.packets.push(Packet {
                data,
                offset,
                pts,
                ticks: 0.,
                key: flags & 1 != 0,
            });
        }
        if streams.is_empty() {
            return Err("Missing NUT stream headers");
        }
        if streams.len() > remaining / size_of::<Track>() {
            return Err("NUT tracks exceed memory budget");
        }
        let mut tracks = Vec::new();
        tracks
            .try_reserve_exact(streams.len())
            .map_err(|_| "NUT tracks exceed memory budget")?;
        for stream in streams {
            let mut stream = stream.ok_or("Missing NUT stream headers")?;
            for i in 0..stream.packets.len() {
                let p = &stream.packets[i];
                let ticks = if let Some(format) = stream.format {
                    (p.data.len() / (stream.channels as usize * usize::from(format.bits() / 8)))
                        as f64
                        * f64::from(stream.scale)
                        / f64::from(stream.rate)
                } else {
                    (stream.packets.get(i + 1).map_or_else(
                        || {
                            p.pts
                                + if i == 0 {
                                    i64::from(stream.numerator)
                                } else {
                                    p.pts - stream.packets[i - 1].pts
                                }
                        },
                        |p| p.pts,
                    ) - p.pts) as f64
                };
                stream.duration = stream.duration.max(p.pts as f64 + ticks);
                stream.packets[i].ticks = ticks;
            }
            tracks.push(stream);
        }
        Ok(Self { tracks })
    }
}
impl Track<'_> {
    pub fn kind(&self) -> &'static str {
        if self.format.is_some() {
            "audio"
        } else {
            "video"
        }
    }
    pub fn seconds(&self) -> f64 {
        self.duration / f64::from(self.scale)
    }
    fn sample_format(&self) -> &'static str {
        match self.format {
            Some(Format::Signed(8, _) | Format::Unsigned(8, _)) => "u8",
            Some(Format::Signed(16, _) | Format::Unsigned(16, _)) => "s16",
            Some(Format::Signed(24 | 32, _) | Format::Unsigned(24 | 32, _)) => "s32",
            Some(Format::Signed(64, _)) => "s64",
            Some(Format::Float(32, _)) => "flt",
            Some(Format::Float(64, _)) => "dbl",
            _ => "fltp",
        }
    }
    fn pixel_format(&self) -> &'static str {
        if self.tag[0] == b'B' {
            "bgr24"
        } else {
            "rgb24"
        }
    }
    pub fn render_audio(&self, seek: InputTime, opts: &Remux) -> Result<Vec<u8>, String> {
        let format = self
            .format
            .ok_or("Raw audio output requires an audio stream")?;
        let size = self
            .packets
            .iter()
            .try_fold(0usize, |n, p| n.checked_add(p.data.len()))
            .filter(|&n| n <= opts.limit)
            .ok_or("NUT audio exceeds memory budget")?;
        let mut data = Vec::new();
        data.try_reserve_exact(size)
            .map_err(|_| "NUT audio exceeds memory budget")?;
        let mut packets = Vec::new();
        let used = size
            .checked_add(self.packets.len() * size_of::<super::ffmpeg_wave::Packet>())
            .filter(|&n| n <= opts.limit)
            .ok_or("NUT audio exceeds memory budget")?;
        packets
            .try_reserve_exact(self.packets.len())
            .map_err(|_| "NUT audio exceeds memory budget")?;
        for p in &self.packets {
            packets.push(super::ffmpeg_wave::Packet {
                pos: data.len(),
                size: p.data.len(),
                pts: (p.pts as f64 * f64::from(self.rate) / f64::from(self.scale))
                    .max(0.)
                    .round() as u64,
            });
            data.extend_from_slice(&p.data);
        }
        let mut format = format;
        if opts.audio_codec != Some("copy")
            && opts.format == "wav"
            && matches!(format, Format::Unsigned(24 | 32, _))
        {
            let width = usize::from(format.bits() / 8);
            let size = (data.len() / width)
                .checked_mul(8)
                .filter(|&n| n <= opts.limit)
                .ok_or("NUT audio exceeds memory budget")?;
            let mut floating = Vec::new();
            floating
                .try_reserve_exact(size)
                .map_err(|_| "NUT audio exceeds memory budget")?;
            for sample in data.chunks_exact(width) {
                floating.extend_from_slice(&format.sample(sample).to_le_bytes());
            }
            data = floating;
            format = Format::Float(64, false);
            packets.clear();
        }
        if opts.audio_codec == Some("copy")
            && opts.format == "wav"
            && matches!(format, Format::Signed(8, _) | Format::Unsigned(_, false))
        {
            format = Format::wave(1, format.bits());
        }
        let mut wave = Wave::raw(format, &data, self.rate, self.channels)?;
        wave.packets = &packets;
        wave.fact =
            Some((self.duration * f64::from(self.rate) / f64::from(self.scale)).round() as u64);
        let mut metadata = opts.metadata.to_vec();
        if opts.format == "wav" && !opts.bitexact {
            metadata.insert(0, ("encoder".into(), "Lavf61.7.100".into()));
        }
        Input::Wave(wave).render(
            seek,
            &Remux {
                metadata: &metadata,
                limit: opts.limit.saturating_sub(used.max(
                    data.capacity() + packets.capacity() * size_of::<super::ffmpeg_wave::Packet>(),
                )),
                hls: None,
                concat: None,
                ..*opts
            },
        )
    }
}

impl Document<'_> {
    pub fn report(
        &self,
        filename: &str,
        bytes: usize,
        mut opts: super::media_probe::ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        use super::super::structured::JVal::{Number, Object, Str};
        use super::media_probe::{Codec, StreamInfo, format_row, report, selected};
        let counts = (
            opts.counts.0 || opts.show.contains("frame"),
            opts.counts.1 || opts.show.contains("packet"),
        );
        if opts.show.contains("frame") && opts.show.contains("packet") {
            opts.show.remove("frame");
            opts.show.remove("packet");
            opts.show.insert("packet_frame");
        }
        let select = opts.select;
        let enabled = |i: usize| {
            selected(
                select,
                self.tracks[i].kind(),
                i,
                self.tracks[..i]
                    .iter()
                    .filter(|t| t.kind() == self.tracks[i].kind())
                    .count(),
            )
        };
        let codec = |t: &Track| {
            if let Some(f) = t.format {
                Codec::Audio {
                    rate: t.rate,
                    channels: t.channels,
                    bits: f.bits().into(),
                    tag: b"sowt",
                    profile: false,
                }
            } else {
                Codec::Video {
                    tag: b"raw ",
                    width: Some(t.width as i64),
                    height: Some(t.height as u32),
                }
            }
        };
        report(opts, |section| match section {
            "stream" => Box::new(
                self.tracks
                    .iter()
                    .enumerate()
                    .filter(move |(i, _)| enabled(*i))
                    .map(move |(i, t)| {
                        let ticks = t.packets.iter().map(|p| p.ticks).sum::<f64>();
                        let total = t.packets.iter().map(|p| p.data.len()).sum::<usize>();
                        let first = t.packets.first().map_or(0, |p| p.pts);
                        let info = StreamInfo {
                            codec: codec(t),
                            scale: t.scale,
                            start: first,
                            ticks: t.duration,
                            sample_ticks: ticks,
                            id: (i + 1) as u64,
                            language: Cow::Borrowed("und"),
                            profile: None,
                            count: t.packets.len(),
                            payload_bytes: total as u64,
                            has_cts: false,
                        };
                        let mut row = info.stream(i, counts);
                        row.retain(|(k, _)| {
                            !matches!(
                                *k,
                                "sample_aspect_ratio"
                                    | "display_aspect_ratio"
                                    | "color_range"
                                    | "color_space"
                            )
                        });
                        let tag = t
                            .tag
                            .iter()
                            .map(|b| {
                                if *b < 32 {
                                    format!("[{b}]")
                                } else {
                                    char::from(*b).to_string()
                                }
                            })
                            .collect::<String>();
                        let name = t
                            .format
                            .map_or_else(|| "rawvideo".into(), |f| format!("pcm_{}", f.name()));
                        let long = match name.as_str() {
                            "pcm_s16le" => "PCM signed 16-bit little-endian",
                            "pcm_s16be" => "PCM signed 16-bit big-endian",
                            "rawvideo" => "raw video",
                            _ => &name,
                        };
                        for (key, value) in &mut row {
                            *value = match *key {
                                "codec_name" => Str(name.clone()),
                                "codec_long_name" => Str(long.into()),
                                "codec_tag_string" => Str(tag.clone()),
                                "codec_tag" => Str(format!("0x{:08x}", u32::from_le_bytes(t.tag))),
                                "sample_fmt" => Str(t.sample_format().into()),
                                "pix_fmt" => Str(t.pixel_format().into()),
                                "channel_layout" => {
                                    Str(if t.channels == 1 { "mono" } else { "stereo" }.into())
                                }
                                _ => continue,
                            };
                        }
                        if t.format.is_none() && t.sar.0 != 0 && t.sar.1 != 0 {
                            row.push((
                                "sample_aspect_ratio",
                                Str(format!("{}:{}", t.sar.0, t.sar.1)),
                            ));
                            row.push((
                                "display_aspect_ratio",
                                Str(super::media_probe::ratio(
                                    t.width as u64 * u64::from(t.sar.0),
                                    t.height as u64 * u64::from(t.sar.1),
                                    ':',
                                )),
                            ));
                        }
                        if let Some((_, Object(fields))) =
                            row.iter_mut().find(|(key, _)| *key == "disposition")
                        {
                            for key in [
                                "non_diegetic",
                                "captions",
                                "descriptions",
                                "metadata",
                                "dependent",
                                "still_image",
                                "multilayer",
                            ] {
                                if !fields.iter().any(|(k, _)| k == key) {
                                    fields.push((key.into(), Number(0., None)));
                                }
                            }
                        }
                        row
                    }),
            ),
            "format" => {
                let mut row = format_row(
                    filename,
                    bytes,
                    ("nut", "NUT"),
                    self.tracks.len(),
                    self.tracks.iter().map(Track::seconds).fold(0., f64::max),
                    vec![],
                );
                row.insert(3, ("nb_stream_groups", Number(0., None)));
                Box::new(std::iter::once(row))
            }
            "packet" | "frame" | "packet_frame" => {
                let combined = section == "packet_frame";
                Box::new(
                    self.tracks
                        .iter()
                        .enumerate()
                        .filter(move |(i, _)| enabled(*i))
                        .flat_map(move |(i, t)| {
                            t.packets.iter().flat_map(move |p| {
                                (0..if combined { 2 } else { 1 }).map(move |n| {
                                    let frame = section == "frame" || combined && n == 1;
                                    let mut row = codec(t).record(
                                        i,
                                        t.scale,
                                        super::media_probe::Packet {
                                            pts: p.pts,
                                            dts: p.pts,
                                            ticks: p.ticks,
                                            size: p.data.len() as u64,
                                            pos: p.offset as u64,
                                            key: p.key,
                                        },
                                        frame,
                                    );
                                    row.retain(|(k, _)| *k != "pict_type");
                                    for (key, value) in &mut row {
                                        *value = match *key {
                                            "sample_fmt" => Str(t.sample_format().into()),
                                            "pix_fmt" => Str(t.pixel_format().into()),
                                            "flags" => {
                                                Str(if p.key { "K__" } else { "___" }.into())
                                            }
                                            _ => continue,
                                        };
                                    }
                                    if t.format.is_none() && t.sar.0 != 0 && t.sar.1 != 0 {
                                        row.push((
                                            "sample_aspect_ratio",
                                            Str(format!("{}:{}", t.sar.0, t.sar.1)),
                                        ));
                                    }
                                    if combined {
                                        row.insert(
                                            0,
                                            (
                                                "type",
                                                Str(if frame { "frame" } else { "packet" }.into()),
                                            ),
                                        );
                                    }
                                    row
                                })
                            })
                        }),
                )
            }
            _ => Box::new(std::iter::empty()),
        })
    }
}

fn integer(mut value: u64, out: &mut Vec<u8>) {
    let mut bytes = [0u8; 10];
    let mut pos = 9;
    bytes[pos] = (value & 127) as u8;
    while value >= 128 {
        value >>= 7;
        pos -= 1;
        bytes[pos] = (value as u8 & 127) | 128;
    }
    out.extend_from_slice(&bytes[pos..]);
}
fn append(out: &mut Vec<u8>, bytes: &[u8], limit: usize) -> Result<(), &'static str> {
    if bytes.len() > limit.saturating_sub(out.len()) {
        return Err("NUT output exceeds memory budget");
    }
    out.try_reserve_exact(bytes.len())
        .map_err(|_| "NUT output exceeds memory budget")?;
    out.extend_from_slice(bytes);
    Ok(())
}
fn header(out: &mut Vec<u8>, code: u64, bytes: &[u8], limit: usize) -> Result<(), &'static str> {
    let mut prefix = code.to_be_bytes().to_vec();
    integer(bytes.len() as u64 + 4, &mut prefix);
    if bytes.len() + 4 > 4096 {
        prefix.extend_from_slice(&checksum(&prefix).to_be_bytes());
    }
    append(out, &prefix, limit)?;
    append(out, bytes, limit)?;
    append(out, &checksum(bytes).to_be_bytes(), limit)
}
pub(super) fn write(tracks: &[Track<'_>], limit: usize) -> Result<Vec<u8>, String> {
    if tracks.len() > 32 {
        return Err("NUT stream count exceeds limit".into());
    }
    if tracks.is_empty() || tracks.iter().any(|t| t.format.is_none()) {
        return Err("NUT output requires PCM audio streams".into());
    }
    let mut out = Vec::new();
    append(&mut out, SIGNATURE, limit)?;
    let mut main = vec![3];
    integer(tracks.len() as u64, &mut main);
    integer(32767, &mut main);
    integer(tracks.len() as u64, &mut main);
    for t in tracks {
        main.push(1);
        integer(t.scale.into(), &mut main);
    }
    integer(8192, &mut main);
    main.extend_from_slice(&[6, 0, 1, 0, 0, 0, 1, 121, 6, 0, 1, 0, 0, 0, 1]);
    integer(8192, &mut main);
    main.extend_from_slice(&[6, 0, 1, 0, 0, 0]);
    integer(253, &mut main);
    main.push(0);
    header(&mut out, CODES[0], &main, limit)?;
    for (id, t) in tracks.iter().enumerate() {
        let format = t.format.unwrap();
        let (ty, big) = match format {
            Format::Signed(_, b) => (b'S', b),
            Format::Unsigned(_, b) => (b'U', b),
            Format::Float(_, b) => (b'F', b),
            _ => return Err("Unsupported NUT audio codec".into()),
        };
        let mut tag = [b'P', ty, b'D', format.bits() as u8];
        if big {
            tag.reverse();
        }
        let mut fields = Vec::new();
        integer(id as u64, &mut fields);
        fields.extend_from_slice(&[1, 4]);
        fields.extend_from_slice(&tag);
        integer(id as u64, &mut fields);
        fields.push(14);
        integer(t.scale.into(), &mut fields);
        fields.extend_from_slice(&[0, 0, 0]);
        integer(t.rate.into(), &mut fields);
        fields.push(1);
        integer(t.channels.into(), &mut fields);
        header(&mut out, CODES[1], &fields, limit)?;
    }
    let mut points = Vec::new();
    let mut max_pts = 0;
    let mut max_time = -1.;
    for (id, t) in tracks.iter().enumerate() {
        let stride = t.channels as usize * usize::from(t.format.unwrap().bits() / 8);
        if stride == 0 {
            return Err("Invalid NUT audio parameters".into());
        }
        let packet_size = (4096 / stride).max(1) * stride;
        for sample in &t.packets {
            for (i, data) in sample.data.chunks(packet_size).enumerate() {
                if points.len() == points.capacity() {
                    let extra = points.capacity().max(1);
                    if extra
                        .checked_add(points.capacity())
                        .and_then(|n| n.checked_mul(size_of::<(usize, usize, u64)>()))
                        .is_none_or(|n| n > limit.saturating_sub(out.capacity()))
                    {
                        return Err("NUT index exceeds memory budget".into());
                    }
                    points
                        .try_reserve_exact(extra)
                        .map_err(|_| "NUT index exceeds memory budget")?;
                }
                let limit = limit - points.capacity() * size_of::<(usize, usize, u64)>();
                let pts = (sample.pts as f64
                    + (i * packet_size) as f64 / stride as f64 * f64::from(t.scale)
                        / f64::from(t.rate))
                .round();
                if pts < 0. || pts >= ((1u64 << 53) / tracks.len() as u64) as f64 {
                    return Err("Invalid NUT output timestamp".into());
                }
                let pts = pts as u64;
                points.push((out.len(), id, pts));
                if pts as f64 / f64::from(t.scale) > max_time {
                    max_time = pts as f64 / f64::from(t.scale);
                    max_pts = pts * tracks.len() as u64 + id as u64;
                }
                let mut sync = Vec::new();
                integer(pts * tracks.len() as u64 + id as u64, &mut sync);
                sync.push(0);
                header(&mut out, CODES[2], &sync, limit)?;
                let mut frame = vec![1];
                integer(id as u64, &mut frame);
                integer(pts + 16384, &mut frame);
                integer(data.len() as u64, &mut frame);
                frame.extend_from_slice(&checksum(&frame).to_be_bytes());
                append(&mut out, &frame, limit)?;
                append(&mut out, data, limit)?;
            }
        }
    }
    if !points.is_empty() {
        let budget = limit
            .checked_sub(points.capacity() * size_of::<(usize, usize, u64)>())
            .ok_or("NUT index exceeds memory budget")?;
        let size = points
            .len()
            .checked_mul(8 + 9 * tracks.len())
            .and_then(|n| n.checked_add(24))
            .filter(|&n| n <= budget.saturating_sub(out.capacity()))
            .ok_or("NUT index exceeds memory budget")?;
        let mut index = Vec::new();
        index
            .try_reserve_exact(size)
            .map_err(|_| "NUT index exceeds memory budget")?;
        integer(max_pts, &mut index);
        integer(points.len() as u64, &mut index);
        let mut previous = 0;
        for &(pos, _, _) in &points {
            let pos = pos / 16;
            integer((pos - previous) as u64, &mut index);
            previous = pos;
        }
        for id in 0..tracks.len() {
            let mut last = -1i64;
            for i in 0..points.len() {
                if let Some(&(_, stream, pts)) = i.checked_sub(1).map(|j| &points[j])
                    && stream == id
                    && pts as i64 > last
                {
                    index.push(1);
                    integer((pts as i64 - last) as u64, &mut index);
                    last = pts as i64;
                } else {
                    index.push(3);
                }
            }
        }
        let size = index.len() + 12;
        let mut pointer = Vec::new();
        integer(size as u64, &mut pointer);
        index.extend_from_slice(
            &(8 + pointer.len() as u64 + if size > 4096 { 4 } else { 0 } + size as u64)
                .to_be_bytes(),
        );
        header(
            &mut out,
            CODES[4],
            &index,
            budget.saturating_sub(index.capacity()),
        )?;
    }
    Ok(out)
}
impl<'a> Track<'a> {
    pub fn wave(wave: Wave<'a>, limit: usize) -> Result<Self, String> {
        let count = if wave.packets.is_empty() {
            wave.data
                .len()
                .div_ceil(wave.packet_frames() * wave.stride())
        } else {
            wave.packets.len()
        };
        if count > limit / size_of::<Packet>() {
            return Err("NUT packets exceed memory budget".into());
        }
        let mut packets = Vec::new();
        packets
            .try_reserve_exact(count)
            .map_err(|_| "NUT packets exceed memory budget")?;
        if wave.packets.is_empty() {
            for (i, data) in wave
                .data
                .chunks(wave.packet_frames() * wave.stride())
                .enumerate()
            {
                packets.push(Packet {
                    data: Cow::Borrowed(data),
                    offset: 0,
                    pts: (i * wave.packet_frames()) as i64,
                    ticks: (data.len() / wave.stride()) as f64,
                    key: true,
                });
            }
        } else {
            for p in wave.packets {
                packets.push(Packet {
                    data: Cow::Borrowed(&wave.data[p.pos..p.pos + p.size]),
                    offset: 0,
                    pts: p.pts as i64,
                    ticks: (p.size / wave.stride()) as f64,
                    key: true,
                });
            }
        }
        Ok(Self {
            format: Some(wave.format()),
            rate: wave.rate,
            channels: wave.channels as u32,
            width: 0,
            height: 0,
            scale: wave.rate,
            duration: (wave.data.len() / wave.stride()) as f64,
            packets,
            tag: [0; 4],
            sar: (0, 0),
            numerator: 1,
            shift: 14,
            last_pts: 0,
        })
    }
    pub fn convert(&self, seek: InputTime, opts: &Remux) -> Result<Track<'_>, String> {
        let source = self.format.ok_or("NUT output requires PCM audio streams")?;
        let format = match opts.audio_codec {
            None | Some("copy") => source,
            Some(codec) => Format::parse(codec.strip_prefix("pcm_").unwrap_or(""))
                .ok_or_else(|| format!("Unsupported NUT audio codec '{codec}'"))?,
        };
        if !matches!(
            format,
            Format::Signed(..) | Format::Unsigned(..) | Format::Float(..)
        ) {
            return Err("Unsupported NUT audio codec".into());
        }
        let mut track = Track {
            format: Some(format),
            rate: opts.rate.unwrap_or(self.rate),
            channels: opts.channels.unwrap_or(self.channels),
            width: 0,
            height: 0,
            scale: opts.rate.unwrap_or(self.scale),
            duration: self.duration,
            packets: Vec::new(),
            tag: [0; 4],
            sar: (0, 0),
            numerator: 1,
            shift: 14,
            last_pts: 0,
        };
        if opts.audio_codec == Some("copy") {
            track.rate = self.rate;
            track.channels = self.channels;
            track.scale = self.scale;
            let start = seek.start.unwrap_or(0.);
            let end = seek.end().unwrap_or(self.seconds());
            let span = (end.min(self.seconds()) - start).max(0.);
            let copies = seek
                .loops
                .checked_add(1)
                .ok_or("NUT packets exceed memory budget")?;
            let count = copies
                .checked_mul(self.packets.len())
                .filter(|&n| n <= opts.limit / size_of::<Packet>())
                .ok_or("NUT packets exceed memory budget")?;
            track
                .packets
                .try_reserve_exact(count)
                .map_err(|_| "NUT packets exceed memory budget")?;
            let mut tick = 0.;
            let mut origin = None;
            for copy in 0..copies {
                let mut first = true;
                for p in &self.packets {
                    let time = p.pts as f64 / f64::from(self.scale);
                    let duration = p.ticks / f64::from(self.scale);
                    if (time + duration) * f64::from(self.scale)
                        <= (start * f64::from(self.scale)).round()
                        || time * f64::from(self.scale) >= (end * f64::from(self.scale)).round()
                    {
                        continue;
                    }
                    if first {
                        tick += (time - start).max(0.);
                        first = false;
                    }
                    let pts = if self.tag == [0; 4] {
                        tick
                    } else {
                        (time - start).max(0.) + copy as f64 * span
                    };
                    tick += duration;
                    let from = opts.start.unwrap_or(0.);
                    if pts + duration > from && opts.end.is_none_or(|e| pts < e) {
                        let output_pts = if self.tag == [0; 4] {
                            let origin = *origin.get_or_insert(pts);
                            if pts < from {
                                continue;
                            }
                            pts - origin
                        } else {
                            (pts - from).max(0.)
                        };
                        track.packets.push(Packet {
                            data: Cow::Borrowed(&p.data),
                            offset: 0,
                            pts: (output_pts * f64::from(self.scale)).round() as i64,
                            ticks: p.ticks,
                            key: true,
                        });
                    }
                }
            }
        } else {
            if matches!(format, Format::Signed(64, _)) {
                return Err(format!(
                    "Unsupported NUT audio encoder 'pcm_{}'",
                    format.name()
                ));
            }
            let name = format.name();
            let codec = format!("pcm_{name}");
            let data = self.render_audio(
                seek,
                &Remux {
                    format: &name,
                    audio_codec: Some(&codec),
                    hls: None,
                    concat: None,
                    ..*opts
                },
            )?;
            let ticks = (data.len() / (track.channels as usize * usize::from(format.bits() / 8)))
                as f64
                * f64::from(track.scale)
                / f64::from(track.rate);
            track.packets.push(Packet {
                data: Cow::Owned(data),
                offset: 0,
                pts: 0,
                ticks,
                key: true,
            });
        }
        Ok(track)
    }
}
impl Track<'_> {
    pub fn times(
        &self,
        seek: InputTime,
        limit: usize,
    ) -> Result<Vec<(usize, f64, f64)>, &'static str> {
        let copies = seek
            .loops
            .checked_add(1)
            .ok_or("NUT frame traversal exceeds memory budget")?;
        let count = copies
            .checked_mul(self.packets.len())
            .filter(|&n| n <= limit / size_of::<(usize, f64, f64)>())
            .ok_or("NUT frame traversal exceeds memory budget")?;
        let mut times = Vec::new();
        times
            .try_reserve_exact(count)
            .map_err(|_| "NUT frame traversal exceeds memory budget")?;
        let start = seek.start.unwrap_or(0.);
        let end = seek.end().unwrap_or(self.seconds()).min(self.seconds());
        let span = (end - start).max(0.);
        for copy in 0..copies {
            for (i, p) in self.packets.iter().enumerate() {
                let pts = p.pts as f64 / f64::from(self.scale);
                let duration = p.ticks / f64::from(self.scale);
                if (pts + duration) * f64::from(self.scale)
                    > (start * f64::from(self.scale)).round()
                    && (pts * f64::from(self.scale)).round() < (end * f64::from(self.scale)).round()
                {
                    times.push((
                        i,
                        (pts - start).max(0.) + copy as f64 * span,
                        duration.min(end - pts),
                    ));
                }
            }
        }
        Ok(times)
    }
    pub fn image(&self, i: usize, limit: usize) -> Result<super::png_pixels::Raster, &'static str> {
        let pixels = self
            .width
            .checked_mul(self.height)
            .filter(|&n| n <= limit / 4)
            .ok_or("NUT frame exceeds memory budget")?;
        let packet = &self.packets[i].data;
        if packet.len()
            != pixels
                .checked_mul(3)
                .ok_or("Invalid NUT packed video frame size")?
        {
            return Err("Invalid NUT packed video frame size");
        }
        let bgr = self.tag[0] == b'B';
        let mut data = Vec::new();
        data.try_reserve_exact(pixels)
            .map_err(|_| "NUT frame exceeds memory budget")?;
        for pixel in packet.chunks_exact(3) {
            data.push([
                pixel[if bgr { 2 } else { 0 }],
                pixel[1],
                pixel[if bgr { 0 } else { 2 }],
                255,
            ]);
        }
        Ok(super::png_pixels::Raster {
            width: self.width,
            height: self.height,
            alpha: false,
            gray: false,
            density: 0,
            orientation: None,
            pixels: data,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_syncpoint_timestamp_overflow_before_unwrapping_frame_pts() {
        let wave = Wave::raw(Format::Signed(16, false), &[0, 0], 8000, 1).unwrap();
        let mut fast = Track::wave(wave, 65536).unwrap();
        fast.scale = 1 << 30;
        let mut slow = Track::wave(wave, 65536).unwrap();
        slow.scale = 1;
        slow.packets[0].pts = 1 << 50;
        let mut bytes = write(&[fast, slow], 65536).unwrap();
        // Resume stream zero with a wrapped PTS after the large syncpoint.
        let mut frame = vec![1, 0, 1, 2];
        frame.extend_from_slice(&checksum(&frame).to_be_bytes());
        bytes.extend_from_slice(&frame);
        bytes.extend_from_slice(&[0, 0]);
        assert!(Document::read(&bytes, 65536).is_err());
    }
}
