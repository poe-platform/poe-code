use super::super::adts::{Frames, Options, RATES};
use super::{
    super::{
        InputTime, MediaInput, gif::Animation,
        ffmpeg_wave::{self, Wave},
        frame_output::{self, ImageSequence},
        png_pixels::Raster,
        y4m,
    },
    h264,
};
use std::borrow::Cow;
use std::collections::BTreeMap;

// Boxes are nested directly in the output. Reserve a size word, then fill it
// once all children have been written; sample offsets are filled at mdat.
pub(in super::super) fn atom(out: &mut Vec<u8>, kind: &[u8; 4], body: impl FnOnce(&mut Vec<u8>)) {
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
#[derive(Clone)]
struct Sample<'a> {
    data: Cow<'a, [u8]>,
    duration: u32,
    cts: i64,
    key: bool,
    description: u32,
}
struct Track<'a> {
    id: u32,
    samples: Vec<Sample<'a>>,
    scale: u32,
    media_ticks: u32,
    movie_ticks: u32,
    first_dts: u64,
    fragment_sample_size: Option<u32>,
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
    fn trak(&self, b: &mut Vec<u8>, fragmented: bool, offsets: &mut usize) {
        let samples = if fragmented { &[][..] } else { &self.samples };
        atom(b, b"trak", |b| {
            atom(b, b"tkhd", |b| {
                words(
                    b,
                    &[
                        if self.enabled { 3 } else { 0 },
                        0,
                        0,
                        self.id,
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
enum VideoCodec {
    Avc(u32),
    Still(&'static [u8; 4]),
}

fn video_entry(w: usize, h: usize, codec: VideoCodec) -> Result<Vec<u8>, &'static str> {
    if w > u16::MAX as usize || h > u16::MAX as usize {
        return Err("invalid AVC sample dimensions");
    }
    let (tag, config) = match codec {
        VideoCodec::Avc(fps) => (b"avc1", Some(h264::configuration(w, h, fps)?)),
        VideoCodec::Still(tag) => (tag, None),
    };
    let mut stsd = Vec::new();
    words(&mut stsd, &[0, 1]);
    atom(&mut stsd, tag, |b| {
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
        if let Some(config) = config {
            atom(b, b"avcC", |b| b.extend_from_slice(&config));
        }
    });
    Ok(stsd)
}

fn encode_video(
    track: &mut Track<'_>,
    movie_scale: u32,
    times: impl Iterator<Item = (f64, f64)>,
    opts: y4m::Options<'_>,
    mut input_consumed: impl FnMut(usize) -> bool,
    fragmented: bool,
    image: impl FnMut(usize) -> Result<Raster, &'static str>,
) -> Result<(), String> {
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
                track.stsd = video_entry(
                    im.width,
                    im.height,
                    VideoCodec::Avc((1. / duration).round().max(1.) as u32),
                )?
                .into();
            }
            // The MP4 encoder consumes the backing buffer. fps can reuse that
            // buffer, in which case the JS encoder reads zero RGB on the next use.
            if previous_buffer == Some(buffer)
                || matches!(buffer, y4m::Buffer::Input(i) if input_consumed(i))
            {
                im.pixels.fill([0, 0, 0, 255]);
            }
            previous_buffer = Some(buffer);
            im.width = track.width as usize;
            im.height = track.height as usize;
            im.pixels.resize(im.width * im.height, [0; 4]);
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
        // Fragmented headers retain the track duration before encoding. Packet
        // durations in trun describe the filtered frames independently.
        if !fragmented && track.edits.is_empty() {
            track.movie_ticks =
                (ticks as f64 * f64::from(movie_scale) / f64::from(track.scale)).round() as u32;
        }
    }
    track.samples = samples;
    track.first_dts = 0;
    Ok(())
}

fn video_track<'a>(
    w: usize,
    h: usize,
    codec: VideoCodec,
    timescale: u32,
    ticks: u64,
    movie_scale: u32,
) -> Result<Track<'a>, &'static str> {
    Ok(Track {
        id: 1,
        samples: vec![],
        scale: timescale,
        media_ticks: ticks as u32,
        movie_ticks: (ticks as f64 / f64::from(timescale) * f64::from(movie_scale)).round() as u32,
        first_dts: 0,
        fragment_sample_size: None,
        stsd: video_entry(w, h, codec)?.into(),
        edits: vec![],
        kind: "video",
        enabled: true,
        volume: 0,
        matrix: MATRIX,
        width: w as u32,
        height: h as u32,
        language: 0x55c4,
        handler: *b"vide",
        name: b"VideoHandler",
    })
}

fn still_track<'a>(
    input: &'a [u8],
    seek: InputTime,
    range: Option<(f64, Option<f64>)>,
    opts: &Remux<'_>,
    scale: u32,
    repeated: bool,
    limit: usize,
) -> Result<Track<'a>, String> {
    let (w, h, tag) = frame_output::still_info(input, limit)?;
    let (start, end) = (seek.start.unwrap_or(0.).max(0.), seek.end().unwrap_or(0.04));
    let mut visible = start < 0.04 && end > 0.;
    let mut packet = frame_output::still_sample(start, end);
    // A sub-tick input cut can retain pixels after dropping the image packet.
    // A subsequent cut materializes those pixels as AVC before slicing.
    let materialized = visible && !packet && range.is_some();
    if let Some((start, end)) = range {
        let end = end.unwrap_or(0.04);
        visible &= packet && start < 0.04 && end > 0.;
        packet &= frame_output::still_sample(start, end);
    }
    let mut track = video_track(
        w,
        h,
        if materialized {
            VideoCodec::Avc(25)
        } else {
            VideoCodec::Still(tag)
        },
        25,
        u64::from(packet),
        scale,
    )?;
    if packet && opts.video_filters.is_empty() {
        track.samples.push(Sample {
            data: Cow::Borrowed(input),
            duration: 1,
            cts: 0,
            key: true,
            description: 1,
        });
    } else if visible {
        let im = frame_output::decode_still(input, limit)?;
        encode_video(
            &mut track,
            scale,
            std::iter::once((0., 0.04)),
            y4m::Options {
                filters: opts.video_filters,
                frames: opts.frames,
                start: 0.,
                end: None,
                no_video: false,
                limit,
            },
            |_| repeated,
            opts.fragmented,
            |_| Ok(im.clone()),
        )?;
    }
    Ok(track)
}

fn raw_video_track(
    clip: &y4m::Clip<'_>,
    opts: &Remux<'_>,
    range: Option<(f64, Option<f64>)>,
    movie_scale: u32,
    repeated: bool,
    limit: usize,
) -> Result<Track<'static>, String> {
    let scale = 90000.;
    let (start, end) = range.unwrap_or((0., None));
    let origin = clip.origin;
    let from = origin.saturating_add((start * scale).round() as u64);
    let until = if range.is_some() {
        origin.saturating_add(
            (end.unwrap_or(clip.seconds()).min(clip.seconds()) * scale).round() as u64,
        )
    } else {
        clip.media_ticks()
    };
    let mut track = video_track(
        clip.width,
        clip.height,
        VideoCodec::Still(b"raw "),
        90000,
        0,
        movie_scale,
    )?;
    let mut packets = Vec::new();
    let mut dts = 0u64;
    let mut skip = 0;
    let mut ticks = 0u64;
    for (data, duration) in clip.packets() {
        let base = dts;
        dts += u64::from(duration);
        if range.is_some() && (until <= from || base >= until || dts <= from) {
            continue;
        }
        if packets.len() >= limit / size_of::<Sample>() {
            return Err("sample index exceeds memory budget".into());
        }
        if packets.is_empty() {
            skip = from.saturating_sub(base);
        }
        let duration = (dts.min(until) - base) as u32;
        packets.push((data, duration));
        ticks += u64::from(duration);
    }
    track.media_ticks = ticks as u32;
    track.movie_ticks =
        ((ticks.saturating_sub(skip) as f64) / scale * f64::from(movie_scale)).round() as u32;
    if skip > 0 {
        // An existing input edit is still in the original 1000 Hz movie clock.
        if range.is_none() {
            track.movie_ticks = (clip.seconds() * 1000.).round() as u32;
        }
        track.edits.push([track.movie_ticks, skip as u32, 65536]);
    }
    let visible = clip
        .times()
        .filter(|&(pts, dur)| range.is_none() || pts + dur > start && end.is_none_or(|v| pts < v))
        .count();
    if !opts.video_filters.is_empty()
        || opts.frames.is_some_and(|n| visible > n as usize)
        || packets.is_empty() && visible > 0
    {
        // Loop copies refer to the same input pixels. Encoding consumes an
        // input buffer once, even when a temporal filter reorders the copies.
        let mut consumed = vec![repeated; clip.frames_per_copy];
        encode_video(
            &mut track,
            movie_scale,
            clip.times(),
            y4m::Options {
                start,
                end,
                frames: opts.frames,
                filters: opts.video_filters,
                no_video: false,
                limit,
            },
            |i| std::mem::replace(&mut consumed[i % clip.frames_per_copy], true),
            opts.fragmented,
            |i| Ok(clip.image(i)),
        )?;
    } else {
        if let Some(n) = opts.frames {
            packets.truncate(n as usize);
        }
        let cost = clip
            .width
            .saturating_mul(clip.height)
            .saturating_mul(4)
            .saturating_add(size_of::<Sample>());
        if packets.len() > limit / cost {
            return Err("output byte limit exceeded".into());
        }
        if range.is_none() {
            track.fragment_sample_size = clip.packet_size;
        }
        track.samples = packets
            .into_iter()
            .map(|(data, duration)| Sample {
                data: clip.raster(data).pixels.into_flattened().into(),
                duration,
                cts: 0,
                key: true,
                description: 1,
            })
            .collect();
    }
    Ok(track)
}

fn gif_track<'a>(
    input: &'a [u8],
    g: &Animation,
    opts: &Remux<'_>,
    range: Option<(f64, Option<f64>)>,
    scale: u32,
    repeated: bool,
    limit: usize,
) -> Result<Track<'a>, String> {
    let (start, end) = range.unwrap_or((0., None));
    let ts = g.timescale();
    let mult = u64::from(ts / 100);
    let from = g.origin * mult + (start * f64::from(ts)).round() as u64;
    let until = if range.is_some() {
        g.origin * mult
            + (end.unwrap_or(g.seconds()).min(g.seconds()) * f64::from(ts)).round() as u64
    } else {
        g.ticks() * mult
    };
    let mut t = video_track(g.width, g.height, VideoCodec::Still(b"gif "), ts, 0, scale)?;
    let mut base = 0;
    let mut ticks = 0;
    for (k, pts, delay) in g.packets() {
        let pts = pts * mult;
        if range.is_some() && (until <= from || pts >= until) {
            break;
        }
        if k == 0 && pts <= from {
            base = pts;
            t.samples.clear();
            ticks = 0;
        }
        if t.samples.len() >= limit / size_of::<Sample>() {
            return Err("sample index exceeds memory budget".into());
        }
        let offset = if k == 0 { 0 } else { g.frames[k - 1].end };
        let delay = (u64::from(delay) * mult).min(until - pts) as u32;
        ticks += u64::from(delay);
        t.samples.push(Sample {
            data: input[offset..g.frames[k].end].into(),
            duration: delay,
            cts: 0,
            key: k == 0,
            description: 1,
        });
    }
    let skip = from.saturating_sub(base).min(ticks);
    t.media_ticks = u32::try_from(ticks).map_err(|_| "track duration exceeds limit")?;
    t.movie_ticks = ((ticks - skip) as f64 / f64::from(ts) * f64::from(scale)).round() as u32;
    if skip > 0 {
        t.edits.push([t.movie_ticks, skip as u32, 65536]);
    }
    let visible = g
        .times()
        .filter(|&(pts, d)| range.is_none() || pts + d > start && end.is_none_or(|v| pts < v))
        .count();
    if !opts.video_filters.is_empty()
        || opts.frames.is_some_and(|n| visible > n as usize)
        || t.samples.is_empty() && visible > 0
    {
        let mut used = vec![repeated; g.frames.len()];
        encode_video(
            &mut t,
            scale,
            g.times(),
            y4m::Options {
                filters: opts.video_filters,
                frames: opts.frames,
                start,
                end,
                no_video: false,
                limit,
            },
            |i| std::mem::replace(&mut used[g.frame_index(i)], true),
            opts.fragmented,
            |i| Ok(g.image(i)),
        )?;
    }
    Ok(t)
}

fn sequence_track(
    seq: &ImageSequence,
    scale: u32,
    filters: &[String],
    frames: Option<u32>,
    repeated: bool,
    fragmented: bool,
    limit: usize,
) -> Result<Track<'static>, String> {
    let first = &seq.frames[0];
    let mut track = video_track(
        first.width,
        first.height,
        VideoCodec::Avc(seq.fps.round().max(1.) as u32),
        90000,
        (90000. / seq.fps).round().max(1.) as u64,
        scale,
    )?;
    encode_video(
        &mut track,
        scale,
        (0..seq.frames.len()).map(|i| (i as f64 / seq.fps, 1. / seq.fps)),
        y4m::Options {
            filters,
            frames,
            start: 0.,
            end: None,
            no_video: false,
            limit,
        },
        |_| repeated,
        fragmented,
        |i| Ok(seq.frames[i].clone()),
    )?;
    if track.samples.is_empty() {
        return Err("Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer".into());
    }
    Ok(track)
}

fn generated_video(
    video: &super::super::lavfi::Video,
    movie_scale: u32,
    filters: &[String],
    frames: Option<u32>,
    fragmented: bool,
    limit: usize,
) -> Result<Track<'static>, String> {
    let (w, h) = (video.width as usize, video.height as usize);
    let count = (video.duration * video.fps).round().max(1.) as usize;
    if count > 200_000 || count > limit / size_of::<Sample>() {
        return Err("frame index exceeds memory budget".into());
    }
    let ticks = (count as f64 / video.fps * 90000.).round() as u64;
    let mut track = video_track(
        w,
        h,
        VideoCodec::Avc(video.fps.round().max(1.) as u32),
        90000,
        ticks,
        movie_scale,
    )?;
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
        |_| false,
        fragmented,
        |i| Ok(video.image(i)),
    )?;
    Ok(track)
}

struct GeneratedAudio {
    rate: u32,
    channels: u32,
    ticks: u64,
    decoded_ticks: u64,
    decoded_per_copy: u64,
    period: Option<u64>,
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
        let payload = super::super::adts::silent(channels);
        let mut samples = Vec::new();
        let mut at = start;
        while at < end {
            if samples.len() >= (available / size_of::<Sample>()).min(200_000) {
                return Err("sample index exceeds memory budget".into());
            }
            let pos = self.period.map_or(at, |n| at % n);
            let packet = 1024 - (self.origin % 1024 + pos % 1024) % 1024;
            let duration = packet
                .min(end - at)
                .min(self.period.map_or(u64::MAX, |n| n - pos));
            samples.push(Sample {
                data: payload.into(),
                duration: duration as u32,
                cts: 0,
                key: true,
                description: 1,
            });
            at += duration;
        }
        Ok(Track {
            id: 1,
            samples,
            scale: rate,
            media_ticks: ticks as u32,
            movie_ticks: (ticks as f64 / rate_f * f64::from(movie_scale)).round() as u32,
            first_dts: 0,
            fragment_sample_size: None,
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

// A WAV packet carries up to 1024 PCM frames. Trimming changes its duration,
// but the muxer keeps the entire payload, including a partial first or last packet.
struct WaveStream<'a> {
    wav: Wave<'a>,
    start: u64,
    length: u64,
    ticks: u64,
}
impl<'a> WaveStream<'a> {
    fn read(input: &'a [u8], seek: InputTime) -> Result<Self, &'static str> {
        let wav = Wave::read(input)?;
        let frames = (wav.data.len() / wav.stride()) as u64;
        let clock = |s: f64| (s * f64::from(wav.rate)).round() as u64;
        let start = seek.start.map_or(0, clock).min(frames);
        let length = seek
            .end()
            .map_or(frames, clock)
            .min(frames)
            .saturating_sub(start);
        let ticks = length
            .checked_mul((seek.loops as u64).saturating_add(1))
            .filter(|&n| n <= u64::from(u32::MAX))
            .ok_or("audio duration exceeds limit")?;
        Ok(Self {
            wav,
            start,
            length,
            ticks,
        })
    }

    fn track(
        &self,
        opts: &Options,
        movie_scale: u32,
        limit: usize,
    ) -> Result<Track<'a>, &'static str> {
        let w = &self.wav;
        let clock = |s: f64| (s * f64::from(w.rate)).round() as u64;
        let mut tick = clock(opts.start);
        let end = opts.end.map_or(self.ticks, clock).min(self.ticks);
        let media_ticks = end.saturating_sub(tick) as u32;
        let stride = w.stride();
        let data = &w.data[..w.data.len() / stride * stride];
        let mut samples = Vec::new();
        while tick < end {
            if samples.len() >= (limit / size_of::<Sample>()).min(200_000) {
                return Err("sample index exceeds memory budget");
            }
            let pos = tick % self.length;
            let frame = self.start + pos;
            let packet = frame / 1024 * 1024;
            let duration = (packet + 1024 - frame)
                .min(self.length - pos)
                .min(end - tick);
            let from = packet as usize * stride;
            let bytes = &data[from..][..(data.len() - from).min(stride.saturating_mul(1024))];
            samples.push(Sample {
                data: bytes.into(),
                duration: duration as u32,
                cts: 0,
                key: true,
                description: 1,
            });
            tick += duration;
        }
        let stsd = if samples.is_empty() {
            audio_entry(w.rate, w.channels as u32, 2)
        } else {
            let mut entry = Vec::new();
            words(&mut entry, &[0, 1]);
            let [lo, hi] = w.tag.to_le_bytes();
            atom(&mut entry, &[lo, hi, 0, 0], |b| {
                words(
                    b,
                    &[
                        0,
                        1,
                        0,
                        0,
                        ((w.channels as u32) << 16) | u32::from(w.bits),
                        0,
                        w.rate.min(65535) << 16,
                    ],
                )
            });
            entry
        };
        Ok(Track {
            id: 1,
            samples,
            scale: w.rate,
            media_ticks,
            movie_ticks: (f64::from(media_ticks) / f64::from(w.rate) * f64::from(movie_scale))
                .round() as u32,
            first_dts: 0,
            fragment_sample_size: None,
            stsd: stsd.into(),
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
        id: 1,
        samples,
        scale,
        media_ticks,
        movie_ticks,
        first_dts: 0,
        fragment_sample_size: None,
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
        id: 1,
        samples,
        scale: 1000,
        media_ticks: ticks,
        movie_ticks,
        first_dts,
        fragment_sample_size: None,
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

// concatMp4 normalizes video to 90 kHz, drops edit lists, and extends the
// final packet of shorter tracks at each boundary before the next copy starts.
#[path = "mp4_concat.rs"]
mod concat;
pub(in super::super) use concat::DecodedConcat;

fn repeat_tracks(
    tracks: &mut [Track<'_>],
    loops: usize,
    movie_scale: u32,
    limit: usize,
) -> Result<(), &'static str> {
    let copies = loops
        .checked_add(1)
        .ok_or("sample index exceeds memory budget")?;
    let mut remaining = limit;
    let mut clip_ticks = Vec::with_capacity(tracks.len());
    for t in tracks.iter_mut() {
        let cost = t
            .samples
            .iter()
            .map(|s| size_of::<Sample>() + s.data.len())
            .try_fold(0usize, usize::checked_add)
            .and_then(|n| n.checked_mul(copies))
            .ok_or("output byte limit exceeded")?;
        remaining = remaining
            .checked_sub(cost)
            .ok_or("output byte limit exceeded")?;
        if t.samples.len().saturating_mul(copies) > 200_000 {
            return Err("sample index exceeds memory budget");
        }
        let target = if t.kind == "video" { 90000 } else { t.scale };
        let ratio = f64::from(target) / f64::from(t.scale);
        let mut ticks = 0u32;
        for s in &mut t.samples {
            s.duration = (f64::from(s.duration) * ratio).round().max(1.) as u32;
            s.cts = (s.cts as f64 * ratio + 0.5).floor() as i64;
            ticks = ticks
                .checked_add(s.duration)
                .ok_or("track duration exceeds limit")?;
        }
        t.scale = target;
        t.media_ticks = ticks;
        clip_ticks.push(ticks);
        t.first_dts = 0;
        t.edits.clear();
        t.movie_ticks = 0;
        let n = t.samples.len();
        if n != 0 {
            t.samples.reserve_exact(n * loops);
            for _ in 0..loops {
                t.samples.extend_from_within(..n);
            }
        }
    }
    if tracks.iter().all(|t| t.samples.is_empty()) {
        return Ok(());
    }
    for copy in 1..copies {
        let boundary = tracks
            .iter()
            .map(|t| f64::from(t.media_ticks) / f64::from(t.scale))
            .fold(0., f64::max);
        for (t, &clip) in tracks.iter_mut().zip(&clip_ticks) {
            if t.samples.is_empty() {
                continue;
            }
            let end = (boundary * f64::from(t.scale)).round() as u64;
            let padding = end.saturating_sub(u64::from(t.media_ticks));
            t.media_ticks =
                u32::try_from(end + u64::from(clip)).map_err(|_| "track duration exceeds limit")?;
            let last = copy * (t.samples.len() / copies) - 1;
            t.samples[last].duration += padding as u32;
        }
    }
    for t in tracks {
        t.movie_ticks =
            (f64::from(t.media_ticks) / f64::from(t.scale) * f64::from(movie_scale)).round() as u32;
    }
    Ok(())
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
            t.trak(b, fragmented, &mut offsets[i]);
        }
        if fragmented {
            atom(b, b"mvex", |b| {
                for a in tracks {
                    atom(b, b"trex", |b| {
                        let (duration, size) = a
                            .samples
                            .first()
                            .map_or((1024, 0), |s| (s.duration, s.data.len() as u32));
                        words(
                            b,
                            &[
                                0,
                                a.id,
                                1,
                                duration,
                                a.fragment_sample_size.unwrap_or(size),
                                0,
                            ],
                        );
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
                    atom(b, b"tfhd", |b| words(b, &[0x020002, a.id, 1]));
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

#[derive(Clone, Copy)]
pub(in super::super) enum Composition {
    Horizontal,
    Vertical,
    Overlay(usize, usize),
    Fade { duration: f64, offset: Option<f64> },
}

impl Composition {
    pub(in super::super) fn parse(graph: &str) -> Option<Self> {
        if graph.contains("concat=") {
            return None;
        }
        if graph.contains("xfade") {
            let seconds = |key: &str| {
                graph.match_indices(key).find_map(|(i, _)| {
                    let text = &graph[i + key.len()..];
                    let mut dot = false;
                    let len = text
                        .bytes()
                        .take_while(|c| {
                            c.is_ascii_digit() || *c == b'.' && !std::mem::replace(&mut dot, true)
                        })
                        .count();
                    text[..len].parse::<f64>().ok()
                })
            };
            return Some(Self::Fade {
                duration: seconds("duration=").filter(|&s| s != 0.).unwrap_or(0.5),
                offset: seconds("offset="),
            });
        }
        if graph.contains("vstack") {
            return Some(Self::Vertical);
        }
        if graph.contains("hstack") {
            return Some(Self::Horizontal);
        }
        let (_, tail) = graph.split_once("overlay")?;
        let offset = tail
            .strip_prefix('=')
            .and_then(|s| s.split_once(':'))
            .and_then(|(x, y)| {
                let y = &y[..y.bytes().take_while(u8::is_ascii_digit).count()];
                if x.is_empty() || y.is_empty() || !x.bytes().all(|c| c.is_ascii_digit()) {
                    return None;
                }
                Some((
                    x.parse().unwrap_or(usize::MAX),
                    y.parse().unwrap_or(usize::MAX),
                ))
            })
            .unwrap_or_default();
        Some(Self::Overlay(offset.0, offset.1))
    }

    fn combine(
        self,
        a: &mut Raster,
        im: &Raster,
        remaining: &mut usize,
    ) -> Result<(), &'static str> {
        let (w, h, x, y) = match self {
            Self::Fade { .. } => unreachable!(),
            Self::Horizontal => (a.width + im.width, a.height.max(im.height), a.width, 0),
            Self::Vertical => (a.width.max(im.width), a.height + im.height, 0, a.height),
            Self::Overlay(x, y) => {
                let cols = a.width.saturating_sub(x).min(im.width);
                if cols != 0 {
                    for (r, row) in im
                        .pixels
                        .chunks_exact(im.width)
                        .take(a.height.saturating_sub(y))
                        .enumerate()
                    {
                        let start = (y + r) * a.width + x;
                        for (dst, src) in a.pixels[start..start + cols].iter_mut().zip(row) {
                            *dst = [src[0], src[1], src[2], 255];
                        }
                    }
                }
                a.gray = false;
                return Ok(());
            }
        };
        let n = w
            .checked_mul(h)
            .filter(|&n| n <= *remaining / 4)
            .ok_or("video frames exceed memory budget")?;
        let mut pixels = vec![[0; 4]; n];
        for (row, src) in a.pixels.chunks_exact(a.width.max(1)).enumerate() {
            pixels[row * w..row * w + a.width].copy_from_slice(src);
        }
        for (row, src) in im.pixels.chunks_exact(im.width.max(1)).enumerate() {
            let offset = (y + row) * w + x;
            pixels[offset..offset + im.width].copy_from_slice(src);
        }
        *remaining = *remaining + 4 * a.pixels.len() - 4 * n;
        a.pixels = pixels;
        a.width = w;
        a.height = h;
        a.gray = false;
        a.alpha = true;
        Ok(())
    }
}

pub(in super::super) struct Remux<'a> {
    pub composition: Option<Composition>,
    pub concat: Option<&'a mut DecodedConcat>,
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
    Y4m(y4m::Clip<'a>),
    Wave(WaveStream<'a>),
    Mp4(Vec<(super::Track<'a>, &'a [u8])>),
    Captions(Cow<'a, str>),
    GeneratedAudio(GeneratedAudio),
    GeneratedVideo(super::super::lavfi::Video),
    Images(&'a ImageSequence),
    Gif(Animation),
    Still(InputTime),
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
            Self::Y4m(_)
            | Self::Wave(_)
            | Self::Gif(_)
            | Self::Images(_)
            | Self::Still(_)
            | Self::GeneratedVideo(_)
            | Self::GeneratedAudio(_)
            | Self::Captions(_)
            | Self::Aac { .. } => 1,
        }
    }
    fn kind(&self, i: usize) -> &'static str {
        match self {
            Self::Mp4(v) => v[i].0.kind,
            Self::Captions(_) => "subtitle",
            Self::Wave(_) | Self::GeneratedAudio(_) | Self::Aac { .. } => "audio",
            Self::Y4m(_) | Self::Gif(_) | Self::Still(_) | Self::Images(_) | Self::GeneratedVideo(_) => "video",
        }
    }
    fn seconds(&self, i: usize) -> f64 {
        match self {
            Self::Mp4(v) => v[i].0.duration as f64 / f64::from(v[i].0.scale),
            Self::Aac { rate, count, .. } => *count as f64 * 1024. / f64::from(*rate),
            Self::Y4m(v) => v.seconds(),
            Self::Wave(w) => w.ticks as f64 / f64::from(w.wav.rate),
            Self::Images(seq) => seq.template_duration(),
            Self::Gif(g) => g.seconds(),
            Self::Still(seek) => {
                if frame_output::still_sample(seek.start.unwrap_or(0.), seek.end().unwrap_or(0.04))
                {
                    0.04
                } else {
                    0.
                }
            }
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

pub(in super::super) fn select_tracks(
    maps: &[&str],
    sources: usize,
    count: impl Fn(usize) -> usize,
    kind_at: impl Fn(usize, usize) -> &'static str,
) -> Result<Vec<(usize, usize)>, String> {
    let mut selected = Vec::new();
    if maps.is_empty() {
        for j in 0..sources {
            selected.extend((0..count(j)).map(|i| (j, i)));
        }
    }
    for map in maps {
        let raw = map.trim_end_matches('?');
        let mut fields = raw.trim_start_matches('-').split(':');
        let Some(j) = fields.next().and_then(|v| v.parse::<usize>().ok()) else {
            continue;
        };
        if j >= sources {
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
        for (i, index) in (0..count(j))
            .filter(|&i| kind.is_none_or(|k| kind_at(j, i) == k))
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
    Ok(selected)
}

pub(in super::super) fn input_slice(
    input: &MediaInput,
    seek: InputTime,
    source_end: Option<f64>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    remux(
        std::slice::from_ref(input),
        Remux {
            composition: None,
            concat: None,
            start: seek.start,
            end: seek.end(),
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
        seek.loops,
    )
}

fn materialize<'a>(
    inputs: &'a [MediaInput],
    opts: &Remux<'_>,
) -> Result<Vec<Cow<'a, [u8]>>, String> {
    let sliced =
        opts.composition.is_none() && (opts.start.is_some() || opts.end.is_some() || opts.shortest);
    let mut materialized = Vec::new();
    let mut admitted = 0usize;
    for (j, source) in inputs.iter().enumerate() {
        let (format, input) = match source {
            MediaInput::Bytes(f, b) => (*f, b.as_slice()),
            MediaInput::Images(_) => ("image2", &[][..]),
        };
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        let audio = format == "lavfi"
            && matches!(
                input.split(|&b| b == b'=').next(),
                Some(b"sine" | b"anullsrc")
            );
        let mut bytes = Cow::Borrowed(input);
        if (seek.start.is_some()
            || seek.end().is_some()
            || seek.loops > 0 && matches!(format, "mp4" | "mov" | "aac" | "image2" | "lavfi"))
            && !audio
            && !matches!(format, "wav" | "y4m" | "gif")
            && (!matches!(source, MediaInput::Bytes("image2", _)) || seek.loops > 0)
        {
            bytes = Cow::Owned(input_slice(
                source,
                seek,
                seek.generation_end(opts.source_end),
                opts.limit.saturating_sub(admitted),
            )?);
        } else if sliced && let MediaInput::Images(seq) = source {
            let limit = opts.limit.saturating_sub(admitted);
            let track = sequence_track(seq, 1000, &[], None, false, false, limit)?;
            bytes = Cow::Owned(write(
                &[track],
                1000,
                b"isom\0\0\x02\0isomiso2avc1mp41",
                &BTreeMap::new(),
                &[],
                false,
                limit,
            )?);
        } else if sliced
            && format == "lavfi"
            && let Some(mut video) =
                super::super::lavfi::Video::parse(std::str::from_utf8(input).unwrap_or(""))
        {
            video.duration = opts.source_end.unwrap_or(video.duration);
            let limit = opts.limit.saturating_sub(admitted);
            let track = generated_video(&video, 1000, &[], None, false, limit)?;
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
    Ok(materialized)
}

type Source<'a> = (&'a [u8], &'a [u8], Streams<'a>);

fn read_sources<'a>(
    inputs: &'a [MediaInput],
    materialized: &'a [Cow<'_, [u8]>],
    opts: &Remux<'_>,
) -> Result<Vec<Source<'a>>, String> {
    use super::atoms;
    let mut sources = Vec::new();
    let mut remaining=opts.limit;
    for (j, (source, data)) in inputs.iter().zip(materialized).enumerate() {
        let format = if matches!(data, Cow::Owned(_)) {
            "mp4"
        } else {
            match source {
                MediaInput::Bytes(f, _) => *f,
                MediaInput::Images(seq) => {
                    sources.push((&[][..], &[][..], Streams::Images(seq)));
                    continue;
                }
            }
        };
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        let input = data.as_ref();
        if format=="gif" {
            sources.push((input,&[][..],Streams::Gif(Animation::read(input,seek,&mut remaining)?)));
            continue;
        }
        if format == "image2" {
            sources.push((input, &[][..], Streams::Still(seek)));
            continue;
        }
        if format == "lavfi" {
            let spec = std::str::from_utf8(input).map_err(|_| "invalid lavfi source")?;
            if let Some(mut video) = super::super::lavfi::Video::parse(spec) {
                video.duration = seek
                    .generation_end(opts.source_end)
                    .unwrap_or(video.duration);
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
            let decoded_per_copy = decoded_ticks;
            let duration_ticks = if seek.start.is_some() || seek.end().is_some() {
                decoded_ticks
            } else {
                ticks
            };
            // Concatenation repeats the original AAC packet boundaries. A cut
            // with only decoded samples first materializes new 1024-frame packets.
            let (ticks, decoded_ticks, duration_ticks, origin, period) = if seek.loops > 0 {
                let (period, origin) = if ticks == 0 {
                    (decoded_ticks, 0)
                } else {
                    (ticks, origin)
                };
                let total = period
                    .checked_mul((seek.loops as u64).saturating_add(1))
                    .filter(|&n| n <= u64::from(u32::MAX))
                    .ok_or("audio duration exceeds limit")?;
                (total, total, total, origin, (period != 0).then_some(period))
            } else {
                (ticks, decoded_ticks, duration_ticks, origin, None)
            };
            sources.push((
                input,
                &[][..],
                Streams::GeneratedAudio(GeneratedAudio {
                    rate: a.sample_rate,
                    channels: a.channels,
                    ticks,
                    decoded_ticks,
                    decoded_per_copy,
                    origin,
                    duration_ticks,
                    period,
                }),
            ));
            continue;
        }
        if format == "y4m" {
            sources.push((
                input,
                &[][..],
                Streams::Y4m(y4m::Stream::parse(input)?.clip(seek, opts.limit)?),
            ));
            continue;
        }
        if format == "wav" {
            sources.push((
                input,
                &[][..],
                Streams::Wave(WaveStream::read(input, seek)?),
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
        let (mut tracks, _) = super::read_tracks(input, moov)?;
        if seek.start.is_none()
            && seek.end().is_none()
            && let MediaInput::Images(seq) = source
        {
            // Before materialization the PNG sequence inherits the single sample
            // duration of the synthetic movie used as its track template.
            tracks[0].duration =
                (seq.template_duration() * f64::from(tracks[0].scale)).round() as u64;
        }
        let boxes = atoms(moov).filter_map(|(k, v)| (k == b"trak").then_some(v));
        sources.push((
            input,
            moov,
            Streams::Mp4(tracks.into_iter().zip(boxes).collect()),
        ));
    }
    Ok(sources)
}

fn mapped_tracks(
    sources: &[Source<'_>],
    opts: &Remux<'_>,
) -> Result<(Vec<(usize, usize)>, Option<f64>), String> {
    let mut selected = select_tracks(
        opts.maps,
        sources.len(),
        |j| sources[j].2.len(),
        |j, i| sources[j].2.kind(i),
    )?;
    selected.retain(|&(j, i)| match sources[j].2.kind(i) {
        "video" => !opts.strip_video,
        "audio" => !opts.strip_audio,
        "subtitle" => !opts.strip_subtitles,
        _ => true,
    });
    if selected.len() > 32 && opts.concat.is_none() {
        return Err("output stream count exceeds limit".into());
    }
    let shortest = opts
        .shortest
        .then(|| {
            selected
                .iter()
                .map(|&(j, i)| sources[j].2.seconds(i))
                .reduce(f64::min)
        })
        .flatten();
    for &(j, _) in &selected {
        if opts.composition.is_none()
            && let Streams::Y4m(clip) = &sources[j].2
        {
            if let Some(end) = shortest {
                clip.check_slice(0., end)?;
            }
            if opts.start.is_some() || opts.end.is_some() {
                let duration = shortest.unwrap_or(clip.seconds());
                clip.check_slice(
                    opts.start.unwrap_or(0.),
                    opts.end.unwrap_or(duration).min(duration),
                )?;
            }
        }
    }
    Ok((selected, shortest))
}

pub(in super::super) fn render_mapped(
    inputs: &[MediaInput],
    opts: &Remux<'_>,
    frames: Option<u32>,
    full_size: bool,
    emit: impl FnMut(Raster, f64, y4m::Buffer) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let data = materialize(inputs, opts)?;
    let sources = read_sources(inputs, &data, opts)?;
    let composed = opts
        .composition
        .map(|s| compose_frames(s, &sources, inputs, opts))
        .transpose()?;
    let sources = if composed.is_some() {
        &sources[..1]
    } else {
        &sources[..]
    };
    let (selected, shortest) = mapped_tracks(sources, opts)?;
    let Some(&(j, i)) = selected
        .iter()
        .find(|&&(j, i)| sources[j].2.kind(i) == "video")
    else {
        return Ok((64, 64, 10));
    };
    let streams = &sources[j].2;
    let durations = selected.iter().map(|&(j, i)| sources[j].2.seconds(i));
    let duration = shortest
        .or_else(|| durations.reduce(f64::max))
        .unwrap_or(0.);
    let cut = opts.shortest || opts.start.is_some() || opts.end.is_some();
    let options = y4m::Options {
        start: opts.start.unwrap_or(0.).max(0.),
        end: cut.then(|| {
            opts.end
                .unwrap_or(duration)
                .min(duration)
                .min(streams.seconds(i))
        }),
        no_video: false,
        frames,
        filters: opts.video_filters,
        limit: opts.limit,
    };
    if let Some(seq) = opts
        .concat
        .as_deref()
        .and_then(|c| c.video.as_ref()?.get(&i))
        && let Streams::Mp4(tracks) = streams
        && !seq.visible(options.start, options.end).is_empty()
    {
        let (w, h) = (tracks[i].0.width as usize, tracks[i].0.height as usize);
        let show = seq.visible(options.start, options.end);
        let geometry = options.filters.is_empty() && !full_size;
        let limit = options.limit;
        let mut emit = emit;
        y4m::render_frames(
            w,
            h,
            show.iter().map(|f| (f.0, f.1)),
            options,
            |k| Ok(seq.images[show[k].2].clone()),
            |mut im, d, b| {
                if geometry {
                    if w.saturating_mul(h) > limit / 4 {
                        return Err("image exceeds memory budget");
                    }
                    im.width = w;
                    im.height = h;
                    im.pixels.resize(w * h, [0; 4]);
                }
                emit(im, d, b)
            },
        )?;
        return Ok((w, h, 30));
    }
    if let Some(sequence) = composed {
        let (w, h) = sequence.geometry;
        y4m::render_frames(
            w,
            h,
            sequence.times(),
            options,
            |i| Ok(sequence.frames[i].0.clone()),
            emit,
        )?;
        return Ok((w, h, 30));
    }
    let duration = if cut && options.filters.is_empty() && matches!(streams, Streams::Mp4(_)) {
        presentation_duration(sources, &selected, movie_scale(sources), Some((options.start, Some(opts.end.unwrap_or(duration).min(duration)))))
    } else { duration };
    render_source(
        &sources[j],
        i,
        (&inputs[j], opts.input_times[j]),
        Some(duration),
        options,
        full_size,
        emit,
    )
}

fn render_source(
    (input, _, streams): &Source<'_>,
    i: usize,
    (source, seek): (&MediaInput, InputTime),
    duration: Option<f64>,
    options: y4m::Options<'_>,
    full_size: bool,
    emit: impl FnMut(Raster, f64, y4m::Buffer) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let cut = options.start != 0. || options.end.is_some();
    match streams {
        Streams::Y4m(v) => v.render(options, emit),
        Streams::Images(seq) => seq.render(options, emit),
        Streams::Gif(g) => {
            y4m::render_frames(g.width,g.height,g.times(),options,|i| Ok(g.image(i)),emit)?;
            Ok((g.width,g.height,30))
        }
        Streams::Still(seek) => {
            frame_output::render_still(input, options, *seek, cut, emit)
        }
        Streams::GeneratedVideo(v) => v.render(options, false, emit),
        Streams::Mp4(tracks) => {
            if let MediaInput::Bytes("image2", bytes) = source
                && tracks[i].0.tag != b"avc1"
            {
                return frame_output::render_still(bytes, options, seek, cut, emit);
            }
            super::render_track(input, &tracks[i].0, duration, options, full_size, emit)
        }
        _ => unreachable!(),
    }
}

struct ComposedFrames {
    frames: Vec<(Raster, f64)>,
    geometry: (usize, usize),
}

impl ComposedFrames {
    fn times(&self) -> impl Iterator<Item = (f64, f64)> {
        self.frames.iter().scan(0., |at, (_, duration)| {
            let pts = *at;
            *at += duration;
            Some((pts, *duration))
        })
    }
    fn encode(
        &self,
        track: &mut Track<'_>,
        scale: u32,
        opts: &Remux<'_>,
        consumed: bool,
        preparing_cut: bool,
        used: &mut usize,
    ) -> Result<(), String> {
        (track.width, track.height) = (self.geometry.0 as u32, self.geometry.1 as u32);
        let limit = opts.limit.saturating_sub(*used);
        // A cut sees the original track duration even if the graph added frames.
        let hz = f64::from(track.scale);
        let origin = track
            .edits
            .first()
            .map_or(0, |r| (r[1] as i32).max(0) as u64);
        let mut remaining = u64::from(track.media_ticks) + origin;
        let times = self.times().map_while(|(pts, duration)| {
            if !preparing_cut {
                return Some((pts, duration));
            }
            let ticks = (duration * hz).round().max(1.) as u64;
            let take = remaining.min(ticks);
            remaining -= take;
            (take != 0).then_some((
                pts,
                if take == ticks {
                    duration
                } else {
                    take as f64 / hz
                },
            ))
        });
        encode_video(
            track,
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
            |_| consumed,
            opts.fragmented,
            |i| Ok(self.frames[i].0.clone()),
        )?;
        *used += track.samples.len() * size_of::<Sample>()
            + track.samples.iter().map(|s| s.data.len()).sum::<usize>();
        Ok(())
    }
}

fn crossfade(
    frames: &mut Vec<(Raster, f64)>,
    next: Vec<(Raster, f64)>,
    duration: f64,
    offset: Option<f64>,
) -> Result<(), String> {
    if frames.is_empty() || next.is_empty() {
        return Err("Cannot read properties of undefined (reading 'data')".into());
    }
    let tick = frames[0].1;
    let fps = if tick > 0. { (1. / tick).round() } else { 25. };
    let overlap = ((duration * fps).round() as usize)
        .min(frames.len())
        .min(next.len())
        .max(1);
    let before = frames.len() - overlap;
    let before = offset.map_or(before, |s| before.min((s * fps).round() as usize));
    frames.truncate(before + overlap);
    for (k, (b, tick)) in next.into_iter().enumerate() {
        if k >= overlap {
            frames.push((b, tick));
            continue;
        }
        let a = &mut frames[before + k].0;
        let alpha = (k + 1) as f64 / (overlap + 1) as f64;
        for (i, p) in a.pixels.iter_mut().enumerate() {
            if let Some(other) = b.pixels.get(i) {
                for c in 0..3 {
                    p[c] = (f64::from(p[c]) * (1. - alpha) + f64::from(other[c]) * alpha).round()
                        as u8;
                }
            } else {
                p[..3].fill(0);
            }
            p[3] = 255;
        }
        a.gray = false;
    }
    Ok(())
}

fn compose_frames(
    composition: Composition,
    sources: &[Source<'_>],
    inputs: &[MediaInput],
    opts: &Remux<'_>,
) -> Result<ComposedFrames, String> {
    let mut frames = Vec::new();
    let mut next = Vec::new();
    let mut remaining = opts.limit;
    let mut geometry = (64, 64);
    for (j, source) in sources.iter().take(2).enumerate() {
        let streams = &source.2;
        let i = (0..streams.len())
            .find(|&i| streams.kind(i) == "video")
            .ok_or("Cannot read properties of undefined (reading 'decodedVideoFrames')")?;
        let mut index = 0;
        let mut last = None;
        let options = y4m::Options {
            start: 0.,
            end: None,
            filters: &[],
            frames: None,
            no_video: false,
            limit: remaining,
        };
        let (w, h, _) = render_source(
            source,
            i,
            (&inputs[j], opts.input_times[j]),
            None,
            options,
            true,
            |im, tick, _| {
                if j == 0 || matches!(composition, Composition::Fade { .. }) {
                    remaining = remaining
                        .checked_sub(im.pixels.len() * 4 + size_of::<(Raster, f64)>())
                        .ok_or("video frames exceed memory budget")?;
                    if j == 0 {
                        frames.push((im, tick));
                    } else {
                        next.push((im, tick));
                    }
                } else if let Some((a, _)) = frames.get_mut(index) {
                    composition.combine(a, &im, &mut remaining)?;
                    if matches!(composition, Composition::Overlay(..)) {
                        last = Some(im);
                    }
                }
                index += 1;
                Ok(())
            },
        )?;
        if j == 0 {
            geometry = (w, h);
        } else if let Composition::Fade { duration, offset } = composition {
            crossfade(&mut frames, std::mem::take(&mut next), duration, offset)?;
        } else if matches!(composition, Composition::Overlay(..)) {
            if let Some(im) = last {
                for (a, _) in frames.iter_mut().skip(index) {
                    composition.combine(a, &im, &mut remaining)?;
                }
            }
        } else {
            frames.truncate(index);
        }
    }
    if let Some((im, _)) = frames.first() {
        geometry = (im.width, im.height);
    }
    Ok(ComposedFrames { frames, geometry })
}

fn cut_packets<'a>(
    t: &'a super::Track<'_>,
    input_len: usize,
    range: Option<(f64, Option<f64>)>,
) -> (usize, u64, u64, impl Iterator<Item = super::Sample> + 'a) {
    let (mut first, mut start, mut end) = (0, 0, u64::MAX);
    if let Some((from, to)) = range {
        let scale = f64::from(t.scale);
        start = t.origin.saturating_add((from * scale).round() as u64);
        end = t.origin.saturating_add(
            to.map_or(t.duration, |s| ((s * scale).round() as u64).min(t.duration)),
        );
        let mut key = None;
        first = t
            .samples(input_len)
            .enumerate()
            .find_map(|(i, s)| {
                if s.key {
                    key = Some(i);
                }
                (end > start && s.dts < end && s.dts.saturating_add(u64::from(s.tick)) > start)
                    .then_some(if t.kind == "video" {
                        key.unwrap_or(i)
                    } else {
                        i
                    })
            })
            .unwrap_or(t.stats.count);
    }
    (
        first,
        start,
        end,
        t.samples(input_len)
            .skip(first)
            .take_while(move |s| s.dts < end)
            .map(move |mut s| {
                s.tick = u64::from(s.tick).min(end - s.dts) as u32;
                s
            }),
    )
}

fn movie_scale(sources: &[Source<'_>]) -> u32 {
    match sources[0].2 {
        Streams::Wave(ref w) => w.wav.rate,
        Streams::Aac { rate, .. } => rate,
        Streams::Gif(_) => 100,
        Streams::Still(_) => 25,
        _ => super::header_time(super::child(sources[0].1, b"mvhd"), 1000).0,
    }
}

pub(super) fn cut_duration(t: &super::Track<'_>, input_len: usize, scale: u32, range: (f64, Option<f64>)) -> f64 {
    let (_, start, end, mut packets) = cut_packets(t, input_len, Some(range));
    let Some(first) = packets.next() else { return 0.; };
    let ticks = u64::from(first.tick) + packets.map(|s| u64::from(s.tick)).sum::<u64>();
    if first.dts >= start {
        return ticks as f64 / f64::from(t.scale);
    }
    let visible = end.min(first.dts.saturating_add(ticks)).saturating_sub(start);
    let segment = (visible as f64 * f64::from(scale) / f64::from(t.scale)).round();
    (segment * f64::from(t.scale) / f64::from(scale)).round() / f64::from(t.scale)
}

fn presentation_duration(sources: &[Source<'_>], selected: &[(usize, usize)], scale: u32, range: Option<(f64, Option<f64>)>) -> f64 {
    selected.iter().map(|&(j, i)| {
        let (bytes, _, stream) = &sources[j];
        let seconds = stream.seconds(i);
        match (range, stream) {
            (None, _) => seconds,
            (Some(range), Streams::Mp4(tracks)) => cut_duration(&tracks[i].0, bytes.len(), scale, range),
            (Some((from, to)), _) => (to.unwrap_or(seconds).min(seconds) - from).max(0.),
        }
    }).fold(0., f64::max)
}

pub(in super::super) fn remux(
    inputs: &[MediaInput],
    mut opts: Remux<'_>,
    loops: usize,
) -> Result<Vec<u8>, String> {
    use super::{atoms, child, rows, u16_at, u32_at, wide};
    if opts.concat.is_some() && inputs.len() > 128 {
        return Err(format!(
            "Resource limit exceeded for maxConcatInputs: {} exceeds maximum allowed 128",
            inputs.len()
        ));
    }
    let data = materialize(inputs, &opts)?;
    let sources = read_sources(inputs, &data, &opts)?;
    let &(input, ..) = sources.first().ok_or("no MP4 inputs")?;
    let scale = movie_scale(&sources);
    let composed = opts
        .composition
        .map(|s| compose_frames(s, &sources, inputs, &opts))
        .transpose()?;
    let sources = if composed.is_some() {
        &sources[..1]
    } else {
        &sources[..]
    };
    let preparing_cut = composed.is_some() && (opts.start.is_some() || opts.end.is_some());
    if preparing_cut {
        opts.start = None;
        opts.end = None;
    }
    let (selected, shortest) = mapped_tracks(sources, &opts)?;
    if opts.format == "null" {
        return Ok(Vec::new());
    }
    if opts.format == "ffmetadata" {
        return super::ffmetadata(
            &inputs[..sources.len()],
            !opts.maps.is_empty(),
            opts.metadata,
            opts.limit,
        );
    }
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
    if opts.format == "wav" {
        let seconds = presentation_duration(sources, &selected, scale, range);
        let mut rate = 44100;
        let mut channels = 2;
        opts.end = end;
        opts.maps = &[]; // mapped_tracks has already resolved selectors across all inputs.
        if let Some(&(j, i)) = selected
            .iter()
            .find(|&&(j, i)| sources[j].2.kind(i) == "audio")
        {
            if let Some(pcm) = opts.concat.as_deref().and_then(|c| c.audio.get(&i)) {
                return ffmpeg_wave::Input::Wave(pcm.wave()).render(InputTime::default(), &opts);
            }
            let (bytes, _, stream) = &sources[j];
            let seek = opts.input_times.get(j).copied().unwrap_or_default();
            let volume;
            (rate, channels, volume) = match stream {
                Streams::Wave(w) => return ffmpeg_wave::Input::Wave(w.wav).render(seek, &opts),
                Streams::GeneratedAudio(_) => {
                    return ffmpeg_wave::Input::parse("lavfi", bytes)?
                        .ok_or("invalid audio generator")?
                        .render(seek, &opts);
                }
                Streams::Aac { rate, channels, .. } => (*rate, usize::from(*channels), 1.),
                Streams::Mp4(t) => {
                    let (track, trak) = &t[i];
                    let tk = child(trak, b"tkhd");
                    (
                        track.audio_rate().unwrap_or(track.scale),
                        usize::from(track.channels()),
                        f64::from(u16_at(tk, if tk.first() == Some(&1) { 48 } else { 36 }) as i16)
                            / 256.,
                    )
                }
                _ => unreachable!(),
            };
            if audio.clear_samples {
                let input = ffmpeg_wave::Input::Encoded {
                    rate,
                    channels,
                    seconds: stream.seconds(i),
                    volume,
                };
                return input.render(InputTime::default(), &opts);
            }
        }
        // Without decoded audio the WAV serializer fills the movie duration with silence.
        let seconds =
            if let (Some(Composition::Fade { .. }), Some(seq)) = (opts.composition, &composed) {
                seq.frames.iter().map(|(_, d)| d).sum()
            } else {
                seconds
            };
        let seconds = if opts.concat.is_some() && range.is_none() {
            (0..sources[0].2.len())
                .map(|i| sources[0].2.seconds(i))
                .fold(0., f64::max)
        } else {
            seconds
        };
        let duration = if seconds == 0. { 1. } else { seconds };
        let frames = (duration * f64::from(rate)).round().max(1024.) as usize;
        return ffmpeg_wave::pcm16(rate, channels, frames, opts.limit);
    }
    if opts.format == "aac" {
        for &(j, i) in &selected {
            let (input, _, streams) = &sources[j];
            match streams {
                Streams::Wave(w) => {
                    let t = w.track(&audio, scale, opts.limit)?;
                    return audio
                        .encode(
                            w.wav.rate,
                            w.wav.channels as u32,
                            t.samples.iter().map(|s| s.data.as_ref()),
                        )
                        .map_err(str::to_owned);
                }
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
                    if let Some(pcm) = opts.concat.as_deref().and_then(|c| c.audio.get(&i)) {
                        audio.rate.get_or_insert(pcm.rate);
                        audio.channels.get_or_insert(pcm.channels as u32);
                    }
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
                    v[i].0.write_subtitles(
                        sources[j].0,
                        &mut writer,
                        range,
                        matches!(data[j], Cow::Owned(_)) || opts.concat.as_deref().is_some_and(|c| c.joined),
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
    let temporal = opts
        .video_filters
        .iter()
        .flat_map(|f| f.split(|c: char| !c.is_ascii_alphanumeric() && c != '_'))
        .any(|word| {
            ["fps", "select", "reverse", "trim", "tile", "setpts"]
                .iter()
                .any(|name| word.eq_ignore_ascii_case(name))
        });
    let mut tracks = Vec::new();
    let mut index_bytes = 0usize;
    for (ordinal, &(j, i)) in selected.iter().enumerate() {
        let (input, _, source) = &sources[j];
        if let Some(sequence) = &composed
            && !matches!(source, Streams::Mp4(_))
            && source.kind(i) == "video"
        {
            let (w, h) = sequence.geometry;
            let ts = match source {
                Streams::Gif(g) => g.timescale(),
                Streams::Still(_) => 25,
                _ => 90000,
            };
            let mut t = video_track(
                w,
                h,
                VideoCodec::Avc(30),
                ts,
                (source.seconds(i) * f64::from(ts)).round() as u64,
                scale,
            )?;
            sequence.encode(&mut t, scale, &opts, false, preparing_cut, &mut index_bytes)?;
            tracks.push(t);
            continue;
        }
        let Streams::Mp4(v) = source else {
            let limit = opts.limit.saturating_sub(index_bytes);
            let repeated = selected[..ordinal].contains(&(j, i));
            let mut track = match source {
                Streams::Still(seek) => {
                    still_track(input, *seek, range, &opts, scale, repeated, limit)?
                }
                Streams::Gif(g) => gif_track(input,g,&opts,range,scale,repeated,limit)?,
                Streams::Y4m(clip) => raw_video_track(clip, &opts, range, scale, repeated, limit)?,
                Streams::Images(seq) => sequence_track(
                    seq,
                    scale,
                    opts.video_filters,
                    opts.frames,
                    repeated,
                    opts.fragmented,
                    limit,
                )?,
                Streams::GeneratedVideo(v) => generated_video(
                    v,
                    scale,
                    opts.video_filters,
                    opts.frames,
                    opts.fragmented,
                    limit,
                )?,
                Streams::GeneratedAudio(a) => {
                    let track = a.track(&audio, scale, limit)?;
                    index_bytes += track.samples.capacity() * size_of::<Sample>();
                    tracks.push(track);
                    continue;
                }
                Streams::Wave(w) => {
                    let t = w.track(&audio, scale, limit)?;
                    index_bytes += t.samples.capacity() * size_of::<Sample>();
                    tracks.push(t);
                    continue;
                }
                Streams::Aac { .. } => {
                    tracks.push(adts_track(input, &audio, scale, &mut index_bytes)?);
                    continue;
                }
                Streams::Mp4(_) => unreachable!(),
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
            track.matrix = rotation_matrix(opts.rotation.unwrap_or(0));
            index_bytes =
                index_bytes.saturating_add(track.samples.capacity() * size_of::<Sample>());
            for sample in &track.samples {
                index_bytes = index_bytes.saturating_add(sample.data.len());
            }
            if index_bytes > opts.limit {
                return Err("output byte limit exceeded".into());
            }
            tracks.push(track);
            continue;
        };
        let (t, trak) = &v[i];
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
        let composed_video = composed.as_ref().filter(|_| video);
        let count = if composed_video.is_some() {
            0
        } else {
            t.stats.count
        };
        index_bytes = index_bytes.saturating_add(count.saturating_mul(size_of::<Sample>()));
        if index_bytes > opts.limit {
            return Err("sample index exceeds memory budget".into());
        }
        let mut samples = Vec::with_capacity(count);
        let mut first_dts = 0;
        let mut begin = 0;
        let sliced = range.is_some();
        let pcm = opts.concat.as_deref().and_then(|c| c.audio.get(&i));
        let (first, start, end, packets) = cut_packets(t, input.len(), range);
        for s in packets.take(count) {
            if samples.is_empty() {
                first_dts = if sliced { 0 } else { s.dts };
                begin = s.dts;
            }
            samples.push(Sample {
                data: input[s.offset..s.offset + s.size as usize].into(),
                duration: if sliced && pcm.is_some() {
                    s.tick
                        .saturating_sub(start.saturating_sub(s.dts).min(u64::from(u32::MAX)) as u32)
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
                let mut decoder = super::VideoDecoder::new(t, opts.limit);
                let key = t
                    .samples(input.len())
                    .take(first + 1)
                    .enumerate()
                    .filter(|(_, s)| s.size > 4 && input[s.offset + 4] & 31 == 5)
                    .map(|(i, _)| i)
                    .last()
                    .unwrap_or(0);
                for (i, s) in t
                    .samples(input.len())
                    .enumerate()
                    .skip(key)
                    .take(first - key + 1)
                {
                    let picture = decoder
                        .decode(s.description, &input[s.offset..s.offset + s.size as usize])?;
                    if i == first {
                        picture.promote(t.width as usize, t.height as usize, opts.limit)?;
                        sample.data = picture.idr(opts.limit)?.into();
                    }
                }
                sample.key = true;
            }
            edits.clear();
            if !samples.is_empty() && begin < start && pcm.is_none() {
                let ticks = samples.iter().map(|s| u64::from(s.duration)).sum::<u64>();
                let visible = end.min(begin.saturating_add(ticks)).saturating_sub(start);
                edits.push([
                    (visible as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32,
                    (start - begin) as u32,
                    65536,
                ]);
            }
        }
        let repeated_still = match &inputs[j] {
            MediaInput::Bytes("image2", bytes)
                if t.tag != b"avc1"
                    && !samples.is_empty()
                    && (!opts.video_filters.is_empty()
                        || opts.frames.is_some_and(|n| samples.len() > n as usize)) =>
            {
                Some(bytes)
            }
            _ => None,
        };
        if video
            && repeated_still.is_none()
            && !temporal
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
            id: t.id,
            samples,
            scale: t.scale,
            media_ticks: ticks as u32,
            movie_ticks,
            first_dts,
            fragment_sample_size: None,
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
        let (from, to) = range.unwrap_or((0., None));
        let joined = opts
            .concat
            .as_deref()
            .and_then(|c| c.video.as_ref()?.get(&i))
            .map(|v| (v, v.visible(from, to)))
            .filter(|(_, v)| {
                !v.is_empty()
                    && (track.samples.is_empty()
                        || !opts.video_filters.is_empty()
                        || opts.frames.is_some_and(|n| v.len() > n as usize))
            });
        if let Some((seq, show)) = joined {
            let mut consumed = vec![false; seq.images.len()];
            let limit = opts.limit.saturating_sub(index_bytes);
            encode_video(
                &mut track,
                scale,
                show.iter().map(|f| ((f.0 - from).max(0.), f.1)),
                y4m::Options {
                    filters: opts.video_filters,
                    frames: opts.frames,
                    start: 0.,
                    end: None,
                    no_video: false,
                    limit,
                },
                |k| std::mem::replace(&mut consumed[show[k].2], true),
                opts.fragmented,
                |k| Ok(seq.images[show[k].2].clone()),
            )?;
            index_bytes = index_bytes
                .saturating_add(track.samples.iter().map(|s| s.data.len()).sum::<usize>());
        } else if let Some(sequence) = composed_video {
            let consumed = selected[..ordinal]
                .iter()
                .any(|&(j, i)| sources[j].2.kind(i) == "video");
            sequence.encode(
                &mut track,
                scale,
                &opts,
                consumed,
                preparing_cut,
                &mut index_bytes,
            )?;
        } else if let Some(bytes) = repeated_still {
            let limit = opts.limit.saturating_sub(index_bytes);
            let im = frame_output::decode_still(bytes, limit)?;
            let mut consumed = selected[..ordinal].contains(&(j, i));
            let (start, end) = range.unwrap_or((0., None));
            encode_video(
                &mut track,
                scale,
                (0..t.stats.count).map(|i| (i as f64 / 25., 0.04)),
                y4m::Options {
                    start,
                    end,
                    frames: opts.frames,
                    filters: opts.video_filters,
                    no_video: false,
                    limit,
                },
                |_| std::mem::replace(&mut consumed, true),
                opts.fragmented,
                |_| Ok(im.clone()),
            )?;
            index_bytes = index_bytes
                .saturating_add(track.samples.iter().map(|s| s.data.len()).sum::<usize>());
        } else if video && !opts.video_filters.is_empty() && !track.samples.is_empty() {
            let mut decoder = super::VideoDecoder::new(t, opts.limit);
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
                |_| false,
                opts.fragmented,
                |i| {
                    let picture = decoder.picture(
                        i,
                        |n| {
                            let s = &input_samples[n];
                            (s.description, s.data.as_ref())
                        },
                        None,
                    )?;
                    picture.image((t.width as usize, t.height as usize), true, limit)
                },
            )?;
            if track.samples.is_empty() && !track.edits.is_empty() {
                track.media_ticks = (f64::from(track.movie_ticks) * f64::from(track.scale)
                    / f64::from(scale))
                .round() as u32;
            }
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
            let (rate, channels) =
                if let Some(pcm) = opts.concat.as_deref().and_then(|c| c.audio.get(&i)) {
                    (pcm.rate, pcm.channels as u32)
                } else {
                    match &sources[j].2 {
                        Streams::Mp4(v) => (
                            v[i].0.audio_rate().unwrap_or(v[i].0.scale),
                            u32::from(v[i].0.channels()),
                        ),
                        Streams::Aac { rate, channels, .. } => (*rate, u32::from(*channels)),
                        Streams::GeneratedAudio(a) => (a.rate, a.channels),
                        Streams::Wave(w) => (w.wav.rate, w.wav.channels as u32),
                        Streams::Y4m(_)
                        | Streams::Gif(_)
                        | Streams::Still(_)
                        | Streams::Images(_)
                        | Streams::GeneratedVideo(_)
                        | Streams::Captions(_) => continue,
                    }
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
    if sources.len() > 1
        && let Some(decoded) = opts.concat.as_deref_mut()
    {
        tracks = concat::join(tracks, sources, inputs, scale, opts.limit, decoded)?;
    }
    if opts.concat.is_none() {
        for (i, t) in tracks.iter_mut().enumerate() {
            t.id = i as u32 + 1;
        }
    }
    if loops != 0 {
        repeat_tracks(&mut tracks, loops, scale, opts.limit)?;
    }
    let mut metadata = BTreeMap::new();
    let mut chapters = Vec::new();
    for (j, &(_, movie, ..)) in sources[..if opts.maps.is_empty() && opts.concat.is_none() {
        sources.len()
    } else {
        1
    }]
        .iter()
        .enumerate()
    {
        if matches!(
            inputs[j],
            MediaInput::Images(_) | MediaInput::Bytes("lavfi", _)
        ) {
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
