// Complex behavior adapted from IronCalc f936620 and Univer 4767b3b.
// See LICENSE.IronCalc and LICENSE.Univer.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn complex_parser_handles_units_signs_exponents_and_invalid_text() {
    let mut b = Spreadsheet::new();
    // All ten original IronCalc parser examples, exercised through public formulas.
    for (text, real, imaginary) in [
        ("1+2i", "1", "2"),
        ("2i", "0", "2"),
        ("7.5", "7.5", "0"),
        ("-7.5", "-7.5", "0"),
        ("7-5i", "7", "-5"),
        ("i", "0", "1"),
        ("7+i", "7", "1"),
        ("7-i", "7", "-1"),
        ("-i", "0", "-1"),
        ("0", "0", "0"),
        (" 1e-2-3E+2j ", "0.01", "-300"),
        ("+j", "0", "1"),
        ("50%+25%i", "0.5", "0.25"),
    ] {
        b.edit(
            &[
                (0, 0, 0, &format!("=IMREAL(\"{text}\")")),
                (0, 0, 1, &format!("=IMAGINARY(\"{text}\")")),
            ],
            LIMIT,
        )
        .unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), real, "{text}");
        assert_eq!(b.display(0, 0, 1, LIMIT).unwrap(), imaginary, "{text}");
    }
    for text in [
        "", "abc", "I", "1+2", "1e309i", "NaN", "inf", "1ii", "1e-+2i",
    ] {
        let formula = format!("=IMREAL(\"{text}\")");
        b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#NUM!", "{text}");
    }
}

#[test]
fn complex_functions_preserve_types_and_errors() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=ISTEXT(COMPLEX(3,0))", "TRUE"),
        ("=COMPLEX(1E20,-1)", "100000000000000000000-i"),
        ("=COMPLEX(1E-20,0)", "1E-20"),
        ("=COMPLEX(TRUE,1)", "#VALUE!"),
        ("=COMPLEX(1,2,0)", "#VALUE!"),
        ("=COMPLEX(1,2,\"\")", "1+2i"),
        ("=COMPLEX()", "#ERROR!"),
        ("=IMABS()", "#ERROR!"),
        ("=IMABS(1,2)", "#ERROR!"),
        ("=IMREAL(TRUE)", "#VALUE!"),
        ("=IMREAL(NA())", "#N/A"),
        ("=IMARGUMENT(0)", "#DIV/0!"),
        ("=IMDIV(1,0)", "#NUM!"),
        ("=IMLN(0)", "#NUM!"),
        ("=IMCOT(0)", "#NUM!"),
        ("=IMCSC(0)", "#NUM!"),
        ("=IMCSCH(0)", "#NUM!"),
        ("=IMEXP(1000)", "#NUM!"),
        ("=IMSIN(\"1000i\")", "#NUM!"),
        ("=IMPOWER(0,-1)", "#NUM!"),
        ("=IMDIV(\"i\",\"j\")", "#NUM!"),
        ("=IMSUB(\"i\",\"j\")", "#NUM!"),
        ("=IMSUM(\"i\",\"j\")", "#VALUE!"),
        ("=IMPRODUCT(\"i\",\"j\")", "#VALUE!"),
        ("=IMSUM(2,\"3j\")", "2+3j"),
        ("=IMDIV(\"2j\",2)", "j"),
        ("=IMCONJUGATE(\"12.7-32j\")", "12.7+32j"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}

#[test]
fn complex_arithmetic_avoids_intermediate_overflow_and_underflow() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=IMABS(\"3E200+4E200i\")/1E200", "5"),
        ("=IMABS(\"3E-200+4E-200i\")/1E-200", "5"),
        ("=IMDIV(\"1E308+1E308i\",\"1E308+1E308i\")", "1"),
        ("=IMDIV(\"1E-300+1E-300i\",\"1E-300+1E-300i\")", "1"),
        ("=IMDIV(\"1E308+1E308i\",\"1E-308+1E-308i\")", "#NUM!"),
        ("=IMPOWER(\"4+3i\",3)", "-44+117i"),
        (
            "=ABS(IMREAL(IMLN(\"1E308+1E308i\"))-LN(1E308)-LN(2)/2)<1E-10",
            "TRUE",
        ),
        ("=IMTAN(\"1000i\")", "i"),
        ("=IMCOT(\"1000i\")", "-i"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}

#[test]
fn complex_arrays_broadcast_and_aggregate_sparse_ranges() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=COMPLEX({1;2},{3,4},\"j\")"),
            (0, 4, 0, "=IMABS({\"3+4i\",\"5+12i\";\"bad\",TRUE})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (0, 0, "1+3j"),
        (0, 1, "1+4j"),
        (1, 0, "2+3j"),
        (1, 1, "2+4j"),
        (4, 0, "5"),
        (4, 1, "13"),
        (5, 0, "#NUM!"),
        (5, 1, "#VALUE!"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
    }
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "1+i"),
            (0, 999_999, 0, "1-i"),
            (0, 0, 2, "=IMSUM(A:A)"),
            (0, 1, 2, "=IMPRODUCT(A:A)"),
            (0, 2, 2, "=IMSUM({1,2;3,4},5,6)"),
            (0, 3, 2, "=IMPRODUCT({1,2;3,4},5,6)"),
        ],
        100_000,
    )
    .unwrap();
    for (r, e) in [(0, "2"), (1, "0"), (2, "21"), (3, "720")] {
        assert_eq!(b.display(0, r, 2, LIMIT).unwrap(), e);
    }
    b.edit(&[(0, 500_000, 0, "#N/A")], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 2, LIMIT).unwrap(), "#N/A");
    assert_eq!(b.display(0, 1, 2, LIMIT).unwrap(), "#N/A");
}

#[test]
fn complex_formulas_recalculate_after_json_excel_and_table_edits() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(0, 0, 0, "Signal"), (0, 1, 0, "3+4i"), (0, 2, 0, "1-i")],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Signals", [0, 0, 2, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 0, 2, "=IMSUM(Signals[Signal])"),
            (0, 1, 2, "=IMABS(A2)"),
            (0, 2, 2, "=IMCONJUGATE(A3)"),
            (0, 3, 2, "=IMREAL(IMSIN(A2))"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "4+3i");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "5");
        assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), "1+i");
        book.edit(&[(0, 1, 0, "5+12i")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "6+11i");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "13");
    }
}

#[test]
fn complex_rounding_reciprocals_and_blank_products_match_spreadsheet_rules() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=COMPLEX(0,1+1E-15)", "i"),
        ("=COMPLEX(2,-1-1E-15)", "2-i"),
        ("=IMSECH(1000)", "0"),
        ("=IMCSCH(-1000)", "0"),
        ("=IMSEC(\"1000i\")", "0"),
        ("=IMCSC(\"1000i\")", "0"),
        ("=IMCOT(\"1E-300i\")", "-1E+300i"),
        ("=IMPRODUCT(B1:B2,\"5+12i\")", "0"),
        ("=IMPRODUCT(B1,\"5+12i\")", "0"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}

#[test]
fn complex_excel_names_and_work_limits_survive_roundtrips() {
    let mut b = Spreadsheet::new();
    for name in [
        "IMCOSH", "IMCOT", "IMCSC", "IMCSCH", "IMSEC", "IMSECH", "IMSINH", "IMTAN",
    ] {
        let formula = format!("=_xlfn.{name}(1)");
        b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let result = b.display(0, 0, 0, LIMIT).unwrap();
        assert!(!result.starts_with('#'), "{formula}: {result}");
        let restored = Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), result);
    }
    let before = b.to_json();
    assert!(
        b.edit(
            &[
                (0, 1, 0, "changed"),
                (0, 0, 0, "=COMPLEX(SEQUENCE(10000),1)")
            ],
            100_000
        )
        .is_err()
    );
    assert_eq!(b.to_json(), before);
    for name in ["IMSUM", "IMPRODUCT"] {
        for count in [255, 256] {
            let f = format!("={name}({})", vec!["1"; count].join(","));
            b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
            let expected = if count == 256 {
                "#ERROR!"
            } else if name == "IMSUM" {
                "255"
            } else {
                "1"
            };
            assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), expected);
        }
    }
}

#[test]
fn complex_tiny_divisors_and_identity_operations_preserve_components() {
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        ("=IMCOT(\"1E-300+1E-300i\")", "5E+299-5E+299i"),
        ("=IMDIV(\"1E308+1E-308i\",1)", "1E+308+1E-308i"),
        ("=IMDIV(\"1E-308+1E308i\",\"i\")", "1E+308-1E-308i"),
        ("=IMPOWER(\"1.3E308+1.3E308i\",1)", "1.3E+308+1.3E+308i"),
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
fn complex_finite_components_do_not_require_a_representable_polar_magnitude() {
    // Independent Decimal(70-digit) references: exp(710)/sqrt(2), and
    // cosh(710.5)/sqrt(2). At this precision sinh(710.5) is the same value.
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        (
            "=IMREAL(IMEXP(COMPLEX(710,PI()/4)))/1E308",
            1.579672848288202,
        ),
        (
            "=IMAGINARY(IMEXP(COMPLEX(710,PI()/4)))/1E308",
            1.579672848288202,
        ),
        (
            "=IMREAL(IMSIN(COMPLEX(PI()/4,710.5)))/1E308",
            1.302220112860107,
        ),
        (
            "=IMAGINARY(IMSIN(COMPLEX(PI()/4,710.5)))/1E308",
            1.302220112860107,
        ),
        (
            "=IMREAL(IMCOS(COMPLEX(PI()/4,710.5)))/1E308",
            1.302220112860107,
        ),
        (
            "=IMAGINARY(IMCOS(COMPLEX(PI()/4,710.5)))/1E308",
            -1.302220112860107,
        ),
        (
            "=IMREAL(IMSINH(COMPLEX(710.5,PI()/4)))/1E308",
            1.302220112860107,
        ),
        (
            "=IMAGINARY(IMCOSH(COMPLEX(710.5,PI()/4)))/1E308",
            1.302220112860107,
        ),
        ("=IMREAL(IMPOWER(\"1.3E154+5E153i\",2))/1E308", 1.44),
        ("=IMAGINARY(IMPOWER(\"1.3E154+5E153i\",2))/1E308", 1.3),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        if !text
            .parse::<f64>()
            .is_ok_and(|value| (value - expected).abs() < 2e-12)
        {
            failures.push(format!("{formula}: {text} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn complex_products_keep_finite_components_when_individual_products_overflow() {
    // (a+bi)(c+di) = (ac-bd)+(ad+bc)i. Here ac overflows f64,
    // but the exact components 1.64e308 and 1.68e308 both fit.
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        (
            "=IMREAL(IMPRODUCT(\"1.4E154+4E153i\",\"1.4E154+8E153i\"))/1E308",
            1.64,
        ),
        (
            "=IMAGINARY(IMPRODUCT(\"1.4E154+4E153i\",\"1.4E154+8E153i\"))/1E308",
            1.68,
        ),
        (
            "=IMREAL(IMPRODUCT(\"1.4E154-4E153j\",\"1.4E154-8E153j\"))/1E308",
            1.64,
        ),
        (
            "=IMAGINARY(IMPRODUCT(\"1.4E154-4E153j\",\"1.4E154-8E153j\"))/1E308",
            -1.68,
        ),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = b.display(0, 0, 0, LIMIT).unwrap();
        if !actual
            .parse::<f64>()
            .is_ok_and(|n| (n - expected).abs() < 2e-12)
        {
            failures.push(format!("{formula}: {actual} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn complex_square_roots_preserve_small_components_near_the_negative_real_axis() {
    // For z=-R+yi, the principal root u+vi has v≈sqrt(R) and
    // u=y/(2v). This identity avoids subtracting or resolving angles near pi.
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        ("=IMREAL(IMSQRT(\"-1E308+i\"))/1E-155", 5.),
        ("=IMAGINARY(IMSQRT(\"-1E308+i\"))/1E154", 1.),
        ("=IMREAL(IMSQRT(\"-1E308-j\"))/1E-155", 5.),
        ("=IMAGINARY(IMSQRT(\"-1E308-j\"))/1E154", -1.),
        ("=IMREAL(IMPOWER(\"-1E308+i\",0.5))/1E-155", 5.),
        ("=IMREAL(IMSQRT(\"-1E-300+1E-310i\"))/1E-161", 5.),
        ("=IMREAL(IMSQRT(-4))/1E-16", 1.22464679914735),
        ("=IMAGINARY(IMSQRT(-4))", 2.),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = b.display(0, 0, 0, LIMIT).unwrap();
        if !actual
            .parse::<f64>()
            .is_ok_and(|n| (n - expected).abs() < 2e-12)
        {
            failures.push(format!("{formula}: {actual} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn complex_products_combine_terms_before_subnormal_rounding() {
    // 2 * (1.3e-162)^2 = 3.38e-324 rounds to the smallest f64.
    // Each individual product instead rounds to zero. Scale the final
    // component into the normal range without a subnormal formula literal.
    let mut b = Spreadsheet::new();
    for formula in [
        "=IMAGINARY(IMPRODUCT(\"1.3E-162+1.3E-162i\",\"1.3E-162+1.3E-162i\"))*1E308*1E16",
        "=IMREAL(IMPRODUCT(\"1.3E-162+1.3E-162i\",\"1.3E-162-1.3E-162i\"))*1E308*1E16",
        "=-IMAGINARY(IMPRODUCT(\"1.3E-162-1.3E-162j\",\"1.3E-162-1.3E-162j\"))*1E308*1E16",
        "=IMREAL(IMPRODUCT(\"1.3E-308+1.3E-162i\",\"1.3E-16-1.3E-162i\"))*1E308*1E16",
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = b.display(0, 0, 0, LIMIT).unwrap();
        assert!(
            actual
                .parse::<f64>()
                .is_ok_and(|n| (n - 4.940656458412465).abs() < 2e-12),
            "{formula}: {actual}"
        );
    }
}
