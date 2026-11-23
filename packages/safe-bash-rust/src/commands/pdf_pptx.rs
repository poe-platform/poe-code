use crate::commands::{codecs, structured::xml};
use std::{borrow::Cow, collections::BTreeMap};

pub(super) fn elements<'a>(nodes: &'a [xml::Node], name: &str) -> Vec<&'a xml::Element> {
    let mut pending: Vec<_> = nodes.iter().rev().collect();
    let mut found = Vec::new();
    while let Some(node) = pending.pop() {
        if let xml::Node::Element(element) = node {
            if element.tag.rsplit(':').next() == Some(name) {
                found.push(element);
            }
            pending.extend(element.children.iter().rev());
        }
    }
    found
}
fn attr<'a>(element: &'a xml::Element, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}
pub(super) fn document(entries: &BTreeMap<String, Vec<u8>>, name: &str) -> Option<xml::Document> {
    xml::parse(&super::super::office_xml::decode(entries.get(name)?).ok()?, None, None).ok()
}
pub(super) fn relationships(
    entries: &BTreeMap<String, Vec<u8>>,
    owner: &str,
) -> Option<BTreeMap<String, String>> {
    let (directory, file) = owner.rsplit_once('/')?;
    let name = format!("{directory}/_rels/{file}.rels");
    if !entries.contains_key(&name) {
        return Some(BTreeMap::new());
    }
    let doc = document(entries, &name)?;
    let mut targets = BTreeMap::new();
    for rel in elements(&doc.nodes, "Relationship") {
        if attr(rel, "TargetMode") == Some("External") {
            continue;
        }
        let target = crate::vfs::resolve_posix_path(&format!("/{directory}"), attr(rel, "Target")?);
        targets.insert(
            attr(rel, "Id")?.to_owned(),
            target.trim_start_matches('/').to_owned(),
        );
    }
    Some(targets)
}

pub(super) fn archive(bytes: &[u8], limit: usize) -> Option<BTreeMap<String, Vec<u8>>> {
    let (members, _) =
        codecs::zip_directory(bytes.len(), |range| Ok(Cow::Borrowed(&bytes[range]))).ok()?;
    let mut entries = BTreeMap::new();
    let mut remaining = limit;
    for member in members {
        remaining = remaining.checked_sub(member.size)?;
        let data = member
            .decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)
            .ok()?
            .into_owned();
        if entries.insert(member.name, data).is_some() {
            return None;
        }
    }
    Some(entries)
}
