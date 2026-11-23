use super::{Calculation, Coord, Expr, Failure, Value, production::Expansion};
use std::cmp::Ordering;

impl Calculation<'_> {
    pub(super) fn database(
        &mut self,
        name: &str,
        nodes: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if nodes.len() != 3 {
            return Some(Value::Error("#N/A"));
        }
        let mut args = Vec::new();
        let mut array = false;
        for (index, node) in nodes.iter().enumerate() {
            let outer_array = self.array;
            self.array |= index != 1;
            let value = self.eval(node, pos, depth + 1, true);
            self.array = outer_array;
            let value = value?;
            let value = if index == 1 {
                if self.array
                    && matches!(
                        value,
                        Value::Range(..)
                            | Value::LabelRange(..)
                            | Value::Matrix(_)
                            | Value::Single(_)
                    )
                {
                    array = true;
                    Value::Matrix(self.matrix(value, depth + 1)?)
                } else {
                    self.scalar(value, pos, depth + 1)?
                }
            } else {
                value.into_range()
            };
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Some(Value::Error(e));
            }
            if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
                return Some(Value::Error("#REF!"));
            }
            if index != 1
                && !matches!(
                    value,
                    Value::Range(..) | Value::LabelRange(..) | Value::Matrix(_)
                )
            {
                return Some(Value::Error("#VALUE!"));
            }
            args.push(value);
        }
        let criteria = args.pop()?;
        let field = args.pop()?;
        let database = args.pop()?;
        if array {
            let Value::Matrix(fields) = field else {
                unreachable!()
            };
            let mut rows = Vec::new();
            for fields in fields {
                let mut row = Vec::new();
                for field in fields {
                    row.push(self.database_aggregate(
                        name,
                        &database,
                        &field,
                        &criteria,
                        depth + 1,
                    )?);
                }
                rows.push(row);
            }
            Some(Value::Matrix(rows))
        } else {
            self.database_aggregate(name, &database, &field, &criteria, depth + 1)
        }
    }

    fn database_column(
        &mut self,
        a: Coord,
        b: Coord,
        field: &Value,
        depth: usize,
    ) -> Option<Option<usize>> {
        if let Value::Number(n) = field {
            let column = a.2 as f64 + n.trunc() - 1.;
            return Some((column >= 0.).then_some(column as usize));
        }
        let (Value::Text(wanted) | Value::UninternedText(wanted)) = field else {
            return Some(None);
        };
        for column in a.2..=b.2 {
            self.tick(depth)?;
            let coord = (a.0, a.1, column);
            if self.values.contains_key(&coord) || self.expressions.contains_key(&coord) {
                let value = self.cell(coord, depth + 1)?;
                if rendered(&value).eq_ignore_ascii_case(wanted) {
                    return Some(Some(column));
                }
            }
        }
        Some(None)
    }

    fn database_aggregate(
        &mut self,
        name: &str,
        database: &Value,
        field: &Value,
        criteria: &Value,
        depth: usize,
    ) -> Option<Value> {
        if let Value::Error(e) | Value::LiteralError(e) = field {
            return Some(Value::Error(e));
        }
        let (Value::Range(a, b), Value::Range(c, d)) = (database, criteria) else {
            return Some(Value::Error("#NUM!"));
        };
        if a.0 != b.0 || c.0 != d.0 {
            self.failure = Some(Failure::Unsupported(
                "Unsupported ssconvert feature: database sheet span".into(),
            ));
            return None;
        }
        let (a, b) = (
            (a.0, a.1.min(b.1), a.2.min(b.2)),
            (b.0, a.1.max(b.1), a.2.max(b.2)),
        );
        let (c, d) = (
            (c.0, c.1.min(d.1), c.2.min(d.2)),
            (d.0, c.1.max(d.1), c.2.max(d.2)),
        );
        let missing = matches!(name, "DCOUNT" | "DCOUNTA")
            && matches!(
                field,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            );
        let column = if missing {
            a.2
        } else {
            let Some(column) = self.database_column(a, b, field, depth)? else {
                return Some(Value::Error("#NUM!"));
            };
            column
        };
        if column >= self.sizes.get(a.0)?.1 {
            self.failure = Some(Failure::Unsupported(
                "Unsupported ssconvert feature: database field outside sheet".into(),
            ));
            return None;
        }
        if c.1 == d.1 {
            return Some(Value::Error("#NUM!"));
        }
        let mut columns = Vec::new();
        for col in c.2..=d.2 {
            let header = self.cell((c.0, c.1, col), depth + 1)?;
            if matches!(
                header,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ) {
                self.failure = Some(Failure::Unsupported(
                    "Unsupported ssconvert feature: uninitialized released database criteria header"
                        .into(),
                ));
                return None;
            }
            let Some(mapped) = self.database_column(a, b, &header, depth)? else {
                return Some(Value::Error("#NUM!"));
            };
            columns.push(mapped);
        }
        let mut conditions = Vec::new();
        for row in c.1 + 1..=d.1 {
            self.tick(depth)?;
            let mut list = Vec::new();
            for (offset, &column) in columns.iter().enumerate() {
                let value = self.cell((c.0, row, c.2 + offset), depth + 1)?;
                if !matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                ) {
                    self.work = self
                        .work
                        .checked_sub(std::mem::size_of::<(usize, Value)>())?;
                    list.push((column, value));
                }
            }
            conditions.push(list);
        }
        let mut values = Vec::new();
        for row in a.1 + 1..=b.1 {
            self.tick(depth)?;
            let coord = (a.0, row, column);
            // fetchCell in the omitted-field path makes the first-column blank
            // present before matching sparse database rows.
            if missing {
                self.values.entry(coord).or_insert(Value::Blank);
            }
            let value = self.cell(coord, depth + 1)?;
            if !missing
                && matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                )
            {
                continue;
            }
            let mut matched = false;
            for list in &conditions {
                let mut matches = true;
                for (column, condition) in list {
                    self.tick(depth)?;
                    let coord = (a.0, row, *column);
                    if self.values.contains_key(&coord) || self.expressions.contains_key(&coord) {
                        let actual = self.cell(coord, depth + 1)?;
                        if !self.database_match(&actual, condition, depth + 1)? {
                            matches = false;
                            break;
                        }
                    }
                }
                if matches {
                    matched = true;
                    break;
                }
            }
            if !matched {
                continue;
            }
            if !missing {
                if name == "DCOUNT" && !matches!(value, Value::Number(_)) {
                    continue;
                }
                if !matches!(name, "DCOUNTA" | "DGET") {
                    if let Value::Error(e) | Value::LiteralError(e) = value {
                        return Some(Value::Error(e));
                    }
                    if !matches!(value, Value::Number(_)) {
                        continue;
                    }
                }
            }
            self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
            values.push(value);
        }
        if matches!(name, "DCOUNT" | "DCOUNTA") {
            return Some(Value::Number(values.len() as f64));
        }
        if name == "DGET" {
            return Some(values.into_iter().next().unwrap_or(Value::Error("#VALUE!")));
        }
        let numbers: Vec<_> = values
            .iter()
            .filter_map(|v| {
                if let Value::Number(n) = v {
                    Some(*n)
                } else {
                    None
                }
            })
            .collect();
        let n = numbers.len() as f64;
        if name == "DSUM" {
            return Some(Value::number(Expansion::sum(&numbers, &mut self.work)?));
        }
        if name == "DPRODUCT" {
            return Some(Value::number(product(&numbers)));
        }
        if numbers.is_empty() {
            return Some(Value::Error("#NUM!"));
        }
        if name == "DMAX" {
            return Some(Value::number(
                numbers.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            ));
        }
        if name == "DMIN" {
            return Some(Value::number(
                numbers.iter().copied().fold(f64::INFINITY, f64::min),
            ));
        }
        let constant = numbers.iter().all(|v| *v == numbers[0]);
        if name == "DAVERAGE" {
            return Some(Value::number(if constant {
                numbers[0]
            } else {
                Expansion::sum(&numbers, &mut self.work)? / n
            }));
        }
        let denominator = n - if name.ends_with('P') { 0. } else { 1. };
        if denominator <= 0. {
            return Some(Value::Error("#NUM!"));
        }
        let variance = if constant {
            0.
        } else {
            squared_deviations(&numbers, &mut self.work)? / denominator
        };
        Some(Value::number(if name.starts_with("DSTDEV") {
            variance.sqrt()
        } else {
            variance
        }))
    }

    fn database_match(&mut self, value: &Value, condition: &Value, depth: usize) -> Option<bool> {
        self.tick(depth)?;
        if matches!(
            condition,
            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
        ) {
            return Some(true);
        }
        if matches!(condition, Value::Number(_) | Value::Bool(_)) {
            return Some(match (value, condition) {
                (Value::Number(a), Value::Number(b)) => a == b,
                (Value::Bool(a), Value::Bool(b)) => a == b,
                (Value::Text(s) | Value::UninternedText(s), Value::Number(n)) => {
                    match_number(s, self.book.date1904) == Some(Value::Number(*n))
                }
                _ => false,
            });
        }
        let text = rendered(condition);
        if text.is_empty() {
            return Some(
                matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                ) || matches!(value, Value::Text(s) | Value::UninternedText(s) if s.is_empty()),
            );
        }
        if text == "=" {
            return Some(matches!(
                value,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ));
        }
        if text == "<>" {
            return Some(!matches!(
                value,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ));
        }
        let op = ["<=", ">=", "<>", "<", ">", "="]
            .into_iter()
            .find(|op| text.starts_with(op));
        let source = op.map_or(text.as_str(), |op| &text[op.len()..]);
        let number = match_number(source, self.book.date1904);
        if op.is_none() && number.is_none() {
            return if let Value::Text(s) | Value::UninternedText(s) = value {
                self.database_wildcard(source, s, depth + 1)
            } else {
                Some(false)
            };
        }
        let order = match number {
            Some(Value::Bool(b)) => {
                if let Value::Bool(a) = value {
                    Some(a.cmp(&b))
                } else {
                    None
                }
            }
            Some(Value::Number(b)) => {
                let actual = match value {
                    Value::Number(n) => Some(*n),
                    Value::Text(s) | Value::UninternedText(s)
                        if op.is_none() || op == Some("=") =>
                    {
                        match match_number(s, self.book.date1904) {
                            Some(Value::Number(n)) => Some(n),
                            _ => None,
                        }
                    }
                    _ => None,
                };
                actual.and_then(|a| a.partial_cmp(&b))
            }
            _ => {
                if let Value::Text(s) | Value::UninternedText(s) = value {
                    Some(
                        s.to_ascii_lowercase()
                            .encode_utf16()
                            .cmp(source.to_ascii_lowercase().encode_utf16()),
                    )
                } else {
                    None
                }
            }
        };
        Some(match (op, order) {
            (Some("<>"), order) => order != Some(Ordering::Equal),
            (_, None) => false,
            (Some("<"), Some(o)) => o.is_lt(),
            (Some(">"), Some(o)) => o.is_gt(),
            (Some("<="), Some(o)) => !o.is_gt(),
            (Some(">="), Some(o)) => !o.is_lt(),
            (_, Some(o)) => o.is_eq(),
        })
    }

    fn database_wildcard(&mut self, pattern: &str, text: &str, depth: usize) -> Option<bool> {
        self.work = self
            .work
            .checked_sub(pattern.len().checked_add(text.len())?.checked_mul(24)?)?;
        let input: Vec<_> = text.to_lowercase().chars().collect();
        let lower = pattern.to_lowercase();
        let mut chars = lower.chars().peekable();
        let mut previous = vec![false; input.len() + 1];
        previous[0] = true;
        while let Some(mut token) = chars.next() {
            self.tick(depth)?;
            let literal =
                token == '~' && chars.peek().is_some_and(|c| matches!(c, '*' | '?' | '~'));
            if literal {
                token = chars.next()?;
            }
            let mut next = vec![false; input.len() + 1];
            next[0] = !literal && token == '*' && previous[0];
            for i in 1..=input.len() {
                self.tick(depth)?;
                next[i] = if !literal && token == '*' {
                    previous[i] || next[i - 1]
                } else {
                    previous[i - 1] && (!literal && token == '?' || token == input[i - 1])
                };
            }
            previous = next;
        }
        Some(previous.into_iter().any(|matched| matched))
    }
}

fn rendered(value: &Value) -> String {
    match value {
        Value::Number(n) => {
            let scientific = format!("{n:e}");
            let (mantissa, exponent) = scientific.split_once('e').unwrap();
            let exponent: i32 = exponent.parse().unwrap();
            if (-4..17).contains(&exponent) {
                n.to_string()
            } else {
                format!("{mantissa}E{exponent:+03}")
            }
        }
        Value::Bool(true) => "TRUE".into(),
        Value::Bool(false) => "FALSE".into(),
        _ => value.text(),
    }
}

fn product(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 1.;
    }
    if values.len() == 1 || values[0] == 0. {
        return values[0];
    }
    let (mut mantissa, mut exponent) = (1., 0i64);
    for &value in values {
        if value == 0. {
            return 0.;
        }
        let mut power = value.abs().log2().floor().clamp(-1074., 1023.) as i32;
        let mut fraction = value / super::power::pow(2., power as f64);
        if fraction.abs() > 1. {
            fraction /= 2.;
            power += 1;
        }
        mantissa *= fraction;
        exponent += power as i64;
        if mantissa.abs() <= 0.5 {
            mantissa *= 2.;
            exponent -= 1;
        }
    }
    if exponent > 1024 {
        return if mantissa < 0. {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    if exponent < -1074 {
        return 0.;
    }
    if exponent == 1024 {
        (mantissa * 2.) * super::power::pow(2., 1023.)
    } else {
        mantissa * super::power::pow(2., exponent as f64)
    }
}

fn quad_product(x: f64, y: f64) -> (f64, f64) {
    fn split(mut value: f64) -> (f64, f64) {
        let mut product = value * 134217729.;
        let rescale = !product.is_finite() && value.is_finite();
        if rescale {
            value *= f64::EPSILON;
            product = value * 134217729.;
        }
        let high = value - product + product;
        let low = value - high;
        if rescale {
            (high / f64::EPSILON, low / f64::EPSILON)
        } else {
            (high, low)
        }
    }
    let (a, b) = (split(x), split(y));
    let product = a.0 * b.0;
    let cross = a.0 * b.1 + a.1 * b.0;
    let high = product + cross;
    (high, product - high + cross + a.1 * b.1)
}

fn squared_deviations(values: &[f64], work: &mut usize) -> Option<f64> {
    let mut sum = Expansion::default();
    for &value in values.iter().rev() {
        sum.add(value, work)?;
    }
    let high = sum.total(work)?;
    sum.add(-high, work)?;
    let low = sum.total(work)?;
    let total_high = high + low;
    let total_low = if high.abs() > low.abs() {
        high - total_high + low
    } else {
        low - total_high + high
    };
    let normalized_high = total_high + total_low;
    let normalized_low = total_high - normalized_high + total_low;
    let n = values.len() as f64;
    let quotient = normalized_high / n;
    let multiplied = quad_product(quotient, n);
    let correction = (normalized_high - multiplied.0 - multiplied.1 + normalized_low) / n;
    let mean_high = quotient + correction;
    let mean_low = quotient - mean_high + correction;
    let mut sum = Expansion::default();
    for &x in values.iter().rev() {
        let difference = x - mean_high;
        let correction = if x.abs() > mean_high.abs() {
            x - difference - mean_high - mean_low
        } else {
            -mean_high - difference + x - mean_low
        };
        let high = difference + correction;
        let low = difference - high + correction;
        let square = quad_product(high, high);
        let square_low = high * low + low * high + square.1;
        let square_high = square.0 + square_low;
        sum.add(square_high, work)?;
        sum.add(square.0 - square_high + square_low, work)?;
    }
    sum.total(work)
}

fn match_number(source: &str, date1904: bool) -> Option<Value> {
    if source.eq_ignore_ascii_case("true") {
        return Some(Value::Bool(true));
    }
    if source.eq_ignore_ascii_case("false") {
        return Some(Value::Bool(false));
    }
    let mut text = source.trim();
    let mut sign = 1.;
    if let Some(inner) = text.strip_prefix('(').and_then(|s| s.strip_suffix(')')) {
        sign = -1.;
        text = inner.trim();
    }
    if let Some(rest) = text.strip_prefix('$') {
        text = rest.trim();
    }
    let mut parts = text.split('.');
    let integral = parts.next()?;
    let fraction = parts.next();
    if parts.next().is_some() {
        return temporal_number(source, date1904, true).map(Value::Number);
    }
    let groups: Vec<_> = integral.split(',').collect();
    if groups.len() > 1
        && (groups[0].encode_utf16().count() > 4
            || groups[1..].iter().any(|s| s.encode_utf16().count() != 3))
    {
        return None;
    }
    let mut number = groups.join("");
    if let Some(fraction) = fraction {
        number.push('.');
        number.push_str(fraction);
    }
    let number = number.trim();
    let (number, scale) = number
        .strip_suffix('%')
        .map_or((number, 1.), |n| (n.trim(), 0.01));
    if let Some(n) = super::super::decimal(number)
        .map(|n| n * scale)
        .filter(|n| n.is_finite())
    {
        return Some(Value::Number(n * sign));
    }
    temporal_number(source, date1904, true).map(Value::Number)
}

fn temporal_number(source: &str, date1904: bool, date_allowed: bool) -> Option<f64> {
    use crate::commands::coreutils::{civil_from_days, days_from_civil};
    fn digits(s: &str) -> bool {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
    }
    let mut text = source.trim();
    let mut parts = Vec::new();
    let mut position = 0;
    for index in 0..3 {
        let start = position;
        while text
            .as_bytes()
            .get(position)
            .is_some_and(u8::is_ascii_digit)
        {
            position += 1;
        }
        parts.push(&text[start..position]);
        if index < 2 {
            if text
                .as_bytes()
                .get(position)
                .is_some_and(|b| matches!(b, b'-' | b'/' | b'.'))
            {
                position += 1;
            } else {
                break;
            }
        }
    }
    if date_allowed && parts.len() == 3 && parts.iter().all(|s| digits(s)) {
        let year_first = parts[0].len() == 4;
        let year_text = parts[if year_first { 0 } else { 2 }];
        let month_text = parts[if year_first { 1 } else { 0 }];
        let day_text = parts[if year_first { 2 } else { 1 }];
        if year_text.len() > 4 || month_text.len() > 2 || day_text.len() > 2 {
            return None;
        }
        let mut year: i64 = year_text.parse().ok()?;
        if year_first && year < 1582 {
            return None;
        }
        if year <= 29 {
            year += 2000;
        } else if year <= 99 {
            year += 1900;
        }
        let month: i64 = month_text.parse().ok()?;
        let day: i64 = day_text.parse().ok()?;
        if !(1582..=9999).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day)
        {
            return None;
        }
        let days = days_from_civil(year, month, day);
        if civil_from_days(days) != (year, month as u32, day as u32) {
            return None;
        }
        let mut serial = (days
            - if date1904 {
                days_from_civil(1904, 1, 1)
            } else {
                days_from_civil(1899, 12, 31)
            }) as f64;
        if !date1904 && serial >= 60. {
            serial += 1.;
        }
        let rest = text[position..].trim();
        if !rest.is_empty() {
            serial += temporal_number(rest, date1904, false)?;
        }
        return Some(serial);
    }
    let lower = text.to_lowercase();
    let meridiem = if lower.ends_with("am") {
        Some(false)
    } else if lower.ends_with("pm") {
        Some(true)
    } else {
        None
    };
    if !date_allowed && text.starts_with(['-', '+', '−']) {
        return None;
    }
    let mut sign = 1.;
    if meridiem.is_some() {
        text = text[..text.len() - 2].trim();
    } else if let Some(rest) = text.strip_prefix('+') {
        text = rest;
    } else if let Some(rest) = text.strip_prefix('-').or_else(|| text.strip_prefix('−')) {
        sign = -1.;
        text = rest;
    }
    let mut parts: Vec<_> = text.split(':').collect();
    let fractional = parts.last()?.contains('.');
    if meridiem.is_some() && fractional && parts.len() < 3 {
        return None;
    }
    let clock_digits = text.split('.').next()?;
    if !date_allowed
        && meridiem.is_none()
        && parts.len() == 1
        && matches!(clock_digits.len(), 4 | 6)
        && digits(clock_digits)
    {
        parts = if clock_digits.len() == 6 {
            vec![&text[..2], &text[2..4], &text[4..]]
        } else {
            vec![&text[..2], &text[2..]]
        };
    }
    if parts.len() > 3 || parts.len() < 2 && meridiem.is_none() && !fractional {
        return None;
    }
    for (index, part) in parts.iter().enumerate() {
        if index == parts.len() - 1 && fractional {
            let (first, last) = part.split_once('.')?;
            if !digits(first) || !last.is_empty() && !digits(last) {
                return None;
            }
        } else if !digits(part) {
            return None;
        }
    }
    let values: Vec<f64> = parts
        .iter()
        .map(|s| s.parse().ok())
        .collect::<Option<_>>()?;
    let (mut hour, minute, second) = if values.len() == 3 {
        (values[0], values[1], values[2])
    } else if values.len() == 1 && fractional && meridiem.is_none() {
        (0., 0., values[0])
    } else if fractional && meridiem.is_none() {
        (0., values[0], values[1])
    } else {
        (values[0], values.get(1).copied().unwrap_or(0.), 0.)
    };
    if let Some(pm) = meridiem {
        if !(1. ..=12.).contains(&hour) {
            return None;
        }
        hour = hour % 12. + if pm { 12. } else { 0. };
    }
    if minute >= 60. && !(fractional && parts.len() == 2) || second >= 60. || !hour.is_finite() {
        return None;
    }
    if !date_allowed && (hour >= 24. || minute >= 60.) {
        return None;
    }
    Some(sign * (hour * 3600. + minute * 60. + second) / 86400.)
}

#[cfg(test)]
mod tests {
    use super::super::calculate;
    use super::super::{Calculation, Value, Workbook, parse};
    use crate::commands::structured::{JVal, parse_json_stream};
    use std::collections::BTreeSet;

    fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
        let JVal::Object(fields) = value else {
            panic!("object")
        };
        &fields.iter().find(|(name, _)| name == key).unwrap().1
    }

    fn value(source: &JVal) -> Value {
        let JVal::Str(kind) = field(source, "kind") else {
            panic!("kind")
        };
        if kind == "blank" {
            return Value::Blank;
        }
        match (kind.as_str(), field(source, "value")) {
            ("number", JVal::Number(n, _)) => Value::Number(*n),
            ("boolean", JVal::Bool(b)) => Value::Bool(*b),
            ("string", JVal::Str(s)) => Value::Text(s.clone()),
            ("error", JVal::Str(s)) => Value::Error(
                super::super::LITERAL_ERRORS
                    .iter()
                    .find(|e| **e == s)
                    .unwrap(),
            ),
            _ => panic!("value {source:?}"),
        }
    }

    #[test]
    fn database_functions_match_production() {
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-database-production.json"
        ))
        .unwrap()
        .remove(0);
        let JVal::Array(scenarios) = field(&fixture, "scenarios") else {
            panic!("scenarios")
        };
        let mut failures = Vec::new();
        for scenario in scenarios {
            let JVal::Array(cells) = field(scenario, "cells") else {
                panic!("cells")
            };
            let JVal::Array(cases) = field(scenario, "cases") else {
                panic!("cases")
            };
            for case in cases {
                let JVal::Str(formula) = field(case, "formula") else {
                    panic!("formula")
                };
                let book = Workbook::default();
                let names = vec!["Sheet1".into()];
                let pos = (0, 30, 10);
                let mut calc = Calculation::new(&book, &names, vec![(1048576, 16384)], 4_000_000);
                for cell in cells {
                    let JVal::Number(row, _) = field(cell, "row") else {
                        panic!("row")
                    };
                    let JVal::Number(col, _) = field(cell, "column") else {
                        panic!("column")
                    };
                    calc.values.insert(
                        (0, *row as usize, *col as usize),
                        value(field(cell, "value")),
                    );
                }
                calc.array = matches!(field(case, "array"), JVal::Bool(true));
                let mut work = 4_000_000;
                let compiled = super::super::super::csv::reference_text(
                    formula,
                    "Sheet1",
                    super::super::super::csv::FormulaMode::Calculate,
                    &mut work,
                )
                .unwrap();
                let compiled =
                    super::super::super::csv::text_from_units(compiled.into_iter(), true, work)
                        .unwrap();
                let expression = parse(
                    crate::commands::structured::xlsx::Dialect::LibreOffice,
                    &compiled,
                    &names,
                    &book,
                    (0, 30, 10),
                    Some(0),
                    true,
                    None,
                    work,
                )
                .unwrap()
                .unwrap();
                let actual = calc.eval(&expression, pos, 0, false).unwrap();
                let actual = if calc.array {
                    calc.matrix(actual, 0).unwrap()
                } else {
                    vec![vec![calc.scalar(actual, pos, 0).unwrap()]]
                };
                let JVal::Array(expected) = field(case, "values") else {
                    panic!("values")
                };
                for (col, expected) in expected.iter().enumerate() {
                    let expected = value(expected);
                    let actual = actual[0]
                        .get(if actual[0].len() == 1 { 0 } else { col })
                        .unwrap_or(&Value::Error("#N/A"));
                    if *actual != expected {
                        failures.push(format!(
                            "{:?}: {formula} array={} [{col}]: {actual:?} != {expected:?}",
                            field(scenario, "label"),
                            calc.array
                        ));
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} mismatches:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn database_ranges_and_criteria_are_bounded() {
        for formula in ["=DSUM(A1:B65536,2,D1:D2)", "=DCOUNT(A1:B2,2,D1:D65536)"] {
            let rows = vec![
                vec!["Key".into(), "Value".into(), formula.into(), "Key".into()],
                vec!["a".into(), "1".into(), "".into(), "a".into()],
            ];
            for budget in [128, 4096] {
                assert!(
                    calculate(&rows, &BTreeSet::new(), budget).is_none(),
                    "{formula}: {budget}"
                );
            }
            assert!(
                calculate(&rows, &BTreeSet::new(), 8_000_000).is_some(),
                "{formula}"
            );
        }
    }
}
