// Scalar/reference cases from IronCalc; array expansion from Univer CHOOSE.
// MIT/Apache-2.0: LICENSE.IronCalc and LICENSE.Univer.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn choose_coerces_indices_and_reports_catchable_argument_errors() {
    let mut b = Spreadsheet::new();
    for (formula, want) in [
        ("=CHOOSE()", "#ERROR!"),
        ("=CHOOSE(1)", "#ERROR!"),
        ("=CHOOSE(0,7)", "#VALUE!"),
        ("=CHOOSE(-0.1,7)", "#VALUE!"),
        ("=CHOOSE(2,7)", "#VALUE!"),
        ("=CHOOSE(1.9,7,8)", "7"),
        ("=CHOOSE(TRUE,7)", "7"),
        ("=CHOOSE(FALSE,7)", "#VALUE!"),
        ("=CHOOSE(\"2\",7,8)", "8"),
        ("=CHOOSE(\"100%\",7,8)", "7"),
        ("=CHOOSE(\"text\",7)", "#VALUE!"),
        ("=CHOOSE(#N/A,7)", "#N/A"),
        ("=CHOOSE(1,,8)", "0"),
        ("=IFERROR(CHOOSE(),99)", "99"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    let accepted = format!(
        "=CHOOSE(254,{})",
        (1..=254)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    b.edit(&[(0, 0, 0, &accepted)], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "254");
    let caught = format!(
        "=IFERROR(CHOOSE(1,{}),\"caught\")",
        vec!["7"; 255].join(",")
    );
    b.edit(&[(0, 0, 0, &caught)], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "caught");
}

#[test]
fn choose_array_indices_expand_ranges_and_keep_local_errors() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Red"),
            (0, 1, 0, "Green"),
            (0, 2, 0, "Blue"),
            (0, 0, 1, "4"),
            (0, 1, 1, "3"),
            (0, 2, 1, "2"),
            (0, 0, 3, "=CHOOSE({1,2},A1:A3,B1:B3)"),
            (
                0,
                5,
                3,
                "=CHOOSE({1;2;3},{11,22,33,44},{44,77;55,88;66,99},3)",
            ),
            (0, 9, 3, "=CHOOSE({1,0,#N/A;2,3,1},10,20)"),
            (0, 12, 3, "=TYPE(CHOOSE({1},7))"),
            (0, 13, 3, "=TYPE(CHOOSE(1,7))"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 3, "Red"),
        (0, 4, "4"),
        (1, 3, "Green"),
        (2, 4, "2"),
        (5, 3, "11"),
        (5, 6, "44"),
        (6, 3, "55"),
        (6, 4, "88"),
        (6, 5, "#N/A"),
        (7, 6, "3"),
        (9, 3, "10"),
        (9, 4, "#VALUE!"),
        (9, 5, "#N/A"),
        (10, 3, "20"),
        (10, 4, "#VALUE!"),
        (10, 5, "10"),
        (12, 3, "64"),
        (13, 3, "1"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
}

#[test]
fn choose_scalar_references_remain_lazy_and_arrays_evaluate_choices_once() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (0, 0, 2, "=CHOOSE(2,C1,\"Not a cycle\")"),
            (0, 1, 2, "=SUM(A1:CHOOSE(2,A2,A3))"),
            (0, 2, 2, "=@CHOOSE(1,A1:A3,999)"),
            (0, 3, 2, "=SUM(CHOOSE(1,A:A,1/0))"),
            (0, 4, 2, "=CHOOSE(1,42,SEQUENCE(1048576))"),
            (0, 6, 2, "=CHOOSE(SEQUENCE(100,1,1,0),SUM(SEQUENCE(1000)))"),
        ],
        1_000_000,
    )
    .unwrap();
    for (r, want) in [
        (0, "Not a cycle"),
        (1, "6"),
        (2, "3"),
        (3, "6"),
        (4, "42"),
        (6, "500500"),
        (105, "500500"),
    ] {
        assert_eq!(b.display(0, r, 2, LIMIT).unwrap(), want, "{r}");
    }
    // A single-element array stays an array and expands with its value's range.
    b.edit(&[(0, 0, 4, "=CHOOSE({1},A1:A3)")], LIMIT).unwrap();
    assert_eq!(b.display(0, 2, 4, LIMIT).unwrap(), "3");
}

#[test]
fn choose_roundtrips_and_rejects_oversized_broadcasts_atomically() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(0, 0, 0, "=CHOOSE({1,2},{\"text\";\"more\"},{TRUE;#DIV/0!})")],
        LIMIT,
    )
    .unwrap();
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=CHOOSE({1,2},Z:Z,AA:AA)")], 100_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
    for b in [
        Spreadsheet::from_json(&before, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        b,
    ] {
        for (r, c, want) in [
            (0, 0, "text"),
            (0, 1, "TRUE"),
            (1, 0, "more"),
            (1, 1, "#DIV/0!"),
        ] {
            assert_eq!(b.display(0, r, c, LIMIT).unwrap(), want);
        }
    }
}
