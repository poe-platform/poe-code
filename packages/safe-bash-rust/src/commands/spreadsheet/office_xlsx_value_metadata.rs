// Rich-error metadata resolution adapted from IronCalc f936620
// xlsx/src/import/value_metadata.rs (MIT, LICENSE.IronCalc).
// vm is one-based; rich-value/structure/field indices are zero-based.
use super::{xml_attribute as attr, xml_elements as elements, xml_text as text};
use crate::commands::structured::xml;

pub(super) fn errors(
    metadata: &[xml::Node],
    values: &[xml::Node],
    structures: &[xml::Node],
) -> Vec<Option<&'static str>> {
    let types = elements(metadata, "metadataType");
    let future: Vec<_> = elements(metadata, "futureMetadata")
        .into_iter()
        .filter(|e| attr(e, "name") == Some("XLRICHVALUE"))
        .flat_map(|e| elements(&e.children, "bk"))
        .map(|e| {
            elements(&e.children, "rvb")
                .first()
                .and_then(|e| attr(e, "i")?.parse::<usize>().ok())
        })
        .collect();
    let fields: Vec<_> = elements(structures, "s")
        .into_iter()
        .map(|s| {
            if attr(s, "t") != Some("_error") {
                return None;
            }
            elements(&s.children, "k")
                .iter()
                .position(|k| attr(k, "n") == Some("errorType"))
        })
        .collect();
    let values: Vec<_> = elements(values, "rv")
        .into_iter()
        .map(|v| {
            let structure = attr(v, "s")?.parse::<usize>().ok()?;
            let field = (*fields.get(structure)?)?;
            let values = elements(&v.children, "v");
            // Only codes confirmed by Excel-written fixtures override the fallback.
            match text(values.get(field)?).trim().parse::<u32>().ok()? {
                2 => Some("#VALUE!"),
                8 => Some("#SPILL!"),
                13 => Some("#CALC!"),
                _ => None,
            }
        })
        .collect();
    elements(metadata, "valueMetadata")
        .into_iter()
        .flat_map(|m| elements(&m.children, "bk"))
        .map(|b| {
            // A block may also carry another metadata type. Find its rich value.
            elements(&b.children, "rc").into_iter().find_map(|r| {
                let kind = attr(r, "t")?.parse::<usize>().ok()?.checked_sub(1)?;
                if attr(types.get(kind)?, "name") != Some("XLRICHVALUE") {
                    return None;
                }
                let record = attr(r, "v")?.parse::<usize>().ok()?;
                *values.get((*future.get(record)?)?)?
            })
        })
        .collect()
}

// Extend our fixed dynamic-array template in schema order: types, future
// records, cell metadata, value metadata. Error records are shared by kind.
pub(super) fn write(codes: &[u8], dynamic: bool, work: &mut usize) -> Option<(String, String)> {
    use std::fmt::Write;
    if codes.len() > 2 || codes.iter().any(|c| !matches!(c, 8 | 13)) {
        return None;
    }
    *work = work.checked_sub(8192)?;
    let template = include_str!("xlsx/dynamic-metadata.xml");
    let (head, tail) = template.split_once("</metadataTypes>")?;
    let (future, cell) = tail.split_once("<cellMetadata")?;
    let mut metadata = if dynamic {
        head.replace("count=\"1\"", "count=\"2\"")
    } else {
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><metadata xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><metadataTypes count=\"1\">".into()
    };
    metadata.push_str(r#"<metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>"#);
    if dynamic {
        metadata.push_str(future);
    }
    write!(
        metadata,
        r#"<futureMetadata name="XLRICHVALUE" count="{}">"#,
        codes.len()
    )
    .ok()?;
    for i in 0..codes.len() {
        write!(metadata,r#"<bk><extLst><ext uri="{{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}}"><xlrd:rvb xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" i="{i}"/></ext></extLst></bk>"#).ok()?;
    }
    metadata.push_str("</futureMetadata>");
    if dynamic {
        metadata.push_str("<cellMetadata");
        metadata.push_str(cell.trim_end().strip_suffix("</metadata>")?);
    }
    write!(metadata, r#"<valueMetadata count="{}">"#, codes.len()).ok()?;
    for i in 0..codes.len() {
        write!(
            metadata,
            r#"<bk><rc t="{}" v="{i}"/></bk>"#,
            1 + usize::from(dynamic)
        )
        .ok()?;
    }
    metadata.push_str("</valueMetadata></metadata>");
    let mut values = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="{}">"#,
        codes.len()
    );
    for code in codes {
        write!(values, r#"<rv s="0"><v>{code}</v><v>0</v></rv>"#).ok()?;
    }
    values.push_str("</rvData>");
    Some((metadata, values))
}

#[cfg(test)]
mod tests {
    use super::*;
    const METADATA: &str = r#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">
<metadataTypes count="2"><metadataType name="XLDAPR"/><metadataType name="XLRICHVALUE"/></metadataTypes>
<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext><xda:dynamicArrayProperties fDynamic="1"/></ext></extLst></bk></futureMetadata>
<futureMetadata name="XLRICHVALUE" count="3">
<bk><extLst><ext><xlrd:rvb i="2"/></ext></extLst></bk>
<bk><extLst><ext><xlrd:rvb i="0"/></ext></extLst></bk>
<bk><extLst><ext><xlrd:rvb i="1"/></ext></extLst></bk>
</futureMetadata>
<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata>
<valueMetadata count="4"><bk><rc t="2" v="0"/></bk><bk><rc t="2" v="1"/></bk><bk><rc t="2" v="2"/></bk><bk><rc t="1" v="0"/></bk></valueMetadata>
</metadata>"#;

    // The second structure lists `errorType` in second place
    const STRUCTURES: &str = r#"<rvStructures count="2">
<s t="_error"><k n="errorType" t="i"/><k n="subType" t="i"/></s>
<s t="_error"><k n="colOffset" t="i"/><k n="errorType" t="i"/><k n="rwOffset" t="i"/><k n="subType" t="i"/></s>
</rvStructures>"#;

    const RICH_VALUES: &str = r#"<rvData count="3">
<rv s="0"><v>2</v><v>3</v></rv>
<rv s="1"><v>2</v><v>8</v><v>0</v><v>1</v></rv>
<rv s="0"><v>13</v><v>0</v></rv>
</rvData>"#;

    fn parse(source: &str) -> Vec<xml::Node> {
        xml::parse(source, None, None).unwrap().nodes
    }
    #[test]
    fn vm_is_resolved_through_rich_values_and_reordered_fields() {
        assert_eq!(
            errors(&parse(METADATA), &parse(RICH_VALUES), &parse(STRUCTURES)),
            vec![Some("#CALC!"), Some("#VALUE!"), Some("#SPILL!"), None]
        );
    }
    #[test]
    fn unknown_or_invalid_metadata_keeps_the_fallback() {
        for source in [
            METADATA.replace("i=\"2\"", "i=\"999\""),
            METADATA.replace("i=\"2\"", "i=\"x\""),
            METADATA.replace("t=\"2\"", "t=\"0\""),
        ] {
            assert_eq!(
                errors(&parse(&source), &parse(RICH_VALUES), &parse(STRUCTURES))[0],
                None
            );
        }
        for values in [
            RICH_VALUES.replace("<v>13</v>", "<v>999</v>"),
            RICH_VALUES.replace("s=\"0\"", "s=\"999\""),
        ] {
            assert_eq!(
                errors(&parse(METADATA), &parse(&values), &parse(STRUCTURES))[0],
                None
            );
        }
        assert_eq!(errors(&[], &parse(RICH_VALUES), &parse(STRUCTURES)), vec![]);
        assert!(
            errors(&parse(METADATA), &[], &parse(STRUCTURES))
                .iter()
                .all(Option::is_none)
        );
        assert!(
            errors(&parse(METADATA), &parse(RICH_VALUES), &[])
                .iter()
                .all(Option::is_none)
        );
        assert!(
            errors(
                &parse(METADATA),
                &parse(RICH_VALUES),
                &parse(&STRUCTURES.replace("_error", "other"))
            )
            .iter()
            .all(Option::is_none)
        );
    }
}
