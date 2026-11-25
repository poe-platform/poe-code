use mcp_protocol_rust::json::Value;
use safe_bash_rust::commands::{
    codecs::{parse_zip_archive, serialize_zip_archive},
    spreadsheet::Spreadsheet,
};

const LIMIT: usize = 64 * 1024 * 1024;

fn workbook(states: [&str; 3]) -> Vec<u8> {
    let mut book = Spreadsheet::new();
    book.rename_sheet(0, "Quote", LIMIT).unwrap();
    book.add_sheet("Rates").unwrap();
    book.add_sheet("Notes").unwrap();
    book.edit(
        &[
            (0, 0, 0, "=100*(1+Rates!A1)"),
            (1, 0, 0, "20%"),
            (2, 0, 0, "Supporting notes"),
        ],
        LIMIT,
    )
    .unwrap();
    let mut entries = parse_zip_archive(&book.export_xlsx(LIMIT).unwrap()).unwrap();
    let entry = entries
        .iter_mut()
        .find(|p| p.name == "xl/workbook.xml")
        .unwrap();
    let mut xml = String::from_utf8(entry.content.clone())
        .unwrap()
        .replace(" state=\"visible\"", "");
    for (name, state) in ["Quote", "Rates", "Notes"].into_iter().zip(states) {
        let before = format!("name=\"{name}\"");
        assert_eq!(xml.matches(&before).count(), 1);
        xml = xml.replace(&before, &format!("{before} state=\"{state}\""));
    }
    entry.content = xml.into_bytes();
    serialize_zip_archive(&entries)
}

fn states(book: &Spreadsheet) -> Vec<Option<String>> {
    let doc = book.to_json();
    let Value::Array(sheets) = doc.get("sheets").unwrap() else {
        panic!()
    };
    sheets
        .iter()
        .map(|sheet| match sheet.get("state") {
            None => None,
            Some(Value::String(s)) => Some(String::from_utf16(s).unwrap()),
            _ => panic!(),
        })
        .collect()
}

fn part(bytes: &[u8], name: &str) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|p| p.name == name)
            .unwrap()
            .content,
    )
    .unwrap()
}

#[test]
fn hidden_worksheets_survive_import_native_save_edit_and_excel_export() {
    let bytes = workbook(["visible", "hidden", "veryHidden"]);
    let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let expected = vec![None, Some("hidden".into()), Some("veryHidden".into())];
    assert_eq!(states(&book), expected);
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "120");
    book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(states(&book), expected);
    book.edit(&[(1, 0, 0, "30%")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "130");
    let exported = book.export_xlsx(LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&exported, LIMIT).unwrap();
    assert_eq!(states(&reopened), expected);
    assert_eq!(reopened.to_json(), book.to_json());
    assert_eq!(
        reopened.display(2, 0, 0, LIMIT).unwrap(),
        "Supporting notes"
    );
}

#[test]
fn invalid_visibility_and_all_hidden_workbooks_are_rejected() {
    for invalid in ["hidden", "veryHidden", "invalid"] {
        assert!(
            Spreadsheet::import_xlsx(&workbook([invalid, "hidden", "veryHidden"]), LIMIT).is_err(),
            "{invalid}"
        );
    }
    let mut book =
        Spreadsheet::import_xlsx(&workbook(["visible", "hidden", "veryHidden"]), LIMIT).unwrap();
    let before = book.to_json();
    assert!(book.delete_sheet(0, LIMIT).is_err());
    assert_eq!(book.to_json(), before);
    book.delete_sheet(1, LIMIT).unwrap();
    assert_eq!(states(&book), vec![None, Some("veryHidden".into())]);
}

#[test]
fn excel_selects_the_first_visible_worksheet() {
    let mut book =
        Spreadsheet::import_xlsx(&workbook(["hidden", "visible", "veryHidden"]), LIMIT).unwrap();
    book.sheets[1].frozen_rows = 2;
    book.sheets[1].frozen_columns = 1;
    let bytes = book.export_xlsx(LIMIT).unwrap();
    assert!(part(&bytes, "xl/workbook.xml").contains("activeTab=\"1\""));
    for (i, selected) in [(1, false), (2, true), (3, false)] {
        assert_eq!(
            part(&bytes, &format!("xl/worksheets/sheet{i}.xml")).contains("tabSelected=\"1\""),
            selected
        );
    }
}

#[test]
fn native_load_and_export_reject_invalid_visibility() {
    let mut book =
        Spreadsheet::import_xlsx(&workbook(["visible", "hidden", "veryHidden"]), LIMIT).unwrap();
    for invalid in ["hidden", "veryHidden", "invalid"] {
        book.sheets[0].state = invalid;
        assert!(
            Spreadsheet::from_json(&book.to_json(), LIMIT).is_err(),
            "{invalid}"
        );
        assert!(book.export_xlsx(LIMIT).is_err(), "{invalid}");
    }
}

#[test]
fn legacy_json_and_new_worksheets_default_to_visible() {
    let mut book = Spreadsheet::new();
    book.add_sheet("New").unwrap();
    assert_eq!(states(&book), vec![None, None]);
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(states(&restored), vec![None, None]);
    assert!(restored.export_xlsx(LIMIT).is_ok());
}
