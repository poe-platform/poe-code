use super::super::structured::{JVal, format_jval_with_indent};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

pub(super) struct Clip {
    track: Track,
    timescale: u32,
    payload_bytes: u64,
    ticks: u64,
    duration: f64,
    count: usize,
}

enum VideoPackets {
    Fixed(u64),
    Y4m { size: u64, offsets: Vec<usize> },
    Gif(Vec<(u64, usize)>), // cumulative duration and end offset of each packet
}

enum Track {
    Video {
        tag: &'static [u8; 4],
        width: u32,
        height: u32,
        packets: VideoPackets,
    },
    Aac {
        channels: u8,
        ends: Vec<usize>,
    },
}

impl Clip {
    pub(super) fn y4m(input: &[u8], records: bool, limit: usize) -> Result<Self, &'static str> {
        let stream = super::y4m::Stream::parse(input)?;
        let (width, height, fps, frame_size) =
            (stream.width, stream.height, stream.fps, stream.frame_size);
        let mut count = 0;
        let mut offsets = Vec::new();
        for frame in stream.frames() {
            if records {
                if count >= limit / size_of::<usize>() {
                    return Err("sample index exceeds memory budget");
                }
                offsets.push(frame.as_ptr().addr() - input.as_ptr().addr());
            }
            count += 1;
        }
        Ok(Self {
            track: Track::Video {
                tag: b"raw ",
                width,
                height,
                packets: VideoPackets::Y4m { size: frame_size, offsets },
            },
            timescale: stream.frame_rate.0,
            payload_bytes: count as u64 * frame_size,
            duration: count as f64 / fps,
            count,
            ticks: stream.frame_rate.1.into(),
        })
    }
    pub(super) fn still(input: &[u8], limit: usize) -> Result<Self, &'static str> {
        let (width, height, tag) = super::frame_output::still_info(input, limit)?;
        Ok(Self {
            track: Track::Video {
                tag,
                width: width as u32,
                height: height as u32,
                packets: VideoPackets::Fixed(input.len() as u64),
            },
            timescale: 25,
            ticks: 1,
            count: 1,
            duration: 0.04,
            payload_bytes: input.len() as u64,
        })
    }
    pub(super) fn gif(input: &[u8], records: bool, limit: usize) -> Result<Self, &'static str> {
        let (width, height) = super::gif::dimensions(input)?;
        if !super::gif::signature(input) {
            return Err("Input buffer contains unsupported image format");
        }
        if u64::from(width) * u64::from(height) > (limit / 4) as u64 {
            return Err("image exceeds memory budget");
        }
        let (mut ticks, mut count) = (0u64, 0usize);
        let mut ends = Vec::new();
        super::gif::packets(input, |delay, end| {
            ticks += u64::from(delay);
            if records {
                if count >= limit / size_of::<(u64, usize)>() {
                    return Err("sample index exceeds memory budget");
                }
                ends.push((ticks, end));
            }
            count += 1;
            Ok(())
        })?;
        if count == 0 {
            return Err("Cannot read properties of undefined (reading 'byteLength')");
        }
        if let Some(last) = ends.last_mut() {
            last.1 = input.len();
        }
        Ok(Self {
            track: Track::Video {
                tag: b"gif ",
                width,
                height,
                packets: VideoPackets::Gif(ends),
            },
            timescale: 100,
            payload_bytes: input.len() as u64,
            ticks,
            duration: ticks as f64 / 100.,
            count,
        })
    }
    pub(super) fn adts(input: &[u8], records: bool) -> Self {
        let mut frames = super::adts::Frames::new(input);
        let (mut payload, mut count) = (0, 0);
        let mut ends = Vec::new();
        for data in frames.by_ref() {
            payload += data.len();
            if records {
                ends.push(payload);
            }
            count += 1;
        }
        let timescale = frames.rate;
        Self {
            track: Track::Aac {
                channels: frames.channels,
                ends,
            },
            timescale,
            count,
            payload_bytes: payload as u64,
            duration: count as f64 * 1024. / f64::from(timescale),
            ticks: 1024,
        }
    }
}

pub(super) type Row = Vec<(&'static str, JVal)>;
use JVal::{Number, Object, Str};

pub(super) fn ratio(a: u64, b: u64, sep: char) -> String {
    let (mut x, mut y) = (a, b);
    while y != 0 {
        (x, y) = (y, x % y);
    }
    format!("{}{sep}{}", a / x, b / x)
}

pub(super) fn disposition(enabled: bool) -> Vec<(String, JVal)> {
    [
        "default",
        "dub",
        "original",
        "comment",
        "lyrics",
        "karaoke",
        "forced",
        "hearing_impaired",
        "visual_impaired",
        "clean_effects",
        "attached_pic",
        "timed_thumbnails",
    ]
    .into_iter()
    .map(|k| {
        (
            k.to_owned(),
            Number(f64::from(enabled && k == "default"), None),
        )
    })
    .collect()
}

#[derive(Clone, Copy)]
pub(super) enum Codec {
    Video {
        tag: &'static [u8; 4],
        width: Option<i64>,
        height: Option<u32>,
    },
    Audio {
        rate: u32,
        channels: u32,
        bits: u32,
        tag: &'static [u8; 4],
        profile: bool,
    },
    Subtitle {
        name: &'static str,
    },
}

pub(super) struct StreamInfo {
    pub codec: Codec,
    pub scale: u32,
    pub start: i64,
    pub ticks: f64,
    pub sample_ticks: f64,
    pub id: u64,
    pub language: std::borrow::Cow<'static, str>,
    pub profile: Option<String>,
    pub count: usize,
    pub payload_bytes: u64,
    pub has_cts: bool,
}

impl StreamInfo {
    pub(super) fn stream(&self, index: usize, (count_frames, count_packets): (bool, bool)) -> Row {
        let (start, ticks) = (self.start as f64, self.ticks);
        let duration = ticks / f64::from(self.scale);
        let rate = if self.count == 0
            || self.sample_ticks <= 0.
            || !matches!(self.codec, Codec::Video { .. })
        {
            "0/0".into()
        } else {
            let num = self.scale as f64 * self.count as f64;
            let (mut x, mut y) = (num, self.sample_ticks.round());
            while y != 0. {
                (x, y) = (y, x % y);
            }
            format!("{}/{}", num / x, self.sample_ticks / x)
        };
        let mut row = vec![
            ("index", Number(index as f64, None)),
            ("id", Str(format!("0x{:x}", self.id))),
        ];
        match self.codec {
            Codec::Subtitle { name } => {
                let (name, long, tag, code) = if name == "ass" {
                    ("ass", "ASS (Advanced SSA) subtitle", "[0][0][0][0]", "0x0000")
                } else if name == "mov_text" {
                    ("mov_text", "3GPP Timed Text subtitle", "tx3g", "0x74783367")
                } else if name == "webvtt" {
                    ("webvtt", "WebVTT subtitle", "wvtt", "0x77767474")
                } else {
                    ("subrip", "SubRip subtitle", "tx3g", "0x74783367")
                };
                row.extend([
                    ("codec_name", Str(name.into())),
                    ("codec_long_name", Str(long.into())),
                    ("codec_type", Str("subtitle".into())),
                    ("codec_tag_string", Str(tag.into())),
                    ("codec_tag", Str(code.into())),
                ]);
            }
            Codec::Video {
                tag, width, height, ..
            } => {
                let fourcc = std::str::from_utf8(tag).unwrap();
                let (name, long) = match tag {
                    b"hvc1" => ("hevc", "H.265 / HEVC (High Efficiency Video Coding)"),
                    b"vp08" => ("vp8", "On2 VP8"),
                    b"vp09" => ("vp9", "Google VP9"),
                    b"av01" => ("av1", "Alliance for Open Media AV1"),
                    b"avc1" => ("h264", "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"),
                    b"mjpe" | b"jpeg" => ("mjpeg", "Motion JPEG"),
                    b"webp" => ("webp", "WebP image"),
                    b"gif " => ("gif", "GIF (Graphics Interchange Format)"),
                    b"raw " => ("rawvideo", "raw video"),
                    b"png " => ("png", "PNG (Portable Network Graphics) image"),
                    _ => (fourcc.trim_end(), fourcc.trim_end()),
                };
                row.extend([
                    ("codec_name", Str(name.into())),
                    ("codec_long_name", Str(long.into())),
                ]);
                if let Some(profile) = &self.profile {
                    row.push(("profile", Str(profile.clone())));
                }
                row.extend([
                    ("codec_type", Str("video".into())),
                    ("codec_tag_string", Str(fourcc.into())),
                    (
                        "codec_tag",
                        Str(format!("0x{:08x}", u32::from_be_bytes(*tag))),
                    ),
                ]);
                if let Some(w) = width {
                    row.push(("width", Number(w as f64, None)));
                }
                if let Some(h) = height {
                    row.push(("height", Number(h.into(), None)));
                }
                if let Some(width) = width.filter(|&w| w != 0) {
                    row.push((
                        "coded_width",
                        Number(((width + 15).div_euclid(16) * 16) as f64, None),
                    ));
                }
                if let Some(height) = height.filter(|&h| h != 0) {
                    row.push((
                        "coded_height",
                        Number(f64::from(height.div_ceil(16)) * 16., None),
                    ));
                }
                row.extend([
                    ("has_b_frames", Number(f64::from(self.has_cts), None)),
                    ("sample_aspect_ratio", Str("1:1".into())),
                ]);
                if let (Some(width), Some(height)) =
                    (width.filter(|&w| w != 0), height.filter(|&h| h != 0))
                {
                    row.push((
                        "display_aspect_ratio",
                        Str(format!(
                            "{}{}",
                            if width < 0 { "-" } else { "" },
                            ratio(width.unsigned_abs(), height.into(), ':')
                        )),
                    ));
                }
                row.extend([
                    (
                        "pix_fmt",
                        Str(match tag {
                            b"gif " => "rgb8",
                            b"raw " | b"jpeg" | b"avc1" | b"hvc1" | b"vp08" | b"vp09" | b"av01" => {
                                "yuv420p"
                            }
                            _ => "rgb24",
                        }
                        .into()),
                    ),
                    ("color_range", Str("tv".into())),
                    ("color_space", Str("bt709".into())),
                ])
            }
            Codec::Audio {
                channels,
                rate,
                profile,
                tag,
                bits,
            } => {
                let (name, long) = match tag {
                    b"samr" => ("amr_nb", "AMR-NB (Adaptive Multi-Rate NarrowBand)"),
                    b"sawb" => ("amr_wb", "AMR-WB (Adaptive Multi-Rate WideBand)"),
                    b"ac-3" => ("ac3", "ATSC A/52A (AC-3)"),
                    b"wvpk" => ("wavpack", "WavPack"),
                    b"Opus" => ("opus", "Opus (Opus Interactive Audio Codec)"),
                    b"vorb" => ("vorbis", "Vorbis"),
                    b".mp3" => ("mp3", "MP3 (MPEG audio layer 3)"),
                    b"fLaC" => ("flac", "FLAC (Free Lossless Audio Codec)"),
                    b"sowt" => ("pcm_s16le", "PCM signed 16-bit little-endian"),
                    b"avc1" => ("h264", "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"),
                    _ => ("aac", "AAC (Advanced Audio Coding)"),
                };
                row.extend([
                    ("codec_name", Str(name.into())),
                    ("codec_long_name", Str(long.into())),
                ]);
                if profile {
                    row.push(("profile", Str("LC".into())));
                }
                row.extend([
                    ("codec_type", Str("audio".into())),
                    (
                        "codec_tag_string",
                        Str(std::str::from_utf8(tag).unwrap().into()),
                    ),
                    (
                        "codec_tag",
                        Str(format!("0x{:08x}", u32::from_be_bytes(*tag))),
                    ),
                    (
                        "sample_fmt",
                        Str(if tag == b"sowt" { "s16" } else { "fltp" }.into()),
                    ),
                    ("sample_rate", Str(rate.to_string())),
                    ("channels", Number(channels.into(), None)),
                    (
                        "channel_layout",
                        Str(if channels == 1 { "mono" } else { "stereo" }.into()),
                    ),
                    ("bits_per_sample", Number(bits.into(), None)),
                ]);
            }
        }
        row.extend([
            ("r_frame_rate", Str(rate.clone())),
            ("avg_frame_rate", Str(rate)),
            ("time_base", Str(format!("1/{}", self.scale))),
            ("start_pts", Number(start, None)),
            (
                "start_time",
                Str(format!("{:.6}", start / f64::from(self.scale))),
            ),
            ("duration_ts", Number(ticks, None)),
            ("duration", Str(format!("{duration:.6}"))),
            (
                "bit_rate",
                Str(if duration == 0. {
                    "0".into()
                } else {
                    ((self.payload_bytes as f64 * 8.) / duration)
                        .round()
                        .to_string()
                }),
            ),
            ("nb_frames", Str(self.count.to_string())),
            ("disposition", Object(disposition(true))),
            (
                "tags",
                Object(vec![("language".into(), Str(self.language.to_string()))]),
            ),
        ]);
        if count_frames {
            row.push(("nb_read_frames", Str(self.count.to_string())));
        }
        if count_packets {
            row.push(("nb_read_packets", Str(self.count.to_string())));
        }
        row
    }
}

impl Clip {
    fn info(&self) -> StreamInfo {
        let codec = match self.track {
            Track::Video {
                tag, width, height, ..
            } => Codec::Video {
                tag,
                width: Some(width.into()),
                height: Some(height),
            },
            Track::Aac { channels, .. } => Codec::Audio {
                rate: self.timescale,
                channels: channels.into(),
                tag: b"mp4a",
                bits: 16,
                profile: true,
            },
        };
        let (start, ticks) = match self.track {
            Track::Video {
                packets: VideoPackets::Gif(_),
                ..
            } => (0, self.ticks),
            _ => (0, self.count as u64 * self.ticks),
        };
        StreamInfo {
            codec,
            scale: self.timescale,
            start,
            ticks: ticks as f64,
            sample_ticks: ticks as f64,
            id: 1,
            language: "und".into(),
            profile: None,
            count: self.count,
            payload_bytes: self.payload_bytes,
            has_cts: false,
        }
    }

    fn format(&self, filename: &str, bytes: usize) -> Row {
        let duration = self.duration;
        let (name, long_name) = match self.track {
            Track::Aac { .. } => ("aac", "raw ADTS AAC (Advanced Audio Coding)"),
            Track::Video { tag: b"raw ", .. } => ("yuv4mpegpipe", "YUV4MPEG pipe"),
            Track::Video { tag: b"gif ", .. } => {
                ("gif", "CompuServe Graphics Interchange Format (GIF)")
            }
            Track::Video { .. } => ("image2", "image2 sequence"),
        };
        format_row(filename, bytes, (name, long_name), 1, duration, vec![])
    }

    fn record(&self, i: usize, frame: bool) -> Row {
        let default_pts = (i as u64 * self.ticks) as i64;
        let (pts, ticks, size, pos) = match &self.track {
            Track::Aac { ends, .. } => {
                let pos = if i == 0 { 0 } else { ends[i - 1] };
                (default_pts, self.ticks, (ends[i] - pos) as u64, pos as u64)
            }
            Track::Video {
                packets: VideoPackets::Gif(ends),
                ..
            } => {
                let (pts, pos) = if i == 0 { (0, 0) } else { ends[i - 1] };
                let (end, offset) = ends[i];
                (pts as i64, end - pts, (offset - pos) as u64, pos as u64)
            }
            Track::Video {
                packets: VideoPackets::Y4m { size, offsets },
                ..
            } => (default_pts, self.ticks, *size, offsets[i] as u64),
            Track::Video {
                packets: VideoPackets::Fixed(frame_size),
                ..
            } => (default_pts, self.ticks, *frame_size, i as u64 * frame_size),
        };
        let key = i == 0
            || !matches!(
                self.track,
                Track::Video {
                    packets: VideoPackets::Gif(_),
                    ..
                }
            );
        let mut row = self.info().codec.record(
            0,
            self.timescale,
            Packet {
                pts,
                dts: pts,
                ticks: ticks as f64,
                size,
                pos,
                key,
            },
            frame,
        );
        if matches!(self.track, Track::Video { packets: VideoPackets::Y4m { .. }, .. }) {
            for (key, value) in &mut row {
                match *key {
                    "pts" | "dts" | "pkt_dts" | "best_effort_timestamp" => *value = Number(i as f64, None),
                    "duration" | "pkt_duration" => *value = Number(1., None),
                    _ => {}
                }
            }
            if frame { row.push(("pkt_pos", Str(pos.to_string()))); }
        }
        row
    }
}

#[derive(Clone, Copy)]
pub(super) struct Packet {
    pub pts: i64,
    pub dts: i64,
    pub ticks: f64,
    pub size: u64,
    pub pos: u64,
    pub key: bool,
}
impl Codec {
    pub(super) fn record(self, index: usize, scale: u32, p: Packet, frame: bool) -> Row {
        let Packet {
            pts,
            dts,
            ticks,
            size,
            pos,
            key,
        } = p;
        let (pts, dts, ticks) = (pts as f64, dts as f64, ticks);
        let kind = match self {
            Self::Audio { .. } => "audio",
            Self::Video { .. } => "video",
            Self::Subtitle { .. } => "subtitle",
        };
        let time = |t| Str(format!("{:.6}", t / f64::from(scale)));
        let duration = Str(format!("{:.6}", ticks / f64::from(scale)));
        if frame {
            let mut row = vec![
                ("media_type", Str(kind.into())),
                ("stream_index", Number(index as f64, None)),
                ("key_frame", Number(f64::from(key), None)),
                ("pts", Number(pts, None)),
                ("pts_time", time(pts)),
                ("pkt_dts", Number(dts, None)),
                ("pkt_dts_time", time(dts)),
                ("best_effort_timestamp", Number(pts, None)),
                ("best_effort_timestamp_time", time(pts)),
                ("pkt_duration", Number(ticks, None)),
                ("pkt_duration_time", duration),
                ("pkt_size", Str(size.to_string())),
            ];
            match self {
                Codec::Subtitle { .. } => {}
                Codec::Audio { channels, tag, .. } => row.extend([
                    (
                        "sample_fmt",
                        Str(if tag == b"sowt" { "s16" } else { "fltp" }.into()),
                    ),
                    ("nb_samples", Number(ticks, None)),
                    ("channels", Number(channels.into(), None)),
                ]),
                Codec::Video {
                    tag, width, height, ..
                } => {
                    if let Some(w) = width {
                        row.push(("width", Number(w as f64, None)));
                    }
                    if let Some(h) = height {
                        row.push(("height", Number(h.into(), None)));
                    }
                    row.extend([
                        (
                            "pix_fmt",
                            Str(match tag {
                                b"gif " => "rgb8",
                                b"raw " | b"jpeg" | b"avc1" | b"hvc1" | b"vp08" | b"vp09"
                                | b"av01" => "yuv420p",
                                _ => "rgb24",
                            }
                            .into()),
                        ),
                        ("pict_type", Str(if key { "I" } else { "P" }.into())),
                    ]);
                }
            }
            row
        } else {
            vec![
                ("codec_type", Str(kind.into())),
                ("stream_index", Number(index as f64, None)),
                ("pts", Number(pts, None)),
                ("pts_time", time(pts)),
                ("dts", Number(dts, None)),
                ("dts_time", time(dts)),
                ("duration", Number(ticks, None)),
                ("duration_time", duration),
                ("size", Str(size.to_string())),
                ("pos", Str(pos.to_string())),
                ("flags", Str(if key { "K__" } else { "___" }.into())),
            ]
        }
    }
}

pub(super) fn format_row(
    filename: &str,
    bytes: usize,
    (name, long_name): (&str, &str),
    tracks: usize,
    duration: f64,
    tags: Vec<(String, JVal)>,
) -> Row {
    vec![
        ("filename", Str(filename.into())),
        ("nb_streams", Number(tracks as f64, None)),
        ("nb_programs", Number(0., None)),
        ("format_name", Str(name.into())),
        ("format_long_name", Str(long_name.into())),
        ("start_time", Str("0.000000".into())),
        ("duration", Str(format!("{duration:.6}"))),
        ("size", Str(bytes.to_string())),
        (
            "bit_rate",
            Str(if duration <= 0. {
                "0".into()
            } else {
                (bytes as f64 * 8. / duration).round().to_string()
            }),
        ),
        ("probe_score", Number(100., None)),
        ("tags", Object(tags)),
    ]
}

// Canonical section name, shared name, and parent from the native section tree.
const SECTIONS: &[(&str, &str, &str)] = &[
    ("root", "", ""),
    ("chapters", "", "root"),
    ("chapter", "", "chapters"),
    ("chapter_tags", "tags", "chapter"),
    ("format", "", "root"),
    ("format_tags", "tags", "format"),
    ("frames", "", "root"),
    ("frame", "", "frames"),
    ("frame_tags", "tags", "frame"),
    ("frame_side_data_list", "side_data_list", "frame"),
    ("frame_side_data", "side_data", "frame_side_data_list"),
    ("timecodes", "", "frame_side_data"),
    ("timecode", "", "timecodes"),
    ("frame_side_data_components", "components", "frame_side_data"),
    ("frame_side_data_component", "component", "frame_side_data_components"),
    ("frame_side_data_pieces", "pieces", "frame_side_data_component"),
    ("frame_side_data_piece", "piece", "frame_side_data_pieces"),
    ("logs", "", "frame"),
    ("log", "", "logs"),
    ("subtitle", "", "frames"),
    ("programs", "", "root"),
    ("program", "", "programs"),
    ("program_tags", "tags", "program"),
    ("program_streams", "streams", "program"),
    ("program_stream", "stream", "program_streams"),
    ("program_stream_disposition", "disposition", "program_stream"),
    ("program_stream_tags", "tags", "program_stream"),
    ("stream_groups", "", "root"),
    ("stream_group", "", "stream_groups"),
    ("stream_group_tags", "tags", "stream_group"),
    ("stream_group_disposition", "disposition", "stream_group"),
    ("stream_group_components", "components", "stream_group"),
    ("stream_group_component", "component", "stream_group_components"),
    ("subcomponents", "", "stream_group_component"),
    ("subcomponent", "", "subcomponents"),
    ("stream_group_pieces", "pieces", "subcomponent"),
    ("stream_group_piece", "piece", "stream_group_pieces"),
    ("subpieces", "", "stream_group_piece"),
    ("subpiece", "", "subpieces"),
    ("blocks", "", "subpiece"),
    ("block", "", "blocks"),
    ("stream_group_streams", "streams", "stream_group"),
    ("stream_group_stream", "stream", "stream_group_streams"),
    ("stream_group_stream_disposition", "disposition", "stream_group_stream"),
    ("stream_group_stream_tags", "tags", "stream_group_stream"),
    ("streams", "", "root"),
    ("stream", "", "streams"),
    ("stream_disposition", "disposition", "stream"),
    ("stream_tags", "tags", "stream"),
    ("stream_side_data_list", "side_data_list", "stream"),
    ("stream_side_data", "side_data", "stream_side_data_list"),
    ("packets", "", "root"),
    ("packets_and_frames", "", ""),
    ("packet", "", "packets"),
    ("packet_tags", "tags", "packet"),
    ("packet_side_data_list", "side_data_list", "packet"),
    ("packet_side_data", "side_data", "packet_side_data_list"),
    ("error", "", "root"),
    ("program_version", "", "root"),
    ("library_versions", "", "root"),
    ("library_version", "", "library_versions"),
    ("pixel_formats", "", "root"),
    ("pixel_format", "", "pixel_formats"),
    ("pixel_format_flags", "flags", "pixel_format"),
    ("pixel_format_components", "components", "pixel_format"),
    ("component", "", "pixel_format_components"),
];

#[derive(Default)]
pub(super) struct ProbeFields {
    pub all: bool,
    // Distinguish -show_entries sections from inherited or -show_* selections.
    pub explicit: bool,
    pub keys: BTreeSet<String>,
}

impl ProbeFields {
    pub fn includes(&self, key: &str) -> bool {
        self.all || self.keys.contains(key)
    }

    pub fn active(&self) -> bool {
        self.all || !self.keys.is_empty()
    }
}

pub(super) fn select_entries(
    entries: &mut BTreeMap<&'static str, ProbeFields>,
    section: &'static str,
    fields: Option<&BTreeSet<String>>,
) {
    let selected = entries.entry(section).or_default();
    selected.all = fields.is_none();
    if let Some(fields) = fields {
        selected.keys.extend(fields.iter().cloned());
    } else {
        for &(child, _, parent) in SECTIONS {
            if parent == section { select_entries(entries, child, None); }
        }
    }
}

fn entry_token(input: &mut &str, delimiters: &[char]) -> String {
    let whitespace = [' ', '\n', '\t', '\r'];
    *input = input.trim_start_matches(whitespace);
    let mut out = String::new();
    let mut protected = 0;
    while let Some(ch) = input.chars().next() {
        if delimiters.contains(&ch) { break; }
        *input = &input[ch.len_utf8()..];
        if ch == '\\' && let Some(next) = input.chars().next() {
            out.push(next);
            *input = &input[next.len_utf8()..];
            protected = out.len();
        } else if ch == '\'' {
            if let Some(end) = input.find('\'') {
                out.push_str(&input[..end]);
                *input = &input[end + 1..];
                protected = out.len();
            } else {
                out.push_str(input);
                *input = "";
            }
        } else { out.push(ch); }
    }
    out.truncate(protected.max(out.trim_end_matches(whitespace).len()));
    out
}

pub(super) fn parse_entries(entries: &mut BTreeMap<&'static str, ProbeFields>, mut input: &str) -> Result<(), String> {
    while !input.is_empty() {
        let section = entry_token(&mut input, &['=', ':']);
        let fields = if let Some(rest) = input.strip_prefix('=') {
            input = rest;
            let mut fields = BTreeSet::new();
            while !input.is_empty() && !input.starts_with(':') {
                fields.insert(entry_token(&mut input, &[',', ':']));
                if let Some(rest) = input.strip_prefix(',') { input = rest; }
            }
            Some(fields)
        } else { None };
        let mut matched = false;
        for &(name, alias, _) in SECTIONS {
            if section == name || !alias.is_empty() && section == alias {
                select_entries(entries, name, fields.as_ref());
                entries.get_mut(name).unwrap().explicit = true;
                matched = true;
            }
        }
        if !matched { return Err(section); }
        if let Some(rest) = input.strip_prefix(':') { input = rest; }
    }
    Ok(())
}

pub(super) fn section_output(mut name: &str) -> Option<&'static str> {
    loop {
        let &(section, _, parent) = SECTIONS.iter().find(|(section, _, _)| *section == name)?;
        if section == "root" { return None; }
        if parent == "root" || section == "packets_and_frames" {
            return Some(if section == "packets_and_frames" { "packet" } else { section.strip_suffix('s').unwrap_or(section) });
        }
        name = parent;
    }
}

pub(super) struct ProbeOptions<'a> {
    pub show: BTreeSet<&'a str>,
    pub entries: Option<BTreeMap<&'static str, ProbeFields>>,
    pub select: Option<&'a str>,
    pub counts: (bool, bool),
    pub writer: &'a str,
    pub settings: &'a BTreeMap<&'a str, &'a str>,
    pub limit: usize,
}

impl Clip {
    pub(super) fn report(
        &self,
        filename: &str,
        bytes: usize,
        opts: ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        let counts = opts.counts;
        let select = opts.select;
        report(opts, |section| match section {
            "packet" | "frame" => {
                Box::new((0..self.count).map(move |i| self.record(i, section == "frame")))
            }
            "stream"
                if selected(
                    select,
                    match self.track {
                        Track::Aac { .. } => "audio",
                        Track::Video { .. } => "video",
                    },
                    0,
                    0,
                ) =>
            {
                Box::new(std::iter::once(self.info().stream(0, counts)))
            }
            "format" => Box::new(std::iter::once(self.format(filename, bytes))),
            _ => Box::new(std::iter::empty()),
        })
    }
}

pub(super) fn selected(select: Option<&str>, kind: &str, index: usize, ordinal: usize) -> bool {
    let spec = select.unwrap_or("");
    match spec {
        "v" => kind == "video",
        "a" => kind == "audio",
        "s" => kind == "subtitle",
        "d" => kind == "data",
        s if s.starts_with("a:") || s.starts_with("v:") || s.starts_with("s:") || s.starts_with("d:") => {
            let digits = s[2..].trim_start();
            let unsigned = digits.trim_start_matches(['+', '-']);
            let n = unsigned.bytes().take_while(u8::is_ascii_digit).count();
            let value =
                unsigned[..n]
                    .parse::<usize>()
                    .unwrap_or(if n == 0 { 0 } else { usize::MAX });
            (if s.starts_with('a') {
                kind == "audio"
            } else if s.starts_with('v') {
                kind == "video"
            } else if s.starts_with('d') {
                kind == "data"
            } else {
                kind == "subtitle"
            }) && ordinal == value
                && (!digits.starts_with('-') || value == 0)
        }
        s if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => s.parse() == Ok(index),
        _ => true,
    }
}

pub(super) fn report<'a>(
    opts: ProbeOptions<'_>,
    rows: impl Fn(&'static str) -> Box<dyn Iterator<Item = Row> + 'a>,
) -> Result<String, &'static str> {
    let empty = BTreeMap::new();
    let filters = opts.entries.as_ref().unwrap_or(&empty);
    let setting = |key| opts.settings.get(key).copied();
    let json = opts.writer == "json";
    let compact = setting("compact") == Some("1") || setting("c") == Some("1");
    let mut out = match opts.writer { "json" => "{".to_owned(), "ini" => "# ffprobe output\n".to_owned(), "xml" => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ffprobe>\n".to_owned(), _ => String::new() };
    let mut first = true;
    let no_fields = BTreeSet::new();
    for (section, key) in [
        ("packet_frame", "packets_and_frames"),
        ("packet", "packets"),
        ("frame", "frames"),
        ("program", "programs"),
        ("stream_group", "stream_groups"),
        ("stream", "streams"),
        ("chapter", "chapters"),
        ("format", "format"),
    ] {
        let fields = filters.get(section);
        let requested = opts.show.contains(section);
        let active = filters.iter().any(|(name, fields)| {
            (*name == section || name.strip_prefix(section).is_some_and(|s| s.starts_with('_')))
                && !(section == "stream" && name.starts_with("stream_group"))
                && fields.active()
        });
        if !requested
            && (matches!(section, "frame" | "packet" | "packet_frame")
                || !active)
        {
            continue;
        }
        let array = section != "format";
        if json {
            if !first {
                out.push(',');
            }
            first = false;
            if !compact {
                out.push_str("\n  ");
            }
            write!(out, "\"{key}\":").unwrap();
            if !compact {
                out.push(' ');
            }
            if array {
                out.push('[');
            }
        }
        if opts.writer == "xml" && array { writeln!(out, "    <{key}>").unwrap(); }
        let mut count = 0;
        let mut record_indices = [0, 0];
        for (i, mut row) in rows(section).enumerate() {
            let row_section = if section == "packet_frame" {
                match row.first().map(|(_, value)| value) { Some(Str(s)) if s == "packet" => "packet", Some(Str(s)) if s == "frame" => "frame", _ => "subtitle" }
            } else if section == "frame" && row.iter().any(|(key, value)| *key == "media_type" && matches!(value, Str(s) if s == "subtitle")) { "subtitle" } else { section };
            let fields = if section == "packet_frame" || row_section == "subtitle" { filters.get(row_section) } else { fields };
            let side_fields = filters.get(format!("{row_section}_side_data").as_str());
            let side_fields = side_fields.map_or_else(
                || opts.entries.as_ref().map(|_| &no_fields),
                |fields| (!fields.all).then_some(&fields.keys),
            );
            count += 1;
            if opts.entries.is_some() {
                row.retain_mut(|(key, value)| {
                    if section == "packet_frame" && *key == "type" { return true; }
                    if *key == "side_data_list" { return true; }
                    if matches!(*key, "tags" | "disposition") && let Object(values) = value {
                        let had_values = !values.is_empty();
                        let selected = filters.get(format!("{row_section}_{key}").as_str());
                        values.retain(|(k, _)| selected.is_some_and(|fields| fields.includes(k)));
                        return !values.is_empty() || selected.is_some_and(|fields| had_values && fields.active() || fields.all && !fields.explicit);
                    }
                    fields.is_some_and(|fields| fields.includes(key))
                });
            }
            if json {
                if let Some(fields) = side_fields {
                    for (key, value) in &mut row {
                        if *key == "side_data_list" && let JVal::Array(values) = value {
                            for value in values {
                                if let Object(values) = value { values.retain(|(k,_)| fields.contains(k.as_str())); }
                            }
                        }
                    }
                }
                if array {
                    if i != 0 {
                        out.push(',');
                    }
                    if !compact {
                        out.push_str("\n    ");
                    }
                }
                let value = Object(row.into_iter().map(|(k, v)| (k.to_owned(), v)).collect());
                if compact {
                    out.push_str(&value.to_json_string(true, false, 0));
                } else {
                    out.push_str(&format_jval_with_indent(
                        &value,
                        Some(2),
                        if array { 2 } else { 1 },
                    ));
                }
            } else {
                let index = if section == "packet_frame" {
                    row.remove(0);
                    let index = &mut record_indices[usize::from(row_section != "packet")];
                    let current = *index;
                    *index += 1;
                    current
                } else { i };
                if opts.writer == "xml" { xml_row(&mut out, row_section, &row, if array { 8 } else { 4 }, side_fields); }
                else { text_row(&mut out, key, row_section, index, row, opts.writer, opts.settings, side_fields); }
            }
            if out.len() > opts.limit {
                return Err("output byte limit exceeded");
            }
        }
        if opts.writer == "ini" && array && count == 0 { out.push('\n'); }
        if opts.writer == "xml" && array { writeln!(out, "    </{key}>\n").unwrap(); }
        if json && array {
            if !compact && count != 0 {
                out.push_str("\n  ");
            }
            out.push(']');
        }
    }
    if json {
        if !first && !compact {
            out.push('\n');
        }
        out.push_str("}\n");
    }
    if opts.writer == "xml" { if out.ends_with("\n\n") { out.pop(); } out.push_str("</ffprobe>\n"); }
    if opts.writer == "ini" && out == "# ffprobe output\n" { out.push('\n'); }
    if out.len() > opts.limit {
        return Err("output byte limit exceeded");
    }
    Ok(out)
}

fn xml_row(out: &mut String, section: &str, row: &Row, indent: usize, side_fields: Option<&BTreeSet<String>>) {
    let escape = |value: &JVal| match value { Str(s) => s.clone(), _ => value.to_json_string(true, false, 0) }.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\"', "&quot;").replace('\n', "&#10;").replace('\r', "&#13;");
    write!(out, "{:indent$}<{section}", "").unwrap();
    for (key, value) in row { if !matches!(value, Object(_) | JVal::Array(_)) { write!(out, " {key}=\"{}\"", escape(value)).unwrap(); } }
    if row.iter().all(|(_, v)| matches!(v, Object(_) | JVal::Array(_))) { out.push(' '); }
    if row.iter().all(|(_, v)| !matches!(v, Object(_) | JVal::Array(_))) { out.push_str("/>\n"); return; }
    out.push_str(">\n");
    for (key, value) in row {
        if let Object(values) = value {
            if *key == "tags" {
                writeln!(out, "{:width$}<tags>", "", width=indent+4).unwrap();
                for (name, value) in values { writeln!(out, "{:width$}<tag key=\"{}\" value=\"{}\"/>", "", escape(&Str(name.clone())), escape(value), width=indent+8).unwrap(); }
                writeln!(out, "{:width$}</tags>", "", width=indent+4).unwrap();
            } else {
                write!(out, "{:width$}<{key}", "", width=indent+4).unwrap();
                for (name, value) in values { write!(out, " {name}=\"{}\"", escape(value)).unwrap(); }
                out.push_str("/>\n");
            }
        } else if *key == "side_data_list" && let JVal::Array(values) = value {
            writeln!(out, "{:width$}<side_data_list>", "", width=indent+4).unwrap();
            for value in values {
                if let Object(values) = value {
                    let kind = values.iter().find(|(k,_)| k == "side_data_type").map(|(_,v)| escape(v)).unwrap_or_default();
                    writeln!(out, "{:width$}<side_data type=\"{kind}\">", "", width=indent+8).unwrap();
                    for (key, value) in values.iter().filter(|(k,_)| side_fields.is_none_or(|fields| fields.contains(k.as_str()))) {
                        writeln!(out, "{:width$}<side_datum key=\"{key}\" value=\"{}\"/>", "", escape(value), width=indent+12).unwrap();
                    }
                    writeln!(out, "{:width$}</side_data>", "", width=indent+8).unwrap();
                }
            }
            writeln!(out, "{:width$}</side_data_list>", "", width=indent+4).unwrap();
        }
    }
    writeln!(out, "{:indent$}</{section}>", "").unwrap();
}

fn text_row(
    out: &mut String,
    group: &str,
    section: &str,
    index: usize,
    row: Row,
    writer: &str,
    settings: &BTreeMap<&str, &str>,
    side_fields: Option<&BTreeSet<String>>,
) {
    let get = |k| settings.get(k).copied();
    let nokey = get("nokey") == Some("1") || get("nk") == Some("1");
    let wrappers =
        writer == "default" && get("nw") != Some("1") && get("noprint_wrappers") != Some("1");
    let delimited = matches!(writer, "compact" | "csv");
    let sep = get("s").unwrap_or(match writer {
        "compact" => "|",
        "csv" => ",",
        _ => ".",
    });
    if wrappers {
        writeln!(out, "[{}]", section.to_uppercase()).unwrap();
    }
    if writer == "ini" { if section == "format" { out.push_str("\n[format]\n"); } else { writeln!(out, "\n[{group}.{section}.{index}]").unwrap(); } }
    let mut first = true;
    if delimited && get("p") != Some("0") && get("print_section") != Some("0") {
        out.push_str(section);
        first = false;
    }
    let mut emit = |out: &mut String, k: &str, v: JVal, nested: Option<&str>| {
        let numeric = matches!(v, Number(_, _));
        let s = match v {
            Str(s) => s,
            Number(_, _) => v.to_json_string(true, false, 0),
            _ => return,
        };
        if delimited {
            if !first {
                out.push_str(sep);
            }
            first = false;
            if writer == "compact" && !nokey && !k.is_empty() {
                if let Some(nested) = nested { write!(out, "{}:", if nested == "tags" { "tag" } else { nested }).unwrap(); }
                write!(out, "{k}=").unwrap();
            }
            if writer == "csv" {
                if s.contains(sep) || s.contains(['\n', '\r', '"']) {
                    write!(out, "\"{}\"", s.replace('"', "\"\"")).unwrap();
                } else {
                    out.push_str(&s);
                }
            } else {
                for c in s.chars() {
                    match c {
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        _ => {
                            if c == '\\' || sep.starts_with(c) && c.len_utf8() == sep.len() {
                                out.push('\\');
                            }
                            out.push(c);
                        }
                    }
                }
            }
        } else if writer == "flat" {
            if section == "format" {
                write!(out, "format{sep}").unwrap();
            } else {
                write!(out, "{group}{sep}{section}{sep}{index}{sep}").unwrap();
            }
            if let Some(nested) = nested { write!(out, "{nested}{sep}").unwrap(); }
            write!(out, "{k}=").unwrap();
            if numeric {
                out.push_str(&s);
            } else {
                out.push('"');
                for c in s.chars() {
                    match c {
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        '\\' | '"' => {
                            out.push('\\');
                            out.push(c)
                        }
                        _ => out.push(c),
                    }
                }
                out.push('"');
            }
            out.push('\n');
        } else {
            if !nokey {
                if writer != "ini" && let Some(nested) = nested { write!(out, "{}:", if nested == "tags" { "TAG".into() } else { nested.to_uppercase() }).unwrap(); }
                write!(out, "{k}=").unwrap();
            }
            if writer == "ini" {
                for c in s.chars() { match c { '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"), '\\' | '=' | ':' | '#' => { out.push('\\'); out.push(c); }, _ => out.push(c) } }
            } else { out.push_str(&s); }
            out.push('\n');
        }
    };
    let only_objects = row.iter().all(|(_, v)| matches!(v, Object(_) | JVal::Array(_)));
    let empty = row.is_empty();
    for (k, v) in row {
        if let Object(values) = v {
            if writer == "ini" { if section == "format" { writeln!(out, "{}[format.{k}]", if only_objects { "" } else { "\n" }).unwrap(); } else { writeln!(out, "{}[{group}.{section}.{index}.{k}]", if only_objects { "" } else { "\n" }).unwrap(); } }
            if delimited && values.is_empty() { emit(out, "", Str(String::new()), None); }
            for (key, value) in values { emit(out, &key, value, Some(k)); }
        } else if k == "side_data_list" && let JVal::Array(values) = v {
            for (i, value) in values.into_iter().enumerate() {
                if let Object(fields) = value {
                    let kind = fields.iter().find_map(|(k,v)| match (k.as_str(),v) { ("side_data_type",Str(s))=>Some(s.to_ascii_lowercase().replace(' ',"_")), _=>None }).unwrap_or_default();
                    if wrappers { out.push_str("[SIDE_DATA]\n"); }
                    if writer == "ini" { writeln!(out,"{}[{group}.{section}.{index}.side_data_list.side_data.{i}]", if only_objects && i == 0 { "" } else { "\n" }).unwrap(); }
                    let prefix = if writer == "compact" { format!("side_datum/{kind}") } else { format!("side_data_list{sep}side_data{sep}{i}") };
                    let mut count = 0;
                    for (key, value) in fields.into_iter().filter(|(k,_)| side_fields.is_none_or(|fields| fields.contains(k.as_str()))) {
                        emit(out, &key, value, matches!(writer,"compact"|"flat").then_some(prefix.as_str()));
                        count += 1;
                    }
                    if delimited && count == 0 && i == 0 { emit(out,"",Str(String::new()),None); }
                    if wrappers { out.push_str("[/SIDE_DATA]\n"); }
                }
            }
        } else { emit(out, k, v, None); }
    }
    if delimited {
        if empty && !first { out.push_str(sep); }
        out.push('\n');
    }
    if wrappers {
        writeln!(out, "[/{}]", section.to_uppercase()).unwrap();
    }
}
