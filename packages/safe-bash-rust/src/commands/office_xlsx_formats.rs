use super::{INVALID, LIMIT, attr, elements, serialize, xml};
use crate::commands::archive::office_xml::decode;
use std::collections::BTreeMap;

pub(super) struct Formats {
    doc: xml::Document,
    indexes: BTreeMap<(usize, String), usize>,
    remaining: usize,
    source_size: usize,
}

impl Formats {
    pub(super) fn new(source: Option<&[u8]>, remaining: usize) -> Result<Self, String> {
        let source = source.unwrap_or(include_bytes!("office-xlsx-styles.xml"));
        Ok(Self {
            doc: xml::parse(&decode(source).map_err(|_| INVALID)?, None, None)
                .map_err(|_| INVALID)?,
            indexes: BTreeMap::new(),
            remaining,
            source_size: source.len(),
        })
    }

    pub(super) fn changed(&self) -> bool {
        !self.indexes.is_empty()
    }

    pub(super) fn index(&mut self, base: usize, format: &str) -> Result<usize, String> {
        let key = (base, format.to_owned());
        if let Some(&index) = self.indexes.get(&key) {
            return Ok(index);
        }
        self.remaining = self
            .remaining
            .checked_sub(self.source_size + format.len() + 512)
            .ok_or(LIMIT)?;
        let root = root(&mut self.doc)?;
        let prefix = root
            .tag
            .strip_suffix("styleSheet")
            .ok_or(INVALID)?
            .to_owned();
        let formats = collection(root, "numFmts", &prefix);
        let id = if let Some(id) = elements(&formats.children, "numFmt")
            .iter()
            .find(|el| attr(el, "formatCode") == Some(format))
            .and_then(|el| attr(el, "numFmtId"))
            .and_then(|id| id.parse::<usize>().ok())
        {
            id
        } else {
            let id = elements(&formats.children, "numFmt")
                .iter()
                .filter_map(|el| attr(el, "numFmtId").and_then(|id| id.parse::<usize>().ok()))
                .max()
                .unwrap_or(163)
                .max(163)
                .checked_add(1)
                .ok_or(LIMIT)?;
            formats.children.push(xml::Node::Element(xml::Element {
                namespace: String::new(),
                tag: format!("{prefix}numFmt"),
                attrs: vec![
                    ("numFmtId".into(), id.to_string()),
                    ("formatCode".into(), format.into()),
                ],
                children: Vec::new(),
                self_closing: true,
            }));
            count(formats, "numFmt");
            id
        };
        let xfs = collection(root, "cellXfs", &prefix);
        if elements(&xfs.children, "xf").is_empty() {
            xfs.children.push(xml::Node::Element(xml::Element {
                namespace: String::new(),
                tag: format!("{prefix}xf"),
                attrs: vec![("numFmtId".into(), "0".into())],
                children: Vec::new(),
                self_closing: true,
            }));
        }
        let existing = elements(&xfs.children, "xf");
        let mut xf = (*existing.get(base).unwrap_or(&existing[0])).clone();
        let index = existing.len();
        xf.attrs
            .retain(|(key, _)| !matches!(key.as_str(), "numFmtId" | "applyNumberFormat"));
        xf.attrs.extend([
            ("numFmtId".into(), id.to_string()),
            ("applyNumberFormat".into(), "1".into()),
        ]);
        xfs.children.push(xml::Node::Element(xf));
        count(xfs, "xf");
        self.indexes.insert(key, index);
        Ok(index)
    }

    pub(super) fn write(
        self,
        entries: &mut BTreeMap<String, Vec<u8>>,
        workbook: &str,
        path: &str,
        limit: usize,
    ) -> Result<(), String> {
        entries.insert(
            path.trim_start_matches('/').into(),
            serialize(&self.doc, limit)?,
        );
        let (directory, filename) = workbook.rsplit_once('/').ok_or(INVALID)?;
        let rel_path = format!("{directory}/_rels/{filename}.rels");
        let rel_path = rel_path.trim_start_matches('/');
        let mut rels = xml::parse(entries.get(rel_path).map(|bytes| decode(bytes))
            .transpose().map_err(|_| INVALID)?.as_deref().unwrap_or(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#), None, None).map_err(|_| INVALID)?;
        let rels_root = root(&mut rels)?;
        if !elements(&rels_root.children, "Relationship")
            .iter()
            .any(|el| {
                attr(el, "Type").is_some_and(|t| t.ends_with("/styles"))
                    && attr(el, "TargetMode") != Some("External")
            })
        {
            let existing = elements(&rels_root.children, "Relationship");
            let mut number = 1usize;
            while existing
                .iter()
                .any(|el| attr(el, "Id") == Some(&format!("rId{number}")))
            {
                number += 1;
            }
            let prefix = rels_root.tag.strip_suffix("Relationships").ok_or(INVALID)?;
            let target = path.strip_prefix(&format!("{directory}/")).unwrap_or(path);
            rels_root.children.push(xml::Node::Element(xml::Element {
                namespace: String::new(),
                tag: format!("{prefix}Relationship"),
                attrs: vec![("Id".into(), format!("rId{number}")), ("Type".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles".into()), ("Target".into(), target.into())],
                children: Vec::new(),
                self_closing: true,
            }));
            rels_root.self_closing = false;
            entries.insert(rel_path.into(), serialize(&rels, limit)?);
        }
        let mut types = xml::parse(entries.get("[Content_Types].xml").map(|bytes| decode(bytes))
            .transpose().map_err(|_| INVALID)?.as_deref().unwrap_or(r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#), None, None).map_err(|_| INVALID)?;
        let types_root = root(&mut types)?;
        if !elements(&types_root.children, "Override")
            .iter()
            .any(|el| attr(el, "PartName") == Some(path))
        {
            let prefix = types_root.tag.strip_suffix("Types").ok_or(INVALID)?;
            types_root.children.push(xml::Node::Element(xml::Element {
                namespace: String::new(),
                tag: format!("{prefix}Override"),
                attrs: vec![
                    ("PartName".into(), path.into()),
                    (
                        "ContentType".into(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"
                            .into(),
                    ),
                ],
                children: Vec::new(),
                self_closing: true,
            }));
            types_root.self_closing = false;
            entries.insert("[Content_Types].xml".into(), serialize(&types, limit)?);
        }
        Ok(())
    }
}

pub(super) fn root(doc: &mut xml::Document) -> Result<&mut xml::Element, String> {
    doc.nodes
        .iter_mut()
        .find_map(|node| match node {
            xml::Node::Element(el) => Some(el),
            _ => None,
        })
        .ok_or_else(|| INVALID.into())
}

fn collection<'a>(root: &'a mut xml::Element, tag: &str, prefix: &str) -> &'a mut xml::Element {
    let index = root.children.iter().position(|node| matches!(node, xml::Node::Element(el) if el.tag.rsplit(':').next() == Some(tag)))
        .unwrap_or_else(|| {
            let at = if tag == "numFmts" { 0 } else { root.children.iter().position(|node| matches!(node, xml::Node::Element(el) if matches!(el.tag.rsplit(':').next(), Some("cellStyles" | "dxfs" | "tableStyles" | "colors" | "extLst")))).unwrap_or(root.children.len()) };
            root.children.insert(at, xml::Node::Element(xml::Element {
                namespace: String::new(),
                tag: format!("{prefix}{tag}"), attrs: Vec::new(), children: Vec::new(), self_closing: false,
            }));
            at
        });
    root.self_closing = false;
    let xml::Node::Element(el) = &mut root.children[index] else {
        unreachable!()
    };
    el.self_closing = false;
    el
}

fn count(el: &mut xml::Element, tag: &str) {
    let count = elements(&el.children, tag).len();
    el.attrs.retain(|(key, _)| key != "count");
    el.attrs.push(("count".into(), count.to_string()));
}
