// Cases adapted from IronCalc lookup_and_reference/{wrapcols_wraprows,trimrange}
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc), and complete
// Univer lookup/{wraprows,wrapcols}/__tests__/index.spec.ts at
// 4767b3b309467c283bbd52b725536ca73861e0fc (Apache-2.0, LICENSE.Univer).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn wrap_vectors_and_padding_match_upstream_typed_cases() {
    for name in ["WRAPROWS", "WRAPCOLS"] {
        for (pad, expected) in [
            ("", "#N/A"),
            (",", "#N/A"),
            (",NA()", "#N/A"),
            (",#NAME?", "#NAME?"),
            (",\"test\"", "test"),
            (",0", "0"),
        ] {
            let mut book = Spreadsheet::new();
            book.edit(
                &[(
                    0,
                    0,
                    0,
                    &format!("={name}({{\"Ben\",1,\"Mary\",-2}},3{pad})"),
                )],
                LIMIT,
            )
            .unwrap();
            let expected = if name == "WRAPROWS" {
                vec![vec!["Ben", "1", "Mary"], vec!["-2", expected, expected]]
            } else {
                vec![
                    vec!["Ben", "-2"],
                    vec!["1", expected],
                    vec!["Mary", expected],
                ]
            };
            for (r, row) in expected.iter().enumerate() {
                for (c, want) in row.iter().enumerate() {
                    assert_eq!(
                        book.display(0, r, c, LIMIT).unwrap(),
                        *want,
                        "{name}{pad}: {r},{c}"
                    );
                }
            }
        }
        for (source, count, want) in [
            ("#NAME?", "3", "#NAME?"),
            ("", "3", "#VALUE!"),
            ("\"test\"", "3", "test"),
            ("{1,2,3}", "0", "#NUM!"),
            ("{1,2,3}", "#NAME?", "#NAME?"),
            ("{1,2,3}", "\"test\"", "#VALUE!"),
            ("{1,2;3,4}", "2", "#VALUE!"),
            ("{1,2}", "-1", "#NUM!"),
            ("{1,2}", "0.9", "#NUM!"),
        ] {
            let mut book = Spreadsheet::new();
            book.edit(&[(0, 0, 0, &format!("={name}({source},{count})"))], LIMIT)
                .unwrap();
            assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want);
        }
    }
}

#[test]
fn wrapping_large_counts_stays_compact_and_parameter_arrays_broadcast() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=WRAPROWS({1;2;3},1E300)"),
            (0, 3, 0, "=WRAPCOLS({1,2,3},1E300)"),
            (
                0,
                7,
                0,
                "=WRAPROWS({\"Ben\",1,\"Mary\",-2},3,{\"a\",\"b\"})",
            ),
            (
                0,
                9,
                0,
                "=WRAPCOLS({\"Ben\",1,\"Mary\",-2},3,{\"a\",\"b\"})",
            ),
            (0, 11, 0, "=WRAPROWS({7,8,9},{2,0,#N/A,\"bad\"},0)"),
            (0, 14, 0, "=WRAPCOLS({1,2,3},2.9)"),
        ],
        100_000,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 0, "1"),
        (0, 2, "3"),
        (0, 3, ""),
        (3, 0, "1"),
        (5, 0, "3"),
        (6, 0, ""),
        (7, 0, "Ben"),
        (7, 1, "Ben"),
        (9, 0, "Ben"),
        (9, 1, "Ben"),
        (11, 0, "7"),
        (11, 1, "#NUM!"),
        (11, 2, "#N/A"),
        (11, 3, "#VALUE!"),
        (14, 1, "3"),
        (15, 1, "#N/A"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
}

#[test]
fn trimrange_preserves_reference_identity_and_scans_sparse_whole_columns() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 900_000, 0, "42"),
            (0, 900_002, 1, "7"),
            (0, 0, 3, "=TRIMRANGE(A:B)"),
            (0, 0, 7, "=ROW(TRIMRANGE(A:B))"),
            (0, 0, 9, "=ISREF(TRIMRANGE(A:B))"),
            (0, 1, 9, "=SUM(TRIMRANGE(A:B))"),
            (0, 2, 9, "=ROWS(TRIMRANGE(A:B))"),
            (0, 3, 9, "=COLUMNS(TRIMRANGE(A:B))"),
        ],
        100_000,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 3, "42"),
        (1, 3, "0"),
        (2, 4, "7"),
        (0, 7, "900001"),
        (1, 7, "900002"),
        (2, 7, "900003"),
        (0, 9, "TRUE"),
        (1, 9, "49"),
        (2, 9, "3"),
        (3, 9, "2"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
}

#[test]
fn trim_modes_keep_interior_blanks_empty_text_errors_and_zero() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 1, 1, "=\"\""),
            (0, 2, 2, "0"),
            (0, 3, 1, "#N/A"),
            (0, 0, 5, "=TRIMRANGE(A1:D5)"),
            (0, 6, 5, "=TRIMRANGE(A1:D5,1,0)"),
            (0, 12, 5, "=TRIMRANGE(A1:D5,2,2)"),
            (0, 18, 5, "=TRIMRANGE(A1:D5,0,0)"),
            (0, 24, 5, "=TRIMRANGE(A20:C25)"),
            (0, 26, 5, "=TRIMRANGE(A20:C21,0,0)"),
            (0, 29, 5, "=TRIMRANGE({0,1;2,3})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 5, ""),
        (0, 6, "0"),
        (1, 6, "0"),
        (2, 5, "#N/A"),
        (3, 5, ""),
        (6, 5, "0"),
        (6, 6, ""),
        (9, 5, "0"),
        (10, 5, ""),
        (12, 5, "0"),
        (15, 6, "#N/A"),
        (16, 5, ""),
        (18, 5, "0"),
        (22, 5, "0"),
        (23, 5, ""),
        (24, 5, "#REF!"),
        (26, 5, "0"),
        (27, 7, "0"),
        (28, 5, ""),
        (29, 5, "0"),
        (30, 6, "3"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
}

#[test]
fn reshape_errors_are_cells_and_work_limits_rollback_edits() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=TRIMRANGE()", "#ERROR!"),
        ("=TRIMRANGE(A1,1,2,3)", "#ERROR!"),
        ("=TRIMRANGE(B1:B2,-1)", "#VALUE!"),
        ("=TRIMRANGE(B1:B2,4)", "#VALUE!"),
        ("=TRIMRANGE(B1:B2,\"bad\")", "#VALUE!"),
        ("=TRIMRANGE(B1:B2,NA())", "#N/A"),
        ("=TRIMRANGE(#REF!)", "#REF!"),
        ("=WRAPROWS()", "#ERROR!"),
        ("=WRAPCOLS({1,2},2,0,1)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    book.edit(&[(0, 0, 0, "7")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=WRAPROWS(B:B,2)",
        "=WRAPCOLS(B:B,2)",
        "=WRAPROWS(SEQUENCE(100),60,REPT(\"x\",10000))",
        "=TRIMRANGE(B:B,0,0)",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 20_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn reshape_recalculates_late_spills_and_survives_json_excel() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=TRIMRANGE(C:C)"),
            (0, 2, 2, "=SEQUENCE(3)"),
            (0, 0, 5, "=WRAPROWS(A1#,2,0)"),
        ],
        LIMIT,
    )
    .unwrap();
    for restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 2, 0, LIMIT).unwrap(), "3");
        assert_eq!(restored.display(0, 1, 5, LIMIT).unwrap(), "3");
        assert_eq!(restored.display(0, 1, 6, LIMIT).unwrap(), "0");
    }
    book.edit(&[(0, 2, 2, "=SEQUENCE(2)")], LIMIT).unwrap();
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "");
    assert_eq!(book.display(0, 1, 5, LIMIT).unwrap(), "");
}

#[test]
fn reshaping_references_keeps_blank_values_and_refreshes_after_source_edits() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 1, 0, "'"),
            (0, 2, 0, "FALSE"),
            (0, 3, 0, "#N/A"),
            (0, 0, 2, "=WRAPROWS(A1:A4,3,\"pad\")"),
            (0, 4, 2, "=WRAPCOLS(A1:A4,3,\"pad\")"),
            (0, 8, 2, "=TRIMRANGE(A1:A4)"),
            (0, 12, 2, "=TRIMRANGE(A20:A21,0,0)"),
            (0, 15, 2, "=WRAPROWS(A20,3)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 2, "0"),
        (0, 3, ""),
        (0, 4, "FALSE"),
        (1, 2, "#N/A"),
        (1, 3, "pad"),
        (4, 2, "0"),
        (5, 2, ""),
        (6, 2, "FALSE"),
        (4, 3, "#N/A"),
        (5, 3, "pad"),
        (8, 2, ""),
        (9, 2, "FALSE"),
        (10, 2, "#N/A"),
        (12, 2, "0"),
        (13, 2, "0"),
        (15, 2, "0"),
        (15, 3, ""),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
    book.edit(&[(0, 1, 0, ""), (0, 3, 0, "")], LIMIT).unwrap();
    assert_eq!(book.display(0, 8, 2, LIMIT).unwrap(), "FALSE");
    assert_eq!(book.display(0, 9, 2, LIMIT).unwrap(), "");
    book.edit(&[(0, 0, 5, "=TRIMRANGE(F:F)")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 5, LIMIT).unwrap(), "#CIRC!");
}

#[test]
fn excel_exports_reshape_names_and_imports_without_private_formula_metadata() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 2, 0, "7"),
            (0, 3, 0, "8"),
            (0, 0, 2, "=TRIMRANGE(A:A)"),
            (0, 0, 4, "=WRAPROWS(C1#,3)"),
            (0, 0, 8, "=WRAPCOLS(C1#,1)"),
        ],
        LIMIT,
    )
    .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let archive = crate::commands::structured::read_office_archive(&bytes);
    let sheet = std::str::from_utf8(&archive["xl/worksheets/sheet1.xml"]).unwrap();
    for name in ["TRIMRANGE", "WRAPROWS", "WRAPCOLS"] {
        assert!(sheet.contains(&format!("_xlfn.{name}(")), "{sheet}");
    }
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>_xlfn.WRAPROWS({1;2;3},2)</f></c><c r="D1"><f>_xlfn.WRAPCOLS({4,5,6},2)</f></c><c r="G1"><f>_xlfn.TRIMRANGE(J1:J10)</f></c></row><row r="3"><c r="J3"><v>7</v></c></row><row r="4"><c r="J4"><v>8</v></c></row></sheetData></worksheet>"#),
    ]);
    let mut restored = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    assert_eq!(restored.display(0, 1, 0, LIMIT).unwrap(), "3");
    assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "#N/A");
    assert_eq!(restored.display(0, 0, 4, LIMIT).unwrap(), "6");
    assert_eq!(restored.display(0, 1, 6, LIMIT).unwrap(), "8");
    restored.edit(&[(0, 3, 9, "9")], LIMIT).unwrap();
    assert_eq!(restored.display(0, 1, 6, LIMIT).unwrap(), "9");
}

#[test]
fn wrap_rejects_three_dimensional_parameters_without_losing_padding_errors() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (1, 0, 0, "3"),
            (0, 0, 2, "=WRAPROWS({1,2,3},Sheet1:Other!A1)"),
            (0, 3, 2, "=WRAPCOLS({1,2,3},2,Sheet1:Other!A1)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#VALUE!");
    assert_eq!(book.display(0, 3, 2, LIMIT).unwrap(), "1");
    assert_eq!(book.display(0, 4, 3, LIMIT).unwrap(), "#VALUE!");
}
