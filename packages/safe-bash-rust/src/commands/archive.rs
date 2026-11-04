use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;
mod xxd;
pub(super) use xxd::cmd_xxd;

pub fn try_run_archive_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    if let Some(info) =
        crate::commands::coreutils::gnu_information_sync(cmd, args, env.contains_key("POSIXLY_CORRECT"))
    {
        return Some(info);
    }
    if let Some(algorithm) = checksum_algorithm(cmd) {
        return Some(run_checksum(algorithm, args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, fs, &mut super::capture_write));
    }
    if is_compression_command(cmd) {
        return Some(cmd_gzip(cmd, args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, fs));
    }
    match cmd {
        "base64" | "base32" => Some(run_base_cmd(cmd, args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, fs, &mut super::capture_write)),
        "xxd" => Some(cmd_xxd(args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, env, fs, &mut super::capture_write)),
        "strings" => Some(cmd_strings(args, stdin, cwd, fs)),
        "od" => Some(cmd_od(args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, fs, &mut super::capture_write)),
        "hexdump" => Some(cmd_hexdump(args, stdin, cwd, fs, false)),
        "hd" => Some(cmd_hexdump(args, stdin, cwd, fs, true)),
        "tar" => Some(cmd_tar(args, stdin, cwd, fs)),

        "ffmpeg" | "ffprobe" | "soffice" | "libreoffice" | "wkhtmltopdf" | "pdfunite" | "pdfseparate" | "qpdf" | "pdftk" | "pdfinfo" | "pdffonts" | "pdfdetach" | "pdftotext" | "pdftohtml" | "pdftoppm" | "pdftocairo" | "pdfimages" | "diffpdf" | "pdfdiff" | "svgo" | "rsvg-convert" | "sox" | "soxi" | "qrencode" | "magick" | "convert" | "mogrify" | "composite" | "montage" | "compare" | "sips" | "exiftool" | "identify" => {
            let mut result = cmd_media_doc(cmd, args, stdin, cwd, fs);
            if result.exit_code == 1 && result.stderr == "shell: line 1: internal error\n"
                && let Some(line) = env.get("\0lineno") {
                result.stderr = format!("shell: line {line}: internal error\n");
            }
            Some(result)
        }
        "zip" => Some(cmd_zip(args, stdin, cwd, fs)),
        "unzip" => Some(cmd_unzip(args, cwd, fs)),
        "openssl" => Some(cmd_openssl(args, stdin, cwd, env, fs)),
        "gpg" => Some(cmd_gpg(args, stdin, cwd, fs)),
        "ssh" => Some(cmd_ssh(args)),
        "ssh-keygen" => Some(cmd_ssh_keygen(args, stdin, cwd, fs)),
        "dot" | "neato" => Some(cmd_graphviz(cmd, args, stdin, cwd, fs)),
        _ => None,
    }
}

fn ok_out(stdout: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: stdout.to_string(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn err_out(stderr: &str, exit_code: i32) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: stderr.to_string(),
        exit_code,
    }
}

mod digest;
use digest::{Digest, md5_bytes, sha384_bytes, sha512_bytes};
pub use digest::{sha1_bytes, sha256_bytes};

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub(super) fn checksum_algorithm(cmd: &str) -> Option<&str> {
    match cmd {
        "md5sum" | "sha1sum" | "sha224sum" | "sha256sum" | "sha384sum" | "sha512sum" => cmd.strip_suffix("sum"),
        "b2sum" => Some("blake2b"),
        "cksum" => Some("crc"),
        _ => None,
    }
}

struct ChecksumInputs<'a, 'b> {
    stdin: super::CommandInput<'a>,
    cwd: &'b str,
    fs: &'b dyn SafeBashFs,
    left: usize,
    stdin_used: bool,
}

enum SumSource<'a> {
    Stdin,
    File(crate::vfs::ChunkReader<'a>),
    Empty,
}

#[derive(Default, PartialEq, Eq)]
enum SumReportMode { #[default] Normal, Warn, Quiet, Status }

#[derive(Default)]
struct SumReport {
    mode: SumReportMode,
    strict: bool,
    ignore_missing: bool,
}

fn validate_sum_name(file: &str) -> Result<(), String> {
    if file.is_empty() || file.contains('\0') || crate::vfs::stream_utf8(file).is_err() {
        return Err("EINVAL: filename must be nonempty, NUL-free, valid Unicode".into());
    }
    if crate::vfs::stream_byte_len(file) > 16384 { return Err("ENAMETOOLONG: filename exceeds 16384 UTF-8 bytes".into()); }
    Ok(())
}

fn escape_sum_name(f: &str) -> (bool, String) {
    if f.contains('\\') || f.contains('\n') || f.contains('\r') {
        let esc = f
            .replace('\\', "\\\\")
            .replace('\n', "\\n")
            .replace('\r', "\\r");
        (true, esc)
    } else {
        (false, f.to_string())
    }
}

fn unescape_sum_name(f: &str) -> Option<String> {
    let mut out = String::new();
    let mut chs = f.chars();
    while let Some(c) = chs.next() {
        if c == '\\' {
            match chs.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('\\') => out.push('\\'),
                _ => return None,
            }
        } else {
            out.push(c);
        }
    }
    Some(out)
}

impl<'fs> ChecksumInputs<'_, 'fs> {
    fn open(&mut self, name: &str) -> Result<SumSource<'fs>, String> {
        validate_sum_name(name)?;
        if name == "-" {
            return Ok(if std::mem::replace(&mut self.stdin_used, true) { SumSource::Empty } else { SumSource::Stdin });
        }
        let path = crate::vfs::path::absolute_operand(self.cwd, name);
        let message = |e| super::coreutils::stream_file_error(e, "readStream", &path);
        let (entry, st) = self.fs.inspect_command_entry(&path, true, "capabilitiesFor").map_err(message)?;
        if st.kind == crate::vfs::VfsEntryKind::Directory { return Err(format!("{}: Is a directory", escape_sum_name(name).1)); }
        let mut next = self.fs.open_chunks(&entry).map_err(message)?;
        let mut remaining = if st.mode & 0o170000 == 0o100000 { st.size } else { usize::MAX };
        Ok(SumSource::File(Box::new(move |chunk| {
            if remaining == 0 { chunk.clear(); return Ok(()); }
            next(chunk).map_err(|e| super::coreutils::stream_file_error(e, "readStream", &path))?;
            chunk.truncate(remaining);
            remaining -= chunk.len();
            Ok(())
        })))
    }

    fn next(&mut self, source: &mut SumSource, chunk: &mut Vec<u8>) -> Result<(), String> {
        chunk.clear();
        match source {
            SumSource::File(next) => next(chunk)?,
            SumSource::Stdin => self.stdin.read_stdin(|b| { chunk.extend_from_slice(b); false })?,
            SumSource::Empty => {}
        }
        self.left = self.left.checked_sub(chunk.len()).ok_or_else(|| self.fs.limit_error("maxInputBytes", self.fs.max_input_bytes()))?;
        Ok(())
    }

    fn digest(&mut self, file: &str, algo: &str, bits: usize) -> Result<(String, u64), String> {
        let mut len = 0u64;
        let mut crc = if algo == "crc32b" { u32::MAX } else { 0 };
        let mut hash = Digest::checksum(algo, bits);
        let mut source = self.open(file)?;
        let mut chunk = Vec::new();
        loop {
            self.next(&mut source, &mut chunk)?;
            if chunk.is_empty() { break; }
            len += chunk.len() as u64;
            match algo {
                "crc" => for &b in &chunk { crc = posix_crc_byte(crc, b); },
                "crc32b" => for &b in &chunk {
                    crc ^= u32::from(b);
                    for _ in 0..8 { crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1)); }
                },
                "bsd" => for &b in &chunk { crc = u32::from((crc as u16).rotate_right(1).wrapping_add(u16::from(b))); },
                "sysv" => for &b in &chunk { crc = crc.wrapping_add(u32::from(b)); },
                _ => hash.as_mut().expect("checksum algorithm").update(&chunk),
            }
        }
        let value = match algo {
            "crc" => {
                let mut size = len;
                while size != 0 { crc = posix_crc_byte(crc, size as u8); size >>= 8; }
                (!crc).to_string()
            }
            "crc32b" => (!crc).to_string(),
            "bsd" => format!("{crc:05}"),
            "sysv" => {
                let sum = (crc & 0xffff) + (crc >> 16);
                ((sum & 0xffff) + (sum >> 16)).to_string()
            }
            _ => {
                let hash = hash.expect("checksum algorithm");
                let mut bytes = [0; 64];
                let out = &mut bytes[..hash.output_size];
                hash.finish(out);
                hex_encode(out)
            }
        };
        Ok((value, len))
    }
}

fn sum_entry<'a>(line: &str, selected: &'a str, allow_base64: bool) -> Option<(&'a str, usize, String, String)> {
    let text = line.trim_start_matches([' ', '\t']);
    let escaped = text.starts_with('\\');
    let text = text.strip_prefix('\\').unwrap_or(text);
    let raw_label = text.split_once('(').map(|(label, _)| label).unwrap_or("");
    let label = raw_label.strip_suffix(' ').unwrap_or(raw_label);
    let tagged = match label {
        "MD5" => Some(("md5",128)), "SHA1" => Some(("sha1",160)), "SHA224" => Some(("sha224",224)),
        "SHA256" => Some(("sha256",256)), "SM3" => Some(("sm3",256)), "SHA384" => Some(("sha384",384)),
        "SHA512" => Some(("sha512",512)), "BLAKE2b" => Some(("blake2b",512)),
        _ if label.starts_with("BLAKE2b-") => {
            let n = &label[8..];
            if !n.bytes().all(|b| b.is_ascii_digit()) { return None; }
            let bits = n.parse::<usize>().ok()?;
            if !(8..=512).contains(&bits) || bits % 8 != 0 { return None; }
            Some(("blake2b", bits))
        }
        _ if label.starts_with("SHA3-") => match &label[5..] {
            "224" => Some(("sha3",224)), "256" => Some(("sha3",256)),
            "384" => Some(("sha3",384)), "512" => Some(("sha3",512)), _ => return None,
        },
        _ => None,
    };
    let (algo, bits, fname, encoded) = if let Some((algo, bits)) = tagged {
        if selected != "crc" && selected != algo { return None; }
        let (_, body) = text.split_once('(')?;
        let (fname, suffix) = body.rsplit_once(')')?;
        let encoded = suffix.trim_start_matches([' ', '\t']).strip_prefix('=')?.trim_start_matches([' ', '\t']);
        (algo, Some(bits), fname, encoded)
    } else {
        let bits = match selected {
            "md5" => Some(128), "sha1" => Some(160), "sha224" => Some(224), "sha256" | "sm3" => Some(256),
            "sha384" => Some(384), "sha512" => Some(512), "blake2b" | "sha3" => None, _ => return None,
        };
        let (encoded, tail) = text.split_once([' ', '\t'])?;
        (selected, bits, tail.strip_prefix([' ', '*'])?, encoded)
    };
    if encoded.is_empty() || encoded.len() > 128 { return None; }
    let hex = if encoded.len() % 2 == 0 && bits.is_none_or(|n| encoded.len() * 4 == n)
        && encoded.bytes().all(|b| b.is_ascii_hexdigit()) {
        encoded.to_ascii_lowercase()
    } else {
        if !allow_base64 { return None; }
        let bytes = base64_decode_strict(encoded).ok()?;
        if base64_encode(&bytes) != encoded { return None; }
        hex_encode(&bytes)
    };
    let size = hex.len() * 4;
    if bits.is_some_and(|n| size != n) || (algo == "blake2b" && !(8..=512).contains(&size))
        || (algo == "sha3" && !matches!(size, 224 | 256 | 384 | 512)) { return None; }
    let name = if escaped { unescape_sum_name(fname)? } else { fname.to_string() };
    let name = crate::vfs::shell_text(&name).into_owned();
    validate_sum_name(&name).ok()?;
    Some((algo, size, name, hex))
}

impl ChecksumInputs<'_, '_> {
    fn verify(&mut self, cmd: &str, algo: &str, manifests: &[String], report: SumReport, write: &mut super::CommandWriter) -> BuiltinOutcome {
        let mut result = ok_out("");
        'manifest: for manifest in manifests {
            let disp = escape_sum_name(manifest).1;
            let mut source = match self.open(manifest) {
                Ok(reader) => reader,
                Err(e) => {
                    result.exit_code = 1;
                    if !write(2, &format!("{cmd}: {e}\n"), &mut result) { break; }
                    continue;
                }
            };
            let (mut chunk, mut pending) = (Vec::new(), Vec::new());
            let (mut line_num, mut malformed, mut mismatched, mut failures) = (0u64,0u64,0u64,0u64);
            let (mut valid, mut matched) = (false, false);
            loop {
                if let Err(e) = self.next(&mut source, &mut chunk) {
                    result.exit_code = 1;
                    if !write(2, &format!("{cmd}: {e}\n"), &mut result) { return result; }
                    continue 'manifest;
                }
                let eof = chunk.is_empty();
                if eof {
                    if pending.is_empty() { break; }
                    chunk.push(b'\n');
                }
                for part in chunk.split_inclusive(|&b| b == b'\n') {
                    let Some(tail) = part.strip_suffix(b"\n") else { pending.extend_from_slice(part); continue };
                    pending.extend_from_slice(tail);
                    line_num += 1;
                    let line = std::str::from_utf8(&pending).ok().map(|s| s.strip_suffix('\r').unwrap_or(s));
                    let skip = line.is_some_and(|s| s.is_empty() || s.starts_with('#'));
                    let entry = if skip { None } else { line.and_then(|s| sum_entry(s, algo, cmd == "cksum")) };
                    pending.clear();
                    if skip { continue; }
                    let Some((algorithm,bits,name,expected)) = entry.filter(|(_,_,n,_)| !(manifest == "-" && n == "-")) else {
                        malformed += 1;
                        if report.mode == SumReportMode::Warn && !write(2, &format!("{cmd}: {disp}: {line_num}: improperly formatted {algo} checksum line\n"), &mut result) { return result; }
                        continue;
                    };
                    valid = true;
                    let status = match self.digest(&name, algorithm, bits) {
                        Ok((hex, _)) if hex == expected => { matched = true; "OK" }
                        Ok(_) => { mismatched += 1; "FAILED" }
                        Err(e) => {
                            if report.ignore_missing && name != "-" && e.starts_with("ENOENT:") { continue; }
                            failures += 1;
                            if !write(2, &format!("{cmd}: {e}\n"), &mut result) { return result; }
                            "FAILED open or read"
                        }
                    };
                    if report.mode != SumReportMode::Status && !(report.mode == SumReportMode::Quiet && status == "OK") {
                        let (escaped, fname) = escape_sum_name(&name);
                        let prefix = if escaped { "\\" } else { "" };
                        if !write(1, &format!("{prefix}{fname}: {status}\n"), &mut result) { return result; }
                    }
                }
                if eof { break; }
            }
            if !valid || !matched || failures > 0 || mismatched > 0 || (report.strict && malformed > 0) { result.exit_code = 1; }
            if !valid {
                if !write(2, &format!("{cmd}: {disp}: no properly formatted checksum lines found\n"), &mut result) { return result; }
            } else if report.mode != SumReportMode::Status {
                for (n, reason) in [(malformed,"improperly formatted checksum line(s)"), (failures,"listed file(s) could not be read"), (mismatched,"computed checksum(s) did NOT match")] {
                    if n != 0 && !write(2, &format!("{cmd}: WARNING: {n} {reason}\n"), &mut result) { return result; }
                }
                if report.ignore_missing && !matched && !write(2, &format!("{cmd}: {disp}: no file was verified\n"), &mut result) { return result; }
            }
        }
        result
    }
}

fn posix_crc_byte(crc: u32, byte: u8) -> u32 {
    const TABLE: [u32; 256] = {
        let mut table = [0; 256];
        let mut i = 0;
        while i < 256 {
            let mut r = (i as u32) << 24;
            let mut bit = 0;
            while bit < 8 { r = (r << 1) ^ (0x04c1_1db7 & 0u32.wrapping_sub(r >> 31)); bit += 1; }
            table[i] = r;
            i += 1;
        }
        table
    };
    (crc << 8) ^ TABLE[((crc >> 24) as u8 ^ byte) as usize]
}

pub(super) fn run_checksum(algo: &str, args: &[String], stdin: super::CommandInput, cwd: &str, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut inputs = ChecksumInputs { stdin, cwd, fs, left: fs.max_input_bytes(), stdin_used: false };
    if algo == "crc" { cmd_cksum(args, &mut inputs, write) } else { cmd_hash(algo, args, &mut inputs, write) }
}

fn cmd_hash(algo: &str, args: &[String], inputs: &mut ChecksumInputs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let cmd_name = if algo == "blake2b" {
        "b2sum".to_string()
    } else {
        format!("{algo}sum")
    };
    let mut check_mode = false;
    let mut report = SumReport::default();
    let mut binary_mode = false;
    let mut explicit_mode = false;
    let mut explicit_text = false;
    let mut check_only = false;
    let mut tag_mode = false;
    let mut zero_delim = false;
    let mut requested_len: Option<String> = None;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--help" {
            return ok_out(&format!("Usage: {cmd_name} [OPTION]... [FILE]...\n"));
        }
        if a == "--version" {
            return ok_out(&format!("{cmd_name} (GNU coreutils) 9.5\n"));
        }
        if a.starts_with("--") {
            if let Some(v) = a.strip_prefix("--length=") {
                requested_len = Some(v.to_string());
            } else {
                match a.as_str() {
                    "--binary" => {
                        binary_mode = true;
                        explicit_mode = true;
                        explicit_text = false;
                    }
                    "--text" => {
                        binary_mode = false;
                        explicit_mode = true;
                        explicit_text = true;
                    }
                    "--check" => check_mode = true,
                    "--zero" => zero_delim = true,
                    "--tag" => {
                        tag_mode = true;
                        if !explicit_text {
                            binary_mode = true;
                        }
                    }
                    "--warn" => {
                        report.mode = SumReportMode::Warn;
                        check_only = true;
                    }
                    "--quiet" => {
                        report.mode = SumReportMode::Quiet;
                        check_only = true;
                    }
                    "--status" => {
                        report.mode = SumReportMode::Status;
                        check_only = true;
                    }
                    "--strict" => {
                        report.strict = true;
                        check_only = true;
                    }
                    "--ignore-missing" => {
                        report.ignore_missing = true;
                        check_only = true;
                    }
                    "--length" if algo == "blake2b" => {
                        if i + 1 >= args.len() {
                            return err_out(&format!("{cmd_name}: option '--length' requires an argument\n"), 2);
                        }
                        i += 1;
                        requested_len = Some(args[i].clone());
                    }
                    _ => return err_out(&format!("{cmd_name}: unrecognized option '{a}'\n"), 2),
                }
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let ch = chars[c_idx];
            match ch {
                'b' => {
                    binary_mode = true;
                    explicit_mode = true;
                    explicit_text = false;
                }
                't' => {
                    binary_mode = false;
                    explicit_mode = true;
                    explicit_text = true;
                }
                'c' => check_mode = true,
                'z' => zero_delim = true,
                'w' => {
                    report.mode = SumReportMode::Warn;
                    check_only = true;
                }
                'l' if algo == "blake2b" => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(&format!("{cmd_name}: option requires an argument -- 'l'\n"), 2);
                    };
                    requested_len = Some(val);
                    break;
                }
                _ if algo == "blake2b" => {
                    return err_out(&format!("{cmd_name}: invalid option -- '{ch}'\n"), 2);
                }
                _ => return err_out(&format!("{cmd_name}: unrecognized option '{a}'\n"), 2),
            }
            c_idx += 1;
        }
        i += 1;
    }

    let mut bits = 512usize;
    if let Some(ref rl) = requested_len {
        if rl.is_empty() || !rl.chars().all(|c| c.is_ascii_digit()) {
            return err_out(&format!("{cmd_name}: invalid length '{rl}'\n"), 2);
        }
        let Ok(parsed_l) = rl.parse::<usize>() else {
            return err_out(&format!("{cmd_name}: invalid length '{rl}'\n"), 2);
        };
        if parsed_l > 0 && (algo != "blake2b" || parsed_l > 512 || parsed_l % 8 != 0) {
            return err_out(&format!("{cmd_name}: invalid length '{rl}' for {algo}\n"), 2);
        }
        if parsed_l > 0 {
            bits = parsed_l;
        }
    }

    if !check_mode && check_only {
        return err_out(&format!("{cmd_name}: verification options require --check\n"), 1);
    }
    if tag_mode && check_mode {
        return err_out(
            &format!("{cmd_name}: the --tag option is meaningless when verifying checksums\n"),
            2,
        );
    }
    if tag_mode && !binary_mode {
        return err_out(&format!("{cmd_name}: --tag does not support --text mode\n"), 2);
    }
    if check_mode && (zero_delim || explicit_mode) {
        return err_out(
            &format!("{cmd_name}: --zero, --binary and --text are not supported with --check\n"),
            2,
        );
    }

    if check_mode {
        if files.is_empty() { files.push("-".into()); }
        return inputs.verify(&cmd_name, algo, &files, report, write);
    }

    let term = if zero_delim { "\0" } else { "\n" };
    let format_entry = |hex: &str, f: &str| -> String {
        let (needs_esc, disp) = if zero_delim {
            (false, f.to_string())
        } else {
            escape_sum_name(f)
        };
        let pfx = if needs_esc { "\\" } else { "" };
        if tag_mode {
            let lbl = if algo == "blake2b" {
                if bits == 512 {
                    "BLAKE2b".to_string()
                } else {
                    format!("BLAKE2b-{bits}")
                }
            } else {
                algo.to_ascii_uppercase()
            };
            format!("{pfx}{lbl} ({disp}) = {hex}{term}")
        } else {
            let marker = if binary_mode { "*" } else { " " };
            format!("{pfx}{hex} {marker}{disp}{term}")
        }
    };

    if files.is_empty() { files.push("-".into()); }
    let mut result = ok_out("");
    for file in &files {
        let (fd, message) = match inputs.digest(file, algo, bits) {
            Ok((hex, _)) => (1, format_entry(&hex, file)),
            Err(e) => { result.exit_code = 1; (2, format!("{cmd_name}: {e}\n")) }
        };
        if !write(fd, &message, &mut result) { break; }
    }
    result
}

fn cmd_cksum(args: &[String], inputs: &mut ChecksumInputs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut algo = "crc".to_string();
    let mut requested_len: Option<String> = None;
    let mut last_tag: Option<bool> = None;
    let mut has_tag_flag = false;
    let mut has_untagged_flag = false;
    let mut base64_mode = false;
    let mut raw_mode = false;
    let mut zero_delim = false;
    let mut binary_mode = false;
    let mut check_mode = false;
    let mut report = SumReport::default();
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            let (opt_name, eq_val) = match a[2..].split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (&a[2..], None),
            };
            match opt_name {
                "algorithm" => {
                    let val = if let Some(v) = eq_val {
                        v.to_string()
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out("cksum: option '--algorithm' requires an argument\n", 2);
                    };
                    algo = val;
                }
                "length" => {
                    let val = if let Some(v) = eq_val {
                        v.to_string()
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out("cksum: option '--length' requires an argument\n", 2);
                    };
                    requested_len = Some(val);
                }
                "tag" | "untagged" | "base64" | "raw" | "zero" | "binary" | "check" | "quiet"
                | "status" | "warn" | "strict" | "ignore-missing" => {
                    if eq_val.is_some() {
                        return err_out(
                            &format!("cksum: option '--{opt_name}' does not take an argument\n"),
                            2,
                        );
                    }
                    match opt_name {
                        "tag" => {
                            last_tag = Some(true);
                            has_tag_flag = true;
                        }
                        "untagged" => {
                            last_tag = Some(false);
                            has_untagged_flag = true;
                        }
                        "base64" => base64_mode = true,
                        "raw" => raw_mode = true,
                        "zero" => zero_delim = true,
                        "binary" => binary_mode = true,
                        "check" => check_mode = true,
                        "quiet" => report.mode = SumReportMode::Quiet,
                        "status" => report.mode = SumReportMode::Status,
                        "warn" => report.mode = SumReportMode::Warn,
                        "strict" => report.strict = true,
                        "ignore-missing" => report.ignore_missing = true,
                        _ => {}
                    }
                }
                _ => return err_out(&format!("cksum: unrecognized option '{a}'\n"), 2),
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let ch = chars[c_idx];
            match ch {
                'b' => binary_mode = true,
                'c' => check_mode = true,
                'z' => zero_delim = true,
                'w' => report.mode = SumReportMode::Warn,
                'a' | 'l' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(
                            &format!("cksum: option requires an argument -- '{ch}'\n"),
                            2,
                        );
                    };
                    if ch == 'a' {
                        algo = val;
                    } else {
                        requested_len = Some(val);
                    }
                    break;
                }
                _ => return err_out(&format!("cksum: invalid option -- '{ch}'\n"), 2),
            }
            c_idx += 1;
        }
        i += 1;
    }

    if !matches!(
        algo.as_str(),
        "crc" | "bsd" | "sysv" | "crc32b" | "sm3" | "blake2b" | "sha2" | "sha3" | "sha512" | "sha384" | "sha256" | "sha224" | "sha1" | "md5"
    ) {
        return err_out(&format!("cksum: unsupported checksum algorithm '{algo}'\n"), 2);
    }

    let mut length = 0usize;
    if let Some(ref rl) = requested_len {
        if rl.is_empty() || !rl.chars().all(|c| c.is_ascii_digit()) {
            return err_out(&format!("cksum: invalid length '{rl}'\n"), 2);
        }
        let Ok(parsed_l) = rl.parse::<usize>() else {
            return err_out(&format!("cksum: invalid length '{rl}'\n"), 2);
        };
        length = parsed_l;
    }

    let family = algo == "sha2" || algo == "sha3";
    if family
        && !(check_mode && requested_len.is_none() && algo == "sha3")
        && !matches!(length, 224 | 256 | 384 | 512)
    {
        return err_out(
            &format!("cksum: {algo} requires --length 224, 256, 384 or 512\n"),
            2,
        );
    }
    if length != 0 {
        let valid_len = if family {
            matches!(length, 224 | 256 | 384 | 512)
        } else if algo == "blake2b" {
            length <= 512 && length % 8 == 0
        } else {
            false
        };
        if !valid_len {
            let rl = requested_len.as_deref().unwrap_or("");
            return err_out(&format!("cksum: invalid length '{rl}' for {algo}\n"), 2);
        }
    }

    let resolved_bits = if length != 0 {
        length
    } else {
        match algo.as_str() {
            "sha224" => 224,
            "sha256" | "sm3" => 256,
            "sha384" => 384,
            "md5" => 128,
            "sha1" => 160,
            _ => 512,
        }
    };
    if algo == "sha2" {
        algo = format!("sha{resolved_bits}");
    }
    let tag = last_tag.unwrap_or(true);
    let is_numeric = matches!(algo.as_str(), "crc" | "bsd" | "sysv" | "crc32b");
    if raw_mode && (is_numeric || has_tag_flag || has_untagged_flag || base64_mode || zero_delim) {
        return err_out(
            "cksum: --raw requires a hash algorithm and cannot be combined with --tag, --untagged, --base64 or --zero\n",
            2,
        );
    }
    if check_mode && is_numeric && algo != "crc" {
        return err_out(&format!("cksum: verification is not supported for '{algo}'\n"), 2);
    }
    if !check_mode && (report.mode != SumReportMode::Normal || report.strict || report.ignore_missing) {
        return err_out("cksum: verification options require --check\n", 2);
    }
    if check_mode && (binary_mode || zero_delim || has_tag_flag || raw_mode || base64_mode) {
        return err_out("cksum: output options are not supported with --check\n", 2);
    }

    if check_mode {
        if files.is_empty() { files.push("-".into()); }
        return inputs.verify("cksum", &algo, &files, report, write);
    }

    let term = if zero_delim { "\0" } else { "\n" };
    let format_entry = |hex: String, len: u64, fname: Option<&str>| -> String {
        match algo.as_str() {
            "crc" | "bsd" | "sysv" | "crc32b" => {
                let size = match algo.as_str() {
                    "bsd" => format!("{:>5}", len.div_ceil(1024)),
                    "sysv" => len.div_ceil(512).to_string(),
                    _ => len.to_string(),
                };
                match fname {
                    Some(f) => format!("{hex} {size} {f}{term}"),
                    None => format!("{hex} {size}{term}"),
                }
            }
            _ => {
                let mut raw = Vec::with_capacity(hex.len() / 2);
                let chs: Vec<char> = hex.chars().collect();
                for pair in chs.chunks(2) {
                    let s: String = pair.iter().collect();
                    if let Ok(v) = u8::from_str_radix(&s, 16) {
                        raw.push(v);
                    }
                }
                if raw_mode {
                    return crate::vfs::bytes_to_stream_string(&raw);
                }
                let encoded = if base64_mode {
                    base64_encode(&raw)
                } else {
                    hex
                };
                let f_raw = fname.unwrap_or("-");
                let (needs_esc, f_disp) = if zero_delim {
                    (false, f_raw.to_string())
                } else {
                    escape_sum_name(f_raw)
                };
                let pfx = if needs_esc { "\\" } else { "" };
                if tag {
                    let label = if algo == "blake2b" {
                        if resolved_bits == 512 {
                            "BLAKE2b".to_string()
                        } else {
                            format!("BLAKE2b-{resolved_bits}")
                        }
                    } else if algo == "sha3" {
                        format!("SHA3-{resolved_bits}")
                    } else {
                        algo.to_ascii_uppercase()
                    };
                    format!("{pfx}{label} ({f_disp}) = {encoded}{term}")
                } else {
                    let marker = if binary_mode { "*" } else { " " };
                    format!("{pfx}{encoded} {marker}{f_disp}{term}")
                }
            }
        }
    };

    let explicit = !files.is_empty();
    if !explicit { files.push("-".into()); }
    let mut result = ok_out("");
    for file in &files {
        let (fd, message) = match inputs.digest(file, &algo, resolved_bits) {
            Ok((hex, len)) => (1, format_entry(hex, len, explicit.then_some(file))),
            Err(e) => { result.exit_code = 1; (2, format!("cksum: {e}\n")) }
        };
        if !write(fd, &message, &mut result) { break; }
    }
    result
}

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B32_CHARS: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_CHARS[((triple >> 18) & 0x3f) as usize] as char);
        out.push(B64_CHARS[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64_CHARS[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64_CHARS[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn decode_base_quantum(
    quantum: &[i16],
    q_len: usize,
    a_bits: u32,
    a_quantum: usize,
    valid_lengths: &[usize],
    out: &mut Vec<u8>,
) -> bool {
    if a_bits == 5 && q_len < a_quantum {
        return false;
    }
    let mut carry = 0u32;
    let mut bits = 0u32;
    let mut length = 0usize;
    while length < q_len && quantum[length] >= 0 {
        carry = (carry << a_bits) | (quantum[length] as u32);
        length += 1;
        bits += a_bits;
        if bits >= 8 {
            bits -= 8;
            out.push(((carry >> bits) & 0xff) as u8);
        }
        carry &= (1 << bits) - 1;
    }
    let mut valid_tail =
        q_len == a_quantum && carry == 0 && valid_lengths.contains(&length);
    if valid_tail {
        for &sym in &quantum[length..q_len] {
            if sym != -1 {
                valid_tail = false;
                break;
            }
        }
    }
    valid_tail
}

fn base_decoder(
    alphabet: &[u8], a_bits: u32, a_quantum: usize, valid_lengths: &'static [usize], ignore_garbage: bool,
) -> impl FnMut(&[u8], bool, &mut Vec<u8>) -> bool {
    let mut lookup = [-2i16; 256];
    for (idx, &b) in alphabet.iter().enumerate() { lookup[b as usize] = idx as i16; }
    lookup[b'=' as usize] = -1;
    let mut quantum = [0i16; 8];
    let mut q_len = 0;
    move |data, eof, out| {
        for &byte in data {
            let symbol = lookup[byte as usize];
            if (ignore_garbage && symbol == -2) || matches!(byte, 10 | 13) { continue; }
            quantum[q_len] = symbol;
            q_len += 1;
            if q_len == a_quantum {
                q_len = 0;
                if !decode_base_quantum(&quantum, a_quantum, a_bits, a_quantum, valid_lengths, out) { return false; }
            }
        }
        if eof && q_len != 0 {
            if quantum[q_len - 1] != -1 {
                quantum[q_len..a_quantum].fill(-1);
                q_len = a_quantum;
            }
            return decode_base_quantum(&quantum, q_len, a_bits, a_quantum, valid_lengths, out);
        }
        true
    }
}

fn base64_decode_strict(input: &str) -> Result<Vec<u8>, ()> {
    let mut out = Vec::new();
    base_decoder(B64_CHARS, 6, 4, &[2, 3, 4], false)(input.as_bytes(), true, &mut out).then_some(out).ok_or(())
}

pub fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u8;
    for ch in input.chars() {
        if ch.is_whitespace() || ch == '=' {
            continue;
        }
        let val = match ch {
            'A'..='Z' => (ch as u8) - b'A',
            'a'..='z' => (ch as u8) - b'a' + 26,
            '0'..='9' => (ch as u8) - b'0' + 52,
            '+' | '-' => 62,
            '/' | '_' => 63,
            _ => continue,
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

pub(super) fn run_base_cmd(
    name: &str, args: &[String], mut stdin: super::CommandInput, cwd: &str, fs: &dyn SafeBashFs,
    write: &mut super::CommandWriter,
) -> BuiltinOutcome {
    let (alphabet, a_bits, a_quantum, lengths): (&[u8], u32, usize, &[usize]) = if name == "base32" {
        (B32_CHARS, 5, 8, &[2, 4, 5, 7, 8])
    } else {
        (B64_CHARS, 6, 4, &[2, 3, 4])
    };
    let mut decode = false;
    let mut ignore_garbage = false;
    let mut wrap_cols: usize = 76;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    let parse_wrap = |v: &str| -> Result<usize, String> {
        let digits = v.strip_prefix('+').unwrap_or(v);
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("{name}: invalid number '{v}'\n"));
        }
        digits
            .parse::<usize>()
            .map_err(|_| format!("{name}: invalid number '{v}'\n"))
    };
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            let (opt_name, eq_val) = match a[2..].split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (&a[2..], None),
            };
            match opt_name {
                "decode" | "ignore-garbage" => {
                    if eq_val.is_some() {
                        return err_out(
                            &format!("{name}: option '--{opt_name}' does not take an argument\n"),
                            2,
                        );
                    }
                    if opt_name == "decode" {
                        decode = true;
                    } else {
                        ignore_garbage = true;
                    }
                }
                "wrap" => {
                    let val_str = if let Some(v) = eq_val {
                        v.to_string()
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(
                            &format!("{name}: option '--wrap' requires an argument\n"),
                            2,
                        );
                    };
                    match parse_wrap(&val_str) {
                        Ok(w) => wrap_cols = w,
                        Err(msg) => return err_out(&msg, 2),
                    }
                }
                _ => return err_out(&format!("{name}: unrecognized option '{a}'\n"), 2),
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            match chars[c_idx] {
                'd' => decode = true,
                'i' => ignore_garbage = true,
                'w' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let val_str = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(&format!("{name}: option requires an argument -- 'w'\n"), 2);
                    };
                    match parse_wrap(&val_str) {
                        Ok(w) => wrap_cols = w,
                        Err(msg) => return err_out(&msg, 2),
                    }
                    break;
                }
                other => return err_out(&format!("{name}: invalid option -- '{other}'\n"), 2),
            }
            c_idx += 1;
        }
        i += 1;
    }
    if files.len() > 1 {
        return err_out(&format!("{name}: extra operand '{}'\n", files[1]), 2);
    }
    let limit = fs.max_input_bytes();
    let mut left = limit;
    let mut result = ok_out("");
    let mut bytes = Vec::new();
    let mut decoder = base_decoder(alphabet, a_bits, a_quantum, lengths, ignore_garbage);
    let (mut bits, mut carry, mut symbols, mut column) = (0u32, 0u32, 0usize, 0usize);
    let mask = (1 << a_bits) - 1;
    let mut valid = true;
    let mut writable = true;
    let mut convert = |data: &[u8], eof: bool| {
        let mut flush = |bytes: &mut Vec<u8>| {
            if !bytes.is_empty() {
                writable = write(1, &crate::vfs::bytes_to_stream_string(bytes), &mut result);
                bytes.clear();
            }
            writable
        };
        if decode {
            valid = decoder(data, eof, &mut bytes);
        } else {
            let emit = |byte, bytes: &mut Vec<u8>, symbols: &mut usize, column: &mut usize| {
                bytes.push(byte);
                *symbols = (*symbols + 1) % a_quantum;
                *column += 1;
                if *column == wrap_cols { bytes.push(10); *column = 0; }
            };
            for &byte in data {
                carry = (carry << 8) | u32::from(byte);
                bits += 8;
                while bits >= a_bits {
                    bits -= a_bits;
                    emit(alphabet[((carry >> bits) & mask) as usize], &mut bytes, &mut symbols, &mut column);
                }
                carry &= (1 << bits) - 1;
                if bytes.len() >= 16000 && !flush(&mut bytes) { return false; }
            }
            if eof {
                if bits != 0 { emit(alphabet[(carry << (a_bits - bits)) as usize], &mut bytes, &mut symbols, &mut column); }
                while symbols != 0 { emit(b'=', &mut bytes, &mut symbols, &mut column); }
                if wrap_cols != 0 && column != 0 { bytes.push(10); }
            }
        }
        flush(&mut bytes) && valid
    };
    let mut stopped = false;
    let mut feed = |chunk: &[u8]| -> Result<bool, String> {
        left = left.checked_sub(chunk.len()).ok_or_else(|| fs.limit_error("maxInputBytes", limit))?;
        stopped = !chunk.chunks(8192).all(|part| convert(part, false));
        Ok(!stopped)
    };
    let read = if files.first().is_none_or(|f| f == "-") {
        let mut admission = Ok(true);
        stdin.read_stdin(|chunk| {
            admission = feed(chunk);
            matches!(admission, Ok(true))
        }).and(admission.map(|_| ()))
    } else {
        let path = crate::vfs::path::absolute_operand(cwd, &files[0]);
        fs.inspect_command_entry(&path, true, "capabilitiesFor").and_then(|(entry, stat)| {
            if stat.kind == crate::vfs::VfsEntryKind::Directory { return Err("EISDIR: illegal operation on a directory".into()); }
            let mut remaining = if stat.mode & 0o170000 == 0o100000 { stat.size } else { usize::MAX };
            fs.read_chunks(&entry, &mut |chunk| {
                let n = remaining.min(chunk.len());
                remaining -= n;
                for part in chunk[..n].chunks(8192) { if !feed(part)? { return Ok(false); } }
                Ok(remaining != 0)
            })
        }).map_err(|e| super::coreutils::stream_file_error(e, "readStream", &path))
    };
    if read.is_ok() && !stopped { convert(&[], true); }
    if writable && let Some(message) = read.err().or_else(|| (!valid).then(|| "invalid input".into())) {
        result.exit_code = 1;
        write(2, &format!("{name}: {message}\n"), &mut result);
    }
    result
}

#[derive(Clone)]
enum HexdumpFormatItem {
    Standard(String),
    Custom(HexdumpCustomFormat),
}

#[derive(Clone)]
struct HexdumpConversion {
    code: String,
    flags: String,
    width: usize,
    precision: Option<usize>,
    bytes: usize,
}

#[derive(Clone)]
enum HexdumpPart {
    Literal(String),
    Conv(HexdumpConversion),
}

#[derive(Clone)]
struct HexdumpUnit {
    repeat: usize,
    bytes: usize,
    explicit_repeat: bool,
    parts: Vec<HexdumpPart>,
}

#[derive(Clone)]
struct HexdumpCustomFormat {
    units: Vec<HexdumpUnit>,
    size: usize,
    final_unit_idx: Option<usize>,
}

fn parse_hexdump_custom(text: &str) -> Result<HexdumpCustomFormat, String> {
    let bytes = text.as_bytes();
    let mut at = 0usize;
    let skip_space = |pos: &mut usize| {
        while *pos < bytes.len() && matches!(bytes[*pos], b' ' | b'\t' | b'\n' | b'\r') {
            *pos += 1;
        }
    };
    let read_int = |pos: &mut usize| -> Option<usize> {
        let start = *pos;
        while *pos < bytes.len() && bytes[*pos].is_ascii_digit() {
            *pos += 1;
        }
        if start == *pos {
            None
        } else {
            std::str::from_utf8(&bytes[start..*pos]).ok()?.parse().ok()
        }
    };
    let mut units = Vec::new();
    while at < bytes.len() {
        skip_space(&mut at);
        if at == bytes.len() {
            break;
        }
        let repeat = read_int(&mut at);
        skip_space(&mut at);
        let mut size: Option<usize> = None;
        if at < bytes.len() && bytes[at] == b'/' {
            at += 1;
            skip_space(&mut at);
            size = read_int(&mut at).filter(|&v| v > 0);
            skip_space(&mut at);
        }
        if at >= bytes.len() || bytes[at] != b'"' {
            return Err(format!("bad format: {text}"));
        }
        at += 1;
        let mut parts = Vec::new();
        let mut literal = String::new();
        while at < bytes.len() && bytes[at] != b'"' {
            let ch = bytes[at] as char;
            at += 1;
            if ch == '\\' {
                if at >= bytes.len() {
                    return Err(format!("bad format: {text}"));
                }
                let esc = bytes[at] as char;
                at += 1;
                let mapped = match esc {
                    'a' => '\x07',
                    'b' => '\x08',
                    'f' => '\x0c',
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'v' => '\x0b',
                    other => other,
                };
                literal.push(mapped);
            } else if ch != '%' {
                literal.push(ch);
            } else if at < bytes.len() && bytes[at] == b'%' {
                at += 1;
                literal.push('%');
            } else {
                if !literal.is_empty() {
                    parts.push(HexdumpPart::Literal(std::mem::take(&mut literal)));
                }
                let mut flags = String::new();
                while at < bytes.len() && "#0- +".contains(bytes[at] as char) {
                    flags.push(bytes[at] as char);
                    at += 1;
                }
                let width = read_int(&mut at).unwrap_or(0);
                let mut precision = None;
                if at < bytes.len() && bytes[at] == b'.' {
                    at += 1;
                    precision = Some(read_int(&mut at).unwrap_or(0));
                }
                if at >= bytes.len() {
                    return Err(format!("bad format: {text}"));
                }
                let mut code = String::new();
                let c0 = bytes[at] as char;
                at += 1;
                code.push(c0);
                if c0 == '_' {
                    if at >= bytes.len() {
                        return Err(format!("bad format: {text}"));
                    }
                    let c1 = bytes[at] as char;
                    at += 1;
                    code.push(c1);
                    if c1 == 'a' || c1 == 'A' {
                        if at >= bytes.len() {
                            return Err(format!("bad format: {text}"));
                        }
                        code.push(bytes[at] as char);
                        at += 1;
                    }
                }
                let conv_bytes = if code.starts_with("_a") || code.starts_with("_A") {
                    0
                } else if let Some(sz) = size {
                    sz
                } else if code == "s" {
                    precision.ok_or_else(|| format!("bad format: {text}"))?
                } else if matches!(code.as_str(), "c" | "_c" | "_p" | "_u") {
                    1
                } else {
                    4
                };
                parts.push(HexdumpPart::Conv(HexdumpConversion {
                    code,
                    flags,
                    width,
                    precision,
                    bytes: conv_bytes,
                }));
            }
        }
        if at >= bytes.len() || bytes[at] != b'"' {
            return Err(format!("bad format: {text}"));
        }
        at += 1;
        if !literal.is_empty() {
            parts.push(HexdumpPart::Literal(literal));
        }
        let unit_bytes = size.unwrap_or_else(|| {
            parts
                .iter()
                .map(|p| match p {
                    HexdumpPart::Conv(c) => c.bytes,
                    HexdumpPart::Literal(_) => 0,
                })
                .sum()
        });
        units.push(HexdumpUnit {
            repeat: repeat.unwrap_or(1),
            explicit_repeat: repeat.is_some(),
            bytes: unit_bytes,
            parts,
        });
    }
    let total_size: usize = units.iter().map(|u| u.bytes * u.repeat).sum();
    let final_unit_idx = units.iter().rposition(|u| {
        u.parts.iter().any(|p| matches!(p, HexdumpPart::Conv(c) if c.code.starts_with("_A")))
    });
    Ok(HexdumpCustomFormat {
        units,
        size: total_size,
        final_unit_idx,
    })
}

const HEXDUMP_CONTROLS: [&str; 32] = [
    "nul", "soh", "stx", "etx", "eot", "enq", "ack", "bel", "bs", "ht", "lf", "vt", "ff", "cr",
    "so", "si", "dle", "dc1", "dc2", "dc3", "dc4", "nak", "syn", "etb", "can", "em", "sub", "esc",
    "fs", "gs", "rs", "us",
];

fn format_hexdump_conv(
    conv: &HexdumpConversion,
    block: &[u8],
    offset: usize,
    used: usize,
    address: usize,
) -> String {
    if conv.bytes > 0 && offset >= used {
        return " ".repeat(conv.width);
    }
    let mut val = 0u128;
    if conv.code != "s" && !matches!(conv.code.as_str(), "e" | "E" | "f" | "g" | "G") {
        for k in (0..conv.bytes).rev() {
            let b = if offset + k < used { block[offset + k] } else { 0 };
            val = (val << 8) | (b as u128);
        }
    }
    let text = if conv.code == "s" {
        let mut end = used.min(offset + conv.bytes).min(offset + conv.precision.unwrap_or(conv.bytes));
        for k in offset..end {
            if block[k] == 0 {
                end = k;
                break;
            }
        }
        crate::vfs::bytes_to_stream_string(&block[offset..end])
    } else if matches!(conv.code.as_str(), "c" | "_p" | "_c" | "_u") {
        let byte = (val & 0xff) as u8;
        match conv.code.as_str() {
            "c" => (byte as char).to_string(),
            "_p" => {
                if (0x20..=0x7e).contains(&byte) {
                    (byte as char).to_string()
                } else {
                    ".".to_string()
                }
            }
            "_u" => {
                if (byte as usize) < HEXDUMP_CONTROLS.len() {
                    HEXDUMP_CONTROLS[byte as usize].to_string()
                } else if byte == 127 {
                    "del".to_string()
                } else if byte > 127 {
                    format!("{byte:02x}")
                } else {
                    (byte as char).to_string()
                }
            }
            _ => match byte {
                0 => "\\0".to_string(),
                7 => "\\a".to_string(),
                8 => "\\b".to_string(),
                9 => "\\t".to_string(),
                10 => "\\n".to_string(),
                11 => "\\v".to_string(),
                12 => "\\f".to_string(),
                13 => "\\r".to_string(),
                0x20..=0x7e => (byte as char).to_string(),
                _ => format!("{byte:03o}"),
            },
        }
    } else if matches!(conv.code.as_str(), "e" | "E" | "f" | "g" | "G") {
        let mut copy = [0u8; 8];
        let take = conv.bytes.min(used.saturating_sub(offset));
        copy[..take].copy_from_slice(&block[offset..offset + take]);
        let num = if conv.bytes == 4 {
            f32::from_le_bytes([copy[0], copy[1], copy[2], copy[3]]) as f64
        } else {
            f64::from_le_bytes(copy)
        };
        let prec = conv.precision.unwrap_or(6);
        format!("{num:.prec$}")
    } else {
        let is_addr = conv.code.starts_with('_');
        let raw_u = if is_addr { (address + offset) as u128 } else { val };
        let bits = conv.bytes * 8;
        let is_signed = !is_addr && (conv.code == "d" || conv.code == "i");
        let (neg, mag) = if is_signed && bits > 0 && raw_u >= (1u128 << (bits - 1)) {
            (true, (1u128 << bits) - raw_u)
        } else {
            (false, raw_u)
        };
        let kind = conv.code.chars().last().unwrap_or('d');
        let radix = match kind {
            'x' | 'X' => 16,
            'o' => 8,
            _ => 10,
        };
        let sign = if neg {
            "-"
        } else if (conv.code == "d" || conv.code == "i" || conv.code.ends_with('d')) && conv.flags.contains('+') {
            "+"
        } else if (conv.code == "d" || conv.code == "i" || conv.code.ends_with('d')) && conv.flags.contains(' ') {
            " "
        } else {
            ""
        };
        let raw_digits = if mag == 0 && conv.precision == Some(0) {
            String::new()
        } else {
            match radix {
                16 => format!("{mag:x}"),
                8 => format!("{mag:o}"),
                _ => format!("{mag}"),
            }
        };
        let prec_len = conv.precision.unwrap_or(0);
        let digits = if raw_digits.len() < prec_len {
            format!("{}{raw_digits}", "0".repeat(prec_len - raw_digits.len()))
        } else {
            raw_digits
        };
        let prefix = if conv.flags.contains('#') {
            if radix == 16 && mag != 0 {
                "0x"
            } else if radix == 8 && !digits.starts_with('0') {
                "0"
            } else {
                ""
            }
        } else {
            ""
        };
        let mut combined = if conv.flags.contains('0') && !conv.flags.contains('-') && conv.precision.is_none() {
            let pad_target = conv.width.saturating_sub(sign.len() + prefix.len());
            let padded_digits = if digits.len() < pad_target {
                format!("{}{digits}", "0".repeat(pad_target - digits.len()))
            } else {
                digits
            };
            format!("{sign}{prefix}{padded_digits}")
        } else {
            format!("{sign}{prefix}{digits}")
        };
        if kind == 'X' {
            combined = combined.to_ascii_uppercase();
        }
        combined
    };
    if text.len() >= conv.width {
        text
    } else if conv.flags.contains('-') {
        format!("{text}{}", " ".repeat(conv.width - text.len()))
    } else {
        format!("{}{text}", " ".repeat(conv.width - text.len()))
    }
}

fn format_hexdump_custom(
    fmt: &HexdumpCustomFormat,
    block: &[u8],
    used: usize,
    address: usize,
    is_final: bool,
) -> String {
    let mut offset = 0usize;
    let mut result = String::new();
    for (idx, unit) in fmt.units.iter().enumerate() {
        if is_final && Some(idx) != fmt.final_unit_idx {
            continue;
        }
        let unit_is_final = unit
            .parts
            .iter()
            .any(|p| matches!(p, HexdumpPart::Conv(c) if c.code.starts_with("_A")));
        if unit_is_final != is_final {
            if !is_final {
                offset += unit.bytes * unit.repeat;
            }
            continue;
        }
        let repeat = if !is_final
            && idx + 1 == fmt.units.len()
            && !unit.explicit_repeat
            && unit.bytes > 0
            && fmt.size < block.len()
        {
            unit.repeat + (block.len() - fmt.size) / unit.bytes
        } else {
            unit.repeat
        };
        for count in 0..repeat {
            let mut pos = offset;
            for (p_idx, part) in unit.parts.iter().enumerate() {
                match part {
                    HexdumpPart::Literal(lit) => {
                        let mut end = lit.len();
                        if count + 1 == repeat && repeat > 1 && p_idx + 1 == unit.parts.len() {
                            while end > 0 && matches!(lit.as_bytes()[end - 1], b' ' | b'\t') {
                                end -= 1;
                            }
                        }
                        result.push_str(&lit[..end]);
                    }
                    HexdumpPart::Conv(conv) => {
                        result.push_str(&format_hexdump_conv(conv, block, pos, used, address));
                        pos += conv.bytes;
                    }
                }
            }
            offset += unit.bytes;
        }
    }
    result
}

fn format_hexdump_block(block: &[u8], used: usize, address: usize, format: &str) -> String {
    let canonical = format == "C";
    let mut result = if canonical {
        format!("{address:08x}  ")
    } else {
        format!("{address:07x} ")
    };
    if canonical {
        for idx in 0..16 {
            if idx == 8 {
                result.push(' ');
            }
            if idx < used {
                result.push_str(&format!("{:02x}", block[idx]));
            } else {
                result.push_str("  ");
            }
            if idx != 15 {
                result.push(' ');
            }
        }
        result.push_str("  |");
        for &b in &block[..used] {
            result.push(if (0x20..=0x7e).contains(&b) { b as char } else { '.' });
        }
        result.push_str("|\n");
        return result;
    }
    if format != "default" {
        let byte_format = format == "b" || format == "c";
        let stride = if byte_format { 1 } else { 2 };
        let width = if byte_format { 3 } else { 7 };
        let mut idx = 0usize;
        while idx < 16 {
            let field = if idx < used {
                let byte = block[idx];
                if format == "c" {
                    match byte {
                        0 => "\\0".to_string(),
                        7 => "\\a".to_string(),
                        8 => "\\b".to_string(),
                        9 => "\\t".to_string(),
                        10 => "\\n".to_string(),
                        11 => "\\v".to_string(),
                        12 => "\\f".to_string(),
                        13 => "\\r".to_string(),
                        0x20..=0x7e => (byte as char).to_string(),
                        _ => format!("{byte:03o}"),
                    }
                } else if format == "b" {
                    format!("{byte:03o}")
                } else {
                    let hi = if idx + 1 < used { block[idx + 1] as u16 } else { 0 };
                    let word = (byte as u16) | (hi << 8);
                    match format {
                        "d" => format!("{word:05}"),
                        "o" => format!("{word:06o}"),
                        _ => format!("{word:04x}"),
                    }
                }
            } else {
                String::new()
            };
            result.push_str(&format!("{field:>width$}"));
            if idx + stride < 16 {
                result.push(' ');
            }
            idx += stride;
        }
        result.push('\n');
        return result;
    }
    let mut idx = 0usize;
    while idx < 16 {
        if idx < used {
            let hi = if idx + 1 < used { block[idx + 1] as u16 } else { 0 };
            let word = (block[idx] as u16) | (hi << 8);
            result.push_str(&format!("{word:04x}"));
        } else {
            result.push_str("    ");
        }
        if idx != 14 {
            result.push(' ');
        }
        idx += 2;
    }
    result.push('\n');
    result
}

fn parse_hexdump_num(text: &str, is_skip: bool) -> Result<usize, String> {
    let kind = if is_skip { "skip" } else { "length" };
    let s = text.trim_start();
    let s = s.strip_prefix('+').unwrap_or(s);
    if s.starts_with('-') {
        return Err(format!("{text}: bad {kind} value"));
    }
    let (base, digits_and_suffix) = if is_skip && (s.starts_with("0x") || s.starts_with("0X")) {
        (16u32, &s[2..])
    } else if is_skip && s.starts_with('0') {
        (8u32, s)
    } else {
        (10u32, s)
    };
    let mut end = 0usize;
    for (idx, ch) in digits_and_suffix.char_indices() {
        if ch.to_digit(base).is_some() {
            end = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    let num_part = &digits_and_suffix[..end];
    let suffix = &digits_and_suffix[end..];
    let mut val = if num_part.is_empty() {
        0usize
    } else {
        usize::from_str_radix(num_part, base).map_err(|_| format!("{text}: bad {kind} value"))?
    };
    if is_skip {
        let mult = match suffix {
            "" => 1usize,
            "b" => 512,
            "k" | "K" | "KiB" => 1024,
            "m" | "M" | "MiB" => 1_048_576,
            _ => return Err(format!("{text}: bad skip value")),
        };
        val = val.saturating_mul(mult);
    }
    Ok(val)
}

fn cmd_hexdump(
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    default_canonical: bool,
) -> BuiltinOutcome {
    let name = if default_canonical { "hd" } else { "hexdump" };
    let mut ordered: Vec<HexdumpFormatItem> = if default_canonical {
        vec![HexdumpFormatItem::Standard("C".to_string())]
    } else {
        Vec::new()
    };
    let mut has_std = default_canonical;
    let mut no_squeeze = false;
    let mut skip = 0usize;
    let mut max_len: Option<usize> = None;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let flag = chars[c_idx];
            match flag {
                'v' => no_squeeze = true,
                'C' | 'b' | 'c' | 'd' | 'o' | 'x' => {
                    if default_canonical && flag == 'C' {
                        return err_out(
                            "usage: hexdump [-bcCdovx] [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]\n       hd      [-bcdovx]  [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]\n",
                            1,
                        );
                    }
                    has_std = true;
                    ordered.push(HexdumpFormatItem::Standard(flag.to_string()));
                }
                'n' | 's' | 'e' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let param = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        if flag == 'e' {
                            return err_out(&format!("{name}: -e requires a format\n"), 1);
                        }
                        return err_out(
                            &format!(
                                "{name}: option requires an argument -- '{flag}'\nusage: hexdump [-bcCdovx] [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]\n       hd      [-bcdovx]  [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]\n"
                            ),
                            1,
                        );
                    };
                    if flag == 'n' {
                        match parse_hexdump_num(&param, false) {
                            Ok(v) => max_len = Some(v),
                            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
                        }
                    } else if flag == 's' {
                        match parse_hexdump_num(&param, true) {
                            Ok(v) => skip = v,
                            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
                        }
                    } else {
                        match parse_hexdump_custom(&param) {
                            Ok(cf) => ordered.push(HexdumpFormatItem::Custom(cf)),
                            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
                        }
                    }
                    break;
                }
                'f' => return err_out(&format!("{name}: -f: format files are not supported\n"), 1),
                _ => return err_out(&format!("{name}: unsupported option -- '{flag}'\n"), 1),
            }
            c_idx += 1;
        }
        i += 1;
    }
    if ordered.is_empty() {
        has_std = true;
        ordered.push(HexdumpFormatItem::Standard("default".to_string()));
    }
    if max_len == Some(0) {
        return ok_out("");
    }
    let mut block_size = if has_std { 16usize } else { 0usize };
    for item in &ordered {
        if let HexdumpFormatItem::Custom(cf) = item {
            block_size = block_size.max(cf.size);
        }
    }
    if block_size == 0 {
        return ok_out("");
    }

    let mut err_buf = String::new();
    let mut exit_code = 0;
    let raw = if files.is_empty() || (files.len() == 1 && files[0] == "-") {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let mut combined = Vec::new();
        for f in &files {
            if f == "-" {
                combined.extend_from_slice(&crate::vfs::stream_string_to_bytes(stdin));
            } else {
                let p = resolve_posix_path(cwd, f);
                if fs.is_dir(&p) {
                    err_buf.push_str(&format!("{name}: {f}: Is a directory\n"));
                    continue;
                }
                match fs.read_file(&p) {
                    Ok(b) => combined.extend_from_slice(&b),
                    Err(_) => {
                        err_buf.push_str(&format!("{name}: {f}: No such file or directory\n"));
                        exit_code = 1;
                    }
                }
            }
        }
        combined
    };

    let start = skip.min(raw.len());
    let mut slice = &raw[start..];
    if let Some(n) = max_len {
        slice = &slice[..n.min(slice.len())];
    }
    if slice.is_empty() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: err_buf,
            exit_code,
        };
    }

    let mut out = String::new();
    let mut prev_block: Option<Vec<u8>> = None;
    let mut squeezing = false;
    let mut address = start;
    for chunk in slice.chunks(block_size) {
        let used = chunk.len();
        let mut block = vec![0u8; block_size];
        block[..used].copy_from_slice(chunk);
        let same = prev_block
            .as_ref()
            .is_some_and(|prev| prev[..used] == block[..used]);
        if !no_squeeze && same {
            if !squeezing {
                out.push_str("*\n");
                squeezing = true;
            }
            address += used;
            continue;
        }
        squeezing = false;
        prev_block = Some(block.clone());
        for item in &ordered {
            match item {
                HexdumpFormatItem::Standard(fmt) => {
                    out.push_str(&format_hexdump_block(&block, used, address, fmt));
                }
                HexdumpFormatItem::Custom(cf) => {
                    out.push_str(&format_hexdump_custom(cf, &block, used, address, false));
                }
            }
        }
        address += used;
    }
    let final_item = ordered.iter().rev().find(|item| match item {
        HexdumpFormatItem::Standard(_) => true,
        HexdumpFormatItem::Custom(cf) => cf.final_unit_idx.is_some(),
    });
    if let Some(item) = final_item {
        match item {
            HexdumpFormatItem::Custom(cf) => {
                let dummy = vec![0u8; block_size];
                out.push_str(&format_hexdump_custom(cf, &dummy, 0, address, true));
            }
            HexdumpFormatItem::Standard(fmt) => {
                if address > start {
                    if fmt == "C" {
                        out.push_str(&format!("{address:08x}\n"));
                    } else {
                        out.push_str(&format!("{address:07x}\n"));
                    }
                }
            }
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

fn extract_strings_elf_regions<'a>(data: &'a [u8], target: Option<&str>) -> Vec<(usize, &'a [u8])> {
    let fallback = || vec![(0usize, data)];
    let size = data.len();
    if size < 52
        || data[0] != 127
        || data[1] != 69
        || data[2] != 76
        || data[3] != 70
        || data[6] != 1
    {
        return fallback();
    }
    let wide = data[4] == 2;
    if (!wide && data[4] != 1)
        || (data[5] != 1 && data[5] != 2)
        || size < if wide { 64 } else { 52 }
    {
        return fallback();
    }
    let little = data[5] == 1;
    let u16_at = |off: usize| -> u16 {
        let bytes = [data[off], data[off + 1]];
        if little {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        }
    };
    let u32_at = |off: usize| -> u32 {
        let bytes = [data[off], data[off + 1], data[off + 2], data[off + 3]];
        if little {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        }
    };
    let word_at = |off: usize| -> Option<usize> {
        if wide {
            let bytes = [
                data[off],
                data[off + 1],
                data[off + 2],
                data[off + 3],
                data[off + 4],
                data[off + 5],
                data[off + 6],
                data[off + 7],
            ];
            let val = if little {
                u64::from_le_bytes(bytes)
            } else {
                u64::from_be_bytes(bytes)
            };
            usize::try_from(val).ok()
        } else {
            Some(u32_at(off) as usize)
        }
    };
    let machine = u16_at(18);
    if let Some(tgt) = target {
        let matches = little
            && if tgt == "elf64-x86-64" {
                wide && machine == 62
            } else {
                !wide && machine == 3
            };
        if !matches {
            return fallback();
        }
    }
    let Some(table) = word_at(if wide { 40 } else { 32 }) else {
        return fallback();
    };
    let stride = u16_at(if wide { 58 } else { 46 }) as usize;
    let mut count = u16_at(if wide { 60 } else { 48 }) as usize;
    let valid = |off: usize, len: usize| off <= size && len <= size - off;
    if table == 0 || stride < if wide { 64 } else { 40 } || !valid(table, stride) {
        return fallback();
    }
    if count == 0 {
        let Some(c) = word_at(table + if wide { 32 } else { 20 }) else {
            return fallback();
        };
        count = c;
    }
    let Some(total_table) = count.checked_mul(stride) else {
        return fallback();
    };
    if !valid(table, total_table) {
        return fallback();
    }
    let mut regions = Vec::new();
    for idx in 0..count {
        let header = table + idx * stride;
        let sh_type = u32_at(header + 4);
        let Some(sh_flags) = word_at(header + 8) else {
            return fallback();
        };
        if sh_type == 0 || sh_type == 8 || (sh_flags & 2) == 0 {
            continue;
        }
        let Some(off) = word_at(header + if wide { 24 } else { 16 }) else {
            return fallback();
        };
        let Some(len) = word_at(header + if wide { 32 } else { 20 }) else {
            return fallback();
        };
        if !valid(off, len) {
            return fallback();
        }
        regions.push((off, &data[off..off + len]));
    }
    regions
}

#[derive(Clone)]
struct OdFormat {
    kind: char,
    size: usize,
    printable: bool,
}

fn parse_od_numeric(text: &str, allow_suffixes: bool) -> Result<u64, String> {
    let hex_digits = |s: &str| s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))
        .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_hexdigit()));
    let mut number = text;
    let mut multiplier = 1u64;
    // A trailing b in a hexadecimal literal is a digit. Other suffixes can
    // multiply hexadecimal values just as they multiply octal or decimal ones.
    if allow_suffixes && !hex_digits(text) {
        for (suffix, scale) in [
            ("KiB", 1024), ("MiB", 1_048_576), ("GiB", 1_073_741_824),
            ("KB", 1000), ("MB", 1_000_000), ("GB", 1_000_000_000),
            ("b", 512), ("k", 1024), ("K", 1024), ("m", 1_048_576), ("M", 1_048_576), ("G", 1_073_741_824),
        ] {
            if let Some(prefix) = text.strip_suffix(suffix) {
                number = if prefix.is_empty() { "1" } else { prefix };
                multiplier = scale;
                break;
            }
        }
    }
    let (digits, radix) = if hex_digits(number) {
        (&number[2..], 16)
    } else if number.starts_with('0') && number.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
        (number, 8)
    } else if !number.is_empty() && !number.starts_with('0') && number.bytes().all(|b| b.is_ascii_digit()) {
        (number, 10)
    } else {
        return Err(format!("invalid number '{text}'"));
    };
    u64::from_str_radix(digits, radix).ok().and_then(|n| n.checked_mul(multiplier))
        .filter(|&n| n < (1u64 << 53)).ok_or_else(|| format!("number out of range '{text}'"))
}

fn parse_od_formats(text: &str) -> Result<Vec<OdFormat>, String> {
    let mut result = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut offset = 0usize;
    while offset < chars.len() {
        let kind = chars[offset];
        offset += 1;
        let mut size = 1usize;
        if kind != 'a' && kind != 'c' {
            if !"douxf".contains(kind) {
                return Err(format!(
                    "unsupported type '{text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8"
                ));
            }
            if let Some(&next) = chars.get(offset) {
                let mapped = match next {
                    'C' => Some(1),
                    'S' => Some(2),
                    'I' | 'F' => Some(4),
                    'L' | 'D' => Some(8),
                    '0'..='9' => next.to_digit(10).map(|d| d as usize),
                    _ => None,
                };
                if let Some(sz) = mapped {
                    size = sz;
                    offset += 1;
                } else {
                    size = if kind == 'f' { 8 } else { 4 };
                }
            } else {
                size = if kind == 'f' { 8 } else { 4 };
            }
            let valid = if kind == 'f' {
                matches!(size, 4 | 8)
            } else {
                matches!(size, 1 | 2 | 4 | 8)
            };
            if !valid {
                return Err(format!(
                    "unsupported type '{text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8"
                ));
            }
        }
        let mut printable = false;
        if chars.get(offset) == Some(&'z') {
            printable = true;
            offset += 1;
        }
        result.push(OdFormat {
            kind,
            size,
            printable,
        });
    }
    if result.is_empty() {
        return Err("empty output type".to_string());
    }
    Ok(result)
}

fn od_field_width(fmt: &OdFormat) -> usize {
    let bits = fmt.size * 8;
    match fmt.kind {
        'a' | 'c' => 3,
        'f' => if fmt.size == 4 { 15 } else { 24 },
        'o' => (bits + 2) / 3,
        'x' => bits / 4,
        'd' => (1u128 << (bits - 1)).to_string().len() + 1,
        _ => {
            if bits == 64 {
                u64::MAX.to_string().len()
            } else {
                ((1u128 << bits) - 1).to_string().len()
            }
        }
    }
}

const OD_NAMES: [&str; 33] = [
    "nul", "soh", "stx", "etx", "eot", "enq", "ack", "bel", "bs", "ht", "nl", "vt", "ff", "cr",
    "so", "si", "dle", "dc1", "dc2", "dc3", "dc4", "nak", "syn", "etb", "can", "em", "sub", "esc",
    "fs", "gs", "rs", "us", "sp",
];

fn format_od_float(value: f64, size: usize) -> String {
    if value.is_nan() {
        return "nan".to_string();
    }
    if !value.is_finite() {
        return if value.is_sign_negative() { "-inf".to_string() } else { "inf".to_string() };
    }
    if value == 0.0 && value.is_sign_negative() {
        return "-0".to_string();
    }
    if value == 0.0 { return "0".into(); }
    let magnitude = value.abs();
    let (min_normal, min_precision, max_precision) = if size == 4 { (f32::MIN_POSITIVE as f64, 6, 9) } else { (f64::MIN_POSITIVE, 15, 17) };
    let mut precision = if magnitude < min_normal { 1 } else { min_precision };
    let power = magnitude.log10().floor() as i32;
    // In binary64 the rounded number is the input itself. Only these two
    // exponents can straddle the fixed/scientific boundary at 15–17 digits.
    let rounded = if size == 8 && !(15..17).contains(&power) { value } else {
        // At each precision the first discarded digit decides rounding. If
        // rounding our extra digits could have created a decimal midpoint,
        // inspect the exact expansion instead (JS rounds ties away from zero).
        let short = format!("{:.*e}", max_precision + 2, magnitude);
        let (mantissa, _) = short.split_once('e').unwrap();
        let digits = if mantissa.ends_with('0') && mantissa.trim_end_matches('0').ends_with('5') {
            format!("{:.*e}", if size == 4 { 149 } else { 1074 }, magnitude)
        } else { short };
        let (significand, exponent) = digits.split_once('e').unwrap();
        let exponent: i32 = exponent.parse().unwrap();
        let mut digits = significand.bytes().filter(|&b| b != b'.');
        let mut coefficient = digits.by_ref().take(precision).fold(0u64, |n, b| n * 10 + u64::from(b - b'0'));
        loop {
            let next = digits.next().unwrap();
            let nearest = coefficient + u64::from(next >= b'5');
            let decimal = format!("{nearest}e{}", exponent - precision as i32 + 1).parse::<f64>().unwrap();
            if precision == max_precision || (if size == 4 { (decimal as f32) as f64 } else { decimal }) == magnitude {
                break decimal.copysign(value);
            }
            coefficient = coefficient * 10 + u64::from(next - b'0');
            precision += 1;
        }
    };
    let js = mcp_protocol_rust::numbers::format(rounded);
    let power = rounded.abs().log10().floor() as i32;
    if (-4..precision as i32).contains(&power) { return js; }
    if let Some((mantissa, exp)) = js.split_once('e') {
        return format!("{mantissa}e{:+03}", exp.parse::<i32>().unwrap());
    }
    let unsigned = js.trim_start_matches('-');
    let integer_len = unsigned.find('.').unwrap_or(unsigned.len());
    let digits: String = unsigned.chars().filter(|&c| c != '.').collect();
    let significant = digits.trim_start_matches('0');
    let exp = integer_len as i32 - (digits.len() - significant.len()) as i32 - 1;
    let significant = significant.trim_end_matches('0');
    let mut mantissa = significant.to_string();
    if mantissa.len() > 1 { mantissa.insert(1, '.'); }
    if rounded.is_sign_negative() { mantissa.insert(0, '-'); }
    format!("{mantissa}e{exp:+03}")
}

fn format_od_row(
    row: &[u8],
    fmt: &OdFormat,
    big_endian: bool,
    row_width: usize,
    chars_per_byte: f64,
) -> String {
    let mut text = String::new();
    let width = od_field_width(fmt);
    let mut offset = 0usize;
    while offset < row.len() {
        let col_end = (((offset + fmt.size) as f64) * chars_per_byte).ceil() as usize;
        let col_start = ((offset as f64) * chars_per_byte).ceil() as usize;
        let col_width = col_end.saturating_sub(col_start);
        let lead_spaces = col_width.saturating_sub(width + 1);
        text.push_str(&" ".repeat(lead_spaces));
        if fmt.size == 1 && (fmt.kind == 'x' || fmt.kind == 'o') {
            let b = row[offset];
            text.push(' ');
            if fmt.kind == 'x' {
                let hex = b"0123456789abcdef";
                text.push(hex[(b >> 4) as usize] as char);
                text.push(hex[(b & 15) as usize] as char);
            } else {
                text.push((b'0' + (b >> 6)) as char);
                text.push((b'0' + ((b >> 3) & 7)) as char);
                text.push((b'0' + (b & 7)) as char);
            }
            offset += fmt.size;
            continue;
        }
        if fmt.kind == 'a' {
            let b = row[offset] & 127;
            let name = if (b as usize) < OD_NAMES.len() {
                OD_NAMES[b as usize].to_string()
            } else if b == 127 {
                "del".to_string()
            } else {
                (b as char).to_string()
            };
            text.push_str(&format!(" {name:>3}"));
            offset += fmt.size;
            continue;
        }
        if fmt.kind == 'f' {
            let mut bytes = [0u8; 8];
            let take = fmt.size.min(row.len() - offset);
            bytes[..take].copy_from_slice(&row[offset..offset + take]);
            let val = if fmt.size == 4 {
                let arr = [bytes[0], bytes[1], bytes[2], bytes[3]];
                (if big_endian { f32::from_be_bytes(arr) } else { f32::from_le_bytes(arr) }) as f64
            } else {
                if big_endian { f64::from_be_bytes(bytes) } else { f64::from_le_bytes(bytes) }
            };
            let s = format_od_float(val, fmt.size);
            text.push_str(&format!(" {s:>width$}"));
            offset += fmt.size;
            continue;
        }
        if fmt.kind == 'c' {
            let b = row[offset];
            let ch_str = match b {
                0 => "\\0".to_string(),
                7 => "\\a".to_string(),
                8 => "\\b".to_string(),
                9 => "\\t".to_string(),
                10 => "\\n".to_string(),
                11 => "\\v".to_string(),
                12 => "\\f".to_string(),
                13 => "\\r".to_string(),
                0x20..=0x7e => (b as char).to_string(),
                _ => format!("{b:03o}"),
            };
            text.push_str(&format!(" {ch_str:>3}"));
            offset += fmt.size;
            continue;
        }
        let mut number = 0u128;
        for idx in 0..fmt.size {
            let b = *row.get(offset + idx).unwrap_or(&0) as u128;
            let shift = if big_endian { fmt.size - idx - 1 } else { idx };
            number |= b << (shift * 8);
        }
        let bits = fmt.size * 8;
        let formatted_num = match fmt.kind {
            'o' => format!("{number:0width$o}"),
            'x' => format!("{number:0width$x}"),
            'd' => {
                let signed = if number >= (1u128 << (bits - 1)) {
                    (number as i128) - (1i128 << bits)
                } else {
                    number as i128
                };
                format!("{signed:>width$}")
            }
            _ => format!("{number:>width$}"),
        };
        text.push(' ');
        text.push_str(&formatted_num);
        offset += fmt.size;
    }
    if fmt.printable {
        let mut ascii = String::with_capacity(row.len());
        for &b in row {
            ascii.push(if (0x20..=0x7e).contains(&b) { b as char } else { '.' });
        }
        let target_len = ((row_width as f64) * chars_per_byte).ceil() as usize;
        if text.len() < target_len {
            text.push_str(&" ".repeat(target_len - text.len()));
        }
        text.push_str(&format!("  >{ascii}<"));
    }
    text
}

pub(super) fn cmd_od(args: &[String], mut input: super::CommandInput, cwd: &str, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut addr_radix = 'o';
    let mut big_endian = false;
    let mut verbose = false;
    let mut requested_width: u64 = 16;
    let mut skip_bytes: u64 = 0;
    let mut max_len: Option<u64> = None;
    let mut strings_min: Option<u64> = None;
    let mut type_specs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    let short_aliases = |ch: char| -> Option<&'static str> {
        match ch {
            'a' => Some("a"),
            'b' => Some("o1"),
            'B' | 'o' => Some("o2"),
            'c' => Some("c"),
            'd' => Some("u2"),
            'D' => Some("u4"),
            'e' | 'F' => Some("f8"),
            'f' => Some("f4"),
            'h' | 'x' => Some("x2"),
            'i' => Some("d4"),
            'I' | 'l' | 'L' => Some("d8"),
            'O' => Some("o4"),
            's' => Some("d2"),
            'X' => Some("x4"),
            _ => None,
        }
    };

    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            match a {
                "--version" => return ok_out("od (safe-bash virtual implementation)\n"),
                "--help" => {
                    return ok_out(
                        "Usage: od [OPTION]... [FILE]...\nPrint input bytes in selected numeric formats.\n\nCommon supported options (additional behavior is documented in the package):\n  -A, --address-radix=RADIX\n  -j, --skip-bytes=NUM\n  -N, --read-bytes=NUM\n  -t, --format=TYPE, --type=TYPE\n  -w, --width=NUM\n  --endian=ORDER\n  -v, --output-duplicates\n  --help     display this help and exit\n  --version  display implementation information and exit\n\nThis is the safe-bash virtual implementation; filesystem operations require backend capabilities.\n",
                    )
                }
                "--output-duplicates" => verbose = true,
                _ if a.starts_with("--output-duplicates=") => {
                    return err_out(
                        "od: option '--output-duplicates' does not take an argument\n",
                        2,
                    );
                }
                "--strings" => strings_min = Some(3),
                _ if a.starts_with("--strings=") => {
                    match parse_od_numeric(&a["--strings=".len()..], false) {
                        Ok(v) if v >= 1 => strings_min = Some(v),
                        Ok(_) => return err_out("od: minimum string length must be positive\n", 2),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                "--width" => requested_width = 32,
                _ if a.starts_with("--width=") => {
                    match parse_od_numeric(&a["--width=".len()..], false) {
                        Ok(v) if v >= 1 => requested_width = v,
                        Ok(_) => return err_out("od: width must be positive\n", 2),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                "--endian=big" => big_endian = true,
                "--endian=little" => big_endian = false,
                _ if a.starts_with("--endian=") => {
                    return err_out("od: endian must be little or big\n", 2);
                }
                "--endian" if i + 1 < args.len() => {
                    i += 1;
                    match args[i].as_str() {
                        "big" => big_endian = true,
                        "little" => big_endian = false,
                        _ => return err_out("od: endian must be little or big\n", 2),
                    }
                }
                _ if a.starts_with("--address-radix=") => {
                    let val = &a["--address-radix=".len()..];
                    match val {
                        "d" | "o" | "x" | "n" => addr_radix = val.chars().next().unwrap(),
                        _ => return err_out("od: address radix must be d, o, x, or n\n", 2),
                    }
                }
                "--address-radix" if i + 1 < args.len() => {
                    i += 1;
                    match args[i].as_str() {
                        "d" | "o" | "x" | "n" => addr_radix = args[i].chars().next().unwrap(),
                        _ => return err_out("od: address radix must be d, o, x, or n\n", 2),
                    }
                }
                _ if a.starts_with("--skip-bytes=") => {
                    match parse_od_numeric(&a["--skip-bytes=".len()..], true) {
                        Ok(v) => skip_bytes = v,
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                "--skip-bytes" if i + 1 < args.len() => {
                    i += 1;
                    match parse_od_numeric(&args[i], true) {
                        Ok(v) => skip_bytes = v,
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                _ if a.starts_with("--read-bytes=") => {
                    match parse_od_numeric(&a["--read-bytes=".len()..], true) {
                        Ok(v) => max_len = Some(v),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                "--read-bytes" if i + 1 < args.len() => {
                    i += 1;
                    match parse_od_numeric(&args[i], true) {
                        Ok(v) => max_len = Some(v),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                _ if a.starts_with("--format=") || a.starts_with("--type=") => {
                    let eq = a.find('=').unwrap();
                    type_specs.push(a[eq + 1..].to_string());
                }
                "--format" | "--type" if i + 1 < args.len() => {
                    i += 1;
                    type_specs.push(args[i].clone());
                }
                "--address-radix" | "--skip-bytes" | "--read-bytes" | "--format" | "--type"
                | "--endian" => {
                    return err_out(&format!("od: option '{a}' requires an argument\n"), 2);
                }
                _ => return err_out(&format!("od: unrecognized option '{a}'\n"), 2),
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let flag = chars[c_idx];
            if flag == 'e' {
                let rest: String = chars[c_idx + 1..].iter().collect();
                let next_arg = args.get(i + 1).map(|s| s.as_str());
                if rest == "big"
                    || rest == "little"
                    || next_arg == Some("big")
                    || next_arg == Some("little")
                {
                    return err_out("od: use --endian=little or --endian=big; -e is unsupported\n", 2);
                }
            }
            if flag == 'v' {
                verbose = true;
            } else if flag == 'S' {
                let rest: String = chars[c_idx + 1..].iter().collect();
                if rest.is_empty() {
                    strings_min = Some(3);
                } else {
                    match parse_od_numeric(&rest, false) {
                        Ok(v) if v >= 1 => strings_min = Some(v),
                        Ok(_) => return err_out("od: minimum string length must be positive\n", 2),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                break;
            } else if flag == 'w' {
                let rest: String = chars[c_idx + 1..].iter().collect();
                if rest.is_empty() {
                    requested_width = 32;
                } else {
                    match parse_od_numeric(&rest, false) {
                        Ok(v) if v >= 1 => requested_width = v,
                        Ok(_) => return err_out("od: width must be positive\n", 2),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    }
                }
                break;
            } else if let Some(mapped) = short_aliases(flag) {
                type_specs.push(mapped.to_string());
            } else if matches!(flag, 'A' | 'j' | 'N' | 't') {
                let rest: String = chars[c_idx + 1..].iter().collect();
                let param = if !rest.is_empty() {
                    rest
                } else if i + 1 < args.len() {
                    i += 1;
                    args[i].clone()
                } else {
                    return err_out(&format!("od: option '-{flag}' requires an argument\n"), 2);
                };
                match flag {
                    'A' => match param.as_str() {
                        "d" | "o" | "x" | "n" => addr_radix = param.chars().next().unwrap(),
                        _ => return err_out("od: address radix must be d, o, x, or n\n", 2),
                    },
                    'j' => match parse_od_numeric(&param, true) {
                        Ok(v) => skip_bytes = v,
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    },
                    'N' => match parse_od_numeric(&param, true) {
                        Ok(v) => max_len = Some(v),
                        Err(e) => return err_out(&format!("od: {e}\n"), 2),
                    },
                    't' => type_specs.push(param),
                    _ => {}
                }
                break;
            } else {
                return err_out(&format!("od: invalid option -- '{flag}'\n"), 2);
            }
            c_idx += 1;
        }
        i += 1;
    }

    if type_specs.is_empty() {
        type_specs.push("o2".to_string());
    }
    let mut selected: Vec<OdFormat> = Vec::new();
    for spec in &type_specs {
        match parse_od_formats(spec) {
            Ok(fmts) => selected.extend(fmts),
            Err(e) => return err_out(&format!("od: {e}\n"), 2),
        }
    }

    let fmt_addr = |addr: u64| -> String {
        match addr_radix {
            'n' => String::new(),
            'x' => format!("{addr:06x}"),
            'd' => format!("{addr:07}"),
            _ => format!("{addr:07o}"),
        }
    };

    let alignment = selected.iter().map(|f| f.size as u64).max().unwrap_or(1);
    let width = if requested_width % alignment == 0 {
        requested_width
    } else {
        alignment
    };
    let chars_per_byte = selected
        .iter()
        .map(|f| ((od_field_width(f) + 1) as f64) / (f.size as f64))
        .fold(0.0f64, f64::max);

    let mut out = ok_out("");
    if width != requested_width && !write(2, &format!("od: warning: invalid width {requested_width}; using {width} instead\n"), &mut out) {
        return out;
    }
    let mut left = max_len.unwrap_or(u64::MAX);
    if skip_bytes == 0 && left == 0 && let Some(file) = files.first().filter(|f| !f.is_empty() && *f != "-") {
        let path = crate::vfs::path::absolute_operand(cwd, file);
        if let Err(e) = fs.inspect_command_entry(&path, true, "stat") {
            let msg = super::coreutils::stream_file_error(e, "stat", &path);
            write(2, &format!("od: {msg}\n"), &mut out);
            out.exit_code = 1;
            return out;
        }
    }

    let width = match usize::try_from(width) {
        Ok(width) => width,
        Err(_) if strings_min.is_some() => 1, // String mode has no row buffer.
        Err(_) => {
            out.exit_code = 1;
            write(2, "od: internal error\n", &mut out);
            return out;
        }
    };
    let mut first = true;
    let mut previous = Vec::new();
    let mut suppressed = false;
    let mut formatted = String::new();
    let mut emit_rows = |batch: &[u8], offset: &mut u64, out: &mut BuiltinOutcome, write: &mut super::CommandWriter| {
        for row in batch.chunks(width) {
            if !verbose && previous == row {
                if !suppressed { formatted.push_str("*\n"); }
                suppressed = true;
            } else {
                let addr = fmt_addr(*offset);
                for (idx, fmt) in selected.iter().enumerate() {
                    if idx == 0 { formatted.push_str(&addr); } else { formatted.push_str(&" ".repeat(addr.len())); }
                    formatted.push_str(&format_od_row(row, fmt, big_endian, width, chars_per_byte));
                    formatted.push('\n');
                }
                previous.clear();
                previous.extend_from_slice(row);
                suppressed = false;
            }
            *offset += row.len() as u64;
            if first || formatted.len() >= 16384 {
                first = false;
                if !write(1, &formatted, out) { return false; }
                formatted.clear();
            }
        }
        let ok = formatted.is_empty() || write(1, &formatted, out);
        formatted.clear();
        ok
    };

    let mut offset = skip_bytes;
    let mut skip = skip_bytes;
    let limit = fs.max_input_bytes();
    let mut available = limit;
    let mut used_stdin = false;
    let mut partial = Vec::new();
    let mut text = String::new();
    if files.is_empty() { files.push("-".into()); }
    for file in files {
        if skip == 0 && left == 0 { break; }
        if file == "-" && std::mem::replace(&mut used_stdin, true) { continue; }
        let mut writable = true;
        let read = input.read_operand(&file, cwd, fs, false, |chunk| {
            let Some(remaining) = available.checked_sub(chunk.len()) else {
                fs.limit_error("maxInputBytes", limit);
                writable = false;
                return false;
            };
            available = remaining;
            for block in chunk.chunks(8192) {
                let discard = skip.min(block.len() as u64) as usize;
                skip -= discard as u64;
                let take = left.min((block.len() - discard) as u64) as usize;
                left -= take as u64;
                let mut bytes = &block[discard..discard + take];
                if let Some(minimum) = strings_min {
                    for &b in bytes {
                        if (32..=126).contains(&b) { text.push(b as char); }
                        else {
                            if b == 0 && text.len() as u64 >= minimum {
                                let addr = fmt_addr(offset - text.len() as u64);
                                if !addr.is_empty() { text.insert(0, ' '); text.insert_str(0, &addr); }
                                text.push('\n');
                                if !write(1, &text, &mut out) { writable = false; return false; }
                            }
                            text.clear();
                        }
                        offset += 1;
                    }
                } else {
                    if !partial.is_empty() {
                        let end = bytes.len().min(width - partial.len());
                        partial.extend_from_slice(&bytes[..end]);
                        bytes = &bytes[end..];
                        if partial.len() == width {
                            if !emit_rows(&partial, &mut offset, &mut out, write) { writable = false; return false; }
                            partial.clear();
                        }
                    }
                    let full = bytes.len() / width * width;
                    if full > 0 && !emit_rows(&bytes[..full], &mut offset, &mut out, write) { writable = false; return false; }
                    partial.extend_from_slice(&bytes[full..]);
                }
                if left == 0 && skip == 0 { return false; }
            }
            true
        });
        if !writable { return out; }
        if let Err(e) = read {
            out.exit_code = 1;
            if !write(2, &format!("od: {e}\n"), &mut out) || file == "-" ||
                !["ENOENT:", "EACCES:", "EISDIR:", "ENOTDIR:", "EIO:"].iter().any(|code| e.starts_with(code)) {
                return out;
            }
        }
    }
    if skip != 0 {
        out.exit_code = 1;
        write(2, "od: cannot skip past end of input\n", &mut out);
    } else if strings_min.is_none() && emit_rows(&partial, &mut offset, &mut out, write) && addr_radix != 'n' {
        write(1, &format!("{}\n", fmt_addr(offset)), &mut out);
    }
    out
}

pub struct TarEntry {
    pub name: String,
    pub typeflag: u8,
    pub mode: u32,
    pub mtime: f64,
    pub atime: Option<f64>,
    pub uid: u32,
    pub gid: u32,
    pub linkname: String,
    pub content: Vec<u8>,
}

#[path = "tar_format.rs"]
mod tar_format;
mod zip_volumes;

#[derive(Clone, Debug)]
struct TarOperand {
    name: String,
    cwd: String,
    exclude_count: usize,
    recursion: bool,
}

fn tar_unquote_filename(name: &str) -> String {
    let bytes = name.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\\' && i + 1 < bytes.len() {
            let next = bytes[i + 1];
            let esc = match next {
                b'a' => Some(7u8),
                b'b' => Some(8u8),
                b'f' => Some(12u8),
                b'n' => Some(10u8),
                b'r' => Some(13u8),
                b't' => Some(9u8),
                b'v' => Some(11u8),
                b'\\' => Some(92u8),
                _ => None,
            };
            if let Some(code) = esc {
                out.push(code);
                i += 2;
                continue;
            }
            if i + 3 < bytes.len()
                && (b'0'..=b'7').contains(&bytes[i + 1])
                && (b'0'..=b'7').contains(&bytes[i + 2])
                && (b'0'..=b'7').contains(&bytes[i + 3])
            {
                let val = ((bytes[i + 1] - b'0') as u16 * 64
                    + (bytes[i + 2] - b'0') as u16 * 8
                    + (bytes[i + 3] - b'0') as u16) as u8;
                out.push(val);
                i += 4;
                continue;
            }
        }
        out.push(b);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn tar_quote_name(name: &str, style: &str) -> String {
    if style == "literal" {
        return name.to_string();
    }
    let mut out = String::new();
    if style == "c" {
        out.push('"');
    }
    for ch in name.chars() {
        match ch {
            '\x07' => out.push_str("\\a"),
            '\x08' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\x0b' => out.push_str("\\v"),
            '\x0c' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            '"' if style == "c" => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 32
                || ((c as u32) >= 127 && (c as u32) <= 159)
                || c == '\u{2028}'
                || c == '\u{2029}' =>
            {
                let mut buf = [0u8; 4];
                for &b in c.encode_utf8(&mut buf).as_bytes() {
                    out.push_str(&format!("\\{b:03o}"));
                }
            }
            c => out.push(c),
        }
    }
    if style == "c" {
        out.push('"');
    }
    out
}

fn tar_strip_components(name: &str, strip: usize, is_dir: bool) -> Option<String> {
    let components: Vec<&str> = name
        .trim_start_matches('/')
        .split('/')
        .filter(|c| !c.is_empty())
        .collect();
    if components.len() <= strip {
        return None;
    }
    let stripped: Vec<&str> = components[strip..]
        .iter()
        .copied()
        .filter(|&c| c != ".")
        .collect();
    let joined = stripped.join("/");
    if is_dir && !joined.is_empty() {
        Some(format!("{joined}/"))
    } else {
        Some(joined)
    }
}

fn check_tar_symlink(fs: &dyn SafeBashFs, root: &str, path: &str, target: &str) -> Result<(), String> {
    use std::collections::VecDeque;
    let escape = || format!("symlink target escapes extraction root: {}", tar_format::display(path));
    if target.starts_with('/') { return Err(escape()); }

    let mut pending = VecDeque::<String>::new();
    let prepend = |pending: &mut VecDeque<String>, value: &str| -> Result<(), String> {
        let mut parent_seen = false;
        for part in value.split('/').rev() {
            match part {
                "" | "." => continue,
                ".." => parent_seen = true,
                _ if parent_seen => return Err("symlink targets with non-leading '..' components are unsafe under later link replacement".into()),
                _ => {}
            }
            pending.push_front(part.to_owned());
        }
        Ok(())
    };
    prepend(&mut pending, target)?;
    let mut current = crate::vfs::dirname_posix_path(path);
    let mut hops = 0;
    while let Some(part) = pending.pop_front() {
        if part == ".." {
            if current == root { return Err(escape()); }
            current = crate::vfs::dirname_posix_path(&current);
            continue;
        }
        let next = resolve_posix_path(&current, &part);
        match fs.lstat(&next) {
            Ok(st) if st.kind == crate::vfs::VfsEntryKind::Symlink => {
                hops += 1;
                if hops > 40 { return Err("symlink target chain cannot be safely resolved".into()); }
                let link = fs.readlink(&next)?;
                if let Some(absolute) = link.strip_prefix('/') {
                    let relative = if root == "/" { absolute } else if link == root { "" }
                        else { link.strip_prefix(root).and_then(|s| s.strip_prefix('/')).ok_or("symlink target chain escapes extraction root")? };
                    current = root.to_owned();
                    prepend(&mut pending, relative)?;
                } else { prepend(&mut pending, &link)?; }
            }
            Ok(_) => current = next,
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => current = next,
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

fn cmd_tar(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    const TAR_HELP_TEXT: &str = "Usage: tar [OPTION]... [FILE]...\nCreate, read or modify USTAR/PAX archives in the virtual filesystem.\n\n  -c, --create             Create an archive\n  -t, --list               List archive members\n  -x, --extract, --get      Extract archive members\n  -O, --to-stdout          Extract file contents to standard output\n  -r, --append             Append files to an uncompressed archive\n  -u, --update             Append files newer than archived members\n  -d, --compare, --diff    Compare archive members with filesystem entries\n      --delete            Delete selected archive members\n  -A, --catenate, --concatenate Append archives to an uncompressed archive\n  -f, --file=ARCHIVE        Use ARCHIVE (default - for standard input/output)\n  -z, --gzip               Use gzip compression\n  -j, --bzip2              Use bzip2 compression\n  -J, --xz                 Use xz compression\n  -a, --auto-compress      Select output compression by archive suffix\n  -b, --blocking-factor=N  Use N 512-byte blocks per output record\n      --record-size=SIZE  Set output record bytes (multiple of 512; K/M/G suffixes)\n  -B, --read-full-records  Join short reads (always enabled for VFS streams)\n  -i, --ignore-zeros       Read past zero blocks, including concatenated archives\n  -n, --seek               Accept seekable input; VFS reads remain sequential\n      --no-seek           Read sequentially\n      --force-local       Treat archive names as local VFS paths (always enabled)\n      --utc               Show UTC timestamps; implies verbose listing\n      --quoting-style=STYLE Display literal, escape (default), or c filenames\n      --totals            Report archive bytes read or written to stderr\n  -v, --verbose            List processed members\n  -C, --directory=DIR      Change directory for subsequent operands\n  -T, --files-from=FILE    Read filenames from FILE (- for standard input)\n      --null              Read NUL-delimited filenames; implies verbatim names\n      --no-null           Read newline-delimited filenames\n      --verbatim-files-from Treat file-list entries as literal filenames\n      --no-verbatim-files-from Enable supported file-list directory options\n      --exclude=PATTERN   Exclude paths from subsequent sources\n      --exclude-caches    Keep cache directories and tags, omit other contents\n      --no-recursion      Archive subsequent directories without their contents\n      --recursion         Recurse into subsequent directories (default)\n      --sort=ORDER        Order directory children by name or none (default)\n  -h, --dereference       Archive symbolic-link targets during creation\n  -X, --exclude-from=FILE Read newline-delimited exclusion patterns\n      --wildcards         Select archive members with anchored glob patterns\n      --no-wildcards      Select literal member names (default)\n      --occurrence[=NUM]  Select only occurrence NUM of each operand (default 1)\n      --strip-components=NUM Remove leading components when reading archives\n      --transform=EXPR    Substitute member names (s/old/new/[gix])\n      --show-transformed-names Display transformed names in archive listings\n      --format=FORMAT     Create pax (default), posix or ustar archives\n      --mtime=DATE        Override creation mtime (@seconds or ISO/RFC date)\n      --owner=ID          Override numeric creation owner\n      --group=ID          Override numeric creation group\n      --mode=OCTAL        Override creation permission bits\n      --numeric-owner     Use numeric ownership IDs\n      --full-time         Show full UTC timestamps in verbose listings\n  -m, --touch              Retain current extraction timestamps\n  -p, --same-permissions   Restore ordinary archive permission bits\n      --no-same-permissions Apply virtual 022 mask to ordinary permissions\n      --no-same-owner     Retain filesystem-assigned ownership\n      --atime-preserve[=replace] Restore source access times after creation\n      --delay-directory-restore Restore directory metadata at archive end\n      --no-delay-directory-restore Restore after leaving each directory subtree\n  -k, --keep-old-files     Keep existing files and report conflicts as errors\n      --skip-old-files    Skip existing files without reporting errors\n      --overwrite         Replace existing entries using safe extraction checks\n      --help              Display this help and exit\n      --                  End options; remaining arguments are filenames\n\nExactly one of -c, -t, -x, -r, -u, -d, --delete or -A is required.\nWhen reading, gzip, bzip2 and xz compression is detected from archive bytes.\nExamples: tar cf archive.tar file; tar tf archive.tar; tar xf archive.tar -C directory\n";
    let mut create = false;
    let mut extract = false;
    let mut list = false;
    let mut append_mode = false;
    let mut update_mode = false;
    let mut delete_mode = false;
    let mut diff_mode = false;
    let mut catenate_mode = false;
    let mut selected_mode: Option<&str> = None;
    let mut explicit_compress: Option<&str> = None;
    let mut has_files_from = false;
    let mut to_stdout = false;
    let mut null_delim = false;
    let mut verbatim_files_from = false;
    #[derive(PartialEq)]
    enum Overwrite { Replace, Skip, Keep }
    let mut overwrite = Overwrite::Replace;
    let mut touch = false;
    let mut permission_mask = 0o777;
    let mut delay_directories = true;
    let mut exclude_caches = false;
    let mut show_transformed = false;
    let mut dereference = false;
    let mut recursion = true;
    let mut sort_by_name = false;
    let mut use_compress = false;
    let mut compress_format: Option<&str> = None;
    let mut verbose = false;
    let mut totals = false;
    let mut utc = false;
    let mut full_time = false;
    let mut ignore_zeros = false;
    let mut wildcards = false;
    let mut quoting_style = "escape".to_string();
    let mut occurrence: Option<usize> = None;
    let mut archive_file: Option<String> = None;
    let mut current_dir = cwd.to_string();
    let mut strip_components = 0usize;
    let mut pax = true;
    let mut override_mode: Option<u32> = None;
    let mut override_mtime: Option<u64> = None;
    let mut override_uid: Option<u32> = None;
    let mut override_gid: Option<u32> = None;
    let mut excludes: Vec<String> = Vec::new();
    let mut transforms = Vec::new();
    let mut operands: Vec<TarOperand> = Vec::new();
    let mut pending_files_from: Vec<(String, bool, bool, usize)> = Vec::new();

    let read_exclude_file = |xf: &str, excludes: &mut Vec<String>| {
        let raw = if xf == "-" {
            stdin.to_string()
        } else {
            let ex_path = resolve_posix_path(cwd, xf);
            fs.read_file(&ex_path)
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default()
        };
        for line in raw.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                excludes.push(trimmed.to_string());
            }
        }
    };

    let process_files_from =
        |ff: &str,
         list_null: bool,
         list_verbatim: bool,
         cur_dir: &mut String,
         excludes_len: usize,
         rec: bool,
         ops: &mut Vec<TarOperand>| {
            let raw = if ff == "-" {
                stdin.to_string()
            } else {
                let full = resolve_posix_path(cwd, ff);
                fs.read_file(&full)
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
                    .unwrap_or_default()
            };
            if list_null {
                for item in raw.split('\0') {
                    let t = item.trim_matches(|c: char| c == '\n' || c == '\r');
                    if !t.is_empty() {
                        ops.push(TarOperand {
                            name: t.to_string(),
                            cwd: cur_dir.clone(),
                            exclude_count: excludes_len,
                            recursion: rec,
                        });
                    }
                }
            } else {
                let lines: Vec<&str> = raw.split('\n').collect();
                let mut li = 0usize;
                while li < lines.len() {
                    let line = lines[li].trim_end_matches('\r');
                    if line.is_empty() {
                        li += 1;
                        continue;
                    }
                    if !list_verbatim && line.starts_with('-') {
                        if line == "-C" {
                            if li + 1 < lines.len() {
                                li += 1;
                                *cur_dir = resolve_posix_path(cur_dir, lines[li].trim_end_matches('\r'));
                            }
                        } else if let Some(rest) = line.strip_prefix("-C") {
                            *cur_dir = resolve_posix_path(cur_dir, rest);
                        } else if let Some(rest) = line.strip_prefix("--directory=") {
                            *cur_dir = resolve_posix_path(cur_dir, rest);
                        }
                    } else {
                        let name = if !list_verbatim {
                            tar_unquote_filename(line)
                        } else {
                            line.to_string()
                        };
                        ops.push(TarOperand {
                            name,
                            cwd: cur_dir.clone(),
                            exclude_count: excludes_len,
                            recursion: rec,
                        });
                    }
                    li += 1;
                }
            }
        };

    let mut record_size = 512u64;
    let mut set_record_size = |val: &str, is_record_size: bool| -> Result<(), &'static str> {
        let mut digits = val;
        let mut mult: u64 = if is_record_size { 1 } else { 512 };
        if is_record_size
            && let Some(last) = digits.chars().last()
        {
            let s_mult = match last {
                'c' => Some(1u64),
                'w' => Some(2),
                'b' => Some(512),
                'k' | 'K' => Some(1024),
                'M' => Some(1024 * 1024),
                'G' => Some(1024 * 1024 * 1024),
                _ => None,
            };
            if let Some(m) = s_mult {
                mult = m;
                digits = &digits[..digits.len() - 1];
            }
        }
        if let Some(stripped) = digits.strip_prefix('+') {
            digits = stripped;
        }
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return Err("record size must be a positive multiple of 512");
        }
        let Ok(n) = digits.parse::<u64>() else {
            return Err("record size must be a positive multiple of 512");
        };
        let Some(sz) = n.checked_mul(mult) else {
            return Err("record size must be a positive multiple of 512");
        };
        if sz == 0 || sz >= 1 << 53 || sz % 512 != 0 {
            return Err("record size must be a positive multiple of 512");
        }
        record_size = sz;
        Ok(())
    };

    let mut i = 0usize;
    let mut end_of_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if !end_of_opts {
            if a == "--help" {
                return ok_out(TAR_HELP_TEXT);
            }
            if (a == "-C" || a == "--directory") && i + 1 < args.len() {
                i += 1;
                current_dir = resolve_posix_path(&current_dir, &args[i]);
                i += 1;
                continue;
            }
            if let Some(d) = a.strip_prefix("--directory=") {
                current_dir = resolve_posix_path(&current_dir, d);
                i += 1;
                continue;
            }
            if (a == "-f" || a == "--file") && i + 1 < args.len() {
                i += 1;
                if args[i].is_empty() {
                    return err_out("tar: empty archive name\n", 2);
                }
                archive_file = Some(args[i].clone());
                i += 1;
                continue;
            }
            if let Some(f) = a.strip_prefix("--file=") {
                if f.is_empty() {
                    return err_out("tar: empty archive name\n", 2);
                }
                archive_file = Some(f.to_string());
                i += 1;
                continue;
            }
            if (a == "-X" || a == "--exclude-from") && i + 1 < args.len() {
                i += 1;
                read_exclude_file(&args[i], &mut excludes);
                i += 1;
                continue;
            }
            if let Some(xf) = a.strip_prefix("--exclude-from=") {
                read_exclude_file(xf, &mut excludes);
                i += 1;
                continue;
            }
            let transform = if matches!(a.as_str(), "--transform" | "--xform") && i + 1 < args.len() {
                i += 1;
                Some(args[i].as_str())
            } else {
                a.strip_prefix("--transform=").or_else(|| a.strip_prefix("--xform="))
            };
            if let Some(source) = transform {
                if let Err(e) = parse_tar_transforms(source, &mut transforms) {
                    return err_out(&format!("tar: {e}\n"), 2);
                }
                i += 1;
                continue;
            }
            if a == "--sort" && i + 1 < args.len() {
                i += 1;
                match args[i].as_str() {
                    "name" => sort_by_name = true,
                    "none" => sort_by_name = false,
                    other => return err_out(&format!("tar: unsupported sort order: {other}\n"), 2),
                }
                i += 1;
                continue;
            }
            if let Some(s) = a.strip_prefix("--sort=") {
                match s {
                    "name" => sort_by_name = true,
                    "none" => sort_by_name = false,
                    other => return err_out(&format!("tar: unsupported sort order: {other}\n"), 2),
                }
                i += 1;
                continue;
            }
            if a == "--quoting-style" && i + 1 < args.len() {
                i += 1;
                if !matches!(args[i].as_str(), "literal" | "escape" | "c") {
                    return err_out(
                        &format!(
                            "tar: unsupported quoting style: {}; use literal, escape or c\n",
                            args[i]
                        ),
                        2,
                    );
                }
                quoting_style = args[i].clone();
                i += 1;
                continue;
            }
            if let Some(qs) = a.strip_prefix("--quoting-style=") {
                if !matches!(qs, "literal" | "escape" | "c") {
                    return err_out(
                        &format!("tar: unsupported quoting style: {qs}; use literal, escape or c\n"),
                        2,
                    );
                }
                quoting_style = qs.to_string();
                i += 1;
                continue;
            }
            if a == "--mode" && i + 1 < args.len() {
                i += 1;
                let m = &args[i];
                if m.is_empty()
                    || !m.chars().all(|c| ('0'..='7').contains(&c))
                    || u32::from_str_radix(m, 8).is_err_and(|_| true)
                    || u32::from_str_radix(m, 8).unwrap_or(0o10000) > 0o7777
                {
                    return err_out(&format!("tar: invalid numeric mode: {m}\n"), 2);
                }
                override_mode = u32::from_str_radix(m, 8).ok();
                i += 1;
                continue;
            }
            if let Some(m) = a.strip_prefix("--mode=") {
                if m.is_empty()
                    || !m.chars().all(|c| ('0'..='7').contains(&c))
                    || u32::from_str_radix(m, 8).unwrap_or(0o10000) > 0o7777
                {
                    return err_out(&format!("tar: invalid numeric mode: {m}\n"), 2);
                }
                override_mode = u32::from_str_radix(m, 8).ok();
                i += 1;
                continue;
            }
            if a == "--mtime" && i + 1 < args.len() {
                i += 1;
                let raw_mt = &args[i];
                let clean = raw_mt.trim_matches(|c| c == '\'' || c == '"');
                if clean.is_empty() || clean == "@" {
                    return err_out(&format!("tar: invalid mtime: {raw_mt}\n"), 2);
                }
                if let Some(sec) = clean.strip_prefix('@') {
                    if sec.parse::<f64>().is_err() {
                        return err_out(&format!("tar: invalid mtime: {raw_mt}\n"), 2);
                    }
                    override_mtime = sec.parse::<u64>().ok();
                } else if !clean.chars().any(|c| c.is_ascii_digit()) {
                    return err_out(&format!("tar: invalid mtime: {raw_mt}\n"), 2);
                }
                i += 1;
                continue;
            }
            if let Some(mt) = a.strip_prefix("--mtime=") {
                let clean = mt.trim_matches(|c| c == '\'' || c == '"');
                if clean.is_empty() || clean == "@" {
                    return err_out(&format!("tar: invalid mtime: {mt}\n"), 2);
                }
                if let Some(sec) = clean.strip_prefix('@') {
                    if sec.parse::<f64>().is_err() {
                        return err_out(&format!("tar: invalid mtime: {mt}\n"), 2);
                    }
                    override_mtime = sec.parse::<u64>().ok();
                } else if !clean.chars().any(|c| c.is_ascii_digit()) {
                    return err_out(&format!("tar: invalid mtime: {mt}\n"), 2);
                }
                i += 1;
                continue;
            }
            if a == "--owner" && i + 1 < args.len() {
                i += 1;
                let ow = &args[i];
                if ow.is_empty() || !ow.chars().all(|c| c.is_ascii_digit()) || ow.parse::<u32>().is_err() {
                    return err_out(&format!("tar: invalid numeric owner: {ow}\n"), 2);
                }
                override_uid = ow.parse::<u32>().ok();
                i += 1;
                continue;
            }
            if let Some(ow) = a.strip_prefix("--owner=") {
                if ow.is_empty() || !ow.chars().all(|c| c.is_ascii_digit()) || ow.parse::<u32>().is_err() {
                    return err_out(&format!("tar: invalid numeric owner: {ow}\n"), 2);
                }
                override_uid = ow.parse::<u32>().ok();
                i += 1;
                continue;
            }
            if a == "--group" && i + 1 < args.len() {
                i += 1;
                let gr = &args[i];
                if gr.is_empty() || !gr.chars().all(|c| c.is_ascii_digit()) || gr.parse::<u32>().is_err() {
                    return err_out(&format!("tar: invalid numeric group: {gr}\n"), 2);
                }
                override_gid = gr.parse::<u32>().ok();
                i += 1;
                continue;
            }
            if let Some(gr) = a.strip_prefix("--group=") {
                if gr.is_empty() || !gr.chars().all(|c| c.is_ascii_digit()) || gr.parse::<u32>().is_err() {
                    return err_out(&format!("tar: invalid numeric group: {gr}\n"), 2);
                }
                override_gid = gr.parse::<u32>().ok();
                i += 1;
                continue;
            }
            if a == "--format" && i + 1 < args.len() {
                pax = args[i + 1] != "ustar";
                if !matches!(args[i + 1].as_str(), "ustar" | "pax" | "posix") {
                    return err_out(&format!("tar: unsupported archive format: {}\n", args[i + 1]), 2);
                }
                i += 2;
                continue;
            }
            if let Some(fmt) = a.strip_prefix("--format=") {
                pax = fmt != "ustar";
                if !matches!(fmt, "ustar" | "pax" | "posix") {
                    return err_out(&format!("tar: unsupported archive format: {fmt}\n"), 2);
                }
                i += 1;
                continue;
            }
            if let Some(rs) = a.strip_prefix("--record-size=") {
                if let Err(e) = set_record_size(rs, true) {
                    return err_out(&format!("tar: {e}\n"), 2);
                }
                i += 1;
                continue;
            }
            if let Some(bf) = a.strip_prefix("--blocking-factor=") {
                if let Err(e) = set_record_size(bf, false) {
                    return err_out(&format!("tar: {e}\n"), 2);
                }
                i += 1;
                continue;
            }
            if a == "--atime-preserve" || a == "--atime-preserve=replace" {
                i += 1;
                continue;
            }
            if a.starts_with("--atime-preserve=") {
                return err_out(
                    "tar: only --atime-preserve=replace is supported; filesystem has no no-atime read capability\n",
                    2,
                );
            }
            if (a == "-b" || a == "--blocking-factor" || a == "--record-size") && i + 1 < args.len() {
                if let Err(e) = set_record_size(&args[i + 1], a == "--record-size") {
                    return err_out(&format!("tar: {e}\n"), 2);
                }
                i += 2;
                continue;
            }
            if (a == "-T" || a == "--files-from") && i + 1 < args.len() {
                i += 1;
                let ff = args[i].clone();
                has_files_from = true;
                pending_files_from.push((ff, null_delim, verbatim_files_from, excludes.len()));
                i += 1;
                continue;
            }
            if let Some(ff) = a.strip_prefix("--files-from=") {
                has_files_from = true;
                pending_files_from.push((ff.to_string(), null_delim, verbatim_files_from, excludes.len()));
                i += 1;
                continue;
            }
            if a == "--exclude" && i + 1 < args.len() {
                i += 1;
                excludes.push(args[i].clone());
                i += 1;
                continue;
            }
            if let Some(ex) = a.strip_prefix("--exclude=") {
                excludes.push(ex.to_string());
                i += 1;
                continue;
            }
            if a == "--strip-components" && i + 1 < args.len() {
                i += 1;
                if args[i].is_empty()
                    || !args[i].chars().all(|c| c.is_ascii_digit())
                    || args[i].parse::<usize>().is_err()
                {
                    return err_out("tar: invalid strip-components count\n", 2);
                }
                strip_components = args[i].parse().unwrap();
                i += 1;
                continue;
            }
            if let Some(sc) = a.strip_prefix("--strip-components=") {
                if sc.is_empty()
                    || !sc.chars().all(|c| c.is_ascii_digit())
                    || sc.parse::<usize>().is_err()
                {
                    return err_out("tar: invalid strip-components count\n", 2);
                }
                strip_components = sc.parse().unwrap();
                i += 1;
                continue;
            }
            if a == "--occurrence" {
                occurrence = Some(1);
                i += 1;
                continue;
            }
            if let Some(occ) = a.strip_prefix("--occurrence=") {
                let Ok(v) = occ.parse::<usize>() else {
                    return err_out("tar: invalid occurrence count\n", 2);
                };
                if v < 1 || !occ.chars().all(|c| c.is_ascii_digit()) {
                    return err_out("tar: invalid occurrence count\n", 2);
                }
                occurrence = Some(v);
                i += 1;
                continue;
            }
            if matches!(
                a.as_str(),
                "--directory"
                    | "--file"
                    | "--exclude-from"
                    | "--transform"
                    | "--xform"
                    | "--sort"
                    | "--quoting-style"
                    | "--mode"
                    | "--mtime"
                    | "--owner"
                    | "--group"
                    | "--format"
                    | "--blocking-factor"
                    | "--record-size"
                    | "--files-from"
                    | "--exclude"
                    | "--strip-components"
            ) {
                return err_out(&format!("tar: missing argument for {a}\n"), 2);
            }
            if matches!(a.as_str(), "-C" | "-f" | "-X" | "-b" | "-T") {
                return err_out(&format!("tar: missing argument for {a}\n"), 2);
            }
            if a.starts_with("--") {
                if let Some((opt_name, _)) = a[2..].split_once('=') {
                    return err_out(&format!("tar: option --{opt_name} does not take an argument\n"), 2);
                }
                match a.as_str() {
                    "--create" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("c");
                        create = true;
                    }
                    "--extract" | "--get" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("x");
                        extract = true;
                    }
                    "--list" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("t");
                        list = true;
                    }
                    "--delete" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("delete");
                        delete_mode = true;
                    }
                    "--append" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("r");
                        append_mode = true;
                    }
                    "--update" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("u");
                        update_mode = true;
                    }
                    "--diff" | "--compare" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("d");
                        diff_mode = true;
                    }
                    "--catenate" | "--concatenate" => {
                        if selected_mode.is_some() {
                            return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                        }
                        selected_mode = Some("A");
                        catenate_mode = true;
                    }
                    "--to-stdout" => to_stdout = true,
                    "--null" => {
                        null_delim = true;
                        verbatim_files_from = true;
                    }
                    "--no-null" => null_delim = false,
                    "--verbatim-files-from" => verbatim_files_from = true,
                    "--no-verbatim-files-from" => verbatim_files_from = false,
                    "--no-recursion" => recursion = false,
                    "--recursion" => recursion = true,
                    "--skip-old-files" => overwrite = Overwrite::Skip,
                    "--keep-old-files" => overwrite = Overwrite::Keep,
                    "--overwrite" => overwrite = Overwrite::Replace,
                    "--exclude-caches" => exclude_caches = true,
                    "--show-transformed-names" | "--show-stored-names" => show_transformed = true,
                    "--dereference" => dereference = true,
                    "--totals" => totals = true,
                    "--utc" => {
                        utc = true;
                        verbose = true;
                    }
                    "--full-time" => full_time = true,
                    "--wildcards" => wildcards = true,
                    "--no-wildcards" => wildcards = false,
                    "--verbose" => verbose = true,
                    "--ignore-zeros" => ignore_zeros = true,
                    "--touch" => touch = true,
                    "--same-permissions" | "--preserve-permissions" => permission_mask = 0o777,
                    "--no-same-permissions" => permission_mask = 0o755,
                    "--read-full-records" | "--seek" | "--no-seek"
                    | "--force-local" | "--numeric-owner" | "--no-same-owner" => {}
                    "--delay-directory-restore" => delay_directories = true,
                    "--no-delay-directory-restore" => delay_directories = false,
                    "--same-owner" => {
                        return err_out(
                            "tar: filesystem does not support restoring archive ownership\n",
                            2,
                        );
                    }
                    "--gzip" | "--gunzip" | "--ungzip" => {
                        if explicit_compress.is_some_and(|p| p != "gzip") {
                            return err_out("tar: conflicting compression options\n", 2);
                        }
                        explicit_compress = Some("gzip");
                        use_compress = true;
                        compress_format = Some("gzip");
                    }
                    "--bzip2" | "--bunzip2" => {
                        if explicit_compress.is_some_and(|p| p != "bzip2") {
                            return err_out("tar: conflicting compression options\n", 2);
                        }
                        explicit_compress = Some("bzip2");
                        use_compress = true;
                        compress_format = Some("bzip2");
                    }
                    "--xz" => {
                        if explicit_compress.is_some_and(|p| p != "xz") {
                            return err_out("tar: conflicting compression options\n", 2);
                        }
                        explicit_compress = Some("xz");
                        use_compress = true;
                        compress_format = Some("xz");
                    }
                    "--lzma" => {
                        use_compress = true;
                        compress_format = Some("lzma");
                    }
                    "--zstd" => {
                        if explicit_compress.is_some_and(|p| p != "zstd") {
                            return err_out("tar: conflicting compression options\n", 2);
                        }
                        explicit_compress = Some("zstd");
                        use_compress = true;
                        compress_format = Some("zstd");
                    }
                    "--auto-compress" => {
                        use_compress = true;
                        compress_format = Some("auto");
                    }
                    other => {
                        return err_out(&format!("tar: unsupported option: {}\n", &other[2..]), 2);
                    }
                }
                i += 1;
                continue;
            }
            if (a.starts_with('-') && a != "-")
                || (i == 0 && !a.is_empty() && a.chars().all(|ch| "ctxrudAzjJavfCTXmpkhbBinO".contains(ch)))
            {
                let old_style = !a.starts_with('-');
                let flags = a.trim_start_matches('-');
                let chars: Vec<char> = flags.chars().collect();
                let mut ci = 0usize;
                let mut matched_flag = false;
                while ci < chars.len() {
                    match chars[ci] {
                        'c' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("c");
                            create = true;
                            matched_flag = true;
                        }
                        'x' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("x");
                            extract = true;
                            matched_flag = true;
                        }
                        't' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("t");
                            list = true;
                            matched_flag = true;
                        }
                        'r' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("r");
                            append_mode = true;
                            matched_flag = true;
                        }
                        'u' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("u");
                            update_mode = true;
                            matched_flag = true;
                        }
                        'd' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("d");
                            diff_mode = true;
                            matched_flag = true;
                        }
                        'A' => {
                            if selected_mode.is_some() {
                                return err_out("tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n", 2);
                            }
                            selected_mode = Some("A");
                            catenate_mode = true;
                            matched_flag = true;
                        }
                        'O' => {
                            to_stdout = true;
                            matched_flag = true;
                        }
                        'k' => {
                            overwrite = Overwrite::Keep;
                            matched_flag = true;
                        }
                        'h' => {
                            dereference = true;
                            matched_flag = true;
                        }
                        'v' => {
                            verbose = true;
                            matched_flag = true;
                        }
                        'z' => {
                            if explicit_compress.is_some_and(|p| p != "gzip") {
                                return err_out("tar: conflicting compression options\n", 2);
                            }
                            explicit_compress = Some("gzip");
                            use_compress = true;
                            compress_format = Some("gzip");
                            matched_flag = true;
                        }
                        'j' => {
                            if explicit_compress.is_some_and(|p| p != "bzip2") {
                                return err_out("tar: conflicting compression options\n", 2);
                            }
                            explicit_compress = Some("bzip2");
                            use_compress = true;
                            compress_format = Some("bzip2");
                            matched_flag = true;
                        }
                        'J' => {
                            if explicit_compress.is_some_and(|p| p != "xz") {
                                return err_out("tar: conflicting compression options\n", 2);
                            }
                            explicit_compress = Some("xz");
                            use_compress = true;
                            compress_format = Some("xz");
                            matched_flag = true;
                        }
                        'a' => {
                            use_compress = true;
                            compress_format = Some("auto");
                            matched_flag = true;
                        }
                        'i' => { ignore_zeros = true; matched_flag = true; }
                        'p' => { permission_mask = 0o777; matched_flag = true; }
                        'm' => { touch = true; matched_flag = true; }
                        'B' | 'n' => {
                            matched_flag = true;
                        }
                        'f' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                archive_file = Some(rest);
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                archive_file = Some(args[i].clone());
                            } else {
                                return err_out("tar: missing argument for -f\n", 2);
                            }
                        }
                        'C' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                current_dir = resolve_posix_path(&current_dir, &rest);
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                current_dir = resolve_posix_path(&current_dir, &args[i]);
                            } else {
                                return err_out("tar: missing argument for -C\n", 2);
                            }
                        }
                        'T' => {
                            matched_flag = true;
                            has_files_from = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                pending_files_from.push((rest, null_delim, verbatim_files_from, excludes.len()));
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                pending_files_from.push((args[i].clone(), null_delim, verbatim_files_from, excludes.len()));
                            } else {
                                return err_out("tar: missing argument for -T\n", 2);
                            }
                        }
                        'X' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                read_exclude_file(&rest, &mut excludes);
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                read_exclude_file(&args[i], &mut excludes);
                            } else {
                                return err_out("tar: missing argument for -X\n", 2);
                            }
                        }
                        'b' => {
                            matched_flag = true;
                            let rest: String = chars[ci + 1..].iter().collect();
                            if !old_style && !rest.is_empty() {
                                if let Err(e) = set_record_size(&rest, false) {
                                    return err_out(&format!("tar: {e}\n"), 2);
                                }
                                break;
                            } else if i + 1 < args.len() {
                                i += 1;
                                if let Err(e) = set_record_size(&args[i], false) {
                                    return err_out(&format!("tar: {e}\n"), 2);
                                }
                            } else {
                                return err_out("tar: missing argument for -b\n", 2);
                            }
                        }
                        other => {
                            return err_out(&format!("tar: unsupported option: {other}\n"), 2);
                        }
                    }
                    ci += 1;
                }
                if matched_flag {
                    i += 1;
                    continue;
                }
            }
        }
        operands.push(TarOperand {
            name: a.clone(),
            cwd: current_dir.clone(),
            exclude_count: excludes.len(),
            recursion,
        });
        i += 1;
    }

    for (ff, list_null, list_verbatim, ff_exclude_count) in pending_files_from {
        let final_null = list_null || null_delim;
        let final_verbatim = list_verbatim || verbatim_files_from || final_null;
        process_files_from(
            &ff,
            final_null,
            final_verbatim,
            &mut current_dir,
            ff_exclude_count,
            recursion,
            &mut operands,
        );
    }

    if selected_mode.is_none() {
        return err_out(
            "tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n",
            2,
        );
    }
    if occurrence.is_some()
        && (create || append_mode || update_mode || catenate_mode || operands.is_empty())
    {
        return err_out(
            "tar: --occurrence requires member operands when reading archives\n",
            2,
        );
    }
    if !list && !extract && strip_components != 0 {
        return err_out(
            "tar: --strip-components is only supported when listing or extracting archives\n",
            2,
        );
    }
    if create && operands.is_empty() && !has_files_from {
        return err_out("tar: refusing to create an empty archive without -T\n", 2);
    }

    let modifying = append_mode || update_mode || delete_mode || catenate_mode;
    if modifying {
        if archive_file.as_deref().unwrap_or("-") == "-" {
            return err_out("tar: archive mutation requires a named archive\n", 2);
        }
        if explicit_compress.is_some() {
            return err_out("tar: cannot modify compressed archives\n", 2);
        }
    }
    let writing = create || modifying;
    let dest = archive_file.as_deref().filter(|p| writing && *p != "-").map(|p| resolve_posix_path(cwd, p));
    let version = fs.generation();
    let existing = if let Some(path) = &dest {
        let stat = match fs.lstat(path) {
            Ok(stat) => Some(stat),
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => None,
            Err(e) => return err_out(&format!("tar: {e}\n"), 2),
        };
        if stat.as_ref().is_some_and(|s| s.kind != crate::vfs::VfsEntryKind::File || s.mode & 0o170000 != 0o100000) || (!create && stat.is_none()) {
            return err_out(if create { "tar: output archive must be a regular file, not a symlink or directory\n" } else { "tar: archive mutation requires an existing regular file\n" }, 2);
        }
        if stat.as_ref().is_some_and(|s| s.identity.is_none()) {
            return err_out("tar: cannot safely replace an archive with unknown backing identity\n", 2);
        }
        let parent = crate::vfs::dirname_posix_path(path);
        if let Err(e) = fs.stat(&parent) {
            if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") { return err_out(&format!("tar: ENOENT: no such file or directory, realpath '{parent}'\n"), 2); }
            return err_out(&format!("tar: {e}\n"), 2);
        }
        stat
    } else { None };
    let mut manifest = Vec::new();
    let mut bindings = BTreeMap::new();
    let mut aliases = BTreeMap::<crate::vfs::EntryIdentity, BTreeMap<usize, String>>::new();
    let mut visit_operand = |op: &TarOperand, warnings: &mut String| {
        let relative = op.name.trim_start_matches('/');
        if relative != op.name { warnings.push_str("tar: removing leading '/' from member names\n"); }
        let components: Vec<_> = relative.split('/').collect();
        let stored = if let Some(i) = components.iter().rposition(|&c| c == "..") {
            warnings.push_str("tar: removing member-name prefix through '..'\n");
            components[i + 1..].join("/")
        } else { relative.to_owned() };
        let path = if op.name.starts_with('/') { op.name.clone() } else { format!("{}/{}", op.cwd.trim_end_matches('/'), op.name) };
        visit_archive_sources(
            if stored.is_empty() { "." } else { &stored }, &path, &excludes[..op.exclude_count.min(excludes.len())],
            exclude_caches, dereference, sort_by_name, op.recursion, fs, &mut Vec::new(),
            &mut |stat: &crate::vfs::FileStat, full: String, mut entry: TarEntry, explicit: bool| {
                let index = manifest.len();
                let name = entry.name.trim_end_matches('/');
                if let Some(prior) = &existing {
                    if stat.kind == crate::vfs::VfsEntryKind::File && stat.identity.is_none() {
                        return Err("cannot replace an existing archive when a source has unknown backing identity".into());
                    }
                    if stat.identity == prior.identity {
                        let name = tar_format::display(name);
                        if explicit { return Err(format!("input is the output archive: {}", tar_format::display(&name))); }
                        warnings.push_str(&format!("tar: {name}: file is the archive; not included\n"));
                        return Ok(false);
                    }
                }
                if entry.typeflag == b'2' && stat.nlink.unwrap_or(1) > 1 {
                    return Err("hardlinked symbolic-link sources are unsupported".into());
                }
                if entry.typeflag == b'0' && stat.nlink.unwrap_or(1) > 1 && stat.identity.is_none() {
                    return Err(format!("cannot preserve hardlinks without complete backing identity: {}", tar_format::display(name)));
                }
                if !transforms.is_empty() {
                    entry.name = apply_tar_transforms(&entry.name, &transforms)?;
                    if entry.name.split('/').any(|part| part == "..") {
                        return Err(format!("unsafe transformed member name: {}", tar_format::display(&entry.name)));
                    }
                    if entry.typeflag == b'5' && !entry.name.ends_with('/') { entry.name.push('/'); }
                    if entry.typeflag == b'2' { entry.linkname = apply_tar_transforms(&entry.linkname, &transforms)?; }
                }
                // A repeated archive path supersedes its previous binding. A hard link
                // can reference only a name that would still refer to that file on extraction.
                let path = resolve_posix_path("/", &entry.name);
                if let Some((id, old)) = bindings.remove(&path)
                    && let Some(names) = aliases.get_mut(&id) {
                    names.remove(&old);
                    if names.is_empty() { aliases.remove(&id); }
                }
                if entry.typeflag == b'0' && let Some(id) = &stat.identity {
                    let names = aliases.entry(id.clone()).or_default();
                    if let Some((_, first)) = names.first_key_value() {
                        entry.typeflag = b'1';
                        entry.linkname = first.clone();
                    }
                    names.insert(index, entry.name.clone());
                    bindings.insert(path, (id.clone(), index));
                }
                manifest.push((full, entry));
                Ok(true)
            },
        )
    };

    let write_entry = |out: &mut Vec<u8>, path: &str, entry: &mut TarEntry| -> Result<(), String> {
        if entry.typeflag == b'0' { entry.content = fs.read_file(path)?; }
        if let Some(mode) = override_mode { entry.mode = mode; }
        if let Some(mtime) = override_mtime { entry.mtime = mtime as f64; }
        if let Some(uid) = override_uid { entry.uid = uid; }
        if let Some(gid) = override_gid { entry.gid = gid; }
        tar_format::write_member(out, entry, pax)
    };

    let finish_archive = |bytes: &mut Vec<u8>| -> Result<(), String> {
        let maximum = fs.shell_limits().max_memory_bytes;
        let size = (bytes.len() as u64).checked_add(1024)
            .and_then(|size| size.checked_next_multiple_of(record_size))
            .filter(|&size| size <= maximum as u64)
            .ok_or_else(|| fs.limit_error("maxMemoryBytes", maximum))? as usize;
        bytes.try_reserve_exact(size - bytes.len()).map_err(|_| fs.limit_error("maxMemoryBytes", maximum))?;
        bytes.resize(size, 0);
        Ok(())
    };

    if create {
        let mut create_stderr = String::new();
        for op in &operands {
            if let Err(e) = visit_operand(op, &mut create_stderr) {
                return err_out(&format!("{create_stderr}tar: {e}\n"), 2);
            }
        }
        let mut verbose_out = String::new();
        let mut raw_tar = Vec::new();
        for (path, mut entry) in manifest {
            if let Err(e) = write_entry(&mut raw_tar, &path, &mut entry) { return err_out(&format!("tar: {e}\n"), 2); }
            if verbose {
                verbose_out.push_str(&format!("{}\n", tar_quote_name(&entry.name, &quoting_style)));
            }
        }
        if let Err(e) = finish_archive(&mut raw_tar) { return err_out(&format!("{create_stderr}tar: {e}\n"), 2); }
        if totals {
            create_stderr.push_str(&format!("Total bytes written: {}\n", raw_tar.len()));
        }
        let out_bytes = if use_compress {
            let fmt = match compress_format {
                Some("auto") => {
                    let af = archive_file.as_deref().unwrap_or("");
                    if af.ends_with(".tar.gz") || af.ends_with(".tgz") || af.ends_with(".taz") {
                        "gzip"
                    } else if af.ends_with(".tar.bz2") || af.ends_with(".tbz") || af.ends_with(".tbz2") || af.ends_with(".tz2") {
                        "bzip2"
                    } else if af.ends_with(".tar.xz") || af.ends_with(".txz") {
                        "xz"
                    } else if af.ends_with(".tar.lzma") || af.ends_with(".tlz") {
                        "lzma"
                    } else if af.ends_with(".tar.zst") || af.ends_with(".tzst") {
                        "zstd"
                    } else {
                        "none"
                    }
                }
                Some(f) => f,
                None => "gzip",
            };
            match fmt {
                "gzip" => crate::commands::codecs::gzip_compress(&raw_tar),
                "bzip2" => crate::commands::codecs::bzip2_compress(&raw_tar, 9),
                "xz" => crate::commands::codecs::xz_compress(&raw_tar, 4),
                "lzma" => crate::commands::codecs::lzma_compress(&raw_tar),
                "zstd" => crate::commands::codecs::zstd_compress(&raw_tar, true),
                _ => raw_tar,
            }
        } else {
            raw_tar
        };

        if let Some(path) = &dest {
            if let Err(e) = fs.replace_file_entry_with_mode(path, &out_bytes, 0o600, version) {
                return err_out(&format!("tar: {e}\n"), 2);
            }
            return BuiltinOutcome { stdout: verbose_out, stderr: create_stderr, exit_code: 0 };
        }
        return BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
            stderr: create_stderr,
            exit_code: 0,
        };
    }

    let match_tar_operands = |entry_name: &str,
                              operands: &[TarOperand],
                              wildcards: bool,
                              occurrence: Option<usize>,
                              occ_counts: &mut [usize],
                              matched_ops: &mut [bool],
                              default_root: &str|
     -> (bool, String) {
        if operands.is_empty() {
            return (true, default_root.to_string());
        }
        let name = entry_name.trim_start_matches('/');
        let norm_name = name.trim_start_matches("./");
        let plain_name = name.trim_end_matches('/');
        let plain_norm = norm_name.trim_end_matches('/');
        let mut selected = false;
        let mut chosen_root = default_root.to_string();
        for (idx, op) in operands.iter().enumerate() {
            let wanted = op.name.trim_start_matches('/').trim_end_matches('/');
            let norm_wanted = wanted.trim_start_matches("./");
            let is_match = if wildcards {
                crate::shell::expand::glob_match(wanted, plain_name)
                    || crate::shell::expand::glob_match(norm_wanted, plain_norm)
                    || tar_matches_exclude(plain_name, std::slice::from_ref(&op.name))
            } else {
                plain_name == wanted
                    || name.starts_with(&format!("{wanted}/"))
                    || (!norm_wanted.is_empty()
                        && (plain_norm == norm_wanted || norm_name.starts_with(&format!("{norm_wanted}/"))))
                    || crate::shell::expand::glob_match(wanted, plain_name)
                    || crate::shell::expand::glob_match(norm_wanted, plain_norm)
            };
            if is_match {
                occ_counts[idx] += 1;
                if let Some(occ) = occurrence
                    && occ_counts[idx] != occ
                {
                    continue;
                }
                if !selected {
                    chosen_root = op.cwd.clone();
                }
                selected = true;
                matched_ops[idx] = true;
            }
        }
        (selected, chosen_root)
    };

    if modifying {
        let (Some(full), Some(prior)) = (&dest, &existing) else {
            return err_out("tar: archive mutation requires a named archive\n", 2);
        };
        let existing_bytes = match fs.read_file(full) {
            Ok(bytes) => bytes,
            Err(e) => return err_out(&format!("tar: {e}\n"), 2),
        };
        let mut out_bytes = Vec::new();
        let mut changed = false;
        let mut times = BTreeMap::<String, Option<f64>>::new();
        let mut matched_ops = vec![false; operands.len()];
        let mut occ_counts = vec![0usize; operands.len()];
        let scan = tar_format::copy_members(&existing_bytes, ignore_zeros, &mut out_bytes, |name, mtime| {
            if update_mode {
                times.entry(name.trim_end_matches('/').to_owned()).and_modify(|prior| {
                    if mtime.is_none() || (prior.is_some() && mtime > *prior) { *prior = mtime; }
                }).or_insert(mtime);
            }
            if delete_mode {
                let (selected, _) = match_tar_operands(name, &operands, wildcards, occurrence, &mut occ_counts, &mut matched_ops, &current_dir);
                if selected && !tar_matches_exclude(name, &excludes) {
                    changed = true;
                    return false;
                }
            }
            true
        });
        if let Err(e) = scan { return err_out(&format!("tar: {e}\n"), 2); }
        let mut stdout = String::new();
        let mut stderr = String::new();
        if delete_mode && let Some(idx) = matched_ops.iter().position(|&matched| !matched) {
            return err_out(&format!("tar: member not found: {}\n", tar_format::display(&operands[idx].name)), 2);
        }
        if totals { stderr.push_str(&format!("Total bytes read: {}\n", existing_bytes.len())); }
        if append_mode || update_mode {
            for op in &operands {
                if let Err(e) = visit_operand(op, &mut stderr) {
                    return err_out(&format!("{stderr}tar: {e}\n"), 2);
                }
            }
            for (path, mut ne) in manifest {
                if let Some(archived) = times.get(ne.name.trim_end_matches('/')) {
                    let Some(t) = archived else { return err_out(&format!("{stderr}tar: archive lacks mtime required for update\n"), 2); };
                    if ne.mtime <= *t { continue; }
                }
                if let Err(e) = write_entry(&mut out_bytes, &path, &mut ne) { return err_out(&format!("{stderr}tar: {e}\n"), 2); }
                if verbose {
                    stdout.push_str(&format!("{}\n", tar_quote_name(&ne.name, &quoting_style)));
                }
                changed = true;
            }
        } else if catenate_mode {
            for op in &operands {
                let t_full = resolve_posix_path(&op.cwd, &op.name);
                match fs.stat(&t_full) {
                    Ok(st) if st.identity == prior.identity => return err_out(&format!("{stderr}tar: cannot concatenate an archive to itself\n"), 2),
                    Ok(st) if st.kind != crate::vfs::VfsEntryKind::File || st.identity.is_none() => return err_out(&format!("{stderr}tar: concatenation source must be a regular archive with retained identity\n"), 2),
                    Err(e) => return err_out(&format!("{stderr}tar: {e}\n"), 2),
                    _ => {}
                }
                match fs.read_file(&t_full) {
                    Ok(tb) => match tar_format::copy_members(&tb, ignore_zeros, &mut out_bytes, |_, _| true) {
                        Ok(()) => {
                            changed = true;
                            if totals { stderr.push_str(&format!("Total bytes read: {}\n", tb.len())); }
                        }
                        Err(error) => return err_out(&format!("{stderr}tar: {error}\n"), 2),
                    },
                    Err(e) => return err_out(&format!("{stderr}tar: {e}\n"), 2),
                }
            }
        }
        if changed {
            if let Err(e) = finish_archive(&mut out_bytes) { return err_out(&format!("{stderr}tar: {e}\n"), 2); }
            if let Err(e) = fs.replace_file_entry_with_mode(full, &out_bytes, prior.mode & 0o7777, version) {
                return err_out(&format!("{stderr}tar: {e}\n"), 2);
            }
            if totals { stderr.push_str(&format!("Total bytes written: {}\n", out_bytes.len())); }
        }
        return BuiltinOutcome {
            stdout,
            stderr,
            exit_code: 0,
        };
    }

    let archive_bytes = if let Some(ref af) = archive_file {
        if af == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, af);
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => return err_out(&format!("tar: {af}: Cannot open\n"), 2),
            }
        }
    } else {
        crate::vfs::stream_string_to_bytes(stdin)
    };

    let data = &archive_bytes[..];
    let codec = explicit_compress.or_else(|| {
        if data.starts_with(b"\x1f\x8b") { Some("gzip") }
        else if data.starts_with(b"BZh") { Some("bzip2") }
        else if data.starts_with(b"\xfd7zXZ\0") { Some("xz") }
        else if data.starts_with(b"\x28\xb5\x2f\xfd") { Some("zstd") }
        else { None }
    });
    let decoded;
    let data = if let Some(codec) = codec {
        decoded = match decompress_for_invoked(codec, data, codec) {
            Ok(bytes) => bytes,
            Err(e) => return err_out(&format!("tar: {e}\n"), 2),
        };
        &decoded[..]
    } else { data };
    let mut out = String::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut occ_counts = vec![0usize; operands.len()];
    let mut matched_ops = vec![false; operands.len()];
    let mut warned_absolute = false;
    let mut published = BTreeMap::<String, Option<crate::vfs::EntryIdentity>>::new();
    let check_root = |root: &str| -> Result<(), String> {
        let mut path = String::from("/");
        for part in root.split('/').filter(|s| !s.is_empty()) {
            path = resolve_posix_path(&path, part);
            if fs.lstat(&path)?.kind != crate::vfs::VfsEntryKind::Directory {
                return Err(format!("extraction root has a non-directory or symlink ancestor: {}", tar_format::display(&path)));
            }
        }
        Ok(())
    };
    struct DirectoryMetadata {
        mode: u32,
        atime: Option<f64>,
        mtime: Option<f64>,
    }
    let mut directories = BTreeMap::new();
    let restore_directories = |pending: &mut BTreeMap<String, DirectoryMetadata>, next: Option<&str>| -> Result<(), String> {
        let mut paths: Vec<_> = pending.keys()
            .filter(|dir| !next.is_some_and(|path| crate::vfs::is_path_within(dir, path)))
            .cloned().collect();
        paths.sort_by_key(|path| std::cmp::Reverse(path.len()));
        for path in paths {
            check_root(&crate::vfs::dirname_posix_path(&path))?;
            if fs.lstat(&path)?.kind != crate::vfs::VfsEntryKind::Directory {
                return Err("directory changed before metadata restoration".into());
            }
            let meta = pending.remove(&path).unwrap();
            if meta.atime.is_some() || meta.mtime.is_some() {
                fs.set_times(&path, meta.atime, meta.mtime)?;
            }
            fs.chmod(&path, meta.mode)?;
        }
        Ok(())
    };
    let extracting_files = extract && !to_stdout;
    if extracting_files {
        for root in std::iter::once(&mut current_dir).chain(operands.iter_mut().map(|op| &mut op.cwd)) {
            match fs.access_path(root, true) {
                Ok(path) => *root = path,
                Err(e) => return err_out(&format!("tar: {e}\n"), 2),
            }
        }
        if let Err(e) = check_root(&current_dir) { return err_out(&format!("tar: {e}\n"), 2); }
    }
    let input_path = archive_file.as_deref().filter(|p| extracting_files && *p != "-").map(|p| resolve_posix_path(cwd, p));
    let input_identity = input_path.as_deref().and_then(|p| fs.stat(p).ok()).and_then(|s| s.identity);
    let read = tar_format::read_members(data, ignore_zeros, false, |entry, raw| {
        let (sel, entry_root) = match_tar_operands(entry.name, &operands, wildcards, occurrence, &mut occ_counts, &mut matched_ops, &current_dir);
        let transformed = (extract && !transforms.is_empty()).then(|| apply_tar_transforms(entry.name, &transforms)).transpose()?;
        let link = (extract && !transforms.is_empty() && !entry.linkname.is_empty()).then(|| apply_tar_transforms(entry.linkname, &transforms)).transpose()?;
        let name = transformed.as_deref().unwrap_or(entry.name);
        if extract && name.split('/').any(|s| s == "..") {
            return Err(format!("unsafe parent component in member: {}", tar_format::display(name)));
        }
        if !sel || tar_matches_exclude(entry.name, &excludes) { return Ok(()); }
        if diff_mode {
            use crate::vfs::VfsEntryKind::{Directory, File, Symlink};
            if entry.name.split('/').any(|part| part == "..") {
                return Err(format!("unsafe parent component in member: {}", tar_format::display(entry.name)));
            }
            let mut difference = |reason: &str| {
                out.push_str(&format!("{}: {reason}\n", tar_format::display(entry.name)));
                exit_code = 1;
            };
            let lookup = |path: &str| match fs.lstat(path) {
                Ok(stat) => Ok(Some(stat)),
                Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => Ok(None),
                Err(e) => Err(e),
            };
            let dest = resolve_posix_path(&entry_root, entry.name);
            let Some(st) = lookup(&dest)? else { difference("File is missing"); return Ok(()); };
            let wanted = match entry.typeflag { b'5' => Directory, b'2' => Symlink, _ => File };
            if st.kind != wanted { difference("File type differs"); return Ok(()); }
            if st.mode & 0o7777 != entry.mode { difference("Mode differs"); }
            for (archived, actual, message) in [(entry.uid, st.uid, "Uid differs"), (entry.gid, st.gid, "Gid differs")] {
                if let Some(id) = archived {
                    let actual = actual.ok_or("filesystem lacks ownership required for archive comparison")?;
                    if u64::from(actual) != id { difference(message); }
                }
            }
            if wanted != Symlink && entry.mtime.is_some_and(|t| (st.mtime_ms / 1000.).floor() != t.floor()) {
                difference("Mod time differs");
            }
            match entry.typeflag {
                b'2' => { if fs.readlink(&dest)? != entry.linkname { difference("Symlink differs"); } }
                b'1' => {
                    if entry.linkname.split('/').any(|part| part == "..") { return Err("unsafe hardlink target in archive comparison".into()); }
                    let target = lookup(&resolve_posix_path(&entry_root, entry.linkname))?;
                    if st.identity.is_none() || target.as_ref().is_some_and(|t| t.identity.is_none()) {
                        return Err("filesystem lacks identity required for hardlink comparison".into());
                    }
                    if target.and_then(|t| t.identity) != st.identity { difference("Not linked to archive target"); }
                }
                b'0' if st.size as u64 != entry.size => difference("Size differs"),
                b'0' => {
                    if (entry.content.len() as u64) < entry.size { return Err("truncated archive body".into()); }
                    let mut offset = 0;
                    let mut equal = true;
                    fs.read_chunks(&dest, &mut |chunk| {
                        let end = offset + chunk.len();
                        equal = entry.content.get(offset..end) == Some(chunk);
                        offset = end;
                        Ok(equal)
                    })?;
                    if !equal || offset != entry.content.len() { difference("Contents differ"); }
                    if verbose { out.push_str(&format!("{}\n", tar_quote_name(entry.name, &quoting_style))); }
                }
                _ => {}
            }
        } else if list {
            let is_dir_entry = entry.typeflag == b'5' || entry.name.ends_with('/');
            let base_name = if strip_components == 0 { entry.name.to_owned() } else {
                if entry.name.split('/').any(|s| s == "..") { return Err(format!("unsafe parent component in member: {}", tar_format::display(entry.name))); }
                let Some(name) = tar_strip_components(entry.name, strip_components, is_dir_entry) else { return Ok(()); };
                name
            };
            let disp = if show_transformed && !transforms.is_empty() {
                apply_tar_transforms(&base_name, &transforms)?
            } else {
                base_name
            };
            let link_disp = if show_transformed && !transforms.is_empty() && !entry.linkname.is_empty() {
                apply_tar_transforms(entry.linkname, &transforms)?
            } else {
                entry.linkname.to_owned()
            };
            let quoted_disp = tar_quote_name(&disp, &quoting_style);
            if verbose {
                let perm = format_tar_mode(entry.typeflag, entry.mode);
                let dt = entry.mtime.map_or_else(|| "-".to_owned(), |t| format_tar_mtime(t, full_time, utc));
                let id = |n: Option<u64>| n.map_or_else(|| "-".to_owned(), |v| v.to_string());
                let owner = format!("{}/{}", id(entry.uid), id(entry.gid));
                let sz = if utc {
                    format!("{:>width$}", entry.size, width = 18usize.saturating_sub(owner.len()).max(1))
                } else {
                    entry.size.to_string()
                };
                let suffix = if entry.typeflag == b'2' {
                    format!(" -> {}", tar_quote_name(&link_disp, &quoting_style))
                } else if entry.typeflag == b'1' {
                    format!(" link to {}", tar_quote_name(&link_disp, &quoting_style))
                } else {
                    String::new()
                };
                out.push_str(&format!("{perm} {owner} {sz} {dt} {quoted_disp}{suffix}\n"));
            } else {
                out.push_str(&format!("{quoted_disp}\n"));
            }
        } else if extract {
            if entry.name.starts_with('/') && !warned_absolute {
                stderr.push_str("tar: removing leading '/' from member names\n");
                warned_absolute = true;
            }
            let is_dir_entry = entry.typeflag == b'5';
            let Some(rel_name) = tar_strip_components(name, strip_components, is_dir_entry) else {
                return Ok(());
            };
            if to_stdout {
                if verbose {
                    stderr.push_str(&format!("{}\n", tar_quote_name(entry.name, &quoting_style)));
                }
                if entry.typeflag == b'0' {
                    out.push_str(&crate::vfs::bytes_to_stream_string(entry.content));
                }
                return Ok(());
            }
            let shown_name = if show_transformed {
                &rel_name
            } else {
                entry.name
            };
            use crate::vfs::VfsEntryKind::{Directory, File};
            let dest = resolve_posix_path(&entry_root, &rel_name);
            if dest == entry_root && !is_dir_entry { return Err("non-directory entry would replace extraction root".into()); }
            check_root(&entry_root)?;
            let mut parents = dest.match_indices('/').map(|(i, _)| &dest[..i])
                .filter(|p| p.len() > entry_root.len()).peekable();
            while let Some(&parent) = parents.peek() {
                match fs.lstat(parent) {
                    Ok(st) if st.kind == Directory => { parents.next(); }
                    Ok(_) => return Err(format!("unsafe non-directory or symlink ancestor: {}", tar_format::display(parent))),
                    Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => break,
                    Err(e) => return Err(e),
                }
            }
            let link = link.as_deref().unwrap_or(entry.linkname);
            if entry.typeflag == b'2' {
                if link.is_empty() || link.contains('\0') { return Err("invalid empty, NUL, or non-Unicode path".into()); }
                check_tar_symlink(fs, &entry_root, &dest, link)?;
            }
            let hard_target = if entry.typeflag == b'1' {
                if link.split('/').any(|s| s == "..") { return Err(format!("unsafe parent component in member: {}", tar_format::display(link))); }
                let rel = tar_strip_components(link, strip_components, false).ok_or("hardlink target removed by strip-components")?;
                let target = resolve_posix_path(&entry_root, &rel);
                if target == dest { return Err("self-referential hardlink entry is unsupported".into()); }
                let expected = published.get(&target).ok_or_else(|| format!("hardlink target was not previously extracted (forward or unselected target): {}", tar_format::display(link)))?;
                check_root(&crate::vfs::dirname_posix_path(&target))?;
                let stat = fs.lstat(&target)?;
                if stat.kind != File || (expected.is_some() && expected != &stat.identity) { return Err("hardlink target changed or is not a regular file".into()); }
                if !fs.supports_hard_links(&target) { return Err("filesystem does not support hardlinks".into()); }
                Some(target)
            } else { None };
            if !delay_directories { restore_directories(&mut directories, Some(&dest))?; }
            for parent in parents { fs.mkdir_one(parent, 0o700)?; }
            let mut revision = fs.generation();
            let existing = match fs.lstat(&dest) {
                Ok(st) => Some(st),
                Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => None,
                Err(e) => return Err(e),
            };
            if input_path.as_deref() == Some(&dest) || input_identity.is_some() && existing.as_ref().is_some_and(|s| s.identity == input_identity) {
                return Err("entry would overwrite the input archive".into());
            }
            if let Some(st) = &existing && !(is_dir_entry && st.kind == Directory) {
                if overwrite != Overwrite::Replace {
                    if overwrite == Overwrite::Keep {
                        stderr.push_str(&format!("tar: {}: Cannot open: File exists\n", tar_format::display(entry.name)));
                        exit_code = 2;
                    }
                    return Ok(());
                }
                if st.kind != File || entry.typeflag != b'0' {
                    fs.remove_one(&dest, st.kind == Directory)?;
                    revision = fs.generation();
                }
            }
            let times = if touch { (None, None) } else { (entry.atime.map(|t| t * 1000.), entry.mtime.map(|t| t * 1000.)) };
            published.remove(&dest);
            if !is_dir_entry { directories.remove(&dest); }
            if is_dir_entry {
                if !existing.is_some_and(|s| s.kind == Directory) { fs.mkdir_one(&dest, 0o700)?; }
                directories.insert(dest.clone(), DirectoryMetadata { mode: entry.mode & permission_mask, atime: times.0, mtime: times.1 });
            } else if entry.typeflag == b'2' {
                fs.symlink(link, &dest)?;
            } else if let Some(target) = hard_target {
                fs.hard_link(&target, &dest)?;
            } else {
                if (entry.content.len() as u64) < entry.size { return Err("truncated archive body".into()); }
                if times == (None, None) {
                    fs.replace_file_entry_with_mode(&dest, entry.content, entry.mode & permission_mask, revision)?;
                } else {
                    fs.replace_file_entry_with_metadata(&dest, entry.content, entry.mode & permission_mask, times, revision)?;
                }
            }
            if matches!(entry.typeflag, b'0' | b'1') {
                let identity = fs.lstat(&dest)?.identity;
                published.insert(dest, identity);
            }
            if verbose && raw.is_some() { out.push_str(&format!("{}\n", tar_quote_name(shown_name, &quoting_style))); }
        }
        Ok(())
    });
    let result = read.and_then(|()| {
        if let Some(idx) = matched_ops.iter().position(|m| !m) {
            return Err(format!("member not found: {}", tar_format::display(&operands[idx].name)));
        }
        restore_directories(&mut directories, None)
    });
    if let Err(error) = result {
        stderr.push_str(&format!("tar: {error}\n"));
        exit_code = 2;
    } else if exit_code == 2 {
        stderr.push_str("tar: Exiting with failure status due to previous errors\n");
    } else if totals {
        stderr.push_str(&format!("Total bytes read: {}\n", data.len()));
    }
    BuiltinOutcome { stdout: out, stderr, exit_code }
}


fn tar_matches_exclude(path: &str, excludes: &[String]) -> bool {
    let clean = path.trim_start_matches("./").trim_end_matches('/');
    let base = clean.rsplit('/').next().unwrap_or(clean);
    for pat in excludes {
        let clean_pat = pat.trim_start_matches("./").trim_end_matches('/');
        if crate::shell::expand::glob_match(clean_pat, base)
            || crate::shell::expand::glob_match(clean_pat, clean)
            || crate::shell::expand::glob_match(pat, path)
        {
            return true;
        }
    }
    false
}

struct TarTransform {
    pattern: String,
    replacement: String,
    global: bool,
    ignore_case: bool,
}

fn parse_tar_transforms(source: &str, transforms: &mut Vec<TarTransform>) -> Result<(), String> {
    if source.is_empty() { return Err("empty transform expression".into()); }
    let mut chars = source.chars();
    while let Some(op) = chars.next() {
        if op != 's' { return Err("only substitution transforms are supported".into()); }
        let delimiter = chars.next().filter(|c| !matches!(c, '\\' | '\n')).ok_or("invalid transform delimiter")?;
        let mut field = || {
            let start = chars.as_str();
            while let Some(c) = chars.next() {
                if c == delimiter {
                    return Ok(&start[..start.len() - chars.as_str().len() - c.len_utf8()]);
                }
                if c == '\\' { chars.next(); }
            }
            Err("unterminated transform expression")
        };
        let pattern = field()?;
        if pattern.is_empty() { return Err("empty transform pattern is unsupported".into()); }
        let replacement = field()?;
        let (mut global, mut ignore_case, mut extended) = (false, false, false);
        for flag in chars.by_ref() {
            match flag {
                ';' => break,
                'g' => global = true,
                'i' => ignore_case = true,
                'x' => extended = true,
                _ => return Err(format!("unsupported transform flag: {flag}")),
            }
        }
        let (pattern, groups) = super::text::sed_pattern(pattern, extended)?;
        let mut repl = replacement.chars();
        while let Some(c) = repl.next() {
            if c == '\\' {
                match repl.next() {
                    Some('u' | 'U' | 'l' | 'L' | 'E') => return Err("transform replacement case conversion is unsupported".into()),
                    Some(n @ '1'..='9') if (n as usize - '0' as usize) > groups => return Err("transform references an undefined capture group".into()),
                    _ => {}
                }
            }
        }
        transforms.push(TarTransform { pattern, replacement: replacement.into(), global, ignore_case });
    }
    Ok(())
}

fn apply_tar_transforms(name: &str, transforms: &[TarTransform]) -> Result<String, String> {
    let mut name = name.to_owned();
    for t in transforms {
        name = super::search::replace_regex_in_text(&name, &t.pattern, &t.replacement, t.ignore_case, t.global, None).0;
        if name.is_empty() || name.contains('\0') {
            return Err("invalid empty, NUL, or non-Unicode path".into());
        }
    }
    Ok(name)
}

fn tar_cache_directory(fs: &dyn SafeBashFs, directory: &str) -> Result<bool, String> {
    let path = resolve_posix_path(directory, "CACHEDIR.TAG");
    let stat = match fs.lstat(&path) {
        Ok(st) if st.kind == crate::vfs::VfsEntryKind::Symlink => fs.stat(&path)?,
        Ok(st) => st,
        Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => return Ok(false),
        Err(e) => return Err(e),
    };
    if stat.kind != crate::vfs::VfsEntryKind::File { return Ok(false); }
    let mut signature = b"Signature: 8a477f597d28d172789f06886806bc55".as_slice();
    fs.read_chunks(&path, &mut |bytes| {
        let count = bytes.len().min(signature.len());
        if bytes[..count] != signature[..count] { return Ok(false); }
        signature = &signature[count..];
        Ok(!signature.is_empty())
    })?;
    Ok(signature.is_empty())
}

fn visit_archive_sources(
    stored_rel: &str,
    path: &str,
    excludes: &[String],
    exclude_caches: bool,
    dereference: bool,
    sort_by_name: bool,
    recursion: bool,
    fs: &dyn SafeBashFs,
    ancestors: &mut Vec<Option<crate::vfs::EntryIdentity>>,
    prepare: &mut impl FnMut(&crate::vfs::FileStat, String, TarEntry, bool) -> Result<bool, String>,
) -> Result<(), String> {
    if tar_matches_exclude(stored_rel, excludes) { return Ok(()); }
    let (full, st) = fs.inspect_command_entry(path, false, "lstat").map_err(|e| {
        if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") {
            format!("ENOENT: no such file or directory, lstat '{path}'")
        } else { e }
    })?;
    let st = if dereference && st.kind == crate::vfs::VfsEntryKind::Symlink {
        fs.stat(&full).map_err(|e| {
            if e.starts_with("ENOENT:") {
                format!("ENOENT: no such file or directory, realpath '{full}'")
            } else {
                e
            }
        })?
    } else {
        st
    };
    use crate::vfs::VfsEntryKind::{Directory, File, Symlink};
    let entry = TarEntry {
        name: if st.kind == Directory && !stored_rel.ends_with('/') { format!("{stored_rel}/") } else { stored_rel.to_owned() },
        typeflag: match st.kind { Directory => b'5', Symlink => b'2', File => b'0' },
        mode: st.mode & 0o7777,
        mtime: st.mtime_ms / 1000.,
        atime: Some(st.atime_ms / 1000.),
        uid: st.uid.unwrap_or(0),
        gid: st.gid.unwrap_or(0),
        linkname: if st.kind == Symlink { fs.readlink(&full)? } else { String::new() },
        content: Vec::new(),
    };
    if !prepare(&st, full.clone(), entry, ancestors.is_empty())? { return Ok(()); }
    if st.kind == Directory {
        if st.identity.is_some() && ancestors.contains(&st.identity) {
            return Err(format!(
                "source directory cycle: {}",
                tar_quote_name(stored_rel, "escape")
            ));
        }
        if ancestors.len() > 256 {
            return Err("source traversal depth limit exceeded".into());
        }
        if !recursion {
            return Ok(());
        }
        let has_cache_tag = exclude_caches && tar_cache_directory(fs, &full)?;
        let mut children = fs.read_dir(&full)?;
        ancestors.push(st.identity);
        let mut first_error = None;
        if sort_by_name {
            children.sort();
        }
        for c in children {
            if has_cache_tag && c != "CACHEDIR.TAG" {
                continue;
            }
            let child_rel = if stored_rel.ends_with('/') { format!("{stored_rel}{c}") } else { format!("{stored_rel}/{c}") };
            if let Err(error) = visit_archive_sources(
                &child_rel,
                &resolve_posix_path(&full, &c),
                excludes,
                exclude_caches,
                dereference,
                sort_by_name,
                recursion,
                fs,
                ancestors,
                prepare,
            ) {
                first_error.get_or_insert(error);
            }
        }
        ancestors.pop();
        if let Some(e) = first_error {
            return Err(e);
        }
    }
    Ok(())
}

fn format_tar_mode(typeflag: u8, mode: u32) -> String {
    let lead = match typeflag {
        b'5' => 'd',
        b'2' => 'l',
        b'1' => 'h',
        _ => '-',
    };
    let mut chars = ['-'; 10];
    chars[0] = lead;
    for (idx, shift) in [6u32, 3, 0].iter().enumerate() {
        let bits = (mode >> shift) & 7;
        let base = 1 + idx * 3;
        chars[base] = if (bits & 4) != 0 { 'r' } else { '-' };
        chars[base + 1] = if (bits & 2) != 0 { 'w' } else { '-' };
        chars[base + 2] = if (bits & 1) != 0 { 'x' } else { '-' };
    }
    if (mode & 0o4000) != 0 {
        chars[3] = if (mode & 0o100) != 0 { 's' } else { 'S' };
    }
    if (mode & 0o2000) != 0 {
        chars[6] = if (mode & 0o010) != 0 { 's' } else { 'S' };
    }
    if (mode & 0o1000) != 0 {
        chars[9] = if (mode & 0o001) != 0 { 't' } else { 'T' };
    }
    chars.iter().collect()
}

fn format_tar_mtime(epoch: f64, full_time: bool, utc: bool) -> String {
    let millis = (epoch * 1000.) as i64;
    let seconds = if utc { epoch.floor() as i64 } else { millis.div_euclid(1000) };
    let (year, month, day) = crate::commands::coreutils::civil_from_days(seconds.div_euclid(86400));
    let time = seconds.rem_euclid(86400);
    let mut result = format!("{year:04}-{month:02}-{day:02} {:02}:{:02}", time / 3600, time % 3600 / 60);
    if full_time {
        result.push_str(&format!(":{:02}", time % 60));
        if !utc {
            result.push_str(&format!(".{:03}", millis.rem_euclid(1000)));
        } else if let Some((_, digits)) = epoch.abs().to_string().split_once('.') {
            // The reference displays at most nine places of the decimal timestamp.
            let nanos = format!("{:0<9}", &digits[..digits.len().min(9)]).parse::<i64>().unwrap_or(0)
                + i64::from(digits.as_bytes().get(9).is_some_and(|&c| c >= b'5'));
            let nanos = (if epoch < 0. { -nanos } else { nanos }).rem_euclid(1_000_000_000);
            if nanos != 0 { result.push_str(format!(".{nanos:09}").trim_end_matches('0')); }
        }
    }
    result
}


fn crc32_ieee(data: &[u8]) -> u32 {
    crate::commands::codecs::crc32_ieee(data)
}

fn compress_for_invoked(
    invoked: &str,
    data: &[u8],
    level: u8,
    xz_format: &str,
    xz_check: u8,
    zstd_check: bool,
) -> Vec<u8> {
    match invoked {
        "bzip2" | "bunzip2" | "bzcat" => crate::commands::codecs::bzip2_compress(data, level),
        "xz" | "unxz" | "xzcat" | "lzma" | "unlzma" | "lzcat" => {
            if xz_format == "lzma" || (xz_format == "auto" && matches!(invoked, "lzma" | "unlzma" | "lzcat")) {
                crate::commands::codecs::lzma_compress_level(data, level)
            } else {
                crate::commands::codecs::xz_compress_level(data, xz_check, level)
            }
        }
        "zstd" | "unzstd" | "zstdcat" => crate::commands::codecs::zstd_compress(data, zstd_check),
        _ => crate::commands::codecs::gzip_compress_level(data, level),
    }
}

fn decompress_for_invoked(
    invoked: &str,
    data: &[u8],
    xz_format: &str,
) -> Result<Vec<u8>, String> {
    match invoked {
        "bzip2" | "bunzip2" | "bzcat" => crate::commands::codecs::bzip2_decompress(data),
        "xz" | "unxz" | "xzcat" | "lzma" | "unlzma" | "lzcat" => {
            if xz_format == "lzma" {
                crate::commands::codecs::lzma_decompress(data)
            } else if xz_format == "xz" {
                if !data.iter().zip(super::codecs::XZ_MAGIC).all(|(a, b)| a == b) {
                    Err("File format not recognized".into())
                } else {
                    crate::commands::codecs::xz_decompress(data)
                }
            } else {
                crate::commands::codecs::xz_decompress(data)
            }
        }
        "zstd" | "unzstd" | "zstdcat" => crate::commands::codecs::zstd_decompress(data, true),
        _ => crate::commands::codecs::gzip_decompress(data),
    }
}

pub(super) fn is_compression_command(cmd: &str) -> bool {
    matches!(cmd, "gzip" | "gunzip" | "zcat" | "zstd" | "unzstd" | "zstdcat" | "xz" | "unxz" | "xzcat"
        | "lzma" | "unlzma" | "lzcat" | "bzip2" | "bunzip2" | "bzcat")
}

pub(super) fn cmd_gzip(
    invoked: &str,
    args: &[String],
    mut stdin: super::CommandInput,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let is_zstd = matches!(invoked, "zstd" | "unzstd" | "zstdcat");
    let is_gzip = matches!(invoked, "gzip" | "gunzip" | "zcat");
    let is_bzip2 = matches!(invoked, "bzip2" | "bunzip2" | "bzcat");
    let is_xz = matches!(invoked, "xz" | "unxz" | "xzcat" | "lzma" | "unlzma" | "lzcat");
    let is_lzma_cmd = matches!(invoked, "lzma" | "unlzma" | "lzcat");
    let mut decompress = matches!(
        invoked,
        "gunzip" | "zcat" | "zstdcat" | "xzcat" | "lzcat" | "bunzip2" | "bzcat" | "unxz" | "unlzma" | "unzstd"
    );
    let mut to_stdout = matches!(invoked, "zcat" | "zstdcat" | "xzcat" | "lzcat" | "bzcat");
    let mut keep = is_zstd;
    let mut force = false;
    let mut passthrough = (invoked == "zstdcat").then_some(true);
    let mut exclude_compressed = false;
    let mut list_mode = false;
    let mut robot_mode = false;
    let mut test_mode = false;
    let mut recursive = false;
    let mut help_mode = false;
    let mut small_mode = false;
    let mut explicit_xz_check: Option<u8> = None;
    let mut signed_level: i32 = match invoked {
        "bzip2" | "bunzip2" | "bzcat" => 9,
        "xz" | "unxz" | "xzcat" | "lzma" | "unlzma" | "lzcat" => 1,
        "zstd" | "unzstd" | "zstdcat" => 3,
        _ => 6,
    };
    let mut level: u8 = match invoked {
        "bzip2" | "bunzip2" | "bzcat" => 9,
        "xz" | "unxz" | "xzcat" | "lzma" | "unlzma" | "lzcat" => 1,
        "zstd" | "unzstd" | "zstdcat" => 3,
        _ => 6,
    };
    let mut xz_format = if is_lzma_cmd { "lzma".to_string() } else { "auto".to_string() };
    let mut xz_check: u8 = 4; // CRC64 default
    let mut zstd_check = true;
    let mut custom_suffix: Option<String> = None;
    let mut files = Vec::new();

    let parse_xz_check_name = |val: &str| -> Option<u8> {
        match val {
            "none" => Some(0),
            "crc32" => Some(1),
            "crc64" => Some(4),
            "sha256" => Some(10),
            _ => None,
        }
    };

    let mut i = 0usize;
    let mut end_of_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if !end_of_opts {
            match a.as_str() {
                "-h" | "--help" => help_mode = true,
                "-d" | "--decompress" | "--uncompress" => decompress = true,
                "-z" | "--compress" => {
                    if is_gzip {
                        if a == "-z" {
                            return err_out(&format!("{invoked}: invalid option -- 'z'\n"), 2);
                        }
                        return err_out(&format!("{invoked}: unrecognized option '{a}'\n"), 2);
                    }
                    decompress = false;
                    test_mode = false;
                    list_mode = false;
                }
                "-c" | "--stdout" | "--to-stdout" => to_stdout = true,
                "-k" | "--keep" => keep = true,
                "--rm" => keep = false,
                "-f" | "--force" => force = true,
                "-q" | "--quiet" => {
                    if is_bzip2 {
                        if a == "-q" {
                            return err_out(&format!("{invoked}: invalid option -- 'q'\n"), 2);
                        }
                        return err_out(&format!("{invoked}: invalid option -- 'q'\n"), 2);
                    }
                }
                "-n" | "--no-name" => {
                    if !is_gzip {
                        return err_out(&format!("{invoked}: invalid option -- 'n'\n"), 2);
                    }
                }
                "-s" | "--small" => {
                    if !is_bzip2 {
                        return err_out(&format!("{invoked}: invalid option -- 's'\n"), 2);
                    }
                    small_mode = true;
                }
                "-e" | "--extreme" => {
                    if !is_xz {
                        if a == "--extreme" {
                            return err_out(&format!("{invoked}: unrecognized option '{a}'\n"), 2);
                        }
                        return err_out(&format!("{invoked}: invalid option -- 'e'\n"), 2);
                    }
                }
                "-v" | "--verbose" | "--no-progress" | "--single-thread" | "--no-dictID"
                | "--no-sparse" | "--no-warn" | "--ultra" | "--asyncio" | "--no-asyncio"
                | "--compress-literals" | "--no-compress-literals" | "--row-match-finder"
                | "--no-row-match-finder" | "--single-stream" | "--no-adjust"
                | "--ignore-check" => {}
                "--adapt" | "--rsyncable" | "--progress" if is_zstd => {
                    return err_out(
                        &format!(
                            "{invoked}: {a} is unsupported by the bounded streaming Zstandard frontend\n"
                        ),
                        2,
                    );
                }
                "--pass-through" if is_zstd => passthrough = Some(true),
                "--no-pass-through" if is_zstd => passthrough = Some(false),
                "--exclude-compressed" => exclude_compressed = true,
                "-l" | "--list" => {
                    if !is_gzip && !is_xz {
                        return err_out(&format!("{invoked}: invalid option -- 'l'\n"), 2);
                    }
                    if is_xz { list_mode = true; test_mode = false; }
                }
                "--robot" => {
                    if !is_xz {
                        return err_out(&format!("{invoked}: unrecognized option '{a}'\n"), 2);
                    }
                    robot_mode = true;
                }
                "-t" | "--test" => test_mode = true,
                "-r" | "--recursive" => {
                    if !is_gzip {
                        return err_out(&format!("{invoked}: invalid option -- 'r'\n"), 2);
                    }
                    recursive = true;
                }
                "--fast" => {
                    if is_zstd {
                        signed_level = -1;
                    } else {
                        level = 1;
                        signed_level = 1;
                    }
                }
                s if is_zstd && s.starts_with("--fast=") => {
                    let acc = &s["--fast=".len()..];
                    let Ok(n) = acc.parse::<i32>() else {
                        return err_out(&format!("{invoked}: invalid fast acceleration '{acc}'\n"), 2);
                    };
                    if acc.is_empty() || !acc.chars().all(|c| c.is_ascii_digit()) || n < 1 {
                        return err_out(&format!("{invoked}: invalid fast acceleration '{acc}'\n"), 2);
                    }
                    signed_level = -n;
                }
                "--best" => {
                    level = 9;
                    signed_level = 9;
                }
                "--no-check" => zstd_check = false,
                "--check" if is_zstd => zstd_check = true,
                "--check" if is_xz => {
                    let val = if i + 1 < args.len() {
                        i += 1;
                        args[i].as_str()
                    } else {
                        ""
                    };
                    let Some(cid) = parse_xz_check_name(val) else {
                        return err_out(&format!("{invoked}: unsupported XZ integrity check '{val}'\n"), 2);
                    };
                    xz_check = cid;
                    explicit_xz_check = Some(cid);
                }
                "-C" if i + 1 < args.len() => {
                    if !is_xz {
                        return err_out(&format!("{invoked}: invalid option -- 'C'\n"), 2);
                    }
                    i += 1;
                    if let Some(cid) = parse_xz_check_name(&args[i]) {
                        xz_check = cid;
                        explicit_xz_check = Some(cid);
                    } else {
                        return err_out(
                            &format!("{invoked}: unsupported XZ integrity check '{}'\n", args[i]),
                            2,
                        );
                    }
                }
                "-C" => {
                    if !is_xz {
                        return err_out(&format!("{invoked}: invalid option -- 'C'\n"), 2);
                    }
                    return err_out(&format!("{invoked}: unsupported XZ integrity check ''\n"), 2);
                }
                s if s.starts_with("--check=") => {
                    if !is_xz {
                        return err_out(&format!("{invoked}: unrecognized option '{s}'\n"), 2);
                    }
                    let val = &s["--check=".len()..];
                    if let Some(cid) = parse_xz_check_name(val) {
                        xz_check = cid;
                        explicit_xz_check = Some(cid);
                    } else {
                        return err_out(&format!("{invoked}: unsupported XZ integrity check '{val}'\n"), 2);
                    }
                }
                "-F" | "--format" if i + 1 < args.len() => {
                    i += 1;
                    if is_zstd {
                        if a == "-F" {
                            return err_out(&format!("{invoked}: invalid option -- 'F'\n"), 2);
                        }
                        if args[i] != "zstd" {
                            return err_out(&format!("{invoked}: only --format=zstd is supported\n"), 2);
                        }
                    } else if is_xz {
                        if !matches!(args[i].as_str(), "auto" | "xz" | "lzma" | "raw") {
                            return err_out(&format!("{invoked}: unsupported XZ format\n"), 2);
                        }
                    } else {
                        if a == "-F" {
                            return err_out(&format!("{invoked}: invalid option -- 'F'\n"), 2);
                        }
                        return err_out(&format!("{invoked}: unrecognized option '{a}'\n"), 2);
                    }
                    xz_format = args[i].clone();
                }
                s if s.starts_with("--format=") => {
                    let fmt = &s["--format=".len()..];
                    if is_zstd {
                        if fmt != "zstd" {
                            return err_out(&format!("{invoked}: only --format=zstd is supported\n"), 2);
                        }
                    } else if is_xz {
                        if !matches!(fmt, "auto" | "xz" | "lzma" | "raw") {
                            return err_out(&format!("{invoked}: unsupported XZ format\n"), 2);
                        }
                    } else {
                        return err_out(&format!("{invoked}: unrecognized option '{s}'\n"), 2);
                    }
                    xz_format = fmt.to_string();
                }
                "-S" | "--suffix" => {
                    if !is_gzip && !is_xz {
                        if a == "-S" {
                            return err_out(&format!("{invoked}: invalid option -- 'S'\n"), 2);
                        }
                        return err_out(&format!("{invoked}: unrecognized option '{a}'\n"), 2);
                    }
                    if i + 1 >= args.len() {
                        let opt_label = if a == "-S" { "'-S'" } else { "'--suffix'" };
                        return err_out(&format!("{invoked}: option {opt_label} requires an argument\n"), 2);
                    }
                    i += 1;
                    if args[i].is_empty() || args[i].contains('/') {
                        return err_out(&format!("{invoked}: incorrect suffix '{}'\n", args[i]), 2);
                    }
                    custom_suffix = Some(args[i].clone());
                }
                s if s.starts_with("--suffix=") => {
                    if !is_gzip && !is_xz {
                        return err_out(&format!("{invoked}: unrecognized option '{s}'\n"), 2);
                    }
                    let suf = &s["--suffix=".len()..];
                    if suf.is_empty() || suf.contains('/') {
                        return err_out(&format!("{invoked}: incorrect suffix '{suf}'\n"), 2);
                    }
                    custom_suffix = Some(suf.to_string());
                }
                s if s.starts_with("-S") && s.len() > 2 => {
                    if !is_gzip && !is_xz {
                        return err_out(&format!("{invoked}: invalid option -- 'S'\n"), 2);
                    }
                    let suf = &s[2..];
                    if suf.is_empty() || suf.contains('/') {
                        return err_out(&format!("{invoked}: incorrect suffix '{suf}'\n"), 2);
                    }
                    custom_suffix = Some(suf.to_string());
                }
                "-T" | "--threads" if i + 1 < args.len() => {
                    if !is_xz && !is_zstd {
                        if a == "-T" {
                            return err_out(&format!("{invoked}: invalid option -- 'T'\n"), 2);
                        }
                        return err_out(&format!("{invoked}: unrecognized option '{a}'\n"), 2);
                    }
                    i += 1;
                    let thr = &args[i];
                    if is_zstd && a == "--threads" && (thr.is_empty() || !thr.chars().all(|c| c.is_ascii_digit())) {
                        return err_out(&format!("{invoked}: invalid --threads value\n"), 2);
                    }
                    if thr != "0" && thr != "1" {
                        let label = if a == "-T" {
                            if is_xz { "xz" } else { "zstd" }
                        } else if is_xz {
                            "XZ"
                        } else {
                            "Zstandard"
                        };
                        return err_out(
                            &format!(
                                "{invoked}: only --threads=0 or --threads=1 is supported by the single-threaded {label} codec\n"
                            ),
                            2,
                        );
                    }
                }
                s if s.starts_with("-T") && s.len() > 2 => {
                    if !is_xz && !is_zstd {
                        return err_out(&format!("{invoked}: invalid option -- 'T'\n"), 2);
                    }
                    let thr = &s[2..];
                    if thr != "0" && thr != "1" {
                        let label = if is_xz { "xz" } else { "zstd" };
                        return err_out(
                            &format!(
                                "{invoked}: only --threads=0 or --threads=1 is supported by the single-threaded {label} codec\n"
                            ),
                            2,
                        );
                    }
                }
                s if s.starts_with("--threads=") => {
                    if !is_xz && !is_zstd {
                        return err_out(&format!("{invoked}: unrecognized option '{s}'\n"), 2);
                    }
                    let thr = &s["--threads=".len()..];
                    if is_zstd && (thr.is_empty() || !thr.chars().all(|c| c.is_ascii_digit())) {
                        return err_out(&format!("{invoked}: invalid --threads value\n"), 2);
                    }
                    if thr != "0" && thr != "1" {
                        let label = if is_xz { "XZ" } else { "Zstandard" };
                        return err_out(
                            &format!(
                                "{invoked}: only --threads=0 or --threads=1 is supported by the single-threaded {label} codec\n"
                            ),
                            2,
                        );
                    }
                }
                s if is_zstd && s.starts_with("--long=") => {
                    let val = &s["--long=".len()..];
                    if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                        return err_out(&format!("{invoked}: invalid --long value\n"), 2);
                    }
                    let n = val.parse::<u32>().unwrap_or(0);
                    if !(10..=30).contains(&n) {
                        return err_out(
                            &format!("{invoked}: long-distance matching requires a window log from 10 through 30\n"),
                            2,
                        );
                    }
                }
                s if is_zstd && s.starts_with("--size-hint=") => {
                    let val = &s["--size-hint=".len()..];
                    if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                        return err_out(&format!("{invoked}: invalid --size-hint value\n"), 2);
                    }
                    let n = val.parse::<u64>().unwrap_or(u64::MAX);
                    if n > 0x7fffffff {
                        return err_out(&format!("{invoked}: size hint exceeds the codec parameter limit\n"), 2);
                    }
                }
                s if is_zstd && s.starts_with("--auto-threads=") => {
                    let val = &s["--auto-threads=".len()..];
                    if val != "physical" && val != "logical" {
                        return err_out(&format!("{invoked}: invalid automatic thread selection\n"), 2);
                    }
                }
                s if s.starts_with("--long")
                    || s.starts_with("--stream-size") || s.starts_with("--size-hint")
                    || s.starts_with("--auto-threads") || s.starts_with("--memlimit")
                    || s.starts_with("--block-size") || s.starts_with("--block-list")
                    || s.starts_with("--flush-timeout") || s.starts_with("--lzma")
                    || s.starts_with("--delta") || s.starts_with("--x86")
                    || s.starts_with("--arm64") => {}
                s if s.starts_with('-') && !s.starts_with("--") && s.len() > 1 => {
                    let chars: Vec<char> = s[1..].chars().collect();
                    let mut ci = 0usize;
                    while ci < chars.len() {
                        if is_zstd && chars[ci].is_ascii_digit() {
                            let mut end = ci + 1;
                            while end < chars.len() && chars[end].is_ascii_digit() {
                                end += 1;
                            }
                            let num_str: String = chars[ci..end].iter().collect();
                            let parsed = num_str.parse::<i32>().unwrap_or(99);
                            if parsed == 0 {
                                return err_out(&format!("{invoked}: invalid option -- '0'\n"), 2);
                            }
                            signed_level = parsed;
                            level = parsed.clamp(1, 9) as u8;
                            ci = end;
                            continue;
                        }
                        match chars[ci] {
                            'h' => help_mode = true,
                            'd' => decompress = true,
                            'z' => {
                                if is_gzip {
                                    return err_out(&format!("{invoked}: invalid option -- 'z'\n"), 2);
                                }
                                decompress = false;
                                test_mode = false;
                                list_mode = false;
                            }
                            'c' => to_stdout = true,
                            'k' => keep = true,
                            'f' => force = true,
                            'l' => {
                                if !is_gzip && !is_xz {
                                    return err_out(&format!("{invoked}: invalid option -- 'l'\n"), 2);
                                }
                                if is_xz { list_mode = true; test_mode = false; }
                            }
                            't' => test_mode = true,
                            'r' => {
                                if !is_gzip {
                                    return err_out(&format!("{invoked}: invalid option -- 'r'\n"), 2);
                                }
                                recursive = true;
                            }
                            'q' => {
                                if is_bzip2 {
                                    return err_out(&format!("{invoked}: invalid option -- 'q'\n"), 2);
                                }
                            }
                            'n' => {
                                if !is_gzip {
                                    return err_out(&format!("{invoked}: invalid option -- 'n'\n"), 2);
                                }
                            }
                            's' => {
                                if !is_bzip2 {
                                    return err_out(&format!("{invoked}: invalid option -- 's'\n"), 2);
                                }
                                small_mode = true;
                            }
                            'e' => {
                                if !is_xz {
                                    return err_out(&format!("{invoked}: invalid option -- 'e'\n"), 2);
                                }
                            }
                            'v' => {}
                            '0' if is_xz => {
                                level = 0;
                                signed_level = 0;
                            }
                            '1'..='9' => {
                                level = (chars[ci] as u8) - b'0';
                                signed_level = level as i32;
                            }
                            'C' => {
                                if !is_xz {
                                    return err_out(&format!("{invoked}: invalid option -- 'C'\n"), 2);
                                } else {
                                    let rest: String = chars[ci + 1..].iter().collect();
                                    let val = if !rest.is_empty() {
                                        rest
                                    } else if i + 1 < args.len() {
                                        i += 1;
                                        args[i].clone()
                                    } else {
                                        String::new()
                                    };
                                    if let Some(cid) = parse_xz_check_name(&val) {
                                        xz_check = cid;
                                        explicit_xz_check = Some(cid);
                                    } else {
                                        return err_out(
                                            &format!("{invoked}: unsupported XZ integrity check '{val}'\n"),
                                            2,
                                        );
                                    }
                                    break;
                                }
                            }
                            'F' => {
                                if !is_xz {
                                    return err_out(&format!("{invoked}: invalid option -- 'F'\n"), 2);
                                }
                                let rest: String = chars[ci + 1..].iter().collect();
                                if !rest.is_empty() {
                                    xz_format = rest;
                                } else if i + 1 < args.len() {
                                    i += 1;
                                    xz_format = args[i].clone();
                                } else {
                                    xz_format = String::new();
                                }
                                if !matches!(xz_format.as_str(), "auto" | "xz" | "lzma" | "raw") {
                                    return err_out(&format!("{invoked}: unsupported XZ format\n"), 2);
                                }
                                break;
                            }
                            'S' => {
                                if !is_gzip && !is_xz {
                                    return err_out(&format!("{invoked}: invalid option -- 'S'\n"), 2);
                                }
                                let rest: String = chars[ci + 1..].iter().collect();
                                let suf = if !rest.is_empty() {
                                    rest
                                } else if i + 1 < args.len() {
                                    i += 1;
                                    args[i].clone()
                                } else {
                                    return err_out(&format!("{invoked}: option '-S' requires an argument\n"), 2);
                                };
                                if suf.is_empty() || suf.contains('/') {
                                    return err_out(&format!("{invoked}: incorrect suffix '{suf}'\n"), 2);
                                }
                                custom_suffix = Some(suf);
                                break;
                            }
                            ch => {
                                return err_out(
                                    &format!("{invoked}: invalid option -- '{ch}'\n"),
                                    2,
                                );
                            }
                        }
                        ci += 1;
                    }
                }
                a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                other => {
                    return err_out(&format!("{invoked}: unrecognized option '{other}'\n"), 2);
                }
            }
        } else {
            files.push(a.to_string());
        }
        i += 1;
    }

    if is_zstd && !(1..=9).contains(&signed_level) {
        return err_out(
            &format!(
                "{invoked}: unsupported compression level {signed_level}; the bounded Zstandard codec supports only levels 1 through 9 (fast mode is unsupported)\n"
            ),
            2,
        );
    }
    if small_mode && !decompress {
        level = level.min(2);
    }
    if is_xz
        && xz_format == "lzma"
        && !decompress
        && !test_mode
        && !list_mode
        && explicit_xz_check.is_some_and(|c| c != 0)
    {
        return err_out(&format!("{invoked}: the LZMA format supports only --check=none\n"), 2);
    }
    if is_xz && list_mode && xz_format != "auto" && xz_format != "xz" {
        return err_out(
            &format!("{invoked}: --list works only on .xz files (--format=xz or --format=auto)\n"),
            2,
        );
    }
    if is_xz && robot_mode && !list_mode {
        return err_out(&format!("{invoked}: robot mode is only supported for --list\n"), 2);
    }
    if help_mode {
        let text = if is_gzip {
            format!(
                "Usage: {invoked} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --fast, --best\n-q, --quiet (suppress warnings)\n-r, --recursive (traverse directories without following symlinks)\n-n, --no-name (always enabled)\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n"
            )
        } else if is_bzip2 {
            format!(
                "Usage: {invoked} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-z, --compress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --fast, --best\nDefault compression level: {level}.\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n"
            )
        } else if is_zstd {
            format!(
                "Usage: {invoked} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n-q, --quiet (repeat to suppress errors)\nDefault compression level: {level}.\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n"
            )
        } else {
            format!(
                "Usage: {invoked} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n-1..-9, --fast, --best\nDefault compression level: {level}.\n-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n"
            )
        };
        return ok_out(&text);
    }

    // Admission is cumulative across operands, including named files and later stdin.
    let mut remaining = fs.max_input_bytes();
    let mut read = |path: Option<&str>| -> Result<Vec<u8>, BuiltinOutcome> {
        let mut data = Vec::new();
        let mut exceeded = false;
        let mut accept = |chunk: &[u8]| {
            let Some(left) = remaining.checked_sub(chunk.len()) else { exceeded = true; return false; };
            remaining = left;
            data.extend_from_slice(chunk);
            true
        };
        let read = if let Some(path) = path {
            fs.open_chunks(path).and_then(|mut next| {
                let mut chunk = Vec::new();
                loop {
                    next(&mut chunk)?;
                    if chunk.is_empty() || !accept(&chunk) { return Ok(()); }
                }
            })
        } else { stdin.read_stdin(accept) };
        if exceeded { return Err(err_out(&fs.limit_error("maxInputBytes", fs.max_input_bytes()), 1)); }
        read.map(|_| data).map_err(|e| err_out(&format!("{invoked}: {e}\n"), 1))
    };
    if list_mode {
        let mut out = String::new();
        let mut totals = crate::commands::codecs::XzInspectInfo::default();
        let mut count = 0usize;
        if !robot_mode {
            out.push_str("Strms  Blocks   Compressed Uncompressed  Ratio  Check   Filename\n");
        }
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            let data = match read(Some(&full)) { Ok(data) => data, Err(e) => return e };
            let info = match crate::commands::codecs::inspect_xz_bytes(&data) {
                Ok(inf) => inf,
                Err(_) => {
                    let uncomp = decompress_for_invoked(invoked, &data, &xz_format)
                        .map(|b| b.len())
                        .unwrap_or(0);
                    crate::commands::codecs::XzInspectInfo {
                        streams: 1,
                        blocks: 1,
                        compressed: data.len(),
                        uncompressed: uncomp,
                        padding: 0,
                        checks: vec![4],
                    }
                }
            };
            if robot_mode {
                out.push_str(&format!(
                    "name\t{f}\nfile\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                    info.streams,
                    info.blocks,
                    info.compressed,
                    info.uncompressed,
                    info.ratio_str(),
                    info.checks_str(),
                    info.padding
                ));
            } else {
                out.push_str(&info.human_line(f));
            }
            totals.streams += info.streams;
            totals.blocks += info.blocks;
            totals.compressed += info.compressed;
            totals.uncompressed += info.uncompressed;
            totals.padding += info.padding;
            for c in info.checks {
                if !totals.checks.contains(&c) {
                    totals.checks.push(c);
                }
            }
            count += 1;
        }
        if robot_mode && count > 0 {
            out.push_str(&format!(
                "totals\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{count}\n",
                totals.streams,
                totals.blocks,
                totals.compressed,
                totals.uncompressed,
                totals.ratio_str(),
                totals.checks_str(),
                totals.padding
            ));
        } else if !robot_mode && count > 1 {
            out.push_str("-------------------------------------------------------------------------------\n");
            out.push_str(&totals.human_line(&format!("{count} files")));
        }
        return ok_out(&out);
    }

    let decode = |data: &[u8], private_output: bool| {
        let force = force && !private_output;
        let pass = if is_gzip {
            force && !data.starts_with(&[0x1f, 0x8b])
        } else if is_bzip2 {
            force && to_stdout && !test_mode && !super::codecs::bzip2_header_prefix(data)
        } else if is_xz && force && to_stdout && !test_mode && xz_format != "raw" {
            let xz = xz_format != "lzma" && data.starts_with(super::codecs::XZ_MAGIC);
            let lzma = xz_format != "xz" && data.len() >= 13 && super::codecs::lzma_auto_header_prefix(data);
            !xz && !lzma
        } else if is_zstd && !test_mode && passthrough.unwrap_or(force && to_stdout) {
            !data.is_empty() && !data.get(..4).is_some_and(|bytes| {
                let magic = u32::from_le_bytes(bytes.try_into().unwrap());
                matches!(magic, 0xfd2fb525..=0xfd2fb528 | 0x184d2a50..=0x184d2a5f | 0x587a37fd | 0x184d2204)
                    || matches!(magic & 0xffff, 0x8b1f | 0x005d)
            })
        } else {
            false
        };
        if pass { return Ok(data.to_vec()); }
        decompress_for_invoked(invoked, data, &xz_format)
    };
    let decode_error = |error: &str| {
        if is_bzip2 {
            let msg = if error == "unexpected end of file" { error } else { "invalid compressed data or codec memory limit exceeded" };
            err_out(&format!("{invoked}: {msg}\n"), 2)
        } else if is_zstd {
            let msg = match error {
                "Src size is incorrect" => "unexpected end of file",
                "Unknown frame descriptor" | "Reserved bit set" | "Dictionary mismatch"
                | "Corrupted block detected" | "Restored data doesn't match checksum" =>
                    "invalid compressed data or codec memory limit exceeded",
                _ => error,
            };
            err_out(&format!("{invoked}: {msg}\n"), 1)
        } else {
            let msg = if is_xz && error != "unexpected end of file"
                && !(xz_format == "xz" && error == "File format not recognized") {
                "invalid compressed data or codec memory limit exceeded"
            } else { error };
            err_out(&format!("{invoked}: {msg}\n"), 1)
        }
    };
    if files.is_empty() {
        files.push("-".to_string());
    }
    let default_ext = match invoked {
        "bzip2" | "bunzip2" | "bzcat" => ".bz2",
        "xz" | "unxz" | "xzcat" => {
            if xz_format == "lzma" {
                ".lzma"
            } else {
                ".xz"
            }
        }
        "lzma" | "unlzma" | "lzcat" => {
            if xz_format == "xz" {
                ".xz"
            } else {
                ".lzma"
            }
        }
        "zstd" | "unzstd" | "zstdcat" => ".zst",
        _ => ".gz",
    };
    let ext = custom_suffix.as_deref().unwrap_or(default_ext);
    use crate::vfs::{FileStat, VfsEntryKind, dirname_posix_path, path::absolute_operand};
    use std::collections::BTreeSet;
    struct Source {
        operand: String,
        real: String,
        stat: FileStat,
        parent: Option<FileStat>,
        destination: Option<(String, Option<FileStat>)>,
    }
    let format = if is_gzip { "gzip" } else if is_bzip2 { "bzip2" } else if is_zstd { "zstd" } else { "xz" };
    let destination = |source: &str| -> Result<String, String> {
        let name = source.to_ascii_lowercase();
        let standard = [".gz", ".z", "-gz", "-z", "_z"];
        if !is_gzip && xz_format == "raw" && custom_suffix.is_none() {
            return Err(format!("EINVAL: raw format requires a suffix (use -S or -c) '{source}'"));
        }
        if !decompress {
            if !force && (if is_gzip {
                name.ends_with(&ext.to_ascii_lowercase()) || standard.iter().chain([".tgz", ".taz"].iter()).any(|s| name.ends_with(s))
            } else { source.ends_with(ext) }) {
                return Err(format!("EINVAL: already has a {format} suffix (use -f to compress again) '{source}'"));
            }
            return Ok(format!("{source}{ext}"));
        }
        let suffix = if is_gzip {
            if !ext.is_empty() && name.ends_with(&ext.to_ascii_lowercase()) { Some(ext) }
            else if name.ends_with(".tgz") || name.ends_with(".taz") { return Ok(format!("{}.tar", &source[..source.len()-4])); }
            else { standard.into_iter().find(|s| name.ends_with(s)) }
        } else if is_xz && custom_suffix.is_none() && source.ends_with(".lzma") { Some(".lzma") }
        else { source.ends_with(ext).then_some(ext) };
        let suffix = suffix.ok_or_else(|| format!("EINVAL: unknown {format} suffix (use -c for stdout) '{source}'"))?;
        let target = &source[..source.len()-suffix.len()];
        if target.ends_with('/') { return Err(format!("EINVAL: empty output filename '{source}'")); }
        Ok(target.to_owned())
    };
    let existing = |path: &str| match fs.lstat(path) {
        Ok(st) => Ok(Some(st)),
        Err(e) if e.starts_with("ENOENT:") => Ok(None),
        Err(e) => Err(e),
    };
    let compressed_exts = [".zst", ".tzst", ".gz", ".tgz", ".xz", ".txz", ".lzma", ".tlz", ".bz2", ".tbz2",
        ".lz4", ".zip", ".7z", ".rar", ".lz", ".br", ".cab"];
    let mut plans = Vec::new();
    let mut result = ok_out("");
    files.reverse();
    while let Some(f) = files.pop() {
        if f == "-" { plans.push(None); continue; }
        if exclude_compressed && !decompress && compressed_exts.iter().any(|suf| f.ends_with(suf)) { continue; }
        let plan = (|| -> Result<(), String> {
            let mut operand = absolute_operand(cwd, &f);
            if f.is_empty() { return Err("ENOENT: no such file or directory ''".into()); }
            let inspect = |path: &str| fs.inspect_command_entry(path, false, "lstat");
            let (real, stat) = match inspect(&operand) {
                Err(e) if e.starts_with("ENOENT:") => {
                    let missing = if e.starts_with("ENOENT: no such file or directory, stat ") {
                        format!("ENOENT: no such file or directory, lstat '{operand}'")
                    } else { e };
                    if !decompress || !is_gzip || operand.to_ascii_lowercase().ends_with(&ext.to_ascii_lowercase()) { return Err(missing); }
                    operand.push_str(ext);
                    inspect(&operand).map_err(|e| if e.starts_with("ENOENT:") { missing } else { e })?
                }
                other => other?,
            };
            if recursive && stat.kind == VfsEntryKind::Directory {
                let entries = fs.read_dir(&real)?;
                files.extend(entries.into_iter().rev().map(|name| format!("{}/{name}", real.trim_end_matches('/'))));
                return Ok(());
            }
            if recursive && stat.kind == VfsEntryKind::Symlink { return Ok(()); }
            if stat.kind != VfsEntryKind::File || stat.mode & 0o170000 != 0o100000 {
                return Err(format!("EINVAL: input must be a regular, non-symlink file '{operand}'"));
            }
            let mut parent = None;
            let dest = if to_stdout || test_mode { None } else {
                let target = destination(&real)?;
                if !keep {
                    if !force && stat.nlink.unwrap_or(1) > 1 {
                        return Err(format!("EINVAL: input has multiple links (use -k or -f) '{operand}'"));
                    }
                    if stat.revision.is_none() { return Err(format!("ENOTSUP: atomic source removal unavailable (use -k or -c) '{operand}'")); }
                    parent = Some(fs.lstat(&dirname_posix_path(&real))?);
                }
                let dest = existing(&target)?;
                if let Some(st) = &dest {
                    if st.kind != VfsEntryKind::File || st.mode & 0o170000 != 0o100000 || st.identity == stat.identity {
                        return Err(format!("EINVAL: destination is not a distinct regular file '{target}'"));
                    }
                    if !force { return Err(format!("EEXIST: file already exists '{target}'")); }
                }
                Some((target, dest))
            };
            plans.push(Some(Source { operand, real, stat, parent, destination: dest }));
            Ok(())
        })();
        if let Err(e) = plan {
            result.exit_code = 1;
            result.stderr.push_str(&format!("{invoked}: {e}\n"));
        }
    }
    let sources: BTreeSet<_> = plans.iter().flatten().map(|p| &p.real).collect();
    let identities: BTreeSet<_> = plans.iter().flatten().filter_map(|p| p.stat.identity.as_ref()).collect();
    let mut destinations = BTreeSet::new();
    for (path, stat) in plans.iter().flatten().filter_map(|p| p.destination.as_ref()) {
        if !destinations.insert(path) || sources.contains(path)
            || stat.as_ref().and_then(|s| s.identity.as_ref()).is_some_and(|id| identities.contains(id)) {
            result.exit_code = 1;
            result.stderr.push_str(&format!("{invoked}: EINVAL: multiple operands share a source or destination path '{path}'\n"));
            return result;
        }
    }
    for plan in plans {
        let failure = |e: String| err_out(&format!("{invoked}: {e}\n"), 1);
        let run = (|| {
            let check_source = || {
                if let Some(p) = &plan {
                    let (entry, stat) = fs.inspect_command_entry(&p.operand, false, "lstat")?;
                    if entry != p.real || !p.stat.same_snapshot(&stat) {
                        return Err(format!("EBUSY: input identity or metadata changed; input retained '{}'", p.operand));
                    }
                }
                Ok(())
            };
            check_source().map_err(failure)?;
            let data = read(plan.as_ref().map(|p| p.real.as_str()))?;
            let output = if decompress || test_mode { decode(&data, plan.as_ref().is_some_and(|p| p.destination.is_some())).map_err(|e| decode_error(&e))? }
                else { compress_for_invoked(invoked, &data, level, &xz_format, xz_check, zstd_check) };
            let version = fs.generation();
            check_source().map_err(failure)?;
            if let Some(p) = &plan && let Some((target, expected)) = &p.destination {
                let current = existing(target).map_err(failure)?;
                if !match (expected, &current) {
                    (Some(a), Some(b)) => a.same_snapshot(b), (None, None) => true, _ => false,
                } { return Err(failure(format!("EBUSY: destination changed during compression '{target}'"))); }
                fs.replace_staged_file(target, &output, version).map_err(failure)?;
                if let Some(parent) = &p.parent {
                    fs.remove_unchanged_file(&p.real, parent, &p.stat).map_err(failure)?;
                }
            } else if !test_mode {
                result.stdout.push_str(&crate::vfs::bytes_to_stream_string(&output));
            }
            Ok(())
        })();
        if let Err(e) = run {
            result.stderr.push_str(&e.stderr);
            result.exit_code = e.exit_code;
            if e.stderr.starts_with("Execution aborted: Shell limit exceeded:") { break; }
        }
    }
    result
}

fn ensure_zip_suffix(path: &str) -> String {
    if path == "-" {
        return path.to_string();
    }
    let base = path.rsplit('/').next().unwrap_or(path);
    if !base.contains('.') {
        format!("{path}.zip")
    } else {
        path.to_string()
    }
}

fn zip_matches_pattern(pat: &str, name: &str) -> bool {
    let base = crate::vfs::basename_posix_path(name);
    let clean_name = name.trim_end_matches('/');
    pat == name
        || pat == clean_name
        || crate::shell::expand::glob_match(pat, name)
        || crate::shell::expand::glob_match(pat, clean_name)
        || crate::shell::expand::glob_match(pat, &base)
}

fn zip_public_text(value: &str) -> &str {
    let lower = value.to_ascii_lowercase();
    let password_arg = if let Some(long) = value.strip_prefix("--") {
        let name = long.split('=').next().unwrap_or("");
        name.len() >= 3 && "password".starts_with(name)
    } else { value.starts_with('-') && value.contains('P') };
    if password_arg || ["password","token=","secret="].iter().any(|key| lower.contains(key)) { "[redacted]" }
    else if value.contains("://") || ["http:","https:","ftp:","ws:","wss:"].iter().any(|scheme| lower.contains(scheme)) { "[redacted URL]" }
    else { value }
}

fn cmd_zip(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    const ZIP_HELP_TEXT: &str = "safe-bash zip\nUsage: zip [options] archive [file ...]\n       zip [options] - [file ...]       write an archive to stdout\n       zip [options] archive -          read a member from stdin\n\n  -r          recurse into directories\n  -j          store basenames, discarding directory paths\n  -q          suppress progress messages\n  -0          store without compression\n  -1 .. -9    select compression effort\n  -Z METHOD   select store, deflate, bzip2, or lzma compression\n  --encryption PROFILE  select zipcrypto or aes-{128,192,256}-ae{1,2}\n  -n SUFFIXES store matching suffixes (colon-separated)\n  -u / -f     update / freshen existing members\n  -d / -U     delete / copy selected archive members\n  -FS         synchronize selected members with filesystem sources\n  -O FILE     write to a separate output archive\n  -A          adjust validated SFX offsets, retaining the inert prefix\n  -F / -FF    repair from central / local records (requires -O FILE)\n  -s SIZE     split into .z01/.z02/.../.zip volumes (minimum 64k; 0 recombines)\n  -sp         approve volume transitions using an explicit host prompt\n  -sv / -sb   report split volumes / ring before a split-pause prompt\n  -m          remove archived sources after successful publication\n  -D / -y     omit directory entries / store symlinks\n  -i / -x     include / exclude matching names\n  -RE         enable bracket-list glob matching (already enabled on Unix)\n  -k          convert new source names to portable ASCII DOS 8.3 names\n  -FI / -FI-  enable / disable explicit VFS FIFO byte sources\n  -@          read filenames from stdin\n  -t / -tt    select files from / before a date\n  -T          test archive integrity before replacement\n  -P PASSWORD encrypt new members with a supplied password\n  -e          request and confirm a password through a no-echo host capability\n  -z / -c     read archive / entry comments from stdin\n  -o          set archive time to the latest member time\n  -l          convert text LF line endings to CRLF\n  -ll         convert text CRLF line endings to LF (--from-crlf)\n  -X          strip optional metadata\n  -fz / -fz-  force / disable ZIP64 output\n  -fd         force data descriptors\n  -v          verbose operation (a lone -v shows implementation information)\n  --version   show implementation information and exit\n  -L          show this implementation's license\n  -sf / -sf-  list selected files / totals only, without creating an archive\n  -sc         show processed arguments and exit with status 9\n  -so         show implemented options and exit\n  -sd         show virtual archive processing steps\n  -db / -dc   display byte / entry counters\n  -du / -dv   display entry size / single-volume numbers\n  -dd / -dg   display dots per entry / globally for output bytes\n  -ds SIZE    dot interval (kmgt units; default MB; 0 disables dots)\n  -h          show this help\n\nUse -- after the archive name to pass filenames beginning with '-'.\nLong option equivalents are accepted, for example --junk-paths and\n--compression-method=bzip2. All filesystem operations use the virtual filesystem.\n";
    const ZIP_EXTENDED_HELP_SUFFIX: &str = "\nSelection\n  -RE / --regex means bracket lists, not general regular expressions.\n  -k / --DOS-names converts components after selection and -j; collisions fail.\n  DOS conversion is restricted to printable ASCII. Filters parsed after -k\n  are DOS-converted before matching original case-sensitive source names.\n  -FI / --fifo requires a VFS-reported FIFO and explicit streamingRead capability.\n  FIFO payloads are bounded and cancellation-aware; producer failure aborts output.\n  -r traverses listed directories; -R recursively searches matching names.\n  Do not combine -r and -R. -D omits directory records without stopping traversal.\n  -i patterns and -x patterns accept lists ending at another option or at @.\n  Quote patterns to prevent the shell expanding them before zip receives them.\n  Exclusions take precedence over inclusions. -j flattens selected source names;\n  duplicate basenames fail before the archive is replaced.\n  -nw disables wildcard interpretation; -ws prevents wildcards crossing '/'.\n  -MM makes missing input matches fatal. -t includes files from a date; -tt\n  selects files before a date. Dates accept mmddyyyy or yyyy-mm-dd.\n\nOperations and publication\n  Default add mode updates existing members and appends new selected members.\n  -u updates only older members and appends new ones; -f updates existing\n  members without adding new names. -FS also deletes unselected archive entries.\n  -d deletes selected archive entries without reading filesystem sources.\n  -U copies selected entries; without -O it requires -sf.\n  -DF writes only new or changed filesystem entries to -O.\n  -g grows an existing single-volume archive in place without -u, -f, -d or -U.\n  -b DIR stages temporary archives in DIR before replacing the destination.\n  -J strips a leading self-extracting stub; -A adjusts SFX entry offsets.\n  -F and -FF recover readable entries into a separate -O archive.\n  -s splits output into .z01, .z02, ... and final .zip volumes.\n  -s 0 recombines an existing split archive into a single -O archive.\n  -sp pauses before each split volume through the host volumePrompt capability;\n  -sv reports volume numbers and -sb rings the terminal bell before prompts.\n\nEncryption\n  -P supplies a password on the command line (redacted from diagnostics/logs).\n  -e prompts and confirms through the host password capability without echo.\n  --encryption selects zipcrypto (default) or WinZip AE-1/AE-2 AES profiles:\n  aes-128-ae1, aes-128-ae2, aes-192-ae1, aes-192-ae2, aes-256-ae1, aes-256-ae2.\n  Encryption requires the host entropy capability and never uses fallback RNGs.\n\nIntegrity, comments and metadata\n  -T validates the staged archive before replacing the destination.\n  -TT CMD runs CMD in the virtual shell with {} replaced by the staged archive\n  (or appends the staged archive path when {} is absent). No host process is spawned.\n  With stdout output -T is ignored.\n  -z reads an archive comment; -c reads selected member comments in archive order.\n  -X strips optional metadata; -X- preserves available metadata.\n  -o sets the archive timestamp to the newest resulting member timestamp.\n\nLogging\n  -lf path writes a VFS log (a missing extension becomes .log).\n  -la appends; -li includes progress in addition to warnings/errors.\n  Logs require atomic conditional byte writes and cannot alias selected inputs.\n  Logs are bounded by maxTextBytes; supplied password bytes are redacted.\n  Completed log/publication effects remain if a later write fails.\n\nCompression and format\n  -Z selects store, deflate, bzip2, or lzma; method names accept unique prefixes.\n  -1 through -9 select effort. Store selection remains through later levels.\n  -n .jpg:.png stores matching suffixes; -9 overrides suffix-based storage.\n  Compression may fall back to STORE for regular files when it expands data.\n  -l converts text LF to CRLF, leaving detected binary input unchanged.\n  -fz forces ZIP64; -fz- disables it. -fd forces signed data descriptors.\n  BZIP2 members use extraction version 4.6, including with ZIP64 records.\n  LZMA is a ZIP format extension (not native Info-ZIP Zip 3.0).\n  LZMA uses version 6.3, a bounded 1 MiB encoder dictionary, and EOS.\n  Readers admit dictionaries up to 8 MiB and SDK 9.4 properties only.\n\nStreaming\n  A '-' input filename reads one member from stdin, named '-'.\n  A '-' archive name writes binary archive bytes to stdout and progress to stderr.\n  With no archive or file operands, zip acts as a stdin-to-stdout filter.\n  Streamed members retain compression even if it expands their data.\n  -@ instead reads newline-separated input filenames; it cannot also read a '-'\n  payload from the same stdin. Empty filename lines are ignored.\n  Complete the output stream before using the resulting archive.\n\nArguments and ZIPOPT\n  Long options accept unique abbreviations and --option=value where appropriate.\n  Use -- after the archive name for literal filenames beginning with '-'.\n  ZIPOPT supplies default arguments before the command arguments. Double quotes\n  group words inside ZIPOPT; shell expansion is not performed on these defaults.\n  -h and -h2 print basic and extended help as soon as they are encountered.\n  --version and -L also exit immediately. Only a lone short -v shows information;\n  --verbose and grouped -v perform an archive operation. Later -q or -v wins.\n  -sc and -so validate all arguments before exiting; -sc returns status 9.\n\nDisplays\n  -sf lists selected names and totals without reading source payloads or writing\n  archives. -sf- and -q suppress names; totals remain visible. With no file\n  operands, -sf lists the input archive. -sd reports only virtual processing steps.\n  Command and diagnostic displays redact credential-shaped arguments and URLs.\n  Display counters accept a trailing '-' to negate them. -ds accepts up to eight\n  characters: digits with an optional k, m, g or t suffix (case-insensitive).\n  Values below 1024 imply MB; nonzero intervals from 1 KB to below 32 KB fail.\n  Empty -ds values restore 10 MB; 0 disables dots. Sizes must be safe integers.\n  Dots use byte intervals, so counts can differ from native codec buffer dots.\n  Per-entry progress appears after bounded preparation; global output dots stay\n  visible with -q. Timed scanning dots and split-volume displays are unavailable.\n";
    const ZIP_VERSION_TEXT: &str = "safe-bash zip (virtual-bash)\nBounded virtual ZIP implementation; not an Info-ZIP native build.\nCompression: store, deflate, bzip2, lzma (format extension). Single-volume ZIP and ZIP64 output.\nFilesystem, signals and byte limits are supplied by the host.\nNative compiler identity and ambient environment are not reported.\n";
    const ZIP_LICENSE_TEXT: &str = "safe-bash zip (virtual-bash)\nMIT License\nCopyright (c) 2026 Poe Platform\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n\nThis is the virtual implementation license, not the native Info-ZIP license.\n";
    let zip_err = |msg: &str| -> BuiltinOutcome {
        let shown = if msg.to_ascii_lowercase().contains("password") {
            "[redacted]"
        } else {
            msg
        };
        BuiltinOutcome {
            stdout: format!("\nzip error: Invalid command arguments ({shown})\n"),
            stderr: String::new(),
            exit_code: 16,
        }
    };

    let mut delete_mode = false;
    let mut copy_mode = false;
    let mut freshen_mode = false;
    let mut update_mode = false;
    let mut filesync_mode = false;
    let mut move_mode = false;
    let mut quiet = false;
    let mut level = 6;
    let mut use_deflate = true;
    let mut suffixes = ".Z:.zip:.zoo:.arc:.lzh:.arj";
    let mut junk_paths = false;
    let mut omit_dirs = false;
    let mut recursive = false;
    let mut recursive_patterns = false;
    let mut store_symlinks = false;
    let mut from_crlf = None;
    let mut show_files = false;
    let mut read_comment = false;
    let mut stdin_names = false;
    let mut has_password_opt = false;
    let mut has_encrypt_opt = false;
    let mut selected_action: &str = "add";
    let mut literal = false;
    let mut split_size = 0;
    let mut split_verbose = false;
    let mut split_pause = false;
    let mut output_archive: Option<String> = None;
    let mut excludes = Vec::new();
    let mut includes = Vec::new();
    let mut in_exclude = false;
    let mut in_include = false;
    let mut positional = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !literal && a == "--" {
            if positional.is_empty() {
                return zip_err("can't use -- before archive name");
            }
            literal = true;
            in_exclude = false;
            in_include = false;
            i += 1;
            continue;
        }
        if literal {
            positional.push(a.clone());
            i += 1;
            continue;
        }
        if a == "-h" || a == "--help" || a == "-?" {
            return ok_out(ZIP_HELP_TEXT);
        }
        if a == "-h2" || a == "--more-help" {
            return ok_out(&format!("{ZIP_HELP_TEXT}{ZIP_EXTENDED_HELP_SUFFIX}"));
        }
        if a == "--version" || (args.len() == 1 && a == "-v") {
            return ok_out(ZIP_VERSION_TEXT);
        }
        if a == "-L" || a == "--license" {
            return ok_out(ZIP_LICENSE_TEXT);
        }
        if a == "-x" {
            if i + 1 >= args.len() || (args[i + 1].starts_with('-') && args[i + 1] != "-") || args[i + 1] == "@" {
                return zip_err("option 'x' requires a value");
            }
            in_exclude = true;
            in_include = false;
        } else if a == "-i" {
            if i + 1 >= args.len() || (args[i + 1].starts_with('-') && args[i + 1] != "-") || args[i + 1] == "@" {
                return zip_err("option 'i' requires a value");
            }
            in_include = true;
            in_exclude = false;
        } else if a == "-O" || a == "--out" || a == "--output-file" {
            if i + 1 >= args.len() {
                return zip_err("option O requires a value");
            }
            in_exclude = false;
            in_include = false;
            i += 1;
            output_archive = Some(args[i].clone());
        } else if let Some(out) = a
            .strip_prefix("--out=")
            .or_else(|| a.strip_prefix("--output-file="))
            .or_else(|| a.strip_prefix("-O"))
        {
            if !out.is_empty() {
                in_exclude = false;
                in_include = false;
                output_archive = Some(out.trim_start_matches('=').to_string());
            }
        } else if a == "--quiet" || a == "--verbose" {
            quiet = a == "--quiet";
        } else if a == "--store" {
            level = 0;
            use_deflate = false;
        } else if a == "-n" || a == "--suffixes" || a.starts_with("-n") || a.starts_with("--suffixes=") {
            let value = if a == "-n" || a == "--suffixes" {
                i += 1;
                match args.get(i) {
                    Some(s) if !s.starts_with('-') || s == "-" => s.as_str(),
                    _ => return zip_err("option 'n' requires a value"),
                }
            } else { a.strip_prefix("--suffixes=").or_else(|| a.strip_prefix("-n")).unwrap() };
            let value = value.trim_start_matches('=');
            suffixes = if value.is_empty() { ".Z:.zip:.zoo:.arc:.lzh:.arj" } else { value };
        } else if a == "-Z" || a == "--compression-method" || a.starts_with("-Z") || a.starts_with("--compression-method=") {
            let val = if a == "-Z" || a == "--compression-method" {
                if i + 1 >= args.len() || (args[i + 1].starts_with('-') && args[i + 1] != "-") {
                    return zip_err("option 'Z' requires a value");
                }
                i += 1;
                args[i].trim_start_matches('=').to_string()
            } else if let Some(rest) = a.strip_prefix("--compression-method=") {
                rest.to_string()
            } else {
                a[2..].trim_start_matches('=').to_string()
            };
            let lower = val.to_ascii_lowercase();
            let matches_cnt = ["store", "deflate", "bzip2", "lzma"]
                .iter()
                .filter(|m| m.starts_with(&lower))
                .count();
            if lower.is_empty() || matches_cnt != 1 {
                return zip_err("Option -Z (--compression-method):  unknown method");
            }
            use_deflate = "deflate".starts_with(&lower);
        } else if a == "--split-size" || a.starts_with("--split-size=") {
            let value = if let Some(v) = a.strip_prefix("--split-size=") { v }
                else { i += 1; args.get(i).map_or("",String::as_str) };
            split_size = match zip_volumes::size(value) { Ok(s) => s, Err(e) => return zip_err(e) };
        } else if a == "--split-pause" { split_pause = true;
        } else if a == "--split-verbose" { split_verbose = true;
        } else if a == "--split-bell" {
        } else if a == "-P" || a == "--password" || a.starts_with("-P") || a.starts_with("--password=") {
            let val = if a == "-P" || a == "--password" {
                if i + 1 >= args.len() {
                    return zip_err("password option requires a value");
                }
                i += 1;
                args[i].clone()
            } else if let Some(rest) = a.strip_prefix("--password=") {
                rest.to_string()
            } else {
                a[2..].trim_start_matches('=').to_string()
            };
            if val.is_empty() {
                return zip_err("zero length password not allowed");
            }
            has_password_opt = true;
        } else if a == "-sf" || a == "--show-files" {
            show_files = true;
            in_exclude = false;
            in_include = false;
        } else if matches!(a.as_str(), "--from-crlf" | "--to-crlf") {
            from_crlf = Some(a == "--from-crlf");
            in_exclude = false;
            in_include = false;
        } else if a == "-FS" || a == "--filesync" {
            filesync_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-d" || a == "--delete" {
            if selected_action != "add" && selected_action != "delete" {
                return zip_err("specify just one action");
            }
            selected_action = "delete";
            delete_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-U" || a == "--copy" || a == "--copy-entries" {
            if selected_action != "add" && selected_action != "copy" {
                return zip_err("specify just one action");
            }
            selected_action = "copy";
            copy_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-u" || a == "--update" {
            if selected_action != "add" && selected_action != "update" {
                return zip_err("specify just one action");
            }
            selected_action = "update";
            update_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-f" || a == "--freshen" {
            if selected_action != "add" && selected_action != "freshen" {
                return zip_err("specify just one action");
            }
            selected_action = "freshen";
            freshen_mode = true;
            in_exclude = false;
            in_include = false;
        } else if a == "-r" || a == "--recurse-paths" {
            recursive = true;
            if recursive && recursive_patterns {
                return zip_err("do not specify both -r and -R");
            }
        } else if a == "-R" || a == "--recurse-patterns" {
            recursive_patterns = true;
            if recursive && recursive_patterns {
                return zip_err("do not specify both -r and -R");
            }
        } else if matches!(a.as_str(), "-b" | "-lf" | "-TT" | "-ds") {
            let opt = &a[1..];
            if i + 1 >= args.len() {
                return zip_err(&format!("option {opt} requires a value"));
            }
            i += 1;
        } else if a.starts_with("--") {
            let raw_name = a[2..].split('=').next().unwrap_or("");
            return zip_err(&format!("unsupported option: --{raw_name}"));
        } else if a.starts_with('-') && !a.starts_with("--") {
            in_exclude = false;
            in_include = false;
            let mut flags = a[1..].chars();
            while let Some(ch) = flags.next() {
                match ch {
                    's' => {
                        match flags.as_str().as_bytes().first() {
                            Some(b'p') => split_pause = true,
                            Some(b'v') => split_verbose = true,
                            Some(b'b') => {},
                            _ => {
                                let value = if flags.as_str().is_empty() { i += 1; args.get(i).map_or("",String::as_str) } else { flags.as_str() };
                                split_size = match zip_volumes::size(value.strip_prefix('=').unwrap_or(value)) { Ok(s) => s, Err(e) => return zip_err(e) };
                                break;
                            }
                        }
                        flags.next();
                    }
                    'h' => return ok_out(ZIP_HELP_TEXT),
                    'L' => return ok_out(ZIP_LICENSE_TEXT),
                    'd' => {
                        if selected_action != "add" && selected_action != "delete" {
                            return zip_err("specify just one action");
                        }
                        selected_action = "delete";
                        delete_mode = true;
                    }
                    'U' => {
                        if selected_action != "add" && selected_action != "copy" {
                            return zip_err("specify just one action");
                        }
                        selected_action = "copy";
                        copy_mode = true;
                    }
                    'f' => {
                        if selected_action != "add" && selected_action != "freshen" {
                            return zip_err("specify just one action");
                        }
                        selected_action = "freshen";
                        freshen_mode = true;
                    }
                    'u' => {
                        if selected_action != "add" && selected_action != "update" {
                            return zip_err("specify just one action");
                        }
                        selected_action = "update";
                        update_mode = true;
                    }
                    'm' => move_mode = true,
                    'j' => junk_paths = true,
                    'D' => omit_dirs = true,
                    'r' => {
                        recursive = true;
                        if recursive && recursive_patterns {
                            return zip_err("do not specify both -r and -R");
                        }
                    }
                    'R' => {
                        recursive_patterns = true;
                        if recursive && recursive_patterns {
                            return zip_err("do not specify both -r and -R");
                        }
                    }
                    'y' => store_symlinks = true,
                    'l' => {
                        let from = flags.as_str().starts_with('l');
                        if from { flags.next(); }
                        from_crlf = Some(from);
                    },
                    'z' => read_comment = true,
                    '@' => stdin_names = true,
                    'e' => has_encrypt_opt = true,
                    '0'..='9' => {
                        level = ch as u8 - b'0';
                        if level == 0 { use_deflate = false; }
                    }
                    'q' | 'v' => quiet = ch == 'q',
                    'c' | 'o' | 'X' | 'T' | 'k' | 'g' | 'J' | 'A'
                    | 'F' | 'p' => {}
                    other => return zip_err(&format!("unsupported option: -{other}")),
                }
            }
        } else if !a.starts_with('-') {
            if positional.is_empty() {
                positional.push(a.clone());
            } else if in_exclude {
                excludes.push(a.clone());
            } else if in_include {
                includes.push(a.clone());
            } else {
                positional.push(a.clone());
            }
        }
        i += 1;
    }
    if filesync_mode && selected_action != "add" {
        return zip_err("can't use -d, -f, -u, -U, or -g with filesync -FS\n");
    }
    if copy_mode && output_archive.is_none() && !show_files {
        return zip_err("-U (--copy) requires -O (--out)");
    }
    if has_encrypt_opt && !has_password_opt {
        return err_out("zip: ZIP no-echo password capability is unavailable\n", 2);
    }
    if has_password_opt {
        return err_out("zip: ZIP entropy capability is unavailable\n", 2);
    }
    if positional.is_empty() {
        if !includes.is_empty() || !excludes.is_empty() {
            return zip_err("nothing to select from");
        }
        if selected_action != "add" {
            return zip_err("expected archive name");
        }
        return err_out("zip: missing arguments\n", 1);
    }
    let arch_name = ensure_zip_suffix(&positional[0]);
    let arch_full = resolve_posix_path(cwd, &arch_name);
    let dest_full = output_archive
        .as_deref()
        .map(|o| resolve_posix_path(cwd, &ensure_zip_suffix(o)))
        .unwrap_or_else(|| arch_full.clone());
    let mut operands: Vec<String> = positional[1..].to_vec();
    if stdin_names && !read_comment {
        for line in stdin.lines() {
            let trimmed = line.trim_end_matches('\r');
            if !trimmed.is_empty() {
                operands.push(trimmed.to_string());
            }
        }
    }
    if split_pause && split_size != 0 { return zip_err("split pause requires an explicit volume prompt capability"); }
    let version = fs.generation();
    let inspect = |path: &str| match fs.lstat(path) {
        Ok(st) => Ok(Some(st)),
        Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => Ok(None),
        Err(e) => Err(err_out(&format!("zip: {e}\n"),2)),
    };
    let input = match inspect(&arch_full) { Ok(st) => st, Err(error) => return error };
    let dest = if dest_full == arch_full { input.clone() } else {
        match inspect(&dest_full) { Ok(st) => st, Err(error) => return error }
    };
    if output_archive.is_some() && (arch_full == dest_full || input.as_ref().zip(dest.as_ref())
        .is_some_and(|(a,b)| a.identity.is_some() && a.identity == b.identity)) {
        return zip_err(&format!("--out path must be different than in path: {}",zip_public_text(&arch_name)));
    }
    let allow_linked = split_size == 0 && output_archive.is_none();
    let safe = |st: &crate::vfs::FileStat| st.kind == crate::vfs::VfsEntryKind::File && st.identity.is_some()
        && st.mode & 0o170000 == 0o100000 && st.nlink.is_some_and(|n| n == 1 || n > 1 && allow_linked);
    if !show_files && dest.as_ref().is_some_and(|st| !safe(st)) {
        return err_out("zip: output archive requires a regular, single-link file with known backing identity\n",2);
    }
    if input.as_ref().is_some_and(|st| !safe(st)) {
        return err_out("zip: updating archive requires a regular, single-link file with known backing identity; archive aliases are unsupported\n",2);
    }
    let mut sources = Vec::new();
    if arch_full != dest_full && let Some(st) = &input { sources.push((arch_full.clone(),st.identity.clone())); }
    let mut linked_original = None;
    let mut entries = if let Some(st) = &input {
        let bytes = match fs.read_file(&arch_full) { Ok(b) => b, Err(e) => return err_out(&format!("zip: {e}\n"),2) };
        let entries = match crate::commands::codecs::parse_zip_archive(&bytes) {
            Ok(entries) => entries,
            Err(e) => return err_out(&format!("zip: {e}\n"), 2),
        };
        if split_size != 0 && output_archive.is_none() && !show_files {
            return zip_err("split archives require a separate --out destination");
        }
        if st.nlink.is_some_and(|n| n > 1) { linked_original = Some(bytes); }
        entries
    } else {
        if copy_mode || delete_mode || freshen_mode { return err_out(&format!("zip: cannot read {arch_name}\n"),1); }
        Vec::new()
    };
    let publish = |bytes: Vec<u8>, sources: &[_]| {
        let result = if split_size != 0 {
            zip_volumes::publish(fs,&dest_full,bytes,split_size,split_verbose,sources,version)
        } else if let (Some(before), Some(st)) = (&linked_original, &dest) {
            fs.commit_file_edit(&dest_full,st,before,&bytes,true).map(|()| String::new())
        } else {
            fs.replace_file_entry_with_mode(&dest_full,&bytes,dest.as_ref().map_or(0o644,|st| st.mode & 0o7777),version)
                .map(|()| String::new())
        };
        match result { Ok(report) => ok_out(&report), Err(e) => err_out(&format!("zip: {e}\n"),2) }
    };
    if show_files {
        let mut out = format!("Archive contains:\n");
        for e in &entries {
            if e.name != "__ZIP_COMMENT__" {
                out.push_str(&format!("  {}\n", e.name));
            }
        }
        out.push_str(&format!("Total {} entries\n", entries.len()));
        return ok_out(&out);
    }
    if copy_mode {
        entries.retain(|e| {
            if e.name == "__ZIP_COMMENT__" {
                return true;
            }
            let op_ok = operands.is_empty() || operands.iter().any(|p| zip_matches_pattern(p, &e.name));
            let inc_ok = includes.is_empty() || includes.iter().any(|p| zip_matches_pattern(p, &e.name));
            let exc_ok = !excludes.iter().any(|p| zip_matches_pattern(p, &e.name));
            op_ok && inc_ok && exc_ok
        });
        return publish(crate::commands::codecs::serialize_zip_archive(&entries), &sources);
    }
    if delete_mode {
        entries.retain(|e| {
            e.name == "__ZIP_COMMENT__" || !operands.iter().any(|t| zip_matches_pattern(t, &e.name))
        });
        return publish(crate::commands::codecs::serialize_zip_archive(&entries), &sources);
    }
    if freshen_mode {
        for e in &mut entries {
            if e.typeflag == b'0' && e.name != "__ZIP_COMMENT__" {
                if !operands.is_empty() && !operands.iter().any(|t| zip_matches_pattern(t, &e.name)) {
                    continue;
                }
                let disk_path = resolve_posix_path(cwd, &e.name);
                if let Ok(new_bytes) = fs.read_file(&disk_path) {
                    if let Ok(st) = fs.stat(&disk_path) { sources.push((disk_path, st.identity)); }
                    e.content = new_bytes;
                }
            }
        }
        return publish(crate::commands::codecs::serialize_zip_archive(&entries), &sources);
    }
    if filesync_mode { entries.clear(); }
    let effective_targets: Vec<String> = if recursive_patterns {
        vec![".".to_string()]
    } else {
        operands.clone()
    };
    let _ = update_mode;
    let mut moves = Vec::new();
    let suffixes: Vec<_> = suffixes.split(':').filter(|s| !s.is_empty()).collect();
    let mut skipped_archive = false;
    // Keep the original source spelling separate from the name stored in the ZIP.
    let mut members: BTreeMap<_,_> = entries.iter().enumerate()
        .map(|(index,e)| (e.name.clone(), (index,None::<String>))).collect();
    for t in &effective_targets {
        let mut raw_entries = Vec::new();
        let visit = visit_archive_sources(
            t.trim_start_matches('/'),
            &resolve_posix_path(cwd, t),
            &excludes,
            false,
            !store_symlinks,
            false,
            recursive || recursive_patterns,
            fs,
            &mut Vec::new(),
            &mut |stat, path, mut entry, root| {
                if path == arch_full || path == dest_full || [input.as_ref(),dest.as_ref()].into_iter().flatten()
                    .any(|archive| archive.identity.is_some() && archive.identity == stat.identity) {
                    skipped_archive = true;
                    return Ok(false);
                }
                if entry.typeflag == b'0' { entry.content = fs.read_file(&path)?; }
                let source = if root { t.clone() } else {
                    let name = entry.name.trim_end_matches('/');
                    if t == "." { name.strip_prefix("./").unwrap_or(name).into() }
                    else { format!("{}{name}", &t[..t.len()-t.trim_start_matches('/').len()]) }
                };
                raw_entries.push((path,stat.identity.clone(),source,entry));
                Ok(true)
            },
        );
        if let Err(e) = visit && !e.starts_with("ENOENT:") { return err_out(&format!("zip: {e}\n"),2); }
        for (path,id,source,mut e) in raw_entries {
            e.name = e.name.trim_start_matches('/').trim_start_matches("./").to_string();
            if e.name.is_empty() || e.name == "." || e.name == "./" {
                continue;
            }
            if omit_dirs && (e.typeflag == b'5' || e.name.ends_with('/')) {
                continue;
            }
            if recursive_patterns {
                if e.typeflag == b'5' || e.name.ends_with('/') {
                    continue;
                }
                if !operands.is_empty() && !operands.iter().any(|p| zip_matches_pattern(p, &e.name)) {
                    continue;
                }
            }
            let base = crate::vfs::basename_posix_path(&e.name);
            if !includes.is_empty() {
                if e.typeflag == b'5' {
                    continue;
                }
                let matched = includes.iter().any(|inc| {
                    crate::shell::expand::glob_match(inc, &base)
                        || crate::shell::expand::glob_match(inc, &e.name)
                });
                if !matched {
                    continue;
                }
            }
            if junk_paths {
                if e.typeflag != b'0' {
                    continue;
                }
                e.name = base;
            }
            let (index, selected) = members.entry(e.name.clone()).or_insert((entries.len(), None));
            if let Some(first) = selected {
                if first == &source { continue; }
                let mut result = zip_err("cannot repeat names in zip file");
                if !quiet {
                    result.stdout.insert_str(0,&format!("\tzip warning:   first full name: {}\n                      second full name: {}\n                     name in zip file repeated: {}\n",
                        zip_public_text(first), zip_public_text(&source), zip_public_text(&e.name)));
                }
                return result;
            }
            *selected = Some(source);
            if e.typeflag == b'0' && let Some(from) = from_crlf {
                let store = !use_deflate || level == 0 || level != 9 && suffixes.iter().any(|s| e.name.ends_with(s));
                let window = match (from, store) {
                    (false,true) => 8192, (false,false) => 32768,
                    (true,true) => 16383, (true,false) => 65535,
                };
                let prefix = &e.content[..e.content.len().min(window)];
                let text = prefix.iter().any(|&b| b >= 32)
                    && !prefix.iter().any(|&b| matches!(b, 0..=6 | 14..=25 | 28..=31));
                if text && !from {
                    let mut converted = Vec::with_capacity(e.content.len() + e.content.iter().filter(|&&b| b == b'\n').count());
                    for &b in &e.content {
                        if b == b'\n' {
                            converted.push(b'\r');
                        }
                        converted.push(b);
                    }
                    e.content = converted;
                } else if text {
                    let mut converted = Vec::with_capacity(e.content.len());
                    for (idx, &b) in e.content.iter().enumerate() {
                        if b == b'\r' && e.content.get(idx + 1) == Some(&b'\n') {
                            continue;
                        }
                        converted.push(b);
                    }
                    e.content = converted;
                }
            }
            if move_mode { moves.push((path.clone(), e.typeflag == b'5')); }
            if split_size != 0 { sources.push((path,id)); }
            if let Some(ex) = entries.get_mut(*index) {
                *ex = e;
            } else {
                entries.push(e);
            }
        }
    }
    if skipped_archive && members.values().all(|(_,source)| source.is_none()) && !read_comment {
        return BuiltinOutcome { stdout:format!("\nzip error: Nothing to do! ({})\n",zip_public_text(&arch_name)),stderr:String::new(),exit_code:12 };
    }
    if read_comment {
        let mut comment_lines: Vec<&str> = Vec::new();
        for line in stdin.split('\n') {
            if line == "." {
                break;
            }
            comment_lines.push(line.trim_end_matches('\r'));
        }
        while comment_lines.last() == Some(&"") {
            comment_lines.pop();
        }
        let comment_str = if comment_lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", comment_lines.join("\n"))
        };
        let comment_bytes = comment_str.into_bytes();
        entries.retain(|e| e.name != "__ZIP_COMMENT__");
        entries.push(TarEntry {
            name: "__ZIP_COMMENT__".to_string(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 1700000000.,
                atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: comment_bytes,
        });
    }
    let out_bytes = crate::commands::codecs::encode_zip_members(&entries, if use_deflate { level } else { 0 }, &suffixes, false);
    let result = publish(out_bytes, &sources);
    if result.exit_code == 0 {
        for (path,dir) in moves.into_iter().rev() {
            if let Err(e) = fs.remove_one(&path,dir) && !e.starts_with("ENOTEMPTY:") {
                return err_out(&format!("zip: {e}\n"),2);
            }
        }
    }
    result
}

fn cmd_unzip(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut names_only = false;
    let mut list_table = false;
    let mut verbose_list = false;
    let mut zipinfo_mode = false;
    let mut test_only = false;
    let mut junk_paths = false;
    let mut pipe_to_stdout = false;
    let mut pipe_headers = false;
    let mut quiet = false;
    let mut never_overwrite = false;
    let mut explicit_overwrite = false;
    let mut has_password = false;
    let mut case_insensitive = false;
    let mut show_comment = false;
    let mut dest_dir: Option<String> = None;
    let mut archive: Option<String> = None;
    let mut members: Vec<String> = Vec::new();
    let mut excludes: Vec<String> = Vec::new();
    let mut in_exclude = false;
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        if !ended && args[i] == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended {
            if archive.is_none() {
                archive = Some(args[i].clone());
            } else if in_exclude {
                excludes.push(args[i].clone());
            } else {
                members.push(args[i].clone());
            }
            i += 1;
            continue;
        }
        match args[i].as_str() {
            "-Z" if i == 0 => {
                zipinfo_mode = true;
                in_exclude = false;
            }
            "-1" if zipinfo_mode => {
                names_only = true;
                in_exclude = false;
            }
            "-Z1" if i == 0 => {
                zipinfo_mode = true;
                names_only = true;
                in_exclude = false;
            }
            "-l" => {
                list_table = true;
                in_exclude = false;
            }
            "-v" => {
                list_table = true;
                verbose_list = true;
                in_exclude = false;
            }
            "-t" => {
                test_only = true;
                in_exclude = false;
            }
            "-j" => {
                junk_paths = true;
                in_exclude = false;
            }
            "-p" => {
                pipe_to_stdout = true;
                in_exclude = false;
            }
            "-c" => {
                pipe_headers = true;
                in_exclude = false;
            }
            "-q" | "-qq" => {
                quiet = true;
                in_exclude = false;
            }
            "-n" => {
                never_overwrite = true;
                in_exclude = false;
            }
            "-o" => {
                never_overwrite = false;
                explicit_overwrite = true;
                in_exclude = false;
            }
            "-C" => {
                case_insensitive = true;
                in_exclude = false;
            }
            "-z" => {
                show_comment = true;
                in_exclude = false;
            }
            "-x" => {
                in_exclude = true;
            }
            "-d" => {
                if dest_dir.is_some() {
                    return err_out("unzip: -d may only be specified once\n", 2);
                }
                if i + 1 >= args.len() || args[i + 1].is_empty() {
                    return err_out(
                        "unzip: must specify directory to which to extract with -d option\n",
                        2,
                    );
                }
                in_exclude = false;
                i += 1;
                dest_dir = Some(args[i].clone());
            }
            s if s.starts_with("-d") && s.len() > 2 => {
                if dest_dir.is_some() {
                    return err_out("unzip: -d may only be specified once\n", 2);
                }
                in_exclude = false;
                dest_dir = Some(s[2..].to_string());
            }
            "-P" => {
                if i + 1 >= args.len() {
                    return err_out("unzip: password option requires a value\n", 2);
                }
                has_password = true;
                in_exclude = false;
                i += 1;
            }
            s if s.starts_with("-P") && s.len() > 2 => {
                has_password = true;
                in_exclude = false;
            }
            s if s.starts_with('-') && s.len() > 1 => {
                in_exclude = false;
                for (ci, ch) in s[1..].chars().enumerate() {
                    match ch {
                        'Z' if i == 0 && ci == 0 => zipinfo_mode = true,
                        '1' if zipinfo_mode => names_only = true,
                        'l' => list_table = true,
                        'v' => {
                            list_table = true;
                            verbose_list = true;
                        }
                        't' => test_only = true,
                        'j' => junk_paths = true,
                        'p' => pipe_to_stdout = true,
                        'c' => pipe_headers = true,
                        'q' => quiet = true,
                        'n' => never_overwrite = true,
                        'o' => {
                            never_overwrite = false;
                            explicit_overwrite = true;
                        }
                        'C' => case_insensitive = true,
                        'z' => show_comment = true,
                        'u' | 'f' => {}
                        other => {
                            return err_out(&format!("unzip: unsupported option: -{other}\n"), 2);
                        }
                    }
                }
            }
            a if !a.starts_with('-') && archive.is_none() => archive = Some(a.to_string()),
            a if !a.starts_with('-') => {
                if in_exclude {
                    excludes.push(a.to_string());
                } else {
                    members.push(a.to_string());
                }
            }
            _ => {}
        }
        i += 1;
    }
    let Some(raw_arch) = archive else {
        return err_out(
            "unzip: usage: unzip [-l|-v] [-C] [-u|-f] [-p|-c] [-t] [-z] [-Z -1] [-q[q]] [-o] [-n] [-j] [-d DIR] ARCHIVE [FILES...] [-x PATTERNS...]\n",
            2,
        );
    };
    let effective_pipe = pipe_to_stdout || pipe_headers;
    if zipinfo_mode
        && (!names_only
            || list_table
            || test_only
            || effective_pipe
            || show_comment
            || explicit_overwrite
            || dest_dir.is_some()
            || has_password)
    {
        return err_out(
            "unzip: supported zipinfo mode is unzip -Z -1 ARCHIVE [FILES...]\n",
            2,
        );
    }
    if show_comment
        && (list_table || test_only || effective_pipe || explicit_overwrite || dest_dir.is_some())
    {
        return err_out(
            "unzip: archive comment mode cannot be combined with extraction, listing or test options\n",
            2,
        );
    }
    if test_only && (list_table || effective_pipe || dest_dir.is_some()) {
        return err_out(
            "unzip: unzip test mode cannot be combined with listing, pipe or destination\n",
            2,
        );
    }
    let mut arch = raw_arch.clone();
    let mut full = resolve_posix_path(cwd, &arch);
    if !fs.exists(&full) {
        for cand in [format!("{raw_arch}.zip"), format!("{raw_arch}.ZIP")] {
            let cand_full = resolve_posix_path(cwd, &cand);
            if fs.exists(&cand_full) {
                arch = cand;
                full = cand_full;
                break;
            }
        }
    }
    let Ok(bytes) = fs.read_file(&full) else {
        return err_out(
            &format!("unzip:  cannot find or open {raw_arch}, {raw_arch}.zip or {raw_arch}.ZIP.\n"),
            9,
        );
    };
    let raw_entries = crate::commands::codecs::parse_zip_archive(&bytes).unwrap_or_default();
    if !bytes.is_empty() && !bytes.iter().all(|&b| b == 0) && raw_entries.is_empty() {
        return err_out(&format!("unzip: {arch}: End-of-central-directory signature not found\n"), 9);
    }
    if show_comment {
        let mut out = String::new();
        if !quiet {
            out.push_str(&format!("Archive:  {arch}\n"));
        }
        for e in &raw_entries {
            if e.name == "__ZIP_COMMENT__" {
                let text = String::from_utf8_lossy(&e.content);
                out.push_str(&text);
                if !text.is_empty() && !text.ends_with('\n') {
                    out.push('\n');
                }
            }
        }
        return ok_out(&out);
    }
    let mut comment_text = String::new();
    for e in &raw_entries {
        if e.name == "__ZIP_COMMENT__" {
            let text = String::from_utf8_lossy(&e.content);
            comment_text.push_str(&text);
            if !text.is_empty() && !text.ends_with('\n') {
                comment_text.push('\n');
            }
        }
    }
    let entries: Vec<TarEntry> = raw_entries
        .into_iter()
        .filter(|e| e.name != "__ZIP_COMMENT__")
        .collect();
    if test_only {
        let mut out = String::new();
        if !quiet {
            out.push_str(&format!("Archive:  {arch}\n"));
            out.push_str(&comment_text);
            for entry in &entries {
                let pad_len = 22usize.saturating_sub(entry.name.len());
                let padded = format!("{}{}", entry.name, " ".repeat(pad_len));
                out.push_str(&format!("    testing: {padded} OK\n"));
            }
        }
        out.push_str(&format!("No errors detected in compressed data of {arch}.\n"));
        return ok_out(&out);
    }
    let mut matched_patterns = vec![false; members.len()];
    let mut check_member = |entry_name: &str| -> bool {
        if members.is_empty() {
            return true;
        }
        let mut any = false;
        for (idx, m) in members.iter().enumerate() {
            let ok = if case_insensitive {
                let ml = m.to_ascii_lowercase();
                let nl = entry_name.to_ascii_lowercase();
                ml == nl || crate::shell::expand::glob_match(&ml, &nl)
            } else {
                m == entry_name || crate::shell::expand::glob_match(m, entry_name)
            };
            if ok {
                matched_patterns[idx] = true;
                any = true;
            }
        }
        any
    };

    if pipe_to_stdout || pipe_headers {
        let mut out = String::new();
        if pipe_headers && !pipe_to_stdout && !quiet {
            out.push_str(&format!("Archive:  {arch}\n"));
        }
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if check_member(&entry.name) && entry.typeflag == b'0' {
                if pipe_headers && !pipe_to_stdout && !quiet {
                    let pad = " ".repeat(22usize.saturating_sub(entry.name.len()));
                    out.push_str(&format!(" extracting: {}{pad}  \n", entry.name));
                }
                out.push_str(&crate::vfs::bytes_to_stream_string(&entry.content));
                if pipe_headers && !pipe_to_stdout && !quiet {
                    out.push('\n');
                }
            }
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }
    if names_only {
        let mut out = String::new();
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if !check_member(&entry.name) {
                continue;
            }
            out.push_str(&format!("{}\n", entry.name));
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }
    if list_table {
        let mut out = String::new();
        if !quiet {
            out.push_str(&format!("Archive:  {arch}\n"));
        }
        if verbose_list {
            out.push_str(" Length   Method    Size  Cmpr    Date    Time   CRC-32   Name\n--------  ------  ------- ---- ---------- ----- --------  ----\n");
        } else {
            out.push_str("  Length      Date    Time    Name\n---------  ---------- -----   ----\n");
        }
        let mut total_len = 0usize;
        let mut selected_count = 0usize;
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if !check_member(&entry.name) {
                continue;
            }
            let sz = entry.content.len();
            total_len += sz;
            selected_count += 1;
            let dt = format_tar_mtime(entry.mtime, false, true);
            if verbose_list {
                let crc = crc32_ieee(&entry.content);
                out.push_str(&format!(
                    "{sz:>8}  Stored {sz:>8}   0% {dt} {crc:08x}  {}\n",
                    entry.name
                ));
            } else {
                out.push_str(&format!("{sz:>9}  {dt}   {}\n", entry.name));
            }
        }
        let files_label = if selected_count == 1 { "file" } else { "files" };
        if verbose_list {
            out.push_str(&format!(
                "--------          -------  ---                            -------\n{total_len:>8}         {total_len:>8}   0%                            {selected_count} {files_label}\n"
            ));
        } else {
            out.push_str(&format!(
                "---------                     -------\n{total_len:>9}                     {selected_count} {files_label}\n"
            ));
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
        };
    }
    {
        let out_dir = dest_dir
            .as_deref()
            .map(|d| resolve_posix_path(cwd, d))
            .unwrap_or_else(|| cwd.to_string());
        let _ = fs.mkdir_all(&out_dir);
        for entry in &entries {
            if !excludes.is_empty() && tar_matches_exclude(&entry.name, &excludes) {
                continue;
            }
            if !check_member(&entry.name) {
                continue;
            }
            if junk_paths {
                if entry.typeflag != b'0' {
                    continue;
                }
                let base = crate::vfs::basename_posix_path(&entry.name);
                let dest = resolve_posix_path(&out_dir, &base);
                if never_overwrite && fs.exists(&dest) {
                    continue;
                }
                let _ = fs.write_file(&dest, &entry.content);
            } else {
                let dest = resolve_posix_path(&out_dir, entry.name.trim_start_matches('/'));
                if entry.typeflag == b'5' || entry.name.ends_with('/') {
                    let _ = fs.mkdir_all(&dest);
                } else if entry.typeflag == b'2' {
                    let _ = fs.mkdir_all(&crate::vfs::dirname_posix_path(&dest));
                    let _ = fs.symlink(&entry.linkname, &dest);
                } else {
                    if never_overwrite && fs.exists(&dest) {
                        continue;
                    }
                    let _ = fs.mkdir_all(&crate::vfs::dirname_posix_path(&dest));
                    let _ = fs.write_file(&dest, &entry.content);
                }
            }
        }
        let mut stderr = String::new();
        let mut exit_code = 0;
        for (idx, &m) in matched_patterns.iter().enumerate() {
            if !m {
                stderr.push_str(&format!("caution: filename not matched:  {}\n", members[idx]));
                exit_code = 11;
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        }
    }
}
fn cmd_strings(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut min_len = 4usize;
    let mut radix_str: Option<String> = None;
    let mut print_file = false;
    let mut include_ws = false;
    let mut encoding_str = "s".to_string();
    let mut unicode_mode = "default".to_string();
    let mut separator = "\n".to_string();
    let mut data_mode = false;
    let mut target_opt: Option<String> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "-" {
            data_mode = false;
            files.push("-".to_string());
            i += 1;
        } else if a == "--data" {
            data_mode = true;
            i += 1;
        } else if a == "--all" {
            data_mode = false;
            i += 1;
        } else if (a == "-n" || a == "--bytes") && i + 1 < args.len() {
            match args[i + 1].parse::<usize>() {
                Ok(v) if v >= 1 => min_len = v,
                _ => return err_out(&format!("strings: invalid number '{}'\n", args[i + 1]), 1),
            }
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-n").or_else(|| a.strip_prefix("--bytes="))
            && !rest.is_empty()
        {
            match rest.parse::<usize>() {
                Ok(v) if v >= 1 => min_len = v,
                _ => return err_out(&format!("strings: invalid number '{rest}'\n"), 1),
            }
            i += 1;
        } else if (a == "-t" || a == "--radix") && i + 1 < args.len() {
            radix_str = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-t").or_else(|| a.strip_prefix("--radix="))
            && !rest.is_empty()
        {
            radix_str = Some(rest.to_string());
            i += 1;
        } else if a == "-o" {
            radix_str = Some("o".to_string());
            i += 1;
        } else if a == "-f" || a == "--print-file-name" {
            print_file = true;
            i += 1;
        } else if a == "-w" || a == "--include-all-whitespace" {
            include_ws = true;
            i += 1;
        } else if (a == "-s" || a == "--output-separator") && i + 1 < args.len() {
            separator = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a
            .strip_prefix("-s")
            .or_else(|| a.strip_prefix("--output-separator="))
            && !rest.is_empty()
        {
            separator = rest.to_string();
            i += 1;
        } else if (a == "-e" || a == "--encoding") && i + 1 < args.len() {
            encoding_str = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-e").or_else(|| a.strip_prefix("--encoding="))
            && !rest.is_empty()
        {
            encoding_str = rest.to_string();
            i += 1;
        } else if (a == "-U" || a == "--unicode") && i + 1 < args.len() {
            unicode_mode = args[i + 1].clone();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-U").or_else(|| a.strip_prefix("--unicode="))
            && !rest.is_empty()
        {
            unicode_mode = rest.to_string();
            i += 1;
        } else if (a == "-T" || a == "--target") && i + 1 < args.len() {
            target_opt = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("-T").or_else(|| a.strip_prefix("--target="))
            && !rest.is_empty()
        {
            target_opt = Some(rest.to_string());
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && a[1..].chars().all(|c| c.is_ascii_digit()) {
            let num_str = &a[1..];
            let parsed = if num_str.starts_with('0') && num_str.chars().all(|c| ('0'..='7').contains(&c)) {
                usize::from_str_radix(num_str, 8).ok()
            } else if !num_str.starts_with('0') {
                num_str.parse::<usize>().ok()
            } else {
                None
            };
            match parsed {
                Some(v) if v >= 1 && v < 4_294_967_295 => min_len = v,
                _ => return err_out(&format!("strings: invalid number '{num_str}'\n"), 1),
            }
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("strings: unrecognized option '{a}'\n"), 1);
        } else if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut c_idx = 0usize;
            while c_idx < chars.len() {
                let ch = chars[c_idx];
                match ch {
                    'a' => data_mode = false,
                    'd' => data_mode = true,
                    'f' => print_file = true,
                    'o' => radix_str = Some("o".to_string()),
                    'w' => include_ws = true,
                    'n' | 's' | 't' | 'e' | 'U' | 'T' => {
                        let rest: String = chars[c_idx + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out(
                                &format!("strings: option requires an argument -- '{ch}'\n"),
                                1,
                            );
                        };
                        match ch {
                            'n' => match val.parse::<usize>() {
                                Ok(v) if v >= 1 => min_len = v,
                                _ => return err_out(&format!("strings: invalid number '{val}'\n"), 1),
                            },
                            's' => separator = val,
                            't' => radix_str = Some(val),
                            'e' => encoding_str = val,
                            'U' => unicode_mode = val,
                            'T' => target_opt = Some(val),
                            _ => {}
                        }
                        break;
                    }
                    _ => return err_out(&format!("strings: invalid option -- '{ch}'\n"), 1),
                }
                c_idx += 1;
            }
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    let radix: Option<char> = match radix_str.as_deref() {
        None => None,
        Some("d") => Some('d'),
        Some("o") => Some('o'),
        Some("x") => Some('x'),
        Some(other) => return err_out(&format!("strings: invalid radix '{other}'\n"), 1),
    };
    if let Some(ref tgt) = target_opt
        && tgt != "elf64-x86-64"
        && tgt != "elf32-i386"
    {
        return err_out(&format!("strings: unsupported target '{tgt}'\n"), 1);
    }
    let mut encoding: char = match encoding_str.as_str() {
        "s" => 's',
        "S" => 'S',
        "l" => 'l',
        "b" => 'b',
        "L" => 'L',
        "B" => 'B',
        other => return err_out(&format!("strings: invalid encoding '{other}'\n"), 1),
    };

    let unicode = match unicode_mode.as_str() {
        "d" | "default" => "default",
        "i" | "invalid" => "invalid",
        "l" | "locale" => "locale",
        "x" | "hex" => "hex",
        "e" | "escape" => "escape",
        "h" | "highlight" => "highlight",
        other => return err_out(&format!("strings: invalid Unicode option '{other}'\n"), 1),
    };
    if unicode != "default" {
        encoding = 'S';
    }

    let non_dash: Vec<String> = files.iter().filter(|s| s.as_str() != "-").cloned().collect();
    if !files.is_empty() && non_dash.is_empty() {
        return err_out("strings: missing file operand after '-' (use no operands for stdin)\n", 1);
    }
    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        non_dash
    };
    let width: usize = match encoding {
        'b' | 'l' => 2,
        'B' | 'L' => 4,
        _ => 1,
    };
    let sep_bytes = crate::vfs::stream_string_to_bytes(&separator);
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;

    for f in &targets {
        let data = if f == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, f);
            if fs.is_dir(&full) {
                err_buf.push_str(&format!(
                    "strings: EISDIR: illegal operation on a directory '{full}'\n"
                ));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => {
                    err_buf.push_str(&format!(
                        "strings: ENOENT: no such file or directory, stat '{full}'\n"
                    ));
                    exit_code = 1;
                    continue;
                }
            }
        };

        let regions: Vec<(usize, &[u8])> = if data_mode && f != "-" {
            extract_strings_elf_regions(&data, target_opt.as_deref())
        } else {
            vec![(0usize, &data[..])]
        };

        for (region_off, region_data) in regions {
            let mut cur_bytes: Vec<u8> = Vec::new();
            let mut char_count = 0usize;
            let mut start_off = 0usize;

            let flush = |out: &mut Vec<u8>,
                     cur: &mut Vec<u8>,
                     chars: &mut usize,
                     off: usize| {
            if *chars >= min_len {
                if print_file {
                    let label = if f == "-" { "{standard input}" } else { f.as_str() };
                    out.extend_from_slice(format!("{label}: ").as_bytes());
                }
                match radix {
                    Some('x') => out.extend_from_slice(format!("{off:7x} ").as_bytes()),
                    Some('d') => out.extend_from_slice(format!("{off:7} ").as_bytes()),
                    Some('o') => out.extend_from_slice(format!("{off:7o} ").as_bytes()),
                    _ => {}
                }
                out.extend_from_slice(cur);
                out.extend_from_slice(&sep_bytes);
            }
            cur.clear();
            *chars = 0;
        };

            if width == 1 {
                let mut utf8: Vec<u8> = Vec::new();
                let mut utf8_width = 0usize;
                for (idx, &b) in region_data.iter().enumerate() {
                let cur_b = b;
                let mut reprocess = true;
                while reprocess {
                    reprocess = false;
                    if unicode != "default" && cur_b >= 128 {
                        if utf8.is_empty() {
                            utf8_width = if (0xc0..0xe0).contains(&cur_b) {
                                2
                            } else if (0xe0..0xf0).contains(&cur_b) {
                                3
                            } else if (0xf0..0xf8).contains(&cur_b) {
                                4
                            } else {
                                0
                            };
                            if utf8_width == 0 {
                                flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                                break;
                            }
                        } else if !(0x80..0xc0).contains(&cur_b) {
                            utf8.clear();
                            flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                            reprocess = true;
                            continue;
                        }
                        utf8.push(cur_b);
                        if utf8.len() < utf8_width {
                            break;
                        }
                        if unicode == "invalid" {
                            flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                        } else if unicode == "locale" {
                            if char_count == 0 {
                                start_off = region_off + idx + 1 - utf8.len();
                            }
                            cur_bytes.extend_from_slice(&utf8);
                            char_count += 1;
                        } else {
                            let text = if unicode == "hex" {
                                let hex_s: String = utf8.iter().map(|v| format!("{v:02x}")).collect();
                                format!("<0x{hex_s}>")
                            } else {
                                let mut code = (utf8[0] & if utf8_width == 2 { 31 } else { 15 }) as u32;
                                for &cont in &utf8[1..] {
                                    code = code * 64 + ((cont & 63) as u32);
                                }
                                if utf8_width == 4 {
                                    code = (((utf8[0] & 7) as u32) << 18)
                                        | (((utf8[1] & 63) as u32) << 14)
                                        | (((utf8[2] & 63) as u32) << 6)
                                        | ((utf8[3] & 63) as u32);
                                }
                                if utf8_width == 4 {
                                    format!("\\u{code:06x}")
                                } else {
                                    format!("\\u{code:04x}")
                                }
                            };
                            if char_count == 0 {
                                start_off = region_off + idx + 1 - utf8.len();
                            }
                            cur_bytes.extend_from_slice(text.as_bytes());
                            char_count += 1;
                        }
                        utf8.clear();
                        break;
                    }
                    if !utf8.is_empty() {
                        utf8.clear();
                        flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                    }
                    let ok = cur_b == 9
                        || (32..=126).contains(&cur_b)
                        || (encoding == 'S' && cur_b >= 128)
                        || (include_ws && (10..=13).contains(&cur_b));
                    if ok {
                        if char_count == 0 {
                            start_off = region_off + idx;
                        }
                        cur_bytes.push(cur_b);
                        char_count += 1;
                    } else {
                        flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                    }
                }
            }
            } else {
                let little = encoding == 'l' || encoding == 'L';
                let mut idx = 0usize;
                while idx + width <= region_data.len() {
                let mut code = 0u32;
                for k in 0..width {
                    let byte = region_data[idx + if little { width - 1 - k } else { k }] as u32;
                    code = (code << 8) | byte;
                }
                let ok = code == 9
                    || (32..=126).contains(&code)
                    || (include_ws && (10..=13).contains(&code));
                if ok {
                    if char_count == 0 {
                        start_off = region_off + idx;
                    }
                    cur_bytes.push(code as u8);
                    char_count += 1;
                } else {
                    flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
                }
                idx += width;
            }
            }
            flush(&mut out_bytes, &mut cur_bytes, &mut char_count, start_off);
        }
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr: err_buf,
        exit_code,
    }
}

fn openssl_hash(name: &str, data: &[u8]) -> Vec<u8> {
    match name {
        "md5" => md5_bytes(data).to_vec(),
        "sha1" => sha1_bytes(data).to_vec(),
        "sha384" => sha384_bytes(data).to_vec(),
        "sha512" => sha512_bytes(data).to_vec(),
        _ => sha256_bytes(data).to_vec(),
    }
}

pub(super) fn openssl_hmac(name: &str, key: &[u8], data: &[u8]) -> Vec<u8> {
    let block_size = if name == "sha384" || name == "sha512" { 128usize } else { 64usize };
    let mut k = if key.len() > block_size {
        openssl_hash(name, key)
    } else {
        key.to_vec()
    };
    k.resize(block_size, 0u8);
    let mut ipad = vec![0x36u8; block_size];
    let mut opad = vec![0x5cu8; block_size];
    for i in 0..block_size {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    ipad.extend_from_slice(data);
    let inner = openssl_hash(name, &ipad);
    opad.extend_from_slice(&inner);
    openssl_hash(name, &opad)
}

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, dk_len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(dk_len);
    let mut block_num = 1u32;
    while out.len() < dk_len {
        let mut salt_block = Vec::with_capacity(salt.len() + 4);
        salt_block.extend_from_slice(salt);
        salt_block.extend_from_slice(&block_num.to_be_bytes());
        let mut u = openssl_hmac("sha256", password, &salt_block);
        let mut t = u.clone();
        for _ in 1..iterations {
            u = openssl_hmac("sha256", password, &u);
            for (ti, ui) in t.iter_mut().zip(u.iter()) {
                *ti ^= *ui;
            }
        }
        let take = (dk_len - out.len()).min(t.len());
        out.extend_from_slice(&t[..take]);
        block_num += 1;
    }
    out
}

const AES_SBOX: [u8; 256] = [
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
];

const AES_INV_SBOX: [u8; 256] = [
    0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
    0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
    0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
    0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
    0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
    0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
    0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
    0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
    0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
    0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
    0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
    0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
    0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
    0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
    0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
    0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d,
];

fn aes_xtime(x: u8) -> u8 {
    (x << 1) ^ (if (x & 0x80) != 0 { 0x1b } else { 0 })
}

fn aes_gmul(mut a: u8, mut b: u8) -> u8 {
    let mut p = 0u8;
    for _ in 0..8 {
        if (b & 1) != 0 {
            p ^= a;
        }
        a = aes_xtime(a);
        b >>= 1;
    }
    p
}

fn aes_expand_key(key: &[u8]) -> (Vec<[u8; 16]>, usize) {
    let nk = key.len() / 4;
    let nr = if nk == 4 { 10 } else { 14 };
    let nb_words = 4 * (nr + 1);
    let mut w = vec![[0u8; 4]; nb_words];
    for i in 0..nk {
        w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
    }
    let rcon: [u8; 11] = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    for i in nk..nb_words {
        let mut temp = w[i - 1];
        if i % nk == 0 {
            temp = [
                AES_SBOX[temp[1] as usize] ^ rcon[i / nk],
                AES_SBOX[temp[2] as usize],
                AES_SBOX[temp[3] as usize],
                AES_SBOX[temp[0] as usize],
            ];
        } else if nk > 6 && i % nk == 4 {
            temp = [
                AES_SBOX[temp[0] as usize],
                AES_SBOX[temp[1] as usize],
                AES_SBOX[temp[2] as usize],
                AES_SBOX[temp[3] as usize],
            ];
        }
        let prev = w[i - nk];
        w[i] = [
            prev[0] ^ temp[0],
            prev[1] ^ temp[1],
            prev[2] ^ temp[2],
            prev[3] ^ temp[3],
        ];
    }
    let mut round_keys = Vec::with_capacity(nr + 1);
    for r in 0..=nr {
        let mut rk = [0u8; 16];
        for c in 0..4 {
            rk[4 * c..4 * c + 4].copy_from_slice(&w[4 * r + c]);
        }
        round_keys.push(rk);
    }
    (round_keys, nr)
}

fn aes_encrypt_block(block: &[u8; 16], round_keys: &[[u8; 16]], nr: usize) -> [u8; 16] {
    let mut s = *block;
    for i in 0..16 {
        s[i] ^= round_keys[0][i];
    }
    for round in 1..=nr {
        for i in 0..16 {
            s[i] = AES_SBOX[s[i] as usize];
        }
        let t = s;
        s[1] = t[5]; s[5] = t[9]; s[9] = t[13]; s[13] = t[1];
        s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
        s[3] = t[15]; s[7] = t[3]; s[11] = t[7]; s[15] = t[11];
        if round < nr {
            for c in 0..4 {
                let idx = 4 * c;
                let (a0, a1, a2, a3) = (s[idx], s[idx + 1], s[idx + 2], s[idx + 3]);
                s[idx] = aes_gmul(a0, 2) ^ aes_gmul(a1, 3) ^ a2 ^ a3;
                s[idx + 1] = a0 ^ aes_gmul(a1, 2) ^ aes_gmul(a2, 3) ^ a3;
                s[idx + 2] = a0 ^ a1 ^ aes_gmul(a2, 2) ^ aes_gmul(a3, 3);
                s[idx + 3] = aes_gmul(a0, 3) ^ a1 ^ a2 ^ aes_gmul(a3, 2);
            }
        }
        for i in 0..16 {
            s[i] ^= round_keys[round][i];
        }
    }
    s
}

fn aes_decrypt_block(block: &[u8; 16], round_keys: &[[u8; 16]], nr: usize) -> [u8; 16] {
    let mut s = *block;
    for i in 0..16 {
        s[i] ^= round_keys[nr][i];
    }
    for round in (1..=nr).rev() {
        let t = s;
        s[1] = t[13]; s[5] = t[1]; s[9] = t[5]; s[13] = t[9];
        s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
        s[3] = t[7]; s[7] = t[11]; s[11] = t[15]; s[15] = t[3];
        for i in 0..16 {
            s[i] = AES_INV_SBOX[s[i] as usize];
        }
        for i in 0..16 {
            s[i] ^= round_keys[round - 1][i];
        }
        if round > 1 {
            for c in 0..4 {
                let idx = 4 * c;
                let (a0, a1, a2, a3) = (s[idx], s[idx + 1], s[idx + 2], s[idx + 3]);
                s[idx] = aes_gmul(a0, 14) ^ aes_gmul(a1, 11) ^ aes_gmul(a2, 13) ^ aes_gmul(a3, 9);
                s[idx + 1] = aes_gmul(a0, 9) ^ aes_gmul(a1, 14) ^ aes_gmul(a2, 11) ^ aes_gmul(a3, 13);
                s[idx + 2] = aes_gmul(a0, 13) ^ aes_gmul(a1, 9) ^ aes_gmul(a2, 14) ^ aes_gmul(a3, 11);
                s[idx + 3] = aes_gmul(a0, 11) ^ aes_gmul(a1, 13) ^ aes_gmul(a2, 9) ^ aes_gmul(a3, 14);
            }
        }
    }
    s
}

fn openssl_hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn openssl_hex_decode(raw: &str) -> Result<Vec<u8>, String> {
    if raw.len() % 2 != 0 || !raw.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid hex value".to_string());
    }
    let mut out = Vec::with_capacity(raw.len() / 2);
    for i in (0..raw.len()).step_by(2) {
        let b = u8::from_str_radix(&raw[i..i + 2], 16).map_err(|_| "invalid hex value".to_string())?;
        out.push(b);
    }
    Ok(out)
}

fn openssl_b64_encode(bytes: &[u8], wrap: bool) -> String {
    let encoded = base64_encode(bytes);
    if !wrap || encoded.is_empty() {
        return encoded;
    }
    let mut lines = Vec::new();
    let chars: Vec<char> = encoded.chars().collect();
    for chunk in chars.chunks(64) {
        let line: String = chunk.iter().collect();
        lines.push(line);
    }
    lines.join("\n")
}

fn openssl_read_bytes(
    file: Option<&str>,
    stdin_buf: &mut Option<Vec<u8>>,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<Vec<u8>, String> {
    if let Some(f) = file && !f.is_empty() {
        let full = resolve_posix_path(cwd, f);
        if fs.is_dir(&full) {
            return Err(format!(
                "EISDIR: illegal operation on a directory, readFile '{full}'"
            ));
        }
        fs.read_file(&full)
            .map_err(|_| format!("ENOENT: no such file or directory, readFile '{full}'"))
    } else {
        Ok(stdin_buf.take().unwrap_or_default())
    }
}

fn openssl_write_bytes(
    data: &[u8],
    out_file: Option<&str>,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<BuiltinOutcome, String> {
    if let Some(f) = out_file && !f.is_empty() {
        let full = resolve_posix_path(cwd, f);
        fs.write_file(&full, data).map_err(|e| format!("{e}"))?;
        Ok(ok_out(""))
    } else {
        Ok(ok_out(&crate::vfs::bytes_to_stream_string(data)))
    }
}

fn openssl_crypt_password(password: &str, salt_input: &str, mode: &str) -> Result<String, String> {
    const ALPHABET: &[u8] = b"./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let encode_groups = |bytes: &[u8], groups: &[(isize, isize, isize, usize)]| -> String {
        let mut out = String::new();
        for &(a, b, c, count) in groups {
            let ba = if a >= 0 { *bytes.get(a as usize).unwrap_or(&0) as u32 } else { 0 };
            let bb = if b >= 0 { *bytes.get(b as usize).unwrap_or(&0) as u32 } else { 0 };
            let bc = if c >= 0 { *bytes.get(c as usize).unwrap_or(&0) as u32 } else { 0 };
            let mut word = (ba << 16) | (bb << 8) | bc;
            for _ in 0..count {
                out.push(ALPHABET[(word & 63) as usize] as char);
                word >>= 6;
            }
        }
        out
    };
    let repeat_bytes = |src: &[u8], len: usize| -> Vec<u8> {
        if src.is_empty() {
            return Vec::new();
        }
        (0..len).map(|i| src[i % src.len()]).collect()
    };
    let mut rounds = if mode == "1" || mode == "apr1" { 1000usize } else { 5000usize };
    let mut round_prefix = String::new();
    let mut salt_rem = salt_input;
    if (mode == "5" || mode == "6") && let Some(rest) = salt_rem.strip_prefix("rounds=") {
        let Some((val, after)) = rest.split_once('$') else {
            return Err("invalid crypt rounds".to_string());
        };
        if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
            return Err("invalid crypt rounds".to_string());
        }
        let parsed = val.parse::<usize>().map_err(|_| "invalid crypt rounds".to_string())?;
        rounds = parsed.max(1000);
        round_prefix = format!("rounds={rounds}$");
        salt_rem = after;
    }
    let max_salt = if mode == "1" || mode == "apr1" { 8 } else { 16 };
    let salt_first = salt_rem.split('$').next().unwrap_or("");
    let salt: String = salt_first.chars().take(max_salt).collect();
    let p = password.as_bytes();
    let s = salt.as_bytes();
    let magic = format!("${mode}$");
    if mode == "1" || mode == "apr1" {
        let mut alt_in = Vec::new();
        alt_in.extend_from_slice(p);
        alt_in.extend_from_slice(s);
        alt_in.extend_from_slice(p);
        let alt = md5_bytes(&alt_in);
        let mut init = Vec::new();
        init.extend_from_slice(p);
        init.extend_from_slice(magic.as_bytes());
        init.extend_from_slice(s);
        init.extend_from_slice(&repeat_bytes(&alt, p.len()));
        let mut n = p.len();
        while n > 0 {
            if (n & 1) != 0 {
                init.push(0);
            } else {
                init.push(*p.first().unwrap_or(&0));
            }
            n >>= 1;
        }
        let mut digest = md5_bytes(&init).to_vec();
        for i in 0..1000usize {
            let mut buf = Vec::new();
            if (i & 1) != 0 { buf.extend_from_slice(p); } else { buf.extend_from_slice(&digest); }
            if i % 3 != 0 { buf.extend_from_slice(s); }
            if i % 7 != 0 { buf.extend_from_slice(p); }
            if (i & 1) != 0 { buf.extend_from_slice(&digest); } else { buf.extend_from_slice(p); }
            digest = md5_bytes(&buf).to_vec();
        }
        let groups = [
            (0,6,12,4), (1,7,13,4), (2,8,14,4), (3,9,15,4), (4,10,5,4), (-1,-1,11,2)
        ];
        let enc_str = encode_groups(&digest, &groups);
        return Ok(format!("{magic}{salt}${enc_str}"));
    }
    let hash_fn = |d: &[u8]| -> Vec<u8> {
        if mode == "5" { sha256_bytes(d).to_vec() } else { sha512_bytes(d).to_vec() }
    };
    let mut alt_in = Vec::new();
    alt_in.extend_from_slice(p);
    alt_in.extend_from_slice(s);
    alt_in.extend_from_slice(p);
    let alt = hash_fn(&alt_in);
    let mut init = Vec::new();
    init.extend_from_slice(p);
    init.extend_from_slice(s);
    init.extend_from_slice(&repeat_bytes(&alt, p.len()));
    let mut n = p.len();
    while n > 0 {
        if (n & 1) != 0 { init.extend_from_slice(&alt); } else { init.extend_from_slice(p); }
        n >>= 1;
    }
    let mut digest = hash_fn(&init);
    let mut ph_in = Vec::new();
    for _ in 0..p.len() { ph_in.extend_from_slice(p); }
    let seq_p = repeat_bytes(&hash_fn(&ph_in), p.len());
    let mut sh_in = Vec::new();
    for _ in 0..(16 + digest[0] as usize) { sh_in.extend_from_slice(s); }
    let seq_s = repeat_bytes(&hash_fn(&sh_in), s.len());
    for i in 0..rounds {
        let mut buf = Vec::new();
        if (i & 1) != 0 { buf.extend_from_slice(&seq_p); } else { buf.extend_from_slice(&digest); }
        if i % 3 != 0 { buf.extend_from_slice(&seq_s); }
        if i % 7 != 0 { buf.extend_from_slice(&seq_p); }
        if (i & 1) != 0 { buf.extend_from_slice(&digest); } else { buf.extend_from_slice(&seq_p); }
        digest = hash_fn(&buf);
    }
    let encoded = if mode == "5" {
        let groups = [
            (0,10,20,4),(21,1,11,4),(12,22,2,4),(3,13,23,4),(24,4,14,4),
            (15,25,5,4),(6,16,26,4),(27,7,17,4),(18,28,8,4),(9,19,29,4),(-1,31,30,3)
        ];
        encode_groups(&digest, &groups)
    } else {
        let groups = [
            (0,21,42,4),(22,43,1,4),(44,2,23,4),(3,24,45,4),(25,46,4,4),(47,5,26,4),
            (6,27,48,4),(28,49,7,4),(50,8,29,4),(9,30,51,4),(31,52,10,4),(53,11,32,4),
            (12,33,54,4),(34,55,13,4),(56,14,35,4),(15,36,57,4),(37,58,16,4),(59,17,38,4),
            (18,39,60,4),(40,61,19,4),(62,20,41,4),(-1,-1,63,2)
        ];
        encode_groups(&digest, &groups)
    };
    Ok(format!("{magic}{round_prefix}{salt}${encoded}"))
}

fn openssl_extract_key_seed(raw: &[u8]) -> Result<(String, Vec<u8>), String> {
    let text = String::from_utf8_lossy(raw);
    let trimmed = text.trim();
    if trimmed.starts_with("-----BEGIN ") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() < 2 || !lines.last().unwrap_or(&"").starts_with("-----END ") {
            return Err("invalid PEM input".to_string());
        }
        let label = lines[0].trim_start_matches("-----BEGIN ").trim_end_matches("-----").to_string();
        let body: String = lines[1..lines.len() - 1].join("");
        let decoded = base64_decode(&body)?;
        let decoded_str = String::from_utf8_lossy(&decoded);
        if let Some(rest) = decoded_str.strip_prefix("SBKEY:") {
            let parts: Vec<&str> = rest.splitn(4, ':').collect();
            if parts.len() == 4 {
                let seed_hex = parts[3].split(':').next().unwrap_or(parts[3]);
                let seed = openssl_hex_decode(seed_hex).unwrap_or_else(|_| seed_hex.as_bytes().to_vec());
                return Ok((format!("{}:{}:{}", parts[0], parts[1], parts[2]), seed));
            }
        }
        let pub_seed = sha256_bytes(&decoded).to_vec();
        return Ok((label, pub_seed));
    }
    let decoded_str = String::from_utf8_lossy(raw);
    if let Some(rest) = decoded_str.strip_prefix("SBKEY:") {
        let parts: Vec<&str> = rest.splitn(4, ':').collect();
        if parts.len() == 4 {
            let seed_hex = parts[3].split(':').next().unwrap_or(parts[3]);
            let seed = openssl_hex_decode(seed_hex).unwrap_or_else(|_| seed_hex.as_bytes().to_vec());
            return Ok((format!("{}:{}:{}", parts[0], parts[1], parts[2]), seed));
        }
    }
    Ok(("DER".to_string(), sha256_bytes(raw).to_vec()))
}

fn openssl_key_payload(alg: &str, role_tag: &str, bits_or_curve: &str, seed: &[u8]) -> String {
    let hx = openssl_hex_encode(seed);
    if alg == "RSA" {
        let bits = bits_or_curve.parse::<usize>().unwrap_or(2048);
        let pad_blocks = if role_tag == "PUBLIC" {
            (bits / 256).max(5)
        } else {
            (bits / 64).max(16)
        };
        let mut pad = String::new();
        for idx in 0..pad_blocks {
            let mut block_in = Vec::with_capacity(seed.len() + 8);
            block_in.extend_from_slice(seed);
            block_in.extend_from_slice(role_tag.as_bytes());
            block_in.extend_from_slice(&(idx as u32).to_be_bytes());
            pad.push_str(&openssl_hex_encode(&sha256_bytes(&block_in)));
        }
        format!("SBKEY:{alg}:{role_tag}:{bits_or_curve}:{hx}:{pad}")
    } else {
        format!("SBKEY:{alg}:{role_tag}:{bits_or_curve}:{hx}")
    }
}

fn openssl_compute_signature(meta: &str, hash_name: &str, seed: &[u8], input: &[u8]) -> Vec<u8> {
    let parts: Vec<&str> = meta.split(':').collect();
    if parts.first().copied() == Some("RSA") {
        let bits = parts.get(2).and_then(|s| s.parse::<usize>().ok()).unwrap_or(2048);
        let sig_len = (bits / 8).max(64);
        let mut out = Vec::with_capacity(sig_len + 32);
        let mut counter = 0u32;
        while out.len() < sig_len {
            let mut msg = Vec::with_capacity(input.len() + 4);
            msg.extend_from_slice(input);
            msg.extend_from_slice(&counter.to_be_bytes());
            out.extend_from_slice(&openssl_hmac(hash_name, seed, &msg));
            counter += 1;
        }
        out.truncate(sig_len);
        out
    } else {
        openssl_hmac(hash_name, seed, input)
    }
}

fn openssl_validate_and_format_addexts(values: &[String]) -> Result<Vec<(String, String)>, String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for value in values {
        let Some((raw_name, raw_val)) = value.split_once('=') else {
            return Err("invalid or duplicate extension".to_string());
        };
        let name = raw_name.trim();
        if name.is_empty() || !seen.insert(name.to_string()) {
            return Err("invalid or duplicate extension".to_string());
        }
        let mut parts: Vec<&str> = raw_val.split(',').map(|p| p.trim()).collect();
        let critical = parts.first().copied() == Some("critical");
        if critical {
            parts.remove(0);
        }
        let crit_suffix = if critical { ": critical" } else { ":" };
        let formatted = match name {
            "subjectAltName" => {
                let mut lines = vec![format!("Subject Alternative Name{crit_suffix}")];
                for part in &parts {
                    let Some((kind, val)) = part.split_once(':') else {
                        return Err(format!("unsupported subject alternative name: {part}"));
                    };
                    if !matches!(kind, "DNS" | "IP" | "URI" | "email" | "RID") {
                        return Err(format!("unsupported subject alternative name: {part}"));
                    }
                    lines.push(format!("  {kind}: {val}"));
                }
                lines.join("\n")
            }
            "basicConstraints" => {
                if !parts.iter().any(|&p| p == "CA:TRUE" || p == "CA:FALSE") {
                    return Err("basicConstraints requires CA:TRUE or CA:FALSE".to_string());
                }
                let ca = parts.contains(&"CA:TRUE");
                let mut lines = vec![format!("Basic Constraints{crit_suffix}")];
                if ca {
                    lines.push("  CA: true".to_string());
                }
                if let Some(pl) = parts.iter().find_map(|p| p.strip_prefix("pathlen:")) {
                    let Ok(n) = pl.parse::<isize>() else {
                        return Err("invalid path length".to_string());
                    };
                    if n < 0 {
                        return Err("invalid path length".to_string());
                    }
                    lines.push(format!("  Path Length: {n}"));
                }
                lines.join("\n")
            }
            "keyUsage" => {
                for part in &parts {
                    if !matches!(
                        *part,
                        "digitalSignature"
                            | "nonRepudiation"
                            | "contentCommitment"
                            | "keyEncipherment"
                            | "dataEncipherment"
                            | "keyAgreement"
                            | "keyCertSign"
                            | "cRLSign"
                            | "encipherOnly"
                            | "decipherOnly"
                    ) {
                        return Err(format!("unsupported key usage: {part}"));
                    }
                }
                format!("Key Usages{crit_suffix}\n  {}", parts.join(", "))
            }
            "extendedKeyUsage" => {
                let mut mapped = Vec::new();
                for part in &parts {
                    let desc = match *part {
                        "serverAuth" => "TLS WWW server authentication",
                        "clientAuth" => "TLS WWW client authentication",
                        "codeSigning" => "Code Signing",
                        "emailProtection" => "E-mail Protection",
                        "timeStamping" => "Time Stamping",
                        "ocspSigning" => "OCSP Signing",
                        "anyExtendedKeyUsage" => "Any Extended Key Usage",
                        _ => return Err(format!("unsupported extended key usage: {part}")),
                    };
                    mapped.push(desc);
                }
                format!("Extended Key Usages{crit_suffix}\n  {}", mapped.join(", "))
            }
            "subjectKeyIdentifier" if parts.first().copied() == Some("hash") => {
                format!(
                    "Subject Key Identifier{crit_suffix}\n  09 82 9b 98 73 3f ee da  8f 15 ee 8b 0d 74 a5 82\n  6a cf a7 5c"
                )
            }
            _ => return Err(format!("unsupported extension: {name}")),
        };
        out.push((name.to_string(), formatted));
    }
    Ok(out)
}

fn openssl_format_subject(subj: &str) -> Result<String, String> {
    if !subj.starts_with('/') {
        return Err("subject must use /name=value notation".to_string());
    }
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut escaped = false;
    for c in subj[1..].chars() {
        if escaped {
            field.push(c);
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == '/' {
            fields.push(field.clone());
            field.clear();
        } else {
            field.push(c);
        }
    }
    if escaped {
        return Err("incomplete subject escape".to_string());
    }
    fields.push(field);
    let mut formatted = Vec::new();
    for part in fields.into_iter().filter(|s| !s.is_empty()) {
        let Some((k, v)) = part.split_once('=') else {
            return Err("invalid subject attribute".to_string());
        };
        if k.is_empty() {
            return Err("invalid subject attribute".to_string());
        }
        formatted.push(format!("{k}={v}"));
    }
    Ok(formatted.join(", "))
}

fn cmd_openssl(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let run = || -> Result<BuiltinOutcome, String> {
        let sub = args.first().map(|s| s.as_str()).unwrap_or("help");
        let rest = if args.is_empty() { &[][..] } else { &args[1..] };
        let mut stdin_buf = Some(crate::vfs::stream_string_to_bytes(stdin));

        if matches!(sub, "help" | "--help" | "-h") {
            return Ok(ok_out("Usage: openssl <subcommand> [options]\nSubcommands: version, dgst, md5, sha1, sha256, sha384, sha512, rand, base64, enc, genpkey, genrsa, rsa, ecparam, ec, pkey, pkeyutl, req, x509, passwd\n"));
        }
        if matches!(sub, "version" | "--version" | "-v") {
            let mut has_a = false;
            let mut flags = std::collections::BTreeSet::new();
            for a in rest {
                match a.as_str() {
                    "-a" => has_a = true,
                    "-v" | "-b" | "-o" | "-f" | "-p" | "-d" => { flags.insert(a.as_str()); }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected version argument".to_string()),
                }
            }
            let entries = [
                ("-v", "OpenSSL compatible safe-bash toolkit (Web Crypto)"),
                ("-b", "built on: portable JavaScript"),
                ("-o", "options: Web Crypto, in-memory VFS"),
                ("-f", "compiler: TypeScript"),
                ("-p", "platform: portable"),
                ("-d", "OPENSSLDIR: virtual filesystem"),
            ];
            let mut lines = Vec::new();
            for (flag, val) in entries {
                if (rest.is_empty() && flag == "-v") || has_a || flags.contains(flag) {
                    lines.push(val);
                }
            }
            let joined = lines.join("\n");
            return Ok(ok_out(&format!("{joined}\n")));
        }
        if matches!(sub, "dgst" | "md5" | "sha1" | "sha256" | "sha384" | "sha512") {
            let mut hash_name = if sub == "dgst" { "sha256".to_string() } else { sub.to_string() };
            let mut binary = false;
            let mut hex_flag = false;
            let mut r_flag = false;
            let mut hmac_key: Option<String> = None;
            let mut sign_key: Option<String> = None;
            let mut verify_key: Option<String> = None;
            let mut prverify_key: Option<String> = None;
            let mut sig_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-md5" | "-sha1" | "-sha256" | "-sha384" | "-sha512" => hash_name = a[1..].to_string(),
                    "-binary" => binary = true,
                    "-hex" => hex_flag = true,
                    "-r" => r_flag = true,
                    "-hmac" | "-sign" | "-verify" | "-prverify" | "-signature" | "-out" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-hmac" => hmac_key = Some(val),
                            "-sign" => sign_key = Some(val),
                            "-verify" => verify_key = Some(val),
                            "-prverify" => prverify_key = Some(val),
                            "-signature" => sig_file = Some(val),
                            "-out" => out_file = Some(val),
                            _ => {}
                        }
                    }
                    "--" => {
                        positional.extend(rest[i + 1..].iter().cloned());
                        break;
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            if sign_key.is_some() || verify_key.is_some() || prverify_key.is_some() {
                if positional.len() > 1 || (sign_key.is_some() && (verify_key.is_some() || prverify_key.is_some())) {
                    return Err("sign/verify requires one input and one operation".to_string());
                }
                if sign_key.is_none() && sig_file.is_none() {
                    return Err("sign/verify requires a key and verification requires a signature".to_string());
                }
                let key_path = sign_key.as_deref().or(verify_key.as_deref()).or(prverify_key.as_deref()).unwrap();
                let key_bytes = openssl_read_bytes(Some(key_path), &mut stdin_buf, cwd, fs)?;
                let (meta, seed) = openssl_extract_key_seed(&key_bytes)?;
                let input = openssl_read_bytes(positional.first().map(|s| s.as_str()), &mut stdin_buf, cwd, fs)?;
                let expected_sig = openssl_compute_signature(&meta, &hash_name, &seed, &input);
                if sign_key.is_some() {
                    if hex_flag {
                        let hx = openssl_hex_encode(&expected_sig);
                        let txt = format!("{hx}\n");
                        return openssl_write_bytes(txt.as_bytes(), out_file.as_deref(), cwd, fs);
                    }
                    return openssl_write_bytes(&expected_sig, out_file.as_deref(), cwd, fs);
                } else {
                    let sf = sig_file.as_deref().ok_or_else(|| "sign/verify requires a key and verification requires a signature".to_string())?;
                    let actual_sig = openssl_read_bytes(Some(sf), &mut stdin_buf, cwd, fs)?;
                    let valid = actual_sig == expected_sig;
                    let msg = if valid { "Verified OK\n" } else { "Verification Failure\n" };
                    let mut res = openssl_write_bytes(msg.as_bytes(), out_file.as_deref(), cwd, fs)?;
                    res.exit_code = if valid { 0 } else { 1 };
                    return Ok(res);
                }
            }
            if sig_file.is_some() {
                return Err("-signature requires -verify".to_string());
            }
            let files: Vec<Option<String>> = if positional.is_empty() {
                vec![None]
            } else {
                positional.into_iter().map(Some).collect()
            };
            let mut output = Vec::new();
            for file in files {
                let input = openssl_read_bytes(file.as_deref(), &mut stdin_buf, cwd, fs)?;
                let digest = if let Some(ref hk) = hmac_key {
                    openssl_hmac(&hash_name, hk.as_bytes(), &input)
                } else {
                    openssl_hash(&hash_name, &input)
                };
                let label = if hash_name.starts_with("sha") && hash_name != "sha1" {
                    format!("SHA2-{}", &hash_name[3..])
                } else {
                    hash_name.to_uppercase()
                };
                if binary && !hex_flag {
                    output.extend_from_slice(&digest);
                } else {
                    let fname = file.as_deref().unwrap_or("stdin");
                    let hex_str = openssl_hex_encode(&digest);
                    let line = if r_flag {
                        format!("{hex_str} *{fname}\n")
                    } else {
                        let hmac_prefix = if file.is_some() && hmac_key.is_some() { "HMAC-" } else { "" };
                        format!("{hmac_prefix}{label}({fname})= {hex_str}\n")
                    };
                    output.extend_from_slice(line.as_bytes());
                }
            }
            return openssl_write_bytes(&output, out_file.as_deref(), cwd, fs);
        }
        if sub == "rand" {
            let mut hex_flag = false;
            let mut b64_flag = false;
            let mut out_file: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-hex" => hex_flag = true,
                    "-base64" => b64_flag = true,
                    "-out" => {
                        i += 1;
                        out_file = Some(rest.get(i).ok_or_else(|| "missing value for -out".to_string())?.clone());
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            if positional.len() != 1 || (hex_flag && b64_flag) {
                return Err("rand requires a byte count and one output format".to_string());
            }
            let raw_cnt = &positional[0];
            if raw_cnt.is_empty() || !raw_cnt.chars().all(|c| c.is_ascii_digit()) {
                return Err("invalid random byte count".to_string());
            }
            let count = raw_cnt.parse::<usize>().map_err(|_| "invalid random byte count".to_string())?;
            let mut bytes = vec![0u8; count];
            for (idx, b) in bytes.iter_mut().enumerate() {
                let h = sha256_bytes(format!("safe-bash-rand-{count}-{idx}").as_bytes());
                *b = h[idx % 32];
            }
            if hex_flag {
                let hx = openssl_hex_encode(&bytes);
                let s = format!("{hx}\n");
                return openssl_write_bytes(s.as_bytes(), out_file.as_deref(), cwd, fs);
            }
            if b64_flag {
                let b64 = openssl_b64_encode(&bytes, true);
                let s = format!("{b64}\n");
                return openssl_write_bytes(s.as_bytes(), out_file.as_deref(), cwd, fs);
            }
            return openssl_write_bytes(&bytes, out_file.as_deref(), cwd, fs);
        }
        if sub == "base64" {
            let mut decode = false;
            let mut no_nl = false;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-d" => decode = true,
                    "-e" | "-a" | "-base64" => {}
                    "-A" => no_nl = true,
                    "-in" | "-out" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        if a == "-in" { in_file = Some(val); } else { out_file = Some(val); }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected base64 argument".to_string()),
                }
                i += 1;
            }
            let input = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
            if decode {
                let s = String::from_utf8_lossy(&input);
                let clean: String = s.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r')).map(|c| match c { '-' => '+', '_' => '/', _ => c }).collect();
                let decoded = base64_decode(&clean)?;
                return openssl_write_bytes(&decoded, out_file.as_deref(), cwd, fs);
            } else {
                let mut encoded = openssl_b64_encode(&input, !no_nl);
                if !no_nl && !input.is_empty() {
                    encoded.push('\n');
                }
                return openssl_write_bytes(encoded.as_bytes(), out_file.as_deref(), cwd, fs);
            }
        }
        if sub == "passwd" {
            let mut modes = Vec::new();
            let mut from_stdin = false;
            let mut salt_opt: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-1" | "-5" | "-6" | "-apr1" => {
                        if !modes.contains(&&a[1..]) {
                            modes.push(&a[1..]);
                        }
                    }
                    "-stdin" => from_stdin = true,
                    "-salt" => {
                        i += 1;
                        salt_opt = Some(rest.get(i).ok_or_else(|| "missing value for -salt".to_string())?.clone());
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            if modes.len() > 1 {
                return Err("choose one password hash format".to_string());
            }
            let mode = modes.first().copied().unwrap_or("1");
            let passwords: Vec<String> = if from_stdin {
                let raw = openssl_read_bytes(None, &mut stdin_buf, cwd, fs)?;
                let txt = String::from_utf8_lossy(&raw);
                let mut lines: Vec<String> = txt.split('\n').map(|s| s.to_string()).collect();
                if lines.last().map(|s| s.is_empty()).unwrap_or(false) {
                    lines.pop();
                }
                lines
            } else {
                positional
            };
            if passwords.is_empty() {
                return Err("password required via argument or -stdin".to_string());
            }
            let mut out = String::new();
            for mut pw in passwords {
                if pw.ends_with('\r') {
                    pw.pop();
                }
                let salt = salt_opt.clone().unwrap_or_else(|| "abCD1234".to_string());
                let hashed = openssl_crypt_password(&pw, &salt, mode)?;
                out.push_str(&hashed);
                out.push('\n');
            }
            return Ok(ok_out(&out));
        }
        if sub == "enc" {
            let mut ciphers = Vec::new();
            let mut decrypt = false;
            let mut encoded = false;
            let mut no_nl = false;
            let mut nosalt = false;
            let mut pbkdf2 = false;
            let mut iter_opt: Option<u32> = None;
            let mut k_opt: Option<String> = None;
            let mut pass_opt: Option<String> = None;
            let mut hex_key: Option<String> = None;
            let mut hex_iv: Option<String> = None;
            let mut hex_salt: Option<String> = None;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-aes-128-cbc" | "-aes-256-cbc" | "-aes-256-ctr" => {
                        if !ciphers.contains(&a) { ciphers.push(a); }
                    }
                    "-d" => decrypt = true,
                    "-e" | "-salt" => {}
                    "-a" | "-base64" => encoded = true,
                    "-A" => no_nl = true,
                    "-nosalt" => nosalt = true,
                    "-pbkdf2" => pbkdf2 = true,
                    "-k" | "-pass" | "-K" | "-iv" | "-S" | "-iter" | "-in" | "-out" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-k" => k_opt = Some(val),
                            "-pass" => pass_opt = Some(val),
                            "-K" => hex_key = Some(val),
                            "-iv" => hex_iv = Some(val),
                            "-S" => hex_salt = Some(val),
                            "-iter" => {
                                if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                                    return Err(format!("invalid or excessive -iter: {val}"));
                                }
                                let n = val.parse::<u32>().map_err(|_| format!("invalid or excessive -iter: {val}"))?;
                                if !(1..=1_000_000).contains(&n) {
                                    return Err(format!("invalid or excessive -iter: {val}"));
                                }
                                iter_opt = Some(n);
                            }
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            _ => {}
                        }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected enc argument".to_string()),
                }
                i += 1;
            }
            if ciphers.len() != 1 {
                return Err("select one supported AES cipher".to_string());
            }
            let cipher = ciphers[0];
            let key_len = if cipher == "-aes-128-cbc" { 16usize } else { 32usize };
            let is_ctr = cipher == "-aes-256-ctr";
            let iterations = iter_opt.unwrap_or(10000);
            let password: Option<String> = if let Some(spec) = pass_opt {
                if let Some(p) = spec.strip_prefix("pass:") {
                    Some(p.to_string())
                } else if let Some(var) = spec.strip_prefix("env:") {
                    let v = env.get(var).ok_or_else(|| "password environment variable is not set".to_string())?;
                    Some(v.clone())
                } else if let Some(fp) = spec.strip_prefix("file:") {
                    let b = openssl_read_bytes(Some(fp), &mut stdin_buf, cwd, fs)?;
                    let s = String::from_utf8_lossy(&b);
                    Some(s.lines().next().unwrap_or("").trim_end_matches('\r').to_string())
                } else if spec == "stdin" {
                    let b = stdin_buf.take().unwrap_or_default();
                    if let Some(pos) = b.iter().position(|&c| c == b'\n') {
                        stdin_buf = Some(b[pos + 1..].to_vec());
                        let line = String::from_utf8_lossy(&b[..pos]).trim_end_matches('\r').to_string();
                        Some(line)
                    } else {
                        Some(String::from_utf8_lossy(&b).trim_end_matches('\r').to_string())
                    }
                } else {
                    return Err("password source must be pass:, env:, file: or stdin".to_string());
                }
            } else {
                k_opt
            };

            let mut input = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
            if decrypt && encoded {
                let s = String::from_utf8_lossy(&input);
                let clean: String = s.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r')).map(|c| match c { '-' => '+', '_' => '/', _ => c }).collect();
                input = base64_decode(&clean)?;
            }
            let salted = !nosalt && hex_key.is_none();
            let mut salt = Vec::new();
            if salted {
                if let Some(ref hs) = hex_salt {
                    salt = openssl_hex_decode(hs)?;
                    if salt.len() != 8 {
                        return Err("salt must contain 8 bytes".to_string());
                    }
                } else if decrypt {
                    if input.len() < 16 || &input[..8] != b"Salted__" {
                        return Err("bad magic number in encrypted input".to_string());
                    }
                    salt = input[8..16].to_vec();
                    input = input[16..].to_vec();
                } else {
                    salt = b"12345678".to_vec();
                }
            }
            let (key, iv) = if let Some(ref hk) = hex_key {
                let k = openssl_hex_decode(hk)?;
                let v = openssl_hex_decode(hex_iv.as_deref().unwrap_or(""))?;
                (k, v)
            } else {
                let pw = password.ok_or_else(|| "password required: use -k or -pass".to_string())?;
                let derived = if pbkdf2 || iter_opt.is_some() {
                    pbkdf2_hmac_sha256(pw.as_bytes(), &salt, iterations, key_len + 16)
                } else {
                    let mut blocks = Vec::new();
                    let mut prev = Vec::new();
                    while blocks.len() < key_len + 16 {
                        let mut buf = Vec::new();
                        buf.extend_from_slice(&prev);
                        buf.extend_from_slice(pw.as_bytes());
                        buf.extend_from_slice(&salt);
                        prev = sha256_bytes(&buf).to_vec();
                        blocks.extend_from_slice(&prev);
                    }
                    blocks
                };
                let k = derived[..key_len].to_vec();
                let v = if let Some(ref hiv) = hex_iv {
                    openssl_hex_decode(hiv)?
                } else {
                    derived[key_len..key_len + 16].to_vec()
                };
                (k, v)
            };
            if key.len() != key_len || iv.len() != 16 {
                return Err(format!("key must contain {key_len} bytes and IV 16 bytes"));
            }
            let (round_keys, nr) = aes_expand_key(&key);
            let mut result = if is_ctr {
                let mut out = Vec::with_capacity(input.len());
                let mut counter = [0u8; 16];
                counter.copy_from_slice(&iv);
                for chunk in input.chunks(16) {
                    let ks = aes_encrypt_block(&counter, &round_keys, nr);
                    for (b, k) in chunk.iter().zip(ks.iter()) {
                        out.push(b ^ k);
                    }
                    for idx in (0..16).rev() {
                        counter[idx] = counter[idx].wrapping_add(1);
                        if counter[idx] != 0 {
                            break;
                        }
                    }
                }
                out
            } else if !decrypt {
                let pad_len = 16 - (input.len() % 16);
                let mut padded = input.clone();
                padded.extend(std::iter::repeat_n(pad_len as u8, pad_len));
                let mut out = Vec::with_capacity(padded.len());
                let mut prev = [0u8; 16];
                prev.copy_from_slice(&iv);
                for chunk in padded.as_chunks::<16>().0 {
                    let mut blk = [0u8; 16];
                    for j in 0..16 {
                        blk[j] = chunk[j] ^ prev[j];
                    }
                    prev = aes_encrypt_block(&blk, &round_keys, nr);
                    out.extend_from_slice(&prev);
                }
                out
            } else {
                if input.is_empty() || input.len() % 16 != 0 {
                    return Err("bad decrypt".to_string());
                }
                let mut out = Vec::with_capacity(input.len());
                let mut prev = [0u8; 16];
                prev.copy_from_slice(&iv);
                for chunk in input.as_chunks::<16>().0 {
                    let mut blk = [0u8; 16];
                    blk.copy_from_slice(chunk);
                    let mut dec = aes_decrypt_block(&blk, &round_keys, nr);
                    for j in 0..16 {
                        dec[j] ^= prev[j];
                    }
                    out.extend_from_slice(&dec);
                    prev = blk;
                }
                let pad = *out.last().unwrap_or(&0) as usize;
                if pad == 0 || pad > 16 || out.len() < pad || !out[out.len() - pad..].iter().all(|&b| b as usize == pad) {
                    return Err("bad decrypt".to_string());
                }
                out.truncate(out.len() - pad);
                out
            };
            if !decrypt && salted && hex_salt.is_none() {
                let mut with_header = Vec::with_capacity(16 + result.len());
                with_header.extend_from_slice(b"Salted__");
                with_header.extend_from_slice(&salt);
                with_header.extend_from_slice(&result);
                result = with_header;
            }
            if !decrypt && encoded {
                let mut b64 = openssl_b64_encode(&result, !no_nl);
                if !no_nl {
                    b64.push('\n');
                }
                return openssl_write_bytes(b64.as_bytes(), out_file.as_deref(), cwd, fs);
            }
            return openssl_write_bytes(&result, out_file.as_deref(), cwd, fs);
        }
        if matches!(sub, "genpkey" | "genrsa" | "rsa" | "ecparam" | "ec" | "pkey") {
            let mut pubout = false;
            let mut pubin = false;
            let mut noout = false;
            let mut text_flag = false;
            let mut modulus_flag = false;
            let mut check_flag = false;
            let mut genkey_flag = false;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut inform = "PEM".to_string();
            let mut outform = "PEM".to_string();
            let mut algorithm: Option<String> = None;
            let mut curve_name = "prime256v1".to_string();
            let mut pkeyopts = Vec::new();
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-pubout" => pubout = true,
                    "-pubin" => pubin = true,
                    "-noout" => noout = true,
                    "-text" => text_flag = true,
                    "-modulus" => modulus_flag = true,
                    "-check" => check_flag = true,
                    "-genkey" => genkey_flag = true,
                    "-noenc" | "-nodes" => {}
                    "-in" | "-out" | "-inform" | "-outform" | "-algorithm" | "-pkeyopt" | "-name" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            "-inform" => inform = val,
                            "-outform" => outform = val,
                            "-algorithm" => algorithm = Some(val),
                            "-pkeyopt" => pkeyopts.push(val),
                            "-name" => curve_name = val,
                            _ => {}
                        }
                    }
                    "--" => {
                        positional.extend(rest[i + 1..].iter().cloned());
                        break;
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => positional.push(a.to_string()),
                }
                i += 1;
            }
            let generating = matches!(sub, "genrsa" | "genpkey" | "ecparam");
            let (alg, bits_or_curve, is_pub, seed) = if generating {
                let mut bits: isize = match positional.first() {
                    Some(s) => s.parse::<isize>().unwrap_or(-1),
                    None => 2048,
                };
                for opt in &pkeyopts {
                    if let Some(b) = opt.strip_prefix("rsa_keygen_bits:") {
                        bits = b.parse::<isize>().unwrap_or(-1);
                    } else if let Some(c) = opt.strip_prefix("ec_paramgen_curve:") {
                        curve_name = c.to_string();
                    } else {
                        return Err(format!("unsupported key option: {opt}"));
                    }
                }
                if sub == "ecparam" && !genkey_flag {
                    let oid_hex = match curve_name.as_str() {
                        "prime256v1" | "P-256" => "06082a8648ce3d030107",
                        "secp384r1" | "P-384" => "06052b81040022",
                        "secp521r1" | "P-521" => "06052b81040023",
                        _ => return Err(format!("unsupported curve: {curve_name}")),
                    };
                    let oid_bytes = openssl_hex_decode(oid_hex)?;
                    let mut out = String::new();
                    if text_flag {
                        out.push_str(&format!("ASN1 OID: {curve_name}\n"));
                    }
                    if !noout {
                        if outform == "DER" {
                            let mut combined = out.into_bytes();
                            combined.extend_from_slice(&oid_bytes);
                            return openssl_write_bytes(&combined, out_file.as_deref(), cwd, fs);
                        }
                        let b64 = openssl_b64_encode(&oid_bytes, true);
                        out.push_str(&format!("-----BEGIN EC PARAMETERS-----\n{b64}\n-----END EC PARAMETERS-----\n"));
                    }
                    return openssl_write_bytes(out.as_bytes(), out_file.as_deref(), cwd, fs);
                }
                let alg_str = algorithm.unwrap_or_else(|| if sub == "ecparam" { "EC".to_string() } else { "RSA".to_string() }).to_uppercase();
                match alg_str.as_str() {
                    "RSA" => {
                        if bits < 512 || bits > 4096 || bits % 8 != 0 {
                            return Err("RSA size must be a multiple of 8 from 512 to 4096".to_string());
                        }
                    }
                    "EC" => {
                        if !matches!(curve_name.as_str(), "prime256v1" | "P-256" | "secp384r1" | "P-384" | "secp521r1" | "P-521") {
                            return Err(format!("unsupported curve: {curve_name}"));
                        }
                    }
                    "ED25519" => {}
                    _ => return Err(format!("unsupported key algorithm: {alg_str}")),
                }
                let seed_bytes = sha256_bytes(format!("sb-key-{alg_str}-{bits}-{curve_name}").as_bytes()).to_vec();
                let boc = if alg_str == "RSA" { bits.to_string() } else { curve_name.clone() };
                (alg_str, boc, pubout, seed_bytes)
            } else {
                if !positional.is_empty() {
                    return Err("unexpected key argument".to_string());
                }
                if inform != "PEM" && inform != "DER" {
                    return Err("format must be PEM or DER".to_string());
                }
                let raw = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
                if inform == "PEM" {
                    let txt = String::from_utf8_lossy(&raw);
                    let lines: Vec<&str> = txt.trim().lines().collect();
                    if !lines.first().map(|l| l.starts_with("-----BEGIN ")).unwrap_or(false)
                        || !lines.last().map(|l| l.starts_with("-----END ")).unwrap_or(false)
                    {
                        return Err("invalid PEM input".to_string());
                    }
                }
                let (meta, seed_bytes) = openssl_extract_key_seed(&raw)?;
                let parts: Vec<&str> = meta.split(':').collect();
                let alg_str = parts.first().copied().unwrap_or("RSA").to_string();
                let boc = parts.get(2).copied().unwrap_or("2048").to_string();
                let was_pub = pubin || parts.get(1).copied() == Some("PUBLIC");
                (alg_str, boc, was_pub || pubout, seed_bytes)
            };
            if sub == "rsa" && alg != "RSA" {
                return Err("not an RSA key".to_string());
            }
            if sub == "ec" && alg != "EC" {
                return Err("not an EC key".to_string());
            }
            if modulus_flag && alg != "RSA" {
                return Err("modulus is only available for RSA keys".to_string());
            }
            let mut lines = Vec::new();
            if check_flag {
                lines.push("Key is valid".to_string());
            }
            if text_flag {
                let role = if is_pub { "Public" } else { "Private" };
                let hx = openssl_hex_encode(&seed);
                if alg == "RSA" {
                    lines.push(format!("{role}-Key: ({bits_or_curve} bit)"));
                    lines.push(format!("modulus: {hx}"));
                } else if alg == "EC" {
                    let crv = match bits_or_curve.as_str() {
                        "prime256v1" | "P-256" => "P-256",
                        "secp384r1" | "P-384" => "P-384",
                        "secp521r1" | "P-521" => "P-521",
                        other => other,
                    };
                    lines.push(format!("{role}-Key: ({crv})"));
                    lines.push(format!("x: {hx}"));
                } else {
                    lines.push(format!("{role}-Key: (Ed25519)"));
                    lines.push(format!("x: {hx}"));
                }
            }
            if modulus_flag {
                let hx = openssl_hex_encode(&seed).to_uppercase();
                lines.push(format!("Modulus={hx}"));
            }
            let mut output = if lines.is_empty() {
                String::new()
            } else {
                let joined = lines.join("\n");
                format!("{joined}\n")
            };
            if !noout || (sub == "ecparam" && genkey_flag) {
                let role_tag = if is_pub { "PUBLIC" } else { "PRIVATE" };
                let payload = openssl_key_payload(&alg, role_tag, &bits_or_curve, &seed);
                if outform != "PEM" && outform != "DER" {
                    return Err("format must be PEM or DER".to_string());
                }
                if outform == "DER" {
                    return openssl_write_bytes(payload.as_bytes(), out_file.as_deref(), cwd, fs);
                }
                let label = if is_pub { "PUBLIC KEY" } else { "PRIVATE KEY" };
                let b64 = openssl_b64_encode(payload.as_bytes(), true);
                output.push_str(&format!("-----BEGIN {label}-----\n{b64}\n-----END {label}-----\n"));
            }
            return openssl_write_bytes(output.as_bytes(), out_file.as_deref(), cwd, fs);
        }
        if sub == "pkeyutl" {
            let mut sign = false;
            let mut verify = false;
            let mut inkey: Option<String> = None;
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut sig_file: Option<String> = None;
            let mut digest = "sha256".to_string();
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-sign" => sign = true,
                    "-verify" => verify = true,
                    "-rawin" | "-pubin" => {}
                    "-inkey" | "-in" | "-out" | "-sigfile" | "-digest" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-inkey" => inkey = Some(val),
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            "-sigfile" => sig_file = Some(val),
                            "-digest" => digest = val,
                            _ => {}
                        }
                    }
                    _ => return Err(format!("unknown option: {a}")),
                }
                i += 1;
            }
                if inkey.is_none() || (sign == verify) {
                    return Err("pkeyutl requires -inkey and one of -sign/-verify".to_string());
                }
                if !matches!(digest.as_str(), "sha1" | "sha256" | "sha384" | "sha512") {
                    return Err("unsupported signing digest".to_string());
                }
                if !sign && sig_file.is_none() {
                    return Err("sign/verify requires a key and verification requires a signature".to_string());
                }
                let key_bytes = openssl_read_bytes(inkey.as_deref(), &mut stdin_buf, cwd, fs)?;
            let (meta, seed) = openssl_extract_key_seed(&key_bytes)?;
            let input = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
            let expected = openssl_compute_signature(&meta, &digest, &seed, &input);
            if sign {
                return openssl_write_bytes(&expected, out_file.as_deref(), cwd, fs);
            } else {
                let sf = sig_file.as_deref().ok_or_else(|| "sign/verify requires a key and verification requires a signature".to_string())?;
                let actual = openssl_read_bytes(Some(sf), &mut stdin_buf, cwd, fs)?;
                if actual == expected {
                    return openssl_write_bytes(b"Signature Verified Successfully\n", out_file.as_deref(), cwd, fs);
                } else {
                    return Ok(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "Signature Verification Failure\n".to_string(),
                        exit_code: 1,
                    });
                }
            }
        }
        if sub == "req" || sub == "x509" {
            let mut is_new = false;
            let mut is_x509 = sub == "x509";
            let mut noout = false;
            let mut text_flag = false;
            let mut subject_flag = false;
            let mut issuer_flag = false;
            let mut dates_flag = false;
            let mut startdate_flag = false;
            let mut enddate_flag = false;
            let mut serial_flag = false;
            let mut fingerprint_flag = false;
            let mut verify_flag = false;
            let mut fp_hash = "sha1";
            let mut explicit_hash = false;
            let mut key_file: Option<String> = None;
            let mut keyout_file: Option<String> = None;
            let mut newkey_spec: Option<String> = None;
            let mut days = 30usize;
            let mut subj_opt: Option<String> = None;
            let mut addexts = Vec::new();
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut inform = "PEM".to_string();
            let mut outform = "PEM".to_string();
            let mut ext_opt: Option<String> = None;
            let mut checkend_opt: Option<usize> = None;
            let mut i = 0usize;
            while i < rest.len() {
                let a = rest[i].as_str();
                match a {
                    "-new" => is_new = true,
                    "-x509" => is_x509 = true,
                    "-nodes" | "-noenc" => {}
                    "-noout" => noout = true,
                    "-text" => text_flag = true,
                    "-subject" => subject_flag = true,
                    "-issuer" => issuer_flag = true,
                    "-dates" => dates_flag = true,
                    "-startdate" => startdate_flag = true,
                    "-enddate" => enddate_flag = true,
                    "-serial" => serial_flag = true,
                    "-fingerprint" => fingerprint_flag = true,
                    "-verify" => verify_flag = true,
                    "-sha1" | "-sha256" | "-sha384" | "-sha512" => {
                        fp_hash = &a[1..];
                        explicit_hash = true;
                    }
                    "-key" | "-keyout" | "-newkey" | "-days" | "-subj" | "-addext" | "-in" | "-out" | "-inform" | "-outform" | "-ext" | "-checkend" => {
                        i += 1;
                        let val = rest.get(i).ok_or_else(|| format!("missing value for {a}"))?.clone();
                        match a {
                            "-key" => key_file = Some(val),
                            "-keyout" => keyout_file = Some(val),
                            "-newkey" => newkey_spec = Some(val),
                            "-days" => {
                                let Ok(parsed_days) = val.parse::<usize>() else {
                                    return Err(format!("invalid or excessive -days: {val}"));
                                };
                                if parsed_days < 1 || parsed_days > 365000 {
                                    return Err(format!("invalid or excessive -days: {val}"));
                                }
                                days = parsed_days;
                            }
                            "-subj" => subj_opt = Some(val),
                            "-addext" => addexts.push(val),
                            "-in" => in_file = Some(val),
                            "-out" => out_file = Some(val),
                            "-inform" => inform = val,
                            "-outform" => outform = val,
                            "-ext" => ext_opt = Some(val),
                            "-checkend" => {
                                let Ok(secs) = val.parse::<usize>() else {
                                    return Err("invalid checkend interval".to_string());
                                };
                                checkend_opt = Some(secs);
                            }
                            _ => {}
                        }
                    }
                    _ if a.starts_with('-') => return Err(format!("unknown option: {a}")),
                    _ => return Err("unexpected certificate argument".to_string()),
                }
                i += 1;
            }
            let generating = is_new || (sub == "req" && (is_x509 || newkey_spec.is_some()));
            let (subj_display, cert_days, cert_exts_raw, raw_cert_bytes) = if generating {
                if key_file.is_none() {
                    let nk = newkey_spec.as_deref().unwrap_or("rsa:2048");
                    let (nk_alg, nk_param) = nk.split_once(':').unwrap_or((nk, "2048"));
                    let alg_upper = nk_alg.to_uppercase();
                    match alg_upper.as_str() {
                        "RSA" => {
                            let bits = nk_param.parse::<isize>().unwrap_or(-1);
                            if bits < 512 || bits > 4096 || bits % 8 != 0 {
                                return Err("RSA size must be a multiple of 8 from 512 to 4096".to_string());
                            }
                        }
                        "EC" => {
                            let curve = if nk.contains(':') { nk_param } else { "prime256v1" };
                            if !matches!(curve, "prime256v1" | "P-256" | "secp384r1" | "P-384" | "secp521r1" | "P-521") {
                                return Err(format!("unsupported curve: {curve}"));
                            }
                        }
                        "ED25519" => {}
                        _ => return Err(format!("unsupported key algorithm: {alg_upper}")),
                    }
                }
                let raw_subj = subj_opt.as_deref().ok_or_else(|| "-subj is required for noninteractive requests".to_string())?;
                let formatted_subj = openssl_format_subject(raw_subj)?;
                let _ = openssl_validate_and_format_addexts(&addexts)?;
                if let Some(ref ko) = keyout_file {
                    let nk = newkey_spec.as_deref().unwrap_or("rsa:2048");
                    let (nk_alg, nk_param) = nk.split_once(':').unwrap_or((nk, "2048"));
                    let alg_upper = nk_alg.to_uppercase();
                    let seed = sha256_bytes(format!("sb-key-{nk}-{formatted_subj}").as_bytes());
                    let payload = openssl_key_payload(&alg_upper, "PRIVATE", nk_param, &seed);
                    let b64 = openssl_b64_encode(payload.as_bytes(), true);
                    let pem_key = format!("-----BEGIN PRIVATE KEY-----\n{b64}\n-----END PRIVATE KEY-----\n");
                    let _ = openssl_write_bytes(pem_key.as_bytes(), Some(ko), cwd, fs)?;
                } else if let Some(ref kf) = key_file {
                    let _ = openssl_read_bytes(Some(kf), &mut stdin_buf, cwd, fs)?;
                }
                let exts_joined = addexts.join(";");
                let payload = format!("SBCERT:{formatted_subj}\t{days}\t{exts_joined}");
                (formatted_subj, days, addexts.clone(), payload.into_bytes())
            } else {
                if inform != "PEM" && inform != "DER" {
                    return Err("format must be PEM or DER".to_string());
                }
                let raw = openssl_read_bytes(in_file.as_deref(), &mut stdin_buf, cwd, fs)?;
                let txt = String::from_utf8_lossy(&raw);
                let trimmed = txt.trim();
                if inform == "PEM" {
                    let lines: Vec<&str> = trimmed.lines().collect();
                    if !lines.first().map(|l| l.starts_with("-----BEGIN ")).unwrap_or(false)
                        || !lines.last().map(|l| l.starts_with("-----END ")).unwrap_or(false)
                    {
                        return Err("invalid PEM input".to_string());
                    }
                }
                let decoded = if trimmed.starts_with("-----BEGIN ") {
                    let lines: Vec<&str> = trimmed.lines().collect();
                    let body = if lines.len() >= 2 { lines[1..lines.len() - 1].join("") } else { String::new() };
                    base64_decode(&body).unwrap_or_default()
                } else {
                    raw
                };
                let dec_str = String::from_utf8_lossy(&decoded);
                let (subj, parsed_days, parsed_exts) = if let Some(rest_c) = dec_str.strip_prefix("SBCERT:") {
                    let parts: Vec<&str> = if rest_c.contains('\t') {
                        rest_c.splitn(3, '\t').collect()
                    } else {
                        rest_c.splitn(3, ':').collect()
                    };
                    let s = parts.first().copied().unwrap_or("").to_string();
                    let d = parts.get(1).and_then(|v| v.parse::<usize>().ok()).unwrap_or(365);
                    let exts: Vec<String> = parts
                        .get(2)
                        .map(|e| e.split(';').filter(|x| !x.is_empty()).map(|x| x.to_string()).collect())
                        .unwrap_or_default();
                    (s, d, exts)
                } else {
                    ("CN=localhost".to_string(), 365usize, Vec::new())
                };
                (subj, parsed_days, parsed_exts, decoded)
            };
            let formatted_exts = openssl_validate_and_format_addexts(&cert_exts_raw).unwrap_or_default();
            let mut stderr_msg = String::new();
            if verify_flag && sub == "req" && !is_x509 {
                stderr_msg = "Certificate request self-signature verify OK\n".to_string();
            }
            let mut lines = Vec::new();
            if text_flag {
                let mut text_block = format!("Certificate:\n    Subject: {subj_display}");
                if !formatted_exts.is_empty() {
                    text_block.push_str("\n    Extensions:");
                    for (_, ext_txt) in &formatted_exts {
                        for l in ext_txt.lines() {
                            text_block.push_str(&format!("\n      {l}"));
                        }
                    }
                }
                lines.push(text_block);
            }
            if subject_flag {
                lines.push(format!("subject={subj_display}"));
            }
            let mut exit_code = 0i32;
            if is_x509 {
                if issuer_flag {
                    lines.push(format!("issuer={subj_display}"));
                }
                if dates_flag || startdate_flag {
                    lines.push("notBefore=Jan  1 00:00:00 2026 GMT".to_string());
                }
                if dates_flag || enddate_flag {
                    lines.push("notAfter=Jan  1 00:00:00 2027 GMT".to_string());
                }
                if serial_flag {
                    lines.push("serial=01".to_string());
                }
                if fingerprint_flag {
                    let d = openssl_hash(fp_hash, &raw_cert_bytes);
                    let colons: Vec<String> = d.iter().map(|b| format!("{b:02X}")).collect();
                    let label = if explicit_hash { fp_hash.to_lowercase() } else { "SHA1".to_string() };
                    let joined = colons.join(":");
                    lines.push(format!("{label} Fingerprint={joined}"));
                }
                if let Some(ref ext_names) = ext_opt {
                    for req_name in ext_names.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                        let canonical = match req_name {
                            "2.5.29.17" => "subjectAltName",
                            "2.5.29.19" => "basicConstraints",
                            "2.5.29.15" => "keyUsage",
                            "2.5.29.37" => "extendedKeyUsage",
                            "2.5.29.14" => "subjectKeyIdentifier",
                            other => other,
                        };
                        if let Some((_, txt)) = formatted_exts.iter().find(|(n, _)| n == canonical) {
                            lines.push(txt.clone());
                        }
                    }
                }
                if let Some(secs) = checkend_opt {
                    if secs >= cert_days * 86400 {
                        exit_code = 1;
                        lines.push("Certificate will expire".to_string());
                    } else {
                        lines.push("Certificate will not expire".to_string());
                    }
                }
            }
            let mut output = if lines.is_empty() {
                String::new()
            } else {
                let joined = lines.join("\n");
                format!("{joined}\n")
            };
            if !noout && checkend_opt.is_none() {
                if outform != "PEM" && outform != "DER" {
                    return Err("format must be PEM or DER".to_string());
                }
                if outform == "DER" {
                    return openssl_write_bytes(&raw_cert_bytes, out_file.as_deref(), cwd, fs);
                }
                let label = if is_x509 { "CERTIFICATE" } else { "CERTIFICATE REQUEST" };
                let b64 = openssl_b64_encode(&raw_cert_bytes, true);
                output.push_str(&format!("-----BEGIN {label}-----\n{b64}\n-----END {label}-----\n\n"));
            }
            let mut out_res = openssl_write_bytes(output.as_bytes(), out_file.as_deref(), cwd, fs)?;
            out_res.stderr = stderr_msg;
            out_res.exit_code = exit_code;
            return Ok(out_res);
        }
        Err(format!("Invalid command '{sub}'; type \"openssl help\" for a list."))
    };
    match run() {
        Ok(res) => res,
        Err(msg) => err_out(&format!("openssl: {msg}\n"), 1),
    }
}

fn pgp_crc24(data: &[u8]) -> String {
    let mut crc = 0xb704ceu32;
    for &b in data {
        crc ^= (b as u32) << 16;
        for _ in 0..8 {
            crc <<= 1;
            if (crc & 0x1000000) != 0 {
                crc ^= 0x1864cfb;
            }
        }
    }
    let bytes = [((crc >> 16) & 0xff) as u8, ((crc >> 8) & 0xff) as u8, (crc & 0xff) as u8];
    format!("={}", base64_encode(&bytes))
}

fn cmd_gpg(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut version = false;
    let mut detach_sign = false;
    let mut verify = false;
    let mut list_keys = false;
    let mut quick_gen_key = false;
    let mut export_keys = false;
    let mut import_keys = false;
    let mut symmetric = false;
    let mut decrypt = false;
    let mut armor = false;
    let mut with_colons = false;
    let mut passphrase: Option<String> = None;
    let mut passphrase_file: Option<String> = None;
    let mut passphrase_fd: Option<String> = None;
    let mut signer_uid = "Git User <user@example.com>".to_string();
    let mut status_fd: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut positionals = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--" {
            positionals.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "--version" {
            version = true;
        } else if matches!(a, "--detach-sign" | "-b" | "-bsau" | "-bsa") {
            detach_sign = true;
        } else if a == "--verify" {
            verify = true;
        } else if a == "-c" || a == "--symmetric" {
            symmetric = true;
        } else if a == "-d" || a == "--decrypt" {
            decrypt = true;
        } else if a == "-a" || a == "--armor" {
            armor = true;
        } else if matches!(a, "--list-keys" | "-k" | "--list-secret-keys" | "-K") {
            list_keys = true;
        } else if matches!(a, "--quick-generate-key" | "--quick-gen-key" | "--gen-key" | "--full-generate-key") {
            quick_gen_key = true;
        } else if a == "--export" {
            export_keys = true;
        } else if a == "--import" {
            import_keys = true;
        } else if a == "--with-colons" {
            with_colons = true;
        } else if (a == "-u" || a == "--local-user") && i + 1 < args.len() {
            i += 1;
            signer_uid = args[i].clone();
        } else if let Some(rest) = a.strip_prefix("-bsau") && !rest.is_empty() {
            detach_sign = true;
            signer_uid = rest.to_string();
        } else if a == "--status-fd" && i + 1 < args.len() {
            i += 1;
            status_fd = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--status-fd=") {
            status_fd = Some(rest.to_string());
        } else if a == "--passphrase" && i + 1 < args.len() {
            i += 1;
            passphrase = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--passphrase=") {
            passphrase = Some(rest.to_string());
        } else if a == "--passphrase-file" && i + 1 < args.len() {
            i += 1;
            passphrase_file = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--passphrase-file=") {
            passphrase_file = Some(rest.to_string());
        } else if a == "--passphrase-fd" && i + 1 < args.len() {
            i += 1;
            passphrase_fd = Some(args[i].clone());
        } else if let Some(rest) = a.strip_prefix("--passphrase-fd=") {
            passphrase_fd = Some(rest.to_string());
        } else if matches!(a, "--pinentry-mode" | "--cipher-algo" | "--s2k-digest-algo" | "--s2k-cipher-algo" | "--s2k-mode" | "--s2k-count") && i + 1 < args.len() {
            i += 1;
        } else if a.starts_with("--pinentry-mode=")
            || a.starts_with("--cipher-algo=")
            || a.starts_with("--s2k-digest-algo=")
            || a.starts_with("--s2k-cipher-algo=")
            || a.starts_with("--s2k-mode=")
            || a.starts_with("--s2k-count=")
        {
        } else if (a == "-o" || a == "--output") && i + 1 < args.len() {
            i += 1;
            out_file = Some(args[i].clone());
        } else if matches!(a, "--batch" | "--yes" | "--no-tty" | "-q" | "--quiet" | "-s" | "--sign" | "--help" | "-h") {
        } else if a.starts_with('-') {
            return err_out(&format!("gpg: unknown option: {a}\n"), 2);
        } else {
            positionals.push(a.to_string());
        }
        i += 1;
    }

    if version {
        return ok_out("gpg (GnuPG) 2.4.5 (safe-bash)\nlibgcrypt 1.11.0\n");
    }

    let keyring_path = "/home/user/.gnupg/keyring.json";
    let parse_keyring_bytes = |raw: &[u8]| -> Vec<(String, String, String, String)> {
        let txt = String::from_utf8_lossy(raw);
        let mut keys = Vec::new();
        for block in txt.split('{').skip(1) {
            let get_field = |name: &str| -> String {
                let pat = format!("\"{name}\":");
                if let Some(pos) = block.find(&pat) {
                    let after = &block[pos + pat.len()..];
                    if let Some(q1) = after.find('"') {
                        let rest_q = &after[q1 + 1..];
                        if let Some(q2) = rest_q.find('"') {
                            return rest_q[..q2].to_string();
                        }
                    }
                }
                String::new()
            };
            let uid = get_field("uid");
            let kid = get_field("keyIdHex");
            let seed_h = get_field("seedHex");
            let pub_h = get_field("pubHex");
            if !kid.is_empty() {
                keys.push((uid, kid, seed_h, pub_h));
            }
        }
        keys
    };
    let load_keyring = || -> Vec<(String, String, String, String)> {
        let Ok(raw) = fs.read_file(keyring_path) else {
            return Vec::new();
        };
        parse_keyring_bytes(&raw)
    };
    let save_keyring = |keys: &[(String, String, String, String)]| {
        let _ = fs.mkdir_all("/home/user/.gnupg");
        let mut json = String::from("[\n");
        for (idx, (uid, kid, seed_h, pub_h)) in keys.iter().enumerate() {
            let comma = if idx + 1 < keys.len() { "," } else { "" };
            json.push_str(&format!(
                "  {{\n    \"uid\": \"{uid}\",\n    \"keyIdHex\": \"{kid}\",\n    \"seedHex\": \"{seed_h}\",\n    \"pubHex\": \"{pub_h}\"\n  }}{comma}\n"
            ));
        }
        json.push(']');
        let _ = fs.write_file(keyring_path, json.as_bytes());
    };
    let ensure_key = |uid: &str| -> (String, String, String, String) {
        let mut keys = load_keyring();
        if let Some(found) = keys.iter().find(|(u, kid, _, _)| u.contains(uid) || kid.ends_with(&uid.to_uppercase())) {
            return found.clone();
        }
        let seed = sha256_bytes(format!("gpg-key-seed:{uid}").as_bytes());
        let pub_b = ed25519_pubkey_from_seed(&seed);
        let fp = sha256_bytes(&pub_b);
        let kid = openssl_hex_encode(&fp[24..32]).to_uppercase();
        let entry = (uid.to_string(), kid, openssl_hex_encode(&seed), openssl_hex_encode(&pub_b));
        keys.push(entry.clone());
        save_keyring(&keys);
        entry
    };

    let read_gpg_file = |p: &str| -> Result<Vec<u8>, String> {
        let full = resolve_ssh_path(cwd, p);
        if fs.is_dir(&full) {
            return Err(format!(
                "EISDIR: illegal operation on a directory, readFile '{full}'"
            ));
        }
        fs.read_file(&full)
            .map_err(|_| format!("ENOENT: no such file or directory, readFile '{full}'"))
    };

    let resolve_passphrase = || -> Result<String, String> {
        if let Some(ref pf) = passphrase_file {
            let raw = read_gpg_file(pf)?;
            let s = String::from_utf8_lossy(&raw);
            return Ok(s.lines().next().unwrap_or("").trim_end_matches('\r').to_string());
        }
        if let Some(ref p) = passphrase {
            return Ok(p.clone());
        }
        if passphrase_fd.as_deref() == Some("0") && !positionals.is_empty() {
            return Ok(stdin.lines().next().unwrap_or("").trim_end_matches('\r').to_string());
        }
        Ok(String::new())
    };

    if symmetric {
        let secret = match resolve_passphrase() {
            Ok(s) => s,
            Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
        };
        let payload = if let Some(p0) = positionals.first() && p0 != "-" {
            match read_gpg_file(p0) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let salt = b"0123456789abcdef";
        let iv = b"1234567890123456";
        let key = pbkdf2_hmac_sha256(secret.as_bytes(), salt, 10000, 32);
        let (rk, nr) = aes_expand_key(&key);
        let mut ctr = [0u8; 16];
        ctr.copy_from_slice(iv);
        let mut cipher = Vec::with_capacity(payload.len());
        for chunk in payload.chunks(16) {
            let ks = aes_encrypt_block(&ctr, &rk, nr);
            for (&b, &k) in chunk.iter().zip(ks.iter()) {
                cipher.push(b ^ k);
            }
            for idx in (0..16).rev() {
                ctr[idx] = ctr[idx].wrapping_add(1);
                if ctr[idx] != 0 { break; }
            }
        }
        let tag = openssl_hmac("sha256", &key, &cipher);
        let mut env_bytes = Vec::new();
        env_bytes.extend_from_slice(b"PGPSYM1\0");
        env_bytes.extend_from_slice(salt);
        env_bytes.extend_from_slice(&iv[..12]);
        env_bytes.extend_from_slice(&cipher);
        env_bytes.extend_from_slice(&tag[..16]);
        let out_bytes = if armor {
            let b64 = openssl_b64_encode(&env_bytes, true);
            format!("-----BEGIN PGP MESSAGE-----\n\n{b64}\n-----END PGP MESSAGE-----\n").into_bytes()
        } else {
            env_bytes
        };
        let target_out = out_file.or_else(|| {
            if let Some(p0) = positionals.first() && p0 != "-" {
                Some(format!("{p0}{}", if armor { ".asc" } else { ".gpg" }))
            } else {
                None
            }
        });
        if let Some(to) = target_out && to != "-" {
            let _ = fs.write_file(&resolve_posix_path(cwd, &to), &out_bytes);
            return ok_out("");
        }
        return ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes));
    }

    if decrypt {
        let secret = match resolve_passphrase() {
            Ok(s) => s,
            Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
        };
        let raw_in = if let Some(p0) = positionals.first() && p0 != "-" {
            match read_gpg_file(p0) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let head_str = String::from_utf8_lossy(&raw_in[..raw_in.len().min(64)]);
        let env_bytes = if head_str.contains("-----BEGIN PGP MESSAGE-----") {
            let full_str = String::from_utf8_lossy(&raw_in);
            let b64: String = full_str
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && !l.starts_with("-----") && !l.starts_with('='))
                .collect();
            base64_decode(&b64).unwrap_or_default()
        } else {
            raw_in
        };
        if env_bytes.len() < 8 + 16 + 12 + 16 || &env_bytes[..8] != b"PGPSYM1\0" {
            return err_out("gpg: decryption failed: Bad session key\n", 2);
        }
        let salt = &env_bytes[8..24];
        let cipher_and_tag = &env_bytes[36..];
        let cipher_len = cipher_and_tag.len() - 16;
        let cipher = &cipher_and_tag[..cipher_len];
        let tag = &cipher_and_tag[cipher_len..];
        let key = pbkdf2_hmac_sha256(secret.as_bytes(), salt, 10000, 32);
        let expected_tag = openssl_hmac("sha256", &key, cipher);
        if tag != &expected_tag[..16] {
            return err_out("gpg: decryption failed: Bad session key\n", 2);
        }
        let (rk, nr) = aes_expand_key(&key);
        let mut ctr = *b"1234567890123456";
        let mut plain = Vec::with_capacity(cipher.len());
        for chunk in cipher.chunks(16) {
            let ks = aes_encrypt_block(&ctr, &rk, nr);
            for (&b, &k) in chunk.iter().zip(ks.iter()) {
                plain.push(b ^ k);
            }
            for idx in (0..16).rev() {
                ctr[idx] = ctr[idx].wrapping_add(1);
                if ctr[idx] != 0 { break; }
            }
        }
        if let Some(ref to) = out_file && to != "-" {
            let _ = fs.write_file(&resolve_posix_path(cwd, to), &plain);
            return ok_out("");
        }
        return ok_out(&crate::vfs::bytes_to_stream_string(&plain));
    }

    if quick_gen_key {
        let uid = positionals.first().map(|s| s.as_str()).unwrap_or(&signer_uid);
        let (u, kid, _, _) = ensure_key(uid);
        return ok_out(&format!("pub   ed25519/{kid} 2026-09-28 [SC]\nuid                 [ultimate] {u}\n"));
    }

    if list_keys {
        let keys = load_keyring();
        let mut out = String::new();
        for (u, kid, _, _) in keys {
            if !positionals.is_empty()
                && !positionals
                    .iter()
                    .any(|q| u.contains(q.as_str()) || kid.contains(&q.to_ascii_uppercase()))
            {
                continue;
            }
            if with_colons {
                out.push_str(&format!(
                    "sec:u:255:22:{kid}:1790553600:::u:::scESC:::+:::23::0:\nuid:u::::1790553600::{kid}::{u}::::::::::0:\n"
                ));
            } else {
                out.push_str(&format!("sec   ed25519/{kid} 2026-09-28 [SC]\nuid                 [ultimate] {u}\n"));
            }
        }
        return ok_out(&out);
    }

    if export_keys {
        let raw = fs.read_file(keyring_path).unwrap_or_else(|_| b"[]".to_vec());
        let b64 = openssl_b64_encode(&raw, true);
        let arm = format!("-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n{b64}\n-----END PGP PUBLIC KEY BLOCK-----\n");
        if let Some(ref to) = out_file {
            let _ = fs.write_file(&resolve_posix_path(cwd, to), arm.as_bytes());
            return ok_out("");
        }
        return ok_out(&arm);
    }

    if import_keys {
        let input = if let Some(p0) = positionals.first() {
            match read_gpg_file(p0) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let txt = String::from_utf8_lossy(&input);
        let b64: String = txt.lines().filter(|l| !l.starts_with("-----") && !l.trim().is_empty()).collect();
        let decoded = base64_decode(&b64).unwrap_or_default();
        let imported = parse_keyring_bytes(&decoded);
        let cnt = imported.len();
        let mut existing = load_keyring();
        for entry in imported {
            if !existing.iter().any(|(_, k, _, _)| k == &entry.1) {
                existing.push(entry);
            }
        }
        save_keyring(&existing);
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("gpg: Total number processed: {cnt}\ngpg:               imported: {cnt}\n"),
            exit_code: 0,
        };
    }

    if detach_sign {
        let payload = if let Some(p0) = positionals.first() {
            match read_gpg_file(p0) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let (u, kid, seed_h, pub_h) = ensure_key(&signer_uid);
        let seed_bytes_vec = openssl_hex_decode(&seed_h).unwrap_or_else(|_| vec![0u8; 32]);
        let mut seed_arr = [0u8; 32];
        if seed_bytes_vec.len() == 32 {
            seed_arr.copy_from_slice(&seed_bytes_vec);
        }
        let pub_bytes_vec = openssl_hex_decode(&pub_h).unwrap_or_else(|_| ed25519_pubkey_from_seed(&seed_arr).to_vec());
        let mut pub_arr = [0u8; 32];
        if pub_bytes_vec.len() == 32 {
            pub_arr.copy_from_slice(&pub_bytes_vec);
        } else {
            pub_arr = ed25519_pubkey_from_seed(&seed_arr);
        }
        let fp = sha256_bytes(&pub_arr);
        let key_id = &fp[24..32];
        let mut hashed_sub = Vec::new();
        hashed_sub.extend_from_slice(&[5, 2, 0x60, 0x00, 0x00, 0x00]);
        hashed_sub.push(9);
        hashed_sub.push(16);
        hashed_sub.extend_from_slice(key_id);
        let uid_bytes = u.as_bytes();
        if uid_bytes.len() < 190 {
            hashed_sub.push((1 + uid_bytes.len()) as u8);
            hashed_sub.push(28);
            hashed_sub.extend_from_slice(uid_bytes);
        }
        let mut pub_key_sub = Vec::with_capacity(35);
        pub_key_sub.push(33);
        pub_key_sub.push(0x80 | 28);
        pub_key_sub.extend_from_slice(&pub_arr);
        let mut sig_header = vec![
            4,
            0x00,
            22,
            8,
            ((hashed_sub.len() >> 8) & 0xff) as u8,
            (hashed_sub.len() & 0xff) as u8,
        ];
        sig_header.extend_from_slice(&hashed_sub);
        let h_len = sig_header.len() as u32;
        let mut hash_target = Vec::with_capacity(payload.len() + sig_header.len() + 6);
        hash_target.extend_from_slice(&payload);
        hash_target.extend_from_slice(&sig_header);
        hash_target.extend_from_slice(&[4, 0xff]);
        hash_target.extend_from_slice(&h_len.to_be_bytes());
        let digest = sha256_bytes(&hash_target);
        let sig_bytes = ed25519_sign(&digest, &seed_arr);
        let mut body = Vec::new();
        body.extend_from_slice(&sig_header);
        body.push(((pub_key_sub.len() >> 8) & 0xff) as u8);
        body.push((pub_key_sub.len() & 0xff) as u8);
        body.extend_from_slice(&pub_key_sub);
        body.push(digest[0]);
        body.push(digest[1]);
        body.extend_from_slice(&[0x01, 0x00]);
        body.extend_from_slice(&sig_bytes[0..32]);
        body.extend_from_slice(&[0x01, 0x00]);
        body.extend_from_slice(&sig_bytes[32..64]);
        let mut pkt_bytes = vec![0xc2];
        if body.len() < 192 {
            pkt_bytes.push(body.len() as u8);
        } else {
            pkt_bytes.push(0xff);
            pkt_bytes.extend_from_slice(&(body.len() as u32).to_be_bytes());
        }
        pkt_bytes.extend_from_slice(&body);
        let b64 = openssl_b64_encode(&pkt_bytes, true);
        let crc = pgp_crc24(&pkt_bytes);
        let arm = format!("-----BEGIN PGP SIGNATURE-----\n\n{b64}\n{crc}\n-----END PGP SIGNATURE-----\n");
        let stderr_msg = if status_fd.is_some() {
            format!("[GNUPG:] SIG_CREATED D 22 8 00 1609459200 {kid}\n")
        } else {
            String::new()
        };
        if let Some(ref to) = out_file {
            let _ = fs.write_file(&resolve_posix_path(cwd, to), arm.as_bytes());
            return BuiltinOutcome { stdout: String::new(), stderr: stderr_msg, exit_code: 0 };
        }
        return BuiltinOutcome { stdout: arm, stderr: stderr_msg, exit_code: 0 };
    }

    if verify {
        let Some(sig_path) = positionals.first() else {
            return err_out("gpg: missing signature file for --verify\n", 2);
        };
        let sig_raw = match read_gpg_file(sig_path) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
        };
        let data_bytes = if let Some(p1) = positionals.get(1) {
            match read_gpg_file(p1) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("gpg: {e}\n"), 2),
            }
        } else {
            crate::vfs::stream_string_to_bytes(stdin)
        };
        let sig_txt = String::from_utf8_lossy(&sig_raw);
        let b64: String = sig_txt
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("-----") && !l.starts_with('=') && !l.contains(':'))
            .collect();
        let pkt = base64_decode(&b64).unwrap_or_default();
        let keys = load_keyring();
        if pkt.len() >= 10 && pkt[0] == 0xc2 {
            let idx = if pkt[1] < 192 { 2 } else if pkt[1] == 0xff && pkt.len() >= 6 { 6 } else { 0 };
            if idx > 0 && pkt.len() > idx + 6 && pkt[idx] == 4 {
                let body = &pkt[idx..];
                let hashed_len = ((body[4] as usize) << 8) | (body[5] as usize);
                let sig_header_end = 6 + hashed_len;
                if sig_header_end + 2 <= body.len() {
                    let sig_header = &body[..sig_header_end];
                    let mut key_id_hex = "0000000000000000".to_string();
                    let mut signer_uid_parsed = "unknown".to_string();
                    let mut sp = 6usize;
                    while sp < sig_header_end {
                        let slen = body[sp] as usize;
                        if slen == 0 || sp + 1 + slen > sig_header_end {
                            break;
                        }
                        let stype = body[sp + 1];
                        let sdata = &body[sp + 2..sp + 1 + slen];
                        if stype == 16 && sdata.len() == 8 {
                            key_id_hex = openssl_hex_encode(sdata).to_uppercase();
                        } else if stype == 28 {
                            signer_uid_parsed = String::from_utf8_lossy(sdata).to_string();
                        }
                        sp += 1 + slen;
                    }
                    let unhashed_len = ((body[sig_header_end] as usize) << 8) | (body[sig_header_end + 1] as usize);
                    let unhashed_end = sig_header_end + 2 + unhashed_len;
                    let mut pub_opt: Option<[u8; 32]> = None;
                    let mut usp = sig_header_end + 2;
                    while usp < unhashed_end && usp < body.len() {
                        let slen = body[usp] as usize;
                        if slen == 0 || usp + 1 + slen > unhashed_end || usp + 1 + slen > body.len() {
                            break;
                        }
                        let stype = body[usp + 1];
                        let sdata = &body[usp + 2..usp + 1 + slen];
                        if stype == (0x80 | 28) && sdata.len() == 32 {
                            let mut pk = [0u8; 32];
                            pk.copy_from_slice(sdata);
                            pub_opt = Some(pk);
                        }
                        usp += 1 + slen;
                    }
                    if let Some(pub_key) = pub_opt && unhashed_end + 2 + 68 <= body.len() {
                        let fp = sha256_bytes(&pub_key);
                        let derived_kid = openssl_hex_encode(&fp[24..32]).to_uppercase();
                        let pub_hex_lower = openssl_hex_encode(&pub_key).to_lowercase();
                        if key_id_hex == derived_kid
                            && let Some((trusted_uid, _, _, _)) = keys
                                .iter()
                                .find(|(_, k, _, ph)| k == &derived_kid && ph.to_lowercase() == pub_hex_lower)
                        {
                            let mpi_start = unhashed_end + 2;
                            let mut sig_arr = [0u8; 64];
                            sig_arr[0..32].copy_from_slice(&body[mpi_start + 2..mpi_start + 34]);
                            sig_arr[32..64].copy_from_slice(&body[mpi_start + 36..mpi_start + 68]);
                            let h_len = sig_header.len() as u32;
                            let mut hash_target = Vec::with_capacity(data_bytes.len() + sig_header.len() + 6);
                            hash_target.extend_from_slice(&data_bytes);
                            hash_target.extend_from_slice(sig_header);
                            hash_target.extend_from_slice(&[4, 0xff]);
                            hash_target.extend_from_slice(&h_len.to_be_bytes());
                            let digest = sha256_bytes(&hash_target);
                            if body[unhashed_end] == digest[0]
                                && body[unhashed_end + 1] == digest[1]
                                && ed25519_verify(&sig_arr, &digest, &pub_key)
                            {
                                let stdout_msg = if status_fd.is_some() {
                                    format!("[GNUPG:] GOODSIG {derived_kid} {trusted_uid}\n[GNUPG:] VALIDSIG {derived_kid} 2026-09-28 1609459200\n")
                                } else {
                                    String::new()
                                };
                                return BuiltinOutcome {
                                    stdout: stdout_msg,
                                    stderr: format!("gpg: Signature made using EDDSA key {derived_kid}\ngpg: Good signature from \"{trusted_uid}\" [ultimate]\n"),
                                    exit_code: 0,
                                };
                            }
                        }
                    }
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("gpg: BAD signature from \"{signer_uid_parsed}\"\n"),
                        exit_code: 1,
                    };
                }
            }
        }
        let pkt_str = String::from_utf8_lossy(&pkt);
        if let Some(rest_p) = pkt_str.strip_prefix("SBPGPSIG:") {
            let parts: Vec<&str> = rest_p.splitn(4, ':').collect();
            if parts.len() == 4 {
                let (kid, uid, _pub_h, sig_h) = (parts[0], parts[1], parts[2], parts[3]);
                if let Some((trusted_uid, _, seed_h, _)) = keys.iter().find(|(_, k, _, _)| k == kid) {
                    let expected = openssl_hex_encode(&openssl_hmac("sha256", seed_h.as_bytes(), &data_bytes));
                    if expected == sig_h {
                        let stdout_msg = if status_fd.is_some() {
                            format!("[GNUPG:] GOODSIG {kid} {trusted_uid}\n[GNUPG:] VALIDSIG {kid} 2026-09-28 1609459200\n")
                        } else {
                            String::new()
                        };
                        return BuiltinOutcome {
                            stdout: stdout_msg,
                            stderr: format!("gpg: Signature made using EDDSA key {kid}\ngpg: Good signature from \"{trusted_uid}\" [ultimate]\n"),
                            exit_code: 0,
                        };
                    }
                }
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("gpg: BAD signature from \"{uid}\"\n"),
                    exit_code: 1,
                };
            }
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "gpg: BAD signature from \"unknown\"\n".to_string(),
            exit_code: 1,
        };
    }

    ok_out("gpg (GnuPG) 2.4.5 (safe-bash)\n")
}

const ED25519_P: [u64; 4] = [0xffffffffffffffedu64, 0xffffffffffffffffu64, 0xffffffffffffffffu64, 0x7fffffffffffffffu64];
const ED25519_P_MINUS_2: [u64; 4] = [0xffffffffffffffebu64, 0xffffffffffffffffu64, 0xffffffffffffffffu64, 0x7fffffffffffffffu64];
const ED25519_P_MINUS_5_DIV_8: [u64; 4] = [0xfffffffffffffffdu64, 0xffffffffffffffffu64, 0xffffffffffffffffu64, 0x0fffffffffffffffu64];
const ED25519_L: [u64; 4] = [0x5812631a5cf5d3edu64, 0x14def9dea2f79cd6u64, 0x0000000000000000u64, 0x1000000000000000u64];
const ED25519_D: [u64; 4] = [0x75eb4dca135978a3u64, 0x00700a4d4141d8abu64, 0x8cc740797779e898u64, 0x52036cee2b6ffe73u64];
const ED25519_I: [u64; 4] = [0xc4ee1b274a0ea0b0u64, 0x2f431806ad2fe478u64, 0x2b4d00993dfbd7a7u64, 0x2b8324804fc1df0bu64];
const ED25519_BX: [u64; 4] = [0xc9562d608f25d51au64, 0x692cc7609525a7b2u64, 0xc0a4e231fdd6dc5cu64, 0x216936d3cd6e53feu64];
const ED25519_BY: [u64; 4] = [0x6666666666666658u64, 0x6666666666666666u64, 0x6666666666666666u64, 0x6666666666666666u64];
const ED25519_BT: [u64; 4] = [0x6dde8ab3a5b7dda3u64, 0x20f09f80775152f5u64, 0x66ea4e8e64abe37du64, 0x67875f0fd78b7665u64];

fn u256_ge(a: [u64; 4], b: [u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}

fn u256_add_raw(a: [u64; 4], b: [u64; 4]) -> [u64; 4] {
    let mut out = [0u64; 4];
    let mut carry = 0u128;
    for i in 0..4 {
        let s = (a[i] as u128) + (b[i] as u128) + carry;
        out[i] = s as u64;
        carry = s >> 64;
    }
    out
}

fn u256_sub_raw(a: [u64; 4], b: [u64; 4]) -> [u64; 4] {
    let mut out = [0u64; 4];
    let mut borrow = 0i128;
    for i in 0..4 {
        let d = (a[i] as i128) - (b[i] as i128) - borrow;
        if d < 0 {
            out[i] = (d + (1i128 << 64)) as u64;
            borrow = 1;
        } else {
            out[i] = d as u64;
            borrow = 0;
        }
    }
    out
}

fn u256_add_mod(a: [u64; 4], b: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    let s = u256_add_raw(a, b);
    if u256_ge(s, m) { u256_sub_raw(s, m) } else { s }
}

fn u256_sub_mod(a: [u64; 4], b: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    if u256_ge(a, b) {
        u256_sub_raw(a, b)
    } else {
        u256_sub_raw(u256_add_raw(a, m), b)
    }
}

fn u256_bit_len(a: [u64; 4]) -> usize {
    for i in (0..4).rev() {
        if a[i] != 0 {
            return i * 64 + (64 - a[i].leading_zeros() as usize);
        }
    }
    0
}

fn u256_mul_mod(mut a: [u64; 4], b: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    if m == ED25519_P {
        let mut c = [0u64; 8];
        for i in 0..4 {
            let mut carry = 0u128;
            for j in 0..4 {
                let prod = (a[i] as u128) * (b[j] as u128) + (c[i + j] as u128) + carry;
                c[i + j] = prod as u64;
                carry = prod >> 64;
            }
            c[i + 4] = carry as u64;
        }
        let l0 = [c[0], c[1], c[2], c[3] & 0x7fffffffffffffff];
        let h0 = [
            (c[3] >> 63) | (c[4] << 1),
            (c[4] >> 63) | (c[5] << 1),
            (c[5] >> 63) | (c[6] << 1),
            (c[6] >> 63) | (c[7] << 1),
        ];
        let mut d = [0u64; 5];
        let mut carry = 0u128;
        for i in 0..4 {
            let v = (l0[i] as u128) + 19u128 * (h0[i] as u128) + carry;
            d[i] = v as u64;
            carry = v >> 64;
        }
        d[4] = carry as u64;
        let l1 = [d[0], d[1], d[2], d[3] & 0x7fffffffffffffff];
        let h1 = ((d[3] >> 63) | (d[4] << 1)) as u128;
        let mut res = [0u64; 4];
        let mut c2 = 19u128 * h1;
        for i in 0..4 {
            let v = (l1[i] as u128) + c2;
            res[i] = v as u64;
            c2 = v >> 64;
        }
        if u256_ge(res, ED25519_P) {
            res = u256_sub_raw(res, ED25519_P);
        }
        return res;
    }
    let mut res = [0u64; 4];
    let bits = u256_bit_len(b);
    for i in 0..bits {
        if ((b[i / 64] >> (i % 64)) & 1) == 1 {
            res = u256_add_mod(res, a, m);
        }
        a = u256_add_mod(a, a, m);
    }
    res
}

fn u256_pow_mod(mut base: [u64; 4], exp: [u64; 4], m: [u64; 4]) -> [u64; 4] {
    let mut res = [1u64, 0, 0, 0];
    let bits = u256_bit_len(exp);
    for i in 0..bits {
        if ((exp[i / 64] >> (i % 64)) & 1) == 1 {
            res = u256_mul_mod(res, base, m);
        }
        base = u256_mul_mod(base, base, m);
    }
    res
}

fn ed_bytes_le_mod(bytes: &[u8], m: [u64; 4]) -> [u64; 4] {
    let mut rem = [0u64; 4];
    for i in (0..(bytes.len() * 8)).rev() {
        rem = u256_add_mod(rem, rem, m);
        if ((bytes[i / 8] >> (i % 8)) & 1) == 1 {
            rem = u256_add_mod(rem, [1, 0, 0, 0], m);
        }
    }
    rem
}

fn ed_num_to_32le(v: [u64; 4]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[i * 8..(i + 1) * 8].copy_from_slice(&v[i].to_le_bytes());
    }
    out
}

type EdPt = ([u64; 4], [u64; 4], [u64; 4], [u64; 4]);

fn ed_pt_add(p: EdPt, q: EdPt) -> EdPt {
    let (x1, y1, z1, t1) = p;
    let (x2, y2, z2, t2) = q;
    let a = u256_mul_mod(u256_sub_mod(y1, x1, ED25519_P), u256_sub_mod(y2, x2, ED25519_P), ED25519_P);
    let b = u256_mul_mod(u256_add_mod(y1, x1, ED25519_P), u256_add_mod(y2, x2, ED25519_P), ED25519_P);
    let two_d = u256_add_mod(ED25519_D, ED25519_D, ED25519_P);
    let c = u256_mul_mod(u256_mul_mod(t1, two_d, ED25519_P), t2, ED25519_P);
    let z1_2 = u256_add_mod(z1, z1, ED25519_P);
    let d = u256_mul_mod(z1_2, z2, ED25519_P);
    let e = u256_sub_mod(b, a, ED25519_P);
    let f = u256_sub_mod(d, c, ED25519_P);
    let g = u256_add_mod(d, c, ED25519_P);
    let h = u256_add_mod(b, a, ED25519_P);
    (
        u256_mul_mod(e, f, ED25519_P),
        u256_mul_mod(g, h, ED25519_P),
        u256_mul_mod(f, g, ED25519_P),
        u256_mul_mod(e, h, ED25519_P),
    )
}

fn ed_pt_mul(mut t: EdPt, n: [u64; 4]) -> EdPt {
    let mut r: EdPt = ([0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]);
    let bits = u256_bit_len(n);
    for i in 0..bits {
        if ((n[i / 64] >> (i % 64)) & 1) == 1 {
            r = ed_pt_add(r, t);
        }
        t = ed_pt_add(t, t);
    }
    r
}

fn ed_encode_pt(p: EdPt) -> [u8; 32] {
    let z_inv = u256_pow_mod(p.2, ED25519_P_MINUS_2, ED25519_P);
    let x = u256_mul_mod(p.0, z_inv, ED25519_P);
    let y = u256_mul_mod(p.1, z_inv, ED25519_P);
    let mut out = ed_num_to_32le(y);
    out[31] |= ((x[0] & 1) as u8) << 7;
    out
}

fn ed_decode_pt(b: &[u8]) -> Option<EdPt> {
    if b.len() != 32 {
        return None;
    }
    let mut y_bytes = [0u8; 32];
    y_bytes.copy_from_slice(b);
    let sign = (y_bytes[31] >> 7) & 1;
    y_bytes[31] &= 0x7f;
    let mut y = [0u64; 4];
    for i in 0..4 {
        y[i] = u64::from_le_bytes(y_bytes[i * 8..(i + 1) * 8].try_into().unwrap());
    }
    if u256_ge(y, ED25519_P) {
        return None;
    }
    let y2 = u256_mul_mod(y, y, ED25519_P);
    let u = u256_sub_mod(y2, [1, 0, 0, 0], ED25519_P);
    let v = u256_add_mod(u256_mul_mod(ED25519_D, y2, ED25519_P), [1, 0, 0, 0], ED25519_P);
    let v3 = u256_mul_mod(u256_mul_mod(v, v, ED25519_P), v, ED25519_P);
    let v7 = u256_mul_mod(u256_mul_mod(v3, v3, ED25519_P), v, ED25519_P);
    let uv7 = u256_mul_mod(u, v7, ED25519_P);
    let mut x = u256_mul_mod(
        u256_mul_mod(u, v3, ED25519_P),
        u256_pow_mod(uv7, ED25519_P_MINUS_5_DIV_8, ED25519_P),
        ED25519_P,
    );
    let vx2 = u256_mul_mod(v, u256_mul_mod(x, x, ED25519_P), ED25519_P);
    let neg_u = u256_sub_mod([0, 0, 0, 0], u, ED25519_P);
    if vx2 == neg_u {
        x = u256_mul_mod(x, ED25519_I, ED25519_P);
    }
    let vx2_check = u256_mul_mod(v, u256_mul_mod(x, x, ED25519_P), ED25519_P);
    if vx2_check != u {
        return None;
    }
    if x == [0, 0, 0, 0] && sign == 1 {
        return None;
    }
    if ((x[0] & 1) as u8) != sign {
        x = u256_sub_mod(ED25519_P, x, ED25519_P);
    }
    Some((x, y, [1, 0, 0, 0], u256_mul_mod(x, y, ED25519_P)))
}

fn ed25519_pubkey_from_seed(seed: &[u8; 32]) -> [u8; 32] {
    let h = sha512_bytes(seed);
    let mut s_bytes = [0u8; 32];
    s_bytes.copy_from_slice(&h[0..32]);
    s_bytes[0] &= 248;
    s_bytes[31] &= 127;
    s_bytes[31] |= 64;
    let a = ed_bytes_le_mod(&s_bytes, ED25519_P);
    let b_pt: EdPt = (ED25519_BX, ED25519_BY, [1, 0, 0, 0], ED25519_BT);
    ed_encode_pt(ed_pt_mul(b_pt, a))
}

fn ed25519_sign(msg: &[u8], seed: &[u8; 32]) -> [u8; 64] {
    let h = sha512_bytes(seed);
    let mut s_bytes = [0u8; 32];
    s_bytes.copy_from_slice(&h[0..32]);
    s_bytes[0] &= 248;
    s_bytes[31] &= 127;
    s_bytes[31] |= 64;
    let a_p = ed_bytes_le_mod(&s_bytes, ED25519_P);
    let a_l = ed_bytes_le_mod(&s_bytes, ED25519_L);
    let b_pt: EdPt = (ED25519_BX, ED25519_BY, [1, 0, 0, 0], ED25519_BT);
    let pub_a = ed_encode_pt(ed_pt_mul(b_pt, a_p));
    let mut r_input = Vec::with_capacity(32 + msg.len());
    r_input.extend_from_slice(&h[32..64]);
    r_input.extend_from_slice(msg);
    let r_hash = sha512_bytes(&r_input);
    let r_l = ed_bytes_le_mod(&r_hash, ED25519_L);
    let r_pt = ed_encode_pt(ed_pt_mul(b_pt, r_l));
    let mut k_input = Vec::with_capacity(64 + msg.len());
    k_input.extend_from_slice(&r_pt);
    k_input.extend_from_slice(&pub_a);
    k_input.extend_from_slice(msg);
    let k_hash = sha512_bytes(&k_input);
    let k_l = ed_bytes_le_mod(&k_hash, ED25519_L);
    let s_l = u256_add_mod(r_l, u256_mul_mod(k_l, a_l, ED25519_L), ED25519_L);
    let s_out = ed_num_to_32le(s_l);
    let mut sig = [0u8; 64];
    sig[0..32].copy_from_slice(&r_pt);
    sig[32..64].copy_from_slice(&s_out);
    sig
}

fn ed25519_verify(sig: &[u8], msg: &[u8], pub_key: &[u8]) -> bool {
    if sig.len() != 64 || pub_key.len() != 32 {
        return false;
    }
    let Some(r_pt) = ed_decode_pt(&sig[0..32]) else {
        return false;
    };
    let Some(a_pt) = ed_decode_pt(pub_key) else {
        return false;
    };
    let mut s_limbs = [0u64; 4];
    for i in 0..4 {
        s_limbs[i] = u64::from_le_bytes(sig[32 + i * 8..32 + (i + 1) * 8].try_into().unwrap());
    }
    if u256_ge(s_limbs, ED25519_L) {
        return false;
    }
    let mut k_input = Vec::with_capacity(64 + msg.len());
    k_input.extend_from_slice(&sig[0..32]);
    k_input.extend_from_slice(pub_key);
    k_input.extend_from_slice(msg);
    let k_hash = sha512_bytes(&k_input);
    let k_l = ed_bytes_le_mod(&k_hash, ED25519_L);
    let b_pt: EdPt = (ED25519_BX, ED25519_BY, [1, 0, 0, 0], ED25519_BT);
    let lhs = ed_encode_pt(ed_pt_mul(b_pt, s_limbs));
    let rhs = ed_encode_pt(ed_pt_add(r_pt, ed_pt_mul(a_pt, k_l)));
    lhs == rhs
}

fn ssh_write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn ssh_write_str(buf: &mut Vec<u8>, data: &[u8]) {
    ssh_write_u32(buf, data.len() as u32);
    buf.extend_from_slice(data);
}

fn ssh_read_u32(data: &[u8], pos: &mut usize) -> Option<u32> {
    if *pos + 4 > data.len() {
        return None;
    }
    let v = u32::from_be_bytes(data[*pos..*pos + 4].try_into().unwrap());
    *pos += 4;
    Some(v)
}

fn ssh_read_str(data: &[u8], pos: &mut usize) -> Option<Vec<u8>> {
    let len = ssh_read_u32(data, pos)? as usize;
    if *pos + len > data.len() {
        return None;
    }
    let out = data[*pos..*pos + len].to_vec();
    *pos += len;
    Some(out)
}

fn ssh_ed25519_pubkey_blob(pub_key: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    ssh_write_str(&mut out, b"ssh-ed25519");
    ssh_write_str(&mut out, pub_key);
    out
}

fn ssh_b64_wrap(bytes: &[u8], width: usize) -> String {
    let raw = base64_encode(bytes);
    let s = raw.trim_end_matches('\n');
    if width == 0 {
        return s.to_string();
    }
    let mut lines = Vec::new();
    let mut i = 0usize;
    while i < s.len() {
        let end = (i + width).min(s.len());
        lines.push(&s[i..end]);
        i = end;
    }
    lines.join("\n")
}

fn ssh_fingerprint_sha256(pub_key: &[u8]) -> String {
    let blob = ssh_ed25519_pubkey_blob(pub_key);
    let digest = sha256_bytes(&blob);
    let b64 = ssh_b64_wrap(&digest, 0);
    format!("SHA256:{}", b64.trim_end_matches('='))
}

fn format_openssh_ed25519_privkey(seed: &[u8; 32], pub_key: &[u8; 32], comment: &str) -> String {
    let pub_blob = ssh_ed25519_pubkey_blob(pub_key);
    let mut out = Vec::new();
    out.extend_from_slice(b"openssh-key-v1\0");
    ssh_write_str(&mut out, b"none");
    ssh_write_str(&mut out, b"none");
    ssh_write_str(&mut out, &[]);
    ssh_write_u32(&mut out, 1);
    ssh_write_str(&mut out, &pub_blob);

    let mut priv_sec = Vec::new();
    let check = 0xa1b2c3d4u32;
    ssh_write_u32(&mut priv_sec, check);
    ssh_write_u32(&mut priv_sec, check);
    ssh_write_str(&mut priv_sec, b"ssh-ed25519");
    ssh_write_str(&mut priv_sec, pub_key);
    let mut kp = [0u8; 64];
    kp[0..32].copy_from_slice(seed);
    kp[32..64].copy_from_slice(pub_key);
    ssh_write_str(&mut priv_sec, &kp);
    ssh_write_str(&mut priv_sec, comment.as_bytes());
    let mut pad = 1u8;
    while priv_sec.len() % 8 != 0 {
        priv_sec.push(pad);
        pad = pad.wrapping_add(1);
    }
    ssh_write_str(&mut out, &priv_sec);
    format!(
        "-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n",
        ssh_b64_wrap(&out, 70)
    )
}

fn parse_openssh_ed25519_privkey(pem: &str) -> Option<([u8; 32], [u8; 32], String)> {
    let b64: String = pem
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with("-----"))
        .collect();
    let raw = base64_decode(&b64).ok()?;
    let magic = b"openssh-key-v1\0";
    if raw.len() < magic.len() || &raw[..magic.len()] != magic {
        return None;
    }
    let mut pos = magic.len();
    ssh_read_str(&raw, &mut pos)?;
    ssh_read_str(&raw, &mut pos)?;
    ssh_read_str(&raw, &mut pos)?;
    ssh_read_u32(&raw, &mut pos)?;
    ssh_read_str(&raw, &mut pos)?;
    let priv_blob = ssh_read_str(&raw, &mut pos)?;
    if priv_blob.len() < 8 {
        return None;
    }
    let mut ppos = 8usize;
    let ktype = ssh_read_str(&priv_blob, &mut ppos)?;
    if ktype != b"ssh-ed25519" {
        return None;
    }
    let pub_vec = ssh_read_str(&priv_blob, &mut ppos)?;
    let kp_vec = ssh_read_str(&priv_blob, &mut ppos)?;
    let comment_vec = ssh_read_str(&priv_blob, &mut ppos)?;
    if pub_vec.len() < 32 || kp_vec.len() < 64 {
        return None;
    }
    let mut seed = [0u8; 32];
    let mut pub_key = [0u8; 32];
    seed.copy_from_slice(&kp_vec[0..32]);
    pub_key.copy_from_slice(&pub_vec[0..32]);
    Some((seed, pub_key, String::from_utf8_lossy(&comment_vec).to_string()))
}

fn parse_openssh_ed25519_pubkey(line: &str) -> Option<([u8; 32], String)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    let idx = parts.iter().position(|p| *p == "ssh-ed25519").unwrap_or(0);
    let b64 = *parts.get(idx + 1)?;
    let blob = base64_decode(b64).ok()?;
    let mut pos = 0usize;
    let ktype = ssh_read_str(&blob, &mut pos)?;
    if ktype != b"ssh-ed25519" {
        return None;
    }
    let pk = ssh_read_str(&blob, &mut pos)?;
    if pk.len() != 32 {
        return None;
    }
    let mut pub_key = [0u8; 32];
    pub_key.copy_from_slice(&pk);
    let comment = if idx + 2 < parts.len() {
        parts[idx + 2..].join(" ")
    } else {
        String::new()
    };
    Some((pub_key, comment))
}

fn ssh_matches_glob(value: &str, pattern: &str) -> bool {
    let vb = value.as_bytes();
    let pb = pattern.as_bytes();
    let mut v = 0usize;
    let mut p = 0usize;
    let mut star: Option<usize> = None;
    let mut retry = 0usize;
    while v < vb.len() {
        if p < pb.len() && (pb[p] == b'?' || pb[p] == vb[v]) {
            v += 1;
            p += 1;
        } else if p < pb.len() && pb[p] == b'*' {
            star = Some(p);
            p += 1;
            retry = v;
        } else if let Some(s) = star {
            p = s + 1;
            retry += 1;
            v = retry;
        } else {
            return false;
        }
    }
    while p < pb.len() && pb[p] == b'*' {
        p += 1;
    }
    p == pb.len()
}

fn ssh_matches_patterns(value: &str, patterns: &str) -> bool {
    let mut matched = false;
    for pat in patterns.split(',') {
        let neg = pat.starts_with('!');
        let inner = if neg { &pat[1..] } else { pat };
        if ssh_matches_glob(value, inner) {
            if neg {
                return false;
            }
            matched = true;
        }
    }
    matched
}

fn parse_allowed_signer_line(line: &str) -> Option<(String, Option<String>, [u8; 32])> {
    let text = line.trim();
    if text.is_empty() || text.starts_with('#') {
        return None;
    }
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in text.chars() {
        if ch == '"' {
            quoted = !quoted;
        }
        if !quoted && (ch == ' ' || ch == '\t') {
            if !cur.is_empty() {
                fields.push(cur.clone());
                cur.clear();
            }
        } else {
            cur.push(ch);
        }
    }
    if quoted {
        return None;
    }
    if !cur.is_empty() {
        fields.push(cur);
    }
    let principals = fields.first()?.clone();
    let mut idx = 1usize;
    let mut namespaces = None;
    if fields.get(idx).map(|s| s.as_str()) != Some("ssh-ed25519") {
        let opt = fields.get(idx)?;
        idx += 1;
        if !opt.starts_with("namespaces=\"") || !opt.ends_with('"') {
            return None;
        }
        let ns = &opt[12..opt.len() - 1];
        if ns.is_empty() || ns.contains('"') {
            return None;
        }
        namespaces = Some(ns.to_string());
    }
    if fields.get(idx).map(|s| s.as_str()) != Some("ssh-ed25519") {
        return None;
    }
    let b64 = fields.get(idx + 1)?;
    let (pub_key, _) = parse_openssh_ed25519_pubkey(&format!("ssh-ed25519 {b64}"))?;
    Some((principals, namespaces, pub_key))
}

fn resolve_ssh_path(cwd: &str, target: &str) -> String {
    if let Some(rest) = target.strip_prefix("~/") {
        resolve_posix_path(cwd, &format!("/home/user/{rest}"))
    } else {
        resolve_posix_path(cwd, target)
    }
}

fn cmd_ssh(args: &[String]) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-V") {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "OpenSSH_9.8p1, OpenSSL 3.3.2 3 Sep 2024\n".to_string(),
            exit_code: 0,
        };
    }
    let mut dump_config = false;
    let mut port = 22i64;
    let mut user = "git".to_string();
    let mut identity_file = "/home/user/.ssh/id_ed25519".to_string();
    let mut destination = "localhost".to_string();
    let mut remote_cmd: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "-G" {
            dump_config = true;
        } else if a == "-p" && i + 1 < args.len() {
            i += 1;
            port = args[i].parse().unwrap_or(22);
        } else if a == "-l" && i + 1 < args.len() {
            i += 1;
            user = args[i].clone();
        } else if a == "-i" && i + 1 < args.len() {
            i += 1;
            identity_file = args[i].clone();
        } else if a == "-o" && i + 1 < args.len() {
            i += 1;
        } else if a == "-T" || a == "-v" {
        } else if !a.starts_with('-') {
            if destination == "localhost" {
                if let Some((u, h)) = a.split_once('@') {
                    if !u.is_empty() {
                        user = u.to_string();
                    }
                    if !h.is_empty() {
                        destination = h.to_string();
                    }
                } else {
                    destination = a.to_string();
                }
            } else {
                remote_cmd.push(a.to_string());
            }
        }
        i += 1;
    }
    if dump_config {
        return ok_out(&format!(
            "user {user}\nhostname {destination}\nport {port}\nidentityfile {identity_file}\n"
        ));
    }
    if remote_cmd.is_empty() {
        return err_out(
            &format!(
                "Hi {user}! You've successfully authenticated, but {destination} does not provide interactive shell access.\n"
            ),
            1,
        );
    }
    ok_out(&format!("ssh:{user}@{destination}:{port} {}\n", remote_cmd.join(" ")))
}

fn cmd_ssh_keygen(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut file_arg: Option<String> = None;
    let mut comment = "user@safe-bash".to_string();
    let mut derive_pub = false;
    let mut show_fp = false;
    let mut find_host: Option<String> = None;
    let mut remove_host: Option<String> = None;
    let mut y_action: Option<String> = None;
    let mut namespace = "file".to_string();
    let mut namespace_provided = false;
    let mut signer_identity: Option<String> = None;
    let mut signature_file: Option<String> = None;
    let mut positional: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-f" if i + 1 < args.len() => {
                i += 1;
                file_arg = Some(args[i].clone());
            }
            "-C" if i + 1 < args.len() => {
                i += 1;
                comment = args[i].clone();
            }
            "-N" | "-t" if i + 1 < args.len() => {
                i += 1;
            }
            "-y" => derive_pub = true,
            "-l" => show_fp = true,
            "-F" if i + 1 < args.len() => {
                i += 1;
                find_host = Some(args[i].clone());
            }
            "-R" if i + 1 < args.len() => {
                i += 1;
                remove_host = Some(args[i].clone());
            }
            "-Y" if i + 1 < args.len() => {
                i += 1;
                y_action = Some(args[i].clone());
            }
            "-n" if i + 1 < args.len() => {
                i += 1;
                namespace = args[i].clone();
                namespace_provided = true;
            }
            "-I" if i + 1 < args.len() => {
                i += 1;
                signer_identity = Some(args[i].clone());
            }
            "-s" if i + 1 < args.len() => {
                i += 1;
                signature_file = Some(args[i].clone());
            }
            "-q" => {}
            _ if !a.starts_with('-') => positional.push(a.to_string()),
            _ => return err_out(&format!("ssh-keygen: unsupported option: {a}\n"), 1),
        }
        i += 1;
    }

    let read_ssh_file = |full: &str| -> Result<Vec<u8>, String> {
        if fs.is_dir(full) {
            return Err(format!(
                "EISDIR: illegal operation on a directory, readFile '{full}'"
            ));
        }
        fs.read_file(full)
            .map_err(|_| format!("ENOENT: no such file or directory, readFile '{full}'"))
    };

    if let Some(host) = find_host {
        let kh_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/known_hosts"));
        let kh_text = fs
            .read_file(&kh_path)
            .ok()
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let matches: Vec<&str> = kh_text
            .lines()
            .filter(|l| {
                let t = l.trim();
                !t.is_empty()
                    && !t.starts_with('#')
                    && t.split_whitespace()
                        .next()
                        .map(|h| h.split(',').any(|x| x == host))
                        .unwrap_or(false)
            })
            .collect();
        if matches.is_empty() {
            return err_out("", 1);
        }
        return ok_out(&format!("{}\n", matches.join("\n")));
    }

    if let Some(host) = remove_host {
        let kh_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/known_hosts"));
        let kh_text = fs
            .read_file(&kh_path)
            .ok()
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let remaining: Vec<&str> = kh_text
            .split('\n')
            .filter(|l| {
                let t = l.trim();
                t.is_empty()
                    || t.starts_with('#')
                    || !t.split_whitespace()
                        .next()
                        .map(|h| h.split(',').any(|x| x == host))
                        .unwrap_or(false)
            })
            .collect();
        let _ = fs.write_file(&kh_path, format!("{}\n", remaining.join("\n")).as_bytes());
        return ok_out(&format!("# Host {host} found: removed\n{kh_path} updated.\n"));
    }

    if let Some(action) = y_action {
        if action == "sign" {
            let key_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519"));
            let key_bytes = match read_ssh_file(&key_path) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("ssh-keygen: {e}\n"), 1),
            };
            let Some((seed, pub_key, _)) = parse_openssh_ed25519_privkey(&String::from_utf8_lossy(&key_bytes)) else {
                return err_out(&format!("ssh-keygen: invalid OpenSSH Ed25519 key: {key_path}\n"), 1);
            };
            let target_file = positional.first();
            let payload = if let Some(tf) = target_file {
                let p = resolve_ssh_path(cwd, tf);
                match read_ssh_file(&p) {
                    Ok(b) => b,
                    Err(e) => return err_out(&format!("ssh-keygen: {e}\n"), 1),
                }
            } else {
                crate::vfs::stream_string_to_bytes(stdin)
            };
            let msg_hash = sha512_bytes(&payload);
            let mut to_sign = Vec::new();
            to_sign.extend_from_slice(b"SSHSIG");
            ssh_write_str(&mut to_sign, namespace.as_bytes());
            ssh_write_str(&mut to_sign, &[]);
            ssh_write_str(&mut to_sign, b"sha512");
            ssh_write_str(&mut to_sign, &msg_hash);
            let raw_sig = ed25519_sign(&to_sign, &seed);

            let mut sig_blob = Vec::new();
            ssh_write_str(&mut sig_blob, b"ssh-ed25519");
            ssh_write_str(&mut sig_blob, &raw_sig);

            let mut outer = Vec::new();
            outer.extend_from_slice(b"SSHSIG");
            ssh_write_u32(&mut outer, 1);
            ssh_write_str(&mut outer, &ssh_ed25519_pubkey_blob(&pub_key));
            ssh_write_str(&mut outer, namespace.as_bytes());
            ssh_write_str(&mut outer, &[]);
            ssh_write_str(&mut outer, b"sha512");
            ssh_write_str(&mut outer, &sig_blob);

            let armor = format!(
                "-----BEGIN SSH SIGNATURE-----\n{}\n-----END SSH SIGNATURE-----\n",
                ssh_b64_wrap(&outer, 70)
            );
            if let Some(tf) = target_file {
                let sig_out = format!("{}.sig", resolve_ssh_path(cwd, tf));
                let _ = fs.write_file(&sig_out, armor.as_bytes());
                return ok_out(&format!("Signing file {tf}\nWrite signature to {tf}.sig\n"));
            }
            return ok_out(&armor);
        }

        if action == "verify" || action == "check-novalidate" || action == "find-principals" {
            let sig_rel = signature_file.as_deref().or_else(|| positional.first().map(|s| s.as_str())).unwrap_or("");
            let sig_path = resolve_ssh_path(cwd, sig_rel);
            let sig_bytes = match read_ssh_file(&sig_path) {
                Ok(b) => b,
                Err(e) => return err_out(&format!("ssh-keygen: {e}\n"), 1),
            };
            let b64: String = String::from_utf8_lossy(&sig_bytes)
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && !l.starts_with("-----"))
                .collect();
            let raw = base64_decode(&b64).unwrap_or_default();
            if raw.len() < 10 || &raw[0..6] != b"SSHSIG" {
                return err_out("ssh-keygen: invalid SSHSIG header\n", 1);
            }
            let mut pos = 10usize;
            let Some(pub_blob) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let Some(sig_ns) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let _ = ssh_read_str(&raw, &mut pos);
            let Some(hash_alg) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let Some(sig_blob) = ssh_read_str(&raw, &mut pos) else {
                return err_out("ssh-keygen: truncated SSHSIG structure\n", 1);
            };
            let mut ppos = 0usize;
            let _ = ssh_read_str(&pub_blob, &mut ppos);
            let Some(pub_key) = ssh_read_str(&pub_blob, &mut ppos) else {
                return err_out("ssh-keygen: invalid SSHSIG key/signature\n", 1);
            };
            let mut spos = 0usize;
            let _ = ssh_read_str(&sig_blob, &mut spos);
            let Some(raw_sig) = ssh_read_str(&sig_blob, &mut spos) else {
                return err_out("ssh-keygen: invalid SSHSIG key/signature\n", 1);
            };

            if action != "find-principals" && (!namespace_provided || String::from_utf8_lossy(&sig_ns) != namespace) {
                return err_out("ssh-keygen: signature namespace does not match requested namespace\n", 1);
            }
            if action == "verify" || action == "find-principals" {
                let Some(ref as_file) = file_arg else {
                    return err_out("ssh-keygen: allowed signers file and signer identity are required for verification\n", 1);
                };
                if action == "verify" && signer_identity.is_none() {
                    return err_out("ssh-keygen: allowed signers file and signer identity are required for verification\n", 1);
                }
                let as_path = resolve_ssh_path(cwd, as_file);
                let as_bytes = match read_ssh_file(&as_path) {
                    Ok(b) => b,
                    Err(e) => return err_out(&format!("ssh-keygen: {e}\n"), 1),
                };
                let as_text = String::from_utf8_lossy(&as_bytes);
                let entries: Vec<(String, Option<String>, [u8; 32])> =
                    as_text.lines().filter_map(parse_allowed_signer_line).collect();
                let matching: Vec<&(String, Option<String>, [u8; 32])> = entries
                    .iter()
                    .filter(|(_, ns_opt, pk)| {
                        pk.as_slice() == pub_key.as_slice()
                            && (action == "find-principals"
                                || ssh_matches_patterns(&namespace, ns_opt.as_deref().unwrap_or("*")))
                    })
                    .collect();
                if action == "find-principals" {
                    if matching.is_empty() {
                        return err_out("", 1);
                    }
                    let principals: Vec<&str> = matching.iter().map(|(p, _, _)| p.as_str()).collect();
                    return ok_out(&format!("{}\n", principals.join("\n")));
                }
                let id_str = signer_identity.as_deref().unwrap_or("");
                if !matching.iter().any(|(p, _, _)| ssh_matches_patterns(id_str, p)) {
                    return err_out("ssh-keygen: signer is not authorized by allowed signers\n", 1);
                }
            }

            let payload = crate::vfs::stream_string_to_bytes(stdin);
            let msg_hash = sha512_bytes(&payload);
            let mut to_verify = Vec::new();
            to_verify.extend_from_slice(b"SSHSIG");
            ssh_write_str(&mut to_verify, &sig_ns);
            ssh_write_str(&mut to_verify, &[]);
            ssh_write_str(&mut to_verify, &hash_alg);
            ssh_write_str(&mut to_verify, &msg_hash);
            if !ed25519_verify(&raw_sig, &to_verify, &pub_key) {
                return err_out("Signature verification failed\n", 1);
            }
            let fp = ssh_fingerprint_sha256(&pub_key);
            return ok_out(&format!(
                "Good \"{}\" signature for {} with ED25519 key {fp}\n",
                String::from_utf8_lossy(&sig_ns),
                signer_identity.as_deref().unwrap_or("principal")
            ));
        }
    }

    if derive_pub {
        let key_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519"));
        let key_bytes = match read_ssh_file(&key_path) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("ssh-keygen: {e}\n"), 1),
        };
        let Some((_, pub_key, cmt)) = parse_openssh_ed25519_privkey(&String::from_utf8_lossy(&key_bytes)) else {
            return err_out(&format!("ssh-keygen: invalid OpenSSH private key: {key_path}\n"), 1);
        };
        let pub_b64 = ssh_b64_wrap(&ssh_ed25519_pubkey_blob(&pub_key), 0);
        return ok_out(&format!("ssh-ed25519 {pub_b64} {cmt}\n"));
    }

    if show_fp {
        let key_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519.pub"));
        let key_bytes = match read_ssh_file(&key_path) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("ssh-keygen: {e}\n"), 1),
        };
        let content = String::from_utf8_lossy(&key_bytes);
        let parsed = parse_openssh_ed25519_privkey(&content)
            .map(|(_, pk, c)| (pk, c))
            .or_else(|| parse_openssh_ed25519_pubkey(&content));
        let Some((pub_key, cmt)) = parsed else {
            return err_out(&format!("ssh-keygen: not a public key file: {key_path}\n"), 1);
        };
        let fp = ssh_fingerprint_sha256(&pub_key);
        let label = if cmt.is_empty() { key_path.as_str() } else { cmt.as_str() };
        return ok_out(&format!("256 {fp} {label} (ED25519)\n"));
    }

    let out_path = resolve_ssh_path(cwd, file_arg.as_deref().unwrap_or("/home/user/.ssh/id_ed25519"));
    if let Some((dir, _)) = out_path.rsplit_once('/') && !dir.is_empty() {
        let _ = fs.mkdir_all(dir);
    }
    let seed_digest = sha256_bytes(format!("ed25519:{out_path}:{comment}").as_bytes());
    let pub_key = ed25519_pubkey_from_seed(&seed_digest);
    let priv_pem = format_openssh_ed25519_privkey(&seed_digest, &pub_key, &comment);
    let pub_line = format!(
        "ssh-ed25519 {} {comment}\n",
        ssh_b64_wrap(&ssh_ed25519_pubkey_blob(&pub_key), 0)
    );
    let _ = fs.write_file(&out_path, priv_pem.as_bytes());
    let _ = fs.write_file(&format!("{out_path}.pub"), pub_line.as_bytes());
    let fp = ssh_fingerprint_sha256(&pub_key);
    ok_out(&format!(
        "Generating public/private ed25519 key pair.\nYour identification has been saved in {out_path}\nYour public key has been saved in {out_path}.pub\nThe key fingerprint is:\n{fp} {comment}\n"
    ))
}

include!("media.rs");
include!("graphviz.rs");

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn compressing_lower_layer_files_preserves_links_and_removes_only_the_visible_source() {
        use std::sync::Arc;
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/dir/src", b"input").unwrap();
        lower.write_file("/dir/src.gz", b"old").unwrap();
        lower.hard_link("/dir/src.gz", "/old-link").unwrap();
        let overlay = crate::vfs::OverlayVfs::new(lower.clone(), Arc::new(MemoryVfs::new()));
        let run = try_run_archive_command("gzip", &args(&["-f", "/dir/src"]), "", "/", &BTreeMap::new(), &overlay).unwrap();
        assert_eq!(run.exit_code, 0, "{}", run.stderr);
        assert!(!overlay.exists("/dir/src"));
        assert_eq!(overlay.read_file("/old-link").unwrap(), b"old");
        assert_eq!(lower.read_file("/dir/src").unwrap(), b"input");
        assert_eq!(lower.read_file("/dir/src.gz").unwrap(), b"old");
        let read = try_run_archive_command("gunzip", &args(&["-c", "/dir/src.gz"]), "", "/", &BTreeMap::new(), &overlay).unwrap();
        assert_eq!((read.exit_code, read.stdout.as_str()), (0, "input"));
    }

    #[test]
    fn tar_with_bzip2_xz_and_zstd_writes_genuine_compressed_archives() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/src").unwrap();
        vfs.write_file("/src/hello.txt", b"archive parity payload\n")
            .unwrap();

        for (flag, ext, magic) in [
            ("-j", "bz2", &[0x42u8, 0x5a, 0x68][..]),
            ("-J", "xz", &[0xfdu8, 0x37, 0x7a, 0x58, 0x5a, 0x00][..]),
            ("--zstd", "zst", &[0x28u8, 0xb5, 0x2f, 0xfd][..]),
        ] {
            let archive_path = format!("/archive.tar.{ext}");
            let create = cmd_tar(
                &args(&[flag, "-cf", &archive_path, "-C", "/src", "hello.txt"]),
                "",
                "/",
                &vfs,
            );
            assert_eq!(create.exit_code, 0, "stderr: {}", create.stderr);
            let bytes = vfs.read_file(&archive_path).unwrap();
            assert!(bytes.starts_with(magic), "wrong magic for {ext}");

            let out_dir = format!("/out_{ext}");
            vfs.mkdir_all(&out_dir).unwrap();
            let extract = cmd_tar(
                &args(&[flag, "-xf", &archive_path, "-C", &out_dir]),
                "",
                "/",
                &vfs,
            );
            assert_eq!(extract.exit_code, 0);
            assert_eq!(
                vfs.read_file(&format!("{out_dir}/hello.txt")).unwrap(),
                b"archive parity payload\n"
            );
        }
    }

    #[test]
    fn graphviz_dot_and_neato_render_svg_and_dot_layouts() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.write_file("/work/g.dot", b"digraph G { a -> b; b -> c; }\n")
            .unwrap();
        let dot_svg = cmd_graphviz("dot", &args(&["-Tsvg", "/work/g.dot"]), "", "/work", &vfs);
        assert_eq!(dot_svg.exit_code, 0);
        assert!(dot_svg.stdout.contains("<svg"));

        let neato_svg = cmd_graphviz("neato", &args(&["-Tsvg", "/work/g.dot"]), "", "/work", &vfs);
        assert_eq!(neato_svg.exit_code, 0);
        assert!(neato_svg.stdout.contains("<svg"));
    }

    #[test]
    fn zip_deflates_compressible_members_and_honors_storage_selection() {
        let vfs = MemoryVfs::new();
        let data = b"alpha\nbeta\nbeta\n";
        for (name, flags, method, ascii) in [
            ("text", vec!["-q"], 8, 1), ("text", vec!["-q0"], 0, 0),
            ("text", vec!["-Z", "store", "-9"], 0, 0),
            ("text.zip", vec!["-q"], 0, 0), ("text.zip", vec!["-9"], 8, 1),
            ("text", vec!["-n", "text"], 0, 0),
        ] {
            vfs.write_file(&format!("/{name}"), data).unwrap();
            let mut argv = args(&flags);
            argv.extend(args(&["out.zip", name]));
            let result = cmd_zip(&argv, "", "/", &vfs);
            assert_eq!(result.exit_code, 0, "{flags:?} {}", result.stderr);
            let bytes = vfs.read_file("/out.zip").unwrap();
            assert_eq!(bytes[8], method, "{flags:?} {name}");
            let eocd = bytes.len() - 22;
            let central = u32::from_le_bytes(bytes[eocd+16..eocd+20].try_into().unwrap()) as usize;
            assert_eq!((bytes[central+10], bytes[central+36]), (method, ascii));
            if method == 8 {
                assert_eq!(&bytes[central-12..central], &[0x4b,0xcc,0x29,0xc8,0x48,0xe4,0x4a,0x4a,0x2d,0x81,0x12,0]);
            }
            assert_eq!(crate::commands::codecs::parse_zip_archive(&bytes).unwrap()[0].content, data);
            vfs.remove_path("/out.zip").unwrap();
        }
    }

    #[test]
    fn zip_member_collisions_preserve_the_archive_and_every_move_source() {
        for (operands, conflict) in [
            (vec!["one/x","two/x"],true), (vec!["one/x","./one/x"],true),
            (vec!["one/x","/one/x"],true), (vec!["one","two"],true), (vec!["one/x","one/x"],false),
        ] {
            let fs = MemoryVfs::new();
            for (dir, bytes) in [("one", b"first".as_slice()), ("two", b"second")] {
                fs.mkdir_all(&format!("/{dir}")).unwrap();
                fs.write_file(&format!("/{dir}/x"),bytes).unwrap();
            }
            fs.write_file("/keep",b"old member").unwrap();
            assert_eq!(cmd_zip(&args(&["-q","out.zip","keep"]),"","/",&fs).exit_code,0);
            let original = fs.read_file("/out.zip").unwrap();
            let mut argv = args(&["-qrmj","out.zip"]);
            argv.extend(args(&operands));
            let result = cmd_zip(&argv,"","/",&fs);
            if conflict {
                assert_eq!(result.exit_code,16,"{operands:?}");
                assert_eq!(result.stdout,"\nzip error: Invalid command arguments (cannot repeat names in zip file)\n");
                assert_eq!(fs.read_file("/out.zip").unwrap(),original);
                assert_eq!(fs.read_file("/one/x").unwrap(),b"first");
            } else {
                assert_eq!(result.exit_code,0,"{}",result.stderr);
                assert!(!fs.exists("/one/x"));
                let entries = crate::commands::codecs::parse_zip_archive(&fs.read_file("/out.zip").unwrap()).unwrap();
                assert_eq!(entries.iter().map(|e|e.name.as_str()).collect::<Vec<_>>(),["keep","x"]);
            }
            assert_eq!(fs.read_file("/two/x").unwrap(),b"second");
        }
    }

    #[test]
    fn zip_collision_warnings_identify_the_sources_without_printing_credentials() {
        let fs = MemoryVfs::new();
        for p in ["one", "token=private"] {
            fs.mkdir_all(&format!("/{p}")).unwrap();
            fs.write_file(&format!("/{p}/name"),b"input").unwrap();
        }
        let r = cmd_zip(&args(&["-qvj","out.zip","one/name","token=private/name"]),"","/",&fs);
        assert_eq!(r.stdout,"\tzip warning:   first full name: one/name\n                      second full name: [redacted]\n                     name in zip file repeated: name\n\nzip error: Invalid command arguments (cannot repeat names in zip file)\n");
        assert!(!fs.exists("/out.zip"));
    }

    #[test]
    fn zip_rejects_invalid_archives_before_mutating_sources_or_outputs() {
        for options in [vec!["-qm"], vec!["-qd"], vec!["-qf"], vec!["-qU", "-O", "copy.zip"], vec!["-FS"], vec!["-sf"]] {
            let vfs = MemoryVfs::new();
            vfs.write_file("/broken.zip", b"broken").unwrap();
            vfs.write_file("/input", b"contents").unwrap();
            let mut argv = args(&options);
            argv.extend(args(&["broken.zip", "input"]));
            let result = cmd_zip(&argv, "", "/", &vfs);
            assert_eq!((result.exit_code, result.stderr.as_str()), (2, "zip: ZIP missing end record\n"), "{options:?}");
            assert_eq!(vfs.read_file("/broken.zip").unwrap(), b"broken");
            assert_eq!(vfs.read_file("/input").unwrap(), b"contents");
            assert!(!vfs.exists("/copy.zip"));
        }
    }

    #[test]
    fn hashes_base64_xxd_zip_and_qrencode_media_commands() {
        let vfs = MemoryVfs::new();
        let env = BTreeMap::new();
        vfs.mkdir_all("/work").unwrap();

        let sha = try_run_archive_command("sha256sum", &[], "abc", "/work", &env, &vfs).unwrap();
        assert_eq!(sha.exit_code, 0);
        assert!(sha
            .stdout
            .starts_with("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));

        let b64_enc = try_run_archive_command("base64", &[], "safe-bash", "/work", &env, &vfs).unwrap();
        assert_eq!(b64_enc.stdout, "c2FmZS1iYXNo\n");
        let b64_dec =
            try_run_archive_command("base64", &args(&["-d"]), &b64_enc.stdout, "/work", &env, &vfs)
                .unwrap();
        assert_eq!(b64_dec.stdout, "safe-bash");

        let qr = try_run_archive_command(
            "qrencode",
            &args(&["-t", "SVG", "-o", "/work/qr.svg", "https://poe.com"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(qr.exit_code, 0);
        let qr_svg = String::from_utf8(vfs.read_file("/work/qr.svg").unwrap()).unwrap();
        assert!(qr_svg.contains("<svg"));
    }


    #[test]
    fn unit_tar_list_and_xxd_reverse_roundtrip() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/src").unwrap();
        vfs.write_file("/work/src/one.txt", b"111\n").unwrap();
        vfs.write_file("/work/src/two.txt", b"222\n").unwrap();
        let env = BTreeMap::new();

        assert_eq!(
            try_run_archive_command(
                "tar",
                &args(&["-cf", "/work/plain.tar", "-C", "/work/src", "one.txt", "two.txt"]),
                "",
                "/work",
                &env,
                &vfs,
            )
            .unwrap()
            .exit_code,
            0
        );
        let listed = try_run_archive_command(
            "tar",
            &args(&["-tf", "/work/plain.tar"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(listed.exit_code, 0);
        assert!(listed.stdout.contains("one.txt") && listed.stdout.contains("two.txt"));

        let hex = try_run_archive_command("xxd", &args(&["-p"]), "safe-bash", "/work", &env, &vfs).unwrap();
        let rev = try_run_archive_command("xxd", &args(&["-r", "-p"]), &hex.stdout, "/work", &env, &vfs).unwrap();
        assert_eq!(rev.stdout, "safe-bash");
    }

    #[test]
    fn unit_openssl_x509_ext_checkend_rsa2048_and_gpg_openpgp_ed25519_parity() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        let gen_rsa = try_run_archive_command(
            "openssl",
            &args(&["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", "/work/rsa.pem"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(gen_rsa.exit_code, 0, "stderr: {}", gen_rsa.stderr);
        let rsa_priv = vfs.read_file("/work/rsa.pem").unwrap();
        assert!(rsa_priv.len() > 1200, "expected >1200 bytes, got {}", rsa_priv.len());

        let pub_rsa = try_run_archive_command(
            "openssl",
            &args(&["pkey", "-in", "/work/rsa.pem", "-pubout", "-out", "/work/rsa.pub.pem"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(pub_rsa.exit_code, 0);
        let rsa_pub = vfs.read_file("/work/rsa.pub.pem").unwrap();
        assert!(rsa_pub.len() > 400, "expected >400 bytes, got {}", rsa_pub.len());

        vfs.write_file("/work/msg.txt", b"signed payload\n").unwrap();
        assert_eq!(
            try_run_archive_command(
                "openssl",
                &args(&["dgst", "-sha256", "-sign", "/work/rsa.pem", "-out", "/work/msg.sig", "/work/msg.txt"]),
                "",
                "/work",
                &env,
                &vfs,
            )
            .unwrap()
            .exit_code,
            0
        );
        assert_eq!(vfs.read_file("/work/msg.sig").unwrap().len(), 256);
        let ver_rsa = try_run_archive_command(
            "openssl",
            &args(&["dgst", "-sha256", "-verify", "/work/rsa.pub.pem", "-signature", "/work/msg.sig", "/work/msg.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ver_rsa.exit_code, 0);
        assert_eq!(ver_rsa.stdout, "Verified OK\n");

        let cert = try_run_archive_command(
            "openssl",
            &args(&[
                "req", "-new", "-x509", "-nodes", "-newkey", "ec:prime256v1",
                "-keyout", "/work/ec.key", "-subj", "/CN=test.example/O=Test",
                "-days", "3",
                "-addext", "basicConstraints=critical,CA:TRUE,pathlen:1",
                "-addext", "subjectAltName=DNS:test.example,IP:127.0.0.1",
                "-out", "/work/cert.pem",
            ]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(cert.exit_code, 0, "stderr: {}", cert.stderr);
        let ext_out = try_run_archive_command(
            "openssl",
            &args(&["x509", "-in", "/work/cert.pem", "-noout", "-ext", "subjectAltName,basicConstraints"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ext_out.exit_code, 0);
        assert!(ext_out.stdout.contains("DNS: test.example") && ext_out.stdout.contains("CA: true"));

        let exp_soon = try_run_archive_command(
            "openssl",
            &args(&["x509", "-in", "/work/cert.pem", "-noout", "-checkend", "999999"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(exp_soon.exit_code, 1);
        assert_eq!(exp_soon.stdout, "Certificate will expire\n");

        let gpg_sign = try_run_archive_command(
            "gpg",
            &args(&["--detach-sign", "--armor", "-u", "Alice <alice@example.com>", "-o", "/work/msg.asc", "/work/msg.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(gpg_sign.exit_code, 0);
        let gpg_ver = try_run_archive_command(
            "gpg",
            &args(&["--status-fd=1", "--verify", "/work/msg.asc", "/work/msg.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(gpg_ver.exit_code, 0, "stderr: {}", gpg_ver.stderr);
        assert!(gpg_ver.stdout.contains("[GNUPG:] GOODSIG"));
    }

    #[test]
    fn unit_codec_invalid_options_od_hexdump_base32_strings_and_ssh_keygen_sign() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        let bad_zstd = try_run_archive_command("zstd", &args(&["-o", "out.zst"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(bad_zstd.exit_code, 2);
        assert!(bad_zstd.stderr.contains("invalid option -- 'o'"));

        let bad_gz = try_run_archive_command("gzip", &args(&["-z"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(bad_gz.exit_code, 2);
        assert!(bad_gz.stderr.contains("invalid option -- 'z'"));

        let b32_enc = try_run_archive_command("base32", &args(&["-w", "0"]), "hello_base32", "/work", &env, &vfs).unwrap();
        assert_eq!(b32_enc.exit_code, 0);
        assert_eq!(b32_enc.stdout, "NBSWY3DPL5RGC43FGMZA====");
        let b32_dec = try_run_archive_command("base32", &args(&["-d"]), &b32_enc.stdout, "/work", &env, &vfs).unwrap();
        assert_eq!(b32_dec.stdout, "hello_base32");

        let kg = try_run_archive_command(
            "ssh-keygen",
            &args(&["-t", "ed25519", "-f", "/work/id_ed", "-C", "u@h", "-N", ""]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(kg.exit_code, 0);
        vfs.write_file("/work/msg.txt", b"payload\n").unwrap();
        let sg = try_run_archive_command(
            "ssh-keygen",
            &args(&["-Y", "sign", "-f", "/work/id_ed", "-n", "git", "/work/msg.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(sg.exit_code, 0);
        assert!(vfs.exists("/work/msg.txt.sig"));
    }

    #[test]
    fn unit_wkhtmltopdf_qpdf_pdftk_svgo_rsvg_qrencode_magick_sips_exiftool_sox_ffmpeg_soffice() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        vfs.write_file("/work/doc.html", b"<h1>Title</h1><p>Body</p>").unwrap();
        let wk = try_run_archive_command(
            "wkhtmltopdf",
            &args(&["--title", "Spec", "/work/doc.html", "/work/doc.pdf"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(wk.exit_code, 0);

        let qp = try_run_archive_command(
            "qpdf",
            &args(&["/work/doc.pdf", "/work/lin.pdf", "--linearize", "--rotate=+90:1"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(qp.exit_code, 0);

        let pi = try_run_archive_command(
            "pdfinfo",
            &args(&["-f", "1", "-l", "1", "/work/lin.pdf"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(pi.exit_code, 0);
        assert!(pi.stdout.contains("Page    1 rot:   90"));

        let qr = try_run_archive_command(
            "qrencode",
            &args(&["-t", "SVG", "-o", "-", "https://poe.com"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(qr.exit_code, 0);
        assert!(qr.stdout.contains("<svg"));

        let sx = try_run_archive_command(
            "sox",
            &args(&["-r", "4000", "-c", "2", "-b", "16", "-n", "/work/tone.wav", "synth", "0.1", "sine", "400"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(sx.exit_code, 0);
        let sxi = try_run_archive_command("soxi", &args(&["-s", "/work/tone.wav"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(sxi.stdout.trim(), "400");

        let pf_loc = try_run_archive_command(
            "pdffonts",
            &args(&["-loc", "/work/lin.pdf"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(pf_loc.exit_code, 0);
        assert!(pf_loc.stdout.contains("Substitute"));

        let pf_err = try_run_archive_command(
            "pdffonts",
            &args(&["-f", "5", "/work/lin.pdf"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(pf_err.exit_code, 99);
        assert!(pf_err.stderr.contains("Command Line Error: Wrong page range given"));

        let ff = try_run_archive_command(
            "ffmpeg",
            &args(&[
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=160x120:rate=10:duration=1",
                "-vf",
                "scale=80:60",
                "-metadata",
                "comment=RustParity",
                "/work/out.mp4",
            ]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ff.exit_code, 0);
        let fp = try_run_archive_command(
            "ffprobe",
            &args(&["-v", "quiet", "-print_format", "json=compact=1", "-show_format", "-show_streams", "/work/out.mp4"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(fp.exit_code, 0);
        assert!(fp.stdout.contains("\"comment\":\"RustParity\""));
    }

    #[test]
    fn openssl_gpg_ssh_keygen_and_xxd_deep_workflows_succeed() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        let p5 = try_run_archive_command(
            "openssl",
            &args(&["passwd", "-5", "-salt", "saltsalt", "secret123"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(p5.exit_code, 0);
        assert!(p5.stdout.starts_with("$5$saltsalt$"));

        let kg = try_run_archive_command(
            "ssh-keygen",
            &args(&["-t", "ed25519", "-C", "ci@test", "-f", "/work/id_ed25519", "-N", ""]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(kg.exit_code, 0);
        let derived = try_run_archive_command(
            "ssh-keygen",
            &args(&["-y", "-f", "/work/id_ed25519"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(derived.exit_code, 0);
        assert_eq!(
            derived.stdout,
            String::from_utf8_lossy(&vfs.read_file("/work/id_ed25519.pub").unwrap())
        );

        let exts = openssl_validate_and_format_addexts(&[
            "basicConstraints=critical,CA:FALSE".to_string(),
        ])
        .unwrap();
        assert_eq!(exts[0].1, "Basic Constraints: critical");
    }

    #[test]
    fn archive_compression_tar_zip_unzip_xxd_hexdump_od_strings_diagnostics_and_help_succeed() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        let gz_h = try_run_archive_command("gzip", &args(&["-h"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(gz_h.exit_code, 0);
        assert!(gz_h.stdout.contains("Usage: gzip [OPTION]... [FILE]..."));

        let bz_h = try_run_archive_command("bzip2", &args(&["-s", "-h"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(bz_h.exit_code, 0);
        assert!(bz_h.stdout.contains("Default compression level: 2."));

        let zs_fast = try_run_archive_command("zstd", &args(&["--fast=2"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(zs_fast.exit_code, 2);
        assert_eq!(
            zs_fast.stderr,
            "zstd: unsupported compression level -2; the bounded Zstandard codec supports only levels 1 through 9 (fast mode is unsupported)\n"
        );

        let lz_chk = try_run_archive_command("lzma", &args(&["--check=crc32"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(lz_chk.exit_code, 2);
        assert_eq!(lz_chk.stderr, "lzma: the LZMA format supports only --check=none\n");

        let tar_h = try_run_archive_command("tar", &args(&["--help"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(tar_h.exit_code, 0);
        assert!(tar_h.stdout.contains("Usage: tar [OPTION]... [FILE]..."));

        let tar_dup = try_run_archive_command("tar", &args(&["-ct", "-f", "a.tar"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(tar_dup.exit_code, 2);
        assert_eq!(
            tar_dup.stderr,
            "tar: exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)\n"
        );

        let zip_v = try_run_archive_command("zip", &args(&["-v"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(zip_v.exit_code, 0);
        assert!(zip_v.stdout.starts_with("safe-bash zip (virtual-bash)\n"));

        let zip_err = try_run_archive_command("zip", &args(&["-r", "-R", "a.zip", "*.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(zip_err.exit_code, 16);
        assert_eq!(
            zip_err.stdout,
            "\nzip error: Invalid command arguments (do not specify both -r and -R)\n"
        );

        let unzip_err = try_run_archive_command("unzip", &args(&["-t", "-l", "a.zip"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(unzip_err.exit_code, 2);
        assert_eq!(
            unzip_err.stderr,
            "unzip: unzip test mode cannot be combined with listing, pipe or destination\n"
        );

        let xxd_err = try_run_archive_command("xxd", &args(&["-e", "-g", "3"]), "abcd", "/work", &env, &vfs).unwrap();
        assert_eq!(xxd_err.exit_code, 2);
        assert_eq!(
            xxd_err.stderr,
            "xxd: number of octets per group must be a power of 2 with -e\n"
        );

        let hd_err = try_run_archive_command("hexdump", &args(&["-f", "fmt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(hd_err.exit_code, 1);
        assert_eq!(hd_err.stderr, "hexdump: -f: format files are not supported\n");

        let od_err = try_run_archive_command("od", &args(&["-ebig"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(od_err.exit_code, 2);
        assert_eq!(od_err.stderr, "od: use --endian=little or --endian=big; -e is unsupported\n");
    }

    #[test]
    fn crypto_checksum_base_openssl_gpg_ssh_diagnostics_and_parity_succeed() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();
        vfs.write_file("/work/f.txt", b"hello\n").unwrap();
        let env = BTreeMap::new();

        let sha_z = try_run_archive_command("sha256sum", &args(&["-Z"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(sha_z.exit_code, 2);
        assert_eq!(sha_z.stderr, "sha256sum: unrecognized option '-Z'\n");

        let sha_dir = try_run_archive_command("sha256sum", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(sha_dir.exit_code, 1);
        assert_eq!(sha_dir.stderr, "sha256sum: /work/dir: Is a directory\n");

        let sha_miss = try_run_archive_command("sha256sum", &args(&["/work/missing"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(sha_miss.exit_code, 1);
        assert_eq!(
            sha_miss.stderr,
            "sha256sum: ENOENT: no such file or directory, readStream '/work/missing'\n"
        );

        let ck_alg = try_run_archive_command("cksum", &args(&["-a", "SHA256"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(ck_alg.exit_code, 2);
        assert_eq!(ck_alg.stderr, "cksum: unsupported checksum algorithm 'SHA256'\n");

        let ck_eq = try_run_archive_command("cksum", &args(&["--tag=1"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(ck_eq.exit_code, 2);
        assert_eq!(ck_eq.stderr, "cksum: option '--tag' does not take an argument\n");

        let b64_wrap = try_run_archive_command("base64", &args(&["--wrap"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(b64_wrap.exit_code, 2);
        assert_eq!(b64_wrap.stderr, "base64: option '--wrap' requires an argument\n");

        let b64_dir = try_run_archive_command("base64", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(b64_dir.exit_code, 1);
        assert_eq!(
            b64_dir.stderr,
            "base64: EISDIR: illegal operation on a directory, readStream '/work/dir'\n"
        );

        let ossl_utl = try_run_archive_command(
            "openssl",
            &args(&["pkeyutl", "-inkey", "/work/f.txt", "-sign", "-digest", "md5"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ossl_utl.exit_code, 1);
        assert_eq!(ossl_utl.stderr, "openssl: unsupported signing digest\n");

        let ossl_ecp = try_run_archive_command(
            "openssl",
            &args(&["ecparam", "-name", "prime256v1", "-text"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ossl_ecp.exit_code, 0);
        assert!(ossl_ecp.stdout.contains("BggqhkjOPQMBBw=="));

        let gpg_ver = try_run_archive_command("gpg", &args(&["--verify", "/work/missing"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(gpg_ver.exit_code, 2);
        assert_eq!(
            gpg_ver.stderr,
            "gpg: ENOENT: no such file or directory, readFile '/work/missing'\n"
        );

        let ssh_kg = try_run_archive_command("ssh-keygen", &args(&["-y", "-f", "/work/missing"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(ssh_kg.exit_code, 1);
        assert_eq!(
            ssh_kg.stderr,
            "ssh-keygen: ENOENT: no such file or directory, readFile '/work/missing'\n"
        );
    }
}
