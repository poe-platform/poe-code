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
    source_tags: &[&[u8]],
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
            w.element(0x22b59c, &lang)?;
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
                let rate = audio.rate.unwrap_or(rate);
                channels = audio.channels.unwrap_or(ch);
                if audio.clear_samples {
                    timescale = rate;
                }
                if codec == b"A_AAC" {
                    let fallback = audio_specific_config(rate, channels, 2);
                    w.element(
                        0x63a2,
                        if audio.clear_samples || !source_tags[i].is_empty() {
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
        let mut sample = |pts: f64, ticks: u32, data, key| -> Result<()> {
            if blocks.len() >= audio.limit / size_of::<Block>() {
                return Err("sample index exceeds memory budget");
            }
            let scale = f64::from(timescale.max(1));
            let ms = (pts / scale * 1000.).round() as u64;
            duration = duration.max(((pts + f64::from(ticks)) / scale * 1000.).round() as u64);
            blocks.push(Block {
                ms,
                duration: ((f64::from(ticks) / scale * 1000.).round() as u64).max(1),
                track: i,
                key,
                data,
            });
            Ok(())
        };
        if t.kind == "audio" && audio.clear_samples {
            sample(0., 1024, super::super::super::adts::silent(channels), true)?;
        } else {
            let mut dts = t.first_dts;
            let mut source_ms =
                super::super::flv_input::timestamps(source_tags[i], t.kind == "video");
            for s in &t.samples {
                sample(
                    source_ms.next().map_or(dts as f64, f64::from) + s.cts as f64,
                    s.duration,
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
