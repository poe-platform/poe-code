// TEXTJOIN behavior adapts IronCalc f936620 and Univer 4767b3b.
// See LICENSE.IronCalc and LICENSE.Univer.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn textjoin_flattens_values_and_cycles_delimiters() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        (r#"=TEXTJOIN("-",TRUE,{1,"a";TRUE,2.5})"#, "1-a-TRUE-2.5"),
        (
            r#"=TEXTJOIN({"~","."},TRUE,{"Hi","Univer";"","test"},"again")"#,
            "Hi~Univer.test~again",
        ),
        (r#"=TEXTJOIN(TRUE,TRUE,"a","b")"#, "aTRUEb"),
        (r#"=TEXTJOIN(,TRUE,"a","b")"#, "ab"),
        (r#"=TEXTJOIN("|",TRUE,0.1+0.2,1E20)"#, "0.3|1E+20"),
        (r#"=TEXTJOIN(",",TRUE,"a","","b")"#, "a,b"),
        (r#"=TEXTJOIN(",",FALSE,"a","","b")"#, "a,,b"),
        (
            r#"=TEXTJOIN(",",TRUE,CHAR({72,101,108,108,111}))"#,
            "H,e,l,l,o",
        ),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}

#[test]
fn textjoin_ignore_empty_arrays_keep_shape_and_error_precedence() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "a"),
            (0, 2, 0, "b"),
            (0, 0, 2, r#"=TEXTJOIN(",",{TRUE,FALSE;#N/A,"bad"},A1:A3)"#),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (0, 2, "a,b"),
        (0, 3, "a,,b"),
        (1, 2, "#N/A"),
        (1, 3, "#VALUE!"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
    }
    b.edit(&[(0, 2, 0, "#DIV/0!")], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "#DIV/0!");
    assert_eq!(b.display(0, 1, 2, LIMIT).unwrap(), "#N/A");
    b.edit(
        &[(0, 0, 2, r#"=TEXTJOIN(#REF!,{TRUE,FALSE;#N/A,"bad"},A1:A3)"#)],
        LIMIT,
    )
    .unwrap();
    for r in 0..2 {
        for c in 2..4 {
            assert_eq!(b.display(0, r, c, LIMIT).unwrap(), "#REF!");
        }
    }
}

#[test]
fn textjoin_whole_columns_visit_stored_cells_and_count_blank_runs() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "first"),
            (0, 999_999, 0, "last"),
            (0, 0, 2, r#"=TEXTJOIN("|",TRUE,A:A)"#),
            (0, 1, 2, r#"=TEXTJOIN("",FALSE,A:A)"#),
            (0, 2, 2, r#"=TEXTJOIN(",",FALSE,A:A)"#),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "first|last");
    assert_eq!(b.display(0, 1, 2, LIMIT).unwrap(), "firstlast");
    assert_eq!(b.display(0, 2, 2, LIMIT).unwrap(), "#VALUE!");
    b.edit(
        &[
            (0, 0, 0, ""),
            (0, 999_999, 0, ""),
            (0, 1, 0, "x"),
            (0, 2, 1, "y"),
            (0, 0, 2, r#"=TEXTJOIN({"a","b","c"},FALSE,A1:B3)"#),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "abxcaby");
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=SEQUENCE(1,1,LEN(TEXTJOIN(\",\",TRUE,D:D)))"),
            (0, 0, 2, "=SEQUENCE(3,1,10)"),
            (0, 0, 3, "=SEQUENCE(5)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "9");
}

#[test]
fn textjoin_validates_arguments_and_bounds_output_before_allocation() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=TEXTJOIN()", "#ERROR!"),
        ("=TEXTJOIN(1,TRUE)", "#ERROR!"),
        (r#"=TEXTJOIN(",","bad","a")"#, "#VALUE!"),
        (r#"=TEXTJOIN(",",NA(),1/0)"#, "#N/A"),
        (r#"=TEXTJOIN(",",TRUE,CHAR({65,0}))"#, "#VALUE!"),
        (r#"=LEN(TEXTJOIN("",TRUE,REPT("a",32766),"b"))"#, "32767"),
        (r#"=TEXTJOIN("",TRUE,REPT("a",32767),"b")"#, "#VALUE!"),
        (r#"=TEXTJOIN("😀",FALSE,REPT("a",32766),"")"#, "#VALUE!"),
        (r#"=TEXTJOIN("",TRUE,REPT("a",32767),"b",NA())"#, "#N/A"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
    for n in [253, 254] {
        let f = format!("=TEXTJOIN(\"\",TRUE,{})", vec!["\"x\""; n].join(","));
        b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
        assert_eq!(
            b.display(0, 0, 0, LIMIT).unwrap(),
            if n == 253 {
                "x".repeat(n)
            } else {
                "#ERROR!".into()
            }
        );
    }
    let before = b.to_json();
    assert!(
        b.edit(
            &[
                (0, 1, 0, "changed"),
                (0, 0, 0, r#"=TEXTJOIN(",",SEQUENCE(10000),"x")"#)
            ],
            100_000
        )
        .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn textjoin_table_edits_and_structure_survive_json_and_excel() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(0, 0, 0, "Item"), (0, 1, 0, "first"), (0, 3, 0, "last")],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Items", [0, 0, 3, 0], LIMIT).unwrap();
    b.edit(
        &[(0, 0, 2, r#"=TEXTJOIN("|",{TRUE;FALSE},Items[Item])"#)],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "first|last");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "first||last");
        book.edit(&[(0, 2, 0, "middle")], LIMIT).unwrap();
        book.rename_table(0, "Values", LIMIT).unwrap();
        book.edit_axis(0, false, 2, 1, LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "first|middle|last");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "first||middle|last");
    }
}

#[test]
fn textjoin_full_worksheet_blank_runs_do_not_overflow_wasm_coordinates() {
    let mut b = Spreadsheet::new();
    b.add_sheet("Summary").unwrap();
    b.edit(
        &[
            (0, 0, 0, "first"),
            (0, 1_048_575, 16_383, "last"),
            (1, 0, 0, r#"=TEXTJOIN("",FALSE,Sheet1!A:XFD)"#),
            (1, 1, 0, r#"=TEXTJOIN("|",TRUE,Sheet1!A:XFD)"#),
            (1, 2, 0, r#"=TEXTJOIN(",",FALSE,Sheet1!A:XFD)"#),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(b.display(1, 0, 0, LIMIT).unwrap(), "firstlast");
    assert_eq!(b.display(1, 1, 0, LIMIT).unwrap(), "first|last");
    assert_eq!(b.display(1, 2, 0, LIMIT).unwrap(), "#VALUE!");
}
