// FORMULATEXT reference/array cases adapt IronCalc f936620 and Univer 4767b3b.
// See LICENSE.IronCalc and LICENSE.Univer.
use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn formula_text_reads_source_without_evaluating_it() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=FORMULATEXT(A1)"),
            (0, 1, 0, "=B2"),
            (0, 1, 1, "=FORMULATEXT(A2)"),
            (0, 2, 0, "=1/0"),
            (0, 2, 1, "=FORMULATEXT(A3)"),
            (0, 3, 0, "=CONCATENATE(FORMULATEXT(B4),\" NOT CIRCULAR!\")"),
            (0, 3, 1, "=A4"),
            (0, 4, 0, "=SUM(1,  2)"),
            (0, 4, 1, "=FORMULATEXT(A5)"),
            (0, 5, 0, "=LET(items,{1,2},SUM(items))"),
            (0, 5, 1, "=FORMULATEXT(A6)"),
            (0, 6, 0, "=UNKNOWN(1)"),
            (0, 6, 1, "=FORMULATEXT(A7)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (0, 0, "=FORMULATEXT(A1)"),
        (1, 0, "=B2"),
        (1, 1, "=B2"),
        (2, 1, "=1/0"),
        (3, 0, "=A4 NOT CIRCULAR!"),
        (3, 1, "=A4 NOT CIRCULAR!"),
        (4, 1, "=SUM(1,  2)"),
        (5, 1, "=LET(items,{1,2},SUM(items))"),
        (6, 1, "=UNKNOWN(1)"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e, "{r},{c}");
        assert!(matches!(
            b.cell(0, r, c).unwrap().value,
            Some(Value::Text(_))
        ));
    }
}

#[test]
fn formula_text_arrays_keep_missing_formulas_and_explicit_intersection() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=1+1"),
            (0, 1, 0, "5"),
            (0, 0, 1, "=SUM(A1:A2)"),
            (0, 0, 3, "=FORMULATEXT(A1:B2)"),
            (0, 4, 3, "=COUNTA(FORMULATEXT(A1:B2))"),
            (0, 5, 3, "=SUM(--ISNA(FORMULATEXT(A1:B2)))"),
            (0, 0, 7, "=FORMULATEXT(@A:A)"),
            (0, 1, 7, "=FORMULATEXT(@A:A)"),
            (0, 4, 0, "=SEQUENCE(2)"),
            (0, 4, 1, "=FORMULATEXT(A5:A6)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (0, 3, "=1+1"),
        (0, 4, "=SUM(A1:A2)"),
        (1, 3, "#N/A"),
        (1, 4, "#N/A"),
        (4, 3, "4"),
        (5, 3, "2"),
        (0, 7, "=1+1"),
        (1, 7, "#N/A"),
        (4, 1, "=SEQUENCE(2)"),
        (5, 1, "#N/A"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e, "{r},{c}");
    }
    b.edit(&[(0, 1, 4, "blocked")], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), "#SPILL!");
}

#[test]
fn formula_text_validates_arguments_and_source_length_before_allocating() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=FORMULATEXT()", "#ERROR!"),
        ("=FORMULATEXT(A1,A2)", "#ERROR!"),
        ("=FORMULATEXT(A1)", "#N/A"),
        ("=FORMULATEXT(42)", "#VALUE!"),
        ("=FORMULATEXT(\"text\")", "#VALUE!"),
        ("=FORMULATEXT(#REF!)", "#REF!"),
        ("=FORMULATEXT(#DIV/0!)", "#DIV/0!"),
    ] {
        b.edit(&[(0, 0, 1, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 1, LIMIT).unwrap(), e, "{f}");
    }
    for size in [8189, 8190] {
        let f = format!("=\"{}\"", "x".repeat(size));
        b.edit(&[(0, 0, 0, &f), (0, 0, 1, "=FORMULATEXT(A1)")], LIMIT)
            .unwrap();
        assert_eq!(
            b.display(0, 0, 1, LIMIT).unwrap(),
            if size == 8189 { f.as_str() } else { "#N/A" }
        );
    }
    let before = b.to_json();
    assert!(
        b.edit(
            &[(0, 1, 0, "changed"), (0, 0, 2, "=FORMULATEXT(A:A)")],
            100_000
        )
        .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn formula_text_preserves_typed_constants_across_excel_import() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "TRUE"),
            (0, 1, 0, "FALSE"),
            (0, 2, 0, "#DIV/0!"),
            (0, 3, 0, "#N/A"),
            (0, 4, 0, "=TRUE()"),
            (0, 5, 0, "=#DIV/0!"),
            (0, 0, 2, "=FORMULATEXT(A1:A6)"),
            (0, 0, 3, "=ISFORMULA(A1:A6)"),
        ],
        LIMIT,
    )
    .unwrap();
    for book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, input) in ["TRUE", "FALSE", "#DIV/0!", "#N/A", "=TRUE()", "=#DIV/0!"]
            .into_iter()
            .enumerate()
        {
            assert_eq!(book.input(0, r, 0), input);
            assert_eq!(
                book.display(0, r, 2, LIMIT).unwrap(),
                if r < 4 { "#N/A" } else { input }
            );
            assert_eq!(
                book.display(0, r, 3, LIMIT).unwrap(),
                if r < 4 { "FALSE" } else { "TRUE" }
            );
        }
    }
}

#[test]
fn concatenate_broadcasts_typed_arguments_and_preserves_error_order() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(0, 0, 0, "=CONCATENATE({\"a\",TRUE;2,#N/A},\"!\")")],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [(0, 0, "a!"), (0, 1, "TRUE!"), (1, 0, "2!"), (1, 1, "#N/A")] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
    }
    b.edit(&[(0, 0, 0, "=CONCATENATE({#DIV/0!,\"a\"},NA())")], LIMIT)
        .unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#DIV/0!");
    assert_eq!(b.display(0, 0, 1, LIMIT).unwrap(), "#N/A");
    for (f, e) in [
        ("=CONCATENATE()", "#ERROR!"),
        ("=CONCATENATE(TRUE,FALSE,Z1,0.1+0.2)", "TRUEFALSE0.3"),
        ("=LEN(CONCATENATE(REPT(\"a\",32766),\"b\"))", "32767"),
        ("=CONCATENATE(REPT(\"a\",32767),\"b\")", "#VALUE!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
    for n in [255, 256] {
        let f = format!("=CONCATENATE({})", vec!["\"x\""; n].join(","));
        b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
        assert_eq!(
            b.display(0, 0, 0, LIMIT).unwrap(),
            if n == 255 {
                "x".repeat(n)
            } else {
                "#ERROR!".into()
            }
        );
    }
}

#[test]
fn formula_text_and_formula_bar_read_fixed_array_member_sources() {
    let input=office_package_rust::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#.as_slice()),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:A2">ROW(A1:A2)</f><v>1</v></c><c r="C1"><f>_xlfn.FORMULATEXT(A2)</f></c></row><row r="2"><c r="A2"><v>2</v></c><c r="C2"><f>_xlfn.ISFORMULA(A2)</f></c></row></sheetData></worksheet>"#),
    ]);
    let b = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    for mut book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(book.input(0, 1, 0), "=ROW(A1:A2)");
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "=ROW(A1:A2)");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "TRUE");
        assert!(book.edit(&[(0, 1, 0, "3")], LIMIT).is_err());
        book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
        assert_eq!(book.input(0, 2, 0), "=ROW(A2:A3)");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "=ROW(A2:A3)");
    }
}

#[test]
fn formula_text_tracks_source_changes_tables_and_structure_through_reopening() {
    let mut b = Spreadsheet::new();
    b.add_sheet("Summary").unwrap();
    b.edit(
        &[(0, 0, 0, "Amount"), (0, 1, 0, "3"), (0, 2, 0, "5")],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Sales", [0, 0, 2, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 0, 2, "=SUM(Sales[Amount])"),
            (1, 0, 0, "=FORMULATEXT(Sheet1!C1)"),
            (0, 4, 2, "=FORMULATEXT(C5)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(
        b.input(0, 0, 2),
        "=SUM(Sales[Amount])",
        "initial formula bar"
    );
    assert_eq!(
        b.display(1, 0, 0, LIMIT).unwrap(),
        "=SUM(Sales[Amount])",
        "initial formula text"
    );
    for (stage, mut book) in [
        ("json", Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap()),
        (
            "xlsx",
            Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ),
    ] {
        assert_eq!(
            book.input(0, 0, 2),
            "=SUM(Sales[Amount])",
            "{stage} formula bar"
        );
        assert_eq!(
            book.display(1, 0, 0, LIMIT).unwrap(),
            "=SUM(Sales[Amount])",
            "{stage} formula text"
        );
        book.rename_table(0, "Costs", LIMIT).unwrap();
        assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "=SUM(Costs[Amount])");
        book.edit(&[(0, 0, 2, "=SUM(Costs[Amount])*2")], LIMIT)
            .unwrap();
        assert_eq!(
            book.display(1, 0, 0, LIMIT).unwrap(),
            "=SUM(Costs[Amount])*2"
        );
        book.rename_sheet(0, "New data", LIMIT).unwrap();
        book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
        assert_eq!(
            book.display(1, 0, 0, LIMIT).unwrap(),
            "=SUM(Costs[Amount])*2"
        );
        assert_eq!(book.display(0, 5, 2, LIMIT).unwrap(), "=FORMULATEXT(C6)");
    }
}
