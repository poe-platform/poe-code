use super::{dates, number_format};
#[cfg(test)]
use crate::commands::spreadsheet::model::Sheet;
use crate::commands::spreadsheet::model::{TypedCell, Value};
#[cfg(test)]
use std::collections::BTreeMap;

#[cfg(test)]
#[path = "office_csv_references.rs"]
mod references;
#[cfg(test)]
pub(super) use references::{FormulaMode, formula as reference_text};

#[cfg(test)]
const LIMIT: &str = "document exceeds byte limit";

#[cfg(test)]
#[path = "office_csv_encoding.rs"]
pub(in crate::commands) mod encoding;
#[cfg(test)]
use encoding::Encoding;
#[cfg(test)]
pub(super) use encoding::text_from_units;

#[cfg(test)]
pub(in crate::commands) struct Csv {
    separator: Option<u16>,
    quote: Option<u16>,
    quote_text: bool,
    number_as_text: bool,
    shown: bool,
    formulas: bool,
    pub(in crate::commands) output: Vec<u8>,
    encoding: Encoding,
    limit: usize,
}

#[cfg(test)]
impl Csv {
    pub(in crate::commands) fn new(
        filter: Option<&str>,
        limit: usize,
    ) -> Result<Self, &'static str> {
        let mut csv = Self {
            separator: Some(44),
            quote: Some(34),
            quote_text: false,
            number_as_text: false,
            shown: false,
            formulas: false,
            output: Vec::new(),
            encoding: Encoding::Utf8,
            limit,
        };
        let options = filter
            .and_then(|f| f.split_once(':'))
            .map_or("", |(_, options)| options);
        if !options.is_empty() {
            let filter = options;
            let parts: Vec<_> = filter.split(',').take(14).collect();
            csv.shown = true;
            csv.separator = None;
            csv.quote = None;
            csv.encoding = Encoding::Utf16LowByte;
            if parts.len() >= 3 {
                csv.encoding = Encoding::parse(parts[2])?;
                let character = |s: &str| {
                    let s = s.trim_start();
                    let end = s
                        .char_indices()
                        .skip(usize::from(s.starts_with(['+', '-'])))
                        .find(|(_, c)| !c.is_ascii_digit())
                        .map_or(s.len(), |(i, _)| i);
                    let n = s[..end].parse::<i32>().unwrap_or(0);
                    (n != 0).then_some(n as u16)
                };
                csv.separator = [44, 9, 59, 32]
                    .into_iter()
                    .find(|c| parts[0].split('/').any(|s| character(s) == Some(*c)))
                    .or_else(|| parts[0].split('/').find_map(character))
                    .filter(|n| *n != 0);
                csv.quote = character(parts[1]).filter(|n| *n != 0);
                if parts.len() == 4 {
                    csv.shown = parts[3].parse::<i32>().unwrap_or(0) != 0;
                    csv.quote_text = true;
                } else {
                    csv.quote_text = parts.get(6) == Some(&"true");
                    csv.number_as_text = parts.get(7).is_some_and(|s| *s != "true");
                    csv.shown = parts.get(8).is_none_or(|s| *s == "true");
                    csv.formulas = parts.get(9) == Some(&"true");
                    if parts.get(13) == Some(&"true") && matches!(csv.encoding, Encoding::Utf8) {
                        csv.output.extend_from_slice(b"\xef\xbb\xbf");
                    }
                }
            }
        }
        if matches!(csv.encoding, Encoding::Utf16) {
            csv.output.extend_from_slice(b"\xff\xfe");
        }
        Ok(csv)
    }

    pub(in crate::commands) fn field(
        &mut self,
        text: impl Iterator<Item = u16> + Clone,
        is_text: bool,
        first: bool,
    ) -> Option<()> {
        let nonempty = text.clone().next().is_some();
        let force = !is_text && !self.shown && self.number_as_text && nonempty;
        let string_cell = is_text
            || force
            || self.quote.is_some_and(|q| {
                nonempty
                    && (text.clone().next() == Some(32)
                        || text.clone().last() == Some(32)
                        || text.clone().any(|c| c == q || Some(c) == self.separator))
            });
        let utf7 = matches!(self.encoding, Encoding::Utf7);
        let (mut text, utf7_quoted) = if utf7 {
            // Native UTF-7 round-trips UTF-16 units exactly. Escape those units
            // before shifting, including lone surrogates introduced by quotes.
            let eligible = self.quote.is_some() && string_cell;
            let quoted = eligible
                && (self.quote_text
                    || force
                    || text.clone().any(|unit| {
                        Some(unit) == self.quote
                            || unit == self.separator.unwrap_or(0)
                            || matches!(unit, 10 | 13)
                    }));
            let units = text.clone().flat_map(|unit| {
                std::iter::once(unit).chain((eligible && Some(unit) == self.quote).then_some(unit))
            });
            (encoding::utf7::encode(units, self.limit)?, quoted)
        } else {
            // Stateful round trips can shrink before quoting. Bound their
            // initial temporary by source bytes; enforce the final output limit
            // after normalization (including charset changes and escape collapse).
            let limit = if string_cell && self.quote.is_some() {
                match self.encoding {
                    Encoding::Iso2022Kr | Encoding::Iso2022Cn => {
                        let bytes = char::decode_utf16(text.clone())
                            .try_fold(0usize, |n, c| n.checked_add(c.map_or(3, char::len_utf8)))?;
                        if matches!(self.encoding, Encoding::Iso2022Kr) {
                            bytes.saturating_mul(2).saturating_add(4)
                        } else {
                            bytes.saturating_mul(4)
                        }
                    }
                    _ => self.limit,
                }
            } else {
                self.limit
            };
            // Native stream writes skip empty text, even when the charset's
            // standalone encoder would emit a header for an empty buffer.
            (
                if !nonempty {
                    Vec::new()
                } else {
                    self.encoding.encode_units(text.clone(), limit)?
                },
                false,
            )
        };
        // Single-unit delimiters are bounded temporaries. Charge them only
        // when emitted, so an unused quote cannot reject a smaller output.
        let separator = self
            .encoding
            .encode_unit(self.separator.unwrap_or(0), usize::MAX)?;
        let quote = self.quote.map_or_else(
            || Some(Vec::new()),
            |c| self.encoding.encode_unit(c, usize::MAX),
        )?;
        let unit = if matches!(self.encoding, Encoding::Utf16) {
            2
        } else {
            1
        };
        // Java UTF-8 round-trips every UTF-16 unit exactly. Its prefix-free unit
        // encodings make byte escaping equivalent to native UTF-16 escaping.
        let unicode_quoting = matches!(
            self.encoding,
            Encoding::Multibyte(_, Some(_), _)
                | Encoding::Gb18030
                | Encoding::Iso2022Cn
                | Encoding::Iso2022Jp
                | Encoding::Iso2022Kr
        );
        let (quoted, escapes) = if utf7 {
            (utf7_quoted, 0)
        } else if unicode_quoting {
            if self.quote.is_some() && string_cell {
                // A decoded byte can occupy three UTF-8 bytes. Escaping can
                // double that intermediate text; the final encoder still
                // enforces the output byte limit.
                let decoded_limit = self.limit.saturating_mul(3);
                let decoded = self.encoding.decode(&text, decoded_limit)?;
                let quote = self.encoding.decode(&quote, decoded_limit)?;
                let separator = self.encoding.decode(&separator, decoded_limit)?;
                let quoted = self.quote_text
                    || force
                    || !quote.is_empty() && decoded.contains(&quote)
                    || !separator.is_empty() && decoded.contains(&separator)
                    || decoded.contains(['\r', '\n']);
                let count = if quote.is_empty() {
                    0
                } else {
                    decoded.matches(&quote).count()
                };
                if decoded.len().checked_add(quote.len().checked_mul(count)?)?
                    > decoded_limit.saturating_mul(2)
                {
                    return None;
                }
                let escaped = if count == 0 {
                    decoded
                } else {
                    decoded.replace(&quote, &format!("{quote}{quote}"))
                };
                text = if escaped.is_empty() {
                    Vec::new()
                } else {
                    self.encoding.encode(&escaped, self.limit)?
                };
                (quoted, 0)
            } else {
                (false, 0)
            }
        } else {
            let count = |needle: &[u8]| {
                if needle.is_empty() {
                    0
                } else {
                    text.windows(needle.len())
                        .step_by(unit)
                        .filter(|s| *s == needle)
                        .count()
                }
            };
            let escapes = count(&quote);
            let quoted = !quote.is_empty()
                && string_cell
                && (force
                    || self.quote_text
                    || escapes != 0
                    || count(&separator) != 0
                    || count(&b"\r\0"[..unit]) != 0
                    || count(&b"\n\0"[..unit]) != 0);
            (quoted, escapes)
        };
        let separator = if first || self.separator.is_none() {
            &[][..]
        } else {
            separator.as_slice()
        };
        let quote = if quoted { quote.as_slice() } else { &[][..] };
        let size = text
            .len()
            .checked_add(separator.len())?
            .checked_add(quote.len().checked_mul(escapes.checked_add(2)?)?)?;
        if self.output.len().checked_add(size)? > self.limit {
            return None;
        }
        self.output.try_reserve(size).ok()?;
        self.output.extend_from_slice(separator);
        self.output.extend_from_slice(quote);
        if unicode_quoting || utf7 {
            self.output.extend_from_slice(&text);
        } else {
            let mut pos = 0;
            while pos < text.len() {
                if !quote.is_empty() && text[pos..].starts_with(quote) {
                    self.output.extend_from_slice(quote);
                    self.output.extend_from_slice(quote);
                    pos += quote.len();
                } else {
                    self.output.extend_from_slice(&text[pos..pos + unit]);
                    pos += unit;
                }
            }
        }
        self.output.extend_from_slice(quote);
        Some(())
    }

    pub(in crate::commands) fn empty_fields(&mut self, count: usize, first: bool) -> Option<()> {
        if count == 0 {
            return Some(());
        }
        // Missing cells emit separators, not encoded empty strings.
        let pattern = self.separator.map_or_else(
            || Some(Vec::new()),
            |unit| self.encoding.encode_unit(unit, usize::MAX),
        )?;
        let skip = if first { pattern.len() } else { 0 };
        let size = pattern
            .len()
            .checked_mul(count - 1)?
            .checked_add(pattern.len() - skip)?;
        if self.output.len().checked_add(size)? > self.limit {
            return None;
        }
        self.output.try_reserve(size).ok()?;
        self.output.extend_from_slice(&pattern[skip..]);
        // Disabled separators and quotes permit arbitrarily wide empty gaps.
        if !pattern.is_empty() {
            for _ in 1..count {
                self.output.extend_from_slice(&pattern);
            }
        }
        Some(())
    }

    pub(in crate::commands) fn row(&mut self) -> Option<()> {
        let newline = if matches!(self.encoding, Encoding::Utf16) {
            &b"\n\0"[..]
        } else {
            &b"\n"[..]
        };
        if self.output.len().checked_add(newline.len())? > self.limit {
            return None;
        }
        self.output.extend_from_slice(newline);
        Some(())
    }
}

pub(in crate::commands) fn cell_text(
    cell: &TypedCell<String>,
    raw: Option<&(String, bool)>,
    date1904: bool,
    mode: number_format::Mode,
    work: &mut usize,
) -> Option<(String, bool)> {
    let shown = mode != number_format::Mode::Edit;
    let (mut text, mut numeric) = raw.cloned().unwrap_or_else(|| match &cell.value {
        Some(Value::Number(n)) => (dates::display_number(*n), true),
        Some(Value::Bool(b)) if cell.value_format.as_deref() == Some("General") => {
            (u8::from(*b).to_string(), true)
        }
        Some(Value::Bool(b)) => (if *b { "TRUE" } else { "FALSE" }.into(), false),
        Some(Value::Text(s) | Value::Error(s)) => (s.clone(), false),
        _ => (String::new(), false),
    });
    let pattern = cell
        .format
        .as_deref()
        .filter(|f| cell.formula.is_none() && *f != "General")
        .or(cell.value_format.as_deref())
        .or(cell.format.as_deref())
        .unwrap_or("General");
    if let Some(Value::Bool(b)) = cell.value
        && !pattern.eq_ignore_ascii_case("General")
    {
        text = u8::from(b).to_string();
        numeric = true;
    }
    if numeric {
        let source = text.trim_matches([' ', '\t']);
        let body = source.strip_prefix(['+', '-']).unwrap_or(source);
        let n = if source.starts_with("NaN") {
            f64::NAN
        } else if body.starts_with("INF") {
            if source.starts_with('-') {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            }
        } else if body.starts_with(|c: char| c.is_ascii_alphabetic()) {
            0.
        } else {
            source.parse::<f64>().unwrap_or(0.)
        };
        text = number_format::text(n, pattern, date1904, mode, work)?;
    }
    if shown
        && matches!(cell.value, Some(Value::Text(_)))
        && !pattern.eq_ignore_ascii_case("General")
    {
        *work = work.checked_sub(pattern.len().checked_mul(32)?.checked_add(512)?)?;
        if let Ok(sections) = dates::sections(pattern, true)
            && let Some(section) = sections.get(3).or_else(|| sections.first())
        {
            let tokens = dates::tokens(&section.pattern, work).ok()?;
            if sections.len() > 3 || tokens.iter().any(|t| !t.escaped && t.text == "@") {
                let mut formatted = String::new();
                for token in tokens {
                    let part = if !token.escaped && token.text == "@" {
                        text.as_str()
                    } else {
                        token.text
                    };
                    *work = work.checked_sub(part.len())?;
                    formatted.push_str(part);
                }
                text = formatted;
            }
        }
    }
    let is_text = matches!(cell.value, Some(Value::Text(_) | Value::Error(_)))
        || shown && numeric && pattern == "@";
    Some((text, is_text))
}

#[cfg(test)]
pub(in crate::commands) fn spreadsheet(
    sheet: &Sheet<String>,
    filter: Option<&str>,
    date1904: bool,
    raw: &BTreeMap<(usize, usize), (String, bool)>,
    limit: usize,
    work: &mut usize,
) -> Result<Vec<u8>, &'static str> {
    let mut csv = Csv::new(filter, limit)?;
    let mut height = 1;
    let mut width = 1;
    for (&(r, c), cell) in &sheet.cells {
        if cell.value.is_some() || csv.formulas && cell.formula.is_some() {
            height = height.max(r + 1);
            width = width.max(c + 1);
        }
    }
    for group in &sheet.arrays {
        height = height.max(group.range[0] + group.range[3]);
        width = width.max(group.range[1] + group.range[2]);
    }
    if height.checked_mul(width).is_none_or(|n| n > limit) {
        return Err(LIMIT);
    }
    for row in 0..height {
        for col in 0..width {
            if csv.formulas {
                *work = work.checked_sub(sheet.arrays.len()).ok_or(LIMIT)?;
                if let Some(group) = sheet.arrays.iter().find(|group| {
                    let [r, c, w, h] = group.range;
                    (r..r + h).contains(&row)
                        && (c..c + w).contains(&col)
                        && ((row, col) == (r, c)
                            || sheet.cells.get(&(row, col)).is_none_or(|cell| {
                                cell.formula.is_none()
                                    || group
                                        .openformula
                                        .as_deref()
                                        .is_some_and(|s| s.starts_with("msoxl:="))
                                        && cell.openformula.is_none()
                            }))
                }) {
                    let formula = formula_text(
                        &group.expression,
                        group.openformula.as_deref(),
                        group.formula_display.as_deref(),
                        work,
                    )
                    .ok_or(LIMIT)?;
                    *work = work.checked_sub(formula.len() + 2).ok_or(LIMIT)?;
                    csv.field(format!("{{{formula}}}").encode_utf16(), true, col == 0)
                        .ok_or(LIMIT)?;
                    continue;
                }
            }
            let Some(cell) = sheet.cells.get(&(row, col)) else {
                csv.empty_fields(1, col == 0).ok_or(LIMIT)?;
                continue;
            };
            let (text, is_text) = if csv.formulas
                && let Some(formula) = &cell.formula
            {
                (
                    formula_text(
                        formula,
                        cell.openformula.as_deref(),
                        cell.formula_display.as_deref(),
                        work,
                    )
                    .ok_or(LIMIT)?,
                    true,
                )
            } else {
                cell_text(
                    cell,
                    raw.get(&(row, col)),
                    date1904,
                    if csv.shown {
                        number_format::Mode::Display
                    } else {
                        number_format::Mode::Edit
                    },
                    work,
                )
                .ok_or(LIMIT)?
            };
            csv.field(text.encode_utf16(), is_text, col == 0)
                .ok_or(LIMIT)?;
        }
        csv.row().ok_or(LIMIT)?;
    }
    Ok(csv.output)
}

#[cfg(test)]
pub(super) fn formula_numbers(source: &str, work: &mut usize) -> Option<String> {
    *work = work.checked_sub(source.len())?;
    let mut output = String::new();
    let mut append = |token: &str| -> Option<()> {
        let trimmed = token.trim();
        let number = trimmed.parse::<f64>().ok().filter(|n| {
            n.is_finite()
                && !n.is_subnormal()
                && (*n != 0.
                    || !trimmed
                        .split(['e', 'E'])
                        .next()
                        .unwrap_or("")
                        .bytes()
                        .any(|b| (b'1'..=b'9').contains(&b)))
        });
        let text = number.map(|n| number_format::number(n, true));
        let before = &token[..token.len() - token.trim_start().len()];
        let after = &token[token.trim_end().len()..];
        if let Some(text) = text {
            *work = work.checked_sub(before.len() + text.len() + after.len())?;
            output.push_str(before);
            output.push_str(&text);
            output.push_str(after);
        } else {
            *work = work.checked_sub(token.len())?;
            output.push_str(token);
        }
        Some(())
    };
    let mut quote = None;
    let mut start = 0;
    for (i, c) in source.char_indices() {
        if quote == Some(c) {
            quote = None;
        } else if quote.is_none() {
            if matches!(c, '\'' | '"') {
                quote = Some(c);
            } else if matches!(
                c,
                '+' | '-'
                    | '*'
                    | '/'
                    | '^'
                    | '&'
                    | '('
                    | ')'
                    | ','
                    | ';'
                    | ':'
                    | '='
                    | '<'
                    | '>'
                    | '{'
                    | '}'
            ) {
                if matches!(c, '+' | '-')
                    && source[start..i]
                        .strip_suffix(['e', 'E'])
                        .is_some_and(|s| s.trim().parse::<f64>().is_ok())
                {
                    continue;
                }
                append(&source[start..i])?;
                append(&source[i..i + c.len_utf8()])?;
                start = i + c.len_utf8();
            }
        }
    }
    append(&source[start..])?;
    Some(output)
}

#[cfg(test)]
pub(in crate::commands) fn formula_text(
    source: &str,
    openformula: Option<&str>,
    display: Option<&str>,
    work: &mut usize,
) -> Option<String> {
    if let Some(display) = display {
        *work = work.checked_sub(display.len().checked_add(1)?)?;
        return Some(format!("={display}"));
    }
    if let Some(original) = openformula.filter(|s| s.starts_with("of:=")) {
        let parsed =
            crate::commands::spreadsheet::ods_formula::convert(original, false, *work, true)
                .ok()??;
        *work = work.checked_sub(
            original
                .len()
                .checked_mul(4)?
                .checked_add(parsed.excel.len())?,
        )?;
        if parsed.excel == source
            && let Some(display) = parsed.display
        {
            *work = work.checked_sub(display.len().checked_add(1)?)?;
            return Some(format!("={display}"));
        }
    }
    if source.is_empty() && openformula == Some("Err:520") {
        *work = work.checked_sub(7)?;
        return Some("Err:520".into());
    }
    // XLSX compiler failures retain an internal error instead of source code.
    let imported = openformula.is_some_and(|s| s.starts_with("msoxl:=") || s.starts_with("Err:"));
    *work = work.checked_sub(source.len().checked_mul(3)?.checked_add(4)?)?;
    // XLSX import has already normalized numeric tokens. Re-tokenizing here
    // would change text inside a terminal bad token such as #_X+1.200.
    let source = if imported {
        std::borrow::Cow::Borrowed(source)
    } else {
        std::borrow::Cow::Owned(formula_numbers(source, work)?)
    };
    let source = source.strip_prefix('=').unwrap_or(&source);
    if source.eq_ignore_ascii_case("TRUE") || source.eq_ignore_ascii_case("FALSE") {
        return Some(format!("={}()", source.to_ascii_uppercase()));
    }
    let mut text = String::from("=");
    let mut quoted = None;
    let mut brackets = 0usize;
    let mut token = 0;
    for (i, c) in source.char_indices() {
        if quoted == Some(c) {
            quoted = None;
        } else if quoted.is_some() {
            continue;
        } else if matches!(c, '\'' | '"') {
            quoted = Some(c);
        } else if c == '[' {
            brackets += 1;
        } else if c == ']' {
            brackets = brackets.saturating_sub(1);
        } else if !imported
            && brackets == 0
            && c == '!'
            && !["#REF", "#DIV/0", "#VALUE", "#NUM", "#NULL"]
                .iter()
                .any(|error| source[..i].ends_with(error))
        {
            let tail = &source[i + 1..];
            let end = tail
                .char_indices()
                .find(|(_, c)| !c.is_alphanumeric() && !matches!(c, '$' | '#' | '!'))
                .map_or(tail.len(), |(i, _)| i);
            let address = &tail[..end];
            let axis = address.strip_prefix('$').unwrap_or(address);
            let whole = tail[end..].starts_with(':')
                && !axis.is_empty()
                && (axis.bytes().all(|b| b.is_ascii_digit())
                    || axis.bytes().all(|b| b.is_ascii_alphabetic()));
            if super::coordinate(address).is_none() && !address.contains("#REF!") && !whole {
                continue;
            }
            let name = &source[token..i];
            if !name.starts_with('$') {
                text.push('$');
            }
            text.push_str(name);
            text.push('.');
            token = i + 1;
        } else if c == '(' {
            let raw = &source[token..i];
            let name = raw.trim();
            let upper = name.to_ascii_uppercase();
            if let Some((ui, exported)) = super::function_names::imported(&upper)
                && exported == name
            {
                text.push_str(&raw[..raw.len() - raw.trim_start().len()]);
                text.push_str(ui);
                text.push_str(&raw[raw.trim_end().len()..]);
            } else {
                text.push_str(raw);
            }
            text.push(c);
            token = i + 1;
        } else if matches!(
            c,
            '+' | '-'
                | '*'
                | '/'
                | '^'
                | '&'
                | '('
                | ')'
                | ','
                | ';'
                | ':'
                | '='
                | '<'
                | '>'
                | '{'
                | '}'
        ) {
            text.push_str(&source[token..i + 1]);
            token = i + 1;
        }
    }
    text.push_str(&source[token..]);
    Some(text)
}

#[cfg(test)]
#[allow(dead_code)] // The converter compatibility check validates acceptance.
pub(in crate::commands) struct Output {
    pub sheet: Option<String>,
    pub bytes: Vec<u8>,
}

#[cfg(test)]
pub(in crate::commands) fn workbook(
    sheets: &[Sheet<String>],
    filter: Option<&str>,
    date1904: bool,
    raw: &[BTreeMap<(usize, usize), (String, bool)>],
    mut remaining: usize,
) -> Result<Vec<Output>, String> {
    let selector = filter
        .and_then(|f| f.split_once(':'))
        .and_then(|(_, options)| options.split(',').nth(11))
        .unwrap_or("");
    let selected = if selector == "-1" {
        None
    } else if selector.bytes().all(|b| b.is_ascii_digit()) {
        Some(selector.parse::<i32>().unwrap_or(0) as usize)
    } else {
        return Err("Bad sheet number string given.".into());
    };
    if selected.is_some_and(|n| n > sheets.len()) {
        return Err(format!(
            "No sheet number {}, number of sheets is {}",
            selected.unwrap(),
            sheets.len()
        ));
    }
    let range = match selected {
        None => 0..sheets.len(),
        Some(0) => 0..1,
        Some(n) => n - 1..n,
    };
    remaining = remaining
        .checked_sub(
            range
                .len()
                .checked_mul(std::mem::size_of::<Output>())
                .ok_or(LIMIT)?,
        )
        .ok_or(LIMIT)?;
    let mut outputs = Vec::new();
    let mut work = remaining;
    let empty = BTreeMap::new();
    for index in range {
        let sheet = sheets.get(index).ok_or(LIMIT)?;
        let name = if selected == Some(0) {
            None
        } else {
            remaining = remaining.checked_sub(sheet.name.len()).ok_or(LIMIT)?;
            let mut bytes = Vec::new();
            let mut chars = sheet.name.bytes().peekable();
            while let Some(b) = chars.next() {
                if b == b'%' {
                    let mut look = chars.clone();
                    if let Some(a) = look.next().and_then(|b| (b as char).to_digit(16))
                        && let Some(b) = look.next().and_then(|b| (b as char).to_digit(16))
                    {
                        bytes.push((a * 16 + b) as u8);
                        chars = look;
                        continue;
                    }
                }
                bytes.push(b);
            }
            let name = String::from_utf8(bytes).map_err(|_| "Invalid CSV sheet filename")?;
            if name.contains('\0') {
                return Err("Invalid CSV sheet filename".into());
            }
            Some(name)
        };
        let bytes = spreadsheet(
            sheet,
            filter,
            date1904,
            raw.get(index).unwrap_or(&empty),
            remaining,
            &mut work,
        )?;
        remaining = remaining.checked_sub(bytes.len()).ok_or(LIMIT)?;
        outputs.push(Output { sheet: name, bytes });
    }
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_literal_rendering_preserves_tokens_and_bounds_expansion() {
        let source = "=1e14";
        assert!(formula_numbers(source, &mut 20).is_none());
        assert_eq!(
            formula_numbers(source, &mut 21).unwrap(),
            "=100000000000000"
        );
        assert_eq!(
            formula_numbers("='1.200'!A1+1E-15+\"1.200\"", &mut 4096).unwrap(),
            "='1.200'!A1+1E-015+\"1.200\""
        );
        assert_eq!(
            formula_numbers("=1e999+1e-999+A001+1E2", &mut 4096).unwrap(),
            "=1e999+1e-999+A001+100"
        );
    }

    #[test]
    fn csv_formula_limit_failures_preserve_existing_cells() {
        for (source, limit) in [
            (
                format!("value\n{}", "=COUNTBLANK(A1:B1)\n".repeat(1024)),
                24_000,
            ),
            ("=1e15\n".into(), 12),
            (format!("={}1{}\n", "(".repeat(100), ")".repeat(100)), 4096),
        ] {
            let mut book = crate::commands::spreadsheet::Spreadsheet::new();
            book.edit(&[(0, 0, 0, "old")], 10_000_000).unwrap();
            let edits: Vec<_> = source
                .lines()
                .enumerate()
                .map(|(r, text)| (0, r, 0, text))
                .collect();
            assert!(book.edit(&edits, limit).is_err());
            assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "old");
            assert_eq!(book.sheets[0].cells.len(), 1);
        }
    }

    #[test]
    fn csv_surrogate_delimiters_preserve_units_and_atomic_limits() {
        for (options, text, is_text, expected) in [
            ("44,55330,97", "a\"b", true, &b"\"a\"\"b\"\n"[..]),
            ("44,55345,97", "12.5", false, &b"12.5\n"[..]),
            ("55296,34,76", "plain", true, &b"plain\n"[..]),
            ("0,34,97", "Ā", true, &b"\"\0\"\n"[..]),
            (
                "44,55296,64",
                "\u{f181}\u{f140}",
                true,
                &b"\x81\x63\x81\x40\n"[..],
            ),
            (
                "44,55357,90",
                "😀",
                true,
                &b"\xed\xa0\xbd\xed\xa0\xbd\xed\xa0\xbd\xed\xb8\x80\xed\xa0\xbd\n"[..],
            ),
            (
                "44,56832,90",
                "😀",
                true,
                &b"\xed\xb8\x80\xed\xa0\xbd\xed\xb8\x80\xed\xb8\x80\xed\xb8\x80\n"[..],
            ),
            ("0,34,90", "A\0B", true, &b"\"A\xc0\x80B\"\n"[..]),
            (
                "44,55357,65535",
                "😀",
                true,
                &b"\xff\xfe\x3d\xd8\x3d\xd8\x3d\xd8\0\xde\x3d\xd8\n\0"[..],
            ),
            (
                "44,56832,65535",
                "😀",
                true,
                &b"\xff\xfe\0\xde\x3d\xd8\0\xde\0\xde\0\xde\n\0"[..],
            ),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options},1,,0,false,true,false");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), is_text, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "{options}: partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(success, limit == expected.len(), "{options}: {limit}");
                if success {
                    assert_eq!(csv.output, expected, "{options}");
                }
            }
        }
    }

    #[test]
    fn csv_raw_formula_units_obey_atomic_output_limits() {
        // Token truncation can leave a high surrogate before a closing token
        // or at EOF. Raw encodings retain it; other encoders recover differently.
        let units = [97, 0xd83d, 41, 0xd83d];
        for (id, expected) in [
            (76, &b"a?\n"[..]),
            (1, &b"a?)\n"[..]),
            (64, &b"a?)\n"[..]),
            (85, &b"a?\n"[..]),
            (71, &b"a?\n"[..]),
            (86, &b"a?\n"[..]),
            (91, &b"a?\n"[..]),
            (75, &b"a+2D0-)+2D0-\n"[..]),
            (90, &b"a\xed\xa0\xbd)\xed\xa0\xbd\n"[..]),
            (97, &b"a=)=\n"[..]),
            (65535, &b"\xff\xfea\0\x3d\xd8)\0\x3d\xd8\n\0"[..]),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):44,0,{id}");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(units.iter().copied(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "{id}: partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(success, limit == expected.len(), "{id}: {limit}");
                if success {
                    assert_eq!(csv.output, expected, "{id}");
                }
            }
        }
    }

    #[test]
    fn csv_encoded_fields_respect_byte_limits_without_partial_writes() {
        for (id, text, expected) in [
            (
                "65535",
                "😀∀Ā",
                &b"\xff\xfe\x3d\xd8\x00\xde\x00\x22\x00\x01\x0a\x00"[..],
            ),
            ("10", "α", &b"?\n"[..]),
            ("91", "\u{f122}", &b"\0\n"[..]),
            ("92", "ABC", &b"????????\n"[..]),
            ("94", "ABC", &b"????????\n"[..]),
            ("90", "A\0😀", &b"A\xc0\x80\xed\xa0\xbd\xed\xb8\x80\n"[..]),
            ("40", "Ã", &b"A\xde\n"[..]),
            ("12", "‟", &b"\"\"\"\"\n"[..]),
            ("69", "˘", &b"\x8f\xa2\xaf\n"[..]),
            ("71", "𠀀", &b"\x8e\xa5\xa1\xa5\n"[..]),
            ("71", "\u{f0000}", &b"\0\n"[..]),
            (
                "71",
                "\u{f0000}\u{f0000}\u{f0000}\u{f0000}",
                &b"\0\0\0\0\n"[..],
            ),
            ("64", "日", &b"\x93\xfa\n"[..]),
            ("68", "中", &b"\xa4\xa4\n"[..]),
            ("86", "𠀡", &b"\x9c\x71\n"[..]),
            ("85", "\u{80}", &b"\x81\x30\x81\x30\n"[..]),
            ("85", "😀", &b"\x94\x39\xfc\x36\n"[..]),
            ("85", "\u{10ffff}", &b"\xe3\x32\x9a\x35\n"[..]),
            ("9", "😀Ā", &b"=\0\0\n"[..]),
            ("97", "ĢĬĊ", &b"\"\"\",\n\"\n"[..]),
            ("65536", "Ā", &b"\0\n"[..]),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):44,34,{id},1,,0,false,true,false");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "{id}: partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(success, limit == expected.len(), "{id}: {limit}");
                if success {
                    assert_eq!(csv.output, expected);
                }
            }
        }
    }

    #[test]
    fn csv_symbol_quotes_and_disabled_separators_obey_output_limits() {
        for (options, text, is_text, expected) in [
            ("0,34,91", "α", true, &b"\"?\"\n"[..]),
            ("0,34,91", "\u{f122}", true, &b"\0\n"[..]),
            ("44,34,94", "12.5", false, &b"????\n"[..]),
            ("44,34,94", "12.5", true, &b"??????????\n"[..]),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options},1,,0,false,true,false");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), is_text, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "{options}: partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(success, limit == expected.len(), "{options}: {limit}");
                if success {
                    assert_eq!(csv.output, expected, "{options}");
                }
            }
        }
    }

    #[test]
    fn csv_gb18030_digit_quotes_do_not_split_encoded_characters() {
        let filter = "Text - txt - csv (StarCalc):44,48,85,1,,0,false,true,false";
        for (text, expected) in [
            ("\u{80}", &b"\x81\x30\x81\x30\n"[..]),
            ("0\u{80}", &b"000\x81\x30\x81\x300\n"[..]),
        ] {
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(success, limit == expected.len(), "{text:?}: {limit}");
                if success {
                    assert_eq!(csv.output, expected);
                }
            }
        }
    }

    #[test]
    fn csv_dbcs_quotes_round_trip_whole_fields_with_bounded_output() {
        let filter = "Text - txt - csv (StarCalc):44,12288,64,1,,0,false,true,false";
        let expected = b"\x81\x40\x81\x63\x81\x40\x81\x40\x81\x40\n";
        for limit in 0..=expected.len() {
            let mut csv = Csv::new(Some(filter), limit).unwrap();
            let before = csv.output.clone();
            let field = csv.field("\u{f181}\u{f140}".encode_utf16(), true, true);
            if field.is_none() {
                assert_eq!(csv.output, before, "partial field at {limit}");
            }
            let success = field.is_some() && csv.row().is_some();
            assert_eq!(success, limit == expected.len(), "{limit}");
            if success {
                assert_eq!(csv.output, expected);
            }
        }
    }

    #[test]
    fn csv_chinese_state_changes_and_quotes_obey_exact_limits() {
        for (options, text, expected) in [
            ("44,34,73", "一", "\x1b$)A\x0eR;\x0f\n"),
            ("44,34,73", "丟", "\x1b$)G\x0eG#\x0f\n"),
            ("44,34,73", "乂", "\x1b$*H\x1bN!!\n"),
            ("44,65,73", "一", "\x1b$)A\x0eR;\x0f\n"),
            (
                "44,34,73",
                "一丟一",
                "\x1b$)A\x0eR;\x0f\x1b$)G\x0eG#D!\x0f\n",
            ),
            (
                "44,34,73",
                "一A\n一",
                "\"\x1b$)A\x0eR;\x0fA\n\x0eR;\x0f\"\n",
            ),
            ("44,34,73", "乂\n乂", "\"\x1b$*H\x1bN!!\n\x1bN!!\"\n"),
            (
                "44,34,73",
                "一乂\n乂",
                "\"\x1b$)A\x0eR;\x1b$*H\x1bN!!\x0f\n\x1b$*H\x1bN!!\"\n",
            ),
            (
                "44,20034,73",
                "乂",
                "\x1b$*H\x1bN!!\x1b$*H\x1bN!!\x1bN!!\x1b$*H\x1bN!!\n",
            ),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options}");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before);
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(
                    success,
                    limit == expected.len(),
                    "{options}: {text:?}, {limit}"
                );
                if success {
                    assert_eq!(csv.output, expected.as_bytes());
                }
            }
        }
    }

    #[test]
    fn csv_chinese_normalization_can_shrink_before_output_limits() {
        let mut csv = Csv::new(Some("Text - txt - csv (StarCalc):44,34,73"), 11).unwrap();
        csv.field("–―".encode_utf16(), true, true).unwrap();
        csv.row().unwrap();
        assert_eq!(csv.output, b"\x1b$)G\x0e!9!7\x0f\n");
    }

    #[test]
    fn csv_korean_normalization_can_shrink_before_output_limits() {
        for repeats in [2, 4096] {
            let text = format!("겵{}", "썶쯇".repeat(repeats));
            let mut csv = Csv::new(Some("Text - txt - csv (StarCalc):44,34,80"), 8).unwrap();
            csv.field(text.encode_utf16(), true, true).unwrap();
            csv.row().unwrap();
            assert_eq!(csv.output, b"\x1b$)C?A?\n");
        }
    }

    #[test]
    fn csv_korean_headers_quotes_and_normalization_obey_exact_limits() {
        for (options, text, expected) in [
            ("44,34,80", "A", "\x1b$)CA\n"),
            ("44,34,80", "한", "\x1b$)C\x0eGQ\x0f\n"),
            ("44,34,80", "갂", "\x1b$)C?A?\n"),
            ("44,34,80", "룢ㄹ횓", "\n"),
            ("44,34,80,1,,0,true", "룢ㄹ횓", "\x1b$)C\"\x1b$)C\"\n"),
            ("44,0,80", "갂", "\x1b$)C\x0e\x01A\x0f\n"),
            ("44,34,80", "a,b", "\x1b$)C\"\x1b$)Ca,b\x1b$)C\"\n"),
            ("44,34,80", "", "\n"),
            ("44,55357,80,1,,0,true", "A", "\x1b$)C\x1b$)CA\x1b$)C\n"),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options}");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before);
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(
                    success,
                    limit == expected.len(),
                    "{options}: {text:?}, {limit}"
                );
                if success {
                    assert_eq!(csv.output, expected.as_bytes());
                }
            }
        }
    }

    #[test]
    fn csv_iso2022jp_round_trip_quotes_and_shifts_obey_byte_limits() {
        for (options, text, expected) in [
            ("44,34,72", "日", "\x1b$BF|\x1b(B\n"),
            ("44,34,72", "¥", "\x1b$B!o\x1b(B\n"),
            ("44,34,72", "日😀日", "\x1b$BF|\x1b(B?\x1b$BF|\x1b(B\n"),
            ("44,63,72", "日😀日", "?\x1b$BF|\x1b(B??\x1b$BF|\x1b(B?\n"),
            (
                "44,26085,72",
                "日",
                "\x1b$BF|\x1b(B\x1b$BF|F|\x1b(B\x1b$BF|\x1b(B\n",
            ),
            ("0,34,72", "\u{e000}", "\"\0\"\n"),
            (
                "44,0,72",
                "日\u{f0000}日",
                "\x1b$BF|\x1b(B\0\x1b$BF|\x1b(B\n",
            ),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options}");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "{options}: partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(
                    success,
                    limit == expected.len(),
                    "{options}: {text:?}, {limit}"
                );
                if success {
                    assert_eq!(csv.output, expected.as_bytes());
                }
            }
        }
    }

    #[test]
    fn csv_utf7_escapes_units_before_shifting_and_bounds_output() {
        for (options, text, expected) in [
            ("44,34,75", "A", "A\n"),
            ("44,34,75", "日", "+ZeU-\n"),
            ("44,34,75", "日++A", "+ZeUAKwAr-A\n"),
            ("44,34,75", "a\rb", "+ACI-a+AA0-b+ACI-\n"),
            ("44,34,75", "a\u{c}b", "a\u{c}b\n"),
            ("44,34,75", "x\"y,z", "+ACI-x+ACIAIg-y,z+ACI-\n"),
            ("44,55357,75", "😀", "+2D0-+2D3YPd4A-+2D0-\n"),
            ("44,56832,75", "😀", "+3gA-+2D3eAN4A-+3gA-\n"),
            ("0,34,75", "\0", "+ACI-+AAA-+ACI-\n"),
            ("44,34,75,1,,0,true", "", "+ACI-+ACI-\n"),
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options}");
            for limit in 0..=expected.len() {
                let mut csv = Csv::new(Some(&filter), limit).unwrap();
                let before = csv.output.clone();
                let field = csv.field(text.encode_utf16(), true, true);
                if field.is_none() {
                    assert_eq!(csv.output, before, "{options}: partial field at {limit}");
                }
                let success = field.is_some() && csv.row().is_some();
                assert_eq!(
                    success,
                    limit == expected.len(),
                    "{options}: {text:?}, {limit}"
                );
                if success {
                    assert_eq!(csv.output, expected.as_bytes());
                }
            }
        }
    }

    #[test]
    fn csv_unused_delimiters_do_not_consume_the_output_budget() {
        for options in [
            "44,20034,73",
            "44,26085,72",
            "44,34,75",
            "0,0,75",
            "44,8220,76",
            "8220,34,76",
        ] {
            let filter = format!("Text - txt - csv (StarCalc):{options}");
            let mut csv = Csv::new(Some(&filter), 2).unwrap();
            assert!(
                csv.field("A".encode_utf16(), true, true).is_some(),
                "{options}"
            );
            csv.row().unwrap();
            assert_eq!(csv.output, b"A\n");
        }
    }

    #[test]
    fn csv_empty_leading_cells_count_only_emitted_separators_and_quotes() {
        for (filter, expected) in [
            (
                "Text - txt - csv (StarCalc):44,34,80",
                &b"\x1b$)C,\x1b$)C,"[..],
            ),
            (
                "Text - txt - csv (StarCalc):55357,34,80",
                &b"\x1b$)C\x1b$)C"[..],
            ),
        ] {
            let mut csv = Csv::new(Some(filter), expected.len()).unwrap();
            assert!(csv.empty_fields(4, true).is_none());
            assert!(csv.output.is_empty());
            csv.empty_fields(3, true).unwrap();
            assert_eq!(csv.output, expected);
        }
        let mut csv = Csv::new(Some("Text - txt - csv (StarCalc):0,34,80,1,,0,true"), 0).unwrap();
        csv.empty_fields(usize::MAX, true).unwrap();
        assert!(csv.output.is_empty());
        assert!(csv.field("".encode_utf16(), true, true).is_none());
    }

    #[test]
    fn csv_empty_fields_bound_expansion_and_skip_empty_output() {
        for id in [72, 73, 75, 90] {
            let filter = format!("Text - txt - csv (StarCalc):0,34,{id}");
            let mut csv = Csv::new(Some(&filter), 1).unwrap();
            csv.field("a".encode_utf16(), true, true).unwrap();
            assert!(csv.empty_fields(usize::MAX, false).is_some());
            assert_eq!(csv.output, b"a");
        }
        for (filter, expected) in [
            (None, &b"a,,,"[..]),
            (
                Some("Text - txt - csv (StarCalc):20034,34,73"),
                &b"a\x1b$*H\x1bN!!\x1b$*H\x1bN!!\x1b$*H\x1bN!!"[..],
            ),
            (
                Some("Text - txt - csv (StarCalc):26085,34,72"),
                &b"a\x1b$BF|\x1b(B\x1b$BF|\x1b(B\x1b$BF|\x1b(B"[..],
            ),
            (
                Some("Text - txt - csv (StarCalc):26085,34,75"),
                &b"a+ZeU-+ZeU-+ZeU-"[..],
            ),
            (
                Some("Text - txt - csv (StarCalc):44,34,65535"),
                &b"\xff\xfea\0,\0,\0,\0"[..],
            ),
        ] {
            let mut csv = Csv::new(filter, expected.len()).unwrap();
            csv.field("a".encode_utf16(), true, true).unwrap();
            let before = csv.output.clone();
            assert!(csv.empty_fields(usize::MAX, false).is_none());
            assert_eq!(csv.output, before);
            assert!(csv.empty_fields(4, false).is_none());
            assert_eq!(csv.output, before);
            csv.empty_fields(0, false).unwrap();
            assert_eq!(csv.output, before);
            csv.empty_fields(3, false).unwrap();
            assert_eq!(csv.output, expected);
        }
    }

    #[test]
    fn csv_limits_include_utf8_quotes_bom_and_record_terminators() {
        let filter =
            "Text - txt - csv (StarCalc):44,8220,76,1,,0,true,true,true,false,false,0,false,true";
        let mut csv = Csv::new(Some(filter), 12).unwrap();
        assert!(csv.field("é".encode_utf16(), true, true).is_some());
        assert!(csv.row().is_some());
        assert_eq!(csv.output, "\u{feff}“é“\n".as_bytes());
        let mut csv = Csv::new(Some(filter), 11).unwrap();
        assert!(csv.field("é".encode_utf16(), true, true).is_some());
        assert!(csv.row().is_none());
        let mut csv = Csv::new(Some(filter), 10).unwrap();
        let before = csv.output.clone();
        assert!(csv.field("é".encode_utf16(), true, true).is_none());
        assert_eq!(csv.output, before);
        let mut csv = Csv::new(None, 5).unwrap();
        assert!(csv.field("a\"b".encode_utf16(), true, true).is_none());
        assert!(csv.output.is_empty());
        assert!(formula_text("Sheet!A1", None, None, &mut 10).is_none());
    }
    #[test]
    fn csv_sheets_share_the_formatting_budget() {
        use crate::commands::spreadsheet::model::TypedCell;
        let sheets: Vec<_> = (0..2)
            .map(|i| Sheet {
                state: "visible",
                name: format!("Sheet{i}"),
                view: Vec::new(),
                print: Default::default(),
                filter: None,
                cells: [(
                    (0, 0),
                    TypedCell {
                        legacy_formula: false,
                        value: Some(Value::Number(1.)),
                        formula: None,
                        openformula: None,
                        formula_display: None,
                        format: None,
                        value_format: None,
                        style: None,
                        rich_text: None,
                    },
                )]
                .into(),
                rows: BTreeMap::new(),
                columns: BTreeMap::new(),
                merges: Vec::new(),
                arrays: Vec::new(),
                comments: Vec::new(),
                empty_headers: false,
                default_row_height: None,
                frozen_rows: 0,
                frozen_columns: 0,
                default_column_width: None,
            })
            .collect();
        assert!(workbook(&sheets[..1], None, false, &[], 1024).is_ok());
        let filter = "Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1";
        assert_eq!(
            workbook(&sheets, Some(filter), false, &[], 1024)
                .err()
                .as_deref(),
            Some(LIMIT)
        );
        assert!(workbook(&sheets, Some(filter), false, &[], 4096).is_ok());
    }
}
