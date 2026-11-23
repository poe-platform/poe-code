use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn search_text_scalar_unicode_and_coercion() {
    let mut b = Spreadsheet::new();
    for (formula, expected) in [
        (r#"=EXACT(0.3-0.2,0.1)"#, "TRUE"),
        (r#"=EXACT(TRUE,"TRUE")"#, "TRUE"),
        (r#"=EXACT("é","é")"#, "FALSE"),
        (r#"=EXACT(A100,"")"#, "TRUE"),
        (r#"=FIND("😀","é😀x😀",3)"#, "4"),
        (r#"=FIND("x","é😀x")"#, "3"),
        (r#"=FIND("","abc",3)"#, "3"),
        (r#"=FIND("","abc",4)"#, "#VALUE!"),
        (r#"=FIND("","")"#, "#VALUE!"),
        (r#"=FIND("b","abc","2.9")"#, "2"),
        (r#"=FINDB("b","abc")"#, "2"),
        (r#"=SEARCHB("B","abc")"#, "2"),
        (r#"=SEARCH("?b","é😀B")"#, "2"),
        (r#"=SEARCH("~*","ab*cd")"#, "3"),
        (r#"=SEARCH("a*b","zzAxxB")"#, "3"),
        (r#"=SEARCH("*b","zzAb")"#, "1"),
        (r#"=SEARCH("~?","ab?cd")"#, "3"),
        (r#"=SEARCH("~","a~b")"#, "1"),
        (r#"=SUBSTITUTE("aaaaa","aa","x")"#, "xxa"),
        (r#"=SUBSTITUTE("aaaaa","aa","x",2)"#, "aaxa"),
        (r#"=SUBSTITUTE("é😀é","é","日本",2.9)"#, "é😀日本"),
        (r#"=SUBSTITUTE("a","","b")"#, "a"),
        (r#"=SUBSTITUTE("a","a","b",1E100)"#, "a"),
        (r#"=SUBSTITUTE(TRUE,"R","r")"#, "TrUE"),
        (r#"=SUBSTITUTE("a","a","b",0)"#, "#VALUE!"),
        (r#"=SUBSTITUTE("a","a","b","NaN")"#, "#VALUE!"),
        (r#"=FIND("a","abc","inf")"#, "#VALUE!"),
        (r#"=EXACT(1)"#, "#ERROR!"),
        (r#"=FIND("a")"#, "#ERROR!"),
        (r#"=SEARCH("a","a",1,1)"#, "#ERROR!"),
        (r#"=SUBSTITUTE("a","a")"#, "#ERROR!"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn search_text_broadcasts_errors_in_argument_order() {
    let mut b = Spreadsheet::new();
    for formula in [
        "=EXACT({#DIV/0!,1,2},NA())",
        r#"=FIND("a",{#DIV/0!,"abc","a"},NA())"#,
        r#"=SEARCH("a",{#DIV/0!,"abc","a"},NA())"#,
        r#"=SUBSTITUTE({#DIV/0!,"abc","a"},"a","x",NA())"#,
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        for (c, e) in [(0, "#DIV/0!"), (1, "#N/A"), (2, "#N/A")] {
            assert_eq!(b.display(0, 0, c, LIMIT).unwrap(), e, "{formula}: {c}");
        }
    }
}

#[test]
fn substitute_bounds_output_and_rolls_back_exhausted_budget() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        (r#"=LEN(SUBSTITUTE(REPT("a",32767),"a","b"))"#, "32767"),
        (r#"=SUBSTITUTE(REPT("a",16384),"a","bb")"#, "#VALUE!"),
        (r#"=SUBSTITUTE(REPT("a",16384),"a","😀")"#, "#VALUE!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e);
    }
    b.edit(
        &[(0, 0, 0, "=SEQUENCE(20)"), (0, 0, 2, &"a".repeat(5000))],
        LIMIT,
    )
    .unwrap();
    let before = b.to_json();
    assert!(
        b.edit(
            &[(0, 0, 1, r#"=SUBSTITUTE(IF(A1:A20>0,$C$1,""),"a","bb")"#)],
            200_000
        )
        .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn search_text_tables_recalculate_after_json_and_excel_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Label"),
            (0, 1, 0, "Rust-fast"),
            (0, 2, 0, "rust-small"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Labels", [0, 0, 2, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 1, 2, r#"=EXACT(Labels[Label],"Rust-fast")"#),
            (0, 1, 3, r#"=FIND("-",Labels[Label])"#),
            (0, 1, 4, r#"=SEARCH("RUST",Labels[Label])"#),
            (0, 1, 5, r#"=SUBSTITUTE(Labels[Label],"-"," · ")"#),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert!(matches!(
            book.cell(0, 1, 2).unwrap().value,
            Some(Value::Bool(true))
        ));
        book.edit(&[(0, 1, 0, "fast-Rust")], LIMIT).unwrap();
        for (c, e) in [(2, "FALSE"), (3, "5"), (4, "6"), (5, "fast · Rust")] {
            assert_eq!(book.display(0, 1, c, LIMIT).unwrap(), e);
        }
    }
}
