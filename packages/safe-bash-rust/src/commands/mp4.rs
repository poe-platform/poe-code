// Atom lengths include their own header. A zero length occupies the remainder of
// its parent; extended lengths include the extra eight bytes used for the size.
fn atoms(mut bytes: &[u8]) -> impl Iterator<Item = (&[u8; 4], &[u8])> {
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
        bytes = &bytes[end..];
        Some((kind, payload))
    })
}

pub(super) fn movie(input: &[u8]) -> Result<&[u8], &'static str> {
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
    dts: u64,
    pts: i64,
    size: u64,
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
                    per_chunk = u32_at(mappings.next().unwrap(), 4);
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
                dts,
                pts: dts as i64 + cts,
                size,
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

struct Track<'a> {
    index: usize,
    id: u32,
    kind: &'static str,
    scale: u32,
    duration: u64,
    tag: &'a [u8; 4],
    entry: &'a [u8],
    width: u32,
    height: u32,
    enabled: bool,
    language: String,
    handler: &'a [u8],
    count: usize,
    ticks: u64,
    bytes: u64,
    start: i64,
    b_frames: bool,
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
        input_size: usize,
    ) -> Result<Self, String> {
        let tk = child(trak, b"tkhd");
        let long = tk.first() == Some(&1);
        let i = if long { 20 } else { 12 };
        let id = u32_at(tk, i);
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
        if n > 200_000 {
            return Err(format!(
                "Resource limit exceeded for maxSamplesPerTrack: {n} exceeds maximum allowed 200000"
            ));
        }
        let stsd = child(stbl, b"stsd");
        let (tag, entry) = atoms(stsd.get(8..).unwrap_or_default())
            .next()
            .unwrap_or((if kind == "video" { b"avc1" } else { b"mp4a" }, &[]));
        let (mut count, mut ticks, mut bytes, mut start, mut b_frames) = (0, 0, 0, 0, false);
        for s in tables.samples(input_size) {
            if count == 0 {
                start = s.pts
            }
            count += 1;
            ticks += u64::from(s.tick);
            bytes += s.size;
            b_frames |= s.pts != s.dts as i64
        }
        let elst = child(child(trak, b"edts"), b"elst");
        let v1 = elst.first() == Some(&1);
        let mut edits = rows(elst, if v1 { 20 } else { 12 }).peekable();
        let duration = if edits.peek().is_some() {
            (edits.map(|r| wide(r, 0, v1) as f64).sum::<f64>() * f64::from(scale)
                / f64::from(movie_scale))
            .round() as u64
        } else if ticks != 0 {
            ticks
        } else if declared != 0 {
            declared
        } else {
            (header_duration as f64 * f64::from(scale) / f64::from(movie_scale)).round() as u64
        };
        let width = match fixed(dims) {
            0 if kind == "video" => u32::from(u16_at(entry, 24)),
            v => v,
        };
        let height = match fixed(dims + 4) {
            0 if kind == "video" => u32::from(u16_at(entry, 26)),
            v => v,
        };
        Ok(Self {
            index,
            id: if id == 0 { index as u32 + 1 } else { id },
            kind,
            scale,
            duration,
            tag,
            entry,
            width,
            height,
            enabled: tk.len() < 24 || tk[3] & 1 != 0,
            language,
            handler,
            count,
            ticks,
            bytes,
            start,
            b_frames,
            tables,
        })
    }
    fn time(&self, ticks: f64) -> String {
        format!("{:.6}", ticks / f64::from(self.scale))
    }
    fn channels(&self) -> u16 {
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
                    ("pix_fmt", Str("yuv420p".into())),
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
            r.push(("profile", Str("LC".into())))
        }
        if codec == "h264" && avc.len() >= 11 && avc[5] & 31 != 0 && u16_at(avc, 6) >= 3 {
            let profile = match avc[9] {
                66 if avc[10] & 64 != 0 => "Constrained Baseline".into(),
                66 => "Baseline".into(),
                77 => "Main".into(),
                88 => "Extended".into(),
                100 => "High".into(),
                110 => "High 10".into(),
                122 => "High 4:2:2".into(),
                244 => "High 4:4:4 Predictive".into(),
                v => format!("Profile {v}"),
            };
            r.push(("profile", Str(profile)));
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
            r.push(("coded_width", Number((w.div_ceil(16) * 16).into())))
        }
        if h != 0 {
            r.push(("coded_height", Number((h.div_ceil(16) * 16).into())))
        }
        if self.kind == "video" {
            let pasp = child(children, b"pasp");
            r.extend([
                ("has_b_frames", Number(f64::from(self.b_frames))),
                (
                    "sample_aspect_ratio",
                    Str(format!(
                        "{}:{}",
                        u32_at(pasp, 0).max(1),
                        u32_at(pasp, 4).max(1)
                    )),
                ),
            ]);
            if w != 0 && h != 0 {
                r.push((
                    "display_aspect_ratio",
                    Str(media_probe::ratio(w.into(), h.into(), ':')),
                ))
            }
            r.push(("pix_fmt", Str("yuv420p".into())));
            if let Some(level) = avc.get(3) {
                r.push(("level", Number((*level).into())))
            }
            r.extend([
                ("color_range", Str("tv".into())),
                ("color_space", Str("bt709".into())),
            ]);
        } else if self.kind == "audio" {
            let channels = self.channels();
            let (rate, bits) = if self.entry.len() >= 28 {
                (
                    ((u64::from(u32_at(self.entry, 24)) + 32768) >> 16) as u32,
                    u16_at(self.entry, 18),
                )
            } else {
                (self.scale, 16)
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
        let rate = if self.kind == "video" && self.ticks != 0 {
            media_probe::ratio(self.count as u64 * u64::from(self.scale), self.ticks, '/')
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
            ("start_pts", Number(self.start as f64)),
            ("start_time", Str(self.time(self.start as f64))),
            ("duration_ts", Number(self.duration as f64)),
            ("duration", Str(format!("{dur:.6}"))),
            (
                "bit_rate",
                Str(if dur == 0. {
                    "0".into()
                } else {
                    (self.bytes as f64 * 8. / dur).round().to_string()
                }),
            ),
            ("nb_frames", Str(self.count.to_string())),
            (
                "disposition",
                Object(media_probe::disposition(self.enabled)),
            ),
            ("tags", Object(tags)),
        ]);
        if counts.0 {
            r.push(("nb_read_frames", Str(self.count.to_string())))
        }
        if counts.1 {
            r.push(("nb_read_packets", Str(self.count.to_string())))
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
    let mut meta = child(child(moov, b"udta"), b"meta");
    if meta.is_empty() {
        meta = child(moov, b"meta")
    }
    if matches!(meta.get(8..12), Some(b"hdlr" | b"ilst" | b"keys" | b"free")) {
        meta = &meta[4..]
    }
    let ilst = child(meta, b"ilst");
    for (code, key) in [
        (b"\xa9nam", "title"),
        (b"\xa9ART", "artist"),
        (b"\xa9alb", "album"),
        (b"\xa9day", "date"),
        (b"\xa9cmt", "comment"),
        (b"\xa9gen", "genre"),
        (b"\xa9too", "encoder"),
    ] {
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
        if let Some(v) = value {
            tags.push((key.into(), Str(v)))
        }
    }
    tags
}

fn chapters(moov: &[u8], duration: f64) -> impl Iterator<Item = Row> + '_ {
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
        let title = String::from_utf8_lossy(&row[9..9 + len]);
        Some(vec![
            ("id", Number(f64::from(id))),
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
        ])
    })
}

pub(super) fn report(
    input: &[u8],
    filename: &str,
    opts: ProbeOptions<'_>,
) -> Result<String, String> {
    let moov = movie(input)?;
    let (scale, ticks) = header_time(child(moov, b"mvhd"), 1000);
    let mut tracks = Vec::new();
    let mut duration = ticks as f64 / f64::from(scale);
    for (_, trak) in atoms(moov).filter(|(k, _)| *k == b"trak") {
        if tracks.len() == 32 {
            return Err(
                "Resource limit exceeded for maxStreams: 33 exceeds maximum allowed 32".into(),
            );
        }
        let t = Track::parse(trak, tracks.len(), scale, input.len())?;
        duration = duration.max(t.duration as f64 / f64::from(t.scale));
        tracks.push(t);
    }
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
            t.tables
                .samples(input.len())
                .map(move |s| t.record(s, section == "frame"))
        })),
        _ => Box::new(std::iter::empty()),
    })
    .map_err(str::to_owned)
}
