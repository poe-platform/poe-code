use super::super::collation;
use super::{
    Calculation, Coord, Expr, Value, approximately_equal, lookup, rounding, summation::Sum,
};
use crate::commands::{search::ZeroRegex, spreadsheet::model::LookupSearch};
use std::cmp::Ordering;

struct Condition {
    field: usize,
    or: bool,
    operator: &'static str,
    text: String,
    number: Option<f64>,
    regex: Option<ZeroRegex>,
    boolean: Option<bool>,
    prefix: bool,
}

fn operator(text: &str) -> (&'static str, &str) {
    for op in ["<=", ">=", "<>", "<", ">", "="] {
        if let Some(rest) = text.strip_prefix(op) {
            return (op, rest);
        }
    }
    ("=", text)
}

fn compare(operator: &str, order: Ordering) -> bool {
    match operator {
        "<" => order.is_lt(),
        ">" => order.is_gt(),
        "<=" => !order.is_gt(),
        ">=" => !order.is_lt(),
        "<>" => !order.is_eq(),
        _ => order.is_eq(),
    }
}

// Calc's matrix database API exposes only strings through GetString; numeric
// headers and numeric criteria become empty strings, unlike worksheet cells.
fn text(value: &Value, matrix: bool) -> String {
    if matrix && !matches!(value, Value::Text(_) | Value::UninternedText(_)) {
        String::new()
    } else {
        value.text()
    }
}

// Excel preserves boolean header names; Calc's Value::text uses numeric booleans.
fn excel_text(value: &Value) -> String {
    match value {
        Value::Bool(true) => "TRUE".into(),
        Value::Bool(false) => "FALSE".into(),
        _ => value.text(),
    }
}

impl Calculation<'_> {
    pub(super) fn database(
        &mut self,
        name: &str,
        nodes: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let excel = self.dynamic.is_some();
        let invalid = if excel { "#VALUE!" } else { "Err:504" };
        if excel && nodes.len() != 3 {
            return Some(Value::Error("#ERROR!"));
        }
        let mut args = Vec::new();
        for node in nodes {
            let value = self.eval(node, pos, depth + 1, true)?;
            if let Value::Error(error) = value {
                return Some(Value::Error(error));
            }
            self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
            args.push(value);
        }
        if args.len() != 3 {
            return Some(Value::Error(invalid));
        }
        let criteria = args.pop()?;
        let field = args.pop()?;
        let database = args.pop()?;
        for value in [&criteria, &field, &database] {
            if let Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
                return Some(Value::Error("#REF!"));
            }
        }
        if !matches!(criteria, Value::Range(..) | Value::Matrix(_)) {
            return Some(Value::Error(invalid));
        }
        let counts = matches!(name, "DCOUNT" | "DCOUNTA");
        let mut missing = counts && matches!(field, Value::Blank);
        if counts && let Value::Range(..) = &field {
            if excel || field != database {
                return Some(Value::Error(invalid));
            }
            missing = true;
        }
        let referenced_field = matches!(field, Value::Single(_));
        let field = if referenced_field {
            self.scalar(field, pos, depth + 1)?
        } else {
            field
        };
        if let Value::Error(error) | Value::LiteralError(error) = field {
            return Some(Value::Error(error));
        }
        let numeric_field = match field {
            Value::Number(n) => Some(n),
            Value::Bool(b) => Some(f64::from(b)),
            Value::Blank if !referenced_field => Some(0.),
            _ => None,
        };
        if counts
            && !excel
            && !referenced_field
            && numeric_field.is_some_and(|n| rounding::approximate(n).floor() == 0.)
        {
            missing = true;
        }
        if !missing
            && numeric_field.is_none()
            && !matches!(
                field,
                Value::Text(_) | Value::UninternedText(_) | Value::Empty | Value::Blank
            )
        {
            return Some(Value::Error(invalid));
        }
        if !matches!(database, Value::Range(..) | Value::Matrix(_)) {
            return Some(Value::Error(invalid));
        }
        let matrix = matches!(database, Value::Matrix(_));
        let criteria_matrix = matches!(criteria, Value::Matrix(_));
        let origin = if let Value::Range(a, b) = database {
            Some((a.0.min(b.0), a.1.min(b.1), a.2.min(b.2)))
        } else {
            None
        };
        let data = self.matrix(database, depth + 1)?;
        let query = self.matrix(criteria, depth + 1)?;
        if excel && (data.len() < 2 || query.len() < 2) {
            return Some(Value::Error(invalid));
        }
        let header = data.first()?;
        let mut headers = Vec::new();
        for value in header {
            self.charge_value(value)?;
            self.work = self.work.checked_sub(std::mem::size_of::<String>())?;
            headers.push(collation::uppercase(
                if excel {
                    excel_text(value)
                } else {
                    text(value, matrix)
                }
                .trim(),
                &mut self.work,
            )?);
        }
        let mut field_index = if missing {
            0
        } else if let Some(n) = numeric_field {
            if excel && (n.floor() < 1. || n.floor() > header.len() as f64) {
                return Some(Value::Error(invalid));
            }
            // Calc stores field indexes in a signed 16-bit column number.
            let n = rounding::approximate(n).floor();
            if n < i32::MIN as f64 || n > i32::MAX as f64 {
                return Some(Value::Error(invalid));
            }
            let column = if excel {
                n as isize - 1
            } else {
                n as i32 as i16 as isize - 1
            };
            let absolute = column + origin.map_or(0, |c| c.2) as isize;
            if !(0..16384).contains(&absolute) {
                return Some(Value::Error(invalid));
            }
            column
        } else {
            let wanted = collation::uppercase(field.text().trim(), &mut self.work)?;
            let mut found = None;
            for (index, value) in headers.iter().enumerate() {
                self.tick(depth)?;
                if !excel && let Value::Error(error) | Value::LiteralError(error) = header[index] {
                    return Some(Value::Error(error));
                }
                if *value == wanted {
                    found = Some(index);
                    break;
                }
            }
            let Some(index) = found else {
                return Some(Value::Error(invalid));
            };
            index as isize
        };
        let mut conditions = Vec::new();
        let mut all_rows = false;
        // StarCalc criteria have connector, field, operator and value columns.
        // Native consumes as many criteria rows as there are database rows.
        let mut star = !excel && query.first()?.len() >= 4;
        if star {
            for r in 0..data.len() {
                self.tick(depth)?;
                let row = query.get(r);
                let connector = collation::uppercase(
                    text(
                        row.and_then(|r| r.first()).unwrap_or(&Value::Blank),
                        criteria_matrix,
                    )
                    .trim(),
                    &mut self.work,
                )?;
                if r != 0 && !matches!(connector.as_str(), "AND" | "OR") {
                    star = false;
                    break;
                }
                let wanted = collation::uppercase(
                    text(
                        row.and_then(|r| r.get(1)).unwrap_or(&Value::Blank),
                        criteria_matrix,
                    )
                    .trim(),
                    &mut self.work,
                )?;
                self.work = self.work.checked_sub(headers.len())?;
                let Some(field) = headers.iter().position(|h| *h == wanted) else {
                    star = false;
                    break;
                };
                let op = text(
                    row.and_then(|r| r.get(2)).unwrap_or(&Value::Blank),
                    criteria_matrix,
                );
                let op = operator(op.trim()).0;
                let value = text(
                    row.and_then(|r| r.get(3)).unwrap_or(&Value::Blank),
                    criteria_matrix,
                );
                conditions.push(self.database_condition(field, connector == "OR", op, value)?);
            }
        }
        if !star {
            conditions.clear();
            let mut fields = Vec::new();
            for value in query.first()? {
                let wanted = collation::uppercase(
                    if excel {
                        excel_text(value)
                    } else {
                        text(value, criteria_matrix)
                    }
                    .trim(),
                    &mut self.work,
                )?;
                self.work = self.work.checked_sub(headers.len())?;
                let index = match headers.iter().position(|h| *h == wanted) {
                    Some(index) => index,
                    None if excel => usize::MAX,
                    None => return Some(Value::Error(invalid)),
                };
                self.work = self.work.checked_sub(std::mem::size_of::<usize>())?;
                fields.push(index);
            }
            for row in query.iter().skip(1) {
                let mut first = true;
                for (value, &field) in row.iter().zip(&fields) {
                    self.tick(depth)?;
                    self.charge_value(value)?;
                    let text = collation::uppercase(
                        &if excel {
                            excel_text(value)
                        } else {
                            text(value, criteria_matrix)
                        },
                        &mut self.work,
                    )?;
                    if text.is_empty() {
                        continue;
                    }
                    let (operator, remainder) = operator(&text);
                    let mut condition =
                        self.database_condition(field, first, operator, remainder.into())?;
                    if excel {
                        condition.boolean = if let Value::Bool(b) = value {
                            Some(*b)
                        } else {
                            None
                        };
                        condition.prefix = condition.boolean.is_none()
                            && condition.number.is_none()
                            && matches!(value, Value::Text(_) | Value::UninternedText(_))
                            && remainder.len() == text.len()
                            && !text.contains(['*', '?', '~']);
                        if matches!(value, Value::Error(_) | Value::LiteralError(_)) {
                            condition.field = usize::MAX;
                        }
                    }
                    conditions.push(condition);
                    first = false;
                }
                if excel && first {
                    all_rows = true;
                    break;
                }
            }
        }
        if missing && !excel {
            field_index = conditions
                .first()
                .map_or(-(origin.map_or(0, |c| c.2) as isize), |c| c.field as isize);
        }
        if (field_index < 0 || field_index >= header.len() as isize)
            && (excel || matrix || !(name == "DGET" || name == "DCOUNT" && missing))
        {
            return Some(Value::Error("#VALUE!"));
        }
        let mut search = LookupSearch::Literal;
        if !matrix {
            for condition in &conditions {
                self.work = self.work.checked_sub(condition.text.len())?;
                let text = &condition.text;
                let detected = match self.book.lookup_search {
                    LookupSearch::Wildcard => text.contains(['*', '?', '~']),
                    LookupSearch::Regex => {
                        (text.encode_utf16().count() > 1 || text == ".")
                            && text.contains([
                                '?', '*', '+', '.', '[', ']', '^', '$', '\\', '<', '>', '(', ')',
                                '|',
                            ])
                    }
                    LookupSearch::Literal => false,
                };
                if condition.number.is_none() && detected {
                    search = self.book.lookup_search;
                }
            }
            if search == LookupSearch::Regex {
                for condition in &mut conditions {
                    if condition.number.is_none() {
                        condition.regex = ZeroRegex::office(&condition.text, true, &mut self.work)?;
                    }
                }
            }
        }
        let mut sum = Sum::default();
        let mut count = 0usize;
        let mut result = 0.;
        let mut first_value = None;
        let mut values = Vec::new();
        for (r, row) in data.iter().enumerate().skip(1) {
            self.tick(depth)?;
            let outside;
            let value = if let Some(value) = row.get(field_index as usize) {
                value
            } else {
                let (sheet, first_row, first_col) = origin?;
                outside = self.cell(
                    (
                        sheet,
                        first_row + r,
                        first_col.checked_add_signed(field_index)?,
                    ),
                    depth + 1,
                )?;
                &outside
            };
            if matches!(value, Value::Blank | Value::Empty)
                && !(excel && (name == "DGET" || missing))
            {
                continue;
            }
            let mut matched = all_rows || !matrix && conditions.is_empty();
            let mut group = true;
            for (i, condition) in conditions.iter().enumerate() {
                if condition.or && i != 0 {
                    matched |= group;
                    group = true;
                }
                group &= if let Some(value) = row.get(condition.field) {
                    self.database_match(value, condition, matrix, search, depth + 1)?
                } else {
                    false
                };
            }
            if !conditions.is_empty() {
                matched |= group;
            }
            if !matched {
                continue;
            }
            if let Value::Error(error) | Value::LiteralError(error) = value {
                if !excel && name == "DGET" {
                    return Some(if matrix {
                        Value::Error(error)
                    } else {
                        first_value.unwrap_or(Value::Error("#VALUE!"))
                    });
                }
                if !excel && !(name == "DCOUNT" && missing && !matrix) {
                    return Some(Value::Error(error));
                }
            }
            let numeric =
                matches!(value, Value::Number(_)) || !excel && matches!(value, Value::Bool(_));
            if !numeric
                && !matches!(name, "DCOUNTA" | "DGET")
                && !(name == "DCOUNT" && missing && !matrix)
            {
                continue;
            }
            count += 1;
            if name == "DGET" {
                if first_value.is_some() {
                    return Some(Value::Error(if excel { "#NUM!" } else { "Err:502" }));
                }
                self.charge_value(value)?;
                first_value = Some(match value {
                    Value::Blank | Value::Empty if excel => Value::Number(0.),
                    Value::Bool(b) if !excel => Value::Number(f64::from(*b)),
                    Value::UninternedText(text) => Value::Text(text.clone()),
                    _ => value.clone(),
                });
                continue;
            }
            if matches!(name, "DCOUNT" | "DCOUNTA") {
                continue;
            }
            let n = value.numeric()?;
            match name {
                "DSUM" | "DAVERAGE" => sum.add(n),
                "DPRODUCT" => result = if count == 1 { n } else { result * n },
                "DMIN" => result = if count == 1 { n } else { result.min(n) },
                "DMAX" => result = if count == 1 { n } else { result.max(n) },
                _ => {
                    self.work = self.work.checked_sub(std::mem::size_of::<f64>())?;
                    values.push(n);
                    sum.add(n);
                }
            }
        }
        Some(match name {
            "DCOUNT" | "DCOUNTA" => Value::Number(count as f64),
            "DGET" => first_value.unwrap_or(Value::Error("#VALUE!")),
            "DSUM" => Value::number(sum.total()),
            "DAVERAGE" if count == 0 => Value::Error("#DIV/0!"),
            "DAVERAGE" => Value::number(sum.total() / count as f64),
            "DPRODUCT" | "DMIN" | "DMAX" => Value::number(result),
            _ => {
                let population = matches!(name, "DSTDEVP" | "DVARP");
                if excel && count < if population { 1 } else { 2 } {
                    return Some(Value::Error("#DIV/0!"));
                }
                let mean = sum.total() / count as f64;
                let mut squares = Sum::default();
                for value in values {
                    self.tick(depth)?;
                    squares.add((value - mean) * (value - mean));
                }
                let variance = squares.total() / (count as f64 - if population { 0. } else { 1. });
                let result = if matches!(name, "DSTDEV" | "DSTDEVP") {
                    variance.sqrt()
                } else {
                    variance
                };
                if result.is_finite() {
                    Value::Number(result)
                } else {
                    Value::Error("#NUM!")
                }
            }
        })
    }

    fn database_condition(
        &mut self,
        field: usize,
        or: bool,
        operator: &'static str,
        text: String,
    ) -> Option<Condition> {
        self.work = self.work.checked_sub(std::mem::size_of::<Condition>())?;
        let text = collation::uppercase(&text, &mut self.work)?;
        let number = lookup::number::parse(&text, self.book.date1904);
        Some(Condition {
            field,
            or,
            operator,
            text,
            number,
            regex: None,
            boolean: None,
            prefix: false,
        })
    }

    fn database_match(
        &mut self,
        value: &Value,
        condition: &Condition,
        matrix: bool,
        search: LookupSearch,
        depth: usize,
    ) -> Option<bool> {
        self.tick(depth)?;
        if self.dynamic.is_some() {
            if let Some(boolean) = condition.boolean {
                return Some(matches!(value, Value::Bool(b) if *b == boolean));
            }
            if matches!(value, Value::Error(_) | Value::LiteralError(_)) {
                // Excel's database <> criteria include error-valued records;
                // the selected aggregate column still applies its own rules.
                return Some(condition.operator == "<>");
            }
            if let Some(number) = condition.number {
                return Some(if let Value::Number(n) = value {
                    let order = if approximately_equal(*n, number) {
                        Ordering::Equal
                    } else {
                        n.partial_cmp(&number)?
                    };
                    compare(condition.operator, order)
                } else {
                    condition.operator == "<>"
                });
            }
            if matches!(value, Value::Bool(_) | Value::Number(_)) {
                return Some(condition.operator == "<>");
            }
            self.charge_value(value)?;
            let text = excel_text(value);
            if matches!(condition.operator, "=" | "<>") {
                self.work = self.work.checked_sub(condition.text.len() + 1)?;
                let pattern = if condition.prefix {
                    format!("{}*", condition.text)
                } else {
                    condition.text.clone()
                };
                let equal = self.lookup_wildcard(&pattern, &text, true, depth + 1)?;
                return Some(if condition.operator == "<>" {
                    !equal
                } else {
                    equal
                });
            }
            return Some(compare(
                condition.operator,
                collation::compare(&text, &condition.text, false, &mut self.work)?,
            ));
        }
        if let Some(number) = condition.number
            && (matches!(value, Value::Number(_) | Value::Bool(_))
                || matrix && matches!(value, Value::Blank | Value::Empty))
        {
            let n = value.numeric()?;
            let order = if approximately_equal(n, number) {
                Ordering::Equal
            } else {
                n.partial_cmp(&number)?
            };
            return Some(compare(condition.operator, order));
        }
        let equality = matches!(condition.operator, "=" | "<>");
        if !equality
            && (condition.number.is_some()
                || !matches!(value, Value::Text(_) | Value::UninternedText(_))
                    && !(matrix && matches!(value, Value::Blank | Value::Empty)))
        {
            return Some(false);
        }
        self.charge_value(value)?;
        let text = text(value, matrix);
        let order = if equality {
            let matching = if matrix || condition.number.is_some() {
                LookupSearch::Literal
            } else {
                search
            };
            let whole = !self.book.lookup_substring;
            let equal = match matching {
                LookupSearch::Wildcard => {
                    self.lookup_wildcard(&condition.text, &text, whole, depth + 1)?
                }
                LookupSearch::Regex if condition.regex.is_some() => condition
                    .regex
                    .as_ref()?
                    .office_match(&text, whole, true, &mut self.work)?,
                LookupSearch::Regex => false,
                LookupSearch::Literal
                    if (whole || matrix) && matches!(value, Value::UninternedText(_)) =>
                {
                    false
                }
                LookupSearch::Literal => {
                    let text = collation::uppercase(&text, &mut self.work)?;
                    if whole || matrix {
                        text == condition.text
                    } else {
                        !condition.text.is_empty() && text.contains(&condition.text)
                    }
                }
            };
            if equal {
                Ordering::Equal
            } else {
                Ordering::Less
            }
        } else {
            collation::compare(&text, &condition.text, false, &mut self.work)?
        };
        Some(compare(condition.operator, order))
    }
}

#[cfg(test)]
mod tests {
    use super::super::calculate;
    use std::collections::BTreeSet;

    #[test]
    fn database_ranges_and_criteria_are_bounded() {
        for formula in [
            "=DSUM(A1:B65536,2,{\"Key\";\"a\"})",
            "=DCOUNT(A1:B2,2,D1:D65536)",
        ] {
            let rows = vec![
                vec!["Key".into(), "Value".into(), formula.into(), "Key".into()],
                vec!["a".into(), "1".into(), "".into(), "a".into()],
            ];
            for budget in [128, 4096] {
                assert!(
                    calculate(&rows, &BTreeSet::new(), "Sheet1", budget).is_none(),
                    "{formula}: {budget}"
                );
            }
            assert!(
                calculate(&rows, &BTreeSet::new(), "Sheet1", 8_000_000).is_some(),
                "{formula}"
            );
        }
    }
}
