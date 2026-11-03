// Match the property and script aliases accepted by the production mdq regex parser.
use super::{RxParseError, mdq_classes};
use std::borrow::Cow;

#[path = "mdq_property_data.rs"]
mod data;

fn lookup(name: &str, insensitive: bool) -> Option<Vec<u32>> {
    let i = data::NAMES
        .binary_search_by_key(&name, |&(key, _, _)| key)
        .ok()?;
    let (_, plain, folded) = data::NAMES[i];
    let id = usize::from(if insensitive { folded } else { plain });
    let bytes = &include_bytes!("mdq_properties.bin")[data::OFFSETS[id]..data::OFFSETS[id + 1]];
    let (mut edge, mut delta, mut shift) = (0, 0, 0);
    let mut edges = Vec::new();
    for &byte in bytes {
        delta |= u32::from(byte & 127) << shift;
        if byte < 128 {
            edge += delta;
            edges.push(edge);
            (delta, shift) = (0, 0);
        } else {
            shift += 7;
        }
    }
    Some(edges)
}

fn property(name: &str, insensitive: bool) -> Option<Vec<u32>> {
    let name = name.replace(' ', "").replace('-', "_");
    if name.eq_ignore_ascii_case("ascii") {
        return Some(vec![0, 128]);
    }
    if name.eq_ignore_ascii_case("any") {
        return Some(vec![0, 0x110000]);
    }
    let (key, value) = name.split_once('=').unwrap_or(("", &name));
    let prefix = match key.to_ascii_lowercase().as_str() {
        "sc" | "script" => "Script=",
        "scx" | "scriptextensions" | "script_extensions" => "Script_Extensions=",
        "gc" | "generalcategory" | "general_category" => "General_Category=",
        "" => "",
        _ => return None,
    };
    let title = value
        .to_ascii_lowercase()
        .split('_')
        .map(|s| {
            let mut chars = s.chars();
            chars
                .next()
                .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join("_");
    for prefix in [Some(prefix), key.is_empty().then_some("Script=")]
        .into_iter()
        .flatten()
    {
        for v in [value, &title] {
            if let Some(edges) = lookup(&format!("{prefix}{v}"), insensitive) {
                return Some(edges);
            }
        }
    }
    None
}

// 'at' points just after the escape. Boundaries alternate between entering
// and leaving the class; uppercase escape letters complement the result.
pub(super) fn escape(
    c: char,
    chars: &[char],
    at: &mut usize,
    insensitive: bool,
) -> Result<Option<(Cow<'static, [u32]>, bool)>, RxParseError> {
    let edges = match c.to_ascii_lowercase() {
        'w' => Cow::Borrowed(mdq_classes::WORD),
        's' => Cow::Borrowed(mdq_classes::SPACE),
        'd' => Cow::Borrowed(mdq_classes::DIGIT),
        'h' => Cow::Borrowed(mdq_classes::HEX),
        'p' => {
            let name = if chars.get(*at) == Some(&'{') {
                *at += 1;
                let start = *at;
                let len = chars[start..]
                    .iter()
                    .position(|&ch| ch == '}')
                    .ok_or("Unicode escape not closed")?;
                *at += len + 1;
                chars[start..start + len].iter().collect()
            } else {
                let ch = chars
                    .get(*at)
                    .ok_or("unexpected end of regular expression")?;
                *at += 1;
                ch.to_string()
            };
            Cow::Owned(property(&name, insensitive).ok_or("Regex error: error parsing pattern 0")?)
        }
        _ => return Ok(None),
    };
    Ok(Some((edges, c.is_ascii_uppercase())))
}
