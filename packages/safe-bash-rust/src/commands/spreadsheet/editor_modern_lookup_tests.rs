use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;
#[test]
fn modern_lookup_regex_is_case_sensitive_partial_and_validated() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "cat"),
            (0, 1, 0, "Cart"),
            (0, 2, 0, "Carpet"),
            (0, 0, 1, "10"),
            (0, 1, 1, "20"),
            (0, 2, 1, "30"),
        ],
        LIMIT,
    )
    .unwrap();
    for (formula, want) in [
        ("=XMATCH(\"[A-Z][a-z]*t\",A1:A3,3)", "2"),
        ("=XMATCH(\"ar\",A1:A3,3,-1)", "3"),
        ("=XMATCH(\"[\",A1:A3,3)", "#VALUE!"),
        ("=XMATCH(\"[\",{\"[\"},3)", "#VALUE!"),
        ("=XMATCH(42,{42},3)", "#N/A"),
        ("=XMATCH(\"ar\",{\"cat\",\"Cart\"},3)", "2"),
        ("=XLOOKUP(\"[A-Z][a-z]*t\",A1:A3,B1:B3,,3)", "20"),
        ("=XLOOKUP(\"[\",A1:A3,B1:B3,\"missing\",3)", "#VALUE!"),
        ("=XLOOKUP(\"ar\",{\"cat\",\"Cart\"},{10,20},,3)", "20"),
    ] {
        b.edit(&[(0, 0, 3, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), want, "{formula}");
    }
}
#[test]
fn modern_lookup_argument_errors_are_catchable_and_not_fallbacks() {
    let mut b = Spreadsheet::new();
    for (formula, want) in [
        ("=XMATCH()", "#ERROR!"),
        ("=XLOOKUP(1,2)", "#ERROR!"),
        ("=XMATCH(2,{1,2,3},0,0)", "#VALUE!"),
        ("=XMATCH(2,{1,2,3},0,Z99)", "#VALUE!"),
        ("=XMATCH(2,{1,2,3},99)", "#VALUE!"),
        ("=XMATCH(2,{1,2;3,4})", "#VALUE!"),
        ("=XLOOKUP(2,{1,2,3},{4,5,6},\"missing\",#N/A)", "#N/A"),
        ("=XLOOKUP(#DIV/0!,{1,2,3},{4,5,6},\"missing\")", "#DIV/0!"),
        ("=XLOOKUP(2,{1,2,3},{4,5},\"missing\")", "#VALUE!"),
        ("=IFERROR(XMATCH(),\"caught\")", "caught"),
        ("=IFERROR(XLOOKUP(),\"caught\")", "caught"),
        ("=XMATCH(2,{1,2,3},,)", "2"),
        ("=XLOOKUP(2,{1,2,3},{4,5,6},,,)", "5"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}
#[test]
fn modern_lookup_binary_and_duplicate_candidates_agree_for_ranges_and_arrays() {
    let mut b = Spreadsheet::new();
    for (formula, want) in [
        ("=XMATCH(25,{10,20,30,40,50},1,2)", "3"),
        ("=XMATCH(25,{50,40,30,20,10},-1,-2)", "4"),
        ("=XLOOKUP(25,{10,20,30,40,50},{1,2,3,4,5},,1,2)", "3"),
        ("=XLOOKUP(25,{50,40,30,20,10},{1,2,3,4,5},,-1,-2)", "4"),
        ("=XLOOKUP(2,{1,1,3},{10,20,30},,-1)", "10"),
        ("=XLOOKUP(2,{1,1,3},{10,20,30},,-1,-1)", "20"),
        ("=XLOOKUP(2,{1,3,3},{10,20,30},,1)", "20"),
        ("=XLOOKUP(2,{1,3,3},{10,20,30},,1,-1)", "30"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}
#[test]
fn modern_lookup_whole_axes_stay_sparse_and_references_survive_roundtrips() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 1_048_575, 0, "needle"),
            (0, 1_048_575, 1, "42"),
            (0, 0, 3, "=XMATCH(\"needle\",A:A)"),
            (0, 1, 3, "=XLOOKUP(\"needle\",A:A,B:B)"),
            (0, 2, 3, "=XMATCH(\"needle\",A:A,0,-1)"),
            (0, 3, 3, "=SUM(XLOOKUP(\"needle\",A:A,B:C))"),
        ],
        1_000_000,
    )
    .unwrap();
    for b in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        b,
    ] {
        for (r, want) in [(0, "1048576"), (1, "42"), (2, "1048576"), (3, "42")] {
            assert_eq!(b.display(0, r, 3, LIMIT).unwrap(), want);
        }
    }
}
#[test]
fn modern_lookup_blanks_keep_their_type_and_sparse_direction() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "0"),
            (0, 1, 0, "'0"),
            (0, 2, 0, "=\"\""),
            (0, 4, 0, "key"),
            (0, 0, 1, "10"),
            (0, 1, 1, "20"),
            (0, 2, 1, "30"),
            (0, 3, 1, "40"),
            (0, 4, 1, "50"),
            (0, 1_048_575, 1, "99"),
        ],
        LIMIT,
    )
    .unwrap();
    for (formula, want) in [
        ("=XLOOKUP(,A:A,B:B)", "40"),
        ("=XLOOKUP(,A:A,B:B,,0,-1)", "99"),
        ("=XMATCH(,A:A)", "4"),
        ("=XMATCH(,A:A,0,-1)", "1048576"),
        ("=XLOOKUP(0,A:A,B:B)", "10"),
        ("=XLOOKUP(\"0\",A:A,B:B)", "20"),
        ("=XLOOKUP(\"\",A:A,B:B)", "30"),
        ("=XLOOKUP(,C:C,B:B)", "10"),
    ] {
        b.edit(&[(0, 0, 4, formula)], 1_000_000).unwrap();
        assert_eq!(b.display(0, 0, 4, LIMIT).unwrap(), want, "{formula}");
    }
}
#[test]
fn modern_lookup_mixed_types_and_binary_equal_boundaries() {
    let mut b = Spreadsheet::new();
    for (formula, want) in [
        (
            "=XLOOKUP(FALSE,{2,5,4,5,3,TRUE,\"ala\"},{\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\"},,-1)",
            "g",
        ),
        ("=XMATCH(\"a\",{1,2,3},-1,2)", "3"),
        ("=XMATCH(1,{\"a\",\"b\",\"c\"},1,2)", "1"),
        ("=XMATCH(FALSE,{0,1})", "#N/A"),
        ("=XMATCH(TRUE,{0,1})", "#N/A"),
        ("=XMATCH(5,{1,2,3,4,5,5,5,6,7,7,7,8,9},-1,2)", "5"),
        ("=XMATCH(5,{9,8,7,7,7,6,5,5,5,4,3,2,1},1,-2)", "9"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn modern_lookup_explicit_legacy_intersection_survives_reopening() {
    for (r, c, area, want) in [
        (2, 5, "A2:A4", "20"),
        (8, 2, "B2:D2", "30"),
        (2, 2, "B2:C3", "40"),
        (3, 3, "B2:C3", "#VALUE!"),
    ] {
        let mut b = Spreadsheet::new();
        b.add_sheet("Results").unwrap();
        b.edit(
            &[
                (0, 1, 0, "1"),
                (0, 2, 0, "2"),
                (0, 3, 0, "3"),
                (0, 1, 1, "2"),
                (0, 1, 2, "3"),
                (0, 1, 3, "4"),
                (0, 2, 1, "3"),
                (0, 2, 2, "4"),
            ],
            LIMIT,
        )
        .unwrap();
        let formula = format!("=XLOOKUP(Sheet1!{area},{{1;2;3;4}},{{10;20;30;40}})");
        b.edit(&[(1, r, c, &formula)], LIMIT).unwrap();
        b.sheets[1].cells.get_mut(&(r, c)).unwrap().legacy_formula = true;
        let b = Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap();
        assert_eq!(b.display(1, r, c, LIMIT).unwrap(), want, "{formula}");
        assert!(b.sheets[1].cells[&(r, c)].legacy_formula);
        let b = Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(b.display(1, r, c, LIMIT).unwrap(), want, "Excel {formula}");
    }
}
