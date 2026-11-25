use mcp_protocol_rust::json::Value;
use safe_bash_rust::commands::{
    codecs::{parse_zip_archive, serialize_zip_archive},
    spreadsheet::Spreadsheet,
};

const LIMIT: usize = 64 * 1024 * 1024;
const FLAGS: [&str; 4] = [
    "showFirstColumn",
    "showLastColumn",
    "showRowStripes",
    "showColumnStripes",
];

fn workbook(style: &str) -> Vec<u8> {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Item"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "Paper"),
            (0, 1, 1, "10"),
            (0, 2, 0, "Pens"),
            (0, 2, 1, "20"),
            (0, 0, 3, "=SUM(Orders[Amount])"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
    let mut entries = parse_zip_archive(&book.export_xlsx(LIMIT).unwrap()).unwrap();
    let entry = entries
        .iter_mut()
        .find(|e| e.name == "xl/tables/table1.xml")
        .unwrap();
    let xml = String::from_utf8(entry.content.clone()).unwrap();
    assert!(!xml.contains("<tableStyleInfo"));
    entry.content = xml
        .replace("</table>", &format!("{style}</table>"))
        .into_bytes();
    serialize_zip_archive(&entries)
}

fn table_xml(bytes: &[u8]) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|e| e.name == "xl/tables/table1.xml")
            .unwrap()
            .content,
    )
    .unwrap()
}

fn style(book: &Spreadsheet) -> Option<Value> {
    let doc = book.to_json();
    let Value::Array(tables) = doc.get("options").unwrap().get("tables").unwrap() else {
        panic!()
    };
    tables[0].get("style").cloned()
}

#[test]
fn table_style_name_and_all_flag_combinations_survive_edits_and_roundtrips() {
    for mask in 0..16 {
        let mut source = String::from("<tableStyleInfo name=\"TableStyleMedium9\"");
        for (i, name) in FLAGS.into_iter().enumerate() {
            source.push_str(&format!(" {name}=\"{}\"", (mask >> i) & 1));
        }
        source.push_str("/>");
        let mut book = Spreadsheet::import_xlsx(&workbook(&source), LIMIT).unwrap();
        let before = style(&book).expect("table style metadata must survive import");
        book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        book.edit(&[(0, 1, 1, "15")], LIMIT).unwrap();
        book.rename_table(0, "Supplies", LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 3, LIMIT).unwrap(), "35");
        assert_eq!(style(&book), Some(before.clone()));
        let bytes = book.export_xlsx(LIMIT).unwrap();
        assert!(table_xml(&bytes).contains(&source));
        let reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(style(&reopened), Some(before));
        assert_eq!(reopened.display(0, 1, 1, LIMIT).unwrap(), "15");
        assert_eq!(reopened.display(0, 0, 3, LIMIT).unwrap(), "35");
    }
}

#[test]
fn absent_and_unnamed_table_styles_remain_distinct() {
    for source in [
        "",
        "<tableStyleInfo/>",
        "<tableStyleInfo showColumnStripes=\"true\"/>",
    ] {
        let book = Spreadsheet::import_xlsx(&workbook(source), LIMIT).unwrap();
        let expected = !source.is_empty();
        assert_eq!(style(&book).is_some(), expected);
        let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        let xml = table_xml(&restored.export_xlsx(LIMIT).unwrap());
        assert_eq!(xml.contains("<tableStyleInfo"), expected);
        assert!(!xml.contains("TableStyleMedium"));
        if source.contains("true") {
            assert!(xml.contains("showColumnStripes=\"1\""));
        }
    }
}

#[test]
fn table_style_names_preserve_xml_escaping_without_changing_cells() {
    let source = "<tableStyleInfo name=\"A &amp; B &quot;Theme&quot;\" showFirstColumn=\"true\"/>";
    let book = Spreadsheet::import_xlsx(&workbook(source), LIMIT).unwrap();
    let saved = book.to_json();
    let output = book.export_xlsx(LIMIT).unwrap();
    let xml = table_xml(&output);
    assert!(xml.contains("name=\"A &amp; B &quot;Theme&quot;\""));
    assert!(xml.contains("showFirstColumn=\"1\""));
    assert_eq!(book.to_json(), saved);
    let reopened = Spreadsheet::import_xlsx(&output, LIMIT).unwrap();
    assert_eq!(style(&reopened), style(&book));
}
