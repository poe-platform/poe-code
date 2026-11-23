use super::{Value, lookup::number, rounding};

pub(super) fn calculate(args: &[&Value], date1904: bool) -> Value {
    let mut error = None;
    let mut numeric = |value: &Value| {
        let result = match value {
            Value::LiteralError(e) => {
                error = Some(*e);
                Some(0.)
            }
            Value::Error(e) => {
                error.get_or_insert(*e);
                Some(0.)
            }
            Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
            _ => value.numeric(),
        };
        result.unwrap_or_else(|| {
            error.get_or_insert("#VALUE!");
            0.
        })
    };
    let precision = if let Some(value) = args.get(4) {
        let precision = rounding::approximate(numeric(value)).floor();
        if precision < 3. {
            return Value::Error(error.unwrap_or("Err:502"));
        }
        precision
    } else {
        0.
    };
    let full = args.get(3).is_some_and(|value| numeric(value) != 0.);
    for value in args[1..3].iter().rev() {
        match value {
            Value::LiteralError(e) => error = Some(*e),
            Value::Error(e) => {
                error.get_or_insert(*e);
            }
            _ => {}
        }
    }
    let value = match args[0] {
        Value::LiteralError(e) => {
            error = Some(*e);
            Some(0.)
        }
        Value::Error(e) => {
            error.get_or_insert(*e);
            Some(0.)
        }
        Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
        value => value.numeric(),
    };
    let value = value.unwrap_or_else(|| {
        error.get_or_insert("#VALUE!");
        0.
    });
    if let Some(error) = error {
        return Value::Error(error);
    }
    let from = args[1].text();
    let to = args[2].text();
    let (Some((from_rate, _)), Some((to_rate, decimals))) = (currency(&from), currency(&to)) else {
        return Value::Error("Err:502");
    };
    if from.eq_ignore_ascii_case(&to) {
        return Value::number(value);
    }
    let mut result = if from.eq_ignore_ascii_case("EUR") {
        value * to_rate
    } else {
        let mut intermediate = value / from_rate;
        if precision != 0. && intermediate.is_finite() {
            // The native signed precision conversion overflows to INT_MIN.
            intermediate = if precision > i32::MAX as f64 {
                0.
            } else {
                rounding::decimal(intermediate, precision as i32, "ROUND")
            };
        }
        intermediate * to_rate
    };
    if !full {
        result = rounding::decimal(result, decimals, "ROUND");
    }
    Value::number(result)
}

fn currency(code: &str) -> Option<(f64, i32)> {
    [
        ("EUR", 1., 2),
        ("ATS", 13.7603, 2),
        ("BEF", 40.3399, 0),
        ("DEM", 1.95583, 2),
        ("ESP", 166.386, 0),
        ("FIM", 5.94573, 2),
        ("FRF", 6.55957, 2),
        ("IEP", 0.787564, 2),
        ("ITL", 1936.27, 0),
        ("LUF", 40.3399, 0),
        ("NLG", 2.20371, 2),
        ("PTE", 200.482, 2),
        ("GRD", 340.750, 2),
        ("SIT", 239.640, 2),
        ("MTL", 0.429300, 2),
        ("CYP", 0.585274, 2),
        ("SKK", 30.1260, 2),
        ("EEK", 15.6466, 2),
        ("LVL", 0.702804, 2),
        ("LTL", 3.45280, 2),
        ("HRK", 7.53450, 2),
    ]
    .into_iter()
    .find(|(name, _, _)| code.eq_ignore_ascii_case(name))
    .map(|(_, rate, decimals)| (rate, decimals))
}
