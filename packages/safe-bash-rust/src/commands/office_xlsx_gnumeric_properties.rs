use super::{Element, Node, Workbook, attr, elements};
use crate::commands::structured::{JVal, xml};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write,
};

const CP: &str = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DC: &str = "http://purl.org/dc/elements/1.1/";
const DCTERMS: &str = "http://purl.org/dc/terms/";
const FIELDS: &[(&str, &str)] = &[
    ("dc:title", "dc:title"),
    ("dc:subject", "dc:subject"),
    ("dc:description", "dc:description"),
    ("dc:creator", "meta:initial-creator"),
    ("dc:language", "dc:language"),
    ("cp:lastModifiedBy", "dc:creator"),
    ("cp:lastPrinted", "meta:print-date"),
    ("dcterms:created", "meta:creation-date"),
    ("dcterms:modified", "dc:date"),
    ("cp:revision", "meta:editing-cycles"),
    ("cp:keywords", "dc:keywords"),
];

pub(super) fn read(
    entries: &BTreeMap<String, Vec<u8>>,
    relationships: &[Node],
    book: &mut Workbook,
    work: &mut usize,
    diagnostics: &mut String,
) -> Result<(), String> {
    let Some(relation) = elements(relationships, "Relationship").into_iter().find(|r| {
        attr(r, "Type") == Some("http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties")
            && attr(r, "TargetMode") != Some("External")
    }) else { return Ok(()); };
    let path = crate::vfs::resolve_posix_path("/", attr(relation, "Target").unwrap_or(""));
    let path = path.trim_start_matches('/');
    let bytes = entries.get(path).ok_or_else(|| {
        format!("Error: conversion failed: E Invalid XLSX: missing part '{path}'\n")
    })?;
    let source = super::super::super::office_xml::decode(bytes)?;
    let document = xml::parse(&source, None, None).map_err(|error| {
        if !source.ends_with('>') {
            let line = source.chars().filter(|&c| c == '\n').count() + 1;
            let column = source.rsplit('\n').next().unwrap().encode_utf16().count();
            let message = if source.contains('>') { "unexpected end." } else { "document must contain a root element." };
            format!("Error: conversion failed: E Invalid XLSX: Invalid XML: {line}:{column}: {message}\n")
        } else { format!("Error: conversion failed: E Invalid XLSX: {error}\n") }
    })?;
    let Some(root) = document.nodes.iter().find_map(|n| {
        if let Node::Element(e) = n {
            Some(e)
        } else {
            None
        }
    }) else {
        return Ok(());
    };
    let mut prefixes = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut unknown = BTreeSet::new();
    let mut root_default = String::new();
    for (index, node) in std::iter::once(root)
        .chain(root.children.iter().filter_map(|n| {
            if let Node::Element(e) = n {
                Some(e)
            } else {
                None
            }
        }))
        .enumerate()
    {
        let mut default = root_default.clone();
        for (key, value) in &node.attrs {
            let known = super::workbook_namespace(value).is_some();
            if key == "xmlns" && known {
                default = value.clone();
            } else if let Some(prefix) = key.strip_prefix("xmlns:") {
                if !known {
                    unknown.insert(prefix.to_owned());
                } else if seen.insert(prefix.to_owned()) {
                    prefixes
                        .entry(value.clone())
                        .or_insert_with(|| prefix.to_owned());
                }
            }
        }
        if index == 0 {
            root_default = default.clone();
        }
        let local = node.tag.rsplit(':').next().unwrap();
        let expected = if index == 0 && local == "coreProperties" {
            Some(CP)
        } else if index == 0 {
            None
        } else {
            match local {
                "category" | "contentStatus" | "contentType" | "keywords" | "lastModifiedBy"
                | "lastPrinted" | "revision" | "version" => Some(CP),
                "creator" | "description" | "identifier" | "language" | "subject" | "title" => {
                    Some(DC)
                }
                "created" | "modified" => Some(DCTERMS),
                _ => None,
            }
        };
        let accepted = expected.is_some_and(|ns| {
            node.tag
                .split_once(':')
                .map_or(default == ns, |(prefix, _)| {
                    prefixes.get(ns).is_some_and(|p| p == prefix)
                })
        });
        let ignored = |node: &Element| {
            node.tag
                .split_once(':')
                .is_some_and(|(prefix, _)| unknown.contains(prefix))
        };
        if !accepted {
            if !ignored(node) {
                writeln!(
                    diagnostics,
                    "Unexpected element '{}' in state : \n\t{}",
                    node.tag,
                    if index == 0 { "" } else { "coreProperties" }
                )
                .unwrap();
            }
            if index == 0 {
                break;
            }
            continue;
        }
        if index == 0 {
            continue;
        }
        for child in &node.children {
            if let Node::Element(child) = child
                && !ignored(child)
            {
                writeln!(
                    diagnostics,
                    "Unexpected element '{}' in state : \n\tcoreProperties -> {local}",
                    child.tag
                )
                .unwrap();
            }
        }
        let Some((_, key)) = FIELDS
            .iter()
            .find(|(name, _)| name.rsplit(':').next() == Some(local))
        else {
            continue;
        };
        let value: String = node
            .children
            .iter()
            .filter_map(|n| match n {
                Node::Text(s, _) | Node::Cdata(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();
        if value.is_empty() {
            continue;
        }
        *work = work
            .checked_sub(value.len() + key.len() + 128)
            .ok_or(super::LIMIT)?;
        let value = if *key == "dc:keywords" {
            JVal::Array(
                value
                    .split(' ')
                    .filter(|s| !s.is_empty())
                    .map(|s| JVal::Str(s.into()))
                    .collect(),
            )
        } else {
            JVal::Str(value)
        };
        book.document_properties.insert((*key).into(), value);
    }
    Ok(())
}

const META: &str = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
const GNUMERIC_FIELDS: &[&str] = &[
    "meta:generator",
    "dc:title",
    "dc:description",
    "dc:subject",
    "meta:initial-creator",
    "dc:creator",
    "meta:printed-by",
    "meta:creation-date",
    "dc:date",
    "meta:print-date",
    "dc:language",
    "meta:editing-cycles",
    "meta:editing-duration",
];

pub(in crate::commands) fn read_gnumeric(
    root: &Element,
    book: &mut Workbook,
) -> Result<(), String> {
    let child = |node: &Element, name: &str| {
        node.tag.rsplit(':').next() == Some(name)
            && node.namespace == "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    };
    let Some(doc) = root.children.iter().find_map(|n| match n {
        Node::Element(e) if child(e, "document-meta") => Some(e),
        _ => None,
    }) else {
        return Ok(());
    };
    let Some(meta) = doc.children.iter().find_map(|n| match n {
        Node::Element(e) if child(e, "meta") => Some(e),
        _ => None,
    }) else {
        return Ok(());
    };
    for node in &meta.children {
        let Node::Element(node) = node else { continue };
        let prefix = match node.namespace.as_str() {
            DC => "dc",
            META => "meta",
            _ => continue,
        };
        let key = format!("{prefix}:{}", node.tag.rsplit(':').next().unwrap());
        let value: String = node
            .children
            .iter()
            .filter_map(|n| match n {
                Node::Text(s, _) | Node::Cdata(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();
        if key == "meta:keyword" {
            let values = book
                .document_properties
                .entry("dc:keywords".into())
                .or_insert_with(|| JVal::Array(Vec::new()));
            if !matches!(values, JVal::Array(_)) {
                *values = JVal::Array(Vec::new());
            }
            if let JVal::Array(values) = values {
                values.push(JVal::Str(value));
            }
        } else if key == "meta:user-defined" {
            let property = |name: &str| {
                node.attrs.iter().find_map(|(key, value)| {
                    let (prefix, local) = key.split_once(':')?;
                    if local != name {
                        return None;
                    }
                    let declaration = format!("xmlns:{prefix}");
                    let namespace = [node, meta, doc, root].into_iter().find_map(|e| {
                        e.attrs
                            .iter()
                            .find(|(k, _)| k == &declaration)
                            .map(|(_, v)| v)
                    });
                    (namespace.map(String::as_str) == Some(META)).then_some(value.as_str())
                })
            };
            let key = property("name").unwrap_or("");
            let value = match property("value-type")
                .or_else(|| property("type"))
                .unwrap_or("string")
            {
                "float" => JVal::Number(crate::commands::js_number(&value, 0.), None),
                "boolean" => JVal::Bool(value == "true"),
                _ => JVal::Str(value),
            };
            book.document_properties.insert(key.into(), value);
        } else if GNUMERIC_FIELDS.contains(&key.as_str()) {
            let value = if key == "meta:editing-cycles" {
                let number = crate::commands::js_number(&value, 0.);
                JVal::Number(number, None)
            } else {
                JVal::Str(value)
            };
            book.document_properties.insert(key, value);
        }
    }
    if book
        .document_properties
        .values()
        .any(|v| matches!(v, JVal::Number(n, _) if !n.is_finite()))
    {
        return Err("Nonfinite workbook number\n".into());
    }
    Ok(())
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\r', "&#13;")
}

const EXPORT_FIELDS: &[(&str, &str)] = &[
    ("cp:category", "gsf:category"),
    ("cp:contentStatus", "cp:contentStatus"),
    ("cp:contentType", "cp:contentType"),
    ("cp:version", "cp:version"),
    ("dc:identifier", "dc:identifier"),
];

pub(in crate::commands) fn xlsx(book: &Workbook) -> [String; 3] {
    let extended_fields = [
        ("meta:template", "Template", "text"),
        ("gsf:manager", "Manager", "text"),
        ("dc:publisher", "Company", "text"),
        ("gsf:page-count", "Pages", "int"),
        ("gsf:word-count", "Words", "int"),
        ("gsf:character-count", "Characters", "int"),
        ("gsf:presentation-format", "PresentationFormat", "text"),
        ("gsf:line-count", "Lines", "int"),
        ("gsf:paragraph-count", "Paragraphs", "int"),
        ("gsf:slide-count", "Slides", "int"),
        ("gsf:note-count", "Notes", "int"),
        ("meta:editing-duration", "TotalTime", "duration"),
        ("gsf:hidden-slide-count", "HiddenSlides", "int"),
        ("xlsx:MMClips", "MMClips", "text"),
        ("gsf:scale", "ScaleCrop", "bool"),
        ("gsf:links-dirty", "LinksUpToDate", "bool"),
        ("gsf:byte-count", "CharactersWithSpaces", "int"),
        ("xlsx:SharedDoc", "SharedDoc", "bool"),
        ("xlsx:HyperlinkBase", "HyperlinkBase", "text"),
        ("xlsx:HyperlinksChanged", "HyperlinksChanged", "bool"),
        ("gsf:security", "DocSecurity", "int"),
    ];
    let mut core = String::new();
    let mut extended = String::new();
    let mut custom = String::new();
    let mut pid = 29;
    for (key, value) in &book.document_properties {
        let scalar = match value {
            JVal::Str(s) => Some(s.clone()),
            JVal::Number(n, _) => Some(crate::commands::structured::xlsx::attribute_number(*n)),
            _ => None,
        };
        if let Some((tag, _)) = FIELDS
            .iter()
            .chain(EXPORT_FIELDS)
            .find(|(_, field)| *field == key)
        {
            let text = if let JVal::Array(values) = value
                && key == "dc:keywords"
            {
                Some(
                    values
                        .iter()
                        .filter_map(|v| {
                            if let JVal::Str(s) = v {
                                Some(s.as_str())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                )
            } else {
                scalar
            };
            let Some(text) = text else { continue };
            write!(core, "<{tag}").unwrap();
            if tag.starts_with("dcterms:") {
                core.push_str(" xsi:type=\"dcterms:W3CDTF\"");
            }
            if text.is_empty() {
                core.push_str("/>");
            } else {
                write!(core, ">{}</{tag}>", escape(&text)).unwrap();
            }
        } else if let Some((_, tag, kind)) =
            extended_fields.iter().find(|(field, _, _)| *field == key)
        {
            let text = match (*kind, value) {
                ("bool", _) => {
                    let yes = match value {
                        JVal::Str(s) => matches!(s.to_lowercase().as_str(), "true" | "yes"),
                        JVal::Bool(b) => *b,
                        JVal::Number(n, _) => *n != 0.,
                        JVal::Null => false,
                        _ => true,
                    };
                    if yes { "1".into() } else { "0".into() }
                }
                ("int", JVal::Number(n, _)) if n.fract() == 0. => scalar.unwrap(),
                ("int", _) => "0".into(),
                ("duration", JVal::Str(s)) => {
                    let m = s.find('M');
                    let end = s[m.map_or(0, |i| i + 1)..]
                        .find('S')
                        .map(|i| i + m.map_or(0, |i| i + 1));
                    let minutes = m
                        .filter(|&i| i >= 2 && s.starts_with("PT"))
                        .map_or(f64::NAN, |i| crate::commands::js_number(&s[2..i], 0.));
                    let seconds = end.map_or(f64::NAN, |i| {
                        crate::commands::js_number(&s[m.map_or(0, |i| i + 1)..i], 0.)
                    });
                    let duration = if minutes.is_finite() && seconds.is_finite() {
                        minutes + if seconds > 29. { 1. } else { 0. }
                    } else {
                        0.
                    };
                    crate::commands::structured::xlsx::attribute_number(duration)
                }
                _ => scalar.unwrap_or_default(),
            };
            if text.is_empty() {
                write!(extended, "<{tag}/>").unwrap();
            } else {
                write!(extended, "<{tag}>{}</{tag}>", escape(&text)).unwrap();
            }
        } else if key != "meta:generator" {
            let (tag, text) = match value {
                JVal::Str(_) => ("vt:lpwstr", scalar.unwrap()),
                JVal::Number(_, _) => ("vt:decimal", scalar.unwrap()),
                JVal::Bool(b) => ("vt:bool", b.to_string()),
                _ => continue,
            };
            let id = if key == "Editor" {
                2
            } else {
                let id = pid;
                pid += 1;
                id
            };
            let name = escape(key).replace('\n', "&#10;").replace('\t', "&#9;");
            write!(custom, "<property fmtid=\"{{D5CDD505-2E9C-101B-9397-08002B2CF9AE}}\" pid=\"{id}\" name=\"{name}\"><{tag}").unwrap();
            if text.is_empty() {
                custom.push_str("/>");
            } else {
                write!(custom, ">{}</{tag}>", escape(&text)).unwrap();
            }
            custom.push_str("</property>");
        }
    }
    [
        include_str!("xlsx/app.xml").replace("</Properties>", &format!("{extended}</Properties>")),
        if core.is_empty() {
            include_str!("xlsx/core.xml").into()
        } else {
            include_str!("xlsx/core.xml").replacen("/>", &format!(">{core}</cp:coreProperties>"), 1)
        },
        if custom.is_empty() {
            include_str!("xlsx/custom.xml").into()
        } else {
            include_str!("xlsx/custom.xml").replacen("/>", &format!(">{custom}</Properties>"), 1)
        },
    ]
}

pub(in crate::commands) fn gnumeric(book: &Workbook) -> Result<String, String> {
    let mut content = String::new();
    let mut properties: Vec<_> = book.document_properties.iter().collect();
    properties.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
    for (key, value) in properties {
        let number;
        let (tag, values) = match value {
            JVal::Str(s) => (key.as_str(), vec![s.as_str()]),
            JVal::Number(n, _) => {
                number = crate::commands::structured::xlsx::attribute_number(*n);
                (key.as_str(), vec![number.as_str()])
            }
            JVal::Bool(b) if !GNUMERIC_FIELDS.contains(&key.as_str()) => {
                (key.as_str(), vec![if *b { "true" } else { "false" }])
            }
            JVal::Array(values) if key == "dc:keywords" => (
                "meta:keyword",
                values
                    .iter()
                    .filter_map(|v| {
                        if let JVal::Str(s) = v {
                            Some(s.as_str())
                        } else {
                            None
                        }
                    })
                    .collect(),
            ),
            _ if GNUMERIC_FIELDS.contains(&key.as_str()) => {
                return Err("E Invalid Gnumeric XML: invalid workbook metadata type\n".into());
            }
            JVal::Null => continue,
            _ => return Err("Unsupported ssconvert feature: XML metadata value type\n".into()),
        };
        for text in values {
            let (tag, attributes) =
                if matches!(value, JVal::Array(_)) || GNUMERIC_FIELDS.contains(&tag) {
                    (tag, String::new())
                } else {
                    let kind = match value {
                        JVal::Number(_, _) => "float",
                        JVal::Bool(_) => "boolean",
                        _ => "string",
                    };
                    let name = escape(key).replace('\n', "&#10;").replace('\t', "&#9;");
                    (
                        "meta:user-defined",
                        format!(" meta:name=\"{name}\" meta:value-type=\"{kind}\""),
                    )
                };
            if text.is_empty() {
                writeln!(content, "      <{tag}{attributes}/>").unwrap();
            } else {
                writeln!(content, "      <{tag}{attributes}>{}</{tag}>", escape(text)).unwrap();
            }
        }
    }
    if content.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(
        "  <office:document-meta xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:meta=\"urn:oasis:names:tc:opendocument:xmlns:meta:1.0\" xmlns:ooo=\"http://openoffice.org/2004/office\" office:version=\"1.2\">\n    <office:meta>\n{content}    </office:meta>\n  </office:document-meta>\n"
    ))
}

pub(in crate::commands) fn xlsx_diagnostics(book: &Workbook) -> String {
    let Some(root) = &book.gnumeric else {
        return String::new();
    };
    let office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
    let mut output = String::new();
    for doc in root.children.iter().filter_map(|n| match n {
        Node::Element(e)
            if e.namespace == office && e.tag.rsplit(':').next() == Some("document-meta") =>
        {
            Some(e)
        }
        _ => None,
    }) {
        let children: Vec<_> = doc
            .children
            .iter()
            .filter_map(|n| {
                if let Node::Element(e) = n {
                    Some(e)
                } else {
                    None
                }
            })
            .collect();
        let represented = children.len() == 1
            && children[0].namespace == office
            && children[0].tag.rsplit(':').next() == Some("meta")
            && children[0].children.iter().all(|n| {
                let Node::Element(field) = n else {
                    return true;
                };
                if field.children.iter().any(|n| matches!(n, Node::Element(_))) {
                    return false;
                }
                let name = field.tag.rsplit(':').next().unwrap();
                let key = match (field.namespace.as_str(), name) {
                    (META, "user-defined") => field
                        .attrs
                        .iter()
                        .rev()
                        .find(|(key, _)| {
                            key.rsplit(':').next() == Some("name") && !key.starts_with("xmlns:")
                        })
                        .map(|(_, value)| value.clone()),
                    (META, "keyword") => Some("dc:keywords".into()),
                    (META, _) => Some(format!("meta:{name}")),
                    (DC, _) => Some(format!("dc:{name}")),
                    _ => None,
                };
                let Some(key) = key else {
                    return false;
                };
                if key == "meta:generator" {
                    return false;
                }
                match book.document_properties.get(&key) {
                    Some(JVal::Str(_) | JVal::Number(_, _)) => true,
                    Some(JVal::Bool(_)) => !FIELDS
                        .iter()
                        .chain(EXPORT_FIELDS)
                        .any(|(_, field)| *field == key),
                    Some(JVal::Array(_)) => key == "dc:keywords",
                    _ => false,
                }
            });
        if !represented {
            output.push_str("XLSX writer does not export workbook record 'document-meta'\n");
        }
    }
    output
}
