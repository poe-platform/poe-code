// Formula-entry correction follows IronCalc Model::set_cell_with_formula at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn formula_entry_completes_one_parenthesis_only_when_the_ast_accepts_it() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Plan) 2026").unwrap();
    book.edit(&[(0, 0, 0, "3"), (1, 0, 0, "7")], LIMIT).unwrap();
    for (input, want) in [
        ("=BITAND(13,25", "9"),
        ("=BITOR(13,10", "15"),
        ("=BITXOR(13,25", "20"),
        ("=BITLSHIFT(13,7", "1664"),
        ("=BITRSHIFT(13,7", "0"),
        ("=SUM(A1,ABS(-4)", "7"),
        ("=(A1+4", "7"),
        ("=IFERROR(1/0,7", "7"),
        ("=NA(", "#N/A"),
        ("=LEN(\"(雪)\"", "3"),
        ("=LEN(\"a\"\"(\"", "3"),
        ("=SUM('Plan) 2026'!A1,1", "8"),
        ("=SUM({1,2;3,4}", "10"),
        ("=LET(value,3,value*2", "6"),
        ("=LAMBDA(value,value*2)(3", "6"),
    ] {
        book.edit(&[(0, 0, 2, input)], LIMIT).unwrap();
        assert_eq!(book.input(0, 0, 2), format!("{input})"), "{input}");
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), want, "{input}");
    }
}

#[test]
fn formula_entry_keeps_complete_formulas_and_invalid_drafts_unchanged() {
    let mut book = Spreadsheet::new();
    for input in [
        "=SUM(1,2)",
        "=LEN(\"(\")",
        "=LEN(\")\")",
        "=LEN(\"a\"\"(\")",
    ] {
        book.edit(&[(0, 0, 0, input)], LIMIT).unwrap();
        assert_eq!(book.input(0, 0, 0), input);
    }
    for input in [
        "=SUM(1,2))",
        "=SUM((1+2",
        "=SUM(1+",
        "=LEN(\"unfinished(",
        "=SUM({1,2",
        "=SUM(Table[Unclosed",
        "=LET(value,1,value+",
        "=SUM(1) trailing",
        "=SUM(1;2",
        "=SUM(1])",
        "=1+",
    ] {
        let before = book.to_json();
        match book.edit(&[(0, 0, 0, input)], LIMIT) {
            Ok(()) => assert_eq!(book.input(0, 0, 0), input, "{input}"),
            Err(_) => assert_eq!(book.to_json(), before, "Rejected draft: {input}"),
        }
    }
}

#[test]
fn completed_formulas_follow_table_headers_and_json_excel_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Cost)"), (0, 1, 0, "3"), (0, 2, 0, "4")], LIMIT)
        .unwrap();
    book.add_table(0, "Costs", [0, 0, 2, 0], LIMIT).unwrap();
    book.edit(&[(0, 0, 2, "=SUM(Costs[Cost)]")], LIMIT).unwrap();
    assert_eq!(book.input(0, 0, 2), "=SUM(Costs[Cost)])");
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "7");
    book.edit(&[(0, 0, 0, "Amount)"), (0, 1, 0, "5")], LIMIT)
        .unwrap();
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(
            reopened.input(0, 0, 2).to_ascii_uppercase(),
            "=SUM(COSTS[AMOUNT)])"
        );
        assert_eq!(reopened.display(0, 0, 2, LIMIT).unwrap(), "9");
        reopened.edit(&[(0, 2, 0, "6")], LIMIT).unwrap();
        assert_eq!(reopened.display(0, 0, 2, LIMIT).unwrap(), "11");
    }
}

#[test]
fn formula_entry_limits_leave_the_batch_unchanged() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "7")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "9"), (0, 0, 1, "=SUM(1,2,3,4,5,6,7,8,9")], 700)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    for formula in [
        format!("=SUM(\"{}\"", "雪".repeat(4_000)),
        format!("=SUM({}", "1,".repeat(4_000)),
    ] {
        assert!(
            book.edit(&[(0, 0, 0, "9"), (0, 0, 1, &formula)], 1_000)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn importing_existing_formulas_does_not_apply_entry_correction() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=SUM(1,2)")], LIMIT).unwrap();
    let cell = book.sheets[0].cells.get_mut(&(0, 0)).unwrap();
    cell.formula = Some("SUM(1,2".into());
    cell.openformula = Some("msoxl:=SUM(1,2".into());
    cell.formula_display = None;
    for reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(reopened.input(0, 0, 0), "=SUM(1,2");
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "Err:508");
    }
}
