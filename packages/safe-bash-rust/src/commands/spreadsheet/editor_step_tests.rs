// Engineering thresholds adapt IronCalc f936620 engineering/misc.rs (MIT,
// LICENSE.IronCalc) and Univer 4767b3b engineering/delta and gestep (Apache-2.0,
// LICENSE.Univer). Keep their complete audit groups separately unchanged.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn engineering_thresholds_validate_types_defaults_and_arity() {
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        ("=DELTA(7,7)", "1"),
        ("=DELTA(-7,-7)", "1"),
        ("=DELTA(-7,7)", "0"),
        ("=DELTA(-0,0)", "1"),
        ("=DELTA(0)", "1"),
        ("=DELTA(2)", "0"),
        ("=GESTEP(7,4.6)", "1"),
        ("=GESTEP(45,45)", "1"),
        ("=GESTEP(-7,-6)", "0"),
        ("=GESTEP(0.1)", "1"),
        ("=GESTEP(-0.1)", "0"),
        ("=GESTEP(B1)", "1"),
        ("=DELTA(,4)", "0"),
        ("=GESTEP(,4)", "#N/A"),
        ("=DELTA(\"1\",1)", "1"),
        ("=GESTEP(\"1.5\")", "1"),
        ("=DELTA(TRUE,1)", "#VALUE!"),
        ("=GESTEP(FALSE)", "#VALUE!"),
        ("=DELTA(1,\"true\")", "#VALUE!"),
        ("=GESTEP(\"test\")", "#VALUE!"),
        ("=DELTA(NA(),1)", "#N/A"),
        ("=GESTEP(1,1/0)", "#DIV/0!"),
        ("=DELTA()", "#ERROR!"),
        ("=DELTA(1,2,3)", "#ERROR!"),
        ("=GESTEP()", "#ERROR!"),
        ("=GESTEP(1,2,3)", "#ERROR!"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = b.display(0, 0, 0, LIMIT).unwrap();
        if actual != expected {
            failures.push(format!("{formula}: {actual} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn engineering_thresholds_compare_sixteen_significant_digits() {
    let mut b = Spreadsheet::new();
    for (formula, expected) in [
        ("=DELTA(3+1E-16,3)", "1"),
        ("=DELTA(3+1E-15,3)", "0"),
        ("=GESTEP(3,3+1E-16)", "1"),
        ("=GESTEP(3,3+1E-15)", "0"),
        ("=DELTA(0.1+0.2,0.3)", "1"),
        ("=GESTEP(0.3,0.1+0.2)", "1"),
        ("=DELTA(1E300,-1E300)", "0"),
        ("=GESTEP(-1E300,1E300)", "0"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn engineering_thresholds_broadcast_arrays_without_hiding_element_errors() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=DELTA({1;2},{1,2})"),
            (0, 3, 0, "=GESTEP({1,2;TRUE,\"bad\"},2)"),
            (0, 6, 0, "=DELTA({1,#N/A},{1,#DIV/0!})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, expected) in [
        (0, 0, "1"),
        (0, 1, "0"),
        (1, 0, "0"),
        (1, 1, "1"),
        (3, 0, "0"),
        (3, 1, "1"),
        (4, 0, "#VALUE!"),
        (4, 1, "#VALUE!"),
        (6, 0, "1"),
        (6, 1, "#N/A"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), expected, "{r},{c}");
    }
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=GESTEP(SEQUENCE(10000),0)")], 100_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn engineering_thresholds_recalculate_tables_after_json_and_excel() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Reading"),
            (0, 1, 0, "3"),
            (0, 2, 0, "5"),
            (0, 3, 0, "7"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Readings", [0, 0, 3, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 0, 2, "=GESTEP(Readings[Reading],5)"),
            (0, 4, 2, "=SUM(DELTA(Readings[Reading],5))"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, expected) in [(0, "0"), (1, "1"), (2, "1"), (4, "1")] {
            assert_eq!(book.display(0, r, 2, LIMIT).unwrap(), expected);
        }
        book.edit(&[(0, 1, 0, "5")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "1");
        assert_eq!(book.display(0, 4, 2, LIMIT).unwrap(), "2");
    }
}
