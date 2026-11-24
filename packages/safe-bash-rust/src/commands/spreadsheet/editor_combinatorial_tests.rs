// Basic cases adapted from IronCalc f936620 test_combin_combina.rs and
// test_statistical_functions.rs (MIT, LICENSE.IronCalc). Additional cases use
// the counting identities C(n,k) = C(n,n-k) and C_repetition(n,k) = C(n+k-1,k).
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

#[test]
fn combinatorial_values_include_repetition_and_zero_selections() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=COMBIN(5,2)", "10"),
        ("=COMBINA(5,2)", "15"),
        ("=COMBINA(2,6)", "7"),
        ("=COMBINA(1,6)", "1"),
        ("=COMBINA(0,6)", "0"),
        ("=COMBINA(0,0)", "1"),
        ("=COMBIN(0,0)", "1"),
        ("=PERMUT(0,0)", "1"),
        ("=PERMUT(6,2)", "30"),
        ("=PERMUTATIONA(3,2)", "9"),
        ("=PERMUTATIONA(2,3)", "8"),
        ("=PERMUTATIONA(0,0)", "1"),
        ("=FACT(0)", "1"),
        ("=FACT(5.9)", "120"),
        ("=COMBIN(5.9,2.9)", "10"),
        ("=COMBINA(2.9,6.9)", "7"),
        ("=PERMUT(6.9,2.9)", "30"),
        ("=PERMUTATIONA(3.9,2.9)", "9"),
        ("=COMBIN(\"5\",\"2\")", "10"),
        ("=COMBIN(5,TRUE)", "5"),
        ("=COMBIN(5,Z1)", "1"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn combinatorial_excel_errors_and_arity() {
    let mut book = Spreadsheet::new();
    for (name, count) in [
        ("FACT", 1),
        ("COMBIN", 2),
        ("COMBINA", 2),
        ("PERMUT", 2),
        ("PERMUTATIONA", 2),
    ] {
        for arity in 0..=count + 1 {
            if arity == count {
                continue;
            }
            let formula = format!("={name}({})", vec!["1"; arity].join(","));
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(
                book.display(0, 0, 0, LIMIT).unwrap(),
                "#ERROR!",
                "{formula}"
            );
        }
        for argument in 0..count {
            for (input, expected) in [
                ("-0.5", "#NUM!"),
                ("\"bad\"", "#VALUE!"),
                ("\"TRUE\"", "#VALUE!"),
                ("#N/A", "#N/A"),
                ("#DIV/0!", "#DIV/0!"),
            ] {
                let mut args = vec!["2"; count];
                args[argument] = input;
                let formula = format!("={name}({})", args.join(","));
                book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
                assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
            }
        }
    }
    for formula in [
        "=PERMUT(2,6)",
        "=COMBIN(2,6)",
        "=FACT(171)",
        "=COMBIN(2000,1000)",
        "=COMBINA(1000,1000)",
        "=PERMUT(1000,1000)",
        "=PERMUTATIONA(1000,1000)",
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#NUM!", "{formula}");
    }
}

#[test]
fn combinatorial_large_finite_results_do_not_exhaust_work_or_overflow_early() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=COMBIN(1E300,1E300)", 1.),
        ("=COMBIN(1E300,1)", 1e300),
        ("=COMBINA(1,1E300)", 1.),
        ("=COMBINA(2,1E300)", 1e300),
        ("=COMBINA(1E300,1)", 1e300),
        ("=COMBIN(1028,514)", 7.156051054877897e307),
        ("=COMBINA(515,514)", 7.156051054877897e307),
        ("=FACT(170)", 7.257415615307999e306),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let Some(Value::Number(actual)) = book.cell(0, 0, 0).and_then(|c| c.value.clone()) else {
            panic!("{formula}: {}", book.display(0, 0, 0, LIMIT).unwrap());
        };
        assert!(
            (actual / expected - 1.).abs() < 2e-13,
            "{formula}: {actual} != {expected}"
        );
    }
}

#[test]
fn combinatorial_arrays_and_recalculation_survive_json_and_excel() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 0, 1, "=COMBINA(A1,{1,6})"),
            (0, 1, 1, "=PERMUT({2;6},2)"),
            (0, 3, 1, "=COMBIN({2;#N/A},6)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (row, col, expected) in [
            (0, 1, "2"),
            (0, 2, "7"),
            (1, 1, "2"),
            (2, 1, "30"),
            (3, 1, "#NUM!"),
            (4, 1, "#N/A"),
        ] {
            assert_eq!(reopened.display(0, row, col, LIMIT).unwrap(), expected);
        }
        reopened.edit(&[(0, 0, 0, "3")], LIMIT).unwrap();
        assert_eq!(reopened.display(0, 0, 2, LIMIT).unwrap(), "28");
    }
}
