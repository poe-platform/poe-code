use super::{Value, index, last_xref, pdf_copy::literal, pdf_string::decode, uint};
use std::io::Write;

pub(in super::super) const INFO_TAGS: &[&str] = &[
    "Title",
    "Author",
    "Subject",
    "Keywords",
    "Creator",
    "Producer",
    "Description",
    "Comment",
    "Copyright",
    "ModifyDate",
    "CreateDate",
];

pub(in super::super) fn edit_info(
    bytes: &[u8],
    updates: &[(String, String)],
    copied: bool,
) -> Result<Vec<u8>, String> {
    let invalid = "Invalid PDF cross-reference table";
    if !bytes.starts_with(b"%PDF-") {
        return Err("Invalid PDF header".into());
    }
    let (mut objects, trailer) = index(bytes).ok_or(invalid)?;
    let root = trailer
        .get(b"Root")
        .and_then(Value::reference)
        .ok_or(invalid)?;
    let mut info = Vec::<(&str, String)>::new();
    if let Some(reference) = trailer.get(b"Info") {
        let Value::Dict(entries) = objects.resolve(reference).ok_or(invalid)? else {
            return Err(invalid.into());
        };
        for (k, v) in entries {
            let key = match k {
                b"CreationDate" => "CreateDate",
                b"ModDate" => "ModifyDate",
                _ => std::str::from_utf8(k).unwrap_or(""),
            };
            if let Value::String { bytes: value, .. } = v
                && INFO_TAGS.contains(&key)
                && !info.iter().any(|(k, _)| *k == key)
            {
                info.push((key, decode(&value)));
            }
        }
    }
    if !info.iter().any(|(k, _)| *k == "Producer") {
        info.push(("Producer", "@poe-code/pdf-ast".into()));
    }
    let mut modified = false;
    for (name, value) in updates {
        let key = name.trim_end_matches(['+', '-']);
        let Some(&key) = INFO_TAGS.iter().find(|k| k.eq_ignore_ascii_case(key)) else {
            if copied {
                continue;
            }
            return Err(format!("Tag write not yet supported: {key}"));
        };
        let pos = info.iter().position(|(k, _)| *k == key);
        let old = pos.map(|i| info[i].1.as_str()).unwrap_or("");
        let next = if name.ends_with('+') && !old.is_empty() {
            format!("{old}, {value}")
        } else if name.ends_with('-') {
            if !value.is_empty() && old != value {
                continue;
            }
            String::new()
        } else {
            value.clone()
        };
        if next == old {
            continue;
        }
        modified = true;
        match pos {
            Some(i) if next.is_empty() => {
                info.remove(i);
            }
            Some(i) => info[i].1 = next,
            None => info.push((key, next)),
        }
    }
    if !modified {
        return Ok(Vec::new());
    }
    let next_id = objects
        .xref
        .keys()
        .next_back()
        .ok_or(invalid)?
        .0
        .checked_add(1)
        .ok_or(invalid)?;
    let id = next_id.max(
        trailer
            .get(b"Size")
            .and_then(Value::word)
            .and_then(uint)
            .unwrap_or(0),
    );
    let size = id.checked_add(1).ok_or(invalid)?;
    let mut out = format!("\n{id} 0 obj\n<<").into_bytes();
    for (key, value) in info {
        let mut encoded = Vec::new();
        if value.bytes().all(|c| (32..=126).contains(&c)) {
            literal(value.as_bytes(), &mut encoded);
        } else {
            encoded.extend_from_slice(b"<FEFF");
            for c in value.encode_utf16() {
                write!(encoded, "{c:04X}").unwrap();
            }
            encoded.push(b'>');
        }
        for k in std::iter::once(key).chain(match key {
            "CreateDate" => Some("CreationDate"),
            "ModifyDate" => Some("ModDate"),
            _ => None,
        }) {
            write!(out, " /{k} ").unwrap();
            out.extend_from_slice(&encoded);
        }
    }
    out.extend_from_slice(b" >>\nendobj\n");
    let xref = bytes.len() + out.len();
    write!(out,"xref\n0 1\n0000000000 65535 f \n{id} 1\n{:010} 00000 n \ntrailer\n<< /Size {size} /Root {} {} R /Info {id} 0 R /Prev {} >>\nstartxref\n{xref}\n%%EOF\n",bytes.len()+1,root.0,root.1,last_xref(bytes).ok_or(invalid)?).unwrap();
    Ok(out)
}
