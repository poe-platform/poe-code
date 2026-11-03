use super::super::{atoms, child, esds, u16_at, u32_at};
use super::{MediaInput, Raster, Source, Streams, Track, atom, ffmpeg_wave, frame_output};
use std::collections::{BTreeMap, HashMap};

pub(in super::super::super) struct DecodedConcat {
    pub(super) video: Option<BTreeMap<usize, VideoFrames>>,
    pub(super) audio: BTreeMap<usize, Pcm>,
    pub(super) joined: bool,
    pub(super) align_durations: bool,
    export_pcm: bool,
}
impl DecodedConcat {
    pub(in super::super::super) fn new(video: bool, export_pcm: bool) -> Self {
        Self {
            video: video.then(BTreeMap::new),
            audio: BTreeMap::new(),
            joined: false,
            align_durations: true,
            export_pcm,
        }
    }
}
pub(super) struct Pcm {
    pub(super) rate: u32,
    pub(super) channels: usize,
    bytes: Vec<u8>,
}
impl Pcm {
    pub(super) fn wave(&self) -> ffmpeg_wave::Wave<'_> {
        ffmpeg_wave::Wave {
            rate: self.rate,
            channels: self.channels,
            bits: 32,
            tag: 3,
            data: &self.bytes,
        }
    }
    fn resize(&mut self, frames: usize, remaining: &mut usize) -> Result<(), String> {
        let len = frames
            .checked_mul(self.channels)
            .and_then(|n| n.checked_mul(4))
            .ok_or("audio output exceeds memory budget")?;
        *remaining = remaining
            .checked_sub(len.saturating_sub(self.bytes.len()))
            .ok_or("audio output exceeds memory budget")?;
        self.bytes.resize(len, 0);
        Ok(())
    }
    fn append(
        &mut self,
        offset: f64,
        (rate, channels): (u32, usize),
        frames: usize,
        remaining: &mut usize,
        work: &mut usize,
        sample: impl Fn(usize, usize) -> f32,
    ) -> Result<(), String> {
        let count = (frames as f64 * f64::from(self.rate) / f64::from(rate)).round() as usize;
        if count == 0 {
            return Ok(());
        }
        // Downmixing reads every source channel for each interpolated sample.
        let per_frame = if self.channels == 1 {
            channels
        } else {
            self.channels
        };
        *work = work
            .checked_sub(count.saturating_mul(per_frame))
            .ok_or("audio resampling work limit exceeded")?;
        let start = (offset * f64::from(self.rate)).round() as usize;
        let end = start
            .checked_add(count)
            .ok_or("audio output exceeds memory budget")?;
        let stride = self.channels * 4;
        if self.bytes.len() / stride < end {
            self.resize(end, remaining)?;
        }
        for (i, frame) in self.bytes[start * stride..end * stride]
            .chunks_exact_mut(stride)
            .enumerate()
        {
            let pos = i as f64 * f64::from(rate) / f64::from(self.rate);
            let left = (pos as usize).min(frames - 1);
            let right = (left + 1).min(frames - 1);
            let blend = pos - left as f64;
            let value = |c| {
                let a = f64::from(sample(left, c));
                if blend == 0. {
                    a
                } else {
                    a + (f64::from(sample(right, c)) - a) * blend
                }
            };
            for (c, out) in frame.chunks_exact_mut(4).enumerate() {
                let v = if self.channels == 1 && channels > 1 {
                    (0..channels).map(value).sum::<f64>() / channels as f64
                } else {
                    value(c % channels)
                };
                out.copy_from_slice(&(v as f32).to_le_bytes());
            }
        }
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

pub(super) fn join<'a>(
    tracks: Vec<Track<'a>>,
    sources: &[Source<'_>],
    inputs: &[MediaInput],
    movie_scale: u32,
    limit: usize,
    retained: &mut DecodedConcat,
) -> Result<Vec<Track<'a>>, String> {
    let mut tracks = tracks.into_iter();
    let mut remaining = limit;
    let mut audio_work = limit.saturating_mul(8);
    let mut slots: Vec<Track<'a>> = Vec::new();
    let mut descriptions = Vec::new();
    let mut decoded = BTreeMap::new();
    for (j, (_, _, source)) in sources.iter().enumerate() {
        let mut ordinals = BTreeMap::new();
        for _ in 0..source.len() {
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
            let mut samples = std::mem::take(&mut clip.samples);
            let entries = std::mem::take(&mut clip.stsd);
            let slot = match slot {
                Some(i) => i,
                None => {
                    if slots.len() >= 32 {
                        return Err("output stream count exceeds limit".into());
                    }
                    if clip.kind == "video" {
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
                    slots.len() - 1
                }
            };
            let t = &mut slots[slot];
            if t.kind == "audio" {
                let pcm = matches!(source, Streams::Wave(_) | Streams::GeneratedAudio(_));
                if (pcm || !samples.is_empty())
                    && decoded.insert(slot, pcm).is_some_and(|v| v != pcm)
                {
                    return Err(
                        "concatMp4 requires all segments in a decoded audio track to be decoded"
                            .into(),
                    );
                }
            }
            let offset = f64::from(t.media_ticks) / f64::from(t.scale);
            match source {
                Streams::Wave(w) => {
                    let pcm = retained.audio.entry(slot).or_insert_with(|| Pcm {
                        rate: w.wav.rate,
                        channels: w.wav.channels,
                        bytes: vec![],
                    });
                    if retained.export_pcm {
                        pcm.append(
                            offset,
                            (w.wav.rate, w.wav.channels),
                            w.ticks as usize,
                            &mut remaining,
                            &mut audio_work,
                            |i, c| w.wav.sample((w.start + i as u64 % w.length) as usize, c),
                        )?;
                    }
                }
                Streams::GeneratedAudio(a) => {
                    let pcm = retained.audio.entry(slot).or_insert_with(|| Pcm {
                        rate: a.rate,
                        channels: a.channels as usize,
                        bytes: vec![],
                    });
                    if retained.export_pcm
                        && let Some(ffmpeg_wave::Input::Generated { frequency, .. }) =
                            ffmpeg_wave::Input::parse("lavfi", sources[j].0)?
                    {
                        pcm.append(
                            offset,
                            (a.rate, a.channels as usize),
                            a.decoded_ticks as usize,
                            &mut remaining,
                            &mut audio_work,
                            |i, _| {
                                let index = a.period.map_or(i as u64, |p| i as u64 % p);
                                if index >= a.decoded_per_copy {
                                    return 0.;
                                }
                                let pos = a.origin + index;
                                ((2. * std::f64::consts::PI * frequency * pos as f64
                                    / f64::from(a.rate))
                                .sin()
                                    * 0.5) as f32
                            },
                        )?;
                    }
                }
                _ => {}
            }
            if let Some(frames) = retained.video.as_mut()
                && t.kind == "video"
                && !samples.is_empty()
            {
                match (source, &inputs[j]) {
                    (Streams::Y4m(clip), _) => {
                        frames.entry(slot).or_default().append(
                            offset,
                            clip.times(),
                            clip.frames_per_copy,
                            |i, _| Ok(clip.image(i)),
                            &mut remaining,
                        )?;
                    }
                    (Streams::Still(_), MediaInput::Bytes(_, bytes))
                    | (Streams::Mp4(_), MediaInput::Bytes("image2", bytes))
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
                let key = Description::read(tag, data, container, t.kind);
                let dict = &mut descriptions[slot];
                let index = if let Some(&index) = dict.get(&key) {
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
            for sample in &mut samples {
                sample.duration = (f64::from(sample.duration) * ratio).round().max(1.) as u32;
                sample.cts = (sample.cts as f64 * ratio + 0.5).floor() as i64;
                sample.description = sample
                    .description
                    .checked_sub(1)
                    .and_then(|i| map.get(i as usize))
                    .copied()
                    .unwrap_or(1);
                t.media_ticks = t
                    .media_ticks
                    .checked_add(sample.duration)
                    .ok_or("track duration exceeds limit")?;
            }
            t.samples.append(&mut samples);
        }
        if retained.align_durations && j + 1 < sources.len() {
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
        if retained.export_pcm
            && let Some(pcm) = retained.audio.get_mut(&i)
        {
            pcm.resize(
                (f64::from(t.media_ticks) / f64::from(t.scale) * f64::from(pcm.rate)).round()
                    as usize,
                &mut remaining,
            )?;
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
    fn upsampling_many_channels_charges_for_each_mixed_sample() {
        let mut pcm = Pcm {
            rate: 64,
            channels: 1,
            bytes: Vec::new(),
        };
        assert_eq!(
            pcm.append(0., (1, 512), 1, &mut 512, &mut 4096, |_, _| 0.),
            Err("audio resampling work limit exceeded".into())
        );
    }
}
