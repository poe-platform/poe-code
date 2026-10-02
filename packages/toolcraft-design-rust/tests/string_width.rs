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
