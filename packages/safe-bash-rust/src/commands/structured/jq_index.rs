use super::{JVal, JqFault};

pub(super) fn index_value<'a>(base: &'a JVal, index: &JVal) -> Result<&'a JVal, String> {
    match (base, index) {
        (JVal::Object(fields), JVal::Str(key)) => Ok(fields
            .iter()
            .find(|(k, _)| k == key)
            .map_or(&JVal::Null, |(_, v)| v)),
        (JVal::Array(items), JVal::Number(n, _)) if n.is_finite() => {
            let mut i = n.trunc();
            if i < 0.0 {
                i += items.len() as f64;
            }
            Ok(if i < 0.0 {
                &JVal::Null
            } else {
                items.get(i as usize).unwrap_or(&JVal::Null)
            })
        }
        (JVal::Null, JVal::Str(_)) => Ok(&JVal::Null),
        (JVal::Null, JVal::Number(n, _)) if n.is_finite() => Ok(&JVal::Null),
        _ => {
            let detail = if matches!(index,JVal::Str(k) if k.len()<30) {
                format!(" {}", index.to_json_string(true, false, 0))
            } else {
                String::new()
            };
            Err(format!(
                "Cannot index {} with {}{detail}",
                base.type_name(),
                index.type_name()
            ))
        }
    }
}

pub(super) fn path_slice(
    value: &JVal,
    bounds: &[(String, JVal)],
    nan_is_null: bool,
) -> Result<JVal, String> {
    let len = match value {
        JVal::Array(items) => items.len(),
        JVal::Str(s) => s.chars().count(),
        _ => unreachable!(),
    };
    let bound = |name, default| match bounds.iter().find(|(key, _)| key == name).map(|(_, v)| v) {
        Some(JVal::Null) => Ok(default),
        Some(JVal::Number(n, _)) if nan_is_null && n.is_nan() => Ok(default),
        Some(JVal::Number(n, _)) if n.is_finite() => {
            let i = if name == "start" { n.floor() } else { n.ceil() };
            Ok((if i < 0.0 { len as f64 + i } else { i }).clamp(0.0, len as f64) as usize)
        }
        _ => Err("Array/string slice indices must be integers"),
    };
    let start = bound("start", 0)?;
    let end = bound("end", len)?.max(start);
    Ok(match value {
        JVal::Array(items) => JVal::Array(items[start..end].to_vec()),
        JVal::Str(s) => JVal::Str(s.chars().skip(start).take(end - start).collect()),
        _ => unreachable!(),
    })
}

pub(super) fn indices(input: &JVal, sought: &JVal) -> Result<JVal, JqFault> {
    match (input, sought) {
        (JVal::Str(s), JVal::Str(pattern)) => positions(s.as_bytes(), pattern.as_bytes()),
        (JVal::Null, JVal::Object(_)) => Ok(JVal::Null),
        (JVal::Str(_) | JVal::Array(_), JVal::Object(bounds)) => {
            Ok(path_slice(input, bounds, true)?)
        }
        (JVal::Array(items), JVal::Array(pattern)) => positions(items, pattern),
        (JVal::Array(items), scalar) => positions(items, std::slice::from_ref(scalar)),
        _ => Ok(index_value(input, sought)?.clone()),
    }
}

// Keep the matched prefix after each hit so overlapping patterns take linear time.
fn positions<T: PartialEq>(source: &[T], pattern: &[T]) -> Result<JVal, JqFault> {
    let mut hits = Vec::new();
    if pattern.is_empty() || pattern.len() > source.len() {
        return Ok(JVal::Array(hits));
    }
    let memory = crate::ShellLimits::default().max_memory_bytes;
    if pattern.len() > memory / size_of::<usize>() {
        return Err(JqFault::Limit("maxCollectionSize"));
    }
    let mut prefixes = vec![0; pattern.len()];
    let mut matched = 0;
    for i in 1..pattern.len() {
        while matched > 0 && pattern[i] != pattern[matched] {
            matched = prefixes[matched - 1];
        }
        if pattern[i] == pattern[matched] {
            matched += 1;
        }
        prefixes[i] = matched;
    }
    matched = 0;
    for (i, value) in source.iter().enumerate() {
        while matched > 0 && *value != pattern[matched] {
            matched = prefixes[matched - 1];
        }
        if *value == pattern[matched] {
            matched += 1;
        }
        if matched == pattern.len() {
            if hits.len() >= (memory - size_of_val(prefixes.as_slice())) / size_of::<JVal>() {
                return Err(JqFault::Limit("maxCollectionSize"));
            }
            hits.push(JVal::Number((i + 1 - matched) as f64, None));
            matched = prefixes[matched - 1];
        }
    }
    Ok(JVal::Array(hits))
}
