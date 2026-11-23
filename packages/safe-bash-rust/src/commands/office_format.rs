use crate::commands::{codecs::zip_directory, structured::xml};
use std::borrow::Cow;

pub(in crate::commands) struct Archive {
    pub format: &'static str,
}

fn attr<'a>(element: &'a xml::Element, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn package_entries<'a>(nodes: &'a [xml::Node], root: &str) -> Vec<(&'a xml::Element, usize)> {
    let mut result = Vec::new();
    let mut namespaces: std::collections::BTreeMap<&str, Vec<&str>> =
        std::collections::BTreeMap::new();
    let mut declarations = Vec::new();
    let mut pending = vec![(nodes.iter(), None, 0)];
    while let Some((nodes, parent, _)) = pending.last_mut() {
        let Some(node) = nodes.next() else {
            let (_, _, start) = pending.pop().unwrap();
            for prefix in declarations.drain(start..).rev() {
                let values = namespaces.get_mut(prefix).unwrap();
                values.pop();
                if values.is_empty() {
                    namespaces.remove(prefix);
                }
            }
            continue;
        };
        let xml::Node::Element(element) = node else {
            continue;
        };
        let parent = *parent;
        let start = declarations.len();
        for (name, value) in &element.attrs {
            if let Some(prefix) = if name == "xmlns" {
                Some("")
            } else {
                name.strip_prefix("xmlns:")
            } {
                namespaces.entry(prefix).or_default().push(value);
                declarations.push(prefix);
            }
        }
        let (prefix, local) = element.tag.split_once(':').unwrap_or(("", &element.tag));
        let namespace = namespaces
            .get(prefix)
            .and_then(|values| values.last())
            .copied()
            .unwrap_or("");
        let token = match (namespace, local) {
            (
                "http://schemas.openxmlformats.org/package/2006/relationships",
                "Relationships" | "Relationship",
            )
            | (
                "http://schemas.openxmlformats.org/package/2006/content-types",
                "Types" | "Default" | "Override",
            ) => Some(local),
            _ => None,
        };
        if parent == Some(root)
            && matches!(
                (root, token),
                ("Relationships", Some("Relationship")) | ("Types", Some("Default" | "Override"))
            )
        {
            result.push((element, pending.len() - 1));
        }
        // Fast detection ignores unknown elements without changing its token
        // context, but their namespace scope applies. Keep deep XML iterative.
        pending.push((element.children.iter(), token.or(parent), start));
    }
    result
}

fn manifest_type(bytes: &[u8]) -> Option<String> {
    let mut source = super::super::office_xml::decode(bytes).ok()?;
    let mut header = source.as_str();
    loop {
        header = header.trim_start_matches([' ', '\t', '\r', '\n']);
        if header.starts_with("<?") {
            header = &header[header.find("?>")? + 2..];
        } else if header.starts_with("<!--") {
            header = &header[header.find("-->")? + 3..];
        } else {
            break;
        }
    }
    // Old manifests declare an external DTD. It supplies no data needed for
    // admission; internal subsets and entity declarations remain rejected.
    if let Some(doctype) = header.strip_prefix("<!DOCTYPE ") {
        let start = source.len() - header.len();
        let mut quote = None;
        let mut end = None;
        for (offset, c) in doctype.char_indices() {
            if let Some(open) = quote {
                if c == open {
                    quote = None;
                }
            } else if matches!(c, '\'' | '"') {
                quote = Some(c);
            } else if c == '[' {
                return None;
            } else if c == '>' {
                end = Some(start + "<!DOCTYPE ".len() + offset + 1);
                break;
            }
        }
        source.drain(start..end?);
    }
    let mut parser = xml::Parser::new(None, None, true);
    // The native manifest reader predefines this historical prefix, even when
    // the document omits its declaration. Other prefixes use their bindings.
    parser.bind_namespace(
        "manifest",
        "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
    );
    parser.feed(&source).ok()?;
    let document = parser.finish().ok()?;
    let root = document.nodes.iter().find_map(|node| match node {
        xml::Node::Element(el) => Some(el),
        _ => None,
    })?;
    let mut result = None;
    for node in &root.children {
        let xml::Node::Element(entry) = node else {
            continue;
        };
        let matches = |name: &str, local: &str, attribute: bool| {
            let (prefix, tail) = name.split_once(':').unwrap_or(("", name));
            if tail != local || attribute && prefix.is_empty() {
                return false;
            }
            if prefix == "manifest" {
                return true;
            }
            let declaration = if prefix.is_empty() {
                "xmlns".to_string()
            } else {
                format!("xmlns:{prefix}")
            };
            entry
                .attrs
                .iter()
                .chain(&root.attrs)
                .find(|(key, _)| key == &declaration)
                .is_some_and(|(_, value)| {
                    matches!(
                        value.as_str(),
                        "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
                            | "http://openoffice.org/2001/manifest"
                    )
                })
        };
        if !matches(&entry.tag, "file-entry", false) {
            continue;
        }
        let attribute = |name| {
            entry
                .attrs
                .iter()
                .find(|(key, _)| matches(key, name, true))
                .map(|(_, value)| value.as_str())
        };
        if attribute("full-path") == Some("/") {
            result = Some(attribute("media-type").unwrap_or("").to_owned());
        }
    }
    result
}

pub(in crate::commands) fn archive(
    bytes: &[u8],
    extension: &str,
    limit: usize,
) -> Result<Option<Archive>, String> {
    if !bytes.starts_with(b"PK\x03\x04") {
        return Ok(None);
    }
    let Ok((members, _)) = zip_directory(bytes.len(), |r| Ok(Cow::Borrowed(&bytes[r]))) else {
        return Ok(None);
    };
    let accept = |format: Option<(&'static str, &'static str)>| {
        if format.is_none() || matches!(extension, "csv" | "txt") {
            Err(super::SOURCE_LOAD_ERROR.into())
        } else {
            Ok(format)
        }
    };
    let mut remaining = limit;
    let mut read = |name: &str| -> Result<Option<Vec<u8>>, String> {
        let Some(member) = members.iter().find(|m| m.name == name) else {
            return Ok(None);
        };
        remaining = remaining
            .checked_sub(member.size)
            .ok_or("Error: conversion failed: document exceeds byte limit\n")?;
        if !matches!(member.method, 0 | 8) {
            return Ok(None);
        }
        Ok(member
            .decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)
            .ok()
            .map(Cow::into_owned))
    };
    let parse = |bytes: &[u8]| {
        super::super::office_xml::decode(bytes)
            .ok()
            .and_then(|s| xml::parse(&s, None, None).ok())
    };
    let mime = read("mimetype")?;
    let manifest = read("META-INF/manifest.xml")?;
    if mime.is_none() && members.iter().any(|member| member.name == "mimetype") {
        return Err(super::SOURCE_LOAD_ERROR.into());
    }
    if mime.is_some()
        || members
            .iter()
            .any(|member| member.name == "META-INF/manifest.xml")
        || members
            .iter()
            .any(|member| member.name == "content.xml" && matches!(member.method, 0 | 8))
            && !members.iter().any(|member| member.name == "_rels/.rels")
    {
        let kind = manifest
            .as_deref()
            .and_then(manifest_type)
            .ok_or(super::SOURCE_LOAD_ERROR)?;
        if mime.as_deref().is_some_and(|mime| mime != kind.as_bytes()) {
            return Err(super::SOURCE_LOAD_ERROR.into());
        }
        return accept(Some(match kind.as_str() {
            "application/vnd.oasis.opendocument.spreadsheet" => ("ods", "calc8"),
            "application/vnd.oasis.opendocument.spreadsheet-template" => ("ods", "calc8_template"),
            "application/vnd.sun.xml.calc" => ("ods", "StarOffice XML (Calc)"),
            "application/vnd.oasis.opendocument.text" => ("odt", "writer8"),
            "application/vnd.oasis.opendocument.text-template" => ("odt", "writer8_template"),
            "application/vnd.sun.xml.writer" => ("odt", "StarOffice XML (Writer)"),
            "application/vnd.oasis.opendocument.presentation" => ("odp", "impress8"),
            "application/vnd.oasis.opendocument.presentation-template" => {
                ("odp", "impress8_template")
            }
            "application/vnd.sun.xml.impress" => ("odp", "StarOffice XML (Impress)"),
            _ => return Err(super::SOURCE_LOAD_ERROR.into()),
        }))
        .map(|detected| detected.map(|(format, _)| Archive { format }));
    }
    let Some(rels) = read("_rels/.rels")?.and_then(|bytes| parse(&bytes)) else {
        return Err(super::SOURCE_LOAD_ERROR.into());
    };
    let relationships = package_entries(&rels.nodes, "Relationships");
    let Some((target, external)) = relationships.iter().find_map(|(rel, _)| {
        (matches!(
            attr(rel, "Type"),
            Some(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
                    | "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"
            )
        ))
        .then(|| {
            attr(rel, "Target").map(|target| (target, attr(rel, "TargetMode") == Some("External")))
        })
        .flatten()
    }) else {
        return Err(super::SOURCE_LOAD_ERROR.into());
    };
    let target = crate::vfs::resolve_posix_path("/", target);
    let Some(types) = read("[Content_Types].xml")?.and_then(|bytes| parse(&bytes)) else {
        return Err(super::SOURCE_LOAD_ERROR.into());
    };
    let entries = package_entries(&types.nodes, "Types");
    let declared = entries
        .iter()
        .filter(|(el, _)| el.tag.rsplit(':').next() == Some("Override"))
        .find_map(|(entry, _)| {
            (attr(entry, "PartName") == Some(target.as_str()))
                .then(|| attr(entry, "ContentType"))
                .flatten()
        });
    let content_type = declared.or_else(|| {
        let extension = target.rsplit_once('.')?.1;
        entries
            .iter()
            .filter(|(el, _)| el.tag.rsplit(':').next() == Some("Default"))
            .find_map(|(entry, _)| {
                (attr(entry, "Extension") == Some(extension))
                    .then(|| attr(entry, "ContentType"))
                    .flatten()
            })
    });
    let mut iso = false;
    for (relation, _) in &relationships {
        let kind = attr(relation, "Type").unwrap_or("").to_ascii_lowercase();
        if kind.starts_with("http://schemas.openxmlformats.org/officedocument/2006/relationships/metadata/core-properties")
            || kind.starts_with("http://purl.oclc.org/ooxml/officedocument") { iso = true; }
        else if kind.starts_with("http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties") { iso = false; }
    }
    let format = match content_type.unwrap_or("") {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" => {
            Some(("xlsx", "Calc MS Excel 2007 XML"))
        }
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml" => {
            Some(("xlsx", "Calc MS Excel 2007 VBA XML"))
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml"
        | "application/vnd.ms-excel.template.macroEnabled.main+xml" => {
            Some(("xlsx", "Calc MS Excel 2007 XML Template"))
        }
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" => {
            Some((
                "docx",
                if extension == "docm" {
                    "MS Word 2007 XML VBA"
                } else if iso {
                    "Office Open XML Text"
                } else {
                    "MS Word 2007 XML"
                },
            ))
        }
        "application/vnd.ms-word.document.macroEnabled.main+xml" => {
            Some(("docx", "MS Word 2007 XML VBA"))
        }
        "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
        | "application/vnd.ms-word.template.macroEnabledTemplate.main+xml" => Some((
            "docx",
            if iso {
                "Office Open XML Text Template"
            } else {
                "MS Word 2007 XML Template"
            },
        )),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" => {
            Some(("pptx", "Impress MS PowerPoint 2007 XML"))
        }
        "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml" => {
            Some(("pptx", "Impress MS PowerPoint 2007 XML VBA"))
        }
        "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml"
        | "application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml" => {
            Some(("pptx", "Impress MS PowerPoint 2007 XML AutoPlay"))
        }
        "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml"
        | "application/vnd.ms-powerpoint.template.macroEnabled.main+xml" => {
            Some(("pptx", "Impress MS PowerPoint 2007 XML Template"))
        }
        _ => None,
    };
    // Only Calc's package detector accepts the main type through a Default.
    let format = format.filter(|(format, _)| declared.is_some() || *format == "xlsx");
    // Writer accepts an in-package document target even when its relationship
    // is marked External. Calc and Impress reject that relationship.
    let (format, _) = accept(format.filter(|(format, _)| !external || *format == "docx"))?.unwrap();
    Ok(Some(Archive { format }))
}

#[cfg(test)]
mod tests {
    use super::super::super::cmd_soffice;
    use crate::commands::structured::{JVal, parse_json_stream, write_zip_stored};
    use crate::{MemoryVfs, SafeBashFs};

    fn assert_pdf_matches(actual: &[u8], expected: &[u8], context: &str) {
        let read = super::super::super::pdf_reader::read;
        let (actual, _) = read(actual, "").unwrap_or_else(|e| panic!("{context}: actual: {e}"));
        let (expected, _) = read(expected, "").unwrap_or_else(|e| panic!("{context}: expected: {e}"));
        assert_eq!(actual.version, expected.version, "{context}");
        assert_eq!(actual.info, expected.info, "{context}");
        assert_eq!(actual.page_w, expected.page_w, "{context}");
        assert_eq!(actual.page_h, expected.page_h, "{context}");
        assert_eq!(actual.page_media, expected.page_media, "{context}");
        assert_eq!(actual.pages.len(), expected.pages.len(), "{context}");
        for (actual, expected) in actual.pages.iter().zip(&expected.pages) {
            assert_eq!(actual.text, expected.text, "{context}");
            assert_eq!(actual.rot, expected.rot, "{context}");
            assert_eq!(actual.images, expected.images, "{context}");
            assert_eq!(actual.urls, expected.urls, "{context}");
        }
    }

    #[test]
    fn archive_conversion_matches_public_command_and_preserves_outputs() {
        let mut failures = Vec::new();
        for source in [
            include_str!("../../tests/fixtures/soffice-archive-admission-native.json"),
            include_str!("../../tests/fixtures/soffice-zip-admission-native.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let JVal::Object(inputs) = &fixture.iter().find(|(k, _)| k == "inputs").unwrap().1
            else {
                panic!("inputs")
            };
            let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
                panic!("cases")
            };
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let text = |key| match &fields.iter().find(|(k, _)| k == key).unwrap().1 {
                    JVal::Str(s) => s.as_str(),
                    _ => panic!("text"),
                };
                let name = text("input");
                let decode = |value: &str| {
                    value
                        .as_bytes()
                        .chunks_exact(2)
                        .map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
                        .collect::<Vec<_>>()
                };
                let bytes = if let Some((_, JVal::Str(bytes))) =
                    fields.iter().find(|(key, _)| key == "archive")
                {
                    decode(bytes)
                } else {
                    let JVal::Object(parts) = &inputs.iter().find(|(k, _)| k == name).unwrap().1
                    else {
                        panic!("parts")
                    };
                    write_zip_stored(
                        &parts
                            .iter()
                            .map(|(name, value)| {
                                let JVal::Str(value) = value else {
                                    panic!("part")
                                };
                                (name.as_str(), value.as_bytes())
                            })
                            .collect::<Vec<_>>(),
                    )
                };
                let fs = MemoryVfs::new();
                let path = format!("/{name}");
                let target = text("target");
                let extension = if target == "cat" {
                    "txt"
                } else {
                    target.split(':').next().unwrap()
                };
                let dest = format!("/out/{}.{}", name.rsplit_once('.').unwrap().0, extension);
                fs.mkdir_all("/out").unwrap();
                fs.write_file(&path, &bytes).unwrap();
                fs.write_file(&dest, b"destination sentinel").unwrap();
                fs.write_file("/unrelated", b"keep").unwrap();
                let cat = text("target") == "cat";
                let args = if cat {
                    vec!["--cat".into(), path.clone()]
                } else {
                    ["--convert-to", target, "--outdir", "/out", &path]
                        .map(String::from)
                        .to_vec()
                };
                let result = cmd_soffice(&args, "/", &fs);
                let expected = decode(text("hex"));
                let actual = if cat {
                    result.stdout.as_bytes().to_vec()
                } else {
                    fs.read_file(&dest).unwrap()
                };
                let parts = crate::commands::structured::read_office_archive(&expected);
                let same = if target == "pdf" && expected.starts_with(b"%PDF-") {
                    assert_pdf_matches(&actual, &expected, name);
                    true
                } else if target != "xlsx" || parts.is_empty() {
                    actual == expected
                } else {
                    crate::commands::structured::read_office_archive(&actual) == parts
                };
                let JVal::Number(code, _) =
                    &fields.iter().find(|(key, _)| key == "exitCode").unwrap().1
                else {
                    panic!("exitCode")
                };
                if result.exit_code != *code as i32
                    // These malformed-archive cases require a failed conversion,
                    // not the same decoder-specific explanation of bad bytes.
                    || if *code != 0. {
                        !result.stderr.starts_with("Error: conversion failed: ")
                    } else {
                        result.stderr != text("stderr")
                    }
                    || result.stdout != text("stdout")
                    || !same
                {
                    failures.push(format!(
                        "{name} {}: status {}, stderr {:?}, output {:?}",
                        text("target"),
                        result.exit_code,
                        result.stderr,
                        String::from_utf8_lossy(&actual)
                    ));
                }
                if cat || !text("stderr").is_empty() {
                    assert_eq!(
                        fs.read_file(&dest).unwrap(),
                        b"destination sentinel",
                        "{name}"
                    );
                }
                assert_eq!(fs.read_file(&path).unwrap(), bytes);
                assert_eq!(fs.read_file("/unrelated").unwrap(), b"keep");
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn archive_routes_match_public_filename_dispatch() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-archive-routes-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Object(parts) = field("parts") else {
                panic!("parts")
            };
            let bytes = write_zip_stored(
                &parts
                    .iter()
                    .map(|(name, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (name.as_str(), value.as_bytes())
                    })
                    .collect::<Vec<_>>(),
            );
            let JVal::Array(checks) = field("checks") else {
                panic!("checks")
            };
            for check in checks {
                let JVal::Object(fields) = check else {
                    panic!("check")
                };
                let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
                let text = |key| match field(key) {
                    JVal::Str(value) => value.as_str(),
                    _ => panic!("text"),
                };
                let path = text("path");
                let target = text("target");
                let destination = text("dest");
                let context = format!("{path} {target}");
                let fs = MemoryVfs::new();
                fs.mkdir_all("/out").unwrap();
                fs.write_file(path, &bytes).unwrap();
                fs.write_file(destination, b"existing output").unwrap();
                fs.write_file("/unrelated", b"keep").unwrap();
                let args = if target == "cat" {
                    vec!["--cat".into(), path.into()]
                } else {
                    ["--convert-to", target, "--outdir", "/out", path]
                        .map(String::from)
                        .to_vec()
                };
                let result = cmd_soffice(&args, "/", &fs);
                let JVal::Number(code, _) = field("exitCode") else {
                    panic!("exitCode")
                };
                assert_eq!(
                    result.exit_code, *code as i32,
                    "{context}: {}",
                    result.stderr
                );
                assert_eq!(result.stdout, text("stdout"), "{context}");
                assert_eq!(result.stderr, text("stderr"), "{context}");
                let actual = fs.read_file(destination).unwrap();
                let expected = super::super::super::hex_dec(text("hex"));
                if target == "pdf" && expected.starts_with(b"%PDF-") {
                    assert_pdf_matches(&actual, &expected, &context);
                } else if target == "docx" && *code == 0. && text("stderr").is_empty() {
                    assert_eq!(
                        crate::commands::structured::read_office_archive(&actual),
                        crate::commands::structured::read_office_archive(&expected),
                        "{context}"
                    );
                } else {
                    assert_eq!(actual, expected, "{context}");
                }
                assert_eq!(fs.read_file(path).unwrap(), bytes);
                assert_eq!(fs.read_file("/unrelated").unwrap(), b"keep");
            }
        }
    }
}
