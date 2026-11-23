// Examples from IronCalc financial_bonds.rs, test_fn_bond_functions.rs and
// test_fn_oddfprice.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT,
// LICENSE.IronCalc), and Univer odd-bond tests (4767b3b309467c283bbd52b725536ca73861e0fc,
// Apache-2.0, LICENSE.Univer).
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;
fn numeric(book: &Spreadsheet, row: usize, col: usize) -> f64 {
    match book.cell(0, row, col).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            book.input(0, row, col),
            book.display(0, row, col, LIMIT).unwrap()
        ),
    }
}
fn near(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= expected.abs().max(1.) * 1e-10,
        "{actual} != {expected}"
    );
}

#[test]
fn odd_bonds_match_reference_examples_and_zero_rates() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        (
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)",
            113.597717474,
        ),
        (
            "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,120,1,2)",
            113.508466507,
        ),
        (
            "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0,120,1,2)",
            195.,
        ),
        (
            "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0,0.1,100,1,2)",
            38.503326319,
        ),
        (
            "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,120,2,2)",
            131.483767046542,
        ),
        (
            "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,120,2,1)",
            131.556968693,
        ),
        (
            "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)",
            99.8782860235454,
        ),
        (
            "=ODDLPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),0.0785,0.0625,100,2,1)",
            110.8745242842,
        ),
        (
            "=ODDLYIELD(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),0.0785,84.5,100,2,1)",
            0.107072088907,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(numeric(&book, 0, 0), want);
    }
}
#[test]
fn odd_bonds_recover_yields_across_bases_frequencies_and_epochs() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for basis in 0..=4 {
            for frequency in [1, 2, 4] {
                for rate in [0., 0.075] {
                    for yield_rate in [0., 1e-9, 0.05, 2.] {
                        for (price_fn, yield_fn, dates) in [
                            (
                                "ODDFPRICE",
                                "ODDFYIELD",
                                "DATE(2024,3,1),DATE(2030,8,31),DATE(2024,1,15),DATE(2024,8,31)",
                            ),
                            (
                                "ODDFPRICE",
                                "ODDFYIELD",
                                "DATE(2024,3,1),DATE(2030,8,31),DATE(2022,1,15),DATE(2025,8,31)",
                            ),
                            (
                                "ODDLPRICE",
                                "ODDLYIELD",
                                "DATE(2024,3,1),DATE(2024,8,15),DATE(2024,2,15)",
                            ),
                            (
                                "ODDLPRICE",
                                "ODDLYIELD",
                                "DATE(2024,3,1),DATE(2026,8,15),DATE(2024,2,15)",
                            ),
                        ] {
                            let price = format!(
                                "={price_fn}({dates},{rate},{yield_rate},100,{frequency},{basis})"
                            );
                            book.edit(&[(0, 0, 0, &price)], LIMIT).unwrap();
                            if numeric(&book, 0, 0) <= 0. {
                                continue;
                            }
                            let yield_formula =
                                format!("={yield_fn}({dates},{rate},A1,100,{frequency},{basis})");
                            book.edit(&[(0, 0, 1, &yield_formula)], LIMIT).unwrap();
                            near(numeric(&book, 0, 1), yield_rate);
                        }
                    }
                }
            }
        }
    }
}
#[test]
fn odd_bonds_reject_invalid_dates_frequency_and_arguments() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=ODDFPRICE(100,790,30,220,0.05,0.06,100,2,0)", "#NUM!"),
        ("=ODDFYIELD(70,790,60,220,0.05,97,100,2,1)", "#NUM!"),
        ("=ODDLPRICE(100,220,30,0.05,0.06,100,2,0)", "#NUM!"),
        ("=ODDLPRICE(500,400,300,0.1,0.1,100,2)", "#NUM!"),
        ("=ODDLPRICE(400,500,300,0.1,0.1,100,3)", "#NUM!"),
        ("=ODDLYIELD(400,500,300,0.1,0,100,2)", "#NUM!"),
        ("=ODDLPRICE(400,500,300,TRUE,0.1,100,2)", "#VALUE!"),
        ("=ODDLPRICE(400,500,300,0.1,0.1,100)", "#ERROR!"),
        ("=ODDFPRICE(400,500,300,450,0.1,0.1,100)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn odd_bonds_preserve_extreme_zero_coupon_prices_and_yields() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        (
            "=ODDLPRICE(DATE(2024,1,1),DATE(2027,1,1),DATE(2024,1,1),0,1E308,1E308,2,0)",
            1. / 3.,
        ),
        (
            "=ODDLYIELD(DATE(2024,1,1),DATE(2027,1,1),DATE(2024,1,1),0,1/3,1E308,2,0)",
            1e308,
        ),
        (
            "=ODDFPRICE(DATE(2024,1,1),DATE(2026,1,1),DATE(2023,11,1),DATE(2025,1,1),0,1E200,1E308,1,0)",
            1e-92,
        ),
        (
            "=ODDFYIELD(DATE(2024,1,1),DATE(2026,1,1),DATE(2023,11,1),DATE(2025,1,1),0,1E-92,1E308,1,0)",
            1e200,
        ),
        (
            "=ODDFYIELD(DATE(2024,1,1),DATE(2026,1,1),DATE(2023,11,1),DATE(2025,1,1),0,400,100,1,0)",
            -0.5,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = numeric(&book, 0, 0);
        assert!(
            (actual / want - 1.).abs() < 1e-11,
            "{formula}: {actual} != {want}"
        );
    }
}

#[test]
fn odd_bond_schedules_and_yield_solving_obey_work_limits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=ODDLPRICE(500,2958465,400,0.1,0.1,100,4)",
        "=ODDFPRICE(DATE(1901,3,1),DATE(9999,12,31),DATE(1901,1,1),DATE(9998,12,31),0.1,0.1,100,4)",
        "=ODDFYIELD(DATE(2024,3,1),DATE(2030,8,31),DATE(2024,1,15),DATE(2024,8,31),0.1,90,100,2)",
        "=ODDLYIELD(400,500,300,REPT(\"1\",100000),90,100,2)",
    ] {
        assert!(book.edit(&[(0, 0, 0, formula)], 1500).is_err(), "{formula}");
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn odd_bonds_tables_array_bases_and_excel_reopening_recalculate() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "Rate"),
                (0, 0, 1, "Yield"),
                (0, 1, 0, "7.5%"),
                (0, 1, 1, "5%"),
                (0, 2, 0, "3%"),
                (0, 2, 1, "4%"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Bonds", [0, 0, 2, 1], LIMIT).unwrap();
        let first = "DATE(2024,3,1),DATE(2030,8,31),DATE(2022,1,15),DATE(2025,8,31)";
        let last = "DATE(2024,3,1),DATE(2026,8,15),DATE(2024,2,15)";
        for (r, name, dates, amount) in [
            (0, "ODDFPRICE", first, "Bonds[Yield]"),
            (4, "ODDFYIELD", first, "D1#"),
            (8, "ODDLPRICE", last, "Bonds[Yield]"),
            (12, "ODDLYIELD", last, "D9#"),
        ] {
            let formula = format!("={name}({dates},Bonds[Rate],{amount},100,2,{{0,1,2,3,4}})");
            book.edit(&[(0, r, 3, &formula)], LIMIT).unwrap();
        }
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            for r in [4, 12] {
                for c in 3..8 {
                    near(numeric(&restored, r, c), 0.05);
                    near(numeric(&restored, r + 1, c), 0.04);
                }
            }
            restored.edit(&[(0, 1, 1, "6%")], LIMIT).unwrap();
            near(numeric(&restored, 4, 3), 0.06);
            near(numeric(&restored, 12, 7), 0.06);
            restored.rename_table(0, "Notes", LIMIT).unwrap();
            assert!(restored.input(0, 0, 3).contains("Notes[Rate]"));
            restored.convert_table_to_range(0, LIMIT).unwrap();
            near(numeric(&restored, 4, 7), 0.06);
            near(numeric(&restored, 13, 3), 0.04);
        }
    }
}

#[test]
fn odd_bonds_preserve_error_types_and_strict_date_order() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=ODDFPRICE(500,900,600,700,0.1,0.1,100,2)", "#NUM!"),
        ("=ODDFYIELD(700,900,500,600,0.1,90,100,2)", "#NUM!"),
        ("=ODDFPRICE(600,900,500,900,0.1,0.1,100,2)", "#NUM!"),
        ("=ODDLPRICE(400,500,300,0.1,0.1,100,2,1E100)", "#NUM!"),
        ("=ODDLPRICE(400,500,300,0.1,0.1,100,2,-0.1)", "#NUM!"),
        ("=ODDLPRICE(400,500,300,0.1,0.1,100,1E100)", "#NUM!"),
        ("=ODDFPRICE(\"bad\",900,300,700,0.1,0.1,100,2)", "#VALUE!"),
        ("=ODDLPRICE(400,500,300,\"TRUE\",0.1,100,2)", "#VALUE!"),
        ("=ODDFYIELD(400,500,300,450,0.1,90,100,2,NA())", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    book.edit(
        &[(
            0,
            0,
            0,
            "=ODDLPRICE(400.9,500.8,300.1,{0.1,-0.1,TRUE,#N/A},0.1,100,2.9,0.9)",
        )],
        LIMIT,
    )
    .unwrap();
    assert!(numeric(&book, 0, 0) > 0.);
    for (c, want) in [(1, "#NUM!"), (2, "#VALUE!"), (3, "#N/A")] {
        assert_eq!(book.display(0, 0, c, LIMIT).unwrap(), want);
    }
}

#[test]
fn odd_first_bonds_keep_tiny_coupons_when_redemption_is_much_larger() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        (
            "=ODDFPRICE(DATE(2024,1,1),DATE(2026,1,1),DATE(2023,11,1),DATE(2025,1,1),1E-300,1E200,1E308,1,0)",
            1e-92,
        ),
        (
            "=ODDFPRICE(DATE(2024,1,31),DATE(3024,7,30),DATE(2024,1,30),DATE(2024,7,30),1E-20,1E4,1E308,2,0)",
            1e-22,
        ),
        (
            "=ODDFYIELD(DATE(2024,1,31),DATE(3024,7,30),DATE(2024,1,30),DATE(2024,7,30),1E-20,1E-22,1E308,2,0)",
            1e4,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = numeric(&book, 0, 0);
        assert!(
            (actual / want - 1.).abs() < 1e-10,
            "{formula}: {actual} != {want}"
        );
    }
}
