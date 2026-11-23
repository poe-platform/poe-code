// Adapted from IronCalc test/lookup_and_reference/test_fn_expand.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc), and all cases in
// Univer lookup/expand/__tests__/index.spec.ts at
// 4767b3b309467c283bbd52b725536ca73861e0fc (Apache-2.0, LICENSE.Univer).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn expand_keeps_source_values_and_fills_only_added_rows_and_columns() {
    for pad in ["", ",0", ",\"pending\"", ",TRUE", ",#DIV/0!", ",{\"a\"}"] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[(0, 0, 0, &format!("=EXPAND({{2,2;2,2}},3,3{pad})"))],
            LIMIT,
        )
        .unwrap();
        let fill = match pad {
            "" => "#N/A",
            ",0" => "0",
            ",TRUE" => "TRUE",
            ",#DIV/0!" => "#DIV/0!",
            ",{\"a\"}" => "a",
            _ => "pending",
        };
        for r in 0..3 {
            for c in 0..3 {
                assert_eq!(
                    book.display(0, r, c, LIMIT).unwrap(),
                    if r < 2 && c < 2 { "2" } else { fill },
                    "{pad}: {r},{c}"
                );
            }
        }
    }
    for (formula, want) in [
        ("=EXPAND({7,8},1,2)", vec![vec!["7", "8"]]),
        (
            "=EXPAND({1;2},4)",
            vec![vec!["1"], vec!["2"], vec!["#N/A"], vec!["#N/A"]],
        ),
        (
            "=EXPAND({1;2},3,2,0)",
            vec![vec!["1", "0"], vec!["2", "0"], vec!["0", "0"]],
        ),
        (
            "=EXPAND({\"\",TRUE;#N/A,\"007\"},3,3,\"\")",
            vec![
                vec!["", "TRUE", ""],
                vec!["#N/A", "007", ""],
                vec!["", "", ""],
            ],
        ),
        (
            "=EXPAND(\"label\",2,2)",
            vec![vec!["label", "#N/A"], vec!["#N/A", "#N/A"]],
        ),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        for (r, row) in want.iter().enumerate() {
            for (c, value) in row.iter().enumerate() {
                assert_eq!(
                    book.display(0, r, c, LIMIT).unwrap(),
                    *value,
                    "{formula}: {r},{c}"
                );
            }
        }
    }
}

#[test]
fn expand_dimensions_coerce_omissions_booleans_and_numbers_without_shrinking() {
    for (rows, columns, want) in [
        ("", "2", "2"),
        ("TRUE", "2", "2"),
        ("FALSE", "2", "#VALUE!"),
        ("\"test\"", "2", "#VALUE!"),
        ("#NAME?", "2", "#NAME?"),
        ("2", "", "2"),
        ("2", "TRUE", "2"),
        ("2", "FALSE", "#VALUE!"),
        ("2", "\"test\"", "#VALUE!"),
        ("2", "#NAME?", "#NAME?"),
        ("0", "2", "#VALUE!"),
        ("2", "0", "#VALUE!"),
        ("-2", "2", "#VALUE!"),
        ("2", "-2", "#VALUE!"),
        ("1.9", "2.9", "2"),
        ("\"2\"", "\"2\"", "2"),
        ("1E300", "1", "#NUM!"),
        ("1", "1E300", "#NUM!"),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[(0, 0, 0, &format!("=EXPAND({{2}},{rows},{columns})"))],
            LIMIT,
        )
        .unwrap();
        assert_eq!(
            book.display(0, 0, 0, LIMIT).unwrap(),
            want,
            "{rows},{columns}"
        );
    }
    for (formula, want) in [
        ("=EXPAND({1;2;3},2)", "#VALUE!"),
        ("=EXPAND({1,2,3},3,2)", "#VALUE!"),
        ("=EXPAND(#NAME?,0,0)", "#NAME?"),
        ("=EXPAND(,1,1)", "#VALUE!"),
        ("=EXPAND(1,1,1)", "1"),
        ("=EXPAND({2,2;2,2},3,3,{\"a\",\"b\"})", "#VALUE!"),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "=EXPAND({2},,2)"), (0, 3, 0, "=EXPAND({2},2,)")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "#N/A");
    assert_eq!(book.display(0, 4, 0, LIMIT).unwrap(), "#N/A");
}

#[test]
fn expand_parameter_arrays_broadcast_without_allocating_nested_results() {
    for (source, first, rest) in [
        ("1", "1", "#VALUE!"),
        ("#NAME?", "#NAME?", "#NAME?"),
        ("", "#VALUE!", "#VALUE!"),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[(0, 0, 0, &format!("=EXPAND({source},{{1;0;0}},{{1,0}})"))],
            LIMIT,
        )
        .unwrap();
        for r in 0..3 {
            for c in 0..2 {
                assert_eq!(
                    book.display(0, r, c, LIMIT).unwrap(),
                    if r == 0 && c == 0 { first } else { rest }
                );
            }
        }
    }
    for formula in ["=EXPAND({2},{1,2},2)", "=EXPAND({2},2,{1,2})"] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "2");
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "2");
        assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "");
    }
}

#[test]
fn expand_reference_blanks_and_padding_remain_typed_and_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "'007"),
            (0, 2, 0, "TRUE"),
            (0, 3, 0, "=NA()"),
            (0, 0, 3, "=EXPAND(A1:A4,5,2,B1)"),
            (0, 0, 6, "=ISTEXT(D1)"),
            (0, 1, 6, "=ISNUMBER(D2)"),
            (0, 2, 6, "=ISLOGICAL(D3)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 3, "007"),
        (1, 3, "0"),
        (2, 3, "TRUE"),
        (3, 3, "#N/A"),
        (4, 3, "0"),
        (0, 4, "0"),
        (0, 6, "TRUE"),
        (1, 6, "TRUE"),
        (2, 6, "TRUE"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
    book.edit(&[(0, 1, 0, "9"), (0, 0, 1, "'009")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 1, 3, LIMIT).unwrap(), "9");
    assert_eq!(book.display(0, 4, 4, LIMIT).unwrap(), "009");
}

#[test]
fn expand_bounds_output_allocation_and_rollback_before_scanning_large_ranges() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "7")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=EXPAND(A1,10000,10000,\"padding\")",
        "=EXPAND(A:A,1048576)",
        "=EXPAND(A1,20,20,REPT(\"x\",10000))",
    ] {
        assert!(
            book.edit(&[(0, 0, 2, formula)], 100_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
    book.edit(&[(0, 0, 2, "=EXPAND(A:A,1)")], 100_000).unwrap();
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#VALUE!");
}

#[test]
fn expand_reads_delayed_spills_and_roundtrips_json_and_excel() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=EXPAND(C1#,4,2,0)"),
            (0, 0, 2, "=SEQUENCE(3)"),
            (0, 0, 5, "=SUM(A1#)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, want) in [
            (0, 0, "1"),
            (2, 0, "3"),
            (3, 0, "0"),
            (3, 1, "0"),
            (0, 5, "6"),
        ] {
            assert_eq!(restored.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
        }
        restored.edit(&[(0, 0, 2, "=SEQUENCE(2)")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 2, 0, LIMIT).unwrap(), "0");
        assert_eq!(restored.display(0, 0, 5, LIMIT).unwrap(), "3");
    }
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let archive = crate::commands::structured::read_office_archive(&bytes);
    let sheet = std::str::from_utf8(&archive["xl/worksheets/sheet1.xml"]).unwrap();
    assert!(sheet.contains("_xlfn.EXPAND("), "{sheet}");
}

#[test]
fn expand_rejects_three_dimensional_sizes_and_handles_padding_errors_in_place() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (1, 0, 0, "3"),
            (0, 0, 2, "=EXPAND(Sheet1:Other!A1,2,2)"),
            (0, 2, 2, "=EXPAND({1,2},Sheet1:Other!A1,2)"),
            (0, 4, 2, "=EXPAND({1,2},2,Sheet1:Other!A1)"),
            (0, 6, 2, "=EXPAND({1,2},2,2,Sheet1:Other!A1)"),
        ],
        LIMIT,
    )
    .unwrap();
    for r in [0, 2, 4] {
        assert_eq!(book.display(0, r, 2, LIMIT).unwrap(), "#VALUE!");
    }
    assert_eq!(book.display(0, 6, 2, LIMIT).unwrap(), "1");
    assert_eq!(book.display(0, 6, 3, LIMIT).unwrap(), "2");
    assert_eq!(book.display(0, 7, 2, LIMIT).unwrap(), "#VALUE!");
    for formula in ["=EXPAND()", "=EXPAND(1)", "=EXPAND(1,2,2,0,0)"] {
        book.edit(&[(0, 0, 2, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#ERROR!");
    }
}

#[test]
fn expand_imports_plain_excel_formulas_without_private_metadata() {
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>_xlfn.EXPAND({1,2},3,3)</f></c><c r="E1"><f>_xlfn.EXPAND(G1:G2,4,,&quot;007&quot;)</f></c><c r="G1"><v>7</v></c></row><row r="2"><c r="G2"><v>8</v></c></row></sheetData></worksheet>"#),
    ]);
    let mut book = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    for (r, c, want) in [
        (0, 0, "1"),
        (0, 1, "2"),
        (2, 2, "#N/A"),
        (1, 4, "8"),
        (2, 4, "007"),
        (3, 4, "007"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
    book.edit(&[(0, 1, 6, "9")], LIMIT).unwrap();
    assert_eq!(book.display(0, 1, 4, LIMIT).unwrap(), "9");
}
