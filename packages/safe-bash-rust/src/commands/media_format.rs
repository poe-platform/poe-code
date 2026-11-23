// The production registry tries a named demuxer, a matching filename and
// signature, signatures alone, then a known extension for malformed input.
// Text subtitle probes use native scores and reject ties.
pub(super) const FORMATS: &[(&str, &str, &str, &[&str], bool)] = &[
    (
        "mp4",
        "mov,mp4,m4a,3gp,3g2,mj2",
        "MP4 / ISOBMFF (MPEG-4 Part 14)",
        &["mp4", "m4a", "m4v", "3gp", "3g2", "f4v"],
        true,
    ),
    (
        "mov",
        "mov,mp4,m4a,3gp,3g2,mj2",
        "QuickTime / MOV",
        &["mov", "qt"],
        true,
    ),
    (
        "mkv",
        "matroska,webm",
        "Matroska / WebM",
        &["mkv", "mka", "mks"],
        true,
    ),
    ("webm", "matroska,webm", "WebM", &["webm"], true),
    (
        "mpegts",
        "mpegts",
        "MPEG-TS (MPEG-2 Transport Stream)",
        &["ts", "m2ts", "mts"],
        true,
    ),
    (
        "avi",
        "avi",
        "AVI (Audio Video Interleaved)",
        &["avi"],
        true,
    ),
    ("nut", "nut", "NUT", &["nut"], true),
    ("flv", "flv", "FLV (Flash Video)", &["flv"], true),
    ("y4m", "yuv4mpegpipe", "YUV4MPEG pipe", &["y4m"], true),
    (
        "aac",
        "aac,adts",
        "raw ADTS AAC (Advanced Audio Coding)",
        &["aac"],
        true,
    ),
    ("latm", "loas,latm", "LOAS/LATM", &["latm", "loas"], true),
    ("amr", "amr", "3GPP AMR", &["amr", "awb"], true),
    ("ac3", "ac3", "raw AC-3", &["ac3"], false),
    (
        "wav",
        "wav",
        "WAV / WAVE (Waveform Audio)",
        &["wav", "wave"],
        true,
    ),
    ("w64", "w64", "Sony Wave64", &["w64"], true),
    ("au", "au", "Sun AU", &["au", "snd"], true),
    ("voc", "voc", "Creative Voice", &["voc"], true),
    (
        "ircam",
        "ircam",
        "Berkeley/IRCAM/CARL Sound Format",
        &["sf", "ircam"],
        true,
    ),
    (
        "nistsphere",
        "nistsphere",
        "NIST SPeech HEader REsources",
        &["sph"],
        false,
    ),
    (
        "caf",
        "caf",
        "Apple CAF (Core Audio Format)",
        &["caf"],
        true,
    ),
    ("aiff", "aiff", "Audio IFF", &["aiff", "aif"], true),
    ("s8", "s8", "Raw s8 audio", &[], true),
    ("u8", "u8", "Raw u8 audio", &[], true),
    ("s16le", "s16le", "Raw s16le audio", &[], true),
    ("s16be", "s16be", "Raw s16be audio", &[], true),
    ("s24le", "s24le", "Raw s24le audio", &[], true),
    ("s24be", "s24be", "Raw s24be audio", &[], true),
    ("s32le", "s32le", "Raw s32le audio", &[], true),
    ("s32be", "s32be", "Raw s32be audio", &[], true),
    ("u16le", "u16le", "Raw u16le audio", &[], true),
    ("u16be", "u16be", "Raw u16be audio", &[], true),
    ("u24le", "u24le", "Raw u24le audio", &[], true),
    ("u24be", "u24be", "Raw u24be audio", &[], true),
    ("u32le", "u32le", "Raw u32le audio", &[], true),
    ("u32be", "u32be", "Raw u32be audio", &[], true),
    ("f32le", "f32le", "Raw f32le audio", &[], true),
    ("f32be", "f32be", "Raw f32be audio", &[], true),
    ("f64le", "f64le", "Raw f64le audio", &[], true),
    ("f64be", "f64be", "Raw f64be audio", &[], true),
    ("mulaw", "mulaw", "Raw mulaw audio", &[], true),
    ("alaw", "alaw", "Raw alaw audio", &[], true),
    ("vidc", "vidc", "PCM Archimedes VIDC", &[], true),
    ("mp3", "mp3", "MP2/3 (MPEG audio layer 2/3)", &["mp3"], true),
    ("flac", "flac", "raw FLAC", &["flac"], true),
    ("wv", "wv", "WavPack", &["wv"], true),
    ("ogg", "ogg", "Ogg", &["ogg", "oga", "ogv", "opus"], true),
    (
        "gif",
        "gif",
        "CompuServe Graphics Interchange Format (GIF)",
        &["gif"],
        true,
    ),
    (
        "apng",
        "apng",
        "Animated Portable Network Graphics",
        &["apng"],
        false,
    ),
    (
        "ico",
        "ico",
        "Microsoft Windows ICO",
        &["ico", "cur"],
        false,
    ),
    (
        "image2",
        "image2",
        "image2 sequence",
        &[
            "png", "jpg", "jpeg", "webp", "bmp", "ppm", "pgm", "pbm", "pnm", "tga", "tiff", "tif",
            "qoi", "exr",
        ],
        true,
    ),
    ("srt", "srt", "SubRip subtitle", &["srt"], true),
    ("ttml", "ttml", "TTML subtitle", &["ttml"], true),
    ("lrc", "lrc", "LRC lyrics", &["lrc"], true),
    ("sami", "sami", "SAMI subtitle", &["smi", "sami"], false),
    ("realtext", "realtext", "RealText subtitle", &["rt"], false),
    (
        "subviewer",
        "subviewer",
        "SubViewer subtitle",
        &["sub"],
        false,
    ),
    (
        "subviewer1",
        "subviewer1",
        "SubViewer v1 subtitle",
        &[],
        false,
    ),
    ("aqtitle", "aqtitle", "AQTitle subtitles", &["aqt"], false),
    ("microdvd", "microdvd", "MicroDVD subtitle", &["sub"], true),
    ("jacosub", "jacosub", "JACOsub subtitle", &["jss"], false),
    ("mpl2", "mpl2", "MPL2 subtitle", &[], false),
    ("stl", "stl", "Spruce STL subtitle", &[], false),
    ("vplayer", "vplayer", "VPlayer subtitle", &[], false),
    ("pjs", "pjs", "PJS subtitle", &["pjs"], false),
    (
        "ass",
        "ass",
        "ASS (Advanced SubStation Alpha) subtitle",
        &["ass", "ssa"],
        true,
    ),
    (
        "webvtt",
        "webvtt",
        "WebVTT subtitle",
        &["vtt", "webvtt"],
        true,
    ),
    (
        "ffmetadata",
        "ffmetadata",
        "FFmpeg metadata in text",
        &["ffmeta", "ffmetadata"],
        true,
    ),
    (
        "hls",
        "hls",
        "Apple HTTP Live Streaming",
        &["m3u8", "m3u"],
        true,
    ),
    (
        "dash",
        "dash",
        "Dynamic Adaptive Streaming over HTTP",
        &["mpd"],
        true,
    ),
];

pub(super) fn by_name(format: &str) -> Option<&'static str> {
    if matches!(
        format,
        "exr_pipe" | "qoi_pipe" | "pgm_pipe" | "pbm_pipe" | "ppm_pipe" | "image2pipe"
    ) {
        return Some("image2");
    }
    FORMATS
        .iter()
        .find(|(id, name, _, exts, _)| {
            id.eq_ignore_ascii_case(format)
                || name.eq_ignore_ascii_case(format)
                || name
                    .split(',')
                    .chain(exts.iter().copied())
                    .any(|s| s.eq_ignore_ascii_case(format))
        })
        .map(|f| f.0)
}

pub(super) fn by_filename(filename: &str) -> Option<&'static str> {
    let file = filename.split('?').next()?;
    let extension = file.rsplit('.').next()?;
    FORMATS
        .iter()
        .find(|(_, _, _, exts, _)| exts.iter().any(|s| s.eq_ignore_ascii_case(extension)))
        .map(|f| f.0)
}

pub(super) fn detect(
    bytes: &[u8],
    filename: &str,
    explicit: Option<&str>,
) -> Result<Option<&'static str>, &'static str> {
    if super::png_pixels::still_format(bytes).is_none()
        && (matches!(explicit, Some("pgm_pipe" | "pbm_pipe" | "ppm_pipe"))
            || matches!(explicit, None | Some("image2"))
                && filename
                    .split('?')
                    .next()
                    .unwrap_or(filename)
                    .rsplit('.')
                    .next()
                    .is_some_and(|ext| {
                        matches!(
                            ext.to_ascii_lowercase().as_str(),
                            "pgm" | "pbm" | "ppm" | "pnm"
                        )
                    }))
    {
        return Err("Invalid PNM header");
    }
    if !super::exr::signature(bytes)
        && (explicit == Some("exr_pipe")
            || matches!(explicit, None | Some("image2"))
                && filename
                    .rsplit('.')
                    .next()
                    .is_some_and(|s| s.eq_ignore_ascii_case("exr"))
                && super::png_pixels::still_format(bytes).is_none())
    {
        return Err("Invalid EXR header");
    }
    if !bytes.starts_with(b"qoif")
        && (explicit == Some("qoi_pipe")
            || matches!(explicit, None | Some("image2"))
                && filename
                    .split('?')
                    .next()
                    .unwrap_or(filename)
                    .rsplit('.')
                    .next()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("qoi"))
                && super::png_pixels::still_format(bytes).is_none())
    {
        return Err("Invalid QOI header");
    }
    if let Some(format) = explicit.and_then(by_name) {
        if format == "ttml" {
            return Err("TTML input is not supported");
        }
        return Ok(Some(format));
    }
    let mut subtitle = None;
    let mut best_score = 0;
    for id in [
        "lrc",
        "vplayer",
        "stl",
        "aqtitle",
        "microdvd",
        "jacosub",
        "sami",
        "realtext",
        "subviewer",
        "subviewer1",
        "pjs",
        "mpl2",
        "ass",
    ] {
        let score = if id == "lrc" {
            super::lrc::score(bytes)
        } else if id == "ass" {
            super::ass::score(bytes)
        } else {
            super::text_subtitles::score(id, bytes)
        };
        if score > best_score {
            best_score = score;
            subtitle = Some(id);
        } else if score > 0 && score == best_score {
            subtitle = None;
        }
    }
    if best_score > 0 && subtitle.is_none() {
        return Err("Invalid data found when processing input");
    }
    let named = by_filename(filename).filter(|id| *id != "ttml");
    // A Unicode text BOM can otherwise resemble a weak MPEG audio sync word.
    if bytes.starts_with(b"\xff\xfe") || bytes.starts_with(b"\xfe\xff") {
        return Ok(subtitle.or(named));
    }
    let suffix = if filename.contains('?') { None } else { named };
    let text = |limit| String::from_utf8_lossy(&bytes[..bytes.len().min(limit)]);
    let mp4 = matches!(
        bytes.get(4..8),
        Some(b"ftyp" | b"styp" | b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot")
    );
    let signature = |id: &str| match id {
        "amr" => bytes.starts_with(b"#!AMR\n") || bytes.starts_with(b"#!AMR-WB\n"),
        "ac3" => bytes.len() >= 7 && bytes.starts_with(b"\x0b\x77"),
        "latm" => bytes.len() >= 3 && bytes[0] == 0x56 && bytes[1] & 0xe0 == 0xe0,
        "wv" => bytes.len() >= 32 && bytes.starts_with(b"wvpk"),
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
        "aiff" => super::aiff::signature(bytes),
        "caf" => bytes.starts_with(b"caff"),
        "nut" => bytes.starts_with(super::nut::SIGNATURE),
        "au" => bytes.starts_with(b".snd"),
        "nistsphere" => bytes.starts_with(b"NIST_1A\n"),
        "voc" => bytes.len() >= 26 && bytes.starts_with(b"Creative Voice File\x1a"),
        "ircam" => matches!(bytes.get(..4), Some(b"\x64\xa3\x01\0" | b"\0\x01\xa3\x64")),
        "w64" => {
            bytes.starts_with(super::ffmpeg_wave::W64_RIFF)
                && bytes.get(24..40) == Some(super::ffmpeg_wave::W64_WAVE)
        }
        "mp3" => {
            bytes.len() >= 4
                && (bytes.starts_with(b"ID3")
                    || bytes[0] == 255 && bytes[1] & 0xe0 == 0xe0 && bytes[1] & 6 != 0
                    || suffix == Some("mp3"))
        }
        "flac" => bytes.starts_with(b"fLaC"),
        "ogg" => bytes.starts_with(b"OggS"),
        "apng" => super::apng::signature(bytes),
        "ico" => super::ico::signature(bytes),
        "gif" => bytes.len() >= 6 && (bytes.starts_with(b"GIF8") || suffix == Some(id)),
        "image2" => {
            !super::apng::signature(bytes)
                && (bytes.len() >= 8 && bytes.starts_with(b"\x89PNG")
                    || bytes.starts_with(b"qoif")
                    || super::exr::signature(bytes)
                    || bytes.starts_with(b"\xff\xd8\xff")
                    || bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
                    || bytes.len() >= 3 && matches!(bytes.get(..2), Some(b"P6" | b"P3"))
                    || suffix == Some(id) && bytes.len() >= 4)
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
        "lrc" | "vplayer" | "stl" | "aqtitle" | "microdvd" | "jacosub" | "sami" | "realtext"
        | "subviewer" | "subviewer1" | "pjs" | "mpl2" | "ass" => subtitle == Some(id),
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
    let detected = named
        .filter(|id| signature(id))
        .or_else(|| FORMATS.iter().map(|f| f.0).find(|id| signature(id)));
    if detected.is_none() && matches!(named, Some("subviewer" | "jacosub")) {
        return Err("Invalid data found when processing input");
    }
    Ok(detected.or(named))
}
