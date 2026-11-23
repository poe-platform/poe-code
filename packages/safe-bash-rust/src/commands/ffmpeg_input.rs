use super::{
    InputTime, MediaInput, SafeBashFs, avi_input, frame_output, media_format, media_stdin, mp4,
    read_media_stdin, resolve_posix_path, streaming_input,
};
#[path = "concat_manifest.rs"]
mod concat_manifest;

#[derive(Clone)]
pub(super) struct Chapter {
    pub id: i64,
    pub scale: u32,
    pub start: i64,
    pub end: i64,
    pub title: Option<String>,
}

pub(super) fn boolean(value: &str) -> Option<bool> {
    match value.to_ascii_lowercase().as_str() {
        "true" | "yes" | "y" | "on" | "enabled" => Some(true),
        "false" | "no" | "n" | "off" | "disabled" => Some(false),
        s => match s.parse::<i32>() { Ok(0) => Some(false), Ok(1) => Some(true), _ => None },
    }
}

pub(super) struct Error {
    pub message: String,
    pub status: i32,
}
impl From<String> for Error {
    fn from(message: String) -> Self {
        let status = if message == "Invalid data found when processing input" { 183 } else { 1 };
        Self { message, status }
    }
}
impl From<&str> for Error {
    fn from(message: &str) -> Self { message.to_owned().into() }
}

pub(super) struct Reader<'a, 'b> {
    pub fs: &'a dyn SafeBashFs,
    pub cwd: &'a str,
    pub stdin: &'a mut super::super::CommandInput<'b>,
    pub auto_convert: bool,
    pub safe: bool,
    pub warnings: String,
    pub diagnostics: String,
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
    ) -> Result<(MediaInput, InputTime), Error> {
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
                .map(|s| concat_manifest::File {path: s.to_owned(), cut: InputTime::default(), duration: None, options: Vec::new()});
            return self.join(parts, limit, retain, depth, false);
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
            .map(|seq|(MediaInput::Images(seq), InputTime::default())).map_err(Into::into);
        }
        let full = resolve_posix_path(self.cwd, path.strip_prefix("file:").unwrap_or(path));
        let mut bytes = if media_stdin(path) {
            read_media_stdin(self.stdin)?
        } else {
            self.fs.read_file(&full).map_err(|e| Error {
                status: 254,
                message: format!(
                    "{}, readFile '{full}'",
                    e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)
                ),
            })?
        };
        if bytes.len() > limit {
            return Err("input byte limit exceeded".into());
        }
        if explicit == Some("concat") || explicit.is_none() && bytes.starts_with(b"ffconcat version 1.0") {
            let text = String::from_utf8_lossy(&bytes);
            let (parts, chapters) = concat_manifest::parse(&text, &full, self.safe, limit - bytes.len(), &mut self.diagnostics)?;
            let retained = parts.capacity() * size_of::<concat_manifest::File>()
                + chapters.capacity() * size_of::<Chapter>()
                + parts.iter().map(|f| f.path.capacity() + f.options.capacity() * size_of::<(String, String)>()
                    + f.options.iter().map(|(k,v)| k.capacity() + v.capacity()).sum::<usize>()).sum::<usize>();
            let limit = limit.checked_sub(bytes.len() + retained).ok_or("concat manifest exceeds memory budget")?;
            let (mut input, cut) = self.join(parts.into_iter(), limit, retain, depth, true)?;
            if let MediaInput::Joined(_, decoded) = &mut input { decoded.chapters = chapters; }
            return Ok((input, cut));
        }
        let id = media_format::detect(&bytes, path, explicit)?.ok_or_else(|| match explicit {
            Some(s) => format!("Unknown input format: '{s}' (AST not registered)"),
            None => format!("{path}: Unsupported input format (AST not registered)"),
        })?;
        if id == "image2" && super::exr::signature(&bytes) {super::exr::Image::read(&bytes,limit)?;}
        if id == "image2" && bytes.starts_with(b"qoif") {super::qoi::images(&bytes,limit)?;}
        if id == "image2" && super::netpbm::signature(&bytes) {super::ffmpeg_pnm::images(&bytes,limit)?;}
        match id {
            "aiff" if media_stdin(path) => {
                let doc=super::aiff::Document::read(&bytes,true,limit)?;
                let end=doc.offset+doc.data.len();
                // A pipe stops at its first sound chunk; later chunks cannot replace it.
                bytes.truncate(end);
            }
            "w64" if !bytes.starts_with(super::ffmpeg_wave::W64_RIFF) => return Err("Invalid Wave64 header".into()),
            "wav" if !bytes.starts_with(b"RIFF") => return Err("Invalid WAV file: missing RIFF WAVE signature".into()),
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
        parts: impl Iterator<Item = concat_manifest::File>,
        limit: usize,
        retain: (bool, bool),
        depth: usize,
        demuxer: bool,
    ) -> Result<(MediaInput, InputTime), Error> {
        let mut inputs = Vec::new();
        let mut cuts = Vec::new();
        let mut timings = Vec::new();
        let mut remaining = limit;
        for concat_manifest::File {path, cut, duration, options: file_options} in parts {
            let options = (self.auto_convert, self.safe);
            (self.auto_convert, self.safe) = (true, true);
            let loaded = self.load(&path, None, (None, None), remaining, retain, depth + 1);
            (self.auto_convert, self.safe) = options;
            let (mut input, inner_cut) = loaded?;
            let mut used = 0;
            if let MediaInput::Bytes("mp4" | "mov", bytes) = &mut input {
                mp4::movie(bytes)?;
                if let Some((_, value)) = file_options.iter().find(|(k, _)| k == "ignore_editlist") {
                    used += 1;
                    let ignore = boolean(value).ok_or_else(|| Error {message: format!("Unable to parse option value \"{value}\" as boolean"), status: 234})?;
                    if ignore { mp4::ignore_editlist(bytes, remaining)?; }
                }
            }
            if used < file_options.len() {
                let warning = format!("ffmpeg: Unused options for '{path}'.\n");
                if self.warnings.len() + warning.len() > remaining { return Err("concat diagnostics exceed memory budget".into()); }
                self.warnings.push_str(&warning);
            }
            // The concat demuxer must cut MP4 packets in their shared read order.
            // Cutting tracks separately loses preroll and cross-stream outpoints.
            cuts.push(if demuxer && matches!(input, MediaInput::Bytes("mp4" | "mov", _) | MediaInput::Joined(..)) {
                inner_cut
            } else {
                let mut applied = inner_cut.then(cut);
                if demuxer && let MediaInput::Bytes("wav" | "w64", bytes) = &input {
                    let wave = super::ffmpeg_wave::Wave::read(bytes)?;
                    let frames = wave.data.len() / wave.stride();
                    if matches!(wave.tag, 1 | 3 | 6 | 7) && applied.start.is_some_and(|s| (s * f64::from(wave.rate)).round() > frames as f64) && frames > 0 {
                        let packet = wave.packet_frames();
                        applied.start = Some(((frames - 1) / packet * packet) as f64 / f64::from(wave.rate));
                    }
                }
                applied
            });
            if demuxer {
                timings.push((cut, duration));
            }
            remaining = remaining
                .checked_sub(input.byte_size() + size_of::<MediaInput>())
                .ok_or("input byte limit exceeded")?;
            inputs.push(input);
        }
        match inputs.len() {
            0 => Err("concatMp4 requires at least one input MediaDocument".into()),
            1 if !demuxer => Ok((inputs.pop().unwrap(), cuts[0])),
            _ => {
                let mut decoded = mp4::mux::DecodedConcat::new(retain.0, retain.1);
                decoded.timings = demuxer.then_some(timings);
                decoded.auto_convert = demuxer && self.auto_convert;
                let bytes = mp4::mux::assemble_segments(&inputs, &cuts, Some(&mut decoded), limit)?;
                Ok((MediaInput::Joined(bytes, decoded), InputTime::default()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{commands::{archive::cmd_media_doc, structured::{JVal,parse_json_stream}}, vfs::{MemoryVfs,SafeBashFs}};

    #[test]
    fn container_chapter_preservation_matches_native() {
        let JVal::Object(fixture)=parse_json_stream(include_str!("../../tests/fixtures/chapter-preservation.json")).unwrap().remove(0) else {panic!("fixture")};
        let JVal::Object(inputs)=&fixture.iter().find(|(k,_)|k=="inputs").unwrap().1 else {panic!("inputs")};
        let JVal::Array(cases)=&fixture.iter().find(|(k,_)|k=="cases").unwrap().1 else {panic!("cases")};
        let fs=MemoryVfs::new();
        for (name,value) in inputs {let JVal::Str(hex)=value else{panic!("hex")};fs.write_file(&format!("/{name}"),&super::super::hex_dec(hex)).unwrap();}
        let mut failures=Vec::new();
        for case in cases {
            let JVal::Object(fields)=case else{panic!("case")};
            let field=|key|&fields.iter().find(|(k,_)|k==key).unwrap().1;
            let text=|key|match field(key){JVal::Str(s)=>s.as_str(),_=>panic!("text")};
            let JVal::Array(args)=field("args") else{panic!("args")};
            let args=args.iter().map(|v|match v{JVal::Str(s)=>s.clone(),_=>panic!("arg")}).collect::<Vec<_>>();
            let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
            if fields.iter().any(|(k,_)|k=="error") {
                if r.exit_code==0 || !r.stderr.contains(text("error")) {failures.push(format!("{}: expected rejection: {}",text("name"),r.stderr));}
                continue;
            }
            if r.exit_code!=0 {failures.push(format!("{}: {}",text("name"),r.stderr));continue;}
            if fields.iter().any(|(k,_)|k=="metadata") {
                let bytes=fs.read_file("/output").unwrap();
                let value=String::from_utf8(bytes).unwrap();
                let chapters=value.find("[CHAPTER]").map_or("",|at|&value[at..]);
                if chapters!=text("metadata") {failures.push(format!("{}: metadata {chapters:?} != {:?}",text("name"),text("metadata")));}
            } else {
                fs.write_file("/native",&super::super::hex_dec(text("native"))).unwrap();
                for path in ["native","output"] {
                    let r=cmd_media_doc("ffprobe",&["-show_chapters","-of","json",path].map(str::to_owned),"","/",&fs);
                    let actual=parse_json_stream(&r.stdout).ok().and_then(|mut v|v.pop());
                    let expected=JVal::Object(vec![("chapters".into(),field("chapters").clone())]);
                    if r.exit_code!=0 || actual!=Some(expected) {failures.push(format!("{} ({path}): chapters differ: {} {}",text("name"),r.stderr,r.stdout));}
                    let r=cmd_media_doc("ffprobe",&["-select_streams","d","-show_packets","-show_entries","stream=codec_name,codec_type,codec_tag_string,time_base,start_pts,duration_ts:packet=pts,dts,duration","-of","json",path].map(str::to_owned),"","/",&fs);
                    if parse_json_stream(&r.stdout).ok().and_then(|mut v|v.pop()).as_ref()!=Some(field("data")) {failures.push(format!("{} ({path}): data track differs: {}",text("name"),r.stdout));}
                    if fields.iter().any(|(k,_)|k=="audio") {
                        let r=cmd_media_doc("ffprobe",&["-select_streams","a:0","-show_packets","-show_entries","packet=pts,dts,duration","-of","json",path].map(str::to_owned),"","/",&fs);
                        if parse_json_stream(&r.stdout).ok().and_then(|mut v|v.pop()).as_ref()!=Some(field("audio")) {failures.push(format!("{} ({path}): audio packets differ: {}",text("name"),r.stdout));}
                    }
                }
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }

    #[test]
    fn concat_chapter_containers_and_probes_match_native() {
        let JVal::Object(fixture)=parse_json_stream(include_str!("../../tests/fixtures/concat-chapter-containers.json")).unwrap().remove(0) else {panic!("fixture")};
        let JVal::Object(inputs)=&fixture.iter().find(|(k,_)|k=="inputs").unwrap().1 else {panic!("inputs")};
        let JVal::Array(cases)=&fixture.iter().find(|(k,_)|k=="cases").unwrap().1 else {panic!("cases")};
        let fs=MemoryVfs::new();
        for (name,value) in inputs {let JVal::Str(hex)=value else{panic!("hex")};fs.write_file(&format!("/{name}"),&super::super::hex_dec(hex)).unwrap();}
        let mut failures=Vec::new();
        for case in cases {
            let JVal::Object(fields)=case else{panic!("case")};
            let field=|key|&fields.iter().find(|(k,_)|k==key).unwrap().1;
            let text=|key|match field(key){JVal::Str(s)=>s.as_str(),_=>panic!("text")};
            let JVal::Array(args)=field("args") else{panic!("args")};
            let args=args.iter().map(|v|match v{JVal::Str(s)=>s.clone(),_=>panic!("arg")}).collect::<Vec<_>>();
            let output=args.last().unwrap();
            fs.write_file("/list",text("list").as_bytes()).unwrap();
            fs.write_file("/native",&super::super::hex_dec(text("native"))).unwrap();
            let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
            if r.exit_code!=0 {failures.push(format!("{}: {}",text("name"),r.stderr));continue;}
            for path in ["native",output] {
                let args=["-show_chapters","-of","json",path].map(str::to_owned);
                let r=cmd_media_doc("ffprobe",&args,"","/",&fs);
                let actual=parse_json_stream(&r.stdout).ok().and_then(|mut v|v.pop());
                let expected=JVal::Object(vec![("chapters".into(),field("chapters").clone())]);
                if r.exit_code!=0 || actual!=Some(expected) {failures.push(format!("{} ({path}): chapters differ: {}",text("name"),r.stderr));}
            }
        }
        let JVal::Object(writers)=&fixture.iter().find(|(k,_)|k=="writers").unwrap().1 else{panic!("writers")};
        for (name,case) in writers {
            let JVal::Object(fields)=case else{panic!("writer")};
            let text=|key|match &fields.iter().find(|(k,_)|k==key).unwrap().1 {JVal::Str(s)=>s.as_str(),_=>panic!("text")};
            let JVal::Array(args)=&fields.iter().find(|(k,_)|k=="args").unwrap().1 else{panic!("args")};
            let args=args.iter().map(|v|match v{JVal::Str(s)=>s.clone(),_=>panic!("arg")}).collect::<Vec<_>>();
            fs.write_file(&format!("/{}",args.last().unwrap()),&super::super::hex_dec(text("input"))).unwrap();
            let r=cmd_media_doc("ffprobe",&args,"","/",&fs);
            let matched=if args.iter().any(|a|a=="json") {parse_json_stream(&r.stdout).ok()==parse_json_stream(text("output")).ok()}else{r.stdout==text("output")};
            if r.exit_code!=0 || !matched {failures.push(format!("{name}: probe writer differs: {}",r.stderr));}
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }

    #[test]
    fn concat_chapters_match_native_metadata_pcm_and_rejected_outputs() {
        let JVal::Object(fixture)=parse_json_stream(include_str!("../../tests/fixtures/concat-chapters.json")).unwrap().remove(0) else {panic!("fixture")};
        let JVal::Object(inputs)=&fixture.iter().find(|(k,_)|k=="inputs").unwrap().1 else {panic!("inputs")};
        let JVal::Array(cases)=&fixture.iter().find(|(k,_)|k=="cases").unwrap().1 else {panic!("cases")};
        let fs=MemoryVfs::new();
        for (name,value) in inputs {let JVal::Str(hex)=value else{panic!("hex")};fs.write_file(&format!("/{name}"),&super::super::hex_dec(hex)).unwrap();}
        let mut failures=Vec::new();
        for case in cases {
            let JVal::Object(fields)=case else{panic!("case")};
            let field=|key|fields.iter().find(|(k,_)|k==key).map(|(_,v)|v);
            let text=|key|match field(key){Some(JVal::Str(s))=>s.as_str(),_=>panic!("text")};
            let Some(JVal::Array(args))=field("args") else{panic!("args")};
            let args=args.iter().map(|v|match v{JVal::Str(s)=>s.clone(),_=>panic!("arg")}).collect::<Vec<_>>();
            let Some(JVal::Number(status,_))=field("exit") else{panic!("exit")};
            fs.write_file("/list",text("list").as_bytes()).unwrap();
            fs.write_file("/output",b"keep").unwrap();
            let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
            let bytes=fs.read_file("/output").unwrap();
            let matches=if *status!=0. {bytes==super::super::hex_dec(text("output"))}
                else if let Some(JVal::Str(expected))=field("chapters") {String::from_utf8_lossy(&bytes).split("\n[CHAPTER]").skip(1).collect::<Vec<_>>().join("\n[CHAPTER]")==*expected}
                else {super::super::hex_enc(&crate::commands::archive::sha256_bytes(&bytes))==text("sha256")};
            if r.exit_code!=*status as i32 || !matches || matches!(field("error"),Some(JVal::Str(s)) if !r.stderr.contains(s)) {
                failures.push(format!("{}: status {} (expected {status}), output matches {matches}: {}",text("name"),r.exit_code,r.stderr));
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }

    #[test]
    fn concat_manifest_matches_native_syntax_and_preserves_rejected_output() {
        let JVal::Object(fixture)=parse_json_stream(include_str!("../../tests/fixtures/concat-manifests.json")).unwrap().remove(0) else {panic!("fixture")};
        let JVal::Object(inputs)=&fixture.iter().find(|(k,_)|k=="inputs").unwrap().1 else {panic!("inputs")};
        let JVal::Array(cases)=&fixture.iter().find(|(k,_)|k=="cases").unwrap().1 else {panic!("cases")};
        let fs=MemoryVfs::new();
        fs.mkdir("/sub",true,0o755).unwrap();
        for (name,value) in inputs {let JVal::Str(hex)=value else{panic!("hex")};fs.write_file(&format!("/{name}"),&super::super::hex_dec(hex)).unwrap();}
        let mut failures=Vec::new();
        for case in cases {
            let JVal::Object(fields)=case else{panic!("case")};
            let field=|key|&fields.iter().find(|(k,_)|k==key).unwrap().1;
            let text=|key|match field(key){JVal::Str(s)=>s.as_str(),_=>panic!("text")};
            let num=|key|match field(key){JVal::Number(n,_)=>*n as i32,_=>panic!("number")};
            fs.write_file("/list",text("list").as_bytes()).unwrap();
            fs.write_file("/out.pcm",b"keep").unwrap();
            let args=["-y","-f","concat","-safe",if num("safe")==0{"0"}else{"1"},"-i","list","-c:a","pcm_s16le","-f","s16le","out.pcm"].map(str::to_owned);
            let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
            if num("exit")==0 {
                if r.exit_code!=0 || fs.read_file("/out.pcm").unwrap()!=super::super::hex_dec(text("pcm")) {failures.push(format!("{}: PCM or status differs: {}",text("name"),r.stderr));}
            } else if r.exit_code!=num("exit") || fs.read_file("/out.pcm").unwrap()!=b"keep" || fields.iter().any(|(k,v)|k=="error" && matches!(v,JVal::Str(s) if !r.stderr.contains(s))) {
                failures.push(format!("{}: expected failure preserving output: {}",text("name"),r.stderr));
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }
}
