// Examples adapted from IronCalc financial/mod.rs and test_fn_financial_simple.rs,
// test_fn_accrintm.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT,
// LICENSE.IronCalc), and Univer financial security/T-bill test files
// (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;
fn number(book: &Spreadsheet, r: usize, c: usize) -> f64 {
    let cell = book.cell(0, r, c);
    match cell.as_ref().and_then(|cell| cell.value.as_ref()) {
        Some(Value::Number(n)) => *n,
        _ => panic!(
            "{}: {}",
            book.input(0, r, c),
            book.display(0, r, c, LIMIT).unwrap()
        ),
    }
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs().max(1.) * 1e-10, "{a} != {b}");
}

#[test]
fn security_formulas_match_documented_examples() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=ACCRINTM(39539,39614,0.1,1000,3)", 100. * 75. / 365.),
        ("=ACCRINTM(39539,39614,0.1)", 100. * 74. / 360.),
        (
            "=DISC(39472,39614,97.975,100,1)",
            (100. - 97.975) / 100. * 366. / 142.,
        ),
        ("=INTRATE(39493,39583,1000000,1014420,2)", 0.05768),
        ("=PRICEDISC(39494,39508,0.0525,100,2)", 99.79583333333333),
        (
            "=PRICEMAT(39493,39551,39397,0.061,0.0625,0)",
            99.9601957532277,
        ),
        (
            "=RECEIVED(39493,39583,1000000,0.0575,2)",
            1014584.6544071017,
        ),
        (
            "=YIELDDISC(39494,39508,97.975,100,2)",
            (100. - 97.975) / 97.975 * 360. / 14.,
        ),
        (
            "=YIELDMAT(39522,39755,39394,0.0625,100.0123,0)",
            0.0609543336915388,
        ),
        (
            "=TBILLPRICE(\"2008-3-31\",\"2008-6-1\",0.0914)",
            98.4258888889,
        ),
        (
            "=TBILLYIELD(\"2008-3-31\",\"2008-6-1\",98.45)",
            0.0914169629253,
        ),
        (
            "=TBILLEQ(\"2008-3-31\",\"2008-6-1\",0.0914)",
            0.0941514935659,
        ),
        (
            "=TBILLEQ(\"2008-3-31\",\"2008-11-1\",0.0914)",
            0.0973043585198,
        ),
        ("=TBILLEQ(0,366,0.0914)", 0.0999453758814),
        ("=TBILLEQ(60,366,0.0914)", 0.09851681907154934),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(number(&book, 0, 0), want);
    }
}

#[test]
fn intrate_uses_security_day_counts_at_month_ends() {
    // LibreOffice GetYearDiff: calendar days are not clamped to day 30.
    // The January-to-leap-day result also agrees with Gnumeric 1.12.62.
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for (start, end, fractions) in [
            (
                "2024,1,31",
                "2024,2,29",
                [28. / 360., 29. / 366., 29. / 360., 29. / 365., 28. / 360.],
            ),
            (
                "2023,1,31",
                "2023,2,28",
                [27. / 360., 28. / 365., 28. / 360., 28. / 365., 27. / 360.],
            ),
            (
                "2024,2,29",
                "2024,3,31",
                [31. / 360., 31. / 366., 31. / 360., 31. / 365., 32. / 360.],
            ),
            (
                "2023,2,28",
                "2023,3,31",
                [31. / 360., 31. / 365., 31. / 360., 31. / 365., 33. / 360.],
            ),
            (
                "2023,2,28",
                "2024,3,31",
                [
                    393. / 360.,
                    397. / 365.,
                    397. / 360.,
                    397. / 365.,
                    393. / 360.,
                ],
            ),
        ] {
            for (basis, fraction) in fractions.into_iter().enumerate() {
                book.edit(
                    &[(
                        0,
                        0,
                        0,
                        &format!("=INTRATE(DATE({start}),DATE({end}),94,100,{basis})"),
                    )],
                    LIMIT,
                )
                .unwrap();
                near(number(&book, 0, 0), (6. / 94.) / fraction);
            }
        }
        book.edit(
            &[(0, 0, 0, "=INTRATE(DATE(2024,1,31),DATE(2024,2,29),94,100)")],
            LIMIT,
        )
        .unwrap();
        near(number(&book, 0, 0), 0.8206686930091185);
    }
}

#[test]
fn accrued_maturity_interest_reuses_all_year_fraction_bases() {
    let mut book = Spreadsheet::new();
    for (year, month, day, endyear, endmonth, endday) in [
        (2024, 1, 15, 2024, 3, 15),
        (2023, 1, 15, 2023, 3, 31),
        (2023, 2, 28, 2023, 6, 15),
        (2024, 2, 28, 2024, 6, 15),
        (2023, 11, 15, 2024, 3, 15),
        (2020, 2, 29, 2025, 3, 1),
        (1900, 1, 0, 1900, 3, 1),
    ] {
        for basis in 0..=4 {
            let start = format!("DATE({year},{month},{day})");
            let end = format!("DATE({endyear},{endmonth},{endday})");
            book.edit(
                &[
                    (
                        0,
                        0,
                        0,
                        &format!("=ACCRINTM({start},{end},0.1,1000,{basis})"),
                    ),
                    (0, 0, 1, &format!("=YEARFRAC({start},{end},{basis})*100")),
                ],
                LIMIT,
            )
            .unwrap();
            near(number(&book, 0, 0), number(&book, 0, 1));
        }
    }
}

#[test]
fn security_contracts_reject_invalid_dates_amounts_and_types() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=ACCRINTM(39539,39539,0.1)", "#NUM!"),
        ("=ACCRINTM(39539,39614,0)", "#NUM!"),
        ("=ACCRINTM(39539,39614,0.1,0)", "#NUM!"),
        ("=ACCRINTM(39539,39614,TRUE)", "#VALUE!"),
        ("=DISC(400,500,0,100)", "#NUM!"),
        ("=DISC(400,500,97,0)", "#NUM!"),
        ("=INTRATE(400,500,0,100)", "#NUM!"),
        ("=PRICEDISC(400,500,0,100)", "#NUM!"),
        ("=RECEIVED(400,500,100,4,2)", "#NUM!"),
        ("=RECEIVED(400,500,100,0)", "#NUM!"),
        ("=YIELDDISC(400,500,0,100)", "#NUM!"),
        ("=YIELDMAT(400,500,400,0.05,100)", "#NUM!"),
        ("=PRICEMAT(400,500,300,-0.1,0.05)", "#NUM!"),
        ("=YIELDMAT(400,500,300,0.05,0)", "#NUM!"),
        ("=PRICEMAT(400,500,300,0.1,-0.05)", "#NUM!"),
        ("=TBILLPRICE(400,400,0.1)", "#NUM!"),
        ("=TBILLEQ(400,767,0.1)", "#NUM!"),
        ("=TBILLYIELD(400,500,0)", "#NUM!"),
        ("=TBILLPRICE(400,500,10)", "#NUM!"),
        ("=TBILLEQ(400,500,10)", "#NUM!"),
        ("=TBILLEQ(400,600,10)", "#NUM!"),
        ("=TBILLPRICE(-1,10,0.1)", "#NUM!"),
        ("=TBILLPRICE(2958465,2958466,0.1)", "#NUM!"),
        ("=DISC(400,500,97,100,-0.5)", "#NUM!"),
        ("=DISC(400,500,97,100,5)", "#NUM!"),
        ("=INTRATE(400,500,\"TRUE\",100)", "#VALUE!"),
        ("=RECEIVED(400,500,100,\"bad\")", "#VALUE!"),
        ("=PRICEDISC(400,NA(),0.1,100)", "#N/A"),
        ("=ACCRINTM(1,2)", "#ERROR!"),
        ("=PRICEMAT(1,2,3,4)", "#ERROR!"),
        ("=TBILLEQ(1,2,3,4)", "#ERROR!"),
        ("=DISC()", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn maturity_prices_and_yields_share_issue_anchored_factors() {
    let mut book = Spreadsheet::new();
    // Leap-year denominator is anchored to issue/settlement, not settlement year.
    for (basis, a, term) in [
        (0, 30. / 360., 90. / 360.),
        (1, 31. / 365., 91. / 365.),
        (2, 31. / 360., 91. / 360.),
        (3, 31. / 365., 91. / 365.),
        (4, 30. / 360., 90. / 360.),
    ] {
        for (rate, yld) in [(0., 0.), (0.05, 0.), (0., 0.06), (0.05, 0.06)] {
            let want = (100. + 100. * rate * term) / (1. + yld * (term - a)) - 100. * rate * a;
            book.edit(&[(0,0,0,&format!("=PRICEMAT(DATE(2024,1,31),DATE(2024,3,31),DATE(2023,12,31),{rate},{yld},{basis})")),
                (0,0,1,&format!("=YIELDMAT(DATE(2024,1,31),DATE(2024,3,31),DATE(2023,12,31),{rate},A1,{basis})"))],LIMIT).unwrap();
            near(number(&book, 0, 0), want);
            near(number(&book, 0, 1), yld);
        }
    }
    let want =
        (100. + 100. * 0.05 * 43. / 360.) / (1. + 0.06 * 27. / 360.) - 100. * 0.05 * 16. / 360.;
    book.edit(
        &[(
            0,
            0,
            0,
            "=PRICEMAT(DATE(2023,1,31),DATE(2023,2,28),DATE(2023,1,15),0.05,0.06,0)",
        )],
        LIMIT,
    )
    .unwrap();
    near(number(&book, 0, 0), want);
}

#[test]
fn discount_functions_invert_prices_and_use_independent_bases() {
    let mut book = Spreadsheet::new();
    for basis in 0..=4 {
        for discount in [0.000001, 0.05, 0.8] {
            book.edit(
                &[
                    (
                        0,
                        0,
                        0,
                        &format!(
                            "=PRICEDISC(DATE(2024,1,15),DATE(2024,3,15),{discount},100,{basis})"
                        ),
                    ),
                    (
                        0,
                        0,
                        1,
                        &format!("=DISC(DATE(2024,1,15),DATE(2024,3,15),A1,100,{basis})"),
                    ),
                    (
                        0,
                        0,
                        2,
                        &format!(
                            "=RECEIVED(DATE(2024,1,15),DATE(2024,3,15),A1,{discount},{basis})"
                        ),
                    ),
                    (
                        0,
                        0,
                        3,
                        &format!("=INTRATE(DATE(2024,1,15),DATE(2024,3,15),A1,100,{basis})"),
                    ),
                    (
                        0,
                        0,
                        4,
                        &format!("=YIELDDISC(DATE(2024,1,15),DATE(2024,3,15),A1,100,{basis})"),
                    ),
                ],
                LIMIT,
            )
            .unwrap();
            let year = match basis {
                1 => 366.,
                3 => 365.,
                _ => 360.,
            };
            near(number(&book, 0, 0), 100. * (1. - discount * 60. / year));
            near(number(&book, 0, 1), discount);
            near(number(&book, 0, 2), 100.);
            near(number(&book, 0, 3), number(&book, 0, 4));
        }
    }
}

#[test]
fn treasury_bills_preserve_tiny_discounts_and_calendar_year_limits() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for days in [1, 62, 182, 183, 200, 365, 366] {
            for discount in [1e-14, 0.0914, 0.9] {
                book.edit(
                    &[
                        (
                            0,
                            0,
                            0,
                            &format!("=TBILLEQ(DATE(2024,1,1),DATE(2024,1,1)+{days},{discount})"),
                        ),
                        (
                            0,
                            0,
                            1,
                            &format!(
                                "=TBILLPRICE(DATE(2024,1,1),DATE(2024,1,1)+{days},{discount})"
                            ),
                        ),
                    ],
                    LIMIT,
                )
                .unwrap();
                let y = number(&book, 0, 0);
                let price = number(&book, 0, 1) / 100.;
                if days < 183 {
                    near(y, 365. * discount / (360. - discount * days as f64));
                } else {
                    let year = if days == 366 { 366. } else { 365. };
                    near(
                        price * (1. + y / 2.) * (1. + (days as f64 - year / 2.) * y / year),
                        1.,
                    );
                }
                if discount == 1e-14 {
                    near(
                        y / discount,
                        if days == 366 {
                            366. / 360.
                        } else {
                            365. / 360.
                        },
                    );
                }
            }
        }
        for (formula, want) in [
            (
                "=TBILLPRICE(DATE(2023,3,1),DATE(2024,3,1),0.1)",
                "89.8333333333333",
            ),
            ("=TBILLPRICE(DATE(2024,3,1),DATE(2025,3,2),0.1)", "#NUM!"),
            ("=TBILLPRICE(400.9,500.1,0.09)", "97.5"),
            ("=TBILLEQ(400,580,2)", "#DIV/0!"),
            ("=TBILLPRICE(400,580,2)", "0"),
        ] {
            book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
            assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
        }
    }
}

#[test]
fn security_math_preserves_finite_extreme_products_and_small_gains() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=ACCRINTM(400,401,1E200,1E110,2)", 1e308 / 3.6),
        ("=ACCRINTM(400,2958465,1E300,1E-300,2)", 2958065. / 360.),
        (
            "=PRICEDISC(400,2958465,1E308,1E-300,2)",
            -1e8 * 2958065. / 360.,
        ),
        (
            "=PRICEMAT(DATE(2024,1,31),DATE(2024,2,29),DATE(2024,1,30),1E308,1E308,0)",
            100.,
        ),
        (
            "=YIELDMAT(DATE(2024,1,31),DATE(2024,2,29),DATE(2024,1,30),1E308,100,0)",
            1e308,
        ),
        (
            "=DISC(400,760,10000000000000000,10000000000000002,2)",
            2. / 10000000000000002.,
        ),
        (
            "=INTRATE(400,760,10000000000000000,10000000000000002,2)",
            2e-16,
        ),
        ("=YIELDDISC(400,760,200,100,2)", -0.5),
        ("=PRICEDISC(400,760,2,100,2)", -100.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = number(&book, 0, 0);
        assert!(
            (actual / want - 1.).abs() < 1e-10,
            "{formula}: {actual} != {want}"
        );
    }
}

#[test]
fn upstream_security_basis_examples() {
    let mut book = Spreadsheet::new();
    for (name, arguments, wants) in [
        (
            "DISC",
            "\"2018-7-1\",\"2048-1-1\",97.975,100",
            [
                0.000686440677966,
                0.000686384169121,
                0.000676503340757,
                0.00068589922049,
                0.000686440677966,
            ],
        ),
        (
            "INTRATE",
            "\"2008-2-15\",\"2008-5-15\",10000000,10144200",
            // US security day count subtracts one day when leaving February
            // in a leap year: 89 days, rather than YEARFRAC's 90 days.
            [
                0.05832808988764045,
                0.0586413333333,
                0.05768,
                0.0584811111111,
                0.05768,
            ],
        ),
        (
            "YIELDDISC",
            "\"2008-11-11\",\"2021-3-1\",98.45,100",
            [
                0.00127942476329,
                0.00128000671242,
                0.00126148491016,
                0.00127900553392,
                0.00127942476329,
            ],
        ),
        (
            "PRICEMAT",
            "\"2008-11-11\",\"2021-3-1\",\"2008-10-15\",0.0785,0.0625",
            [
                110.882869098244,
                110.862780081706,
                110.96026004584,
                110.878910539315,
                110.882869098244,
            ],
        ),
        (
            "YIELDMAT",
            "\"2008-11-11\",\"2021-3-1\",\"2008-10-15\",0.0785,98.45",
            [
                0.0805514592749,
                0.080544639989,
                0.0805158908953,
                0.0805398660055,
                0.0805514592749,
            ],
        ),
    ] {
        for (basis, want) in wants.iter().enumerate() {
            book.edit(
                &[(0, 0, 0, &format!("={name}({arguments},{basis})"))],
                LIMIT,
            )
            .unwrap();
            near(number(&book, 0, 0), *want);
        }
    }
    for (formula, want) in [
        (
            "=ACCRINTM(\"2012/2/2\",\"2021/3/11\",0.1,1000)",
            910.833333333333,
        ),
        (
            "=ACCRINTM(\"2012/2/2\",\"2021/3/11\",0.1,1000,1)",
            910.210785655626,
        ),
        (
            "=RECEIVED(\"2008-2-15\",\"2008-3-15\",10000000,0.0575,2)",
            10046534.9919418,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(number(&book, 0, 0), want);
    }
}

#[test]
fn securities_tables_arrays_and_epochs_survive_json_and_excel() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "Rate"),
                (0, 0, 1, "Par"),
                (0, 1, 0, "5%"),
                (0, 1, 1, "1000"),
                (0, 2, 0, "8%"),
                (0, 2, 1, "2000"),
                (0, 3, 0, "0"),
                (0, 3, 1, "1000"),
                (0, 4, 0, "=TRUE()"),
                (0, 4, 1, "1000"),
                (0, 5, 0, "=NA()"),
                (0, 5, 1, "1000"),
                (0, 0, 3, "=DATE(2024,1,1)"),
                (0, 1, 3, "=DATE(2024,6,29)"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Deposits", [0, 0, 5, 1], LIMIT).unwrap();
        book.edit(
            &[
                (
                    0,
                    0,
                    5,
                    "=ACCRINTM($D$1,$D$2,Deposits[Rate],Deposits[Par],2)",
                ),
                (0, 0, 6, "=PRICEDISC($D$1,$D$2,Deposits[Rate],100,2)"),
                (0, 7, 0, "=TBILLPRICE($D$1,$D$2,{0.05,0.08,0,TRUE,\"bad\"})"),
                (0, 9, 0, "=RECEIVED($D$1,$D$2,{1000;2000},{0.05,0.08},2)"),
                (0, 12, 0, "=TBILLPRICE({1,2,3},{200,210},0.1)"),
            ],
            LIMIT,
        )
        .unwrap();
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            near(number(&restored, 0, 5), 25.);
            near(number(&restored, 1, 5), 80.);
            near(number(&restored, 0, 6), 97.5);
            near(number(&restored, 1, 6), 96.);
            for (r, want) in [(2, "#NUM!"), (3, "#VALUE!"), (4, "#N/A")] {
                for c in [5, 6] {
                    assert_eq!(restored.display(0, r, c, LIMIT).unwrap(), want);
                }
            }
            for (c, want) in ["97.5", "96", "#NUM!", "#VALUE!", "#VALUE!"]
                .iter()
                .enumerate()
            {
                assert_eq!(restored.display(0, 7, c, LIMIT).unwrap(), *want);
            }
            for (r, amount) in [(9, 1000.), (10, 2000.)] {
                near(number(&restored, r, 0), amount / 0.975);
                near(number(&restored, r, 1), amount / 0.96);
            }
            assert_eq!(restored.display(0, 12, 2, LIMIT).unwrap(), "#N/A");
            restored
                .edit(&[(0, 1, 3, "=DATE(2024,3,31)")], LIMIT)
                .unwrap();
            near(number(&restored, 0, 5), 12.5);
            near(number(&restored, 1, 6), 98.);
            restored.rename_table(0, "Notes", LIMIT).unwrap();
            assert!(restored.input(0, 0, 5).contains("Notes[Rate]"));
            restored.convert_table_to_range(0, LIMIT).unwrap();
            near(number(&restored, 1, 5), 40.);
        }
    }
}

#[test]
fn security_arrays_and_large_text_obey_work_limits_and_rollback() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=ACCRINTM(400,SEQUENCE(100000,1,500),0.1)",
        "=TBILLPRICE(SEQUENCE(100000),100001,0.1)",
        "=DISC(REPT(\"1\",100000),500,98,100)",
    ] {
        assert!(book.edit(&[(0, 0, 0, formula)], 1_000).is_err());
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn external_excel_securities_recalculate_and_ignore_stale_caches() {
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>0.05</v></c><c r="B1"><f>ACCRINTM(400,580,A1,1000,2)</f><v>999</v></c><c r="C1"><f>TBILLPRICE(400,580,A1)</f><v>999</v></c><c r="D1"><f>DISC(400,580,C1,100,2)</f><v>999</v></c><c r="E1"><f>RECEIVED(400,580,C1,A1,2)</f><v>999</v></c></row></sheetData></worksheet>"#),
    ]);
    let mut book = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    near(number(&book, 0, 1), 25.);
    near(number(&book, 0, 2), 97.5);
    near(number(&book, 0, 3), 0.05);
    near(number(&book, 0, 4), 100.);
    book.edit(&[(0, 0, 0, "0.08")], LIMIT).unwrap();
    near(number(&book, 0, 1), 40.);
    near(number(&book, 0, 2), 96.);
    near(number(&book, 0, 3), 0.08);
    near(number(&book, 0, 4), 100.);
}
