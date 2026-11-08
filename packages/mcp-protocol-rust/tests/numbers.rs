use mcp_protocol_rust::{
    json::{self, Value},
    numbers,
};

#[test]
fn ecmascript_numbers_use_shortest_digits_and_notation_boundaries() {
    for (number, expected) in [
        (0.0, "0"),
        (-0.0, "0"),
        (1e-7, "1e-7"),
        (1e-6, "0.000001"),
        (1e20, "100000000000000000000"),
        (1e21, "1e+21"),
        (1.234e21, "1.234e+21"),
        (-1.234e-7, "-1.234e-7"),
        (f64::from_bits(1), "5e-324"),
        (f64::MAX, "1.7976931348623157e+308"),
        (f64::from_bits(0x431e6c8213473ec1), "2140888806576048.2"),
    ] {
        assert_eq!(numbers::format(number), expected);
        assert_eq!(json::stringify(&Value::Number(number)), expected);
    }
}

#[test]
fn nonfinite_number_text_is_distinct_from_json_serialization() {
    for (number, expected) in [
        (f64::NAN, "NaN"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
    ] {
        assert_eq!(numbers::format(number), expected);
        assert_eq!(json::stringify(&Value::Number(number)), "null");
    }
}
