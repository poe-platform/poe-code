use super::{INVALID, LIMIT, attr, elements, serialize, xml};
use crate::commands::spreadsheet::office_xml::decode;
use std::collections::BTreeMap;

// Keep document properties and existing package paths while identifying the
// exporter. Calc uses this identity when deciding whether to trust formula caches.
pub(super) fn write(
    entries: &mut BTreeMap<String, Vec<u8>>,
    imported_path: Option<&str>,
    work: &mut usize,
    limit: usize,
) -> Result<(), String> {
    let path = imported_path.unwrap_or("/docProps/app.xml");
    let template = include_str!("xlsx/app-libreoffice.xml");
    let native = xml::parse(template, None, None).map_err(|_| INVALID)?;
    let source = entries
        .get(path.trim_start_matches('/'))
        .map(|bytes| decode(bytes))
        .transpose()
        .map_err(|_| INVALID)?;
    let source = source.as_deref().unwrap_or(template);
    *work = work
        .checked_sub(
            source
                .len()
                .checked_mul(3)
                .and_then(|n| n.checked_add(512))
                .ok_or(LIMIT)?,
        )
        .ok_or(LIMIT)?;
    let mut doc = xml::parse(source, None, None).map_err(|_| INVALID)?;
    let root = super::formats::root(&mut doc)?;
    let prefix = root
        .tag
        .strip_suffix("Properties")
        .ok_or(INVALID)?
        .to_owned();
    for name in ["Application", "AppVersion"] {
        let value = super::super::text(elements(&native.nodes, name)[0]);
        let mut found = false;
        for node in &mut root.children {
            if let xml::Node::Element(el) = node
                && el.tag.rsplit(':').next() == Some(name)
            {
                el.children = vec![xml::Node::Text(value.clone(), None)];
                found = true;
            }
        }
        if !found {
            root.children.push(xml::Node::Element(xml::Element {
                namespace: String::new(),
                self_closing: false,
                tag: format!("{prefix}{name}"),
                attrs: Vec::new(),
                children: vec![xml::Node::Text(value, None)],
            }));
        }
    }
    entries.insert(path.trim_start_matches('/').into(), serialize(&doc, limit)?);

    if imported_path.is_none() {
        let source = entries
            .get("_rels/.rels")
            .map(|bytes| decode(bytes))
            .transpose()
            .map_err(|_| INVALID)?;
        let source = source.as_deref().unwrap_or(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#);
        *work = work
            .checked_sub(
                source
                    .len()
                    .checked_mul(3)
                    .and_then(|n| n.checked_add(512))
                    .ok_or(LIMIT)?,
            )
            .ok_or(LIMIT)?;
        let mut doc = xml::parse(source, None, None).map_err(|_| INVALID)?;
        let root = super::formats::root(&mut doc)?;
        let prefix = root.tag.strip_suffix("Relationships").ok_or(INVALID)?;
        let existing = elements(&root.children, "Relationship");
        let mut number = 1;
        loop {
            *work = work.checked_sub(existing.len() + 1).ok_or(LIMIT)?;
            if !existing
                .iter()
                .any(|el| attr(el, "Id") == Some(&format!("rId{number}")))
            {
                break;
            }
            number += 1;
        }
        root.children.push(xml::Node::Element(xml::Element {
                namespace: String::new(),
                self_closing: false,
            tag: format!("{prefix}Relationship"),
            attrs: vec![
                ("Id".into(), format!("rId{number}")),
                ("Type".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties".into()),
                ("Target".into(), path.trim_start_matches('/').into()),
            ], children: Vec::new(),
        }));
        entries.insert("_rels/.rels".into(), serialize(&doc, limit)?);
    }
    let source = entries
        .get("[Content_Types].xml")
        .map(|bytes| decode(bytes))
        .transpose()
        .map_err(|_| INVALID)?;
    let source = source.as_deref().unwrap_or(
        r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#,
    );
    *work = work
        .checked_sub(
            source
                .len()
                .checked_mul(3)
                .and_then(|n| n.checked_add(512))
                .ok_or(LIMIT)?,
        )
        .ok_or(LIMIT)?;
    let mut doc = xml::parse(source, None, None).map_err(|_| INVALID)?;
    let root = super::formats::root(&mut doc)?;
    if !elements(&root.children, "Override")
        .iter()
        .any(|el| attr(el, "PartName") == Some(path))
    {
        let prefix = root.tag.strip_suffix("Types").ok_or(INVALID)?;
        root.children.push(xml::Node::Element(xml::Element {
            namespace: String::new(),
            self_closing: false,
            tag: format!("{prefix}Override"),
            attrs: vec![
                ("PartName".into(), path.into()),
                (
                    "ContentType".into(),
                    "application/vnd.openxmlformats-officedocument.extended-properties+xml".into(),
                ),
            ],
            children: Vec::new(),
        }));
        entries.insert("[Content_Types].xml".into(), serialize(&doc, limit)?);
    }
    Ok(())
}
