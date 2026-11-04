use crate::vfs::{EntryIdentity, SafeBashFs, VfsEntryKind};

pub(super) fn size(value: &str) -> Result<usize, &'static str> {
    if value.is_empty() {
        return Err("split size requires a value");
    }
    if value == "-" {
        return Ok(0);
    }
    let invalid = "split size must be zero or at least 64 KB";
    let (digits, unit) = value.split_at(value.bytes().take_while(u8::is_ascii_digit).count());
    let power = match unit.to_ascii_lowercase().as_str() {
        "" => 0,
        "k" => 1,
        "m" => 2,
        "g" => 3,
        "t" => 4,
        _ => return Err(invalid),
    };
    let mut size = digits
        .parse::<u64>()
        .ok()
        .and_then(|n| n.checked_mul(1024u64.pow(power)))
        .ok_or(invalid)?;
    if size < 1024 {
        size *= 1024 * 1024;
    }
    if size != 0 && !(65536..=9_007_199_254_740_991).contains(&size) {
        return Err(invalid);
    }
    Ok(usize::try_from(size).unwrap_or(usize::MAX))
}

// Only consumes ZIP32 output from encode_zip_members. Use its directory, never
// apparent signatures inside a member's data, to locate indivisible records.
fn partition(mut bytes: Vec<u8>, size: usize) -> Result<Vec<Vec<u8>>, String> {
    let word = |p: usize| u16::from_le_bytes(bytes[p..p + 2].try_into().unwrap()) as usize;
    let dword = |p: usize| u32::from_le_bytes(bytes[p..p + 4].try_into().unwrap()) as usize;
    let mut ends = (bytes.len().saturating_sub(65557)..=bytes.len() - 22)
        .rev()
        .filter(|&p| dword(p) == 0x06054b50 && p + 22 + word(p + 20) == bytes.len());
    let end = ends.next().ok_or("ZIP missing end record")?;
    if ends.next().is_some() {
        return Err("ZIP ambiguous end records".into());
    }
    let directory = dword(end + 16);
    let mut headers = Vec::new();
    let mut local_headers = Vec::new();
    let mut central_headers = Vec::new();
    let mut p = directory;
    for _ in 0..word(end + 10) {
        if p.checked_add(46).is_none_or(|next| next > end) || dword(p) != 0x02014b50 {
            return Err("ZIP invalid central record".into());
        }
        let local = dword(p + 42);
        if local.checked_add(30).is_none_or(|next| next > directory) || dword(local) != 0x04034b50 {
            return Err("ZIP invalid local record".into());
        }
        headers.push((p, local));
        let payload = local + 30 + word(local + 26) + word(local + 28);
        local_headers.push((local,payload));
        if word(local + 6) & 8 != 0 {
            let descriptor = payload.checked_add(dword(p + 20)).ok_or("ZIP invalid descriptor offset")?;
            local_headers.push((descriptor,descriptor.checked_add(16).ok_or("ZIP invalid descriptor offset")?));
        }
        let next = p + 46 + word(p + 28) + word(p + 30) + word(p + 32);
        central_headers.push((p, next));
        p = next;
    }
    if p != end {
        return Err("ZIP invalid central directory".into());
    }
    let mut starts = vec![0];
    let mut pos = 0;
    let mut used = 4;
    for (start, stop) in local_headers
        .into_iter()
        .chain(central_headers)
        .chain([(end, bytes.len())])
    {
        if start < pos || stop > bytes.len() || stop - start > size {
            return Err("ZIP record cannot fit in split volume".into());
        }
        while start > pos && start - pos >= size - used {
            pos += size - used;
            starts.push(pos);
            used = 0;
        }
        used += start - pos;
        if stop - start > size - used {
            starts.push(start);
            used = 0;
        }
        used += stop - start;
        pos = stop;
    }
    if starts.len() >= 65535 {
        return Err("ZIP split volume count limit exceeded".into());
    }
    let location = |pos| {
        let disk = starts.partition_point(|&s| s <= pos) - 1;
        (
            disk as u16,
            (pos - starts[disk] + if disk == 0 { 4 } else { 0 }) as u32,
        )
    };
    let last = (starts.len() - 1) as u16;
    let mut count = 0u16;
    for (central, local) in headers {
        let (disk, offset) = location(local);
        count += u16::from(location(central).0 == last);
        bytes[central + 34..central + 36].copy_from_slice(&disk.to_le_bytes());
        bytes[central + 42..central + 46].copy_from_slice(&offset.to_le_bytes());
    }
    let (disk, offset) = location(directory);
    bytes[end + 4..end + 6].copy_from_slice(&last.to_le_bytes());
    bytes[end + 6..end + 8].copy_from_slice(&disk.to_le_bytes());
    bytes[end + 8..end + 10].copy_from_slice(&count.to_le_bytes());
    bytes[end + 16..end + 20].copy_from_slice(&offset.to_le_bytes());
    starts.push(bytes.len());
    Ok(starts
        .windows(2)
        .enumerate()
        .map(|(disk, s)| {
            let mut part = Vec::with_capacity(s[1] - s[0] + if disk == 0 { 4 } else { 0 });
            if disk == 0 {
                part.extend_from_slice(b"PK\x07\x08");
            }
            part.extend_from_slice(&bytes[s[0]..s[1]]);
            part
        })
        .collect())
}

pub(super) fn publish(
    fs: &dyn SafeBashFs,
    dest: &str,
    bytes: Vec<u8>,
    size: usize,
    verbose: bool,
    inputs: &[(String, Option<EntryIdentity>)],
    version: u64,
) -> Result<String, String> {
    if !dest.to_ascii_lowercase().ends_with(".zip") {
        return Err("split output requires a .zip filename".into());
    }
    let parts = partition(bytes, size)?;
    let count = parts.len();
    let mut files = Vec::new();
    let mut report = String::new();
    for (disk, part) in parts.into_iter().enumerate() {
        let path = if disk + 1 == count {
            dest.into()
        } else {
            format!("{}.z{:02}", &dest[..dest.len() - 4], disk + 1)
        };
        if inputs.iter().any(|(p, _)| p == &path) {
            return Err("ZIP split output aliases an input volume".into());
        }
        let mode = match fs.lstat(&path) {
            Ok(st)
                if st.kind == VfsEntryKind::File
                    && st.identity.is_some()
                    && st.nlink == Some(1)
                    && !inputs.iter().any(|(_, id)| *id == st.identity) =>
            {
                st.mode & 0o7777
            }
            Ok(_) => return Err("ZIP split destination is not a safe regular file".into()),
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => 0o644,
            Err(e) => return Err(e),
        };
        if verbose {
            report.push_str(&format!(
                "split {}/{}: {} ({} bytes)\n",
                disk + 1,
                count,
                super::zip_public_text(&path),
                part.len()
            ));
        }
        files.push((path, part, mode));
    }
    fs.replace_file_batch(files, version)?;
    Ok(report)
}
