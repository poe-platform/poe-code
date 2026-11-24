#[path = "h264.rs"]
pub(super) mod h264;
#[path = "mpegts_input.rs"]
pub(super) mod mpegts_input;
#[path = "flv_input.rs"]
pub(super) mod flv_input;
#[path = "mkv_input.rs"]
pub(super) mod mkv_input;
#[path = "mov_text.rs"]
mod mov_text;
#[path = "mp4_mux.rs"]
pub(super) mod mux;

// Atom lengths include their own header. A zero length occupies the remainder of
// its parent; extended lengths include the extra eight bytes used for the size.
fn spans(mut bytes: &[u8]) -> impl Iterator<Item = (usize, &[u8; 4], &[u8])> {
    let total = bytes.len();
    std::iter::from_fn(move || {
        let kind: &[u8; 4] = bytes.get(4..8)?.try_into().ok()?;
        let (len, mut header) = match u32::from_be_bytes(bytes[..4].try_into().ok()?) {
            0 => (bytes.len() as u64, 8),
            1 => (u64::from_be_bytes(bytes.get(8..16)?.try_into().ok()?), 16),
            n => (u64::from(n), 8),
        };
        let end = if len < header as u64 || len > bytes.len() as u64 {
            bytes.len()
        } else {
            len as usize
        };
        if kind == b"uuid" && end >= header + 16 {
            header += 16;
        }
        let payload = &bytes[header..end];
        let offset = total - bytes.len();
        bytes = &bytes[end..];
        Some((offset, kind, payload))
    })
}

fn atoms(bytes: &[u8]) -> impl Iterator<Item = (&[u8; 4], &[u8])> {
    spans(bytes).map(|(_, k, v)| (k, v))
}

pub(super) fn movie(input: &[u8]) -> Result<&[u8], &'static str> {
    atoms(input)
        .find_map(|(kind, payload)| (kind == b"moov").then_some(payload))
        .ok_or("Invalid MP4/ISOBMFF file: missing 'moov' atom")
}

pub(super) fn ignore_editlist(input: &mut [u8], limit: usize) -> Result<(), &'static str> {
    let mut edits = Vec::new();
    for (_, trak) in atoms(movie(input)?).filter(|(tag, _)| *tag == b"trak") {
        for (offset, _, _) in spans(trak).filter(|(_, tag, _)| *tag == b"edts") {
            if edits.len() >= limit / size_of::<usize>() { return Err("edit index exceeds memory budget"); }
            edits.push(trak.as_ptr() as usize - input.as_ptr() as usize + offset + 4);
        }
    }
    for offset in edits { input[offset..offset+4].copy_from_slice(b"free"); }
    Ok(())
}

use super::super::structured::JVal::{Number, Object, Str};
use super::media_probe::{self, ProbeOptions, Row};

fn child<'a>(bytes: &'a [u8], name: &[u8; 4]) -> &'a [u8] {
    atoms(bytes)
        .find_map(|(k, v)| (k == name).then_some(v))
        .unwrap_or_default()
}
fn u16_at(b: &[u8], i: usize) -> u16 {
    b.get(i..i + 2)
        .map_or(0, |v| u16::from_be_bytes(v.try_into().unwrap()))
}
fn u32_at(b: &[u8], i: usize) -> u32 {
    b.get(i..i + 4)
        .map_or(0, |v| u32::from_be_bytes(v.try_into().unwrap()))
}
fn wide(b: &[u8], i: usize, long: bool) -> u64 {
    if long {
        b.get(i..i + 8)
            .map_or(0, |v| u64::from_be_bytes(v.try_into().unwrap()))
    } else {
        u32_at(b, i).into()
    }
}
fn rows(b: &[u8], width: usize) -> impl Iterator<Item = &[u8]> + Clone {
    b.get(8..)
        .unwrap_or_default()
        .chunks(width)
        .take(u32_at(b, 4) as usize)
}

#[derive(Clone, Copy)]
struct Sample {
    tick: u32,
    description: u32,
    dts: u64,
    pts: i128,
    size: u64,
    offset: usize,
    pos: u64,
    key: bool,
    chunk_end: bool,
}

struct Tables<'a> {
    timing: &'a [u8],
    composition: &'a [u8],
    mapping: &'a [u8],
    sizes: &'a [u8],
    chunks: &'a [u8],
    long: bool,
    sync: Option<std::collections::HashSet<u32>>,
}
impl Tables<'_> {
    fn read(stbl: &[u8]) -> Tables<'_> {
        let offsets = child(stbl, b"stco");
        let long = offsets.len() < 8;
        Tables {
            timing: child(stbl, b"stts"),
            composition: child(stbl, b"ctts"),
            mapping: child(stbl, b"stsc"),
            sizes: child(stbl, b"stsz"),
            chunks: if long { child(stbl, b"co64") } else { offsets },
            long,
            sync: atoms(stbl)
                .find(|(k, _)| *k == b"stss")
                .map(|(_, v)| rows(v, 4).map(|r| u32_at(r, 0)).collect()),
        }
    }
    fn samples(&self, input_size: usize) -> impl Iterator<Item = Sample> + '_ {
        let count = u32_at(self.sizes, 8);
        let fixed = u32_at(self.sizes, 4);
        let mut chunks = rows(self.chunks, if self.long { 8 } else { 4 }).enumerate();
        let mut mappings = rows(self.mapping, 12).peekable();
        let mut per_chunk = mappings.peek().map_or(0, |r| u32_at(r, 4));
        let mut description = mappings.peek().map_or(1, |r| u32_at(r, 8).max(1));
        let mut timing = rows(self.timing, 8);
        let mut composition = rows(self.composition, 8);
        let (mut left, mut delta, mut cleft, mut cts) = (0, 1024, 0, 0);
        let (mut chunk_left, mut cursor, mut n, mut dts, mut pos) = (0, 0u64, 0, 0u64, 0);
        std::iter::from_fn(move || {
            if n >= count {
                return None;
            }
            while chunk_left == 0 {
                let (i, offset) = chunks.next()?;
                while mappings
                    .peek()
                    .is_some_and(|r| u32_at(r, 0) as usize <= i + 1)
                {
                    let row = mappings.next().unwrap();
                    per_chunk = u32_at(row, 4);
                    description = u32_at(row, 8).max(1);
                }
                chunk_left = per_chunk;
                cursor = wide(offset, 0, self.long);
            }
            while left == 0 {
                let Some(r) = timing.next() else { break };
                left = u32_at(r, 0);
                delta = u32_at(r, 4)
            }
            while cleft == 0 {
                let Some(r) = composition.next() else { break };
                cleft = u32_at(r, 0);
                let x = u32_at(r, 4);
                cts = if self.composition.first() == Some(&1) {
                    i64::from(x as i32)
                } else {
                    i64::from(x)
                }
            }
            let declared = if fixed == 0 {
                u32_at(self.sizes, 12 + n as usize * 4)
            } else {
                fixed
            };
            let size = (input_size as u64)
                .saturating_sub(cursor)
                .min(declared.into());
            let key = self.sync.as_ref().is_none_or(|s| {
                if s.is_empty() {
                    n == 0
                } else {
                    s.contains(&(n + 1))
                }
            });
            let sample = Sample {
                tick: delta,
                description,
                dts,
                pts: i128::from(dts) + i128::from(cts),
                size,
                offset: cursor.min(input_size as u64) as usize,
                pos,
                key,
                chunk_end: chunk_left == 1,
            };
            left = left.saturating_sub(1);
            cleft = cleft.saturating_sub(1);
            chunk_left -= 1;
            n += 1;
            pos += size;
            dts += u64::from(delta);
            cursor = cursor.saturating_add(declared.into());
            Some(sample)
        })
    }
}

// A trun stores only fields enabled by its flags. The others come from tfhd or trex.
#[derive(Clone, Copy)]
struct Defaults {
    description: u32,
    duration: u32,
    size: u32,
    flags: u32,
}
struct Run<'a> {
    trun: &'a [u8],
    defaults: Defaults,
    base: u64,
    dts: u64,
    pos: u64,
}
fn next_word(b: &[u8], cursor: &mut usize) -> u32 {
    let v = u32_at(b, *cursor);
    *cursor += 4;
    v
}
impl Run<'_> {
    fn samples(&self, input_size: usize, video: bool) -> impl Iterator<Item = Sample> + '_ {
        let flags = u32_at(self.trun, 0) & 0xff_ffff;
        let mut i = 8;
        let mut off = i128::from(self.base);
        if flags & 1 != 0 {
            off += i128::from(next_word(self.trun, &mut i) as i32)
        }
        let first_flags = if flags & 4 != 0 {
            next_word(self.trun, &mut i)
        } else {
            self.defaults.flags
        };
        let (mut dts, mut pos) = (self.dts, self.pos);
        (0..u32_at(self.trun, 4)).map(move |n| {
            let tick = if flags & 0x100 != 0 {
                next_word(self.trun, &mut i)
            } else {
                self.defaults.duration
            };
            let declared = if flags & 0x200 != 0 {
                next_word(self.trun, &mut i)
            } else {
                self.defaults.size
            };
            let sample_flags = if flags & 0x400 != 0 {
                next_word(self.trun, &mut i)
            } else if n == 0 {
                first_flags
            } else {
                self.defaults.flags
            };
            let cts = if flags & 0x800 != 0 {
                let c = next_word(self.trun, &mut i);
                if self.trun[0] == 1 {
                    i128::from(c as i32)
                } else {
                    i128::from(c)
                }
            } else {
                0
            };
            let offset = off.clamp(0, input_size as i128) as u64;
            let size = (input_size as u64 - offset).min(declared.into());
            let key = (sample_flags >> 24) & 3 == 2
                || (sample_flags & 0x10000 == 0 && (n == 0 || !video));
            let s = Sample {
                tick,
                description: self.defaults.description,
                dts,
                pts: i128::from(dts) + cts,
                size,
                offset: offset as usize,
                pos,
                key,
                chunk_end: true,
            };
            dts = dts.saturating_add(tick.into());
            pos += size;
            off += i128::from(declared);
            s
        })
    }
}

#[derive(Default)]
struct Stats {
    count: usize,
    ticks: u64,
    bytes: u64,
    start: i128,
    b_frames: bool,
    media_end: i128,
}
impl Stats {
    fn add(&mut self, s: &Sample) {
        if self.count == 0 {
            self.start = s.pts
        }
        self.count += 1;
        self.ticks += u64::from(s.tick);
        self.bytes += s.size;
        self.b_frames |= s.pts != i128::from(s.dts);
        self.media_end = self.media_end.max(s.pts + i128::from(s.tick));
    }
}
fn check_samples(n: usize) -> Result<(), String> {
    if n > 200_000 {
        Err(format!(
            "Resource limit exceeded for maxSamplesPerTrack: {n} exceeds maximum allowed 200000"
        ))
    } else {
        Ok(())
    }
}

// MPEG-4 ES descriptors contain a variable-length header. The decoder-specific
// descriptor holds the actual sampling frequency and channel configuration.
struct AudioConfig {
    indication: u8,
    object: u8,
    rate: u32,
    channels: u16,
}
fn decoder_config(payload: &[u8]) -> (u8, Option<&[u8]>) {
    let mut at = if payload.len() >= 4 { 4 } else { 0 };
    let mut indication = 0x40;
    while let Some(&tag) = payload.get(at) {
        at += 1;
        let mut len = 0;
        for _ in 0..4 {
            let Some(&b) = payload.get(at) else { break };
            at += 1;
            len = (len << 7) | usize::from(b & 127);
            if b & 128 == 0 {
                break;
            }
        }
        match tag {
            3 => {
                let flags = payload.get(at + 2).copied().unwrap_or(0);
                at += 3;
                if flags & 128 != 0 {
                    at += 2
                }
                if flags & 64 != 0 {
                    at += 1 + usize::from(payload.get(at).copied().unwrap_or(0))
                }
                if flags & 32 != 0 {
                    at += 2
                }
            }
            4 => {
                indication = payload.get(at).copied().unwrap_or(0);
                at += 13
            }
            5 => {
                return (indication, payload.get(at..at.saturating_add(len).min(payload.len())));
            }
            _ => at = at.saturating_add(len),
        }
    }
    (indication, None)
}
fn audio_entry_format(tag:&[u8;4])->bool {
    matches!(tag, b"mp4a" | b"Opus" | b"fLaC" | b"alac" | b"samr" | b"sawb" | b"ac-3" | b"ec-3" | b"sowt" | b"twos" | b"lpcm" | b"ipcm" | b"fpcm" | b"raw " | b"in24" | b"in32" | b"fl32" | b"fl64" | b".mp3" | b"ulaw" | b"alaw")
}
fn esds(payload: &[u8]) -> AudioConfig {
    let (indication, asc) = decoder_config(payload);
    let (object, rate, channels) = audio_config(asc.unwrap_or_default());
    AudioConfig { indication, object, rate, channels: channels.into() }
}

fn audio_config(asc: &[u8]) -> (u8, u32, u8) {
    let asc = if asc.len() < 2 { &[0x12, 0x10] } else { asc };
    let mut bits = 0u64;
    for (i, &b) in asc.iter().take(6).enumerate() {
        bits |= u64::from(b) << (56 - i * 8)
    }
    let mut take = |n: u32| {
        let v = (bits >> (64 - n)) as u32;
        bits <<= n;
        v
    };
    let object = match take(5) {
        31 => 32 + take(6),
        v => v,
    } as u8;
    let rate = match take(4) {
        15 => take(24),
        i => super::adts::RATES.get(i as usize).copied().unwrap_or(44100),
    };
    let channels = match take(4) {
        0 => 2,
        v => v as u8,
    };
    (object, rate, channels)
}

#[derive(Clone, Copy, Default)]
enum Original<'a> {
    #[default]
    None,
    Avi(&'a super::avi_input::Description),
    Transport(&'a mpegts_input::Description),
    Flv(&'a [u8]),
    Fragmented(&'a Track<'a>, usize),
    Matroska(&'a mkv_input::Track<'a>),
}
impl<'a> Original<'a> {
    fn avi(self) -> Option<&'a super::avi_input::Description> {
        if let Self::Avi(track) = self {Some(track)} else {None}
    }
    fn avcc(self, entry: &'a [u8]) -> Option<&'a [u8]> {
        if let Some(t) = self.avi() && !t.jpeg_avcc.is_empty() {
            return Some(&t.jpeg_avcc);
        }
        if let Self::Transport(t) = self && !t.avcc.is_empty() {return Some(&t.avcc);}
        atoms(entry.get(78..).unwrap_or_default())
            .find(|(k, _)| *k == b"avcC").map(|(_, body)| body)
    }
    fn matroska(self) -> Option<&'a mkv_input::Track<'a>> {
        match self {
            Self::Matroska(track) => Some(track),
            _ => None,
        }
    }
    fn timestamps(&self, video: bool) -> Box<dyn Iterator<Item = u64> + '_> {
        match self {
            Self::None | Self::Avi(_) => Box::new(std::iter::empty()),
            Self::Fragmented(t, len) => Box::new(t.samples(*len).map(|s|s.dts)),
            Self::Transport(t) => Box::new(t.packets.iter().map(|p|p.dts as u64)),
            Self::Flv(tags) => Box::new(flv_input::timestamps(tags, video).map(u64::from)),
            Self::Matroska(t) => Box::new(t.blocks.iter().map(|b| b.dts as u64)),
        }
    }
}

struct Track<'a> {
    index: usize,
    id: u32,
    kind: &'static str,
    scale: u32,
    duration: u64,
    origin: u64,
    edit_duration: Option<u64>,
    empty_ticks: u64,
    negative_edit: bool,
    probe_origin: u64,
    tag: &'a [u8; 4],
    sample_tag: &'a [u8; 4],
    audio: Option<AudioConfig>,
    sequence: Option<h264::Sequence>,
    other_video: Vec<(&'a [u8; 4], &'a [u8])>,
    sar: (u32, u32),
    entry: &'a [u8],
    width: u32,
    height: u32,
    enabled: bool,
    rotation: u16,
    language: String,
    handler: &'a [u8],
    stats: Stats,
    runs: Vec<Run<'a>>,
    tables: Tables<'a>,
    original: Original<'a>,
}
fn header_time(b: &[u8], fallback: u32) -> (u32, u64) {
    if b.len() < 20 {
        return (fallback, 0);
    }
    let long = b[0] == 1;
    let i = if long { 20 } else { 12 };
    let scale = u32_at(b, i);
    (if scale == 0 { 1000 } else { scale }, wide(b, i + 4, long))
}
// Decoded PCM supplies its sample count to the demuxer loop clock; video
// contributes its last timestamp without the final packet duration.
fn pcm_loop_duration(input: &[u8], selected: &[usize], seek: Option<f64>) -> Result<f64, String> {
    let (tracks, _) = read_tracks(input, movie(input)?)?;
    let (mut start, mut end, mut end_scale) = (f64::INFINITY, f64::NEG_INFINITY, 1u32);
    let input_start = tracks.iter().filter(|t| t.kind != "data").map(|t| t.stats.start as f64 / f64::from(t.scale)).reduce(f64::min).unwrap_or(0.);
    let video = tracks.iter().find(|t| t.kind == "video");
    for t in &tracks {
        if !selected.is_empty() && !selected.contains(&t.index) { continue; }
        let skip = if t.tag == b"mp4a" { seek.map_or(0, |seek| t.aac_seek_sample(input.len(), input_start + seek, video)) } else { 0 };
        for s in t.samples(input.len()).skip(skip) {
            if t.discarded_pcm_sample(&s) { continue; }
            let length = if let Some(format) = t.pcm_format() {
                let rate = t.audio_rate().filter(|&rate| rate > 0).ok_or("Invalid PCM sample rate")?;
                if t.channels() == 0 { return Err("Invalid PCM channel count".into()); }
                s.size as f64 / f64::from(t.channels()) / f64::from(format.bits() / 8) / f64::from(rate)
            } else if t.tag == b"mp4a" && !t.discarded_packet(&s) {
                1024. / f64::from(t.audio_rate().filter(|&rate| rate > 0).ok_or("Invalid AAC sample rate")?)
            } else { 0. };
            let offset = (((input_start + seek.unwrap_or(0.)) * 1_000_000.).round() * f64::from(t.scale) / 1_000_000.).round() as i128;
            let pts = (s.pts - i128::from(t.origin) + i128::from(t.empty_ticks) - offset) as f64 / f64::from(t.scale);
            start = start.min(pts);
            if pts + length > end {
                end = pts + length;
                end_scale = if t.tag == b"mp4a" { t.audio_rate().unwrap_or(t.scale) } else { t.scale };
            }
        }
    }
    Ok(((end * f64::from(end_scale)).round() - (start * f64::from(end_scale)).round()).max(0.) / f64::from(end_scale))
}
impl<'a> Track<'a> {
    fn parse(
        trak: &'a [u8],
        index: usize,
        movie_scale: u32,
        input: &'a [u8],
        mvex: &[u8],
    ) -> Result<Self, String> {
        let input_size = input.len();
        let tk = child(trak, b"tkhd");
        let long = tk.first() == Some(&1);
        let i = if long { 20 } else { 12 };
        let id = match u32_at(tk, i) {
            0 => index as u32 + 1,
            x => x,
        };
        let header_duration = wide(tk, i + 8, long);
        let dims = if long { 88 } else { 76 };
        let fixed = |i| ((u64::from(u32_at(tk, i)) + 32768) >> 16) as u32;
        let mdia = child(trak, b"mdia");
        let md = child(mdia, b"mdhd");
        let (scale, declared) = header_time(md, movie_scale);
        let lang = u16_at(md, if md.first() == Some(&1) { 32 } else { 20 });
        let codes = [(lang >> 10) & 31, (lang >> 5) & 31, lang & 31];
        let language = if codes.iter().all(|v| (1..=26).contains(v)) {
            codes.map(|v| char::from(96 + v as u8)).iter().collect()
        } else {
            "und".into()
        };
        let h = child(mdia, b"hdlr");
        let chapter_track = atoms(movie(input)?).filter(|(k, _)| *k == b"trak")
            .any(|(_, t)| child(child(t, b"tref"), b"chap").chunks_exact(4).any(|b| u32_at(b, 0) == id));
        let kind = match h.get(8..12) {
            Some(kind) if chapter_track && kind != b"vide" => "data",
            Some(b"vide") | None => "video",
            Some(b"soun") => "audio",
            Some(b"sbtl" | b"text" | b"subp") => "subtitle",
            _ => "data",
        };
        let handler = h
            .get(24..)
            .unwrap_or_default()
            .split(|&b| b == 0)
            .next()
            .unwrap_or_default();
        let stbl = child(child(mdia, b"minf"), b"stbl");
        let tables = Tables::read(stbl);
        let n = u32_at(tables.sizes, 8);
        check_samples(n as usize)?;
        let stsd = child(stbl, b"stsd");
        let mut descriptions = atoms(stsd.get(8..).unwrap_or_default());
        let (tag, entry) = descriptions
            .next()
            .unwrap_or((if kind == "video" { b"avc1" } else { b"mp4a" }, &[]));
        let sample_tag = tag;
        let tag = if tag == b"mp4v" && decoder_config(child(entry.get(78..).unwrap_or_default(), b"esds")).0 == 0x6d { b"png " } else { tag };
        // An unknown audio FourCC is opaque: the track still has a timescale,
        // but its bytes do not declare a QuickTime audio sample entry.
        let entry = if kind == "audio" && !audio_entry_format(tag) {
            &[][..]
        } else { entry };
        if matches!(tag, b"ipcm" | b"fpcm") {
            let config = child(entry.get(28..).unwrap_or_default(), b"pcmC");
            if config.len() < 6 || u32_at(config, 0) != 0
                || !match tag { b"ipcm" => matches!(config[5], 16 | 24 | 32), _ => matches!(config[5], 32 | 64) } {
                return Err("Invalid MP4 PCM configuration".into());
            }
        }
        let mut sequence = None;
        let mut sar = (1, 1);
        if matches!(
            tag,
            b"avc1"
                | b"avc3"
                | b"hvc1"
                | b"hev1"
                | b"av01"
                | b"vp09"
                | b"vp08"
                | b"mp4v"
                | b"jpeg"
                | b"mjpa"
                | b"png "
                | b"s263"
        ) {
            for (k, body) in atoms(entry.get(78..).unwrap_or_default()) {
                match k {
                    b"avcC" => {
                        if let Some(s) = h264::Sequence::from_config(body) {
                            sar = s.sar;
                            sequence = Some(s)
                        }
                    }
                    b"pasp" if body.len() >= 8 => {
                        sar = (u32_at(body, 0).max(1), u32_at(body, 4).max(1))
                    }
                    _ => {}
                }
            }
        }
        let mut other_video = Vec::new();
        if kind == "video" {
            for (tag, entry) in descriptions {
                if other_video.len() >= input_size / size_of::<(&[u8; 4], &[u8])>() {
                    return Err("video description index exceeds memory budget".into());
                }
                other_video.push((tag, entry));
            }
        }
        let audio = if kind == "audio" {
            let offset = match u16_at(entry, 8) {
                1 => 44,
                2 => 64,
                _ => 28,
            };
            atoms(entry.get(offset..).unwrap_or_default())
                .filter(|(k, _)| *k == b"esds")
                .last()
                .map(|(_, b)| esds(b))
        } else {
            None
        };
        let mut stats = Stats::default();
        let mut gap_ticks = 0;
        for s in tables.samples(input_size) {
            // Classic timed text uses a zero-length string to clear the screen.
            // It is a packet on the timeline but contributes no cue duration.
            if kind == "subtitle" && s.size >= 2 && u16_at(input, s.offset) == 0 {
                gap_ticks += u64::from(s.tick);
            }
            stats.add(&s)
        }
        let mut defaults = Defaults {
            description: 1,
            duration: if kind == "video" { 3000 } else { 1024 },
            size: 0,
            flags: 0,
        };
        for (_, trex) in
            atoms(mvex).filter(|(k, v)| *k == b"trex" && v.len() >= 24 && u32_at(v, 4) == id)
        {
            defaults = Defaults {
                description: u32_at(trex, 8).max(1),
                duration: match u32_at(trex, 12) {
                    0 => 1024,
                    x => x,
                },
                size: u32_at(trex, 16),
                flags: u32_at(trex, 20),
            };
        }
        let mut runs = Vec::new();
        let mut dts = stats.ticks;
        let mut fragmented = false;
        for (offset, _, moof) in spans(input).filter(|(_, k, _)| *k == b"moof") {
            fragmented = true;
            for (_, traf) in atoms(moof).filter(|(k, _)| *k == b"traf") {
                let h = child(traf, b"tfhd");
                if h.len() < 8 || u32_at(h, 4) != id {
                    continue;
                }
                let flags = u32_at(h, 0);
                let mut at = 8;
                let base = if flags & 1 != 0 {
                    at += 8;
                    wide(h, 8, true)
                } else {
                    offset as u64
                };
                let mut header = defaults;
                if flags & 2 != 0 {
                    header.description = next_word(h, &mut at).max(1);
                }
                if flags & 8 != 0 {
                    header.duration = next_word(h, &mut at)
                }
                if flags & 16 != 0 {
                    header.size = next_word(h, &mut at)
                }
                if flags & 32 != 0 {
                    header.flags = next_word(h, &mut at)
                }
                let tfdt = child(traf, b"tfdt");
                if tfdt.len() >= 8 {
                    dts = wide(tfdt, 4, tfdt[0] == 1)
                }
                for (_, trun) in atoms(traf).filter(|(k, v)| *k == b"trun" && u32_at(v, 4) != 0) {
                    check_samples(stats.count.saturating_add(u32_at(trun, 4) as usize))?;
                    let run = Run {
                        trun,
                        defaults: header,
                        base,
                        dts,
                        pos: stats.bytes,
                    };
                    for s in run.samples(input_size, kind == "video") {
                        dts = s.dts.saturating_add(s.tick.into());
                        stats.add(&s)
                    }
                    runs.push(run);
                }
            }
        }
        let elst = child(child(trak, b"edts"), b"elst");
        let v1 = elst.first() == Some(&1);
        let mut edits = rows(elst, if v1 { 20 } else { 12 }).peekable();
        let media_time = |r: &[u8]| if v1 { wide(r, 8, true) as i64 } else { i64::from(u32_at(r, 4) as i32) };
        let empty_ticks = (rows(elst, if v1 {20} else {12}).take_while(|r|media_time(r) < 0)
            .map(|r|wide(r,0,v1) as f64).sum::<f64>() * f64::from(scale) / f64::from(movie_scale)).round() as u64;
        let origin = rows(elst, if v1 {20} else {12}).find_map(|r|u64::try_from(media_time(r)).ok()).unwrap_or(0);
        let edit_duration = rows(elst, if v1 { 20 } else { 12 }).find(|r| media_time(r) >= 0)
            .map(|r| (wide(r, 0, v1) as f64 * f64::from(scale) / f64::from(movie_scale)).round() as u64);
        // MOV edits align the visible video origin to the first presentation sample.
        let probe_origin = if kind == "video" && origin > 0 && !fragmented {
            tables.samples(input_size).filter(|s|s.pts >= i128::from(origin)).map(|s|s.pts as u64).min().unwrap_or(origin)
        } else { origin };
        if !elst.is_empty() { stats.start = i128::from(empty_ticks); }
        let negative_edit = rows(elst, if v1 { 20 } else { 12 }).any(|r|
            if v1 { (wide(r, 0, true) as i64) < 0 } else { (u32_at(r, 0) as i32) < 0 });
        let duration = if negative_edit {
            declared
        } else if edits.peek().is_some() {
            (edits
                .map(|r| {
                    let seg = wide(r, 0, v1) as f64;
                    let media_time = if v1 {
                        i128::from(wide(r, 8, true) as i64)
                    } else {
                        i128::from(u32_at(r, 4) as i32)
                    };
                    if fragmented && seg == 0. && media_time >= 0 {
                        ((stats.media_end - media_time).max(0) as f64 * f64::from(movie_scale)
                            / f64::from(scale))
                        .round()
                    } else {
                        seg
                    }
                })
                .sum::<f64>()
                * f64::from(scale)
                / f64::from(movie_scale))
            .round() as u64
        } else if stats.ticks > gap_ticks {
            stats.ticks - gap_ticks
        } else if declared != 0 {
            declared
        } else {
            (header_duration as f64 * f64::from(scale) / f64::from(movie_scale)).round() as u64
        };
        // The movie clock rounds edits to whole ticks; keep the media clock's
        // precision when both headers describe the same end of the stream.
        let duration = if declared != 0 && duration.saturating_sub(empty_ticks).abs_diff(declared) < u64::from(scale).div_ceil(u64::from(movie_scale)) {
            declared.saturating_add(empty_ticks)
        } else { duration };
        let duration = if stats.count > 0 { duration.min(stats.ticks.saturating_add(empty_ticks)) } else { duration };
        let width = match fixed(dims) {
            0 if kind == "video" => sequence
                .as_ref()
                .map_or(u32::from(u16_at(entry, 24)), |s| s.width),
            v => v,
        };
        let height = match fixed(dims + 4) {
            0 if kind == "video" => sequence
                .as_ref()
                .map_or(u32::from(u16_at(entry, 26)), |s| s.height),
            v => v,
        };
        let a = u32_at(tk, dims - 36) as i32;
        let b = u32_at(tk, dims - 32) as i32;
        let angle = (f64::from(b).atan2(f64::from(a)).to_degrees() + 0.5).floor() as i32;
        let rotation = match angle.rem_euclid(360) {
            85..=95 => 90, 175..=185 => 180, 265..=275 => 270, _ => 0,
        };
        Ok(Self {
            index,
            id,
            kind,
            scale,
            duration,
            origin,
            edit_duration,
            empty_ticks,
            negative_edit,
            probe_origin,
            tag,
            sample_tag,
            audio,
            sequence,
            other_video,
            sar,
            entry,
            width,
            height,
            rotation,
            enabled: tk.len() < 24 || tk[3] & 1 != 0,
            language,
            handler,
            stats,
            runs,
            tables,
            original: Original::None,
        })
    }
    fn time(&self, ticks: f64) -> String {
        format!("{:.6}", ticks / f64::from(self.scale))
    }
    fn packet_origin(&self, input_size: usize) -> Original<'_> {
        if self.runs.is_empty() {self.original} else {Original::Fragmented(self, input_size)}
    }
    fn samples(&self, input_size: usize) -> impl Iterator<Item = Sample> + '_ {
        let mut timestamps = match self.original {Original::Flv(tags)=>Some(flv_input::timestamps(tags, self.kind=="video")), _=>None};
        let mut blocks=self.original.matroska().map(|t|t.packets());
        let block_scale=self.original.matroska().map_or(self.scale,|t|t.info.scale);
        let mut transport = match self.original { Original::Transport(t) => t.packets.iter(), _ => [].iter() };
        let mut keys = self.original.avi().into_iter().flat_map(|a| &a.audio_keys);
        let samples = self.tables.samples(input_size).map(move |mut s| {
            if let Some(p) = transport.next() {s.pts=p.pts.into();s.dts=p.dts as u64;s.tick=p.ticks as u64 as u32;}
            if let Some(&key) = keys.next() {s.key=key;}
            if let Some((p,_))=blocks.as_mut().and_then(Iterator::next) {
                s.dts=(p.dts as f64 * f64::from(self.scale) / f64::from(block_scale)).round() as u64;
                s.pts=(p.pts as f64 * f64::from(self.scale) / f64::from(block_scale)).round() as i128;
                s.key=p.key;
            }
            if let Some(dts) = timestamps.as_mut().and_then(Iterator::next) {
                s.pts += i128::from(dts) - i128::from(s.dts);
                s.dts = dts.into();
            }
            s
        }).chain(
            self.runs
                .iter()
                .flat_map(move |r| r.samples(input_size, self.kind == "video")),
        );
        let pcm = self.pcm_format().is_some() && self.runs.is_empty() && matches!(self.original,Original::None);
        let mut samples = samples.peekable();
        std::iter::from_fn(move || {
            let mut sample = samples.next()?;
            if pcm && sample.tick == 1 {
                while !sample.chunk_end && sample.tick < 1024 && samples.peek().is_some_and(|next|
                    next.tick == 1 && next.description == sample.description
                    && next.offset == sample.offset + sample.size as usize
                    && next.dts == sample.dts + u64::from(sample.tick)
                    && next.pts == sample.pts + i128::from(sample.tick)) {
                    let next = samples.next().unwrap();
                    sample.tick += 1;
                    sample.size += next.size;
                    sample.chunk_end = next.chunk_end;
                }
            }
            Some(sample)
        })
    }
    fn discarded_pcm_sample(&self, sample: &Sample) -> bool {
        let duration = self.duration.saturating_sub(self.empty_ticks);
        self.pcm_format().is_some() && self.origin <= self.stats.ticks
            && (sample.dts >= self.origin.saturating_add(duration)
                || !self.negative_edit && self.origin > 0 && sample.dts.saturating_add(u64::from(sample.tick)) == self.stats.ticks
                    && sample.dts.saturating_add(duration) <= self.origin)
    }
    fn edit_start(&self, input_size: usize) -> usize {
        if self.kind != "video" || self.origin == 0 || !self.runs.is_empty()
            || !matches!(self.original, Original::None) { return 0; }
        // MOV seeks the edit to the last indexed keyframe whose DTS and PTS
        // precede the media origin. Earlier packets remain in the sample table.
        self.samples(input_size).enumerate()
            .take_while(|(_,s)| s.dts <= self.origin)
            .filter(|(_,s)| s.key && s.pts <= i128::from(self.origin))
            .map(|(i,_)| i).last().unwrap_or(0)
    }
    fn write_subtitles(
        &self,
        input: &[u8],
        writer: &mut super::subtitles::Writer,
        range: (Option<f64>, Option<f64>),
        seek: super::InputTime,
    ) -> Result<(), &'static str> {
        let scale = f64::from(self.scale);
        let ms = |t: i128| (t as f64 * 1000. / scale).round() as i64;
        let from = (seek.start.unwrap_or(0.) * scale).round() as i128;
        let copies = seek.loops.checked_add(1).ok_or("sample index exceeds memory budget")?;
        if self.stats.count.max(1).saturating_mul(copies) > 200_000 { return Err("sample index exceeds memory budget"); }
        // MOV starts the edit at its first in-range sample and retains earlier samples as preroll.
        let edited = matches!(self.tag, b"tx3g" | b"text") && self.origin > 0 && self.runs.is_empty() && matches!(self.original, Original::None);
        let edit_end = i128::from(self.origin) + i128::from(self.duration);
        let mut preroll = 0;
        let mut origin = i128::from(self.origin);
        if edited {
            let mut first = None;
            for s in self.samples(input.len()) {
                if s.pts <= i128::from(self.origin) { preroll = s.pts; }
                if s.pts >= i128::from(self.origin) && s.pts < edit_end { first.get_or_insert(s.pts); }
            }
            origin = first.unwrap_or(preroll);
        }
        let samples = || self.samples(input.len()).filter_map(|mut s| {
            if edited {
                if s.pts < preroll || s.pts >= edit_end { return None; }
                if s.pts + i128::from(s.tick) >= edit_end {
                    // The last indexed subtitle ends at the edited stream duration.
                    s.tick = (i128::from(self.duration) - (s.pts - origin)).clamp(0, i128::from(u32::MAX)) as u32;
                }
            }
            let pts = s.pts - origin;
            (seek.start.is_none() || pts + i128::from(s.tick) > from).then_some(s)
        });
        let mut first = None;
        let mut last = 0;
        for s in samples() {
            first.get_or_insert(s.pts);
            last = last.max(s.pts + i128::from(s.tick));
        }
        let period = last - first.unwrap_or(last);
        let mut shift = None;
        for repeat in 0..copies {
            for s in samples() {
                let pts = s.pts - origin - from + repeat as i128 * period;
                if range.0.is_some_and(|start| pts < (start * scale).round() as i128) || range.1.is_some_and(|end| pts >= (end * scale).round() as i128) {
                    continue;
                }
                let packet = &input[s.offset..s.offset + s.size as usize];
                if matches!(self.tag, b"tx3g" | b"text") && packet.len() >= 2 && u16_at(packet, 0) == 0 { continue; }
                let data = match self.tag {
                    b"tx3g" | b"text" => mov_text::decode(packet, if self.tag == b"text" { &[] } else { self.entry }, writer.format, writer.limit.saturating_sub(writer.output.len()))?,
                    b"ass " if writer.format == "ttml" => std::borrow::Cow::Owned(String::from_utf8_lossy(packet).splitn(9, ',').nth(8).unwrap_or("").as_bytes().to_vec()),
                    b"ass " => std::borrow::Cow::Owned(super::lrc::decode_ass(String::from_utf8_lossy(packet).splitn(9, ',').nth(8).unwrap_or(""), writer.format == "webvtt", None).into_bytes()),
                    _ => std::borrow::Cow::Borrowed(packet),
                };
                let start = ms(pts);
                let start = if writer.format == "lrc" { start } else { start.saturating_add(*shift.get_or_insert(start.min(0).saturating_neg())) };
                // FFmpeg's MOV demuxer reports zero subtitle durations for fragmented packets.
                let duration = if self.runs.is_empty() { ms(s.tick.into()) } else { 0 };
                writer.cue(start, start.saturating_add(duration), &String::from_utf8_lossy(&data))?;
            }
        }
        Ok(())
    }
    fn pcm_format(&self) -> Option<super::ffmpeg_pcm::Format> {
        use super::ffmpeg_pcm::Format;
        if self.kind != "audio" {return None;}
        if matches!(self.tag, b"ipcm" | b"fpcm") {
            let config = child(self.entry.get(28..).unwrap_or_default(), b"pcmC");
            if config.len() < 6 || u32_at(config, 0) != 0 { return None; }
            let bits = u16::from(config[5]);
            let big = config[4] & 1 == 0;
            return match self.tag {
                b"ipcm" if matches!(bits, 16 | 24 | 32) => Some(Format::Signed(bits, big)),
                b"fpcm" if matches!(bits, 32 | 64) => Some(Format::Float(bits, big)),
                _ => None,
            };
        }
        let bits = u16_at(self.entry, 18);
        let offset = match u16_at(self.entry, 8) { 1 => 44, 2 => 64, _ => 28 };
        let children = self.entry.get(offset..).unwrap_or_default();
        let enda = child(child(children, b"wave"), b"enda");
        let enda = if enda.is_empty() { child(children, b"enda") } else { enda };
        let big = enda.get(1) != Some(&1);
        Some(match self.tag {
            b"sowt" | b"twos" if matches!(bits,8|16|24|32) => Format::Signed(bits, bits != 8 && self.tag == b"twos"),
            b"raw " => if bits == 16 {Format::Signed(16,true)} else {Format::Unsigned(8,false)},
            b"in24" => Format::Signed(24,big),
            b"in32" => Format::Signed(32,big),
            b"fl32" => Format::Float(32,big),
            b"fl64" => Format::Float(64,big),
            b"ulaw" => Format::Mulaw,
            b"alaw" => Format::Alaw,
            b"lpcm" if u16_at(self.entry,8)==2 && self.entry.len()>=64 => {
                let bits=u32_at(self.entry,48);let flags=u32_at(self.entry,52);let big=flags&2!=0;
                if flags&1!=0 && matches!(bits,32|64) {Format::Float(bits as u16,big)}
                else if flags&1==0 && matches!(bits,8|16|24|32) {
                    if flags&4!=0 {Format::Signed(bits as u16,big)}else{Format::Unsigned(bits as u16,big)}
                }else{return None;}
            }
            _ => return None,
        })
    }
    fn audio_rate(&self) -> Option<u32> {
        if matches!(self.tag, b"ipcm" | b"fpcm") {
            let rate = u32_at(child(self.entry.get(28..).unwrap_or_default(), b"srat"), 4);
            if rate > 0 && rate <= i32::MAX as u32 { return Some(rate); }
        }
        if u16_at(self.entry,8)==2 && self.entry.len()>=64 {
            let rate=f64::from_bits(wide(self.entry,32,true));
            return (rate.is_finite() && rate>=1. && rate<=f64::from(u32::MAX)).then_some(rate as u32);
        }
        if let Some(a) = &self.audio
            && a.rate > 0
        {
            return Some(a.rate);
        }
        if self.entry.len() >= 28 {
            Some(((u64::from(u32_at(self.entry, 24)) + 32768) >> 16) as u32)
        } else {
            None
        }
    }
    fn channel_order(&self) -> Vec<u16> {
        let offset = if matches!(self.tag, b"ipcm" | b"fpcm") { 28 } else {
            match u16_at(self.entry, 8) { 1 => 44, 2 => 64, _ => 28 }
        };
        let children = self.entry.get(offset..).unwrap_or_default();
        let chan = child(children, b"chan");
        let channels = usize::from(self.channels());
        let mut order = Vec::new();
        if chan.len() >= 16 && u32_at(chan, 12) as usize <= (chan.len() - 16) / 20 {
            let tag = u32_at(chan, 4);
            if tag == 0x10000 {
                let mask = u32_at(chan, 8);
                if mask < 0x40000 && mask.count_ones() as usize == channels {
                    order = (0..18).filter(|&i| mask & (1 << i) != 0).collect();
                }
            } else if tag & 0xffff == channels as u32 {
                let speakers: &[u16] = match tag >> 16 {
                    100 => &[2], 101 | 102 | 104..=106 => &[0,1], 103 => &[29,30],
                    107 => &[1024,1027,1025,1026], 108 => &[0,1,4,5],
                    109 => &[0,1,4,5,2], 110 => &[0,1,4,5,2,8],
                    111 => &[0,1,4,5,2,8,9,10], 112 => &[0,1,4,5,12,14,15,17],
                    113 => &[0,1,2], 114 => &[2,0,1], 115 => &[0,1,2,8], 116 => &[2,0,1,8],
                    117 => &[0,1,2,9,10], 118 => &[0,1,9,10,2], 119 => &[0,2,1,9,10], 120 => &[2,0,1,9,10],
                    121 => &[0,1,2,3,9,10], 122 => &[0,1,9,10,2,3], 123 => &[0,2,1,9,10,3], 124 => &[2,0,1,9,10,3],
                    125 => &[0,1,2,3,9,10,8], 126 => &[0,1,2,3,9,10,6,7], 127 => &[2,6,7,0,1,9,10,3],
                    128 => &[0,1,2,3,9,10,4,5], 129 => &[0,1,9,10,2,3,6,7], 130 => &[0,1,2,3,9,10,29,30],
                    131 => &[0,1,8], 132 => &[0,1,9,10], 133 => &[0,1,3], 134 => &[0,1,3,8],
                    135 => &[0,1,3,9,10], 136 => &[0,1,2,3], 137 => &[0,1,2,3,8], 138 => &[0,1,9,10,3],
                    139 => &[0,1,9,10,2,8], 140 => &[0,1,9,10,2,4,5], 141 => &[2,0,1,9,10,8],
                    142 => &[2,0,1,9,10,8,3], 143 => &[2,0,1,9,10,4,5], 144 => &[2,0,1,9,10,4,5,8],
                    148 => &[0,1,9,10,2,6,7], 149 => &[2,3], 150 => &[0,2,1], 151 => &[0,2,1,8],
                    152 => &[0,2,1,3], 153 => &[0,1,8,3], 154 => &[0,2,1,8,3],
                    _ => &[],
                };
                order.extend_from_slice(speakers);
            }
            if tag == 0 && u32_at(chan, 12) as usize >= channels {
                order = chan[16..].chunks_exact(20).take(channels).map(|description| match u32_at(description, 0) {
                    label @ 1..=18 => label as u16 - 1,
                    35 => 31, 36 => 32, 37 => 35, 38 => 29, 39 => 30,
                    0 => u16::MAX, _ => 0x300,
                }).collect();
            }
        }
        let chnl = child(children, b"chnl");
        if chnl.len() >= 6 && chnl[0] == 0 && chnl[4] & 1 != 0 {
            order.clear();
            if chnl[5] == 0 {
                let mut positions = chnl[6..].iter();
                for _ in 0..channels {
                    let Some(&position) = positions.next() else { return Vec::new(); };
                    if position == 126 { for _ in 0..3 { if positions.next().is_none() { return Vec::new(); } } }
                    order.push(match position {
                        0..=3 => position.into(), 4..=5 => u16::from(position + 5), 6..=7 => position.into(),
                        8..=9 => u16::from(position - 4), 10 => 8, 11 => 33, 12 => 34, 13 => 41, 14 => 42,
                        15 => 31, 16 => 32, 17 => 12, 18 => 14, 19 => 13, 20 => 15, 21 => 17, 22 => 16,
                        23 => 36, 24 => 37, 25 => 11, 26 => 35, 27 => 39, 28 => 40, 29 => 38,
                        _ => 0x300,
                    });
                }
            } else if chnl.len() >= 14 {
                let speakers: &[u16] = match chnl[5] {
                    1 => &[2], 2 => &[0,1], 3 => &[2,0,1], 4 => &[2,0,1,8], 5 => &[2,0,1,9,10],
                    6 => &[2,0,1,9,10,3], 7 => &[2,6,7,0,1,9,10,3], 9 => &[0,1,8], 10 => &[0,1,9,10],
                    11 => &[2,0,1,9,10,8,3], 12 => &[2,0,1,9,10,4,5,3], 14 => &[2,0,1,9,10,3,12,14],
                    _ => &[],
                };
                let omitted = wide(chnl, 6, true);
                order.extend(speakers.iter().enumerate().filter_map(|(i,&speaker)| (omitted & (1 << i) == 0).then_some(speaker)));
            }
        }
        if order.len() != channels || order.iter().all(|&speaker| speaker == 0x300) { order.clear(); }
        order
    }
    fn decode_pcm(&self, input: &[u8], seek: super::InputTime, period: f64, limit: usize)
        -> Result<(Vec<u8>, Vec<super::ffmpeg_wave::Frame>), &'static str> {
        let format = self.pcm_format().ok_or("Invalid PCM sample description")?;
        let rate = self.audio_rate().ok_or("Invalid PCM sample rate")?;
        let stride = usize::from(self.channels()) * usize::from(format.bits() / 8);
        if rate == 0 || stride == 0 { return Err("Invalid PCM sample rate or channel count"); }
        let clock = |ticks: i128| (ticks as f64 * f64::from(rate) / f64::from(self.scale)).round() as i128;
        let start = (seek.start.unwrap_or(0.) * f64::from(rate)).round() as i128;
        let delay = clock(i128::from(self.empty_ticks)).saturating_sub(start).max(0);
        let until = seek.end().map(|end| ((end - seek.start.unwrap_or(0.)) * f64::from(rate)).round() as i128 + delay);
        let mut data = Vec::new();
        let mut frames = Vec::new();
        let mut seen = false;
        let mut work = limit.saturating_mul(8);
        for pass in 0..=seek.loops {
            let offset = (pass as f64 * period * f64::from(rate)).round() as i128 - start;
            for s in self.samples(input.len()) {
                work = work.checked_sub(1).ok_or("PCM packet work limit exceeded")?;
                if self.discarded_pcm_sample(&s) { continue; }
                if s.description != 1 { return Err("Changing PCM sample descriptions is not supported"); }
                let pts = clock(s.pts - i128::from(self.origin) + i128::from(self.empty_ticks)) + offset;
                let length = s.size as usize / stride;
                seen = true;
                if until.is_some_and(|end| pts >= end) { return Ok((data, frames)); }
                let preroll = -clock(s.pts - i128::from(self.origin));
                let lo = preroll.max(-pts).max(0).min(length as i128) as usize;
                let hi = until.map_or(length, |end| (end - pts).max(0).min(length as i128) as usize).max(lo);
                if hi == lo { continue; }
                let size = (hi - lo) * stride;
                data.len().checked_add(size).map(|n| n.max(data.capacity()))
                    .and_then(|n| n.checked_add((frames.len() + 1) * size_of::<super::ffmpeg_wave::Frame>()))
                    .filter(|&n| n <= limit).ok_or("PCM timeline exceeds memory budget")?;
                data.try_reserve_exact(size).map_err(|_| "PCM decoding exceeds memory budget")?;
                frames.try_reserve_exact(1).map_err(|_| "PCM timeline exceeds memory budget")?;
                frames.push(super::ffmpeg_wave::Frame { start: data.len() / stride, len: hi - lo, pts: pts + lo as i128 });
                data.extend_from_slice(&input[s.offset + lo * stride..s.offset + hi * stride]);
            }
            if !seen { break; }
        }
        Ok((data, frames))
    }
    fn decode_amr(&self, input:&[u8], trak:&[u8], seek:super::InputTime, limit:usize)->Result<Vec<u8>,&'static str> {
        let rate=match self.tag {b"samr"=>8000,b"sawb"=>16000,_=>return Err("Unsupported AMR codec")};
        if self.channels()!=1 || self.audio_rate()!=Some(rate) {return Err("Invalid AMR channel count or sample rate");}
        let elst=child(child(trak,b"edts"),b"elst");
        if !elst.is_empty() {
            let long=elst[0]==1;let mut edits=rows(elst,if long{20}else{12});let edit=edits.next().ok_or("Invalid AMR presentation edits")?;
            if edits.next().is_some() || u32_at(edit,if long{16}else{8})!=65536 || (if long{wide(edit,8,true) as i64}else{i64::from(u32_at(edit,4) as i32)})<0 {return Err("Unsupported AMR presentation edits");}
        }
        let target=self.origin as f64+seek.start.unwrap_or(0.).max(0.)*f64::from(self.scale);
        // MOV seeks subtract the first fully presented packet timestamp. With
        // a partial priming packet this retains one extra packet of history.
        let corrected=self.samples(input.len()).find(|s|s.pts>=i128::from(self.origin)).map_or(0.,|s|(s.pts-i128::from(self.origin)) as f64);
        let skip=if seek.start.is_some() {self.samples(input.len()).take_while(|s|s.pts as f64<=target-corrected).count().saturating_sub(1)}else{0};
        let first=self.samples(input.len()).nth(skip).ok_or("Empty AMR track")?.pts;
        let from=((target-first as f64)*f64::from(rate)/f64::from(self.scale)).round().max(0.) as usize;
        let copies=seek.loops.checked_add(1).ok_or("AMR loop count exceeds memory budget")?;
        let packets=(0..copies).flat_map(|_|self.samples(input.len()).skip(skip)).map(|s|&input[s.offset..s.offset+s.size as usize]);
        let mut pcm=if self.tag==b"samr" {super::amr_nb::decode(packets,limit)?}else{super::amr_wb::decode(packets,limit)?};
        let frames=pcm.len()/4/copies;
        let until=seek.end().map_or(frames,|end|((self.origin as f64+end*f64::from(self.scale)-first as f64)*f64::from(rate)/f64::from(self.scale)).round().max(0.) as usize).min(frames);
        let from=from.min(until);
        for copy in 0..copies {pcm.copy_within((copy*frames+from)*4..(copy*frames+until)*4,copy*(until-from)*4);}
        pcm.truncate(copies*(until-from)*4);Ok(pcm)
    }
    fn aac_seek_sample(&self, input_size: usize, timestamp: f64, video: Option<&Track<'_>>) -> usize {
        // MOV seeks the default video stream first, then aligns audio to it.
        let timestamp = video.and_then(|video| {
            let target = (timestamp * f64::from(video.scale)).round() as i128
                + i128::from(video.origin) - i128::from(video.empty_ticks);
            video.samples(input_size).filter(|s| s.key && s.pts <= target).last()
                .or_else(|| video.samples(input_size).next())
                .map(|s| (s.dts as f64 - video.origin as f64 + video.empty_ticks as f64) / f64::from(video.scale))
        }).unwrap_or(timestamp);
        let corrected = self.samples(input_size).find(|s| s.pts >= i128::from(self.origin))
            .map_or(0, |s| s.pts - i128::from(self.origin));
        let target = i128::from(self.origin) - i128::from(self.empty_ticks) - corrected
            + (timestamp * f64::from(self.scale)).round() as i128;
        self.samples(input_size).take_while(|s| s.pts <= target).count().saturating_sub(1)
    }
    fn decode_aac(&self, input: &[u8], trak: &[u8], seek: super::InputTime, selected: &[usize], limit: usize) -> Result<(u32, u32, Vec<u8>, Vec<super::ffmpeg_wave::Frame>), &'static str> {
        let offset = match u16_at(self.entry, 8) { 1 => 44, 2 => 64, _ => 28 };
        let children = self.entry.get(offset..).unwrap_or_default();
        let direct = child(children, b"esds");
        let payload = if direct.is_empty() { child(child(children, b"wave"), b"esds") } else { direct };
        let (indication, config) = decoder_config(payload);
        if indication != 0x40 { return Err("Unsupported MPEG audio decoder configuration"); }
        let config = config.ok_or("Missing AAC decoder configuration")?;
        let elst = child(child(trak, b"edts"), b"elst");
        if !elst.is_empty() {
            let long = elst[0] == 1;
            let mut edits = rows(elst, if long { 20 } else { 12 });
            let media_time = |edit: &[u8]| if long {wide(edit,8,true) as i64} else {i64::from(u32_at(edit,4) as i32)};
            let mut edit=edits.next().ok_or("Invalid AAC presentation edits")?;
            if media_time(edit) == -1 && u32_at(edit, if long { 16 } else { 8 }) == 65536 {
                edit=edits.next().ok_or("Invalid AAC presentation edits")?;
            }
            if edits.next().is_some() || u32_at(edit, if long { 16 } else { 8 }) != 65536
                || media_time(edit) < 0 {
                return Err("Unsupported AAC presentation edits");
            }
        }
        let first = self.samples(input.len()).next().ok_or("Empty AAC track")?;
        let rate = self.audio_rate().ok_or("Missing AAC sample rate")?;
        let clock = |ticks: i128| (ticks as f64 * f64::from(rate) / f64::from(self.scale)).round() as i128;
        let (tracks, _) = read_tracks(input, movie(input).map_err(|_| "Invalid AAC movie")?).map_err(|_| "Invalid AAC tracks")?;
        let input_start = tracks.iter().filter(|t| t.kind != "data").map(|t| t.stats.start as f64 / f64::from(t.scale)).reduce(f64::min).unwrap_or(0.);
        let origin = i128::from(self.origin) - i128::from(self.empty_ticks)
            + ((input_start * 1_000_000.).round() * f64::from(self.scale) / 1_000_000.).round() as i128;
        let start = (seek.start.unwrap_or(0.) * f64::from(rate)).round() as i128;
        let video = tracks.iter().find(|t| t.kind == "video");
        let repeat_skip = self.aac_seek_sample(input.len(), input_start, video.filter(|t| selected.contains(&t.index)));
        let skip = seek.start.map_or(0, |start| self.aac_seek_sample(input.len(), input_start + start, video));
        let copies = seek.loops.checked_add(1).ok_or("AAC loop count exceeds memory budget")?;
        let packets = (0..copies).flat_map(|copy| self.samples(input.len()).skip(if copy == 0 { skip } else { repeat_skip }).enumerate()).map(|(index,s)| {
            if s.description != 1 { return Err("Changing AAC sample descriptions is not supported"); }
            Ok((index == 0, std::borrow::Cow::Borrowed(&input[s.offset..s.offset+s.size as usize])))
        });
        let (rate, channels, mut pcm) = super::aac::decode(config, packets, limit)?;
        let stride = channels as usize * 4;
        let initial_padding = self.skip_samples(&first).unwrap_or(0);
        let period = if seek.loops > 0 && selected.len() > 1 {
            (pcm_loop_duration(input, selected, seek.start).map_err(|_| "Invalid AAC loop duration")? * f64::from(rate)).round() as i128
        } else {
            self.samples(input.len()).last().zip(self.samples(input.len()).nth(skip))
                .map_or(0, |(last, first)| clock(last.pts - first.pts) + 1024)
        };
        let mut frames = Vec::new();
        let (mut read, mut written) = (0, 0);
        let mut until = None;
        for copy in 0..copies {
            let skipped = if copy == 0 { skip } else { repeat_skip };
            let offset = copy as i128 * period - start;
            let mut remaining = self.samples(input.len()).nth(skipped).map_or(0, |s|
                initial_padding.saturating_sub(clock(s.pts - first.pts).max(0) as u64));
            for s in self.samples(input.len()).skip(skipped) {
                let skipped = remaining.min(1024) as usize;
                remaining = remaining.saturating_sub(1024);
                let source = read;
                read += 1024 * stride;
                if self.discarded_packet(&s) || skipped == 1024 { continue; }
                let pts = clock(s.pts - origin) + offset;
                if until.is_none() {
                    until = seek.end().map(|end| {
                        let anchor = if seek.start.is_some() { 0 } else { pts + skipped as i128 };
                        anchor + ((end - seek.start.unwrap_or(0.)) * f64::from(rate)).round() as i128
                    });
                }
                let lo = if seek.start.is_some() { skipped.max((-pts).clamp(0, 1024) as usize) } else { skipped };
                let hi = until.map_or(1024, |end| (end - pts).clamp(0, 1024) as usize).max(lo);
                if lo == hi { continue; }
                pcm.capacity().checked_add((frames.len() + 1) * size_of::<super::ffmpeg_wave::Frame>())
                    .filter(|&n| n <= limit).ok_or("AAC timeline exceeds memory budget")?;
                frames.try_reserve_exact(1).map_err(|_| "AAC timeline exceeds memory budget")?;
                frames.push(super::ffmpeg_wave::Frame { start: written / stride, len: hi - lo, pts: pts + lo as i128 });
                pcm.copy_within(source + lo * stride..source + hi * stride, written);
                written += (hi - lo) * stride;
            }
        }
        pcm.truncate(written);
        Ok((rate, channels, pcm, frames))
    }

    fn alac_config(&self) -> Result<super::alac::Config, &'static str> {
        let offset = match u16_at(self.entry, 8) { 1 => 44, 2 => 64, _ => 28 };
        let children = self.entry.get(offset..).unwrap_or_default();
        let direct = child(children, b"alac");
        let payload = if direct.is_empty() { child(child(children, b"wave"), b"alac") } else { direct };
        if payload.len() != 28 { return Err("Missing MOV ALAC decoder configuration"); }
        super::alac::Config::read(&payload[4..])
    }
    fn extract_adts(
        &self,
        input: &[u8],
        opts: &super::adts::Options,
    ) -> Result<Vec<u8>, &'static str> {
        let scale = f64::from(self.scale);
        let start = self
            .origin
            .saturating_add((opts.start * scale).round() as u64);
        let end = self
            .origin
            .saturating_add(opts.end.map_or(self.duration, |s| {
                ((s * scale).round() as u64).min(self.duration)
            }));
        let trim = opts.start > 0. || opts.end.is_some();
        let samples = self
            .samples(input.len())
            .filter(|s| {
                !trim || end > start && s.dts < end && s.dts.saturating_add(s.tick.into()) > start
            })
            .map(|s| &input[s.offset..s.offset + s.size as usize]);
        opts.encode(self.audio_rate().unwrap_or(44100), self.channels().into(), samples)
    }
    fn channels(&self) -> u16 {
        if u16_at(self.entry,8)==2 && self.entry.len()>=64 {return u16::try_from(u32_at(self.entry,40)).unwrap_or(0);}
        if let Some(a) = &self.audio {
            return a.channels;
        }
        if self.entry.len() >= 28 {
            u16_at(self.entry, 16)
        } else {
            2
        }
    }
    fn codec(&self) -> (&str, &str) {
        use super::ffmpeg_pcm::Format;
        if let Some(format)=self.pcm_format() {
            return match format {
                Format::Signed(8,_) => ("pcm_s8","PCM signed 8-bit"),
                Format::Unsigned(8,_) => ("pcm_u8","PCM unsigned 8-bit"),
                Format::Signed(16,false) => ("pcm_s16le","PCM signed 16-bit little-endian"),
                Format::Signed(16,true) => ("pcm_s16be","PCM signed 16-bit big-endian"),
                Format::Signed(24,false) => ("pcm_s24le","PCM signed 24-bit little-endian"),
                Format::Signed(24,true) => ("pcm_s24be","PCM signed 24-bit big-endian"),
                Format::Signed(32,false) => ("pcm_s32le","PCM signed 32-bit little-endian"),
                Format::Signed(32,true) => ("pcm_s32be","PCM signed 32-bit big-endian"),
                Format::Float(32,false) => ("pcm_f32le","PCM 32-bit floating point little-endian"),
                Format::Float(32,true) => ("pcm_f32be","PCM 32-bit floating point big-endian"),
                Format::Float(64,false) => ("pcm_f64le","PCM 64-bit floating point little-endian"),
                Format::Float(64,true) => ("pcm_f64be","PCM 64-bit floating point big-endian"),
                Format::Alaw => ("pcm_alaw","PCM A-law / G.711 A-law"),
                Format::Mulaw => ("pcm_mulaw","PCM mu-law / G.711 mu-law"),
                _ => ("unknown","unknown"),
            };
        }
        match self.tag {
            b"avc1" | b"avc3" => ("h264", "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"),
            b"hvc1" | b"hev1" => ("hevc", "H.265 / HEVC (High Efficiency Video Coding)"),
            b"av01" => ("av1", "Alliance for Open Media AV1"),
            b"vp09" => ("vp9", "Google VP9"),
            b"vp08" => ("vp8", "On2 VP8"),
            b"mp4v" => ("mpeg4", "MPEG-4 part 2"),
            b"mp4a"
                if self
                    .audio
                    .as_ref()
                    .is_some_and(|a| matches!(a.indication, 0x69 | 0x6b)) =>
            {
                ("mp3", "MP3 (MPEG audio layer 3)")
            }
            b"mp4a" => ("aac", "AAC (Advanced Audio Coding)"),
            b"jpeg" | b"mjpa" => ("mjpeg", "Motion JPEG"),
            b"png " => ("png", "PNG (Portable Network Graphics) image"),
            b"text" if self.kind == "data" => ("bin_data", "binary data"),
            b"tx3g" | b"text" => ("mov_text", "3GPP Timed Text subtitle"),
            b"samr" => ("amr_nb", "AMR-NB (Adaptive Multi-Rate NarrowBand)"),
            b"sawb" => ("amr_wb", "AMR-WB (Adaptive Multi-Rate WideBand)"),
            b"ac-3" => ("ac3", "ATSC A/52A (AC-3)"),
            b"wvpk" => ("wavpack", "WavPack"),
            b"Opus" => ("opus", "Opus (Opus Interactive Audio Codec)"),
            b"fLaC" => ("flac", "FLAC (Free Lossless Audio Codec)"),
            b".mp3" => ("mp3", "MP3 (MPEG audio layer 3)"),
            b"sowt" | b"lpcm" => ("pcm_s16le", "PCM signed 16-bit little-endian"),
            b"twos" => ("pcm_s16be", "PCM signed 16-bit big-endian"),
            other => {
                let s = std::str::from_utf8(other).unwrap_or("unknown").trim();
                (s, s)
            }
        }
    }
    fn sample_fmt(&self) -> &'static str {
        use super::ffmpeg_pcm::Format;
        match self.pcm_format() {
            Some(Format::Float(32,_)) => "flt",
            Some(Format::Float(64,_)) => "dbl",
            Some(Format::Signed(8,_)|Format::Unsigned(8,_)) => "u8",
            Some(Format::Signed(16,_)|Format::Unsigned(16,_)|Format::Alaw|Format::Mulaw) => "s16",
            Some(_) => "s32",
            None => "fltp",
        }
    }
    fn packet_key(&self, input: &[u8], sample: &Sample) -> bool {
        let (tag, entry) = sample.description.checked_sub(2)
            .and_then(|i|self.other_video.get(i as usize).copied()).unwrap_or((self.tag,self.entry));
        if matches!(tag, b"avc1" | b"avc3") {
            let config = self.original.avcc(entry).unwrap_or_default();
            let length = usize::from(config.get(4).copied().unwrap_or(3) & 3) + 1;
            h264::keyframe(&input[sample.offset..sample.offset + sample.size as usize], length).unwrap_or(sample.key)
        } else { sample.key }
    }
    fn discarded_packet(&self, s: &Sample) -> bool {
        self.runs.is_empty() && self.edit_duration.is_some_and(|duration| {
            let origin = i128::from(self.origin);
            let frame_duration = if s.dts.saturating_add(u64::from(s.tick)) == self.stats.ticks {
                duration
            } else { u64::from(s.tick) };
            s.pts >= origin + i128::from(duration)
                || s.pts < origin && (self.kind != "audio" || s.pts + i128::from(frame_duration) <= origin)
        })
    }
    fn skip_samples(&self, s: &Sample) -> Option<u64> {
        if s.pts >= i128::from(self.origin)
            || !(self.pcm_format().is_some() && (s.pts + i128::from(s.tick) > i128::from(self.origin) || self.origin > self.stats.ticks)
                || self.tag == b"mp4a" && s.dts == self.runs.first().map_or(0, |r| r.dts)) { return None; }
        let discarded = self.discarded_pcm_sample(s)
            || self.tag == b"mp4a" && !self.negative_edit && self.origin > 0 && self.origin <= self.stats.ticks
                && s.dts.saturating_add(u64::from(s.tick)) == self.stats.ticks
                && s.dts.saturating_add(self.duration.saturating_sub(self.empty_ticks)) <= self.origin;
        Some(if discarded { self.duration } else { (i128::from(self.origin) - s.pts) as u64 })
    }
    fn frame_skip(&self, s: &Sample, remaining: &mut u64) -> Option<u32> {
        if self.codec().0 == "aac" {
            if let Some(skip) = self.skip_samples(s) { *remaining = skip; }
            let skipped = (*remaining).min(1024) as u32;
            *remaining = remaining.saturating_sub(1024);
            // Discarded packets still consume decoder priming samples.
            (!self.discarded_packet(s) && skipped < 1024).then_some(skipped)
        } else if self.pcm_format().is_some() {
            (s.pts + i128::from(s.tick) > i128::from(self.origin)).then_some(0)
        } else if self.kind == "video" {
            (!self.discarded_packet(s)).then_some(0)
        } else { Some(0) }
    }
    fn frame_rate(&self) -> f64 {
        let (num, den) = self.video_rate();
        let mut rate = num as f64 / den as f64;
        let average = self.stats.count as f64 * f64::from(self.scale) / self.stats.ticks as f64;
        if average > 0. && average < 70. && rate > 210. { rate = average; }
        // Like av_guess_frame_rate, prefer codec timing when variable packet
        // spacing makes the indexed rate much higher than the picture cadence.
        if let Some(codec) = self.sequence.as_ref().and_then(|s| s.fps)
            && (rate == 0. || codec < rate * 0.7 && (1. - average / rate).abs() > 0.1)
        { rate = codec; }
        rate
    }
    fn video_rate(&self) -> (u64, u64) {
        if self.kind != "video" { return (0, 0); }
        let mut timing = rows(self.tables.timing, 8);
        if let Some(first) = timing.next() {
            let tail = timing.next();
            if timing.next().is_none() && tail.is_none_or(|row| u32_at(row, 0) == 1)
                && u32_at(first, 4) > 0 {
                return (u64::from(self.scale), u64::from(u32_at(first, 4)));
            }
        }
        // MOV fits at most 99 indexed timestamps before packet probing.
        // A coarse clock already expresses the plausible frame rate directly.
        if (5..101).contains(&self.scale) && !matches!(self.tag, b"avc1" | b"avc3" | b"hvc1" | b"hev1" | b"mp4v" | b"gif ") {
            return (u64::from(self.scale), 1);
        }
        super::y4m::guess_rate(self.scale, || self.samples(usize::MAX).take(99).map(|s| s.dts))
    }
    fn record(&self, mut s: Sample, frame_skip: Option<u32>, optional: bool) -> Row {
        let frame = frame_skip.is_some();
        let aac = self.codec().0 == "aac";
        let skipped = frame_skip.unwrap_or(0);
        if frame && self.pcm_format().is_some() {
            let skipped = (i128::from(self.origin) - s.pts).clamp(0, i128::from(s.tick)) as u32;
            s.pts += i128::from(skipped);
            s.dts += u64::from(skipped);
            s.tick -= skipped;
        }
        let discarded_pcm = self.discarded_pcm_sample(&s)
            || self.tag == b"mp4a" && !self.negative_edit && self.origin > 0 && self.origin <= self.stats.ticks
                && s.dts.saturating_add(u64::from(s.tick)) == self.stats.ticks
                && s.dts.saturating_add(self.duration.saturating_sub(self.empty_ticks)) <= self.origin;
        let mut pts = if discarded_pcm { 0. } else { (s.pts - i128::from(self.probe_origin) + i128::from(self.empty_ticks)) as f64 };
        let mut dts = if discarded_pcm { 0. } else { (i128::from(s.dts) - i128::from(self.probe_origin) + i128::from(self.empty_ticks)) as f64 };
        let mut duration = if aac && !self.runs.is_empty() {
            if s.dts == self.runs[0].dts { 0. } else { (1024. * f64::from(self.scale) / f64::from(self.audio_rate().filter(|&rate| rate > 0).unwrap_or(self.scale))).round() }
        } else if self.kind == "video" && !self.stats.b_frames && self.probe_origin > self.origin
            && s.dts.saturating_add(u64::from(s.tick)) == self.stats.ticks {
            f64::from(s.tick).max(self.duration as f64 - pts)
        } else if self.stats.b_frames {
            // MOV leaves reordered packet durations to the codec parser.
            self.sequence.as_ref().and_then(|s|s.fps)
                .filter(|fps| *fps > 0.)
                .map_or(f64::from(s.tick), |fps| (f64::from(self.scale) / fps).round())
        } else if self.kind == "video" && self.empty_ticks > 0 && s.dts.saturating_add(u64::from(s.tick)) == self.stats.ticks {
            let remaining = self.duration.saturating_sub(self.empty_ticks) as f64 - pts;
            if remaining > 0. { remaining } else {
                let (num, den) = self.video_rate();
                if num > 0 { (f64::from(self.scale) * den as f64 / num as f64).floor() } else { f64::from(s.tick) }
            }
        } else if (self.tag == b"mp4a" && (self.origin > 0 || self.empty_ticks > 0) || self.pcm_format().is_some())
            && (s.dts.saturating_add(u64::from(s.tick)) == self.stats.ticks
                || self.pcm_format().is_some() && !discarded_pcm
                    && s.dts.saturating_add(u64::from(s.tick)) >= self.origin.saturating_add(self.duration.saturating_sub(self.empty_ticks))) {
            let remaining = self.duration.saturating_sub(self.empty_ticks) as f64 - pts;
            // The edit's visible end determines the last indexed duration;
            // beyond that end the AAC parser supplies one decoded frame.
            if remaining > 0. { remaining } else if self.pcm_format().is_some() { f64::from(s.tick) } else { 1024. }
        } else { f64::from(s.tick) };
        if frame && aac && skipped > 0 {
            let rate = u64::from(self.audio_rate().filter(|&rate| rate > 0).unwrap_or(self.scale));
            let shift = ((u64::from(skipped) * u64::from(self.scale) + rate / 2) / rate) as f64;
            pts += shift; dts += shift;
            if duration >= shift { duration -= shift; }
        }
        let mut r = vec![
            (
                if frame { "media_type" } else { "codec_type" },
                Str(self.kind.into()),
            ),
            ("stream_index", Number(self.index as f64, None)),
        ];
        if frame {
            r.push(("key_frame", Number(f64::from(s.key), None)))
        }
        r.extend([
            ("pts", Number(pts, None)),
            ("pts_time", Str(self.time(pts))),
            (if frame { "pkt_dts" } else { "dts" }, Number(dts, None)),
            (
                if frame { "pkt_dts_time" } else { "dts_time" },
                Str(self.time(dts)),
            ),
        ]);
        if frame {
            r.extend([
                ("best_effort_timestamp", Number(pts, None)),
                ("best_effort_timestamp_time", Str(self.time(pts))),
            ])
        }
        r.extend([
            (
                if frame && !aac { "pkt_duration" } else { "duration" },
                Number(duration, None),
            ),
            (
                if frame && !aac {
                    "pkt_duration_time"
                } else {
                    "duration_time"
                },
                Str(self.time(duration)),
            ),
            (
                if frame { "pkt_size" } else { "size" },
                Str(s.size.to_string()),
            ),
        ]);
        if frame && aac {
            r.insert(r.len() - 1, ("pkt_pos", Str(if matches!(self.original, Original::None) { s.offset.to_string() } else { s.pos.to_string() })));
        }
        if !frame {
            let discard = self.discarded_packet(&s);
            r.extend([
                ("pos", Str(if matches!(self.original, Original::None) { s.offset.to_string() } else { s.pos.to_string() })),
                ("flags", Str(match (s.key, discard) {
                    (true, true) => "KD_", (true, false) => "K__",
                    (false, true) => "_D_", (false, false) => "___",
                }.into())),
            ])
        } else {
            if self.width != 0 {
                r.push(("width", Number(self.width.into(), None)))
            }
            if self.height != 0 {
                r.push(("height", Number(self.height.into(), None)))
            }
            if self.kind == "video" {
                r.extend([
                    (
                        "pix_fmt",
                        Str(self
                            .sequence
                            .as_ref()
                            .map_or("yuv420p", |s| s.pix_fmt)
                            .into()),
                    ),
                    ("pict_type", Str(if s.key { "I" } else { "P" }.into())),
                ])
            }
            if self.kind == "audio" {
                r.extend([
                    ("sample_fmt", Str(self.sample_fmt().into())),
                    ("nb_samples", Number(if aac { f64::from(1024u32.saturating_sub(skipped)) } else { duration }, None)),
                    ("channels", Number(self.channels().into(), None)),
                ]);
                if aac { r.push(("channel_layout", Str(if self.channels() == 1 { "mono" } else { "stereo" }.into()))); }
            }
        }
        // A lone delayed AAC priming packet has no next packet from which
        // the native demuxer can infer a duration outside the visible edit.
        if !frame && self.tag == b"mp4a" && self.stats.count == 1 && self.empty_ticks > 0
            && self.empty_ticks >= self.duration.saturating_sub(self.empty_ticks) {
            r.retain(|(key, _)| !matches!(*key, "duration" | "duration_time"));
        }
        if aac && duration == 0. {
            r.retain_mut(|(key, value)| {
                if matches!(*key, "duration" | "duration_time") {
                    if !optional { return false; }
                    *value = Str("N/A".into());
                }
                true
            });
        }
        if !frame && let Some(skipped) = self.skip_samples(&s) {
            r.push(("side_data_list",super::super::structured::JVal::Array(vec![Object(vec![
                ("side_data_type".into(),Str("Skip Samples".into())),
                ("skip_samples".into(),Number(skipped as f64,None)),
                ("discard_padding".into(),Number(0.,None)),
                ("skip_reason".into(),Number(0.,None)),
                ("discard_reason".into(),Number(0.,None)),
            ])])));
        }
        r
    }
    fn stream(&self, counts: (bool, bool), frame_count: usize, packet_count: usize, optional: bool) -> Row {
        let (codec, long_name) = self.codec();
        let mut r = vec![
            ("index", Number(self.index as f64, None)),
            ("codec_name", Str(codec.into())),
            ("codec_long_name", Str(long_name.into())),
        ];
        let children = self.entry.get(78..).unwrap_or_default();
        let avc = child(children, b"avcC");
        if codec == "aac" && !self.entry.is_empty() {
            r.push((
                "profile",
                Str(if self.audio.as_ref().is_some_and(|a| a.object == 5) {
                    "HE-AAC"
                } else {
                    "LC"
                }
                .into()),
            ))
        }
        if let Some(s) = &self.sequence {
            r.push(("profile", Str(s.profile.clone())));
        }
        r.extend([
            ("codec_type", Str(self.kind.into())),
            (
                "codec_tag_string",
                Str(self
                    .sample_tag
                    .iter()
                    .map(|&b| {
                        if b < 32 {
                            format!("[{b}]")
                        } else {
                            char::from(b).to_string()
                        }
                    })
                    .collect()),
            ),
            ("codec_tag", Str(format!("0x{:08x}", u32::from_le_bytes(*self.sample_tag)))),
        ]);
        let (w, h) = (self.width, self.height);
        if w != 0 {
            r.push(("width", Number(w.into(), None)))
        }
        if h != 0 {
            r.push(("height", Number(h.into(), None)))
        }
        if w != 0 {
            r.push(("coded_width", Number(w.into(), None)))
        }
        if h != 0 {
            r.push(("coded_height", Number(h.into(), None)))
        }
        if self.kind == "video" {
            r.extend([
                ("has_b_frames", Number(f64::from(self.stats.b_frames), None)),
                (
                    "sample_aspect_ratio",
                    Str(format!("{}:{}", self.sar.0, self.sar.1)),
                ),
            ]);
            if w != 0 && h != 0 {
                r.push((
                    "display_aspect_ratio",
                    Str(media_probe::ratio(w.into(), h.into(), ':')),
                ))
            }
            r.push((
                "pix_fmt",
                Str(self
                    .sequence
                    .as_ref()
                    .map_or("yuv420p", |s| s.pix_fmt)
                    .into()),
            ));
            if let Some(level) = avc.get(3) {
                r.push(("level", Number((*level).into(), None)))
            }
            r.extend([
                ("color_range", Str("tv".into())),
                ("color_space", Str("bt709".into())),
            ]);
        } else if self.kind == "audio" {
            let channels = self.channels();
            let rate = self.audio_rate().unwrap_or(self.scale);
            let bits = if codec == "aac" { 0 } else if let Some(format)=self.pcm_format() {format.bits()} else if self.entry.len() >= 28 {
                u16_at(self.entry, 18)
            } else {
                16
            };
            r.extend([
                ("sample_fmt", Str(self.sample_fmt().into())),
                ("sample_rate", Str(rate.to_string())),
                ("channels", Number(channels.into(), None)),
                ("bits_per_sample", Number(bits.into(), None)),
            ]);
            let layout = if self.pcm_format().is_some() { super::audio_remix::describe_order(&self.channel_order()) }
                else { Some(if channels == 1 { "mono" } else { "stereo" }.into()) };
            if let Some(layout) = layout { r.insert(r.len() - 1, ("channel_layout", Str(layout))); }
            r.push(("initial_padding", Number(0., None)));
        }
        let rate = if self.kind == "video" && self.stats.ticks != 0 {
            media_probe::ratio(
                self.stats.count as u64 * u64::from(self.scale),
                self.stats.ticks,
                '/',
            )
        } else {
            "0/0".into()
        };
        let duration = self.duration.saturating_sub(self.empty_ticks);
        let dur = duration as f64 / f64::from(self.scale);
        let mut tags = vec![("language".into(), Str(self.language.clone()))];
        if !self.handler.is_empty() {
            tags.push((
                "handler_name".into(),
                Str(String::from_utf8_lossy(self.handler).into_owned()),
            ))
        }
        if self.rotation != 0 {
            tags.push(("rotate".into(), Str(self.rotation.to_string())));
        }
        if self.kind == "audio" && self.entry.len() >= 16 {
            tags.push(("vendor_id".into(), Str(self.entry[12..16].iter().map(|&b| if b < 32 { format!("[{b}]") } else { char::from(b).to_string() }).collect())));
        }
        r.push(("id", Str(format!("0x{:x}", self.id))));
        r.extend([
            ("r_frame_rate", Str({ let (num, den) = self.video_rate(); if den == 0 { "0/0".into() } else { media_probe::ratio(num, den, '/') } })),
            ("avg_frame_rate", Str(rate)),
            ("time_base", Str(format!("1/{}", self.scale))),
            ("start_pts", Number(self.stats.start as f64, None)),
            ("start_time", Str(self.time(self.stats.start as f64))),
            ("duration_ts", Number(duration as f64, None)),
            ("duration", Str(format!("{dur:.6}"))),
            (
                "bit_rate",
                Str(if self.stats.ticks == 0 { "0".into() } else {
                    (u128::from(self.stats.bytes) * 8 * u128::from(self.scale) / u128::from(self.stats.ticks)).to_string()
                }),
            ),
            ("nb_frames", Str(self.stats.count.to_string())),
        ]);
        if !self.runs.is_empty() {
            let declared = u32_at(self.tables.sizes, 8);
            r.retain_mut(|(key, value)| {
                if *key != "nb_frames" { return true; }
                if declared == 0 && !optional { return false; }
                *value = Str(if declared == 0 { "N/A".into() } else { declared.to_string() });
                true
            });
        }
        if optional && self.kind == "audio" {
            let index = r.iter().position(|(key, _)| *key == "nb_frames").unwrap_or(r.len());
            r.splice(index..index, [("max_bit_rate", Str("N/A".into())), ("bits_per_raw_sample", Str("N/A".into()))]);
        }
        if counts.0 && frame_count > 0 { r.push(("nb_read_frames", Str(frame_count.to_string()))); }
        else if optional && self.kind == "audio" { r.push(("nb_read_frames", Str("N/A".into()))); }
        if counts.1 { r.push(("nb_read_packets", Str(packet_count.to_string()))); }
        else if optional && self.kind == "audio" { r.push(("nb_read_packets", Str("N/A".into()))); }
        if codec == "aac" {
            let offset = match u16_at(self.entry, 8) { 1 => 44, 2 => 64, _ => 28 };
            let children = self.entry.get(offset..).unwrap_or_default();
            let direct = child(children, b"esds");
            let payload = if direct.is_empty() { child(child(children, b"wave"), b"esds") } else { direct };
            if let (_, Some(config)) = decoder_config(payload) { r.push(("extradata_size", Number(config.len() as f64, None))); }
        }
        let mut disposition = media_probe::disposition(self.enabled);
        disposition.extend(["non_diegetic", "captions", "descriptions", "metadata", "dependent", "still_image"].map(|key| (key.into(), Number(0., None))));
        r.extend([("disposition", Object(disposition)), ("tags", Object(tags))]);
        if self.rotation != 0 {
            r.push(("side_data_list", super::super::structured::JVal::Array(vec![Object(vec![
                ("side_data_type".into(), Str("Display Matrix".into())),
                ("rotation".into(), Number(-f64::from(self.rotation), None)),
            ])])));
        }
        r
    }
}

fn tags(input: &[u8], moov: &[u8]) -> Vec<(String, super::super::structured::JVal)> {
    let brands = atoms(input)
        .find(|(k, _)| *k == b"ftyp")
        .or_else(|| atoms(input).find(|(k, _)| *k == b"styp"))
        .map(|(_, v)| v)
        .unwrap_or_default();
    let latin = |s: &[u8]| s.iter().map(|&b| char::from(b)).collect::<String>();
    let mut tags = vec![
        (
            "major_brand".into(),
            Str(if brands.len() >= 8 {
                latin(&brands[..4])
            } else {
                "isom".into()
            }),
        ),
        (
            "minor_version".into(),
            Str(if brands.len() >= 8 {
                u32_at(brands, 4).to_string()
            } else {
                "512".into()
            }),
        ),
    ];
    if brands.len() >= 12 {
        tags.push((
            "compatible_brands".into(),
            Str(latin(&brands[8..brands.len() / 4 * 4])),
        ))
    }
    tags.extend(text_tags(moov).map(|(k, v)| (k.into(), Str(v))));
    tags
}

fn text_tags(moov: &[u8]) -> impl Iterator<Item = (&'static str, String)> + '_ {
    let mut meta = child(child(moov, b"udta"), b"meta");
    if meta.is_empty() {
        meta = child(moov, b"meta")
    }
    if matches!(meta.get(8..12), Some(b"hdlr" | b"ilst" | b"keys" | b"free")) {
        meta = &meta[4..]
    }
    let ilst = child(meta, b"ilst");
    [
        (b"\xa9nam", "title"),
        (b"\xa9ART", "artist"),
        (b"\xa9alb", "album"),
        (b"\xa9day", "date"),
        (b"\xa9cmt", "comment"),
        (b"\xa9gen", "genre"),
        (b"\xa9too", "encoder"),
    ]
    .into_iter()
    .filter_map(move |(code, key)| {
        let mut value = None;
        for (_, item) in atoms(ilst).filter(|(k, _)| *k == code) {
            let bytes = match atoms(item).find(|(k, _)| *k == b"data") {
                Some((_, b)) => b.get(8..).unwrap_or(b),
                None if item.len() >= 8 => item,
                None => continue,
            };
            let s = String::from_utf8_lossy(bytes);
            let s = s.trim_start_matches('\u{feff}').trim_end_matches('\0');
            if !s.is_empty() {
                value = Some(s.to_owned())
            }
        }
        value.map(|v| (key, v))
    })
}

fn chapter_entries(moov: &[u8], duration: f64) -> impl Iterator<Item = (u64, u64, &[u8])> + '_ {
    let chpl = child(child(moov, b"udta"), b"chpl");
    let count = chpl.get(8).copied().unwrap_or(0);
    let (mut bytes, count) = if count == 0 { (chpl.get(13..).unwrap_or_default(), u32_at(chpl, 9).min(255)) }
        else { (chpl.get(9..).unwrap_or_default(), u32::from(count)) };
    let mut entries = Vec::new();
    for _ in 0..count {
        let Some(&len) = bytes.get(8) else { break; };
        let len = usize::from(len).min(bytes.len() - 9);
        entries.push((wide(bytes, 0, true), 0, &bytes[9..9 + len]));
        bytes = &bytes[9 + len..];
    }
    let mut order = (0..entries.len()).collect::<Vec<_>>();
    order.sort_by_key(|&i| entries[i].0);
    for (at, &i) in order.iter().enumerate() {
        let start = entries[i].0;
        let mut end = if duration > 0. { (duration * 10_000_000.).round() as u64 } else { u64::MAX };
        if let Some(&next) = order.get(at + 1) && entries[next].0 > start { end = end.min(entries[next].0); }
        entries[i].1 = if end == u64::MAX { start } else { end.max(start) };
    }
    entries.into_iter()
}

fn read_chapters(input: &[u8], moov: &[u8], tracks: &[Track<'_>], duration: f64, limit: usize) -> Result<Vec<super::ffmpeg_input::Chapter>, String> {
    use super::ffmpeg_input::Chapter;
    let mut chapters = Vec::new();
    let mut remaining = limit;
    for (id, (start, end, title)) in chapter_entries(moov, chapter_duration(tracks, duration)).enumerate() {
        let title = String::from_utf8_lossy(title).trim_start_matches('\u{feff}').to_owned();
        remaining = remaining.checked_sub(2 * size_of::<Chapter>() + title.capacity()).ok_or("chapter index exceeds memory budget")?;
        chapters.push(Chapter { id: id as i64, scale: 10_000_000, start: start as i64, end: end as i64, title: Some(title) });
    }
    for t in tracks.iter().filter(|t| t.kind == "data" && t.tag == b"text") {
        let mut samples = t.samples(input.len()).peekable();
        let mut id = 0;
        while let Some(sample) = samples.next() {
            let data = &input[sample.offset..sample.offset + sample.size as usize];
            let len = usize::from(u16_at(data, 0));
            let Some(title) = data.get(2..2 + len) else { continue; };
            let title = match title.get(..2) {
                Some(b"\xfe\xff" | b"\xff\xfe") => {
                    let little = title[0] == 0xff;
                    char::decode_utf16(data[4..(4 + len).min(data.len())].chunks_exact(2).map(|b| if little {u16::from_le_bytes([b[0], b[1]])} else {u16::from_be_bytes([b[0], b[1]])}))
                        .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)).take_while(|&c| c != '\0').collect()
                }
                _ => String::from_utf8_lossy(title.split(|&b| b == 0).next().unwrap_or_default()).into_owned(),
            };
            remaining = remaining.checked_sub(2 * size_of::<Chapter>() + title.capacity()).ok_or("chapter index exceeds memory budget")?;
            let start = (sample.dts as i64).saturating_sub(t.origin as i64);
            let end = samples.peek().map_or(t.duration.saturating_sub(t.empty_ticks) as i64, |s| (s.dts as i64).saturating_sub(t.origin as i64));
            let chapter = Chapter { id, scale: t.scale, start, end, title: Some(title) };
            if let Some(old) = chapters.iter_mut().find(|c| c.id == id) { *old = chapter; } else { chapters.push(chapter); }
            id += 1;
        }
    }
    Ok(chapters)
}

fn chapter_row(c: &super::ffmpeg_input::Chapter) -> Row {
    let mut row = vec![
        ("id", Number(c.id as f64, Some(c.id.to_string().into_boxed_str()))),
        ("time_base", Str(format!("1/{}", c.scale))),
        ("start", Number(c.start as f64, Some(c.start.to_string().into_boxed_str()))),
        ("start_time", Str(format!("{:.6}", c.start as f64 / f64::from(c.scale)))),
        ("end", Number(c.end as f64, Some(c.end.to_string().into_boxed_str()))),
        ("end_time", Str(format!("{:.6}", c.end as f64 / f64::from(c.scale)))),
    ];
    if let Some(title) = &c.title { row.push(("tags", Object(vec![("title".into(), Str(title.clone()))]))); }
    row
}

fn chapter_duration(tracks: &[Track<'_>], fallback: f64) -> f64 {
    let Some(start) = tracks.iter().filter(|t| t.kind != "data").map(|t| (t.stats.start as f64 / f64::from(t.scale) * 1_000_000.).round()).reduce(f64::min) else { return fallback; };
    let duration = tracks.iter().filter(|t| t.kind != "data").map(|t| (t.duration.saturating_sub(t.empty_ticks) as f64 / f64::from(t.scale) * 1_000_000.).round()).fold(0., f64::max);
    (start + duration) / 1_000_000.
}

pub(super) fn output_chapters(inputs: &[super::MediaInput], opts: &mux::Remux) -> Result<Vec<super::ffmpeg_input::Chapter>, String> {
    use super::ffmpeg_input::Chapter;
    if opts.chapter_input.is_some_and(|n| n < 0) || opts.concat.as_ref().is_some_and(|c| c.timings.is_some()) { return Ok(Vec::new()); }
    for (i, input) in inputs.iter().enumerate() {
        if opts.chapter_input.is_some_and(|n| n as usize != i) { continue; }
        let mut chapters = match input {
            super::MediaInput::Joined(_, decoded) if decoded.timings.is_some() => decoded.chapters.clone(),
            super::MediaInput::Bytes("mp4" | "mov", bytes) | super::MediaInput::Joined(bytes, _) => {
                let moov = movie(bytes)?;
                let (tracks, duration) = read_tracks(bytes, moov)?;
                read_chapters(bytes, moov, &tracks, duration, opts.limit)?
            }
            super::MediaInput::Bytes("mkv" | "webm", bytes) => mkv_input::parse(bytes, opts.limit)?.chapters.into_iter()
                .map(|(id, start, end, title)| Chapter { id, scale: 1_000_000_000, start: start as i64, end: end as i64, title }).collect(),
            _ => Vec::new(),
        };
        if chapters.is_empty() && opts.chapter_input.is_none() { continue; }
        let offset = ((opts.start.unwrap_or(0.) + opts.input_times.get(i).and_then(|t| t.start).unwrap_or(0.)) * 1_000_000.).round() as i64;
        let span = opts.end.map(|end| ((end - opts.start.unwrap_or(0.)) * 1_000_000.).round() as i64);
        let mut done = false;
        chapters.retain_mut(|c| {
            let offset = super::lrc::rescale(offset, (1, 1_000_000), i64::from(c.scale));
            let span = span.map(|span| super::lrc::rescale(span, (1, 1_000_000), i64::from(c.scale)));
            if done || c.end < offset { return false; }
            if span.is_some_and(|span| c.start > span.saturating_add(offset)) { done = true; return false; }
            c.start = c.start.saturating_sub(offset).max(0);
            c.end = c.end.saturating_sub(offset);
            if let Some(span) = span { c.end = c.end.min(span); }
            if opts.strip_metadata { c.title = None; }
            true
        });
        return Ok(chapters);
    }
    Ok(Vec::new())
}

fn read_tracks<'a>(input: &'a [u8], moov: &'a [u8]) -> Result<(Vec<Track<'a>>, f64), String> {
    let (scale, ticks) = header_time(child(moov, b"mvhd"), 1000);
    let mut tracks = Vec::new();
    let mut duration = ticks as f64 / f64::from(scale);
    let mvex = child(moov, b"mvex");
    for (_, trak) in atoms(moov).filter(|(k, _)| *k == b"trak") {
        if tracks.len() == 32 {
            return Err(
                "Resource limit exceeded for maxStreams: 33 exceeds maximum allowed 32".into(),
            );
        }
        let t = Track::parse(trak, tracks.len(), scale, input, mvex)?;
        duration = duration.max(t.duration as f64 / f64::from(t.scale));
        tracks.push(t);
    }
    Ok((tracks, duration))
}

pub(super) fn media_doc(input: &[u8]) -> Option<super::MediaDoc> {
    let moov = movie(input).ok()?;
    let (tracks, duration) = read_tracks(input, moov).ok()?;
    let audio = tracks.iter().find(|t| t.kind == "audio");
    let t = tracks.iter().find(|t| t.kind == "video").or(audio)?;
    let mut doc = super::MediaDoc::default_video();
    doc.codec_type = t.kind.into();
    doc.codec_name = t.codec().0.into();
    doc.width = t.width;
    doc.height = t.height;
    doc.nb_frames = t.stats.count as u32;
    if t.stats.ticks > 0 {
        doc.fps = (t.stats.count as f64 * f64::from(t.scale) / t.stats.ticks as f64).round() as u32;
    }
    doc.duration = duration;
    if let Some(a) = audio {
        doc.has_audio = true;
        doc.sample_rate = a.audio_rate().unwrap_or(a.scale);
        doc.channels = u32::from(a.channels());
    }
    doc.tags.extend(text_tags(moov).map(|(k, v)| (k.into(), v)));
    doc.title = doc.tags.get("title").cloned().unwrap_or_default();
    Some(doc)
}

fn ffmetadata(
    inputs: &[super::MediaInput],
    materialized: &[mux::InputBytes<'_>],
    opts: &mux::Remux,
) -> Result<Vec<u8>, String> {
    use std::fmt::Write;
    let mapped = !opts.maps.is_empty();
    let overrides = opts.metadata;
    let limit = opts.limit;
    let sphere = inputs.iter().any(|input| matches!(input, super::MediaInput::Bytes("nistsphere", _)));
    let aiff = inputs.iter().any(|input| matches!(input, super::MediaInput::Bytes("aiff" | "caf", _)));
    let mut custom = Vec::<(String, String)>::new();
    let mut metadata = std::collections::BTreeMap::new();
    let mut chapter_text = String::new();
    for (i,source) in inputs.iter().enumerate(){
        if opts.strip_metadata { break; }
        let input=match source{
            super::MediaInput::Joined(b,_) | super::MediaInput::Bytes("mp4"|"mov",b)=>b.as_slice(),
            super::MediaInput::Bytes("mkv"|"webm",_)=>materialized[i].bytes.as_ref(),
            super::MediaInput::Bytes("y4m",b)=>{super::y4m::Stream::parse(b)?;continue;}
            super::MediaInput::Bytes("au",b)=>{
                let doc=super::au::Document::read(b,limit)?;
                if i==0 || !mapped {metadata.extend(doc.tags.into_iter().map(|(k,v)|(match k.as_str(){"title"=>"title","artist"=>"artist","album"=>"album","genre"=>"genre",_=>"track"},v)));}
                continue;
            }
            super::MediaInput::Bytes("aiff",b)=>{
                let doc=super::aiff::Document::read(b,false,limit)?;
                if i==0 || !mapped {
                    for (key,value) in doc.tags {
                        if let Some(name)=["title","artist","album","date","comment","copyright","genre","track","disc","encoder"].into_iter().find(|&name|name==key) {metadata.insert(name,value);}
                        else if key!="albumArtist" {if let Some((_,old))=custom.iter_mut().find(|(k,_)|k==&key){*old=value;}else{custom.push((key,value));}}
                    }
                }
                continue;
            }
            super::MediaInput::Bytes("wv",b)=>{
                let doc=super::wavpack::Document::read(b,limit)?;
                doc.decode(limit,super::ffmpeg_pcm::Format::Float(64,false))?;
                if i==0 || !mapped {
                    for (key,value) in doc.tags {
                        if key=="encoder" {continue;}
                        if let Some(name)=["title","artist","album","date","comment","copyright","genre","track","disc"].into_iter().find(|&name|name==key) {metadata.insert(name,value);}
                        else {custom.push((key,value));}
                    }
                }
                continue;
            }
            super::MediaInput::Bytes("nut",b)=>{super::nut::Document::read(b,limit)?;continue;}
            super::MediaInput::Bytes("caf",b)=>{
                let doc=super::caf::Document::read(b,false,limit)?;
                if i==0 || !mapped {
                    for (key,value) in doc.tags {
                        if let Some(name)=["title","artist","album","comment","encoder"].into_iter().find(|&name|name==key) {metadata.insert(name,value);}
                        else if let Some((_,old))=custom.iter_mut().find(|(k,_)|k==&key){*old=value;}else{custom.push((key,value));}
                    }
                }
                continue;
            }
            super::MediaInput::Bytes("nistsphere",b)=>{
                let doc=super::nistsphere::Document::read(b,limit)?;
                if i==0 || !mapped {
                    for (key,value) in doc.tags {
                        if let Some((_,previous))=custom.iter_mut().find(|(k,_)|k==&key) { *previous=value; }
                        else { custom.push((key,value)); }
                    }
                }
                continue;
            }
            super::MediaInput::Bytes("voc",b)=>{super::voc::Document::read(b,limit)?;continue;}
            super::MediaInput::Bytes("ircam",b)=>{super::ircam::read(b)?;continue;}
            super::MediaInput::Bytes("wav" | "w64",b)=>{super::ffmpeg_wave::Wave::read(b)?;continue;}
            super::MediaInput::Bytes("lavfi",_) | super::MediaInput::Images(_)=>{
                if i==0 || !mapped{metadata.insert("encoder","@poe-code/mp4-ast".into());}
                continue;
            }
            _=>continue,
        };
        let moov = movie(input)?;
        read_tracks(input, moov)?;
        if i != 0 && mapped {
            continue;
        }
        metadata.extend(text_tags(moov));
    }
    for c in output_chapters(inputs, opts)? {
        writeln!(chapter_text, "[CHAPTER]\nTIMEBASE=1/{}\nSTART={}\nEND={}", c.scale, c.start, c.end).unwrap();
        if let Some(title) = c.title {
            chapter_text.push_str("title=");
            for ch in title.chars() {
                if matches!(ch, '\\' | '\n' | '=' | ';' | '#') { chapter_text.push('\\'); }
                chapter_text.push(ch);
            }
            chapter_text.push('\n');
        }
        if chapter_text.len() > limit { return Err("output byte limit exceeded".into()); }
    }
    for (key,value) in overrides {
        if !matches!(key.as_str(),"title"|"artist"|"album"|"date"|"comment"|"copyright"|"genre"|"encoder")
            && let Some(index)=custom.iter().position(|(k,_)|k==key) {
            custom.remove(index);
            if !value.is_empty() { custom.push((key.clone(),value.clone())); }
        }
    }
    if (sphere || aiff || inputs.iter().any(|input| matches!(input, super::MediaInput::Bytes("ico" | "nut" | "wv", _)))) && !opts.bitexact {
        if overrides.is_empty() { metadata.insert("encoder","Lavf61.7.100".into()); }
        else { custom.push(("encoder".into(),"Lavf61.7.100".into())); }
    }
    let mut tags = Vec::<(String,String)>::new();
    for name in [
        "title", "artist", "album", "date", "comment", "copyright", "genre", "track", "disc", "encoder",
    ] {
        let mut value = overrides.iter().find(|(key, _)| key == name).map(|(_, value)| value);
        if name == "date" {
            value = value.or_else(|| overrides.iter().find(|(key, _)| key == "year").map(|(_, value)| value));
        }
        if let Some(v) = value
            .or_else(|| metadata.get(name))
            .filter(|v| !v.is_empty())
        {
            tags.push((name.into(),v.clone()));
        }
    }
    for (key,value) in custom {
        if let Some((_,previous))=tags.iter_mut().find(|(k,_)|k==&key) { *previous=value; }
        else { tags.push((key,value)); }
    }
    let mut out=String::from(";FFMETADATA1\n");
    for (key,value) in tags {
        for (text,separator) in [(key,'='),(value,'\n')] {
            for ch in text.chars() {
                if matches!(ch,'\\'|'\n'|'='|';'|'#') { out.push('\\'); }
                out.push(ch);
            }
            out.push(separator);
        }
        if out.len()>limit { return Err("output byte limit exceeded".into()); }
    }
    if out.len().saturating_add(chapter_text.len()) > limit {
        return Err("output byte limit exceeded".into());
    }
    out.push_str(&chapter_text);
    Ok(out.into_bytes())
}

pub(super) fn render_video(
    input: &[u8],
    opts: super::y4m::Options<'_>,
    maps: &[&str],
    full_size: bool,
    emit: impl FnMut(super::y4m::Frame, super::y4m::TimedFrame) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let moov = movie(input)?;
    let (tracks, duration) = read_tracks(input, moov)?;
    let selected = mux::select_tracks(maps, 1, |_| tracks.len(), |_, i| tracks[i].kind)?;
    let automatic = maps.is_empty() || maps.iter().all(|m| m.ends_with('?')) && mux::select_tracks(&maps.iter().map(|m|m.trim_end_matches('?')).collect::<Vec<_>>(),1,|_|tracks.len(),|_,i|tracks[i].kind)?.is_empty();
    let mut videos = selected
        .iter()
        .map(|&(_, i)| &tracks[i])
        .filter(|t| t.kind == "video" && !opts.no_video);
    let Some(t) = (if automatic {
        videos.max_by_key(|t| (u64::from(t.width)*u64::from(t.height) + 100_000_000*u64::from(t.stats.count!=0) + 5_000_000*u64::from(t.enabled), std::cmp::Reverse(t.index)))
    } else { videos.next() })
    else {
        return Ok((64, 64, 10));
    };
    let duration = if opts.filters.is_empty() && (opts.start > 0. || opts.end.is_some()) {
        let scale = header_time(child(moov, b"mvhd"), 1000).0;
        selected.iter().map(|&(_, i)| mux::cut_duration(&tracks[i], input, scale, (opts.start, opts.end))).fold(0., f64::max)
    } else { duration };
    render_track(input, t, Some(duration), opts, full_size, emit)
}

struct VideoDecoder<'a> {
    track: &'a Track<'a>,
    state: Option<(u32, h264::Pcm)>,
    next: usize,
    remaining: usize,
    limit: usize,
}
impl<'a> VideoDecoder<'a> {
    fn new(track: &'a Track<'a>, limit: usize) -> Self {
        Self {
            track,
            state: None,
            next: 0,
            remaining: limit.saturating_mul(32),
            limit,
        }
    }
    fn decode(&mut self, desc: u32, data: &[u8]) -> Result<&mut h264::Pcm, &'static str> {
        if self.track.original.avi().is_some_and(|a| a.width < 0) {
            return Err("Invalid H.264 pixel limit");
        }
        self.remaining = self
            .remaining
            .checked_sub(data.len())
            .ok_or("H.264 decode work limit exceeded")?;
        if self.state.as_ref().is_none_or(|(id, _)| *id != desc) {
            let (tag, entry) = desc.checked_sub(2)
                .and_then(|i| self.track.other_video.get(i as usize).copied())
                .unwrap_or((self.track.tag, self.track.entry));
            let config = self.track.original.avcc(entry);
            let generated;
            let config = if let Some(config) = config {
                config
            } else if matches!(tag, b"avc1" | b"avc3") {
                let dimension = |offset, fallback: u32| {
                    entry.get(offset..offset+2).map_or(fallback as usize, |b| usize::from(u16_at(b, 0)))
                };
                let w = dimension(24, self.track.width);
                let h = dimension(26, self.track.height);
                if w.div_ceil(16).max(1).saturating_mul(h.div_ceil(16).max(1)) > self.limit / 384 {
                    return Err("image exceeds memory budget");
                }
                generated = h264::configuration(w as i64, h as u32, 30)?;
                &generated
            } else if super::image_header::recognized_image(data) {
                return Err(h264::INVALID_PACKET);
            } else {
                return Err("unsupported MP4 video codec or missing H.264 sequence parameters");
            };
            let seq = h264::Sequence::from_config(config).ok_or(h264::INVALID_PACKET)?;
            self.state = Some((desc, h264::Pcm::new(seq, config, self.limit)?));
        }
        let d = &mut self.state.as_mut().unwrap().1;
        d.decode(data)?;
        self.next += 1;
        Ok(d)
    }
    fn picture<'b>(
        &mut self,
        index: usize,
        mut packet: impl FnMut(usize) -> (u32, &'b [u8]),
        promote: Option<usize>,
    ) -> Result<&h264::Pcm, &'static str> {
        if self.next > index + 1 {
            self.next = 0;
            self.state = None;
        }
        while self.next <= index {
            let i = self.next;
            let (desc, data) = packet(i);
            let (w, h, limit) = (self.track.width, self.track.height, self.limit);
            let d = self.decode(desc, data)?;
            if Some(i) == promote && data.get(4).is_some_and(|v| v & 31 == 1) {
                d.promote(w as usize, h as usize, limit)?;
            }
        }
        Ok(&self.state.as_ref().unwrap().1)
    }
}

struct VideoFrames<'a> {
    track: Track<'a>,
    input: &'a [u8],
    samples: Vec<Sample>,
    frames: Vec<(usize, (f64, f64))>,
}

impl<'a> VideoFrames<'a> {
    fn read(input: &'a [u8], index: usize, seek: super::InputTime, limit: usize) -> Result<Self, String> {
        let (mut tracks, _) = read_tracks(input, movie(input)?)?;
        // The demuxer loops the packet span, including compressed preroll.
        // Presentation edits still decide which frames each pass emits.
        let period = tracks.iter().map(|t| {
            t.stats.media_end.max(i128::from(t.probe_origin.saturating_add(t.duration).saturating_sub(t.empty_ticks))) as f64 / f64::from(t.scale)
        }).fold(0., f64::max);
        let track = tracks.swap_remove(index);
        let count = track.stats.count.checked_mul(seek.loops.saturating_add(1))
            .filter(|&n| n <= limit / size_of::<Sample>()).ok_or("frame index exceeds memory budget")?;
        let mut samples: Vec<_> = track.samples(input.len()).collect();
        if let Some(last) = samples.last_mut() {
            let end = track.probe_origin.saturating_add(track.duration).saturating_sub(track.empty_ticks);
            last.tick = u32::try_from(u64::from(last.tick).max(end.saturating_sub(last.dts))).map_err(|_| "track duration exceeds limit")?;
        }
        let scale = f64::from(track.scale);
        let start = (seek.start.unwrap_or(0.).max(0.) * scale).round() as i128;
        let end = seek.end().map_or(i128::MAX, |t| (t * scale).round() as i128);
        let mut frames = Vec::with_capacity(count);
        for copy in 0..=seek.loops {
            let offset = (copy as f64 * period * scale).round() as i128
                + i128::from(track.empty_ticks) - i128::from(track.probe_origin);
            for (i, sample) in samples.iter().enumerate() {
                let pts = sample.pts + offset;
                if !track.discarded_packet(sample) && pts >= start && pts < end {
                    frames.push((i, ((pts - start) as f64 / scale, i128::from(sample.tick).min(end - pts) as f64 / scale)));
                }
            }
        }
        Ok(Self { track, input, samples, frames })
    }

    fn image(&self, index: usize, decoder: &mut VideoDecoder<'_>, limit: usize) -> Result<super::y4m::Frame, &'static str> {
        let index = self.frames[index].0;
        let sample = &self.samples[index];
        let tag = sample.description.checked_sub(2).and_then(|n| self.track.other_video.get(n as usize)).map_or(self.track.tag, |(tag,_)| *tag);
        if tag == b"png " {
            return super::png_pixels::Raster::decode(&self.input[sample.offset..sample.offset + sample.size as usize], limit).map(Into::into);
        }
        decoder.picture(index, |n| {
            let sample = &self.samples[n];
            (sample.description, &self.input[sample.offset..sample.offset + sample.size as usize])
        }, None)?.planes(limit)
    }
}

fn render_track(
    input: &[u8],
    t: &Track<'_>,
    duration: Option<f64>,
    opts: super::y4m::Options<'_>,
    full_size: bool,
    emit: impl FnMut(super::y4m::Frame, super::y4m::TimedFrame) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    if t.stats.count != 0 && t.original.avi().is_some_and(|a| a.width < 0) {return Err("Invalid H.264 pixel limit".into());}
    let (w, h) = (t.width as usize, t.height as usize);
    let limit = opts.limit;
    if t.stats.count > limit / size_of::<Sample>() {
        return Err("frame index exceeds memory budget".into());
    }
    let samples: Vec<_> = t.samples(input.len()).collect();
    let scale = f64::from(t.scale);
    let start = t.origin.saturating_add((opts.start * scale).round() as u64);
    let end = opts.end.map_or(u64::MAX, |s| {
        t.origin.saturating_add((s * scale).round() as u64)
    });
    // Keep every packet available to the decoder, but only present samples
    // admitted by the movie edit and requested output interval.
    let visible: Vec<_> = samples.iter().enumerate().filter_map(|(i, s)| {
        (end > start && !t.discarded_packet(s)
            && s.dts.saturating_add(s.tick.into()) > start && s.dts < end).then_some(i)
    }).collect();
    let first = visible.first().copied().unwrap_or(0);
    let count = visible.len();
    // Full decoded frames retain the source sample delay (including when a GIF caps the frame count).
    let sample_timing = full_size || duration.is_none() || !opts.filters.is_empty();
    let duration = duration.unwrap_or_default();
    let produced = count.min(opts.frames.map_or(usize::MAX, |n| n.max(1) as usize));
    let uniform = if duration > 0. && produced != 0 {
        duration / produced as f64
    } else {
        1. / 30.
    };
    let times = visible.iter().map(|&i| {
        let s = &samples[i];
        let tick = if sample_timing {
            s.dts
                .saturating_add(s.tick.into())
                .min(end)
                .saturating_sub(s.dts) as f64
                / scale
        } else {
            uniform
        };
        (s.dts.saturating_sub(start) as f64 / scale, tick)
    });
    let mut decoder = VideoDecoder::new(t, limit);
    super::y4m::render_frames(
        w,
        h,
        (scale, Some(t.frame_rate())),
        times,
        super::y4m::Options {
            start: 0.,
            end: None,
            ..opts
        },
        |i| {
            let sample = &samples[visible[i]];
            let tag = sample.description.checked_sub(2).and_then(|n| t.other_video.get(n as usize)).map_or(t.tag, |(tag,_)| *tag);
            if tag == b"png " {
                return super::png_pixels::Raster::decode(&input[sample.offset..sample.offset + sample.size as usize], limit).map(Into::into);
            }
            let promote = (!sample_timing && (opts.start > 0. || opts.end.is_some())).then_some(first);
            let d = decoder.picture(
                visible[i],
                |n| {
                    let s = &samples[n];
                    (s.description, &input[s.offset..s.offset + s.size as usize])
                },
                promote,
            )?;
            if sample_timing { d.planes(limit) } else { d.image((w, h), false, limit).map(Into::into) }
        },
        emit,
    )?;
    Ok((w, h, 30))
}

#[path = "streaming_probe.rs"]
pub(super) mod streaming_probe;

pub(super) fn report(
    input: &[u8],
    filename: &str,
    mut opts: ProbeOptions<'_>,
) -> Result<String, String> {
    let moov = movie(input)?;
    let (tracks, duration) = read_tracks(input, moov)?;
    let counts = (opts.counts.0 || opts.show.contains("frame"), opts.counts.1 || opts.show.contains("packet"));
    let optional = !matches!(opts.writer, "json" | "xml");
    if opts.show.contains("packet") && opts.show.contains("frame") {
        opts.show.remove("packet"); opts.show.remove("frame"); opts.show.insert("packet_frame");
    }
    let select = opts.select;
    let chapters = read_chapters(input, moov, &tracks, duration, opts.limit)?;
    media_probe::report(opts, |section| match section {
        "chapter" => Box::new(chapters.iter().map(chapter_row)),
        "format" => { let mut row = media_probe::format_row(
            filename,
            input.len(),
            ("mov,mp4,m4a,3gp,3g2,mj2", "QuickTime / MOV"),
            tracks.len(),
            duration,
            tags(input, moov),
        ); row.insert(3, ("nb_stream_groups", Number(0., None))); Box::new(std::iter::once(row)) },
        "stream" => Box::new(
            tracks
                .iter()
                .filter(|t| {
                    media_probe::selected(
                        select,
                        t.kind,
                        t.index,
                        tracks[..t.index]
                            .iter()
                            .filter(|p| p.kind == t.kind)
                            .count(),
                    )
                })
                .map(move |t| {
                    let (frames, packets) = if counts.0 || counts.1 {
                        let mut skip = 0;
                        t.samples(input.len()).skip(t.edit_start(input.len()))
                            .filter(|s| s.dts < t.origin || !t.discarded_pcm_sample(s))
                            .fold((0, 0), |(frames, packets), s| (frames + usize::from(t.frame_skip(&s, &mut skip).is_some()), packets + 1))
                    } else { (0, 0) };
                    t.stream(counts, frames, packets, optional)
                }),
        ),
        "packet" | "packet_frame" => {
            let mut pending = None;
            let mut streams: Vec<_> = tracks.iter().filter(|t| {
                !(t.kind == "data" && t.tag == b"text") && media_probe::selected(select, t.kind, t.index, tracks[..t.index].iter().filter(|p| p.kind == t.kind).count())
            }).map(|t| (t, 0u64, t.samples(input.len()).skip(t.edit_start(input.len()))
                .filter(move |s| s.dts < t.origin || !t.discarded_pcm_sample(s)).peekable())).collect();
            Box::new(std::iter::from_fn(move || {
                if let Some(row) = pending.take() { return Some(row); }
                let mut best: Option<(usize, i128, usize)> = None;
                for (i, (t, _, samples)) in streams.iter_mut().enumerate() {
                    let Some(s) = samples.peek() else { continue; };
                    let dts = i128::from(s.dts) - i128::from(t.probe_origin) + i128::from(t.empty_ticks);
                    let dts = (dts * 1_000_000 + dts.signum() * i128::from(t.scale) / 2) / i128::from(t.scale);
                    // Seekable MOV demuxing favors file position within a
                    // second, then DTS for streams stored farther apart.
                    if best.is_none_or(|(_, time, pos)| if dts.abs_diff(time) <= 1_000_000 { s.offset < pos } else { dts < time }) {
                        best = Some((i, dts, s.offset));
                    }
                }
                let (t, skip, samples) = &mut streams[best?.0];
                let mut s = samples.next()?;
                s.key = t.packet_key(input, &s);
                if section == "packet_frame" && let Some(skipped) = t.frame_skip(&s, skip) {
                    let mut row = t.record(s, Some(skipped), optional);
                    row.insert(0, ("type", Str("frame".into())));
                    pending = Some(row);
                }
                let mut row = t.record(s, None, optional);
                if section == "packet_frame" { row.insert(0, ("type", Str("packet".into()))); }
                Some(row)
            }))
        }
        "frame" => Box::new(tracks.iter().filter(|t| {
            !(t.kind == "data" && t.tag == b"text") && media_probe::selected(select, t.kind, t.index, tracks[..t.index].iter().filter(|p| p.kind == t.kind).count())
        }).flat_map(move |t| {
            let mut skip = 0;
            t.samples(input.len()).skip(t.edit_start(input.len()))
                .filter(move |s| s.dts < t.origin || !t.discarded_pcm_sample(s))
                .filter_map(move |mut s| {
                    let skipped = t.frame_skip(&s, &mut skip)?;
                    s.key = t.packet_key(input, &s);
                    Some(t.record(s, Some(skipped), optional))
                })
        })),
        _ => Box::new(std::iter::empty()),
    })
    .map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    #[test]
    fn mp4_pcm_sample_description_versions_match_native() {
        use super::*;
        use crate::{commands::structured::{JVal, parse_json_stream}, vfs::{MemoryVfs, SafeBashFs}};
        let JVal::Object(fixture) = parse_json_stream(include_str!("../../tests/fixtures/mp4-pcm.json")).unwrap().remove(0) else { panic!("fixture") };
        let JVal::Object(inputs) = &fixture.iter().find(|(k, _)| k == "inputs").unwrap().1 else { panic!("inputs") };
        let fs = MemoryVfs::new();
        for (name, data) in inputs {
            let JVal::Str(hex) = data else { panic!("input") };
            fs.write_file(&format!("/{name}"), &super::super::hex_dec(hex)).unwrap();
        }
        for codec in ["s16le", "s16be", "s24le", "s24be", "s32le", "s32be", "f32le", "f32be", "f64le", "f64be"] {
            for rate in [16000, 96000] {
                let native = fs.read_file(&format!("/{codec}-{rate}.mp4")).unwrap();
                let args = ["-y", "-i", "source.wav", "-ar", &rate.to_string(), "-c:a", &format!("pcm_{codec}"), "-f", "mp4", "output"];
                let result = super::super::cmd_media_doc("ffmpeg", &args.map(String::from), "", "/", &fs);
                assert_eq!(result.exit_code, 0, "{codec}/{rate}: {}", result.stderr);
                let output = fs.read_file("/output").unwrap();
                let descriptions = [&output, &native].map(|bytes| {
                    [b"trak", b"mdia", b"minf", b"stbl", b"stsd"].into_iter().fold(movie(bytes).unwrap(), child)
                });
                assert_eq!(descriptions[0][..8], descriptions[1][..8], "{codec}/{rate}: sample-description version and count");
            }
        }
    }

    #[test]
    fn copied_video_seeks_match_native_packets_and_edits() {
        use super::*;
        use crate::{commands::{archive::sha256_bytes, structured::{JVal, parse_json_stream}}, vfs::{MemoryVfs, SafeBashFs}};
        let JVal::Object(fixture) = parse_json_stream(include_str!("../../tests/fixtures/copy-video-seek.json")).unwrap().remove(0) else { panic!("fixture") };
        let JVal::Object(inputs) = &fixture.iter().find(|(k,_)|k=="inputs").unwrap().1 else { panic!("inputs") };
        let JVal::Array(cases) = &fixture.iter().find(|(k,_)|k=="cases").unwrap().1 else { panic!("cases") };
        let fs = MemoryVfs::new();
        for (name, value) in inputs { let JVal::Str(bytes)=value else {panic!("input")}; fs.write_file(&format!("/{name}"), &super::super::hex_dec(bytes)).unwrap(); }
        let JVal::Object(keys) = &fixture.iter().find(|(k,_)|k=="keys").unwrap().1 else { panic!("keys") };
        for (name, expected) in keys {
            let bytes=fs.read_file(&format!("/{name}")).unwrap();
            let (tracks,_)=read_tracks(&bytes,movie(&bytes).unwrap()).unwrap();
            let actual=tracks.iter().filter(|t|t.kind=="video").flat_map(|t|t.samples(bytes.len()).map(|s|JVal::Bool(t.packet_key(&bytes,&s)))).collect();
            assert_eq!(&JVal::Array(actual),expected,"{name}: native key flags");
        }
        let mut failures = Vec::new();
        for case in cases {
            let JVal::Object(fields) = case else { panic!("case") };
            let field = |key| &fields.iter().find(|(k,_)|k==key).unwrap().1;
            let text = |key| match field(key) { JVal::Str(s)=>s.as_str(), _=>panic!("text") };
            let JVal::Array(args) = field("args") else { panic!("args") };
            let mut args: Vec<_> = args.iter().map(|v|match v {JVal::Str(s)=>s.clone(), _=>panic!("arg")}).collect();
            args.insert(0,"-y".into());
            let result = super::super::cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            if result.exit_code != 0 { failures.push(format!("{}: {}",text("name"),result.stderr)); continue; }
            for (key, args) in [
                ("streams",vec!["-show_entries","stream=codec_name,start_pts,start_time,duration_ts,duration,nb_frames","-of","csv=p=0","out.mp4"]),
                ("video",vec!["-select_streams","v","-show_packets","-show_entries","packet=pts,dts,duration","-of","csv=p=0","out.mp4"]),
            ] {
                let result=super::super::cmd_media_doc("ffprobe",&args.iter().map(|s|(*s).into()).collect::<Vec<_>>(),"","/",&fs);
                if result.exit_code!=0 || result.stdout!=text(key) { failures.push(format!("{} {key}: {:?}, expected {:?}",text("name"),result.stdout,text(key))); }
            }
            let bytes=fs.read_file("/out.mp4").unwrap();
            let (tracks,_)=read_tracks(&bytes,movie(&bytes).unwrap()).unwrap();
            let declared = atoms(movie(&bytes).unwrap()).filter(|(tag,_)|*tag==b"trak").map(|(_,trak)| {
                JVal::Number(header_time(child(child(trak,b"mdia"),b"mdhd"),1000).1 as f64,None)
            }).collect();
            if &JVal::Array(declared)!=field("media_ticks") {failures.push(format!("{}: declared media durations differ",text("name")));}
            let hashes:Vec<_>=tracks.iter().filter(|t|t.kind=="video").flat_map(|t|t.samples(bytes.len())).map(|s| {
                JVal::Str(format!("SHA256:{}",sha256_bytes(&bytes[s.offset..s.offset+s.size as usize]).iter().map(|b|format!("{b:02x}")).collect::<String>()))
            }).collect();
            if &JVal::Array(hashes)!=field("hashes") {failures.push(format!("{}: copied packet hashes differ",text("name")));}
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }
    #[test]
    fn concat_duration_preserves_native_packet_and_pcm_timelines() {
        use super::*;
        use crate::{commands::{archive::sha256_bytes, structured::{JVal,parse_json_stream}}, vfs::{MemoryVfs,SafeBashFs}};
        let JVal::Object(fixture)=parse_json_stream(include_str!("../../tests/fixtures/concat-timelines.json")).unwrap().remove(0) else {panic!("fixture")};
        let JVal::Object(inputs)=&fixture.iter().find(|(k,_)|k=="inputs").unwrap().1 else {panic!("inputs")};
        let JVal::Array(cases)=&fixture.iter().find(|(k,_)|k=="cases").unwrap().1 else {panic!("cases")};
        let fs=MemoryVfs::new();
        for (name,value) in inputs {let JVal::Str(hex)=value else{panic!("hex")};fs.write_file(&format!("/{name}"),&super::super::hex_dec(hex)).unwrap();}
        let mut failures=Vec::new();
        for case in cases {
            let JVal::Object(fields)=case else{panic!("case")};
            let field=|key|&fields.iter().find(|(k,_)|k==key).unwrap().1;
            let text=|key|match field(key){JVal::Str(s)=>s.as_str(),_=>panic!("text")};
            fs.write_file("/list",text("list").as_bytes()).unwrap();
            let JVal::Array(args)=field("args") else{panic!("args")};
            let args=std::iter::once("-y".into()).chain(args.iter().map(|v|match v{JVal::Str(s)=>s.clone(),_=>panic!("arg")})).collect::<Vec<_>>();
            let r=super::super::cmd_media_doc("ffmpeg",&args,"","/",&fs);
            if r.exit_code!=0{failures.push(format!("{}: {}",text("name"),r.stderr));continue;}
            if fields.iter().any(|(k,_)|k=="pcm") {
                let pcm=fs.read_file("/out.pcm").unwrap();
                if pcm!=super::super::hex_dec(text("pcm")){failures.push(format!("{}: PCM differs ({} bytes)",text("name"),pcm.len()));}
                continue;
            }
            for (key,args) in [
                ("streams",vec!["-show_entries","stream=codec_name,time_base,start_pts,duration_ts,nb_frames","-of","csv=p=0","out.mp4"]),
                ("video",vec!["-select_streams","v","-show_packets","-show_entries","packet=pts,dts,duration","-of","csv=p=0","out.mp4"]),
                ("audio",vec!["-select_streams","a","-show_packets","-show_entries","packet=pts,dts,duration","-of","csv=p=0","out.mp4"]),
                ("read_packets",vec!["-count_packets","-show_entries","stream=nb_read_packets","-of","csv=p=0","out.mp4"]),
            ] {
                if !fields.iter().any(|(k,_)| k == key) { continue; }
                let r=super::super::cmd_media_doc("ffprobe",&args.iter().map(|s|(*s).into()).collect::<Vec<_>>(),"","/",&fs);
                if r.exit_code!=0||r.stdout!=text(key){failures.push(format!("{} {key}: {:?}, expected {:?}",text("name"),r.stdout,text(key)));}
            }
            let bytes=fs.read_file("/out.mp4").unwrap();let (tracks,_)=read_tracks(&bytes,movie(&bytes).unwrap()).unwrap();
            if fields.iter().any(|(k,_)| k == "descriptions") {
                let counts=tracks.iter().filter(|t|t.kind=="video").map(|t|JVal::Number((1+t.other_video.len()) as f64,None)).collect();
                if &JVal::Array(counts)!=field("descriptions"){failures.push(format!("{}: video descriptions differ",text("name")));}
            }
            let durations = atoms(movie(&bytes).unwrap()).filter(|(tag,_)| *tag == b"trak")
                .map(|(_,trak)| JVal::Number(header_time(child(child(trak,b"mdia"),b"mdhd"),1000).1 as f64,None)).collect();
            if &JVal::Array(durations) != field("media_ticks") {
                failures.push(format!("{}: media header durations differ",text("name")));
            }
            let hashes=tracks.iter().filter(|t|t.kind=="video").flat_map(|t|t.samples(bytes.len()).skip(t.edit_start(bytes.len()))).map(|s|JVal::Str(format!("SHA256:{}",sha256_bytes(&bytes[s.offset..s.offset+s.size as usize]).iter().map(|b|format!("{b:02x}")).collect::<String>()))).collect();
            if &JVal::Array(hashes)!=field("hashes"){failures.push(format!("{}: packet hashes differ",text("name")));}
            if fields.iter().any(|(k,_)| k == "audio_hashes") {
                let hashes = tracks.iter().filter(|t| t.kind == "audio").flat_map(|t| t.samples(bytes.len()))
                    .map(|s| JVal::Str(format!("SHA256:{}",sha256_bytes(&bytes[s.offset..s.offset+s.size as usize]).iter().map(|b|format!("{b:02x}")).collect::<String>()))).collect();
                if &JVal::Array(hashes) != field("audio_hashes") { failures.push(format!("{}: audio packet hashes differ",text("name"))); }
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }

}
