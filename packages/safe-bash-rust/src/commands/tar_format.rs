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
    out.resize(out.len() + 1024, 0);
    Ok(out)
}
