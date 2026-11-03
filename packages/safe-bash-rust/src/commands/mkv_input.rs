use super::super::super::structured::JVal;
use super::super::media_probe::{self, Codec, Packet, ProbeOptions, StreamInfo};
use std::collections::BTreeMap;

fn vint(bytes: &mut &[u8], strip: bool) -> Option<(u64, bool)> {
    let first = *bytes.first()?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 {
        return None;
    }
    let (head, tail) = bytes.split_at_checked(len)?;
    *bytes = tail;
    let mut value = u64::from(if strip {
        first ^ (0x80 >> (len - 1))
    } else {
        first
    });
    for &b in &head[1..] {
        value = (value << 8) | u64::from(b);
    }
    Some((value, strip && value == (1 << (7 * len)) - 1))
}

fn elements(mut bytes: &[u8], master: bool) -> impl Iterator<Item = (u64, &[u8])> {
    std::iter::from_fn(move || {
        let (id, _) = vint(&mut bytes, false)?;
        let (len, unknown) = vint(&mut bytes, true)?;
        let n = if master && unknown {
            bytes.len()
        } else {
            len.min(bytes.len() as u64) as usize
        };
        let (body, tail) = bytes.split_at(n);
        bytes = tail;
        Some((id, body))
    })
}
fn uint(b: &[u8]) -> u64 {
    b.iter()
        .fold(0u64, |a, &n| a.saturating_mul(256).saturating_add(n.into()))
}
fn float(b: &[u8]) -> f64 {
    if let Ok(v) = b.try_into() {
        f64::from_be_bytes(v)
    } else if let Ok(v) = b.try_into() {
        f32::from_be_bytes(v).into()
    } else {
        0.
    }
}
fn string(b: &[u8]) -> String {
    String::from_utf8_lossy(b).trim_end_matches('\0').into()
}

struct Header<'a> {
    id: u64,
    kind: u64,
    default_ns: u64,
    codec: String,
    private: &'a [u8],
    language: String,
    width: Option<u32>,
    height: Option<u32>,
    rate: Option<u32>,
    channels: Option<u32>,
    bits: u32,
}
impl<'a> Header<'a> {
    fn read(bytes: &'a [u8], id: u64) -> Self {
        let mut h = Self {
            id,
            kind: 1,
            default_ns: 0,
            codec: "V_MPEG4/ISO/AVC".into(),
            private: &[],
            language: "und".into(),
            width: None,
            height: None,
            rate: None,
            channels: None,
            bits: 16,
        };
        for (id, b) in elements(bytes, false) {
            match id {
                0xd7 => h.id = uint(b),
                0x83 => h.kind = uint(b),
                0x23e383 => h.default_ns = uint(b),
                0x86 => h.codec = string(b),
                0x63a2 => h.private = b,
                0x22b59c => h.language = string(b),
                0xe0 | 0xe1 => {
                    for (field, v) in elements(b, false) {
                        match (id, field) {
                            (0xe0, 0xb0) => h.width = Some(uint(v) as u32),
                            (0xe0, 0xba) => h.height = Some(uint(v) as u32),
                            (0xe1, 0xb5) => h.rate = Some(float(v).round() as u32),
                            (0xe1, 0x9f) => h.channels = Some(uint(v) as u32),
                            (0xe1, 0x6264) => h.bits = uint(v) as u32,
                            _ => (),
                        }
                    }
                }
                _ => (),
            }
        }
        h
    }
    fn codec(&self, scale: u32) -> (Codec, Option<String>) {
        if self.kind == 1 {
            let tag = if self.codec.contains("V_MPEGH/ISO/HEVC") {
                b"hvc1"
            } else if self.codec.contains("V_VP8") {
                b"vp08"
            } else if self.codec.contains("V_VP9") {
                b"vp09"
            } else if self.codec.contains("V_AV1") {
                b"av01"
            } else {
                b"avc1"
            };
            let seq = (tag == b"avc1")
                .then(|| super::h264::Sequence::from_config(self.private))
                .flatten();
            (
                Codec::Video {
                    tag,
                    width: self.width.or_else(|| seq.as_ref().map(|s| s.width)),
                    height: self.height.or_else(|| seq.as_ref().map(|s| s.height)),
                },
                seq.map(|s| s.profile),
            )
        } else if self.kind == 2 {
            let tag = if self.codec.contains("A_AAC") {
                b"mp4a"
            } else if self.codec.contains("A_OPUS") {
                b"Opus"
            } else if self.codec.contains("A_VORBIS") {
                b"vorb"
            } else if self.codec.contains("A_MPEG/L3") {
                b".mp3"
            } else if self.codec.contains("A_FLAC") {
                b"fLaC"
            } else if self.codec.contains("A_PCM") {
                b"sowt"
            } else {
                b"avc1"
            };
            let asc = (tag == b"mp4a" && self.private.len() >= 2)
                .then(|| super::audio_config(self.private));
            (
                Codec::Audio {
                    tag,
                    rate: self.rate.or(asc.map(|v| v.1)).unwrap_or(if tag == b"Opus" {
                        48000
                    } else {
                        scale
                    }),
                    channels: self.channels.or(asc.map(|v| v.2.into())).unwrap_or(2),
                    bits: self.bits,
                    profile: false,
                },
                None,
            )
        } else {
            (
                Codec::Subtitle {
                    webvtt: self.codec.contains("WEBVTT"),
                },
                None,
            )
        }
    }
}
struct Block<'a> {
    dts: i64,
    ticks: f64,
    data: &'a [u8],
    key: bool,
}
struct Movie<'a> {
    headers: BTreeMap<u64, Header<'a>>,
    order: Vec<u64>,
    blocks: BTreeMap<u64, Vec<Block<'a>>>,
    scale: u64,
    duration: f64,
    title: Option<String>,
    encoder: Option<String>,
    tags: BTreeMap<String, String>,
    budget: usize,
}
impl<'a> Movie<'a> {
    fn charge(&mut self, n: usize) -> Result<(), &'static str> {
        self.budget = self
            .budget
            .checked_sub(n)
            .ok_or("sample index exceeds memory budget")?;
        Ok(())
    }
    fn read(&mut self, bytes: &'a [u8]) -> Result<(), &'static str> {
        let mut parents = vec![elements(bytes, true)];
        while let Some(parent) = parents.last_mut() {
            let Some((id, b)) = parent.next() else {
                parents.pop();
                continue;
            };
            match id {
                0x1a45dfa3 | 0x18538067 | 0x1549a966 | 0x1654ae6b | 0x1254c367 | 0x7373 => {
                    let children = elements(b, true);
                    if parents.len() >= self.budget / size_of_val(&children) {
                        return Err("element index exceeds memory budget");
                    }
                    parents.push(children);
                }
                0x2ad7b1 => {
                    self.scale = match uint(b) {
                        0 => 1_000_000,
                        n => n,
                    }
                }
                0x4489 => self.duration = float(b),
                0x7ba9 => self.title = Some(string(b)),
                0x5741 => self.encoder = Some(string(b)),
                0x67c8 => {
                    let (mut name, mut value) = (&[][..], &[][..]);
                    for (k, v) in elements(b, false) {
                        match k {
                            0x45a3 => name = v,
                            0x4487 => value = v,
                            _ => (),
                        }
                    }
                    let name = string(name).to_ascii_uppercase();
                    if matches!(
                        name.as_str(),
                        "TITLE"
                            | "ARTIST"
                            | "ALBUM"
                            | "DATE"
                            | "DATE_RELEASED"
                            | "COMMENT"
                            | "GENRE"
                            | "ENCODER"
                    ) && !value.is_empty()
                    {
                        self.tags.insert(name, string(value));
                    }
                }
                0xae => {
                    let h = Header::read(b, self.headers.len() as u64 + 1);
                    if !self.headers.contains_key(&h.id) {
                        self.charge(size_of::<Header>() + size_of::<u64>())?;
                        self.order.push(h.id);
                    }
                    self.headers.insert(h.id, h);
                }
                0x1f43b675 => {
                    let mut time = 0;
                    for (k, v) in elements(b, false) {
                        if k == 0xe7 {
                            time = uint(v);
                            continue;
                        }
                        if !matches!(k, 0xa3 | 0xa0) {
                            continue;
                        }
                        let (mut block, mut ticks) = (v, 0.);
                        if k == 0xa0 {
                            for (field, value) in elements(v, false) {
                                match field {
                                    0xa1 => block = value,
                                    0x9b => ticks = uint(value) as f64,
                                    _ => (),
                                }
                            }
                        }
                        if let Some((track, _)) = vint(&mut block, true)
                            && let [hi, lo, flags, data @ ..] = block
                        {
                            self.charge(size_of::<Block>())?;
                            let dts = (i128::from(time)
                                + i128::from(i16::from_be_bytes([*hi, *lo])))
                            .clamp(0, i128::from(i64::MAX))
                                as i64;
                            self.blocks.entry(track).or_default().push(Block {
                                dts,
                                ticks,
                                data,
                                key: k == 0xa0 || flags & 128 != 0,
                            });
                        }
                    }
                }
                _ => (),
            }
        }
        Ok(())
    }
}
struct Track<'a> {
    info: StreamInfo,
    blocks: Vec<Block<'a>>,
    wrap: bool,
    kind: &'static str,
    ordinal: usize,
}
impl Track<'_> {
    fn packets(&self) -> impl Iterator<Item = Packet> + '_ {
        let (mut pos, mut cursor) = (0, 0);
        self.blocks.iter().flat_map(move |b| {
            let mut dts = b.dts;
            let mut ticks = b.ticks;
            let mut size = b.data.len() as u64;
            let mut gap = None;
            if self.wrap {
                dts = dts.max(cursor);
                if dts > cursor {
                    gap = Some(Packet {
                        dts: cursor,
                        pts: cursor,
                        ticks: (dts - cursor) as f64,
                        size: 2,
                        pos,
                        key: true,
                    });
                    pos += 2;
                }
                ticks = ticks.round().max(1.);
                size += 2;
                cursor = dts.saturating_add(ticks as i64);
            }
            let p = Packet {
                pts: dts,
                dts,
                ticks,
                size,
                pos,
                key: self.wrap || b.key,
            };
            pos += size;
            gap.into_iter().chain(std::iter::once(p))
        })
    }
}
pub(in super::super) fn report(
    bytes: &[u8],
    name: &str,
    limit: usize,
    opts: ProbeOptions<'_>,
) -> Result<String, &'static str> {
    if !bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Err("Invalid Matroska/WebM file: missing EBML header signature");
    }
    let mut movie = Movie {
        headers: BTreeMap::new(),
        order: vec![],
        blocks: BTreeMap::new(),
        scale: 1_000_000,
        duration: 0.,
        title: None,
        encoder: None,
        tags: BTreeMap::new(),
        budget: limit,
    };
    movie.read(bytes)?;
    let scale = (1e9 / movie.scale as f64).round().max(1.) as u32;
    let mut duration = movie.duration * movie.scale as f64 / 1e9;
    let mut tracks = Vec::new();
    let mut ordinals = [0; 3];
    for id in movie.order {
        let h = movie.headers.remove(&id).unwrap();
        let mut blocks = movie.blocks.remove(&id).unwrap_or_default();
        let mut previous =
            (f64::from(scale) / if h.kind == 1 { 30. } else { 44100. / 1024. }).max(1.);
        let mut end = 0f64;
        for i in 0..blocks.len() {
            let delta = blocks.get(i + 1).map_or(0, |b| b.dts - blocks[i].dts);
            let b = &mut blocks[i];
            if b.ticks == 0. {
                b.ticks = if h.default_ns != 0 {
                    h.default_ns as f64 / movie.scale as f64
                } else if delta > 0 {
                    delta as f64
                } else {
                    previous
                };
            }
            previous = b.ticks;
            end = end.max(b.dts as f64 + b.ticks);
        }
        if end == 0. {
            end = movie.duration;
        }
        if movie.duration <= 0. {
            duration = duration.max(end / f64::from(scale));
        }
        let (codec, profile) = h.codec(scale);
        let (kind, k) = match h.kind {
            1 => ("video", 0),
            2 => ("audio", 1),
            _ => ("subtitle", 2),
        };
        let wrap = k == 2
            && blocks.iter().any(|b| {
                b.data.len() < 2 || usize::from(super::u16_at(b.data, 0)) != b.data.len() - 2
            });
        let mut t = Track {
            info: StreamInfo {
                codec,
                profile,
                scale,
                start: 0,
                ticks: end,
                count: 0,
                sample_ticks: 0.,
                payload_bytes: 0,
                has_cts: false,
                id,
                language: if h.language.is_empty() {
                    "und".into()
                } else {
                    h.language.into()
                },
            },
            blocks,
            wrap,
            kind,
            ordinal: ordinals[k],
        };
        let (mut start, mut count, mut ticks, mut payload) = (0, 0, 0., 0);
        for p in t.packets() {
            if count == 0 {
                start = p.pts;
            }
            count += 1;
            ticks += p.ticks;
            payload += p.size;
        }
        t.info.start = start;
        t.info.count = count;
        t.info.sample_ticks = ticks;
        t.info.payload_bytes = payload;
        tracks.push(t);
        ordinals[k] += 1;
    }
    let mut tags = vec![];
    for key in [
        "title", "artist", "album", "date", "comment", "genre", "encoder",
    ] {
        let value = match key {
            "title" => movie.title.take(),
            "encoder" => movie.encoder.take(),
            _ => None,
        }
        .or_else(|| movie.tags.remove(&key.to_ascii_uppercase()))
        .or_else(|| {
            if key == "date" {
                movie.tags.remove("DATE_RELEASED")
            } else {
                None
            }
        });
        if let Some(v) = value.filter(|v| !v.is_empty()) {
            tags.push((key.into(), JVal::Str(v)));
        }
    }
    let (select, counts) = (opts.select, opts.counts);
    media_probe::report(opts, |section| match section {
        "packet" | "frame" => Box::new(tracks.iter().enumerate().flat_map(move |(i, t)| {
            t.packets()
                .map(move |p| t.info.codec.record(i, scale, p, section == "frame"))
        })),
        "stream" => Box::new(
            tracks
                .iter()
                .enumerate()
                .filter(|(i, t)| media_probe::selected(select, t.kind, *i, t.ordinal))
                .map(|(i, t)| t.info.stream(i, counts)),
        ),
        "format" => Box::new(std::iter::once(media_probe::format_row(
            name,
            bytes.len(),
            ("matroska,webm", "Matroska / WebM"),
            tracks.len(),
            duration,
            tags.clone(),
        ))),
        _ => Box::new(std::iter::empty()),
    })
}
