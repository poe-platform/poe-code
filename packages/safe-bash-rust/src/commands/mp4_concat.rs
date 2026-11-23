use super::super::{atoms, child, esds, u16_at, u32_at};
use super::super::super::{audio_remix, audio_resample, ffmpeg_pcm::Format};
use super::{InputTime, MediaInput, Raster, Source, Streams, Track, atom, ffmpeg_wave, frame_output};
use std::collections::{BTreeMap, HashMap};

pub(in super::super::super) struct DecodedConcat {
    pub(super) video: Option<BTreeMap<usize, VideoFrames>>,
    pub(super) audio: BTreeMap<usize, Pcm>,
    pub(in super::super::super) joined: bool,
    pub(in super::super::super) align_durations: bool,
    export_pcm: bool,
    pub(in super::super::super) timings: Option<Vec<(InputTime, Option<f64>)>>,
    pub(in super::super::super) auto_convert: bool,
    pub(in super::super::super) chapters: Vec<super::super::super::ffmpeg_input::Chapter>,
}
impl DecodedConcat {
    pub(in super::super::super) fn byte_size(&self) -> usize {
        self.chapters.capacity() * size_of::<super::super::super::ffmpeg_input::Chapter>() + self.audio
            .values()
            .map(|pcm| pcm.bytes.capacity() + pcm.channel_order.capacity() * size_of::<u16>() + pcm.frames.capacity() * size_of::<ffmpeg_wave::Frame>())
            .sum::<usize>()
            + self
                .video
                .iter()
                .flat_map(|slots| slots.values())
                .flat_map(|seq| &seq.images)
                .map(|im| im.pixels.len() * 4)
                .sum::<usize>()
    }
    pub(in super::super::super) fn new(video: bool, export_pcm: bool) -> Self {
        Self {
            video: video.then(BTreeMap::new),
            audio: BTreeMap::new(),
            joined: false,
            align_durations: true,
            export_pcm,
            timings: None,
            auto_convert: false,
            chapters: Vec::new(),
        }
    }
}
pub(super) struct Pcm {
    pub(super) rate: u32,
    pub(super) channels: usize,
    pub(super) channel_mask: u32,
    pub(super) channel_order: Vec<u16>,
    format: Format,
    bytes: Vec<u8>,
    frames: Vec<ffmpeg_wave::Frame>,
}
impl Pcm {
    pub(super) fn wave(&self) -> ffmpeg_wave::Wave<'_> {
        ffmpeg_wave::Wave {
            block_align: 0, fmt: &[],
            raw: Some(self.format),
            packet_frames: None,
            packets: &[], frames: &self.frames,
            rate: self.rate,
            channels: self.channels,
            bits: self.format.bits(),
            tag: self.format.wave_encoding().map_or(1, |(tag,_)|tag),
            data: &self.bytes,
            data_pos: 0, truncated: false,
            fact: None,
            channel_mask: self.channel_mask, channel_order: &self.channel_order,
        }
    }
    fn resize(&mut self, frames: usize, remaining: &mut usize) -> Result<(), String> {
        let len = frames
            .checked_mul(self.channels)
            .and_then(|n| n.checked_mul(usize::from(self.format.bits()/8)))
            .ok_or("audio output exceeds memory budget")?;
        let growth = len.saturating_sub(self.bytes.capacity());
        let available = remaining
            .checked_sub(growth)
            .ok_or("audio output exceeds memory budget")?;
        let previous = self.bytes.len();
        if growth != 0 {
            self.bytes.try_reserve_exact(len - previous)
                .map_err(|_| "audio output exceeds memory budget")?;
        }
        *remaining = available;
        self.bytes.resize(len, 0);
        for sample in self.bytes[previous.min(len)..].chunks_exact_mut(usize::from(self.format.bits()/8)) {
            self.format.write_float(0., sample);
        }
        Ok(())
    }
    fn append(
        &mut self,
        (offset, cut): (f64, InputTime),
        (rate, channels, source_mask, source_order, source_format): (u32, usize, u32, &[u16], Format),
        (frames, period): (usize, usize),
        remaining: &mut usize,
        work: &mut usize,
        sample: impl Fn(usize, usize) -> f64,
    ) -> Result<(), String> {
        let count = (frames as f64 * f64::from(self.rate) / f64::from(rate)).ceil() as usize;
        if count == 0 { return Ok(()); }
        let mut input_mask = if source_mask == 0 { audio_remix::default_mask(channels) } else { source_mask };
        let mut output_mask = if self.channel_mask == 0 { audio_remix::default_mask(self.channels) } else { self.channel_mask };
        if input_mask != output_mask || channels != self.channels || source_order != self.channel_order {
            let mask = |order: &[u16], fallback| {
                if order.is_empty() { return Ok(fallback); }
                order.iter().try_fold(0u32, |mask, &speaker| {
                    let bit = 1u32.checked_shl(u32::from(speaker)).ok_or("Unsupported PCM channel layout")?;
                    if mask & bit != 0 { return Err("Duplicate PCM speakers cannot be mixed"); }
                    Ok(mask | bit)
                })
            };
            input_mask = mask(source_order, input_mask)?;
            output_mask = mask(&self.channel_order, output_mask)?;
        }
        let remix = input_mask != output_mask || channels != self.channels || source_order != self.channel_order;
        let double = matches!(source_format, Format::Float(64, _));
        let resample = self.rate != rate;
        let operations = count.saturating_mul(self.channels).saturating_add(if remix {
            frames.max(count).saturating_mul(channels).saturating_mul(self.channels)
        } else { 0 });
        *work = work.checked_sub(operations).ok_or("audio resampling work limit exceeded")?;
        let weights = if remix {
            if input_mask.count_ones() as usize != channels || output_mask.count_ones() as usize != self.channels {
                return Err("Invalid PCM channel layout".into());
            }
            let canonical = audio_remix::matrix(input_mask, output_mask, !matches!(self.format, Format::Float(..)))?;
            let mut weights = canonical;
            for (c, row) in weights.iter_mut().enumerate().take(self.channels) {
                let target = if self.channel_order.is_empty() { c }
                    else { (output_mask & ((1 << self.channel_order[c]) - 1)).count_ones() as usize };
                for (i, value) in row.iter_mut().enumerate().take(channels) {
                    let source = if source_order.is_empty() { i }
                        else { (input_mask & ((1 << source_order[i]) - 1)).count_ones() as usize };
                    *value = canonical[target][source];
                }
            }
            Some(weights)
        } else { None };
        let surround = source_order.is_empty() && self.channel_order.is_empty() && output_mask == 3 && matches!(input_mask,0x3f|0x60f|0x63f);
        let resample_first = !remix || ((self.channels / channels) as f64) < f64::from(self.rate) / f64::from(rate);
        let width = if double { 8 } else { 4 };
        let overhead = (channels+self.channels)*size_of::<Vec<f64>>();
        if remix || resample {
            frames.checked_mul(channels + self.channels).and_then(|n|n.checked_mul(width))
                .and_then(|n|n.checked_add(overhead)).filter(|&n|n<=*remaining)
                .ok_or("audio mixing exceeds memory budget")?;
        }
        let limit = *remaining;
        let mixed = if !double && (remix || resample) {
            let mut input = (0..channels).map(|c|(0..frames).map(|f|sample(f,c) as f32).collect()).collect::<Vec<Vec<f32>>>();
            if resample && resample_first { input = audio_resample::resample(&input,rate,self.rate,limit,work)?; }
            if let Some(weights) = &weights {
                let integer = !resample && matches!(source_format, Format::Signed(16, _) | Format::Unsigned(16, _))
                    && matches!(self.format, Format::Signed(16, _) | Format::Unsigned(16, _));
                input = audio_remix::mix(&input, weights, self.channels, integer, surround, limit.saturating_sub(overhead))?;
            }
            if resample && !resample_first { input = audio_resample::resample(&input,rate,self.rate,limit,work)?; }
            Some(input)
        } else { None };
        let mixed_double = if double && (remix || resample) {
            let mut input = (0..channels).map(|c|(0..frames).map(|f|sample(f,c)).collect()).collect::<Vec<Vec<f64>>>();
            if resample && resample_first { input = audio_resample::resample_f64(&input,rate,self.rate,limit,work)?; }
            if let Some(weights) = &weights {
                input = audio_remix::mix_f64(&input, weights, self.channels, surround, limit)?;
            }
            if resample && !resample_first { input = audio_resample::resample_f64(&input,rate,self.rate,limit,work)?; }
            Some(input)
        } else { None };
        let count = mixed.as_ref().map(|p|p[0].len()).or_else(||mixed_double.as_ref().map(|p|p[0].len())).unwrap_or(frames);
        let from = (cut.start.unwrap_or(0.) * f64::from(self.rate)).round() as usize;
        let until = cut.end().map(|end| (end * f64::from(self.rate)).round() as usize);
        let ratio = f64::from(rate) / f64::from(self.rate);
        let delay = if resample { (16. / (0.97 / ratio).min(1.)).ceil() as usize } else { 0 };
        let first = if period > 0 { let n = frames % period; if n == 0 { period } else { n } } else { frames };
        let copies = if period > 0 { (frames - first) / period + 1 } else { 1 };
        let emitted = |input: usize| (input.saturating_sub(delay) as f64 / ratio).ceil() as usize;
        // Keep filter-frame boundaries: trimming can retain a partial frame
        // before an overlapping loop, then retain another frame after restart.
        let ranges = || (0..copies).flat_map(|pass| {
            let base = if pass == 0 { 0 } else { first + (pass - 1) * period };
            let length = if pass == 0 { first } else { period };
            (0..length).step_by(1024).map(move |at| ((base + at + 1024).min(base + length), pass, false))
        }).chain(std::iter::once((frames, copies - 1, true)))
            .scan((0usize, false), |(previous, done), (input_end, pass, flush)| {
                if *done { return None; }
                let begin = *previous;
                let end = if flush { count } else { emitted(input_end).min(count) };
                *previous = end;
                let shift = (pass as f64 * period.saturating_sub(first) as f64 / ratio).round() as usize;
                let lo = begin.max(from.saturating_add(shift)).min(end);
                let hi = until.map_or(end, |until| end.min(until.saturating_add(shift))).max(lo);
                if end > begin && until.is_some_and(|until| begin >= until.saturating_add(shift)) { *done = true; }
                Some((lo..hi, lo.saturating_sub(shift).saturating_sub(from)))
            });
        let count = ranges().map(|(range, _)| range.len()).sum::<usize>();
        let retained = mixed.as_ref().map_or(0, |pcm|pcm.capacity()*size_of::<Vec<f32>>() + pcm.iter().map(|ch|ch.capacity()*4).sum::<usize>())
            + mixed_double.as_ref().map_or(0, |pcm|pcm.capacity()*size_of::<Vec<f64>>() + pcm.iter().map(|ch|ch.capacity()*8).sum::<usize>());
        *remaining = remaining.checked_sub(retained).ok_or("audio mixing exceeds memory budget")?;
        let start = (offset * f64::from(self.rate)).round() as usize;
        let end = start
            .checked_add(count)
            .ok_or("audio output exceeds memory budget")?;
        let width = usize::from(self.format.bits()/8);
        let stride = self.channels * width;
        if self.bytes.len() / stride < end {
            self.resize(end, remaining)?;
        }
        let timestamp = self.frames.last().map_or(start as i128, |p| p.pts + start.saturating_sub(p.start) as i128);
        let mut appended = 0;
        for (range, pts) in ranges() {
            if range.is_empty() { continue; }
            if self.frames.len() == self.frames.capacity() {
                *remaining = remaining.checked_sub(size_of::<ffmpeg_wave::Frame>()).ok_or("audio timeline exceeds memory budget")?;
                self.frames.try_reserve_exact(1).map_err(|_| "audio timeline exceeds memory budget")?;
            }
            self.frames.push(ffmpeg_wave::Frame {
                start: start + appended, len: range.len(), pts: timestamp + pts as i128,
            });
            appended += range.len();
        }
        for (i, frame) in ranges().flat_map(|(range, _)| range)
            .zip(self.bytes[start * stride..end * stride].chunks_exact_mut(stride))
        {
            for (c, out) in frame.chunks_exact_mut(width).enumerate() {
                let value = if let Some(pcm) = &mixed { f64::from(pcm[c][i]) }
                    else if let Some(pcm) = &mixed_double { pcm[c][i] }
                    else { sample(i,c) };
                self.format.write_float(value, out);
            }
        }
        *remaining += retained;
        Ok(())
    }
}
#[derive(Default)]
pub(super) struct VideoFrames {
    pub(super) images: Vec<Raster>,
    times: Vec<(f64, f64, usize)>,
}
impl VideoFrames {
    fn append(
        &mut self,
        offset: f64,
        times: impl Iterator<Item = (f64, f64)>,
        period: usize,
        mut image: impl FnMut(usize, usize) -> Result<Raster, &'static str>,
        remaining: &mut usize,
    ) -> Result<(), &'static str> {
        let base = self.images.len();
        for (i, (pts, duration)) in times.enumerate() {
            *remaining = remaining
                .checked_sub(size_of::<(f64, f64, usize)>())
                .ok_or("video frames exceed memory budget")?;
            if i < period {
                let im = image(i, *remaining)?;
                *remaining = remaining
                    .checked_sub(im.pixels.len() * 4 + size_of::<Raster>())
                    .ok_or("video frames exceed memory budget")?;
                self.images.push(im);
            }
            self.times.push((offset + pts, duration, base + i % period));
        }
        Ok(())
    }
    pub(super) fn visible(&self, start: f64, end: Option<f64>) -> &[(f64, f64, usize)] {
        let from = self.times.partition_point(|f| f.0 + f.1 <= start);
        let until = end.map_or(self.times.len(), |t| {
            self.times.partition_point(|f| f.0 < t)
        });
        &self.times[from..until.max(from)]
    }
}
#[derive(Eq, PartialEq, Hash)]
struct Description {
    tag: [u8; 4],
    dimensions: Option<(u16, u16)>,
    audio: Option<(u32, u16)>,
    avcc: Vec<u8>,
}
impl Description {
    fn read(tag: &[u8; 4], data: &[u8], container: bool, kind: &str) -> Self {
        let visual = matches!(
            tag,
            b"avc1"
                | b"avc3"
                | b"hvc1"
                | b"hev1"
                | b"av01"
                | b"vp08"
                | b"vp09"
                | b"mp4v"
                | b"jpeg"
                | b"mjpa"
                | b"png "
                | b"s263"
        ) || !container && kind == "video";
        let audio = matches!(
            tag,
            b"mp4a"
                | b"Opus"
                | b"fLaC"
                | b"alac"
                | b"ac-3"
                | b"ec-3"
                | b"sowt"
                | b"twos"
                | b"lpcm"
                | b".mp3"
                | b"ulaw"
                | b"alaw"
        ) || !container && kind == "audio";
        let audio = (audio && data.len() >= 28).then(|| {
            let offset = match u16_at(data, 8) {
                1 => 44,
                2 => 64,
                _ => 28,
            };
            let config = child(data.get(offset..).unwrap_or_default(), b"esds");
            if config.is_empty() {
                (
                    ((u64::from(u32_at(data, 24)) + 32768) >> 16) as u32,
                    u16_at(data, 16),
                )
            } else {
                let c = esds(config);
                (c.rate, c.channels)
            }
        });
        Self {
            tag: *tag,
            dimensions: (visual && data.len() >= 78).then(|| (u16_at(data, 24), u16_at(data, 26))),
            audio,
            avcc: if visual {
                child(data.get(78..).unwrap_or_default(), b"avcC").to_vec()
            } else {
                vec![]
            },
        }
    }
}

fn packet_ranges(tracks: &[(super::super::Track<'_>, &[u8])], input: &[u8], cut: InputTime) -> Vec<(usize, usize)> {
    let mut starts = vec![0; tracks.len()];
    if let Some(start) = cut.start {
        let reference = tracks.iter().position(|(t,_)| t.kind == "video").unwrap_or(0);
        let track = &tracks[reference].0;
        let first = track.samples(input.len()).enumerate()
            .filter(|(_,s)| s.key && s.dts as f64 <= start * f64::from(track.scale))
            .last();
        if let Some((index, sample)) = first {
            starts[reference] = index;
            let timestamp = (sample.dts as f64 - track.probe_origin as f64 + track.empty_ticks as f64) / f64::from(track.scale);
            for (i, (t,_)) in tracks.iter().enumerate() {
                if i == reference { continue; }
                starts[i] = t.samples(input.len()).enumerate()
                    .filter(|(_,s)| s.key && (s.dts as f64 - t.probe_origin as f64 + t.empty_ticks as f64) / f64::from(t.scale) <= timestamp)
                    .map(|(i,_)| i).last().unwrap_or(0);
            }
        }
    }
    let mut packets: Vec<_> = tracks.iter().zip(&starts)
        .map(|((t,_), &start)| t.samples(input.len()).skip(start).peekable()).collect();
    let mut counts = vec![0; tracks.len()];
    loop {
        let mut best = None;
        for (i, packets) in packets.iter_mut().enumerate() {
            let Some(s) = packets.peek() else { continue; };
            let t = &tracks[i].0;
            let dts = ((s.dts as f64 - t.probe_origin as f64 + t.empty_ticks as f64) * 1_000_000. / f64::from(t.scale)).round() as i64;
            // MOV interleaves nearby packets by file position, but reads the
            // earlier clock first when streams are more than one second apart.
            if best.is_none_or(|(_,time,pos): (usize,i64,usize)| {
                if dts.abs_diff(time) <= 1_000_000 { s.offset < pos } else { dts < time }
            }) { best = Some((i,dts,s.offset)); }
        }
        let Some((i,dts,_)) = best else { break; };
        if cut.to.is_some_and(|end| dts >= (end * 1_000_000.).round() as i64) { break; }
        packets[i].next();
        counts[i] += 1;
    }
    starts.into_iter().zip(counts).collect()
}

struct PacketClock {
    delay: usize,
    last: Option<i64>,
    ordered: u16,
    misordered: u16,
    pts: [i64; 17],
    errors: [(u64, u16); 16],
}
impl PacketClock {
    fn new(delay: usize) -> Self {
        Self {delay, last: None, ordered: 0, misordered: 0, pts: [i64::MIN; 17], errors: [(0, 0); 16]}
    }
    fn dts(&mut self, dts: i64, pts: i64) -> i64 {
        if dts == pts && let Some(last) = self.last {
            if dts >= last { self.ordered += 1; } else { self.misordered += 1; }
            if self.ordered + self.misordered > 250 { self.ordered >>= 1; self.misordered >>= 1; }
        }
        self.last = Some(dts);
        self.pts[0] = pts;
        for i in 0..self.delay {
            if self.pts[i] <= self.pts[i+1] { break; }
            self.pts.swap(i, i+1);
        }
        if self.ordered < 8 * self.misordered && dts == pts {
            let index = self.errors[..self.delay].iter().enumerate().filter(|(_,(_,n))| *n > 0)
                .min_by_key(|(_, (sum, n))| sum / u64::from(*n)).map_or(0, |(i,_)| i);
            return if self.pts[index] == i64::MIN { dts } else { self.pts[index] };
        }
        for (i, (sum, count)) in self.errors[..self.delay].iter_mut().enumerate() {
            if self.pts[i] == i64::MIN { continue; }
            *sum = sum.saturating_add(self.pts[i].abs_diff(dts)).min(i64::MAX as u64);
            *count += 1;
            if *count > 250 { *sum >>= 1; *count >>= 1; }
        }
        dts
    }
}

pub(super) fn join<'a>(
    mut tracks: Vec<Track<'a>>,
    sources: &[Source<'a>],
    inputs: &[MediaInput],
    input_times: &[InputTime],
    movie_scale: u32,
    limit: usize,
    retained: &mut DecodedConcat,
) -> Result<Vec<Track<'a>>, String> {
    let timed = retained.timings.is_some();
    let mut remaining = limit;
    let mut track_base = 0;
    for (j, (input, _, source)) in sources.iter().enumerate() {
        if let Some(times) = &retained.timings
            && matches!(inputs[j], MediaInput::Bytes("mp4" | "mov", _) | MediaInput::Joined(..))
            && let Streams::Mp4(original) = source
            && !original.is_empty()
        {
            let ranges = packet_ranges(original, input, times[j].0);
            for (i, ((first, count), (original, _))) in ranges.into_iter().zip(original).enumerate() {
                let clip = &mut tracks[track_base + i];
                clip.samples.clear();
                let mut converter = None;
                let mut description = 0;
                for sample in original.samples(input.len()).skip(first).take(count) {
                    let key = original.packet_key(input, &sample);
                    if clip.kind == "video" && clip.samples.is_empty() && !key { continue; }
                    if clip.samples.is_empty() { clip.first_dts = sample.dts; }
                    if retained.auto_convert && description != sample.description {
                        description = sample.description;
                        let (tag, entry) = description.checked_sub(2)
                            .and_then(|n| original.other_video.get(n as usize).copied())
                            .unwrap_or((original.tag,original.entry));
                        converter = if matches!(tag,b"avc1"|b"avc3") {
                            original.original.avcc(entry).map(super::super::h264::concat::Converter::new).transpose()?
                        } else { None };
                    }
                    let data = &input[sample.offset..sample.offset + sample.size as usize];
                    clip.samples.push(super::Sample {
                        data: if let Some(converter) = &mut converter { converter.packet(data, &mut remaining)?.into() } else { data.into() },
                        duration: sample.tick,
                        cts: (sample.pts - i128::from(sample.dts)) as i64,
                        key, description: sample.description,
                    });
                }
            }
        }
        track_base += source.len();
    }
    let clip_origin = |t: &Track<'_>| {
        let empty = t.edits.iter().take_while(|r| r[1] == u32::MAX)
            .map(|r| f64::from(r[0])).sum::<f64>() / f64::from(movie_scale);
        let media = t.edits.iter().find(|r| r[1] != u32::MAX)
            .map_or(0., |r| f64::from(r[1])) / f64::from(t.scale);
        t.first_dts as f64 / f64::from(t.scale) + empty - media
    };
    let shift = if timed {
        tracks.iter().take(sources[0].2.len()).enumerate().filter(|(_,t)| !t.samples.is_empty())
            .filter(|(i,t)| !matches!(&sources[0].2, Streams::Mp4(v) if t.kind == "video" && i128::from(t.first_dts) + i128::from(t.samples[0].cts) < i128::from(v[*i].0.origin)))
            .map(|(_,t)| clip_origin(t) + t.samples[0].cts as f64 / f64::from(t.scale))
            .reduce(f64::min).map_or(0., |start| -start + if matches!(inputs[0], MediaInput::Bytes("mp4" | "mov", _) | MediaInput::Joined(..)) {
                retained.timings.as_ref().unwrap()[0].0.start.unwrap_or_else(|| match &sources[0].2 {
                    Streams::Mp4(v) => v.iter().map(|(t,_)| t.stats.start as f64 / f64::from(t.scale)).reduce(f64::min).unwrap_or(0.),
                    _ => 0.,
                })
            } else { 0. })
    } else { 0. };
    let mut boundary = 0.;
    let mut origins: Vec<i64> = Vec::new();
    let mut presentation_ends: Vec<i64> = Vec::new();
    let mut clocks = Vec::new();
    let mut tracks = tracks.into_iter();
    let mut audio_work = limit.saturating_mul(8);
    let mut slots: Vec<Track<'a>> = Vec::new();
    let mut descriptions: Vec<HashMap<Description, u32>> = Vec::new();
    let mut decoded = BTreeMap::new();
    for (j, (_, _, source)) in sources.iter().enumerate() {
        let movie_times = if timed && matches!(inputs[j], MediaInput::Bytes("mp4" | "mov", _) | MediaInput::Joined(..)) {
            if let Streams::Mp4(tracks) = source {
                Some((
                    tracks.iter().map(|(t,_)| t.stats.start as f64 / f64::from(t.scale)).reduce(f64::min).unwrap_or(0.),
                    tracks.iter().map(|(t,_)| (t.stats.start as f64 + t.duration as f64 - t.empty_ticks as f64) / f64::from(t.scale)).fold(0., f64::max),
                ))
            } else { None }
        } else { None };
        let mut ordinals = BTreeMap::new();
        for i in 0..source.len() {
            let mut clip = tracks.next().ok_or("missing concat track")?;
            let ordinal = ordinals.entry(clip.kind).or_insert(0);
            let slot = slots
                .iter()
                .enumerate()
                .filter(|(_, t)| t.kind == clip.kind)
                .nth(*ordinal)
                .map(|(i, _)| i);
            *ordinal += 1;
            let from = clip.scale;
            let input_origin = clip_origin(&clip) - if let Some((start, _)) = movie_times {
                retained.timings.as_ref().unwrap()[j].0.start.unwrap_or(start)
            } else { 0. };
            let samples = std::mem::take(&mut clip.samples);
            let entries = std::mem::take(&mut clip.stsd);
            let slot = match slot {
                Some(i) => i,
                None => {
                    if slots.len() >= 32 {
                        return Err("output stream count exceeds limit".into());
                    }
                    if clip.kind == "video" && !timed {
                        clip.scale = 90000;
                    }
                    clip.id = slots.len() as u32 + 1;
                    clip.first_dts = 0;
                    clip.media_ticks = 0;
                    clip.edits.clear();
                    clip.fragment_sample_size = None;
                    clip.stsd = vec![0; 8].into();
                    descriptions.push(HashMap::new());
                    slots.push(clip);
                    origins.push(0);
                    presentation_ends.push(0);
                    if timed {
                        remaining = remaining.checked_sub(size_of::<PacketClock>()).ok_or("concat packet clocks exceed memory budget")?;
                        let delay = if let Streams::Mp4(v) = source { v[i].0.sequence.as_ref().and_then(|s| s.reorder).unwrap_or(0) } else { 0 };
                        clocks.push(PacketClock::new(delay));
                    }
                    slots.len() - 1
                }
            };
            let t = &mut slots[slot];
            let inner = inputs[j].decoded();
            let inner_pcm = inner.and_then(|c| c.audio.get(&i));
            let movie_pcm = retained.export_pcm && !timed && inner_pcm.is_none()
                && matches!(inputs[j], MediaInput::Bytes("mp4" | "mov", _) | MediaInput::Joined(..))
                && matches!(source, Streams::Mp4(v) if v[i].0.pcm_format().is_some());
            if retained.export_pcm && !timed && t.kind == "audio" && !retained.audio.contains_key(&slot)
                && input_times.get(j).is_some_and(|cut| cut.start.is_some() || cut.end().is_some()) {
                // FFmpeg negotiates concat formats from directly connected
                // inputs before those behind an input seek/duration filter.
                let preferred = sources.iter().enumerate()
                    .filter(|(n, _)| input_times.get(*n).is_none_or(|cut| cut.start.is_none() && cut.end().is_none()))
                    .find_map(|(n, (_, _, source))| (0..source.len()).filter(|&k| source.kind(k) == "audio").nth(*ordinal - 1).map(|k| (n, k, source)));
                if let Some((n, k, preferred)) = preferred {
                    let config = if let Some(pcm) = inputs[n].decoded().and_then(|c| c.audio.get(&k)) {
                        Some((pcm.rate, pcm.channels, pcm.channel_mask, pcm.channel_order.clone(), pcm.format))
                    } else { match preferred {
                        Streams::Wave(w) => Some((w.wav.rate, w.wav.channels, w.wav.channel_mask, Vec::new(), w.wav.format())),
                        Streams::GeneratedAudio(a) => Some((a.rate, a.channels as usize, 0, Vec::new(), Format::Float(32, false))),
                        Streams::Mp4(v) => v[k].0.pcm_format().map(|format| {
                            let order = v[k].0.channel_order();
                            let mask = audio_remix::order_mask(&order);
                            (v[k].0.audio_rate().unwrap_or(v[k].0.scale), usize::from(v[k].0.channels()), mask,
                                if mask == 0 { order } else { Vec::new() }, format)
                        }),
                        _ => None,
                    }};
                    if let Some((rate, channels, channel_mask, channel_order, format)) = config {
                        remaining = remaining.checked_sub(channel_order.capacity() * size_of::<u16>()).ok_or("audio layout exceeds memory budget")?;
                        retained.audio.insert(slot, Pcm { rate, channels, channel_mask, channel_order, format, bytes: Vec::new(), frames: Vec::new() });
                    }
                }
            }
            if t.kind == "audio" {
                let pcm = matches!(source, Streams::Wave(_) | Streams::GeneratedAudio(_))
                    || inner_pcm.is_some() || movie_pcm;
                if (pcm || !samples.is_empty())
                    && decoded.insert(slot, pcm).is_some_and(|v| v != pcm)
                {
                    return Err(
                        "concatMp4 requires all segments in a decoded audio track to be decoded"
                            .into(),
                    );
                }
            }
            let offset = if timed {
                boundary + shift + input_origin
            } else {
                f64::from(t.media_ticks) / f64::from(t.scale)
            };
            // Raw PCM carries no timestamps: every decoded sample is appended.
            let pcm_offset = if timed {
                retained.audio.get(&slot).map_or(0., |p| {
                    p.bytes.len() as f64 / (p.channels as f64 * f64::from(p.format.bits()/8) * f64::from(p.rate))
                })
            } else { offset };
            if let Some(src) = inner_pcm {
                if !retained.audio.contains_key(&slot) {
                    remaining = remaining.checked_sub(src.channel_order.len() * size_of::<u16>()).ok_or("audio layout exceeds memory budget")?;
                }
                let pcm = retained.audio.entry(slot).or_insert_with(|| Pcm {
                    rate: src.rate,
                    channels: src.channels,
                    channel_mask: src.channel_mask,
                    channel_order: src.channel_order.clone(),
                    format: src.format,
                    bytes: Vec::new(), frames: Vec::new(),
                });
                if retained.export_pcm {
                    let wave = src.wave();
                    pcm.append(
                        (pcm_offset, InputTime::default()),
                        (wave.rate, wave.channels, wave.channel_mask, wave.channel_order, wave.format()),
                        (wave.data.len() / wave.stride(), 0),
                        &mut remaining,
                        &mut audio_work,
                        |f, c| wave.format().sample(&wave.data[f * wave.stride() + c * usize::from(wave.bits / 8)..]),
                    )?;
                }
            }
            match source {
                Streams::Wave(w) => {
                    let pcm = retained.audio.entry(slot).or_insert_with(|| Pcm {
                        rate: w.wav.rate,
                        channels: w.wav.channels,
                        channel_mask: w.wav.channel_mask,
                        channel_order: Vec::new(),
                        format: w.wav.format(),
                        bytes: vec![], frames: Vec::new(),
                    });
                    if retained.export_pcm {
                        let cut = input_times.get(j).copied().unwrap_or_default();
                        let before_trim = !timed;
                        let total = w.wav.data.len() / w.wav.stride();
                        let first = total.saturating_sub(w.start as usize);
                        let frames = if before_trim {
                            total.checked_mul(cut.loops).and_then(|n|n.checked_add(first))
                                .ok_or("audio duration exceeds limit")?
                        } else { w.ticks as usize };
                        pcm.append(
                            (pcm_offset, if before_trim { InputTime { duration: cut.end().map(|end| end - cut.start.unwrap_or(0.)), ..InputTime::default() } } else { InputTime::default() }),
                            (w.wav.rate, w.wav.channels, w.wav.channel_mask, w.wav.channel_order, w.wav.format()),
                            (frames, if before_trim && cut.loops > 0 { total } else { 0 }),
                            &mut remaining,
                            &mut audio_work,
                            |i, c| {
                                let frame = if before_trim {
                                    if i < first { w.start as usize + i } else { (i - first) % total }
                                } else { (w.start + i as u64 % w.length) as usize };
                                w.wav.format().sample(&w.wav.data[frame * w.wav.stride() + c * usize::from(w.wav.bits / 8)..])
                            },
                        )?;
                    }
                }
                Streams::GeneratedAudio(a) => {
                    let pcm = retained.audio.entry(slot).or_insert_with(|| Pcm {
                        rate: a.rate,
                        channels: a.channels as usize,
                        channel_mask: 0,
                        channel_order: Vec::new(),
                        format: Format::Float(32, false),
                        bytes: vec![], frames: Vec::new(),
                    });
                    if retained.export_pcm
                        && let Some(ffmpeg_wave::Input::Generated { frequency, .. }) =
                            ffmpeg_wave::Input::parse("lavfi", sources[j].0)?
                    {
                        pcm.append(
                            (pcm_offset, InputTime::default()),
                            (a.rate, a.channels as usize, 0, &[], Format::Float(32, false)),
                            (a.period.map_or(a.decoded_ticks, |period| a.decoded_per_copy * (a.ticks / period)) as usize, 0),
                            &mut remaining,
                            &mut audio_work,
                            |i, _| {
                                let index = a.period.map_or(i as u64, |_| i as u64 % a.decoded_per_copy);
                                let pos = a.origin + index;
                                ((2. * std::f64::consts::PI * frequency * pos as f64
                                    / f64::from(a.rate))
                                .sin()
                                    * 0.5) as f32 as f64
                            },
                        )?;
                    }
                }
                Streams::Mp4(v) if movie_pcm => {
                    let cut = input_times.get(j).copied().unwrap_or_default();
                    let original;
                    let (track, bytes, mut cut) = if (cut.loops > 0 || cut.start.is_some() || cut.end().is_some())
                        && let MediaInput::Bytes(_, bytes) | MediaInput::Joined(bytes, _) = &inputs[j] {
                        // Auto-resampling precedes FFmpeg's input trim filter;
                        // retain the neighboring samples needed by the filter.
                        original = super::super::read_tracks(bytes, super::super::movie(bytes)?)?;
                        (&original.0[i], bytes.as_slice(), cut)
                    } else {
                        (&v[i].0, sources[j].0, InputTime { duration: cut.end().map(|end| end - cut.start.unwrap_or(0.)), ..InputTime::default() })
                    };
                    let size = track.samples(bytes.len()).try_fold(0usize, |n,s| n.checked_add(s.size as usize))
                        .filter(|&n| n <= remaining).ok_or("PCM decoding exceeds memory budget")?;
                    let mut data = Vec::with_capacity(size);
                    let target = track.origin as f64 + cut.start.unwrap_or(0.) * f64::from(track.scale);
                    let mut packet_start = 0;
                    for s in track.samples(bytes.len()) {
                        if track.discarded_pcm_sample(&s) { continue; }
                        if s.description != 1 { return Err("Changing PCM sample descriptions is not supported".into()); }
                        if cut.start.is_some() && s.pts as f64 <= target { packet_start = data.len(); }
                        data.extend_from_slice(&bytes[s.offset..s.offset + s.size as usize]);
                    }
                    let mut wave = ffmpeg_wave::Wave::raw(track.pcm_format().unwrap(), &data,
                        track.audio_rate().ok_or("Invalid PCM sample rate")?, u32::from(track.channels()))?;
                    let order = track.channel_order();
                    wave.channel_mask = audio_remix::order_mask(&order);
                    if wave.channel_mask == 0 { wave.channel_order = &order; }
                    let temporary = data.capacity() + order.capacity() * size_of::<u16>();
                    remaining = remaining.checked_sub(temporary).ok_or("PCM decoding exceeds memory budget")?;
                    if !retained.audio.contains_key(&slot) {
                        remaining = remaining.checked_sub(std::mem::size_of_val(wave.channel_order)).ok_or("audio layout exceeds memory budget")?;
                    }
                    let pcm = retained.audio.entry(slot).or_insert_with(|| Pcm {
                        rate: wave.rate, channels: wave.channels, channel_mask: wave.channel_mask,
                        channel_order: wave.channel_order.to_vec(), format: wave.format(), bytes: Vec::new(), frames: Vec::new(),
                    });
                    let skip = (track.origin as f64 * f64::from(wave.rate) / f64::from(track.scale)).round() as usize;
                    wave.data = &data[skip.saturating_mul(wave.stride()).min(data.len())..];
                    let total = wave.data.len() / wave.stride();
                    let start = (packet_start / wave.stride()).saturating_sub(skip).min(total);
                    let first = total - start;
                    let frames = total.checked_mul(cut.loops).and_then(|n|n.checked_add(first))
                        .ok_or("audio duration exceeds limit")?;
                    let duration = cut.end().map(|end| end - cut.start.unwrap_or(0.));
                    cut.start = cut.start.map(|time| (time - start as f64 / f64::from(wave.rate)).max(0.));
                    cut.to = None;
                    cut.duration = duration;
                    pcm.append((pcm_offset, cut), (wave.rate, wave.channels, wave.channel_mask, wave.channel_order, wave.format()),
                        (frames, if cut.loops > 0 { total } else { 0 }), &mut remaining, &mut audio_work,
                        |f,c| {
                            let frame = if f < first { start + f } else { (f - first) % total };
                            wave.format().sample(&wave.data[frame * wave.stride() + c * usize::from(wave.bits / 8)..])
                        })?;
                    remaining += temporary;
                }
                _ => {}
            }
            if let Some(frames) = retained.video.as_mut()
                && t.kind == "video"
                && !samples.is_empty()
            {
                let inner_frames = inner.and_then(|c| c.video.as_ref()?.get(&i));
                match (source, &inputs[j], inner_frames) {
                    (Streams::Mp4(_), _, Some(seq)) => {
                        let frames = frames.entry(slot).or_default();
                        let base = frames.images.len();
                        let bytes = seq
                            .images
                            .iter()
                            .map(|im| im.pixels.len() * 4 + size_of::<Raster>())
                            .sum::<usize>()
                            + seq.times.len() * size_of::<(f64, f64, usize)>();
                        remaining = remaining
                            .checked_sub(bytes)
                            .ok_or("video frames exceed memory budget")?;
                        frames.images.extend_from_slice(&seq.images);
                        frames
                            .times
                            .extend(seq.times.iter().map(|&(t, d, k)| (offset + t, d, base + k)));
                    }
                    (Streams::Apng(doc,seek), _, _) => {
                        let times:Vec<_>=doc.times(*seek,remaining)?.collect();
                        frames.entry(slot).or_default().append(offset,times.iter().map(|t|(t.1,t.2)),times.len(),
                            |index,_|Ok(doc.frames[times[index].0].image.clone()),&mut remaining)?;
                    }
                    (Streams::Ico(images, _), _, _) => {
                        frames.entry(slot).or_default().append(
                            offset,
                            (0..samples.len()).map(|i| (i as f64 / 25., 0.04)),
                            1,
                            |_, _| Ok(images[i].raster.clone()),
                            &mut remaining,
                        )?;
                    }
                    (Streams::Y4m(clip), _, _) => {
                        frames.entry(slot).or_default().append(
                            offset,
                            clip.times(),
                            clip.frames_per_copy,
                            |i, _| Ok(clip.image(i)),
                            &mut remaining,
                        )?;
                    }
                    (Streams::Still(_), MediaInput::Bytes(_, bytes), _)
                    | (Streams::Mp4(_), MediaInput::Bytes("image2", bytes), _)
                        if !matches!(source, Streams::Mp4(v) if v[0].0.tag == b"avc1") =>
                    {
                        let times = (0..samples.len()).map(|i| (i as f64 / 25., 0.04));
                        frames.entry(slot).or_default().append(
                            offset,
                            times,
                            1,
                            |_, limit| frame_output::decode_still(bytes, limit),
                            &mut remaining,
                        )?;
                    }
                    _ => {}
                }
            }
            let stsd = t.stsd.to_mut();
            let mut map = Vec::new();
            let container = matches!(source, Streams::Mp4(_));
            for (tag, data) in atoms(entries.get(8..).unwrap_or_default()) {
                let mut key = Description::read(tag, data, container && inner_pcm.is_none(), t.kind);
                if retained.auto_convert && let Some(length) = key.avcc.get_mut(4) { *length |= 3; }
                let dict = &mut descriptions[slot];
                let converted = (retained.auto_convert && matches!(tag,b"avc1"|b"avc3"))
                    .then(|| dict.iter().find(|(k,_)| matches!(&k.tag,b"avc1"|b"avc3")).map(|(_,v)| *v)).flatten();
                let index = if let Some(index) = converted.or_else(|| dict.get(&key).copied()) {
                    index
                } else {
                    if stsd.len().saturating_add(8 + data.len()) > limit {
                        return Err("sample index exceeds memory budget".into());
                    }
                    let index = dict.len() as u32 + 1;
                    dict.insert(key, index);
                    stsd[4..8].copy_from_slice(&index.to_be_bytes());
                    atom(stsd, tag, |b| {
                        let pos = b.len();
                        b.extend_from_slice(data);
                        if retained.auto_convert && matches!(tag,b"avc1"|b"avc3") {
                            let mut at = 78;
                            while at + 8 <= data.len() {
                                let len = u32_at(data,at) as usize;
                                if len < 8 || len > data.len() - at { break; }
                                if data.get(at+4..at+8) == Some(b"avcC") && len >= 13 { b[pos+at+12] |= 3; }
                                at += len;
                            }
                        }
                        if !container && t.kind == "video" && data.len() >= 78 {
                            b[pos + 24..pos + 26].copy_from_slice(&(t.width as u16).to_be_bytes());
                            b[pos + 26..pos + 28].copy_from_slice(&(t.height as u16).to_be_bytes());
                        }
                    });
                    index
                };
                map.push(index);
            }
            if t.samples.len().saturating_add(samples.len()) > 200_000 {
                return Err("sample index exceeds memory budget".into());
            }
            let ratio = f64::from(t.scale) / f64::from(from);
            let mut source_dts = 0i64;
            for mut sample in samples {
                let duration = (f64::from(sample.duration) * ratio).round().max(1.) as u32;
                sample.cts = (sample.cts as f64 * ratio + 0.5).floor() as i64;
                sample.description = sample.description.checked_sub(1)
                    .and_then(|i| map.get(i as usize)).copied().unwrap_or(1);
                if timed {
                    let mut dts = (offset * f64::from(t.scale)).round() as i64 + source_dts;
                    if t.kind == "video" {
                        let pts = dts + sample.cts;
                        dts = clocks[slot].dts(dts, pts);
                        sample.cts = pts - dts;
                    }
                    if t.samples.is_empty() {
                        origins[slot] = dts;
                    }
                    let relative = dts - origins[slot];
                    if let Some(last) = t.samples.last_mut() {
                        let last_dts = i64::from(t.media_ticks) - i64::from(last.duration);
                        // Like the MOV muxer, advance overlapping DTS by one tick.
                        let next = relative.max(last_dts + 1);
                        last.duration = u32::try_from(next - last_dts)
                            .map_err(|_| "track duration exceeds limit")?;
                        t.media_ticks = u32::try_from(next).map_err(|_| "track duration exceeds limit")?;
                        if next > relative {
                            sample.cts = (relative + sample.cts).max(next) - next;
                        }
                    }
                    source_dts += i64::from(duration);
                }
                sample.duration = duration;
                if timed {
                    presentation_ends[slot] = presentation_ends[slot]
                        .max(i64::from(t.media_ticks) + sample.cts + i64::from(duration));
                }
                t.media_ticks = t.media_ticks.checked_add(duration)
                    .ok_or("track duration exceeds limit")?;
                t.samples.push(sample);
            }
            if retained.export_pcm && !timed && let Some(pcm) = retained.audio.get(&slot) {
                let frames = pcm.bytes.len() / (pcm.channels * usize::from(pcm.format.bits()/8));
                t.media_ticks = (frames as f64 * f64::from(t.scale) / f64::from(pcm.rate)).round() as u32;
            }
        }
        if let Some(times) = &retained.timings {
            let (cut, declared) = times[j];
            boundary += if let Some((start, end)) = movie_times {
                declared.unwrap_or_else(|| cut.end().unwrap_or(end) - cut.start.unwrap_or(start))
            } else {
                declared.or_else(|| cut.end().map(|end| end - cut.start.unwrap_or(0.)))
                    .unwrap_or_else(|| (0..source.len()).map(|i| source.seconds(i)).fold(0., f64::max))
            };
        }
        if !timed && retained.align_durations && j + 1 < sources.len() {
            let boundary = slots
                .iter()
                .map(|t| f64::from(t.media_ticks) / f64::from(t.scale))
                .fold(0., f64::max);
            for t in &mut slots {
                if let Some(s) = t.samples.last_mut() {
                    let end = (boundary * f64::from(t.scale)).round() as u64;
                    let end = u32::try_from(end).map_err(|_| "track duration exceeds limit")?;
                    s.duration += end.saturating_sub(t.media_ticks);
                    t.media_ticks = t.media_ticks.max(end);
                }
            }
        }
    }
    for (i, t) in slots.iter_mut().enumerate() {
        if retained.export_pcm && !timed
            && let Some(pcm) = retained.audio.get_mut(&i)
        {
            pcm.resize(
                (f64::from(t.media_ticks) / f64::from(t.scale) * f64::from(pcm.rate)).round()
                    as usize,
                &mut remaining,
            )?;
        }
        if timed && !t.samples.is_empty() {
            let first_pts = t.samples[0].cts;
            let end = presentation_ends[i];
            t.media_ticks = u32::try_from((end-first_pts).max(0)).map_err(|_|"track duration exceeds limit")?;
            let pts = origins[i] + first_pts;
            if pts > 0 { t.edits.push([((pts as f64 * f64::from(movie_scale) / f64::from(t.scale)).floor()) as u32,u32::MAX,65536]); }
            let visible = (origins[i] + end - pts.max(0)).max(0);
            t.edits.push([(visible as f64 * f64::from(movie_scale) / f64::from(t.scale)).ceil() as u32,
                if pts >= 0 {first_pts.max(0) as u32} else {(-origins[i]).max(0) as u32},65536]);
            t.movie_ticks = t.edits.iter().map(|r|r[0]).sum();
            continue;
        }
        t.movie_ticks =
            (f64::from(t.media_ticks) * f64::from(movie_scale) / f64::from(t.scale)).round() as u32;
    }
    retained.joined = true;
    Ok(slots)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_growth_and_shrinking_keep_retained_capacity_charged() {
        let mut pcm = Pcm {
            rate: 8000,
            channels: 1,
            channel_order: Vec::new(),
            channel_mask: 4,
            format: Format::Signed(16, false),
            bytes: Vec::new(), frames: Vec::new(),
        };
        let mut remaining = 300;
        for frames in [100, 101, 1, 120] {
            pcm.resize(frames, &mut remaining).unwrap();
            assert_eq!(pcm.bytes.capacity() + remaining, 300);
        }
        let original = pcm.bytes.clone();
        assert!(pcm.resize(151, &mut remaining).is_err());
        assert_eq!(pcm.bytes, original);
    }

    #[test]
    fn resampling_charges_for_the_coefficient_bank_before_processing_samples() {
        let mut pcm = Pcm {
            rate: 48000,
            channels: 1,
            channel_order: Vec::new(),
            channel_mask: 4,
            format: Format::Float(32, false),
            bytes: Vec::new(), frames: Vec::new(),
        };
        assert_eq!(
            pcm.append((0., InputTime::default()), (47999, 1, 4, &[], Format::Float(32, false)), (64, 0), &mut 1048576, &mut 100000, |_, _| 0.),
            Err("audio resampling work limit exceeded".into()),
        );
        assert!(pcm.bytes.is_empty());
    }

    #[test]
    fn downsampling_charges_for_every_frame_mixed_before_resampling() {
        let mut pcm = Pcm {
            rate: 64,
            channels: 2,
            channel_order: Vec::new(),
            channel_mask: 3,
            format: Format::Signed(16, false),
            bytes: Vec::new(), frames: Vec::new(),
        };
        assert_eq!(
            pcm.append((0., InputTime::default()), (8192, 8, 0x63f, &[], Format::Signed(16, false)), (128, 0), &mut 8192, &mut 100, |_, _| 0.),
            Err("audio resampling work limit exceeded".into()),
        );
    }

    #[test]
    fn upsampling_charges_for_each_output_sample() {
        let mut pcm = Pcm {
            rate: 64,
            channels: 8,
            channel_order: Vec::new(),
            channel_mask: 0x63f,
            format: Format::Float(32, false),
            bytes: Vec::new(), frames: Vec::new(),
        };
        assert_eq!(
            pcm.append((0., InputTime::default()), (1, 2, 3, &[], Format::Float(32, false)), (1, 0), &mut 4096, &mut 128, |_, _| 0.),
            Err("audio resampling work limit exceeded".into())
        );
    }
}
