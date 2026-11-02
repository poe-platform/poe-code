// Reconstruct the index from physical object bodies when the xref cannot be read.
use super::{Cursor, Location, ObjectId, Objects, Value, header_version, uint};
use std::collections::BTreeMap;

pub(super) fn scan<'a>(
    objects: &mut Objects<'a>,
    mut found: impl FnMut(ObjectId, usize),
) -> Option<Vec<Value<'a>>> {
    let bytes = objects.bytes;
    let mut trailers = Vec::new();
    let mut cursor = Cursor(bytes);
    // A malformed candidate can consume bytes without yielding an object. Bound
    // the total distance of these probes rather than rescanning arbitrary suffixes.
    let mut probes = bytes.len().saturating_mul(4);
    while !cursor.0.is_empty() {
        cursor.skip();
        if cursor.0.is_empty() {
            break;
        }
        let offset = bytes.len() - cursor.0.len();
        let Some(word) = cursor.word() else {
            cursor.byte()?;
            continue;
        };
        let mut candidate = cursor;
        let id = if word == b"trailer" {
            None
        } else if word.first().is_some_and(u8::is_ascii_digit)
            && let Some(number) = uint(word)
            && let Some(generation) = candidate.word().and_then(uint)
            && candidate.word() == Some(b"obj")
        {
            Some((number, generation))
        } else {
            continue;
        };
        objects.tokens = objects.tokens.checked_sub(1)?;
        let start = candidate.0.len();
        let value = candidate.value(0, &mut objects.tokens, false);
        probes = probes.checked_sub(start - candidate.0.len())?;
        let Some(value) = value else { continue };
        if let Some((number, generation)) = id {
            candidate.skip();
            if candidate.0.starts_with(b"stream") {
                let raw = objects.stream(&value, candidate)?;
                // stream() borrows this exact range from bytes and repairs a bad
                // /Length. Skip its payload, including any object-like text.
                let end = raw.as_ptr() as usize - bytes.as_ptr() as usize + raw.len();
                candidate = Cursor(&bytes[end..]);
                if !candidate.keyword(b"endstream", &mut objects.remaining_bytes)? {
                    continue;
                }
                if value.get(b"Type").and_then(Value::word) == Some(b"/XRef") {
                    trailers.push(value);
                }
            }
            if !candidate.keyword(b"endobj", &mut objects.remaining_bytes)? {
                continue;
            }
            found((number, generation), offset);
        } else if matches!(value, Value::Dict(_)) {
            trailers.push(value);
        }
        cursor = candidate;
    }
    Some(trailers)
}

pub(super) fn recover<'a>(
    bytes: &'a [u8],
    password: &str,
) -> Result<(Objects<'a>, Value<'a>), &'static str> {
    const INVALID: &str = "invalid PDF object graph";
    header_version(bytes).ok_or(INVALID)?;
    let mut objects = Objects::new(bytes);
    let mut rows = BTreeMap::new();
    let trailers = scan(&mut objects, |(number, generation), offset| {
        let order = rows.len();
        let row = rows.entry(number).or_insert((generation, offset, order));
        (row.0, row.1) = (generation, offset);
    })
    .ok_or(INVALID)?;
    let mut direct = vec![(0, 0); rows.len()];
    for (number, (generation, offset, order)) in rows {
        direct[order] = (number, generation);
        objects
            .xref
            .insert((number, generation), (Location::File(offset), order));
    }
    let mut root = None;
    let mut info = None;
    let mut packed = Vec::new();
    let observe =
        |id, value: &Value<'_>, root: &mut Option<ObjectId>, info: &mut Option<ObjectId>| {
            if value.get(b"Type").and_then(Value::word) == Some(b"/Catalog") {
                *root = Some(id);
            }
            if [b"Title".as_slice(), b"Author", b"Producer"]
                .iter()
                .any(|key| value.get(key).is_some())
            {
                *info = Some(id);
            }
        };
    for id in direct {
        let (v, mut c) = objects.object(id).ok_or(INVALID)?;
        observe(id, &v, &mut root, &mut info);
        c.skip();
        if v.get(b"Type").and_then(Value::word) == Some(b"/ObjStm") && c.0.starts_with(b"stream") {
            packed.push(id.0);
        }
    }
    // Trailer security parameters must be selected before opening compressed members.
    let protected = trailers.iter().any(|t| t.get(b"Encrypt").is_some());
    let mut selected = None;
    let mut score = None;
    for t in trailers {
        let Some(id) = t.get(b"Root").and_then(Value::reference) else {
            continue;
        };
        match objects.object(id) {
            Some((catalog, _)) => match catalog.get(b"Pages") {
                Some(Value::Dict(_)) => (),
                Some(Value::Ref(page_tree)) => match objects.object(*page_tree) {
                    Some((Value::Dict(_), _)) => (),
                    None if !packed.is_empty() => (),
                    _ => continue,
                },
                _ => continue,
            },
            None if !packed.is_empty() => (),
            _ => continue,
        }
        let rank = (
            t.get(b"Encrypt").is_some(),
            matches!(t.get(b"ID"), Some(Value::Array(_))),
        );
        if score.is_none_or(|s| rank >= s) {
            selected = Some(t);
            score = Some(rank);
        }
    }
    if protected && !score.is_some_and(|rank| rank.0) {
        return Err(INVALID);
    }
    let trailer = selected.unwrap_or_else(|| Value::Dict(Vec::new()));
    objects.authenticate(&trailer, password)?;
    let Value::Dict(mut trailer) = trailer else { return Err(INVALID); };
    for container in packed {
        let Some(stream) = objects.object_stream(container) else {
            continue;
        };
        for (ordinal, &(n, _)) in stream.members.iter().enumerate() {
            if objects
                .xref
                .range((n, 0)..=(n, usize::MAX))
                .next()
                .is_none()
            {
                let order = objects.xref.len();
                objects
                    .xref
                    .insert((n, 0), (Location::Member { container, ordinal }, order));
            }
        }
        objects.streams.insert(container, stream);
    }
    if root.is_none() || info.is_none() {
        let mut member_root = None;
        let mut member_info = None;
        let members: Vec<_> = objects
            .xref
            .iter()
            .filter_map(|(id, (loc, _))| matches!(loc, Location::Member { .. }).then_some(*id))
            .collect();
        for id in members {
            if let Some((v, _)) = objects.object(id) {
                observe(id, &v, &mut member_root, &mut member_info);
            }
        }
        root = root.or(member_root);
        info = info.or(member_info);
    }
    for (k, id) in [(b"Root".as_slice(), root), (b"Info", info)] {
        if let Some(id) = id
            && !trailer.iter().any(|(key, _)| key.as_ref() == k)
        {
            trailer.push((k.into(), Value::Ref(id)));
        }
    }
    let trailer = Value::Dict(trailer);
    Ok((objects, trailer))
}
