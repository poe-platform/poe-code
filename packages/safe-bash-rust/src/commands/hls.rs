use super::super::super::{Hls, filename_width, write_streaming_file};
use super::super::{atoms, child};
use super::{Sample, Track, h264};
use crate::vfs::resolve_posix_path;

fn filename(pattern: &str, index: usize) -> Result<String, &'static str> {
    for (at, _) in pattern.match_indices('%') {
        let tail = &pattern[at + 1..];
        let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
        if tail.as_bytes().get(digits) == Some(&b'd') {
            let width =
                filename_width(&tail[..digits]).ok_or("HLS segment filename is too long")?;
            return Ok(format!(
                "{}{index:0width$}{}",
                &pattern[..at],
                &tail[digits + 1..]
            ));
        }
    }
    Ok(pattern.into())
}

pub(super) fn segments(
    hls: &Hls<'_>,
    mut tracks: Vec<Track<'_>>,
    timestamps: &[Vec<u64>],
    seconds: &[f64],
    movie_seconds: f64,
    decoded_video: bool,
    movie_scale: u32,
    limit: usize,
    mut serialize: impl FnMut(&[Track<'_>]) -> Result<Vec<u8>, &'static str>,
) -> Result<Vec<u8>, String> {
    let video = tracks.iter().position(|t| t.kind == "video");
    let total = video
        .map_or(
            if movie_seconds == 0. {
                1.
            } else {
                movie_seconds
            },
            |i| seconds[i],
        )
        .max(0.1);
    let mut boundaries = vec![0.];
    if let Some(v) = video.filter(|&i| !decoded_video && !tracks[i].samples.is_empty()) {
        let track = &tracks[v];
        let mut dts = track.first_dts;
        for (n, s) in track.samples.iter().enumerate() {
            dts = timestamps[v].get(n).copied().unwrap_or(dts);
            let time = dts as f64 / f64::from(track.scale);
            if s.key && time >= boundaries.last().unwrap() + hls.time - 1e-6 && time < total {
                boundaries.push(time);
            }
            dts += u64::from(s.duration);
        }
    } else {
        let mut time = hls.time;
        while time < total - 1e-6 {
            if boundaries.len() >= 200_000 {
                return Err("HLS segment count exceeds limit".into());
            }
            boundaries.push(time);
            time += hls.time;
        }
    }
    boundaries.push(total);
    let target = boundaries
        .windows(2)
        .map(|w| w[1] - w[0])
        .fold(0., f64::max)
        .ceil();
    let mut manifest = format!(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{target}\n#EXT-X-MEDIA-SEQUENCE:0\n"
    );
    let pattern = hls.pattern.unwrap_or(if hls.fmp4 {
        "seg_%03d.m4s"
    } else {
        "seg_%03d.ts"
    });
    // Keep one sample index per track. Adjacent segments may share a packet
    // when the segment boundary falls between two audio sample boundaries.
    let packets: Vec<_> = tracks
        .iter_mut()
        .map(|t| {
            let origin = t
                .edits
                .first()
                .map_or(0, |e| i64::from(e[1] as i32).max(0) as u64);
            t.edits.clear();
            let first = std::mem::take(&mut t.first_dts);
            t.fragment_sample_size = None;
            (std::mem::take(&mut t.samples), origin, first)
        })
        .collect();
    let mut cursors = vec![0; tracks.len()];
    let mut positions: Vec<_> = packets.iter().map(|p| p.2).collect();
    let mut decode_budget = limit.saturating_mul(32);
    for (index, w) in boundaries.windows(2).enumerate() {
        for (i, t) in tracks.iter_mut().enumerate() {
            let (samples, origin, _) = &packets[i];
            let scale = f64::from(t.scale);
            let start = origin.saturating_add((w[0] * scale).round() as u64);
            let end = origin.saturating_add((w[1].min(seconds[i]) * scale).round() as u64);
            let pos = &mut positions[i];
            let cursor = &mut cursors[i];
            while *cursor < samples.len() {
                *pos = timestamps[i].get(*cursor).copied().unwrap_or(*pos);
                let next = *pos + u64::from(samples[*cursor].duration);
                if next > start {
                    break;
                }
                *pos = next;
                *cursor += 1;
            }
            let mut dts = *pos;
            t.samples.clear();
            t.media_ticks = 0;
            for (n, s) in samples[*cursor..].iter().enumerate() {
                dts = timestamps[i].get(*cursor + n).copied().unwrap_or(dts);
                if start >= end || dts >= end {
                    break;
                }
                let next = dts + u64::from(s.duration);
                let duration = next.min(end).saturating_sub(dts.max(start)) as u32;
                let mut sliced = Sample {
                    duration,
                    ..s.clone()
                };
                if n == 0 && t.kind == "video" && s.data.get(4).is_some_and(|v| v & 31 == 1) {
                    let entry = atoms(t.stsd.get(8..).unwrap_or_default())
                        .nth(s.description.saturating_sub(1) as usize)
                        .map_or(&[][..], |(_, e)| e);
                    let avcc = child(entry.get(78..).unwrap_or_default(), b"avcC");
                    let seq = h264::Sequence::from_config(avcc).ok_or(h264::INVALID_PACKET)?;
                    let mut picture = h264::Pcm::new(seq, avcc, limit)?;
                    let key = samples[..*cursor]
                        .iter()
                        .rposition(|s| s.data.get(4).is_some_and(|v| v & 31 == 5))
                        .unwrap_or(0);
                    for p in &samples[key..=*cursor] {
                        decode_budget = decode_budget
                            .checked_sub(p.data.len())
                            .ok_or("H.264 decode work limit exceeded")?;
                        picture.decode(&p.data)?;
                    }
                    picture.promote(t.width as usize, t.height as usize, limit)?;
                    sliced.data = picture.idr(limit)?.into();
                    sliced.key = true;
                }
                t.samples.push(sliced);
                t.media_ticks = t
                    .media_ticks
                    .checked_add(duration)
                    .ok_or("track duration exceeds limit")?;
                dts = next;
            }
            t.movie_ticks =
                (f64::from(t.media_ticks) / scale * f64::from(movie_scale)).round() as u32;
        }
        let data = serialize(&tracks)?;
        let name = filename(pattern, index)?;
        let path = resolve_posix_path(
            if hls.pattern.is_some() {
                hls.cwd
            } else {
                hls.dir
            },
            &name,
        );
        write_streaming_file(hls.fs, &path, &data)?;
        let uri = path
            .strip_prefix(hls.dir.trim_end_matches('/'))
            .and_then(|p| p.strip_prefix('/'))
            .unwrap_or(&name);
        manifest.push_str(&format!("#EXTINF:{:.6},\n{uri}\n", (w[1] - w[0]).max(0.04)));
        if manifest.len() > limit {
            return Err("output byte limit exceeded".into());
        }
    }
    manifest.push_str("#EXT-X-ENDLIST\n");
    Ok(manifest.into_bytes())
}
