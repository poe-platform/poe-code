use super::super::adts::{Frames, Options, RATES};
use super::{
    super::{png_pixels::Raster, y4m},
    h264,
};
use std::borrow::Cow;
use std::collections::BTreeMap;

// Boxes are nested directly in the output. Reserve a size word, then fill it
// once all children have been written; sample offsets are filled at mdat.
fn atom(out: &mut Vec<u8>, kind: &[u8; 4], body: impl FnOnce(&mut Vec<u8>)) {
    let start = out.len();
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(kind);
    body(out);
    let len = (out.len() - start) as u32;
    out[start..start + 4].copy_from_slice(&len.to_be_bytes());
}
fn words(out: &mut Vec<u8>, values: &[u32]) {
    for v in values {
        out.extend_from_slice(&v.to_be_bytes())
    }
}
const MATRIX: [u32; 9] = [65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30];
fn rotation_matrix(angle: i32) -> [u32; 9] {
    let mut matrix = MATRIX;
    let minus = (-65536i32) as u32;
    match angle.rem_euclid(360) {
        85..=95 => {
            matrix[0] = 0;
            matrix[1] = 65536;
            matrix[3] = minus;
            matrix[4] = 0
        }
        175..=185 => {
            matrix[0] = minus;
            matrix[4] = minus
        }
        265..=275 => {
            matrix[0] = 0;
            matrix[1] = minus;
            matrix[3] = 65536;
            matrix[4] = 0
        }
        _ => {}
    }
    matrix
}
fn tags(out: &mut Vec<u8>, metadata: &BTreeMap<String, String>, chapters: &[u8]) {
    let keys = [
        (b"\xa9nam", "title"),
        (b"\xa9ART", "artist"),
        (b"\xa9alb", "album"),
        (b"\xa9day", "date"),
        (b"\xa9cmt", "comment"),
        (b"\xa9gen", "genre"),
        (b"\xa9too", "encoder"),
    ];
    let mut fields = keys
        .iter()
        .filter_map(|&(code, name)| {
            metadata
                .get(name)
                .or_else(|| {
                    if name == "date" {
                        metadata.get("year")
                    } else {
                        None
                    }
                })
                .filter(|v| !v.is_empty())
                .map(|v| (code, v))
        })
        .peekable();
    if fields.peek().is_none() && chapters.is_empty() {
        return;
    }
    atom(out, b"udta", |b| {
        if !chapters.is_empty() {
            atom(b, b"chpl", |b| b.extend_from_slice(chapters));
        }
        if fields.peek().is_none() {
            return;
        }
        atom(b, b"meta", |b| {
            words(b, &[0]);
            atom(b, b"hdlr", |b| {
                words(b, &[0, 0]);
                b.extend_from_slice(b"mdirappl");
                b.extend_from_slice(&[0; 9]);
            });
            atom(b, b"ilst", |b| {
                for (code, value) in fields {
                    atom(b, code, |b| {
                        atom(b, b"data", |b| {
                            words(b, &[1, 0]);
                            b.extend_from_slice(value.as_bytes());
                        })
                    });
                }
            });
        })
    });
}
struct Sample<'a> {
    data: Cow<'a, [u8]>,
    duration: u32,
    cts: i64,
    key: bool,
    description: u32,
}
struct Track<'a> {
    samples: Vec<Sample<'a>>,
    scale: u32,
    media_ticks: u32,
    movie_ticks: u32,
    first_dts: u64,
    stsd: Cow<'a, [u8]>,
    edits: Vec<[u32; 3]>,
    kind: &'static str,
    enabled: bool,
    volume: u32,
    matrix: [u32; 9],
    width: u32,
    height: u32,
    language: u16,
    handler: [u8; 4],
    name: &'a [u8],
}
fn audio_entry(scale: u32, channels: u32, object: u8) -> Vec<u8> {
    let mut out = Vec::new();
    words(&mut out, &[0, 1]);
    atom(&mut out, b"mp4a", |b| {
        words(
            b,
            &[0, 1, 0, 0, (channels << 16) | 16, 0, scale.min(65535) << 16],
        );
        atom(b, b"esds", |b| {
            words(b, &[0]);
            b.extend_from_slice(&[3, 25, 0, 1, 0, 4, 17, 0x40, 0x15, 0, 0, 0]);
            words(b, &[128000, 128000]);
            b.extend_from_slice(&[5, 2]);
            let frequency = RATES
                .iter()
                .enumerate()
                .min_by_key(|(_, r)| r.abs_diff(scale))
                .unwrap()
                .0 as u16;
            let asc =
                (u16::from(object) << 11) | (frequency << 7) | (((channels & 15) as u16) << 3);
            b.extend_from_slice(&asc.to_be_bytes());
            b.extend_from_slice(&[6, 1, 2]);
        });
    });
    out
}
impl Track<'_> {
    fn trak(&self, b: &mut Vec<u8>, id: u32, fragmented: bool, offsets: &mut usize) {
        let samples = if fragmented { &[][..] } else { &self.samples };
        atom(b, b"trak", |b| {
            atom(b, b"tkhd", |b| {
                words(
                    b,
                    &[
                        if self.enabled { 3 } else { 0 },
                        0,
                        0,
                        id,
                        0,
                        self.movie_ticks,
                        0,
                        0,
                        0,
                        self.volume << 16,
                    ],
                );
                words(b, &self.matrix);
                words(b, &[self.width << 16, self.height << 16]);
            });
            if !self.edits.is_empty() {
                atom(b, b"edts", |b| {
                    atom(b, b"elst", |b| {
                        words(b, &[0, self.edits.len() as u32]);
                        for row in &self.edits {
                            words(b, row)
                        }
                    });
                })
            }
            atom(b, b"mdia", |b| {
                atom(b, b"mdhd", |b| {
                    words(
                        b,
                        &[
                            0,
                            0,
                            0,
                            self.scale,
                            if fragmented { 0 } else { self.media_ticks },
                            u32::from(self.language) << 16,
                        ],
                    )
                });
                atom(b, b"hdlr", |b| {
                    words(b, &[0, 0]);
                    b.extend_from_slice(&self.handler);
                    words(b, &[0; 3]);
                    b.extend_from_slice(self.name);
                    b.push(0);
                });
                atom(b, b"minf", |b| {
                    match self.kind {
                        "video" => atom(b, b"vmhd", |b| words(b, &[1, 0, 0])),
                        "audio" => atom(b, b"smhd", |b| words(b, &[0, 0])),
                        _ => atom(b, b"nmhd", |b| words(b, &[0])),
                    };
                    atom(b, b"dinf", |b| {
                        atom(b, b"dref", |b| {
                            words(b, &[0, 1]);
                            atom(b, b"url ", |b| words(b, &[1]));
                        })
                    });
                    atom(b, b"stbl", |b| {
                        atom(b, b"stsd", |b| {
                            b.extend_from_slice(&self.stsd);
                        });
                        atom(b, b"stts", |b| {
                            let at = b.len() + 4;
                            words(b, &[0, 0]);
                            let mut runs = 0;
                            for group in samples.chunk_by(|a, c| a.duration == c.duration) {
                                words(b, &[group.len() as u32, group[0].duration]);
                                runs += 1u32;
                            }
                            b[at..at + 4].copy_from_slice(&runs.to_be_bytes());
                        });
                        if samples.iter().any(|s| s.cts != 0) {
                            atom(b, b"ctts", |b| {
                                let at = b.len() + 4;
                                let mut count = 0u32;
                                let runs = samples.chunk_by(|a, b| a.cts == b.cts);
                                words(b, &[u32::from(samples.iter().any(|s| s.cts < 0)) << 24, 0]);
                                for g in runs {
                                    count += 1;
                                    words(b, &[g.len() as u32, g[0].cts as u32]);
                                }
                                b[at..at + 4].copy_from_slice(&count.to_be_bytes());
                            });
                        }
                        atom(b, b"stsc", |b| {
                            let at = b.len() + 4;
                            let mut count = 0u32;
                            let runs = samples.chunk_by(|a, b| a.description == b.description);
                            words(b, &[0, 0]);
                            let mut chunk = 1;
                            for g in runs {
                                count += 1;
                                words(b, &[chunk, 1, g[0].description]);
                                chunk += g.len() as u32;
                            }
                            b[at..at + 4].copy_from_slice(&count.to_be_bytes());
                        });
                        atom(b, b"stsz", |b| {
                            words(b, &[0, 0, samples.len() as u32]);
                            for s in samples {
                                words(b, &[s.data.len() as u32]);
                            }
                        });
                        atom(b, b"stco", |b| {
                            words(b, &[0, samples.len() as u32]);
                            *offsets = b.len();
                            b.resize(b.len() + samples.len() * 4, 0);
                        });
                        if self.kind == "video" && !samples.is_empty() {
                            atom(b, b"stss", |b| {
                                words(b, &[0, samples.iter().filter(|s| s.key).count() as u32]);
                                for (i, _) in samples.iter().enumerate().filter(|(_, s)| s.key) {
                                    words(b, &[i as u32 + 1]);
                                }
                            });
                        }
                    });
                });
            });
        });
    }
}
fn video_entry(w: usize, h: usize, fps: u32) -> Result<Vec<u8>, &'static str> {
    if w == 0 || h == 0 || w > u16::MAX as usize || h > u16::MAX as usize {
        return Err("invalid AVC sample dimensions");
    }
    let config = h264::configuration(w, h, fps)?;
    let mut stsd = Vec::new();
    words(&mut stsd, &[0, 1]);
    atom(&mut stsd, b"avc1", |b| {
        words(
            b,
            &[
                0,
                1,
                0,
                0,
                0,
                0,
                (w as u32) << 16 | h as u32,
                0x00480000,
                0x00480000,
                0,
            ],
        );
        b.extend_from_slice(&1u16.to_be_bytes());
        b.extend_from_slice(&[0; 32]);
        words(b, &[0x0018ffff]);
        atom(b, b"avcC", |b| b.extend_from_slice(&config));
    });
    Ok(stsd)
}

fn encode_video(
    track: &mut Track<'_>,
    movie_scale: u32,
    times: impl Iterator<Item = (f64, f64)>,
    opts: y4m::Options<'_>,
    image: impl FnMut(usize) -> Result<Raster, &'static str>,
) -> Result<(), &'static str> {
    let limit = opts.limit;
    let mut previous_buffer = None;
    let mut samples = Vec::new();
    let mut previous = Vec::new();
    let mut ticks = 0u64;
    let mut used = 0usize;
    y4m::render_frames(
        track.width as usize,
        track.height as usize,
        times,
        opts,
        image,
        |mut im, duration, buffer| {
            if samples.is_empty() {
                track.width = im.width as u32;
                track.height = im.height as u32;
                track.stsd =
                    video_entry(im.width, im.height, (1. / duration).round().max(1.) as u32)?
                        .into();
            }
            // The MP4 encoder consumes the backing buffer. fps can reuse that
            // buffer, in which case the JS encoder reads zero RGB on the next use.
            if previous_buffer == Some(buffer) {
                im.pixels.fill([0, 0, 0, 255]);
            }
            previous_buffer = Some(buffer);
            let blocks = h264::macroblocks(im, limit)?;
            let data = h264::encode_slice(
                &blocks,
                &previous,
                samples.len(),
                limit.saturating_sub(used),
            )?;
            previous = blocks;
            used = used.saturating_add(data.len() + size_of::<Sample>());
            if used > limit {
                return Err("output byte limit exceeded");
            }
            let duration = (duration * f64::from(track.scale)).round().max(1.) as u32;
            ticks += u64::from(duration);
            samples.push(Sample {
                data: data.into(),
                duration,
                cts: 0,
                key: true,
                description: 1,
            });
            Ok(())
        },
    )?;
    if !samples.is_empty() {
        track.media_ticks = ticks as u32;
        if track.edits.is_empty() {
            track.movie_ticks =
                (ticks as f64 * f64::from(movie_scale) / f64::from(track.scale)).round() as u32;
        }
    }
    track.samples = samples;
    track.first_dts = 0;
    Ok(())
}

fn generated_video(
    video: &super::super::lavfi::Video,
    movie_scale: u32,
    filters: &[String],
    frames: Option<u32>,
    limit: usize,
) -> Result<Track<'static>, String> {
    let (w, h) = (video.width as usize, video.height as usize);
    let count = (video.duration * video.fps).round().max(1.) as usize;
    if count > 200_000 || count > limit / size_of::<Sample>() {
        return Err("frame index exceeds memory budget".into());
    }
    let ticks = (count as f64 / video.fps * 90000.).round() as u64;
    let mut track = Track {
        samples: vec![],
        scale: 90000,
        media_ticks: ticks as u32,
        movie_ticks: (ticks as f64 / 90000. * f64::from(movie_scale)).round() as u32,
        first_dts: 0,
        stsd: video_entry(w, h, video.fps.round().max(1.) as u32)?.into(),
        edits: vec![],
        kind: "video",
        enabled: true,
        volume: 0,
        matrix: MATRIX,
        width: video.width,
        height: video.height,
        language: 0x55c4,
        handler: *b"vide",
        name: b"VideoHandler",
    };
    encode_video(
        &mut track,
        movie_scale,
        (0..count).map(|i| (i as f64 / video.fps, 1. / video.fps)),
        y4m::Options {
            filters,
            frames,
            start: 0.,
            end: None,
            no_video: false,
            limit,
        },
        |i| Ok(video.image(i)),
    )?;
    Ok(track)
}

struct GeneratedAudio {
    rate: u32,
    channels: u32,
    ticks: u64,
    decoded_ticks: u64,
    duration_ticks: u64,
    origin: u64,
}
impl GeneratedAudio {
    fn track(
        &self,
        opts: &Options,
        movie_scale: u32,
        available: usize,
    ) -> Result<Track<'static>, String> {
        let (rate, channels) = (self.rate, self.channels);
        let rate_f = f64::from(rate);
        let start = (opts.start * rate_f).round() as u64;
        let end = opts.end.map_or(self.ticks, |e| (e * rate_f).round() as u64);
        let total = if (opts.start > 0. || opts.end.is_some()) && opts.clear_samples {
            self.decoded_ticks
        } else {
            self.ticks
        };
        let end = end.min(total);
        let ticks = end.saturating_sub(start);
        let start = self.origin.saturating_add(start);
        let end = self.origin.saturating_add(end);
        let first = start / 1024;
        let last = if ticks == 0 {
            first
        } else {
            end.div_ceil(1024)
        };
        if last - first > 200_000 || last - first > (available / size_of::<Sample>()) as u64 {
            return Err("sample index exceeds memory budget".into());
        }
        let payload = super::super::adts::silent(channels);
        let samples = (first..last)
            .map(|i| Sample {
                data: payload.into(),
                duration: (end.min((i * 1024).saturating_add(1024)) - start.max(i * 1024)) as u32,
                cts: 0,
                key: true,
                description: 1,
            })
            .collect();
        Ok(Track {
            samples,
            scale: rate,
            media_ticks: ticks as u32,
            movie_ticks: (ticks as f64 / rate_f * f64::from(movie_scale)).round() as u32,
            first_dts: 0,
            stsd: audio_entry(rate, channels, 2).into(),
            edits: vec![],
            kind: "audio",
            enabled: true,
            volume: 256,
            matrix: MATRIX,
            width: 0,
            height: 0,
            language: 0x55c4,
            handler: *b"soun",
            name: b"SoundHandler",
        })
    }
}

fn adts_track<'a>(
    input: &'a [u8],
    opts: &Options,
    movie_scale: u32,
    index_bytes: &mut usize,
) -> Result<Track<'a>, &'static str> {
    let mut frames = Frames::new(input);
    let available = opts.limit.saturating_sub(*index_bytes) / size_of::<Sample>();
    let mut samples = Vec::new();
    for data in frames.by_ref() {
        if samples.len() >= 200_000 || samples.len() >= available {
            return Err("sample index exceeds memory budget");
        }
        samples.push(Sample {
            data: data.into(),
            duration: 1024,
            cts: 0,
            key: true,
            description: 1,
        });
    }
    let scale = frames.rate;
    let original = samples.len() as u32 * 1024;
    let start = (opts.start * f64::from(scale)).round() as u32;
    let end = opts
        .end
        .map_or(original, |s| (s * f64::from(scale)).round() as u32)
        .min(original);
    let mut base = 0;
    let mut skip = 0;
    samples.retain_mut(|s| {
        let dts = base;
        base += 1024;
        if end <= start || dts >= end || base <= start {
            return false;
        }
        if dts < start {
            skip = start - dts
        }
        s.duration = base.min(end) - dts;
        true
    });
    let media_ticks = samples.iter().map(|s| s.duration).sum();
    let movie_ticks = end.saturating_sub(start);
    *index_bytes += samples.capacity() * size_of::<Sample>();
    let movie_ticks =
        (f64::from(movie_ticks) * f64::from(movie_scale) / f64::from(scale)).round() as u32;
    Ok(Track {
        samples,
        scale,
        media_ticks,
        movie_ticks,
        first_dts: 0,
        stsd: audio_entry(scale, frames.channels.into(), frames.object).into(),
        edits: if skip != 0 {
            vec![[movie_ticks, skip, 65536]]
        } else {
            vec![]
        },
        kind: "audio",
        enabled: true,
        volume: 256,
        matrix: MATRIX,
        width: 0,
        height: 0,
        language: 0x55c4,
        handler: *b"soun",
        name: b"SoundHandler",
    })
}

fn subtitle_track(
    text: &str,
    range: Option<(f64, Option<f64>)>,
    movie_scale: u32,
    index_bytes: &mut usize,
    limit: usize,
) -> Result<Track<'static>, &'static str> {
    let mut samples = Vec::new();
    let (mut ticks, mut skip, mut first_dts) = (0u64, 0, 0);
    for (data, duration, preroll, start) in super::super::subtitles::packets(text, range) {
        *index_bytes = index_bytes
            .saturating_add(size_of::<Sample>())
            .saturating_add(data.len());
        if *index_bytes > limit {
            return Err("sample index exceeds memory budget");
        }
        if samples.is_empty() {
            skip = preroll as u32;
            if range.is_none() {
                first_dts = start.max(0) as u64;
            }
        }
        ticks = ticks.saturating_add(duration as u64);
        samples.push(Sample {
            data: data.into(),
            duration: duration as u32,
            cts: 0,
            key: true,
            description: 1,
        });
    }
    let ticks = ticks as u32;
    let movie_ticks =
        (f64::from(ticks.saturating_sub(skip)) * f64::from(movie_scale) / 1000.).round() as u32;
    let mut stsd = Vec::new();
    words(&mut stsd, &[0, 1]);
    atom(&mut stsd, b"tx3g", |b| {
        words(b, &[0, 1, 0]);
        b.extend_from_slice(&[1, 255, 0, 0, 0, 255]); // justification and background color
        words(b, &[0, 0, 0, 0x00010010, 0xffffffff]); // text box and default style
        atom(b, b"ftab", |b| {
            b.extend_from_slice(b"\0\x01\0\x01\x05Serif")
        });
    });
    Ok(Track {
        samples,
        scale: 1000,
        media_ticks: ticks,
        movie_ticks,
        first_dts,
        stsd: stsd.into(),
        edits: if skip > 0 {
            vec![[movie_ticks, skip, 65536]]
        } else {
            vec![]
        },
        kind: "subtitle",
        enabled: true,
        volume: 0,
        matrix: MATRIX,
        width: 0,
        height: 0,
        language: 0x55c4,
        handler: *b"sbtl",
        name: b"SubtitleHandler",
    })
}

fn write(
    tracks: &[Track<'_>],
    scale: u32,
    ftyp: &[u8],
    metadata: &BTreeMap<String, String>,
    chapters: &[u8],
    fragmented: bool,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    let mut offsets = vec![0; tracks.len()];
    atom(&mut out, b"ftyp", |b| b.extend_from_slice(ftyp));
    atom(&mut out, b"moov", |b| {
        atom(b, b"mvhd", |b| {
            words(
                b,
                &[
                    0,
                    0,
                    0,
                    scale,
                    if fragmented {
                        0
                    } else {
                        tracks.iter().map(|t| t.movie_ticks).max().unwrap_or(0)
                    },
                    65536,
                    0x01000000,
                    0,
                    0,
                ],
            );
            words(b, &MATRIX);
            words(b, &[0; 6]);
            words(b, &[tracks.len() as u32 + 1]);
        });
        for (i, t) in tracks.iter().enumerate() {
            t.trak(b, i as u32 + 1, fragmented, &mut offsets[i]);
        }
        if fragmented {
            atom(b, b"mvex", |b| {
                for (i, a) in tracks.iter().enumerate() {
                    atom(b, b"trex", |b| {
                        let (duration, size) = a
                            .samples
                            .first()
                            .map_or((1024, 0), |s| (s.duration, s.data.len() as u32));
                        words(b, &[0, i as u32 + 1, 1, duration, size, 0]);
                    });
                }
            })
        }
        tags(b, metadata, chapters);
    });
    if fragmented {
        let moof = out.len();
        atom(&mut out, b"moof", |b| {
            atom(b, b"mfhd", |b| words(b, &[0, 1]));
            for (i, a) in tracks.iter().enumerate() {
                atom(b, b"traf", |b| {
                    atom(b, b"tfhd", |b| words(b, &[0x020002, i as u32 + 1, 1]));
                    atom(b, b"tfdt", |b| {
                        words(
                            b,
                            &[0x01000000, (a.first_dts >> 32) as u32, a.first_dts as u32],
                        )
                    });
                    atom(b, b"trun", |b| {
                        words(b, &[0x01000f01, a.samples.len() as u32]);
                        offsets[i] = b.len();
                        words(b, &[0]);
                        for s in &a.samples {
                            words(
                                b,
                                &[
                                    s.duration,
                                    s.data.len() as u32,
                                    if s.key { 0x02000000 } else { 0x01010000 },
                                    s.cts as u32,
                                ],
                            );
                        }
                    });
                })
            }
        });
        let mut offset = (out.len() - moof + 8) as u64;
        for (a, &at) in tracks.iter().zip(&offsets) {
            out[at..at + 4].copy_from_slice(&(offset as u32).to_be_bytes());
            offset += a.samples.iter().map(|s| s.data.len() as u64).sum::<u64>();
        }
    }
    let payload = tracks
        .iter()
        .flat_map(|t| &t.samples)
        .map(|s| s.data.len() as u64)
        .sum::<u64>();
    if payload + out.len() as u64 + 8 > limit.min(u32::MAX as usize) as u64 {
        return Err("output byte limit exceeded");
    }
    atom(&mut out, b"mdat", |b| {
        for (a, mut at) in tracks.iter().zip(offsets) {
            for s in &a.samples {
                if !fragmented {
                    let pos = b.len() as u32;
                    b[at..at + 4].copy_from_slice(&pos.to_be_bytes());
                    at += 4;
                }
                b.extend_from_slice(&s.data);
            }
        }
    });
    Ok(out)
}

pub(in super::super) struct Remux<'a> {
    pub rate: Option<u32>,
    pub channels: Option<u32>,
    pub audio_filters: &'a [&'a str],
    pub video_filters: &'a [String],
    pub maps: &'a [&'a str],
    pub strip_audio: bool,
    pub strip_video: bool,
    pub strip_subtitles: bool,
    pub shortest: bool,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub source_end: Option<f64>,
    pub input_times: &'a [super::super::InputTime],
    pub frames: Option<u32>,
    pub format: &'a str,
    pub fragmented: bool,
    pub metadata: &'a BTreeMap<String, String>,
    pub rotation: Option<i32>,
    pub limit: usize,
}

enum Streams<'a> {
    Mp4(Vec<(super::Track<'a>, &'a [u8])>),
    Captions(Cow<'a, str>),
    GeneratedAudio(GeneratedAudio),
    GeneratedVideo(super::super::lavfi::Video),
    Aac {
        rate: u32,
        channels: u8,
        count: usize,
    },
}
impl Streams<'_> {
    fn len(&self) -> usize {
        match self {
            Self::Mp4(v) => v.len(),
            Self::GeneratedVideo(_)
            | Self::GeneratedAudio(_)
            | Self::Captions(_)
            | Self::Aac { .. } => 1,
        }
    }
    fn kind(&self, i: usize) -> &'static str {
        match self {
            Self::Mp4(v) => v[i].0.kind,
            Self::Captions(_) => "subtitle",
            Self::GeneratedAudio(_) | Self::Aac { .. } => "audio",
            Self::GeneratedVideo(_) => "video",
        }
    }
    fn seconds(&self, i: usize) -> f64 {
        match self {
            Self::Mp4(v) => v[i].0.duration as f64 / f64::from(v[i].0.scale),
            Self::Aac { rate, count, .. } => *count as f64 * 1024. / f64::from(*rate),
            Self::GeneratedVideo(v) => (v.duration * v.fps).round().max(1.) / v.fps,
            Self::GeneratedAudio(a) => a.duration_ticks as f64 / f64::from(a.rate),
            Self::Captions(text) => {
                super::super::subtitles::cues(text)
                    .map(|c| c.start.saturating_add(c.duration))
                    .max()
                    .unwrap_or(0)
                    .max(0) as f64
                    / 1000.
            }
        }
    }
}

pub(in super::super) fn input_slice(
    format: &str,
    input: &[u8],
    start: Option<f64>,
    end: Option<f64>,
    source_end: Option<f64>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    remux(
        &[(format, input)],
        Remux {
            start,
            end,
            source_end,
            input_times: &[],
            limit,
            rate: None,
            channels: None,
            audio_filters: &[],
            video_filters: &[],
            maps: &[],
            strip_audio: false,
            strip_video: false,
            strip_subtitles: false,
            shortest: false,
            frames: None,
            format: "mp4",
            fragmented: false,
            metadata: &BTreeMap::new(),
            rotation: None,
        },
    )
}

pub(in super::super) fn remux(
    inputs: &[(&str, &[u8])],
    opts: Remux<'_>,
) -> Result<Vec<u8>, String> {
    use super::{atoms, child, header_time, rows, u16_at, u32_at, wide};
    let sliced = opts.start.is_some() || opts.end.is_some() || opts.shortest;
    let mut materialized = Vec::new();
    let mut admitted = 0usize;
    for (j, &(format, input)) in inputs.iter().enumerate() {
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        let audio = format == "lavfi"
            && matches!(
                input.split(|&b| b == b'=').next(),
                Some(b"sine" | b"anullsrc")
            );
        let mut bytes = Cow::Borrowed(input);
        if (seek.start.is_some() || seek.end().is_some()) && !audio {
            bytes = Cow::Owned(input_slice(
                format,
                input,
                seek.start,
                seek.end(),
                seek.generation_end(opts.source_end),
                opts.limit.saturating_sub(admitted),
            )?);
        } else if sliced
            && format == "lavfi"
            && let Some(mut video) =
                super::super::lavfi::Video::parse(std::str::from_utf8(input).unwrap_or(""))
        {
            video.duration = opts.source_end.unwrap_or(video.duration);
            let limit = opts.limit.saturating_sub(admitted);
            let track = generated_video(&video, 1000, &[], None, limit)?;
            bytes = Cow::Owned(write(
                &[track],
                1000,
                b"isom\0\0\x02\0isomiso2avc1mp41",
                &BTreeMap::new(),
                &[],
                false,
                limit,
            )?);
        }
        admitted = admitted.saturating_add(bytes.len());
        if admitted > opts.limit {
            return Err("input byte limit exceeded".into());
        }
        materialized.push(bytes);
    }
    let mut sources = Vec::new();
    for (j, (&(format, _), data)) in inputs.iter().zip(&materialized).enumerate() {
        let format = if matches!(data, Cow::Owned(_)) {
            "mp4"
        } else {
            format
        };
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        let input = data.as_ref();
        if format == "lavfi" {
            let spec = std::str::from_utf8(input).map_err(|_| "invalid lavfi source")?;
            if let Some(video) = super::super::lavfi::Video::parse(spec) {
                sources.push((input, &[][..], Streams::GeneratedVideo(video)));
                continue;
            }
            let a = super::super::parse_lavfi_input_doc(spec).ok_or("invalid lavfi source")?;
            let duration = seek.generation_end(opts.source_end).unwrap_or(a.duration);
            let rate = f64::from(a.sample_rate);
            // The synthetic movie's AAC packet table is timed on a 10 fps grid;
            // the decoded channel buffers retain the requested duration.
            let origin = (seek.start.unwrap_or(0.) * rate).round() as u64;
            let end = seek.end().map_or(u64::MAX, |s| (s * rate).round() as u64);
            let clip = |n: f64| ((n.round().max(1024.) as u64).min(end)).saturating_sub(origin);
            let ticks = clip((duration * 10.).round().max(1.) / 10. * rate);
            let decoded_ticks = clip(duration * rate);
            sources.push((
                input,
                &[][..],
                Streams::GeneratedAudio(GeneratedAudio {
                    rate: a.sample_rate,
                    channels: a.channels,
                    ticks,
                    decoded_ticks,
                    origin,
                    duration_ticks: if seek.start.is_some() || seek.end().is_some() {
                        decoded_ticks
                    } else {
                        ticks
                    },
                }),
            ));
            continue;
        }
        if format == "aac" {
            let mut frames = Frames::new(input);
            let count = frames.by_ref().count();
            if count > 200_000 {
                return Err("sample index exceeds memory budget".into());
            }
            sources.push((
                input,
                &[][..],
                Streams::Aac {
                    rate: frames.rate,
                    channels: frames.channels,
                    count,
                },
            ));
            continue;
        }
        if matches!(format, "srt" | "webvtt") {
            sources.push((
                input,
                &[][..],
                Streams::Captions(String::from_utf8_lossy(input)),
            ));
            continue;
        }
        let moov = super::movie(input)?;
        let (tracks, _) = super::read_tracks(input, moov)?;
        let boxes = atoms(moov).filter_map(|(k, v)| (k == b"trak").then_some(v));
        sources.push((
            input,
            moov,
            Streams::Mp4(tracks.into_iter().zip(boxes).collect()),
        ));
    }
    let &(input, moov, ..) = sources.first().ok_or("no MP4 inputs")?;
    let scale = match sources[0].2 {
        Streams::Aac { rate, .. } => rate,
        _ => header_time(child(moov, b"mvhd"), 1000).0,
    };
    let mut selected = Vec::new();
    if opts.maps.is_empty() {
        for (j, (_, _, tracks)) in sources.iter().enumerate() {
            selected.extend((0..tracks.len()).map(|i| (j, i)));
        }
    }
    for map in opts.maps {
        let raw = map.trim_end_matches('?');
        let mut fields = raw.trim_start_matches('-').split(':');
        let Some(j) = fields.next().and_then(|v| v.parse::<usize>().ok()) else {
            continue;
        };
        let Some((_, _, source)) = sources.get(j) else {
            continue;
        };
        let selector = fields.next();
        let kind = match selector {
            Some("v") => Some("video"),
            Some("a") => Some("audio"),
            Some("s") => Some("subtitle"),
            _ => None,
        };
        let ordinal = if kind.is_some() {
            fields.next()
        } else {
            selector
        };
        for (i, index) in (0..source.len())
            .filter(|&i| kind.is_none_or(|k| source.kind(i) == k))
            .enumerate()
        {
            if ordinal.is_some_and(|s| s.parse::<usize>() != Ok(i)) {
                continue;
            }
            if raw.starts_with('-') {
                selected.retain(|&v| v != (j, index))
            } else {
                selected.push((j, index))
            }
        }
        if selected.len() > 32 {
            return Err("output stream count exceeds limit".into());
        }
    }
    selected.retain(|&(j, i)| match sources[j].2.kind(i) {
        "video" => !opts.strip_video,
        "audio" => !opts.strip_audio,
        "subtitle" => !opts.strip_subtitles,
        _ => true,
    });
    if selected.len() > 32 {
        return Err("output stream count exceeds limit".into());
    }
    let shortest = if opts.shortest {
        selected
            .iter()
            .map(|&(j, i)| sources[j].2.seconds(i))
            .reduce(f64::min)
    } else {
        None
    };
    let end = shortest.map(|s| s.min(opts.end.unwrap_or(s))).or(opts.end);
    let range =
        (opts.start.is_some() || end.is_some()).then_some((opts.start.unwrap_or(0.).max(0.), end));
    let mut audio = Options {
        start: opts.start.unwrap_or(0.).max(0.),
        end,
        rate: opts.rate,
        channels: opts.channels,
        clear_samples: opts.rate.is_some()
            || opts.channels.is_some()
            || !opts.audio_filters.is_empty(),
        strip_audio: opts.strip_audio,
        limit: opts.limit,
    };
    if opts.format == "aac" {
        for &(j, i) in &selected {
            let (input, _, streams) = &sources[j];
            match streams {
                Streams::GeneratedAudio(a) => {
                    let t = a.track(&audio, scale, opts.limit)?;
                    return audio
                        .encode(
                            a.rate,
                            a.channels,
                            t.samples.iter().map(|s| s.data.as_ref()),
                        )
                        .map_err(str::to_owned);
                }
                Streams::Mp4(v) if v[i].0.kind == "audio" => {
                    return v[i].0.extract_adts(input, &audio).map_err(str::to_owned);
                }
                Streams::Aac { rate, channels, .. } => {
                    return super::super::adts::remux(input, *rate, *channels, &audio)
                        .map_err(str::to_owned);
                }
                _ => {}
            }
        }
        audio.strip_audio = true;
        return audio
            .encode(44100, 2, std::iter::empty())
            .map_err(str::to_owned);
    }
    if matches!(opts.format, "srt" | "webvtt") {
        let mut writer = super::super::subtitles::Writer::new(opts.format == "webvtt", opts.limit);
        for (j, i) in selected {
            match &sources[j].2 {
                Streams::Mp4(v) if v[i].0.kind == "subtitle" => {
                    let seek = opts.input_times.get(j).copied().unwrap_or_default();
                    v[i].0.write_subtitles(
                        sources[j].0,
                        &mut writer,
                        range,
                        seek.start.is_some() || seek.end().is_some(),
                    )?
                }
                Streams::Captions(text) => {
                    super::super::subtitles::convert(text, &mut writer, range)?
                }
                _ => continue,
            }
            break;
        }
        return Ok(writer.output.into_bytes());
    }
    let mut tracks = Vec::new();
    let mut index_bytes = 0usize;
    for &(j, i) in &selected {
        let (input, _, source) = &sources[j];
        let (t, trak) = match source {
            Streams::GeneratedVideo(v) => {
                let mut track = generated_video(
                    v,
                    scale,
                    opts.video_filters,
                    opts.frames,
                    opts.limit.saturating_sub(index_bytes),
                )?;
                track.matrix = rotation_matrix(opts.rotation.unwrap_or(0));
                index_bytes += track.samples.capacity() * size_of::<Sample>()
                    + track.samples.iter().map(|s| s.data.len()).sum::<usize>();
                tracks.push(track);
                continue;
            }
            Streams::GeneratedAudio(a) => {
                let track = a.track(&audio, scale, opts.limit.saturating_sub(index_bytes))?;
                index_bytes += track.samples.capacity() * size_of::<Sample>();
                tracks.push(track);
                continue;
            }
            Streams::Aac { .. } => {
                tracks.push(adts_track(input, &audio, scale, &mut index_bytes)?);
                continue;
            }
            Streams::Mp4(v) => &v[i],
            Streams::Captions(text) => {
                tracks.push(subtitle_track(
                    text,
                    range,
                    scale,
                    &mut index_bytes,
                    opts.limit,
                )?);
                continue;
            }
        };
        let video = t.kind == "video";
        let audio = t.kind == "audio";
        let tk = child(trak, b"tkhd");
        let long = tk.first() == Some(&1);
        let mdia = child(trak, b"mdia");
        let stbl = child(child(mdia, b"minf"), b"stbl");
        let stsd = child(stbl, b"stsd");
        let hdlr = child(mdia, b"hdlr");
        let handler = hdlr
            .get(8..12)
            .and_then(|s| s.try_into().ok())
            .unwrap_or(*b"vide");
        let name: &[u8] = if !t.handler.is_empty() {
            t.handler
        } else if video {
            b"VideoHandler"
        } else if audio {
            b"SoundHandler"
        } else {
            b"SubtitleHandler"
        };
        let language = t
            .language
            .bytes()
            .fold(0u16, |a, b| (a << 5) | u16::from(b - 96));
        let angle = opts.rotation.filter(|_| video).unwrap_or_else(|| {
            let i = if long { 52 } else { 40 };
            let a = u32_at(tk, i) as i32;
            let b = u32_at(tk, i + 4) as i32;
            (f64::from(b).atan2(f64::from(a)).to_degrees().round() as i32).rem_euclid(360)
        });
        let matrix = rotation_matrix(angle);
        let elst = child(child(trak, b"edts"), b"elst");
        let v1 = elst.first() == Some(&1);
        let mut edits: Vec<_> = rows(elst, if v1 { 20 } else { 12 })
            .map(|r| {
                let segment = wide(r, 0, v1);
                let time = if v1 {
                    wide(r, 8, true) as i64
                } else {
                    i64::from(u32_at(r, 4) as i32)
                };
                let segment = if segment == 0 && !t.runs.is_empty() && time >= 0 {
                    ((t.stats.media_end - i128::from(time)).max(0) as f64 * f64::from(scale)
                        / f64::from(t.scale))
                    .round() as u64
                } else {
                    segment
                };
                [
                    segment as u32,
                    time as u32,
                    u32_at(r, if v1 { 16 } else { 8 }),
                ]
            })
            .collect();
        index_bytes = index_bytes.saturating_add(t.stats.count.saturating_mul(size_of::<Sample>()));
        if index_bytes > opts.limit {
            return Err("sample index exceeds memory budget".into());
        }
        let mut samples = Vec::with_capacity(t.stats.count);
        let mut first_dts = 0;
        let mut begin = 0;
        let sliced = opts.start.is_some() || opts.end.is_some() || shortest.is_some();
        let start = t
            .origin
            .saturating_add((opts.start.unwrap_or(0.) * f64::from(t.scale)).round() as u64);
        let end = t.origin.saturating_add(
            shortest
                .map(|secs| secs.min(opts.end.unwrap_or(secs)))
                .or(opts.end)
                .map_or(t.duration, |s| {
                    ((s * f64::from(t.scale)).round() as u64).min(t.duration)
                }),
        );
        let mut first = 0;
        if sliced {
            let mut key = None;
            first = t
                .samples(input.len())
                .enumerate()
                .find_map(|(i, s)| {
                    if s.key {
                        key = Some(i);
                    }
                    (end > start && s.dts < end && s.dts.saturating_add(u64::from(s.tick)) > start)
                        .then_some(if video { key.unwrap_or(i) } else { i })
                })
                .unwrap_or(t.stats.count);
        }
        for s in t.samples(input.len()).skip(first) {
            if sliced && s.dts >= end {
                break;
            }
            if samples.is_empty() {
                first_dts = if sliced { 0 } else { s.dts };
                begin = s.dts;
            }
            samples.push(Sample {
                data: input[s.offset..s.offset + s.size as usize].into(),
                duration: if sliced {
                    s.tick
                        .min(end.saturating_sub(s.dts).min(u64::from(u32::MAX)) as u32)
                } else {
                    s.tick
                },
                key: s.key,
                cts: (s.pts - i128::from(s.dts)) as i64,
                description: s.description,
            });
        }
        if sliced {
            if video
                && let Some(sample) = samples.first_mut()
                && sample.data.get(4).is_some_and(|v| v & 31 == 1)
            {
                let config = child(t.entry.get(78..).unwrap_or_default(), b"avcC");
                let mut decoder = super::h264::Pcm::new(
                    t.sequence
                        .as_ref()
                        .ok_or("missing H.264 sequence parameters")?,
                    config,
                    opts.limit,
                )?;
                let key = t
                    .samples(input.len())
                    .take(first + 1)
                    .enumerate()
                    .filter(|(_, s)| s.size > 4 && input[s.offset + 4] & 31 == 5)
                    .map(|(i, _)| i)
                    .last()
                    .unwrap_or(0);
                for s in t.samples(input.len()).skip(key).take(first - key + 1) {
                    decoder.decode(&input[s.offset..s.offset + s.size as usize])?;
                }
                decoder.promote(t.width as usize, t.height as usize, opts.limit)?;
                sample.data = decoder.idr(opts.limit)?.into();
                sample.key = true;
            }
            edits.clear();
            if !samples.is_empty() && begin < start {
                edits.push([
                    ((end - start) as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32,
                    (start - begin) as u32,
                    65536,
                ]);
            }
        }
        if video
            && opts.video_filters.is_empty()
            && let Some(n) = opts.frames
        {
            samples.truncate(n.max(1) as usize);
        }
        let mut ticks = samples.iter().map(|s| u64::from(s.duration)).sum::<u64>();
        if !sliced && samples.is_empty() {
            ticks = t.duration
        }
        let movie_ticks = if edits.is_empty() {
            (ticks as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32
        } else {
            edits.iter().map(|r| u64::from(r[0])).sum::<u64>() as u32
        };
        let mut track = Track {
            samples,
            scale: t.scale,
            media_ticks: ticks as u32,
            movie_ticks,
            first_dts,
            stsd: if stsd.len() >= 8 { stsd } else { &[0; 8] }.into(),
            edits,
            kind: t.kind,
            enabled: t.enabled,
            volume: if audio {
                if tk.len() < 24 {
                    256
                } else {
                    u32::from(u16_at(tk, if long { 48 } else { 36 }))
                }
            } else {
                0
            },
            matrix,
            width: if video { t.width } else { 0 },
            height: if video { t.height } else { 0 },
            language,
            handler,
            name,
        };
        if video && !opts.video_filters.is_empty() && !track.samples.is_empty() {
            let config = child(t.entry.get(78..).unwrap_or_default(), b"avcC");
            let mut decoder = h264::Pcm::new(
                t.sequence
                    .as_ref()
                    .ok_or("missing H.264 sequence parameters")?,
                config,
                opts.limit,
            )?;
            let input_samples = std::mem::take(&mut track.samples);
            let times = input_samples.iter().scan(0u64, |dts, s| {
                let at = *dts;
                *dts += u64::from(s.duration);
                Some((
                    (at as f64 + s.cts as f64) / f64::from(t.scale),
                    f64::from(s.duration) / f64::from(t.scale),
                ))
            });
            let limit = opts.limit.saturating_sub(index_bytes);
            let mut replay = 0usize;
            encode_video(
                &mut track,
                scale,
                times,
                y4m::Options {
                    filters: opts.video_filters,
                    frames: opts.frames,
                    start: 0.,
                    end: None,
                    no_video: false,
                    limit,
                },
                |i| {
                    if decoder.next > i + 1 {
                        decoder.next = 0;
                    }
                    while decoder.next <= i {
                        let data = &input_samples[decoder.next].data;
                        replay = replay.saturating_add(data.len());
                        if replay > opts.limit.saturating_mul(32) {
                            return Err("H.264 decode work limit exceeded");
                        }
                        decoder.decode(data)?;
                    }
                    decoder.image((t.width as usize, t.height as usize), true, limit)
                },
            )?;
            index_bytes = index_bytes
                .saturating_sub(input_samples.capacity() * size_of::<Sample>())
                .saturating_add(
                    track.samples.capacity() * size_of::<Sample>()
                        + track.samples.iter().map(|s| s.data.len()).sum::<usize>(),
                );
        }
        tracks.push(track);
    }
    if audio.clear_samples {
        for (track, (j, i)) in tracks.iter_mut().zip(selected) {
            if track.kind != "audio" {
                continue;
            }
            let (rate, channels) = match &sources[j].2 {
                Streams::Mp4(v) => (v[i].0.audio_rate(), u32::from(v[i].0.channels())),
                Streams::Aac { rate, channels, .. } => (*rate, u32::from(*channels)),
                Streams::GeneratedAudio(a) => (a.rate, a.channels),
                Streams::GeneratedVideo(_) | Streams::Captions(_) => continue,
            };
            // Slicing can keep a partial first packet hidden by an edit list.
            let duration = if range.is_none() {
                sources[j].2.seconds(i)
            } else if track.edits.is_empty() {
                f64::from(track.media_ticks) / f64::from(track.scale)
            } else {
                (f64::from(track.movie_ticks) * f64::from(track.scale) / f64::from(scale)).round()
                    / f64::from(track.scale)
            };
            let seconds = if duration == 0. {
                f64::from(rate) / f64::from(track.scale)
            } else {
                duration
            };
            let mut tempo = 1.;
            let mut volume = f64::from(track.volume as i16) / 256.;
            for f in opts
                .audio_filters
                .iter()
                .flat_map(|f| f.split(','))
                .map(str::trim)
            {
                if let Some(s) = f.strip_prefix("atempo=") {
                    tempo *= s
                        .trim()
                        .parse::<f64>()
                        .ok()
                        .filter(|v| *v != 0. && !v.is_nan())
                        .unwrap_or(1.)
                        .clamp(0.25, 4.);
                }
                if let Some(s) = f.strip_prefix("volume=") {
                    let s = s.trim();
                    volume *= if let Some(db) = s.strip_suffix("dB") {
                        10f64.powf(db.parse::<f64>().unwrap_or(0.) / 20.)
                    } else {
                        s.parse::<f64>().ok().filter(|v| *v != 0.).unwrap_or(1.)
                    }
                }
            }
            let rate = opts.rate.unwrap_or(rate);
            let channels = opts.channels.unwrap_or(channels);
            let ticks = (seconds.max(0.05) / tempo * f64::from(rate))
                .round()
                .max(1.) as u64;
            let count = ticks.div_ceil(1024);
            index_bytes =
                index_bytes.saturating_sub(track.samples.capacity() * size_of::<Sample>());
            track.samples = Vec::new();
            if count > 200_000
                || count > (opts.limit.saturating_sub(index_bytes) / size_of::<Sample>()) as u64
            {
                return Err("sample index exceeds memory budget".into());
            }
            let data = super::super::adts::silent(channels);
            track.samples = (0..count)
                .map(|i| Sample {
                    data: data.into(),
                    duration: (ticks - i * 1024).min(1024) as u32,
                    cts: 0,
                    key: true,
                    description: 1,
                })
                .collect();
            index_bytes += track.samples.capacity() * size_of::<Sample>();
            track.scale = rate;
            track.media_ticks = ticks as u32;
            if track.edits.is_empty() {
                track.movie_ticks =
                    (ticks as f64 * f64::from(scale) / f64::from(rate)).round() as u32;
            }
            track.volume = (volume * 256.).round() as i32 as u32;
            track.first_dts = 0;
            track.stsd = audio_entry(rate, channels, 2).into();
        }
    }
    let mut metadata = BTreeMap::new();
    let mut chapters = Vec::new();
    for (j, &(_, movie, ..)) in sources[..if opts.maps.is_empty() {
        sources.len()
    } else {
        1
    }]
        .iter()
        .enumerate()
    {
        if inputs[j].0 == "lavfi" {
            metadata.insert("encoder".into(), "@poe-code/mp4-ast".into());
        }
        metadata.extend(super::text_tags(movie).map(|(k, v)| (k.to_owned(), v)));
        let chpl = child(child(movie, b"udta"), b"chpl");
        if let Some(&n) = chpl.get(8) {
            let (count, mut rest) = if n == 0 {
                (u32_at(chpl, 9), chpl.get(13..).unwrap_or_default())
            } else {
                (u32::from(n), &chpl[9..])
            };
            for _ in 0..count {
                if rest.len() < 9 || chapters.get(8) == Some(&255) {
                    break;
                }
                if chapters.is_empty() {
                    chapters.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0, 0])
                }
                let len = usize::from(rest[8]).min(rest.len() - 9);
                let title = String::from_utf8_lossy(&rest[9..9 + len]);
                let utf8 = title.trim_start_matches('\u{feff}').as_bytes();
                let take = utf8.len().min(255);
                chapters[8] += 1;
                chapters.extend_from_slice(&rest[..8]);
                chapters.push(take as u8);
                chapters.extend_from_slice(&utf8[..take]);
                rest = &rest[9 + len..];
            }
        }
    }
    metadata.extend(opts.metadata.clone());
    if !opts.metadata.contains_key("date")
        && let Some(year) = opts.metadata.get("year")
    {
        metadata.insert("date".into(), year.clone());
    }
    let brands = atoms(input)
        .find(|(k, _)| *k == b"ftyp")
        .or_else(|| atoms(input).find(|(k, _)| *k == b"styp"))
        .map_or(&[][..], |(_, b)| b);
    let mov = opts.format == "mov"
        || brands.get(..4) == Some(b"qt  ")
        || brands
            .get(8..)
            .is_some_and(|b| b.chunks_exact(4).any(|v| v == b"qt  "));
    let mut ftyp = Vec::new();
    ftyp.extend_from_slice(if mov {
        b"qt  "
    } else {
        brands.get(..4).unwrap_or(b"isom")
    });
    words(
        &mut ftyp,
        &[if brands.len() >= 8 {
            u32_at(brands, 4)
        } else {
            512
        }],
    );
    ftyp.extend_from_slice(if mov {
        b"qt  "
    } else if brands.len() >= 12 {
        &brands[8..brands.len() / 4 * 4]
    } else {
        b"isomiso2avc1mp41"
    });
    write(
        &tracks,
        scale,
        &ftyp,
        &metadata,
        &chapters,
        opts.fragmented,
        opts.limit,
    )
    .map_err(str::to_owned)
}
