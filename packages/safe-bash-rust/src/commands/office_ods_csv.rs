use super::super::office::csv;
use super::{Element, LIMIT, Sheet, TypedCell, Value, attr, duration};

// ODS transcode exports stored values, including stale formula caches. Attribute
// order determines the first usable scalar independently of the declared type.
pub(super) fn cell(
    element: &Element,
    legacy: bool,
    date1904: bool,
    limit: usize,
) -> Result<TypedCell<String>, String> {
    let mut value = None;
    let mut value_format = None;
    for (name, text) in &element.attrs {
        let Some(name) = name.strip_prefix(if legacy { "table:" } else { "office:" }) else {
            continue;
        };
        value = match name {
            "value" => {
                let n = crate::commands::js_number(text, 0.);
                n.is_finite().then_some(Value::Number(n))
            }
            "boolean-value" => Some(Value::Bool(
                !text.eq_ignore_ascii_case("false") && text != "0",
            )),
            "string-value" => Some(Value::Text(text.clone())),
            "date-value" => date(text, date1904).map(Value::Number),
            "time-value" => duration(text).map(Value::Number),
            _ => None,
        };
        if value.is_some() {
            value_format = match name {
                "date-value" => Some(
                    if text
                        .split_once('T')
                        .is_some_and(|(_, time)| !time.is_empty())
                    {
                        "yyyy/mm/dd hh:mm:ss"
                    } else {
                        "yyyy/mm/dd"
                    }
                    .into(),
                ),
                "time-value" => Some("hh:mm:ss".into()),
                _ => None,
            };
            break;
        }
    }
    if value.is_none() {
        let text = paragraphs(element, legacy, limit)?;
        if legacy || attr(element, "office:value-type").is_some() {
            value = text.map(Value::Text);
        }
    }
    if attr(element, "table:formula").is_some_and(|source| {
        matches!(
            source,
            "=" | "of:="
                | "oooc:="
                | "{urn:oasis:names:tc:opendocument:xmlns:of:1.2}="
                | "{http://openoffice.org/2004/calc}="
        )
    }) {
        value = Some(Value::Error(
            paragraphs(element, legacy, limit)?.unwrap_or_else(|| "#VALUE!".into()),
        ));
    }
    Ok(TypedCell {
        value,
        formula: None,
        openformula: None,
        formula_display: None,
        format: None,
        value_format,
        style: None,
        rich_text: None,
    })
}

fn paragraphs(element: &Element, legacy: bool, limit: usize) -> Result<Option<String>, String> {
    use super::Node;
    let mut result: Option<String> = None;
    for paragraph in super::children(element, "text:p") {
        if let Some(text) = &mut result {
            text.push('\n');
        }
        let text = result.get_or_insert_with(String::new);
        let mut pending: Vec<_> = paragraph
            .children
            .iter()
            .rev()
            .map(|node| (node, "text:p"))
            .collect();
        while let Some((node, parent)) = pending.pop() {
            match node {
                Node::Text(value, _) | Node::Cdata(value) => text.push_str(value),
                Node::Element(element)
                    if super::text::inline_allowed(&element.tag, parent, legacy) =>
                {
                    match element.tag.as_str() {
                        "text:s" => {
                            let count = attr(element, "text:c")
                                .map_or(1., |v| crate::commands::js_number(v, 0.));
                            if !count.is_finite() || count.fract() != 0. || count < 0. {
                                return Err(format!("{}invalid repeat/span count", super::INVALID));
                            }
                            if count > limit.saturating_sub(text.len()) as f64 {
                                return Err(LIMIT.into());
                            }
                            text.extend(std::iter::repeat_n(' ', count as usize));
                        }
                        "text:tab" | "text:tab-stop" => text.push('\t'),
                        "text:line-break" => text.push('\n'),
                        "text:span" | "text:a" => pending.extend(
                            element
                                .children
                                .iter()
                                .rev()
                                .map(|node| (node, element.tag.as_str())),
                        ),
                        _ => {}
                    }
                }
                _ => {}
            }
            if text.len() > limit {
                return Err(LIMIT.into());
            }
        }
    }
    Ok(result)
}

fn date(source: &str, date1904: bool) -> Option<f64> {
    use crate::commands::coreutils::{civil_from_days, days_from_civil};
    let mut parts = source.split('T');
    let date: Vec<_> = parts
        .next()?
        .split('-')
        .map(|v| crate::commands::js_number(v, 0.))
        .collect();
    if date.len() != 3
        || date.iter().any(|n| !n.is_finite() || n.fract() != 0.)
        || !(0. ..=275760.).contains(&date[0])
        || !(1. ..=12.).contains(&date[1])
        || !(1. ..=31.).contains(&date[2])
    {
        return None;
    }
    let (year, month, day) = (date[0] as i64, date[1] as i64, date[2] as i64);
    let days = days_from_civil(year, month, day);
    if days > 100_000_000 || civil_from_days(days) != (year, month as u32, day as u32) {
        return None;
    }
    let serial = days
        + if date1904 {
            24107
        } else if days < -25508 {
            25568
        } else {
            25569
        };
    let mut fraction = 0.;
    if let Some(time) = parts.next() {
        let time: Vec<_> = time.split(':').collect();
        if time.len() >= 3 {
            let hour = crate::commands::js_number(time[0], 0.);
            let minute = crate::commands::js_number(time[1], 0.);
            let second = super::super::parse_float_prefix(time[2]);
            if hour.is_finite()
                && hour.fract() == 0.
                && minute.is_finite()
                && minute.fract() == 0.
                && second.is_finite()
            {
                fraction = (hour + minute / 60. + second / 3600.) / 24.;
            }
        }
    }
    Some(serial as f64 + fraction)
}

fn number(value: f64) -> String {
    if value == 0. {
        return "0".into();
    }
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    if !(-4..17).contains(&exponent) {
        format!(
            "{mantissa}E{}{absolute:02}",
            if exponent < 0 { "-" } else { "+" },
            absolute = exponent.abs()
        )
    } else {
        let decimals = mantissa.split_once('.').map_or(0, |(_, tail)| tail.len()) as i32;
        format!(
            "{value:.precision$}",
            precision = (decimals - exponent).max(0) as usize
        )
    }
}

pub(super) fn export(
    sheets: &[Sheet<String>],
    filter: Option<&str>,
    limit: usize,
) -> Result<Vec<csv::Output>, String> {
    let sheet = sheets.first().ok_or(LIMIT)?;
    let parts: Vec<_> = filter
        .and_then(|f| f.split_once(':'))
        .map_or("", |(_, options)| options)
        .split(',')
        .collect();
    let separator = csv::character(parts.first().copied(), 44);
    let quote = csv::character(parts.get(1).copied(), 34);
    let quote_all = parts.get(6) == Some(&"true");
    let (mut end_row, mut end_column) = (0, 0);
    for (&(row, column), cell) in &sheet.cells {
        if cell
            .value
            .as_ref()
            .is_some_and(|v| !matches!(v, Value::Empty))
        {
            end_row = end_row.max(row);
            end_column = end_column.max(column);
        }
    }
    let mut units = Vec::new();
    let mut append = |unit| {
        if units.len() == limit {
            return Err(LIMIT.to_string());
        }
        units.push(unit);
        Ok(())
    };
    for row in 0..=end_row {
        for column in 0..=end_column {
            if column != 0 {
                append(separator)?;
            }
            let text = match sheet
                .cells
                .get(&(row, column))
                .and_then(|cell| cell.value.as_ref())
            {
                Some(Value::Number(n)) => number(*n),
                Some(Value::Bool(true)) => "TRUE".into(),
                Some(Value::Bool(false)) => "FALSE".into(),
                Some(Value::Text(s) | Value::Error(s)) => s.clone(),
                _ => String::new(),
            };
            // The spreadsheet exporter retains its original quote triggers even
            // when separator and quote characters are customized.
            let quoted = quote_all || text.contains([',', ' ', '\t', '\n', '"']);
            if quoted {
                append(quote)?;
            }
            for character in text.chars() {
                if quoted && character as u32 == u32::from(quote) {
                    append(quote)?;
                }
                let mut buffer = [0; 2];
                for &unit in character.encode_utf16(&mut buffer).iter() {
                    append(unit)?;
                }
            }
            if quoted {
                append(quote)?;
            }
        }
        append(10)?;
    }
    let bytes = String::from_utf16_lossy(&units).into_bytes();
    if bytes.len() > limit {
        return Err(LIMIT.into());
    }
    Ok(vec![csv::Output { sheet: None, bytes }])
}
