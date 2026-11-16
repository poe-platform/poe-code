use super::{XmlElement, XmlNode, xml};
use std::collections::BTreeMap;

pub(super) fn attr<'a>(element: &'a XmlElement, name: &str) -> Option<&'a str> {
    element.attrs.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
}

pub(super) fn children<'a>(element: &'a XmlElement, name: &'a str) -> impl Iterator<Item = &'a XmlElement> {
    element.children.iter().filter_map(move |node| match node {
        XmlNode::Element(child) if child.tag == name => Some(child),
        _ => None,
    })
}

pub(super) fn text(element: &XmlElement) -> String {
    element.children.iter().filter_map(|node| match node {
        XmlNode::Text(value, _) | XmlNode::Cdata(value) => Some(value.as_str()),
        _ => None,
    }).collect()
}

// Canonicalize aliases with scoped namespace bindings. Foreign elements must
// not become worksheet cells or shared text merely by reusing a local name.
fn normalize(element: &mut XmlElement, bindings: &mut BTreeMap<String, String>, depth: usize) -> Result<(), String> {
    if depth > 64 { return Err("XLSX XML nesting limit exceeded".into()); }
    let mut previous = Vec::new();
    for (key, value) in &element.attrs {
        if key == "xmlns" || key.starts_with("xmlns:") {
            let prefix = key.strip_prefix("xmlns:").unwrap_or("").to_owned();
            previous.push((prefix.clone(), bindings.insert(prefix, value.clone())));
        }
    }
    let (prefix, local) = element.tag.split_once(':').unwrap_or(("", &element.tag));
    let namespace = bindings.get(prefix).map(String::as_str).unwrap_or(if prefix.is_empty() { "" } else { "unknown" });
    element.tag = match namespace {
        "" | "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        | "http://purl.oclc.org/ooxml/spreadsheetml/main"
        | "http://schemas.openxmlformats.org/package/2006/relationships" => local.to_owned(),
        _ => format!("foreign:{local}"),
    };
    for (name, _) in &mut element.attrs {
        if let Some((prefix, local)) = name.split_once(':') {
            if matches!(bindings.get(prefix).map(String::as_str),
                Some("http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                    | "http://purl.oclc.org/ooxml/officeDocument/relationships")) {
                *name = format!("r:{local}");
            }
        }
    }
    for node in &mut element.children {
        if let XmlNode::Element(child) = node { normalize(child, bindings, depth + 1)?; }
    }
    for (prefix, old) in previous.into_iter().rev() {
        if let Some(value) = old { bindings.insert(prefix, value); }
        else { bindings.remove(&prefix); }
    }
    Ok(())
}

pub(super) fn root(source: &str, name: &str) -> Result<XmlElement, String> {
    let doc = xml::parse(source, None, None).map_err(|error| format!("invalid XLSX XML: {error}"))?;
    let mut root = doc.nodes.into_iter().find_map(|node| match node {
        XmlNode::Element(element) => Some(element), _ => None,
    }).ok_or("missing XLSX XML root")?;
    normalize(&mut root, &mut BTreeMap::new(), 1)?;
    if root.tag != name { return Err(format!("invalid XLSX XML root: expected {name}")); }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xlsx_xml_decodes_references_and_scoped_namespace_aliases() {
        let root = root(r#"<s:sst xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><s:si><s:t>&#x1F680; &amp; &#233;</s:t><s:r><s:t>tail</s:t></s:r><s:r xmlns:s="urn:foreign"><s:t>ignore</s:t></s:r><s:r><s:t>end</s:t></s:r></s:si></s:sst>"#, "sst").unwrap();
        let si = children(&root, "si").next().unwrap();
        assert_eq!(text(children(si, "t").next().unwrap()), "🚀 & é");
        assert_eq!(children(si, "r").flat_map(|r| children(r, "t")).map(text).collect::<String>(), "tailend");
    }

    #[test]
    fn xlsx_xml_rejects_invalid_xml_and_foreign_roots() {
        for source in ["<sst>", "<sst><si>&bad;</si></sst>", "<sst xmlns='urn:foreign'/>"] {
            assert!(root(source, "sst").is_err());
        }
    }
}
