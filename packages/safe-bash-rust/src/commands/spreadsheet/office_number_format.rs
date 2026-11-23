pub(in crate::commands) fn logical(format: &str) -> bool {
    let format = format
        .strip_prefix("[$-")
        .and_then(|s| s.split_once(']'))
        .filter(|(locale, _)| !locale.is_empty() && locale.bytes().all(|b| b.is_ascii_hexdigit()))
        .map_or(format, |(_, body)| body);
    format.eq_ignore_ascii_case("BOOLEAN") || format == r#""TRUE";"TRUE";"FALSE""#
}

pub(in crate::commands) fn number(n: f64, input_line: bool) -> String {
    if !n.is_finite() {
        return if n.is_nan() {
            "NaN"
        } else if n < 0. {
            "-INF"
        } else {
            "INF"
        }
        .into();
    }
    if n == 0. {
        return "0".into();
    }
    let scientific = format!("{:e}", n.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let mut exponent: i32 = exponent.parse().unwrap();
    let mut digits = mantissa.replace('.', "");
    // Calc preserves exact integers below 2^53; other input-line numbers use
    // 15 significant decimal digits, rounded from their shortest decimal form.
    if exponent + 1 >= digits.len() as i32 && n.abs() < 9007199254740992. {
        return n.to_string();
    }
    let exponential = if input_line {
        !(-14..15).contains(&exponent)
    } else {
        !(-4..17).contains(&exponent)
    };
    let precision = if n.abs().to_bits() >= f64::MAX.to_bits() - 4 {
        17
    } else {
        15
    };
    if digits.len() > precision {
        let divisor = 10u64.pow((digits.len() - precision) as u32);
        let rounded = (digits.parse::<u64>().unwrap() + divisor / 2) / divisor;
        digits = rounded.to_string();
        if digits.len() > precision {
            exponent += 1;
        }
    }
    let digits = digits.trim_end_matches('0');
    let sign = if n < 0. { "-" } else { "" };
    if exponential {
        let fraction = if digits.len() > 1 {
            format!(".{}", &digits[1..])
        } else {
            String::new()
        };
        format!(
            "{sign}{}{fraction}E{}{:03}",
            &digits[..1],
            if exponent < 0 { "-" } else { "+" },
            exponent.unsigned_abs()
        )
    } else {
        let point = exponent + 1;
        if point <= 0 {
            format!("{sign}0.{}{digits}", "0".repeat((-point) as usize))
        } else if point as usize >= digits.len() {
            format!(
                "{sign}{digits}{}",
                "0".repeat(point as usize - digits.len())
            )
        } else {
            let (whole, fraction) = digits.split_at(point as usize);
            format!("{sign}{whole}.{fraction}")
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FormatKind {
    Number,
    Literal,
    Text,
    Date,
    Time,
    DateTime,
}

pub(super) fn format_kind(tokens: &[super::dates::Token<'_>], currency: bool) -> FormatKind {
    if tokens.iter().any(|t| !t.escaped && t.text == "@") {
        return FormatKind::Text;
    }
    let time = tokens.iter().any(|t| {
        !t.literal
            && (t
                .text
                .chars()
                .any(|c| "hs".contains(c.to_ascii_lowercase()))
                || t.text.eq_ignore_ascii_case("AM/PM")
                || t.text.eq_ignore_ascii_case("A/P"))
    });
    let date = super::dates::has_date(tokens);
    if (date || time)
        && (currency
            || tokens
                .iter()
                .any(|t| !t.escaped && matches!(t.text, "0" | "#" | "?"))
            || tokens
                .iter()
                .filter(|t| !t.literal && t.text.starts_with('['))
                .count()
                > 1)
    {
        return FormatKind::Number;
    }
    match (date, time) {
        (true, true) => FormatKind::DateTime,
        (true, false) => FormatKind::Date,
        (false, true) => FormatKind::Time,
        _ if !tokens.is_empty() && tokens.iter().all(|t| t.literal && t.escaped) => {
            FormatKind::Literal
        }
        _ => FormatKind::Number,
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands) enum Mode {
    Edit,
    Filter,
    Display,
    ExcelDisplay,
}

// Calc compares numeric cells using their input-line string with filtering
// enabled. CSV uses the edit format instead, which removes numeric decoration.
pub(in crate::commands) fn text(
    n: f64,
    format: &str,
    date1904: bool,
    mode: Mode,
    work: &mut usize,
) -> Option<String> {
    use super::dates;
    let filtering = mode != Mode::Edit;
    *work = work.checked_sub(format.len().checked_mul(32)?.checked_add(512)?)?;
    if n.is_finite() && logical(format) {
        return Some(if n == 0. { "FALSE" } else { "TRUE" }.into());
    }
    let sections = match dates::sections(format, true) {
        Ok(sections) => sections,
        Err(_) => return Some(number(n, true)),
    };
    let (pattern, magnitude) = if filtering {
        dates::select(&sections, n).unwrap_or(("", false))
    } else {
        (sections.first()?.pattern.as_str(), false)
    };
    let tokens = dates::tokens(pattern, work).ok()?;
    let kind = format_kind(&tokens, sections.first()?.currency);
    if !n.is_finite() {
        return Some(if n.is_nan() && kind == FormatKind::Time {
            "00:00.NaN".into()
        } else {
            number(n, true)
        });
    }
    if !filtering && kind == FormatKind::Literal {
        let value = number(n, true);
        return Some(if let Some((body, exponent)) = value.split_once("E-") {
            format!("{body}E-{:02}", exponent.parse::<u32>().ok()?)
        } else {
            value
        });
    }
    if !filtering && kind == FormatKind::Text {
        return Some(if n.abs() > 1e15 {
            let s = format!("{n:.14e}");
            let (body, exponent) = s.split_once('e')?;
            let exponent: i32 = exponent.parse().ok()?;
            format!(
                "{body}E{}{exponent:02}",
                if exponent < 0 { "-" } else { "+" },
                exponent = exponent.abs()
            )
        } else {
            let precision = if n == 0. {
                0
            } else {
                (14. - n.abs().log10().floor()).max(0.) as usize
            };
            let value = fixed(n.abs(), precision);
            format!(
                "{}{}",
                if n < 0. { "-" } else { "" },
                if precision == 0 {
                    &value
                } else {
                    value.trim_end_matches('0').trim_end_matches('.')
                }
            )
        });
    }
    if matches!(
        kind,
        FormatKind::Date | FormatKind::Time | FormatKind::DateTime
    ) {
        let has_time = kind != FormatKind::Date;
        let has_date = kind != FormatKind::Time;
        let mut mixed = false;
        if !filtering {
            for section in sections.iter().take(3) {
                let tokens = dates::tokens(&section.pattern, work).ok()?;
                mixed |= format_kind(&tokens, section.currency) != kind;
            }
        }
        let pattern = if filtering {
            format
        } else if has_date {
            let iso = !mixed
                && tokens.get(..5).is_some_and(|t| {
                    !t[0].literal
                        && matches!(t[0].text, "yy" | "yyyy")
                        && t[1].text == "-"
                        && !t[2].literal
                        && matches!(t[2].text, "m" | "mm")
                        && t[3].text == "-"
                        && !t[4].literal
                        && matches!(t[4].text, "d" | "dd")
                });
            if iso && has_time && pattern.eq_ignore_ascii_case("yyyy-mm-dd hh:mm:ss.000") {
                "yyyy-mm-dd hh:mm:ss.000"
            } else if n.fract() == 0. && !has_time {
                if iso { "yyyy-mm-dd" } else { "mm/dd/yyyy" }
            } else if iso {
                "yyyy-mm-dd hh:mm:ss"
            } else {
                "mm/dd/yyyy hh:mm:ss"
            }
        } else {
            let duration = !(0. ..1.).contains(&n) || pattern.eq_ignore_ascii_case("[hh]:mm:ss");
            let seconds = n.abs() * 86400.;
            if duration && n.abs() * 24. >= 32767. {
                "mm/dd/yyyy hh:mm:ss"
            } else if (seconds + 0.5).floor() * 100. != (seconds * 100. + 0.5).floor() {
                if duration || seconds >= 3600. {
                    "[hh]:mm:ss.0000000"
                } else {
                    "mm:ss.0000000"
                }
            } else if duration {
                "[hh]:mm:ss"
            } else {
                "hh:mm:ss AM/PM"
            }
        };
        if mode == Mode::ExcelDisplay && n < 0. && !date1904 {
            return Some("######".into());
        }
        let mut result = dates::text(
            &n.to_string(),
            pattern,
            date1904,
            mode != Mode::ExcelDisplay,
            *work,
            work,
        )
        .ok()?
        .unwrap_or_else(|| number(n, true));
        if !filtering
            && pattern.ends_with(".0000000")
            && let Some(point) = result.find('.')
        {
            while result.len() > point + 3 && result.ends_with('0') {
                result.pop();
            }
        }
        return Some(result);
    }
    let percent = tokens.iter().any(|t| !t.escaped && t.text == "%");
    if percent && n.abs() >= 1.7e306 {
        return Some(number(n, true));
    }
    let scaled = if percent { n * 100. } else { n };
    if !filtering
        || matches!(pattern, "General" | "@")
        || mode == Mode::Filter && matches!(pattern, "0.00E+00" | "0%" | "0.00%")
    {
        let mut s = number(scaled, true);
        if matches!(mode, Mode::Display | Mode::ExcelDisplay)
            && pattern == "General"
            && let Some((body, exponent)) = s.split_once("E-")
        {
            s = format!("{body}E-{:02}", exponent.parse::<u32>().ok()?);
        }
        if percent && (n * 100.).is_finite() {
            s.push('%');
        }
        return Some(s);
    }
    let mut parts = Vec::new();
    for token in &tokens {
        for c in token.text.chars() {
            parts.push((c, token.escaped));
        }
    }
    let first = parts
        .iter()
        .position(|(c, literal)| !literal && matches!(c, '0' | '#' | '?'));
    let Some(first) = first else {
        return Some(parts.iter().map(|(c, _)| *c).collect());
    };
    let last = parts
        .iter()
        .rposition(|(c, literal)| !literal && matches!(c, '0' | '#' | '?'))?;
    let numeric = &parts[first..=last];
    let exponent = numeric
        .iter()
        .position(|(c, literal)| !literal && matches!(c, 'E' | 'e'));
    let mantissa = &numeric[..exponent.unwrap_or(numeric.len())];
    let point = mantissa
        .iter()
        .position(|(c, literal)| !literal && *c == '.')
        .unwrap_or(mantissa.len());
    let integers = mantissa[..point]
        .iter()
        .filter(|(c, l)| !l && *c == '0')
        .count();
    let fraction = if point < mantissa.len() {
        &mantissa[point + 1..]
    } else {
        &[]
    };
    let precision = fraction
        .iter()
        .filter(|(c, l)| !l && matches!(c, '0' | '#' | '?'))
        .count();
    let required = fraction.iter().filter(|(c, l)| !l && *c == '0').count();
    *work = work.checked_sub(
        integers
            .checked_add(precision)?
            .checked_add(parts.len())?
            .checked_mul(4)?,
    )?;
    let value = if magnitude { scaled.abs() } else { scaled };
    let mut number = if exponent.is_some() {
        // Shortest round-trip strings have very few significant digits for
        // subnormals (e.g. 1.5e-323). Preserve the mantissa before mask rounding.
        format!("{:.16e}", value.abs())
    } else {
        fixed(value.abs(), precision)
    };
    let exp = if let Some(index) = exponent {
        let (body, power) = number.split_once('e')?;
        let mut power: i32 = power.parse().ok()?;
        let mut body = fixed(body.parse().ok()?, precision);
        if body.starts_with("10") {
            power += 1;
            body = fixed(1., precision);
        }
        let width = numeric[index + 1..]
            .iter()
            .filter(|(c, l)| !l && *c == '0')
            .count();
        let suffix = format!(
            "E{}{:0width$}",
            if power < 0 { "-" } else { "+" },
            power.unsigned_abs()
        );
        number = body;
        suffix
    } else {
        String::new()
    };
    let negative = value < 0. && number.bytes().any(|b| matches!(b, b'1'..=b'9'));
    if let Some(point) = number.find('.') {
        while number.len() > point + 1 + required && number.ends_with('0') {
            number.pop();
        }
        if number.ends_with('.') {
            number.pop();
        }
    }
    let count = number.find('.').unwrap_or(number.len());
    if count < integers {
        number.insert_str(0, &"0".repeat(integers - count));
    }
    if mantissa[..point].iter().any(|(c, l)| !l && *c == ',') {
        // Group the ASCII digits before inserting Unicode mask literals. A
        // forward pass avoids shifting the buffer once for every separator.
        let count = number.find('.').unwrap_or(number.len());
        let size = number.len().checked_add(count.saturating_sub(1) / 3)?;
        *work = work.checked_sub(size)?;
        let mut grouped = String::with_capacity(size);
        for (index, c) in number.char_indices() {
            if index > 0 && index < count && (count - index) % 3 == 0 {
                grouped.push(',');
            }
            grouped.push(c);
        }
        number = grouped;
    }
    // Integer masks can place literal separators between digit placeholders.
    // Fill from the right while preserving every literal, including Unicode.
    if exponent.is_none()
        && point == mantissa.len()
        && numeric
            .iter()
            .any(|(c, escaped)| *escaped || !matches!(c, '0' | '#' | '?' | ','))
    {
        let mut digits = number.chars().rev();
        let mut reversed = String::new();
        for (c, escaped) in numeric.iter().rev() {
            if !escaped && matches!(c, '0' | '#' | '?') {
                let mut digit = digits.next();
                if digit == Some(',') {
                    reversed.push(',');
                    digit = digits.next();
                }
                if let Some(digit) = digit {
                    reversed.push(digit);
                }
            } else if *escaped || *c != ',' {
                reversed.push(*c);
            }
        }
        reversed.extend(digits);
        number = reversed.chars().rev().collect();
    }
    let prefix: String = parts[..first].iter().map(|(c, _)| *c).collect();
    let suffix: String = parts[last + 1..].iter().map(|(c, _)| *c).collect();
    Some(format!(
        "{}{prefix}{number}{exp}{suffix}",
        if negative { "-" } else { "" }
    ))
}

fn fixed(value: f64, precision: usize) -> String {
    // Round the native decimal input representation, not the slightly lower
    // binary value of numbers such as 1.005 and 2.675.
    let source = number(value, true);
    let (mantissa, exponent) = source
        .split_once('E')
        .map_or((source.as_str(), 0), |(s, e)| {
            (s, e.parse::<i32>().unwrap())
        });
    let point = mantissa.find('.').unwrap_or(mantissa.len()) as i32 + exponent;
    let mut digits = mantissa.replace('.', "");
    let keep = i64::from(point) + precision as i64;
    if keep < 0 {
        digits = "0".into();
    } else {
        let keep = keep as usize;
        if keep < digits.len() {
            let up = digits.as_bytes()[keep] >= b'5';
            digits.truncate(keep);
            let n = digits.parse::<u64>().unwrap_or(0) + u64::from(up);
            digits = format!("{n:0keep$}");
        } else {
            digits.extend(std::iter::repeat_n('0', keep - digits.len()));
        }
    }
    if digits.len() <= precision {
        digits.insert_str(0, &"0".repeat(precision + 1 - digits.len()));
    }
    if precision != 0 {
        digits.insert(digits.len() - precision, '.');
    }
    digits
}
