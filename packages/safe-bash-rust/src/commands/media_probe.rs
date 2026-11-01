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

enum Track {
    Y4m {
        width: u32,
        height: u32,
        frame_size: u64,
    },
    Aac {
        channels: u8,
        ends: Vec<usize>,
    },
}

impl Clip {
    pub(super) fn y4m(input: &[u8]) -> Result<Self, &'static str> {
        let stream = super::y4m::Stream::parse(input)?;
        let (width, height, fps, frame_size) =
            (stream.width, stream.height, stream.fps, stream.frame_size);
        let count = stream.frames().count();
        Ok(Self {
            track: Track::Y4m {
                width,
                height,
                frame_size,
            },
            timescale: 90000,
            payload_bytes: count as u64 * frame_size,
            duration: count as f64 / fps,
            count,
            ticks: (90000. / fps).round().max(1.) as u64,
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
    .map(|k| (k.to_owned(), Number(f64::from(enabled && k == "default"))))
    .collect()
}

impl Clip {
    fn stream(&self, count_frames: bool, count_packets: bool) -> Row {
        let ticks = self.count as f64 * self.ticks as f64;
        let duration = ticks / f64::from(self.timescale);
        let rate = if self.count == 0 || matches!(self.track, Track::Aac { .. }) {
            "0/0".into()
        } else {
            ratio(self.timescale.into(), self.ticks, '/')
        };
        let mut row = vec![("index", Number(0.)), ("id", Str("0x1".into()))];
        match self.track {
            Track::Y4m { width, height, .. } => row.extend([
                ("codec_name", Str("rawvideo".into())),
                ("codec_long_name", Str("raw video".into())),
                ("codec_type", Str("video".into())),
                ("codec_tag_string", Str("raw ".into())),
                ("codec_tag", Str("0x72617720".into())),
                ("width", Number(width.into())),
                ("height", Number(height.into())),
                ("coded_width", Number(f64::from(width.div_ceil(16)) * 16.)),
                ("coded_height", Number(f64::from(height.div_ceil(16)) * 16.)),
                ("has_b_frames", Number(0.)),
                ("sample_aspect_ratio", Str("1:1".into())),
                (
                    "display_aspect_ratio",
                    Str(ratio(width.into(), height.into(), ':')),
                ),
                ("pix_fmt", Str("yuv420p".into())),
                ("color_range", Str("tv".into())),
                ("color_space", Str("bt709".into())),
            ]),
            Track::Aac { channels, .. } => row.extend([
                ("codec_name", Str("aac".into())),
                ("codec_long_name", Str("AAC (Advanced Audio Coding)".into())),
                ("profile", Str("LC".into())),
                ("codec_type", Str("audio".into())),
                ("codec_tag_string", Str("mp4a".into())),
                ("codec_tag", Str("0x6d703461".into())),
                ("sample_fmt", Str("fltp".into())),
                ("sample_rate", Str(self.timescale.to_string())),
                ("channels", Number(channels.into())),
                (
                    "channel_layout",
                    Str(if channels == 1 { "mono" } else { "stereo" }.into()),
                ),
                ("bits_per_sample", Number(16.)),
            ]),
        }
        row.extend([
            ("r_frame_rate", Str(rate.clone())),
            ("avg_frame_rate", Str(rate)),
            ("time_base", Str(format!("1/{}", self.timescale))),
            ("start_pts", Number(0.)),
            ("start_time", Str("0.000000".into())),
            ("duration_ts", Number(ticks)),
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
            ("tags", Object(vec![("language".into(), Str("und".into()))])),
        ]);
        if count_frames {
            row.push(("nb_read_frames", Str(self.count.to_string())));
        }
        if count_packets {
            row.push(("nb_read_packets", Str(self.count.to_string())));
        }
        row
    }

    fn format(&self, filename: &str, bytes: usize) -> Row {
        let duration = self.duration;
        let (name, long_name) = match self.track {
            Track::Aac { .. } => ("aac", "raw ADTS AAC (Advanced Audio Coding)"),
            Track::Y4m { .. } => ("yuv4mpegpipe", "YUV4MPEG pipe"),
        };
        format_row(filename, bytes, (name, long_name), 1, duration, vec![])
    }

    fn record(&self, i: usize, frame: bool) -> Row {
        let (size, pos, kind) = match &self.track {
            Track::Aac { ends, .. } => {
                let pos = if i == 0 { 0 } else { ends[i - 1] };
                ((ends[i] - pos) as u64, pos as u64, "audio")
            }
            Track::Y4m { frame_size, .. } => (*frame_size, i as u64 * frame_size, "video"),
        };
        let pts = i as f64 * self.ticks as f64;
        let time = || Str(format!("{:.6}", pts / f64::from(self.timescale)));
        let duration = Str(format!(
            "{:.6}",
            self.ticks as f64 / f64::from(self.timescale)
        ));
        if frame {
            let mut row = vec![
                ("media_type", Str(kind.into())),
                ("stream_index", Number(0.)),
                ("key_frame", Number(1.)),
                ("pts", Number(pts)),
                ("pts_time", time()),
                ("pkt_dts", Number(pts)),
                ("pkt_dts_time", time()),
                ("best_effort_timestamp", Number(pts)),
                ("best_effort_timestamp_time", time()),
                ("pkt_duration", Number(self.ticks as f64)),
                ("pkt_duration_time", duration),
                ("pkt_size", Str(size.to_string())),
            ];
            match self.track {
                Track::Aac { channels, .. } => row.extend([
                    ("sample_fmt", Str("fltp".into())),
                    ("nb_samples", Number(1024.)),
                    ("channels", Number(channels.into())),
                ]),
                Track::Y4m { width, height, .. } => row.extend([
                    ("width", Number(width.into())),
                    ("height", Number(height.into())),
                    ("pix_fmt", Str("yuv420p".into())),
                    ("pict_type", Str("I".into())),
                ]),
            }
            row
        } else {
            vec![
                ("codec_type", Str(kind.into())),
                ("stream_index", Number(0.)),
                ("pts", Number(pts)),
                ("pts_time", time()),
                ("dts", Number(pts)),
                ("dts_time", time()),
                ("duration", Number(self.ticks as f64)),
                ("duration_time", duration),
                ("size", Str(size.to_string())),
                ("pos", Str(pos.to_string())),
                ("flags", Str("K_".into())),
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
        ("nb_streams", Number(tracks as f64)),
        ("nb_programs", Number(0.)),
        ("format_name", Str(name.into())),
        ("format_long_name", Str(long_name.into())),
        ("start_time", Str("0.000000".into())),
        ("duration", Str(format!("{duration:.6}"))),
        ("size", Str(bytes.to_string())),
        (
            "bit_rate",
            Str(if duration == 0. {
                "0".into()
            } else {
                (bytes as f64 * 8. / duration).round().to_string()
            }),
        ),
        ("probe_score", Number(100.)),
        ("tags", Object(tags)),
    ]
}

pub(super) struct ProbeOptions<'a> {
    pub show: BTreeSet<&'a str>,
    pub entries: Option<&'a str>,
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
                    if matches!(self.track, Track::Aac { .. }) {
                        "audio"
                    } else {
                        "video"
                    },
                    0,
                    0,
                ) =>
            {
                Box::new(std::iter::once(self.stream(counts.0, counts.1)))
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
        s if s.starts_with("a:") || s.starts_with("v:") => {
            let digits = s[2..].trim_start();
            let unsigned = digits.trim_start_matches(['+', '-']);
            let n = unsigned.bytes().take_while(u8::is_ascii_digit).count();
            let value =
                unsigned[..n]
                    .parse::<usize>()
                    .unwrap_or(if n == 0 { 0 } else { usize::MAX });
            (if s.starts_with('a') {
                kind == "audio"
            } else {
                kind == "video"
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
    let mut filters = BTreeMap::new();
    for field in opts
        .entries
        .unwrap_or("")
        .split(':')
        .filter(|s| !s.trim().is_empty())
    {
        let (k, v) = field.split_once('=').unwrap_or((field, ""));
        filters.insert(
            k.trim().to_ascii_lowercase(),
            v.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<BTreeSet<_>>(),
        );
    }
    let setting = |key| opts.settings.get(key).copied();
    let json = opts.writer == "json";
    let compact = setting("compact") == Some("1") || setting("c") == Some("1");
    let defaults = opts.show.is_empty() && opts.entries.is_none();
    let mut out = if json { "{".to_owned() } else { String::new() };
    let mut first = true;
    for (section, key) in [
        ("program", "programs"),
        ("packet", "packets"),
        ("frame", "frames"),
        ("stream", "streams"),
        ("chapter", "chapters"),
        ("format", "format"),
    ] {
        let fields = filters.get(section);
        let tags = match section {
            "stream" => filters.get("stream_tags"),
            "format" => filters.get("format_tags"),
            _ => None,
        };
        let requested = opts.show.contains(section);
        if !requested
            && (matches!(section, "frame" | "packet")
                || fields.is_none()
                    && tags.is_none()
                    && !(defaults && matches!(section, "stream" | "format")))
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
        let mut count = 0;
        for (i, mut row) in rows(section).enumerate() {
            count += 1;
            if fields.is_some() || tags.is_some() {
                row.retain_mut(|(key, value)| {
                    if *key == "tags"
                        && let Some(tags) = tags
                        && let Object(values) = value
                    {
                        values.retain(|(k, _)| tags.is_empty() || tags.contains(k.as_str()));
                        return true;
                    }
                    fields.is_some_and(|f| f.is_empty() || f.contains(key))
                });
            }
            if json {
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
                text_row(&mut out, section, i, row, opts.writer, opts.settings);
            }
            if out.len() > opts.limit {
                return Err("output byte limit exceeded");
            }
        }
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
    if out.len() > opts.limit {
        return Err("output byte limit exceeded");
    }
    Ok(out)
}

fn text_row(
    out: &mut String,
    section: &str,
    index: usize,
    row: Row,
    writer: &str,
    settings: &BTreeMap<&str, &str>,
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
    let mut first = true;
    if delimited && get("p") != Some("0") && get("print_section") != Some("0") {
        out.push_str(section);
        first = false;
    }
    let mut emit = |k: &str, v: JVal, tag: bool| {
        let numeric = matches!(v, Number(_));
        let s = match v {
            Str(s) => s,
            Number(_) => v.to_json_string(true, false, 0),
            _ => return,
        };
        if delimited {
            if !first {
                out.push_str(sep);
            }
            first = false;
            if writer == "compact" && !nokey {
                if tag {
                    out.push_str("tag:");
                }
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
                write!(out, "{section}s{sep}{section}{sep}{index}{sep}").unwrap();
            }
            if tag {
                write!(out, "tags{sep}").unwrap();
            }
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
                if tag {
                    out.push_str("TAG:");
                }
                write!(out, "{k}=").unwrap();
            }
            out.push_str(&s);
            out.push('\n');
        }
    };
    for (k, v) in row {
        if k == "tags"
            && let Object(tags) = v
        {
            for (key, value) in tags {
                emit(&key, value, true);
            }
        } else {
            emit(k, v, false);
        }
    }
    if delimited {
        out.push('\n');
    }
    if wrappers {
        writeln!(out, "[/{}]", section.to_uppercase()).unwrap();
    }
}
