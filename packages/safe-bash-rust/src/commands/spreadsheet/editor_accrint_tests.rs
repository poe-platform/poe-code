// ACCRINT cases adapted from IronCalc test_fn_accrint.rs and test_date_system.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
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
fn accrint_excel_examples_cover_long_coupons_and_calculation_methods() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=ACCRINT(39508,39691,39569,0.1,1000,2,0)", 100. / 6.),
        ("=ACCRINT(39508,39691,39569,0.1,1000,4)", 16.94444444444444),
        (
            "=ACCRINT(DATE(2007,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)",
            116.94444444444444,
        ),
        (
            "=ACCRINT(DATE(2007,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0,FALSE)",
            66.94444444444444,
        ),
        (
            "=ACCRINT(DATE(2008,3,1),DATE(2008,9,1),DATE(2008,9,1),0.1,1000,2)",
            50.,
        ),
        (
            "=ACCRINT(DATE(2017,1,1),DATE(2017,12,1),DATE(2017,4,1),0.33,3000,2,0,FALSE)",
            247.5,
        ),
        (
            "=ACCRINT(DATE(2017,1,1),DATE(2017,12,1),DATE(2017,4,1),0.33,3000,4,1)",
            241.1236263736264,
        ),
        (
            "=ACCRINT(DATE(2017,1,1),DATE(2017,12,1),DATE(2017,4,1),0.33,3000,4,2)",
            236.5,
        ),
        (
            "=ACCRINT(DATE(2017,1,1),DATE(2017,12,1),DATE(2017,4,1),0.33,3000,4,3)",
            240.04109589041096,
        ),
        (
            "=ACCRINT(DATE(2017,1,1),DATE(2017,12,1),DATE(2017,4,1),0.33,3000,4,4)",
            247.5,
        ),
        ("=ACCRINT(61,425,300,0.1,1000,2,2)", 66.38888888888889),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(numeric(&book, 0, 0), expected);
    }
}
#[test]
fn accrint_validates_inputs_before_schedule_arithmetic() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=ACCRINT(10,40,50,0.1,1000,2)", "#NUM!"),
        ("=ACCRINT(0,182,100,0.1,1000,2)", "#NUM!"),
        ("=ACCRINT(500,600,500,0.1,1000,2)", "#NUM!"),
        ("=ACCRINT(400,600,500,0,1000,2)", "#NUM!"),
        ("=ACCRINT(400,600,500,0.1,0,2)", "#NUM!"),
        ("=ACCRINT(400,600,500,0.1,1000,3)", "#NUM!"),
        ("=ACCRINT(400,600,500,0.1,1000,1E100)", "#NUM!"),
        ("=ACCRINT(400,600,500,0.1,1000,2,-0.1)", "#NUM!"),
        ("=ACCRINT(400,600,500,0.1,1000,2,5)", "#NUM!"),
        ("=ACCRINT(400,600,500,TRUE,1000,2)", "#VALUE!"),
        ("=ACCRINT(400,600,500,0.1,1000,2,0,NA())", "#N/A"),
        ("=ACCRINT(400,600,500,0.1,1000)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}
#[test]
fn accrint_extreme_values_and_work_limits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=ACCRINT(400,580,401,1E200,1E110,2,2)")], LIMIT)
        .unwrap();
    near(numeric(&book, 0, 0), 1e308 / 3.6);
    let before = book.to_json();
    for formula in [
        "=ACCRINT(400,2958465,2958464,0.1,1000,4)",
        "=ACCRINT(400,500,2958465,0.1,1000,4)",
        "=ACCRINT(400,600,500,0.1,1000,2,0,REPT(\"1\",100000))",
    ] {
        assert!(book.edit(&[(0, 0, 0, formula)], 1000).is_err(), "{formula}");
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn accrint_all_bases_frequencies_epochs_and_fractional_arguments() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for frequency in [1, 2, 4] {
            for basis in 0..=4 {
                let formula = format!(
                    "=ACCRINT(DATE(2020,1,1)+0.9,DATE(2020,{},1)+0.1,DATE(2020,3,1)+0.8,0.1,1000,{},{} )",
                    1 + 12 / frequency,
                    frequency as f64 + 0.9,
                    basis as f64 + 0.9
                );
                book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
                let expected = match basis {
                    1 => {
                        100. / frequency as f64 * 60.
                            / match frequency {
                                1 => 366.,
                                2 => 182.,
                                _ => 91.,
                            }
                    }
                    3 => 100. * 60. / 365.,
                    _ => 100. * 60. / 360.,
                };
                near(numeric(&book, 0, 0), expected);
            }
        }
        if date1904 {
            book.edit(&[(0, 0, 0, "=ACCRINT(0,182,60,0.1,1000,2,1)")], LIMIT)
                .unwrap();
            near(numeric(&book, 0, 0), 50. * 60. / 182.);
        }
    }
}

#[test]
fn accrint_tables_broadcast_eighth_argument_and_recalculate_after_roundtrips() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "Rate"),
                (0, 0, 1, "Par"),
                (0, 1, 0, "10%"),
                (0, 1, 1, "1000"),
                (0, 2, 0, "20%"),
                (0, 2, 1, "2000"),
                (0, 3, 0, "0"),
                (0, 3, 1, "1000"),
                (0, 4, 0, "=TRUE()"),
                (0, 4, 1, "1000"),
                (0, 5, 0, "=NA()"),
                (0, 5, 1, "1000"),
                (0, 0, 3, "=DATE(2007,3,1)"),
                (0, 1, 3, "=DATE(2008,8,31)"),
                (0, 2, 3, "=DATE(2008,5,1)"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Notes", [0, 0, 5, 1], LIMIT).unwrap();
        book.edit(
            &[(
                0,
                0,
                5,
                "=ACCRINT($D$1,$D$2,$D$3,Notes[Rate],Notes[Par],2,0,{TRUE,FALSE})",
            )],
            LIMIT,
        )
        .unwrap();
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            for (col, expected) in [(5, 116.94444444444444), (6, 66.94444444444444)] {
                near(numeric(&restored, 0, col), expected);
                near(numeric(&restored, 1, col), 4. * expected);
                for (r, error) in [(2, "#NUM!"), (3, "#VALUE!"), (4, "#N/A")] {
                    assert_eq!(restored.display(0, r, col, LIMIT).unwrap(), error);
                }
            }
            restored.edit(&[(0, 1, 0, "5%")], LIMIT).unwrap();
            near(numeric(&restored, 0, 5), 58.47222222222222);
            restored.rename_table(0, "Bonds", LIMIT).unwrap();
            assert!(restored.input(0, 0, 5).contains("Bonds[Rate]"));
            restored.convert_table_to_range(0, LIMIT).unwrap();
            near(numeric(&restored, 0, 6), 33.47222222222222);
        }
    }
}

#[test]
fn accrint_date_text_calculation_flag_and_array_errors() {
    let mut book = Spreadsheet::new();
    for flag in ["FALSE", "0", "\"FALSE\"", "\"0\"", ""] {
        let formula = format!(
            "=ACCRINT(\"2007-3-1\",\"2008-8-31\",\"2008-5-1\",\"0.1\",\"1000\",\"2\",0,{flag})"
        );
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        near(numeric(&book, 0, 0), 66.94444444444444);
    }
    book.edit(
        &[(
            0,
            0,
            0,
            "=ACCRINT(39508,39691,39569,0.1,1000,2,0,{TRUE,\"bad\",#N/A,FALSE})",
        )],
        LIMIT,
    )
    .unwrap();
    near(numeric(&book, 0, 0), 100. / 6.);
    near(numeric(&book, 0, 3), 100. / 6.);
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "#VALUE!");
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#N/A");
}
