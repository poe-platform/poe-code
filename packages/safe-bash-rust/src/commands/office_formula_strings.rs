use super::{Value, lookup::number, rounding};

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    csv: bool,
    dialect: super::Dialect,
) -> Value {
    if csv || dialect == super::Dialect::Gnumeric {
        for value in args {
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Value::Error(error);
            }
        }
        let text = super::text::rendered(args[0]);
        let text = text.split('\0').next().unwrap();
        if name == "LEN" {
            return Value::Number(text.chars().count() as f64);
        }
        let count = args
            .get(if name == "MID" { 2 } else { 1 })
            .map_or(1., |value| value.numeric().unwrap_or(f64::NAN));
        let start = args
            .get(1)
            .map_or(1., |value| value.numeric().unwrap_or(f64::NAN));
        if count.is_nan() || count < 0. || name == "MID" && (start.is_nan() || start < 1.) {
            return Value::Error("#VALUE!");
        }
        let count = count.min(i32::MAX as f64) as usize;
        let start = match name {
            "RIGHT" => text.chars().count().saturating_sub(count),
            "MID" => (start - 1.).min(i32::MAX as f64) as usize,
            _ => 0,
        };
        return Value::Text(text.chars().skip(start).take(count).collect());
    }
    let mut positions = [1i32; 2];
    let mut error = None;
    for (index, value) in args.iter().enumerate().skip(1).rev() {
        let number = match value {
            Value::LiteralError(value) => {
                error = Some(*value);
                Some(0.)
            }
            Value::Error(value) => {
                error.get_or_insert(*value);
                Some(0.)
            }
            Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
            _ => value.numeric(),
        };
        let number = number.unwrap_or_else(|| {
            error.get_or_insert("#VALUE!");
            0.
        });
        let number = rounding::approximate(number).floor();
        positions[index - 1] = if (0. ..=i32::MAX as f64).contains(&number) {
            number as i32
        } else {
            error.get_or_insert("Err:502");
            -1
        };
    }
    if matches!(name, "LEFT" | "RIGHT") && positions[0] < 0 {
        return Value::Error(error.unwrap_or("Err:502"));
    }
    match args[0] {
        Value::LiteralError(value) => error = Some(value),
        Value::Error(value) => {
            error.get_or_insert(value);
        }
        _ => {}
    }
    if name == "MID" {
        if positions[0] < 1 || positions[1] < 0 {
            error.get_or_insert("Err:502");
        } else if positions.iter().any(|n| *n > i32::MAX / 8) {
            error.get_or_insert("Err:513");
        }
    }
    if let Some(error) = error {
        return Value::Error(error);
    }
    let text = args[0].text();
    if name == "LEN" {
        return Value::Number(text.chars().count() as f64);
    }
    let length = positions[usize::from(name == "MID")] as usize;
    let start = match name {
        "RIGHT" => text.chars().count().saturating_sub(length),
        "MID" => positions[0] as usize - 1,
        _ => 0,
    };
    Value::Text(text.chars().skip(start).take(length).collect())
}
