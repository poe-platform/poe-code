// The production registry tries a named demuxer, a matching filename and
// signature, signatures alone, then a known extension for malformed input.
const FORMATS: &[(&str, &str, &[&str])] = &[
    (
        "mp4",
        "mov,mp4,m4a,3gp,3g2,mj2",
        &["mp4", "m4a", "m4v", "3gp", "3g2", "f4v"],
    ),
    ("mov", "mov", &["mov", "qt"]),
    ("mkv", "matroska,webm", &["mkv", "mka", "mks"]),
    ("webm", "webm", &["webm"]),
    ("mpegts", "mpegts", &["ts", "m2ts", "mts"]),
    ("avi", "avi", &["avi"]),
    ("flv", "flv", &["flv"]),
    ("y4m", "yuv4mpegpipe", &["y4m"]),
    ("aac", "aac", &["aac"]),
    ("wav", "wav", &["wav", "wave"]),
    ("mp3", "mp3", &["mp3"]),
    ("flac", "flac", &["flac"]),
    ("ogg", "ogg", &["ogg", "oga", "ogv", "opus"]),
    ("gif", "gif", &["gif"]),
    (
        "image2",
        "image2",
        &[
            "png", "jpg", "jpeg", "webp", "bmp", "ppm", "pgm", "tga", "tiff", "tif",
        ],
    ),
    ("srt", "srt", &["srt"]),
    ("webvtt", "webvtt", &["vtt", "webvtt"]),
    ("ffmetadata", "ffmetadata", &["ffmeta", "ffmetadata"]),
    ("hls", "hls", &["m3u8", "m3u"]),
    ("dash", "dash", &["mpd"]),
];

pub(super) fn detect(bytes: &[u8], filename: &str, explicit: Option<&str>) -> Option<&'static str> {
    if let Some(format) = explicit
        && let Some((id, _, _)) = FORMATS.iter().find(|(id, name, exts)| {
            id.eq_ignore_ascii_case(format)
                || name.eq_ignore_ascii_case(format)
                || name
                    .split(',')
                    .chain(exts.iter().copied())
                    .any(|s| s.eq_ignore_ascii_case(format))
        })
    {
        return Some(id);
    }
    let file = filename.split('?').next().unwrap_or(filename);
    let extension = file.rsplit('.').next().unwrap_or("");
    let named = FORMATS
        .iter()
        .find(|(_, _, exts)| exts.iter().any(|s| s.eq_ignore_ascii_case(extension)))
        .map(|x| x.0);
    let suffix = if file == filename { named } else { None };
    let text = |limit| String::from_utf8_lossy(&bytes[..bytes.len().min(limit)]);
    let mp4 = matches!(
        bytes.get(4..8),
        Some(b"ftyp" | b"styp" | b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot")
    );
    let signature = |id: &str| match id {
        "y4m" => bytes.starts_with(b"YUV4MPEG2 "),
        "aac" => {
            bytes.len() >= 7
                && (suffix == Some("aac") || bytes[0] == 255 && bytes[1] & 0xf6 == 0xf0)
        }
        "mp4" => mp4 || suffix == Some("mp4") && bytes.len() >= 8,
        "mov" => bytes.get(4..12) == Some(b"ftypqt  ") || suffix == Some("mov") && mp4,
        "mkv" | "webm" => {
            bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
                && (id == "webm") == (suffix == Some("webm"))
        }
        "mpegts" => {
            bytes.len() >= 188
                && bytes[0] == 0x47
                && (bytes.len() < 376 || bytes[188] == 0x47 || suffix == Some("mpegts"))
                || bytes.len() >= 192
                    && bytes[4] == 0x47
                    && (bytes.len() < 384 || bytes[196] == 0x47)
        }
        "flv" => bytes.len() >= 9 && bytes.starts_with(b"FLV\x01"),
        "wav" | "avi" => {
            bytes.starts_with(b"RIFF")
                && bytes.get(8..12) == Some(if id == "wav" { b"WAVE" } else { b"AVI " })
        }
        "mp3" => {
            bytes.len() >= 4
                && (bytes.starts_with(b"ID3")
                    || bytes[0] == 255 && bytes[1] & 0xe0 == 0xe0 && bytes[1] & 6 != 0
                    || suffix == Some("mp3"))
        }
        "flac" => bytes.starts_with(b"fLaC"),
        "ogg" => bytes.starts_with(b"OggS"),
        "gif" => bytes.len() >= 6 && (bytes.starts_with(b"GIF8") || suffix == Some(id)),
        "image2" => {
            bytes.len() >= 8 && bytes.starts_with(b"\x89PNG")
                || bytes.starts_with(b"\xff\xd8\xff")
                || bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
                || bytes.len() >= 3 && matches!(bytes.get(..2), Some(b"P6" | b"P3"))
                || suffix == Some(id) && bytes.len() >= 4
        }
        "srt" => {
            suffix == Some(id)
                || bytes.len() >= 15 && {
                    let head = text(256);
                    let mut lines = head.trim_start().lines();
                    lines
                        .next()
                        .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
                        && lines
                            .next()
                            .and_then(|s| s.split_once("-->"))
                            .is_some_and(|(a, b)| {
                                let timestamp = |s: &str| {
                                    s.as_bytes().get(..12).is_some_and(|v| {
                                        v.iter().enumerate().all(|(i, b)| match i {
                                            2 | 5 => *b == b':',
                                            8 => matches!(b, b',' | b'.'),
                                            _ => b.is_ascii_digit(),
                                        })
                                    })
                                };
                                a.trim_end().len() == 12
                                    && timestamp(a.trim_end())
                                    && timestamp(b.trim())
                            })
                }
        }
        "webvtt" => {
            suffix == Some(id)
                || text(64)
                    .trim_start_matches('\u{feff}')
                    .trim_start()
                    .starts_with("WEBVTT")
        }
        "ffmetadata" => {
            suffix == Some(id)
                || bytes.len() >= 12 && text(64).trim_start().starts_with(";FFMETADATA")
        }
        "hls" => suffix == Some(id) || text(64).trim_start().starts_with("#EXTM3U"),
        "dash" => suffix == Some(id) || bytes.len() >= 10 && text(256).contains("<MPD"),
        _ => false,
    };
    named
        .filter(|id| signature(id))
        .or_else(|| FORMATS.iter().map(|f| f.0).find(|id| signature(id)))
        .or(named)
}
