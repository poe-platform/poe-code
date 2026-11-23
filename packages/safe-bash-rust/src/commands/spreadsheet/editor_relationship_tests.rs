// Adapted from IronCalc f93662006b8fb1c401dc870bbda26c5d60ac6037
// xlsx/tests/sheet_relationship_import.rs (MIT; LICENSE.IronCalc).
// Original package contents and expectations retained; use Poe APIs and ZIP writer.
//! A `<sheet>` in `xl/workbook.xml` names its worksheet part through `r:id`,
//! which shall reference that part (ECMA-376 Part 1, §12.3.24). A file whose
//! `r:id` is empty or points at no relationship does not conform; reading it
//! returns an error naming the sheet instead of panicking.

use super::Spreadsheet;
const LIMIT: usize = 20_000_000;

const MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// A workbook with two sheets: "Data" (r:id="rId1", a valid relationship) and
/// "Summary" with the given `r:id`.
fn xlsx(summary_rid: &str) -> Vec<u8> {
    let parts = [
        (
            "[Content_Types].xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
             <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
             <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
             <Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
             <Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
             <Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>\
             </Types>"
                .to_string(),
        ),
        (
            "_rels/.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
             </Relationships>"
                .to_string(),
        ),
        (
            "xl/workbook.xml",
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                 <workbook xmlns=\"{MAIN}\" \
                 xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
                 <sheets>\
                 <sheet name=\"Data\" sheetId=\"1\" r:id=\"rId1\"/>\
                 <sheet name=\"Summary\" sheetId=\"2\" r:id=\"{summary_rid}\"/>\
                 </sheets></workbook>"
            ),
        ),
        (
            "xl/_rels/workbook.xml.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\
             <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>\
             </Relationships>"
                .to_string(),
        ),
        (
            "xl/worksheets/sheet1.xml",
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                 <worksheet xmlns=\"{MAIN}\"><sheetData>\
                 <row r=\"1\"><c r=\"A1\"><v>42</v></c></row>\
                 </sheetData></worksheet>"
            ),
        ),
        (
            "xl/styles.xml",
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                 <styleSheet xmlns=\"{MAIN}\">\
                 <fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>\
                 <fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills>\
                 <borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
                 <cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\
                 <cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs>\
                 </styleSheet>"
            ),
        ),
    ];
    office_package_rust::write_zip_stored(
        &parts
            .iter()
            .map(|(name, content)| (*name, content.as_bytes()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn sheet_with_valid_relationship_loads() {
    // The same workbook with both sheets pointing at the one worksheet part.
    let workbook = Spreadsheet::import_xlsx(&xlsx("rId1"), LIMIT).unwrap();
    assert_eq!(workbook.sheets.len(), 2);
}

#[test]
fn sheet_with_empty_or_unknown_relationship_is_an_error() {
    for rid in ["", "rId99"] {
        match Spreadsheet::import_xlsx(&xlsx(rid), LIMIT) {
            Err(message) => {
                assert!(message.contains("Summary"), "r:id=\"{rid}\": {message}");
            }
            Ok(_) => panic!("r:id=\"{rid}\": loaded a sheet with no relationship"),
        }
    }
}

#[test]
fn invalid_sheet_metadata_cannot_silently_drop_or_rename_a_sheet() {
    let valid = xlsx("rId1");
    for (part, before, after) in [
        (
            "xl/workbook.xml",
            "sheetId=\"2\" r:id=\"rId1\"",
            "sheetId=\"2\"",
        ),
        ("xl/workbook.xml", "name=\"Summary\"", "name=\"Bad/name\""),
        ("xl/workbook.xml", "name=\"Summary\" ", ""),
        (
            "xl/_rels/workbook.xml.rels",
            " Target=\"worksheets/sheet1.xml\"",
            "",
        ),
        (
            "xl/_rels/workbook.xml.rels",
            "Target=\"worksheets/sheet1.xml\"",
            "Target=\"\"",
        ),
        (
            "xl/_rels/workbook.xml.rels",
            "Id=\"rId1\"",
            "Id=\"rId1\" TargetMode=\"External\"",
        ),
    ] {
        let mut entries = crate::commands::structured::read_office_archive(&valid);
        let source = String::from_utf8(entries[part].clone()).unwrap();
        assert!(source.contains(before));
        entries.insert(part.into(), source.replace(before, after).into_bytes());
        let bytes = office_package_rust::write_zip_stored(
            &entries
                .iter()
                .map(|(n, b)| (n.as_str(), b.as_slice()))
                .collect::<Vec<_>>(),
        );
        assert!(
            Spreadsheet::import_xlsx(&bytes, LIMIT).is_err(),
            "{before} -> {after}"
        );
    }
}

#[test]
fn relationship_targets_preserve_values_and_order_after_json_reopening() {
    let imported = Spreadsheet::import_xlsx(&xlsx("rId1"), LIMIT).unwrap();
    for book in [
        &imported,
        &Spreadsheet::from_json(&imported.to_json(), LIMIT).unwrap(),
    ] {
        assert_eq!(
            book.sheets
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            ["Data", "Summary"]
        );
        for sheet in 0..2 {
            assert_eq!(book.display(sheet, 0, 0, LIMIT).unwrap(), "42");
        }
    }
}
