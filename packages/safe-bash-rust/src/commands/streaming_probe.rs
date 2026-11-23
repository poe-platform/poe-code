use super::super::{
    MediaInput,
    media_probe::{self, Packet, ProbeOptions, StreamInfo},
    streaming_input::Manifest,
};
use super::{
    Row, Sample, Stats, Track, chapter_row, read_chapters, movie, mpegts_input, read_tracks, tags, text_tags,
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
    frames: usize,
    packets: Vec<Packet>,
    packet_info: Vec<Option<mpegts_input::PacketInfo>>,
}

impl Timeline {
    // A sequence rebases each segment onto the previous segment's end, with
    // independent clocks per track. A single segment retains its original DTS.
    fn append(
        &mut self,
        mut p: Packet,
        packet_info: Option<mpegts_input::PacketInfo>,
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
                .checked_sub(size_of::<Packet>() + size_of::<Option<mpegts_input::PacketInfo>>())
                .ok_or("sample index exceeds memory budget")?;
            self.packets.push(p);
            self.packet_info.push(packet_info);
        }
        Ok(())
    }
}
impl Slot<'_> {
    fn record(&self, index: usize, p: Packet, packet_info: Option<mpegts_input::PacketInfo>, frame: bool, skip: &mut u64, optional: bool) -> Option<Row> {
        match &self.source {
            Source::Transport(info) => {
                let mut row = info.codec.record(index, self.timeline.scale, p, frame);
                if !frame && let Some(info) = packet_info { info.add_to(&mut row); }
                Some(row)
            }
            Source::Movie(t) => {
                let sample = Sample {
                    chunk_end: true,
                    tick: p.ticks as u32,
                    description: 1,
                    dts: p.dts as u64,
                    pts: p.pts.into(),
                    size: p.size,
                    offset: 0,
                    pos: p.pos,
                    key: p.key,
                };
                let skipped = if frame { Some(t.frame_skip(&sample, skip)?) } else { None };
                Some(t.record(sample, skipped, optional))
            },
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
    let mut transport_offset = 0;
    for (rep, sequence) in doc.sequences.iter().enumerate() {
        let concat = sequence.len() > 1;
        let first = tracks.len();
        // HLS keeps its transport demuxer and codec parsers alive across segments.
        // Read the sequence together so continuity errors and buffered access
        // units retain their native packet flags and emission order.
        let joined = if concat && sequence.iter().all(|input| matches!(input, MediaInput::Bytes("mpegts", _))) {
            let mut bytes = Vec::new();
            for input in sequence {
                let MediaInput::Bytes(_, data) = input else { unreachable!() };
                remaining = remaining.checked_sub(data.len()).ok_or("input byte limit exceeded")?;
                bytes.extend_from_slice(data);
            }
            Some(bytes)
        } else { None };
        for (seg, input) in sequence.iter().enumerate() {
            if joined.is_some() && seg != 0 { continue; }
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
                for t in mpegts_input::parse(joined.as_deref().unwrap_or(data), remaining, mode)? {
                    headers.push((t.kind, Source::Transport(t.info), t.packets, t.packet_info));
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
                    chapter_rows.extend(read_chapters(data, moov, &native, seconds, remaining)?.iter().map(chapter_row));
                }
                headers.extend(
                    native
                        .into_iter()
                        .map(|t| (t.kind, Source::Movie(Box::new(t)), vec![], vec![])),
                );
            }
            let mut counts = std::collections::BTreeMap::new();
            for (kind, source, transport, packet_info) in headers {
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
                    frames: 0,
                    packets: Vec::new(),
                    packet_info: Vec::new(),
                };
                let dst = if let Some(idx) = idx {
                    &mut tracks[idx].timeline
                } else {
                    &mut fresh
                };
                if records || concat || opts.counts.0 || opts.counts.1 {
                    match &source {
                        Source::Movie(t) => {
                            let mut skip = 0;
                            for s in t.samples(data.len()) {
                                dst.frames += usize::from(t.frame_skip(&s, &mut skip).is_some());
                                dst.append(
                                    Packet {
                                        ticks: s.tick.into(),
                                        size: s.size,
                                        dts: s.dts as i64,
                                        pts: s.pts as i64,
                                        key: t.packet_key(data, &s),
                                        pos: 0,
                                    },
                                    None,
                                    scale,
                                    concat,
                                    records,
                                    &mut remaining,
                                )?;
                            }
                        }
                        Source::Transport(_) => {
                            for (p, mut info) in transport.into_iter().zip(packet_info) {
                                info.emitted_at += transport_offset;
                                dst.append(p, Some(info), scale, concat, records, &mut remaining)?;
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
            transport_offset += joined.as_ref().map_or(data.len(), Vec::len) + 2;
        }
        if let Some(bytes) = joined { remaining += bytes.len(); }
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
    let counts = (opts.counts.0 || opts.show.contains("frame"), opts.counts.1 || opts.show.contains("packet"));
    let optional = !matches!(opts.writer, "json" | "xml");
    let count: usize = tracks.iter().map(|t| t.timeline.packets.len()).sum();
    if count > remaining / size_of::<(usize, usize)>() {
        return Err("sample index exceeds memory budget".into());
    }
    let mut order: Vec<_> = tracks.iter().enumerate().flat_map(|(i, t)| (0..t.timeline.packets.len()).map(move |n| (i, n))).collect();
    if tracks.iter().all(|t| matches!(t.source, Source::Transport(_))) {
        order.sort_unstable_by_key(|&(i, n)| (tracks[i].timeline.packet_info[n].map(|p| p.emitted_at), i, n));
    }
    let tracks = &tracks;
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
                    Source::Movie(source) => source.stream(counts, t.timeline.frames, t.timeline.stats.count, optional),
                    Source::Transport(info) => info.stream(i, counts),
                }),
        ),
        "packet" | "frame" => {
            let mut skips = vec![0; tracks.len()];
            Box::new(order.iter().filter_map(move |&(i, n)| {
            let t = &tracks[i];
            let ordinal = tracks[..i].iter().filter(|prior| prior.kind == t.kind).count();
            if !media_probe::selected(select, t.kind, i, ordinal) { return None; }
            t.record(i, t.timeline.packets[n], t.timeline.packet_info[n], section == "frame", &mut skips[i], optional)
        })) },
        _ => Box::new(std::iter::empty()),
    })
    .map_err(str::to_owned)
}
