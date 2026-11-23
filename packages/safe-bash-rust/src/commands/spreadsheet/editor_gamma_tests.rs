// Contracts from IronCalc f936620 statistical/test_fn_gamma (MIT) and
// Univer 4767b3b statistical/{gamma,gammaln,gammaln-precise} (Apache-2.0).
// See LICENSE.IronCalc and LICENSE.Univer. Values use analytic gamma identities.
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;

#[test]
fn gamma_excel_errors_and_scalar_coercion() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for name in ["GAMMA", "GAMMALN", "GAMMALN.PRECISE"] {
        for (args, expected) in [
            ("", "#ERROR!"),
            ("1,2", "#ERROR!"),
            ("0", "#NUM!"),
            ("-1", "#NUM!"),
            ("FALSE", "#NUM!"),
            ("Z1", "#NUM!"),
            ("\"bad\"", "#VALUE!"),
            ("\"TRUE\"", "#VALUE!"),
            ("NA()", "#N/A"),
            ("1/0", "#DIV/0!"),
            ("#REF!", "#REF!"),
            ("TRUE", if name == "GAMMA" { "1" } else { "0" }),
            ("\"2\"", if name == "GAMMA" { "1" } else { "0" }),
        ] {
            let formula = format!("={name}({args})");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let actual = book.display(0, 0, 0, LIMIT).unwrap();
            if actual != expected {
                failures.push(format!("{formula}: {actual} != {expected}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn gamma_arrays_recalculate_typed_errors_and_roundtrip() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "-1"),
            (0, 1, 0, "0"),
            (0, 2, 0, "0.5"),
            (0, 3, 0, "TRUE"),
            (0, 4, 0, "#N/A"),
            (0, 5, 0, "text"),
            (0, 0, 2, "=GAMMA(A1:A7)"),
            (0, 0, 3, "=GAMMALN(A1:A7)"),
            (0, 0, 4, "=GAMMALN.PRECISE(A1:A7)"),
            (0, 0, 6, "=GAMMA(-0.5)"),
        ],
        LIMIT,
    )
    .unwrap();
    let near = |book: &Spreadsheet, row, col, expected: f64| {
        let Some(Value::Number(actual)) = book.cell(0, row, col).and_then(|c| c.value.clone())
        else {
            panic!("{}", book.display(0, row, col, LIMIT).unwrap());
        };
        assert!(
            (actual - expected).abs() <= expected.abs() * 2e-14,
            "{actual} != {expected}"
        );
    };
    for mut copy in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        book,
    ] {
        for col in 2..=4 {
            for (row, expected) in [
                (0, "#NUM!"),
                (1, "#NUM!"),
                (4, "#N/A"),
                (5, "#VALUE!"),
                (6, "#NUM!"),
            ] {
                assert!(
                    matches!(copy.cell(0, row, col).and_then(|c| c.value.clone()), Some(Value::Error(error)) if error == expected),
                    "{}",
                    copy.display(0, row, col, LIMIT).unwrap()
                );
            }
            near(
                &copy,
                2,
                col,
                if col == 2 {
                    std::f64::consts::PI.sqrt()
                } else {
                    std::f64::consts::PI.ln() / 2.
                },
            );
        }
        near(&copy, 0, 6, -2. * std::f64::consts::PI.sqrt());
        copy.edit(&[(0, 0, 0, "3")], LIMIT).unwrap();
        near(&copy, 0, 2, 2.);
        near(&copy, 0, 3, std::f64::consts::LN_2);
        near(&copy, 0, 4, std::f64::consts::LN_2);
    }
}
