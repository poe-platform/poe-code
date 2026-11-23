use super::{attr, child_mut, elements, set, text};
use crate::commands::structured::xml::{Element, Node};
use std::collections::{BTreeMap, BTreeSet};

const EXCEL: &str = "urn:schemas-microsoft-com:office:excel";

fn fields(data: &Element) -> impl Iterator<Item = (&str, &Element)> {
    data.children.iter().filter_map(|node| match node {
        Node::Element(e) if e.namespace == EXCEL => Some((e.tag.rsplit(':').next().unwrap(), e)),
        _ => None,
    })
}

fn position(data: &Element) -> Option<(usize, usize)> {
    let coordinate = |name, limit| {
        let value = text(fields(data).find(|(n, _)| *n == name)?.1);
        if value.trim().is_empty() {
            return None;
        }
        let value = crate::commands::js_number(&value, 0.);
        (value >= 0. && value < limit && value.fract() == 0.).then_some(value as usize)
    };
    Some((coordinate("Row", 1048576.)?, coordinate("Column", 16384.)?))
}

// The XLSX writer keeps note geometry separately from its comment text. Apply
// retained geometry by cell, leaving generated defaults for unrepresented notes.
pub(super) fn restore(output: &mut [Node], drawings: &[Node]) {
    let mut geometry = BTreeMap::new();
    let mut printing = BTreeMap::new();
    for shape in elements(drawings, "shape") {
        if shape.namespace != "urn:schemas-microsoft-com:vml" {
            continue;
        }
        for (i, data) in shape
            .children
            .iter()
            .filter_map(|node| match node {
                Node::Element(e)
                    if e.namespace == EXCEL
                        && e.tag.rsplit(':').next() == Some("ClientData")
                        && attr(e, "ObjectType") == Some("Note") =>
                {
                    Some(e)
                }
                _ => None,
            })
            .enumerate()
        {
            let Some(key) = position(data) else { continue };
            let mut counts = BTreeMap::new();
            for (name, _) in fields(data) {
                *counts.entry(name).or_insert(0) += 1;
            }
            let ambiguous = printing.contains_key(&key)
                || ["Row", "Column", "PrintObject"]
                    .iter()
                    .any(|n| counts.get(n).is_some_and(|c| *c > 1));
            let print = fields(data)
                .find(|(n, _)| *n == "PrintObject")
                .map(|(_, e)| text(e));
            printing.insert(
                key,
                if ambiguous {
                    None
                } else {
                    Some(!print.is_some_and(|v| {
                        matches!(v.trim().to_ascii_lowercase().as_str(), "false" | "f" | "0")
                    }))
                },
            );
            if i == 0 {
                match geometry.entry(key) {
                    std::collections::btree_map::Entry::Vacant(entry) => {
                        entry.insert(Some((shape, data)));
                    }
                    std::collections::btree_map::Entry::Occupied(mut entry) => {
                        entry.insert(None);
                    }
                }
            }
        }
    }
    let Some(root) = child_mut(output, "xml") else {
        return;
    };
    for node in &mut root.children {
        let Node::Element(shape) = node else { continue };
        let Some(data) = elements(&shape.children, "ClientData").first().copied() else {
            continue;
        };
        let Some(key) = position(data) else { continue };
        let mut replacement = None;
        if let Some(Some((source, data))) = geometry.get(&key) {
            let mut names = BTreeSet::new();
            let duplicate = fields(data).any(|(name, _)| !names.insert(name));
            let anchor = fields(data)
                .find(|(n, _)| *n == "Anchor")
                .map(|(_, e)| text(e));
            if let Some(anchor) = anchor {
                let coords: Vec<_> = anchor.split(',').map(str::trim).collect();
                let valid = !duplicate
                    && coords.len() == 8
                    && coords.iter().enumerate().all(|(i, s)| {
                        let n = crate::commands::js_number(s, 0.);
                        !s.is_empty()
                            && n >= 0.
                            && n <= 9_007_199_254_740_991.
                            && n.fract() == 0.
                            && (!matches!(i, 0 | 4) || n < 16384.)
                            && (!matches!(i, 2 | 6) || n < 1048576.)
                    });
                if valid {
                    let mut style: Vec<_> = attr(shape, "style")
                        .unwrap_or("")
                        .split(';')
                        .filter_map(|d| d.split_once(':'))
                        .map(|(k, v)| (k.to_owned(), v.to_owned()))
                        .collect();
                    for declaration in attr(source, "style").unwrap_or("").split(';') {
                        let Some((name, value)) = declaration.split_once(':') else {
                            continue;
                        };
                        let name = name.trim().to_ascii_lowercase();
                        let value = value.trim().to_ascii_lowercase();
                        let value = match name.as_str() {
                            "margin-left" | "margin-top" | "width" | "height" => {
                                let unit = ["pt", "px", "in", "cm", "mm", "pc"]
                                    .into_iter()
                                    .find(|u| value.ends_with(u));
                                let scalar = unit
                                    .map_or(value.as_str(), |u| &value[..value.len() - u.len()])
                                    .trim();
                                let n = crate::commands::js_number(scalar, 0.);
                                if scalar.is_empty()
                                    || !n.is_finite()
                                    || (unit.is_none() && n != 0.)
                                    || (matches!(name.as_str(), "width" | "height") && n < 0.)
                                {
                                    continue;
                                }
                                format!("{}{}", if n == 0. { 0. } else { n }, unit.unwrap_or(""))
                            }
                            "visibility" if matches!(value.as_str(), "visible" | "hidden") => value,
                            "z-index" => {
                                let n = crate::commands::js_number(&value, 0.);
                                if value.is_empty()
                                    || n.abs() > 9_007_199_254_740_991.
                                    || n.fract() != 0.
                                {
                                    continue;
                                }
                                value
                            }
                            _ => continue,
                        };
                        if let Some((_, old)) = style.iter_mut().find(|(k, _)| *k == name) {
                            *old = value;
                        }
                    }
                    set(
                        shape,
                        "style",
                        style
                            .into_iter()
                            .map(|(k, v)| format!("{k}:{v};"))
                            .collect(),
                    );
                    let mut retained = vec![("Anchor", coords.join(", "))];
                    for name in [
                        "MoveWithCells",
                        "SizeWithCells",
                        "Visible",
                        "AutoFill",
                        "Locked",
                        "LockText",
                    ] {
                        if let Some((_, field)) = fields(data).find(|(n, _)| *n == name) {
                            let value = text(field).trim().to_owned();
                            if matches!(
                                value.to_ascii_lowercase().as_str(),
                                "" | "true" | "false" | "t" | "f" | "1" | "0"
                            ) {
                                retained.push((name, value));
                            }
                        }
                    }
                    replacement = Some(retained);
                }
            }
        }
        let Some(data) = child_mut(&mut shape.children, "ClientData") else {
            continue;
        };
        if let Some(replacement) = replacement {
            data.children.retain(|n| matches!(n, Node::Element(e) if matches!(e.tag.rsplit(':').next(), Some("PrintObject" | "Row" | "Column"))));
            data.children.splice(
                0..0,
                replacement.into_iter().map(|(name, value)| {
                    Node::Element(Element {
                        tag: format!("x:{name}"),
                        namespace: EXCEL.into(),
                        attrs: Vec::new(),
                        self_closing: value.is_empty(),
                        children: if value.is_empty() {
                            Vec::new()
                        } else {
                            vec![Node::Text(value, None)]
                        },
                    })
                }),
            );
        }
        if let Some(Some(print)) = printing.get(&key)
            && let Some(field) = child_mut(&mut data.children, "PrintObject")
        {
            field.children = vec![Node::Text(
                if *print { "True" } else { "False" }.into(),
                None,
            )];
        }
    }
}
