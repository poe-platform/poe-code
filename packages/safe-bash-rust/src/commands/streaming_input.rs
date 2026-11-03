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

pub(super) fn hls(
    bytes: &[u8],
    path: &str,
    fs: &dyn SafeBashFs,
) -> Result<(&'static str, Vec<u8>), String> {
    let limit = fs.max_input_bytes();
    let text = String::from_utf8_lossy(bytes);
    let mut segments = Vec::new();
    let mut init = None;
    let mut seconds = 0.;
    for line in text.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("#EXTINF:") {
            let duration = value.split(',').next().unwrap_or("").trim();
            seconds += if duration.is_empty() {
                0.
            } else {
                duration.parse().unwrap_or(f64::NAN)
            };
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
    if inputs.len() == 1
        && let Some(MediaInput::Bytes(id, data)) = inputs.pop()
    {
        return Ok((id, data));
    }
    Ok(("mp4", mp4::mux::join_segments(&inputs, limit)?))
}
