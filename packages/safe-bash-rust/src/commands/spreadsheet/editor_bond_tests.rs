// Regular bond examples and calendars adapted from IronCalc financial_bonds.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc) and Univer
// financial/{price,yield,duration,mduration,coup*} tests
// (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
use super::{Spreadsheet, model::Value};
const LIMIT: usize = 10_000_000;

fn numeric(book: &Spreadsheet, row: usize, column: usize) -> f64 {
    let cell = book.cell(0, row, column);
    match cell.as_ref().and_then(|cell| cell.value.as_ref()) {
        Some(Value::Number(value)) => *value,
        _ => panic!(
            "Expected number at {row},{column}: {}",
            book.display(0, row, column, LIMIT).unwrap()
        ),
    }
}
fn near(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1e-10 * expected.abs().max(1.),
        "{actual} != {expected}"
    );
}

#[test]
fn regular_bonds_match_upstream_prices_yields_and_duration() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,2,1)",
            113.580039836105,
        ),
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,1,1)",
            113.405808810527,
        ),
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,4,1)",
            113.662334504,
        ),
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,2,0)",
            113.581332152,
        ),
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,2,2)",
            113.57920636475,
        ),
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,2,3)",
            113.581273866497,
        ),
        (
            "=PRICE(DATE(2008,11,11),DATE(2021,3,1),0.0785,0.0625,100,2,4)",
            113.581332152,
        ),
        (
            "=YIELD(DATE(2008,11,11),DATE(2021,3,1),0.0785,98.45,100,2,1)",
            0.0804842002961,
        ),
        (
            "=YIELD(DATE(2008,11,11),DATE(2009,3,1),0.0785,98.45,100,2,1)",
            0.129522508296,
        ),
        (
            "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1)",
            5.9937749555452,
        ),
        (
            "=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1)",
            5.73566981391884,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(numeric(&book, 0, 0), want);
    }
}

#[test]
fn coupon_dates_preserve_maturity_month_ends_and_day_count_bases() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,1)", 71.),
        ("=COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,0)", 70.),
        ("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,1)", 181.),
        ("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,0)", 180.),
        ("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,3)", 182.5),
        ("=COUPDAYSNC(DATE(2011,1,25),DATE(2011,11,15),2,1)", 110.),
        ("=COUPNUM(DATE(2011,1,25),DATE(2011,11,15),2,1)", 2.),
        ("=COUPDAYBS(DATE(2010,11,15),DATE(2011,11,15),2,1)", 0.),
        (
            "=COUPNCD(DATE(2024,4,1),DATE(2026,11,30),2)-DATE(2024,5,31)",
            0.,
        ),
        (
            "=COUPPCD(DATE(2024,4,1),DATE(2026,11,30),2)-DATE(2023,11,30)",
            0.,
        ),
        (
            "=COUPPCD(DATE(2024,4,1),DATE(2026,8,30),2)-DATE(2024,2,29)",
            0.,
        ),
        (
            "=COUPNCD(DATE(2024,4,1),DATE(2026,8,30),2)-DATE(2024,8,30)",
            0.,
        ),
        ("=COUPDAYS(DATE(2024,4,1),DATE(2026,8,31),2,1)", 182.),
        ("=COUPDAYS(30,220,2,1)", 184.),
        ("=COUPPCD(30,220,2,1)", 0.),
        ("=COUPDAYBS(30,220,2,1)", 30.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(numeric(&book, 0, 0), want);
    }
}

#[test]
fn bond_contracts_reject_invalid_dates_rates_and_types() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=PRICE(1,400,0.05,0.06,100,3)", "#NUM!"),
        ("=PRICE(1,400,-0.05,0.06,100,2)", "#NUM!"),
        ("=PRICE(1,400,0.05,-0.06,100,2)", "#NUM!"),
        ("=PRICE(1,400,0.05,0.06,0,2)", "#NUM!"),
        ("=PRICE(0,400,0.05,0.06,100,2)", "#NUM!"),
        ("=PRICE(30,220,0.05,0.06,100,2)", "#NUM!"),
        ("=YIELD(1,400,0.05,0,100,2)", "#NUM!"),
        ("=DURATION(1,400,0.05,0.06,TRUE)", "#VALUE!"),
        ("=COUPDAYS(1,400,2,5)", "#NUM!"),
        ("=COUPDAYS(1,400,2,-1)", "#NUM!"),
        ("=COUPDAYS(400,400,2)", "#NUM!"),
        ("=COUPNUM(30,220,2,1)", "#NUM!"),
        ("=COUPDAYS(-1,400,2)", "#NUM!"),
        ("=COUPDAYS(1,2958466,2)", "#NUM!"),
        ("=COUPDAYS(1,400,1E100)", "#NUM!"),
        ("=COUPDAYS(\"bad\",400,2)", "#VALUE!"),
        ("=COUPDAYS(1,400,\"TRUE\")", "#VALUE!"),
        ("=COUPDAYS(1,NA(),2)", "#N/A"),
        ("=DURATION(1,2,3,4)", "#ERROR!"),
        ("=PRICE(1,2,3,4,5)", "#ERROR!"),
        ("=YIELD(1,2,3,4,5,6,7,8)", "#ERROR!"),
        ("=COUPDAYS()", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn price_matches_independent_cash_flows_and_yield_recovers_input() {
    let mut book = Spreadsheet::new();
    for f in [1, 2, 4] {
        for rate in [0., 0.000001, 0.05, 0.8] {
            for yld in [0., 1e-12, 0.02, 0.5, 10.] {
                // Settlement is exactly a coupon date: no calendar prorating.
                let n = 3 * f;
                let coupon = 100. * rate / f as f64;
                let discount = 1. + yld / f as f64;
                let expected = (1..=n).map(|k| coupon / discount.powi(k)).sum::<f64>()
                    + 100. / discount.powi(n);
                book.edit(
                    &[
                        (
                            0,
                            0,
                            0,
                            &format!(
                                "=PRICE(DATE(2020,1,1),DATE(2023,1,1),{rate},{yld},100,{f},1)"
                            ),
                        ),
                        (
                            0,
                            0,
                            1,
                            &format!("=YIELD(DATE(2020,1,1),DATE(2023,1,1),{rate},A1,100,{f},1)"),
                        ),
                    ],
                    LIMIT,
                )
                .unwrap();
                near(numeric(&book, 0, 0), expected);
                near(numeric(&book, 0, 1), yld);
            }
        }
    }
    // Actual/360 can make the accrued fraction exceed one near a coupon.
    // A valid small yield still exists even when price rises again at huge yields.
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=PRICE(DATE(2024,8,30),DATE(2025,8,31),0.05,0.06,100,2,2)",
            ),
            (
                0,
                0,
                1,
                "=YIELD(DATE(2024,8,30),DATE(2025,8,31),0.05,A1,100,2,2)",
            ),
        ],
        LIMIT,
    )
    .unwrap();
    near(numeric(&book, 0, 1), 0.06);
    // Negative returned yields are valid even though PRICE only accepts >=0.
    let target = 100. / 0.95_f64.powi(6);
    book.edit(
        &[(
            0,
            0,
            0,
            &format!("=YIELD(DATE(2020,1,1),DATE(2023,1,1),0,{target},100,2,1)"),
        )],
        LIMIT,
    )
    .unwrap();
    near(numeric(&book, 0, 0), -0.1);
}

#[test]
fn duration_handles_extreme_scales_and_matches_price_sensitivity() {
    let mut book = Spreadsheet::new();
    for (rate, yld) in [
        (0., 0.),
        (0., 1e300),
        (0.05, 0.08),
        (1e300, 0.05),
        (0.05, 1e300),
    ] {
        book.edit(
            &[(
                0,
                0,
                0,
                &format!("=DURATION(DATE(2020,1,1),DATE(2023,1,1),{rate},{yld},2,1)"),
            )],
            LIMIT,
        )
        .unwrap();
        let value = numeric(&book, 0, 0);
        assert!(
            (0.5..=3.0000000001).contains(&value),
            "{rate}, {yld}: {value}"
        );
        if rate == 0. {
            near(value, 3.);
        }
    }
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=MDURATION(DATE(2020,1,1),DATE(2023,1,1),0.05,0.08,2,1)",
            ),
            (
                0,
                0,
                1,
                "=PRICE(DATE(2020,1,1),DATE(2023,1,1),0.05,0.080001,100,2,1)",
            ),
            (
                0,
                0,
                2,
                "=PRICE(DATE(2020,1,1),DATE(2023,1,1),0.05,0.079999,100,2,1)",
            ),
            (
                0,
                0,
                3,
                "=PRICE(DATE(2020,1,1),DATE(2023,1,1),0.05,0.08,100,2,1)",
            ),
        ],
        LIMIT,
    )
    .unwrap();
    let sensitivity =
        (numeric(&book, 0, 2) - numeric(&book, 0, 1)) / (0.000002 * numeric(&book, 0, 3));
    near(numeric(&book, 0, 0), sensitivity);
}

#[test]
fn coupon_functions_respect_epochs_fractional_inputs_and_calendar_text() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for (formula, want) in [
            ("=COUPDAYS(30,220,2,1)", 184.),
            // IronCalc's drifting schedule returns 182 here; Univer's serial-zero
            // special case returns 184 in the 1900 system.
            ("=COUPDAYS(0,365,2,1)", 182.),
            ("=COUPDAYS(30,425,2,1)", if date1904 { 182. } else { 184. }),
            ("=COUPPCD(61,425,2)", if date1904 { 60. } else { 59. }),
            ("=COUPNCD(61,425,2)", 244.),
            ("=COUPNUM(\"2011-1-25\",\"2011-11-15\",2.9,1.9)", 2.),
            (
                "=COUPDAYBS(DATE(2011,1,25)+0.9,DATE(2011,11,15)+0.1,2.9,1.1)",
                71.,
            ),
            ("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),1,1)", 365.),
            ("=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),4,1)", 92.),
        ] {
            book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
            assert_eq!(numeric(&book, 0, 0), want, "{date1904}: {formula}");
        }
        book.edit(&[(0, 0, 0, "=PRICE(0,366,0.05,0.05,100,1,1)")], LIMIT)
            .unwrap();
        if date1904 {
            near(numeric(&book, 0, 0), 100.);
        } else {
            assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#NUM!");
        }
    }
}

#[test]
fn bond_tables_arrays_and_excel_reopening_keep_typed_results() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "Rate"),
                (0, 1, 0, "0.05"),
                (0, 2, 0, "0.08"),
                (0, 3, 0, "=TRUE()"),
                (0, 4, 0, "bad"),
                (0, 5, 0, "=NA()"),
                (0, 6, 0, "0"),
                (0, 0, 2, "0.05"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Bonds", [0, 0, 6, 0], LIMIT).unwrap();
        book.edit(
            &[
                (
                    0,
                    0,
                    4,
                    "=PRICE(DATE(2020,1,1),DATE(2023,1,1),Bonds[Rate],$C$1,100,2,1)",
                ),
                (
                    0,
                    8,
                    0,
                    "=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),{1;2;4},{0,1,2,3,4})",
                ),
                (0, 12, 0, "=COUPNUM({0,1,-1,40000},45000,2)"),
            ],
            LIMIT,
        )
        .unwrap();
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            near(numeric(&restored, 0, 4), 100.);
            for (row, want) in [(2, "#VALUE!"), (3, "#VALUE!"), (4, "#N/A")] {
                assert_eq!(restored.display(0, row, 4, LIMIT).unwrap(), want);
            }
            for (row, wants) in [
                [360., 365., 360., 365., 360.],
                [180., 181., 180., 182.5, 180.],
                [90., 92., 90., 91.25, 90.],
            ]
            .iter()
            .enumerate()
            {
                for (col, want) in wants.iter().enumerate() {
                    near(numeric(&restored, 8 + row, col), *want);
                }
            }
            assert_eq!(restored.display(0, 12, 2, LIMIT).unwrap(), "#NUM!");
            restored.edit(&[(0, 0, 2, "0.08")], LIMIT).unwrap();
            near(numeric(&restored, 1, 4), 100.);
            restored.rename_table(0, "Portfolio", LIMIT).unwrap();
            assert!(restored.input(0, 0, 4).contains("Portfolio[Rate]"));
            restored.convert_table_to_range(0, LIMIT).unwrap();
            near(numeric(&restored, 1, 4), 100.);
        }
    }
}

#[test]
fn long_coupon_schedules_obey_work_limits_and_edits_rollback() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=COUPDAYS(DATE(2000,1,1),DATE(9999,12,31),4,1)",
        "=DURATION(DATE(2000,1,1),DATE(9999,12,31),0.05,0.06,4,1)",
        "=YIELD(DATE(2020,1,1),DATE(2023,1,1),0.05,100,100,2,1)",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 3_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
    book.edit(
        &[(
            0,
            0,
            0,
            "=PRICE(DATE(2000,1,1),DATE(9999,12,31),0.05,0.05,100,4,1)",
        )],
        10_000,
    )
    .unwrap();
    assert!(numeric(&book, 0, 0) > 99.);
}

#[test]
fn upstream_duration_and_yield_frequency_basis_examples() {
    let mut book = Spreadsheet::new();
    for (frequency, duration, modified) in [
        (1, 10.8778775299, 9.97970415591),
        (2, 10.9191452816, 10.4489428532),
        (4, 10.7086433694, 10.4730008502),
    ] {
        book.edit(
            &[
                (
                    0,
                    0,
                    0,
                    &format!("=DURATION(\"2018-7-1\",\"2048-1-1\",0.08,0.09,{frequency},1)"),
                ),
                (
                    0,
                    0,
                    1,
                    &format!("=MDURATION(\"2018-7-1\",\"2048-1-1\",0.08,0.09,{frequency},1)"),
                ),
            ],
            LIMIT,
        )
        .unwrap();
        near(numeric(&book, 0, 0), duration);
        near(numeric(&book, 0, 1), modified);
    }
    for (frequency, basis, want) in [
        (1, 1, 0.0804467519494),
        (4, 1, 0.0804921326093),
        (2, 0, 0.0804841133636),
        (2, 2, 0.0804842576475),
        (2, 3, 0.0804841172323),
        (2, 4, 0.0804841133636),
    ] {
        book.edit(
            &[(
                0,
                0,
                0,
                &format!(
                    "=YIELD(DATE(2008,11,11),DATE(2021,3,1),0.0785,98.45,100,{frequency},{basis})"
                ),
            )],
            LIMIT,
        )
        .unwrap();
        near(numeric(&book, 0, 0), want);
    }
    for date1904 in [false, true] {
        book.options.date1904 = date1904;
        for (formula, want) in [
            ("=PRICE(0,366,0.08,0.09,100,2,1)", 99.0636661248598),
            ("=MDURATION(0,366,0.08,0.09,2,1)", 0.9384500933673366),
            ("=DURATION(1,182,0.08,0.09,2,1)", 0.497252747253),
        ] {
            book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
            // Follow IronCalc's valid coupon schedule for first-year maturity;
            // Univer rejects all 1900-system maturities <=366.
            if date1904 || formula.starts_with("=DURATION(1,") {
                near(numeric(&book, 0, 0), want);
            } else {
                assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#NUM!", "{formula}");
            }
        }
    }
}

#[test]
fn external_excel_bonds_recalculate_without_private_metadata() {
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>0.05</v></c><c r="B1"><f>PRICE(DATE(2020,1,1),DATE(2023,1,1),A1,0.05,100,2,1)</f><v>999</v></c><c r="C1"><f>YIELD(DATE(2020,1,1),DATE(2023,1,1),A1,B1,100,2,1)</f><v>999</v></c><c r="D1"><f>COUPNUM(DATE(2020,1,1),DATE(2023,1,1),2,1)</f></c><c r="E1"><f>DURATION(DATE(2020,1,1),DATE(2023,1,1),0,0.05,2,1)</f></c></row></sheetData></worksheet>"#),
    ]);
    let mut book = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    near(numeric(&book, 0, 1), 100.);
    near(numeric(&book, 0, 2), 0.05);
    near(numeric(&book, 0, 3), 6.);
    near(numeric(&book, 0, 4), 3.);
    book.edit(&[(0, 0, 0, "0.08")], LIMIT).unwrap();
    assert!(numeric(&book, 0, 1) > 100.);
    near(numeric(&book, 0, 2), 0.05);
}
