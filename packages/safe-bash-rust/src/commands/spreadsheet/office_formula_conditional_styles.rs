// IronCalc f936620 conditional_formatting.rs (MIT, LICENSE.IronCalc): priority
// and inclusive comparisons. Evaluate only the caller's visible coordinates.
use super::{Calculation, Expr, Value, parse};
use crate::commands::spreadsheet::{
    ColorScaleThreshold, ConditionalAppearance, ConditionalIcon, ConditionalRule, ConditionalValue,
    DataBarAppearance, IconAppearance, Spreadsheet, ValueOperator, model,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

fn cell_value(value: Option<&model::Value<String>>) -> Value {
    match value {
        Some(model::Value::Number(n)) => Value::Number(*n),
        Some(model::Value::Bool(b)) => Value::Bool(*b),
        Some(model::Value::Text(s)) => Value::Text(s.clone()),
        Some(model::Value::Error(s)) => Value::Error(
            super::LITERAL_ERRORS
                .into_iter()
                .find(|e| s.eq_ignore_ascii_case(e))
                .unwrap_or("#VALUE!"),
        ),
        Some(model::Value::Empty) => Value::Empty,
        None => Value::Blank,
    }
}
fn key(value: &Value) -> Option<String> {
    match value {
        Value::Number(n) => Some(if *n == 0. { "0".into() } else { n.to_string() }),
        Value::Bool(b) => Some(b.to_string()),
        Value::Text(s) | Value::UninternedText(s) => Some(s.to_lowercase()),
        _ => None,
    }
}
fn merge(
    target: &mut ConditionalAppearance,
    rule: &crate::commands::spreadsheet::ConditionalFormat,
) {
    for (dest, source) in [
        (&mut target.style.attributes, &rule.style.attributes),
        (&mut target.style.font, &rule.style.font),
    ] {
        for (key, value) in source {
            if !dest.iter().any(|(k, _)| k == key) {
                dest.push((*key, value.clone()));
            }
        }
    }
    if target.style.family.is_empty() {
        target.style.family = rule.style.family.clone();
    }
    for (side, kind, color) in &rule.style.borders {
        if !target.style.borders.iter().any(|(s, _, _)| s == side) {
            target.style.borders.push((*side, *kind, color.clone()));
        }
    }
    if target.format.is_none() {
        target.format = rule.format.clone();
    }
}
fn formula(
    calc: &mut Calculation<'_>,
    source: &str,
    sheet: usize,
    anchor: (usize, usize),
    position: (usize, usize),
) -> Option<Value> {
    let (r, c) = position;
    let source = source.trim().strip_prefix('=').unwrap_or(source.trim());
    let source = Spreadsheet::translate_formula(
        source,
        calc.sheets,
        sheet,
        (r as i64 - anchor.0 as i64, c as i64 - anchor.1 as i64),
        &mut calc.work,
    )
    .ok()?;
    calc.work = calc.work.checked_sub(source.len() + 128)?;
    let expression = parse(
        &source,
        calc.sheets,
        calc.book,
        (sheet, r as i64, c as i64),
        Some(sheet),
        true,
        None,
        calc.work,
        true,
    )
    .ok()?;
    let Some(expression) = expression else {
        return Some(Value::Error("#VALUE!"));
    };
    let value = calc.eval(&expression, (sheet, r, c), 0, false)?;
    calc.scalar(value, (sheet, r, c), 0)
}

// IronCalc's positional colors and rounded RGB interpolation. Normalize only
// when subtraction would overflow; tiny nonzero spans must still interpolate.
fn scale_color(value: f64, stops: &[f64], thresholds: &[ColorScaleThreshold]) -> String {
    if value <= stops[0] {
        return thresholds[0].color.clone();
    }
    if value >= stops[stops.len() - 1] {
        return thresholds[stops.len() - 1].color.clone();
    }
    for (i, pair) in stops.windows(2).enumerate() {
        let [a, b] = [pair[0], pair[1]];
        if value < a || value > b {
            continue;
        }
        let span = b - a;
        let t = if span == 0. {
            0.
        } else if span.is_finite() {
            (value - a) / span
        } else {
            let scale = a.abs().max(b.abs());
            (value / scale - a / scale) / (b / scale - a / scale)
        };
        let mut color = String::with_capacity(8);
        for offset in (0..8).step_by(2) {
            let a = u8::from_str_radix(&thresholds[i].color[offset..offset + 2], 16).unwrap_or(0)
                as f64;
            let b = u8::from_str_radix(&thresholds[i + 1].color[offset..offset + 2], 16)
                .unwrap_or(0) as f64;
            use std::fmt::Write;
            write!(color, "{:02X}", (a + (b - a) * t).round() as u8).unwrap();
        }
        return color;
    }
    thresholds[0].color.clone()
}

// Clamp before subtracting, and normalize only when the finite endpoints'
// span overflows. This retains useful bars for both huge and subnormal inputs.
fn proportion(value: f64, min: f64, max: f64) -> f64 {
    if value <= min {
        return 0.;
    }
    if value >= max {
        return 1.;
    }
    let span = max - min;
    if span.is_finite() {
        (value - min) / span
    } else {
        let scale = min.abs().max(max.abs());
        (value / scale - min / scale) / (max / scale - min / scale)
    }
    .clamp(0., 1.)
}
// Compare relative thresholds without first rounding them to an absolute cell
// value. Percentiles only need ranks: every queried numeric cell is in numbers.
fn icon_matches(
    value: f64,
    stop: f64,
    threshold: &crate::commands::spreadsheet::IconThreshold,
    numbers: &[f64],
    (min, max): (f64, f64),
) -> bool {
    let equal = threshold.greater_equal;
    let (value, stop) = match threshold.value {
        ConditionalValue::Percent(_) if min == max || stop == 0. => (value, min),
        ConditionalValue::Percent(_) if stop == 100. => (value, max),
        ConditionalValue::Percent(_) => {
            let span = max - min;
            let percent = if span.is_finite() {
                super::regression::scaled(value - min, 100., span)
            } else {
                proportion(value, min, max) * 100.
            };
            (percent, stop)
        }
        ConditionalValue::Percentile(_) if numbers.len() == 1 => (value, numbers[0]),
        ConditionalValue::Percentile(_) => {
            let index = if equal {
                numbers.partition_point(|n| *n <= value) - 1
            } else {
                numbers.partition_point(|n| *n < value)
            };
            let rank = index as f64 / (numbers.len() - 1) as f64 * 100.;
            return if equal { stop <= rank } else { stop < rank };
        }
        _ => (value, stop),
    };
    value > stop || equal && value == stop
}

fn threshold_value(
    value: &ConditionalValue,
    numbers: &[f64],
    bounds: (f64, f64),
    calc: &mut Calculation<'_>,
    sheet: usize,
    anchor: (usize, usize),
) -> Option<f64> {
    calc.work = calc.work.checked_sub(64)?;
    let (min, max) = bounds;
    Some(match value {
        ConditionalValue::Min => min,
        ConditionalValue::Max => max,
        ConditionalValue::Number(n) => *n,
        ConditionalValue::Percent(p) => min * (1. - p / 100.) + max * (p / 100.),
        ConditionalValue::Percentile(p) => {
            match super::order_statistics::percentile(numbers, p / 100., false) {
                Value::Number(n) => n,
                _ => return None,
            }
        }
        ConditionalValue::Formula(source) => match formula(calc, source, sheet, anchor, anchor)? {
            Value::Number(n) if n.is_finite() => n,
            _ => 0.,
        },
    })
}

pub(in super::super) fn evaluate(
    book: &Spreadsheet,
    sheet: usize,
    cells: &[(usize, usize)],
    mut work: usize,
) -> Option<BTreeMap<(usize, usize), ConditionalAppearance>> {
    work = work.checked_sub(book.options.conditional_formats.len().checked_mul(16)?)?;
    let mut rules: Vec<_> = book
        .options
        .conditional_formats
        .iter()
        .filter(|r| r.sheet == sheet)
        .collect();
    if rules.is_empty() || cells.is_empty() {
        return Some(BTreeMap::new());
    }
    rules.sort_by_key(|r| r.priority);
    for s in &book.sheets {
        work = work.checked_sub(s.name.len() + 64)?;
    }
    let names: Vec<_> = book.sheets.iter().map(|s| s.name.clone()).collect();
    let mut calc = Calculation::new(
        &book.options,
        &names,
        vec![(1_048_576, 16_384); names.len()],
        work,
    );
    calc.now_ms = book.spills.calculated_at_ms;
    for (i, s) in book.sheets.iter().enumerate() {
        for (&(r, c), cell) in &s.cells {
            calc.work = calc.work.checked_sub(
                128 + match &cell.value {
                    Some(model::Value::Text(s)) => s.len(),
                    _ => 0,
                },
            )?;
            calc.values
                .insert((i, r, c), cell_value(cell.value.as_ref()));
            if let Some(source) = cell.formula_display.as_deref().or(cell.formula.as_deref()) {
                calc.formula_sources.insert((i, r, c), source);
            }
        }
    }
    for (&p, v) in &book.spills.values {
        calc.work = calc.work.checked_sub(
            128 + match v {
                model::Value::Text(s) => s.len(),
                _ => 0,
            },
        )?;
        calc.values.insert(p, cell_value(Some(v)));
    }
    for (i, name) in book.options.names.iter().enumerate() {
        let source = name.openformula.as_deref().unwrap_or(&name.expression);
        calc.work = calc.work.checked_sub(source.len() + 128)?;
        let expression = parse(
            source,
            &names,
            &book.options,
            name.position,
            name.sheet,
            false,
            Some(i),
            calc.work,
            true,
        )
        .ok()?;
        calc.names.push(Arc::new(
            expression.unwrap_or(Expr::Value(Value::Error("#NAME?"))),
        ));
    }
    calc.work = calc.work.checked_sub(cells.len().checked_mul(64)?)?;
    let coordinates: BTreeSet<_> = cells.iter().copied().collect();
    let mut result = BTreeMap::new();
    let mut stopped = BTreeSet::new();
    for rule in rules {
        let mut numbers = Vec::new();
        let mut counts = BTreeMap::new();
        let statistics = matches!(
            rule.rule,
            ConditionalRule::AboveAverage
                | ConditionalRule::BelowAverage
                | ConditionalRule::AboveOrEqualAverage
                | ConditionalRule::BelowOrEqualAverage
                | ConditionalRule::AverageDeviation { .. }
                | ConditionalRule::Top { .. }
                | ConditionalRule::ColorScale { .. }
                | ConditionalRule::DataBar(_)
                | ConditionalRule::IconSet(_)
        );
        let duplicates = matches!(
            rule.rule,
            ConditionalRule::DuplicateValues | ConditionalRule::UniqueValues
        );
        if statistics || duplicates {
            for (&(_, r, c), value) in calc
                .values
                .range((sheet, 0, 0)..=(sheet, usize::MAX, usize::MAX))
            {
                calc.work = calc.work.checked_sub(rule.ranges.len() + 1)?;
                if !rule
                    .ranges
                    .iter()
                    .any(|a| r >= a[0] && c >= a[1] && r <= a[2] && c <= a[3])
                {
                    continue;
                }
                if statistics {
                    if let Value::Number(n) = value {
                        calc.work = calc.work.checked_sub(16)?;
                        numbers.push(*n);
                    }
                } else {
                    calc.work = calc.work.checked_sub(
                        400 + match value {
                            Value::Text(s) | Value::UninternedText(s) => s.len().checked_mul(4)?,
                            _ => 0,
                        },
                    )?;
                    if let Some(key) = key(value) {
                        *counts.entry(key).or_insert(0usize) += 1;
                    }
                }
            }
        }
        let mut deviation_axis = None;
        let threshold = if numbers.is_empty()
            || matches!(
                rule.rule,
                ConditionalRule::ColorScale { .. }
                    | ConditionalRule::DataBar(_)
                    | ConditionalRule::IconSet(_)
            ) {
            None
        } else if let ConditionalRule::Top {
            rank,
            percent,
            bottom,
        } = &rule.rule
        {
            calc.work = calc.work.checked_sub(
                numbers
                    .len()
                    .checked_mul((numbers.len().ilog2() + 1) as usize)?,
            )?;
            numbers.sort_by(f64::total_cmp);
            let count = if *percent {
                ((*rank as f64 / 100.) * numbers.len() as f64).ceil() as usize
            } else {
                *rank
            }
            .max(1)
            .min(numbers.len());
            Some(
                numbers[if *bottom {
                    count - 1
                } else {
                    numbers.len() - count
                }],
            )
        } else if let ConditionalRule::AverageDeviation {
            above, deviations, ..
        } = &rule.rule
        {
            calc.work = calc
                .work
                .checked_sub(numbers.len().checked_mul(16)?.checked_add(128)?)?;
            // Compare in the existing centered/scaled coordinates. This retains
            // narrow differences near large values, subnormal values, and bounds
            // beyond f64's finite range without rounding the threshold back to a cell.
            let axis = super::regression::normalize(&mut numbers, 0, 1, true);
            let deviation = if numbers.len() > 1 {
                axis.norm / ((numbers.len() - 1) as f64).sqrt() * *deviations as f64
            } else {
                0.
            };
            let threshold = axis.mean + if *above { deviation } else { -deviation };
            deviation_axis = Some(axis);
            Some(threshold)
        } else {
            calc.work = calc.work.checked_sub(numbers.len().checked_mul(3)?)?;
            let scale = numbers.iter().fold(0f64, |s, n| s.max(n.abs()));
            Some(if scale == 0. {
                0.
            } else {
                super::regression::sum(numbers.iter().map(|n| n / scale)) / numbers.len() as f64
                    * scale
            })
        };
        let query = if let ConditionalRule::Text { value, .. } = &rule.rule {
            calc.work = calc.work.checked_sub(value.len().checked_mul(4)?)?;
            Some(value.to_lowercase())
        } else {
            None
        };
        let period = if let ConditionalRule::TimePeriod { period } = &rule.rule {
            super::clock::period_bounds(period, calc.now_ms, book.options.date1904)
        } else {
            None
        };
        let anchor = rule.anchor()?;
        let bounds = numbers
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), &n| {
                (min.min(n), max.max(n))
            });
        let stops = if numbers.is_empty() {
            None
        } else {
            let values: Vec<_> = match &rule.rule {
                ConditionalRule::ColorScale { thresholds } => {
                    thresholds.iter().map(|t| Some(&t.value)).collect()
                }
                ConditionalRule::DataBar(bar) => vec![bar.min.as_ref(), bar.max.as_ref()],
                ConditionalRule::IconSet(set) => {
                    set.thresholds.iter().map(|t| Some(&t.value)).collect()
                }
                _ => Vec::new(),
            };
            if values.is_empty() {
                None
            } else {
                calc.work = calc.work.checked_sub(numbers.len() + 256)?;
                if values
                    .iter()
                    .flatten()
                    .any(|v| matches!(v, ConditionalValue::Percentile(_)))
                {
                    calc.work = calc.work.checked_sub(
                        numbers
                            .len()
                            .checked_mul((numbers.len().ilog2() + 1) as usize)?,
                    )?;
                    numbers.sort_by(f64::total_cmp);
                }
                let mut stops = Vec::new();
                for (i, value) in values.iter().enumerate() {
                    let n = if let Some(value) = value {
                        match value {
                            ConditionalValue::Percent(p) | ConditionalValue::Percentile(p)
                                if matches!(rule.rule, ConditionalRule::IconSet(_)) =>
                            {
                                *p
                            }
                            _ => {
                                threshold_value(value, &numbers, bounds, &mut calc, sheet, anchor)?
                            }
                        }
                    } else if i == 0 {
                        bounds.0.min(0.)
                    } else {
                        bounds.1.max(0.)
                    };
                    stops.push(n);
                }
                // Excel/Univer correct reversed thresholds without reordering colors.
                if !matches!(rule.rule, ConditionalRule::IconSet(_)) {
                    stops.sort_by(f64::total_cmp);
                }
                Some(stops)
            }
        };
        for &(r, c) in &coordinates {
            calc.work = calc.work.checked_sub(rule.ranges.len() + 1)?;
            if stopped.contains(&(r, c))
                || !rule
                    .ranges
                    .iter()
                    .any(|a| r >= a[0] && c >= a[1] && r <= a[2] && c <= a[3])
            {
                continue;
            }
            let value = calc.values.get(&(sheet, r, c)).unwrap_or(&Value::Blank);
            calc.work = calc.work.checked_sub(match value {
                Value::Text(s) | Value::UninternedText(s) => s.len(),
                _ => 0,
            })?;
            let value = value.clone();
            if let ConditionalRule::IconSet(set) = &rule.rule {
                if let (Value::Number(n), Some(stops)) = (&value, &stops) {
                    calc.work = calc.work.checked_sub(512)?;
                    // IronCalc compute_icon_index: keep threshold order; the first
                    // icon is the fallback even below the first threshold.
                    let mut index = 0;
                    for (i, (&stop, threshold)) in
                        stops.iter().zip(&set.thresholds).enumerate().skip(1)
                    {
                        if icon_matches(*n, stop, threshold, &numbers, bounds) {
                            index = i;
                        }
                    }
                    if set.reverse {
                        index = stops.len() - 1 - index;
                    }
                    let icon = set
                        .custom
                        .get(index)
                        .cloned()
                        .unwrap_or_else(|| ConditionalIcon {
                            set: set.name.clone(),
                            index,
                        });
                    let appearance = result
                        .entry((r, c))
                        .or_insert_with(ConditionalAppearance::default);
                    if appearance.icon.is_none() {
                        appearance.icon = Some(IconAppearance {
                            icon,
                            show_value: set.show_value,
                        });
                    }
                }
                continue;
            }
            if let ConditionalRule::ColorScale { thresholds } = &rule.rule {
                if let (Value::Number(n), Some(stops)) = (&value, &stops) {
                    calc.work = calc.work.checked_sub(512)?;
                    let appearance = result
                        .entry((r, c))
                        .or_insert_with(ConditionalAppearance::default);
                    for (key, color) in [
                        ("Back", scale_color(*n, stops, thresholds)),
                        ("Shade", "1".into()),
                    ] {
                        if !appearance.style.attributes.iter().any(|(k, _)| *k == key) {
                            appearance.style.attributes.push((key, color));
                        }
                    }
                }
                continue;
            }
            if let ConditionalRule::DataBar(bar) = &rule.rule {
                if let (Value::Number(n), Some(stops)) = (&value, &stops) {
                    if stops[0] != stops[1] {
                        calc.work = calc.work.checked_sub(512)?;
                        let appearance = result
                            .entry((r, c))
                            .or_insert_with(ConditionalAppearance::default);
                        if appearance.data_bar.is_none() {
                            let (value, axis_position) = match bar.axis.as_str() {
                                "middle" => {
                                    let scale = stops[0].abs().max(stops[1].abs());
                                    (0.5 + n.clamp(stops[0], stops[1]) / scale * 0.5, 0.5)
                                }
                                "none" => (proportion(*n, stops[0], stops[1]), 0.),
                                _ => (
                                    proportion(*n, stops[0], stops[1]),
                                    proportion(0., stops[0], stops[1]),
                                ),
                            };
                            appearance.data_bar = Some(DataBarAppearance {
                                right_to_left: bar.direction == "rightToLeft"
                                    || (bar.direction == "context"
                                        && book.sheets[sheet]
                                            .view
                                            .iter()
                                            .any(|(name, value)| *name == "rightToLeft" && *value)),
                                axis_hidden: bar.axis == "none",
                                number: *n,
                                positive_color: bar.positive_color.clone(),
                                negative_color: bar
                                    .negative_color
                                    .as_ref()
                                    .unwrap_or(&bar.positive_color)
                                    .clone(),
                                border_color: bar.border_color.clone(),
                                negative_border_color: bar
                                    .negative_border_color
                                    .as_ref()
                                    .or(bar.border_color.as_ref())
                                    .cloned(),
                                axis_color: bar.axis_color.clone(),
                                is_gradient: bar.is_gradient,
                                show_value: bar.show_value,
                                min_length: bar.min_length,
                                max_length: bar.max_length,
                                value,
                                axis_position,
                            });
                        }
                    }
                }
                continue;
            }
            let mut evaluate = |source: &str| formula(&mut calc, source, sheet, anchor, (r, c));
            let matches = match &rule.rule {
                ConditionalRule::ColorScale { .. }
                | ConditionalRule::DataBar(_)
                | ConditionalRule::IconSet(_) => unreachable!(),
                ConditionalRule::TimePeriod { .. } => match (&value, period) {
                    (Value::Number(n), Some((start, end))) => {
                        n.is_finite() && *n >= start && *n < end
                    }
                    _ => false,
                },
                ConditionalRule::Formula(source) => match evaluate(source)? {
                    Value::Bool(b) => b,
                    Value::Number(n) => n != 0.,
                    _ => false,
                },
                ConditionalRule::Text { operator, .. } => {
                    if let Value::Text(text) | Value::UninternedText(text) = &value {
                        calc.work = calc.work.checked_sub(text.len().checked_mul(4)?)?;
                        let text = text.to_lowercase();
                        let query = query.as_deref()?;
                        use crate::commands::spreadsheet::TextOperator::*;
                        match operator {
                            Contains => text.contains(query),
                            DoesNotContain => !text.contains(query),
                            BeginsWith => text.starts_with(query),
                            EndsWith => text.ends_with(query),
                            Equals => text == query,
                        }
                    } else {
                        false
                    }
                }
                ConditionalRule::Blanks => matches!(value, Value::Blank | Value::Empty),
                ConditionalRule::NotBlanks => !matches!(value, Value::Blank | Value::Empty),
                ConditionalRule::Errors => {
                    matches!(value, Value::Error(_) | Value::LiteralError(_))
                }
                ConditionalRule::NoErrors => {
                    !matches!(value, Value::Error(_) | Value::LiteralError(_))
                }
                ConditionalRule::DuplicateValues | ConditionalRule::UniqueValues => {
                    calc.work = calc.work.checked_sub(
                        400 + match &value {
                            Value::Text(s) | Value::UninternedText(s) => s.len().checked_mul(4)?,
                            _ => 0,
                        },
                    )?;
                    key(&value).and_then(|k| counts.get(&k)).is_some_and(|&n| {
                        if matches!(rule.rule, ConditionalRule::UniqueValues) {
                            n == 1
                        } else {
                            n > 1
                        }
                    })
                }
                ConditionalRule::AboveAverage
                | ConditionalRule::BelowAverage
                | ConditionalRule::AboveOrEqualAverage
                | ConditionalRule::BelowOrEqualAverage
                | ConditionalRule::AverageDeviation { .. }
                | ConditionalRule::Top { .. } => {
                    if let (Value::Number(n), Some(threshold)) = (&value, threshold) {
                        match rule.rule {
                            ConditionalRule::AverageDeviation { above, equal, .. } => {
                                let value = deviation_axis?.delta(*n);
                                equal && value == threshold
                                    || if above {
                                        value > threshold
                                    } else {
                                        value < threshold
                                    }
                            }
                            ConditionalRule::AboveAverage => *n > threshold,
                            ConditionalRule::BelowAverage => *n < threshold,
                            ConditionalRule::AboveOrEqualAverage => *n >= threshold,
                            ConditionalRule::BelowOrEqualAverage => *n <= threshold,
                            ConditionalRule::Top { bottom: true, .. } => *n <= threshold,
                            _ => *n >= threshold,
                        }
                    } else {
                        false
                    }
                }
                ConditionalRule::CellIs {
                    operator,
                    formula,
                    formula2,
                } => {
                    if let Value::Number(n) = &value {
                        let n = *n;
                        let first = evaluate(formula)?;
                        let second = if let Some(source) = formula2 {
                            Some(evaluate(source)?)
                        } else {
                            None
                        };
                        if let Value::Number(a) = first {
                            use ValueOperator::*;
                            match operator {
                                Equal => n == a,
                                NotEqual => n != a,
                                GreaterThan => n > a,
                                GreaterThanOrEqual => n >= a,
                                LessThan => n < a,
                                LessThanOrEqual => n <= a,
                                Between | NotBetween => {
                                    if let Some(Value::Number(b)) = second {
                                        (n >= a && n <= b) == matches!(operator, Between)
                                    } else {
                                        false
                                    }
                                }
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                }
            };
            if matches {
                calc.work = calc.work.checked_sub(
                    rule.style.retained_bytes() + rule.format.as_ref().map_or(0, String::len) + 256,
                )?;
                merge(
                    result
                        .entry((r, c))
                        .or_insert_with(ConditionalAppearance::default),
                    rule,
                );
                if rule.stop_if_true {
                    stopped.insert((r, c));
                }
            }
        }
    }
    Some(result)
}
