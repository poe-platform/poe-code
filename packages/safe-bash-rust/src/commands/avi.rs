use super::super::{atoms, h264};
use super::{Options, Track};

type Result<T> = std::result::Result<T, &'static str>;
struct Riff {
    bytes: Vec<u8>,
    limit: usize,
}
impl Riff {
    fn put(&mut self, data: &[u8]) -> Result<()> {
        if data.len() > self.limit - self.bytes.len() {
            return Err("output byte limit exceeded");
        }
        self.bytes.extend_from_slice(data);
        Ok(())
    }
    fn words(&mut self, values: &[u32]) -> Result<()> {
        for v in values {
            self.put(&v.to_le_bytes())?;
        }
        Ok(())
    }
    fn chunk(&mut self, tag: &[u8; 4], write: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        self.put(tag)?;
        let at = self.bytes.len();
        self.words(&[0])?;
        write(self)?;
        let len =
            u32::try_from(self.bytes.len() - at - 4).map_err(|_| "output byte limit exceeded")?;
        self.bytes[at..at + 4].copy_from_slice(&len.to_le_bytes());
        if len & 1 != 0 {
            self.put(&[0])?;
        }
        Ok(())
    }
    fn list(&mut self, kind: &[u8; 4], write: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        self.chunk(b"LIST", |r| {
            r.put(kind)?;
            write(r)
        })
    }
}
pub(super) fn write(
    tracks: &[Track<'_>],
    seconds: f64,
    audio: &Options,
    originals: &[super::Original],
) -> Result<Vec<u8>> {
    let video = tracks.iter().find(|t| t.kind == "video");
    let sound = tracks.iter().find(|t| t.kind == "audio");
    let source = tracks
        .iter()
        .zip(originals)
        .find(|(t, _)| t.kind == "video")
        .map(|(_, o)| *o)
        .unwrap_or_default();
    let width = source
        .avi()
        .map(|t| t.width)
        .unwrap_or_else(|| video.map_or(320, |t| i64::from(t.width)));
    let (w, h) = (width as u32, video.map_or(240, |t| t.height));
    let pixels = w.wrapping_mul(h).wrapping_mul(3);
    let n = video.map_or(0, |t| t.samples.len() as u32);
    let fps = if n != 0 && seconds > 0. {
        (f64::from(n) / seconds).round().max(1.) as u32
    } else {
        30
    };
    let us = (1_000_000. / f64::from(fps)).round() as u32;
    let mut out = Riff {
        bytes: Vec::new(),
        limit: audio.limit,
    };
    out.chunk(b"RIFF", |r| {
        r.put(b"AVI ")?;
        r.list(b"hdrl", |r| {
            r.chunk(b"avih", |r| {
                r.words(&[
                    us,
                    100000,
                    0,
                    16,
                    n,
                    0,
                    u32::from(video.is_some()) + u32::from(sound.is_some()),
                    pixels,
                    w,
                    h,
                    0,
                    0,
                    0,
                    0,
                ])
            })?;
            if video.is_some() {
                r.list(b"strl", |r| {
                    r.chunk(b"strh", |r| {
                        r.put(b"vidsH264")?;
                        r.words(&[
                            0,
                            0,
                            0,
                            1,
                            fps,
                            0,
                            n,
                            pixels,
                            u32::MAX,
                            0,
                            0,
                            (h << 16) | (w & 65535),
                        ])
                    })?;
                    r.chunk(b"strf", |r| {
                        r.words(&[40, w, h, 0x00180001])?;
                        r.put(b"H264")?;
                        r.words(&[pixels, 0, 0, 0, 0])
                    })
                })?;
            }
            if let Some(t) = sound {
                let (rate, ch) = t.audio_format(44100);
                let (rate, ch) = (audio.rate.unwrap_or(rate), audio.channels.unwrap_or(ch));
                let count = if audio.clear_samples {
                    1
                } else {
                    t.samples.len().max(1) as u32
                };
                r.list(b"strl", |r| {
                    r.chunk(b"strh", |r| {
                        r.put(b"auds")?;
                        r.words(&[0, 0, 0, 0, 1024, rate, 0, count, 4096, u32::MAX, 0, 0, 0])
                    })?;
                    r.chunk(b"strf", |r| {
                        r.words(&[(ch << 16) | 255, rate, 16000, 0x00100004])?;
                        r.put(&[0, 0])
                    })
                })?;
            }
            Ok(())
        })?;
        let movi_start = r.bytes.len() + 8;
        r.list(b"movi", |r| {
            if let Some(t) = video {
                let entry = atoms(t.stsd.get(8..).unwrap_or_default())
                    .next()
                    .map_or(&[][..], |(_, v)| v);
                let config = source.avcc(entry).unwrap_or_default();
                let fallback = h264::configuration(width, h, fps)?;
                let annex = h264::AnnexB::new(config, &fallback);
                for (i, s) in t.samples.iter().enumerate() {
                    r.chunk(b"00dc", |r| {
                        for bytes in annex.parts(&s.data, i == 0 || s.key) {
                            r.put(bytes)?;
                        }
                        Ok(())
                    })?;
                }
            }
            if let Some(t) = sound {
                if audio.clear_samples || t.samples.is_empty() {
                    r.chunk(b"01wb", |r| r.put(super::super::super::adts::silent(2)))?;
                } else {
                    for s in &t.samples {
                        r.chunk(b"01wb", |r| r.put(&s.data))?;
                    }
                }
            }
            Ok(())
        })?;
        let movi_end = r.bytes.len();
        r.chunk(b"idx1", |r| {
            let mut pos = movi_start + 4;
            let mut i = 0;
            while pos < movi_end {
                let id: [u8; 4] = r.bytes[pos..pos + 4].try_into().unwrap();
                let size = u32::from_le_bytes(r.bytes[pos + 4..pos + 8].try_into().unwrap());
                let key = id == *b"01wb" || video.is_some_and(|t| t.samples[i].key);
                r.put(&id)?;
                r.words(&[u32::from(key) << 4, (pos - movi_start) as u32, size])?;
                pos += 8 + size as usize + (size & 1) as usize;
                i += 1;
            }
            Ok(())
        })
    })?;
    Ok(out.bytes)
}

use super::super::super::avi_input::Description;
pub(super) fn as_mp4(bytes: &[u8], limit: usize) -> Result<(Vec<u8>, Vec<Description>)> {
    use super::super::super::{avi_input, media_probe::Codec};
    use super::{
        MATRIX, Sample, VideoCodec, audio_sample_entry, audio_specific_config, video_entry,
    };
    use std::borrow::Cow;

    let mut budget = limit;
    let mut tracks = Vec::new();
    let mut descriptions = Vec::new();
    for t in avi_input::parse(bytes, limit, avi_input::Read::Payloads)?
        .into_iter()
        .flatten()
    {
        budget = budget
            .checked_sub(
                t.info
                    .count
                    .saturating_mul(size_of::<Sample>())
                    .saturating_add(size_of::<Track>()),
            )
            .ok_or("sample index exceeds memory budget")?;
        let mut samples = Vec::with_capacity(t.info.count);
        // A packet replaces only the types of parameter sets it contains.
        let mut sets = [t.extra, t.extra];
        let direct = t.extra.len() >= 7 && t.extra[0] == 1;
        let video = matches!(t.info.codec, Codec::Video { .. });
        for (p, body) in t.packets.iter().zip(t.bodies) {
            let data = if video && h264::annex_b(body) {
                let mut payload = Vec::new();
                for nal in h264::nals(body) {
                    match nal[0] & 31 {
                        kind @ (7 | 8) => {
                            sets[usize::from(kind - 7)] = body;
                            continue;
                        }
                        9 => continue,
                        _ => (),
                    }
                    budget = budget
                        .checked_sub(4 + nal.len())
                        .ok_or("output byte limit exceeded")?;
                    payload.extend_from_slice(&(nal.len() as u32).to_be_bytes());
                    payload.extend_from_slice(nal);
                }
                if payload.is_empty() {
                    Cow::Borrowed(body)
                } else {
                    Cow::Owned(payload)
                }
            } else {
                Cow::Borrowed(&body[body.len() - p.size as usize..])
            };
            samples.push(Sample {
                data,
                duration: p.ticks as u32,
                cts: 0,
                key: p.key,
                description: 1,
            });
        }
        let mut desc = Description {
            duration: t.info.ticks as u64,
            ..Default::default()
        };
        if !video && samples.iter().any(|s| !s.key) {
            desc.audio_keys = samples.iter().map(|s| s.key).collect();
        }
        let (kind, handler, name, width, height, stsd) = match t.info.codec {
            Codec::Video { tag, width, height } => {
                desc.width = width.unwrap_or(320);
                let w = u32::from(desc.width as u16);
                let h = height.unwrap_or(240) as u32;
                let config;
                let avcc = if direct {
                    t.extra
                } else {
                    config = h264::collected_config(sets, desc.width, h, t.fps, &mut budget)?;
                    &config
                };
                let codec = if tag == b"avc1" {
                    VideoCodec::Config(avcc)
                } else {
                    desc.jpeg_avcc = avcc.to_vec();
                    VideoCodec::Still(tag)
                };
                (
                    "video",
                    *b"vide",
                    b"VideoHandler".as_slice(),
                    w,
                    h,
                    video_entry(w as usize, h as usize, codec)?,
                )
            }
            Codec::Audio {
                tag,
                rate,
                channels,
                bits,
                ..
            } => (
                "audio",
                *b"soun",
                b"SoundHandler".as_slice(),
                0,
                0,
                audio_sample_entry(
                    tag,
                    rate,
                    channels,
                    bits,
                    &audio_specific_config(rate, channels, 2),
                ),
            ),
            Codec::Subtitle { .. } => unreachable!(),
        };
        descriptions.push(desc);
        let ticks = t.info.ticks;
        tracks.push(Track {
            id: t.info.id as u32,
            scale: t.info.scale,
            media_ticks: ticks as u32,
            movie_ticks: (ticks / f64::from(t.info.scale) * 1000.).round() as u32,
            samples,
            first_dts: 0,
            fragment_sample_size: None,
            stsd: stsd.into(),
            edits: vec![],
            kind,
            handler,
            name,
            width,
            height,
            volume: if video { 0 } else { 256 },
            enabled: true,
            language: 0x55c4,
            matrix: MATRIX,
        });
    }
    let bytes = super::write(
        &tracks,
        1000,
        b"isom\0\0\x02\0isomiso2avc1mp41",
        &Default::default(),
        &[],
        false,
        limit,
    )?;
    Ok((bytes, descriptions))
}
