use super::{MediaInput, SafeBashFs, mp4, resolve_posix_path};
use crate::vfs::dirname_posix_path;

fn attribute<'a>(mut text: &'a str, name: &str) -> Option<&'a str> {
    let mut value = None;
    while let Some((key, tail)) = text.split_once('=') {
        let (v, rest) = if let Some(quoted) = tail.strip_prefix('"') {
            let (v, rest) = quoted.split_once('"').unwrap_or((quoted, ""));
            (v, rest.strip_prefix(',').unwrap_or(rest))
        } else {
            tail.split_once(',').unwrap_or((tail, ""))
        };
        if key.trim() == name {
            value = Some(v);
        }
        text = rest;
    }
    value
}

#[path = "dash_input.rs"]
mod dash;

fn hls(text: &str, limit: usize) -> Result<(Vec<(Option<&str>, &str)>, f64), String> {
    let mut segments = Vec::new();
    let mut init = None;
    let mut seconds = 0.;
    for line in text.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("#EXTINF:") {
            let duration = value.split(',').next().unwrap_or("").trim();
            seconds += crate::commands::js_number(duration, 0.);
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-MAP:") {
            if attribute(attrs, "BYTERANGE").is_some() {
                return Err("HLS initialization byte ranges are not supported".into());
            }
            init = Some(
                attribute(attrs, "URI")
                    .filter(|s| !s.is_empty())
                    .ok_or("HLS EXT-X-MAP requires URI")?,
            );
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            if attribute(attrs, "METHOD") != Some("NONE") {
                return Err("Encrypted HLS segments are not supported".into());
            }
        } else if line.starts_with("#EXT-X-BYTERANGE:") || line.starts_with("#EXT-X-STREAM-INF:") {
            return Err("HLS requires a media playlist with complete segment files".into());
        } else if !line.is_empty() && !line.starts_with('#') {
            if segments.len() >= limit / size_of::<(Option<&str>, &str)>() {
                return Err("segment index exceeds memory budget".into());
            }
            segments.push((init, line));
        }
    }
    if segments.is_empty() || !seconds.is_finite() {
        return Err("Invalid or empty HLS media playlist".into());
    }
    Ok((segments, seconds))
}

pub(super) struct Manifest {
    pub sequences: Vec<Vec<MediaInput>>,
    pub duration: f64,
}

impl Manifest {
    pub fn into_media(self, limit: usize) -> Result<(&'static str, Vec<u8>), String> {
        let mut representations = Vec::new();
        for mut sequence in self.sequences {
            let media = if sequence.len() == 1 {
                sequence.pop().unwrap()
            } else {
                let mut concat = mp4::mux::DecodedConcat::new(false, false);
                concat.align_durations = false;
                MediaInput::Bytes("mp4", mp4::mux::assemble_segments(&sequence, &[], Some(&mut concat), limit)?)
            };
            representations.push(media);
        }
        if representations.len() == 1
            && let Some(MediaInput::Bytes(kind, data)) = representations.pop()
        {
            Ok((kind, data))
        } else {
            Ok((
                "mp4",
                mp4::mux::assemble_segments(&representations, &[], None, limit)?,
            ))
        }
    }
}

pub(super) fn read(
    id: &str,
    bytes: &[u8],
    path: &str,
    fs: &dyn SafeBashFs,
) -> Result<Manifest, String> {
    let text = String::from_utf8_lossy(bytes);
    let limit = fs.max_input_bytes();
    let dir = dirname_posix_path(path);
    let mut remaining = limit.saturating_sub(bytes.len());
    let mut read = |uri: &str| -> Result<Vec<u8>, String> {
        if uri.contains(':') && !uri.starts_with("file:") {
            return Err("Streaming media requires local segment files".into());
        }
        let path = resolve_posix_path(&dir, uri.strip_prefix("file:").unwrap_or(uri));
        let data = fs.read_file(&path).map_err(|e| {
            format!(
                "{}, readFile '{path}'",
                e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)
            )
        })?;
        remaining = remaining
            .checked_sub(data.len())
            .ok_or("input byte limit exceeded")?;
        Ok(data)
    };
    if id == "hls" {
        let (segments, duration) = hls(&text, limit)?;
        return Ok(Manifest {
            sequences: vec![sequence(segments, &mut read)?],
            duration,
        });
    }
    let (sequences, duration) = dash::parse(&text, limit)?;
    let sequences = sequences
        .iter()
        .map(|rep| {
            sequence(
                rep.media
                    .iter()
                    .map(|uri| (rep.init.as_deref(), uri.as_str())),
                &mut read,
            )
        })
        .collect::<Result<_, _>>()?;
    Ok(Manifest {
        sequences,
        duration,
    })
}

fn sequence<'a>(
    segments: impl IntoIterator<Item = (Option<&'a str>, &'a str)>,
    mut read: impl FnMut(&str) -> Result<Vec<u8>, String>,
) -> Result<Vec<MediaInput>, String> {
    let mut inputs = Vec::new();
    let mut active = None;
    for (init, uri) in segments {
        if let Some(init) = init {
            if active != Some(init) {
                inputs.push(MediaInput::Bytes("mp4", read(init)?));
                active = Some(init);
            }
            let MediaInput::Bytes(_, bytes) = inputs.last_mut().unwrap() else {
                unreachable!()
            };
            bytes.extend(read(uri)?);
        } else {
            active = None;
            let data = read(uri)?;
            inputs.push(MediaInput::Bytes(
                if data.first() == Some(&0x47) {
                    "mpegts"
                } else {
                    "mp4"
                },
                data,
            ));
        }
    }
    Ok(inputs)
}
