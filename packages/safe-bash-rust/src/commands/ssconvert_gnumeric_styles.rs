use super::{attr, children, namespace, number};
use crate::commands::structured::xml::{Element, Node};

pub(super) fn text(node: &Element) -> String {
    node.children
        .iter()
        .filter_map(|child| match child {
            Node::Text(value, _) | Node::Cdata(value) => Some(value.as_str()),
            _ => None,
        })
        .collect()
}

fn normalize(style: &mut Element) {
    let mut attrs: Vec<(String, String)> = Vec::new();
    for (mut key, mut value) in std::mem::take(&mut style.attrs) {
        if matches!(key.as_str(), "Fit" | "WrapText") {
            let parsed = if value.is_empty() {
                Some(0)
            } else {
                value
                    .trim_start_matches([' ', '\t', '\n', '\r', '\u{b}', '\u{c}'])
                    .parse::<i64>()
                    .ok()
            };
            if let Some(n) = parsed {
                key = "WrapText".into();
                value = if n as i32 == 0 { "0" } else { "1" }.into();
            }
        }
        if let Some(prior) = attrs.iter_mut().find(|(k, _)| *k == key) {
            prior.1 = value;
        } else {
            attrs.push((key, value));
        }
    }
    style.attrs = attrs;
    for child in &mut style.children {
        let Node::Element(font) = child else { continue };
        if font.tag.rsplit(':').next() != Some("Font") || font.namespace != style.namespace {
            continue;
        }
        let name = text(font);
        if !name.starts_with('-') {
            continue;
        }
        let offset = |component| {
            let mut at = 0;
            let mut separators = 0;
            while at < name.len() && separators < component {
                if name.as_bytes()[at] == b'-' {
                    separators += 1;
                }
                at += 1;
            }
            if name.as_bytes().get(at) == Some(&b'-') {
                at += 1;
            }
            &name[at..]
        };
        for (key, enabled) in [
            ("Bold", offset(2).starts_with("bold")),
            ("Italic", offset(3).starts_with(['i', 'o'])),
        ] {
            if enabled {
                font.attrs.retain(|(k, _)| k != key);
                font.attrs.push((key.into(), "1".into()));
            }
        }
        font.children.retain(|n| matches!(n, Node::Element(_)));
    }
}

fn apply(previous: &Element, patch: &Element) -> Element {
    let mut result = patch.clone();
    result.attrs = previous.attrs.clone();
    for (key, value) in &patch.attrs {
        if let Some(prior) = result.attrs.iter_mut().find(|(k, _)| k == key) {
            prior.1.clone_from(value);
        } else {
            result.attrs.push((key.clone(), value.clone()));
        }
    }
    let value = if patch.tag.rsplit(':').next() == Some("Font") && text(patch).is_empty() {
        text(previous)
    } else {
        text(patch)
    };
    result.children = previous
        .children
        .iter()
        .filter(|n| matches!(n, Node::Element(_)))
        .cloned()
        .collect();
    for child in &patch.children {
        let Node::Element(child) = child else {
            continue;
        };
        if patch.tag.rsplit(':').next() == Some("StyleBorder")
            && child.namespace == patch.namespace
            && !attr(child, "Style").is_some_and(|s| {
                let n = crate::commands::js_number(s, f64::NAN);
                !s.trim().is_empty() && n >= 0. && n.is_finite() && n.fract() == 0.
            })
        {
            continue;
        }
        let prior = result.children.iter_mut().find_map(|n| match n {
            Node::Element(e)
                if e.namespace == child.namespace
                    && e.tag.rsplit(':').next() == child.tag.rsplit(':').next() =>
            {
                Some(e)
            }
            _ => None,
        });
        if let Some(prior) = prior {
            *prior = if child.namespace == patch.namespace
                && matches!(child.tag.rsplit(':').next(), Some("Font" | "StyleBorder"))
            {
                apply(prior, child)
            } else {
                child.clone()
            };
        } else {
            result.children.push(Node::Element(child.clone()));
        }
    }
    if !value.is_empty() {
        result.children.insert(0, Node::Text(value, None));
    }
    result
}

fn intersection(a: [usize; 4], b: [usize; 4]) -> Option<[usize; 4]> {
    let cut = [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ];
    (cut[0] <= cut[2] && cut[1] <= cut[3]).then_some(cut)
}

fn outside(a: [usize; 4], cut: [usize; 4]) -> Vec<[usize; 4]> {
    let mut parts = Vec::new();
    if a[0] < cut[0] {
        parts.push([a[0], a[1], cut[0] - 1, a[3]]);
    }
    if a[2] > cut[2] {
        parts.push([cut[2] + 1, a[1], a[2], a[3]]);
    }
    if a[1] < cut[1] {
        parts.push([cut[0], a[1], cut[2], cut[1] - 1]);
    }
    if a[3] > cut[3] {
        parts.push([cut[0], cut[3] + 1, cut[2], a[3]]);
    }
    parts
}

pub(super) fn read(root: &mut Element, legacy: bool) {
    for node in &mut root.children {
        let Node::Element(node) = node else { continue };
        if !namespace(&node.namespace) {
            continue;
        }
        if node.tag.rsplit(':').next() != Some("Styles") {
            if matches!(node.tag.rsplit(':').next(), Some("Sheets" | "Sheet")) {
                read(node, legacy);
            }
            continue;
        }
        for region in &mut node.children {
            let Node::Element(region) = region else {
                continue;
            };
            for style in &mut region.children {
                if let Node::Element(style) = style
                    && style.tag.rsplit(':').next() == Some("Style")
                    && namespace(&style.namespace)
                {
                    normalize(style);
                }
            }
        }
        if !legacy {
            continue;
        }
        let mut resolved: Vec<([usize; 4], Element, Element)> = Vec::new();
        for region in children(node, "StyleRegion") {
            let Some(style) = children(region, "Style").next() else {
                continue;
            };
            let bounds = ["startRow", "startCol", "endRow", "endCol"]
                .map(|key| number(region, key, 0.) as usize);
            let mut next = Vec::new();
            let mut uncovered = vec![bounds];
            for (prior_bounds, prior_region, prior_style) in resolved {
                let Some(overlap) = intersection(prior_bounds, bounds) else {
                    next.push((prior_bounds, prior_region, prior_style));
                    continue;
                };
                for part in outside(prior_bounds, overlap) {
                    next.push((part, prior_region.clone(), prior_style.clone()));
                }
                next.push((overlap, region.clone(), apply(&prior_style, style)));
                uncovered = uncovered
                    .into_iter()
                    .flat_map(|part| {
                        intersection(part, overlap)
                            .map_or_else(|| vec![part], |cut| outside(part, cut))
                    })
                    .collect();
            }
            for part in uncovered {
                next.push((part, region.clone(), style.clone()));
            }
            resolved = next;
        }
        node.children = resolved
            .into_iter()
            .map(|(bounds, mut region, style)| {
                region.attrs = [
                    ("startRow", bounds[0]),
                    ("endRow", bounds[2]),
                    ("startCol", bounds[1]),
                    ("endCol", bounds[3]),
                ]
                .map(|(key, value)| (key.into(), value.to_string()))
                .into();
                region.children = vec![Node::Element(style)];
                Node::Element(region)
            })
            .collect();
    }
}
