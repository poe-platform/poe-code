use super::super::{
    MediaInput,
    media_probe::{self, Packet, ProbeOptions, StreamInfo},
    streaming_input::Manifest,
};
use super::{
    Row, Sample, Stats, Track, chapters, movie, mpegts_input, read_tracks, tags, text_tags,
};
use crate::commands::structured::JVal::Str;

enum Source<'a> {
    Movie(Box<Track<'a>>),
    Transport(StreamInfo),
}
struct Slot<'a> {
    source: Source<'a>,
    kind: &'static str,
    ordinal: usize,
    timeline: Timeline,
    duration: f64,
}
struct Timeline {
    scale: u32,
    stats: Stats,
    packets: Vec<Packet>,
}

impl Timeline {
    // A sequence rebases each segment onto the previous segment's end, with
    // independent clocks per track. A single segment retains its original DTS.
    fn append(
        &mut self,
        mut p: Packet,
        from: u32,
        concat: bool,
        keep: bool,
        remaining: &mut usize,
    ) -> Result<(), String> {
        if concat {
            let ratio = f64::from(self.scale) / f64::from(from);
            let cts = ((p.pts - p.dts) as f64 * ratio + 0.5).floor() as i64;
            p.dts = self.stats.ticks as i64;
            p.pts = p.dts + cts;
            p.ticks = (p.ticks * ratio).round().max(1.);
        }
        if self.stats.count == 0 {
            self.stats.start = i128::from(p.pts);
        }
        p.pos = self.stats.bytes;
        self.stats.count += 1;
        self.stats.bytes += p.size;
        self.stats.ticks += p.ticks as u64;
        self.stats.b_frames |= p.pts != p.dts;
        if keep {
            *remaining = remaining
                .checked_sub(size_of::<Packet>())
                .ok_or("sample index exceeds memory budget")?;
            self.packets.push(p);
        }
        Ok(())
    }
}
impl Slot<'_> {
    fn record(&self, index: usize, p: Packet, frame: bool) -> Row {
        match &self.source {
            Source::Transport(info) => info.codec.record(index, self.timeline.scale, p, frame),
            Source::Movie(t) => t.record(
                Sample {
                    tick: p.ticks as u32,
                    description: 1,
                    dts: p.dts as u64,
                    pts: p.pts.into(),
                    size: p.size,
                    offset: 0,
                    pos: p.pos,
                    key: p.key,
                },
                frame,
            ),
        }
    }
}

pub(in super::super) fn report(
    doc: &Manifest,
    filename: &str,
    format: (&str, &str),
    bytes: usize,
    limit: usize,
    opts: ProbeOptions<'_>,
) -> Result<String, String> {
    let records = opts.show.contains("packet") || opts.show.contains("frame");
    let mut tracks: Vec<Slot> = Vec::new();
    let mut metadata = Vec::new();
    let mut chapter_rows = Vec::new();
    let mut duration: f64 = 0.;
    let mut remaining = limit;
    for (rep, sequence) in doc.sequences.iter().enumerate() {
        let concat = sequence.len() > 1;
        let first = tracks.len();
        for (seg, input) in sequence.iter().enumerate() {
            let MediaInput::Bytes(kind, data) = input else {
                unreachable!()
            };
            let mut headers = Vec::new();
            if *kind == "mpegts" {
                let mode = if concat || records {
                    mpegts_input::Read::Packets
                } else {
                    mpegts_input::Read::Summary
                };
                for t in mpegts_input::parse(data, limit, mode)? {
                    headers.push((t.kind, Source::Transport(t.info), t.packets));
                }
            } else {
                let moov = movie(data)?;
                let (native, seconds) = read_tracks(data, moov)?;
                if !concat && doc.sequences.len() == 1 {
                    duration = seconds;
                }
                if seg == 0 {
                    if rep == 0 {
                        metadata = tags(data, moov);
                    } else {
                        for (key, value) in text_tags(moov) {
                            if let Some((_, v)) = metadata.iter_mut().find(|(k, _)| k == key) {
                                *v = Str(value);
                            } else {
                                metadata.push((key.into(), Str(value)));
                            }
                        }
                    }
                    chapter_rows.extend(chapters(moov, seconds));
                }
                headers.extend(
                    native
                        .into_iter()
                        .map(|t| (t.kind, Source::Movie(Box::new(t)), vec![])),
                );
            }
            let mut counts = std::collections::BTreeMap::new();
            for (kind, source, transport) in headers {
                let (scale, seconds) = match &source {
                    Source::Movie(t) => (t.scale, t.duration as f64 / f64::from(t.scale)),
                    Source::Transport(t) => (t.scale, t.ticks / f64::from(t.scale)),
                };
                let ordinal = counts.entry(kind).or_insert(0);
                let idx = tracks[first..]
                    .iter()
                    .position(|s| s.kind == kind && s.ordinal == *ordinal)
                    .map(|n| first + n);
                let mut fresh = Timeline {
                    scale: if concat && kind == "video" {
                        90000
                    } else {
                        scale
                    },
                    stats: Stats::default(),
                    packets: Vec::new(),
                };
                let dst = if let Some(idx) = idx {
                    &mut tracks[idx].timeline
                } else {
                    &mut fresh
                };
                if records || concat {
                    match &source {
                        Source::Movie(t) => {
                            for s in t.samples(data.len()) {
                                dst.append(
                                    Packet {
                                        ticks: s.tick.into(),
                                        size: s.size,
                                        dts: s.dts as i64,
                                        pts: s.pts as i64,
                                        key: s.key,
                                        pos: 0,
                                    },
                                    scale,
                                    concat,
                                    records,
                                    &mut remaining,
                                )?;
                            }
                        }
                        Source::Transport(_) => {
                            for p in transport {
                                dst.append(p, scale, concat, records, &mut remaining)?;
                            }
                        }
                    }
                }
                if idx.is_none() {
                    if tracks.len() >= 32 {
                        return Err("output stream count exceeds limit".into());
                    }
                    tracks.push(Slot {
                        source,
                        kind,
                        ordinal: *ordinal,
                        timeline: fresh,
                        duration: seconds,
                    });
                }
                *ordinal += 1;
            }
        }
        for (i, slot) in tracks.iter_mut().enumerate().skip(first) {
            let sums = &mut slot.timeline.stats;
            let scale = slot.timeline.scale;
            if concat {
                slot.duration = sums.ticks as f64 / f64::from(scale);
            }
            duration = duration.max(slot.duration);
            let renumber = concat || doc.sequences.len() > 1;
            match &mut slot.source {
                Source::Movie(t) => {
                    t.index = i;
                    if renumber {
                        t.id = i as u32 + 1;
                    }
                    if concat {
                        t.scale = scale;
                        t.duration = sums.ticks;
                        t.stats = std::mem::take(sums);
                    }
                }
                Source::Transport(t) => {
                    if renumber {
                        t.id = i as u64 + 1;
                    }
                    if concat {
                        t.scale = scale;
                        t.ticks = sums.ticks as f64;
                        t.sample_ticks = t.ticks;
                        t.count = sums.count;
                        t.start = sums.start as i64;
                        t.payload_bytes = sums.bytes;
                        t.has_cts = sums.b_frames;
                    }
                }
            }
        }
    }
    if doc.duration != 0. {
        duration = doc.duration;
    }
    let select = opts.select;
    let counts = opts.counts;
    media_probe::report(opts, |section| match section {
        "format" => Box::new(std::iter::once(media_probe::format_row(
            filename,
            bytes,
            format,
            tracks.len(),
            duration,
            metadata.clone(),
        ))),
        "chapter" => Box::new(chapter_rows.iter().cloned()),
        "stream" => Box::new(
            tracks
                .iter()
                .enumerate()
                .filter(|(i, t)| {
                    let ordinal = tracks[..*i]
                        .iter()
                        .filter(|prior| prior.kind == t.kind)
                        .count();
                    media_probe::selected(select, t.kind, *i, ordinal)
                })
                .map(|(i, t)| match &t.source {
                    Source::Movie(t) => t.stream(counts),
                    Source::Transport(info) => info.stream(i, counts),
                }),
        ),
        "packet" | "frame" => Box::new(tracks.iter().enumerate().flat_map(move |(i, t)| {
            t.timeline.packets
                .iter()
                .map(move |&p| t.record(i, p, section == "frame"))
        })),
        _ => Box::new(std::iter::empty()),
    })
    .map_err(str::to_owned)
}
