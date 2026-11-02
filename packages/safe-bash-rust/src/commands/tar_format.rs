use super::TarEntry;
use std::fmt::Write;

fn split_name(name: &str) -> Option<(&str, &str)> {
    if !name.is_ascii() || name.contains('\0') {
        return None;
    }
    if name.len() <= 100 {
        return Some((name, ""));
    }
    let (i, _) = name
        .rmatch_indices('/')
        .find(|(i, _)| (1..=155).contains(i) && (1..=100).contains(&(name.len() - i - 1)))?;
    Some((&name[i + 1..], &name[..i]))
}

pub(super) fn display(path: &str) -> String {
    let mut out = String::new();
    for c in path.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            '\0'..='\x1f' | '\x7f' => write!(out, "\\{:03o}", c as u32).unwrap(),
            _ => out.push(c),
        }
    }
    out
}

fn record(records: &mut String, key: &str, value: &str) {
    let payload = key.len() + value.len() + 3;
    let mut len = payload + 1;
    loop {
        let next = payload + len.ilog10() as usize + 1;
        if len == next {
            break;
        }
        len = next;
    }
    writeln!(records, "{len} {key}={value}").unwrap();
}

fn decimal_time(time: f64) -> String {
    // At nine decimal places a binary float is exactly halfway iff its
    // reduced denominator is 1024. JS toFixed rounds these away from zero.
    let fraction = time.abs().fract();
    if (fraction * 1024.) % 2. == 1. {
        let sign = if time < 0. { "-" } else { "" };
        let nanos = (fraction * 1e9).round() as u32;
        return format!("{sign}{:.0}.{nanos:09}", time.abs().trunc())
            .trim_end_matches('0')
            .to_owned();
    }
    format!("{time:.9}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

fn header(
    (name, prefix): (&str, &str),
    link: &str,
    kind: u8,
    mode: u32,
    owner: [u32; 2],
    mtime: u64,
    size: usize,
) -> [u8; 512] {
    let mut h = [0; 512];
    h[..name.len()].copy_from_slice(name.as_bytes());
    h[345..345 + prefix.len()].copy_from_slice(prefix.as_bytes());
    h[157..157 + link.len()].copy_from_slice(link.as_bytes());
    h[100..107].copy_from_slice(format!("{:07o}", mode & 0o7777).as_bytes());
    h[108..115].copy_from_slice(format!("{:07o}", owner[0]).as_bytes());
    h[116..123].copy_from_slice(format!("{:07o}", owner[1]).as_bytes());
    h[124..135].copy_from_slice(format!("{size:011o}").as_bytes());
    h[136..147].copy_from_slice(format!("{mtime:011o}").as_bytes());
    h[148..156].fill(b' ');
    h[156] = kind;
    h[257..265].copy_from_slice(b"ustar\x0000");
    h[329..336].fill(b'0');
    h[337..344].fill(b'0');
    let sum: u32 = h.iter().map(|&b| u32::from(b)).sum();
    h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
    h
}

pub(super) fn serialize(entries: &[TarEntry], pax: bool) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    write_members(&mut out, entries, pax)?;
    out.resize(out.len() + 1024, 0);
    Ok(out)
}

pub(super) fn write_members(
    out: &mut Vec<u8>,
    entries: &[TarEntry],
    pax: bool,
) -> Result<(), String> {
    for e in entries {
        let mut records = String::new();
        let names = split_name(&e.name).unwrap_or_else(|| {
            record(&mut records, "path", &e.name);
            ("PaxEntry", "")
        });
        let link = if e.linkname.len() > 100 || !e.linkname.is_ascii() || e.linkname.contains('\0')
        {
            record(&mut records, "linkpath", &e.linkname);
            "PaxLink"
        } else {
            &e.linkname
        };
        let mut owner = [e.uid, e.gid];
        for (id, key) in owner.iter_mut().zip(["uid", "gid"]) {
            if *id > 0o7777777 {
                record(&mut records, key, &id.to_string());
                *id = 0;
            }
        }
        let size = e.content.len();
        let header_size = if size as u64 > 0o77777777777 {
            record(&mut records, "size", &size.to_string());
            0
        } else {
            size
        };
        let mtime = if pax { e.mtime } else { e.mtime.floor() };
        if !mtime.is_finite() || mtime.abs() > 8.64e12 {
            return Err("invalid source mtime".into());
        }
        let mtime = if mtime.fract() != 0. || !(0.0..=0o77777777777_u64 as f64).contains(&mtime) {
            record(&mut records, "mtime", &decimal_time(mtime));
            0
        } else {
            mtime as u64
        };
        if pax && let Some(t) = e.atime {
            if !t.is_finite() || t.abs() > 8.64e12 {
                return Err("invalid source atime".into());
            }
            record(&mut records, "atime", &decimal_time(t));
        }
        if !records.is_empty() {
            if !pax {
                let message = format!("metadata requires PAX format: {}", display(&e.name));
                let clipped = String::from_utf16_lossy(
                    &message.encode_utf16().take(1024).collect::<Vec<_>>(),
                );
                return Err(display(&clipped));
            }
            if records.len() > 65536 {
                return Err("PAX header byte limit exceeded".into());
            }
            out.extend_from_slice(&header(
                ("PaxHeader", ""),
                "",
                b'x',
                0o644,
                owner,
                mtime,
                records.len(),
            ));
            out.extend_from_slice(records.as_bytes());
            out.resize(out.len().next_multiple_of(512), 0);
        }
        out.extend_from_slice(&header(
            names,
            link,
            e.typeflag,
            e.mode,
            owner,
            mtime,
            header_size,
        ));
        out.extend_from_slice(&e.content);
        out.resize(out.len().next_multiple_of(512), 0);
    }
    Ok(())
}

fn number(field: &[u8], signed: bool) -> Result<i64, &'static str> {
    let mut n: i128 = 0;
    if field[0] & 0x80 != 0 {
        n = i128::from(field[0] & 0x7f);
        for &b in &field[1..] {
            n = n * 256 + i128::from(b);
        }
        if field[0] & 0x40 != 0 {
            n -= 1_i128 << (field.len() * 8 - 1);
        }
    } else {
        let padding = |&b: &u8| b == 0 || b == b' ';
        if let Some(start) = field.iter().position(|b| !padding(b)) {
            let end = field.iter().rposition(|b| !padding(b)).unwrap();
            for &b in &field[start..=end] {
                if !(b'0'..=b'7').contains(&b) {
                    return Err("invalid octal numeric field");
                }
                n = n * 8 + i128::from(b - b'0');
            }
        }
    }
    if n.abs() >= 1 << 53 || (!signed && n < 0) {
        return Err("invalid or oversized numeric field");
    }
    Ok(n as i64)
}

fn text(bytes: &[u8]) -> Result<&str, &'static str> {
    std::str::from_utf8(bytes).map_err(|_| "invalid UTF-8 archive name or metadata")
}

fn read_pax<'a>(
    mut data: &'a [u8],
    fields: &mut std::collections::BTreeMap<&'a str, &'a str>,
) -> Result<(), String> {
    while !data.is_empty() {
        let space = data
            .iter()
            .take(17)
            .position(|&b| b == b' ')
            .ok_or("invalid PAX record length")?;
        if space == 0 || data[0] == b'0' || !data[..space].iter().all(u8::is_ascii_digit) {
            return Err("invalid PAX record length".into());
        }
        let length = text(&data[..space])?
            .parse::<usize>()
            .map_err(|_| "invalid PAX record framing")?;
        let record = data
            .get(space + 1..length)
            .filter(|r| r.len() >= 3)
            .and_then(|r| r.strip_suffix(b"\n"))
            .ok_or("invalid PAX record framing")?;
        data = &data[length..];
        let eq = record
            .iter()
            .position(|&b| b == b'=')
            .ok_or("invalid PAX key/value")?;
        let key = text(&record[..eq])?;
        if key.is_empty() || key.contains(['\0', '\n']) {
            return Err("invalid PAX key/value".into());
        }
        if matches!(key, "SCHILY.fflags" | "LIBARCHIVE.creationtime")
            || ["LIBARCHIVE.xattr.", "SCHILY.xattr."]
                .iter()
                .any(|p| key.strip_prefix(p).is_some_and(|s| !s.is_empty()))
        {
            continue;
        }
        if !matches!(
            key,
            "path"
                | "linkpath"
                | "size"
                | "uid"
                | "gid"
                | "mtime"
                | "atime"
                | "ctime"
                | "uname"
                | "gname"
                | "comment"
                | "charset"
                | "hdrcharset"
        ) {
            return Err(format!("unsupported PAX keyword: {key}"));
        }
        let value = text(&record[eq + 1..])?;
        if value.contains('\0') {
            return Err("invalid PAX key/value".into());
        }
        if key == "hdrcharset" && !matches!(value, "" | "ISO-IR 10646 2000 UTF-8") {
            return Err("unsupported PAX header charset".into());
        }
        fields.insert(key, value);
    }
    Ok(())
}

// Copy whole records, including local metadata and padding. Never regenerate an
// existing member: its header can carry fields our writer does not produce.
pub(super) fn copy_members(
    data: &[u8],
    ignore_zeros: bool,
    out: &mut Vec<u8>,
    mut keep: impl FnMut(&str, Option<f64>) -> bool,
) -> Result<(), String> {
    if data.starts_with(b"\x1f\x8b") || data.starts_with(b"BZh") || data.starts_with(b"\xfd7zXZ\0")
    {
        return Err("cannot modify compressed archives".into());
    }
    read_members(data, ignore_zeros, true, |member, raw| {
        if keep(member.name, member.mtime) {
            out.extend_from_slice(raw.ok_or("archive changed during preparation")?);
        }
        Ok(())
    })
}

pub(super) struct Member<'a> {
    pub name: &'a str,
    pub linkname: &'a str,
    pub typeflag: u8,
    pub mode: u32,
    pub uid: Option<u64>,
    pub gid: Option<u64>,
    pub mtime: Option<f64>,
    pub size: u64,
    pub content: &'a [u8],
}

pub(super) fn read_members(
    data: &[u8],
    ignore_zeros: bool,
    mutation: bool,
    mut visit: impl FnMut(Member<'_>, Option<&[u8]>) -> Result<(), String>,
) -> Result<(), String> {
    let (mut start, mut pos) = (0, 0);
    let mut fields = std::collections::BTreeMap::new();
    let mut global = std::collections::BTreeMap::new();
    let (mut long_name, mut long_link) = (None, None);
    loop {
        if ignore_zeros && pos == data.len() && pos != 0 {
            break;
        }
        let block = data
            .get(pos..)
            .and_then(|r| r.get(..512))
            .ok_or("truncated archive")?;
        pos += 512;
        if block.iter().all(|&b| b == 0) {
            if ignore_zeros {
                if start == pos - 512 {
                    start = pos;
                }
                continue;
            }
            let second = data[pos..].get(..512).ok_or("truncated archive")?;
            if second.iter().any(|&b| b != 0) {
                return Err("missing second end-of-archive block".into());
            }
            if start != pos - 512 {
                return Err("orphan extended header at end of archive".into());
            }
            let trailing = &data[pos + 512..];
            if trailing.iter().any(|&b| b != 0) {
                return Err(
                    "nonzero trailing archive data or concatenated archive is unsupported".into(),
                );
            }
            if !trailing.len().is_multiple_of(512) {
                return Err("truncated archive trailing record".into());
            }
            return Ok(());
        }
        let expected = number(&block[148..156], false)?;
        let sum: i64 = block[..148]
            .iter()
            .chain(&block[156..])
            .map(|&b| i64::from(b))
            .sum();
        if sum + 8 * 32 != expected {
            return Err("header checksum mismatch".into());
        }
        let posix = &block[257..265] == b"ustar\x0000";
        if !posix && &block[257..265] != b"ustar  \0" {
            return Err(
                "unsupported archive format (expected USTAR, PAX, or GNU basic headers)".into(),
            );
        }
        let mode = number(&block[100..108], false)?;
        number(&block[329..337], false)?;
        number(&block[337..345], false)?;
        if mode > 0o7777 {
            return Err("invalid archive permission bits".into());
        }
        let mut kind = block[156];
        if mutation && kind == b'g' {
            return Err("global PAX headers are unsupported for archive mutation".into());
        }
        if matches!(kind, b'x' | b'g' | b'L' | b'K') {
            let size = usize::try_from(number(&block[124..136], false)?)
                .map_err(|_| "truncated archive")?;
            let body = data[pos..].get(..size).ok_or("truncated archive")?;
            pos += size;
            let padding = (512 - size % 512) % 512;
            if padding > data.len() - pos {
                return Err("truncated archive body".into());
            }
            pos += padding;
            if kind == b'g' {
                read_pax(body, &mut global)?;
                if start == pos - size - padding - 512 {
                    start = pos;
                }
            } else if kind == b'x' {
                read_pax(body, &mut fields)?;
            } else {
                let name = text(
                    body.strip_suffix(&[0])
                        .ok_or("invalid GNU long-name record")?,
                )?;
                if name.is_empty() || name.contains('\0') {
                    return Err("invalid empty, NUL, or non-Unicode path".into());
                }
                if kind == b'L' {
                    long_name = Some(name);
                } else {
                    long_link = Some(name);
                }
            }
            continue;
        }
        for (&key, &value) in &global {
            fields.entry(key).or_insert(value);
        }
        for (&key, &value) in &fields {
            if value.is_empty() {
                continue;
            }
            let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
            if matches!(key, "size" | "uid" | "gid")
                && !(digits(value) && value.parse::<u64>().is_ok_and(|n| n < 1 << 53))
            {
                return Err(format!("invalid PAX {key}"));
            }
            if matches!(key, "mtime" | "ctime" | "atime") {
                let s = value.strip_prefix('-').unwrap_or(value);
                if !s
                    .split_once('.')
                    .map_or_else(|| digits(s), |(a, b)| digits(a) && digits(b))
                    || !value.parse::<f64>().is_ok_and(|n| n.abs() <= 8.64e12)
                {
                    return Err(format!("invalid PAX {key}"));
                }
            }
        }
        let string =
            |range: std::ops::Range<usize>| text(block[range].split(|&b| b == 0).next().unwrap());
        let prefixed;
        let name = if let Some(s) = fields.get("path").copied().or(long_name.take()) {
            s
        } else {
            let raw = string(0..100)?;
            let prefix = if posix { string(345..500)? } else { "" };
            if prefix.is_empty() {
                raw
            } else {
                prefixed = format!("{prefix}/{raw}");
                &prefixed
            }
        };
        if name.is_empty() {
            return Err("missing effective path".into());
        }
        let link = match fields.get("linkpath").copied().or(long_link.take()) {
            Some(s) => s,
            None => string(157..257)?,
        };
        if matches!(kind, b'1' | b'2') && link.is_empty() {
            return Err("missing effective linkpath".into());
        }
        let numeric = |key, range, signed| -> Result<Option<f64>, &'static str> {
            match fields.get(key) {
                Some(&"") => Ok(None),
                Some(s) => Ok(s.parse().ok()),
                None => Ok(Some(number(&block[range], signed)? as f64)),
            }
        };
        let size = numeric("size", 124..136, false)?.ok_or("missing effective size")? as u64;
        let uid = numeric("uid", 108..116, false)?.map(|n| n as u64);
        let gid = numeric("gid", 116..124, false)?.map(|n| n as u64);
        let mtime = numeric("mtime", 136..148, true)?;
        if mtime.is_some_and(|n| n.abs() > 8.64e12) {
            return Err("archive timestamp is outside the supported range".into());
        }
        if kind == 0 {
            kind = b'0';
        }
        if kind == b'0' && name.ends_with('/') {
            kind = b'5';
        }
        if !matches!(kind, b'0' | b'1' | b'2' | b'5') {
            return Err(format!(
                "unsupported archive entry type: {}",
                display(&char::from(kind).to_string())
            ));
        }
        if kind != b'0' && size != 0 {
            return Err("non-file entry has a nonzero payload size".into());
        }
        let available = (data.len() - pos) as u64;
        let padded = size.next_multiple_of(512);
        let end = pos + padded.min(available) as usize;
        visit(
            Member {
                name,
                linkname: link,
                typeflag: kind,
                mode: mode as u32,
                uid,
                gid,
                mtime,
                size,
                content: &data[pos..pos + size.min(available) as usize],
            },
            (padded <= available).then(|| &data[start..end]),
        )?;
        if padded > available {
            return Err("truncated archive body".into());
        }
        pos = end;
        start = pos;
        fields.clear();
    }
    if start != pos {
        return Err("orphan extended header at end of archive".into());
    }
    Ok(())
}
