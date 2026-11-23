// Adapted from IronCalc engineering/test_bit_operations.rs (MIT,
// f93662006b8fb1c401dc870bbda26c5d60ac6037) and all five Univer bit-function
// test files (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn bit_functions_match_upstream_scalars_and_validate_argument_contracts() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, want) in [
        ("=BITAND(1,5)", "1"),
        ("=BITAND(13,25)", "9"),
        ("=BITOR(1,5)", "5"),
        ("=BITOR(13,10)", "15"),
        ("=BITXOR(1,5)", "4"),
        ("=BITXOR(13,25)", "20"),
        ("=BITLSHIFT(4,2)", "16"),
        ("=BITLSHIFT(13,7)", "1664"),
        ("=BITRSHIFT(4,2)", "1"),
        ("=BITRSHIFT(13,7)", "0"),
        ("=BITRSHIFT(145,-3)", "1160"),
        ("=BITLSHIFT(16,-2)", "4"),
        ("=BITAND(\"1\",5)", "1"),
        ("=BITOR(TRUE,10)", "11"),
        ("=BITXOR(Z1,3)", "3"),
        ("=BITAND(,25)", "0"),
        ("=BITLSHIFT(4,2.9)", "16"),
        ("=BITRSHIFT(16,-1.9)", "32"),
        ("=BITLSHIFT(4,-0.9)", "4"),
        ("=BITRSHIFT(16,0.9)", "16"),
        ("=BITAND(\"TRUE\",1)", "#VALUE!"),
        ("=BITLSHIFT(1,\"false\")", "#VALUE!"),
        ("=BITOR(NA(),1)", "#N/A"),
        ("=BITXOR(1,1/0)", "#DIV/0!"),
        ("=BITAND(\"bad\",1)", "#VALUE!"),
        ("=BITLSHIFT(1,\"bad\")", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{formula}: {actual} != {want}"));
        }
    }
    for name in ["BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT"] {
        for args in ["", "1", "1,2,3", "1/0", "1,2,NA()"] {
            let formula = format!("={name}({args})");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let actual = book.display(0, 0, 0, LIMIT).unwrap();
            if actual != "#ERROR!" {
                failures.push(format!("{formula}: {actual} != #ERROR!"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn bit_functions_keep_all_48_bits_and_check_shift_overflow_before_shifting() {
    let mut book = Spreadsheet::new();
    for bit in 0..48 {
        let value = 1u64 << bit;
        let maximum = (1u64 << 48) - 1;
        let formulas = [
            format!("=BITAND({maximum},{value})"),
            format!("=BITOR({},{value})", maximum - value),
            format!("=BITXOR({maximum},{value})"),
            format!("=BITLSHIFT(1,{bit})"),
            format!("=BITRSHIFT({value},{bit})"),
        ];
        let wants = [value, maximum, maximum - value, value, 1];
        for (formula, want) in formulas.iter().zip(wants) {
            book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
            assert_eq!(
                book.display(0, 0, 0, LIMIT).unwrap(),
                want.to_string(),
                "{formula}"
            );
        }
    }
    for (formula, want) in [
        (
            "=BITAND(281474976710655,281474976710655)",
            "281474976710655",
        ),
        ("=BITLSHIFT(0,53)", "0"),
        ("=BITRSHIFT(281474976710655,53)", "0"),
        ("=BITLSHIFT(1,48)", "#NUM!"),
        ("=BITLSHIFT(140737488355328,17)", "#NUM!"),
        ("=BITRSHIFT(140737488355328,-17)", "#NUM!"),
        ("=BITRSHIFT(12,-53)", "#NUM!"),
        ("=BITLSHIFT(12,53)", "#NUM!"),
        ("=BITLSHIFT(0,53.1)", "#NUM!"),
        ("=BITRSHIFT(0,-53.1)", "#NUM!"),
        ("=BITLSHIFT(1,1E100)", "#NUM!"),
        ("=BITAND(1E100,1)", "#NUM!"),
        ("=BITAND(-1,1)", "#NUM!"),
        ("=BITOR(1,-1)", "#NUM!"),
        ("=BITXOR(1.1,1)", "#NUM!"),
        ("=BITLSHIFT(1.1,1)", "#NUM!"),
        ("=BITAND(281474976710656,0)", "#NUM!"),
        ("=BITXOR(0,281474976710656)", "#NUM!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn bit_function_arrays_preserve_all_upstream_types_and_errors() {
    let inputs = [
        "1", "' ", "1.23", "TRUE", "FALSE", "", "0", "'100", "'2.34", "test", "-3", "=#NAME?",
    ];
    for (name, argument, wants) in [
        (
            "BITAND",
            25,
            [
                "1", "#VALUE!", "#NUM!", "1", "0", "0", "0", "0", "#NUM!", "#VALUE!", "#NUM!",
                "#NAME?",
            ],
        ),
        (
            "BITOR",
            10,
            [
                "11", "#VALUE!", "#NUM!", "11", "10", "10", "10", "110", "#NUM!", "#VALUE!",
                "#NUM!", "#NAME?",
            ],
        ),
        (
            "BITXOR",
            3,
            [
                "2", "#VALUE!", "#NUM!", "2", "3", "3", "3", "103", "#NUM!", "#VALUE!", "#NUM!",
                "#NAME?",
            ],
        ),
        (
            "BITLSHIFT",
            2,
            [
                "4", "#VALUE!", "#NUM!", "4", "0", "0", "0", "400", "#NUM!", "#VALUE!", "#NUM!",
                "#NAME?",
            ],
        ),
        (
            "BITRSHIFT",
            2,
            [
                "0", "#VALUE!", "#NUM!", "0", "0", "0", "0", "25", "#NUM!", "#VALUE!", "#NUM!",
                "#NAME?",
            ],
        ),
    ] {
        let mut book = Spreadsheet::new();
        let mut edits: Vec<_> = inputs
            .iter()
            .enumerate()
            .map(|(i, s)| (0, i / 6, i % 6, *s))
            .collect();
        let formula = format!("={name}(A1:F2,{argument})");
        edits.push((0, 4, 0, &formula));
        book.edit(&edits, LIMIT).unwrap();
        for (i, want) in wants.iter().enumerate() {
            assert_eq!(
                book.display(0, 4 + i / 6, i % 6, LIMIT).unwrap(),
                *want,
                "{formula} cell {i}"
            );
        }
    }
}

#[test]
fn bit_table_columns_and_arrays_recalculate_after_json_and_excel_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Mask"),
            (0, 0, 1, "Meaning"),
            (0, 1, 0, "1"),
            (0, 1, 1, "Read"),
            (0, 2, 0, "2"),
            (0, 2, 1, "Write"),
            (0, 3, 0, "4"),
            (0, 3, 1, "Share"),
            (0, 4, 0, "1099511627776"),
            (0, 4, 1, "High bit"),
            (0, 0, 3, "1099511627781"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Masks", [0, 0, 4, 1], LIMIT).unwrap();
    book.edit(
        &[
            (0, 0, 5, "=BITAND(Masks[Mask],$D$1)"),
            (0, 6, 0, "=BITLSHIFT({1;2},{0,1,2})"),
            (0, 10, 0, "=BITOR({1,2,4},{8,16})"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (i, want) in ["1", "0", "4", "1099511627776"].iter().enumerate() {
            assert_eq!(restored.display(0, i, 5, LIMIT).unwrap(), *want);
        }
        for (i, want) in ["1", "2", "4", "2", "4", "8"].iter().enumerate() {
            assert_eq!(restored.display(0, 6 + i / 3, i % 3, LIMIT).unwrap(), *want);
        }
        assert_eq!(restored.display(0, 10, 0, LIMIT).unwrap(), "9");
        assert_eq!(restored.display(0, 10, 1, LIMIT).unwrap(), "18");
        assert_eq!(restored.display(0, 10, 2, LIMIT).unwrap(), "#N/A");
        restored.edit(&[(0, 0, 3, "2")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 1, 5, LIMIT).unwrap(), "2");
        assert_eq!(restored.display(0, 3, 5, LIMIT).unwrap(), "0");
        restored.rename_table(0, "Flags", LIMIT).unwrap();
        assert!(restored.input(0, 0, 5).contains("Flags[Mask]"));
        assert_eq!(restored.display(0, 1, 5, LIMIT).unwrap(), "2");
        restored.convert_table_to_range(0, LIMIT).unwrap();
        assert_eq!(restored.display(0, 1, 5, LIMIT).unwrap(), "2");
    }
}

#[test]
fn bit_arrays_obey_work_limits_and_rollback_failed_edits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=BITAND(SEQUENCE(100000),255)")], 1_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn bit_formulas_import_excel_namespaces_without_private_metadata() {
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1099511627781</v></c><c r="B1"><f>_xlfn.BITAND(A1,1099511627776)</f></c><c r="C1"><f>_xlfn.BITOR(A1,2)</f></c><c r="D1"><f>_xlfn.BITXOR(A1,1099511627776)</f></c><c r="E1"><f>_xlfn.BITLSHIFT(A1,1)</f></c><c r="F1"><f>_xlfn.BITRSHIFT(A1,40)</f></c></row></sheetData></worksheet>"#),
    ]);
    let mut book = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    for (i, want) in ["1099511627776", "1099511627783", "5", "2199023255562", "1"]
        .iter()
        .enumerate()
    {
        assert_eq!(book.display(0, 0, i + 1, LIMIT).unwrap(), *want);
        assert!(!book.input(0, 0, i + 1).contains("_xlfn"));
    }
    book.edit(&[(0, 0, 0, "3")], LIMIT).unwrap();
    for (i, want) in ["0", "3", "1099511627779", "6", "0"].iter().enumerate() {
        assert_eq!(book.display(0, 0, i + 1, LIMIT).unwrap(), *want);
    }
}
