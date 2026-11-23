use super::super::gnumeric_read::{attr, children, namespace, style};
use super::{element, precision, xlsx};
use crate::commands::{
    archive::office::xml_text as text,
    structured::xml::{Element, Node},
};

pub(super) fn record(node: &Element, depth: usize, parents: [&str; 2]) -> String {
    let mut attrs: Vec<_> = node
        .attrs
        .iter()
        .filter(|(k, _)| *k != "xmlns" && !k.starts_with("xmlns:"))
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    let local = node.tag.rsplit(':').next().unwrap();
    if parents == ["PrintInformation", "Margins"]
        && matches!(
            local,
            "top" | "bottom" | "left" | "right" | "header" | "footer"
        )
    {
        for (key, value) in &mut attrs {
            if *key == "Points" {
                let number = crate::commands::js_number(value, 0.);
                if number.is_finite() {
                    *value = precision(number);
                }
            }
        }
    }
    let nested: String = node
        .children
        .iter()
        .filter_map(|n| match n {
            Node::Element(e) if namespace(&e.namespace) => {
                Some(record(e, depth + 1, [parents[1], local]))
            }
            _ => None,
        })
        .collect();
    element(
        node.tag.rsplit(':').next().unwrap(),
        &attrs,
        &text(node),
        &nested,
        depth,
    )
}
pub(super) fn parts(node: &Element, name: &str, depth: usize) -> String {
    children(node, name)
        .map(|n| record(n, depth, ["", ""]))
        .collect()
}
pub(super) fn matches(original: &Element, cell: &xlsx::TypedCell<String>) -> bool {
    cell.style.as_deref() == Some(style(original).as_ref())
        && cell
            .format
            .as_deref()
            .is_none_or(|f| attr(original, "Format") == Some(f))
}
pub(super) fn axes(sheet: &xlsx::Sheet<String>, node: &Element) -> String {
    let mut out = String::new();
    for (kind, info, axes, fallback) in [
        ("Cols", "ColInfo", &sheet.columns, 48.),
        ("Rows", "RowInfo", &sheet.rows, 12.75),
    ] {
        let containers: Vec<_> = children(node, kind).collect();
        let default = containers
            .iter()
            .filter_map(|n| attr(n, "DefaultSizePts"))
            .filter_map(|s| s.parse::<f64>().ok())
            .filter(|n| *n > 0.)
            .last();
        let mut body = String::new();
        for (&index, axis) in axes {
            let original = containers
                .iter()
                .flat_map(|n| children(n, info))
                .filter(|n| {
                    let start = attr(n, "No")
                        .and_then(|s| s.parse::<usize>().ok())
                        .unwrap_or(usize::MAX);
                    let count = attr(n, "Count")
                        .and_then(|s| s.parse::<usize>().ok())
                        .unwrap_or(1);
                    index >= start && index - start < count
                })
                .last();
            let mut attrs = Vec::new();
            if let Some(hard) = original.and_then(|n| attr(n, "HardSize")) {
                attrs.push(("HardSize", hard.into()));
            }
            attrs.extend([
                ("No", index.to_string()),
                (
                    "Unit",
                    precision(axis.size.unwrap_or(default.unwrap_or(fallback))),
                ),
            ]);
            if axis.hidden {
                attrs.push(("Hidden", "1".into()));
            }
            if original.is_some_and(|n| attr(n, "Collapsed").is_some_and(|s| s != "0")) {
                attrs.push(("Collapsed", "1".into()));
            }
            if axis.level != 0 {
                attrs.push(("OutlineLevel", axis.level.to_string()));
            }
            body.push_str(&element(info, &attrs, "", &"", 4));
        }
        let attrs = default
            .map(|n| vec![("DefaultSizePts", precision(n))])
            .unwrap_or_default();
        out.push_str(&element(kind, &attrs, "", &body, 3));
    }
    out
}
