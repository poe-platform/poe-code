use super::Spreadsheet;
const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn regex_scalar_contracts_and_excel_roundtrip() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        (r#"=REGEXTEST("Hello","hello")"#, "FALSE"),
        (r#"=REGEXTEST("Hello","hello",1)"#, "TRUE"),
        (r#"=REGEXMATCH("abc123","[0-9]+")"#, "TRUE"),
        (r#"=REGEXMATCH(TRUE,"^TRUE$")"#, "TRUE"),
        (r#"=REGEXTEST(123,"^123$")"#, "TRUE"),
        (
            r#"=REGEXEXTRACT("2024-01-15","(\d{4})-\d{2}-\d{2}")"#,
            "2024-01-15",
        ),
        (r#"=REGEXEXTRACT("É12","(é)([0-9]+)",0,1)"#, "É12"),
        (
            r#"=REGEXREPLACE("JamesBond","([A-Z][a-z]+)([A-Z][a-z]+)","$2, $1 $2")"#,
            "Bond, James Bond",
        ),
        (r#"=REGEXREPLACE("a1 b2 c3","[0-9]","X",2)"#, "a1 bX c3"),
        (r#"=REGEXREPLACE("a1 b2 c3","[0-9]","X",-1)"#, "a1 b2 cX"),
        (r#"=REGEXREPLACE("a1 b2 c3","[0-9]","X",9)"#, "a1 b2 c3"),
        (r#"=REGEXREPLACE("aA","a","X",,1)"#, "XX"),
        (r#"=REGEXREPLACE("é","","-")"#, "-é-"),
        (r#"=REGEXREPLACE("a",".*?","-")"#, "---"),
        (r#"=REGEXREPLACE("ab","(a)(z)?","$2$1$$$0")"#, "a$ab"),
        (r#"=REGEXEXTRACT("abc","(?<=a)b")"#, "b"),
        (r#"=REGEXTEST("aabb","(.)\1")"#, "TRUE"),
        (r#"=REGEXEXTRACT("hello","[0-9]+")"#, "#N/A"),
        (r#"=REGEXTEST("hello","[")"#, "#VALUE!"),
        (r#"=REGEXREPLACE("hello","[","x")"#, "#VALUE!"),
        (r#"=REGEXEXTRACT("hello",".",3)"#, "#VALUE!"),
        (r#"=REGEXTEST("hello",".",2)"#, "#VALUE!"),
        (r#"=REGEXTEST(#REF!,".")"#, "#REF!"),
        (r#"=REGEXREPLACE("hello",".",#N/A)"#, "#N/A"),
        (r#"=REGEXMATCH("hello",".",1,0)"#, "#ERROR!"),
        (r#"=REGEXEXTRACT("hello")"#, "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(
            excel.display(0, 0, 0, LIMIT).unwrap(),
            expected,
            "Excel: {formula}"
        );
    }
}

#[test]
fn regex_extract_spills_captures_all_matches_and_preserves_text() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, r#"=REGEXEXTRACT("é12 é003","(é)([0-9]+)",2)"#),
            (0, 2, 0, r#"=REGEXEXTRACT("LonelyPlanet","[A-Z][a-z]+",1)"#),
            (0, 4, 0, r#"=REGEXEXTRACT("b","(a)?(b)",2)"#),
            (0, 6, 0, r#"=REGEXEXTRACT("012 003","[0-9]+",1)"#),
        ],
        LIMIT,
    )
    .unwrap();
    for restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        book,
    ] {
        for (r, c, expected) in [
            (0, 0, "é"),
            (0, 1, "12"),
            (2, 0, "Lonely"),
            (2, 1, "Planet"),
            (4, 0, ""),
            (4, 1, "b"),
            (6, 0, "012"),
            (6, 1, "003"),
        ] {
            assert_eq!(
                restored.display(0, r, c, LIMIT).unwrap(),
                expected,
                "{r},{c}"
            );
        }
    }
}

#[test]
fn regex_broadcast_arrays_tables_and_map_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Code"),
            (0, 1, 0, "item-12"),
            (0, 2, 0, "item-34"),
            (0, 3, 0, "none"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Items", [0, 0, 3, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 2, r#"=REGEXEXTRACT(Items[Code],"[0-9]+")"#),
            (0, 1, 4, r#"=REGEXTEST(Items[Code],{"item","34"})"#),
            (
                0,
                6,
                0,
                r#"=MAP({"a1";"b2"},LAMBDA(x,REGEXREPLACE(x,"[0-9]","!")))"#,
            ),
            (0, 9, 0, r#"=REGEXEXTRACT({"a1";"b2"},"(.)(.)",2)"#),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, e) in [
            (1, 2, "12"),
            (2, 2, "34"),
            (3, 2, "#N/A"),
            (1, 4, "TRUE"),
            (1, 5, "FALSE"),
            (2, 5, "TRUE"),
            (6, 0, "a!"),
            (7, 0, "b!"),
            (9, 0, "#CALC!"),
            (10, 0, "#CALC!"),
        ] {
            assert_eq!(restored.display(0, r, c, LIMIT).unwrap(), e, "{r},{c}");
        }
        restored.edit(&[(0, 2, 0, "item-56")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 2, 2, LIMIT).unwrap(), "56");
        assert_eq!(restored.display(0, 2, 5, LIMIT).unwrap(), "FALSE");
    }
}

#[test]
fn regex_compilation_is_reused_and_expensive_edits_roll_back() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, r#"=REGEXTEST(SEQUENCE(1000),"[0-9]+")"#)],
        2_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 999, 0, LIMIT).unwrap(), "TRUE");
    let before = book.to_json();
    assert!(
        book.edit(
            &[(0, 0, 0, r#"=REGEXTEST(REPT("a",50)&"b","(a+)+$")"#)],
            100_000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.edit(
        &[(
            0,
            0,
            0,
            r#"=REGEXREPLACE(REPT("a",1000),"a",REPT("x",100))"#,
        )],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#VALUE!");
}

#[test]
fn regex_spill_obstacles_and_legacy_intersection_survive_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "item-12"),
            (0, 1, 0, "item-34"),
            (0, 2, 0, "none"),
            (0, 1, 1, r#"=REGEXEXTRACT(A1:A3,"[0-9]+")"#),
            (0, 6, 0, r#"=REGEXEXTRACT("one two","[a-z]+",1)"#),
            (0, 6, 1, "obstacle"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "#SPILL!");
    let mut cell = book.sheets[0].cells[&(1, 1)].clone();
    cell.legacy_formula = true;
    book.replace_cells(vec![(0, 1, 1, Some(cell))], LIMIT)
        .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "34");
        assert_eq!(restored.display(0, 2, 1, LIMIT).unwrap(), "");
        assert_eq!(restored.display(0, 6, 1, LIMIT).unwrap(), "obstacle");
        restored.edit(&[(0, 6, 1, "")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 6, 0, LIMIT).unwrap(), "one");
        assert_eq!(restored.display(0, 6, 1, LIMIT).unwrap(), "two");
        restored.edit(&[(0, 1, 0, "item-56")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "56");
    }
}

#[test]
fn regex_unicode_replacement_lengths_and_per_element_errors() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, r#"=REGEXREPLACE("a","a",REPT("😀",16383)&"x")"#),
            (0, 1, 0, r#"=REGEXREPLACE("ab","a",REPT("😀",16383)&"x")"#),
            (0, 3, 0, r#"=REGEXTEST({"a",#N/A,"a"},{"a","a","["})"#),
            (0, 5, 0, r#"=REGEXREPLACE({"a","b"},".",{"$0!",#REF!})"#),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(
        book.display(0, 0, 0, LIMIT).unwrap().encode_utf16().count(),
        32767
    );
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "#VALUE!");
    for (r, c, e) in [
        (3, 0, "TRUE"),
        (3, 1, "#N/A"),
        (3, 2, "#VALUE!"),
        (5, 0, "a!"),
        (5, 1, "#REF!"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), e);
    }
}
