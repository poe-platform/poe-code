use super::{PandocBlock, XmlElement, XmlNode, parse_pandoc_html, serialize_xml_pretty, xml};
use crate::commands::codecs::zip_directory;
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

type Error = (i32, &'static str);
const INVALID: Error = (1, "pandoc: invalid EPUB archive or referenced XML part\n");
const LIMIT: Error = (1, "pandoc: EPUB input or nesting limit exceeded\n");

fn attr<'a>(element: &'a XmlElement, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn children<'a>(element: &'a XmlElement, tag: &'a str) -> impl Iterator<Item = &'a XmlElement> {
    element.children.iter().filter_map(move |node| match node {
        XmlNode::Element(child) if child.tag == tag => Some(child),
        _ => None,
    })
}

fn child<'a>(element: &'a XmlElement, tag: &str) -> Result<&'a XmlElement, Error> {
    let mut found = element.children.iter().filter_map(|node| match node {
        XmlNode::Element(child) if child.tag == tag => Some(child),
        _ => None,
    });
    let result = found.next().ok_or(INVALID)?;
    if found.next().is_some() {
        return Err(INVALID);
    }
    Ok(result)
}

// Resolve namespace aliases once, with scoped bindings and bounded recursion. XHTML
// names become HTML names for the existing Pandoc HTML reader.
fn normalize(
    element: &mut XmlElement,
    namespaces: &mut HashMap<String, String>,
    depth: usize,
) -> Result<(), Error> {
    if depth > 64 {
        return Err(LIMIT);
    }
    let mut previous = Vec::new();
    for (key, value) in &element.attrs {
        if key == "xmlns" || key.starts_with("xmlns:") {
            let prefix = key.strip_prefix("xmlns:").unwrap_or("").to_owned();
            let old = namespaces.insert(prefix.clone(), value.clone());
            previous.push((prefix, old));
        }
    }
    let (prefix, local) = element.tag.split_once(':').unwrap_or(("", &element.tag));
    let canonical = match namespaces.get(prefix).map(String::as_str) {
        Some("urn:oasis:names:tc:opendocument:xmlns:container") => "container:",
        Some("http://www.idpf.org/2007/opf") => "opf:",
        Some("http://www.w3.org/1999/xhtml") => "",
        _ => "foreign:",
    };
    element.tag = format!("{canonical}{local}");
    for node in &mut element.children {
        if let XmlNode::Element(child) = node {
            normalize(child, namespaces, depth + 1)?;
        }
    }
    for (prefix, old) in previous.into_iter().rev() {
        if let Some(value) = old {
            namespaces.insert(prefix, value);
        } else {
            namespaces.remove(&prefix);
        }
    }
    Ok(())
}

fn root(bytes: &[u8], tag: &str) -> Result<XmlElement, Error> {
    let doc = xml::parse(std::str::from_utf8(bytes).map_err(|_| INVALID)?, None, None)
        .map_err(|_| INVALID)?;
    let mut root = doc
        .nodes
        .into_iter()
        .find_map(|node| match node {
            XmlNode::Element(element) => Some(element),
            _ => None,
        })
        .ok_or(INVALID)?;
    normalize(&mut root, &mut HashMap::new(), 1)?;
    if root.tag != tag {
        return Err(INVALID);
    }
    Ok(root)
}

fn resolve(base: &str, href: &str) -> Result<String, Error> {
    if href.is_empty() || href.starts_with('/') || href.contains([':', '\\', '?', '#']) {
        return Err(INVALID);
    }
    let mut parts: Vec<String> = base.rsplit_once('/').map_or(Vec::new(), |(dir, _)| {
        dir.split('/').map(String::from).collect()
    });
    for raw in href.split('/') {
        let mut bytes = Vec::new();
        let mut source = raw.bytes();
        while let Some(byte) = source.next() {
            bytes.push(if byte == b'%' {
                let high = (source.next().ok_or(INVALID)? as char)
                    .to_digit(16)
                    .ok_or(INVALID)?;
                let low = (source.next().ok_or(INVALID)? as char)
                    .to_digit(16)
                    .ok_or(INVALID)?;
                (high * 16 + low) as u8
            } else {
                byte
            });
        }
        let part = String::from_utf8(bytes).map_err(|_| INVALID)?;
        if part.contains(['/', '\\', ':']) || part.chars().any(char::is_control) {
            return Err(INVALID);
        }
        match part.as_str() {
            "" | "." => {}
            ".." => {
                parts.pop().ok_or(INVALID)?;
            }
            _ => parts.push(part),
        }
    }
    if parts.is_empty() {
        return Err(INVALID);
    }
    Ok(parts.join("/"))
}

pub(super) fn read(data: &[u8], limit: usize) -> Result<Vec<PandocBlock>, Error> {
    if data.len() > limit {
        return Err(LIMIT);
    }
    let (members, _) =
        zip_directory(data.len(), |range| Ok(Cow::Borrowed(&data[range]))).map_err(|_| INVALID)?;
    let mut archive = HashMap::new();
    let mut remaining = limit;
    for member in &members {
        remaining = remaining.checked_sub(member.size).ok_or(LIMIT)?;
        if member.name.starts_with('/')
            || member.name.contains(['\\', ':'])
            || member.name.chars().any(char::is_control)
            || member
                .name
                .trim_end_matches('/')
                .split('/')
                .any(|part| matches!(part, "" | "." | ".."))
            || archive.insert(member.name.as_str(), member).is_some()
        {
            return Err(INVALID);
        }
    }
    let part = |name: &str| -> Result<Cow<'_, [u8]>, Error> {
        let member = archive.get(name).ok_or(INVALID)?;
        if !matches!(member.method, 0 | 8) || member.typeflag != b'0' {
            return Err(INVALID);
        }
        member
            .decode(Cow::Borrowed(&data[member.payload.clone()]), None)
            .map_err(|_| INVALID)
    };
    if part("mimetype")?.as_ref() != b"application/epub+zip" {
        return Err(INVALID);
    }
    let container = root(&part("META-INF/container.xml")?, "container:container")?;
    let rootfiles = child(&container, "container:rootfiles")?;
    let rootfile = children(rootfiles, "container:rootfile")
        .find(|node| attr(node, "media-type") == Some("application/oebps-package+xml"))
        .ok_or(INVALID)?;
    let package_path = resolve("", attr(rootfile, "full-path").ok_or(INVALID)?)?;
    let package = root(&part(&package_path)?, "opf:package")?;
    let mut manifest = HashMap::new();
    let mut paths = HashSet::new();
    for item in children(child(&package, "opf:manifest")?, "opf:item") {
        let id = attr(item, "id")
            .filter(|id| !id.is_empty())
            .ok_or(INVALID)?;
        let path = resolve(&package_path, attr(item, "href").ok_or(INVALID)?)?;
        if !paths.insert(path.clone())
            || manifest
                .insert(id, (path, attr(item, "media-type")))
                .is_some()
        {
            return Err(INVALID);
        }
    }
    let mut seen = HashSet::new();
    let mut blocks = Vec::new();
    for item in children(child(&package, "opf:spine")?, "opf:itemref") {
        let id = attr(item, "idref").ok_or(INVALID)?;
        let (path, media) = manifest.get(id).ok_or(INVALID)?;
        if !seen.insert(id)
            || *media != Some("application/xhtml+xml")
            || !matches!(attr(item, "linear"), None | Some("yes" | "no"))
        {
            return Err(INVALID);
        }
        let chapter = root(&part(path)?, "html")?;
        let body = child(&chapter, "body")?;
        let mut html = String::new();
        serialize_xml_pretty(body, false, xml::Escaping::Unicode, &mut html)
            .map_err(|_| INVALID)?;
        blocks.extend(parse_pandoc_html(&html));
    }
    if seen.is_empty() {
        return Err(INVALID);
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::super::{cmd_pandoc, write_zip_stored};
    use crate::vfs::{MemoryVfs, SafeBashFs};

    fn book() -> Vec<(&'static str, String)> {
        vec![
            ("mimetype", "application/epub+zip".into()),
            ("META-INF/container.xml", r#"<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#.into()),
            ("Book/package.opf", r#"<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="two" href="Text/two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="Text/../Text/one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>"#.into()),
            ("Book/Text/two.xhtml", r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>SECOND CHAPTER</p></body></html>"#.into()),
            ("Book/Text/one.xhtml", r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>FIRST CHAPTER</p></body></html>"#.into()),
            ("__pandoc_source.md", "WRONG PRIVATE HINT".into()),
        ]
    }

    fn archive(parts: &[(&str, String)]) -> Vec<u8> {
        write_zip_stored(
            &parts
                .iter()
                .map(|(name, text)| (*name, text.as_bytes()))
                .collect::<Vec<_>>(),
        )
    }

    fn run(bytes: &[u8]) -> (super::super::BuiltinOutcome, Vec<u8>) {
        let fs = MemoryVfs::new();
        fs.write_file("/book.epub", bytes).unwrap();
        fs.write_file("/out.txt", b"KEEP").unwrap();
        let args = ["-f", "epub", "-t", "plain", "/book.epub", "-o", "/out.txt"].map(String::from);
        let result = cmd_pandoc(&args, "", "/", &fs);
        (result, fs.read_file("/out.txt").unwrap())
    }

    #[test]
    fn epub_reads_standard_spine_not_archive_order_or_private_hint() {
        let (result, output) = run(&archive(&book()));
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(output, b"FIRST CHAPTER\n\nSECOND CHAPTER\n");
    }

    #[test]
    fn epub_resolves_namespace_aliases_and_encoded_relative_paths() {
        let mut parts = book();
        parts[2].1 = parts[2]
            .1
            .replace("Text/../Text/one.xhtml", "Text/%6fne.xhtml")
            .replace("<package xmlns=", "<p:package xmlns:p=")
            .replace("</package>", "</p:package>");
        for tag in ["manifest", "item", "spine", "itemref"] {
            parts[2].1 = parts[2]
                .1
                .replace(&format!("<{tag}"), &format!("<p:{tag}"))
                .replace(&format!("</{tag}>"), &format!("</p:{tag}>"));
        }
        let (result, output) = run(&archive(&parts));
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(output, b"FIRST CHAPTER\n\nSECOND CHAPTER\n");
    }

    #[test]
    fn epub_bounds_expanded_archive_bytes() {
        use crate::commands::codecs::{ZipRecords, encode_zip_members, read_zip_members};
        let mut parts = book();
        parts[4].1 = format!(
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>{}</p></body></html>",
            "text ".repeat(4000)
        );
        let members = read_zip_members(&archive(&parts), None).unwrap();
        let compressed = encode_zip_members(
            &members,
            (8, 6),
            &[],
            false,
            (false, None),
            &ZipRecords::new(),
            |_, _, _, _| true,
        );
        assert!(compressed.len() < 4096);
        assert!(matches!(super::read(&compressed, 4096), Err(super::LIMIT)));
        assert_eq!(run(&compressed).0.exit_code, 0);
    }

    #[test]
    fn epub_rejects_invalid_parts_before_publication() {
        let mut cases = vec![b"not an EPUB archive".to_vec()];
        for index in [1, 2, 3, 4] {
            let mut parts = book();
            parts.remove(index);
            cases.push(archive(&parts));
            let mut parts = book();
            parts[index].1 = "<broken>".into();
            cases.push(archive(&parts));
        }
        for (from, to) in [
            ("id=\"two\"", "id=\"one\""),
            ("idref=\"two\"", "idref=\"one\""),
            ("idref=\"two\"", "idref=\"missing\""),
            ("Text/two.xhtml", "Text/../Text/one.xhtml"),
            ("Text/two.xhtml", "../../outside.xhtml"),
            ("<spine>", "<spine/><spine>"),
        ] {
            let mut parts = book();
            parts[2].1 = parts[2].1.replace(from, to);
            cases.push(archive(&parts));
        }
        for source in [
            "<!DOCTYPE html [<!ENTITY secret SYSTEM 'file:///secret'>]><html/>",
            "<html xmlns=\"wrong\"><body>wrong namespace</body></html>",
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body/><body/></html>",
        ] {
            let mut parts = book();
            parts[4].1 = source.into();
            cases.push(archive(&parts));
        }
        let mut corrupt = archive(&book());
        let offset = corrupt
            .windows(13)
            .position(|bytes| bytes == b"FIRST CHAPTER")
            .unwrap();
        corrupt[offset] = b'X';
        cases.push(corrupt);
        let mut parts = book();
        parts.push(parts[4].clone());
        cases.push(archive(&parts));
        let mut parts = book();
        parts[4].1 = format!(
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>{}leaf{}</body></html>",
            "<div>".repeat(300),
            "</div>".repeat(300)
        );
        cases.push(archive(&parts));
        for (index, bytes) in cases.iter().enumerate() {
            let (result, output) = run(bytes);
            assert_ne!(result.exit_code, 0, "case {index}");
            assert_eq!(output, b"KEEP", "case {index}");
        }
    }
}
