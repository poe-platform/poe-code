use super::super::media_probe::{self, Codec, Packet, ProbeOptions, StreamInfo};
use super::{audio_config, h264};

#[derive(Clone, Copy)]
struct Tag<'a> {
    video: bool,
    config: bool,
    key: bool,
    dts: i64,
    cts: i32,
    payload: &'a [u8],
}

fn tags(mut bytes: &[u8]) -> impl Iterator<Item = Tag<'_>> {
    std::iter::from_fn(move || {
        loop {
            let h = bytes.get(..11)?;
            let n = u32::from_be_bytes([0, h[1], h[2], h[3]]) as usize;
            let end = (11 + n).min(bytes.len());
            let body = &bytes[11..end];
            bytes = bytes.get(end.saturating_add(4)..).unwrap_or_default();
            let (video, cts, key, payload) = match (h[0], body) {
                (9, [v, _, a, b, c, payload @ ..]) if v & 15 == 7 => (
                    true,
                    i32::from_be_bytes([*a, *b, *c, 0]) >> 8,
                    v >> 4 == 1,
                    payload,
                ),
                (8, [a, _, payload @ ..]) if a >> 4 == 10 => (false, 0, true, payload),
                _ => continue,
            };
            match body[1] {
                0 if payload.len() >= if video { 7 } else { 2 } => (),
                1 if !payload.is_empty() => (),
                _ => continue,
            }
            return Some(Tag {
                video,
                config: body[1] == 0,
                key,
                cts,
                payload,
                dts: u32::from_be_bytes([h[7], h[4], h[5], h[6]]).into(),
            });
        }
    })
}

pub(super) fn packets(bytes: &[u8], video: bool) -> impl Iterator<Item = (Packet, &[u8])> + '_ {
    let mut samples = tags(bytes)
        .filter(move |t| t.video == video && !t.config)
        .peekable();
    let mut pos = 0;
    std::iter::from_fn(move || {
        let tag = samples.next()?;
        let ticks = if video {
            samples
                .peek()
                .map_or(33, |n| (n.dts - tag.dts).max(1) as u64)
        } else {
            23
        };
        let size = tag.payload.len() as u64;
        let packet = Packet {
            pts: tag.dts + i64::from(tag.cts),
            dts: tag.dts,
            ticks,
            size,
            pos,
            key: tag.key,
        };
        pos += size;
        Some((packet, tag.payload))
    })
}

pub(super) struct Movie<'a> {
    pub bytes: &'a [u8],
    pub avc_config: Option<&'a [u8]>,
    pub tracks: Vec<(bool, StreamInfo)>,
}

pub(in super::super) fn tag_bytes(input: &[u8]) -> Result<&[u8], &'static str> {
    if input.len() < 9 || !input.starts_with(b"FLV\x01") {
        return Err("Invalid FLV file: missing FLV header signature");
    }
    let start = (super::u32_at(input, 5) as usize).saturating_add(4);
    Ok(input.get(start..).unwrap_or_default())
}

pub(super) fn timestamps(bytes: &[u8], video: bool) -> impl Iterator<Item = u32> + '_ {
    tags(bytes)
        .filter(move |t| !t.config && t.video == video)
        .map(|t| t.dts as u32)
}

pub(super) fn parse(input: &[u8]) -> Result<Movie<'_>, &'static str> {
    let bytes = tag_bytes(input)?;
    let (mut width, mut height) = (320, 240);
    let (mut rate, mut channels) = (44100, 2);
    let mut avc_config = None;
    for tag in tags(bytes).filter(|t| t.config) {
        if tag.video {
            avc_config = Some(tag.payload);
            if let Some(sps) = h264::Sequence::from_config(tag.payload) {
                if sps.width != 0 {
                    width = sps.width;
                }
                if sps.height != 0 {
                    height = sps.height;
                }
            } else if tag.payload[5] & 31 != 0 {
                // The production bit reader fills missing SPS fields with zero bits.
                (width, height) = (16, 32);
            }
        } else {
            (_, rate, channels) = audio_config(tag.payload);
        }
    }
    let mut tracks = Vec::new();
    for (video, codec) in [
        (
            true,
            Codec::Video {
                tag: b"avc1",
                width,
                height,
            },
        ),
        (
            false,
            Codec::Aac {
                rate,
                channels,
                profile: false,
            },
        ),
    ] {
        let mut info = StreamInfo {
            codec,
            scale: 1000,
            start: 0,
            ticks: 0,
            count: 0,
            payload_bytes: 0,
            has_cts: false,
        };
        for (p, _) in packets(bytes, video) {
            if info.count == 0 {
                info.start = p.pts;
            }
            info.count += 1;
            info.ticks += p.ticks;
            info.payload_bytes += p.size;
            info.has_cts |= p.dts != p.pts;
        }
        if info.count != 0 || (video && avc_config.is_some()) {
            tracks.push((video, info));
        }
    }
    Ok(Movie {
        bytes,
        avc_config,
        tracks,
    })
}

pub(in super::super) fn report(
    input: &[u8],
    name: &str,
    opts: ProbeOptions<'_>,
) -> Result<String, &'static str> {
    let movie = parse(input)?;
    let tracks = &movie.tracks;
    let (counts, select) = (opts.counts, opts.select);
    let duration = tracks
        .iter()
        .map(|(_, t)| t.ticks)
        .max()
        .unwrap_or_default() as f64
        / 1000.;
    media_probe::report(opts, |section| match section {
        "packet" | "frame" => {
            let bytes = movie.bytes;
            Box::new(tracks.iter().enumerate().flat_map(move |(i, (video, t))| {
                packets(bytes, *video)
                    .map(move |(p, _)| t.codec.record(i, 1000, p, section == "frame"))
            }))
        }
        "stream" => Box::new(
            tracks
                .iter()
                .enumerate()
                .filter(move |(i, (video, _))| {
                    media_probe::selected(select, if *video { "video" } else { "audio" }, *i, 0)
                })
                .map(|(i, (_, t))| t.stream(i, counts)),
        ),
        "format" => Box::new(std::iter::once(media_probe::format_row(
            name,
            input.len(),
            ("flv", "FLV (Flash Video)"),
            tracks.len(),
            duration,
            vec![],
        ))),
        _ => Box::new(std::iter::empty()),
    })
}
