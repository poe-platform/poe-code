use super::{LIMIT, appearance::distance, attr};
use crate::commands::js_number;
use crate::commands::structured::{
    xlsx::{Print, Scale},
    xml::{Element, Node},
};
use std::collections::BTreeMap;

pub(super) struct Styles<'a> {
    nodes: BTreeMap<(&'static str, Option<&'a str>), (&'a Element, bool)>,
}
impl<'a> Styles<'a> {
    pub fn read(
        roots: &[&'a Element],
        legacy: bool,
        remaining: &mut usize,
    ) -> Result<Self, String> {
        let mut nodes = BTreeMap::new();
        for root in roots {
            let external = root.tag == "office:document-styles";
            for node in &root.children {
                let Node::Element(container) = node else {
                    continue;
                };
                for node in &container.children {
                    let Node::Element(el) = node else { continue };
                    let kind = match (container.tag.as_str(), el.tag.as_str()) {
                        ("office:automatic-styles", "style:style") => "style",
                        ("office:styles", "style:style") if external => "style",
                        ("office:master-styles", "style:master-page") if external => "master",
                        ("office:automatic-styles", "style:page-layout") if external || !legacy => {
                            "layout"
                        }
                        ("office:automatic-styles", "style:page-master") if external || legacy => {
                            "layout"
                        }
                        _ => continue,
                    };
                    // Print lookup uses the first definition, including unnamed ones,
                    // and ignores family and parent-style inheritance.
                    let key = (kind, attr(el, "style:name"));
                    if let std::collections::btree_map::Entry::Vacant(entry) = nodes.entry(key) {
                        *remaining = remaining.checked_sub(96).ok_or(LIMIT)?;
                        entry.insert((el, external || !legacy));
                    }
                }
            }
        }
        Ok(Self { nodes })
    }

    pub fn sheet(&self, name: Option<&str>) -> Print {
        let mut print = Print::default();
        let style = self.nodes.get(&("style", name));
        let master = self.nodes.get(&(
            "master",
            style.and_then(|(n, _)| attr(n, "style:master-page-name")),
        ));
        let layout = self.nodes.get(&(
            "layout",
            master.and_then(|(n, _)| attr(n, "style:page-layout-name")),
        ));
        let Some((layout, true)) = layout else {
            return print;
        };
        for node in &layout.children {
            let Node::Element(p) = node else { continue };
            if !matches!(p.tag.as_str(), "style:header-style" | "style:footer-style")
                && p.tag
                    != if layout.tag == "style:page-master" {
                        "style:properties"
                    } else {
                        "style:page-layout-properties"
                    }
            {
                continue;
            }
            if print.orientation.is_none() {
                print.orientation = match attr(p, "style:print-orientation") {
                    Some("portrait") => Some("portrait"),
                    Some("landscape") => Some("landscape"),
                    _ => None,
                };
            }
            if print.margins.is_none() {
                let margins = [
                    "fo:margin-left",
                    "fo:margin-right",
                    "fo:margin-top",
                    "fo:margin-bottom",
                ]
                .map(|side| distance(attr(p, side).or_else(|| attr(p, "fo:margin"))));
                if margins.iter().any(Option::is_some) {
                    print.margins = Some(margins);
                }
            }
            if print.scale.is_none() {
                let pages = attr(p, "style:scale-to-pages");
                let x = attr(p, "style:scale-to-X")
                    .or_else(|| attr(p, "gnm:scale-to-X"))
                    .or(pages);
                let y = attr(p, "style:scale-to-Y")
                    .or_else(|| attr(p, "gnm:scale-to-Y"))
                    .or(pages);
                if x.is_some_and(|s| !s.is_empty()) || y.is_some_and(|s| !s.is_empty()) {
                    print.scale = Some(Scale::Fit(
                        js_number(x.unwrap_or("0"), 0.),
                        js_number(y.unwrap_or("0"), 0.),
                    ));
                } else if let Some(scale) =
                    attr(p, "style:scale-to").and_then(|s| s.strip_suffix('%'))
                {
                    print.scale = Some(Scale::Percentage(js_number(scale, 0.)));
                }
            }
        }
        print
    }
}

impl Styles<'_> {
    pub fn gnumeric(
        &self,
        table: &Element,
        legacy: bool,
        remaining: &mut usize,
    ) -> Result<Option<Element>, String> {
        let style = self.nodes.get(&("style", attr(table, "table:style-name")));
        let master = self.nodes.get(&(
            "master",
            style.and_then(|(n, _)| attr(n, "style:master-page-name")),
        ));
        let layout = self.nodes.get(&(
            "layout",
            master.and_then(|(n, _)| attr(n, "style:page-layout-name")),
        ));
        let node_record = |name: &str, attrs: Vec<(&str, String)>, children: Vec<Node>| Element {
            tag: format!("gnm:{name}"),
            namespace: "http://www.gnumeric.org/v10.dtd".into(),
            attrs: attrs.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            self_closing: children.is_empty(),
            children,
        };
        let mut content = Vec::new();
        let mut row = 0usize;
        let mut pending = vec![(table, None)];
        while let Some((node, start)) = pending.pop() {
            if let Some(start) = start {
                if row > start {
                    content.push(Node::Element(node_record(
                        "repeat_top",
                        vec![("value", format!("${}:${row}", start + 1))],
                        vec![],
                    )));
                }
            } else if node.tag == "table:table-row" {
                row = row
                    .checked_add(super::count(attr(node, "table:number-rows-repeated"))?)
                    .ok_or(LIMIT)?;
            } else {
                if node.tag == "table:table-header-rows" {
                    pending.push((node, Some(row)));
                }
                pending.extend(node.children.iter().rev().filter_map(|n| match n {
                    Node::Element(e)
                        if super::styles::axis_child(&node.tag, &e.tag, legacy)
                            && matches!(
                                e.tag.as_str(),
                                "table:table-row"
                                    | "table:table-row-group"
                                    | "table:table-rows"
                                    | "table:table-header-rows"
                            ) =>
                    {
                        Some((e, None))
                    }
                    _ => None,
                }));
            }
        }
        for p in layout
            .filter(|(_, accepted)| *accepted)
            .into_iter()
            .flat_map(|(layout, _)| {
                layout.children.iter().filter_map(move |n| match n {
                    Node::Element(p)
                        if matches!(
                            p.tag.as_str(),
                            "style:header-style" | "style:footer-style"
                        ) || p.tag
                            == if layout.tag == "style:page-master" {
                                "style:properties"
                            } else {
                                "style:page-layout-properties"
                            } =>
                    {
                        Some(p)
                    }
                    _ => None,
                })
            })
        {
            if let Some(orientation @ ("portrait" | "landscape")) =
                attr(p, "style:print-orientation")
            {
                content.push(Node::Element(node_record(
                    "orientation",
                    vec![],
                    vec![Node::Text(orientation.into(), None)],
                )));
            }
            let mut margins = Vec::new();
            for side in ["top", "bottom", "left", "right"] {
                if let Some(points) =
                    distance(attr(p, &format!("fo:margin-{side}")).or_else(|| attr(p, "fo:margin")))
                {
                    margins.push(Node::Element(node_record(
                        side,
                        vec![
                            (
                                "Points",
                                crate::commands::structured::xlsx::attribute_number(points),
                            ),
                            ("PrefUnit", "cm".into()),
                        ],
                        vec![],
                    )));
                }
            }
            if !margins.is_empty() {
                content.push(Node::Element(node_record("Margins", vec![], margins)));
            }
            let pages = attr(p, "style:scale-to-pages");
            let x = attr(p, "style:scale-to-X")
                .or_else(|| attr(p, "gnm:scale-to-X"))
                .or(pages);
            let y = attr(p, "style:scale-to-Y")
                .or_else(|| attr(p, "gnm:scale-to-Y"))
                .or(pages);
            if x.is_some_and(|v| !v.is_empty()) || y.is_some_and(|v| !v.is_empty()) {
                content.push(Node::Element(node_record(
                    "Scale",
                    vec![
                        ("type", "fit".into()),
                        ("cols", x.unwrap_or("0").into()),
                        ("rows", y.unwrap_or("0").into()),
                    ],
                    vec![],
                )));
            } else if let Some(scale) = attr(p, "style:scale-to").and_then(|s| s.strip_suffix('%'))
            {
                content.push(Node::Element(node_record(
                    "Scale",
                    vec![("type", "percentage".into()), ("percentage", scale.into())],
                    vec![],
                )));
            }
        }
        if content.is_empty() {
            return Ok(None);
        }
        let print = node_record("PrintInformation", vec![], content);
        let mut pending = vec![&print];
        while let Some(node) = pending.pop() {
            *remaining = remaining
                .checked_sub(
                    128 + node
                        .attrs
                        .iter()
                        .map(|(k, v)| k.len() + v.len())
                        .sum::<usize>(),
                )
                .ok_or(LIMIT)?;
            pending.extend(node.children.iter().filter_map(|n| {
                if let Node::Element(e) = n {
                    Some(e)
                } else {
                    None
                }
            }));
        }
        Ok(Some(print))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_definitions_obey_the_import_budget() {
        let mut source = String::from(
            r#"<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles>"#,
        );
        for i in 0..3000 {
            source.push_str(&format!(
                "<style:page-layout style:name=\"{i}\"><style:page-layout-properties style:print-orientation=\"landscape\"/></style:page-layout>"
            ));
        }
        source.push_str("<style:style style:name=\"Table\" style:master-page-name=\"Master\"/></office:automatic-styles><office:master-styles><style:master-page style:name=\"Master\" style:page-layout-name=\"2999\"/></office:master-styles></office:document-styles>");
        let doc = crate::commands::structured::xml::parse(&source, None, None).unwrap();
        let root = doc
            .nodes
            .iter()
            .find_map(|n| {
                if let Node::Element(e) = n {
                    Some(e)
                } else {
                    None
                }
            })
            .unwrap();
        assert!(Styles::read(&[root], false, &mut 4096).is_err());
        let styles = Styles::read(&[root], false, &mut 1_000_000).unwrap();
        assert_eq!(styles.sheet(Some("Table")).orientation, Some("landscape"));
        assert_eq!(styles.sheet(Some("missing")).orientation, None);
    }
}
