// Working-date semantics adapted from IronCalc's functions/date_and_time.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// Count complete weeks and binary-search scheduling dates instead of walking
// every day. Holiday references stay sparse and duplicate dates count once.
use super::{Calculation, Coord, Expr, Value, lookup::number};
use crate::commands::coreutils::days_from_civil;
use std::collections::BTreeSet;

fn numeric(value: &Value, date: bool, date1904: bool) -> Result<f64, &'static str> {
    let number = match value {
        Value::Error(e) | Value::LiteralError(e) => return Err(e),
        Value::Bool(_) => return Err("#VALUE!"),
        Value::Text(text) | Value::UninternedText(text) if date => {
            if text.trim().eq_ignore_ascii_case("true") || text.trim().eq_ignore_ascii_case("false")
            {
                return Err("#VALUE!");
            }
            number::parse(text, date1904)
        }
        _ => value.numeric(),
    }
    .ok_or("#VALUE!")?;
    if number.is_finite() {
        Ok(number)
    } else {
        Err("#NUM!")
    }
}

fn serial(value: &Value, date1904: bool) -> Result<i64, &'static str> {
    let n = numeric(value, true, date1904)?.floor();
    let (minimum, maximum) = bounds(date1904);
    if n < minimum as f64 || n > maximum as f64 {
        Err("#NUM!")
    } else {
        Ok(n as i64)
    }
}

fn bounds(date1904: bool) -> (i64, i64) {
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 30)
    };
    // Preserve the signed-year range of the existing native calendar. Working
    // dates share Excel's upper bound, including the workbook's 1904 offset.
    (
        days_from_civil(-32767, 1, 1) - epoch,
        days_from_civil(9999, 12, 31) - epoch,
    )
}

fn weekday(day: i64, date1904: bool) -> usize {
    (day + 5 + if date1904 { 1462 } else { 0 }).rem_euclid(7) as usize
}

fn weekend(value: &Value) -> Result<[bool; 7], &'static str> {
    let mut mask = [false; 7];
    match value {
        Value::Error(e) | Value::LiteralError(e) => return Err(e),
        Value::Text(text) | Value::UninternedText(text) => {
            if text.len() != 7 || !text.bytes().all(|b| matches!(b, b'0' | b'1')) {
                return Err("#VALUE!");
            }
            for (i, byte) in text.bytes().enumerate() {
                mask[i] = byte == b'1';
            }
        }
        _ => {
            let code = value.numeric().ok_or("#VALUE!")?;
            if code.fract() != 0. || !((1. ..=7.).contains(&code) || (11. ..=17.).contains(&code)) {
                return Err("#NUM!");
            }
            let first = if code <= 7. {
                (code as usize + 4) % 7
            } else {
                (code as usize - 5) % 7
            };
            mask[first] = true;
            if code <= 7. {
                mask[(first + 1) % 7] = true;
            }
        }
    }
    Ok(mask)
}

fn count_days(
    from: i64,
    to: i64,
    mask: &[bool; 7],
    holidays: &[i64],
    date1904: bool,
    work: &mut usize,
) -> Option<i64> {
    if from > to {
        return Some(0);
    }
    // Each partition point is a binary search; charge it even when the interval
    // contains no holidays. Remaining weekday work is at most seven iterations.
    *work = work.checked_sub(8 + 2 * (holidays.len().checked_ilog2().unwrap_or(0) as usize + 1))?;
    let length = to - from + 1;
    let working_week = mask.iter().filter(|&&b| !b).count() as i64;
    let mut total = length / 7 * working_week;
    for offset in 0..length % 7 {
        total += i64::from(!mask[weekday(from + offset, date1904)]);
    }
    let first = holidays.partition_point(|&day| day < from);
    let end = holidays.partition_point(|&day| day <= to);
    Some(total - (end - first) as i64)
}

impl Calculation<'_> {
    pub(super) fn working_dates(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let international = name.ends_with(".INTL");
        let schedule = name.starts_with("WORKDAY");
        let optional = if international { 3 } else { 2 };
        if args.len() < 2 || args.len() > optional + 1 {
            return Some(Value::Error("#ERROR!"));
        }
        if args[..2]
            .iter()
            .any(|a| matches!(a, Expr::Value(Value::Blank)))
        {
            return Some(Value::Error("#N/A"));
        }
        let (mut height, mut width) = (1usize, 1usize);
        let mut matrices = Vec::new();
        for (index, arg) in args.iter().take(optional).enumerate() {
            let value = if index == 2 && matches!(arg, Expr::Value(Value::Blank)) {
                Value::Number(1.)
            } else {
                self.eval(arg, pos, depth + 1, true)?
            };
            let matrix = self.matrix(value, depth + 1)?;
            let h = matrix.len();
            let w = matrix.first()?.len();
            if (height != h && height != 1 && h != 1) || (width != w && width != 1 && w != 1) {
                return Some(Value::Error("#VALUE!"));
            }
            height = height.max(h);
            width = width.max(w);
            matrices.push(matrix);
        }
        if matrices.len() < 3 {
            matrices.push(vec![vec![Value::Number(1.)]]);
        }
        let mut holidays = BTreeSet::new();
        if let Some(arg) = args
            .get(optional)
            .filter(|a| !matches!(a, Expr::Value(Value::Blank)))
        {
            let mut pending = vec![self.eval(arg, pos, depth + 1, true)?];
            while let Some(mut value) = pending.pop() {
                self.tick(depth)?;
                match value {
                    Value::Single(c) => value = self.cell(c, depth + 1)?,
                    Value::Range(a, b) if a.0 == b.0 => {
                        self.read_spill_range(a, b)?;
                        let (a, b) = (
                            (a.0, a.1.min(b.1), a.2.min(b.2)),
                            (a.0, a.1.max(b.1), a.2.max(b.2)),
                        );
                        let mut cells = BTreeSet::new();
                        for &c in self
                            .values
                            .range(a..=b)
                            .map(|(c, _)| c)
                            .chain(self.expressions.range(a..=b).map(|(c, _)| c))
                        {
                            self.work = self.work.checked_sub(1)?;
                            if (a.2..=b.2).contains(&c.2) {
                                self.work = self.work.checked_sub(96)?;
                                cells.insert(c);
                            }
                        }
                        pending.extend(cells.into_iter().rev().map(Value::Single));
                        continue;
                    }
                    Value::Matrix(rows) => {
                        let length = rows
                            .iter()
                            .try_fold(0usize, |n, row| n.checked_add(row.len()))?;
                        self.work = self
                            .work
                            .checked_sub(length.checked_mul(std::mem::size_of::<Value>())?)?;
                        pending
                            .extend(rows.into_iter().rev().flat_map(|row| row.into_iter().rev()));
                        continue;
                    }
                    Value::InvalidReference | Value::InvalidRange(..) => {
                        return Some(Value::Error("#REF!"));
                    }
                    Value::Range(..) | Value::Set(_) => return Some(Value::Error("#VALUE!")),
                    _ => {}
                }
                if matches!(value, Value::Blank | Value::Empty) {
                    continue;
                }
                let day = match serial(&value, self.book.date1904) {
                    Ok(day) => day,
                    Err(e) => return Some(Value::Error(e)),
                };
                self.work = self.work.checked_sub(32)?;
                holidays.insert(day);
            }
        }
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut result = Vec::new();
        for row in 0..height {
            let mut line = Vec::new();
            for col in 0..width {
                let values = std::array::from_fn(|index| {
                    let matrix = &matrices[index];
                    let row = &matrix[if matrix.len() == 1 { 0 } else { row }];
                    &row[if row.len() == 1 { 0 } else { col }]
                });
                line.push(self.working_date_result(schedule, &values, &holidays, depth + 1)?);
            }
            result.push(line);
        }
        if height == 1 && width == 1 {
            Some(result.pop()?.pop()?)
        } else {
            Some(Value::Matrix(result))
        }
    }

    fn working_date_result(
        &mut self,
        schedule: bool,
        values: &[&Value; 3],
        holidays: &BTreeSet<i64>,
        depth: usize,
    ) -> Option<Value> {
        self.tick(depth)?;
        let date1904 = self.book.date1904;
        let start = match serial(values[0], date1904) {
            Ok(n) => n,
            Err(e) => return Some(Value::Error(e)),
        };
        let second = if schedule {
            numeric(values[1], false, date1904)
        } else {
            serial(values[1], date1904).map(|n| n as f64)
        };
        let second = match second {
            Ok(n) => n,
            Err(e) => return Some(Value::Error(e)),
        };
        let mask = match weekend(values[2]) {
            Ok(mask) => mask,
            Err(e) => return Some(Value::Error(e)),
        };
        if schedule && mask.iter().all(|&b| b) {
            return Some(Value::Error("#VALUE!"));
        }
        self.work = self
            .work
            .checked_sub(holidays.len().checked_mul(8 + std::mem::size_of::<i64>())?)?;
        let holidays: Vec<_> = holidays
            .iter()
            .copied()
            .filter(|&d| !mask[weekday(d, date1904)])
            .collect();
        if !schedule {
            let end = second as i64;
            let count = count_days(
                start.min(end),
                start.max(end),
                &mask,
                &holidays,
                date1904,
                &mut self.work,
            )?;
            return Some(Value::number(
                (if end < start { -count } else { count }) as f64,
            ));
        }
        let second = second.trunc();
        let (minimum, maximum) = bounds(date1904);
        let direction = if second < 0. { -1 } else { 1 };
        let distance = if direction > 0 {
            maximum - start
        } else {
            start - minimum
        };
        if second.abs() > distance as f64 {
            return Some(Value::Error("#NUM!"));
        }
        let days = second.abs() as i64;
        if days == 0 {
            return Some(Value::Number(start as f64));
        }
        let mut count = |distance: i64| {
            if direction > 0 {
                count_days(
                    start + 1,
                    start + distance,
                    &mask,
                    &holidays,
                    date1904,
                    &mut self.work,
                )
            } else {
                count_days(
                    start - distance,
                    start - 1,
                    &mask,
                    &holidays,
                    date1904,
                    &mut self.work,
                )
            }
        };
        if count(distance)? < days {
            return Some(Value::Error("#NUM!"));
        }
        let (mut low, mut high) = (1, distance);
        while low < high {
            let middle = low + (high - low) / 2;
            if count(middle)? < days {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        Some(Value::Number((start + direction * low) as f64))
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Workbook, calculate};
    use super::*;

    #[test]
    fn optimized_counts_match_a_daywise_oracle_for_every_weekend_mask() {
        for date1904 in [false, true] {
            for bits in 0..128 {
                let mask = std::array::from_fn(|i| bits & (1 << i) != 0);
                let holidays: Vec<_> = [-9, -2, 1, 5, 12]
                    .into_iter()
                    .filter(|&d| !mask[weekday(d, date1904)])
                    .collect();
                for from in -14..=14 {
                    for length in 0..=22 {
                        let to = from + length - 1;
                        let expected = (from..=to)
                            .filter(|&d| !mask[weekday(d, date1904)] && !holidays.contains(&d))
                            .count() as i64;
                        assert_eq!(
                            count_days(from, to, &mask, &holidays, date1904, &mut 64),
                            Some(expected),
                            "{date1904} {bits} {from}:{to}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn optimized_scheduling_matches_a_daywise_oracle_in_both_date_systems() {
        let sheets = vec!["Sheet1".to_owned()];
        let holidays = BTreeSet::from([-5, 0, 1, 8, 17]);
        for date1904 in [false, true] {
            let book = Workbook {
                date1904,
                ..Default::default()
            };
            for bits in 0..127 {
                let mask = std::array::from_fn::<_, 7, _>(|i| bits & (1 << i) != 0);
                let pattern: String = mask.iter().map(|&b| if b { '1' } else { '0' }).collect();
                for start in -7..=7 {
                    for days in [-15_i64, -7, -1, 0, 1, 7, 15] {
                        let mut expected = start;
                        let mut remaining = days.abs();
                        while remaining > 0 {
                            expected += days.signum();
                            if !mask[weekday(expected, date1904)] && !holidays.contains(&expected) {
                                remaining -= 1;
                            }
                        }
                        let mut calc =
                            Calculation::new(&book, &sheets, vec![(1_048_576, 16_384)], 1024);
                        let values = [
                            Value::Number(start as f64),
                            Value::Number(days as f64),
                            Value::Text(pattern.clone()),
                        ];
                        assert_eq!(
                            calc.working_date_result(
                                true,
                                &[&values[0], &values[1], &values[2]],
                                &holidays,
                                0
                            ),
                            Some(Value::Number(expected as f64)),
                            "{date1904} {bits} {start} {days}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn working_dates_bound_array_and_holiday_work_without_enumerating_empty_days() {
        let rows = vec![
            vec!["=NETWORKDAYS(0,2958465,B:B)".to_owned()],
            vec!["=WORKDAY(0,1000000,B:B)".to_owned()],
        ];
        let values = calculate(&rows, &BTreeSet::new(), "Sheet1", 4096).unwrap();
        assert_eq!(values[&(0, 0)].0, Value::Number(2_113_190.));
        assert_eq!(values[&(1, 0)].0, Value::Number(1_399_999.));
        for formula in [
            "=NETWORKDAYS(A1:A4096,100)",
            "=WORKDAY.INTL(44928,C1:C128,D1:EA1)",
        ] {
            let rows = vec![vec!["1".into(), formula.into()]];
            assert!(
                calculate(&rows, &BTreeSet::from([(0, 0)]), "Sheet1", 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::from([(0, 0)]), "Sheet1", 8_000_000).is_some(),
                "{formula}"
            );
        }
        let mut rows = vec![vec!["".to_owned(), "44928".into()]];
        rows.extend((0..32).map(|_| vec!["=WORKDAY(44928,3,B1:B32)".into(), "44929".into()]));
        let numeric = (0..rows.len()).map(|r| (r, 1)).collect();
        assert!(calculate(&rows, &numeric, "Sheet1", 4096).is_none());
        assert!(calculate(&rows, &numeric, "Sheet1", 1_000_000).is_some());
    }
}
