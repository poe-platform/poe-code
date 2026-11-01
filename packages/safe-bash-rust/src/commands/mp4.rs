#[path = "h264.rs"]
mod h264;
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

fn movie(input: &[u8]) -> Result<&[u8], &'static str> {
    atoms(input)
        .find_map(|(kind, payload)| (kind == b"moov").then_some(payload))
        .ok_or("Invalid MP4/ISOBMFF file: missing 'moov' atom")
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

struct Sample {
    tick: u32,
    description: u32,
    dts: u64,
    pts: i128,
    size: u64,
    offset: usize,
    pos: u64,
    key: bool,
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
fn esds(payload: &[u8]) -> AudioConfig {
    let mut at = if payload.len() >= 4 { 4 } else { 0 };
    let mut indication = 0x40;
    let mut asc = &[0x12, 0x10][..];
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
                asc = &payload[at..(at + len.min(6)).min(payload.len())];
                break;
            }
            _ => at = at.saturating_add(len),
        }
    }
    let mut bits = 0u64;
    if asc.len() < 2 {
        asc = &[0x12, 0x10]
    }
    for (i, &b) in asc.iter().enumerate() {
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
        v => v as u16,
    };
    AudioConfig {
        indication,
        object,
        rate,
        channels,
    }
}

struct Track<'a> {
    index: usize,
    id: u32,
    kind: &'static str,
    scale: u32,
    duration: u64,
    origin: u64,
    tag: &'a [u8; 4],
    audio: Option<AudioConfig>,
    sequence: Option<h264::Sequence>,
    sar: (u32, u32),
    entry: &'a [u8],
    width: u32,
    height: u32,
    enabled: bool,
    language: String,
    handler: &'a [u8],
    stats: Stats,
    runs: Vec<Run<'a>>,
    tables: Tables<'a>,
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
        let kind = match h.get(8..12) {
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
        let (tag, entry) = atoms(stsd.get(8..).unwrap_or_default())
            .next()
            .unwrap_or((if kind == "video" { b"avc1" } else { b"mp4a" }, &[]));
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
                    b"avcC" if body.get(5).is_some_and(|v| v & 31 != 0) && body.len() >= 8 => {
                        let sps = &body[8..(8 + usize::from(u16_at(body, 6))).min(body.len())];
                        if let Some(s) = h264::Sequence::parse(sps) {
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
        let origin = edits.peek().map_or(0, |r| {
            if v1 {
                (wide(r, 8, true) as i64).max(0) as u64
            } else {
                (u32_at(r, 4) as i32).max(0) as u64
            }
        });
        let duration = if edits.peek().is_some() {
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
        Ok(Self {
            index,
            id,
            kind,
            scale,
            duration,
            origin,
            tag,
            audio,
            sequence,
            sar,
            entry,
            width,
            height,
            enabled: tk.len() < 24 || tk[3] & 1 != 0,
            language,
            handler,
            stats,
            runs,
            tables,
        })
    }
    fn time(&self, ticks: f64) -> String {
        format!("{:.6}", ticks / f64::from(self.scale))
    }
    fn samples(&self, input_size: usize) -> impl Iterator<Item = Sample> + '_ {
        self.tables.samples(input_size).chain(
            self.runs
                .iter()
                .flat_map(move |r| r.samples(input_size, self.kind == "video")),
        )
    }
    fn subtitle_cues<'b>(
        &'b self,
        input: &'b [u8],
    ) -> impl Iterator<Item = (Sample, &'b [u8])> + 'b {
        let payload = |s: &Sample| &input[s.offset..s.offset + s.size as usize];
        self.tables
            .samples(input.len())
            .filter_map(move |s| {
                let mut data = payload(&s);
                if data.len() >= 2 {
                    let n = usize::from(u16_at(data, 0));
                    if n == 0 {
                        return None;
                    }
                    if n <= data.len() - 2 {
                        data = &data[2..2 + n]
                    }
                }
                Some((s, data))
            })
            .chain(
                self.runs
                    .iter()
                    .flat_map(move |r| r.samples(input.len(), false))
                    .map(move |s| {
                        let data = payload(&s);
                        (s, data)
                    }),
            )
    }

    fn write_subtitles(
        &self,
        input: &[u8],
        writer: &mut super::subtitles::Writer,
        range: Option<(f64, Option<f64>)>,
        materialized: bool,
    ) -> Result<(), &'static str> {
        let scale = f64::from(self.scale);
        let ms = |t: i128| (t as f64 * 1000. / scale).round() as i64;
        let emit = |writer: &mut super::subtitles::Writer, pts: i128, tick: u64, data: &[u8]| {
            writer.cue(
                ms(pts),
                ms(pts + i128::from(tick)),
                &String::from_utf8_lossy(data),
            )
        };
        // An input slice already holds timed-text packets. Reopening it as an
        // external MP4 would unpack the text a second time and discard gaps.
        let cues = || -> Box<dyn Iterator<Item = (Sample, &[u8])> + '_> {
            if materialized {
                Box::new(self.samples(input.len()).map(|s| {
                    let body = &input[s.offset..s.offset + s.size as usize];
                    (s, body)
                }))
            } else {
                Box::new(self.subtitle_cues(input))
            }
        };
        let Some((start, end)) = range else {
            for (s, data) in cues() {
                emit(writer, s.pts, u64::from(s.tick), data)?;
            }
            return Ok(());
        };
        let start = self.origin.saturating_add((start * scale).round() as u64);
        let end = self.origin.saturating_add(end.map_or(self.duration, |s| {
            ((s * scale).round() as u64).min(self.duration)
        }));
        if end <= start {
            return Ok(());
        }
        let packed = materialized
            || cues()
                .all(|(_, data)| data.len() >= 2 && usize::from(u16_at(data, 0)) == data.len() - 2);
        let mut out_dts = 0u64;
        let mut packet = |dts: u64, cts: i128, tick: u64, data: &[u8]| {
            if dts < end && dts.saturating_add(tick) > start {
                let tick = tick.min(end - dts);
                emit(writer, i128::from(out_dts) + cts, tick, data)?;
                out_dts = out_dts.saturating_add(tick);
            }
            Ok(())
        };
        let mut cursor = 0;
        let mut wrapped = Vec::new();
        for (s, data) in cues() {
            if packed {
                if s.dts >= end {
                    break;
                }
                packet(s.dts, s.pts - i128::from(s.dts), u64::from(s.tick), data)?;
            } else {
                let dts = cursor.max(s.pts.max(0) as u64);
                if dts > cursor {
                    packet(cursor, 0, dts - cursor, &[0, 0])?;
                }
                if dts >= end {
                    break;
                }
                let tick = u64::from(s.tick.max(1));
                if dts.saturating_add(tick) > start {
                    wrapped.clear();
                    wrapped.extend_from_slice(&(data.len() as u16).to_be_bytes());
                    wrapped.extend_from_slice(data);
                    packet(dts, 0, tick, &wrapped)?;
                }
                cursor = dts.saturating_add(tick);
            }
        }
        Ok(())
    }
    fn audio_rate(&self) -> u32 {
        if let Some(a) = &self.audio
            && a.rate > 0
        {
            return a.rate;
        }
        if self.entry.len() >= 28 {
            ((u64::from(u32_at(self.entry, 24)) + 32768) >> 16) as u32
        } else {
            self.scale
        }
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
        opts.encode(self.audio_rate(), self.channels().into(), samples)
    }
    fn channels(&self) -> u16 {
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
            b"tx3g" | b"text" => ("mov_text", "3GPP Timed Text subtitle"),
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
        if matches!(self.tag, b"sowt" | b"lpcm" | b"twos") {
            "s16"
        } else {
            "fltp"
        }
    }
    fn record(&self, s: Sample, frame: bool) -> Row {
        let pts = s.pts as f64;
        let dts = s.dts as f64;
        let duration = f64::from(s.tick);
        let mut r = vec![
            (
                if frame { "media_type" } else { "codec_type" },
                Str(self.kind.into()),
            ),
            ("stream_index", Number(self.index as f64)),
        ];
        if frame {
            r.push(("key_frame", Number(f64::from(s.key))))
        }
        r.extend([
            ("pts", Number(pts)),
            ("pts_time", Str(self.time(pts))),
            (if frame { "pkt_dts" } else { "dts" }, Number(dts)),
            (
                if frame { "pkt_dts_time" } else { "dts_time" },
                Str(self.time(dts)),
            ),
        ]);
        if frame {
            r.extend([
                ("best_effort_timestamp", Number(pts)),
                ("best_effort_timestamp_time", Str(self.time(pts))),
            ])
        }
        r.extend([
            (
                if frame { "pkt_duration" } else { "duration" },
                Number(duration),
            ),
            (
                if frame {
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
        if !frame {
            r.extend([
                ("pos", Str(s.pos.to_string())),
                ("flags", Str(if s.key { "K_" } else { "__" }.into())),
            ])
        } else {
            if self.width != 0 {
                r.push(("width", Number(self.width.into())))
            }
            if self.height != 0 {
                r.push(("height", Number(self.height.into())))
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
                    ("nb_samples", Number(duration)),
                    ("channels", Number(self.channels().into())),
                ])
            }
        }
        r
    }
    fn stream(&self, counts: (bool, bool)) -> Row {
        let (codec, long_name) = self.codec();
        let mut r = vec![
            ("index", Number(self.index as f64)),
            ("id", Str(format!("0x{:x}", self.id))),
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
                    .tag
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
            ("codec_tag", Str(format!("0x{:08x}", u32_at(self.tag, 0)))),
        ]);
        let (w, h) = (self.width, self.height);
        if w != 0 {
            r.push(("width", Number(w.into())))
        }
        if h != 0 {
            r.push(("height", Number(h.into())))
        }
        if w != 0 {
            r.push(("coded_width", Number(f64::from(w.div_ceil(16)) * 16.)))
        }
        if h != 0 {
            r.push(("coded_height", Number(f64::from(h.div_ceil(16)) * 16.)))
        }
        if self.kind == "video" {
            r.extend([
                ("has_b_frames", Number(f64::from(self.stats.b_frames))),
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
                r.push(("level", Number((*level).into())))
            }
            r.extend([
                ("color_range", Str("tv".into())),
                ("color_space", Str("bt709".into())),
            ]);
        } else if self.kind == "audio" {
            let channels = self.channels();
            let rate = self.audio_rate();
            let bits = if self.entry.len() >= 28 {
                u16_at(self.entry, 18)
            } else {
                16
            };
            r.extend([
                ("sample_fmt", Str(self.sample_fmt().into())),
                ("sample_rate", Str(rate.to_string())),
                ("channels", Number(channels.into())),
                (
                    "channel_layout",
                    Str(if channels == 1 { "mono" } else { "stereo" }.into()),
                ),
                ("bits_per_sample", Number(bits.into())),
            ]);
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
        let dur = self.duration as f64 / f64::from(self.scale);
        let mut tags = vec![("language".into(), Str(self.language.clone()))];
        if !self.handler.is_empty() {
            tags.push((
                "handler_name".into(),
                Str(String::from_utf8_lossy(self.handler).into_owned()),
            ))
        }
        r.extend([
            ("r_frame_rate", Str(rate.clone())),
            ("avg_frame_rate", Str(rate)),
            ("time_base", Str(format!("1/{}", self.scale))),
            ("start_pts", Number(self.stats.start as f64)),
            ("start_time", Str(self.time(self.stats.start as f64))),
            ("duration_ts", Number(self.duration as f64)),
            ("duration", Str(format!("{dur:.6}"))),
            (
                "bit_rate",
                Str(if dur == 0. {
                    "0".into()
                } else {
                    (self.stats.bytes as f64 * 8. / dur).round().to_string()
                }),
            ),
            ("nb_frames", Str(self.stats.count.to_string())),
            (
                "disposition",
                Object(media_probe::disposition(self.enabled)),
            ),
            ("tags", Object(tags)),
        ]);
        if counts.0 {
            r.push(("nb_read_frames", Str(self.stats.count.to_string())))
        }
        if counts.1 {
            r.push(("nb_read_packets", Str(self.stats.count.to_string())))
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

fn chapter_entries(moov: &[u8], duration: f64) -> impl Iterator<Item = (f64, f64, &[u8])> {
    let chpl = child(child(moov, b"udta"), b"chpl");
    let count = chpl.get(8).copied().unwrap_or(0);
    let (mut bytes, count) = if count == 0 {
        (chpl.get(13..), u32_at(chpl, 9))
    } else {
        (chpl.get(9..), u32::from(count))
    };
    (0..count).map_while(move |id| {
        let row = bytes?;
        let len = usize::from(*row.get(8)?).min(row.len() - 9);
        let start = wide(row, 0, true) as f64 / 10_000_000.;
        bytes = Some(&row[9 + len..]);
        let end = if id + 1 < count && row.len() - 9 - len >= 9 {
            wide(row, 9 + len, true) as f64 / 10_000_000.
        } else {
            start.max(duration)
        };
        Some((start, end, &row[9..9 + len]))
    })
}

fn chapters(moov: &[u8], duration: f64) -> impl Iterator<Item = Row> + '_ {
    chapter_entries(moov, duration)
        .enumerate()
        .map(|(id, (start, end, title))| {
            let title = String::from_utf8_lossy(title);
            vec![
                ("id", Number(id as f64)),
                ("time_base", Str("1/1000".into())),
                ("start", Number((start * 1000.).round())),
                ("start_time", Str(format!("{start:.6}"))),
                ("end", Number((end * 1000.).round())),
                ("end_time", Str(format!("{end:.6}"))),
                (
                    "tags",
                    Object(vec![(
                        "title".into(),
                        Str(title.trim_start_matches('\u{feff}').into()),
                    )]),
                ),
            ]
        })
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
        doc.sample_rate = a.audio_rate();
        doc.channels = u32::from(a.channels());
    }
    doc.tags.extend(text_tags(moov).map(|(k, v)| (k.into(), v)));
    doc.title = doc.tags.get("title").cloned().unwrap_or_default();
    Some(doc)
}

pub(super) fn ffmetadata(
    inputs: &[super::MediaInput],
    mapped: bool,
    overrides: &std::collections::BTreeMap<String, String>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    use std::fmt::Write;
    let mut metadata = std::collections::BTreeMap::new();
    let mut chapter_text = String::new();
    for (i,source) in inputs.iter().enumerate(){
        let input=match source{
            super::MediaInput::Bytes("mp4"|"mov",b)=>b,
            super::MediaInput::Bytes("wav",b)=>{super::ffmpeg_wave::Wave::read(b)?;continue;}
            super::MediaInput::Bytes("lavfi",_) | super::MediaInput::Images(_)=>{
                if i==0 || !mapped{metadata.insert("encoder","@poe-code/mp4-ast".into());}
                continue;
            }
            _=>continue,
        };
        let moov = movie(input)?;
        let (_, duration) = read_tracks(input, moov)?;
        if i != 0 && mapped {
            continue;
        }
        metadata.extend(text_tags(moov));
        for (start, end, title) in chapter_entries(moov, duration) {
            let title = String::from_utf8_lossy(title);
            writeln!(
                chapter_text,
                "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={}",
                (start * 1000.).round() as u64,
                (end * 1000.).round() as u64,
                title.trim_start_matches('\u{feff}')
            )
            .unwrap();
            if chapter_text.len() > limit {
                return Err("output byte limit exceeded".into());
            }
        }
    }
    let mut out = String::from(";FFMETADATA1\n");
    for name in [
        "title", "artist", "album", "date", "comment", "genre", "encoder",
    ] {
        let mut value = overrides.get(name);
        if name == "date" {
            value = value.or_else(|| overrides.get("year"));
        }
        if let Some(v) = value
            .or_else(|| metadata.get(name))
            .filter(|v| !v.is_empty())
        {
            writeln!(out, "{name}={v}").unwrap();
        }
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
    emit: impl FnMut(super::png_pixels::Raster, f64, super::y4m::Buffer) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let (tracks, duration) = read_tracks(input, movie(input)?)?;
    let selected = mux::select_tracks(maps, 1, |_| tracks.len(), |_, i| tracks[i].kind)?;
    let Some(t) = selected
        .iter()
        .map(|&(_, i)| &tracks[i])
        .find(|t| t.kind == "video" && !opts.no_video)
    else {
        return Ok((64, 64, 10));
    };
    render_track(input, t, duration, opts, full_size, emit)
}

fn render_track(
    input: &[u8],
    t: &Track<'_>,
    duration: f64,
    opts: super::y4m::Options<'_>,
    full_size: bool,
    emit: impl FnMut(super::png_pixels::Raster, f64, super::y4m::Buffer) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let (w, h) = (t.width as usize, t.height as usize);
    let limit = opts.limit;
    if t.stats.count > limit / size_of::<Sample>() {
        return Err("frame index exceeds memory budget".into());
    }
    let samples: Vec<_> = t.samples(input.len()).collect();
    let scale = f64::from(t.scale);
    let start = if opts.start == 0. && opts.end.is_none() {
        0
    } else {
        t.origin.saturating_add((opts.start * scale).round() as u64)
    };
    let end = opts.end.map_or(u64::MAX, |s| {
        t.origin.saturating_add((s * scale).round() as u64)
    });
    let range = if end <= start {
        0..0
    } else {
        samples.partition_point(|s| s.dts.saturating_add(s.tick.into()) <= start)
            ..samples.partition_point(|s| s.dts < end)
    };
    let first = range.start;
    let count = range.len();
    let filtered = !opts.filters.is_empty();
    let produced = count.min(opts.frames.map_or(usize::MAX, |n| n.max(1) as usize));
    let sliced_duration = (opts.end.unwrap_or(duration).min(duration) - opts.start).max(0.);
    let uniform = if sliced_duration > 0. && produced != 0 {
        sliced_duration / produced as f64
    } else {
        1. / 30.
    };
    let times = range.map(|i| {
        let s = &samples[i];
        let tick = if filtered {
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
    let mut decoder = None;
    let mut replay_bytes = 0usize;
    super::y4m::render_frames(
        w,
        h,
        times,
        super::y4m::Options {
            start: 0.,
            end: None,
            ..opts
        },
        |i| {
            let index = first + i;
            if decoder.is_none() {
                let s = t
                    .sequence
                    .as_ref()
                    .ok_or_else(|| {
                        let sample = &samples[index];
                        let packet = &input[sample.offset..sample.offset + sample.size as usize];
                        if super::image_header::recognized_image(packet) {
                            "H.264 packet decode failed (-1094995529)"
                        } else {
                            "unsupported MP4 video codec or missing H.264 sequence parameters"
                        }
                    })?;
                decoder = Some(h264::Pcm::new(
                    s,
                    child(t.entry.get(78..).unwrap_or_default(), b"avcC"),
                    limit,
                )?);
            }
            let d = decoder.as_mut().unwrap();
            if d.next > index + 1 {
                d.next = 0
            }
            while d.next <= index {
                let sample = &samples[d.next];
                replay_bytes = replay_bytes.saturating_add(sample.size as usize);
                if replay_bytes > limit.saturating_mul(32) {
                    return Err("H.264 decode work limit exceeded");
                }
                let data = &input[sample.offset..sample.offset + sample.size as usize];
                let promote = d.next == first
                    && (opts.start > 0. || opts.end.is_some())
                    && data.get(4).is_some_and(|v| v & 31 == 1);
                d.decode(data)?;
                if promote {
                    d.promote(w, h, limit)?;
                }
            }
            d.image((w, h), full_size || filtered, limit)
        },
        emit,
    )?;
    Ok((w, h, 30))
}

pub(super) fn report(
    input: &[u8],
    filename: &str,
    opts: ProbeOptions<'_>,
) -> Result<String, String> {
    let moov = movie(input)?;
    let (tracks, duration) = read_tracks(input, moov)?;
    let counts = opts.counts;
    let select = opts.select;
    media_probe::report(opts, |section| match section {
        "chapter" => Box::new(chapters(moov, duration)),
        "format" => Box::new(std::iter::once(media_probe::format_row(
            filename,
            input.len(),
            ("mov,mp4,m4a,3gp,3g2,mj2", "QuickTime / MOV"),
            tracks.len(),
            duration,
            tags(input, moov),
        ))),
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
                .map(move |t| t.stream(counts)),
        ),
        "frame" | "packet" => Box::new(tracks.iter().flat_map(move |t| {
            t.samples(input.len())
                .map(move |s| t.record(s, section == "frame"))
        })),
        _ => Box::new(std::iter::empty()),
    })
    .map_err(str::to_owned)
}
