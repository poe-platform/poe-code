use super::{
    InputTime, MediaInput, SafeBashFs, avi_input, frame_output, media_format, media_stdin, mp4,
    parse_ffmpeg_timestamp, read_media_stdin, resolve_posix_path, streaming_input,
};
use crate::vfs::dirname_posix_path;

pub(super) struct Reader<'a, 'b> {
    pub fs: &'a dyn SafeBashFs,
    pub cwd: &'a str,
    pub stdin: &'a mut super::super::CommandInput<'b>,
}

impl Reader<'_, '_> {
    pub fn load(
        &mut self,
        path: &str,
        explicit: Option<&str>,
        (start, fps): (Option<u64>, Option<f64>),
        limit: usize,
        retain: (bool, bool),
        depth: usize,
    ) -> Result<(MediaInput, InputTime), String> {
        if depth >= 32 {
            return Err("concat input nesting exceeds limit".into());
        }
        if explicit == Some("lavfi") {
            return Ok((MediaInput::Bytes("lavfi", path.as_bytes().to_vec()), InputTime::default()));
        }
        if let Some(rest) = path.strip_prefix("concat:") {
            let parts = rest
                .split('|')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| (s.to_owned(), InputTime::default()));
            return self.join(parts, limit, retain, depth);
        }
        if let Some(pattern) = frame_output::sequence(path)? {
            return frame_output::ImageSequence::read(
                self.fs,
                self.cwd,
                path,
                pattern,
                start,
                fps.unwrap_or(25.),
                limit,
            )
            .map(|seq|(MediaInput::Images(seq), InputTime::default()));
        }
        let full = resolve_posix_path(self.cwd, path.strip_prefix("file:").unwrap_or(path));
        let bytes = if media_stdin(path) {
            read_media_stdin(self.stdin)?
        } else {
            self.fs.read_file(&full).map_err(|e| {
                format!(
                    "{}, readFile '{full}'",
                    e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)
                )
            })?
        };
        if bytes.len() > limit {
            return Err("input byte limit exceeded".into());
        }
        if explicit == Some("concat") {
            let dir = if path == "-" {
                self.cwd.to_owned()
            } else {
                dirname_posix_path(&full)
            };
            let text = String::from_utf8_lossy(&bytes);
            let mut lines = text.lines().map(str::trim).peekable();
            let parts = std::iter::from_fn(|| {
                let name = lines.by_ref().find_map(|l| l.strip_prefix("file "))?.trim();
                let name = ['\'', '"']
                    .iter()
                    .find_map(|&q| name.strip_prefix(q)?.strip_suffix(q))
                    .unwrap_or(name);
                let mut cut = InputTime::default();
                while let Some(&line) = lines.peek() {
                    if let Some(s) = line.strip_prefix("inpoint ") {
                        cut.start = Some(parse_ffmpeg_timestamp(s));
                    } else if let Some(s) = line.strip_prefix("outpoint ") {
                        cut.to = Some(parse_ffmpeg_timestamp(s));
                    } else if let Some(s) = line.strip_prefix("duration ") {
                        cut.duration = Some(parse_ffmpeg_timestamp(s));
                    } else {
                        break;
                    }
                    lines.next();
                }
                Some((
                    resolve_posix_path(&dir, name.strip_prefix("file:").unwrap_or(name)),
                    cut,
                ))
            });
            return self.join(parts, limit - bytes.len(), retain, depth);
        }
        let id = media_format::detect(&bytes, path, explicit).ok_or_else(|| match explicit {
            Some(s) => format!("Unknown input format: '{s}' (AST not registered)"),
            None => format!("{path}: Unsupported input format (AST not registered)"),
        })?;
        match id {
            "mpegts" => {
                mp4::mpegts_input::framing(&bytes)?;
            }
            "avi" => {
                avi_input::check_header(&bytes)?;
            }
            "flv" => {
                mp4::flv_input::tag_bytes(&bytes)?;
            }
            "mkv" | "webm" => {
                mp4::mkv_input::check_header(&bytes)?;
            }
            "dash" | "hls" => {
                let (kind, data) =
                    streaming_input::read(id, &bytes, &full, self.fs)?.into_media(limit)?;
                return Ok((MediaInput::Bytes(kind, data), InputTime::default()));
            }
            _ => {}
        }
        Ok((MediaInput::Bytes(id, bytes), InputTime::default()))
    }

    fn join(
        &mut self,
        parts: impl Iterator<Item = (String, InputTime)>,
        limit: usize,
        retain: (bool, bool),
        depth: usize,
    ) -> Result<(MediaInput, InputTime), String> {
        let mut inputs = Vec::new();
        let mut cuts = Vec::new();
        let mut remaining = limit;
        for (path, cut) in parts {
            let (input, inner_cut) = self.load(&path, None, (None, None), remaining, retain, depth + 1)?;
            if let MediaInput::Bytes("mp4" | "mov", bytes) = &input {
                mp4::movie(bytes)?;
            }
            cuts.push(inner_cut.then(cut));
            remaining = remaining
                .checked_sub(input.byte_size() + size_of::<MediaInput>())
                .ok_or("input byte limit exceeded")?;
            inputs.push(input);
        }
        match inputs.len() {
            0 => Err("concatMp4 requires at least one input MediaDocument".into()),
            1 => Ok((inputs.pop().unwrap(), cuts[0])),
            _ => {
                let mut decoded = mp4::mux::DecodedConcat::new(retain.0, retain.1);
                let bytes = mp4::mux::assemble_segments(&inputs, &cuts, Some(&mut decoded), limit)?;
                Ok((MediaInput::Joined(bytes, decoded), InputTime::default()))
            }
        }
    }
}
