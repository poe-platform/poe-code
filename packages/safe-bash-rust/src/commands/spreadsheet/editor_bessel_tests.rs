// Values from IronCalc f936620 engineering/transcendental/test_bessel.rs
// (MIT, LICENSE.IronCalc). Additional public-API boundary and persistence tests.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn bessel_functions_match_upstream_known_values() {
    let mut b = Spreadsheet::new();
    for (formula, expected, tolerance) in [
        ("=BESSELJ(2.4,0)", 0.002507683297243813, 1e-13),
        ("=BESSELJ(0.5,3)", 0.002563729994587244, 1e-13),
        ("=BESSELJ(30,20)", 0.0048310199934040645, 1e-13),
        ("=BESSELJ(-0.5,3)", -0.002563729994587244, 1e-13),
        ("=BESSELY(1E-300,0)", -439.8351636227653, 1e-13),
        ("=BESSELY(3,35)", -6.895879073343495e31, 1e-13),
        ("=BESSELI(0.5,1)", 0.2578943053908963, 1e-6),
        ("=BESSELI(0.2,7)", 1.986608521182497e-11, 1e-6),
        ("=BESSELI(-0.5,0)", 1.0634833707413236, 1e-6),
        ("=BESSELK(0.5,1)", 1.656441120003301, 1e-6),
        ("=BESSELK(0.5,3)", 62.05790952993026, 1e-6),
        ("=BESSELK(1E-300/2E23,0)", 744.5560034370396, 1e-6),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        let actual: f64 = text.parse().unwrap_or_else(|_| panic!("{formula}: {text}"));
        assert!(
            (actual - expected).abs() <= expected.abs() * tolerance,
            "{formula}: {actual} != {expected}"
        );
    }
}

#[test]
fn bessel_arguments_errors_and_order_truncation() {
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for name in ["BESSELI", "BESSELJ", "BESSELK", "BESSELY"] {
        for (args, expected) in [
            ("", "#ERROR!"),
            ("1,2,3", "#ERROR!"),
            ("1,-1", "#NUM!"),
            ("TRUE,1", "#VALUE!"),
            ("1,FALSE", "#VALUE!"),
            ("\"TRUE\",1", "#VALUE!"),
            ("\"bad\",1", "#VALUE!"),
            ("#N/A,1", "#N/A"),
            ("1,#DIV/0!", "#DIV/0!"),
            (",1", "#N/A"),
        ] {
            let formula = format!("={name}({args})");
            b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let actual = b.display(0, 0, 0, LIMIT).unwrap();
            if actual != expected {
                failures.push(format!("{formula}: {actual} != {expected}"));
            }
        }
        let formula = format!("={name}(\"1.5\",2.9)={name}(1.5,2)");
        b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "TRUE", "{formula}");
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn bessel_arrays_limits_and_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=BESSELJ({0;0},{0,1,2})"),
            (0, 3, 0, "=BESSELI({0;#N/A},1)"),
            (0, 6, 0, "=BESSELK({0;1},0)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, expected) in [
        (0, 0, "1"),
        (0, 1, "0"),
        (0, 2, "0"),
        (1, 0, "1"),
        (1, 2, "0"),
        (3, 0, "0"),
        (4, 0, "#N/A"),
        (6, 0, "#NUM!"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), expected, "{r},{c}");
    }
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=BESSELJ(20000000,20000000)")], 100_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
    for reopened in [
        Spreadsheet::from_json(&before, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "1");
        assert_eq!(reopened.display(0, 4, 0, LIMIT).unwrap(), "#N/A");
    }
}

#[test]
fn bessel_tiny_j_avoids_integer_factorial_overflow() {
    let mut b = Spreadsheet::new();
    {
        let (formula, expected) = ("=BESSELJ(1E-12,20)/1E-265", 3.919904349624791);
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        let actual: f64 = text.parse().unwrap_or_else(|_| panic!("{formula}: {text}"));
        assert!((actual - expected).abs() < 1e-12, "{formula}: {actual}");
    }
}

#[test]
fn bessel_large_modified_values_do_not_overflow_before_scaling() {
    let mut b = Spreadsheet::new();
    // Positive I-series summed independently with Python Decimal at 70 digits.
    for (formula, expected) in [
        ("=BESSELI(710,0)/1E306", 3.345334558619656),
        ("=BESSELI(710,1)/1E306", 3.342977858509762),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        let actual: f64 = text.parse().unwrap_or_else(|_| panic!("{formula}: {text}"));
        assert!(
            (actual - expected).abs() < expected * 1e-6,
            "{formula}: {actual}"
        );
    }
    for formula in ["=BESSELI(1E20,2)", "=BESSELI(1000,0)", "=BESSELI(-1000,3)"] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#NUM!", "{formula}");
    }
}

#[test]
fn bessel_modified_tiny_inputs_keep_finite_results() {
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        ("=BESSELI(1E-150,2)/1E-301", "1.25"),
        ("=BESSELI(1E-300,2)", "0"),
        ("=ISNUMBER(BESSELK(1E-300/2E23,0))", "TRUE"),
        ("=BESSELI(1E20,2)", "#NUM!"),
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
fn bessel_large_orders_keep_finite_scaled_results() {
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    // Independent positive I-series sums at 70 decimal digits.
    for (formula, expected) in [
        ("=BESSELI(1000,1000)/1E229", 2.723453646910843),
        ("=BESSELI(1000,2000)/1E-285", 1.295095390775681),
        ("=BESSELI(700,1500)/1E-265", 9.203332734443115),
        ("=BESSELI(100,500)/1E-283", 3.590051431469613),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        let actual = text.parse::<f64>().unwrap_or(f64::NAN);
        if !actual.is_finite() || (actual - expected).abs() > expected * 1e-6 {
            failures.push(format!("{formula}: {text} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn bessel_large_order_modified_functions_satisfy_wronskian_identity() {
    let mut b = Spreadsheet::new();
    // I_n K_(n+1) + I_(n+1) K_n = 1/x (DLMF 10.28.2).
    // I_n is separately checked against independent 70-digit series sums.
    for (x, n) in [(1000, 1000), (1000, 2000), (700, 1500), (100, 500)] {
        let formula = format!(
            "={x}*(BESSELI({x},{n})*BESSELK({x},{})+BESSELI({x},{})*BESSELK({x},{n}))",
            n + 1,
            n + 1
        );
        b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        let result = text.parse::<f64>().unwrap_or(f64::NAN);
        assert!((result - 1.).abs() < 1e-6, "x={x}, n={n}: {text}");
    }
}

#[test]
fn bessel_j_at_ten_matches_independent_series_not_approximate_excel_caches() {
    let mut b = Spreadsheet::new();
    for (n, expected) in [(1, 0.043472746168861436), (7, 0.216710917685051514)] {
        for sign in [-1., 1.] {
            let formula = format!("=BESSELJ({}, {n})", sign * 10.);
            b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let actual: f64 = b.display(0, 0, 0, LIMIT).unwrap().parse().unwrap();
            assert!((actual - sign * expected).abs() < expected * 1e-13);
        }
    }
}

#[test]
fn bessel_modified_recurrence_converges_when_input_exceeds_order() {
    // Positive-series references calculated with Python Decimal at 70 digits.
    let mut b = Spreadsheet::new();
    let mut failures = Vec::new();
    for (n, x, expected) in [
        (2, 20, 3.93127852210407555e+07),
        (5, 20, 2.30183922134136707e+07),
        (2, 100, 1.05238431932431056e+42),
        (5, 100, 9.47009387303558049e+41),
        (10, 100, 6.49897552472014772e+41),
        (20, 100, 1.44834612564271720e+41),
        (2, 500, 2.49480026292137367e+215),
        (2, 710, 3.33591771958160057e+306),
    ] {
        let formula = format!("=BESSELI({x},{n})");
        b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let text = b.display(0, 0, 0, LIMIT).unwrap();
        let actual = text.parse::<f64>().unwrap_or(f64::NAN);
        if !actual.is_finite() || (actual - expected).abs() > expected * 1e-6 {
            failures.push(format!("{formula}: {text} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
