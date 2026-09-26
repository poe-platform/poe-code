use mcp_oauth_rust::response::{ResponseBudget, validate_redirect};
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn budgets_validate_limits_and_decimal_content_lengths_without_rounding() {
    for limit in [
        0.0,
        -1.0,
        0.5,
        f64::NAN,
        f64::NEG_INFINITY,
        9_007_199_254_740_992.0,
    ] {
        assert!(ResponseBudget::new(limit).is_err());
    }
    let mut budget = ResponseBudget::new(4.0).unwrap();
    for length in [
        "",
        " 5",
        "5.0",
        "+5",
        "0x5",
        "999999999999999999999999x",
        "0004",
    ] {
        budget.check_content_length(Some(&units(length))).unwrap();
    }
    assert!(
        budget
            .check_content_length(Some(&units("000000000000000000000000000000000000000005")))
            .is_err()
    );
    let mut huge = ResponseBudget::new(9_007_199_254_740_991.0).unwrap();
    assert!(
        huge.check_content_length(Some(&units("9007199254740992")))
            .is_err()
    );
}
#[test]
fn positive_infinity_removes_both_declared_and_streamed_byte_limits() {
    let mut budget = ResponseBudget::new(f64::INFINITY).unwrap();
    budget
        .check_content_length(Some(&units(&"9".repeat(128))))
        .unwrap();
    budget.admit(u64::MAX).unwrap();
    budget.admit(u64::MAX).unwrap();
}
#[test]
fn chunk_counts_are_bounded_and_overflow_is_terminal() {
    let mut budget = ResponseBudget::new(4.0).unwrap();
    budget.admit(2).unwrap();
    budget.admit(2).unwrap();
    assert!(budget.admit(1).is_err());
    assert!(budget.admit(0).is_err());
    assert!(validate_redirect(false, "basic").is_ok());
    assert!(validate_redirect(true, "basic").is_err());
    assert!(validate_redirect(false, "opaqueredirect").is_err());
}

#[test]
fn explicit_infinite_budget_has_no_declared_or_accumulated_limit() {
    let mut budget = ResponseBudget::new(f64::INFINITY).unwrap();
    budget
        .check_content_length(Some(&units("99999999999999999999999999999999999999999")))
        .unwrap();
    budget.admit(u64::MAX).unwrap();
    budget.admit(u64::MAX).unwrap();
    assert!(ResponseBudget::new(f64::NEG_INFINITY).is_err());
}
