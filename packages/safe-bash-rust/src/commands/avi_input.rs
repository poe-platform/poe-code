use super::super::structured::JVal;
use super::media_probe::{self, Codec, Packet, ProbeOptions, StreamInfo};

// RIFF chunks exclude their alignment byte from the declared size. LISTs
// bound their own children, independently of the enclosing file's length.
struct Chunks<'a> {
    levels: Vec<&'a [u8]>,
    limit: usize,
}
struct Chunk<'a> {
    tag: &'a [u8],
    size: usize,
    rest: &'a [u8],
    body: &'a [u8],
}
impl<'a> Chunks<'a> {
    fn new(bytes: &'a [u8], limit: usize) -> Self {
        Self {
            levels: vec![bytes],
            limit,
        }
    }
    fn next(&mut self) -> Result<Option<Chunk<'a>>, &'static str> {
        while let Some(bytes) = self.levels.last_mut() {
            let Some(header) = bytes.get(..8) else {
                self.levels.pop();
                continue;
            };
            let size = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
            let rest = &bytes[8..];
            let (body, tail) = rest.split_at(size.min(rest.len()));
            *bytes = tail.get(size & 1..).unwrap_or_default();
            if &header[..4] == b"LIST"
                && let Some(kind) = body.get(..4)
                && matches!(kind, b"hdrl" | b"strl" | b"movi")
            {
                if self.levels.len() >= self.limit / size_of::<&[u8]>() {
                    return Err("chunk index exceeds memory budget");
                }
                self.levels.push(&body[4..]);
            }
            return Ok(Some(Chunk {
                tag: &header[..4],
                size,
                rest,
                body,
            }));
        }
        Ok(None)
    }
}
const BOUNDS: &str = "Offset is outside the bounds of the DataView";
fn word(bytes: &[u8], at: usize) -> Result<u32, &'static str> {
    Ok(u32::from_le_bytes(
        bytes.get(at..at + 4).ok_or(BOUNDS)?.try_into().unwrap(),
    ))
}
fn short(bytes: &[u8], at: usize) -> Result<u16, &'static str> {
    Ok(u16::from_le_bytes(
        bytes.get(at..at + 2).ok_or(BOUNDS)?.try_into().unwrap(),
    ))
}
fn stream_index(tag: &[u8]) -> Option<usize> {
    match tag {
        [a @ b'0'..=b'9', b @ b'0'..=b'9', c, d]
            if matches!((c, d), (b'd', b'c' | b'b') | (b'w', b'b')) =>
        {
            Some(usize::from((a - b'0') * 10 + b - b'0'))
        }
        _ => None,
    }
}

fn start_code(bytes: &[u8]) -> Option<(usize, usize)> {
    let pos = bytes.windows(3).position(|s| s == [0, 0, 1])?;
    Some((
        if pos > 0 && bytes[pos - 1] == 0 {
            pos - 1
        } else {
            pos
        },
        pos + 3,
    ))
}
pub(super) fn annex_b(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && (bytes.starts_with(&[0, 0, 1]) || bytes.starts_with(&[0, 0, 0, 1]))
}
pub(super) fn nals(mut bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut start = start_code(bytes);
    std::iter::from_fn(move || {
        loop {
            let (_, off) = start?;
            bytes = &bytes[off..];
            start = start_code(bytes);
            let end = start.map_or(bytes.len(), |(pos, _)| pos);
            if end != 0 {
                return Some(&bytes[..end]);
            }
        }
    })
}
fn video_packet(mut bytes: &[u8]) -> (u64, bool) {
    let original = bytes.len() as u64;
    if annex_b(bytes) {
        let (mut size, mut key) = (0, false);
        for nal in nals(bytes) {
            let kind = nal[0] & 31;
            if !matches!(kind, 7..=9) {
                size += 4 + nal.len() as u64;
                key |= kind == 5;
            }
        }
        return (if size == 0 { original } else { size }, key);
    }
    while let Some(prefix) = bytes.get(..4) {
        let n = u32::from_be_bytes(prefix.try_into().unwrap()) as usize;
        let Some(payload) = bytes[4..].get(..n).filter(|v| !v.is_empty()) else {
            break;
        };
        if payload[0] & 31 == 5 {
            return (original, true);
        }
        bytes = &bytes[4 + n..];
    }
    (original, false)
}

enum Header<'a> {
    Video {
        handler: &'a [u8],
        extra: &'a [u8],
        fps: f64,
        width: Option<i64>,
        height: Option<u32>,
        tick: u32,
    },
    Audio {
        rate: u32,
        channels: u32,
        bits: u32,
        format: u16,
    },
    Other,
}
pub(super) struct Track<'a> {
    pub info: StreamInfo,
    pub packets: Vec<Packet>,
    pub bodies: Vec<&'a [u8]>,
    pub extra: &'a [u8],
    pub fps: f64,
    tick: u32,
    mpeg4: bool,
    ordinal: usize,
    chunks: usize,
}
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Read {
    Summary,
    Packets,
    Payloads,
}
impl<'a> Track<'a> {
    fn add(&mut self, c: Chunk<'a>, mode: Read, budget: &mut usize) -> Result<(), &'static str> {
        let video = matches!(self.info.codec, Codec::Video { .. });
        let mut key = self.chunks == 0 || matches!(&c.tag[2..], b"wb" | b"db");
        self.chunks += 1;
        let ticks = f64::from(self.tick);
        if c.body.is_empty() {
            if video && self.info.count != 0 {
                self.info.sample_ticks += ticks;
                if let Some(last) = self.packets.last_mut() {
                    last.ticks += ticks;
                }
            }
            return Ok(());
        }
        let mut size = c.body.len() as u64;
        if video {
            let (n, idr) = video_packet(c.body);
            size = n;
            key |= idr || self.info.count == 0;
        } else if matches!(self.info.codec, Codec::Audio { tag: b"mp4a", .. })
            && c.body.len() > 7
            && c.body[0] == 255
            && c.body[1] & 0xf0 == 0xf0
        {
            let n = if c.body[1] & 1 == 0 { 9 } else { 7 };
            if size > n {
                size -= n;
            }
        }
        if mode == Read::Payloads {
            *budget = budget
                .checked_sub(size_of::<&[u8]>())
                .ok_or("sample index exceeds memory budget")?;
            self.bodies.push(c.body);
        }
        if mode != Read::Summary {
            *budget = budget
                .checked_sub(size_of::<Packet>())
                .ok_or("sample index exceeds memory budget")?;
            let dts = self.info.sample_ticks as i64;
            self.packets.push(Packet {
                dts,
                pts: dts,
                ticks,
                size,
                key,
                pos: self.info.payload_bytes,
            });
        }
        self.info.count += 1;
        self.info.ticks += ticks;
        self.info.sample_ticks += ticks;
        self.info.payload_bytes += size;
        Ok(())
    }
}

pub(super) fn check_header(bytes: &[u8]) -> Result<(), &'static str> {
    if !bytes.starts_with(b"RIFF") || bytes.get(8..12) != Some(b"AVI ") {
        return Err("Invalid AVI file: missing RIFF AVI header");
    }
    Ok(())
}
pub(super) fn parse(
    bytes: &[u8],
    limit: usize,
    mode: Read,
) -> Result<Vec<Option<Track<'_>>>, &'static str> {
    check_header(bytes)?;
    let data = &bytes[12..];
    let mut chunks = Chunks::new(data, limit);
    let (mut width, mut height) = (320i64, 240u32);
    let mut streams = Vec::new();
    let mut budget = limit;
    while let Some(c) = chunks.next()? {
        match c.tag {
            b"avih" if c.size >= 40 => {
                let (w, h) = (word(c.rest, 32)?, word(c.rest, 36)?);
                if w != 0 {
                    width = i64::from(w);
                }
                if h != 0 {
                    height = h;
                }
            }
            b"strh" if c.size >= 48 => {
                let rate = word(c.rest, 24)?;
                let scale = word(c.rest, 20)?.max(1);
                let fps = f64::from(if rate == 0 { 30 } else { rate }) / f64::from(scale);
                budget = budget
                    .checked_sub(size_of::<Header>() + size_of::<Option<Track>>())
                    .ok_or("stream index exceeds memory budget")?;
                streams.push(match &c.rest[..4] {
                    b"vids" => Header::Video {
                        handler: &c.rest[4..8],
                        extra: &[],
                        fps,
                        width: None,
                        height: None,
                        tick: (90000. / fps.max(1.)).round().max(1.) as u32,
                    },
                    b"auds" => Header::Audio {
                        rate: 44100,
                        channels: 2,
                        bits: 16,
                        format: 1,
                    },
                    _ => Header::Other,
                });
            }
            b"strf" => match streams.last_mut() {
                Some(Header::Video {
                    handler,
                    extra,
                    width: w,
                    height: h,
                    ..
                }) if c.size >= 40 => {
                    if c.size > 40 {
                        *extra = c.body.get(40..).unwrap_or_default();
                    }
                    let sw = word(c.rest, 4)? as i32;
                    let sh = word(c.rest, 8)? as i32;
                    *w = Some(if sw == 0 { width } else { sw.into() });
                    *h = Some(if sh == 0 { height } else { sh.unsigned_abs() });
                    if let Some(f) = c.rest.get(16..20)
                        && !f.iter().all(u8::is_ascii_whitespace)
                    {
                        *handler = f;
                    }
                }
                Some(Header::Audio {
                    rate,
                    channels,
                    bits,
                    format,
                }) if c.size >= 14 => {
                    *format = short(c.rest, 0)?;
                    *channels = match short(c.rest, 2)? {
                        0 => 2,
                        n => n.into(),
                    };
                    *rate = match word(c.rest, 4)? {
                        0 => 44100,
                        n => n,
                    };
                    *bits = match short(c.rest, 14)? {
                        0 => 16,
                        n => n.into(),
                    };
                }
                _ => (),
            },
            _ => (),
        }
    }
    let mut ordinals = [0, 0];
    let mut tracks: Vec<_> = streams
        .into_iter()
        .enumerate()
        .map(|(i, h)| {
            let (extra, fps) = match &h {
                Header::Video { extra, fps, .. } => (*extra, *fps),
                _ => (&[][..], 0.),
            };
            let (codec, scale, tick, kind, mpeg4) = match h {
                Header::Video {
                    handler,
                    width: w,
                    height: h,
                    tick,
                    ..
                } => {
                    let mjpeg = handler.eq_ignore_ascii_case(b"MJPG")
                        || handler.eq_ignore_ascii_case(b"JPEG");
                    let mpeg4 = handler.eq_ignore_ascii_case(b"XVID")
                        || handler.eq_ignore_ascii_case(b"FMP4");
                    (
                        Codec::Video {
                            tag: if mjpeg { b"jpeg" } else { b"avc1" },
                            width: Some(w.unwrap_or(width)),
                            height: Some(h.unwrap_or(height)),
                        },
                        90000,
                        tick,
                        0,
                        mpeg4,
                    )
                }
                Header::Audio {
                    rate,
                    channels,
                    bits,
                    format,
                } => (
                    Codec::Audio {
                        tag: match format {
                            0xff => b"mp4a",
                            0x55 => b".mp3",
                            _ => b"sowt",
                        },
                        rate,
                        channels,
                        bits,
                        profile: false,
                    },
                    rate,
                    1024,
                    1,
                    false,
                ),
                Header::Other => return None,
            };
            let ordinal = ordinals[kind];
            ordinals[kind] += 1;
            Some(Track {
                info: StreamInfo {
                    codec,
                    scale,
                    start: 0,
                    ticks: 0.,
                    sample_ticks: 0.,
                    id: i as u64 + 1,
                    language: "und".into(),
                    profile: None,
                    count: 0,
                    payload_bytes: 0,
                    has_cts: false,
                },
                packets: vec![],
                bodies: vec![],
                extra,
                fps,
                tick,
                mpeg4,
                ordinal,
                chunks: 0,
            })
        })
        .collect();
    let mut chunks = Chunks::new(data, limit);
    while let Some(c) = chunks.next()? {
        if let Some(t) = stream_index(c.tag)
            .and_then(|i| tracks.get_mut(i))
            .and_then(Option::as_mut)
        {
            t.add(c, mode, &mut budget)?;
        }
    }
    Ok(tracks)
}

pub(super) fn report(
    bytes: &[u8],
    name: &str,
    limit: usize,
    opts: ProbeOptions<'_>,
) -> Result<String, &'static str> {
    let records = opts.show.contains("packet") || opts.show.contains("frame");
    let tracks = parse(
        bytes,
        limit,
        if records {
            Read::Packets
        } else {
            Read::Summary
        },
    )?;
    let tracks = tracks.iter().flatten();
    let (counts, select) = (opts.counts, opts.select);
    media_probe::report(opts, |section| match section {
        "packet" | "frame" => Box::new(tracks.clone().enumerate().flat_map(move |(i, t)| {
            t.packets
                .iter()
                .map(move |p| t.info.codec.record(i, t.info.scale, *p, section == "frame"))
        })),
        "stream" => Box::new(
            tracks
                .clone()
                .enumerate()
                .filter(move |(i, t)| {
                    media_probe::selected(
                        select,
                        if matches!(t.info.codec, Codec::Video { .. }) {
                            "video"
                        } else {
                            "audio"
                        },
                        *i,
                        t.ordinal,
                    )
                })
                .map(|(i, t)| {
                    let mut row = t.info.stream(i, counts);
                    // AVI's XVID/FMP4 handler reports MPEG-4 part 2 with the avc1 tag.
                    if t.mpeg4 {
                        for (k, v) in &mut row {
                            match *k {
                                "codec_name" => *v = JVal::Str("mpeg4".into()),
                                "codec_long_name" => *v = JVal::Str("MPEG-4 part 2".into()),
                                _ => (),
                            }
                        }
                    }
                    row
                }),
        ),
        "format" => Box::new(std::iter::once(media_probe::format_row(
            name,
            bytes.len(),
            ("avi", "AVI (Audio Video Interleaved)"),
            tracks.clone().count(),
            tracks
                .clone()
                .map(|t| t.info.ticks / f64::from(t.info.scale))
                .fold(0., f64::max),
            vec![],
        ))),
        _ => Box::new(std::iter::empty()),
    })
}
