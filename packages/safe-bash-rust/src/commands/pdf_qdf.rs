// QDF keeps stream lengths in adjacent objects so text edits can be repaired.
use super::super::{Cursor, Objects, Value};
use super::{INVALID, TOO_LARGE, encode};
use std::collections::{BTreeMap, BTreeSet};

fn emit(out: &mut Vec<u8>, bytes: &[u8], limit: usize) -> Result<(), String> {
    if bytes.len() > limit.saturating_sub(out.len()) { return Err(TOO_LARGE.into()); }
    out.extend_from_slice(bytes);
    Ok(())
}
fn node(value: &Value<'_>, numbers: &BTreeMap<usize, usize>, out: &mut Vec<u8>, depth: usize, limit: usize) -> Result<(), String> {
    if depth > 128 { return Err(INVALID.into()); }
    match value {
        Value::Ref((id, _)) => {
            if let Some(number) = numbers.get(id) { emit(out, format!("{number} 0 R").as_bytes(), limit)?; }
            else { emit(out, b"null", limit)?; }
        }
        Value::Dict(entries) => {
            emit(out, b"<<\n", limit)?;
            for (key, value) in entries {
                emit(out, "  ".repeat(depth + 1).as_bytes(), limit)?;
                emit(out, b"/", limit)?; emit(out, key, limit)?; emit(out, b" ", limit)?;
                node(value, numbers, out, depth + 1, limit)?;
                emit(out, b"\n", limit)?;
            }
            emit(out, "  ".repeat(depth).as_bytes(), limit)?;
            emit(out, b">>", limit)?;
        }
        Value::Array(items) => {
            emit(out, b"[\n", limit)?;
            for value in items {
                emit(out, "  ".repeat(depth + 1).as_bytes(), limit)?;
                node(value, numbers, out, depth + 1, limit)?;
                emit(out, b"\n", limit)?;
            }
            emit(out, "  ".repeat(depth).as_bytes(), limit)?;
            emit(out, b"]", limit)?;
        }
        Value::Word(word) => emit(out, word, limit)?,
        Value::String { bytes, hex } => {
            let size = if *hex { bytes.len().checked_mul(2).and_then(|n| n.checked_add(2)) }
                else { bytes.iter().try_fold(2usize, |size, byte| size.checked_add(if matches!(byte, b'(' | b')' | b'\\' | b'\t' | b'\r' | b'\n') { 2 } else { 1 })) };
            if size.ok_or(TOO_LARGE)? > limit.saturating_sub(out.len()) { return Err(TOO_LARGE.into()); }
            encode(value, out)?;
        }
    }
    Ok(())
}

struct Object<'a> { value: Value<'a>, generation: usize, stream: Option<&'a [u8]> }
fn comments(value: &Value<'_>, objects: &BTreeMap<usize, Object<'_>>, seen: &mut BTreeSet<usize>, labels: &mut BTreeMap<usize, String>, page: &mut usize, content: bool, depth: usize) -> Result<(), String> {
    if depth > 128 { return Err(INVALID.into()); }
    let mut value = value;
    let mut id = None;
    if let Value::Ref((number, _)) = value {
        if !seen.insert(*number) { return Ok(()); }
        let Some(object) = objects.get(number) else { return Ok(()); };
        if content && object.stream.is_some() {
            labels.insert(*number, format!("%% Contents for page {page}\n"));
            return Ok(());
        }
        id = Some(*number);
        value = &object.value;
    }
    match value {
        Value::Array(items) => for value in items { comments(value, objects, seen, labels, page, content, depth + 1)?; },
        Value::Dict(_) => {
            let key = if value.get(b"Type").and_then(Value::word) == Some(b"/Page") {
                *page += 1;
                if let Some(id) = id { labels.insert(id, format!("%% Page {page}\n")); }
                b"Contents".as_slice()
            } else { b"Kids".as_slice() };
            if let Some(child) = value.get(key) { comments(child, objects, seen, labels, page, key == b"Contents", depth + 1)?; }
        }
        _ => (),
    }
    Ok(())
}

pub(super) fn finish(out: Vec<u8>, rows: Vec<(u8, usize, usize)>, trailer: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let mut tokens = 1_000_000;
    let mut reader = Objects::new(&out);
    let mut objects = BTreeMap::new();
    let mut numbers = BTreeMap::new();
    let mut next = 1usize;
    for (id, &(kind, offset, generation)) in rows.iter().enumerate() {
        if kind == 0 { continue; }
        if kind != 1 { return Err(INVALID.into()); }
        let mut c = Cursor(out.get(offset..).ok_or(INVALID)?);
        c.object_header().ok_or(INVALID)?;
        let value = c.value(0, &mut tokens, true).ok_or(INVALID)?;
        c.skip();
        let stream = if c.0.starts_with(b"stream") { Some(reader.stream(&value, c).ok_or(INVALID)?) } else { None };
        if value.get(b"Linearized").is_some() || stream.is_some() && matches!(value.get(b"Type").and_then(Value::word), Some(b"/XRef" | b"/ObjStm" | b"/Hint")) { continue; }
        numbers.insert(id, next);
        next = next.checked_add(if stream.is_some() { 2 } else { 1 }).ok_or(TOO_LARGE)?;
        objects.insert(id, Object { value, generation, stream });
    }
    if next > limit / 20 { return Err(TOO_LARGE.into()); }
    let mut trailer_dict = b"<<\n".to_vec(); trailer_dict.extend_from_slice(trailer); trailer_dict.extend_from_slice(b">>");
    let trailer = Cursor(&trailer_dict).value(0, &mut tokens, true).ok_or(INVALID)?;
    let root = trailer.get(b"Root").ok_or(INVALID)?;
    let mut labels = BTreeMap::new();
    if let Some(object) = root.reference().and_then(|id| objects.get(&id.0))
        && let Some(pages) = object.value.get(b"Pages") {
        comments(pages, &objects, &mut BTreeSet::new(), &mut labels, &mut 0, false, 0)?;
    }
    let first_line = out.iter().position(|b| *b == b'\n').ok_or(INVALID)?;
    let mut result = Vec::new();
    emit(&mut result, &out[..=first_line], limit)?;
    emit(&mut result, b"%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n%QDF-1.0\n\n", limit)?;
    let mut offsets = vec![0; next];
    for (id, object) in &objects {
        let number = numbers[id];
        if let Some(label) = labels.get(id) { emit(&mut result, label.as_bytes(), limit)?; }
        emit(&mut result, format!("%% Original object ID: {id} {}\n", object.generation).as_bytes(), limit)?;
        offsets[number] = result.len();
        emit(&mut result, format!("{number} 0 obj\n").as_bytes(), limit)?;
        if let Some(data) = object.stream {
            let Value::Dict(entries) = &object.value else { return Err(INVALID.into()); };
            let mut dict = entries.iter().filter(|(k, _)| k.as_ref() != b"Length").cloned().collect::<Vec<_>>();
            // This reference already uses the new QDF identity, unlike source refs.
            dict.push((b"Length".as_slice().into(), Value::Word(format!("{} 0 R", number + 1).into_bytes().into())));
            node(&Value::Dict(dict), &numbers, &mut result, 0, limit)?;
            emit(&mut result, b"\nstream\n", limit)?; emit(&mut result, data, limit)?;
            emit(&mut result, b"\nendstream\nendobj\n\n%QDF: ignore_newline\n", limit)?;
            offsets[number + 1] = result.len();
            emit(&mut result, format!("{} 0 obj\n{}\nendobj\n\n", number + 1, data.len()).as_bytes(), limit)?;
        } else {
            node(&object.value, &numbers, &mut result, 0, limit)?;
            emit(&mut result, b"\nendobj\n\n", limit)?;
        }
    }
    let xref = result.len();
    emit(&mut result, format!("xref\n0 {next}\n0000000000 65535 f \n").as_bytes(), limit)?;
    for offset in offsets.into_iter().skip(1) { emit(&mut result, format!("{offset:010} 00000 n \n").as_bytes(), limit)?; }
    let mut fields = vec![(b"Size".as_slice().into(), Value::Word(next.to_string().into_bytes().into())), (b"Root".as_slice().into(), root.clone())];
    for key in [b"Info".as_slice(), b"ID"] { if let Some(value) = trailer.get(key) { fields.push((key.into(), value.clone())); } }
    emit(&mut result, b"trailer ", limit)?;
    node(&Value::Dict(fields), &numbers, &mut result, 0, limit)?;
    emit(&mut result, format!("\nstartxref\n{xref}\n%%EOF\n").as_bytes(), limit)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qdf_scalar_encoding_never_appends_beyond_the_output_budget() {
        for value in [
            Value::Word(b"/LongName".as_slice().into()),
            Value::String { bytes: b"(\\\t\r\n)".to_vec(), hex: false },
            Value::String { bytes: vec![0, 255, 128], hex: true },
        ] {
            let mut encoded = Vec::new();
            encode(&value, &mut encoded).unwrap();
            let mut output = b"prefix".to_vec();
            let limit = output.len() + encoded.len() - 1;
            assert!(node(&value, &BTreeMap::new(), &mut output, 0, limit).is_err());
            assert!(output.len() <= limit, "scalar exceeded the output budget");
        }
    }
}
