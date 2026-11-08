use toolcraft_design_rust::string_width::{NumericResult, numeric_operation};

#[test]
fn numeric_width_operations_preserve_ieee_arithmetic() {
    let number = |op, args: &[f64]| match numeric_operation(op, args) {
        Some(NumericResult::Number(value)) => value,
        other => panic!("expected a number, received {other:?}"),
    };
    assert!(number("multiply", &[0.0, f64::INFINITY]).is_nan());
    assert!(number("add", &[f64::INFINITY, f64::NEG_INFINITY]).is_nan());
    assert_eq!(
        number("multiply", &[-0.0, 2.0]).to_bits(),
        (-0.0_f64).to_bits()
    );
    assert_eq!(number("add", &[-0.0, -0.0]).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(number("subtract", &[1.0, 0.1]), 1.0 - 0.1);
    assert_eq!(
        number("increment", &[9007199254740992.0]),
        9007199254740992.0
    );
    assert_eq!(
        numeric_operation("overLimit", &[f64::INFINITY, 0.0, f64::INFINITY]),
        Some(NumericResult::Boolean(false))
    );
    assert_eq!(
        numeric_operation("overInfinity", &[f64::INFINITY, 1.0]),
        Some(NumericResult::Boolean(false))
    );
    assert_eq!(
        numeric_operation("gt", &[f64::NAN, 0.0]),
        Some(NumericResult::Boolean(false))
    );
    assert_eq!(
        numeric_operation("ge", &[-0.0, 0.0]),
        Some(NumericResult::Boolean(true))
    );
    assert_eq!(
        numeric_operation("truthy", &[f64::NAN]),
        Some(NumericResult::Boolean(false))
    );
    assert_eq!(
        numeric_operation("truthy", &[-0.0]),
        Some(NumericResult::Boolean(false))
    );
    assert_eq!(
        numeric_operation("truthy", &[f64::NEG_INFINITY]),
        Some(NumericResult::Boolean(true))
    );
    assert_eq!(numeric_operation("slice", &[1.0, 2.0]), None);
    assert_eq!(numeric_operation("add", &[1.0]), None);
}

#[test]
fn numeric_wrap_operations_keep_strict_comparisons_and_rounding() {
    use NumericResult::{Boolean, Number};
    for (operation, args, expected) in [
        ("lt", vec![f64::NAN, 2.0], Boolean(false)),
        ("le", vec![-0.0, 0.0], Boolean(true)),
        ("same", vec![f64::NAN, f64::NAN], Boolean(false)),
        ("same", vec![-0.0, 0.0], Boolean(true)),
        ("isZero", vec![-0.0], Boolean(true)),
        ("isFalse", vec![0.0], Boolean(false)),
        ("endCode", vec![39.0], Boolean(true)),
        ("endCode", vec![f64::NAN], Boolean(false)),
        ("decrement", vec![1.5], Number(0.5)),
        ("decrement", vec![f64::INFINITY], Number(f64::INFINITY)),
    ] {
        assert_eq!(
            numeric_operation(operation, &args),
            Some(expected),
            "{operation}"
        );
    }
    // Math.floor stays observable; it cannot enter the primitive kernel.
    assert_eq!(numeric_operation("breaksNext", &[5.0, 2.0]), None);
}
