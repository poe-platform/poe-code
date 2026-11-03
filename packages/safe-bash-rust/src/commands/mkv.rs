use super::super::{atoms, child, decoder_config, u16_at, u32_at};
use super::{Options, Track, audio_specific_config, h264};
use std::collections::BTreeMap;

type Result<T> = std::result::Result<T, &'static str>;

struct Ebml {
    bytes: Vec<u8>,
    limit: usize,
}

fn size(n: usize) -> ([u8; 8], usize) {
    let n = n as u64;
    let width = (1..8).find(|w| n < (1 << (w * 7)) - 1).unwrap_or(8);
    ((n | 1 << (width * 7)).to_be_bytes(), 8 - width)
}

impl Ebml {
    fn append(&mut self, bytes: &[u8]) -> Result<()> {
        if bytes.len() > self.limit - self.bytes.len() {
            return Err("output byte limit exceeded");
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }

    fn id(&mut self, id: u32) -> Result<()> {
        self.append(&id.to_be_bytes()[(id.leading_zeros() / 8) as usize..])
    }

    fn element(&mut self, id: u32, payload: &[u8]) -> Result<()> {
        self.id(id)?;
        let (len, start) = size(payload.len());
        self.append(&len[start..])?;
        self.append(payload)
    }

    fn uint(&mut self, id: u32, n: u32) -> Result<()> {
        self.element(
            id,
            &n.to_be_bytes()[(n.leading_zeros() / 8).min(3) as usize..],
        )
    }

    fn group(&mut self, id: u32, children: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        self.id(id)?;
        let pos = self.bytes.len();
        self.append(&[0])?;
        children(self)?;
        let (len, start) = size(self.bytes.len() - pos - 1);
        if 7 - start > self.limit - self.bytes.len() {
            return Err("output byte limit exceeded");
        }
        self.bytes
            .splice(pos..pos + 1, len[start..].iter().copied());
        Ok(())
    }
}

struct Block<'a> {
    ms: u64,
    duration: u64,
    track: usize,
    key: bool,
    data: &'a [u8],
}

pub(super) fn write(
    tracks: &[Track<'_>],
    seconds: f64,
    webm: bool,
    metadata: &BTreeMap<String, String>,
    audio: &Options,
    source_tags: &[super::Original<'_>],
) -> Result<Vec<u8>> {
    let mut out = Ebml {
        bytes: Vec::new(),
        limit: audio.limit,
    };
    let mut blocks = Vec::new();
    let mut duration = (seconds * 1000.).round() as u64;
    let mut entries = Ebml {
        bytes: Vec::new(),
        limit: audio.limit,
    };
    for (i, t) in tracks.iter().enumerate() {
        let (fourcc, entry) = atoms(t.stsd.get(8..).unwrap_or_default())
            .next()
            .unwrap_or((b"    ", &[]));
        let original = match source_tags[i] {
            super::Original::Matroska(t) => Some(t),
            _ => None,
        };
        let mut channels = 2;
        let mut timescale = t.scale;
        entries.group(0xae, |w| {
            w.uint(0xd7, i as u32 + 1)?;
            w.uint(0x73c5, i as u32 + 1)?;
            w.uint(
                0x83,
                match t.kind {
                    "video" => 1,
                    "audio" => 2,
                    _ => 17,
                },
            )?;
            let offset = match u16_at(entry, 8) {
                1 => 44,
                2 => 64,
                _ => 28,
            };
            let (indication, asc) =
                decoder_config(child(entry.get(offset..).unwrap_or_default(), b"esds"));
            let codec: &[u8] = match (t.kind, fourcc) {
                ("video", b"vp08") => b"V_VP8",
                ("video", b"vp09") => b"V_VP9",
                ("video", b"av01") => b"V_AV1",
                ("video", b"hvc1" | b"hev1") => b"V_MPEGH/ISO/HEVC",
                ("video", _) => b"V_MPEG4/ISO/AVC",
                ("audio", _) if audio.clear_samples => b"A_AAC",
                ("audio", b"vorb") => b"A_VORBIS",
                ("audio", b"Opus") => b"A_OPUS",
                ("audio", b"fLaC") => b"A_FLAC",
                ("audio", b".mp3") => b"A_MPEG/L3",
                ("audio", b"mp4a") if matches!(indication, 0x69 | 0x6b) => b"A_MPEG/L3",
                ("audio", _) => b"A_AAC",
                _ if webm => b"S_TEXT/WEBVTT",
                _ => b"S_TEXT/UTF8",
            };
            w.element(0x86, codec)?;
            let lang = [10, 5, 0].map(|shift| ((t.language >> shift) & 31) as u8 + 96);
            w.element(
                0x22b59c,
                original.map_or(lang.as_slice(), |t| t.info.language.as_bytes()),
            )?;
            if !matches!(codec, b"A_AAC" | b"V_MPEG4/ISO/AVC")
                && t.kind != "subtitle"
                && let Some(o) = original
                && !o.private.is_empty()
            {
                w.element(0x63a2, o.private)?;
            }
            if t.kind == "video" {
                if codec == b"V_MPEG4/ISO/AVC" {
                    let avcc = child(entry.get(78..).unwrap_or_default(), b"avcC");
                    let generated;
                    let avcc = if avcc.is_empty() {
                        generated = h264::configuration(t.width as usize, t.height as usize, 30)?;
                        &generated
                    } else {
                        avcc
                    };
                    w.element(0x63a2, avcc)?;
                }
                w.group(0xe0, |w| {
                    w.uint(0xb0, t.width)?;
                    w.uint(0xba, t.height)
                })?;
            } else if t.kind == "audio" {
                let (rate, ch) = asc
                    .map(|b| {
                        let (_, r, c) = super::super::audio_config(b);
                        (r, u32::from(c))
                    })
                    .unwrap_or_else(|| (u32_at(entry, 24) >> 16, u32::from(u16_at(entry, 16))));
                let rate = audio
                    .rate
                    .unwrap_or(original.map_or(rate, |t| t.sample_rate.unwrap_or(t.info.scale)));
                channels = audio.channels.unwrap_or(ch);
                if audio.clear_samples {
                    timescale = rate;
                }
                if codec == b"A_AAC" {
                    let fallback = audio_specific_config(
                        original.map_or(rate, |o| audio.rate.or(o.sample_rate).unwrap_or(44100)),
                        channels,
                        2,
                    );
                    w.element(
                        0x63a2,
                        if audio.clear_samples || matches!(source_tags[i], super::Original::Flv(_))
                        {
                            &fallback
                        } else {
                            asc.unwrap_or(&fallback)
                        },
                    )?;
                }
                w.group(0xe1, |w| {
                    w.element(0xb5, &f64::from(rate).to_be_bytes())?;
                    w.uint(0x9f, channels)?;
                    w.uint(0x6264, u32::from(u16_at(entry, 18)))
                })?;
            }
            Ok(())
        })?;
        let mut sample = |pts: f64, ticks: f64, data, key| -> Result<()> {
            if blocks.len() >= audio.limit / size_of::<Block>() {
                return Err("sample index exceeds memory budget");
            }
            let scale = f64::from(timescale.max(1));
            let ms = (pts / scale * 1000.).round() as u64;
            duration = duration.max(((pts + ticks) / scale * 1000.).round() as u64);
            blocks.push(Block {
                ms,
                duration: ((ticks / scale * 1000.).round() as u64).max(1),
                track: i,
                key,
                data,
            });
            Ok(())
        };
        if t.kind == "audio" && audio.clear_samples {
            sample(0., 1024., super::super::super::adts::silent(channels), true)?;
        } else if let Some(o) = original {
            for b in o.blocks.iter().take(if t.kind == "video" {
                t.samples.len()
            } else {
                o.blocks.len()
            }) {
                sample(b.dts as f64, b.ticks, b.data, b.key)?;
            }
        } else {
            let mut dts = t.first_dts;
            let mut source_ms = source_tags[i].timestamps(t.kind == "video");
            for s in &t.samples {
                sample(
                    source_ms.next().map_or(dts as f64, |n| n as f64) + s.cts as f64,
                    s.duration.into(),
                    s.data.as_ref(),
                    s.key,
                )?;
                dts += u64::from(s.duration);
            }
        }
    }
    blocks.sort_by_key(|b| (b.ms, b.track));
    out.group(0x1a45dfa3, |w| {
        for (id, n) in [(0x4286, 1), (0x42f7, 1), (0x42f2, 4), (0x42f3, 8)] {
            w.uint(id, n)?;
        }
        w.element(0x4282, if webm { b"webm" } else { b"matroska" })?;
        w.uint(0x4287, 4)?;
        w.uint(0x4285, 2)
    })?;
    out.group(0x18538067, |w| {
        w.group(0x1549a966, |w| {
            w.uint(0x2ad7b1, 1000000)?;
            w.element(0x4489, &(duration.max(1) as f64).to_be_bytes())?;
            w.element(0x4d80, b"@poe-code/mp4-ast")?;
            w.element(
                0x5741,
                metadata
                    .get("encoder")
                    .map_or(b"@poe-code/mp4-ast", String::as_bytes),
            )?;
            if let Some(title) = metadata.get("title").filter(|s| !s.is_empty()) {
                w.element(0x7ba9, title.as_bytes())?;
            }
            Ok(())
        })?;
        w.element(0x1654ae6b, &entries.bytes)?;
        let mut tags = [
            "title", "artist", "album", "date", "comment", "genre", "encoder",
        ]
        .into_iter()
        .filter_map(|k| metadata.get(k).filter(|v| !v.is_empty()).map(|v| (k, v)))
        .peekable();
        if tags.peek().is_some() {
            w.group(0x1254c367, |w| {
                w.group(0x7373, |w| {
                    w.element(0x63c0, &[])?;
                    for (key, value) in tags {
                        w.group(0x67c8, |w| {
                            w.element(0x45a3, key.to_ascii_uppercase().as_bytes())?;
                            w.element(0x4487, value.as_bytes())
                        })?;
                    }
                    Ok(())
                })
            })?;
        }
        let mut blocks = blocks.into_iter().peekable();
        while let Some(first) = blocks.peek() {
            let start = first.ms;
            w.group(0x1f43b675, |w| {
                w.uint(0xe7, start as u32)?;
                while let Some(b) = blocks.next_if(|b| b.ms - start <= 30000) {
                    let sub = tracks[b.track].kind == "subtitle";
                    let block = |w: &mut Ebml| {
                        w.group(if sub { 0xa1 } else { 0xa3 }, |w| {
                            let [a, c] = ((b.ms - start) as u16).to_be_bytes();
                            w.append(&[
                                0x80 | ((b.track + 1) as u8 & 127),
                                a,
                                c,
                                if b.key && !sub { 128 } else { 0 },
                            ])?;
                            w.append(b.data)
                        })
                    };
                    if sub {
                        w.group(0xa0, |w| {
                            block(w)?;
                            w.uint(0x9b, b.duration as u32)
                        })?;
                    } else {
                        block(w)?;
                    }
                }
                Ok(())
            })?;
        }
        Ok(())
    })?;
    Ok(out.bytes)
}

pub(super) fn as_mp4(
    movie: &super::super::mkv_input::Document<'_>,
    limit: usize,
) -> Result<Vec<u8>> {
    use super::super::super::media_probe::Codec;
    use super::{MATRIX, Sample, VideoCodec, audio_sample_entry, subtitle_entry, video_entry};
    use std::borrow::Cow;

    let mut remaining = limit;
    let mut tracks = Vec::with_capacity(movie.tracks.len());
    for t in &movie.tracks {
        let info = &t.info;
        remaining = remaining
            .checked_sub(
                info.count
                    .saturating_mul(size_of::<Sample>())
                    .saturating_add(size_of::<Track>()),
            )
            .ok_or("sample index exceeds memory budget")?;
        let (kind, handler, name, stsd, width, height) = match info.codec {
            Codec::Video { tag, width, height } => {
                let (w, h) = (width.unwrap_or(320), height.unwrap_or(240));
                let codec = if tag != b"avc1" {
                    VideoCodec::Still(tag)
                } else if t.private.len() >= 7 {
                    VideoCodec::Config(t.private)
                } else {
                    VideoCodec::Avc(30)
                };
                (
                    "video",
                    *b"vide",
                    b"VideoHandler".as_slice(),
                    video_entry(w as usize, h as usize, codec)?,
                    w,
                    h,
                )
            }
            Codec::Audio {
                tag,
                channels,
                bits,
                ..
            } => {
                let rate = t.sample_rate.unwrap_or(44100);
                let fallback = audio_specific_config(rate, channels, 2);
                (
                    "audio",
                    *b"soun",
                    b"SoundHandler".as_slice(),
                    audio_sample_entry(
                        tag,
                        rate,
                        channels,
                        bits,
                        if t.private.is_empty() {
                            &fallback
                        } else {
                            t.private
                        },
                    ),
                    0,
                    0,
                )
            }
            Codec::Subtitle { .. } => (
                "subtitle",
                *b"sbtl",
                b"SubtitleHandler".as_slice(),
                subtitle_entry(),
                0,
                0,
            ),
        };
        let language = info
            .language
            .to_lowercase()
            .encode_utf16()
            .chain(std::iter::repeat(u16::from(b'u')))
            .take(3)
            .fold(0, |n, c| (n << 5) | c.saturating_sub(96).clamp(1, 26));
        let mut samples = Vec::with_capacity(info.count);
        for (p, data) in t.packets() {
            let data = if p.size > data.len() as u64 {
                remaining = remaining
                    .checked_sub(p.size as usize)
                    .ok_or("sample index exceeds memory budget")?;
                let mut v = Vec::with_capacity(p.size as usize);
                v.extend_from_slice(&(data.len() as u16).to_be_bytes());
                v.extend_from_slice(data);
                Cow::Owned(v)
            } else {
                Cow::Borrowed(data)
            };
            samples.push(Sample {
                data,
                duration: p.ticks.round() as u32,
                cts: 0,
                key: p.key,
                description: 1,
            });
        }
        let ticks = if info.count == 0 {
            info.ticks
        } else {
            info.sample_ticks
        };
        tracks.push(Track {
            id: info.id as u32,
            scale: info.scale,
            media_ticks: ticks as u32,
            movie_ticks: (ticks / f64::from(info.scale) * 1000.).round() as u32,
            samples,
            first_dts: info.start as u64,
            fragment_sample_size: None,
            stsd: stsd.into(),
            edits: vec![],
            kind,
            handler,
            name,
            width,
            height,
            volume: if kind == "audio" { 256 } else { 0 },
            enabled: true,
            language,
            matrix: MATRIX,
        });
    }
    super::write(
        &tracks,
        1000,
        b"isom\0\0\x02\0isomiso2avc1mp41",
        &movie
            .tags
            .iter()
            .map(|(k, v)| ((*k).into(), v.clone()))
            .collect(),
        &[],
        false,
        limit,
    )
}
