use super::{Chapter, Error, InputTime, resolve_posix_path};
use crate::vfs::dirname_posix_path;

pub(super) struct File {
    pub path: String,
    pub cut: InputTime,
    pub duration: Option<f64>,
    pub options: Vec<(String, String)>,
}

fn space(c: char) -> bool { matches!(c, ' ' | '\t' | '\r' | '\n') }

fn word<'a>(line: &mut &'a str) -> &'a str {
    *line = line.trim_start_matches(space);
    let end = line.find(space).unwrap_or(line.len());
    let value = &line[..end];
    *line = &line[end..];
    value
}

fn filename(line: &str) -> String {
    let mut chars = line.trim_start_matches(space).chars();
    let mut value = String::new();
    let mut protected = 0;
    while let Some(c) = chars.next() {
        if space(c) { break; }
        match c {
            '\\' => {
                value.push(chars.next().unwrap_or(c));
                protected = value.len();
            }
            '\'' => {
                for c in chars.by_ref() {
                    if c == '\'' { protected = value.len(); break; }
                    value.push(c);
                }
            }
            _ => value.push(c),
        }
    }
    while value.len() > protected && value.ends_with(space) { value.pop(); }
    value
}

fn duration(value: &str) -> Result<i64, i32> {
    let (value, divisor) = if let Some(s) = value.strip_suffix("ms") { (s, 1_000) }
        else if let Some(s) = value.strip_suffix("us") { (s, 1_000_000) }
        else { (value.strip_suffix('s').unwrap_or(value), 1) };
    let negative = value.starts_with('-');
    let value = value.strip_prefix('-').unwrap_or(value);
    if value.starts_with('+') && value.contains(':') { return Err(234); }
    let value = value.strip_prefix('+').unwrap_or(value);
    let count = value.split(':').count();
    if count > 3 { return Err(234); }
    let mut micros = 0i128;
    for (i, part) in value.split(':').enumerate() {
        let (whole, fraction) = part.split_once('.').unwrap_or((part, ""));
        if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit())
            || !fraction.bytes().all(|b| b.is_ascii_digit())
            || i + 1 != count && part.contains('.') { return Err(234); }
        let whole_value = whole.parse::<i128>().map_err(|_| 222)?;
        if count > 1 && (i > 0 || count == 2) && (whole.len() > 2 || whole_value >= 60) { return Err(234); }
        let digits = fraction.len().min(6);
        let fraction = if digits == 0 { 0 } else { fraction[..digits].parse::<i128>().map_err(|_| 222)? * 10i128.pow(6 - digits as u32) };
        micros = micros.checked_mul(60).and_then(|n| n.checked_add(whole_value.checked_mul(1_000_000)?)).and_then(|n| n.checked_add(fraction)).ok_or(222)?;
    }
    micros /= divisor;
    if negative { micros = -micros; }
    let micros = i64::try_from(micros).map_err(|_| 222)?;
    if micros == i64::MIN { return Err(222); }
    Ok(micros)
}

fn chapter_id(value: &str) -> i64 {
    let negative = value.starts_with('-');
    let value = value.strip_prefix(['-', '+']).unwrap_or(value);
    let (digits, radix) = if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) { (hex, 16) }
        else { (value, if value.starts_with('0') { 8 } else { 10 }) };
    let mut n = 0u64;
    for digit in digits.chars().map_while(|c| c.to_digit(radix)) {
        n = n.saturating_mul(u64::from(radix)).saturating_add(u64::from(digit));
    }
    if negative { -(n.min(i64::MAX as u64) as i64) - i64::from(n > i64::MAX as u64) }
    else { n.min(i64::MAX as u64) as i64 }
}

pub(super) fn parse(text: &str, path: &str, safe: bool, mut limit: usize, diagnostics: &mut String) -> Result<(Vec<File>, Vec<Chapter>), Error> {
    let dir = dirname_posix_path(path);
    let mut files: Vec<File> = Vec::new();
    let mut chapters: Vec<Chapter> = Vec::new();
    let mut rest = text;
    let lines = std::iter::from_fn(|| {
        if rest.is_empty() { return None; }
        let end = rest.find(['\r', '\n', '\0']).unwrap_or(rest.len());
        let line = &rest[..end];
        rest = if rest[end..].starts_with("\r\n") { &rest[end+2..] }
            else { &rest[(end+1).min(rest.len())..] };
        Some(line)
    });
    for (n, mut line) in lines.enumerate() {
        let keyword = word(&mut line);
        if keyword.is_empty() || keyword.starts_with('#') { continue; }
        let error = |message| Error { message: format!("Line {}: {message}", n + 1), status: 183 };
        match keyword {
            "ffconcat" => {
                if word(&mut line) != "version" || word(&mut line) != "1.0" { return Err(error("invalid version".into())); }
            }
            "file" => {
                let name = filename(line);
                if name.is_empty() { return Err(error("string required".into())); }
                if safe && name.split('/').any(|part| part.is_empty() || part.starts_with('.') || !part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))) {
                    return Err(Error {message: format!("Unsafe file name '{name}'"), status: 255});
                }
                let name = if name.starts_with(['#', '?']) { format!("{path}{name}") }
                    else { resolve_posix_path(&dir, name.strip_prefix("file:").unwrap_or(&name)) };
                limit = limit.checked_sub(name.len() + size_of::<File>()).ok_or("concat manifest exceeds memory budget")?;
                files.push(File {path: name, cut: InputTime::default(), duration: None, options: Vec::new()});
            }
            "inpoint" | "outpoint" | "duration" => {
                let Some(file) = files.last_mut() else { return Err(error(format!("{keyword} without file"))); };
                let value = word(&mut line);
                let value = duration(value).map_err(|status| Error {status, ..error(format!("invalid duration '{value}'"))})? as f64 / 1_000_000.;
                match keyword {
                    "inpoint" => file.cut.start = Some(value),
                    "outpoint" => file.cut.to = Some(value),
                    _ => file.duration = Some(value),
                }
            }
            "option" if safe => return Err(error("option not allowed if safe".into())),
            "option" => {
                let Some(file) = files.last_mut() else { return Err(error("option without file".into())); };
                let key = word(&mut line);
                let value = filename(line);
                if value.is_empty() { return Err(error("string required".into())); }
                limit = limit.checked_sub(key.len() + value.len() + size_of::<(String, String)>()).ok_or("concat options exceed memory budget")?;
                if let Some((_, old)) = file.options.iter_mut().find(|(k, _)| k == key) { *old = value; }
                else { file.options.push((key.to_owned(), value)); }
            }
            "chapter" => {
                let id = chapter_id(word(&mut line));
                let mut times = [0; 2];
                for time in &mut times {
                    let value = word(&mut line);
                    *time = duration(value).map_err(|status| Error {status, ..error(format!("invalid duration '{value}'"))})?;
                }
                let [start, end] = times;
                if start > end {
                    let message = format!("Chapter end time {end} before start {start}");
                    if files.is_empty() { return Err(Error {message, status: 183}); }
                    if diagnostics.len() + message.len() + 1 > limit { return Err("concat diagnostics exceed memory budget".into()); }
                    diagnostics.push_str(&message);
                    diagnostics.push('\n');
                    // Native concat returns a positive error from chapter creation,
                    // ending parsing but keeping any files already read.
                    break;
                }
                let chapter = Chapter { id, scale: 1_000_000, start, end, title: None };
                if let Some(old) = chapters.iter_mut().find(|c| c.id == id) { *old = chapter; }
                else {
                    limit = limit.checked_sub(size_of::<Chapter>()).ok_or("concat chapters exceed memory budget")?;
                    chapters.push(chapter);
                }
            }
            _ => return Err(error(format!("unknown keyword '{keyword}'"))),
        }
    }
    if files.is_empty() { return Err("Invalid data found when processing input".into()); }
    for file in &files {
        let cut = file.cut;
        if cut.start.zip(cut.to).is_some_and(|(start, end)| end < start) {
            return Err(Error {message: "outpoint must not precede inpoint".into(), status: 183});
        }
    }
    let mut end = 0.;
    for file in &files {
        let Some(span) = file.duration.or_else(|| file.cut.start.zip(file.cut.to).map(|(start, end)| end - start)) else { break; };
        end += span;
        if !(0. ..= i64::MAX as f64 / 1_000_000.).contains(&end) {
            return Err("Invalid data found when processing input".into());
        }
    }
    Ok((files, chapters))
}
