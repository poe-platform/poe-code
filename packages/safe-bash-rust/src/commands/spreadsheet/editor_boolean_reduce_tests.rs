// AND/OR/XOR cases adapted from IronCalc logical/and_or_xor_not.rs (MIT).
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn logical_reducers_distinguish_direct_text_references_and_array_elements() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "'TRUE"),
            (0, 1, 0, "'FALSE"),
            (0, 2, 0, "'1"),
            (0, 3, 0, "'"),
            (0, 4, 0, "TRUE"),
        ],
        LIMIT,
    )
    .unwrap();
    for name in ["AND", "OR", "XOR"] {
        for (args, want) in [
            ("\"TRUE\"", "TRUE"),
            ("\"false\"", "FALSE"),
            ("\"0\"", "#VALUE!"),
            ("\"1\"", "#VALUE!"),
            ("\"\",TRUE", "TRUE"),
            ("\"text\",FALSE", "FALSE"),
            ("{\"text\",TRUE}", "TRUE"),
            ("{\"TRUE\",FALSE}", "FALSE"),
            ("{\"text\",\"TRUE\"}", "#VALUE!"),
            ("A1:A4", "#VALUE!"),
            ("A1:A5", "TRUE"),
            ("A1", "#VALUE!"),
            ("Z99", "#VALUE!"),
            ("Z99,TRUE", "TRUE"),
            (",", "FALSE"),
        ] {
            let formula = format!("={name}({args})");
            b.edit(&[(0, 0, 3, &formula)], LIMIT).unwrap();
            assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), want, "{formula}");
        }
    }
    for (formula, want) in [
        ("=AND({TRUE;FALSE})", "FALSE"),
        ("=OR({TRUE;FALSE})", "TRUE"),
        ("=XOR({TRUE,TRUE;FALSE,TRUE})", "TRUE"),
        ("=XOR({1,0;2,-3},TRUE)", "FALSE"),
        ("=AND(TRUE,)", "FALSE"),
        ("=OR(FALSE,)", "FALSE"),
    ] {
        b.edit(&[(0, 0, 3, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn logical_reducers_report_catchable_arity_and_propagate_late_errors() {
    let mut b = Spreadsheet::new();
    for name in ["AND", "OR", "XOR"] {
        for (args, want) in [
            ("", "#ERROR!"),
            ("\"text\"", "#VALUE!"),
            ("1,#N/A", "#N/A"),
            ("0,1/0", "#DIV/0!"),
            ("TRUE,{\"text\",#NUM!}", "#NUM!"),
            ("FALSE,{TRUE;#REF!}", "#REF!"),
        ] {
            let formula = format!("={name}({args})");
            b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
        }
        let accepted = format!("={name}({})", vec!["TRUE"; 255].join(","));
        b.edit(&[(0, 0, 0, &accepted)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "TRUE");
        let caught = format!(
            "=IFERROR({name}({}),\"caught\")",
            vec!["TRUE"; 256].join(",")
        );
        b.edit(&[(0, 0, 0, &caught)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "caught");
        let caught = format!("=IFERROR({name}(),9)");
        b.edit(&[(0, 0, 0, &caught)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "9");
    }
    b.edit(
        &[
            (0, 0, 0, "=IFERROR(AND(FALSE,1/0),7)"),
            (0, 1, 0, "=IFERROR(OR(TRUE,1/0),8)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "7");
    assert_eq!(b.display(0, 1, 0, LIMIT).unwrap(), "8");
}

#[test]
fn logical_reducers_read_sparse_last_rows_and_delayed_spills() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "text"),
            (0, 1048575, 0, "TRUE"),
            (0, 0, 2, "=AND(A:A)"),
            (0, 1, 2, "=OR(A:A)"),
            (0, 2, 2, "=XOR(A:A)"),
            (0, 3, 2, "=AND(E2:E3>0)"),
            (0, 4, 2, "=XOR(E2:E3)"),
            (0, 0, 4, "=SEQUENCE(3)"),
        ],
        200_000,
    )
    .unwrap();
    for (r, want) in [
        (0, "TRUE"),
        (1, "TRUE"),
        (2, "TRUE"),
        (3, "TRUE"),
        (4, "FALSE"),
    ] {
        assert_eq!(b.display(0, r, 2, LIMIT).unwrap(), want);
    }
    b.edit(
        &[(0, 1048575, 0, "FALSE"), (0, 0, 4, "=SEQUENCE(1)")],
        200_000,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "FALSE");
    assert_eq!(b.display(0, 4, 2, LIMIT).unwrap(), "#VALUE!");
}

#[test]
fn logical_reducers_keep_atomic_budget_failure_and_roundtrip_types() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=AND({\"text\",TRUE})"),
            (0, 1, 0, "=OR({\"FALSE\",FALSE})"),
            (0, 2, 0, "=XOR({1,1,1})"),
            (0, 3, 0, "=OR({\"text\",#N/A})"),
        ],
        LIMIT,
    )
    .unwrap();
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=AND(SEQUENCE(100000))")], 100_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
    for b in [
        Spreadsheet::from_json(&before, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        b,
    ] {
        for (r, want) in [(0, "TRUE"), (1, "FALSE"), (2, "TRUE"), (3, "#N/A")] {
            assert_eq!(b.display(0, r, 0, LIMIT).unwrap(), want);
        }
    }
}
