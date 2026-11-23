use crate::commands::codecs;
use std::borrow::Cow;

pub(in super::super) fn select(
    kind: Option<&str>,
    bytes: &[u8],
    filename: &str,
    limit: usize,
) -> Result<&'static str, String> {
    match kind {
        Some("Gnumeric_XmlIO:sax") => return Ok("Gnumeric_XmlIO:sax"),
        Some("Gnumeric_sylk:sylk") => return Ok("Gnumeric_sylk:sylk"),
        Some("Gnumeric_dif:dif") => return Ok("Gnumeric_dif:dif"),
        Some("Gnumeric_stf:stf_csvtab") => return Ok("Gnumeric_stf:stf_csvtab"),
        Some("Gnumeric_stf:stf_assistant") => {
            return Err("E This importer can only be used with a GUI.\n".into());
        }
        _ => {}
    }
    if kind.is_none() && filename.to_ascii_lowercase().ends_with(".dif") {
        return Ok("Gnumeric_dif:dif");
    }
    if kind.is_none() && bytes.starts_with(b"ID;") {
        let lower = filename.to_ascii_lowercase();
        if lower.ends_with(".slk") || lower.ends_with(".sylk") {
            return Ok("Gnumeric_sylk:sylk");
        }
    }
    let lower = filename.to_ascii_lowercase();
    if kind.is_none()
        && !["csv", "tsv", "txt"]
            .iter()
            .any(|ext| lower.ends_with(&format!(".{ext}")))
        && super::gnumeric_read::probe(bytes, limit)
    {
        return Ok("Gnumeric_XmlIO:sax");
    }
    let members = match codecs::zip_directory(bytes.len(), |r| Ok(Cow::Borrowed(&bytes[r]))) {
        Ok((members, _)) => Some(members),
        Err(error) => {
            if let Some(kind) = kind {
                let format = if kind == "Gnumeric_Excel:xlsx" {
                    "XLSX"
                } else {
                    "OpenDocument"
                };
                let message = if error == "ZIP missing end record" {
                    "ZIP truncated or missing end of central directory"
                } else {
                    &error
                };
                return Err(format!("E Invalid {format}: {message}\n"));
            }
            None
        }
    };
    if let Some(members) = members {
        if kind == Some("Gnumeric_Excel:xlsx") {
            if !members.iter().any(|m| m.name == "xl/workbook.xml") {
                return Err("E No workbook stream found.\n".into());
            }
            return Ok("Gnumeric_Excel:xlsx");
        }
        let lower = filename.to_ascii_lowercase();
        let extension = lower.rsplit_once('.').map(|(_, ext)| ext);
        let xlsx = members.iter().any(|m| m.name == "xl/workbook.xml");
        if kind.is_none()
            && xlsx
            && matches!(extension, Some("xlsx" | "xltx" | "xlsb" | "xlsm" | "xltm"))
        {
            return Ok("Gnumeric_Excel:xlsx");
        }
        let mime = members.iter().find(|m| m.name == "mimetype");
        let content = members.iter().find(|m| m.name == "content.xml");
        let prefix = |member: &codecs::ZipMember, size: usize| -> Result<String, String> {
            if member.size > limit {
                return Err("ssconvert: workbook exceeds byte limit\n".into());
            }
            let decoded = member.decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)?;
            Ok(String::from_utf8_lossy(&decoded[..decoded.len().min(size)]).into_owned())
        };
        let recognized = if let Some(mime) = mime {
            matches!(
                prefix(mime, 2048)?.as_str(),
                "application/vnd.oasis.opendocument.spreadsheet"
                    | "application/vnd.oasis.opendocument.spreadsheet-template"
                    | "application/vnd.sun.xml.calc"
                    | "application/vnd.sun.xml.calc.template"
            )
        } else {
            kind.is_some()
                || matches!(extension, Some("sxc" | "stc"))
                || content
                    .map(|m| prefix(m, 512))
                    .transpose()?
                    .is_some_and(|s| s.contains("urn:oasis:names:tc:opendocument:xmlns:office:1.0"))
        };
        if kind.is_some() && !recognized {
            return Err("E Invalid OpenDocument: Unknown mimetype for openoffice file.\n".into());
        }
        if kind.is_none() {
            if !(recognized && matches!(extension, Some("ods" | "ots" | "sxc" | "stc"))) {
                if matches!(extension, Some("csv" | "tsv" | "txt"))
                    && super::decoding::probe(bytes, filename)
                {
                    return Ok("Gnumeric_stf:stf_csvtab");
                }
                if xlsx {
                    return Ok("Gnumeric_Excel:xlsx");
                }
            }
        }
        if recognized {
            if content.is_none() {
                return Err("E Invalid OpenDocument: No stream named content.xml found.\n".into());
            }
            return Ok("Gnumeric_OpenCalc:openoffice");
        }
    }
    if bytes.starts_with(b"ID;") {
        return Ok("Gnumeric_sylk:sylk");
    }
    if super::decoding::probe(bytes, filename) {
        Ok("Gnumeric_stf:stf_csvtab")
    } else {
        Err(format!(
            "E Unsupported file format for file \"{filename}\"\n"
        ))
    }
}
