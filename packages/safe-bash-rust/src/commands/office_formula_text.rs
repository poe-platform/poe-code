use super::super::dates;
use super::{Failure, Value, lookup::number};

pub(in crate::commands) fn rendered(value: &Value) -> String {
    match value {
        Value::Number(n) => dates::display_number(*n),
        Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
        _ => value.text(),
    }
}

pub(in crate::commands) fn calculate(
    value: &Value,
    pattern: &Value,
    date1904: bool,
    work: &mut usize,
) -> Result<Value, Failure> {
    for arg in [value, pattern] {
        if let Value::Error(e) | Value::LiteralError(e) = arg {
            return Ok(Value::Error(e));
        }
    }
    let converted;
    let value = if let Value::Text(s) | Value::UninternedText(s) = value {
        converted = if s.eq_ignore_ascii_case("true") || s.eq_ignore_ascii_case("false") {
            Value::Bool(s.eq_ignore_ascii_case("true"))
        } else if let Some(n) = number::parse_production(s, date1904) {
            Value::Number(n)
        } else {
            value.clone()
        };
        &converted
    } else {
        value
    };
    format(value, &rendered(pattern), date1904, "-", work)
}

pub(in crate::commands) fn format(
    value: &Value,
    pattern: &str,
    date1904: bool,
    minus: &str,
    work: &mut usize,
) -> Result<Value, Failure> {
    let general = |value: &Value| {
        let text = rendered(value);
        if matches!(value, Value::Number(_)) && minus != "-" {
            text.replace('-', minus)
        } else {
            text
        }
    };
    *work = work
        .checked_sub(
            pattern
                .len()
                .checked_mul(32)
                .and_then(|n| n.checked_add(2048))
                .ok_or(Failure::Limit)?,
        )
        .ok_or(Failure::Limit)?;
    if matches!(value, Value::Bool(_)) || pattern.eq_ignore_ascii_case("general") {
        return Ok(Value::Text(general(value)));
    }
    let sections = match dates::sections(pattern, false) {
        Ok(sections) => sections,
        Err(e) if e.starts_with("Unsupported") => return Err(Failure::Unsupported(e)),
        Err(_) => return Ok(Value::Error("#VALUE!")),
    };
    if let Value::Text(s) | Value::UninternedText(s) = value {
        for section in &sections {
            let tokens = scan(&section.pattern, work)?;
            if tokens.iter().any(|(s, literal)| !literal && s == "@") {
                let mut result = String::new();
                for (token, literal) in tokens {
                    result.push_str(if !literal && token == "@" { s } else { &token });
                }
                *work = work.checked_sub(result.len()).ok_or(Failure::Limit)?;
                return Ok(Value::Text(result));
            }
        }
        return Ok(Value::Text(
            if sections.len() == 4 && sections[3].pattern.is_empty() {
                String::new()
            } else {
                s.clone()
            },
        ));
    }
    let n = value.numeric().unwrap_or(0.);
    let (pattern, magnitude) = dates::select(&sections, n).unwrap_or(("General", false));
    let n = if magnitude { n.abs() } else { n };
    let tokens = scan(pattern, work)?;
    if pattern.eq_ignore_ascii_case("general")
        || tokens.iter().any(|(s, l)| !l && s == "@")
            && !tokens
                .iter()
                .any(|(s, l)| !l && matches!(s.as_str(), "0" | "#" | "?"))
    {
        return Ok(Value::Text(general(&Value::Number(n))));
    }
    if pattern.contains('/') && pattern.chars().all(|c| "0123456789#? /".contains(c)) {
        return fraction(n, pattern, minus, work);
    }
    if let Some(exponent) = pattern.find(['E', 'e'])
        && pattern[..exponent].chars().all(|c| "0#.".contains(c))
    {
        return scientific(n, pattern, exponent, minus, work);
    }
    let date_tokens = dates::tokens(pattern, work).map_err(|_| Failure::Limit)?;
    if date_tokens.iter().any(|t| {
        !t.literal
            && t.text
                .chars()
                .any(|c| "ymdhs".contains(c.to_ascii_lowercase()))
    }) {
        return match dates::text(&n.to_string(), pattern, date1904, false, minus, *work, work) {
            Ok(Some(text)) => Ok(Value::Text(text)),
            Ok(None) => Ok(Value::Error("#VALUE!")),
            Err(e) if e.starts_with("Unsupported") => Err(Failure::Unsupported(e)),
            Err(_) => Err(Failure::Limit),
        };
    }
    numeric(n, pattern, None, minus, work)
}

pub(in crate::commands) fn scan(
    pattern: &str,
    work: &mut usize,
) -> Result<Vec<(String, bool)>, Failure> {
    let mut tokens = Vec::new();
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        *work = work.checked_sub(1).ok_or(Failure::Limit)?;
        if c == '"' {
            let mut text = String::new();
            for c in chars.by_ref() {
                if c == '"' {
                    break;
                }
                text.push(c);
            }
            tokens.push((text, true));
        } else if c == '\\' {
            tokens.push((chars.next().map_or(String::new(), |c| c.to_string()), true));
        } else {
            tokens.push((c.to_string(), false));
        }
    }
    Ok(tokens)
}

use crate::commands::structured::xlsx::fixed_number as fixed;

fn numeric(
    n: f64,
    pattern: &str,
    exact: Option<String>,
    minus: &str,
    work: &mut usize,
) -> Result<Value, Failure> {
    let tokens = scan(pattern, work)?;
    let decimal = tokens.iter().position(|(s, l)| !l && s == ".");
    if tokens.iter().filter(|(s, l)| !l && s == ".").count() > 1 {
        return Ok(Value::Error("#VALUE!"));
    }
    let mut whole = Vec::new();
    let mut fraction = Vec::new();
    let mut percent = 0;
    for (i, (s, literal)) in tokens.iter().enumerate() {
        if *literal {
            continue;
        }
        if matches!(s.as_str(), "0" | "#" | "?") {
            if decimal.is_some_and(|d| i > d) {
                fraction.push(i);
            } else {
                whole.push(i);
            }
        } else if s == "%" {
            percent += 1;
        } else if "[]_*/@EeDdMmYyHhSs".contains(s.as_str()) {
            return Err(Failure::Unsupported(format!(
                "Unsupported ssconvert feature: TEXT format {pattern}"
            )));
        }
    }
    if whole.is_empty() && fraction.is_empty() {
        return Ok(Value::Text(
            tokens.iter().map(|(s, _)| s.as_str()).collect(),
        ));
    }
    let last_whole = whole.last().map_or(-1, |i| *i as isize);
    let last_digit = fraction.last().map_or(last_whole, |i| *i as isize);
    let mut scaling = 0;
    let mut grouping = false;
    for (i, (s, literal)) in tokens.iter().enumerate() {
        if *literal || s != "," {
            continue;
        }
        if i as isize > last_digit || i as isize > last_whole && decimal.is_none_or(|d| i < d) {
            scaling += 1;
        } else if (i as isize) < last_whole {
            grouping = true;
        }
    }
    let amount = n * 100f64.powi(percent) / 1000f64.powi(scaling);
    if !amount.is_finite() {
        return Ok(Value::Error("#VALUE!"));
    }
    let fixed = exact.unwrap_or_else(|| fixed(amount, fraction.len() % 256, 0));
    let (mut integer, decimals) = fixed.split_once('.').unwrap_or((&fixed, ""));
    if integer == "0" && decimal.is_some() && !whole.iter().any(|i| tokens[*i].0 == "0") {
        integer = "";
    }
    let mut replacements = vec![None; tokens.len()];
    let mut count = 0;
    for i in whole.iter().rev() {
        let mut text = if integer.is_empty() {
            match tokens[*i].0.as_str() {
                "0" => "0",
                "?" => " ",
                _ => "",
            }
            .to_owned()
        } else {
            let digit = integer[integer.len() - 1..].to_owned();
            integer = &integer[..integer.len() - 1];
            digit
        };
        if !text.is_empty() && text != " " {
            if grouping && count != 0 && count % 3 == 0 {
                text.push(',');
            }
            count += 1;
        }
        replacements[*i] = Some(text);
    }
    let mut overflow = String::new();
    for c in integer.chars().rev() {
        if grouping && count != 0 && count % 3 == 0 {
            overflow.insert(0, ',');
        }
        overflow.insert(0, c);
        count += 1;
    }
    if let Some(i) = whole.first() {
        replacements[*i].as_mut().unwrap().insert_str(0, &overflow);
    }
    let significant = decimals.trim_end_matches('0').len();
    for (j, i) in fraction.iter().enumerate() {
        replacements[*i] = Some(if j < significant {
            decimals[j..j + 1].to_owned()
        } else {
            match tokens[*i].0.as_str() {
                "0" => "0",
                "?" => " ",
                _ => "",
            }
            .to_owned()
        });
    }
    let mut result = if amount < 0. && fixed.bytes().any(|c| matches!(c, b'1'..=b'9')) {
        minus
    } else {
        ""
    }
    .to_owned();
    for (i, (s, literal)) in tokens.iter().enumerate() {
        if let Some(text) = &replacements[i] {
            result.push_str(text);
        } else if *literal || s != "," {
            result.push_str(s);
        }
    }
    *work = work.checked_sub(result.len()).ok_or(Failure::Limit)?;
    Ok(Value::Text(result))
}

fn scientific(
    n: f64,
    pattern: &str,
    position: usize,
    minus: &str,
    work: &mut usize,
) -> Result<Value, Failure> {
    let mantissa = &pattern[..position];
    let exponent = &pattern[position + 1..];
    if !exponent.starts_with(['+', '-'])
        || exponent.len() < 2
        || !exponent[1..].bytes().all(|b| b == b'0')
    {
        return Ok(Value::Error("#VALUE!"));
    }
    let width = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    if width == 0 {
        return Err(Failure::Unsupported(format!(
            "Unsupported ssconvert feature: TEXT scientific format {pattern}"
        )));
    }
    let decimals = mantissa.split_once('.').map_or(0, |(_, s)| s.len()) % 256;
    let printed = format!("{n:.16e}");
    let (leading, power) = printed.split_once('e').unwrap();
    let power = power.parse::<i32>().unwrap();
    let mut power = if n == 0. {
        0
    } else {
        power.div_euclid(width) * width
    };
    let mut scaled = if power < -308 {
        leading.parse::<f64>().unwrap()
            * 10f64.powi(printed.split_once('e').unwrap().1.parse::<i32>().unwrap() - power)
    } else {
        n / 10f64.powi(power)
    };
    if !scaled.is_finite() {
        return Err(Failure::Unsupported(
            "Unsupported ssconvert feature: TEXT scientific subnormal boundary".into(),
        ));
    }
    let mut exact = fixed(n, decimals, -power);
    if exact.find('.').unwrap_or(exact.len()) > width as usize {
        power += width;
        scaled /= 10f64.powi(width);
        exact = fixed(n, decimals, -power);
    }
    let Value::Text(mut text) = numeric(scaled, mantissa, Some(exact), minus, work)? else {
        return Ok(Value::Error("#VALUE!"));
    };
    text.push_str(&format!(
        "E{}{:0count$}",
        if power < 0 {
            minus
        } else if exponent.starts_with('+') {
            "+"
        } else {
            ""
        },
        power.unsigned_abs(),
        count = exponent.len() - 1
    ));
    Ok(Value::Text(text))
}

fn fraction(n: f64, pattern: &str, minus: &str, work: &mut usize) -> Result<Value, Failure> {
    let (left, right) = pattern.split_once('/').unwrap();
    if right.contains('/') {
        return Ok(Value::Error("#VALUE!"));
    }
    let left = left.trim_end();
    let boundary = left.rfind(' ').filter(|i| *i > 0);
    let (whole_pattern, numerator_pattern) =
        boundary.map_or(("", left), |i| (&left[..i], &left[i + 1..]));
    let denominator_pattern = right.trim();
    if numerator_pattern.is_empty()
        || denominator_pattern.is_empty()
        || !numerator_pattern
            .chars()
            .chain(whole_pattern.chars())
            .all(|c| "0#?".contains(c))
    {
        return Err(Failure::Unsupported(format!(
            "Unsupported ssconvert feature: TEXT fraction format {pattern}"
        )));
    }
    let explicit = denominator_pattern
        .bytes()
        .any(|c| matches!(c, b'1'..=b'9'));
    if !explicit && !denominator_pattern.chars().all(|c| "0#?".contains(c)) {
        return Err(Failure::Unsupported(format!(
            "Unsupported ssconvert feature: TEXT fraction denominator {pattern}"
        )));
    }
    if explicit && !denominator_pattern.bytes().all(|c| c.is_ascii_digit()) {
        return Ok(Value::Error("#VALUE!"));
    }
    let absolute = n.abs();
    let adjusted = if absolute.fract() == 0. {
        absolute
    } else {
        f64::from_bits(absolute.to_bits() + 1)
    };
    let mut whole = adjusted.floor();
    let fractional = adjusted - whole;
    let (mut numerator, denominator) = if explicit {
        let d = denominator_pattern.parse::<f64>().unwrap();
        ((fractional * d + 0.5).floor(), d)
    } else {
        let maximum = (10f64.powi(denominator_pattern.len().min(10) as i32) - 1.).min(2147483647.);
        let (mut n1, mut d1, mut n2, mut d2, mut x, mut y) = (0., 1., 1., 0., fractional, 1.);
        loop {
            *work = work.checked_sub(1).ok_or(Failure::Limit)?;
            let q = (x / y).floor();
            let remainder = x - q * y;
            if n2 != 0. && q > (2147483647. - n1) / n2
                || d2 != 0. && q > (2147483647. - d1) / d2
                || q * d2 + d1 > maximum
            {
                break;
            }
            (n1, n2, d1, d2, x, y) = (n2, q * n2 + n1, d2, q * d2 + d1, y, remainder);
            if y <= 1e-10 {
                break;
            }
        }
        (n2, d2)
    };
    if adjusted - absolute >= 1. / denominator {
        return Err(Failure::Unsupported(
            "Unsupported ssconvert feature: TEXT fraction epsilon boundary".into(),
        ));
    }
    if boundary.is_some() && numerator == denominator {
        whole += 1.;
        numerator = 0.;
    }
    if boundary.is_none() {
        numerator += denominator * whole;
    }
    if denominator == 0.
        || [whole, numerator, denominator]
            .iter()
            .any(|n| n.abs() > 9_007_199_254_740_991. || n.fract() != 0.)
    {
        return Err(Failure::Unsupported(
            "Unsupported ssconvert feature: TEXT fraction binary64 boundary".into(),
        ));
    }
    let digits = |n: f64, template: &str| {
        let mut source = format!("{n:.0}");
        let mut result = String::new();
        for c in template.chars().rev() {
            if let Some(digit) = source.pop() {
                result.insert(0, digit);
            } else if c == '0' {
                result.insert(0, '0');
            } else if c == '?' {
                result.insert(0, ' ');
            }
        }
        source + &result
    };
    let slash = pattern.find('/').unwrap();
    let mut fraction = format!(
        "{}{}/{}{}",
        digits(numerator, numerator_pattern),
        &pattern[left.len()..slash],
        &right[..right.len() - right.trim_start().len()],
        if explicit {
            denominator_pattern.to_owned()
        } else {
            digits(denominator, denominator_pattern)
        }
    );
    let blank = boundary.is_some() && numerator == 0. && !numerator_pattern.contains('0');
    if blank {
        fraction = " ".repeat(fraction.len());
    }
    let whole_text = if boundary.is_some() && (whole != 0. || blank || whole_pattern.contains('0'))
    {
        digits(whole, whole_pattern) + " "
    } else {
        String::new()
    };
    let text = format!(
        "{}{whole_text}{fraction}{}",
        if n < 0. { minus } else { "" },
        &right[right.trim_end().len()..]
    );
    *work = work.checked_sub(text.len()).ok_or(Failure::Limit)?;
    Ok(Value::Text(text))
}
