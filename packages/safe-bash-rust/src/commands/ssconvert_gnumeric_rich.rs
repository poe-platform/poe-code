use super::xlsx::TextRun;
use std::{collections::BTreeSet, sync::Arc};

pub(super) fn read(value: &str, format: &str) -> Option<Vec<TextRun>> {
    let mut input = format.strip_prefix("@[")?;
    let mut attributes = Vec::new();
    loop {
        let (key, rest) = input.split_once('=')?;
        let (raw, rest) = rest.split_once(':')?;
        let (range, rest) = rest.split_once(']')?;
        let (start, end) = range.split_once(':')?;
        let (start, end) = (start.parse::<usize>().ok()?, end.parse::<usize>().ok()?);
        let key = match key {
            "family" => "family",
            "size" => "size",
            "bold" => "bold",
            "italic" => "italic",
            "strikethrough" => "strikethrough",
            "underline" => "underline",
            "color" => "color",
            "subscript" => "subscript",
            "superscript" => "superscript",
            "rise" => "rise",
            "scale" => "scale",
            _ => "",
        };
        if !key.is_empty() && start < end {
            let raw = match key {
                "color" => format!("FF{}", raw.replace('x', "")),
                "underline" if raw == "low" => "singleAccounting".into(),
                _ => raw.into(),
            };
            attributes.push((start, end, key, raw));
        }
        if rest.is_empty() {
            break;
        }
        input = rest.strip_prefix('[')?;
    }
    if attributes.is_empty() {
        return None;
    }
    let mut boundaries = BTreeSet::from([0, value.len()]);
    for (start, end, _, _) in &attributes {
        for at in [*start, *end] {
            if at <= value.len() && value.is_char_boundary(at) {
                boundaries.insert(at);
            }
        }
    }
    let boundaries: Vec<_> = boundaries.into_iter().collect();
    Some(
        boundaries
            .windows(2)
            .map(|pair| TextRun {
                text: value[pair[0]..pair[1]].into(),
                attributes: Arc::new(
                    attributes
                        .iter()
                        .filter(|(start, end, _, _)| *start <= pair[0] && *end >= pair[1])
                        .map(|(_, _, k, v)| (*k, v.clone()))
                        .collect(),
                ),
            })
            .collect(),
    )
}
