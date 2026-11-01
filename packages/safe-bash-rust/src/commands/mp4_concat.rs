use super::super::{atoms, child, esds, u16_at, u32_at};
use super::{Source, Streams, Track, atom};
use std::collections::{BTreeMap, HashMap};

use super::{Raster, frame_output};

#[derive(Default)]
pub(in super::super::super) struct DecodedConcat {
    pub(in super::super::super) video: Option<BTreeMap<usize, VideoFrames>>,
}
#[derive(Default)]
pub(in super::super::super) struct VideoFrames(Vec<(f64, f64, Raster)>);
impl VideoFrames {
    pub(super) fn visible(&self, start: f64, end: Option<f64>) -> &[(f64, f64, Raster)] {
        let from = self.0.partition_point(|f| f.0 + f.1 <= start);
        let until = end.map_or(self.0.len(), |t| self.0.partition_point(|f| f.0 < t));
        &self.0[from..until.max(from)]
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
    movie_scale: u32,
    limit: usize,
    retained: &mut DecodedConcat,
) -> Result<Vec<Track<'a>>, String> {
    let mut tracks = tracks.into_iter();
    let mut remaining = limit;
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
            if let Some(frames) = retained.video.as_mut() {
                let offset = f64::from(t.media_ticks) / f64::from(t.scale);
                let mut retain = |pts: f64, duration: f64, image: Raster| -> Result<(), String> {
                    remaining = remaining
                        .checked_sub(image.pixels.len() * 4 + size_of::<(f64, f64, Raster)>())
                        .ok_or("video frames exceed memory budget")?;
                    frames
                        .entry(slot)
                        .or_default()
                        .0
                        .push((offset + pts, duration, image));
                    Ok(())
                };
                match source {
                    Streams::Y4m(clip) if !samples.is_empty() => {
                        for (i, (pts, duration)) in clip.times().enumerate() {
                            retain(pts, duration, clip.image(i))?;
                        }
                    }
                    Streams::Still(_) if !samples.is_empty() => {
                        retain(0., 0.04, frame_output::decode_still(sources[j].0, limit)?)?;
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
        if j + 1 < sources.len() {
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
    for t in &mut slots {
        t.movie_ticks =
            (f64::from(t.media_ticks) * f64::from(movie_scale) / f64::from(t.scale)).round() as u32;
    }
    Ok(slots)
}
